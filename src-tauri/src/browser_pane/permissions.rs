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
//
// Site permissions (the side panel's Page tab): per host, camera and
// microphone can be set to Ask (WebKit's prompt), Allow or Block, and sound
// can be muted. They're kept in app data as site_permissions.json, and read
// here when a site asks — so a decision holds across reloads and restarts
// instead of prompting on every visit.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use block2::Block;
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2_foundation::NSString;

// WKPermissionDecision (NSInteger)
const PROMPT: isize = 0;
const GRANT: isize = 1;
const DENY: isize = 2;
// WKMediaCaptureType (NSInteger)
const CAPTURE_CAMERA: isize = 0;
const CAPTURE_MICROPHONE: isize = 1;

#[derive(Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    #[default]
    Ask,
    Allow,
    Block,
}

#[derive(Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct SitePermissions {
    #[serde(default)]
    pub camera: Decision,
    #[serde(default)]
    pub microphone: Decision,
    #[serde(default)]
    pub muted: bool,
}

static STORE_PATH: OnceLock<std::path::PathBuf> = OnceLock::new();
static STORE: Mutex<Option<HashMap<String, SitePermissions>>> = Mutex::new(None);

/// "www.youtube.com" → "youtube.com", the key settings are stored under.
pub fn site_key(host: &str) -> String {
    host.trim_start_matches("www.").to_ascii_lowercase()
}

fn with_store<R>(f: impl FnOnce(&mut HashMap<String, SitePermissions>) -> R) -> R {
    let mut store = STORE.lock().unwrap();
    let map = store.get_or_insert_with(|| {
        STORE_PATH
            .get()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    });
    f(map)
}

pub fn get(host: &str) -> SitePermissions {
    with_store(|m| m.get(&site_key(host)).copied().unwrap_or_default())
}

pub fn set(host: &str, perms: SitePermissions) {
    with_store(|m| {
        let key = site_key(host);
        if perms == SitePermissions::default() {
            m.remove(&key);
        } else {
            m.insert(key, perms);
        }
        if let Some(path) = STORE_PATH.get() {
            let _ = std::fs::write(path, serde_json::to_string_pretty(m).unwrap_or_default());
        }
    });
}

/// Mute or unmute a page's sound (WebKit's per-page mute, what Safari's
/// "Mute tab" uses; private, so skipped if it's ever gone). Main thread.
pub unsafe fn apply_muted(view: *mut AnyObject, muted: bool) {
    let supported: bool = msg_send![view, respondsToSelector: objc2::sel!(_setPageMuted:)];
    if supported {
        // _WKMediaMutedState: bit 0 = audio.
        let state: usize = if muted { 1 } else { 0 };
        let _: () = msg_send![view, _setPageMuted: state];
    }
}

/// End a page's camera / microphone use right away (macOS 12+). Main thread.
pub unsafe fn stop_capture(view: *mut AnyObject, camera: bool, microphone: bool) {
    let none: isize = 0; // WKMediaCaptureStateNone
    let handler: *mut AnyObject = std::ptr::null_mut();
    if camera {
        let ok: bool = msg_send![view, respondsToSelector: objc2::sel!(setCameraCaptureState:completionHandler:)];
        if ok {
            let _: () = msg_send![view, setCameraCaptureState: none, completionHandler: handler];
        }
    }
    if microphone {
        let ok: bool = msg_send![view, respondsToSelector: objc2::sel!(setMicrophoneCaptureState:completionHandler:)];
        if ok {
            let _: () = msg_send![view, setMicrophoneCaptureState: none, completionHandler: handler];
        }
    }
}

static INSTALLED: AtomicBool = AtomicBool::new(false);

/// Install the replacement on wry's UI delegate class (idempotent).
pub fn install(wv: &tauri::Webview) {
    use tauri::Manager;
    if STORE_PATH.get().is_none() {
        if let Ok(dir) = wv.app_handle().path().app_data_dir() {
            let _ = STORE_PATH.set(dir.join("site_permissions.json"));
        }
    }
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
    capture_type: isize,
    decision_handler: *mut Block<dyn Fn(isize)>,
) {
    let decision = if is_app_origin(origin) { GRANT } else { site_decision(origin, capture_type) };
    if let Some(handler) = decision_handler.as_ref() {
        handler.call((decision,));
    }
}

/// What the site's saved settings say for this request. Camera + microphone
/// together: blocked if either is, granted only if both are allowed.
unsafe fn site_decision(origin: *mut AnyObject, capture_type: isize) -> isize {
    if origin.is_null() {
        return PROMPT;
    }
    let host: *mut NSString = msg_send![origin, host];
    let Some(host) = host.as_ref().map(|h| h.to_string()) else { return PROMPT };
    let perms = get(&host);
    let wanted: &[Decision] = match capture_type {
        CAPTURE_CAMERA => &[perms.camera],
        CAPTURE_MICROPHONE => &[perms.microphone],
        _ => &[perms.camera, perms.microphone],
    };
    let decision = if wanted.contains(&Decision::Block) {
        DENY
    } else if wanted.iter().all(|d| *d == Decision::Allow) {
        GRANT
    } else {
        PROMPT
    };
    log::info!("[BrowserPane] {host} asked for capture type {capture_type}: {}", ["prompt", "grant", "deny"][decision as usize]);
    decision
}
