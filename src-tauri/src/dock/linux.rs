// Linux (X11/EWMH) foreground-window queries — powers the dock's fullscreen
// watcher (see the `#[cfg(any(windows, target_os = "linux"))]` block in
// `lib.rs` that hides the drawer handle over a fullscreen app). See
// `dock.rs` for the module-level overview.
//
// Reserve mode (true screen-edge reservation, the Windows AppBar equivalent
// via `set_dock`/`remove_dock`/`work_area`/`monitor_rect`) is NOT
// implemented here — it needs our own window's X11 id, which needs a GTK
// dependency (`gtk_window()` + `gdkx11`) this crate doesn't pull in yet. See
// docs/DEPLOY.md.

use crate::linux_ewmh;

/// Raw X11 window id of the currently active window, or 0 when there isn't
/// one, or no X server is reachable (Wayland-only session, headless CI, ...).
pub fn foreground_hwnd() -> isize {
    linux_ewmh::snapshot().active_window.unwrap_or(0) as isize
}

/// True when the active window carries `_NET_WM_STATE_FULLSCREEN` — a
/// genuinely fullscreen surface (games, F11 browsers, video players).
/// Compliant window managers only set this for real fullscreen surfaces, not
/// merely-maximized windows, so unlike the Windows implementation this needs
/// no separate "is it actually maximized, not fullscreen" heuristic.
pub fn foreground_is_fullscreen() -> bool {
    linux_ewmh::snapshot().active_is_fullscreen
}
