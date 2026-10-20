// Page tools (macOS): highlights and notes on pages in the browser pane.
//
// tools.js is injected into every pane as a WKUserScript in a named content
// world, "cooldesk". A content world shares the page's DOM but not its
// JavaScript, so the site can neither see nor call our code. The way back to
// the app is a WKScriptMessageHandler registered *in that world only*:
// `window.webkit.messageHandlers.cooldesk` doesn't exist for the page's own
// scripts, so a site can't post to it. This keeps the browser pane's rule —
// pages get no app commands — intact.
//
// The page's URL is always read from the WKWebView natively, never taken from
// the message. Storage and validation live in crate::annotations.

use std::sync::{Mutex, OnceLock};

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_foundation::NSString;
use objc2_web_kit::{
    WKContentWorld, WKScriptMessage, WKScriptMessageHandler, WKUserContentController, WKUserScript,
    WKUserScriptInjectionTime, WKWebView,
};
use tauri::Manager;

use crate::annotations;

const WORLD: &str = "cooldesk";
const HANDLER: &str = "cooldesk";
const TOOLS_JS: &str = include_str!("tools.js");
/// Bigger messages are dropped outright (a quote is capped at 4 KB anyway).
const MAX_MESSAGE: usize = 64 * 1024;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

pub struct HandlerIvars {
    label: String,
}

define_class!(
    // Receives messages posted from tools.js (our content world only).
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "CoolDeskPageToolsHandler"]
    #[ivars = HandlerIvars]
    struct PageToolsHandler;

    unsafe impl NSObjectProtocol for PageToolsHandler {}

    unsafe impl WKScriptMessageHandler for PageToolsHandler {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn did_receive(&self, _controller: &WKUserContentController, message: &WKScriptMessage) {
            on_message(&self.ivars().label, message);
        }
    }
);

impl PageToolsHandler {
    fn new(mtm: MainThreadMarker, label: String) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(HandlerIvars { label });
        unsafe { msg_send![super(this), init] }
    }
}

fn world(mtm: MainThreadMarker) -> Retained<WKContentWorld> {
    unsafe { WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm) }
}

/// Current URL of a WKWebView, read natively.
unsafe fn page_url(view: &WKWebView) -> Option<String> {
    let url: *mut AnyObject = msg_send![view, URL];
    let url = url.as_ref()?;
    let s: *mut NSString = msg_send![url, absoluteString];
    s.as_ref().map(|s| s.to_string())
}

/// Run `js` inside our content world (not the page's).
unsafe fn eval_in_world(view: &WKWebView, js: &str) {
    let mtm = MainThreadMarker::new_unchecked();
    view.evaluateJavaScript_inFrame_inContentWorld_completionHandler(&NSString::from_str(js), None, &world(mtm), None);
}

/// Run `js` in our world and hand its (string) result to `done` once.
unsafe fn eval_in_world_then(view: &WKWebView, js: &str, done: impl FnOnce(Option<String>) + 'static) {
    let mtm = MainThreadMarker::new_unchecked();
    let done = Mutex::new(Some(done));
    let block = block2::RcBlock::new(move |result: *mut AnyObject, _err: *mut objc2_foundation::NSError| {
        let text = result.as_ref().and_then(|r| r.downcast_ref::<NSString>()).map(|s| s.to_string());
        if let Some(f) = done.lock().unwrap().take() {
            f(text);
        }
    });
    view.evaluateJavaScript_inFrame_inContentWorld_completionHandler(&NSString::from_str(js), None, &world(mtm), Some(&block));
}

/// Push the saved highlights (and the site's dark-mode setting) for whatever
/// page `view` shows.
unsafe fn apply(app: &tauri::AppHandle, view: &WKWebView) {
    let Some(url) = page_url(view) else { return };
    if !url.starts_with("http") {
        return;
    }
    let list = annotations::list_for(app, &url);
    let json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".into());
    let dark = host_of(&url).is_some_and(|h| dark_hosts(app).contains(&h));
    eval_in_world(view, &format!("window.__cdTools && (window.__cdTools.apply({json}), window.__cdTools.setDark({dark}))"));
}

fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url).ok()?.host_str().map(|h| h.trim_start_matches("www.").to_string())
}

// ── Per-site preferences (dark mode) ─────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct PagePrefs {
    #[serde(default)]
    dark: Vec<String>,
}

static PREFS_LOCK: Mutex<()> = Mutex::new(());

fn prefs_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("page_prefs.json"))
}

fn read_prefs(app: &tauri::AppHandle) -> PagePrefs {
    prefs_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn dark_hosts(app: &tauri::AppHandle) -> Vec<String> {
    let _guard = PREFS_LOCK.lock().unwrap();
    read_prefs(app).dark
}

/// Pane by its frontend id, plus its WKWebView on the main thread.
fn pane(app: &tauri::AppHandle, id: &str) -> Result<tauri::Webview, String> {
    app.get_webview(&format!("{}{}", super::LABEL_PREFIX, id)).ok_or_else(|| "Browser pane is not open".into())
}

/// Run on the pane's WKWebView (main thread) and wait for `f`'s result.
fn with_view<T: Send + 'static>(
    wv: &tauri::Webview,
    f: impl FnOnce(&WKWebView, std::sync::mpsc::Sender<T>) + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    wv.with_webview(move |pw| unsafe { f(&*(pw.inner() as *const WKWebView), tx) })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| "The page didn't respond".to_string())
}

fn on_message(label: &str, message: &WKScriptMessage) {
    let Some(app) = APP.get() else { return };
    let (body, view) = unsafe { (message.body(), message.webView()) };
    let Some(view) = view else { return };
    let Some(text) = body.downcast_ref::<NSString>().map(|s| s.to_string()) else { return };
    if text.len() > MAX_MESSAGE {
        return;
    }
    let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    let Some(url) = (unsafe { page_url(&view) }) else { return };
    let str_field = |k: &str| msg.get(k).and_then(|v| v.as_str()).map(str::to_string);

    let result = match msg.get("type").and_then(|t| t.as_str()) {
        Some("ready") => {
            if cfg!(debug_assertions) {
                log::info!("[PageTools] {label} ready on {url}");
            }
            unsafe { apply(app, &view) };
            Ok(())
        }
        Some("create") => match msg.get("highlight").cloned().map(serde_json::from_value::<annotations::Highlight>) {
            Some(Ok(h)) => annotations::create(app, &url, &str_field("title").unwrap_or_default(), h),
            _ => Err("bad highlight".into()),
        },
        Some("update") => match str_field("id") {
            Some(id) => annotations::update(app, &url, &id, str_field("color"), str_field("note")).map(|_| ()),
            None => Err("no id".into()),
        },
        Some("delete") => match str_field("id") {
            Some(id) => annotations::delete(app, &url, &id).map(|_| ()),
            None => Err("no id".into()),
        },
        // Browser shortcuts pressed while the page had focus (the keys never
        // reach CoolDesk's own document). Only these combos are forwarded.
        Some("shortcut") => match str_field("key").as_deref() {
            Some(key @ ("mod+t" | "mod+l" | "mod+[" | "mod+]" | "mod+r" | "mod+f" | "next-tab" | "prev-tab"
                | "tab-1" | "tab-2" | "tab-3" | "tab-4" | "tab-5" | "tab-6" | "tab-7" | "tab-8" | "tab-9")) => {
                use tauri::Emitter;
                let _ = app.emit("browser-pane-shortcut", serde_json::json!({ "label": label, "key": key }));
                return;
            }
            _ => Err("unknown shortcut".into()),
        },
        _ => Err("unknown message".into()),
    };
    match result {
        // Other panes on the same page (canvas tiles) pick the change up.
        Ok(()) if !matches!(msg.get("type").and_then(|t| t.as_str()), Some("ready")) => refresh_pages_except(app, &url, Some(label)),
        Ok(()) => {}
        Err(e) => log::warn!("[PageTools] {label}: {e}"),
    }
}

/// Install the page tools on a new pane (before its first real navigation, so
/// the user script is in place for the first page).
pub fn install(app: &tauri::AppHandle, wv: &tauri::Webview) {
    let _ = APP.set(app.clone());
    let label = wv.label().to_string();
    let _ = wv.with_webview(move |pw| unsafe {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let view = &*(pw.inner() as *const WKWebView);
        let controller = view.configuration().userContentController();
        let world = world(mtm);
        let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
            WKUserScript::alloc(mtm),
            &NSString::from_str(TOOLS_JS),
            WKUserScriptInjectionTime::AtDocumentEnd,
            true,
            &world,
        );
        controller.addUserScript(&script);
        let handler = PageToolsHandler::new(mtm, label);
        controller.addScriptMessageHandler_contentWorld_name(
            ProtocolObject::from_ref(&*handler),
            &world,
            &NSString::from_str(HANDLER),
        );
    });
}

fn refresh_pages_except(app: &tauri::AppHandle, url: &str, except: Option<&str>) {
    let target = annotations::normalize_url(url);
    for (label, wv) in app.webviews() {
        if !label.starts_with(super::LABEL_PREFIX) || Some(label.as_str()) == except {
            continue;
        }
        let app = app.clone();
        let target = target.clone();
        let _ = wv.with_webview(move |pw| unsafe {
            let view = &*(pw.inner() as *const WKWebView);
            if page_url(view).map(|u| annotations::normalize_url(&u)) == Some(target) {
                apply(&app, view);
            }
        });
    }
}

/// Re-apply highlights on every pane showing `url` (after an edit from the
/// Notes panel).
pub fn refresh_pages(app: &tauri::AppHandle, url: &str) {
    refresh_pages_except(app, url, None);
}

/// Find in page: highlights every match and scrolls to the current one.
/// `step` 1 / -1 moves to the next / previous match; an empty query clears.
#[tauri::command]
pub async fn browser_pane_find(app: tauri::AppHandle, id: String, query: String, step: i32) -> Result<serde_json::Value, String> {
    let wv = pane(&app, &id)?;
    let js = if query.is_empty() {
        "window.__cdTools ? (window.__cdTools.clearFind(), '{\"count\":0,\"index\":0}') : null".to_string()
    } else {
        let q = serde_json::to_string(&query).map_err(|e| e.to_string())?;
        format!("window.__cdTools ? window.__cdTools.find({q}, {step}) : null")
    };
    let text = with_view(&wv, move |view, tx| unsafe {
        eval_in_world_then(view, &js, move |r| { let _ = tx.send(r); });
    })?;
    text.and_then(|t| serde_json::from_str(&t).ok())
        .ok_or_else(|| "Find isn't available on this page".into())
}

/// Hosts with dark mode on (the toolbar's moon state).
#[tauri::command]
pub fn page_dark_hosts(app: tauri::AppHandle) -> Vec<String> {
    dark_hosts(&app)
}

/// Turn dark mode on/off for the site in this pane (remembered per site).
#[tauri::command]
pub async fn browser_pane_set_dark(app: tauri::AppHandle, id: String, on: bool) -> Result<bool, String> {
    let wv = pane(&app, &id)?;
    let url = with_view(&wv, |view, tx| unsafe { let _ = tx.send(page_url(view)); })?.ok_or("No page")?;
    let host = host_of(&url).ok_or("Not a web page")?;
    {
        let _guard = PREFS_LOCK.lock().unwrap();
        let mut prefs = read_prefs(&app);
        prefs.dark.retain(|h| h != &host);
        if on {
            prefs.dark.push(host);
        }
        if let Some(path) = prefs_path(&app) {
            let _ = std::fs::write(path, serde_json::to_string(&prefs).unwrap_or_default());
        }
    }
    let _ = with_view(&wv, move |view, tx| unsafe {
        eval_in_world(view, &format!("window.__cdTools && window.__cdTools.setDark({on})"));
        let _ = tx.send(());
    });
    Ok(on)
}

/// Screenshot of the visible page, saved to the Shelf as a PNG.
#[tauri::command]
pub async fn browser_pane_screenshot(app: tauri::AppHandle, id: String) -> Result<crate::shelf::ShelfItem, String> {
    let wv = pane(&app, &id)?;
    let (png, url) = with_view(&wv, |view, tx| unsafe {
        let url = page_url(view);
        let tx = Mutex::new(Some(tx));
        let block = block2::RcBlock::new(move |image: *mut AnyObject, _err: *mut AnyObject| {
            let bytes = png_bytes(image);
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send((bytes, url.clone()));
            }
        });
        let none: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![view, takeSnapshotWithConfiguration: none, completionHandler: &*block];
    })?;
    let png = png.ok_or("Couldn't capture the page")?;
    let host = url.as_deref().and_then(host_of).unwrap_or_else(|| "page".into());
    let name = format!("Screenshot {host} {}.png", chrono::Local::now().format("%Y-%m-%d %H.%M.%S"));
    crate::shelf::add_file_bytes(&app, &name, &png, url)
}

/// NSImage → PNG bytes (via its bitmap representation).
unsafe fn png_bytes(image: *mut AnyObject) -> Option<Vec<u8>> {
    if image.is_null() {
        return None;
    }
    let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
    if tiff.is_null() {
        return None;
    }
    let rep: *mut AnyObject = msg_send![objc2::class!(NSBitmapImageRep), imageRepWithData: tiff];
    if rep.is_null() {
        return None;
    }
    let props: *mut AnyObject = msg_send![objc2::class!(NSDictionary), dictionary];
    // NSBitmapImageFileTypePNG = 4
    let data: *mut AnyObject = msg_send![rep, representationUsingType: 4usize, properties: props];
    if data.is_null() {
        return None;
    }
    let len: usize = msg_send![data, length];
    let ptr: *const u8 = msg_send![data, bytes];
    (!ptr.is_null()).then(|| std::slice::from_raw_parts(ptr, len).to_vec())
}

/// Scroll a pane to one of its highlights and flash it.
#[tauri::command]
pub fn browser_pane_highlight_focus(app: tauri::AppHandle, id: String, highlight: String) -> Result<(), String> {
    let wv = app
        .get_webview(&format!("{}{}", super::LABEL_PREFIX, id))
        .ok_or("Browser pane is not open")?;
    let arg = serde_json::to_string(&highlight).map_err(|e| e.to_string())?;
    wv.with_webview(move |pw| unsafe {
        let view = &*(pw.inner() as *const WKWebView);
        eval_in_world(view, &format!("window.__cdTools && window.__cdTools.focus({arg})"));
    })
    .map_err(|e| e.to_string())
}
