use tauri::{Manager, Emitter};
use tauri_plugin_autostart::ManagerExt;
use std::sync::{Arc, RwLock};
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};

mod proc;
mod sidecar;
mod system;
mod focus;
#[cfg(target_os = "linux")]
mod linux_ewmh;
mod categorize;
mod scanner;
mod matcher;
mod tab_uia;
mod webapp_embed;
mod browser_pane;
mod shelf;
mod clipboard;
mod vault;
mod terminal;
mod archive;
mod annotations;
mod dock;
mod surfaces;
mod folder_identity;
mod ai_cli;
mod folder_index;
mod preview;
mod dir_watch;

use system::RunningApp;

// Global cache of the last scanner output.
// Written by get_running_apps(), read by the sidecar /search endpoint.
lazy_static::lazy_static! {
    pub static ref APP_CACHE: Arc<RwLock<Vec<serde_json::Value>>> =
        Arc::new(RwLock::new(Vec::new()));

    // Timestamp of the last completed scan. Guards against concurrent scan storms.
    static ref LAST_SCAN: Arc<RwLock<Option<std::time::Instant>>> =
        Arc::new(RwLock::new(None));

    // Mutex that ensures only one scan runs at a time.
    static ref SCAN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::new(());
}

// Minimum seconds between full rescans. Concurrent callers within this window
// get the cached result immediately.
const SCAN_CACHE_SECS: u64 = 10;


#[tauri::command]
async fn get_focused_app() -> Option<RunningApp> {
    system::get_focused_app_info().await
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

// ── Launch at login ──────────────────────────────────────────────────────────
// The autostart plugin only writes the Windows `Run` registry value when the
// user toggles it. Our NSIS preinstall hook runs the *previous* version's
// uninstaller on every update, and Tauri's uninstaller deletes that `Run`
// value — so autostart silently dies after the first auto-update. To survive
// that, we persist the user's intent in a small flag file and re-assert it on
// every startup (see `run()` setup), independent of the registry's state.
fn autostart_flag_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("launch_at_login"))
}

// File format is "<enabled>:<args_version>", e.g. "1:2". Files written before
// the version existed hold a bare "1"/"0" and read back as version 1, which is
// what triggers the one-time Run-entry rewrite.
fn read_autostart_flag(app: &tauri::AppHandle) -> Option<(bool, u32)> {
    let path = autostart_flag_path(app)?;
    let raw = std::fs::read_to_string(&path).ok()?;
    let raw = raw.trim();
    let (enabled, version) = match raw.split_once(':') {
        Some((e, v)) => (e.trim() == "1", v.trim().parse().unwrap_or(1)),
        None => (raw == "1", 1),
    };
    Some((enabled, version))
}

fn read_autostart_intent(app: &tauri::AppHandle) -> Option<bool> {
    read_autostart_flag(app).map(|(enabled, _)| enabled)
}

fn read_autostart_args_version(app: &tauri::AppHandle) -> u32 {
    read_autostart_flag(app).map(|(_, v)| v).unwrap_or(0)
}

fn write_autostart_intent(app: &tauri::AppHandle, enabled: bool) {
    if let Some(path) = autostart_flag_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let value = format!("{}:{}", if enabled { 1 } else { 0 }, AUTOSTART_ARGS_VERSION);
        let _ = std::fs::write(&path, value);
    }
}

#[tauri::command]
fn set_launch_at_login(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())?;
    } else {
        manager.disable().map_err(|e| e.to_string())?;
    }
    // Persist intent only after the registry write succeeds, so the on-startup
    // re-assert reflects what the user actually has set.
    write_autostart_intent(&app, enabled);
    Ok(())
}

// Returns the user's persisted intent. Falls back to the live registry state
// for installs that pre-date the flag file (first run after this change).
#[tauri::command]
fn get_launch_at_login(app: tauri::AppHandle) -> bool {
    if let Some(intent) = read_autostart_intent(&app) {
        return intent;
    }
    app.autolaunch().is_enabled().unwrap_or(false)
}

// ── Backups ──────────────────────────────────────────────────────────────────
// The snapshot itself is assembled in the frontend (the data lives in IndexedDB
// and extension storage, which Rust can't reach), but writing it goes through
// here so a scheduled backup doesn't depend on a browser download — no Settings
// modal open, no Downloads folder, no unbounded pile of files.

// How many backup files to keep. Older ones are pruned after each write.
const BACKUP_KEEP: usize = 10;

fn backups_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn get_backups_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(backups_dir(&app)?.to_string_lossy().to_string())
}

/// Write a backup snapshot and prune old ones. Returns the file path written.
#[tauri::command]
fn save_backup(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    let dir = backups_dir(&app)?;
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let path = dir.join(format!("cooldesk-backup-{}.json", stamp));

    // Write to a temp file first, then rename — a crash mid-write leaves the
    // previous backup intact rather than a truncated one.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;

    prune_backups(&dir);
    log::info!("[Backup] Wrote {}", path.display());
    Ok(path.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
struct BackupEntry {
    name: String,
    path: String,
    size: u64,
    /// Unix millis, from the file's mtime.
    modified: i64,
}

/// List saved backups, newest first.
#[tauri::command]
fn list_backups(app: tauri::AppHandle) -> Result<Vec<BackupEntry>, String> {
    let dir = backups_dir(&app)?;
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;

    let mut out: Vec<BackupEntry> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            let name = path.file_name()?.to_str()?.to_string();
            if !path.is_file() || !name.starts_with("cooldesk-backup-") || !name.ends_with(".json") {
                return None;
            }
            let meta = e.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            Some(BackupEntry {
                name,
                path: path.to_string_lossy().to_string(),
                size: meta.len(),
                modified,
            })
        })
        .collect();

    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

/// Read a backup file's contents.
///
/// Restricted to files inside the backups directory: the path comes from the
/// frontend, and without this check the command would be an arbitrary-file-read
/// primitive for anything running in the webview. Both sides are canonicalized
/// so `..` segments and symlinks can't escape.
#[tauri::command]
fn read_backup(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let dir = backups_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = std::path::PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("Backup not found: {}", e))?;

    if !target.starts_with(&dir) {
        return Err("Refusing to read a file outside the backups folder".into());
    }

    std::fs::read_to_string(&target).map_err(|e| e.to_string())
}

/// Delete a backup file. Same containment check as read_backup.
#[tauri::command]
fn delete_backup(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = backups_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = std::path::PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("Backup not found: {}", e))?;

    if !target.starts_with(&dir) {
        return Err("Refusing to delete a file outside the backups folder".into());
    }

    std::fs::remove_file(&target).map_err(|e| e.to_string())?;
    log::info!("[Backup] Deleted {}", target.display());
    Ok(())
}

/// Keep the newest BACKUP_KEEP files, delete the rest. Sorted by filename, which
/// sorts chronologically given the timestamp format above.
fn prune_backups(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<std::path::PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("cooldesk-backup-") && n.ends_with(".json"))
                    .unwrap_or(false)
        })
        .collect();

    if files.len() <= BACKUP_KEEP {
        return;
    }
    files.sort();
    let cutoff = files.len() - BACKUP_KEEP;
    for stale in &files[..cutoff] {
        match std::fs::remove_file(stale) {
            Ok(_) => log::info!("[Backup] Pruned {}", stale.display()),
            Err(e) => log::warn!("[Backup] Failed to prune {}: {}", stale.display(), e),
        }
    }
}

// ── Agent workspace ──────────────────────────────────────────────────────────
// `/agent` in the global spotlight used to pick `cwd` by scanning the user's
// saved workspaces for whichever one was updated most recently and happened to
// have a folder app — a proxy for "the active project" that drifts the moment
// an unrelated workspace gets touched, silently redirecting agent runs to the
// wrong directory. This gives spotlight a fixed directory it owns outright, so
// every `/agent` run always lands in the same, known-trusted place.

fn agent_workspace_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-workspace");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Mark a directory as trusted in Claude Code's own `~/.claude.json`, so a CLI
/// run there doesn't stop to ask the user to accept a trust dialog.
///
/// Called with `agent_workspace_dir()`'s own path (a directory this app
/// created and controls) and, via `trust_project_dir` below, with a project
/// folder the user explicitly linked into one of their own workspaces — never
/// an arbitrary path we merely discovered, since pre-trusting code the user
/// didn't knowingly vouch for would defeat the point of the prompt.
/// `serde_json`'s `preserve_order` feature is required here: without it,
/// round-tripping through `Value` would alphabetically reorder every key in
/// the user's global CLI config as a side effect of flipping one flag.
fn trust_claude_workspace(path: &std::path::Path) -> Result<(), String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(());
    };
    let config_path = home.join(".claude.json");
    if !config_path.is_file() {
        // No Claude Code config yet on this machine — nothing to pre-trust;
        // the CLI will create its own config and prompt normally on first run.
        return Ok(());
    }

    let raw = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut root: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let path_str = path.to_string_lossy().to_string();
    let projects = root
        .as_object_mut()
        .ok_or("~/.claude.json is not a JSON object")?
        .entry("projects")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let projects = projects
        .as_object_mut()
        .ok_or("~/.claude.json's \"projects\" is not an object")?;
    let entry = projects
        .entry(path_str)
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if let Some(entry) = entry.as_object_mut() {
        entry.insert("hasTrustDialogAccepted".to_string(), serde_json::Value::Bool(true));
    }

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, serialized).map_err(|e| e.to_string())?;
    Ok(())
}

/// Directory `/agent` should run in: created if missing, pre-trusted in Claude
/// Code's config so the first run there doesn't hit the trust-dialog warning.
#[tauri::command]
fn get_agent_workspace_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = agent_workspace_dir(&app)?;
    if let Err(e) = trust_claude_workspace(&dir) {
        // Best-effort: the directory is still usable, just falls back to the
        // CLI's normal trust prompt on first run.
        log::warn!("[AgentWorkspace] Failed to pre-trust {}: {}", dir.display(), e);
    }
    Ok(dir.to_string_lossy().to_string())
}

/// Pre-trust a project folder before the /agent panel's "Create workspace"
/// action runs Claude Code there with `Write`/`Edit` allowed. Unlike
/// `get_agent_workspace_dir`'s fixed, app-owned directory, this path is one
/// the user chose themselves — it came from a folder they already added to
/// one of their own workspaces — so trusting it on their behalf isn't
/// vouching for code we found on disk, it's honouring a folder they already
/// pointed the app at. Best-effort: on failure the run still proceeds and
/// simply hits Claude Code's normal trust prompt.
#[tauri::command]
fn trust_project_dir(path: String) -> Result<(), String> {
    if let Err(e) = trust_claude_workspace(std::path::Path::new(&path)) {
        log::warn!("[Workspace] Failed to pre-trust {}: {}", path, e);
    }
    Ok(())
}

/// Which of a workspace's folder apps look like an actual code project, as
/// opposed to a plain reference folder — decided *before* any Claude Code run
/// so the caller knows how many scaffold runs to make and whether there's
/// anything to link together (see `link_project` in sidecar/cooldesk.rs).
/// Deliberately cheap and deterministic: existence checks only, no shelling
/// out and no LLM judgement call.
#[tauri::command]
fn classify_project_folders(paths: Vec<String>) -> Vec<bool> {
    const MARKERS: &[&str] = &[
        ".git",
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "go.mod",
        "pom.xml",
        "composer.json",
        "Gemfile",
    ];
    paths
        .iter()
        .map(|p| {
            let root = std::path::Path::new(p);
            MARKERS.iter().any(|m| root.join(m).exists())
        })
        .collect()
}

// ── Autostart args ───────────────────────────────────────────────────────────
// At login the Run key launches us with ARG_AUTOSTART. Every well-behaved
// startup app does this (OneDrive /background, Steam -silent, Chrome
// --no-startup-window): come up headless, into the tray, and don't compete with
// the other startup programs for disk. Without it we cold-booted a 1400x900
// WebView2 dashboard at the worst possible moment.
const ARG_AUTOSTART: &str = "--autostart";

// Bumped whenever the Run key's *value* needs rewriting (e.g. adding an arg).
// The flag file stores this; installs written by an older version re-register
// once on startup. Without this, `is_enabled()` only checks that the key exists,
// so a stale argless command line would survive forever.
const AUTOSTART_ARGS_VERSION: u32 = 2;

fn launched_by_autostart() -> bool {
    std::env::args().any(|a| a == ARG_AUTOSTART)
}

// The uninstaller runs `cooldesk.exe --quit` before removing files. The
// single-instance plugin forwards it to the running process, which then exits
// through `RunEvent::Exit` — the only path that releases the AppBar work-area
// reservation (`dock::remove_dock`) and closes glued browser windows. Tauri's
// own uninstall step force-kills the process, which skips all of that and can
// leave a permanently shrunk desktop behind.
const ARG_QUIT: &str = "--quit";

fn quit_requested(args: &[String]) -> bool {
    args.iter().any(|a| a == ARG_QUIT)
}

/// Get the main window, creating it if it doesn't exist yet.
///
/// The main window, as a `Window`. Never `get_webview_window("main")`: once a
/// browser pane (a second webview, see `browser_pane`) lives in the main
/// window, Tauri stops counting it as a webview window and that lookup returns
/// None — which silently broke hiding/showing/docking while a pane was open.
/// Window-level calls (show, hide, frame, decorations, events) all live on
/// `Window`; page-level ones go through `app.get_webview("main")`.
fn main_window(app: &tauri::AppHandle) -> Option<tauri::Window> {
    app.get_window("main")
}

/// Background color of a window *and* its own page webview (the webview
/// labelled like the window). A `Window`'s own `set_background_color` only
/// reaches the NSWindow, so on its own the WKWebView kept drawing its opaque
/// background and a see-through panel painted as a solid black one. Browser
/// panes in the same window are left alone.
fn set_page_background(window: &tauri::Window, color: Option<tauri::window::Color>) {
    let _ = window.set_background_color(color);
    if let Some(page) = window.get_webview(window.label()) {
        let _ = page.set_background_color(color);
    }
}

/// Let AppKit resize the main page webview with the window again.
///
/// Tauri's `unstable` multi-webview feature (needed for browser panes) builds
/// the page as a child view with no autoresizing mask and resizes it itself
/// from Resized events. Those didn't keep up: docking (an AppKit `setFrame`
/// on a hidden, just-undecorated window) and native fullscreen both left the
/// page at its old size — Browse stayed mounted inside the 360pt sidebar
/// with its native page over the panel, and fullscreen showed the old-size
/// page stuck inside the bigger window until a reload. A width/height-sizable
/// mask is what wry gives a non-child webview, so the page tracks the window
/// synchronously in every case; Tauri's own resizing is turned off so the
/// two can't fight.
/// Logs the main page view's geometry against its parent and the window's
/// content view — the facts behind "dark / wrong-size panel" reports.
#[cfg(target_os = "macos")]
fn log_main_page_geometry(window: &tauri::Window, when: &'static str) {
    let Some(page) = window.get_webview("main") else {
        log::warn!("[Window] {when}: no main page webview");
        return;
    };
    let ns_window = window.ns_window().map(|p| p as usize).unwrap_or(0);
    let _ = page.with_webview(move |pw| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        use objc2_foundation::NSRect;
        let r = |f: NSRect| format!("({:.0},{:.0} {:.0}x{:.0})", f.origin.x, f.origin.y, f.size.width, f.size.height);
        let view = pw.inner() as *mut AnyObject;
        let frame: NSRect = msg_send![view, frame];
        let hidden: bool = msg_send![view, isHidden];
        let mask: usize = msg_send![view, autoresizingMask];
        let parent: *mut AnyObject = msg_send![view, superview];
        let parent_frame = if parent.is_null() { "none".into() } else { let f: NSRect = msg_send![parent, frame]; r(f) };
        let (content, opaque, win_state) = if ns_window == 0 { ("none".into(), true, String::new()) } else {
            let w = ns_window as *mut AnyObject;
            let cv: *mut AnyObject = msg_send![w, contentView];
            let o: bool = msg_send![w, isOpaque];
            let same = cv == parent;
            let f: NSRect = msg_send![cv, frame];
            let style: usize = msg_send![w, styleMask];
            let behavior: usize = msg_send![w, collectionBehavior];
            let level: isize = msg_send![w, level];
            let max: objc2_foundation::NSSize = msg_send![w, maxSize];
            let state = format!(
                " style={style:#x} (resizable={} titled={} fullscreen={}) behavior={behavior:#x} level={level} maxSize={:.0}x{:.0}",
                style & 8 != 0, style & 1 != 0, style & (1 << 14) != 0, max.width, max.height,
            );
            (format!("{}{}", r(f), if same { " (= parent)" } else { " (≠ parent)" }), o, state)
        };
        log::info!("[Window] {when}: page {} hidden={hidden} mask={mask} parent {parent_frame} contentView {content} windowOpaque={opaque}{win_state}", r(frame));
    });
}

#[cfg(target_os = "macos")]
fn autoresize_main_page(page: &tauri::Webview) {
    let _ = page.set_auto_resize(false);
    let _ = page.with_webview(|pw| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        use objc2_foundation::NSRect;
        let view = pw.inner() as *mut AnyObject;
        let parent: *mut AnyObject = msg_send![view, superview];
        if parent.is_null() {
            return;
        }
        let bounds: NSRect = msg_send![parent, bounds];
        let _: () = msg_send![view, setFrame: bounds];
        // NSViewWidthSizable (2) | NSViewHeightSizable (16)
        let _: () = msg_send![view, setAutoresizingMask: 18usize];
    });
}

/// The main window is *not* declared in tauri.conf.json — declaring it there
/// makes Tauri build the webview and load the whole React dashboard at process
/// start, which is exactly the login-time cost we're avoiding. It's built here
/// on first demand instead (tray click, single-instance relaunch, dock expand),
/// and pre-warmed in the background well after login has settled.
///
/// Always returns the window hidden; callers decide when to show it.
fn ensure_main_window(app: &tauri::AppHandle) -> Option<tauri::Window> {
    if let Some(win) = main_window(app) {
        return Some(win);
    }

    let built = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("pages/index.html".into()))
        .title("CoolDesk")
        .inner_size(1400.0, 900.0)
        .resizable(true)
        .fullscreen(false)
        .visible(false)
        // Transparent on Windows only, and the asymmetry is deliberate.
        //
        // This was once transparent everywhere, to let the docked sidebar's
        // rounded corners reveal real desktop, and was reverted because WebKit
        // renders `backdrop-filter: blur()` unreliably inside a transparent
        // NSWindow (undefined content behind the blur) — with blur in ~170
        // places (header, modals, dropdowns…) that showed up as glitches across
        // the whole app, not just the sidebar.
        //
        // That objection is WebKit's, not Chromium's: WebView2 composites blur
        // in a transparent window correctly, so Windows can have the
        // see-through dock that macOS gets. macOS still must not — it keeps its
        // opaque window and flips `setOpaque(false)` only while docked
        // (`dock::set_see_through`), which is the one thing Win32/WebView2
        // cannot do, since it fixes transparency at window creation.
        //
        // Consequence worth knowing: on Windows the window is transparent for
        // the whole session, so the full-size app is opaque only because the
        // theme's `.bg-*` gradient paints over it. Anything that makes `body`
        // transparent outside the dock reveals the desktop there too.
        .transparent(cfg!(windows))
        .build();

    match built {
        Ok(built) => {
            let win = built.as_ref().window();
            attach_main_window_events(&win);
            #[cfg(target_os = "macos")]
            {
                autoresize_main_page(built.as_ref());
                log_main_page_geometry(&win, "main window created");
                browser_pane::permissions::install(built.as_ref());
                browser_pane::webcrypto::install(built.as_ref());
            }
            Some(win)
        }
        Err(e) => {
            log::error!("[Window] Failed to create main window: {}", e);
            None
        }
    }
}

/// True when the foreground window belongs to some *other* app. A blur that
/// hands the foreground to one of our own windows (or to nothing at all, which
/// is what a hide/show cycle looks like mid-transition) is not the user leaving.
fn focus_left_the_app(app: &tauri::AppHandle) -> bool {
    #[cfg(windows)]
    {
        let fg = dock::foreground_hwnd();
        if fg == 0 {
            return false;
        }
        let ours = app
            .windows() // not webview_windows(): main stops being one once a browser pane lives in it
            .values()
            .any(|w| w.hwnd().ok().map(|h| h.0 as isize) == Some(fg));
        !ours
    }
    // No raw window-handle API here (unlike `dock::foreground_hwnd` on
    // Windows), but `is_focused` gets the same answer: if one of our own
    // windows already holds focus, this blur is internal bounce, not the
    // user leaving.
    #[cfg(not(windows))]
    {
        !app
            .windows() // not webview_windows(): main stops being one once a browser pane lives in it
            .values()
            .any(|w| w.is_focused().unwrap_or(false))
    }
}

/// Hide-on-close: the main window lives in the tray, it doesn't quit the app.
fn attach_main_window_events(window: &tauri::Window) {
    let win = window.clone();
    window.on_window_event(move |event| match event {
        #[cfg(target_os = "macos")]
        tauri::WindowEvent::Resized(size) => {
            log::info!("[Window] resized to {}x{} (fullscreen={})", size.width, size.height, win.is_fullscreen().unwrap_or(false));
            log_main_page_geometry(&win, "after resize");
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = win.hide();
        }
        _ => {}
    });
}

// Whether the main window has been shown yet this run — the first show opens
// it maximized (filling the screen, not a separate fullscreen Space); after
// that it keeps whatever size the user gave it.
static MAIN_SHOWN_ONCE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Create and show the main window (creating it first if needed). The full
/// app is always an ordinary window — the sidebar and dock are their own
/// windows (surfaces.rs).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = ensure_main_window(app) {
        let _ = win.unminimize();
        let _ = win.show();
        if !MAIN_SHOWN_ONCE.swap(true, std::sync::atomic::Ordering::Relaxed) && !win.is_fullscreen().unwrap_or(false) {
            let _ = win.maximize();
        }
        let _ = win.set_focus();
    }
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    current: String,
    latest: String,
    has_update: bool,
    notes_url: String,
    /// The anonymous heartbeat reached our endpoint. The client clears its
    /// queued counters only when this is true, so a blocked or offline ping
    /// delays them rather than losing them.
    ping_ok: bool,
}

const GITHUB_LATEST: &str =
    "https://api.github.com/repos/abhayraghuwanshi/cooldesk-extension/releases/latest";
const ANALYTICS_ENDPOINT: &str =
    "https://cooldesk-analytics.raghuwanshi-abhay405.workers.dev/api/version";

// Build-time stamp from the release workflow (winget / dmg / linux); "unknown"
// for local builds. Only trusted off Windows — see `install_source`.
#[cfg_attr(windows, allow(dead_code))]
fn build_install_source() -> &'static str {
    option_env!("COOLDESK_INSTALL_SOURCE").unwrap_or("unknown")
}

/// Where this install came from.
///
/// macOS / Linux: the build stamp. Windows ships one installer for winget and
/// direct downloads, so the build stamp can't tell them apart (it said
/// "winget" for everyone). Instead the NSIS installer writes the answer to
/// `<app config dir>/install_source` (nsis/installer-hooks.nsh): "winget" when
/// winget passes `/SOURCE=winget`, "direct" for any other fresh install, and
/// in-app updates leave it untouched. No marker means an MSI install (it lives
/// under Program Files) or an install older than the marker ("legacy").
fn install_source(app: &tauri::AppHandle) -> String {
    #[cfg(windows)]
    {
        if let Ok(dir) = app.path().app_config_dir() {
            if let Ok(raw) = std::fs::read_to_string(dir.join("install_source")) {
                let s: String = raw
                    .trim()
                    .chars()
                    .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                    .take(16)
                    .collect::<String>()
                    .to_ascii_lowercase();
                if !s.is_empty() {
                    return s;
                }
            }
        }
        let in_program_files = std::env::current_exe()
            .map(|p| p.to_string_lossy().to_ascii_lowercase().contains("\\program files"))
            .unwrap_or(false);
        if in_program_files { "msi".to_string() } else { "legacy".to_string() }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        build_install_source().to_string()
    }
}

/// "release" for tagged CI builds, "test" for manual CI runs, "local" for a
/// release build made on a dev machine, "dev" for debug builds. Lets the
/// numbers exclude everything that isn't a real user.
fn release_channel() -> &'static str {
    if cfg!(debug_assertions) {
        "dev"
    } else {
        option_env!("COOLDESK_CHANNEL").unwrap_or("local")
    }
}

// Anonymous, randomly-generated install identifier. Created once and persisted
// in the app config dir; contains no personal data. Used only to count distinct
// installs / daily-active installs. Returns an empty string if it can't be
// persisted, in which case analytics simply degrades — never an error. The
// flag is true when this call created it, i.e. on the very first launch.
fn ensure_install_id(app: &tauri::AppHandle) -> (String, bool) {
    let path = match app.path().app_config_dir() {
        Ok(dir) => dir.join("install_id"),
        Err(_) => return (String::new(), false),
    };
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return (trimmed.to_string(), false);
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&path, &id) {
        Ok(()) => (id, true),
        // Not persisted: a new id every launch would inflate install counts.
        Err(_) => (String::new(), false),
    }
}

fn get_or_create_install_id(app: &tauri::AppHandle) -> String {
    ensure_install_id(app).0
}

// The opt-out lives in the webview's localStorage, but the first-run ping is
// sent from Rust before any window has loaded — so Settings mirrors the choice
// to this file (`set_analytics_enabled`).
fn analytics_disabled_on_disk(app: &tauri::AppHandle) -> bool {
    app.path()
        .app_config_dir()
        .map(|d| d.join("analytics_disabled").exists())
        .unwrap_or(false)
}

#[tauri::command]
fn set_analytics_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let flag = dir.join("analytics_disabled");
    if enabled {
        match std::fs::remove_file(&flag) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    } else {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(&flag, "1").map_err(|e| e.to_string())
    }
}

/// Counters the webview collected since the last successful ping. Integers and
/// whitelisted names only — the worker re-checks both.
#[derive(Default)]
struct PingCounters {
    event: &'static str,
    spotlight_opens: u32,
    active_minutes: u32,
    ping_failures: u32,
    features: std::collections::HashMap<String, u32>,
    feedback: String,
}

// The anonymous usage payload: scalars and small integer counters, no free
// text. Never includes search queries, URLs, file names or any user content.
fn analytics_payload(
    app: &tauri::AppHandle,
    current: &str,
    locale: Option<String>,
    c: PingCounters,
) -> serde_json::Value {
    serde_json::json!({
        "install_id": get_or_create_install_id(app),
        "os": std::env::consts::OS,
        "app_version": current,
        "install_source": install_source(app),
        "channel": release_channel(),
        "locale": locale.unwrap_or_default(),
        "event": c.event,
        "spotlight_opens": c.spotlight_opens,
        "active_minutes": c.active_minutes,
        "ping_failures": c.ping_failures,
        "features": c.features,
        "feedback": c.feedback,
    })
}

/// Web query suggestions for the spotlight ("react hoo" → "react hooks", …)
/// from the user's chosen engine — the same feeds the new-tab search box uses
/// (src/shared/searchEngines.js; keep the engine keys in step). Fetched here
/// rather than from the webview because none of them send CORS headers.
/// `engine` picks from a fixed list, so this can't be pointed at any other
/// URL. Best-effort: any failure is just an empty list.
#[tauri::command]
async fn web_suggest(query: String, engine: Option<String>) -> Vec<String> {
    let q = query.trim();
    if q.is_empty() || q.len() > 200 {
        return Vec::new();
    }
    let enc = urlencoding::encode(q);
    let url = match engine.as_deref().unwrap_or("google") {
        "google" => format!("https://suggestqueries.google.com/complete/search?client=chrome&ie=utf-8&oe=utf-8&q={enc}"),
        "youtube" => format!("https://suggestqueries.google.com/complete/search?client=chrome&ie=utf-8&oe=utf-8&ds=yt&q={enc}"),
        "bing" => format!("https://api.bing.com/osjson.aspx?query={enc}"),
        "ddg" => format!("https://duckduckgo.com/ac/?type=list&q={enc}"),
        "brave" => format!("https://search.brave.com/api/suggest?q={enc}"),
        "ecosia" => format!("https://ac.ecosia.org/autocomplete?type=list&q={enc}"),
        _ => return Vec::new(),
    };
    let res = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "CoolDesk")
        .timeout(std::time::Duration::from_secs(4))
        .send()
        .await;
    let Ok(res) = res else { return Vec::new() };
    let Ok(data) = res.json::<serde_json::Value>().await else { return Vec::new() };
    data.get(1)
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|s| s.as_str())
                .filter(|s| !s.eq_ignore_ascii_case(q))
                .take(8)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

/// Sent once, from `setup`, on the launch that created the install id — before
/// any window exists, so an install whose UI never comes up (a missing
/// runtime, a crash on load) is still counted. The worker records it with
/// `ui_seen = 0`; the webview's first heartbeat flips that to 1.
fn send_first_run_ping(app: &tauri::AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let current = handle.package_info().version.to_string();
        let payload = analytics_payload(
            &handle,
            &current,
            None,
            PingCounters { event: "first_run", ..Default::default() },
        );
        let result = reqwest::Client::new()
            .post(ANALYTICS_ENDPOINT)
            .header("User-Agent", "CoolDesk")
            .timeout(std::time::Duration::from_secs(15))
            .json(&payload)
            .send()
            .await
            .and_then(|r| r.error_for_status());
        if let Err(e) = result {
            log::info!("[Analytics] first-run ping failed: {}", e);
        }
    });
}

fn parse_update_info(current: String, release: &serde_json::Value) -> UpdateInfo {
    let latest = release["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();

    let has_update = match (
        semver::Version::parse(&current),
        semver::Version::parse(&latest),
    ) {
        (Ok(c), Ok(l)) => l > c,
        _ => false,
    };

    UpdateInfo {
        current,
        latest,
        has_update,
        notes_url: release["html_url"].as_str().unwrap_or("").to_string(),
        ping_ok: false,
    }
}

/// Detection only: compares the running version against the latest GitHub
/// release tag. The install itself is `install_native_update`, with
/// `run_winget_upgrade` as a Windows fallback.
///
/// Doubles as the anonymous usage heartbeat: unless `analytics_enabled` is
/// `Some(false)`, the version check is routed through our own endpoint, which
/// records the ping and proxies the GitHub release back. If that endpoint fails
/// (offline, blocked, opted out), it falls back to querying GitHub directly —
/// so the update check is never broken by analytics — and reports
/// `ping_ok: false` so the client keeps its counters for the next try.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn check_winget_update(
    app: tauri::AppHandle,
    analytics_enabled: Option<bool>,
    spotlight_opens: Option<u32>,
    locale: Option<String>,
    features: Option<std::collections::HashMap<String, u32>>,
    active_minutes: Option<u32>,
    ping_failures: Option<u32>,
    feedback: Option<String>,
) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let client = reqwest::Client::new();

    // Preferred path: route through our endpoint so the ping is recorded.
    if analytics_enabled != Some(false) {
        let counters = PingCounters {
            event: "heartbeat",
            spotlight_opens: spotlight_opens.unwrap_or(0),
            active_minutes: active_minutes.unwrap_or(0),
            ping_failures: ping_failures.unwrap_or(0),
            features: features.unwrap_or_default(),
            feedback: feedback.unwrap_or_default(),
        };
        let payload = analytics_payload(&app, &current, locale, counters);
        let attempt = client
            .post(ANALYTICS_ENDPOINT)
            .header("User-Agent", "CoolDesk")
            .timeout(std::time::Duration::from_secs(20))
            .json(&payload)
            .send()
            .await
            .and_then(|r| r.error_for_status());
        if let Ok(resp) = attempt {
            if let Ok(release) = resp.json::<serde_json::Value>().await {
                let mut info = parse_update_info(current, &release);
                info.ping_ok = true;
                return Ok(info);
            }
        }
        // Any failure falls through to a direct GitHub query below.
    }

    // Fallback / opted-out path: query GitHub directly.
    let release = client
        .get(GITHUB_LATEST)
        .header("User-Agent", "CoolDesk")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    Ok(parse_update_info(current, &release))
}

/// The winget package identifier, which must match the `identifier:` komac
/// submits in `.github/workflows/release.yml`. It is *not* derived from the
/// bundle `publisher` ("CN=cool-products") — using that produced
/// `cool-products.CoolDesk`, which matches nothing, so `winget upgrade` failed
/// with "No installed package found matching input criteria" on every machine.
#[cfg(windows)]
const WINGET_PACKAGE_ID: &str = "CoolDesk.CoolDesk";

/// Last-resort Windows updater: hand off to `winget upgrade` in a visible
/// console so the user can watch it, since winget replaces the app underneath
/// us and relaunches it.
///
/// Only reached when the bundled updater could not install (see
/// `install_native_update`, which `updateService.js` tries first). winget is
/// not a reliable primary: it only knows installs it can match to an
/// Add/Remove-Programs entry, so a user who ran the downloaded `.exe` may be
/// invisible to it, and a machine carrying both the MSI and the NSIS install
/// has *two* entries for one id, which makes `-e` ambiguous.
///
/// Verifies the package is actually known before spawning. The old version
/// returned `Ok` as soon as `spawn()` succeeded, so a winget that failed a
/// moment later still reported success — the UI claimed the update was done
/// and the caller's fallback never ran.
#[tauri::command]
fn run_winget_upgrade() -> Result<(), String> {
    #[cfg(windows)]
    {
        // Headless pre-flight: `winget list` exits non-zero when nothing
        // matches, which is the failure the user used to see flash past in a
        // console. Doing it here keeps the error in `Result` where the
        // frontend can act on it.
        let listed = proc::command("winget")
            .args(["list", "--id", WINGET_PACKAGE_ID, "-e"])
            .output()
            .map_err(|e| format!("winget not available: {e}"))?;
        if !listed.status.success() {
            return Err(format!(
                "winget does not know this install (package {WINGET_PACKAGE_ID} not found)"
            ));
        }

        // Visible on purpose: this one the user should see.
        std::process::Command::new("winget")
            .args([
                "upgrade",
                "--id",
                WINGET_PACKAGE_ID,
                "-e",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Err("winget is only available on Windows".to_string())
    }
}

/// Download the signed update artifact via `tauri-plugin-updater`, replace the
/// app in place and relaunch. The primary path on every platform, Windows
/// included.
///
/// Windows used to be excluded here and sent to winget instead. That was the
/// wrong default: the updater works regardless of how the app was installed,
/// `latest.json` already publishes signed `windows-x86_64`, `-nsis` and `-msi`
/// entries, and the plugin is registered unconditionally — the startup check
/// has always run on Windows, only the install was stubbed out.
#[tauri::command]
async fn install_native_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

#[tauri::command]
async fn get_running_apps(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = &app;
        return Ok(serde_json::json!([]));
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        // Return cached result if a scan completed within the last SCAN_CACHE_SECS seconds.
        // This prevents scan storms when the frontend calls this command many times at once.
        let cache_fresh = LAST_SCAN.read().ok().and_then(|t| *t).map(|t| {
            t.elapsed().as_secs() < SCAN_CACHE_SECS
        }).unwrap_or(false);

        if cache_fresh {
            if let Ok(cache) = APP_CACHE.read() {
                if !cache.is_empty() {
                    return Ok(serde_json::Value::Array(cache.clone()));
                }
            }
        }

        // Serialize concurrent scans: only one runs at a time, others wait and
        // then return the fresh cache result populated by the winning scan.
        let _guard = SCAN_LOCK.lock().await;

        // Re-check after acquiring the lock — a concurrent scan may have just finished.
        let cache_fresh = LAST_SCAN.read().ok().and_then(|t| *t).map(|t| {
            t.elapsed().as_secs() < SCAN_CACHE_SECS
        }).unwrap_or(false);

        if cache_fresh {
            if let Ok(cache) = APP_CACHE.read() {
                if !cache.is_empty() {
                    return Ok(serde_json::Value::Array(cache.clone()));
                }
            }
        }

        // Run the scan in-process: no sidecar EXEs spawned. Extra app-scan
        // dirs come from the user's linked folders (Settings → Folders &
        // Index, "include apps" on) — read here, before handing off to the
        // blocking thread, since `folder_index::app_scan_dirs` needs `app`.
        let extra_app_dirs = folder_index::app_scan_dirs(&app);
        let scan_output = tokio::task::spawn_blocking(move || scanner::scan_apps(&extra_app_dirs))
            .await
            .map_err(|e| format!("scan_apps panicked: {}", e))?;

        let entries = matcher::match_apps(scan_output);

        let parsed = serde_json::to_value(&entries)
            .map_err(|e| format!("Failed to serialize app entries: {}", e))?;

        if let Some(arr) = parsed.as_array() {
            if let Ok(mut cache) = APP_CACHE.write() {
                *cache = arr.clone();
            }
            if let Ok(mut ts) = LAST_SCAN.write() {
                *ts = Some(std::time::Instant::now());
            }
        }

        Ok(parsed)
    }
}

#[tauri::command]
async fn get_installed_apps(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    // We can use the same pipeline to get the full list of apps (running + not running)
    get_running_apps(app).await
}

#[tauri::command]
fn categorize_app(name: String, path: String) -> categorize::AppCategory {
    let mut categorizer = categorize::Categorizer::new();
    categorizer.categorize(&name, &path)
}

#[tauri::command(rename_all = "snake_case")]
async fn focus_window(_app: tauri::AppHandle, pid: u32, name: Option<String>, hwnd: Option<i64>, path: Option<String>) -> Result<(), String> {
    let hwnd_opt = hwnd.filter(|&h| h != 0).map(|h| h as isize);
    let name_ref = name.as_deref();
    let path_ref = path.as_deref();

    log::info!(
        "[focus_window] pid={} name={:?} hwnd={:?} path={:?}",
        pid,
        name_ref,
        hwnd_opt,
        path_ref
    );
    match focus::focus_window(hwnd_opt, Some(pid), name_ref, path_ref) {
        Ok(()) => {
            log::info!("[focus_window] succeeded for pid={} name={:?}", pid, name_ref);
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[focus_window] failed for pid={} name={:?}: {}",
                pid,
                name_ref,
                e
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn close_app(_app: tauri::AppHandle, pid: u32, hwnd: Option<i64>) -> Result<(), String> {
    // Gracefully close the app's window(s) via WM_CLOSE (lets it prompt to save).
    let hwnd_opt = hwnd.filter(|&h| h != 0).map(|h| h as isize);
    let pid_opt = if pid != 0 { Some(pid) } else { None };

    focus::close_window(hwnd_opt, pid_opt)
        .map_err(|e| e.to_string())
}

/// List the UIA tabs of a window (Windows Terminal, File Explorer, ...).
/// Returns [] for apps without addressable tabs or on non-Windows.
#[tauri::command(rename_all = "snake_case")]
async fn list_window_tabs(hwnd: i64) -> Vec<tab_uia::TabInfo> {
    if hwnd == 0 {
        return Vec::new();
    }
    tab_uia::list_tabs(hwnd as isize)
}

/// Focus a specific tab within a window via UIA, then foreground the window.
/// Prefers `title` (stable across reordering); falls back to `index`.
#[tauri::command(rename_all = "snake_case")]
async fn focus_window_tab(
    hwnd: i64,
    index: Option<usize>,
    title: Option<String>,
) -> Result<(), String> {
    if hwnd == 0 {
        return Err("missing hwnd".into());
    }
    if tab_uia::focus_tab(hwnd as isize, index, title.as_deref()) {
        Ok(())
    } else {
        Err("tab not found".into())
    }
}

/// The name the shell shows for a folder, which is what Explorer puts in its
/// window and tab titles: "Documents", "Local Disk (C:)", and the localized
/// names of every special folder. Matching those titles by path basename only
/// works for ordinary folders — `C:\Users\me\Documents` is titled "Documents",
/// and on a non-English Windows it isn't even that.
///
/// Falls back to the basename when the shell has nothing better (or off-Windows).
#[tauri::command]
fn folder_display_name(path: String) -> String {
    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_DISPLAYNAME};

        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut info = SHFILEINFOW::default();
        let ok = unsafe {
            SHGetFileInfoW(
                PCWSTR(wide.as_ptr()),
                Default::default(),
                Some(&mut info),
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_DISPLAYNAME,
            )
        };
        if ok != 0 {
            let end = info
                .szDisplayName
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(info.szDisplayName.len());
            let name = String::from_utf16_lossy(&info.szDisplayName[..end]);
            if !name.trim().is_empty() {
                return name;
            }
        }
    }

    path.trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("")
        .to_string()
}

#[tauri::command]
fn toggle_spotlight(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("spotlight") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            // Get cursor position to find the active monitor.
            //
            // On Windows, GetCursorPos and monitor bounds are both in
            // physical pixels, so a direct comparison is safe.
            //
            // On macOS this is deliberately NOT `app.cursor_position()`
            // (tao/winit): that helper converts the cursor's logical
            // position to physical pixels using ONLY the primary monitor's
            // scale factor (see tao's platform_impl/macos/util/mod.rs). On
            // a mixed-DPI setup (e.g. built-in Retina display at 2x plus an
            // external monitor at a different scale) that produces a
            // physical value that doesn't fall inside any real monitor's
            // bounds once the cursor is on the secondary display, so the
            // match below would always fail and silently fall back to the
            // primary monitor. Instead we read the raw cursor position in
            // *points* via CGEvent (unscaled, so it isn't tied to any one
            // monitor's scale factor) and compare it against each
            // candidate monitor's own bounds converted back to points using
            // that monitor's own scale factor — avoiding the chicken-and-egg
            // problem of not yet knowing which scale factor to apply.
            #[cfg(target_os = "windows")]
            let cursor_pos: Option<(f64, f64)> = {
                let mut pt = windows::Win32::Foundation::POINT::default();
                if unsafe { windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut pt) }.is_ok() {
                    Some((pt.x as f64, pt.y as f64))
                } else {
                    None
                }
            };
            #[cfg(target_os = "macos")]
            let cursor_pos: Option<(f64, f64)> = {
                use core_graphics::event::CGEvent;
                use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
                CGEventSource::new(CGEventSourceStateID::HIDSystemState).ok().and_then(|src| {
                    CGEvent::new(src).ok().map(|e| {
                        let loc = e.location();
                        (loc.x, loc.y)
                    })
                })
            };
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let cursor_pos: Option<(f64, f64)> = None;

            // Find which monitor contains this cursor point
            let monitors = app.available_monitors().unwrap_or_default();
            let target_monitor = if let Some((cx, cy)) = cursor_pos {
                monitors.into_iter().find(|m| {
                    let pos = m.position();
                    let size = m.size();
                    #[cfg(target_os = "macos")]
                    {
                        // Compare in points: convert this monitor's physical
                        // bounds back to points using its OWN scale factor.
                        let scale = m.scale_factor();
                        let px = pos.x as f64 / scale;
                        let py = pos.y as f64 / scale;
                        let pw = size.width as f64 / scale;
                        let ph = size.height as f64 / scale;
                        cx >= px && cx < px + pw && cy >= py && cy < py + ph
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        cx >= pos.x as f64 && cx < pos.x as f64 + size.width as f64 &&
                        cy >= pos.y as f64 && cy < pos.y as f64 + size.height as f64
                    }
                }).or_else(|| app.primary_monitor().ok().flatten())
            } else {
                app.primary_monitor().ok().flatten()
            };

            if let Some(monitor) = target_monitor {
                let m_pos = monitor.position();
                let m_size = monitor.size();

                // macOS: do this whole computation in logical points and
                // apply it via `Logical` position/size, not `Physical`. On
                // macOS, `set_size`/`set_position` given `Physical` values
                // get converted to points using the WINDOW's current scale
                // factor (whatever screen it was on before this move), not
                // the target screen's — so moving between screens with
                // different scale factors (e.g. built-in Retina at 2x and
                // an external display at 1x) landed the window off-center
                // or partly off-screen depending on which screen it came
                // from. `Logical` values are passed straight to AppKit
                // unconverted, sidestepping that mismatch entirely.
                #[cfg(target_os = "macos")]
                {
                    let scale = monitor.scale_factor();
                    let mx = m_pos.x as f64 / scale;
                    let my = m_pos.y as f64 / scale;
                    let mw = m_size.width as f64 / scale;
                    let mh = m_size.height as f64 / scale;

                    // Width is kept stable in points (not re-derived from the
                    // window's current physical size) so it doesn't silently
                    // double/halve after moving between screens with
                    // different scale factors.
                    let cur_scale = window.scale_factor().unwrap_or(scale);
                    let w_width = window.outer_size().map(|s| s.width as f64 / cur_scale).unwrap_or(800.0);
                    let w_height = mh * 0.85;
                    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: w_width, height: w_height }));

                    let x = mx + (mw - w_width) / 2.0;
                    let y = my + (mh - w_height) / 3.0;
                    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
                }

                #[cfg(not(target_os = "macos"))]
                {
                    // Size the (transparent) window to most of the monitor height so the
                    // panel can grow with content — the 800x600 default capped it and made
                    // the workspace section collapse when the tabs grid got tall.
                    let w_width = window.outer_size().map(|s| s.width).unwrap_or(800);
                    let w_height = (m_size.height as f64 * 0.85) as u32;
                    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w_width, height: w_height }));

                    // Multi-monitor aware centering: Center X, and find Y at 1/3 of the gap from top
                    let x = m_pos.x + (m_size.width as i32 - w_width as i32) / 2;
                    let y = m_pos.y + (m_size.height as i32 - w_height as i32) / 3;
                    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
                }
            }

            // Without this, the (already-built, just hidden) spotlight window
            // stays pinned to whatever Space it last appeared on — invoking it
            // from a different Space (including another app's fullscreen Space)
            // either shows nothing there or force-switches the user back.
            // macOS-only. Dispatched on the main thread: raw NSWindow access via
            // objc2, and this can be triggered by a global-shortcut callback.
            //
            // `window.show()` / `.set_focus()` are deliberately skipped on
            // macOS in favor of `dock::show_over_fullscreen_spaces`, which
            // also joins the window to the current (possibly fullscreen)
            // Space via the private Spaces API — see that function's doc
            // comment.
            #[cfg(target_os = "macos")]
            {
                let window_for_appkit = window.as_ref().window();
                let _ = app.run_on_main_thread(move || {
                    dock::promote_spotlight_over_fullscreen_spaces(&window_for_appkit);
                    dock::show_over_fullscreen_spaces(&window_for_appkit);
                });
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit("spotlight-shown", ());
        }
    }
}

// Workspace the spotlight window should open /edit-workspace for — set by
// `open_spotlight_edit`, taken (once) by the spotlight window. Held here
// rather than only sent as the event payload so a spotlight webview that
// hasn't finished loading yet still picks it up on mount.
static PENDING_SPOTLIGHT_EDIT: std::sync::Mutex<Option<serde_json::Value>> = std::sync::Mutex::new(None);

/// Open the spotlight window straight into edit mode for `workspace`
/// (`{ id, name }`). Used where the main window has no embedded spotlight of
/// its own: the sidebar (header hidden) and the top/bottom dock bar.
#[tauri::command]
fn open_spotlight_edit(app: tauri::AppHandle, workspace: serde_json::Value) {
    *PENDING_SPOTLIGHT_EDIT.lock().unwrap() = Some(workspace);
    let visible = app
        .get_webview_window("spotlight")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);
    // toggle_spotlight would hide an already-open spotlight — only call it to show.
    if !visible {
        toggle_spotlight(app.clone());
    }
    let _ = app.emit("spotlight-edit-workspace", ());
}

#[tauri::command]
fn take_spotlight_edit() -> Option<serde_json::Value> {
    PENDING_SPOTLIGHT_EDIT.lock().unwrap().take()
}

// Shell command typed into the spotlight (`> …`) for the main window to run
// in a terminal tab — set by `spotlight_run_in_terminal`, taken (once) by the
// main window. A pending slot for the same reason as PENDING_SPOTLIGHT_EDIT:
// a main window that's only now being created still picks it up on mount.
static PENDING_TERMINAL_RUN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Hand a command from the spotlight window to the main window, which opens
/// it as a terminal tab (see `useSpotlightRuns` in runInTerminal.js).
#[tauri::command]
fn spotlight_run_in_terminal(app: tauri::AppHandle, command: String) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("Empty command".into());
    }
    *PENDING_TERMINAL_RUN.lock().unwrap() = Some(command);
    if let Some(window) = app.get_webview_window("spotlight") {
        let _ = window.hide();
    }
    show_main_window(&app);
    let _ = app.emit("spotlight-run-in-terminal", ());
    Ok(())
}

#[tauri::command]
fn take_terminal_run() -> Option<String> {
    PENDING_TERMINAL_RUN.lock().unwrap().take()
}

#[tauri::command]
fn hide_spotlight(app: tauri::AppHandle) {
    // Grant any process foreground permission BEFORE hiding our window.
    // The spotlight owns the foreground right now; once we hide it Windows
    // revokes our foreground lock and subsequent SetForegroundWindow calls
    // from the sidecar would be denied (causing the taskbar-blink symptom).
    // AllowSetForegroundWindow(ASFW_ANY) pre-authorises the focus transfer.
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;
        let _ = AllowSetForegroundWindow(u32::MAX); // ASFW_ANY = 0xFFFFFFFF
    }
    if let Some(window) = app.get_webview_window("spotlight") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn set_spotlight_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<serde_json::Value, String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    let shortcut_str = if shortcut.trim().is_empty() { "Alt+K".to_string() } else { shortcut.trim().to_string() };

    // Unregister all existing shortcuts then register the new one
    if let Err(e) = app.global_shortcut().unregister_all() {
        log::warn!("[Shortcut] Failed to unregister old shortcuts: {}", e);
    }

    let handle = app.clone();
    match app.global_shortcut().on_shortcut(shortcut_str.as_str(), move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            toggle_spotlight(handle.clone());
        }
    }) {
        Ok(_) => {
            log::info!("[Shortcut] Registered new spotlight shortcut: {}", shortcut_str);
            Ok(serde_json::json!({ "ok": true, "spotlightShortcut": shortcut_str }))
        }
        Err(e) => {
            // Failed — fall back to Alt+K
            log::error!("[Shortcut] Failed to register '{}': {}. Falling back to Alt+K", shortcut_str, e);
            let handle2 = app.clone();
            let _ = app.global_shortcut().on_shortcut("Alt+K", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    toggle_spotlight(handle2.clone());
                }
            });
            Err(format!("Invalid shortcut '{}': {}. Reverted to Alt+K.", shortcut_str, e))
        }
    }
}

#[tauri::command]
async fn launch_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        use windows::core::{HSTRING, PCWSTR};

        // Working directory = the exe's own folder. Many apps (OBS, portable apps,
        // some games) resolve resources relative to the cwd — OBS fails with
        // "Failed to find locale/en-US.ini" otherwise. Mirrors a shortcut's "Start in".
        let work_dir = std::path::Path::new(&path)
            .parent()
            .filter(|d| !d.as_os_str().is_empty());

        // Launch via ShellExecuteW — exactly how the Start Menu / double-clicking in
        // Explorer launches an app. Critically, a console app (cmd.exe, powershell)
        // gets its OWN new console window instead of inheriting ours (a plain spawn
        // would attach cmd to our console when we're started from a terminal, e.g.
        // `tauri dev`). GUI apps get their window with no console flash; it also
        // handles .lnk shortcuts, Store apps, and UAC elevation.
        let path_w = HSTRING::from(path.as_str());
        let open_w = HSTRING::from("open");
        let dir_w = work_dir.and_then(|d| d.to_str()).map(HSTRING::from);

        let exec = |verb: PCWSTR| unsafe {
            match &dir_w {
                Some(d) => ShellExecuteW(None, verb, &path_w, None, d, SW_SHOWNORMAL),
                None => ShellExecuteW(None, verb, &path_w, None, None, SW_SHOWNORMAL),
            }
        };

        // ShellExecuteW returns a value > 32 on success. Try the explicit "open"
        // verb first (so console apps get their own console window).
        let mut hinst = exec(PCWSTR(open_w.as_ptr()));

        // If "open" isn't registered for this file type, retry with the shell's
        // default verb (NULL). Control Panel applets (.cpl) register "cplopen"
        // rather than "open", so forcing "open" fails for them — the NULL verb
        // resolves to whatever double-clicking the file in Explorer would do.
        if (hinst.0 as isize) <= 32 {
            hinst = exec(PCWSTR::null());
        }

        // Still failed: fall back to a direct spawn (rare — e.g. an unusual path
        // the shell rejects). Only meaningful for real executables.
        if (hinst.0 as isize) <= 32 {
            let mut cmd = std::process::Command::new(&path);
            if let Some(dir) = work_dir {
                cmd.current_dir(dir);
            }
            let _ = cmd.spawn();
        }
    }
    #[cfg(target_os = "macos")]
    {
        // The scanner stores the Mach-O executable path inside the bundle
        // (e.g. /Applications/Foo.app/Contents/MacOS/Foo). Passing that raw
        // binary to `open` makes macOS treat it as a document and open it in
        // Terminal. Strip back to the .app bundle root so `open` launches it correctly.
        let open_path = if let Some(idx) = path.find(".app/Contents/") {
            path[..idx + 4].to_string() // "/Applications/Foo.app"
        } else {
            path.clone()
        };
        log::info!("[launch_app] macOS: `open '{}'` (raw path: '{}')", open_path, path);
        // `.output()` (not `.spawn()`) so a LaunchServices failure — wrong
        // path, quarantined/damaged bundle, etc — surfaces as an Err instead
        // of being silently discarded once the `open` helper process exits.
        let output = std::process::Command::new("open")
            .arg(&open_path)
            .output()
            .map_err(|e| {
                log::error!("[launch_app] failed to spawn `open`: {}", e);
                e.to_string()
            })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!(
                "[launch_app] `open '{}'` exited with {}: {}",
                open_path,
                output.status,
                stderr.trim()
            );
            return Err(format!("open failed: {}", stderr.trim()));
        }
        log::info!("[launch_app] `open '{}'` succeeded", open_path);
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        use windows::core::HSTRING;
        let url_w = HSTRING::from(url.as_str());
        let open_w = HSTRING::from("open");
        unsafe {
            ShellExecuteW(None, &open_w, &url_w, None, None, SW_SHOWNORMAL);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        open::that(&url).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open a web app in its own dedicated webview window ("installed web app"
/// feel). The window is a real top-level browsing context, so sign-ins are
/// first-party and persist in the shared WebView profile across launches —
/// unlike iframes, which trip third-party cookie blocking. Reuses the window
/// if it's already open.
#[tauri::command]
async fn open_webapp_window(
    app: tauri::AppHandle,
    id: String,
    url: String,
    title: Option<String>,
) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Only http(s) URLs can be opened as web apps".to_string());
    }

    // Window labels only allow [a-zA-Z0-9-/:_]
    let safe_id: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let label = format!("webapp-{}", safe_id);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(parsed))
        .title(title.unwrap_or_else(|| "CoolDesk".to_string()))
        .inner_size(1080.0, 760.0)
        .build()
        .map_err(|e| format!("Failed to open web app window: {}", e))?;
    Ok(())
}

/// Launch an app with arguments (e.g., VSCode with a folder path)
#[tauri::command]
async fn launch_app_with_args(app: String, args: Vec<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        // Try direct spawn first; editor CLIs (cursor, code, windsurf) are often
        // only in the user PATH, which Tauri's process may not inherit. Fall back
        // to `cmd /c` so the shell resolves PATH correctly.
        let direct_ok = std::process::Command::new(&app)
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .is_ok();
        if !direct_ok {
            std::process::Command::new("cmd")
                .arg("/c")
                .arg(&app)
                .args(&args)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("Failed to launch '{}' via cmd /c: {}", app, e))?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        // For macOS, use open -a for .app bundles
        if app.ends_with(".app") || app.contains(".app/") {
            let app_path = if let Some(idx) = app.find(".app/Contents/") {
                app[..idx + 4].to_string()
            } else {
                app.clone()
            };
            std::process::Command::new("open")
                .arg("-a")
                .arg(&app_path)
                .args(&args)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new(&app)
                .args(&args)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new(&app)
            .args(&args)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Wrap a path in single quotes for a POSIX shell, escaping any embedded
/// single quotes (`'` -> `'\''`) so it's passed through as one argument
/// regardless of spaces or other shell metacharacters it contains.
#[cfg(not(target_os = "windows"))]
fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Run a saved project command (from `.cooldesk/commands.json`) in a visible terminal
/// window, in the given working directory, so the user can watch its output. Used by the
/// clickable command pills in the CoolDesk workspace panel.
#[tauri::command]
async fn run_project_command(command: String, cwd: Option<String>) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("Empty command".into());
    }
    // Strip the Windows extended-length prefix (`\\?\`) — CMD rejects it as a working dir.
    let raw = cwd.unwrap_or_default();
    let dir = match raw.strip_prefix(r"\\?\") {
        Some(s) => s.to_string(),
        None => raw,
    };
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;
        // Open a new visible console running the command via `cmd /k` (keeps the window
        // open so dev-server output stays visible). Set the working directory through the
        // OS (`current_dir`) rather than a shell `cd /d "<path>"`, so the project path
        // never passes through cmd's quote parser — which mishandles the `\"`-escaped
        // quotes Rust emits for an embedded path, producing "syntax is incorrect".
        let mut c = std::process::Command::new("cmd");
        c.arg("/k").arg(&command).creation_flags(CREATE_NEW_CONSOLE);
        if !dir.is_empty() {
            c.current_dir(&dir);
        }
        c.spawn()
            .map_err(|e| format!("Failed to run command: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        let script = if dir.is_empty() {
            command.clone()
        } else {
            // `dir` must be shell-quoted, not just interpolated: an unquoted
            // path with a space (e.g. "~/Library/Application Support/Foo", or
            // any project folder with a space in its name — routine on
            // macOS) splits into extra words. `cd` in particular treats a
            // second word as an old/new string-replacement pair rather than
            // part of the path, silently `cd`-ing somewhere unrelated to the
            // saved command's actual working directory instead of failing
            // loudly.
            format!("cd {} && {}", shell_single_quote(&dir), command)
        };
        let osa = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            script.replace('\\', "\\\\").replace('"', "\\\"")
        );
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&osa)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let full = if dir.is_empty() {
            command.clone()
        } else {
            format!("cd {} && {}", shell_single_quote(&dir), command)
        };
        let spawned = std::process::Command::new("x-terminal-emulator")
            .arg("-e")
            .arg(format!("bash -c \"{}; exec bash\"", full))
            .spawn()
            .is_ok();
        if !spawned {
            std::process::Command::new("gnome-terminal")
                .arg("--")
                .arg("bash")
                .arg("-c")
                .arg(format!("{}; exec bash", full))
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Open a folder in the system file explorer
#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct FrequentFolder {
    pub name: String,
    pub path: String,
}

/// Folders the user actually works in, ranked by recent activity. Primary
/// source is the Recent Items shortcuts (real per-file/folder usage); Quick
/// Access "Frequent Places" only tops the list up on fresh machines.
#[tauri::command]
async fn get_frequent_folders() -> Vec<FrequentFolder> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(|| unsafe {
            let mut folders = list_recent_folders();
            if folders.len() < 6 {
                let have: std::collections::HashSet<String> =
                    folders.iter().map(|f| f.path.to_lowercase()).collect();
                folders.extend(
                    list_quick_access_folders()
                        .into_iter()
                        .filter(|f| !have.contains(&f.path.to_lowercase())),
                );
                folders.truncate(12);
            }
            folders
        })
        .await
        .unwrap_or_default()
    }
    // macOS has no bundled Quick-Access-style API to call, but Spotlight
    // already tracks last-used dates per item (kMDItemLastUsedDate) — the
    // same signal Finder's "Recents" uses — so `mdfind` gets a real answer
    // here instead of the empty list this returned unconditionally before.
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let Some(home) = dirs::home_dir() else { return Vec::new() };
            let output = std::process::Command::new("mdfind")
                .arg("-onlyin")
                .arg(&home)
                .arg("kMDItemContentType == 'public.folder' && kMDItemLastUsedDate >= $time.today(-90)")
                .output();
            let Ok(output) = output else { return Vec::new() };
            let stdout = String::from_utf8_lossy(&output.stdout);

            // Noise, not "folders the user works in": default libraries,
            // package internals, VCS/dependency dirs, build output — a
            // compile run touches these constantly, which floods "recently
            // used" with directories the user never navigates to themselves.
            let excluded_names = [
                "Library", "Applications", "Trash", ".Trash",
                "Desktop", "Downloads", "Documents", "Pictures", "Movies", "Music",
                "node_modules", ".git", "target", "dist", "build", ".next", "out",
            ];
            let noisy_segment = |p: &str| {
                p.contains("/Library/") || p.contains("/node_modules/") || p.contains("/.git/")
                    || p.contains("/target/") || p.contains("/dist/") || p.contains("/build/")
                    || p.contains(".app/")
            };

            let mut folders = Vec::new();
            for path in stdout.lines().filter(|s| !s.is_empty()) {
                if path == home.to_string_lossy() { continue; }
                if noisy_segment(path) { continue; }
                let Some(name) = std::path::Path::new(path).file_name().and_then(|n| n.to_str()) else { continue };
                if excluded_names.contains(&name) { continue; }
                folders.push(FrequentFolder { name: name.to_string(), path: path.to_string() });
                if folders.len() >= 20 { break; }
            }
            folders
        })
        .await
        .unwrap_or_default()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Vec::new()
    }
}

/// Rank folders by *actual use*: every file/folder the user opens drops a .lnk
/// into %APPDATA%\Microsoft\Windows\Recent, refreshed on re-open. A recency-
/// weighted count of those shortcuts per parent folder surfaces real working
/// folders (projects, repos) instead of the default libraries that dominate
/// Quick Access. Default libraries, AppData, and temp dirs are excluded.
#[cfg(target_os = "windows")]
unsafe fn list_recent_folders() -> Vec<FrequentFolder> {
    use std::collections::HashMap;
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

    let appdata = match std::env::var("APPDATA") {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let recent_dir = std::path::PathBuf::from(appdata).join("Microsoft\\Windows\\Recent");
    let entries = match std::fs::read_dir(&recent_dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    // One ShellLink instance reused to resolve every shortcut.
    let link: IShellLinkW = match CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) {
        Ok(l) => l,
        Err(_) => return Vec::new(),
    };
    let persist: IPersistFile = match link.cast() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };

    // Destination folders, not "work" folders — the default libraries (local
    // and OneDrive-redirected) drown out project folders if kept.
    let user = std::env::var("USERPROFILE").unwrap_or_default().to_lowercase();
    let mut excluded: Vec<String> = vec![user.clone(), format!("{user}\\onedrive")];
    for base in [user.clone(), format!("{user}\\onedrive")] {
        for lib in ["desktop", "downloads", "documents", "pictures", "music", "videos"] {
            excluded.push(format!("{base}\\{lib}"));
        }
    }

    let now = std::time::SystemTime::now();
    // lowercased path -> (display path, recency-weighted score)
    let mut scores: HashMap<String, (String, f64)> = HashMap::new();

    for entry in entries.flatten() {
        let lnk_path = entry.path();
        if lnk_path
            .extension()
            .map_or(true, |e| !e.eq_ignore_ascii_case("lnk"))
        {
            continue;
        }
        let age_days = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|m| now.duration_since(m).ok())
            .map(|d| d.as_secs_f64() / 86_400.0)
            .unwrap_or(f64::MAX);
        if age_days > 30.0 {
            continue;
        }

        if persist
            .Load(&HSTRING::from(lnk_path.as_os_str()), STGM_READ)
            .is_err()
        {
            continue;
        }
        let mut buf = [0u16; 520];
        let mut fd = WIN32_FIND_DATAW::default();
        if link.GetPath(&mut buf, &mut fd, 0).is_err() {
            continue;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(0);
        if len == 0 {
            continue;
        }
        let target = String::from_utf16_lossy(&buf[..len]);

        // The folder being "used": the target itself if it's a folder, else its parent.
        let target_path = std::path::Path::new(&target);
        let folder = if target_path.is_dir() {
            target_path.to_path_buf()
        } else if target_path.is_file() {
            match target_path.parent() {
                Some(p) => p.to_path_buf(),
                None => continue,
            }
        } else {
            continue; // target no longer exists
        };

        let folder_str = folder.to_string_lossy().to_string();
        if folder_str.len() <= 3 {
            continue; // drive roots
        }
        let lower = folder_str.to_lowercase();
        if excluded.iter().any(|e| e == &lower) {
            continue;
        }
        if lower.split('\\').any(|seg| {
            seg.starts_with('.') // .claude, .codex, .git, ... — tool internals
                || seg == "appdata"
                || seg == "temp"
                || seg == "tmp"
                || seg == "node_modules"
                || seg == "$recycle.bin"
        }) {
            continue;
        }

        // Recency-weighted count: today ≈ 1.0, a week old ≈ 0.3, a month ≈ 0.09.
        let weight = 1.0 / (1.0 + age_days / 3.0);
        let slot = scores.entry(lower).or_insert_with(|| (folder_str, 0.0));
        slot.1 += weight;
    }

    let mut ranked: Vec<(String, f64)> = scores.into_values().collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(12);
    ranked
        .into_iter()
        .map(|(path, _)| {
            let name = std::path::Path::new(&path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            FrequentFolder { name, path }
        })
        .collect()
}

/// Windows Quick Access "Frequent Places" — fallback when Recent Items is
/// empty/sparse (fresh machine). Virtual items and dead paths are skipped.
#[cfg(target_os = "windows")]
unsafe fn list_quick_access_folders() -> Vec<FrequentFolder> {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        BHID_EnumItems, IEnumShellItems, IShellItem, SHCreateItemFromParsingName, SIGDN,
        SIGDN_FILESYSPATH, SIGDN_NORMALDISPLAY,
    };

    unsafe fn display_name(item: &IShellItem, sigdn: SIGDN) -> Option<String> {
        let pw = item.GetDisplayName(sigdn).ok()?;
        let s = pw.to_string().ok();
        CoTaskMemFree(Some(pw.as_ptr() as *const std::ffi::c_void));
        s
    }

    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

    let mut out = Vec::new();
    let parse = HSTRING::from("shell:::{3936E9E4-D92C-4EEE-A85A-BC16D5EA0819}");
    let root: IShellItem = match SHCreateItemFromParsingName(&parse, None) {
        Ok(item) => item,
        Err(_) => return out,
    };
    let enum_items: IEnumShellItems = match root.BindToHandler(None, &BHID_EnumItems) {
        Ok(e) => e,
        Err(_) => return out,
    };

    loop {
        let mut items: [Option<IShellItem>; 1] = [None];
        let mut fetched = 0u32;
        if !enum_items.Next(&mut items, Some(&mut fetched)).is_ok() || fetched == 0 {
            break;
        }
        let Some(item) = items[0].take() else { break };
        // Only real filesystem folders — virtual entries have no FILESYSPATH.
        let Some(path) = display_name(&item, SIGDN_FILESYSPATH) else { continue };
        if !std::path::Path::new(&path).is_dir() {
            continue;
        }
        let name = display_name(&item, SIGDN_NORMALDISPLAY).unwrap_or_else(|| path.clone());
        out.push(FrequentFolder { name, path });
        if out.len() >= 12 {
            break;
        }
    }
    out
}

#[derive(serde::Serialize, Default)]
pub struct SearchFileResult {
    pub path: String,
    pub date: String,
    pub is_dir: bool,
    /// File size in bytes (0 for directories, and for search hits where we
    /// skip the extra stat call). Used by the in-app file manager.
    pub size: u64,
    /// Dot-prefixed, or carrying the Windows hidden/system attribute. These are
    /// still returned — callers decide whether to show them — because project
    /// folders like `.cooldesk`, `.git` and `.claude` matter to the user.
    pub hidden: bool,
}

/// Heavy/noise directories we never recurse INTO (they still match by name).
/// Keeps a home-rooted search fast by skipping AppData, build output, caches, etc.
fn is_pruned_dir(name_lower: &str) -> bool {
    if name_lower.starts_with('.') { return true; } // .git, .cache, .vscode, ...
    matches!(name_lower,
        "node_modules" | "appdata" | "$recycle.bin" | "target" | "dist" | "build"
        | "vendor" | "library" | "programdata" | "application data" | "local settings"
        | "__pycache__" | "venv" | "obj" | "out" | "coverage" | "tmp"
    )
}

/// True if any path *component* (not just a substring of the full path) is a
/// noisy build/cache directory — used to filter `mdfind`'s output, which
/// (unlike the Windows/Linux recursive walk below) has no chance to prune
/// before descending into `target/`, `node_modules/`, etc. A project like
/// `cooldesk-extension` with a `src-tauri/target/debug/` full of object files
/// named `cooldesk-*.o` will otherwise bury an unrelated sibling folder that
/// happens to share a substring (querying "cool" for a folder named
/// "cool-verse" returns hundreds of `cooldesk-*` build artifacts first).
#[cfg(target_os = "macos")]
fn path_has_pruned_component(path: &str) -> bool {
    std::path::Path::new(path).components().any(|c| match c {
        std::path::Component::Normal(os) => is_pruned_dir(&os.to_string_lossy().to_lowercase()),
        _ => false,
    })
}

/// Token-based name match: every query word must appear in the name. This makes
/// separators interchangeable — "rejected project" matches "rejected-project",
/// "rejected_project", "Rejected Project", etc.
fn name_matches(name_lower: &str, tokens: &[String]) -> bool {
    !tokens.is_empty() && tokens.iter().all(|t| name_lower.contains(t.as_str()))
}

fn search_dir_recursive(
    dir: &std::path::Path,
    tokens: &[String],
    results: &mut Vec<SearchFileResult>,
    depth: u32,
    budget: &mut u32,
) {
    if depth == 0 || results.len() >= 15 || *budget == 0 { return; }
    *budget -= 1;
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if results.len() >= 15 || *budget == 0 { break; }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        let is_dir = path.is_dir();
        // Match both files AND folders by name (pruned dirs still match here).
        if name_matches(&name, tokens) {
            let date_str = std::fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Local> = t.into();
                    dt.format("%Y-%m-%d %H:%M").to_string()
                })
                .unwrap_or_default();
            results.push(SearchFileResult { path: path.to_string_lossy().into_owned(), date: date_str, is_dir, size: 0, hidden: false });
        }
        // Descend into folders, but skip heavy/noise ones to stay fast.
        if is_dir && !is_pruned_dir(&name) {
            search_dir_recursive(&path, tokens, results, depth - 1, budget);
        }
    }
}

/// Search user files (Downloads, Documents, Desktop) cross-platform
#[tauri::command]
async fn search_files(app: tauri::AppHandle, query: String) -> Result<Vec<SearchFileResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let query_lower = query.to_lowercase();
    // Split into words so separators (space/-/_) are interchangeable when matching.
    let tokens: Vec<String> = query_lower.split_whitespace().map(String::from).collect();

    // Search the whole home folder (covers Downloads/Documents/Desktop AND
    // arbitrary folders like ~/projects/...). Pruning keeps it fast.
    let mut targets = Vec::new();
    if let Some(home) = dirs::home_dir() {
        targets.push(home);
    } else {
        if let Some(dl) = dirs::download_dir() { targets.push(dl); }
        if let Some(doc) = dirs::document_dir() { targets.push(doc); }
        if let Some(desk) = dirs::desktop_dir() { targets.push(desk); }
    }
    // Folders the user explicitly linked in Settings — covers paths outside
    // the home folder (an external drive, a mounted network share, ...) that
    // the sections above never reach. Cross-platform: same registry powers
    // both the mac `mdfind -onlyin` targets and the Windows/Linux recursive
    // walk below, not a platform-specific mechanism of its own.
    for path in folder_index::enabled_paths(&app) {
        let p = std::path::PathBuf::from(path);
        if p.is_dir() && !targets.contains(&p) {
            targets.push(p);
        }
    }

    // Match the well-known user folders by their OWN name first, so typing
    // "download" surfaces the Downloads folder itself (not just its contents).
    let mut final_results: Vec<SearchFileResult> = Vec::new();
    let roots = [
        dirs::download_dir(), dirs::document_dir(), dirs::desktop_dir(),
        dirs::picture_dir(), dirs::video_dir(), dirs::audio_dir(),
        dirs::home_dir(),
    ];
    for root in roots.into_iter().flatten() {
        let Some(name) = root.file_name() else { continue };
        if name_matches(&name.to_string_lossy().to_lowercase(), &tokens) {
            let date_str = std::fs::metadata(&root).ok()
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Local> = t.into();
                    dt.format("%Y-%m-%d %H:%M").to_string()
                })
                .unwrap_or_default();
            let path = root.to_string_lossy().into_owned();
            if !final_results.iter().any(|r| r.path == path) {
                final_results.push(SearchFileResult { path, date: date_str, is_dir: true, size: 0, hidden: false });
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("mdfind");
        for target in &targets {
            cmd.arg("-onlyin").arg(target);
        }
        cmd.arg("-name").arg(&query);

        let output = cmd.output().map_err(|e| e.to_string())?;
        let output_str = String::from_utf8_lossy(&output.stdout);
        // `mdfind`'s own ordering isn't relevance-ranked — a project folder
        // whose name is a substring of a sibling's (e.g. "cool-verse" next to
        // "cooldesk-extension") can easily lose to hundreds of that sibling's
        // build-artifact filenames matching the same query. So: prune noisy
        // directories first, keep a generous number of candidates (not the
        // final 15) so a real match a few hundred lines down still survives,
        // and only truncate after directories are sorted ahead of files.
        for path in output_str
            .lines()
            .filter(|s| !s.is_empty() && !path_has_pruned_component(s))
            .take(300)
        {
            let mut date_str = String::new();
            let mut is_dir = false;
            if let Ok(metadata) = std::fs::metadata(path) {
                is_dir = metadata.is_dir();
                if let Ok(modified) = metadata.modified() {
                    let datetime: chrono::DateTime<chrono::Local> = modified.into();
                    date_str = datetime.format("%Y-%m-%d %H:%M").to_string();
                }
            }
            if !final_results.iter().any(|r| r.path == path) {
                final_results.push(SearchFileResult { path: path.to_string(), date: date_str, is_dir, size: 0, hidden: false });
            }
        }
        // Stable sort: directories first (usually what a project-name query is
        // after), preserving mdfind's relative order within each group.
        final_results.sort_by_key(|r| !r.is_dir);
        final_results.truncate(15);
        return Ok(final_results);
    }

    #[cfg(target_os = "windows")]
    {
        let mut budget: u32 = 8000; // cap directories scanned to bound latency
        for target in &targets {
            search_dir_recursive(target, &tokens, &mut final_results, 5, &mut budget);
            if final_results.len() >= 15 || budget == 0 { break; }
        }
        final_results.truncate(15);
        return Ok(final_results);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Linux has no bundled Spotlight/Everything equivalent to shell out
        // to, so it gets the same budgeted recursive walk as the Windows
        // fallback rather than the previous no-op.
        let mut budget: u32 = 8000;
        for target in &targets {
            search_dir_recursive(target, &tokens, &mut final_results, 5, &mut budget);
            if final_results.len() >= 15 || budget == 0 { break; }
        }
        final_results.truncate(15);
        Ok(final_results)
    }
}

#[derive(serde::Serialize)]
struct PathKind {
    path: String,
    exists: bool,
    is_dir: bool,
}

/// Classify paths dropped onto the window from the OS (Finder / Explorer), so
/// the app can file each as a workspace "folder" or "file" reference. One stat
/// per path — cheaper than listing a folder just to learn it is one.
#[tauri::command]
fn path_kinds(paths: Vec<String>) -> Vec<PathKind> {
    paths
        .into_iter()
        .map(|path| {
            let meta = std::fs::metadata(&path).ok();
            PathKind {
                exists: meta.is_some(),
                is_dir: meta.map(|m| m.is_dir()).unwrap_or(false),
                path,
            }
        })
        .collect()
}

/// Stack / git branch / dirty state of a folder, for the workspace cards'
/// folder tiles. See `folder_identity.rs`.
#[tauri::command]
async fn folder_identity(path: String) -> folder_identity::FolderIdentity {
    tauri::async_runtime::spawn_blocking(move || folder_identity::folder_identity(&path))
        .await
        .unwrap_or_default()
}

/// List the immediate children of a folder (folders first, then files).
/// Powers the spotlight's inline folder drill-down.
#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<SearchFileResult>, String> {
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

    let mut dirs_out: Vec<SearchFileResult> = Vec::new();
    let mut files_out: Vec<SearchFileResult> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let p = entry.path();
        let meta = entry.metadata().ok();
        // Hidden entries are flagged, not dropped: `.cooldesk`, `.git`, `.env`
        // and friends are exactly what a developer opens a folder to find.
        let mut hidden = name.starts_with('.');
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::fs::MetadataExt;
            const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
            const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
            if let Some(m) = meta.as_ref() {
                if m.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0 {
                    hidden = true;
                }
            }
        }
        let is_dir = p.is_dir();
        let date_str = meta.as_ref()
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.format("%Y-%m-%d %H:%M").to_string()
            })
            .unwrap_or_default();
        let size = if is_dir { 0 } else { meta.as_ref().map(|m| m.len()).unwrap_or(0) };
        let r = SearchFileResult { path: p.to_string_lossy().into_owned(), date: date_str, is_dir, size, hidden };
        if is_dir { dirs_out.push(r) } else { files_out.push(r) }
    }
    // Folders first, each group sorted case-insensitively by name.
    dirs_out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    files_out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    dirs_out.extend(files_out);
    dirs_out.truncate(2000);
    Ok(dirs_out)
}


/// The standard user places the in-app file manager shows in its sidebar
/// (Home, Desktop, Downloads, …) plus, on Windows, the available drive roots.
/// Only paths that actually exist are returned, so the sidebar never dead-ends.
#[tauri::command]
async fn get_user_places() -> Vec<FrequentFolder> {
    let mut out: Vec<FrequentFolder> = Vec::new();
    let mut push = |name: &str, p: Option<std::path::PathBuf>| {
        if let Some(p) = p {
            if p.is_dir() {
                out.push(FrequentFolder { name: name.to_string(), path: p.to_string_lossy().into_owned() });
            }
        }
    };
    push("Home", dirs::home_dir());
    push("Desktop", dirs::desktop_dir());
    push("Downloads", dirs::download_dir());
    push("Documents", dirs::document_dir());
    push("Pictures", dirs::picture_dir());

    #[cfg(target_os = "windows")]
    {
        // Drive roots: probe C:\ … Z:\ and keep the ones that mount.
        for letter in b'C'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            if std::path::Path::new(&root).is_dir() {
                out.push(FrequentFolder { name: root.clone(), path: root });
            }
        }
    }
    out
}

/// Find the process(es) listening on a TCP port and force-kill them.
/// Windows: `netstat -ano` → parse LISTENING rows → `taskkill /F /PID`.
/// macOS/Linux: `lsof -ti tcp:PORT` → `kill -9`.
/// Returns a human-readable summary; errors only when nothing could be killed.
#[tauri::command]
async fn kill_process_on_port(port: u16) -> Result<String, String> {
    if port == 0 {
        return Err("Invalid port".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = std::process::Command::new("netstat")
            .args(["-ano", "-p", "tcp"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to run netstat: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let needle = format!(":{port}");

        // Collect unique PIDs whose local address ends with :PORT and are LISTENING.
        let mut pids: Vec<u32> = Vec::new();
        for line in stdout.lines() {
            let cols: Vec<&str> = line.split_whitespace().collect();
            // Proto, Local Address, Foreign Address, State, PID
            if cols.len() < 5 {
                continue;
            }
            let local = cols[1];
            let state = cols[3];
            if !state.eq_ignore_ascii_case("LISTENING") {
                continue;
            }
            // Match the port exactly (the local addr is e.g. 0.0.0.0:5173 or [::]:5173).
            if !local.ends_with(&needle) {
                continue;
            }
            if let Ok(pid) = cols[4].parse::<u32>() {
                if pid != 0 && !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
        }

        if pids.is_empty() {
            return Err(format!("No process is listening on port {port}"));
        }

        let mut killed = Vec::new();
        let mut failed = Vec::new();
        for pid in &pids {
            let res = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            match res {
                Ok(o) if o.status.success() => killed.push(*pid),
                _ => failed.push(*pid),
            }
        }

        if killed.is_empty() {
            return Err(format!(
                "Found PID(s) {:?} on port {port} but taskkill failed (try running as admin)",
                failed
            ));
        }
        Ok(format!("Killed PID(s) {killed:?} on port {port}"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        // lsof -ti returns one PID per line for processes with the port open.
        let output = std::process::Command::new("lsof")
            .args(["-ti", &format!("tcp:{port}")])
            .output()
            .map_err(|e| format!("Failed to run lsof: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let pids: Vec<&str> = stdout.split_whitespace().filter(|s| !s.is_empty()).collect();

        if pids.is_empty() {
            return Err(format!("No process is listening on port {port}"));
        }

        let mut killed = Vec::new();
        let mut failed = Vec::new();
        for pid in &pids {
            let res = std::process::Command::new("kill")
                .args(["-9", pid])
                .output();
            match res {
                Ok(o) if o.status.success() => killed.push(*pid),
                _ => failed.push(*pid),
            }
        }

        if killed.is_empty() {
            return Err(format!("Found PID(s) {failed:?} on port {port} but kill failed"));
        }
        Ok(format!("Killed PID(s) {killed:?} on port {port}"))
    }
}

#[derive(serde::Serialize)]
pub struct ListeningPort {
    pub port: u16,
    pub pid: u32,
    pub process: String,
    /// CPU usage percent (100 = one full core; may exceed 100 on multi-core).
    pub cpu: f32,
    /// Resident memory in bytes.
    pub memory: u64,
}

/// Sample CPU% + memory for the given PIDs. CPU needs two reads spaced by
/// sysinfo's minimum interval, so this briefly blocks — call via spawn_blocking.
fn collect_process_stats(
    pids: &std::collections::HashSet<u32>,
) -> std::collections::HashMap<u32, (f32, u64)> {
    use sysinfo::{Pid, ProcessRefreshKind, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_cpu().with_memory());
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_cpu().with_memory());

    let mut map = std::collections::HashMap::new();
    for &pid in pids {
        if let Some(p) = sys.process(Pid::from_u32(pid)) {
            map.insert(pid, (p.cpu_usage(), p.memory()));
        }
    }
    map
}

/// Force-kill a process by PID. Windows: `taskkill /F /T` (kills the tree so
/// wrappers like npm→node go too). macOS/Linux: `kill -9`.
#[tauri::command]
async fn kill_process(pid: u32) -> Result<String, String> {
    if pid == 0 {
        return Err("Invalid PID".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let out = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to run taskkill: {e}"))?;
        if out.status.success() {
            Ok(format!("Killed PID {pid}"))
        } else {
            Err(format!(
                "taskkill failed for PID {pid}: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let out = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .map_err(|e| format!("Failed to run kill: {e}"))?;
        if out.status.success() {
            Ok(format!("Killed PID {pid}"))
        } else {
            Err(format!(
                "kill failed for PID {pid}: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ))
        }
    }
}

/// Enumerate processes listening on a TCP port (the "Dev Servers" panel source).
/// Windows: `netstat -ano` for (port, pid) + `tasklist` for pid→name.
/// macOS/Linux: `lsof -nP -iTCP -sTCP:LISTEN`.
/// Returns every listening port; the frontend applies dev-range/process filtering.
#[tauri::command]
async fn list_listening_ports() -> Result<Vec<ListeningPort>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::collections::HashMap;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 1. (port, pid) pairs from netstat LISTENING rows.
        let netstat = std::process::Command::new("netstat")
            .args(["-ano", "-p", "tcp"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to run netstat: {e}"))?;
        let netstat_out = String::from_utf8_lossy(&netstat.stdout);

        // Dedupe on (port, pid) — a server bound to both 0.0.0.0 and [::] shows twice.
        let mut seen: std::collections::HashSet<(u16, u32)> = std::collections::HashSet::new();
        let mut rows: Vec<(u16, u32)> = Vec::new();
        for line in netstat_out.lines() {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 5 || !cols[3].eq_ignore_ascii_case("LISTENING") {
                continue;
            }
            // Local address: 0.0.0.0:5173 / [::]:5173 / 127.0.0.1:5173 — port is after the last ':'.
            let local = cols[1];
            let port = match local.rsplit_once(':').and_then(|(_, p)| p.parse::<u16>().ok()) {
                Some(p) => p,
                None => continue,
            };
            let pid = match cols[4].parse::<u32>() {
                Ok(p) => p,
                Err(_) => continue,
            };
            if pid != 0 && seen.insert((port, pid)) {
                rows.push((port, pid));
            }
        }

        // 2. pid → image name from tasklist (CSV, no header).
        let tasklist = std::process::Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to run tasklist: {e}"))?;
        let tasklist_out = String::from_utf8_lossy(&tasklist.stdout);
        let mut names: HashMap<u32, String> = HashMap::new();
        for line in tasklist_out.lines() {
            // "name.exe","1234","Console","1","12,345 K"
            let fields: Vec<&str> = line.split("\",\"").collect();
            if fields.len() < 2 {
                continue;
            }
            let name = fields[0].trim_matches('"').to_string();
            if let Ok(pid) = fields[1].trim_matches('"').parse::<u32>() {
                names.insert(pid, name);
            }
        }

        // CPU/RAM for just the listening PIDs (off-thread because it sleeps).
        let pidset: std::collections::HashSet<u32> = rows.iter().map(|(_, pid)| *pid).collect();
        let stats = tokio::task::spawn_blocking(move || collect_process_stats(&pidset))
            .await
            .unwrap_or_default();

        let mut result: Vec<ListeningPort> = rows
            .into_iter()
            .map(|(port, pid)| {
                let (cpu, memory) = stats.get(&pid).copied().unwrap_or((0.0, 0));
                ListeningPort {
                    port,
                    pid,
                    process: names.get(&pid).cloned().unwrap_or_else(|| "Unknown".to_string()),
                    cpu,
                    memory,
                }
            })
            .collect();
        result.sort_by_key(|p| p.port);
        Ok(result)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // lsof one-line-per-socket: COMMAND PID USER FD TYPE DEVICE SIZE NODE NAME
        // NAME ends with ...:PORT (LISTEN). -nP keeps host/port numeric.
        let output = std::process::Command::new("lsof")
            .args(["-nP", "-iTCP", "-sTCP:LISTEN"])
            .output()
            .map_err(|e| format!("Failed to run lsof: {e}"))?;
        let out = String::from_utf8_lossy(&output.stdout);

        let mut seen: std::collections::HashSet<(u16, u32)> = std::collections::HashSet::new();
        let mut rows: Vec<(u16, u32, String)> = Vec::new();
        for line in out.lines().skip(1) {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 9 {
                continue;
            }
            let process = cols[0].to_string();
            let pid = match cols[1].parse::<u32>() {
                Ok(p) => p,
                Err(_) => continue,
            };
            let name = cols[cols.len() - 1];
            let port = match name.rsplit_once(':').and_then(|(_, p)| p.parse::<u16>().ok()) {
                Some(p) => p,
                None => continue,
            };
            if seen.insert((port, pid)) {
                rows.push((port, pid, process));
            }
        }

        let pidset: std::collections::HashSet<u32> = rows.iter().map(|(_, pid, _)| *pid).collect();
        let stats = tokio::task::spawn_blocking(move || collect_process_stats(&pidset))
            .await
            .unwrap_or_default();

        let mut result: Vec<ListeningPort> = rows
            .into_iter()
            .map(|(port, pid, process)| {
                let (cpu, memory) = stats.get(&pid).copied().unwrap_or((0.0, 0));
                ListeningPort { port, pid, process, cpu, memory }
            })
            .collect();
        result.sort_by_key(|p| p.port);
        Ok(result)
    }
}

/// App commands aren't ACL-checked (there's no app permission manifest), so any
/// page that can reach IPC could call them — `run_project_command` included.
/// Webviews that host remote sites (`webapp-*` windows, the in-app browser
/// pane) therefore get no app commands at all. Plugin commands are unaffected:
/// Tauri's ACL already denies those to remote origins.
fn guard_remote_webviews<R: tauri::Runtime>(
    handler: impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        let label = invoke.message.webview_ref().label();
        if label.starts_with("webapp-") || label.starts_with(browser_pane::LABEL_PREFIX) {
            invoke.resolver.reject("Command not available to web content");
            return true;
        }
        handler(invoke)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        // `--quit` from the uninstaller: shut this instance down cleanly rather
        // than surfacing a window that's about to be deleted.
        if quit_requested(&args) {
            app.exit(0);
            return;
        }
        // When a second instance is launched, show the main window of the first
        // (creating it if the first instance came up headless via autostart).
        show_main_window(app);
    }))
    .plugin(tauri_plugin_dialog::init())
    // Native file drag-out from the file manager (see FileManager.jsx onItemDrag).
    .plugin(tauri_plugin_drag::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec![ARG_AUTOSTART]),
    ))
    .invoke_handler(guard_remote_webviews(tauri::generate_handler![
        web_suggest,
        get_running_apps,
        get_installed_apps,
        categorize_app,
        focus_window,
        close_app,
        list_window_tabs,
        focus_window_tab,
        folder_display_name,
        toggle_spotlight,
        open_spotlight_edit,
        folder_identity,
        take_spotlight_edit,
        spotlight_run_in_terminal,
        take_terminal_run,
        hide_spotlight,
        set_spotlight_shortcut,
        launch_app,
        launch_app_with_args,
        open_url,
        open_webapp_window,
        webapp_embed::webapp_embed_open,
        webapp_embed::webapp_embed_set_bounds,
        webapp_embed::webapp_embed_close,
        open_folder,
        run_project_command,
        get_frequent_folders,
        search_files,
        list_dir,
        dir_watch::watch_dir,
        dir_watch::unwatch_dir,
        path_kinds,
        get_user_places,
        get_focused_app,
        get_app_version,
        set_launch_at_login,
        get_launch_at_login,
        check_winget_update,
        set_analytics_enabled,
        run_winget_upgrade,
        install_native_update,
        kill_process_on_port,
        list_listening_ports,
        kill_process,
        surfaces::dock_enable,
        surfaces::dock_disable,
        surfaces::dock_expand,
        surfaces::dock_collapse,
        surfaces::dock_set_size,
        surfaces::dock_resize,
        surfaces::dock_set_bar_content_width,
        surfaces::dock_get_state,
        surfaces::dock_open_main,
        ai_cli::ai_cli_run,
        ai_cli::ai_cli_cancel,
        ai_cli::ai_cli_detect,
        save_backup,
        get_backups_dir,
        list_backups,
        read_backup,
        delete_backup,
        get_agent_workspace_dir,
        trust_project_dir,
        classify_project_folders,
        folder_index::folder_index_list,
        folder_index::folder_index_add,
        folder_index::folder_index_remove,
        folder_index::folder_index_set_options,
        folder_index::folder_index_reindex,
        folder_index::folder_index_reindex_all,
        preview::preview_text_file,
        preview::preview_image_file,
        preview::preview_pdf_file,
        browser_pane::browser_pane_open,
        browser_pane::browser_pane_set_bounds,
        browser_pane::browser_pane_nav,
        browser_pane::browser_pane_kill,
        browser_pane::browser_pane_stop_capture,
        browser_pane::site_permissions_get,
        browser_pane::site_permissions_set,
        browser_pane::browser_pane_set_adblock,
        browser_pane::browser_pane_set_zoom,
        browser_pane::stats::browser_pane_stats,
        archive::archive_list,
        archive::archive_extract,
        archive::archive_extract_entry,
        archive::archive_compress,
        terminal::terminal_open,
        terminal::terminal_write,
        terminal::terminal_resize,
        terminal::terminal_close,
        shelf::shelf_list,
        shelf::shelf_add_text,
        shelf::shelf_add_bytes,
        shelf::shelf_import,
        shelf::shelf_remove,
        shelf::shelf_pin,
        shelf::shelf_clear,
        shelf::shelf_save_to,
        clipboard::clipboard_status,
        clipboard::clipboard_set_enabled,
        clipboard::clipboard_set_paused,
        clipboard::clipboard_set_filters,
        clipboard::clipboard_list,
        clipboard::clipboard_text,
        clipboard::clipboard_copy,
        clipboard::clipboard_pin,
        clipboard::clipboard_remove,
        clipboard::clipboard_clear,
        clipboard::clipboard_save_to_shelf,
        vault::vault_status,
        vault::vault_set_enabled,
        vault::vault_create,
        vault::vault_unlock,
        vault::vault_lock,
        vault::vault_change_master,
        vault::vault_list,
        vault::vault_get,
        vault::vault_save,
        vault::vault_delete,
        vault::vault_copy,
        vault::vault_generate,
        annotations::highlights_list,
        annotations::highlights_update,
        annotations::highlights_delete,
        browser_pane::tools::browser_pane_highlight_focus,
        browser_pane::tools::browser_pane_find,
        browser_pane::tools::page_dark_hosts,
        browser_pane::tools::browser_pane_set_dark,
        browser_pane::tools::browser_pane_screenshot,
        browser_pane::tools::browser_pane_clip,
        browser_pane::browser_pane_adblock_supported,
        browser_pane::browser_pane_close
    ]))
    .setup(|app| {
      browser_pane::adblock::prepare(app.handle());
      // No instance was running, so `--quit` reached us as the primary. Exit
      // before spawning the sidecar or a window — otherwise the uninstaller's
      // shutdown request would leave a brand-new process running.
      if quit_requested(&std::env::args().collect::<Vec<_>>()) {
        log::info!("[Startup] --quit with no running instance; exiting");
        app.handle().exit(0);
        return Ok(());
      }

      // First launch of this install: count it now, before any window loads,
      // so an install whose UI never appears is still seen. Skipped when the
      // user opted out (a reinstall that kept its config dir).
      let (_, first_launch) = ensure_install_id(app.handle());
      if first_launch && !analytics_disabled_on_disk(app.handle()) {
          send_first_run_ping(app.handle());
      }

      let autostarted = launched_by_autostart();
      log::info!("[Startup] autostart={}", autostarted);

      // Registered in release too, not just under `cfg!(debug_assertions)`.
      // A packaged build has no console and no dev server, so a bug that only
      // shows up there (CSP rejections, a failed AppBar registration) used to
      // leave no trace at all — the log file is the only way to see it.
      // Targets are explicit so the on-disk file is guaranteed rather than
      // dependent on the plugin's default target list; it lands in
      // `app_log_dir()` (Windows: %APPDATA%\com.cooldesk.desktop\logs).
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
          ])
          .build(),
      )?;

      // Clipboard history watcher — idle until the user turns it on.
      clipboard::start(app.handle().clone());
      // Password vault: settings + idle auto-lock.
      vault::start(app.handle().clone());

      // Spawn Rust Sidecar Server (replaces Node.js sidecar)
      tauri::async_runtime::spawn(async {
          if let Err(e) = sidecar::start_server().await {
              log::error!("[Sidecar] Server failed: {}", e);
          }
      });

      // Close glued --app windows a previous process left behind (dev
      // rebuilds and crashes skip RunEvent::Exit), then arm persistence.
      {
          let dir = app
              .path()
              .app_data_dir()
              .unwrap_or_else(|_| std::env::temp_dir());
          let _ = std::fs::create_dir_all(&dir);
          webapp_embed::init(dir.join("webapp_embeds.json"));
      }

      // Re-assert launch-at-login. Auto-updates run the old NSIS uninstaller,
      // which wipes the autostart registry entry; if the user wanted it on,
      // recreate it here so the setting survives updates.
      {
          let app_handle = app.handle();
          if read_autostart_intent(app_handle) == Some(true) {
              let manager = app_handle.autolaunch();
              if !manager.is_enabled().unwrap_or(false) {
                  match manager.enable() {
                      Ok(_) => log::info!("[Autostart] Re-asserted launch-at-login after update"),
                      Err(e) => log::warn!("[Autostart] Failed to re-assert: {}", e),
                  }
              } else if read_autostart_args_version(app_handle) < AUTOSTART_ARGS_VERSION {
                  // The key exists but its command line predates ARG_AUTOSTART.
                  // `is_enabled()` only checks for the key's existence, so the
                  // stale value would never be rewritten — force it once.
                  match manager.disable().and_then(|_| manager.enable()) {
                      Ok(_) => log::info!(
                          "[Autostart] Rewrote Run entry with args (v{})",
                          AUTOSTART_ARGS_VERSION
                      ),
                      Err(e) => log::warn!("[Autostart] Failed to rewrite Run entry: {}", e),
                  }
              }
              write_autostart_intent(app_handle, true);
          }
      }

      // Check for updates in the background on startup. When we were launched at
      // login, hold off until the login storm has passed — a network call plus a
      // possible download is the last thing that should run while every other
      // startup program is hammering the disk. Kept longer than the 60s window
      // pre-warm below on purpose: `update-available` is emitted to windows, and
      // UpdateBanner lives in the main window, so main must exist by then.
      let update_handle = app.handle().clone();
      let update_delay = if autostarted { 90 } else { 0 };
      tauri::async_runtime::spawn(async move {
          if update_delay > 0 {
              tokio::time::sleep(std::time::Duration::from_secs(update_delay)).await;
          }
          use tauri_plugin_updater::UpdaterExt;
          match update_handle.updater() {
              Ok(updater) => match updater.check().await {
                  Ok(Some(update)) => {
                      log::info!("[Updater] New version available: {}", update.version);
                      let _ = update_handle.emit("update-available", &update.version);
                  }
                  Ok(None) => log::info!("[Updater] App is up to date"),
                  Err(e) => log::warn!("[Updater] Update check failed: {}", e),
              },
              Err(e) => log::warn!("[Updater] Updater init failed: {}", e),
          }
      });

      // Sidebar and dock windows: restore whichever the user left on, and start
      // the watchers that keep them placed (see surfaces.rs).
      surfaces::setup(app.handle());


      // Cross-platform: sweep linked folders (Settings → Folders & Index) for
      // ones due for auto-reindex. Checked every minute — reindexing itself is
      // a walk-the-tree operation (see `folder_index::reindex_one`), not
      // something worth polling faster than the coarsest `auto_reindex_minutes`
      // a user can set.
      {
          let app_handle = app.handle().clone();
          std::thread::spawn(move || loop {
              std::thread::sleep(std::time::Duration::from_secs(60));
              folder_index::run_due_auto_reindex(&app_handle);
          });
      }

      // Main window. Launched by hand (or by the installer's "run now"), the user
      // asked to see it — build and show it straight away. Launched at login, stay
      // headless in the tray (the sidebar/dock handles, if on, are already up) and
      // pre-warm the webview once the login storm has settled, so the first tray
      // click is still instant.
      if autostarted {
          let prewarm_handle = app.handle().clone();
          tauri::async_runtime::spawn(async move {
              tokio::time::sleep(std::time::Duration::from_secs(60)).await;
              let inner = prewarm_handle.clone();
              let _ = prewarm_handle.run_on_main_thread(move || {
                  if ensure_main_window(&inner).is_some() {
                      log::info!("[Startup] Pre-warmed main window");
                  }
              });
          });
      } else {
          show_main_window(app.handle());
      }

      // System tray icon — lets users show/hide the full app, toggle the
      // sidebar and dock windows, and quit cleanly. The Sidebar / Dock check
      // items double as the always-reachable recovery path for a panel that
      // ends up stuck or off-screen (its own controls would be too).
      let show_item = MenuItem::with_id(app, "show", "Show CoolDesk", true, None::<&str>)?;
      let (sidebar_item, bar_item) = surfaces::tray_items(app)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let sep1 = tauri::menu::PredefinedMenuItem::separator(app)?;
      let sep2 = tauri::menu::PredefinedMenuItem::separator(app)?;
      let tray_menu = Menu::with_items(
          app,
          &[&show_item, &sep1, &sidebar_item, &bar_item, &sep2, &quit_item],
      )?;

      TrayIconBuilder::new()
          .icon(app.default_window_icon().unwrap().clone())
          .menu(&tray_menu)
          .tooltip("CoolDesk")
          .on_menu_event(|app, event| match event.id.as_ref() {
              "show" => show_main_window(app),
              "quit" => app.exit(0),
              id => {
                  surfaces::handle_tray_menu(app, id);
              }
          })
          .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent| {
              if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                  let app = tray.app_handle();
                  // `is_visible` on a not-yet-created window is treated as
                  // hidden, so a headless autostart falls through to "open it".
                  let visible = app
                      .get_window("main")
                      .and_then(|w| w.is_visible().ok())
                      .unwrap_or(false);
                  if visible {
                      if let Some(window) = main_window(&app) {
                          let _ = window.hide();
                      }
                  } else {
                      show_main_window(app);
                  }
              }
          })
          .build(app)?;

      // Register Global Shortcut — load saved shortcut or default to Alt+K
      let saved_shortcut = {
          let data = sidecar::storage::load_data();
          data.settings.get("spotlightShortcut")
              .and_then(|v| v.as_str())
              .unwrap_or("Alt+K")
              .to_string()
      };
      let startup_shortcut = if saved_shortcut.trim().is_empty() { "Alt+K".to_string() } else { saved_shortcut };

      // Register plugin without a global handler — use per-shortcut on_shortcut() instead.
      // Using with_handler() here would cause double-fire after set_spotlight_shortcut()
      // re-registers via on_shortcut(), toggling the window open then immediately closed.
      app.handle().plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

      let handle = app.handle().clone();
      use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
      // A saved shortcut string the plugin can't parse (a stale/corrupt value,
      // or a bad one that slipped past the recorder's validation — see
      // set_spotlight_shortcut) must never crash the whole app at launch: the
      // ? this used to end in propagated out of .setup(), and a setup-hook
      // Err becomes an unwind across tao's ObjC delegate, which aborts the
      // process outright (Rust panics can't cross that FFI boundary). Fall
      // back to Alt+K and keep starting instead.
      let register_result = app.global_shortcut().on_shortcut(startup_shortcut.as_str(), {
          let handle = handle.clone();
          move |_app, _shortcut, event| {
              if event.state == ShortcutState::Pressed {
                  toggle_spotlight(handle.clone());
              }
          }
      });
      if let Err(e) = register_result {
          log::error!("[Shortcut] Saved shortcut '{}' failed to register: {}. Falling back to Alt+K.", startup_shortcut, e);
          if startup_shortcut != "Alt+K" {
              app.global_shortcut().on_shortcut("Alt+K", move |_app, _shortcut, event| {
                  if event.state == ShortcutState::Pressed {
                      toggle_spotlight(handle.clone());
                  }
              }).map_err(|e| format!("Failed to register fallback shortcut 'Alt+K': {}", e))?;
          }
      }

      // Grant the spotlight window permission to render over other apps'
      // fullscreen Spaces exactly once, here, instead of inside
      // `toggle_spotlight`. `.setup()` runs synchronously on the main
      // thread, so this is race-free; doing it per-toggle via
      // `run_on_main_thread` was racing against that same toggle's
      // `window.show()` — both got queued onto the main run loop with no
      // guaranteed order, so on a fresh launch the very first show (i.e.
      // every test after a rebuild) could fire before the collection
      // behavior was actually applied, making the window invisible over a
      // fullscreen app until a second, later toggle happened to win the race.
      #[cfg(target_os = "macos")]
      if let Some(spotlight) = app.get_webview_window("spotlight") {
          dock::promote_spotlight_over_fullscreen_spaces(&spotlight.as_ref().window());
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app_handle, event| {
        // macOS dock icon reopen handling would go here if needed
        // RunEvent::Reopen is macOS-specific and not available on Windows
        if let tauri::RunEvent::Exit = event {
            // Glued --app browser windows aren't our children — close them
            // explicitly so quitting CoolDesk doesn't orphan them.
            webapp_embed::close_all();
            // End the built-in terminal's shells with the app.
            terminal::close_all();
            // Release any AppBar reservation so we don't leave a reserved strip
            // behind (no-op if reserve mode was never active this run).
            dock::remove_dock();
        }
    });
}

