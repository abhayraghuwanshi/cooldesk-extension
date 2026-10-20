// The Shelf: a temporary holding space for things passing through CoolDesk —
// downloads from the in-app browser, pasted text/images, files dropped in —
// instead of everything landing in ~/Downloads. Items are real files in the
// app-data folder (so preview, native drag-out and "save to…" just work) plus
// a small JSON index. Unpinned items expire after `TTL_DAYS`.
//
// Only CoolDesk's own pages can reach these commands: browser panes are
// refused all app commands (guard_remote_webviews in lib.rs).

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

const TTL_DAYS: i64 = 7;
const INDEX: &str = "index.json";

lazy_static::lazy_static! {
    /// Serializes index read-modify-write (downloads finish on WebKit's
    /// thread while the UI may be pinning/removing at the same time).
    static ref LOCK: Mutex<()> = Mutex::new(());
    /// Download URL → where we told WebKit to save it. WebKit's "finished"
    /// event doesn't always carry the path, and without it the file landed
    /// in the folder but never in the index (invisible on the Shelf).
    static ref PENDING: Mutex<std::collections::HashMap<String, PathBuf>> = Mutex::new(std::collections::HashMap::new());
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ShelfItem {
    pub id: String,
    /// Display name (the file's name in the shelf folder).
    pub name: String,
    /// "file" | "text" | "image"
    pub kind: String,
    pub size: u64,
    /// Where it came from: a page URL for downloads, "clipboard", or the
    /// original path for imported files.
    pub source: Option<String>,
    /// Milliseconds since the epoch.
    pub added: i64,
    pub pinned: bool,
    /// Absolute path; filled in when listing, not stored.
    #[serde(default, skip_deserializing)]
    pub path: String,
    /// When it expires (ms), or None if pinned; filled in when listing.
    #[serde(default, skip_deserializing)]
    pub expires: Option<i64>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn shelf_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("shelf");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_index(dir: &Path) -> Vec<ShelfItem> {
    std::fs::read_to_string(dir.join(INDEX))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_index(dir: &Path, items: &[ShelfItem]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    // Write-then-rename so a crash can't leave a half-written index.
    let tmp = dir.join(format!("{INDEX}.tmp"));
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(INDEX)).map_err(|e| e.to_string())
}

/// Strip path separators and other troublemakers from a suggested name.
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '\0') || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').to_string();
    if trimmed.is_empty() || trimmed == INDEX { "item".into() } else { trimmed }
}

/// `name` in the shelf folder, or `name (1)`, `name (2)`… if taken.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let name = safe_name(name);
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.clone(), String::new()),
    };
    let mut candidate = dir.join(&name);
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    candidate
}

fn kind_for(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "heic" => "image",
        _ => "file",
    }
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Record a file that's already in the shelf folder.
fn add_entry(app: &tauri::AppHandle, path: &Path, kind: Option<&str>, source: Option<String>) -> Result<ShelfItem, String> {
    let dir = shelf_dir(app)?;
    let _guard = LOCK.lock().unwrap();
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("bad path")?;
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let item = ShelfItem {
        id: new_id(),
        kind: kind.unwrap_or_else(|| kind_for(&name)).to_string(),
        name,
        size,
        source,
        added: now_ms(),
        pinned: false,
        path: String::new(),
        expires: None,
    };
    let mut items = read_index(&dir);
    items.push(item.clone());
    write_index(&dir, &items)?;
    drop(_guard);
    let _ = app.emit("shelf-changed", ());
    Ok(item)
}

/// Drop expired, unpinned items (and their files), and index entries whose
/// file is gone. Runs on every listing.
fn purge(dir: &Path, items: Vec<ShelfItem>) -> Vec<ShelfItem> {
    let cutoff = now_ms() - TTL_DAYS * 24 * 3600 * 1000;
    items
        .into_iter()
        .filter(|it| {
            let file = dir.join(&it.name);
            if !file.exists() {
                return false;
            }
            if !it.pinned && it.added < cutoff {
                let _ = std::fs::remove_file(&file);
                return false;
            }
            true
        })
        .collect()
}

/// Files in the shelf folder with no index entry (a download whose finish
/// event came without a path, a crash mid-write…) — add them so nothing sits
/// there invisibly. Their age is the file's modified time.
fn adopt_orphans(dir: &Path, items: &mut Vec<ShelfItem>) -> usize {
    let known: std::collections::HashSet<String> = items.iter().map(|i| i.name.clone()).collect();
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut adopted = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        // Skip the index, its temp file, partial downloads and dotfiles.
        if !meta.is_file() || name == INDEX || name.starts_with('.') || name.ends_with(".tmp") || name.ends_with(".download") || known.contains(&name) {
            continue;
        }
        let added = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or_else(now_ms);
        items.push(ShelfItem {
            id: new_id(),
            kind: kind_for(&name).to_string(),
            name,
            size: meta.len(),
            source: None,
            added,
            pinned: false,
            path: String::new(),
            expires: None,
        });
        adopted += 1;
    }
    adopted
}

#[tauri::command]
pub fn shelf_list(app: tauri::AppHandle) -> Result<Vec<ShelfItem>, String> {
    let dir = shelf_dir(&app)?;
    let _guard = LOCK.lock().unwrap();
    let before = read_index(&dir);
    let count = before.len();
    let mut items = purge(&dir, before);
    let adopted = adopt_orphans(&dir, &mut items);
    if items.len() != count || adopted > 0 {
        write_index(&dir, &items)?;
    }
    for it in &mut items {
        it.path = dir.join(&it.name).to_string_lossy().into_owned();
        it.expires = (!it.pinned).then(|| it.added + TTL_DAYS * 24 * 3600 * 1000);
    }
    items.sort_by(|a, b| b.added.cmp(&a.added));
    Ok(items)
}

/// Pasted / typed text, saved as a .txt so it can be previewed and dragged
/// onto pages like any file.
#[tauri::command]
pub fn shelf_add_text(app: tauri::AppHandle, text: String, name: Option<String>) -> Result<ShelfItem, String> {
    if text.trim().is_empty() {
        return Err("Nothing to add".into());
    }
    let dir = shelf_dir(&app)?;
    let base = name.unwrap_or_else(|| {
        // First line with real words in it ("{" from pasted JSON makes a
        // useless name), else "Clip <date, time>".
        let first = text
            .lines()
            .map(str::trim)
            .find(|l| l.chars().filter(|c| c.is_alphanumeric()).count() >= 3)
            .map(|l| l.chars().take(40).collect::<String>());
        match first {
            Some(f) => f.trim().to_string(),
            None => format!("Clip {}", chrono::Local::now().format("%-d %b, %-I.%M %p")),
        }
    });
    let path = unique_path(&dir, &format!("{}.txt", base.trim_end_matches(".txt")));
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    add_entry(&app, &path, Some("text"), Some("clipboard".into()))
}

/// Save raw bytes as a new shelf item (screenshots, pasted images).
pub fn add_file_bytes(app: &tauri::AppHandle, name: &str, bytes: &[u8], source: Option<String>) -> Result<ShelfItem, String> {
    let dir = shelf_dir(app)?;
    let path = unique_path(&dir, name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    add_entry(app, &path, None, source)
}

/// Pasted image / file bytes (base64 from the frontend's clipboard read).
#[tauri::command]
pub fn shelf_add_bytes(app: tauri::AppHandle, name: String, data: String, source: Option<String>) -> Result<ShelfItem, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("Bad data: {e}"))?;
    add_file_bytes(&app, &name, &bytes, source.or(Some("clipboard".into())))
}

/// Copy files in (dropped from Finder or the file manager). Folders are
/// skipped — the shelf holds files.
#[tauri::command]
pub fn shelf_import(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<ShelfItem>, String> {
    let dir = shelf_dir(&app)?;
    let mut added = Vec::new();
    for p in paths {
        let src = PathBuf::from(&p);
        if !src.is_file() {
            continue;
        }
        let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "item".into());
        let dest = unique_path(&dir, &name);
        std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        added.push(add_entry(&app, &dest, None, Some(p))?);
    }
    Ok(added)
}

fn update<F: FnOnce(&mut Vec<ShelfItem>, &Path) -> Result<(), String>>(app: &tauri::AppHandle, f: F) -> Result<(), String> {
    let dir = shelf_dir(app)?;
    {
        let _guard = LOCK.lock().unwrap();
        let mut items = read_index(&dir);
        f(&mut items, &dir)?;
        write_index(&dir, &items)?;
    }
    let _ = app.emit("shelf-changed", ());
    Ok(())
}

#[tauri::command]
pub fn shelf_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    update(&app, |items, dir| {
        if let Some(i) = items.iter().position(|it| it.id == id) {
            let _ = std::fs::remove_file(dir.join(&items[i].name));
            items.remove(i);
        }
        Ok(())
    })
}

#[tauri::command]
pub fn shelf_pin(app: tauri::AppHandle, id: String, pinned: bool) -> Result<(), String> {
    update(&app, |items, _| {
        if let Some(it) = items.iter_mut().find(|it| it.id == id) {
            it.pinned = pinned;
        }
        Ok(())
    })
}

/// Remove everything (pinned items too, only when asked).
#[tauri::command]
pub fn shelf_clear(app: tauri::AppHandle, include_pinned: bool) -> Result<(), String> {
    update(&app, |items, dir| {
        items.retain(|it| {
            let keep = it.pinned && !include_pinned;
            if !keep {
                let _ = std::fs::remove_file(dir.join(&it.name));
            }
            keep
        });
        Ok(())
    })
}

/// Move an item out of the shelf into a real folder (default ~/Downloads),
/// with the same no-overwrite naming. Returns the new path. A rename keeps
/// the file's quarantine attribute, so Gatekeeper still checks downloads.
#[tauri::command]
pub fn shelf_save_to(app: tauri::AppHandle, id: String, dest_dir: Option<String>) -> Result<String, String> {
    let target_dir = match dest_dir {
        Some(d) => PathBuf::from(d),
        None => dirs::download_dir().ok_or("No Downloads folder")?,
    };
    if !target_dir.is_dir() {
        return Err("Destination folder doesn't exist".into());
    }
    let mut moved = String::new();
    update(&app, |items, dir| {
        let i = items.iter().position(|it| it.id == id).ok_or("Item not found")?;
        let src = dir.join(&items[i].name);
        let dest = unique_path(&target_dir, &items[i].name);
        if std::fs::rename(&src, &dest).is_err() {
            // Different volume: copy, then remove.
            std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&src);
        }
        moved = dest.to_string_lossy().into_owned();
        items.remove(i);
        Ok(())
    })?;
    Ok(moved)
}

// ── Downloads from browser panes ─────────────────────────────────────────

#[derive(Clone, Serialize)]
struct DownloadState {
    name: String,
    url: String,
    /// "started" | "finished" | "failed"
    state: &'static str,
}

/// `on_download` handler for browser panes: everything a page downloads goes
/// to the shelf instead of ~/Downloads.
pub fn download_handler<R: tauri::Runtime>(
    app: tauri::AppHandle,
) -> impl Fn(tauri::Webview<R>, tauri::webview::DownloadEvent<'_>) -> bool + Send + Sync + 'static {
    move |_wv, event| match event {
        tauri::webview::DownloadEvent::Requested { url, destination } => {
            let Ok(dir) = shelf_dir(&app) else { return true };
            let name = destination
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "download".into());
            *destination = unique_path(&dir, &name);
            PENDING.lock().unwrap().insert(url.to_string(), destination.clone());
            let shown = destination.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(name);
            log::info!("[Shelf] download {url} → {}", destination.display());
            let _ = app.emit("shelf-download", DownloadState { name: shown, url: url.to_string(), state: "started" });
            true
        }
        tauri::webview::DownloadEvent::Finished { url, path, success } => {
            // Fall back to the destination we chose: WebKit doesn't always
            // report it.
            let requested = PENDING.lock().unwrap().remove(url.as_str());
            let saved = path.filter(|p| p.exists()).or(requested.filter(|p| p.exists()));
            let name = saved
                .as_ref()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if success {
                match saved.as_ref() {
                    Some(p) => {
                        let _ = add_entry(&app, p, None, Some(url.to_string()));
                    }
                    // Saved under a name we didn't predict: the next listing
                    // adopts it from the folder.
                    None => {
                        let _ = app.emit("shelf-changed", ());
                    }
                }
            }
            log::info!("[Shelf] download {} {url}", if success { "finished" } else { "failed" });
            let _ = app.emit(
                "shelf-download",
                DownloadState { name, url: url.to_string(), state: if success { "finished" } else { "failed" } },
            );
            true
        }
        _ => true,
    }
}
