// Clipboard history: everything the user copies (text, links, colors, images,
// copied files), kept so it can be found again from the side dock. Opt-in —
// the watcher thread runs from startup but captures nothing until the user
// turns it on in Settings, and the ⏸ on the card pauses it.
//
// Storage lives in the app-data `clipboard` folder, separate from the Shelf:
// an `index.json` of clips, `images/<id>.png` for images and
// `texts/<id>.txt` for text too long to keep inline. Unpinned clips expire
// after `TTL_DAYS` or once there are more than `MAX_ITEMS`.
//
// Privacy: anything a password manager marks as concealed/transient is
// skipped (macOS nspasteboard.org types, Windows'
// ExcludeClipboardContentFromMonitorProcessing), as is anything copied while
// a known password manager is frontmost. Pausing and re-enabling take a
// baseline of what's on the clipboard *now* rather than capturing it, so
// whatever was copied while paused never lands in history.

use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

const TTL_DAYS: i64 = 30;
const MAX_ITEMS: usize = 300;
const INDEX: &str = "index.json";
const SETTINGS: &str = "settings.json";
/// Text longer than this goes to its own file; the index keeps a prefix.
const INLINE_TEXT: usize = 20_000;
/// Text longer than this isn't recorded at all (a multi-MB log dump).
const MAX_TEXT: usize = 5_000_000;
/// Images bigger than this (in pixels) aren't recorded.
const MAX_PIXELS: usize = 40_000_000;
const POLL: Duration = Duration::from_millis(400);

/// Frontmost apps whose copies are never recorded, matched case-insensitively
/// against the app name.
const IGNORED_APPS: &[&str] = &[
    "1password", "bitwarden", "keepassxc", "keepass", "keychain access",
    "passwords", "dashlane", "lastpass", "enpass", "proton pass", "nordpass",
];

lazy_static::lazy_static! {
    /// Serializes index read-modify-write (the watcher thread and commands).
    static ref LOCK: Mutex<()> = Mutex::new(());
    /// One long-lived arboard handle. On Linux the process that set the
    /// clipboard has to stay alive serving it, so writes can't go through a
    /// handle that's dropped right after.
    static ref BOARD: Mutex<Option<arboard::Clipboard>> = Mutex::new(None);
}

static ENABLED: AtomicBool = AtomicBool::new(false);
static PAUSED: AtomicBool = AtomicBool::new(false);
/// Set by enable/resume: the watcher records the current clipboard as its
/// baseline instead of capturing it.
static REBASE: AtomicBool = AtomicBool::new(true);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    /// "text" | "link" | "color" | "image" | "files"
    pub kind: String,
    /// The text (or its first `INLINE_TEXT` bytes when `long`).
    #[serde(default)]
    pub text: Option<String>,
    /// Full text lives in `texts/<id>.txt`.
    #[serde(default)]
    pub long: bool,
    #[serde(default)]
    pub files: Option<Vec<String>>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    /// Size of the content in bytes (text length, PNG size).
    pub size: u64,
    /// App that was frontmost when it was copied.
    pub source: Option<String>,
    /// Milliseconds since the epoch; bumped when the same content is copied again.
    pub added: i64,
    pub pinned: bool,
    hash: String,
    /// Absolute path of the image / long-text file; filled in when listing.
    #[serde(default, skip_deserializing)]
    pub path: Option<String>,
}

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardStatus {
    pub enabled: bool,
    pub paused: bool,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn clip_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("clipboard");
    std::fs::create_dir_all(dir.join("images")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir.join("texts")).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn image_path(dir: &Path, id: &str) -> PathBuf {
    dir.join("images").join(format!("{id}.png"))
}

fn text_path(dir: &Path, id: &str) -> PathBuf {
    dir.join("texts").join(format!("{id}.txt"))
}

fn read_index(dir: &Path) -> Vec<Clip> {
    std::fs::read_to_string(dir.join(INDEX))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_index(dir: &Path, items: &[Clip]) -> Result<(), String> {
    let json = serde_json::to_string(items).map_err(|e| e.to_string())?;
    // Write-then-rename so a crash can't leave a half-written index.
    let tmp = dir.join(format!("{INDEX}.tmp"));
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(INDEX)).map_err(|e| e.to_string())
}

fn remove_files(dir: &Path, clip: &Clip) {
    let _ = std::fs::remove_file(image_path(dir, &clip.id));
    let _ = std::fs::remove_file(text_path(dir, &clip.id));
}

/// Newest first; unpinned clips past the TTL or beyond `MAX_ITEMS` dropped
/// along with their files.
fn purge(dir: &Path, items: &mut Vec<Clip>) {
    items.sort_by(|a, b| b.added.cmp(&a.added));
    let cutoff = now_ms() - TTL_DAYS * 24 * 3600 * 1000;
    let mut unpinned = 0;
    items.retain(|c| {
        if c.pinned {
            return true;
        }
        unpinned += 1;
        let keep = c.added >= cutoff && unpinned <= MAX_ITEMS;
        if !keep {
            remove_files(dir, c);
        }
        keep
    });
}

fn hash_of(kind: &str, bytes: &[u8]) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    kind.hash(&mut h);
    bytes.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn is_color(s: &str) -> bool {
    let s = s.trim();
    let hex = s.strip_prefix('#').unwrap_or("");
    (matches!(hex.len(), 3 | 4 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit()))
        || ((s.starts_with("rgb(") || s.starts_with("rgba(") || s.starts_with("hsl(") || s.starts_with("hsla("))
            && s.ends_with(')')
            && s.len() < 40)
}

fn is_link(s: &str) -> bool {
    let s = s.trim();
    !s.contains(char::is_whitespace)
        && (s.starts_with("http://") || s.starts_with("https://"))
        && url::Url::parse(s).is_ok()
}

fn text_kind(s: &str) -> &'static str {
    if is_color(s) {
        "color"
    } else if is_link(s) {
        "link"
    } else {
        "text"
    }
}

// ── Settings ─────────────────────────────────────────────────────────────

fn save_status(app: &tauri::AppHandle) -> Result<ClipboardStatus, String> {
    let status = ClipboardStatus {
        enabled: ENABLED.load(Ordering::SeqCst),
        paused: PAUSED.load(Ordering::SeqCst),
    };
    let json = serde_json::to_string(&status).map_err(|e| e.to_string())?;
    std::fs::write(clip_dir(app)?.join(SETTINGS), json).map_err(|e| e.to_string())?;
    let _ = app.emit("clipboard-status", status);
    Ok(status)
}

#[tauri::command]
pub fn clipboard_status() -> ClipboardStatus {
    ClipboardStatus {
        enabled: ENABLED.load(Ordering::SeqCst),
        paused: PAUSED.load(Ordering::SeqCst),
    }
}

#[tauri::command]
pub fn clipboard_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<ClipboardStatus, String> {
    if enabled && !ENABLED.load(Ordering::SeqCst) {
        REBASE.store(true, Ordering::SeqCst);
        PAUSED.store(false, Ordering::SeqCst);
    }
    ENABLED.store(enabled, Ordering::SeqCst);
    save_status(&app)
}

#[tauri::command]
pub fn clipboard_set_paused(app: tauri::AppHandle, paused: bool) -> Result<ClipboardStatus, String> {
    if !paused {
        REBASE.store(true, Ordering::SeqCst);
    }
    PAUSED.store(paused, Ordering::SeqCst);
    save_status(&app)
}

// ── Platform bits: change detection, concealed content, frontmost app ────

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::{NSPasteboard, NSWorkspace};

    /// Bumped by the system on every clipboard write — cheap to poll.
    pub fn change_token() -> Option<u64> {
        Some(NSPasteboard::generalPasteboard().changeCount() as u64)
    }

    /// The nspasteboard.org markers password managers (and well-behaved
    /// apps) put on secrets and throwaway data.
    pub fn is_concealed() -> bool {
        const MARKERS: &[&str] = &[
            "org.nspasteboard.ConcealedType",
            "org.nspasteboard.TransientType",
            "org.nspasteboard.AutoGeneratedType",
            "com.agilebits.onepassword",
        ];
        let Some(types) = NSPasteboard::generalPasteboard().types() else { return false };
        types.iter().any(|t| MARKERS.contains(&t.to_string().as_str()))
    }

    pub fn frontmost_app() -> Option<String> {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        app.localizedName().map(|n| n.to_string())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::ffi::c_void;
    use windows::core::{w, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HGLOBAL, HWND};
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
        RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    pub fn change_token() -> Option<u64> {
        Some(unsafe { GetClipboardSequenceNumber() } as u64)
    }

    /// The two opt-outs Windows apps use: `ExcludeClipboardContentFromMonitorProcessing`
    /// (its presence asks clipboard monitors to leave the data alone — what
    /// password managers set) and `CanIncludeInClipboardHistory` = 0 (which
    /// also keeps it out of Win+V history).
    pub fn is_concealed() -> bool {
        unsafe {
            let exclude = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
            if exclude != 0 && IsClipboardFormatAvailable(exclude).is_ok() {
                return true;
            }
            let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
            if history == 0 || IsClipboardFormatAvailable(history).is_err() {
                return false;
            }
            // Present but unreadable: skip it rather than risk recording a secret.
            read_dword(history).map_or(true, |v| v == 0)
        }
    }

    unsafe fn read_dword(format: u32) -> Option<u32> {
        // Another app can hold the clipboard open for a moment.
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(HWND::default()).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        if !opened {
            return None;
        }
        let value = GetClipboardData(format).ok().and_then(|handle| {
            let mem = HGLOBAL(handle.0);
            let ptr = GlobalLock(mem) as *const u32;
            if ptr.is_null() {
                return None;
            }
            let v = ptr.read_unaligned();
            let _ = GlobalUnlock(mem);
            Some(v)
        });
        let _ = CloseClipboard();
        value
    }

    /// The foreground window's app, by its product name ("Google Chrome")
    /// or else its exe name. Deliberately not `system::get_focused_app_info`,
    /// which scans every process and window on each call.
    pub fn frontmost_app() -> Option<String> {
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
            if pid == 0 {
                return None;
            }
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = vec![0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(process);
            ok.ok()?;
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let stem = std::path::Path::new(&path).file_stem()?.to_string_lossy().into_owned();
            Some(file_description(&path).unwrap_or(stem))
        }
    }

    /// `FileDescription` from the exe's version resource, in its first
    /// listed language.
    unsafe fn file_description(path: &str) -> Option<String> {
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let path = PCWSTR(wide.as_ptr());
        let size = GetFileVersionInfoSizeW(path, None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(path, 0, size, data.as_mut_ptr() as *mut c_void).ok()?;

        let mut ptr: *mut c_void = std::ptr::null_mut();
        let mut len = 0u32;
        if !VerQueryValueW(data.as_ptr() as *const c_void, w!("\\VarFileInfo\\Translation"), &mut ptr, &mut len).as_bool() || len < 4 {
            return None;
        }
        let lang = *(ptr as *const u16);
        let codepage = *(ptr as *const u16).add(1);
        let key: Vec<u16> = format!("\\StringFileInfo\\{lang:04x}{codepage:04x}\\FileDescription")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        if !VerQueryValueW(data.as_ptr() as *const c_void, PCWSTR(key.as_ptr()), &mut ptr, &mut len).as_bool() || len == 0 {
            return None;
        }
        let chars = std::slice::from_raw_parts(ptr as *const u16, len as usize);
        let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
        let name = String::from_utf16_lossy(&chars[..end]).trim().to_string();
        (!name.is_empty()).then_some(name)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    /// No change counter on X11/Wayland: the watcher compares content hashes.
    pub fn change_token() -> Option<u64> {
        None
    }

    pub fn is_concealed() -> bool {
        false
    }

    pub fn frontmost_app() -> Option<String> {
        tauri::async_runtime::block_on(crate::system::get_focused_app_info()).map(|a| a.name)
    }
}

fn ignored_app(name: &str) -> bool {
    let name = name.to_lowercase();
    IGNORED_APPS.iter().any(|a| name.contains(a))
}

// ── Capture ──────────────────────────────────────────────────────────────

/// What's on the clipboard right now, read in order of preference: copied
/// files (Finder/Explorer also put the file *names* on as text), then text,
/// then an image.
enum Content {
    Files(Vec<String>),
    Text(String),
    Image { width: usize, height: usize, rgba: Vec<u8> },
}

impl Content {
    fn hash(&self) -> String {
        match self {
            Content::Files(f) => hash_of("files", f.join("\n").as_bytes()),
            Content::Text(t) => hash_of("text", t.as_bytes()),
            Content::Image { rgba, .. } => hash_of("image", rgba),
        }
    }
}

fn read_content() -> Option<Content> {
    let mut guard = BOARD.lock().unwrap();
    if guard.is_none() {
        *guard = arboard::Clipboard::new().ok();
    }
    let board = guard.as_mut()?;
    if let Ok(files) = board.get().file_list() {
        let files: Vec<String> = files.into_iter().map(|p| p.to_string_lossy().into_owned()).collect();
        if !files.is_empty() {
            return Some(Content::Files(files));
        }
    }
    if let Ok(text) = board.get_text() {
        if !text.trim().is_empty() {
            return Some(Content::Text(text));
        }
    }
    if let Ok(img) = board.get_image() {
        if img.width * img.height > 0 {
            return Some(Content::Image { width: img.width, height: img.height, rgba: img.bytes.into_owned() });
        }
    }
    None
}

fn encode_png(width: usize, height: usize, rgba: Vec<u8>) -> Result<Vec<u8>, String> {
    let img = image::RgbaImage::from_raw(width as u32, height as u32, rgba).ok_or("bad image data")?;
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

/// Add `content` to history, or — if the same thing is already there — move
/// it back to the top (keeping its pin and original source).
fn record(app: &tauri::AppHandle, content: Content, source: Option<String>) -> Result<(), String> {
    let dir = clip_dir(app)?;
    let hash = content.hash();
    {
        let _guard = LOCK.lock().unwrap();
        let mut items = read_index(&dir);
        if let Some(existing) = items.iter_mut().find(|c| c.hash == hash) {
            existing.added = now_ms();
        } else {
            let id = new_id();
            let mut clip = Clip {
                id: id.clone(),
                kind: String::new(),
                text: None,
                long: false,
                files: None,
                width: None,
                height: None,
                size: 0,
                source,
                added: now_ms(),
                pinned: false,
                hash,
                path: None,
            };
            match content {
                Content::Files(files) => {
                    clip.kind = "files".into();
                    clip.size = files.len() as u64;
                    clip.files = Some(files);
                }
                Content::Text(text) => {
                    if text.len() > MAX_TEXT {
                        log::info!("[Clipboard] skipped {} bytes of text (over the limit)", text.len());
                        return Ok(());
                    }
                    clip.kind = text_kind(&text).into();
                    clip.size = text.len() as u64;
                    if text.len() > INLINE_TEXT {
                        std::fs::write(text_path(&dir, &id), &text).map_err(|e| e.to_string())?;
                        let mut cut = INLINE_TEXT;
                        while !text.is_char_boundary(cut) {
                            cut -= 1;
                        }
                        clip.text = Some(text[..cut].to_string());
                        clip.long = true;
                    } else {
                        clip.text = Some(text);
                    }
                }
                Content::Image { width, height, rgba } => {
                    if width * height > MAX_PIXELS {
                        log::info!("[Clipboard] skipped a {width}x{height} image (over the limit)");
                        return Ok(());
                    }
                    let png = encode_png(width, height, rgba)?;
                    std::fs::write(image_path(&dir, &id), &png).map_err(|e| e.to_string())?;
                    clip.kind = "image".into();
                    clip.size = png.len() as u64;
                    clip.width = Some(width as u32);
                    clip.height = Some(height as u32);
                }
            }
            items.push(clip);
        }
        purge(&dir, &mut items);
        write_index(&dir, &items)?;
    }
    let _ = app.emit("clipboard-changed", ());
    Ok(())
}

/// Starts the watcher thread. Restores the saved on/off and paused state
/// first, so a disabled history never reads the clipboard at all.
pub fn start(app: tauri::AppHandle) {
    if let Ok(dir) = clip_dir(&app) {
        if let Some(s) = std::fs::read_to_string(dir.join(SETTINGS))
            .ok()
            .and_then(|s| serde_json::from_str::<ClipboardStatus>(&s).ok())
        {
            ENABLED.store(s.enabled, Ordering::SeqCst);
            PAUSED.store(s.paused, Ordering::SeqCst);
        }
    }
    std::thread::Builder::new()
        .name("clipboard-watch".into())
        .spawn(move || {
            let mut last_token: Option<u64> = None;
            let mut last_hash: Option<String> = None;
            loop {
                std::thread::sleep(POLL);
                if !ENABLED.load(Ordering::SeqCst) || PAUSED.load(Ordering::SeqCst) {
                    continue;
                }
                let token = platform::change_token();
                let rebase = REBASE.swap(false, Ordering::SeqCst);
                if !rebase && token.is_some() && token == last_token {
                    continue;
                }
                last_token = token;
                // Concealed content is never read, not even to hash it.
                if platform::is_concealed() {
                    continue;
                }
                let Some(content) = read_content() else { continue };
                let hash = content.hash();
                if last_hash.as_deref() == Some(hash.as_str()) {
                    continue;
                }
                last_hash = Some(hash);
                if rebase {
                    continue;
                }
                let source = platform::frontmost_app();
                if source.as_deref().is_some_and(ignored_app) {
                    continue;
                }
                if let Err(e) = record(&app, content, source) {
                    log::warn!("[Clipboard] record failed: {e}");
                }
            }
        })
        .expect("spawn clipboard watcher");
}

// ── Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn clipboard_list(app: tauri::AppHandle) -> Result<Vec<Clip>, String> {
    let dir = clip_dir(&app)?;
    let _guard = LOCK.lock().unwrap();
    let mut items = read_index(&dir);
    let count = items.len();
    purge(&dir, &mut items);
    if items.len() != count {
        write_index(&dir, &items)?;
    }
    for c in &mut items {
        c.path = if c.kind == "image" {
            Some(image_path(&dir, &c.id).to_string_lossy().into_owned())
        } else if c.long {
            Some(text_path(&dir, &c.id).to_string_lossy().into_owned())
        } else {
            None
        };
    }
    Ok(items)
}

fn find(app: &tauri::AppHandle, id: &str) -> Result<(PathBuf, Clip), String> {
    let dir = clip_dir(app)?;
    let _guard = LOCK.lock().unwrap();
    let clip = read_index(&dir).into_iter().find(|c| c.id == id).ok_or("Clip not found")?;
    Ok((dir, clip))
}

fn full_text(dir: &Path, clip: &Clip) -> Result<String, String> {
    if clip.long {
        std::fs::read_to_string(text_path(dir, &clip.id)).map_err(|e| e.to_string())
    } else {
        Ok(clip.text.clone().unwrap_or_default())
    }
}

/// The whole text of a clip (for previews and drags of long text).
#[tauri::command]
pub fn clipboard_text(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let (dir, clip) = find(&app, &id)?;
    full_text(&dir, &clip)
}

/// Put a clip back on the system clipboard. The watcher then sees the same
/// content again and moves the clip to the top.
#[tauri::command]
pub fn clipboard_copy(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let (dir, clip) = find(&app, &id)?;
    let mut guard = BOARD.lock().unwrap();
    if guard.is_none() {
        *guard = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
    }
    let board = guard.as_mut().unwrap();
    match clip.kind.as_str() {
        "image" => {
            let img = image::open(image_path(&dir, &clip.id)).map_err(|e| e.to_string())?.into_rgba8();
            let (w, h) = img.dimensions();
            board
                .set_image(arboard::ImageData { width: w as usize, height: h as usize, bytes: img.into_raw().into() })
                .map_err(|e| e.to_string())
        }
        "files" => board.set().file_list(&clip.files.unwrap_or_default()).map_err(|e| e.to_string()),
        _ => board.set_text(full_text(&dir, &clip)?).map_err(|e| e.to_string()),
    }
}

fn update<F: FnOnce(&mut Vec<Clip>, &Path) -> Result<(), String>>(app: &tauri::AppHandle, f: F) -> Result<(), String> {
    let dir = clip_dir(app)?;
    {
        let _guard = LOCK.lock().unwrap();
        let mut items = read_index(&dir);
        f(&mut items, &dir)?;
        write_index(&dir, &items)?;
    }
    let _ = app.emit("clipboard-changed", ());
    Ok(())
}

#[tauri::command]
pub fn clipboard_pin(app: tauri::AppHandle, id: String, pinned: bool) -> Result<(), String> {
    update(&app, |items, _| {
        if let Some(c) = items.iter_mut().find(|c| c.id == id) {
            c.pinned = pinned;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn clipboard_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    update(&app, |items, dir| {
        if let Some(i) = items.iter().position(|c| c.id == id) {
            remove_files(dir, &items[i]);
            items.remove(i);
        }
        Ok(())
    })
}

/// Remove everything (pinned clips too, only when asked).
#[tauri::command]
pub fn clipboard_clear(app: tauri::AppHandle, include_pinned: bool) -> Result<(), String> {
    update(&app, |items, dir| {
        items.retain(|c| {
            let keep = c.pinned && !include_pinned;
            if !keep {
                remove_files(dir, c);
            }
            keep
        });
        Ok(())
    })
}

/// Turn a clip into a Shelf file: images as PNG, text as .txt.
#[tauri::command]
pub fn clipboard_save_to_shelf(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let (dir, clip) = find(&app, &id)?;
    match clip.kind.as_str() {
        "image" => {
            let bytes = std::fs::read(image_path(&dir, &clip.id)).map_err(|e| e.to_string())?;
            let name = format!("Clip {}.png", chrono::Local::now().format("%-d %b, %-I.%M %p"));
            crate::shelf::add_file_bytes(&app, &name, &bytes, Some("clipboard".into())).map(|_| ())
        }
        "files" => crate::shelf::shelf_import(app, clip.files.unwrap_or_default()).map(|_| ()),
        _ => crate::shelf::shelf_add_text(app, full_text(&dir, &clip)?, None).map(|_| ()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_kinds() {
        assert_eq!(text_kind("#3B82F6"), "color");
        assert_eq!(text_kind("rgb(1, 2, 3)"), "color");
        assert_eq!(text_kind("#zzz"), "text");
        assert_eq!(text_kind("https://github.com/a/b"), "link");
        assert_eq!(text_kind("see https://x.com"), "text");
        assert_eq!(text_kind("hello"), "text");
    }

    #[test]
    fn ignores_password_managers() {
        assert!(ignored_app("1Password 8"));
        assert!(ignored_app("Bitwarden"));
        assert!(!ignored_app("Safari"));
    }

    fn clip(id: &str, added: i64, pinned: bool) -> Clip {
        Clip {
            id: id.into(), kind: "text".into(), text: Some(id.into()), long: false, files: None,
            width: None, height: None, size: 1, source: None, added, pinned, hash: id.into(), path: None,
        }
    }

    #[test]
    fn purge_keeps_pinned_and_caps_unpinned() {
        let dir = tempfile::tempdir().unwrap();
        let now = now_ms();
        let mut items: Vec<Clip> = (0..MAX_ITEMS as i64 + 5).map(|i| clip(&format!("c{i}"), now - i, false)).collect();
        items.push(clip("old-pinned", 0, true));
        items.push(clip("old", 0, false));
        purge(dir.path(), &mut items);
        assert_eq!(items.iter().filter(|c| !c.pinned).count(), MAX_ITEMS);
        assert!(items.iter().any(|c| c.id == "old-pinned"));
        assert!(!items.iter().any(|c| c.id == "old"));
        assert_eq!(items[0].id, "c0");
    }
}
