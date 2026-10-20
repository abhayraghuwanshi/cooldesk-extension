// Native ad/tracker blocking for the browser pane.
//
// macOS: WebKit's own content blocker — the mechanism Safari extensions use.
// `resources/adblock-rules.json` (EasyList + EasyPrivacy converted to WebKit's
// rule format) is compiled once by WKContentRuleListStore into a bytecode it
// caches on disk under an identifier derived from the file's contents, so
// later launches only look it up. Blocking then runs inside WebKit's network
// stack: blocked requests never leave the machine, which is also why pages
// load faster with it on.
//
// Other platforms: not implemented yet; `set_enabled` reports `false` so the
// toolbar can hide the shield.
//
// All WebKit calls happen on the main thread (the compiled list lives in a
// main-thread-only thread_local).

use std::collections::HashMap;
use std::sync::Mutex;

lazy_static::lazy_static! {
    /// pane label → whether blocking should be on. Kept so panes opened before
    /// the list finishes compiling get it attached once it's ready.
    static ref DESIRED: Mutex<HashMap<String, bool>> = Mutex::new(HashMap::new());
}

pub fn supported() -> bool {
    cfg!(target_os = "macos")
}

/// Startup: load (or compile) the rule list in the background.
pub fn prepare(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    mac::prepare(app.clone());
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Turn blocking on/off for one pane. Takes effect from the next page load.
pub fn set_enabled(wv: &tauri::Webview, enabled: bool) -> bool {
    DESIRED.lock().unwrap().insert(wv.label().to_string(), enabled);
    #[cfg(target_os = "macos")]
    mac::apply(wv, enabled);
    supported()
}

pub fn forget(label: &str) {
    DESIRED.lock().unwrap().remove(label);
}

#[cfg(target_os = "macos")]
mod mac {
    use super::DESIRED;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKWebView};
    use std::cell::RefCell;
    use std::hash::{Hash, Hasher};
    use tauri::Manager;

    thread_local! {
        static LIST: RefCell<Option<Retained<WKContentRuleList>>> = const { RefCell::new(None) };
    }

    pub fn prepare(app: tauri::AppHandle) {
        std::thread::spawn(move || {
            let path = match app
                .path()
                .resolve("adblock-rules.json", tauri::path::BaseDirectory::Resource)
            {
                Ok(p) => p,
                Err(e) => return log::warn!("[Adblock] no resource dir: {e}"),
            };
            let json = match std::fs::read_to_string(&path) {
                Ok(j) => j,
                Err(e) => return log::warn!("[Adblock] can't read {}: {e}", path.display()),
            };
            let mut h = std::collections::hash_map::DefaultHasher::new();
            json.hash(&mut h);
            let id = format!("cooldesk-adblock-{:016x}", h.finish());
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || load(handle, id, json));
        });
    }

    /// Look the compiled list up by content id; compile it only on a miss.
    fn load(app: tauri::AppHandle, id: String, json: String) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let Some(store) = (unsafe { WKContentRuleListStore::defaultStore(mtm) }) else {
            return log::warn!("[Adblock] no default content rule list store");
        };
        let ns_id = NSString::from_str(&id);
        let store_for_compile = store.clone();
        let started = std::time::Instant::now();
        let on_lookup = RcBlock::new(move |list: *mut WKContentRuleList, _err: *mut NSError| {
            if let Some(list) = unsafe { Retained::retain(list) } {
                log::info!("[Adblock] loaded cached rules {id}");
                return ready(&app, list);
            }
            let app = app.clone();
            let on_compile = RcBlock::new(move |list: *mut WKContentRuleList, err: *mut NSError| {
                match unsafe { Retained::retain(list) } {
                    Some(list) => {
                        log::info!("[Adblock] compiled rules in {:.1}s", started.elapsed().as_secs_f32());
                        ready(&app, list);
                    }
                    None => {
                        let msg = unsafe { err.as_ref() }
                            .map(|e| e.localizedDescription().to_string())
                            .unwrap_or_default();
                        log::warn!("[Adblock] compile failed: {msg}");
                    }
                }
            });
            let json = NSString::from_str(&json);
            unsafe {
                store_for_compile.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
                    Some(&NSString::from_str(&id)),
                    Some(&json),
                    Some(&on_compile),
                );
            }
        });
        unsafe { store.lookUpContentRuleListForIdentifier_completionHandler(Some(&ns_id), Some(&on_lookup)) };
    }

    /// List is ready: keep it and attach it to every pane that wants it.
    fn ready(app: &tauri::AppHandle, list: Retained<WKContentRuleList>) {
        LIST.with(|l| *l.borrow_mut() = Some(list));
        let wanted: Vec<String> = DESIRED
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, on)| **on)
            .map(|(label, _)| label.clone())
            .collect();
        for label in wanted {
            if let Some(wv) = app.get_webview(&label) {
                apply(&wv, true);
            }
        }
    }

    pub fn apply(wv: &tauri::Webview, enabled: bool) {
        let _ = wv.with_webview(move |pw| unsafe {
            let wk = &*(pw.inner() as *const WKWebView);
            let controller = wk.configuration().userContentController();
            controller.removeAllContentRuleLists();
            if enabled {
                LIST.with(|l| {
                    if let Some(list) = l.borrow().as_ref() {
                        controller.addContentRuleList(list);
                    }
                });
            }
        });
    }
}
