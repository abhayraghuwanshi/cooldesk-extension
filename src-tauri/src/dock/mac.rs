// macOS: allow panels to render over another app's fullscreen Space.
// See `dock.rs` for the module-level overview of what this is for.
//
// `CanJoinAllSpaces` alone (Tauri's own `set_visible_on_all_workspaces`) only
// follows the user across *ordinary* Spaces. A fullscreen app (e.g. Chrome's
// green-button fullscreen) gets its own dedicated Space, and a window needs
// the separate `FullScreenAuxiliary` collection-behavior bit to be allowed to
// render there too — the same mechanism Spotlight/Alfred use. Tauri/tao don't
// expose that bit, so it's set directly on the raw NSWindow.
//
// Both functions here reach into the raw NSWindow via objc2, which AppKit
// requires happen on the main thread — callers must dispatch through
// `AppHandle::run_on_main_thread` rather than calling these directly from a
// background thread (e.g. an async Tauri command runs on a tokio worker).

use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

pub fn allow_over_fullscreen_spaces(window: &tauri::WebviewWindow) {
    let Ok(ptr) = window.ns_window() else { return };
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    let behavior = ns_window.collectionBehavior()
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary;
    ns_window.setCollectionBehavior(behavior);
}

/// Reverses `allow_over_fullscreen_spaces` — used when a window goes back to
/// being a normal, single-Space document window (e.g. dock disabled).
pub fn restrict_to_current_space(window: &tauri::WebviewWindow) {
    let Ok(ptr) = window.ns_window() else { return };
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    let behavior = ns_window.collectionBehavior()
        & !(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary);
    ns_window.setCollectionBehavior(behavior);
}
