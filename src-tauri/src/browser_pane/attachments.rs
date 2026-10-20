// Honour `Content-Disposition: attachment` in browser panes (macOS).
//
// wry decides "show or download" from the MIME type alone: it downloads only
// what WebKit can't display. So a server that says "this is a download" for a
// type WebKit *can* show — a CSV or PDF export (Google Sheets' File ▸
// Download), a .txt, an image — got displayed in the pane, or nowhere, and
// never reached the Shelf. Browsers download those.
//
// wry has no hook for this, so we wrap its navigation delegate's
// `webView:decidePolicyForNavigationResponse:decisionHandler:`: for a pane
// (never the main CoolDesk page) whose response carries an attachment
// disposition we answer Download; everything else goes to wry's original
// implementation untouched. The delegate class is shared by all wry
// webviews, so this is installed once.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use block2::Block;
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2_foundation::NSString;

// WKNavigationResponsePolicy
const POLICY_ALLOW: isize = 1;
const POLICY_DOWNLOAD: isize = 2;

static INSTALLED: AtomicBool = AtomicBool::new(false);
static ORIGINAL: AtomicUsize = AtomicUsize::new(0);

type DecideFn = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject, *mut Block<dyn Fn(isize)>);

pub fn install(wv: &tauri::Webview) {
    if INSTALLED.load(Ordering::Relaxed) {
        return;
    }
    let _ = wv.with_webview(|pw| unsafe {
        if INSTALLED.load(Ordering::Relaxed) {
            return;
        }
        let view = pw.inner() as *mut AnyObject;
        let delegate: *mut AnyObject = msg_send![view, navigationDelegate];
        if delegate.is_null() {
            return;
        }
        let cls = objc2::ffi::object_getClass(delegate) as *mut AnyClass;
        let name = objc2::sel!(webView:decidePolicyForNavigationResponse:decisionHandler:);
        let method = objc2::ffi::class_getInstanceMethod(cls, name) as *mut objc2::runtime::Method;
        if method.is_null() {
            return;
        }
        let ours: Imp = std::mem::transmute(decide as DecideFn);
        let original = objc2::ffi::method_setImplementation(method, ours);
        // Kept for fallthrough; `decide` allows the response if it's missing.
        if let Some(original) = original {
            ORIGINAL.store(original as usize, Ordering::Relaxed);
        }
        INSTALLED.store(true, Ordering::Relaxed);
        log::info!("[BrowserPane] attachment responses now download to the Shelf");
    });
}

/// `Content-Disposition` of an HTTP response, if any.
unsafe fn disposition(response: *mut AnyObject) -> Option<String> {
    if response.is_null() {
        return None;
    }
    let is_http: bool = msg_send![response, isKindOfClass: objc2::class!(NSHTTPURLResponse)];
    if !is_http {
        return None;
    }
    let header = NSString::from_str("Content-Disposition");
    let value: *mut NSString = msg_send![response, valueForHTTPHeaderField: &*header];
    value.as_ref().map(|v| v.to_string())
}

unsafe extern "C-unwind" fn decide(
    this: *mut AnyObject,
    cmd: Sel,
    webview: *mut AnyObject,
    navigation_response: *mut AnyObject,
    handler: *mut Block<dyn Fn(isize)>,
) {
    let is_pane = !webview.is_null() && webview as usize != super::main_webview_ptr();
    if is_pane && !navigation_response.is_null() {
        let response: *mut AnyObject = msg_send![navigation_response, response];
        if let Some(value) = disposition(response) {
            if value.trim_start().to_ascii_lowercase().starts_with("attachment") {
                if let Some(h) = handler.as_ref() {
                    log::info!("[BrowserPane] attachment response → download ({value})");
                    h.call((POLICY_DOWNLOAD,));
                    return;
                }
            }
        }
    }
    let original = ORIGINAL.load(Ordering::Relaxed);
    if original != 0 {
        let f: DecideFn = std::mem::transmute(original);
        f(this, cmd, webview, navigation_response, handler);
    } else if let Some(h) = handler.as_ref() {
        // No original to defer to: allow, as wry does for showable types —
        // never leave WebKit waiting on an unanswered decision.
        h.call((POLICY_ALLOW,));
    }
}
