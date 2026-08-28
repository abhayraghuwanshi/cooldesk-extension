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

/// Positions the vertical sidebar panel directly via AppKit, in one call,
/// instead of `expand_drawer` setting it approximately through Tauri's
/// cross-platform position API first and correcting it a moment later.
/// That two-step version (resize approximately, then immediately resize
/// again to the corrected frame) used to be two separate `setFrame` passes
/// on every single drawer open, including re-opening in the exact same
/// spot — and two back-to-back resizes on this backdrop-filter-heavy
/// WKWebView is exactly the kind of repaint that can leave part of the
/// window showing stale pixels (some wallpaper-mode glass cards render as a
/// frozen, blurred smear over only part of the panel until a full reload).
/// Computing the correct frame up front and applying it once, only when it
/// actually differs from the window's current frame, avoids that condition
/// entirely rather than papering over its symptom.
///
/// Takes over from two separate problems the old two-step version worked
/// around after the fact:
///
/// 1. Tauri's cross-platform position API (tao's `set_outer_position` →
///    `window_position()`) flips tao's top-down Y into AppKit's bottom-up Y
///    using only `CGDisplay::main().pixels_high()` — the *primary*
///    display's height — regardless of which screen the window is actually
///    on. On a secondary monitor this produces a wrong Y (observed: the
///    panel pinned flush to y=0 instead of respecting `SIDEBAR_MARGIN`).
/// 2. `expand_drawer`'s own geometry calc sizes the vertical panel against
///    the monitor's *full* physical rect (deliberately, for the flush-edge
///    historical behavior — see `drawer_geom`'s doc comment), not its
///    menu-bar/Dock-excluded `visibleFrame`. Each display gets its own menu
///    bar in a multi-monitor setup, so a small `SIDEBAR_MARGIN` from the raw
///    physical top edge still lands the panel's top underneath that
///    display's menu bar (observed: no visible gap at all, top or bottom).
///
/// `target_x`/`target_w` (in points) come from `expand_drawer`'s own calc —
/// neither problem above touches them (no Y flip involved, and the sidebar
/// was always narrower than the monitor), so they're taken as correct and
/// only `y`/`height` are re-derived here from `visibleFrame`.
///
/// Must run on the main thread — same constraints as `clamp_to_visible_frame`.
/// Returns the frame actually in place afterward (applied or already
/// current), for the leave-intent watcher snapshot.
pub fn position_sidebar_panel(
    window: &tauri::WebviewWindow,
    target_x: f64,
    target_w: f64,
    margin_logical: f64,
) -> Option<(f64, f64, f64, f64)> {
    let Ok(ptr) = window.ns_window() else { return None };
    let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };

    // Find the screen by horizontal containment rather than trusting
    // `ns_window.screen()` (which picks whichever NSScreen the window's
    // *current* frame — possibly still at some unrelated previous
    // position/size — overlaps most).
    let Some(mtm) = objc2::MainThreadMarker::new() else { return None };
    let screens = NSScreen::screens(mtm);
    let visible = screens
        .iter()
        .find(|s| {
            let f = s.frame();
            target_x >= f.origin.x && target_x < f.origin.x + f.size.width
        })
        .or_else(|| ns_window.screen())
        // Last resort: any screen at all (e.g. the very first `expand_drawer`
        // call on a freshly built, never-shown window, where `target_x` may
        // not land on a known screen's frame and the window has no screen of
        // its own yet). Without this, both lookups failing left the window
        // silently unpositioned — shown at whatever stale/default frame it
        // already had — instead of at least landing on *a* screen.
        .or_else(|| screens.iter().next())
        .map(|s| s.visibleFrame())?;

    let mut target = ns_window.frame(); // reuse the type; every field is overwritten below
    target.origin.x = target_x;
    target.origin.y = visible.origin.y + margin_logical;
    target.size.width = target_w;
    target.size.height = (visible.size.height - margin_logical * 2.0).max(1.0);

    // `setFrame_display(_, true)` forces AppKit to redisplay the window even
    // when nothing about the frame actually changed — skip it entirely when
    // the target already matches the window's current frame (within a
    // fraction of a point, to tolerate float rounding), so re-opening the
    // drawer in the same spot doesn't touch AppKit's layout/paint pipeline
    // at all.
    let current = ns_window.frame();
    let unchanged = (current.origin.x - target.origin.x).abs() < 0.5
        && (current.origin.y - target.origin.y).abs() < 0.5
        && (current.size.width - target.size.width).abs() < 0.5
        && (current.size.height - target.size.height).abs() < 0.5;
    if !unchanged {
        ns_window.setFrame_display(target, true);
    }
    Some((target.origin.x, target.origin.y, target.size.width, target.size.height))
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
