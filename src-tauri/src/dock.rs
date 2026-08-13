// Workspace Layout — Phase 1: the AppBar dock.
//
// Reserves a strip of the primary monitor's work area for CoolDesk via the
// native Windows AppBar API (`SHAppBarMessage`) — the same mechanism the
// taskbar uses. Once the strip is reserved, Windows itself shrinks the usable
// work area, so *maximized* application windows automatically resize to fit
// beside CoolDesk. We do NOT track or resize individual windows here (that's the
// FancyZones-style hard path the feature spec explicitly rejects); we claim the
// work area and let Windows do the rest.
//
// The strip can sit on any edge: "left"/"right" reserve a vertical panel,
// "top"/"bottom" reserve a horizontal taskbar-style bar.
//
// Only the maximized case is guaranteed. Restored (floating) windows that
// overlap the strip are left alone by design.
//
// Platform code lives in per-OS submodules (`windows`, `mac`) behind this
// file's function signatures, so a platform's unsafe FFI/AppKit calls stay
// contained to one file each instead of being scattered behind inline `cfg`
// tags — that's what made it easy to miss, in `mac`, that AppKit calls must
// run on the main thread.

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{
    foreground_hwnd, foreground_is_fullscreen, monitor_rect, remove_dock, set_dock, work_area,
};

// Non-Windows stubs. The callers in lib.rs are all `#[cfg(windows)]`-gated, so
// these are never invoked off Windows — they exist only so the module compiles.
#[cfg(not(windows))]
pub fn set_dock(_raw_hwnd: isize, _edge: &str, _thickness: i32) -> Result<(i32, i32, i32, i32), String> {
    Err("Workspace dock is only supported on Windows".into())
}

#[cfg(not(windows))]
pub fn remove_dock() {}

#[cfg(not(windows))]
pub fn work_area(_raw_hwnd: isize) -> Option<(i32, i32, i32, i32)> {
    None
}

#[cfg(not(windows))]
pub fn monitor_rect(_raw_hwnd: isize) -> Option<(i32, i32, i32, i32)> {
    None
}

#[cfg(not(windows))]
pub fn foreground_is_fullscreen() -> bool {
    false
}

#[cfg(not(windows))]
pub fn foreground_hwnd() -> isize {
    0
}

#[cfg(target_os = "macos")]
mod cgs;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
pub use mac::{
    allow_over_fullscreen_spaces, clamp_to_visible_frame, promote_spotlight_over_fullscreen_spaces,
    restrict_to_current_space, show_over_fullscreen_spaces,
};
