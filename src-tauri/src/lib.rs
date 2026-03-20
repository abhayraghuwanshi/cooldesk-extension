use serde::Serialize;
use tauri::Manager; // Import Manager trait
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

mod sidecar;
mod system;
mod focus;

use system::RunningApp;

// Global cache of the last AppMatcher output.
// Written by get_running_apps(), read by the sidecar /search endpoint.
lazy_static::lazy_static! {
    pub static ref APP_CACHE: Arc<RwLock<Vec<serde_json::Value>>> =
        Arc::new(RwLock::new(Vec::new()));
}


#[tauri::command]
async fn get_focused_app() -> Option<RunningApp> {
    system::get_focused_app_info().await
}

#[tauri::command]
async fn get_running_apps(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = &app;
        return Ok(serde_json::json!([]));
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        use tauri_plugin_shell::ShellExt;

        // 1. Run AppScanner to get all windows and installed apps
        // Use .sidecar() so Tauri resolves the registered external binary by triple-suffix
        // (.command() only searches PATH and fails on macOS where cwd is not in PATH)
        let scan_output = app.shell().sidecar("AppScanner")
            .map_err(|e| format!("AppScanner sidecar not found: {}", e))?
            .args(["--debug"])
            .output()
            .await
            .map_err(|e| format!("AppScanner failed: {}", e))?;

        if !scan_output.status.success() {
            return Err(format!("AppScanner failed: {}", String::from_utf8_lossy(&scan_output.stderr)));
        }

        // 2. Write scan data to a temporary file
        let temp_dir = std::env::temp_dir();
        let scan_file = temp_dir.join(format!("cooldesk_scan_{}.json", std::process::id()));
        std::fs::write(&scan_file, &scan_output.stdout).map_err(|e| format!("Failed to write temp file: {}", e))?;

        // 3. Run AppMatcher with the temp file as input
        let match_output = app.shell().sidecar("AppMatcher")
            .map_err(|e| format!("AppMatcher sidecar not found: {}", e))?
            .args(["--input", scan_file.to_string_lossy().as_ref()])
            .output()
            .await
            .map_err(|e| format!("AppMatcher failed: {}", e))?;

        // Clean up temp file
        let _ = std::fs::remove_file(&scan_file);

        if !match_output.status.success() {
            let stderr = String::from_utf8_lossy(&match_output.stderr);
            return Err(format!("AppMatcher failed: {}", stderr));
        }

        let stdout_str = String::from_utf8_lossy(&match_output.stdout);
        let parsed: serde_json::Value = serde_json::from_str(&stdout_str)
            .map_err(|e| format!("Failed to parse matcher JSON: {}", e))?;

        // Populate global cache so the /search HTTP endpoint can use full installed+running data
        if let Some(arr) = parsed.as_array() {
            if let Ok(mut cache) = APP_CACHE.write() {
                *cache = arr.clone();
            }
        }

        Ok(parsed)
    }
}

#[tauri::command]
async fn get_installed_apps(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    // We can use the same pipeline to get the full list of apps (running + not running)
    get_running_apps(app).await
}

#[tauri::command(rename_all = "snake_case")]
async fn focus_window(_app: tauri::AppHandle, pid: u32, name: Option<String>, hwnd: Option<i64>) -> Result<(), String> {
    // Use native Rust implementation instead of shelling out to AppFocus.exe
    let hwnd_opt = hwnd.filter(|&h| h != 0).map(|h| h as isize);
    let name_ref = name.as_deref();

    focus::focus_window(hwnd_opt, Some(pid), name_ref)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_spotlight(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("spotlight") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            // Get cursor position to find the active monitor
            #[cfg(target_os = "windows")]
            let cursor_pos: Option<(i32, i32)> = {
                let mut pt = windows::Win32::Foundation::POINT::default();
                if unsafe { windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut pt) }.is_ok() {
                    Some((pt.x, pt.y))
                } else {
                    None
                }
            };
            #[cfg(not(target_os = "windows"))]
            let cursor_pos: Option<(i32, i32)> = None;

            // Find which monitor contains this cursor point
            let monitors = app.available_monitors().unwrap_or_default();
            let target_monitor = if let Some((cx, cy)) = cursor_pos {
                monitors.into_iter().find(|m| {
                    let pos = m.position();
                    let size = m.size();
                    cx >= pos.x && cx < pos.x + size.width as i32 &&
                    cy >= pos.y && cy < pos.y + size.height as i32
                }).or_else(|| app.primary_monitor().ok().flatten())
            } else {
                app.primary_monitor().ok().flatten()
            };

            if let Some(monitor) = target_monitor {
                let m_pos = monitor.position();
                let m_size = monitor.size();

                // Get physical window size (default to 800x600 if unknown)
                let w_size = window.outer_size().unwrap_or(tauri::PhysicalSize { width: 800, height: 600 });

                // Multi-monitor aware centering: Center X, and find Y at 1/3 from top
                let x = m_pos.x + (m_size.width as i32 - w_size.width as i32) / 2;
                let y = m_pos.y + (m_size.height as i32 - w_size.height as i32) / 3;

                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            }

            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
fn hide_spotlight(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("spotlight") {
        window.hide().unwrap();
    }
}

#[tauri::command]
async fn launch_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        // The scanner stores the Mach-O executable path inside the bundle
        // (e.g. /Applications/Foo.app/Contents/MacOS/Foo). Passing that raw
        // binary to `open` makes macOS treat it as a document and open it in
        // Terminal. Strip back to the .app bundle root so `open` launches it correctly.
        let open_path = if let Some(idx) = path.find(".app/Contents/") {
            path[..idx + 4].to_string() // "/Applications/Foo.app"
        } else {
            path.clone()
        };
        std::process::Command::new("open")
            .arg(&open_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
        get_running_apps,
        get_installed_apps,
        focus_window,
        toggle_spotlight,
        hide_spotlight,
        launch_app,
        get_focused_app
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Spawn Rust Sidecar Server (replaces Node.js sidecar)
      tauri::async_runtime::spawn(async {
          if let Err(e) = sidecar::start_server().await {
              log::error!("[Sidecar] Server failed: {}", e);
          }
      });

      // Register Global Shortcut
      let handle = app.handle().clone();
      app.handle().plugin(
          tauri_plugin_global_shortcut::Builder::new()
            .with_shortcut("Alt+K")?
            .with_handler(move |_app, shortcut, event| {
              if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                  if shortcut.matches(tauri_plugin_global_shortcut::Modifiers::ALT, tauri_plugin_global_shortcut::Code::KeyK) {
                      toggle_spotlight(handle.clone());
                  }
              }
            })
          .build(),
      )?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

