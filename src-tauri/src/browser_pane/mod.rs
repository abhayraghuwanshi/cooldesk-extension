// In-app browser pane: a native child webview pinned over a slot in the main
// window's React layout (the "Browse" face). Unlike `webapp_embed` (Windows-only,
// adopts the user's real Chrome window) this is the OS webview itself — WebKit
// on macOS, WebView2 on Windows, WebKitGTK on Linux — so it works everywhere
// and adds nothing to the bundle, at the cost of its own cookie jar and no
// extension.
//
// The frontend owns the layout: it measures its placeholder element and calls
// `browser_pane_set_bounds` whenever that moves, and hides the pane whenever
// HTML has to draw over it (the webview is a native layer above the page).
//
// Requires tauri's `unstable` feature (multi-webview `Window::add_child`).
// Pages loaded here are untrusted: `guard_remote_webviews` in lib.rs rejects
// every app command from webviews with this label prefix.

pub mod adblock;
#[cfg(target_os = "macos")]
pub mod tools;
/// Page tools are WebKit-only for now; elsewhere these are no-ops.
#[cfg(not(target_os = "macos"))]
pub mod tools {
    pub fn install(_app: &tauri::AppHandle, _wv: &tauri::Webview) {}
    pub fn refresh_pages(_app: &tauri::AppHandle, _url: &str) {}
    #[tauri::command]
    pub fn browser_pane_highlight_focus(_id: String, _highlight: String) -> Result<(), String> {
        Err("Highlights aren't available on this platform yet".into())
    }
    #[tauri::command]
    pub fn browser_pane_find(_id: String, _query: String, _step: i32) -> Result<serde_json::Value, String> {
        Err("Find isn't available on this platform yet".into())
    }
    #[tauri::command]
    pub fn page_dark_hosts() -> Vec<String> {
        Vec::new()
    }
    #[tauri::command]
    pub fn browser_pane_set_dark(_id: String, _on: bool) -> Result<bool, String> {
        Err("Dark mode isn't available on this platform yet".into())
    }
    #[tauri::command]
    pub fn browser_pane_screenshot(_id: String) -> Result<crate::shelf::ShelfItem, String> {
        Err("Screenshots aren't available on this platform yet".into())
    }
}
#[cfg(target_os = "macos")]
pub mod attachments;
#[cfg(target_os = "macos")]
pub mod permissions;
#[cfg(target_os = "macos")]
pub mod webcrypto;
pub mod stats;

use serde::Serialize;
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

pub const LABEL_PREFIX: &str = "browser-pane-";

fn label_for(id: &str) -> String {
    // Webview labels only allow [a-zA-Z0-9-/:_]
    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    format!("{LABEL_PREFIX}{safe}")
}

fn parse_web_url(url: &str) -> Result<tauri::Url, String> {
    let parsed: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Only http(s) URLs can be opened in the browser pane".into());
    }
    Ok(parsed)
}

/// Emitted as `browser-pane-state` so the toolbar can follow in-page navigation.
#[derive(Clone, Serialize)]
struct PaneState {
    id: String,
    url: Option<String>,
    title: Option<String>,
    loading: Option<bool>,
}

/// Open (or re-target) the pane `id` at the given window-relative logical rect.
/// `adblock` sets content blocking for this load (see `adblock.rs`).
#[tauri::command]
pub async fn browser_pane_open(
    app: tauri::AppHandle,
    id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    adblock: Option<bool>,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let result = open_pane(app, id.clone(), url, x, y, width, height, adblock).await;
    match &result {
        Ok(()) => log::info!("[BrowserPane] opened {id} in {}ms", started.elapsed().as_millis()),
        Err(e) => log::warn!("[BrowserPane] open {id} failed: {e}"),
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn open_pane(
    app: tauri::AppHandle,
    id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    adblock: Option<bool>,
) -> Result<(), String> {
    let parsed = parse_web_url(&url)?;
    let label = label_for(&id);
    let adblock = adblock.unwrap_or(true);
    log::info!("[BrowserPane] open {label} → {parsed} at ({x:.0},{y:.0}) {width:.0}x{height:.0} adblock={adblock}");

    if let Some(wv) = app.get_webview(&label) {
        return retarget(&wv, parsed, x, y, width, height, adblock);
    }

    // get_window/get_webview, not get_webview_window("main"): once the first
    // pane is added the main window holds two webviews and Tauri no longer
    // counts it as a webview window — that lookup returned None and every
    // pane after the first failed with "Main window is not open".
    let window = app.get_window("main").ok_or("Main window is not open")?;
    #[cfg(target_os = "macos")]
    if let Some(main_page) = app.get_webview("main") {
        remember_main_webview(&main_page);
    }

    let load_id = id.clone();
    let title_id = id.clone();
    // Start blank so content blocking is attached before the real page's
    // first request; the navigate below is queued after it on the main thread.
    let blank: tauri::Url = "about:blank".parse().map_err(|e| format!("{e}"))?;
    #[allow(unused_mut)]
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(blank));
    #[cfg(target_os = "macos")]
    {
        builder = builder.user_agent(safari_user_agent());
    }
    let builder = builder
        .on_page_load(move |wv, payload| {
            if payload.url().scheme() == "about" {
                return;
            }
            let _ = wv.emit(
                "browser-pane-state",
                PaneState {
                    id: load_id.clone(),
                    url: Some(payload.url().to_string()),
                    title: None,
                    loading: Some(matches!(payload.event(), tauri::webview::PageLoadEvent::Started)),
                },
            );
        })
        // Downloads go to the Shelf (temporary space in app data) instead of
        // ~/Downloads; without a handler WebKit dropped them entirely.
        .on_download(crate::shelf::download_handler(app.clone()))
        // Let pages get native file drops (dragging a file from the Files
        // panel onto an upload zone). Tauri's own handler would otherwise
        // swallow them into app-level drag-drop events.
        .disable_drag_drop_handler()
        // Web pages only. Dropping a file onto a part of a page that isn't a
        // drop zone makes WebKit navigate the pane to that file:// URL,
        // replacing the site — refuse it (and any other non-web scheme).
        // Upload fields and drop zones still get the file: those are page
        // events, not navigations. `about:` is the blank start page.
        .on_navigation(|url| {
            let allowed = matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data");
            if cfg!(debug_assertions) && url.scheme() != "about" {
                log::info!("[BrowserPane] navigate {} {url}", if allowed { "→" } else { "refused" });
            }
            allowed
        })
        // window.open / target=_blank: no new windows for remote pages (wry
        // drops them when unhandled, so those links did nothing). Web links
        // open in this same pane; anything else (javascript:, custom
        // schemes) is refused.
        .on_new_window({
            let app = app.clone();
            let label = label.clone();
            move |url, _features| {
                if !matches!(url.scheme(), "http" | "https") {
                    return tauri::webview::NewWindowResponse::Deny;
                }
                // Browse tabs: open it as a new tab beside this one (the UI
                // owns tabs). Canvas tiles: load it in the tile.
                if label.starts_with(&format!("{LABEL_PREFIX}bt-")) {
                    if cfg!(debug_assertions) {
                        log::info!("[BrowserPane] pop-up → new tab: {url}");
                    }
                    let _ = app.emit("browser-pane-popup", serde_json::json!({ "label": label, "url": url.to_string() }));
                } else if let Some(wv) = app.get_webview(&label) {
                    let _ = wv.navigate(url);
                }
                tauri::webview::NewWindowResponse::Deny
            }
        })
        .on_document_title_changed(move |wv, title| {
            let _ = wv.emit(
                "browser-pane-state",
                PaneState { id: title_id.clone(), url: None, title: Some(title), loading: None },
            );
        });

    match window.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height)) {
        Ok(wv) => {
            #[cfg(target_os = "macos")]
            {
                permissions::install(&wv);
                webcrypto::install(&wv);
                attachments::install(&wv);
                round_corners(&wv, SLOT_RADIUS);
                enable_element_fullscreen(&wv);
            }
            // Before the first navigation, so the user script is in place.
            tools::install(&app, &wv);
            place(&wv, x, y, width, height)?;
            adblock::set_enabled(&wv, adblock);
            wv.navigate(parsed).map_err(|e| e.to_string())
        }
        // Two opens raced (e.g. a quick double click): the other one created
        // the pane between our lookup and add_child, so just re-target it.
        Err(e) => match app.get_webview(&label) {
            Some(wv) => retarget(&wv, parsed, x, y, width, height, adblock),
            None => {
                log::warn!("[BrowserPane] add_child failed: {e}");
                Err(format!("Failed to open browser pane: {e}"))
            }
        },
    }
}

/// The user agent Safari itself sends. An embedded WKWebView's default omits
/// the trailing `Version/… Safari/…`, which sites read as "an app's built-in
/// browser" — Google sign-in ("This browser may not be secure") and services
/// like Hotstar refuse it. The engine *is* Safari's WebKit, so claiming Safari
/// is accurate. The version comes from the installed Safari, so it tracks
/// Safari updates; the OS part stays at 10_15_7, which Safari also freezes.
#[cfg(target_os = "macos")]
fn safari_user_agent() -> &'static str {
    static UA: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    UA.get_or_init(|| {
        let version = std::fs::read_to_string("/Applications/Safari.app/Contents/Info.plist")
            .ok()
            .and_then(|plist| {
                let after_key = plist.split("<key>CFBundleShortVersionString</key>").nth(1)?;
                let value = after_key.split("<string>").nth(1)?.split("</string>").next()?;
                Some(value.trim().to_string())
            })
            .filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit() || c == '.'))
            .unwrap_or_else(|| "26.0".to_string());
        let ua = format!(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{version} Safari/605.1.15"
        );
        log::info!("[BrowserPane] user agent: {ua}");
        ua
    })
}

/// Pin the pane to a rect given in the main page's CSS coordinates.
///
/// Elsewhere this is plain set_position/set_size. On macOS those are relative
/// to the window's content view, but the main page doesn't always fill it: once
/// the dock has toggled decorations off and on, the content view also spans the
/// title bar, and the pane landed a title bar's height too high (over its own
/// toolbar). So on macOS the rect is converted from the main webview's own
/// coordinate space — what getBoundingClientRect is relative to.
fn place(wv: &tauri::Webview, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if MAIN_WEBVIEW.load(std::sync::atomic::Ordering::Relaxed) != 0 {
            return wv
                .with_webview(move |pw| unsafe { mac_place(pw.inner() as usize, x, y, width, height) })
                .map_err(|e| e.to_string());
        }
    }
    wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}

/// The main window's WKWebView (as an address), the reference frame for panes.
#[cfg(target_os = "macos")]
static MAIN_WEBVIEW: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Address of the main CoolDesk page's WKWebView (0 until a pane opens).
#[cfg(target_os = "macos")]
pub fn main_webview_ptr() -> usize {
    MAIN_WEBVIEW.load(std::sync::atomic::Ordering::Relaxed)
}

#[cfg(target_os = "macos")]
fn remember_main_webview(main: &tauri::Webview) {
    let _ = main.with_webview(|pw| {
        MAIN_WEBVIEW.store(pw.inner() as usize, std::sync::atomic::Ordering::Relaxed);
    });
}

/// Logs the main webview's safe-area inset when it changes (title bar shown
/// or hidden), to diagnose pane placement.
#[cfg(target_os = "macos")]
fn log_inset_change(top: f64, left: f64) {
    static LAST: std::sync::Mutex<Option<(i64, i64)>> = std::sync::Mutex::new(None);
    let key = (top.round() as i64, left.round() as i64);
    let mut last = LAST.lock().unwrap();
    if *last != Some(key) {
        *last = Some(key);
        log::info!("[BrowserPane] main webview safe-area inset top={top} left={left}");
    }
}

/// Main thread only (runs inside with_webview).
#[cfg(target_os = "macos")]
unsafe fn mac_place(child: usize, x: f64, y: f64, width: f64, height: f64) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let child = child as *mut AnyObject;
    if in_fullscreen(child) {
        return;
    }
    let main = MAIN_WEBVIEW.load(std::sync::atomic::Ordering::Relaxed) as *mut AnyObject;
    let parent: *mut AnyObject = msg_send![child, superview];
    if parent.is_null() || main.is_null() {
        return;
    }
    // The rect in the main webview's own coordinates (CSS px == points, origin
    // top-left when the view is flipped), converted by AppKit into whatever
    // view the pane hangs off — the main page may sit nested and offset
    // inside it, below a title bar.
    let bounds: NSRect = msg_send![main, bounds];
    let main_flipped: bool = msg_send![main, isFlipped];
    // When the window's title bar overlays the content (decorations restored
    // after docking), the main webview extends under it and WebKit pushes the
    // page down by the safe-area inset — so CSS y=0 sits `inset.top` below the
    // view's top edge.
    let has_insets: bool = msg_send![main, respondsToSelector: objc2::sel!(safeAreaInsets)];
    let inset: objc2_foundation::NSEdgeInsets = if has_insets {
        msg_send![main, safeAreaInsets]
    } else {
        objc2_foundation::NSEdgeInsets { top: 0.0, left: 0.0, bottom: 0.0, right: 0.0 }
    };
    log_inset_change(inset.top, inset.left);
    let (x, y) = (x + inset.left, y + inset.top);
    let local_y = if main_flipped { y } else { bounds.size.height - y - height };
    let local = NSRect::new(NSPoint::new(x, local_y), NSSize::new(width, height));
    let frame: NSRect = msg_send![main, convertRect: local, toView: parent];
    let _: () = msg_send![child, setFrame: frame];
}

/// Matches `.bp-slot`'s border-radius in browse.css, so the page sits in the
/// card instead of showing square corners over its rounded slot.
#[cfg(target_os = "macos")]
const SLOT_RADIUS: f64 = 12.0;

#[cfg(target_os = "macos")]
fn round_corners(wv: &tauri::Webview, radius: f64) {
    let _ = wv.with_webview(move |pw| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let view = pw.inner() as *mut AnyObject;
        let _: () = msg_send![view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: radius];
            let _: () = msg_send![layer, setMasksToBounds: true];
        }
    });
}

/// Lets pages go fullscreen (YouTube's fullscreen button, `requestFullscreen`).
/// WebKit ships this off and wry never turns it on, so the button did nothing.
/// `configuration` hands back a copy; its `preferences` is the same object the
/// live webview uses, which is what makes setting it after creation work.
#[cfg(target_os = "macos")]
fn enable_element_fullscreen(wv: &tauri::Webview) {
    let _ = wv.with_webview(|pw| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let view = pw.inner() as *mut AnyObject;
        let config: *mut AnyObject = msg_send![view, configuration];
        if config.is_null() {
            return;
        }
        let prefs: *mut AnyObject = msg_send![config, preferences];
        if prefs.is_null() {
            return;
        }
        // macOS 12.3+; on older systems the selector doesn't exist.
        let supported: bool = msg_send![prefs, respondsToSelector: objc2::sel!(setElementFullscreenEnabled:)];
        if supported {
            let _: () = msg_send![prefs, setElementFullscreenEnabled: true];
        }
    });
}

fn retarget(
    wv: &tauri::Webview,
    url: tauri::Url,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    adblock: bool,
) -> Result<(), String> {
    adblock::set_enabled(wv, adblock);
    wv.navigate(url).map_err(|e| e.to_string())?;
    place(wv, x, y, width, height)?;
    wv.show().map_err(|e| e.to_string())
}

/// Re-pin the pane over its slot, or hide it while the slot is off-screen /
/// covered by HTML (face transition, modal, spotlight).
#[tauri::command]
pub fn browser_pane_set_bounds(
    app: tauri::AppHandle,
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    reason: Option<String>,
) -> Result<(), String> {
    let Some(wv) = app.get_webview(&label_for(&id)) else { return Ok(()) };
    if cfg!(debug_assertions) {
        log::info!(
            "[BrowserPane] bounds {id}: {} ({x:.0},{y:.0}) {width:.0}x{height:.0}",
            reason.as_deref().map_or("shown".to_string(), |r| format!("hidden: {r}"))
        );
    }
    let visible = visible && width >= 1.0 && height >= 1.0;
    #[cfg(target_os = "macos")]
    {
        if MAIN_WEBVIEW.load(std::sync::atomic::Ordering::Relaxed) != 0 {
            // One main-thread pass, so the fullscreen check and the frame /
            // visibility change can't interleave with WebKit's own moves.
            return wv
                .with_webview(move |pw| unsafe {
                    use objc2::msg_send;
                    use objc2::runtime::AnyObject;
                    let view = pw.inner() as *mut AnyObject;
                    if in_fullscreen(view) {
                        return;
                    }
                    if !visible {
                        let _: () = msg_send![view, setHidden: true];
                        return;
                    }
                    mac_place(view as usize, x, y, width, height);
                    let _: () = msg_send![view, setHidden: false];
                })
                .map_err(|e| e.to_string());
        }
    }
    if !visible {
        return wv.hide().map_err(|e| e.to_string());
    }
    place(&wv, x, y, width, height)?;
    wv.show().map_err(|e| e.to_string())
}

/// True while WebKit has the page in element fullscreen (a video's fullscreen
/// button). WebKit then moves the view into its own fullscreen window in a new
/// Space; CoolDesk's window goes off-screen, so the frontend reports the slot
/// hidden — and hiding or re-framing the view then blanked the video. Leave it
/// alone until WebKit hands it back.
#[cfg(target_os = "macos")]
unsafe fn in_fullscreen(view: *mut objc2::runtime::AnyObject) -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let has_state: bool = msg_send![view, respondsToSelector: objc2::sel!(fullscreenState)];
    if has_state {
        let state: isize = msg_send![view, fullscreenState]; // macOS 13+
        if state != 0 {
            return true;
        }
    }
    // Any macOS: in fullscreen the view lives in a different window than the
    // main page.
    let main = MAIN_WEBVIEW.load(std::sync::atomic::Ordering::Relaxed) as *mut AnyObject;
    if main.is_null() {
        return false;
    }
    let window: *mut AnyObject = msg_send![view, window];
    let main_window: *mut AnyObject = msg_send![main, window];
    !window.is_null() && window != main_window
}

/// Toolbar actions: "back" | "forward" | "reload".
#[tauri::command]
pub fn browser_pane_nav(app: tauri::AppHandle, id: String, action: String) -> Result<(), String> {
    let wv = app.get_webview(&label_for(&id)).ok_or("Browser pane is not open")?;
    let js = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        other => return Err(format!("Unknown action: {other}")),
    };
    wv.eval(js).map_err(|e| e.to_string())
}

/// Page zoom (WKWebView pageZoom on macOS 11+, WebView2 zoom factor on
/// Windows). The pane zooms out to keep desktop layouts when it's narrow.
#[tauri::command]
pub fn browser_pane_set_zoom(app: tauri::AppHandle, id: String, zoom: f64) -> Result<(), String> {
    let Some(wv) = app.get_webview(&label_for(&id)) else { return Ok(()) };
    wv.set_zoom(zoom.clamp(0.3, 3.0)).map_err(|e| e.to_string())
}

/// Change blocking for an open pane (the toolbar shield); the frontend reloads
/// so it applies. Returns whether blocking is supported on this platform.
#[tauri::command]
pub fn browser_pane_set_adblock(app: tauri::AppHandle, id: String, enabled: bool) -> Result<bool, String> {
    match app.get_webview(&label_for(&id)) {
        Some(wv) => Ok(adblock::set_enabled(&wv, enabled)),
        None => Ok(adblock::supported()),
    }
}

#[tauri::command]
pub fn browser_pane_adblock_supported() -> bool {
    adblock::supported()
}

#[tauri::command]
pub fn browser_pane_close(app: tauri::AppHandle, id: String) -> Result<(), String> {
    adblock::forget(&label_for(&id));
    match app.get_webview(&label_for(&id)) {
        Some(wv) => wv.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}
