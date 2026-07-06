// Glue-embedding of real browser windows over dashboard card slots.
//
// "Option 3" embedding: we spawn the user's own browser in `--app=<url>` mode
// (frameless PWA-style window, user's real profile → already signed in),
// adopt the new HWND by diffing top-level Chromium windows before/after the
// spawn, strip its caption, and let the frontend continuously pin it over a
// card slot with `webapp_embed_set_bounds`. No SetParent — the window stays
// owned by the browser process; we only move/show/hide it, so the worst
// failure mode is a floating browser window, never a crash.
//
// Because `--app` windows are ordinary tabs of the user's default browser,
// the CoolDesk extension (tab sync, scrapers, activity tracking) keeps
// observing them — this is what makes glue-embedding the "editor with
// memory" line rather than an uninstrumented second browser profile.

use std::collections::HashMap;
use std::sync::Mutex;

lazy_static::lazy_static! {
    /// widget id → adopted top-level window handle (HWND as isize).
    static ref EMBEDS: Mutex<HashMap<String, isize>> = Mutex::new(HashMap::new());
    /// widget id → last applied clip (w, h, top, right, bottom, left) so we
    /// only call SetWindowRgn when something actually changed (it repaints).
    static ref CLIPS: Mutex<HashMap<String, (i32, i32, i32, i32, i32, i32)>> = Mutex::new(HashMap::new());
    /// Where adopted HWNDs are persisted so a fresh process can close windows
    /// orphaned by a previous one that died without running close_all()
    /// (dev rebuilds, crashes, task-kill).
    static ref PERSIST_PATH: Mutex<Option<std::path::PathBuf>> = Mutex::new(None);
}

/// Snapshot the current embed map to disk (best-effort).
fn persist_embeds() {
    let path = PERSIST_PATH.lock().unwrap().clone();
    if let Some(path) = path {
        let map: HashMap<String, i64> = EMBEDS
            .lock()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), *v as i64))
            .collect();
        if map.is_empty() {
            let _ = std::fs::remove_file(&path);
        } else if let Ok(json) = serde_json::to_string(&map) {
            let _ = std::fs::write(&path, json);
        }
    }
}

/// Startup hook: close glued windows a previous process left behind, then
/// arm persistence for this process. A stale frameless --app window with a
/// baked-in clip region floating mid-screen is what an orphan looks like.
pub fn init(persist_path: std::path::PathBuf) {
    #[cfg(target_os = "windows")]
    {
        // Primary sweep: every adopted window carries a "CoolDeskGlueEmbed"
        // window property, which outlives our process. Enumerate ALL Chromium
        // windows (orphans may be hidden) and close the tagged ones.
        for hwnd in win::chromium_windows(true) {
            if win::is_tagged(hwnd) {
                log::info!("[WebAppEmbed] Closing orphaned glued window {} (tagged)", hwnd);
                win::close(hwnd);
            }
        }

        // Secondary sweep: the persist file, for windows that died before the
        // tag landed or exotic cases the enumeration missed.
        if let Ok(json) = std::fs::read_to_string(&persist_path) {
            if let Ok(map) = serde_json::from_str::<HashMap<String, i64>>(&json) {
                for (id, hwnd) in map {
                    let hwnd = hwnd as isize;
                    // HWNDs can be recycled by the OS — only close it if it
                    // still looks like a Chromium window.
                    if win::is_alive(hwnd) && win::is_chromium_window(hwnd) {
                        log::info!("[WebAppEmbed] Closing orphaned glued window {} ({})", hwnd, id);
                        win::close(hwnd);
                    }
                }
            }
            let _ = std::fs::remove_file(&persist_path);
        }
        *PERSIST_PATH.lock().unwrap() = Some(persist_path);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = persist_path;
    }
}

#[cfg(target_os = "windows")]
mod win {
    use windows::core::w;
    use windows::Win32::Foundation::{BOOL, HANDLE, HWND, LPARAM, WPARAM};
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, SetWindowRgn};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetPropW, GetWindow, GetWindowLongW, IsWindow,
        IsWindowVisible, PostMessageW, SetPropW, SetWindowLongW, SetWindowPos, ShowWindow,
        GWL_STYLE, GW_HWNDPREV, HWND_TOP, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNA, WM_CLOSE, WS_CAPTION, WS_MAXIMIZEBOX,
        WS_MINIMIZEBOX, WS_THICKFRAME,
    };

    /// Window property stamped onto every adopted window. Properties survive
    /// our process dying, so a fresh instance can recognize glue windows with
    /// certainty (unlike heuristics — Electron apps are also captionless
    /// Chromium windows) and sweep them even without the persist file.
    fn tag_window(hwnd: isize) {
        unsafe {
            let _ = SetPropW(HWND(hwnd as *mut _), w!("CoolDeskGlueEmbed"), HANDLE(1 as *mut _));
        }
    }

    pub fn is_tagged(hwnd: isize) -> bool {
        unsafe { GetPropW(HWND(hwnd as *mut _), w!("CoolDeskGlueEmbed")).0 as usize != 0 }
    }

    /// Clip the window to a sub-rectangle (insets from each edge, window-
    /// relative px). All-zero insets clear the region. This is what keeps a
    /// glued window from painting over the toolbar while the tile scrolls
    /// under it — the native window can't be z-ordered below page content,
    /// but it can be cut to the visible part of the slot.
    pub fn apply_clip(hwnd: isize, w: i32, h: i32, top: i32, right: i32, bottom: i32, left: i32) {
        unsafe {
            let target = HWND(hwnd as *mut _);
            if top == 0 && right == 0 && bottom == 0 && left == 0 {
                let _ = SetWindowRgn(target, None, true);
            } else {
                // Ownership of the region transfers to the system on success.
                let rgn = CreateRectRgn(left, top, (w - right).max(left), (h - bottom).max(top));
                let _ = SetWindowRgn(target, rgn, true);
            }
        }
    }

    /// Collect top-level Chromium windows ("Chrome_WidgetWin_1" is the frame
    /// class for Chrome, Edge, Brave, …). Hidden ones are included on demand —
    /// orphaned glue windows may have been left in the hidden state.
    pub fn chromium_windows(include_hidden: bool) -> Vec<isize> {
        struct Ctx {
            found: Vec<isize>,
            include_hidden: bool,
        }
        unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let ctx = unsafe { &mut *(lparam.0 as *mut Ctx) };
            if ctx.include_hidden || unsafe { IsWindowVisible(hwnd) }.as_bool() {
                let mut class_buf = [0u16; 64];
                let len = unsafe { GetClassNameW(hwnd, &mut class_buf) } as usize;
                let class = String::from_utf16_lossy(&class_buf[..len]);
                if class.starts_with("Chrome_WidgetWin") {
                    ctx.found.push(hwnd.0 as isize);
                }
            }
            BOOL(1)
        }
        let mut ctx = Ctx { found: Vec::new(), include_hidden };
        unsafe {
            let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut Ctx as isize));
        }
        ctx.found
    }

    /// Adopt bookkeeping applied to every glued window.
    pub fn mark_adopted(hwnd: isize) {
        tag_window(hwnd);
        strip_frame(hwnd);
    }

    pub fn is_alive(hwnd: isize) -> bool {
        unsafe { IsWindow(HWND(hwnd as *mut _)).as_bool() }
    }

    pub fn is_chromium_window(hwnd: isize) -> bool {
        let mut class_buf = [0u16; 64];
        let len = unsafe { GetClassNameW(HWND(hwnd as *mut _), &mut class_buf) } as usize;
        String::from_utf16_lossy(&class_buf[..len]).starts_with("Chrome_WidgetWin")
    }

    /// Strip the caption/resize frame so the adopted window reads as an
    /// embedded panel rather than a floating app window.
    pub fn strip_frame(hwnd: isize) {
        unsafe {
            let h = HWND(hwnd as *mut _);
            let style = GetWindowLongW(h, GWL_STYLE) as u32;
            let stripped = style
                & !(WS_CAPTION.0 | WS_THICKFRAME.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0);
            SetWindowLongW(h, GWL_STYLE, stripped as i32);
            // hwndinsertafter is ignored with SWP_NOZORDER — pass null.
            let _ = SetWindowPos(
                h,
                HWND::default(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }

    /// Move/size the glued window (physical px) and keep it z-ordered directly
    /// above the CoolDesk main window without stealing focus.
    pub fn set_bounds(hwnd: isize, main_hwnd: isize, x: i32, y: i32, w: i32, h: i32) {
        unsafe {
            let target = HWND(hwnd as *mut _);
            let main = HWND(main_hwnd as *mut _);
            let _ = ShowWindow(target, SW_SHOWNA);
            // The window directly above main in z-order; inserting after it
            // lands the glued window between it and main (= directly above
            // main). If main is on top, HWND_TOP achieves the same.
            let above_main = GetWindow(main, GW_HWNDPREV).ok().map(|p| p.0 as isize);
            match above_main {
                Some(p) if p == hwnd => {
                    // Already in the right slot — just move.
                    let _ = SetWindowPos(
                        target,
                        HWND::default(),
                        x,
                        y,
                        w,
                        h,
                        SWP_NOZORDER | SWP_NOACTIVATE,
                    );
                }
                Some(p) => {
                    let _ = SetWindowPos(target, HWND(p as *mut _), x, y, w, h, SWP_NOACTIVATE);
                }
                None => {
                    let _ = SetWindowPos(target, HWND_TOP, x, y, w, h, SWP_NOACTIVATE);
                }
            }
        }
    }

    pub fn hide(hwnd: isize) {
        unsafe {
            let _ = ShowWindow(HWND(hwnd as *mut _), SW_HIDE);
        }
    }

    pub fn close(hwnd: isize) {
        unsafe {
            let _ = PostMessageW(HWND(hwnd as *mut _), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }

    /// Locate an installed Chromium browser executable, preferring Edge
    /// (always present on Win11), then Chrome.
    pub fn find_browser_exe() -> Option<std::path::PathBuf> {
        let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
        let pf = std::env::var("ProgramFiles").unwrap_or_default();
        let local = std::env::var("LocalAppData").unwrap_or_default();
        let candidates = [
            format!("{}\\Microsoft\\Edge\\Application\\msedge.exe", pf86),
            format!("{}\\Microsoft\\Edge\\Application\\msedge.exe", pf),
            format!("{}\\Google\\Chrome\\Application\\chrome.exe", pf),
            format!("{}\\Google\\Chrome\\Application\\chrome.exe", pf86),
            format!("{}\\Google\\Chrome\\Application\\chrome.exe", local),
        ];
        candidates
            .iter()
            .map(std::path::PathBuf::from)
            .find(|p| p.exists())
    }
}

/// Spawn the user's browser in --app mode and adopt the window it creates.
/// Returns the adopted HWND. Reuses a still-alive window for the same id.
#[tauri::command]
pub async fn webapp_embed_open(id: String, url: String) -> Result<i64, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (id, url);
        Err("Embedded web apps are only supported on Windows".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
        if parsed.scheme() != "https" && parsed.scheme() != "http" {
            return Err("Only http(s) URLs can be embedded".to_string());
        }

        // Reuse the existing window if it's still alive.
        if let Some(&hwnd) = EMBEDS.lock().unwrap().get(&id) {
            if win::is_alive(hwnd) {
                return Ok(hwnd as i64);
            }
        }

        let exe = win::find_browser_exe()
            .ok_or_else(|| "No Chromium browser (Edge/Chrome) found".to_string())?;

        let before: std::collections::HashSet<isize> =
            win::chromium_windows(false).into_iter().collect();

        std::process::Command::new(&exe)
            .arg(format!("--app={}", url))
            .spawn()
            .map_err(|e| format!("Failed to launch browser: {}", e))?;

        // The launcher process usually hands off to the running browser and
        // exits, so the PID is useless — diff top-level Chromium windows
        // instead. Poll up to 8s (first browser start can be slow).
        for _ in 0..80 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if let Some(new_hwnd) = win::chromium_windows(false)
                .into_iter()
                .find(|h| !before.contains(h))
            {
                win::mark_adopted(new_hwnd);
                EMBEDS.lock().unwrap().insert(id, new_hwnd);
                persist_embeds();
                log::info!("[WebAppEmbed] Adopted HWND {} for {}", new_hwnd, url);
                return Ok(new_hwnd as i64);
            }
        }
        Err("Browser window did not appear within 8s".to_string())
    }
}

/// Pin the glued window over a screen rectangle (physical px), or hide it.
/// The clip insets (window-relative physical px, defaulting to 0) cut the
/// window to the part of the slot that's actually visible inside its scroll
/// container, so scrolling doesn't paint the window over surrounding UI.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn webapp_embed_set_bounds(
    app: tauri::AppHandle,
    id: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    visible: bool,
    clip_top: Option<i32>,
    clip_right: Option<i32>,
    clip_bottom: Option<i32>,
    clip_left: Option<i32>,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (
            app, id, x, y, width, height, visible, clip_top, clip_right, clip_bottom, clip_left,
        );
        Err("Embedded web apps are only supported on Windows".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        let hwnd = {
            let embeds = EMBEDS.lock().unwrap();
            *embeds.get(&id).ok_or_else(|| "not embedded".to_string())?
        };
        if !win::is_alive(hwnd) {
            EMBEDS.lock().unwrap().remove(&id);
            CLIPS.lock().unwrap().remove(&id);
            return Err("window gone".to_string());
        }
        if !visible {
            win::hide(hwnd);
            return Ok(());
        }
        let main_hwnd = app
            .get_webview_window("main")
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as isize)
            .ok_or_else(|| "main window unavailable".to_string())?;
        win::set_bounds(hwnd, main_hwnd, x, y, width, height);

        let clip = (
            width,
            height,
            clip_top.unwrap_or(0).max(0),
            clip_right.unwrap_or(0).max(0),
            clip_bottom.unwrap_or(0).max(0),
            clip_left.unwrap_or(0).max(0),
        );
        let changed = {
            let mut clips = CLIPS.lock().unwrap();
            if clips.get(&id) == Some(&clip) {
                false
            } else {
                clips.insert(id.clone(), clip);
                true
            }
        };
        if changed {
            win::apply_clip(hwnd, clip.0, clip.1, clip.2, clip.3, clip.4, clip.5);
        }
        Ok(())
    }
}

/// Close the glued window (e.g. widget removed or embed toggled off).
#[tauri::command]
pub fn webapp_embed_close(id: String) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = id;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        CLIPS.lock().unwrap().remove(&id);
        if let Some(hwnd) = EMBEDS.lock().unwrap().remove(&id) {
            if win::is_alive(hwnd) {
                win::close(hwnd);
            }
        }
        persist_embeds();
        Ok(())
    }
}

/// Close every glued window — called on app exit so none are orphaned.
pub fn close_all() {
    #[cfg(target_os = "windows")]
    {
        {
            let mut embeds = EMBEDS.lock().unwrap();
            for (_, hwnd) in embeds.drain() {
                if win::is_alive(hwnd) {
                    win::close(hwnd);
                }
            }
        }
        persist_embeds();
    }
}
