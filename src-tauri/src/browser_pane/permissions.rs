// Camera / microphone requests from web pages (macOS).
//
// wry's WKUIDelegate answers every `requestMediaCapturePermissionForOrigin`
// with Grant, for any origin and without asking. With remote sites in the
// browser pane (and webapp-* windows) that means the moment CoolDesk itself
// holds camera/mic access, every site would get it silently. We replace that
// one delegate method at runtime: CoolDesk's own origin keeps the grant; every
// other origin gets WKPermissionDecisionPrompt, WebKit's standard per-site
// "Allow … to use your camera?" prompt.
//
// The delegate class is wry's and shared by all its webviews, so the swap is
// installed once (first webview that has a delegate) and covers them all.

use std::sync::atomic::{AtomicBool, Ordering};

use block2::Block;
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2_foundation::NSString;

// WKPermissionDecision (NSInteger)
const PROMPT: isize = 0;
const GRANT: isize = 1;

static INSTALLED: AtomicBool = AtomicBool::new(false);

/// Install the replacement on wry's UI delegate class (idempotent).
pub fn install(wv: &tauri::Webview) {
    if INSTALLED.load(Ordering::Relaxed) {
        return;
    }
    let _ = wv.with_webview(|pw| unsafe {
        if INSTALLED.load(Ordering::Relaxed) {
            return;
        }
        let view = pw.inner() as *mut AnyObject;
        let delegate: *mut AnyObject = msg_send![view, UIDelegate];
        if delegate.is_null() {
            return;
        }
        let cls = objc2::ffi::object_getClass(delegate) as *mut AnyClass;
        let name = objc2::sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:);
        let method = objc2::ffi::class_getInstanceMethod(cls, name);
        if method.is_null() {
            return;
        }
        let types = objc2::ffi::method_getTypeEncoding(method);
        let imp: Imp = std::mem::transmute(
            media_permission
                as unsafe extern "C-unwind" fn(
                    *mut AnyObject,
                    Sel,
                    *mut AnyObject,
                    *mut AnyObject,
                    *mut AnyObject,
                    isize,
                    *mut Block<dyn Fn(isize)>,
                ),
        );
        objc2::ffi::class_replaceMethod(cls, name, imp, types);
        INSTALLED.store(true, Ordering::Relaxed);
        log::info!("[BrowserPane] camera/mic requests from websites now prompt");
    });
}

/// CoolDesk's own pages: the bundled app origin, plus the dev server in dev.
unsafe fn is_app_origin(origin: *mut AnyObject) -> bool {
    if origin.is_null() {
        return false;
    }
    let read = |sel: &str| -> String {
        let s: *mut NSString = match sel {
            "protocol" => msg_send![origin, protocol],
            _ => msg_send![origin, host],
        };
        s.as_ref().map(|s| s.to_string()).unwrap_or_default()
    };
    let protocol = read("protocol");
    let host = read("host");
    if protocol == "tauri" || host == "tauri.localhost" {
        return true;
    }
    if cfg!(debug_assertions) && (host == "localhost" || host == "127.0.0.1") {
        let port: isize = msg_send![origin, port];
        return port == 5173;
    }
    false
}

unsafe extern "C-unwind" fn media_permission(
    _this: *mut AnyObject,
    _cmd: Sel,
    _webview: *mut AnyObject,
    origin: *mut AnyObject,
    _frame: *mut AnyObject,
    _capture_type: isize,
    decision_handler: *mut Block<dyn Fn(isize)>,
) {
    let decision = if is_app_origin(origin) { GRANT } else { PROMPT };
    if let Some(handler) = decision_handler.as_ref() {
        handler.call((decision,));
    }
}
