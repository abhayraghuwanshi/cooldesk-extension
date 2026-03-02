use sysinfo::System;
use tauri_plugin_shell::ShellExt;
use serde::Serialize;
use tauri::Manager; // Import Manager trait
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

mod sidecar;
mod system;

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
    use tauri_plugin_shell::ShellExt;
    
    // 1. Run AppScanner to get all windows and installed apps
    let scan_output = app.shell().command("AppScanner")
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
    let match_output = app.shell().command("AppMatcher")
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

#[tauri::command]
async fn get_installed_apps(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    // We can use the same pipeline to get the full list of apps (running + not running)
    get_running_apps(app).await
}

#[tauri::command]
async fn focus_window(app: tauri::AppHandle, pid: u32, name: Option<String>, hwnd: Option<i64>) -> Result<(), String> {
    let mut command = app.shell().command("AppFocus");

    if let Some(h) = hwnd.filter(|&h| h != 0) {
        // Precise focus: target the specific window handle
        command = command.args(["--hwnd", &h.to_string()]);
    } else {
        // Fallback: focus by PID (brings first window of that process to front)
        command = command.args([pid.to_string()]);
        if let Some(n) = name {
            command = command.args([n]);
        }
    }

    let output = command
        .output()
        .await
        .map_err(|e| e.to_string())?;
        
    if output.status.success() {
        Ok(())
    } else {
        Err("Failed to focus window".to_string())
    }
}

#[tauri::command]
fn toggle_spotlight(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("spotlight") {
        if window.is_visible().unwrap_or(false) {
            window.hide().unwrap();
        } else {
            // Get cursor position and move window to that monitor
            if let Ok(cursor_pos) = window.cursor_position() {
                // Get window size
                let window_width = 800.0;
                let window_height = 600.0;

                // Center the window horizontally on cursor, position near top
                let x = cursor_pos.x - (window_width / 2.0);
                let y = cursor_pos.y.min(200.0); // Position near top of screen, max 200px from top

                // Move window to cursor's monitor
                let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
            }

            window.show().unwrap();
            window.set_focus().unwrap();
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
    // Use explorer to launch the app, which handles file associations and elevation if needed
    // This avoids the deprecated tauri_plugin_shell::Shell::open method
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
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

