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
//
// The whole feature is Windows-only; the raw Win32 layer (window tagging,
// clipping, z-order, Chromium discovery) lives in `webapp_embed/windows.rs`.

use std::collections::HashMap;
use std::sync::Mutex;

#[cfg(target_os = "windows")]
mod windows;

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
        for hwnd in windows::chromium_windows(true) {
            if windows::is_tagged(hwnd) {
                log::info!("[WebAppEmbed] Closing orphaned glued window {} (tagged)", hwnd);
                windows::close(hwnd);
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
                    if windows::is_alive(hwnd) && windows::is_chromium_window(hwnd) {
                        log::info!("[WebAppEmbed] Closing orphaned glued window {} ({})", hwnd, id);
                        windows::close(hwnd);
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
            if windows::is_alive(hwnd) {
                return Ok(hwnd as i64);
            }
        }

        let exe = windows::find_browser_exe()
            .ok_or_else(|| "No Chromium browser (Edge/Chrome) found".to_string())?;

        let before: std::collections::HashSet<isize> =
            windows::chromium_windows(false).into_iter().collect();

        std::process::Command::new(&exe)
            .arg(format!("--app={}", url))
            .spawn()
            .map_err(|e| format!("Failed to launch browser: {}", e))?;

        // The launcher process usually hands off to the running browser and
        // exits, so the PID is useless — diff top-level Chromium windows
        // instead. Poll up to 8s (first browser start can be slow).
        for _ in 0..80 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if let Some(new_hwnd) = windows::chromium_windows(false)
                .into_iter()
                .find(|h| !before.contains(h))
            {
                windows::mark_adopted(new_hwnd);
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
        if !windows::is_alive(hwnd) {
            EMBEDS.lock().unwrap().remove(&id);
            CLIPS.lock().unwrap().remove(&id);
            return Err("window gone".to_string());
        }
        if !visible {
            windows::hide(hwnd);
            return Ok(());
        }
        let main_hwnd = app
            .get_webview_window("main")
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as isize)
            .ok_or_else(|| "main window unavailable".to_string())?;
        windows::set_bounds(hwnd, main_hwnd, x, y, width, height);

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
            windows::apply_clip(hwnd, clip.0, clip.1, clip.2, clip.3, clip.4, clip.5);
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
            if windows::is_alive(hwnd) {
                windows::close(hwnd);
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
                if windows::is_alive(hwnd) {
                    windows::close(hwnd);
                }
            }
        }
        persist_embeds();
    }
}
