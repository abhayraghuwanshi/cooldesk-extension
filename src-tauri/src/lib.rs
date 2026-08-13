use tauri::{Manager, Emitter};
use tauri_plugin_autostart::ManagerExt;
use std::sync::{Arc, RwLock};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};

mod sidecar;
mod system;
mod focus;
mod categorize;
mod scanner;
mod matcher;
mod tab_uia;
mod webapp_embed;
mod dock;
mod ai_cli;

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
/// The main window is *not* declared in tauri.conf.json — declaring it there
/// makes Tauri build the webview and load the whole React dashboard at process
/// start, which is exactly the login-time cost we're avoiding. It's built here
/// on first demand instead (tray click, single-instance relaunch, dock expand),
/// and pre-warmed in the background well after login has settled.
///
/// Always returns the window hidden; callers decide when to show it.
fn ensure_main_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window("main") {
        return Some(win);
    }

    let built = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        .title("CoolDesk")
        .inner_size(1400.0, 900.0)
        .resizable(true)
        .fullscreen(false)
        .visible(false)
        .build();

    match built {
        Ok(win) => {
            attach_main_window_events(&win);
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
            .webview_windows()
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
            .webview_windows()
            .values()
            .any(|w| w.is_focused().unwrap_or(false))
    }
}

/// Hide-on-close, and (in drawer mode) collapse to the handle when the panel
/// loses focus — the "click away to hide" behavior.
fn attach_main_window_events(window: &tauri::WebviewWindow) {
    let win = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = win.hide();
        }
        tauri::WindowEvent::Focused(false) => {
            let app = win.app_handle();
            let st = load_dock_state(app);
            if st.enabled && st.mode == "drawer" && win.is_visible().unwrap_or(false) {
                // "Click away to hide" must only fire for a click *away*. During a
                // layout switch focus bounces between our own windows (the panel is
                // hidden, the handle is shown, the panel comes back), and the blur
                // that produces is delivered asynchronously — often after the panel
                // has already been re-shown, which then collapsed it right back out
                // of view. Only collapse when something that isn't ours holds the
                // foreground.
                if focus_left_the_app(app) {
                    log::info!("[Dock] Panel blurred → collapsing to handle");
                    collapse_drawer(app, &st);
                }
            }
        }
        _ => {}
    });
}

/// Create and show the main window (creating it first if needed).
fn show_main_window(app: &tauri::AppHandle) {
    // In drawer mode the panel is not an ordinary window: it's a topmost strip
    // pinned to a screen edge, and the handle must go away while it's up. Going
    // through expand_drawer keeps every entry point (tray, relaunch, startup)
    // consistent with the handle click. A plain show() here restored the panel
    // without its topmost flag or dock geometry, so it came back underneath the
    // other windows — and left the handle visible alongside it.
    {
        let st = load_dock_state(app);
        if st.enabled && st.mode == "drawer" {
            expand_drawer(app, &st);
            return;
        }
    }
    if let Some(win) = ensure_main_window(app) {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

// ── Workspace dock ─────────────────────────────────────────────────────────
// Workspace Layout. Two modes:
//   • "drawer"  — a slim always-on-top handle sits at the screen edge; clicking
//                 it slides the panel in as a topmost OVERLAY (nothing reflows).
//                 Blur / click-away collapses back to the handle. This is the
//                 default: low-friction, on-demand.
//   • "reserve" — registers a native AppBar (see `dock.rs`) that reserves work
//                 area so maximized apps fit beside the panel. Heavier: apps
//                 reflow on every open/close.
// State lives in its own small config file — same pattern as the autostart
// intent flag — so it never races the sidecar's SyncData writes.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
// `default` lets state files from older builds (which lacked `mode`) upgrade
// gracefully — a missing field falls back to Default instead of failing the
// whole parse and silently resetting the user's dock.
#[serde(rename_all = "camelCase", default)]
struct DockState {
    /// Whether the dock (handle or reserved strip) is active at all.
    enabled: bool,
    /// "drawer" (overlay handle) or "reserve" (AppBar).
    mode: String,
    /// "left", "right", "top" or "bottom". Top/bottom render the horizontal
    /// taskbar-style workspace bar instead of the sidebar panel.
    side: String,
    /// Panel width in logical (CSS) pixels (vertical docks) — converted to
    /// physical pixels via the window's scale factor when applied, so the
    /// panel is the same *visual* size on a 1x display and a 2x Retina one.
    width: u32,
    /// Bar thickness in logical (CSS) pixels (horizontal docks); see `width`.
    bar_height: u32,
}

impl Default for DockState {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: "drawer".to_string(),
            side: "right".to_string(),
            width: 360,
            bar_height: 72,
        }
    }
}

// True while the drawer is collapsed to its edge handle (the handle window is
// the visible dock surface). The fullscreen watcher thread only acts on the
// handle in this state; when it's false the dock is off, in reserve mode, or the
// panel is open, and there's nothing for the watcher to manage. Set here (not
// read from disk) so the watcher's hot loop needs no file I/O.
static DRAWER_COLLAPSED: AtomicBool = AtomicBool::new(false);

const DOCK_MIN_WIDTH: u32 = 220;
const DOCK_MAX_WIDTH: u32 = 900;
const BAR_MIN_HEIGHT: u32 = 40;
const BAR_MAX_HEIGHT: u32 = 220;

/// Converts a logical/CSS pixel size (what `DockState.width`/`bar_height` and
/// the `HANDLE_W`/`HANDLE_H` constants represent) to the physical pixels the
/// window-positioning APIs need. Every monitor geometry value we combine this
/// with (`primary_geom`, `dock::work_area`, `dock::monitor_rect`) is already
/// physical, so skipping this step made the dock panel render at half its
/// intended width on any 2x display — which is every Mac and many Windows
/// HiDPI laptops. At 1x scaling this is a no-op.
fn logical_to_physical(logical_px: i32, scale_factor: f64) -> i32 {
    (logical_px as f64 * scale_factor).round() as i32
}

// Logical-pixel size of the collapsed edge handle (a centered tab; the long
// side runs along the docked edge, so it's rotated for top/bottom docks).
const HANDLE_W: i32 = 22;
const HANDLE_H: i32 = 132;

fn dock_is_horizontal(side: &str) -> bool {
    side == "top" || side == "bottom"
}

/// The edge-appropriate thickness for a dock state: panel width for vertical
/// docks, bar height for horizontal ones.
fn dock_thickness(st: &DockState) -> u32 {
    if dock_is_horizontal(&st.side) { st.bar_height } else { st.width }
}

fn emit_dock_state(app: &tauri::AppHandle, state: &DockState) {
    let _ = app.emit("dock-state-changed", state);
}

fn dock_state_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("dock_state.json"))
}

fn load_dock_state(app: &tauri::AppHandle) -> DockState {
    let Some(path) = dock_state_path(app) else { return DockState::default() };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<DockState>(&s).ok())
        .unwrap_or_default()
}

fn save_dock_state(app: &tauri::AppHandle, state: &DockState) {
    if let Some(path) = dock_state_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(state) {
            let _ = std::fs::write(&path, json);
        }
    }
}

/// Primary monitor geometry in physical pixels: (x, y, width, height).
/// V1 anchors the dock to the primary monitor; multi-monitor targeting is a
/// later step (ties into "move to the cursor's screen").
fn primary_geom(app: &tauri::AppHandle) -> Option<(i32, i32, i32, i32)> {
    let m = app.primary_monitor().ok().flatten()?;
    let p = m.position();
    let s = m.size();
    Some((p.x, p.y, s.width as i32, s.height as i32))
}

// ── Drawer mode ────────────────────────────────────────────────────────────

/// Geometry the drawer lays out against. Horizontal (top/bottom) docks use the
/// monitor *work area* so the bar sits above the Windows taskbar instead of
/// covering it; vertical docks keep the historical full-monitor strip.
fn drawer_geom(app: &tauri::AppHandle, win: &tauri::WebviewWindow, horizontal: bool) -> Option<(i32, i32, i32, i32)> {
    #[cfg(windows)]
    if horizontal {
        if let Ok(hwnd) = win.hwnd() {
            if let Some(geom) = dock::work_area(hwnd.0 as isize) {
                return Some(geom);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (win, horizontal);
    primary_geom(app)
}

/// Slide the panel in: size the main window to a strip at the docked edge
/// (full-height sidebar or full-width bar), make it a borderless topmost
/// overlay, and hide the handle.
fn expand_drawer(app: &tauri::AppHandle, st: &DockState) {
    let horizontal = dock_is_horizontal(&st.side);
    let Some(main) = ensure_main_window(app) else {
        log::error!("[Dock] expand_drawer: no main window");
        return;
    };
    let scale = main.scale_factor().unwrap_or(1.0);
    match drawer_geom(app, &main, horizontal) {
        None => log::error!("[Dock] expand_drawer: no monitor geometry"),
        Some((mx, my, mw, mh)) => {
            let (x, y, w, h) = if horizontal {
                let h = logical_to_physical(st.bar_height.clamp(BAR_MIN_HEIGHT, BAR_MAX_HEIGHT) as i32, scale);
                let y = if st.side == "top" { my } else { my + mh - h };
                // Span the full monitor width (not the work-area width) so the bar
                // reaches both screen edges even when a side taskbar/appbar insets
                // the work area — that inset was leaving a gap + rounded corner on
                // one side. Vertical placement still uses the work area (above), so
                // a bottom taskbar is not covered.
                #[cfg(windows)]
                let (bx, bw) = main
                    .hwnd()
                    .ok()
                    .and_then(|hwnd| dock::monitor_rect(hwnd.0 as isize))
                    .map(|(rx, _, rw, _)| (rx, rw))
                    .unwrap_or((mx, mw));
                #[cfg(not(windows))]
                let (bx, bw) = (mx, mw);
                (bx, y, bw, h)
            } else {
                let w = logical_to_physical(st.width.clamp(DOCK_MIN_WIDTH, DOCK_MAX_WIDTH) as i32, scale);
                let x = if st.side == "left" { mx } else { mx + mw - w };
                (x, my, w, mh)
            };
            let _ = main.set_decorations(false);
            let _ = main.set_resizable(false);
            let _ = main.set_always_on_top(true);
            let _ = main.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w as u32, height: h as u32 }));
            let _ = main.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            // Same reasoning as the handle: a dock/taskbar panel that vanishes
            // when you switch Spaces (or when some other app goes fullscreen)
            // isn't a dock. Undone in `disable_dock` once the window goes back
            // to being a normal per-Space document window. Also clamps a
            // horizontal bar back inside the visible frame so it doesn't end
            // up rendered (and unclickable) underneath the real macOS Dock or
            // menu bar — see `clamp_to_visible_frame`'s doc comment.
            //
            // `expand_drawer` can run off the main thread (`dock_expand` is an
            // async command, dispatched on a tokio worker), but this reaches
            // into the raw NSWindow via objc2 — AppKit asserts/crashes
            // (EXC_BREAKPOINT) if that happens off the main thread. Dispatched
            // after the size/position calls above so `clamp_to_visible_frame`
            // reads the frame they just set.
            #[cfg(target_os = "macos")]
            {
                let main_for_appkit = main.clone();
                let side_for_appkit = st.side.clone();
                let _ = app.run_on_main_thread(move || {
                    dock::allow_over_fullscreen_spaces(&main_for_appkit);
                    if horizontal {
                        dock::clamp_to_visible_frame(&main_for_appkit, &side_for_appkit);
                    }
                });
            }
            let _ = main.show();
            let _ = main.set_focus();
            log::info!("[Dock] Panel expanded on {}: x={x} y={y} w={w} h={h}", st.side);
        }
    }
    if let Some(handle) = app.get_webview_window("handle") {
        let _ = handle.hide();
    }
    // Panel is now the visible surface — the handle isn't, so the fullscreen
    // watcher should stand down.
    DRAWER_COLLAPSED.store(false, Ordering::Relaxed);
}

/// Collapse to the handle: hide the panel, show the slim edge tab (vertical tab
/// on left/right, horizontal tab on top/bottom).
fn collapse_drawer(app: &tauri::AppHandle, st: &DockState) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    let horizontal = dock_is_horizontal(&st.side);
    if let Some(handle) = app.get_webview_window("handle") {
        let scale = handle.scale_factor().unwrap_or(1.0);
        let (handle_w, handle_h) = (logical_to_physical(HANDLE_W, scale), logical_to_physical(HANDLE_H, scale));
        if let Some((mx, my, mw, mh)) = drawer_geom(app, &handle, horizontal) {
            let (x, y, w, h) = if horizontal {
                // Rotated tab: the long side runs along the edge.
                let (w, h) = (handle_h, handle_w);
                let x = mx + (mw - w) / 2;
                let y = if st.side == "top" { my } else { my + mh - h };
                (x, y, w, h)
            } else {
                let x = if st.side == "left" { mx } else { mx + mw - handle_w };
                let y = my + (mh - handle_h) / 2;
                (x, y, handle_w, handle_h)
            };
            let _ = handle.set_always_on_top(true);
            // Windows clamps every top-level window to a minimum tracking size
            // (SM_CXMINTRACK ≈ 136px wide, SM_CYMINTRACK ≈ 39px tall, DPI-scaled)
            // via WM_GETMINMAXINFO. A vertical handle asks for 22px wide, which
            // gets silently forced up to ~136px — turning the slim tab into a fat
            // near-square (and flipping the grip horizontal via handle.html's
            // aspect-ratio safety net). Horizontal docks escape it because their
            // 132px width already clears the floor. Pin the min size to our exact
            // target first so the clamp can't override set_size below.
            let target = tauri::Size::Physical(tauri::PhysicalSize { width: w as u32, height: h as u32 });
            let _ = handle.set_min_size(Some(target.clone()));
            let _ = handle.set_size(target);
            let _ = handle.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            // Without this, the handle stays pinned to whichever Space/virtual
            // desktop (including another app's fullscreen Space) it was last
            // shown on — switch away and it (and the panel it opens) is simply
            // gone until you switch back. Also clamps a horizontal tab back
            // inside the visible frame so it doesn't render underneath the
            // real macOS Dock or menu bar — unclickable, with no other way to
            // re-expand the drawer. macOS-only.
            //
            // Dispatched via `run_on_main_thread`, after the size/position
            // calls above so `clamp_to_visible_frame` reads the frame they
            // just set: this reaches into the raw NSWindow via objc2, which
            // AppKit requires happen on the main thread — some callers (e.g.
            // the fullscreen watcher) invoke `collapse_drawer` off it.
            #[cfg(target_os = "macos")]
            {
                let handle_for_appkit = handle.clone();
                let side_for_appkit = st.side.clone();
                let _ = app.run_on_main_thread(move || {
                    dock::allow_over_fullscreen_spaces(&handle_for_appkit);
                    if horizontal {
                        dock::clamp_to_visible_frame(&handle_for_appkit, &side_for_appkit);
                    }
                });
            }
            let _ = handle.show();
        }
    }
    // Handle is now the visible dock surface — let the watcher hide/show it as
    // fullscreen apps come and go.
    DRAWER_COLLAPSED.store(true, Ordering::Relaxed);
}

/// Turn on drawer mode: persist state and show the handle (collapsed).
/// `thickness` is the panel width for vertical sides, the bar height for
/// top/bottom; the other dimension's stored value is preserved.
///
/// `force_visible`: skip the visibility check below and always expand. Used
/// by the tray's explicit per-layout recovery items — if the app is
/// genuinely stuck (e.g. `main.is_visible()` wrongly reporting hidden), the
/// point of those items is to guarantee the user actually sees the window,
/// not to collapse it to a handle they may not be able to find either.
fn enable_drawer(app: &tauri::AppHandle, side: String, thickness: u32, force_visible: bool) -> DockState {
    let prev = load_dock_state(app);
    let horizontal = dock_is_horizontal(&side);
    let state = DockState {
        enabled: true,
        mode: "drawer".to_string(),
        width: if horizontal { prev.width } else { thickness.clamp(DOCK_MIN_WIDTH, DOCK_MAX_WIDTH) },
        bar_height: if horizontal { thickness.clamp(BAR_MIN_HEIGHT, BAR_MAX_HEIGHT) } else { prev.bar_height },
        side,
    };
    save_dock_state(app, &state);
    // Turning the drawer *on* from a window the user is currently looking at is a
    // layout switch, not a dismissal: slide straight into the new edge instead of
    // hiding the panel down to the handle. Hiding it here also raced the blur
    // handler, which is how "release to full window, then go back to the side
    // dock" used to end up with no panel at all — just the edge tab.
    let visible = force_visible
        || app
            .get_webview_window("main")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
    if visible {
        expand_drawer(app, &state);
    } else {
        collapse_drawer(app, &state);
    }
    state
}

// ── Reserve mode (AppBar) ──────────────────────────────────────────────────

/// Register the AppBar and dock the main window into the reserved strip.
/// `thickness` is the panel width for vertical sides, the bar height for
/// top/bottom.
fn apply_dock(app: &tauri::AppHandle, side: String, thickness: u32) -> Result<DockState, String> {
    let horizontal = dock_is_horizontal(&side);
    let thickness = if horizontal {
        thickness.clamp(BAR_MIN_HEIGHT, BAR_MAX_HEIGHT)
    } else {
        thickness.clamp(DOCK_MIN_WIDTH, DOCK_MAX_WIDTH)
    };
    let prev = load_dock_state(app);
    let state = DockState {
        enabled: true,
        mode: "reserve".to_string(),
        side: side.clone(),
        width: if horizontal { prev.width } else { thickness },
        bar_height: if horizontal { thickness } else { prev.bar_height },
    };

    #[cfg(windows)]
    {
        // The handle is a drawer concept — make sure it's hidden in reserve mode.
        DRAWER_COLLAPSED.store(false, Ordering::Relaxed);
        if let Some(handle) = app.get_webview_window("handle") {
            let _ = handle.hide();
        }
        let window = ensure_main_window(app)
            .ok_or_else(|| "main window not found".to_string())?;
        let _ = window.set_decorations(false);
        let _ = window.set_resizable(false);
        let scale = window.scale_factor().unwrap_or(1.0);
        let physical_thickness = logical_to_physical(thickness as i32, scale);
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (x, y, cx, cy) = dock::set_dock(hwnd, &side, physical_thickness)?;
        log::info!(
            "[Dock] Reserved strip: x={x} y={y} w={cx} h={cy} (side={side}, thickness={thickness})"
        );
        let _ = window.show();
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        return Err("Reserve mode is only supported on Windows".to_string());
    }

    save_dock_state(app, &state);
    Ok(state)
}

/// Turn the dock off entirely: release any AppBar, hide the handle, and restore
/// the main window to a normal decorated, centered window.
fn disable_dock(app: &tauri::AppHandle) -> DockState {
    #[cfg(windows)]
    dock::remove_dock();

    DRAWER_COLLAPSED.store(false, Ordering::Relaxed);
    if let Some(handle) = app.get_webview_window("handle") {
        let _ = handle.hide();
    }
    if let Some(window) = ensure_main_window(app) {
        let _ = window.set_always_on_top(false);
        // Raw NSWindow access via objc2 — must run on the main thread, see
        // `expand_drawer`'s equivalent call for why.
        #[cfg(target_os = "macos")]
        {
            let window_for_appkit = window.clone();
            let _ = app.run_on_main_thread(move || dock::restrict_to_current_space(&window_for_appkit));
        }
        let _ = window.set_decorations(true);
        let _ = window.set_resizable(true);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1400.0, height: 900.0 }));
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
    }

    let mut state = load_dock_state(app);
    state.enabled = false;
    save_dock_state(app, &state);
    state
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
fn dock_get_state(app: tauri::AppHandle) -> DockState {
    load_dock_state(&app)
}

// Async for the same reason as `dock_expand`: reserve mode docks the main
// window, which may still need building.
#[tauri::command(rename_all = "snake_case")]
async fn dock_enable(
    app: tauri::AppHandle,
    side: Option<String>,
    width: Option<u32>,
    mode: Option<String>,
) -> Result<DockState, String> {
    let prev = load_dock_state(&app);
    let side = match side.as_deref() {
        Some("left") => "left".to_string(),
        Some("right") => "right".to_string(),
        Some("top") => "top".to_string(),
        Some("bottom") => "bottom".to_string(),
        _ => prev.side.clone(),
    };
    // `width` is the thickness of the requested edge; default to the stored
    // value for that orientation, not the other one's.
    let thickness = width.unwrap_or(if dock_is_horizontal(&side) { prev.bar_height } else { prev.width });
    let mode = mode.unwrap_or(prev.mode);
    let state = if mode == "reserve" {
        apply_dock(&app, side, thickness)?
    } else {
        enable_drawer(&app, side, thickness, false)
    };
    emit_dock_state(&app, &state);
    Ok(state)
}

#[tauri::command]
fn dock_disable(app: tauri::AppHandle) -> DockState {
    let state = disable_dock(&app);
    emit_dock_state(&app, &state);
    state
}

/// Slide the drawer panel in (called by the handle window's click, the tray, or
/// the frontend). No-op if the dock isn't in drawer mode.
///
/// `async` on purpose: a sync command runs on the main thread *inside* the event
/// loop, and if the panel still has to be built (headless autostart, before the
/// pre-warm lands) `WebviewWindowBuilder::build` blocks that loop waiting for
/// WebView2 — a deadlock. Off the main thread the build is proxied instead, so
/// the loop stays free to service it.
#[tauri::command]
async fn dock_expand(app: tauri::AppHandle) -> DockState {
    let st = load_dock_state(&app);
    if st.enabled && st.mode == "drawer" {
        expand_drawer(&app, &st);
    }
    st
}

/// Collapse the drawer panel back to the handle.
#[tauri::command]
fn dock_collapse(app: tauri::AppHandle) -> DockState {
    let st = load_dock_state(&app);
    if st.enabled && st.mode == "drawer" {
        collapse_drawer(&app, &st);
    }
    st
}

/// Resize the docked edge: sets the panel width for vertical docks, the bar
/// height for horizontal ones.
#[tauri::command(rename_all = "snake_case")]
fn dock_set_width(app: tauri::AppHandle, width: u32) -> Result<DockState, String> {
    let mut state = load_dock_state(&app);
    if dock_is_horizontal(&state.side) {
        state.bar_height = width.clamp(BAR_MIN_HEIGHT, BAR_MAX_HEIGHT);
    } else {
        state.width = width.clamp(DOCK_MIN_WIDTH, DOCK_MAX_WIDTH);
    }
    save_dock_state(&app, &state);

    if state.enabled {
        if state.mode == "reserve" {
            let state = apply_dock(&app, state.side.clone(), dock_thickness(&state))?;
            emit_dock_state(&app, &state);
            return Ok(state);
        }
        // Drawer: if the panel is currently open, re-lay it out at the new size.
        if let Some(main) = app.get_webview_window("main") {
            if main.is_visible().unwrap_or(false) {
                expand_drawer(&app, &state);
            }
        }
    }
    emit_dock_state(&app, &state);
    Ok(state)
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    current: String,
    latest: String,
    has_update: bool,
    notes_url: String,
}

const GITHUB_LATEST: &str =
    "https://api.github.com/repos/abhayraghuwanshi/cooldesk-extension/releases/latest";
const ANALYTICS_ENDPOINT: &str =
    "https://cooldesk-analytics.raghuwanshi-abhay405.workers.dev/api/version";

// Distribution channel, stamped at build time by the release workflow
// (winget / github / dmg). Defaults to "unknown" for local/dev builds.
fn install_source() -> &'static str {
    option_env!("COOLDESK_INSTALL_SOURCE").unwrap_or("unknown")
}

// Anonymous, randomly-generated install identifier. Created once and persisted
// in the app config dir; contains no personal data. Used only to count distinct
// installs / daily-active installs. Returns an empty string if it can't be
// persisted, in which case analytics simply degrades — never an error.
fn get_or_create_install_id(app: &tauri::AppHandle) -> String {
    let path = match app.path().app_config_dir() {
        Ok(dir) => dir.join("install_id"),
        Err(_) => return String::new(),
    };
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, &id);
    id
}

// The anonymous usage payload: 7 scalar fields, no free text. Never includes
// search queries, URLs, or any user content.
fn analytics_payload(
    app: &tauri::AppHandle,
    current: &str,
    spotlight_opens: u32,
    locale: Option<String>,
) -> serde_json::Value {
    serde_json::json!({
        "install_id": get_or_create_install_id(app),
        "os": std::env::consts::OS,
        "app_version": current,
        "install_source": install_source(),
        "locale": locale.unwrap_or_default(),
        "spotlight_opens": spotlight_opens,
    })
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
    }
}

/// Detection only: compares the running version against the latest GitHub
/// release tag. The actual update is performed by `run_winget_upgrade` so we
/// never silently overwrite a winget-managed install.
///
/// Doubles as the anonymous usage heartbeat: unless `analytics_enabled` is
/// `Some(false)`, the version check is routed through our own endpoint, which
/// records the ping and proxies the GitHub release back. If that endpoint fails
/// (offline, not yet deployed, opted out), it falls back to querying GitHub
/// directly — so the update check is never broken by analytics.
#[tauri::command]
async fn check_winget_update(
    app: tauri::AppHandle,
    analytics_enabled: Option<bool>,
    spotlight_opens: Option<u32>,
    locale: Option<String>,
) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let client = reqwest::Client::new();

    // Preferred path: route through our endpoint so the ping is recorded.
    if analytics_enabled != Some(false) {
        let payload = analytics_payload(&app, &current, spotlight_opens.unwrap_or(0), locale);
        let attempt = client
            .post(ANALYTICS_ENDPOINT)
            .header("User-Agent", "CoolDesk")
            .json(&payload)
            .send()
            .await
            .and_then(|r| r.error_for_status());
        if let Ok(resp) = attempt {
            if let Ok(release) = resp.json::<serde_json::Value>().await {
                return Ok(parse_update_info(current, &release));
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

/// Launches `winget upgrade` for this package in a new console window so the
/// user can see progress. winget replaces the app and relaunches it.
#[tauri::command]
fn run_winget_upgrade() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("winget")
            .args([
                "upgrade",
                "--id",
                "cool-products.CoolDesk",
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

#[tauri::command]
async fn get_running_apps(_app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return Ok(serde_json::json!([]));

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

        // Run the scan in-process: no sidecar EXEs spawned.
        let scan_output = tokio::task::spawn_blocking(|| scanner::scan_apps())
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
async fn focus_window(_app: tauri::AppHandle, pid: u32, name: Option<String>, hwnd: Option<i64>) -> Result<(), String> {
    let hwnd_opt = hwnd.filter(|&h| h != 0).map(|h| h as isize);
    let name_ref = name.as_deref();

    focus::focus_window(hwnd_opt, Some(pid), name_ref)
        .map_err(|e| e.to_string())
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
                let window_for_appkit = window.clone();
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
        std::process::Command::new("open")
            .arg(&open_path)
            .spawn()
            .map_err(|e| e.to_string())?;
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
            format!("cd {} && {}", dir, command)
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
            format!("cd '{}' && {}", dir, command)
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
    #[cfg(not(target_os = "windows"))]
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
async fn search_files(query: String) -> Result<Vec<SearchFileResult>, String> {
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
        for path in output_str.lines().filter(|s| !s.is_empty()).take(15) {
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
        let _ = &targets;
        final_results.truncate(15);
        Ok(final_results)
    }
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
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec![ARG_AUTOSTART]),
    ))
    .invoke_handler(tauri::generate_handler![
        get_running_apps,
        get_installed_apps,
        categorize_app,
        focus_window,
        close_app,
        list_window_tabs,
        focus_window_tab,
        folder_display_name,
        toggle_spotlight,
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
        get_user_places,
        get_focused_app,
        get_app_version,
        set_launch_at_login,
        get_launch_at_login,
        check_winget_update,
        run_winget_upgrade,
        kill_process_on_port,
        list_listening_ports,
        kill_process,
        dock_enable,
        dock_disable,
        dock_expand,
        dock_collapse,
        dock_set_width,
        dock_get_state,
        ai_cli::ai_cli_run,
        ai_cli::ai_cli_cancel,
        ai_cli::ai_cli_detect,
        save_backup,
        get_backups_dir,
        list_backups,
        read_backup,
        delete_backup
    ])
    .setup(|app| {
      // No instance was running, so `--quit` reached us as the primary. Exit
      // before spawning the sidecar or a window — otherwise the uninstaller's
      // shutdown request would leave a brand-new process running.
      if quit_requested(&std::env::args().collect::<Vec<_>>()) {
        log::info!("[Startup] --quit with no running instance; exiting");
        app.handle().exit(0);
        return Ok(());
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

      // Re-apply the workspace dock if the user left it enabled. Windows are
      // already created by the time setup runs.
      //
      // When it takes over, the dock owns the main window's visibility for the
      // rest of startup — the plain show below must not fight it.
      let dock_owns_window = {
          let app_handle = app.handle();
          let dock_state = load_dock_state(app_handle);
          if dock_state.enabled {
              if dock_state.mode == "reserve" {
                  if let Err(e) = apply_dock(app_handle, dock_state.side.clone(), dock_thickness(&dock_state)) {
                      log::warn!("[Dock] Failed to re-apply reserve dock on startup: {}", e);
                  }
              } else {
                  // Drawer: start collapsed, showing only the handle.
                  collapse_drawer(app_handle, &dock_state);
                  log::info!("[Dock] Restored drawer handle on startup ({})", dock_state.side);
              }
              true
          } else {
              false
          }
      };

      // Fullscreen watcher: the drawer handle is a plain topmost window, so —
      // unlike an AppBar — the shell never tells it to hide for a fullscreen app,
      // leaving it floating over games/videos at the (now auto-hidden) taskbar
      // row. Poll the foreground window and hide the handle while a fullscreen app
      // holds it, restoring it afterwards. Gated on DRAWER_COLLAPSED so the loop
      // does nothing (and touches no disk) unless the handle is actually showing.
      #[cfg(windows)]
      {
          let app_handle = app.handle().clone();
          std::thread::spawn(move || {
              let mut hidden_for_fullscreen = false;
              loop {
                  std::thread::sleep(std::time::Duration::from_millis(600));
                  if !DRAWER_COLLAPSED.load(Ordering::Relaxed) {
                      hidden_for_fullscreen = false;
                      continue;
                  }
                  let Some(handle) = app_handle.get_webview_window("handle") else { continue };
                  let fullscreen = dock::foreground_is_fullscreen();
                  if fullscreen {
                      if !hidden_for_fullscreen {
                          let _ = handle.hide();
                          hidden_for_fullscreen = true;
                      }
                      continue;
                  }

                  // Not fullscreen, and the drawer is collapsed — so the handle
                  // is the dock's only surface and it must be on screen. Assert
                  // that every tick rather than only undoing our own hide: an
                  // app that goes topmost buries the tab in the topmost band,
                  // and whatever hid it (a stale hide, a display change) would
                  // otherwise leave the dock simply gone until the next tray
                  // click. SetWindowPos here is SWP_NOACTIVATE, so re-asserting
                  // steals no focus and doesn't flicker.
                  let _ = handle.set_always_on_top(true);
                  if !handle.is_visible().unwrap_or(true) {
                      let _ = handle.show();
                  }
                  hidden_for_fullscreen = false;
              }
          });
      }

      // Main window. Launched by hand (or by the installer's "run now"), the user
      // asked to see it — build and show it straight away. Launched at login, stay
      // headless in the tray and pre-warm the webview once the login storm has
      // settled, so the first tray click is still instant.
      //
      // The dock restore above may already have created it (reserve mode docks the
      // main window); ensure_main_window is idempotent, so this is safe either way.
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
      } else if dock_owns_window {
          // The dock decides when the panel is *shown*, but it must still exist
          // by the time the handle is clicked. Building it lazily from inside
          // `dock_expand` deadlocks: sync commands run on the main thread, and
          // `WebviewWindowBuilder::build` needs that event loop free to pump
          // WebView2 creation messages. Create it hidden here, during setup,
          // where the loop isn't blocked; expand_drawer then only shows it.
          let _ = ensure_main_window(app.handle());
      } else {
          show_main_window(app.handle());
      }

      // System tray icon — lets users show/hide the window and quit cleanly.
      // The three "layout_*" items exist specifically as an always-reachable
      // recovery path: if the window ends up stuck (wrong layout, off-screen,
      // occluded — a docked panel/handle rendered behind the real macOS Dock
      // was one real case of this), the in-app layout controls live inside
      // that same possibly-unreachable window. The tray icon doesn't, so each
      // layout gets its own explicit, unambiguous entry here rather than a
      // single toggle whose effect depends on state the user may not be able
      // to see.
      let show_item = MenuItem::with_id(app, "show", "Show CoolDesk", true, None::<&str>)?;
      let full_item = MenuItem::with_id(app, "layout_full", "Full Window", true, None::<&str>)?;
      let side_item = MenuItem::with_id(app, "layout_side", "Side Dock", true, None::<&str>)?;
      let bar_item = MenuItem::with_id(app, "layout_bar", "Bottom Bar", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let sep1 = tauri::menu::PredefinedMenuItem::separator(app)?;
      let sep2 = tauri::menu::PredefinedMenuItem::separator(app)?;
      let tray_menu = Menu::with_items(
          app,
          &[&show_item, &sep1, &full_item, &side_item, &bar_item, &sep2, &quit_item],
      )?;

      TrayIconBuilder::new()
          .icon(app.default_window_icon().unwrap().clone())
          .menu(&tray_menu)
          .tooltip("CoolDesk")
          .on_menu_event(|app, event| match event.id.as_ref() {
              "show" => {
                  // In drawer mode, "show" means slide the panel in.
                  let st = load_dock_state(app);
                  if st.enabled && st.mode == "drawer" {
                      expand_drawer(app, &st);
                  } else {
                      show_main_window(app);
                  }
              }
              "layout_full" => {
                  let state = disable_dock(app);
                  emit_dock_state(app, &state);
              }
              "layout_side" => {
                  let prev = load_dock_state(app);
                  // Preserve whichever vertical edge was last used; default to
                  // right the same way the in-app layout cycle does.
                  let side = if prev.side == "left" { "left" } else { "right" }.to_string();
                  let state = enable_drawer(app, side, prev.width, true);
                  emit_dock_state(app, &state);
              }
              "layout_bar" => {
                  let prev = load_dock_state(app);
                  let state = enable_drawer(app, "bottom".to_string(), prev.bar_height, true);
                  emit_dock_state(app, &state);
              }
              "quit" => {
                  app.exit(0);
              }
              _ => {}
          })
          .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent| {
              if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                  let app = tray.app_handle();
                  let st = load_dock_state(app);
                  // `is_visible` on a not-yet-created window is treated as
                  // hidden, so a headless autostart falls through to "open it".
                  let visible = app
                      .get_webview_window("main")
                      .and_then(|w| w.is_visible().ok())
                      .unwrap_or(false);
                  if st.enabled && st.mode == "drawer" {
                      // Drawer: toggle the panel open/closed.
                      if visible {
                          collapse_drawer(app, &st);
                      } else {
                          expand_drawer(app, &st);
                      }
                  } else if visible {
                      if let Some(window) = app.get_webview_window("main") {
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
      app.global_shortcut().on_shortcut(startup_shortcut.as_str(), move |_app, _shortcut, event| {
          if event.state == ShortcutState::Pressed {
              toggle_spotlight(handle.clone());
          }
      }).map_err(|e| format!("Failed to register shortcut '{}': {}", startup_shortcut, e))?;

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
          dock::promote_spotlight_over_fullscreen_spaces(&spotlight);
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
            // Release any AppBar reservation so we don't leave a reserved strip
            // behind (no-op if reserve mode was never active this run).
            dock::remove_dock();
        }
    });
}

