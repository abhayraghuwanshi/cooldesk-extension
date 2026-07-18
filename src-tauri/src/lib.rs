use tauri::{Manager, Emitter};
use tauri_plugin_autostart::ManagerExt;
use std::sync::{Arc, RwLock};
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

fn read_autostart_intent(app: &tauri::AppHandle) -> Option<bool> {
    let path = autostart_flag_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Some(s.trim() == "1"),
        Err(_) => None,
    }
}

fn write_autostart_intent(app: &tauri::AppHandle, enabled: bool) {
    if let Some(path) = autostart_flag_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, if enabled { "1" } else { "0" });
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
    /// Panel width in physical pixels (vertical docks).
    width: u32,
    /// Bar thickness in physical pixels (horizontal docks).
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

const DOCK_MIN_WIDTH: u32 = 220;
const DOCK_MAX_WIDTH: u32 = 900;
const BAR_MIN_HEIGHT: u32 = 40;
const BAR_MAX_HEIGHT: u32 = 220;
// Physical-pixel size of the collapsed edge handle (a centered tab; the long
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
    if let Some(main) = app.get_webview_window("main") {
        if let Some((mx, my, mw, mh)) = drawer_geom(app, &main, horizontal) {
            let (x, y, w, h) = if horizontal {
                let h = st.bar_height.clamp(BAR_MIN_HEIGHT, BAR_MAX_HEIGHT) as i32;
                let y = if st.side == "top" { my } else { my + mh - h };
                (mx, y, mw, h)
            } else {
                let w = st.width.clamp(DOCK_MIN_WIDTH, DOCK_MAX_WIDTH) as i32;
                let x = if st.side == "left" { mx } else { mx + mw - w };
                (x, my, w, mh)
            };
            let _ = main.set_decorations(false);
            let _ = main.set_resizable(false);
            let _ = main.set_always_on_top(true);
            let _ = main.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w as u32, height: h as u32 }));
            let _ = main.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
    if let Some(handle) = app.get_webview_window("handle") {
        let _ = handle.hide();
    }
}

/// Collapse to the handle: hide the panel, show the slim edge tab (vertical tab
/// on left/right, horizontal tab on top/bottom).
fn collapse_drawer(app: &tauri::AppHandle, st: &DockState) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    let horizontal = dock_is_horizontal(&st.side);
    if let Some(handle) = app.get_webview_window("handle") {
        if let Some((mx, my, mw, mh)) = drawer_geom(app, &handle, horizontal) {
            let (x, y, w, h) = if horizontal {
                // Rotated tab: the long side runs along the edge.
                let (w, h) = (HANDLE_H, HANDLE_W);
                let x = mx + (mw - w) / 2;
                let y = if st.side == "top" { my } else { my + mh - h };
                (x, y, w, h)
            } else {
                let x = if st.side == "left" { mx } else { mx + mw - HANDLE_W };
                let y = my + (mh - HANDLE_H) / 2;
                (x, y, HANDLE_W, HANDLE_H)
            };
            let _ = handle.set_always_on_top(true);
            let _ = handle.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w as u32, height: h as u32 }));
            let _ = handle.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            let _ = handle.show();
        }
    }
}

/// Turn on drawer mode: persist state and show the handle (collapsed).
/// `thickness` is the panel width for vertical sides, the bar height for
/// top/bottom; the other dimension's stored value is preserved.
fn enable_drawer(app: &tauri::AppHandle, side: String, thickness: u32) -> DockState {
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
    collapse_drawer(app, &state);
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
        if let Some(handle) = app.get_webview_window("handle") {
            let _ = handle.hide();
        }
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?;
        let _ = window.set_decorations(false);
        let _ = window.set_resizable(false);
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (x, y, cx, cy) = dock::set_dock(hwnd, &side, thickness as i32)?;
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

    if let Some(handle) = app.get_webview_window("handle") {
        let _ = handle.hide();
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(false);
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

#[tauri::command(rename_all = "snake_case")]
fn dock_enable(
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
        enable_drawer(&app, side, thickness)
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
#[tauri::command]
fn dock_expand(app: tauri::AppHandle) -> DockState {
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
    // Use native Rust implementation instead of shelling out to AppFocus.exe
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

#[tauri::command]
fn toggle_spotlight(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("spotlight") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            // Get cursor position to find the active monitor
            #[cfg(target_os = "windows")]
            let cursor_pos: Option<(i32, i32)> = {
                let mut pt = windows::Win32::Foundation::POINT::default();
                if unsafe { windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut pt) }.is_ok() {
                    Some((pt.x, pt.y))
                } else {
                    None
                }
            };
            #[cfg(target_os = "macos")]
            let cursor_pos: Option<(i32, i32)> = {
                use core_graphics::event::CGEvent;
                use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
                CGEventSource::new(CGEventSourceStateID::HIDSystemState).ok().and_then(|src| {
                    CGEvent::new(src).ok().map(|e| {
                        let loc = e.location();
                        (loc.x as i32, loc.y as i32)
                    })
                })
            };
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let cursor_pos: Option<(i32, i32)> = None;

            // Find which monitor contains this cursor point
            let monitors = app.available_monitors().unwrap_or_default();
            let target_monitor = if let Some((cx, cy)) = cursor_pos {
                monitors.into_iter().find(|m| {
                    let pos = m.position();
                    let size = m.size();
                    cx >= pos.x && cx < pos.x + size.width as i32 &&
                    cy >= pos.y && cy < pos.y + size.height as i32
                }).or_else(|| app.primary_monitor().ok().flatten())
            } else {
                app.primary_monitor().ok().flatten()
            };

            if let Some(monitor) = target_monitor {
                let m_pos = monitor.position();
                let m_size = monitor.size();

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

            let _ = window.show();
            let _ = window.set_focus();
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

#[derive(serde::Serialize)]
pub struct SearchFileResult {
    pub path: String,
    pub date: String,
    pub is_dir: bool,
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
            results.push(SearchFileResult { path: path.to_string_lossy().into_owned(), date: date_str, is_dir });
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
                final_results.push(SearchFileResult { path, date: date_str, is_dir: true });
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
                final_results.push(SearchFileResult { path: path.to_string(), date: date_str, is_dir });
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
        if name.starts_with('.') { continue; } // skip hidden/system dotfiles
        let p = entry.path();
        let is_dir = p.is_dir();
        let date_str = entry.metadata().ok()
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.format("%Y-%m-%d %H:%M").to_string()
            })
            .unwrap_or_default();
        let r = SearchFileResult { path: p.to_string_lossy().into_owned(), date: date_str, is_dir };
        if is_dir { dirs_out.push(r) } else { files_out.push(r) }
    }
    // Folders first, each group sorted case-insensitively by name.
    dirs_out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    files_out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    dirs_out.extend(files_out);
    dirs_out.truncate(300);
    Ok(dirs_out)
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
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // When a second instance is launched, show the main window of the first
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }))
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
    .invoke_handler(tauri::generate_handler![
        get_running_apps,
        get_installed_apps,
        categorize_app,
        focus_window,
        close_app,
        list_window_tabs,
        focus_window_tab,
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
        get_frequent_folders,
        search_files,
        list_dir,
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
        dock_get_state
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

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
              }
          }
      }

      // Check for updates in the background on startup
      let update_handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
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
      {
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
          }
      }

      // Main window events: hide-on-close, and (in drawer mode) collapse to the
      // handle when the panel loses focus — the "click away to hide" behavior.
      if let Some(main_window) = app.get_webview_window("main") {
          let win = main_window.clone();
          main_window.on_window_event(move |event| {
              match event {
                  tauri::WindowEvent::CloseRequested { api, .. } => {
                      api.prevent_close();
                      let _ = win.hide();
                  }
                  tauri::WindowEvent::Focused(false) => {
                      let app = win.app_handle();
                      let st = load_dock_state(app);
                      if st.enabled && st.mode == "drawer" && win.is_visible().unwrap_or(false) {
                          collapse_drawer(app, &st);
                      }
                  }
                  _ => {}
              }
          });
      }

      // System tray icon — lets users show/hide the window and quit cleanly
      let show_item = MenuItem::with_id(app, "show", "Show CoolDesk", true, None::<&str>)?;
      let dock_item = MenuItem::with_id(app, "toggle_dock", "Toggle Workspace Dock", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let tray_menu = Menu::with_items(app, &[&show_item, &dock_item, &quit_item])?;

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
                  } else if let Some(window) = app.get_webview_window("main") {
                      let _ = window.show();
                      let _ = window.set_focus();
                  }
              }
              "toggle_dock" => {
                  // Toggle the drawer handle on/off.
                  let state = load_dock_state(app);
                  let new_state = if state.enabled {
                      disable_dock(app)
                  } else {
                      enable_drawer(app, state.side.clone(), dock_thickness(&state))
                  };
                  emit_dock_state(app, &new_state);
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
                  if st.enabled && st.mode == "drawer" {
                      // Drawer: toggle the panel open/closed.
                      if let Some(window) = app.get_webview_window("main") {
                          if window.is_visible().unwrap_or(false) {
                              collapse_drawer(app, &st);
                          } else {
                              expand_drawer(app, &st);
                          }
                      }
                  } else if let Some(window) = app.get_webview_window("main") {
                      if window.is_visible().unwrap_or(false) {
                          let _ = window.hide();
                      } else {
                          let _ = window.show();
                          let _ = window.set_focus();
                      }
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

