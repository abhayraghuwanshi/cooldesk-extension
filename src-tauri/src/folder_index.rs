// Folder permissions & indexing — a user-maintained list of folders CoolDesk
// is allowed to search, beyond the built-in home/Desktop/Downloads/Documents
// set `search_files` already covers. No OS-level permission grant involved
// (no security-scoped bookmarks, no entitlements) — this is purely an
// app-level registry: which paths the user has explicitly linked, each with
// its own enabled/exclude/auto-reindex settings, plus a manual "reindex now"
// action so the file-count/last-indexed stats in Settings reflect what's
// actually on disk.
//
// Fully cross-platform: the registry, persistence, and the recursive walk
// used for both counting and (via `search_files`) locating files are plain
// `std::fs`, not tied to any OS search service. On macOS, reindexing also
// shells out to `mdimport` so Spotlight's own index picks up a
// newly-linked folder immediately — `search_files` there queries `mdfind`,
// which depends on that index existing — but that's a best-effort nudge on
// top of the OS-independent stats, not a requirement for the feature to work.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone)]
pub struct IndexedFolder {
    pub path: String,
    pub enabled: bool,
    /// 0 = manual reindex only.
    #[serde(default)]
    pub auto_reindex_minutes: u32,
    /// User-supplied name fragments to prune during the walk, on top of the
    /// built-in noise list (`is_pruned_dir` in `lib.rs`) — e.g. a folder full
    /// of large `cache`/`logs` subfolders the user doesn't want walked.
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Off by default: most linked folders (a project, a document tree) have
    /// no apps in them, so scanning every one for `.app`/`.exe` bundles on
    /// every app-list refresh would just be wasted work. Flip on for a
    /// folder that's actually an app location the OS-standard scan misses
    /// (a portable-apps folder, an external drive's Applications dir, ...).
    #[serde(default)]
    pub include_apps: bool,
    #[serde(default)]
    pub last_indexed: Option<String>,
    #[serde(default)]
    pub file_count: Option<usize>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct FolderIndexState {
    folders: Vec<IndexedFolder>,
}

fn state_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path().app_config_dir().ok().map(|dir| dir.join("folder_index.json"))
}

fn load(app: &tauri::AppHandle) -> FolderIndexState {
    let Some(path) = state_path(app) else { return FolderIndexState::default() };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<FolderIndexState>(&s).ok())
        .unwrap_or_default()
}

fn save(app: &tauri::AppHandle, state: &FolderIndexState) {
    let Some(path) = state_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(&path, json);
    }
}

/// Enabled folders' paths, for `search_files` to fold into its scan targets.
pub fn enabled_paths(app: &tauri::AppHandle) -> Vec<String> {
    load(app).folders.into_iter().filter(|f| f.enabled).map(|f| f.path).collect()
}

/// Enabled folders with `include_apps` on, for the installed-app scanner
/// (`scanner::scan_apps`) to search for `.app`/`.exe` bundles alongside the
/// OS-standard locations.
pub fn app_scan_dirs(app: &tauri::AppHandle) -> Vec<String> {
    load(app)
        .folders
        .into_iter()
        .filter(|f| f.enabled && f.include_apps)
        .map(|f| f.path)
        .collect()
}

fn normalize(path: &str) -> String {
    // Trailing slashes make "the same folder" compare unequal; strip for
    // dedupe/lookup, but keep the original (non-stripped) string as what's
    // actually stored and shown, since `Path::new` handles either form fine.
    path.trim_end_matches(['/', '\\']).to_string()
}

/// Recursively counts files under `dir`, applying the same built-in prune
/// list `search_files`'s Windows walker uses (`super::is_pruned_dir`) plus
/// the folder's own `exclude` fragments. Budget-capped so a huge tree (an
/// entire home folder linked by mistake) can't hang the reindex command
/// indefinitely — this is a stats/coverage action, not a full-text index, so
/// an approximate count past the cap is an acceptable tradeoff.
fn walk_and_count(dir: &Path, exclude: &[String], budget: &mut u64) -> usize {
    if *budget == 0 { return 0; }
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut count = 0usize;
    for entry in entries.flatten() {
        if *budget == 0 { break; }
        *budget -= 1;
        let path = entry.path();
        let name_lower = entry.file_name().to_string_lossy().to_lowercase();
        if exclude.iter().any(|ex| !ex.is_empty() && name_lower.contains(&ex.to_lowercase())) {
            continue;
        }
        if path.is_dir() {
            if !super::is_pruned_dir(&name_lower) {
                count += walk_and_count(&path, exclude, budget);
            }
        } else {
            count += 1;
        }
    }
    count
}

fn now_string() -> String {
    let dt: chrono::DateTime<chrono::Local> = std::time::SystemTime::now().into();
    dt.format("%Y-%m-%d %H:%M").to_string()
}

/// Walks `folder.path`, updates its stats in place, and — on macOS — asks
/// Spotlight to (re)index the folder too, so `search_files`'s `mdfind` query
/// there can actually find what's in it; `mdimport` failing (already
/// indexed, Spotlight disabled for the volume, ...) doesn't fail the
/// reindex, since the OS-independent stats above are the real result.
fn reindex_one(folder: &mut IndexedFolder) {
    let dir = Path::new(&folder.path);
    if !dir.is_dir() {
        folder.status = Some(format!("not found: {}", folder.path));
        return;
    }
    let mut budget: u64 = 300_000;
    let count = walk_and_count(dir, &folder.exclude, &mut budget);
    folder.file_count = Some(count);
    folder.last_indexed = Some(now_string());
    folder.status = if budget == 0 { Some("indexed (large folder, count approximate)".into()) } else { None };

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("mdimport").arg(&folder.path).output();
    }
}

#[tauri::command]
pub fn folder_index_list(app: tauri::AppHandle) -> Vec<IndexedFolder> {
    load(&app).folders
}

#[tauri::command]
pub fn folder_index_add(app: tauri::AppHandle, path: String) -> Result<Vec<IndexedFolder>, String> {
    let normalized = normalize(&path);
    if !Path::new(&normalized).is_dir() {
        return Err(format!("Not a folder: {path}"));
    }
    let mut state = load(&app);
    if state.folders.iter().any(|f| normalize(&f.path) == normalized) {
        return Err("That folder is already linked".to_string());
    }
    let mut folder = IndexedFolder {
        path: normalized,
        enabled: true,
        auto_reindex_minutes: 0,
        exclude: Vec::new(),
        include_apps: false,
        last_indexed: None,
        file_count: None,
        status: None,
    };
    reindex_one(&mut folder);
    state.folders.push(folder);
    save(&app, &state);
    Ok(state.folders)
}

#[tauri::command]
pub fn folder_index_remove(app: tauri::AppHandle, path: String) -> Vec<IndexedFolder> {
    let normalized = normalize(&path);
    let mut state = load(&app);
    state.folders.retain(|f| normalize(&f.path) != normalized);
    save(&app, &state);
    state.folders
}

#[tauri::command]
pub fn folder_index_set_options(
    app: tauri::AppHandle,
    path: String,
    enabled: Option<bool>,
    auto_reindex_minutes: Option<u32>,
    exclude: Option<Vec<String>>,
    include_apps: Option<bool>,
) -> Result<Vec<IndexedFolder>, String> {
    let normalized = normalize(&path);
    let mut state = load(&app);
    let folder = state
        .folders
        .iter_mut()
        .find(|f| normalize(&f.path) == normalized)
        .ok_or_else(|| format!("Not linked: {path}"))?;
    if let Some(v) = enabled { folder.enabled = v; }
    if let Some(v) = auto_reindex_minutes { folder.auto_reindex_minutes = v; }
    if let Some(v) = exclude { folder.exclude = v; }
    if let Some(v) = include_apps { folder.include_apps = v; }
    save(&app, &state);
    Ok(state.folders)
}

#[tauri::command]
pub async fn folder_index_reindex(app: tauri::AppHandle, path: String) -> Result<IndexedFolder, String> {
    let normalized = normalize(&path);
    let mut state = load(&app);
    let folder = state
        .folders
        .iter_mut()
        .find(|f| normalize(&f.path) == normalized)
        .ok_or_else(|| format!("Not linked: {path}"))?;
    reindex_one(folder);
    let result = folder.clone();
    save(&app, &state);
    Ok(result)
}

#[tauri::command]
pub async fn folder_index_reindex_all(app: tauri::AppHandle) -> Vec<IndexedFolder> {
    let mut state = load(&app);
    for folder in state.folders.iter_mut().filter(|f| f.enabled) {
        reindex_one(folder);
    }
    save(&app, &state);
    state.folders
}

/// Auto-reindex sweep, called periodically from the background watcher in
/// `setup()`. Only touches folders whose `auto_reindex_minutes` is set and
/// due; returns `true` if anything changed (so the caller can decide whether
/// a save/log is worth it — kept simple: always saves internally,
/// `reindex_one`'s per-folder work is what actually costs anything).
pub fn run_due_auto_reindex(app: &tauri::AppHandle) {
    let mut state = load(app);
    let mut any_due = false;
    for folder in state.folders.iter_mut() {
        if !folder.enabled || folder.auto_reindex_minutes == 0 {
            continue;
        }
        let due = match &folder.last_indexed {
            None => true,
            Some(last) => {
                let parsed = chrono::NaiveDateTime::parse_from_str(last, "%Y-%m-%d %H:%M").ok();
                match parsed {
                    Some(last_dt) => {
                        let elapsed_minutes = (chrono::Local::now().naive_local() - last_dt).num_minutes();
                        elapsed_minutes >= folder.auto_reindex_minutes as i64
                    }
                    None => true,
                }
            }
        };
        if due {
            reindex_one(folder);
            any_due = true;
        }
    }
    if any_due {
        save(app, &state);
    }
}
