// File uploads from browser panes: CoolDesk's own picker instead of Finder's.
//
// An `<input type=file>` click in a WKWebView asks its UI delegate
// (`webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:`),
// and wry answers with a modal NSOpenPanel. For a pane (never CoolDesk's own
// page) we hold on to the completion handler instead and ask the window that
// hosts the pane to show its picker (UploadPicker.jsx: the Shelf and the file
// manager), emitting `browser-pane-file-request`. The UI answers with
// `browser_pane_file_choose` (paths, or none to cancel) or
// `browser_pane_file_system` (Finder's panel after all — wry's original
// implementation, called with the same arguments). However a request ends,
// `browser-pane-file-done` follows, so the UI can drop its upload tile.
//
// WebKit waits on the handler, so every request gets exactly one answer:
//   - the UI must acknowledge within ACK_MS (`browser_pane_file_ack`), else
//     Finder's panel opens — no picker mounted means no dead upload button;
//   - closing the pane cancels its request;
//   - a second request from the same pane cancels the first.
//
// Everything that touches a request runs on the main thread.

#[cfg(target_os = "macos")]
mod mac {
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::{Mutex, OnceLock};

    use block2::{Block, RcBlock};
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2_foundation::NSString;
    use tauri::{Emitter, Manager};

    const ACK_MS: u64 = 1500;

    type Handler = Block<dyn Fn(*mut AnyObject)>;
    type OpenPanelFn = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject, *mut AnyObject, *mut Handler);

    static INSTALLED: AtomicBool = AtomicBool::new(false);
    static ORIGINAL: AtomicUsize = AtomicUsize::new(0);
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    /// Pane WKWebView address → its webview label.
    static PANES: Mutex<Option<HashMap<usize, String>>> = Mutex::new(None);
    /// Requests the UI has acknowledged (it's showing the picker).
    static ACKED: Mutex<Option<HashSet<u64>>> = Mutex::new(None);
    static PENDING: Mutex<Option<HashMap<u64, MainOnly<Pending>>>> = Mutex::new(None);

    /// Holds Objective-C objects that are only ever touched on the main thread.
    struct MainOnly<T>(T);
    unsafe impl<T> Send for MainOnly<T> {}

    struct Pending {
        label: String,
        multiple: bool,
        directories: bool,
        handler: RcBlock<dyn Fn(*mut AnyObject)>,
        // wry's original arguments, for Finder's panel.
        delegate: Retained<AnyObject>,
        webview: Retained<AnyObject>,
        params: Retained<AnyObject>,
        frame: Option<Retained<AnyObject>>,
    }

    pub fn install(wv: &tauri::Webview) {
        let _ = APP.set(wv.app_handle().clone());
        let label = wv.label().to_string();
        let _ = wv.with_webview(move |pw| unsafe {
            let view = pw.inner() as *mut AnyObject;
            PANES.lock().unwrap().get_or_insert_with(Default::default).insert(view as usize, label);
            if INSTALLED.load(Ordering::Relaxed) {
                return;
            }
            let delegate: *mut AnyObject = msg_send![view, UIDelegate];
            if delegate.is_null() {
                return;
            }
            let cls = objc2::ffi::object_getClass(delegate) as *mut AnyClass;
            let name = objc2::sel!(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:);
            let method = objc2::ffi::class_getInstanceMethod(cls, name) as *mut objc2::runtime::Method;
            if method.is_null() {
                return;
            }
            let ours: Imp = std::mem::transmute(open_panel as OpenPanelFn);
            let original = objc2::ffi::method_setImplementation(method, ours);
            if let Some(original) = original {
                ORIGINAL.store(original as usize, Ordering::Relaxed);
            }
            INSTALLED.store(true, Ordering::Relaxed);
            log::info!("[BrowserPane] file uploads now use CoolDesk's picker");
        });
    }

    /// A pane is closing: drop it and cancel what it asked for.
    pub fn forget(app: &tauri::AppHandle, label: String) {
        let _ = app.run_on_main_thread(move || {
            if let Some(m) = PANES.lock().unwrap().as_mut() {
                m.retain(|_, l| *l != label);
            }
            let ids: Vec<u64> = pending_ids(|p| p.label == label);
            for id in ids {
                unsafe { finish(id, None) };
            }
        });
    }

    fn pending_ids(f: impl Fn(&Pending) -> bool) -> Vec<u64> {
        PENDING.lock().unwrap().as_ref().map(|m| m.iter().filter(|(_, p)| f(&p.0)).map(|(id, _)| *id).collect()).unwrap_or_default()
    }

    /// Remove request `id`; `notify`: tell the UI it's over (not when a
    /// newer request from the same page takes its place — the UI keeps that
    /// page's upload tile and just updates it).
    fn take(id: u64, notify: bool) -> Option<Pending> {
        ACKED.lock().unwrap().get_or_insert_with(Default::default).remove(&id);
        let p = PENDING.lock().unwrap().as_mut()?.remove(&id).map(|p| p.0)?;
        if let (true, Some(app)) = (notify, APP.get()) {
            let _ = app.emit("browser-pane-file-done", serde_json::json!({ "request": id }));
        }
        Some(p)
    }

    unsafe fn retain(ptr: *mut AnyObject) -> Option<Retained<AnyObject>> {
        Retained::retain(ptr)
    }

    unsafe fn strings(array: *mut AnyObject) -> Vec<String> {
        if array.is_null() {
            return Vec::new();
        }
        let count: usize = msg_send![array, count];
        (0..count)
            .filter_map(|i| {
                let s: *mut NSString = msg_send![array, objectAtIndex: i];
                s.as_ref().map(|s| s.to_string())
            })
            .collect()
    }

    /// The input's `accept`, from WKOpenPanelParameters' private lists (if
    /// this WebKit has them): file extensions, or else MIME types.
    unsafe fn accepted(params: *mut AnyObject, extensions: bool) -> Vec<String> {
        let sel = if extensions { objc2::sel!(_acceptedFileExtensions) } else { objc2::sel!(_acceptedMIMETypes) };
        let ok: bool = msg_send![params, respondsToSelector: sel];
        if !ok {
            return Vec::new();
        }
        let list: *mut AnyObject = if extensions {
            msg_send![params, _acceptedFileExtensions]
        } else {
            msg_send![params, _acceptedMIMETypes]
        };
        strings(list)
    }

    unsafe fn page_url(webview: *mut AnyObject) -> Option<String> {
        let url: *mut AnyObject = msg_send![webview, URL];
        if url.is_null() {
            return None;
        }
        let s: *mut NSString = msg_send![url, absoluteString];
        s.as_ref().map(|s| s.to_string())
    }

    unsafe fn call_original(this: *mut AnyObject, cmd: Sel, webview: *mut AnyObject, params: *mut AnyObject, frame: *mut AnyObject, handler: *mut Handler) {
        let original = ORIGINAL.load(Ordering::Relaxed);
        if original != 0 {
            let f: OpenPanelFn = std::mem::transmute(original);
            f(this, cmd, webview, params, frame, handler);
        } else if let Some(h) = handler.as_ref() {
            h.call((std::ptr::null_mut(),));
        }
    }

    unsafe extern "C-unwind" fn open_panel(
        this: *mut AnyObject,
        cmd: Sel,
        webview: *mut AnyObject,
        params: *mut AnyObject,
        frame: *mut AnyObject,
        handler: *mut Handler,
    ) {
        let label = PANES.lock().unwrap().as_ref().and_then(|m| m.get(&(webview as usize)).cloned());
        let (Some(label), Some(app), Some(h)) = (label, APP.get(), handler.as_ref()) else {
            return call_original(this, cmd, webview, params, frame, handler);
        };
        let (Some(delegate), Some(view), Some(params_r)) = (retain(this), retain(webview), retain(params)) else {
            return call_original(this, cmd, webview, params, frame, handler);
        };
        let window = app.get_webview(&label).map(|wv| wv.window().label().to_string());
        let Some(window) = window else {
            return call_original(this, cmd, webview, params, frame, handler);
        };

        // One open request per pane: the new one replaces it.
        for old in pending_ids(|p| p.label == label) {
            answer(old, None, false);
        }

        let multiple: bool = msg_send![params, allowsMultipleSelection];
        let directories: bool = msg_send![params, allowsDirectories];
        let extensions = accepted(params, true);
        let mime_types = accepted(params, false);
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        PENDING.lock().unwrap().get_or_insert_with(Default::default).insert(
            id,
            MainOnly(Pending {
                label: label.clone(),
                multiple,
                directories,
                handler: h.copy(),
                delegate,
                webview: view,
                params: params_r,
                frame: retain(frame),
            }),
        );

        let payload = serde_json::json!({
            "request": id,
            "label": label,
            "url": page_url(webview),
            "multiple": multiple,
            "directories": directories,
            "extensions": extensions,
            "mimeTypes": mime_types,
        });
        log::info!("[BrowserPane] {label} wants a file (request {id}, multiple={multiple}, directories={directories})");
        if app.emit_to(window.as_str(), "browser-pane-file-request", payload).is_err() {
            system(id);
            return;
        }

        // Nobody answered (no picker mounted in that window): Finder's panel.
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(ACK_MS));
            let _ = app.run_on_main_thread(move || {
                let acked = ACKED.lock().unwrap().as_ref().is_some_and(|s| s.contains(&id));
                let waiting = PENDING.lock().unwrap().as_ref().is_some_and(|m| m.contains_key(&id));
                if waiting && !acked {
                    log::warn!("[BrowserPane] upload picker didn't answer request {id}; using the system panel");
                    unsafe { system(id) };
                }
            });
        });
    }

    /// Answer request `id` with these files (None: cancelled). Main thread.
    pub unsafe fn finish(id: u64, paths: Option<Vec<std::path::PathBuf>>) -> bool {
        answer(id, paths, true)
    }

    unsafe fn answer(id: u64, paths: Option<Vec<std::path::PathBuf>>, notify: bool) -> bool {
        let Some(p) = take(id, notify) else { return false };
        objc2::rc::autoreleasepool(|_| {
            let array: *mut AnyObject = match paths {
                Some(paths) if !paths.is_empty() => {
                    let array: *mut AnyObject = msg_send![objc2::class!(NSMutableArray), array];
                    let keep = if p.multiple { paths.len() } else { 1 };
                    for path in paths.iter().take(keep) {
                        let s = NSString::from_str(&path.to_string_lossy());
                        let url: *mut AnyObject = msg_send![objc2::class!(NSURL), fileURLWithPath: &*s];
                        if !url.is_null() {
                            let _: () = msg_send![array, addObject: url];
                        }
                    }
                    array
                }
                _ => std::ptr::null_mut(),
            };
            log::info!("[BrowserPane] {} upload request {id}: {}", p.label, if array.is_null() { "cancelled" } else { "files chosen" });
            p.handler.call((array,));
        });
        true
    }

    /// Answer request `id` with Finder's panel (wry's own implementation). Main thread.
    pub unsafe fn system(id: u64) -> bool {
        let Some(p) = take(id, true) else { return false };
        let frame = p.frame.as_ref().map_or(std::ptr::null_mut(), |f| Retained::as_ptr(f) as *mut AnyObject);
        let handler = &*p.handler as *const Handler as *mut Handler;
        call_original(
            Retained::as_ptr(&p.delegate) as *mut AnyObject,
            objc2::sel!(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:),
            Retained::as_ptr(&p.webview) as *mut AnyObject,
            Retained::as_ptr(&p.params) as *mut AnyObject,
            frame,
            handler,
        );
        true
    }

    pub fn ack(id: u64) -> bool {
        let waiting = PENDING.lock().unwrap().as_ref().is_some_and(|m| m.contains_key(&id));
        if waiting {
            ACKED.lock().unwrap().get_or_insert_with(Default::default).insert(id);
        }
        waiting
    }

    pub fn allows_directories(id: u64) -> bool {
        PENDING.lock().unwrap().as_ref().and_then(|m| m.get(&id)).is_some_and(|p| p.0.directories)
    }
}

#[cfg(target_os = "macos")]
pub use mac::{forget, install};

/// The picker is showing request `request` (stops the fallback to Finder's panel).
#[tauri::command]
pub fn browser_pane_file_ack(request: u64) -> bool {
    #[cfg(target_os = "macos")]
    {
        mac::ack(request)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = request;
        false
    }
}

/// Answer an upload request: these files, or none (`paths` null / empty) to cancel.
#[tauri::command]
pub fn browser_pane_file_choose(app: tauri::AppHandle, request: u64, paths: Option<Vec<String>>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let dirs_ok = mac::allows_directories(request);
        let paths = match paths {
            Some(list) if !list.is_empty() => {
                let mut out = Vec::with_capacity(list.len());
                for p in list {
                    let path = std::fs::canonicalize(&p).map_err(|e| format!("{p}: {e}"))?;
                    let ok = if path.is_dir() { dirs_ok } else { path.is_file() };
                    if !ok {
                        return Err(format!("{p} can't be uploaded"));
                    }
                    out.push(path);
                }
                Some(out)
            }
            _ => None,
        };
        app.run_on_main_thread(move || unsafe {
            mac::finish(request, paths);
        })
        .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, request, paths);
        Err("Not available on this platform".into())
    }
}

/// Answer an upload request with the system's own file panel.
#[tauri::command]
pub fn browser_pane_file_system(app: tauri::AppHandle, request: u64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread(move || unsafe {
            mac::system(request);
        })
        .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, request);
        Err("Not available on this platform".into())
    }
}
