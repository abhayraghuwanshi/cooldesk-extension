// Dev builds only: hand WebKit its WebCrypto master key ourselves instead of
// letting it use the login keychain (macOS).
//
// Sites that persist CryptoKeys in IndexedDB (Netflix, Google sign-in) make
// WebKit wrap them with a per-app "cooldesk WebCrypto Master Key" kept in the
// login keychain. Every `tauri dev` rebuild is a new ad-hoc code signature, so
// macOS treats it as a different app and prompts for the keychain password
// again — on every rebuild, even after "Always Allow".
//
// WebKit asks the navigation delegate first (`_webCryptoMasterKeyForWebView:`,
// private; verified to be called on macOS 26.6) and only falls back to the
// keychain when the delegate doesn't answer. We add that method to wry's
// delegate class and return a key stored in CoolDesk's app-data folder.
//
// Release builds don't install this: a signed build has a stable signature,
// so the keychain prompt happens at most once, and the keychain is the right
// home for the key.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2_foundation::NSData;
use tauri::Manager;

static INSTALLED: AtomicBool = AtomicBool::new(false);
static KEY: OnceLock<Vec<u8>> = OnceLock::new();

/// 16 bytes, like WebKit's own master key. Created once per machine.
fn load_or_create_key(app: &tauri::AppHandle) -> Option<Vec<u8>> {
    let dir = app.path().app_data_dir().ok()?;
    let path = dir.join("dev-webcrypto-master.key");
    if let Ok(bytes) = std::fs::read(&path) {
        if bytes.len() == 16 {
            return Some(bytes);
        }
    }
    let key = uuid::Uuid::new_v4().as_bytes().to_vec();
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::write(&path, &key).ok()?;
    Some(key)
}

pub fn install(wv: &tauri::Webview) {
    if !cfg!(debug_assertions) || INSTALLED.load(Ordering::Relaxed) {
        return;
    }
    if KEY.get().is_none() {
        match load_or_create_key(wv.app_handle()) {
            Some(key) => {
                let _ = KEY.set(key);
            }
            None => return log::warn!("[BrowserPane] couldn't create dev WebCrypto key; keychain will be used"),
        }
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
        let name = objc2::sel!(_webCryptoMasterKeyForWebView:);
        let imp: Imp = std::mem::transmute(
            master_key as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut NSData,
        );
        // Returns an object, takes self, _cmd and the web view.
        let added = objc2::ffi::class_addMethod(cls, name, imp, c"@@:@".as_ptr()).as_bool();
        INSTALLED.store(true, Ordering::Relaxed);
        log::info!("[BrowserPane] dev build: WebCrypto master key served from app data (keychain unused), added={added}");
    });
}

unsafe extern "C-unwind" fn master_key(_this: *mut AnyObject, _cmd: Sel, _webview: *mut AnyObject) -> *mut NSData {
    match KEY.get() {
        Some(key) => Retained::autorelease_return(NSData::with_bytes(key)),
        None => std::ptr::null_mut(),
    }
}
