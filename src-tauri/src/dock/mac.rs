// macOS: allow panels to render over another app's fullscreen Space.
// See `dock.rs` for the module-level overview of what this is for.
//
// `CanJoinAllSpaces` alone (Tauri's own `set_visible_on_all_workspaces`) only
// follows the user across *ordinary* Spaces. A fullscreen app (e.g. Chrome's
// green-button fullscreen) gets its own dedicated Space, and a window needs
// the separate `FullScreenAuxiliary` collection-behavior bit plus a level at
// or above `NSStatusWindowLevel` to be allowed to render on top of Spaces at
// all — set below in `allow_over_fullscreen_spaces`.
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

pub fn allow_over_fullscreen_spaces(window: &tauri::WebviewWindow) {
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
