// macOS: allow panels to render over another app's fullscreen Space.
// See `dock.rs` for the module-level overview of what this is for.
//
// `CanJoinAllSpaces` alone (Tauri's own `set_visible_on_all_workspaces`) only
// follows the user across *ordinary* Spaces. A fullscreen app (e.g. Chrome's
// green-button fullscreen) gets its own dedicated Space, and a window needs
// the separate `FullScreenAuxiliary` collection-behavior bit plus a level at
// or above `NSStatusWindowLevel` to be allowed to render on top of Spaces at
// all — set below in `promote_spotlight_over_fullscreen_spaces`.
//
// That combination is necessary but not sufficient for showing over
// *another app's* fullscreen Space, though: empirically (confirmed by
// logging `NSWindow.occlusionState`/`isOnActiveSpace` and the frontmost app
// while another app was fullscreen) a window with only the public
// collection-behavior bits set stays parked on the ordinary desktop Space —
// invisible — even though macOS never switches frontmost app away from the
// fullscreen one. Getting the window to actually join that fullscreen Space
// needs the private Spaces API in `cgs.rs`, called from
// `show_over_fullscreen_spaces` below.
//
// All functions here reach into the raw NSWindow via objc2, which AppKit
// requires happen on the main thread — callers must dispatch through
// `AppHandle::run_on_main_thread` rather than calling these directly from a
// background thread (e.g. an async Tauri command runs on a tokio worker).

use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior, NSFloatingWindowLevel, NSStatusWindowLevel};

/// Nudges a horizontal (top/bottom) drawer bar or its collapsed handle back
/// inside the screen's *visible* frame after it's been positioned against
/// the full monitor rect (`drawer_geom` in `lib.rs` deliberately spans the
/// full monitor width, matching the Windows side-taskbar-gap behavior — see
/// its doc comment). On macOS the real system Dock and menu bar sit at a
/// window level above ours, so a bar/handle placed flush against the
/// physical bottom or top edge renders (and receives clicks) underneath
/// them whenever the Dock occupies that edge — invisible and unclickable.
/// `NSScreen.visibleFrame` reports how much each edge is actually reserved
/// (0 if the Dock is hidden/auto-hidden, or positioned on a different edge),
/// so this only moves the window when there's an actual overlap to avoid.
///
/// Must run on the main thread (NSWindow/NSScreen access) — call this from
/// inside the same `run_on_main_thread` dispatch as `allow_over_fullscreen_spaces`,
/// after the window's Tauri-side size/position has already been applied.
pub fn clamp_to_visible_frame(window: &tauri::WebviewWindow, side: &str) {
    let Ok(ptr) = window.ns_window() else { return };
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    let Some(screen) = ns_window.screen() else { return };
    let visible = screen.visibleFrame();
    let frame = ns_window.frame();

    // AppKit's coordinate origin is bottom-left, so the Dock (reserved at the
    // physical bottom of the screen) raises `visibleFrame`'s origin.y above
    // the full frame's — pin the bar's bottom edge there. A top bar instead
    // needs its *top* edge (origin.y + height) pulled down to just below the
    // menu bar, which shrinks `visibleFrame` from the top.
    let mut origin = frame.origin;
    origin.y = if side == "bottom" {
        visible.origin.y
    } else {
        (visible.origin.y + visible.size.height) - frame.size.height
    };
    ns_window.setFrameOrigin(origin);
}

/// Lets a window follow the user across *ordinary* Space switches (the
/// original, pre-fullscreen-overlay behavior). Used by the sidebar/handle
/// drawer, which just needs to not vanish when the user switches desktops —
/// it does not need to render over another app's fullscreen Space, and must
/// stay a normal, single-level, Cmd+Tab-able window so it can be brought
/// back to a full window afterward. Do not add `Stationary`, `IgnoresCycle`,
/// or an elevated window level here — see `promote_spotlight_over_fullscreen_spaces`
/// for why those are dangerous outside the spotlight overlay: applying them
/// to the main window previously left it pinned above normal window
/// management, unreachable from the in-app "back to full window" control.
pub fn allow_over_fullscreen_spaces(window: &tauri::WebviewWindow) {
    let Ok(ptr) = window.ns_window() else { return };
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    let behavior = ns_window.collectionBehavior()
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary;
    ns_window.setCollectionBehavior(behavior);
}

/// Spotlight-only: on top of `allow_over_fullscreen_spaces`'s bits, adds
/// `Stationary` + `IgnoresCycle` and raises the window to `NSStatusWindowLevel`
/// so the overlay can actually render above another app's fullscreen Space
/// (see the module doc comment). This combination makes a window behave like
/// a system status item rather than a normal document window — fine for a
/// transient search overlay the user dismisses, wrong for anything the user
/// needs to keep interacting with (the sidebar/handle drawer). Do not call
/// this on `main` or `handle`.
pub fn promote_spotlight_over_fullscreen_spaces(window: &tauri::WebviewWindow) {
    let Ok(ptr) = window.ns_window() else { return };
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    let behavior = ns_window.collectionBehavior()
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::IgnoresCycle;
    ns_window.setCollectionBehavior(behavior);
    ns_window.setLevel(NSStatusWindowLevel);
}

/// Brings the window on-screen over another app's fullscreen Space.
///
/// This is deliberately NOT `window.show()` / `window.set_focus()` (Tauri's
/// own APIs, backed by tao): both of those end up calling
/// `NSWindow.makeKeyAndOrderFront:` followed by
/// `NSApplication.activateIgnoringOtherApps:YES`
/// (tao's `platform_impl/macos/util/async.rs::set_focus`), and while that
/// activation call turned out not to be what breaks fullscreen overlay (see
/// module doc comment), `orderFrontRegardless()` + `makeKeyWindow()` here
/// keeps focus behavior consistent with the CGS join below without
/// depending on tao's internal call path.
pub fn show_over_fullscreen_spaces(window: &tauri::WebviewWindow) {
    let Ok(ptr) = window.ns_window() else { return };
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    // The public collectionBehavior route (set in `allow_over_fullscreen_spaces`)
    // does not actually join another app's fullscreen Space — see the
    // module and `cgs` doc comments. This explicitly adds the window to
    // whatever Space(s) are currently on-screen via the private Spaces API,
    // which does.
    super::cgs::join_active_spaces(ns_window.windowNumber() as i64);
    ns_window.orderFrontRegardless();
    ns_window.makeKeyWindow();
}

/// Reverses `allow_over_fullscreen_spaces` — used when a window goes back to
/// being a normal, single-Space document window (e.g. dock disabled).
pub fn restrict_to_current_space(window: &tauri::WebviewWindow) {
    let Ok(ptr) = window.ns_window() else { return };
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    let behavior = ns_window.collectionBehavior()
        & !(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
    ns_window.setCollectionBehavior(behavior);
    ns_window.setLevel(NSFloatingWindowLevel);
}
