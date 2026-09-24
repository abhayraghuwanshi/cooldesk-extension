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

use objc2_app_kit::{NSApplication, NSEvent, NSScreen, NSWindow, NSWindowCollectionBehavior, NSFloatingWindowLevel, NSStatusWindowLevel};

/// AppKit-space `(frame, visibleFrame)` — each as `(x, y, width, height)` in
/// points, bottom-left origin — of the screen the cursor is currently on.
///
/// The drawer/handle is positioned from this instead of Tauri's monitor
/// APIs, which are unusable for this on a multi-monitor Mac: tao's
/// "physical" monitor rects scale each display's point bounds by *that
/// display's own* scale factor (so rects from a 2x built-in and a 1x
/// external aren't in one shared coordinate space), its `set_position`
/// converts back using the *window's* current scale factor, and it flips Y
/// using only the primary display's height. Any mix of those (moving from a
/// Retina laptop to a 1x external, or to a display arranged above/below)
/// landed the panel on the wrong screen or half off-screen. `NSEvent.mouseLocation`
/// and `NSScreen.frame` share one global point space, so no conversion is
/// needed here at all.
///
/// `visibleFrame` excludes that display's menu bar and Dock — each display
/// gets its own menu bar in a multi-monitor setup, and the real Dock/menu bar
/// sit at a window level above ours, so anything placed flush against the
/// full frame's edge renders (and receives clicks) underneath them.
///
/// Must run on the main thread (NSScreen access).
pub fn cursor_screen_rects() -> Option<((f64, f64, f64, f64), (f64, f64, f64, f64))> {
    let mtm = objc2::MainThreadMarker::new()?;
    let cursor = NSEvent::mouseLocation();
    let screens = NSScreen::screens(mtm);
    // Inclusive bounds: the cursor pinned against a screen's outermost
    // edge reports exactly `origin + size` on that axis.
    let screen = screens
        .iter()
        .find(|s| {
            let f = s.frame();
            cursor.x >= f.origin.x
                && cursor.x <= f.origin.x + f.size.width
                && cursor.y >= f.origin.y
                && cursor.y <= f.origin.y + f.size.height
        })
        .or_else(|| NSScreen::mainScreen(mtm))
        .or_else(|| screens.iter().next())?;
    let f = screen.frame();
    let v = screen.visibleFrame();
    Some((
        (f.origin.x, f.origin.y, f.size.width, f.size.height),
        (v.origin.x, v.origin.y, v.size.width, v.size.height),
    ))
}

/// Applies an AppKit-space frame (points, bottom-left origin) to the window
/// in one `setFrame` call — skipped entirely when the window is already
/// there. Two back-to-back resizes (approximate, then corrected) on this
/// backdrop-filter-heavy WKWebView used to leave part of the window showing
/// stale pixels (wallpaper-mode glass cards rendering as a frozen, blurred
/// smear until a full reload), and `setFrame_display(_, true)` forces a
/// redisplay even when nothing changed, so re-opening the drawer in the same
/// spot shouldn't touch AppKit's layout/paint pipeline at all.
///
/// Must run on the main thread. Returns the frame in place afterward, for
/// the hover/leave-intent watcher snapshots.
pub fn set_window_frame(
    window: &tauri::WebviewWindow,
    (x, y, w, h): (f64, f64, f64, f64),
) -> Option<(f64, f64, f64, f64)> {
    let ptr = window.ns_window().ok()?;
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    let current = ns_window.frame();
    let unchanged = (current.origin.x - x).abs() < 0.5
        && (current.origin.y - y).abs() < 0.5
        && (current.size.width - w).abs() < 0.5
        && (current.size.height - h).abs() < 0.5;
    if !unchanged {
        let mut target = current; // reuse the type; every field is overwritten below
        target.origin.x = x;
        target.origin.y = y;
        target.size.width = w;
        target.size.height = h;
        ns_window.setFrame_display(target, true);
    }
    Some((x, y, w, h))
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
///
/// `activateIgnoringOtherApps(true)` IS still called below, same as tao's
/// path — omitting it (as this function originally did) makes our window
/// key *within our own app*, but doesn't take frontmost-application status
/// away from whatever app currently has it. Invoking spotlight while a
/// different app (e.g. VS Code) is focused then shows the window without
/// actually routing keyboard input to it: the OS keeps delivering keystrokes
/// to the still-frontmost other app, so the search input never receives
/// focus even though `makeKeyWindow()` succeeded at the window level.
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
    if let Some(mtm) = objc2::MainThreadMarker::new() {
        NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
    }
}

/// Dock/sidebar-only: joins whatever Space(s) are currently active/on-screen
/// (including a fullscreen one belonging to another app) via the same private
/// Spaces API `show_over_fullscreen_spaces` uses for the spotlight overlay —
/// but, unlike that function, does NOT raise the window's level, mark it
/// `Stationary`/`IgnoresCycle`, or steal key-window focus. The drawer/handle
/// must stay a normal, single-level, Cmd+Tab-able window reachable from the
/// in-app "back to full window" control (see `allow_over_fullscreen_spaces`'s
/// doc comment for the regression that came from skipping that constraint).
///
/// A CGS Space join is a one-time snapshot of whatever Space is active right
/// now, not a standing subscription — call this again whenever the window is
/// (re)shown AND periodically while it stays visible, so it keeps following
/// the user across later Space switches instead of only covering the Space
/// active at the moment it was first expanded/collapsed.
///
/// Note: per the module doc comment, an elevated window level
/// (`NSStatusWindowLevel`+) is what actually lets a window's *content* render
/// above another app's fullscreen Space, separate from merely joining that
/// Space. Skipping the elevated level here (as requested, to avoid the
/// regression above) means the dock/sidebar joins the fullscreen Space but
/// may still render behind that app's own content — this needs verifying
/// against a real fullscreen app before relying on it.
pub fn join_fullscreen_space(window: &tauri::WebviewWindow) {
    let Ok(ptr) = window.ns_window() else { return };
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    super::cgs::join_active_spaces(ns_window.windowNumber() as i64);
}

/// Global screen-coordinate location of the real system cursor (AppKit's
/// bottom-left-origin space), regardless of which app is currently active.
/// Needed for the handle's hover-to-expand behaviour: a WKWebView's DOM hover
/// events (`:hover`, `mouseenter`/`mouseleave`) are backed by an
/// `NSTrackingArea` created with the default `.activeInActiveApp` option,
/// which only fires while *this* app is the active/frontmost one — never
/// true for a handle that sits at the screen edge over whatever app the user
/// is actually using, so the DOM events silently never fire. Polling the real
/// cursor position from the Rust side sidesteps that restriction entirely.
///
/// Unlike the rest of this file, this is safe to call from a background
/// thread: `NSEvent.mouseLocation` only reads global window-server cursor
/// state — it doesn't touch any NSWindow/NSView, which is what forces the
/// other functions here onto the main thread.
pub fn cursor_location() -> (f64, f64) {
    let point = NSEvent::mouseLocation();
    (point.x, point.y)
}

/// AppKit screen-coordinate frame (bottom-left origin), as
/// `(x, y, width, height)`, of a window's current position — a one-time
/// snapshot meant to be cached by the caller and compared against repeated
/// `cursor_location()` polls, rather than re-read on every poll tick (which
/// would need a `run_on_main_thread` round-trip per tick, since — unlike
/// `cursor_location` — this does touch the NSWindow).
pub fn window_frame(window: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let ptr = window.ns_window().ok()?;
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    let frame = ns_window.frame();
    Some((frame.origin.x, frame.origin.y, frame.size.width, frame.size.height))
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
