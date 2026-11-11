// Dock surfaces — the sidebar and the dock bar, each a window of its own.
//
// CoolDesk used to have one window that changed shape: the full app, a side
// dock, or a bottom bar, cycled by a layout button. Now the three are
// separate, like the spotlight already was:
//
//   • "main"     — the full app. Always an ordinary window; never docked.
//   • "sidebar"  — a panel pinned to the left/right edge, with its own
//                  collapsed edge handle ("sidebar-handle").
//   • "bar"      — the taskbar-style workspace bar on the bottom/top edge,
//                  with its own handle ("bar-handle").
//
// The sidebar and the bar are toggled independently (Settings → Windows, or
// the tray), so either, both or neither can be on. Each panel window loads
// the same `pages/index.html` as the main window; the page picks its layout
// from its own window label (`src/features/dock/surface.js`).
//
// Each surface runs in one of two modes:
//   • "drawer"  — a slim always-on-top handle sits at the screen edge; hovering
//                 or clicking it slides the panel in as a topmost OVERLAY
//                 (nothing reflows). Blur / cursor-leave collapses it back.
//   • "reserve" — Windows only: registers a native AppBar (see `dock.rs`) so
//                 maximized apps fit beside the panel.
//
// State lives in its own small config file — same pattern as the autostart
// intent flag — so it never races the sidecar's SyncData writes.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::dock;

// ── Surfaces ───────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Surface {
    Sidebar,
    Bar,
}

pub const ALL: [Surface; 2] = [Surface::Sidebar, Surface::Bar];

impl Surface {
    fn idx(self) -> usize {
        self as usize
    }

    /// Label of the panel window (also the page's own surface name).
    pub fn panel_label(self) -> &'static str {
        match self {
            Surface::Sidebar => "sidebar",
            Surface::Bar => "bar",
        }
    }

    /// Label of the collapsed edge handle (declared in tauri.conf.json).
    pub fn handle_label(self) -> &'static str {
        match self {
            Surface::Sidebar => "sidebar-handle",
            Surface::Bar => "bar-handle",
        }
    }

    /// The bar runs along a top/bottom edge; the sidebar along left/right.
    fn horizontal(self) -> bool {
        self == Surface::Bar
    }

    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "sidebar" => Ok(Surface::Sidebar),
            "bar" => Ok(Surface::Bar),
            other => Err(format!("unknown dock surface: {other}")),
        }
    }

    /// The edge a requested side resolves to: each surface only accepts its
    /// own two edges, anything else falls back to `current`.
    fn normalize_side(self, requested: Option<&str>, current: &str) -> String {
        let valid: [&str; 2] = match self {
            Surface::Sidebar => ["left", "right"],
            Surface::Bar => ["bottom", "top"],
        };
        match requested {
            Some(s) if valid.contains(&s) => s.to_string(),
            _ if valid.contains(&current) => current.to_string(),
            _ => valid[if self == Surface::Sidebar { 1 } else { 0 }].to_string(),
        }
    }

    fn clamp_size(self, size: u32) -> u32 {
        match self {
            Surface::Sidebar => size.clamp(DOCK_MIN_WIDTH, DOCK_MAX_WIDTH),
            Surface::Bar => size.clamp(BAR_MIN_HEIGHT, BAR_MAX_HEIGHT),
        }
    }
}

// ── State ──────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct SurfaceState {
    /// Whether this surface (handle or reserved strip) is active at all.
    pub enabled: bool,
    /// "drawer" (overlay handle) or "reserve" (AppBar, Windows only).
    pub mode: String,
    /// Sidebar: "left"/"right". Bar: "bottom"/"top".
    pub side: String,
    /// Sidebar width / bar height, in logical (CSS) pixels — converted to
    /// physical pixels via the window's scale factor when applied, so the
    /// panel is the same *visual* size on a 1x display and a 2x Retina one.
    pub size: u32,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct DockState {
    pub sidebar: SurfaceState,
    pub bar: SurfaceState,
}

impl Default for DockState {
    fn default() -> Self {
        Self {
            sidebar: SurfaceState { enabled: false, mode: "drawer".into(), side: "right".into(), size: 320 },
            bar: SurfaceState { enabled: false, mode: "drawer".into(), side: "bottom".into(), size: 72 },
        }
    }
}

impl Default for SurfaceState {
    fn default() -> Self {
        DockState::default().sidebar
    }
}

impl DockState {
    pub fn get(&self, s: Surface) -> &SurfaceState {
        match s {
            Surface::Sidebar => &self.sidebar,
            Surface::Bar => &self.bar,
        }
    }

    fn get_mut(&mut self, s: Surface) -> &mut SurfaceState {
        match s {
            Surface::Sidebar => &mut self.sidebar,
            Surface::Bar => &mut self.bar,
        }
    }
}

/// The single-window dock state older builds wrote to `dock_state.json`:
/// one dock, whose `side` decided whether it was the sidebar or the bar.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct LegacyDockState {
    enabled: bool,
    mode: String,
    side: String,
    width: u32,
    bar_height: u32,
}

impl Default for LegacyDockState {
    fn default() -> Self {
        Self { enabled: false, mode: "drawer".into(), side: "right".into(), width: 360, bar_height: 72 }
    }
}

impl From<LegacyDockState> for DockState {
    fn from(old: LegacyDockState) -> Self {
        let mut st = DockState::default();
        st.sidebar.size = Surface::Sidebar.clamp_size(old.width);
        st.bar.size = Surface::Bar.clamp_size(old.bar_height);
        let target = if old.side == "top" || old.side == "bottom" { Surface::Bar } else { Surface::Sidebar };
        let s = st.get_mut(target);
        s.enabled = old.enabled;
        s.mode = old.mode;
        s.side = old.side;
        st
    }
}

/// Serializes read-modify-write of the state file: the two surfaces are
/// changed from different threads (commands, tray, watchers) and must not
/// clobber each other's half.
static STATE_LOCK: Mutex<()> = Mutex::new(());

fn state_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("dock_surfaces.json"))
}

fn legacy_state_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("dock_state.json"))
}

pub fn load_state(app: &tauri::AppHandle) -> DockState {
    let Some(path) = state_path(app) else { return DockState::default() };
    if let Ok(s) = std::fs::read_to_string(&path) {
        return serde_json::from_str::<DockState>(&s).unwrap_or_default();
    }
    // First run after the split: carry the old single dock over to whichever
    // surface it was (a docked sidebar stays a sidebar, a bar stays a bar).
    let migrated = legacy_state_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<LegacyDockState>(&s).ok())
        .map(DockState::from);
    match migrated {
        Some(st) => {
            log::info!("[Dock] Migrated legacy dock_state.json → dock_surfaces.json: {st:?}");
            write_state(app, &st);
            st
        }
        None => DockState::default(),
    }
}

fn write_state(app: &tauri::AppHandle, state: &DockState) {
    if let Some(path) = state_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(state) {
            let _ = std::fs::write(&path, json);
        }
    }
}

/// Apply `f` to one surface's stored state and persist it. Returns the
/// updated surface state.
fn update_surface(app: &tauri::AppHandle, s: Surface, f: impl FnOnce(&mut SurfaceState)) -> SurfaceState {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load_state(app);
    f(all.get_mut(s));
    write_state(app, &all);
    all.get(s).clone()
}

fn surface_state(app: &tauri::AppHandle, s: Surface) -> SurfaceState {
    load_state(app).get(s).clone()
}

/// Broadcast the full state to every page (main, panels, handles) and keep
/// the tray's check marks in step.
pub fn emit_state(app: &tauri::AppHandle) {
    let st = load_state(app);
    if let Some(tray) = app.try_state::<TrayChecks>() {
        let _ = tray.sidebar.set_checked(st.sidebar.enabled);
        let _ = tray.bar.set_checked(st.bar.enabled);
    }
    let _ = app.emit("dock-state-changed", &st);
}

// ── Runtime flags ──────────────────────────────────────────────────────────

const fn flags() -> [AtomicBool; 2] {
    [AtomicBool::new(false), AtomicBool::new(false)]
}

// True while a surface's drawer is collapsed to its edge handle (the handle
// window is that surface's visible dock surface). The fullscreen and hover
// watchers only act on a handle in this state. Set here (not read from disk)
// so the watchers' hot loops need no file I/O.
static COLLAPSED: [AtomicBool; 2] = flags();

// True while a surface's drawer is enabled and showing (either its panel or
// its handle). Gates the monitor re-anchor watcher so it doesn't read the
// state file every tick while both surfaces are off.
static ACTIVE: [AtomicBool; 2] = flags();

// True while a surface's panel/handle should keep rejoining the current macOS
// Space (see the Space watcher in `setup`). A CGS Space join is a one-time
// snapshot (see `dock::join_fullscreen_space`), so a window that must stay
// visible across Space switches needs it re-applied on a timer.
#[cfg(target_os = "macos")]
static MAC_ACTIVE: [AtomicBool; 2] = flags();

// True once the cursor has been over a surface's expanded panel since it was
// last expanded. The leave-intent watcher only collapses a panel the cursor
// has actually visited: one opened from a button (Settings, the dock's
// sidebar button, the tray) appears while the cursor is somewhere else, and
// collapsing it 350ms later for "leaving" made it vanish before it could be
// reached. Such a panel stays until clicked away from or entered and left.
#[cfg(target_os = "macos")]
static ENTERED: [AtomicBool; 2] = flags();

type Frame = (f64, f64, f64, f64);

// AppKit screen-coordinate frames (bottom-left origin) of each surface's
// collapsed handle and expanded panel, cached when they're placed so the
// hover/leave-intent watchers can compare them against polled cursor
// positions without an NSWindow touch (main-thread-only) on every tick.
#[cfg(target_os = "macos")]
static HANDLE_FRAMES: Mutex<[Option<Frame>; 2]> = Mutex::new([None, None]);
#[cfg(target_os = "macos")]
static PANEL_FRAMES: Mutex<[Option<Frame>; 2]> = Mutex::new([None, None]);

// Width (logical px) of the bar's visible pill, reported by the frontend
// (`dock_set_bar_content_width`). The bar window is see-through, so it's
// sized to hug the pill instead of spanning the screen — a transparent
// full-width strip would still swallow clicks meant for apps behind it.
// 0 = not reported yet → full screen width.
static BAR_CONTENT_WIDTH: AtomicU32 = AtomicU32::new(0);

const DOCK_MIN_WIDTH: u32 = 220;
const DOCK_MAX_WIDTH: u32 = 900;
const BAR_MIN_HEIGHT: u32 = 40;
const BAR_MAX_HEIGHT: u32 = 220;

/// Gap (logical px) between the sidebar panel and its left/right edges — a
/// floating panel, not a flush-docked strip. Needs a non-opaque window plus
/// the `dock-sidebar` page class for the gap and rounded corners to reveal
/// real desktop (Windows: `.transparent(true)` at creation; macOS:
/// `dock::set_see_through` on the live window).
const SIDEBAR_MARGIN: i32 = 16;

/// Gap (logical px) between the sidebar panel and the screen's top/bottom —
/// larger than `SIDEBAR_MARGIN` since it reads as clearance below the menu
/// bar, not just panel styling.
const SIDEBAR_MARGIN_VERTICAL: i32 = 40;

// Logical-pixel size of the collapsed edge handle (a centered tab; the long
// side runs along the docked edge, so it's rotated for the bar).
const HANDLE_W: i32 = 22;
const HANDLE_H: i32 = 132;

/// Logical/CSS pixels → the physical pixels the window-positioning APIs
/// need. Every monitor geometry value combined with this is already physical,
/// so skipping it renders the panel at half size on any 2x display.
fn logical_to_physical(logical_px: i32, scale_factor: f64) -> i32 {
    (logical_px as f64 * scale_factor).round() as i32
}

// ── Geometry ───────────────────────────────────────────────────────────────

/// Primary monitor geometry in physical pixels: (x, y, width, height). Only
/// `cursor_geom`'s last-resort fallback.
fn primary_geom(app: &tauri::AppHandle) -> Option<(i32, i32, i32, i32)> {
    let m = app.primary_monitor().ok().flatten()?;
    let p = m.position();
    let s = m.size();
    Some((p.x, p.y, s.width as i32, s.height as i32))
}

/// Geometry (physical pixels) of whichever monitor currently has the cursor,
/// falling back to the primary monitor — the panels follow the user across
/// screens.
///
/// macOS: tao's `cursor_position()` scales the point location by the
/// *primary* display's scale factor, but `monitor_from_point` compares
/// against `CGDisplayBounds` in points — so feed it the raw CGEvent point
/// location instead. Only the monitor's identity matters on macOS; actual
/// placement is done in points by `mac_frame`.
fn cursor_geom(app: &tauri::AppHandle) -> Option<(i32, i32, i32, i32)> {
    #[cfg(target_os = "macos")]
    let cursor = {
        use core_graphics::event::CGEvent;
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
        CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .ok()
            .and_then(|src| CGEvent::new(src).ok())
            .map(|e| e.location())
            .map(|loc| (loc.x, loc.y))
    };
    #[cfg(not(target_os = "macos"))]
    let cursor = app.cursor_position().ok().map(|pos| (pos.x, pos.y));
    let monitor = cursor.and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten());
    match monitor {
        Some(m) => {
            let p = m.position();
            let s = m.size();
            Some((p.x, p.y, s.width as i32, s.height as i32))
        }
        None => primary_geom(app),
    }
}

/// Geometry a surface lays out against. The bar uses the monitor *work area*
/// on Windows so it sits above the taskbar instead of covering it; the
/// sidebar keeps the full-monitor strip.
fn drawer_geom(app: &tauri::AppHandle, win: &tauri::Window, horizontal: bool) -> Option<(i32, i32, i32, i32)> {
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
    cursor_geom(app)
}

/// macOS placement for a surface's panel (`handle == false`) or its collapsed
/// tab (`handle == true`) on the screen under the cursor, as an AppKit frame
/// (points, bottom-left origin) for `dock::set_window_frame`. Mirrors the
/// physical-pixel math in `expand`/`collapse`, but against `NSScreen` rects —
/// see `dock::cursor_screen_rects` for why Tauri's monitor APIs can't be used
/// for this on a multi-monitor Mac.
#[cfg(target_os = "macos")]
fn mac_frame(s: Surface, st: &SurfaceState, handle: bool) -> Option<Frame> {
    let ((fx, fy, fw, fh), visible) = dock::cursor_screen_rects()?;
    // In a fullscreen app the macOS Dock and menu bar are hidden, so lay out
    // against the whole screen.
    let fullscreen = dock::any_fullscreen_space();
    let (vx, vy, vw, vh) = if fullscreen { (fx, fy, fw, fh) } else { visible };
    let frame = match (handle, s.horizontal()) {
        (false, false) => {
            // No horizontal margin on macOS: the sidebar window is see-through
            // (only its cards paint), so the page's own padding is the gap.
            let margin_v = SIDEBAR_MARGIN_VERTICAL as f64;
            let w = (s.clamp_size(st.size) as f64).max(1.0);
            let x = if st.side == "left" { vx } else { vx + vw - w };
            (x, vy + margin_v, w, (vh - margin_v * 2.0).max(1.0))
        }
        (false, true) => {
            let h = s.clamp_size(st.size) as f64;
            let y = if st.side == "bottom" { vy } else { vy + vh - h };
            // Hug the pill, centered like the macOS Dock (see `BAR_CONTENT_WIDTH`).
            let content = BAR_CONTENT_WIDTH.load(Ordering::Relaxed) as f64;
            let w = if content > 0.0 { content.min(fw) } else { fw };
            (fx + (fw - w) / 2.0, y, w, h)
        }
        (true, false) => {
            let (w, h) = (HANDLE_W as f64, HANDLE_H as f64);
            let x = if st.side == "left" { vx } else { vx + vw - w };
            (x, vy + (vh - h) / 2.0, w, h)
        }
        (true, true) => {
            // Rotated tab: the long side runs along the edge.
            let (w, h) = (HANDLE_H as f64, HANDLE_W as f64);
            let y = if st.side == "bottom" { vy } else { vy + vh - h };
            (fx + (fw - w) / 2.0, y, w, h)
        }
    };
    Some(if fullscreen { frame } else { clear_of_mac_dock(&st.side, frame) })
}

/// Gap (points) kept between a surface and the space the macOS Dock pops up
/// into, on top of the Dock's icon size.
#[cfg(target_os = "macos")]
const MAC_DOCK_CLEARANCE: f64 = 18.0;

/// When the macOS Dock auto-hides on the same edge, that edge is its reveal
/// zone: move in by the Dock's thickness so the two don't fight over it.
/// (An always-shown Dock is already excluded from `visibleFrame`.)
#[cfg(target_os = "macos")]
fn clear_of_mac_dock(side: &str, (x, y, w, h): Frame) -> Frame {
    let prefs = dock::mac_dock_prefs();
    if prefs.orientation != side || !prefs.autohide {
        return (x, y, w, h);
    }
    let inset = prefs.tile_size + MAC_DOCK_CLEARANCE;
    match side {
        "bottom" => (x, y + inset, w, h),
        "left" => (x + inset, y, w, h),
        "right" => (x - inset, y, w, h),
        _ => (x, y, w, h),
    }
}

// ── Windows ────────────────────────────────────────────────────────────────

fn panel_window(app: &tauri::AppHandle, s: Surface) -> Option<tauri::Window> {
    app.get_window(s.panel_label())
}

/// Build a surface's panel window on first demand (hidden). It loads the
/// same page as the main window; the page renders the sidebar / bar layout
/// from its own label. Callers must be off the event-loop thread (an async
/// command, a worker thread, or `setup`): building a webview from inside a
/// sync command deadlocks WebView2.
fn ensure_panel_window(app: &tauri::AppHandle, s: Surface) -> Option<tauri::Window> {
    if let Some(win) = panel_window(app, s) {
        return Some(win);
    }
    let (title, w, h) = match s {
        Surface::Sidebar => ("CoolDesk Sidebar", 320.0, 800.0),
        Surface::Bar => ("CoolDesk Dock", 900.0, 72.0),
    };
    let built = tauri::WebviewWindowBuilder::new(app, s.panel_label(), tauri::WebviewUrl::App("pages/index.html".into()))
        .title(title)
        .inner_size(w, h)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        // See `ensure_main_window` for why only Windows is transparent at
        // creation: macOS flips `setOpaque(false)` on the live window instead
        // (`dock::set_see_through`, applied in `expand`).
        .transparent(cfg!(windows))
        .build();
    match built {
        Ok(built) => {
            let win = built.as_ref().window();
            attach_panel_events(app, s, &win);
            #[cfg(target_os = "macos")]
            crate::autoresize_main_page(built.as_ref());
            log::info!("[Dock] Created {} window", s.panel_label());
            Some(win)
        }
        Err(e) => {
            log::error!("[Dock] Failed to create {} window: {}", s.panel_label(), e);
            None
        }
    }
}

/// Close becomes collapse/hide (the panel has no title bar, but Alt+F4 still
/// reaches it), and in drawer mode the panel collapses to its handle when
/// focus leaves the app — the "click away to hide" behavior.
fn attach_panel_events(app: &tauri::AppHandle, s: Surface, window: &tauri::Window) {
    let app = app.clone();
    let win = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let st = surface_state(&app, s);
            if st.enabled && st.mode == "drawer" {
                collapse(&app, s, &st);
            } else {
                let _ = win.hide();
            }
        }
        tauri::WindowEvent::Focused(false) => {
            let st = surface_state(&app, s);
            // Only for a click *away*: focus bouncing between our own windows
            // (main, the other surface, a handle) is not the user leaving, and
            // its blur can arrive after the panel was already re-shown.
            if st.enabled && st.mode == "drawer" && win.is_visible().unwrap_or(false) && crate::focus_left_the_app(&app) {
                log::info!("[Dock] {} blurred → collapsing to handle", s.panel_label());
                collapse(&app, s, &st);
            }
        }
        _ => {}
    });
}

// ── Drawer mode ────────────────────────────────────────────────────────────

/// Where a surface's panel goes (physical pixels: x, y, w, h) on the monitor
/// under the cursor. Not used for placement on macOS (see `mac_frame`), only
/// for the log line there.
fn panel_rect(app: &tauri::AppHandle, s: Surface, st: &SurfaceState, panel: &tauri::Window) -> Option<(i32, i32, i32, i32)> {
    let horizontal = s.horizontal();
    let scale = panel.scale_factor().unwrap_or(1.0);
    let (mx, my, mw, mh) = drawer_geom(app, panel, horizontal)?;
    Some(if horizontal {
        let h = logical_to_physical(s.clamp_size(st.size) as i32, scale);
        let y = if st.side == "top" { my } else { my + mh - h };
        // Span the full monitor width (not the work-area width) so a side
        // taskbar/appbar doesn't leave a gap on one side.
        #[cfg(windows)]
        let (bx, bw) = panel
            .hwnd()
            .ok()
            .and_then(|hwnd| dock::monitor_rect(hwnd.0 as isize))
            .map(|(rx, _, rw, _)| (rx, rw))
            .unwrap_or((mx, mw));
        #[cfg(not(windows))]
        let (bx, bw) = (mx, mw);
        // Hug the pill instead of spanning the edge (see `BAR_CONTENT_WIDTH`).
        let content = logical_to_physical(BAR_CONTENT_WIDTH.load(Ordering::Relaxed) as i32, scale);
        let (bx, bw) = if content > 0 && content < bw { (bx + (bw - content) / 2, content) } else { (bx, bw) };
        (bx, y, bw, h)
    } else {
        // Floating panel: a gap on every edge, including the docked one.
        let margin = logical_to_physical(SIDEBAR_MARGIN, scale);
        let margin_v = logical_to_physical(SIDEBAR_MARGIN_VERTICAL, scale);
        let w = (logical_to_physical(s.clamp_size(st.size) as i32, scale) - margin * 2).max(1);
        let x = if st.side == "left" { mx + margin } else { mx + mw - w - margin };
        (x, my + margin_v, w, (mh - margin_v * 2).max(1))
    })
}

/// Move/resize an open panel to its stored size, and nothing else — no
/// show, focus or "expanded" event. Used while the sidebar's edge is being
/// dragged (`dock_resize`), where `expand` would steal focus and reset the
/// page's scroll on every step.
fn place(app: &tauri::AppHandle, s: Surface, st: &SurfaceState) {
    let Some(panel) = panel_window(app, s) else { return };
    #[cfg(target_os = "macos")]
    {
        let st = st.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(frame) = mac_frame(s, &st, false) {
                PANEL_FRAMES.lock().unwrap()[s.idx()] = dock::set_window_frame(&panel, frame);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    if let Some((x, y, w, h)) = panel_rect(app, s, st, &panel) {
        let _ = panel.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w as u32, height: h as u32 }));
        let _ = panel.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
    }
}

/// Slide a surface's panel in: size it to a strip at its edge (floating
/// sidebar or bar hugging its pill), make it a topmost overlay, and hide its
/// handle.
pub fn expand(app: &tauri::AppHandle, s: Surface, st: &SurfaceState) {
    let horizontal = s.horizontal();
    let Some(panel) = ensure_panel_window(app, s) else {
        log::error!("[Dock] expand: no {} window", s.panel_label());
        return;
    };
    #[cfg(target_os = "macos")]
    ENTERED[s.idx()].store(false, Ordering::Relaxed);
    match panel_rect(app, s, st, &panel) {
        None => log::error!("[Dock] expand: no monitor geometry"),
        Some((x, y, w, h)) => {
            let _ = panel.set_always_on_top(true);
            // A native rectangular shadow pokes past the sidebar's CSS rounded
            // corners, and frames the see-through bar's pill on macOS.
            let _ = panel.set_shadow(horizontal && !cfg!(target_os = "macos"));
            // macOS positions the panel once, atomically, in AppKit points via
            // `mac_frame` in the main-thread block below — Tauri's physical
            // APIs misplace it on mixed-scale multi-monitor setups.
            if !cfg!(target_os = "macos") {
                let _ = panel.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w as u32, height: h as u32 }));
                let _ = panel.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            }
            // `expand` can run off the main thread, but this reaches into the
            // raw NSWindow via objc2 — AppKit crashes if that happens off it.
            // `show()`/`set_focus()` go inside the same block, after
            // positioning, so the panel can't paint a frame at its old spot.
            #[cfg(target_os = "macos")]
            {
                let panel_for_appkit = panel.clone();
                let st_for_appkit = st.clone();
                let _ = app.run_on_main_thread(move || {
                    dock::allow_over_fullscreen_spaces(&panel_for_appkit);
                    dock::join_fullscreen_space(&panel_for_appkit);
                    // Cards (sidebar) or the pill (bar) float over the desktop
                    // with no panel behind them — see `dock::set_see_through`.
                    dock::set_see_through(&panel_for_appkit, true);
                    crate::set_page_background(&panel_for_appkit, Some(tauri::window::Color(0, 0, 0, 0)));
                    match mac_frame(s, &st_for_appkit, false) {
                        Some(frame) => {
                            dock::set_window_frame(&panel_for_appkit, frame);
                        }
                        None => log::error!("[Dock] expand: no NSScreen to place {} on", s.panel_label()),
                    }
                    PANEL_FRAMES.lock().unwrap()[s.idx()] = dock::window_frame(&panel_for_appkit);
                    let _ = panel_for_appkit.show();
                    let _ = panel_for_appkit.set_focus();
                });
                MAC_ACTIVE[s.idx()].store(true, Ordering::Relaxed);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = panel.show();
                let _ = panel.set_focus();
            }
            // The panel's webview is hidden, never recreated, between opens —
            // the page resets its scroll positions on this.
            let _ = app.emit_to(s.panel_label(), "dock-expanded", s.panel_label());
            log::info!("[Dock] {} expanded on {}: x={x} y={y} w={w} h={h}", s.panel_label(), st.side);
        }
    }
    if let Some(handle) = app.get_webview_window(s.handle_label()) {
        let _ = handle.hide();
    }
    COLLAPSED[s.idx()].store(false, Ordering::Relaxed);
    ACTIVE[s.idx()].store(true, Ordering::Relaxed);
}

/// Collapse a surface to its handle: hide the panel, show the slim edge tab.
pub fn collapse(app: &tauri::AppHandle, s: Surface, st: &SurfaceState) {
    if let Some(panel) = panel_window(app, s) {
        let _ = panel.hide();
    }
    let horizontal = s.horizontal();
    if let Some(handle) = app.get_webview_window(s.handle_label()) {
        let scale = handle.scale_factor().unwrap_or(1.0);
        let (handle_w, handle_h) = (logical_to_physical(HANDLE_W, scale), logical_to_physical(HANDLE_H, scale));
        if let Some((mx, my, mw, mh)) = drawer_geom(app, &handle.as_ref().window(), horizontal) {
            let (x, y, w, h) = if horizontal {
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
            // Windows clamps top-level windows to a minimum tracking size
            // (~136px wide) via WM_GETMINMAXINFO, which would fatten a 22px
            // vertical handle. Pin the min size to the exact target first.
            #[cfg(not(target_os = "macos"))]
            {
                let target = tauri::Size::Physical(tauri::PhysicalSize { width: w as u32, height: h as u32 });
                let _ = handle.set_min_size(Some(target.clone()));
                let _ = handle.set_size(target);
                let _ = handle.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            }
            #[cfg(target_os = "macos")]
            {
                let _ = (x, y, w, h);
                let (lw, lh) = if horizontal { (HANDLE_H, HANDLE_W) } else { (HANDLE_W, HANDLE_H) };
                let _ = handle.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize { width: lw as f64, height: lh as f64 })));
            }
            // Follow the user across Spaces, and stay clear of the real macOS
            // Dock/menu bar. Main thread only; `show()` after positioning.
            #[cfg(target_os = "macos")]
            {
                let handle_for_appkit = handle.as_ref().window();
                let st_for_appkit = st.clone();
                let _ = app.run_on_main_thread(move || {
                    dock::allow_over_fullscreen_spaces(&handle_for_appkit);
                    dock::join_fullscreen_space(&handle_for_appkit);
                    match mac_frame(s, &st_for_appkit, true) {
                        Some(frame) => {
                            dock::set_window_frame(&handle_for_appkit, frame);
                        }
                        None => log::error!("[Dock] collapse: no NSScreen to place {} on", s.handle_label()),
                    }
                    HANDLE_FRAMES.lock().unwrap()[s.idx()] = dock::window_frame(&handle_for_appkit);
                    let _ = handle_for_appkit.show();
                });
                MAC_ACTIVE[s.idx()].store(true, Ordering::Relaxed);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = handle.show();
        }
    }
    COLLAPSED[s.idx()].store(true, Ordering::Relaxed);
    ACTIVE[s.idx()].store(true, Ordering::Relaxed);
}

/// Re-place a drawer surface wherever it currently is (panel or handle).
fn relayout(app: &tauri::AppHandle, s: Surface, st: &SurfaceState) {
    if COLLAPSED[s.idx()].load(Ordering::Relaxed) {
        collapse(app, s, st);
    } else {
        expand(app, s, st);
    }
}

// ── Reserve mode (AppBar) ──────────────────────────────────────────────────

/// Register an AppBar for the surface's panel and dock it into the reserved
/// strip. Windows only.
fn apply_reserve(app: &tauri::AppHandle, s: Surface, st: &SurfaceState) -> Result<(), String> {
    #[cfg(windows)]
    {
        COLLAPSED[s.idx()].store(false, Ordering::Relaxed);
        ACTIVE[s.idx()].store(false, Ordering::Relaxed);
        if let Some(handle) = app.get_webview_window(s.handle_label()) {
            let _ = handle.hide();
        }
        let window = ensure_panel_window(app, s).ok_or_else(|| format!("{} window not found", s.panel_label()))?;
        let scale = window.scale_factor().unwrap_or(1.0);
        let thickness = logical_to_physical(s.clamp_size(st.size) as i32, scale);
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (x, y, cx, cy) = dock::set_dock(hwnd, &st.side, thickness)?;
        log::info!("[Dock] {} reserved strip: x={x} y={y} w={cx} h={cy} (side={})", s.panel_label(), st.side);
        let _ = window.show();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, s, st);
        Err("Reserve mode is only supported on Windows".to_string())
    }
}

/// Release the surface's AppBar reservation, if it holds one.
fn release_reserve(app: &tauri::AppHandle, s: Surface) {
    #[cfg(windows)]
    if let Some(win) = panel_window(app, s) {
        if let Ok(hwnd) = win.hwnd() {
            dock::remove_dock_for(hwnd.0 as isize);
        }
    }
    #[cfg(not(windows))]
    let _ = (app, s);
}

// ── Enable / disable ───────────────────────────────────────────────────────

/// Turn a surface on (or re-apply it with new settings). `expand`: slide the
/// panel straight in instead of starting collapsed to its handle — what an
/// explicit "turn on" should do, so the user sees it appear.
pub fn enable(
    app: &tauri::AppHandle,
    s: Surface,
    side: Option<&str>,
    size: Option<u32>,
    mode: Option<&str>,
    expand_now: bool,
) -> Result<SurfaceState, String> {
    let prev = surface_state(app, s);
    let mode = match mode.unwrap_or(&prev.mode) {
        "reserve" => "reserve",
        _ => "drawer",
    };
    if mode == "reserve" && !cfg!(windows) {
        return Err("Reserve mode is only supported on Windows".to_string());
    }
    let st = update_surface(app, s, |st| {
        st.enabled = true;
        st.mode = mode.to_string();
        st.side = s.normalize_side(side, &prev.side);
        st.size = s.clamp_size(size.unwrap_or(prev.size));
    });
    if mode == "reserve" {
        apply_reserve(app, s, &st)?;
    } else {
        release_reserve(app, s);
        if expand_now {
            expand(app, s, &st);
        } else {
            collapse(app, s, &st);
        }
    }
    Ok(st)
}

/// Turn a surface off: release any AppBar, hide its handle, and close its
/// panel window (a hidden webview still costs a whole page's memory).
pub fn disable(app: &tauri::AppHandle, s: Surface) -> SurfaceState {
    release_reserve(app, s);
    COLLAPSED[s.idx()].store(false, Ordering::Relaxed);
    ACTIVE[s.idx()].store(false, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        MAC_ACTIVE[s.idx()].store(false, Ordering::Relaxed);
        HANDLE_FRAMES.lock().unwrap()[s.idx()] = None;
        PANEL_FRAMES.lock().unwrap()[s.idx()] = None;
    }
    if let Some(handle) = app.get_webview_window(s.handle_label()) {
        let _ = handle.hide();
    }
    if let Some(panel) = panel_window(app, s) {
        let _ = panel.hide();
        let _ = panel.destroy();
    }
    update_surface(app, s, |st| st.enabled = false)
}

fn toggle(app: &tauri::AppHandle, s: Surface) {
    let result = if surface_state(app, s).enabled {
        disable(app, s);
        Ok(())
    } else {
        enable(app, s, None, None, None, true).map(|_| ())
    };
    if let Err(e) = result {
        log::warn!("[Dock] Failed to toggle {}: {}", s.panel_label(), e);
    }
    emit_state(app);
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn dock_get_state(app: tauri::AppHandle) -> DockState {
    load_state(&app)
}

/// Turn a surface on, or change its side / size / mode. Async: the panel
/// window may still need building, which must happen off the event loop.
#[tauri::command(rename_all = "snake_case")]
pub async fn dock_enable(
    app: tauri::AppHandle,
    surface: String,
    side: Option<String>,
    size: Option<u32>,
    mode: Option<String>,
    expand: Option<bool>,
) -> Result<DockState, String> {
    let s = Surface::parse(&surface)?;
    let result = enable(&app, s, side.as_deref(), size, mode.as_deref(), expand.unwrap_or(true));
    emit_state(&app);
    result.map(|_| load_state(&app))
}

/// Async so the panel's webview isn't destroyed from inside a sync command
/// it may itself have issued (its own "turn off" control).
#[tauri::command]
pub async fn dock_disable(app: tauri::AppHandle, surface: String) -> Result<DockState, String> {
    let s = Surface::parse(&surface)?;
    disable(&app, s);
    emit_state(&app);
    Ok(load_state(&app))
}

/// Slide a surface's panel in (its handle's hover/click, the tray, the
/// page). No-op unless that surface is an enabled drawer. Async: the panel
/// may still need building (see `ensure_panel_window`).
#[tauri::command]
pub async fn dock_expand(app: tauri::AppHandle, surface: String) -> Result<(), String> {
    let s = Surface::parse(&surface)?;
    let st = surface_state(&app, s);
    if st.enabled && st.mode == "drawer" {
        expand(&app, s, &st);
    }
    Ok(())
}

/// Collapse a surface's panel back to its handle.
#[tauri::command]
pub fn dock_collapse(app: tauri::AppHandle, surface: String) -> Result<(), String> {
    let s = Surface::parse(&surface)?;
    let st = surface_state(&app, s);
    if st.enabled && st.mode == "drawer" {
        collapse(&app, s, &st);
    }
    Ok(())
}

/// Resize a surface: sidebar width or bar height (logical px).
#[tauri::command]
pub async fn dock_set_size(app: tauri::AppHandle, surface: String, size: u32) -> Result<DockState, String> {
    let s = Surface::parse(&surface)?;
    let st = update_surface(&app, s, |st| st.size = s.clamp_size(size));
    if st.enabled {
        if st.mode == "reserve" {
            apply_reserve(&app, s, &st)?;
        } else if panel_window(&app, s).is_some_and(|w| w.is_visible().unwrap_or(false)) {
            expand(&app, s, &st);
        }
    }
    emit_state(&app);
    Ok(load_state(&app))
}

/// Live resize from the sidebar's edge handle: store the new size and
/// re-place the open panel at it. `done` (pointer released) also broadcasts
/// the state, so Settings and other windows pick up the final size.
#[tauri::command]
pub fn dock_resize(app: tauri::AppHandle, surface: String, size: u32, done: Option<bool>) -> Result<u32, String> {
    let s = Surface::parse(&surface)?;
    let st = update_surface(&app, s, |st| st.size = s.clamp_size(size));
    if st.enabled && st.mode == "drawer" && !COLLAPSED[s.idx()].load(Ordering::Relaxed) {
        place(&app, s, &st);
    }
    if done.unwrap_or(false) {
        emit_state(&app);
    }
    Ok(st.size)
}

/// Open the full app from a panel. The panel it came from collapses, since
/// the user is moving to the main window.
#[tauri::command]
pub async fn dock_open_main(app: tauri::AppHandle, from: Option<String>) {
    log::info!("[Dock] Open full app requested (from {:?})", from);
    if let Some(s) = from.as_deref().and_then(|f| Surface::parse(f).ok()) {
        let st = surface_state(&app, s);
        if st.enabled && st.mode == "drawer" {
            collapse(&app, s, &st);
        }
    }
    crate::show_main_window(&app);
}

/// The bar's pill width (CSS px) whenever it changes; the open bar is re-fit
/// around it in place — see `BAR_CONTENT_WIDTH`.
#[tauri::command(rename_all = "snake_case")]
pub fn dock_set_bar_content_width(app: tauri::AppHandle, width: u32) {
    #[cfg(any(target_os = "macos", windows))]
    {
        if BAR_CONTENT_WIDTH.swap(width, Ordering::Relaxed) == width {
            return;
        }
        let s = Surface::Bar;
        let st = surface_state(&app, s);
        if !(st.enabled && st.mode == "drawer") || COLLAPSED[s.idx()].load(Ordering::Relaxed) {
            return;
        }
        #[cfg(target_os = "macos")]
        {
            let Some(panel) = panel_window(&app, s) else { return };
            let _ = app.run_on_main_thread(move || {
                if let Some(frame) = mac_frame(s, &st, false) {
                    PANEL_FRAMES.lock().unwrap()[s.idx()] = dock::set_window_frame(&panel, frame);
                }
            });
        }
        #[cfg(windows)]
        expand(&app, s, &st);
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = (app, width);
}

// ── Tray ───────────────────────────────────────────────────────────────────

/// The tray's per-surface check items, kept so `emit_state` can update their
/// check marks when a surface is toggled from anywhere else.
pub struct TrayChecks {
    sidebar: tauri::menu::CheckMenuItem<tauri::Wry>,
    bar: tauri::menu::CheckMenuItem<tauri::Wry>,
}

pub const TRAY_SIDEBAR: &str = "surface_sidebar";
pub const TRAY_BAR: &str = "surface_bar";

/// Build the tray's "Sidebar" / "Dock" check items and register them for
/// `emit_state`. They're also the always-reachable recovery path: if a panel
/// ends up stuck or off-screen, its in-page controls are unreachable too.
pub fn tray_items(
    app: &tauri::App,
) -> tauri::Result<(tauri::menu::CheckMenuItem<tauri::Wry>, tauri::menu::CheckMenuItem<tauri::Wry>)> {
    use tauri::menu::CheckMenuItem;
    let st = load_state(app.handle());
    let sidebar = CheckMenuItem::with_id(app, TRAY_SIDEBAR, "Sidebar", true, st.sidebar.enabled, None::<&str>)?;
    let bar = CheckMenuItem::with_id(app, TRAY_BAR, "Dock", true, st.bar.enabled, None::<&str>)?;
    app.manage(TrayChecks { sidebar: sidebar.clone(), bar: bar.clone() });
    Ok((sidebar, bar))
}

/// Handle a tray menu id if it's one of ours. Returns whether it was.
pub fn handle_tray_menu(app: &tauri::AppHandle, id: &str) -> bool {
    let s = match id {
        TRAY_SIDEBAR => Surface::Sidebar,
        TRAY_BAR => Surface::Bar,
        _ => return false,
    };
    // Off the event loop: turning a surface on may build its webview.
    let app = app.clone();
    tauri::async_runtime::spawn(async move { toggle(&app, s) });
    true
}

// ── Startup + watchers ─────────────────────────────────────────────────────

/// Restore whichever surfaces the user left on, and start the watchers that
/// keep them placed. Called from `setup`, where building windows is safe.
pub fn setup(app: &tauri::AppHandle) {
    let state = load_state(app);
    for s in ALL {
        let st = state.get(s);
        if !st.enabled {
            continue;
        }
        if st.mode == "reserve" {
            if let Err(e) = apply_reserve(app, s, st) {
                log::warn!("[Dock] Failed to re-apply {} reserve dock on startup: {}", s.panel_label(), e);
            }
        } else {
            // The panel must exist before its handle is first hovered, and
            // building it lazily from a sync path deadlocks — create it hidden
            // here, then start collapsed to the handle.
            let _ = ensure_panel_window(app, s);
            collapse(app, s, st);
            log::info!("[Dock] Restored {} handle on startup ({})", s.panel_label(), st.side);
        }
    }

    // Fullscreen watcher: a handle is a plain topmost window, so — unlike an
    // AppBar — the shell never hides it for a fullscreen app. Hide collapsed
    // handles while a fullscreen app holds the foreground, and re-assert them
    // otherwise. Linux: X11/EWMH only; under Wayland this never reports
    // fullscreen.
    #[cfg(any(windows, target_os = "linux"))]
    {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let mut hidden_for_fullscreen = [false; 2];
            loop {
                std::thread::sleep(std::time::Duration::from_millis(600));
                if !ALL.iter().any(|s| COLLAPSED[s.idx()].load(Ordering::Relaxed)) {
                    hidden_for_fullscreen = [false; 2];
                    continue;
                }
                let fullscreen = dock::foreground_is_fullscreen();
                for s in ALL {
                    let i = s.idx();
                    if !COLLAPSED[i].load(Ordering::Relaxed) {
                        hidden_for_fullscreen[i] = false;
                        continue;
                    }
                    let Some(handle) = app_handle.get_webview_window(s.handle_label()) else { continue };
                    if fullscreen {
                        if !hidden_for_fullscreen[i] {
                            let _ = handle.hide();
                            hidden_for_fullscreen[i] = true;
                        }
                        continue;
                    }
                    // Not fullscreen and collapsed: the handle is this
                    // surface's only on-screen presence, so assert it every
                    // tick (SWP_NOACTIVATE — no focus steal, no flicker).
                    let _ = handle.set_always_on_top(true);
                    if !handle.is_visible().unwrap_or(true) {
                        let _ = handle.show();
                    }
                    hidden_for_fullscreen[i] = false;
                }
            }
        });
    }

    // macOS: rejoin the current Space on a timer while a surface is meant to
    // be visible (see `MAC_ACTIVE`).
    #[cfg(target_os = "macos")]
    {
        let app_handle = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(600));
            for s in ALL {
                if !MAC_ACTIVE[s.idx()].load(Ordering::Relaxed) {
                    continue;
                }
                let label = if COLLAPSED[s.idx()].load(Ordering::Relaxed) { s.handle_label() } else { s.panel_label() };
                let Some(window) = app_handle.get_window(label) else { continue };
                let _ = app_handle.run_on_main_thread(move || {
                    dock::join_fullscreen_space(&window);
                });
            }
        });
    }

    // macOS: hover-intent to expand a collapsed handle without a click. The
    // handle page's own `mouseenter` never fires while CoolDesk isn't the
    // frontmost app (see `dock::cursor_location`), so poll the real cursor.
    #[cfg(target_os = "macos")]
    {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            const HOVER_INTENT: std::time::Duration = std::time::Duration::from_millis(200);
            let mut hover_since: [Option<std::time::Instant>; 2] = [None, None];
            loop {
                std::thread::sleep(std::time::Duration::from_millis(50));
                for s in ALL {
                    let i = s.idx();
                    if !MAC_ACTIVE[i].load(Ordering::Relaxed) || !COLLAPSED[i].load(Ordering::Relaxed) {
                        hover_since[i] = None;
                        continue;
                    }
                    let Some((fx, fy, fw, fh)) = HANDLE_FRAMES.lock().unwrap()[i] else {
                        hover_since[i] = None;
                        continue;
                    };
                    let (cx, cy) = dock::cursor_location();
                    if !(cx >= fx && cx <= fx + fw && cy >= fy && cy <= fy + fh) {
                        hover_since[i] = None;
                        continue;
                    }
                    let since = *hover_since[i].get_or_insert_with(std::time::Instant::now);
                    if since.elapsed() < HOVER_INTENT {
                        continue;
                    }
                    hover_since[i] = None;
                    let st = surface_state(&app_handle, s);
                    if st.enabled && st.mode == "drawer" {
                        expand(&app_handle, s, &st);
                    }
                }
            }
        });
    }

    // macOS: collapse an expanded panel a beat after the cursor leaves it.
    // The blur handler only fires on a click into another app; just moving
    // the cursor away doesn't change the frontmost app on macOS.
    #[cfg(target_os = "macos")]
    {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            const LEAVE_INTENT: std::time::Duration = std::time::Duration::from_millis(350);
            let mut away_since: [Option<std::time::Instant>; 2] = [None, None];
            loop {
                std::thread::sleep(std::time::Duration::from_millis(50));
                for s in ALL {
                    let i = s.idx();
                    if !MAC_ACTIVE[i].load(Ordering::Relaxed) || COLLAPSED[i].load(Ordering::Relaxed) {
                        away_since[i] = None;
                        continue;
                    }
                    let Some((fx, fy, fw, fh)) = PANEL_FRAMES.lock().unwrap()[i] else {
                        away_since[i] = None;
                        continue;
                    };
                    let (cx, cy) = dock::cursor_location();
                    // The floating sidebar has a gap around it that the cursor
                    // crosses on its way in/out; the bar sits flush on its edge.
                    let (bx, by) = if s.horizontal() {
                        (0.0, 0.0)
                    } else {
                        (SIDEBAR_MARGIN as f64, SIDEBAR_MARGIN_VERTICAL as f64)
                    };
                    if cx >= fx - bx && cx <= fx + fw + bx && cy >= fy - by && cy <= fy + fh + by {
                        ENTERED[i].store(true, Ordering::Relaxed);
                        away_since[i] = None;
                        continue;
                    }
                    if !ENTERED[i].load(Ordering::Relaxed) {
                        // Opened from elsewhere and not visited yet — see `ENTERED`.
                        continue;
                    }
                    let since = *away_since[i].get_or_insert_with(std::time::Instant::now);
                    if since.elapsed() < LEAVE_INTENT {
                        continue;
                    }
                    away_since[i] = None;
                    let st = surface_state(&app_handle, s);
                    if st.enabled && st.mode == "drawer" {
                        log::info!("[Dock] Leave-intent elapsed — collapsing {}", s.panel_label());
                        collapse(&app_handle, s, &st);
                    }
                }
            }
        });
    }

    // Keep active drawers anchored to whichever monitor has the cursor while
    // idle, and (macOS) re-place them when the macOS Dock's settings or the
    // fullscreen state change.
    {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let mut anchor: Option<(i32, i32)> = None;
            #[cfg(target_os = "macos")]
            let mut mac_dock_sig: Option<(String, bool, i64, bool)> = None;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if !ALL.iter().any(|s| ACTIVE[s.idx()].load(Ordering::Relaxed)) {
                    anchor = None;
                    #[cfg(target_os = "macos")]
                    {
                        mac_dock_sig = None;
                    }
                    continue;
                }
                let Some((mx, my, _, _)) = cursor_geom(&app_handle) else { continue };
                let moved = anchor.is_some_and(|(ax, ay)| (ax, ay) != (mx, my));
                anchor = Some((mx, my));
                #[cfg(target_os = "macos")]
                let moved = {
                    let prefs = dock::mac_dock_prefs();
                    let sig = (prefs.orientation, prefs.autohide, prefs.tile_size.round() as i64, dock::any_fullscreen_space());
                    let changed = mac_dock_sig.as_ref().is_some_and(|old| *old != sig);
                    mac_dock_sig = Some(sig);
                    moved || changed
                };
                if !moved {
                    continue;
                }
                let state = load_state(&app_handle);
                for s in ALL {
                    let st = state.get(s);
                    if ACTIVE[s.idx()].load(Ordering::Relaxed) && st.enabled && st.mode == "drawer" {
                        log::info!("[Dock] Re-anchoring {}", s.panel_label());
                        relayout(&app_handle, s, st);
                    }
                }
            }
        });
    }
}
