use serde::Serialize;
use tauri::{Manager, Emitter};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};

mod sidecar;
mod system;
mod focus;
mod categorize;

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

#[tauri::command]
fn categorize_app(name: String, path: String) -> categorize::AppCategory {
    let mut categorizer = categorize::Categorizer::new();
    categorizer.categorize(&name, &path)
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
            #[cfg(target_os = "macos")]
            let cursor_pos: Option<(i32, i32)> = {
                use core_graphics::event::CGEvent;
                use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
                CGEventSource::new(CGEventSourceStateID::HIDSystemState).ok().and_then(|src| {
                    CGEvent::new(src).ok().map(|e| {
                        let loc = e.location();
                        (loc.x as i32, loc.y as i32)
                    })
                })
            };
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
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
        // Try direct spawn first (fastest, works for normal .exe paths).
        // Fall back to ShellExecute via cmd /c start for Store apps (WindowsApps),
        // .lnk shortcuts, and anything else direct spawn can't handle.
        let direct_ok = std::process::Command::new(&path).spawn().is_ok();
        if !direct_ok {
            std::process::Command::new("cmd")
                .args(["/c", "start", "", &path])
                .spawn()
                .map_err(|e| format!("launch failed: {e}"))?;
        }
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

/// Launch an app with arguments (e.g., VSCode with a folder path)
#[tauri::command]
async fn launch_app_with_args(app: String, args: Vec<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("powershell");
        cmd.arg("-WindowStyle").arg("Hidden").arg("-Command");
        
        let mut script = format!("& '{}'", app.replace("'", "''"));
        for arg in &args {
            script.push_str(&format!(" '{}'", arg.replace("'", "''")));
        }
        cmd.arg(script)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        // For macOS, use open -a for .app bundles
        if app.ends_with(".app") || app.contains(".app/") {
            let app_path = if let Some(idx) = app.find(".app/Contents/") {
                app[..idx + 4].to_string()
            } else {
                app.clone()
            };
            std::process::Command::new("open")
                .arg("-a")
                .arg(&app_path)
                .args(&args)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new(&app)
                .args(&args)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new(&app)
            .args(&args)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open a folder in the system file explorer
#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct SearchFileResult {
    pub path: String,
    pub date: String,
}

/// Search user files (Downloads, Documents, Desktop) cross-platform
#[tauri::command]
async fn search_files(query: String) -> Result<Vec<SearchFileResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    
    let mut targets = Vec::new();
    if let Some(dl) = dirs::download_dir() { targets.push(dl); }
    if let Some(doc) = dirs::document_dir() { targets.push(doc); }
    if let Some(desk) = dirs::desktop_dir() { targets.push(desk); }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("mdfind");
        for target in &targets {
            cmd.arg("-onlyin").arg(target);
        }
        cmd.arg("-name").arg(&query);
        
        let output = cmd.output().map_err(|e| e.to_string())?;
        let output_str = String::from_utf8_lossy(&output.stdout);
        let results: Vec<String> = output_str.lines()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .take(15)
            .collect();
            
        let mut final_results = Vec::new();
        for path in results {
            let mut date_str = String::new();
            if let Ok(metadata) = std::fs::metadata(&path) {
                if let Ok(modified) = metadata.modified() {
                    let datetime: chrono::DateTime<chrono::Local> = modified.into();
                    date_str = datetime.format("%Y-%m-%d %H:%M").to_string();
                }
            }
            final_results.push(SearchFileResult { path, date: date_str });
        }
        return Ok(final_results);
    }
    
    #[cfg(target_os = "windows")]
    {
        let mut ps_script = String::from("$con = New-Object -ComObject ADODB.Connection; ");
        ps_script.push_str("$con.Open(\"Provider=Search.CollatorDSO;Extended Properties='Application=Windows';\"); ");
        
        let mut folder_conditions = Vec::new();
        for target in &targets {
            // e.g. C:\Users\Raghu\Downloads
            let path_str = target.to_string_lossy().replace("'", "''");
            folder_conditions.push(format!("System.ItemFolderPathDisplay LIKE '{}%'", path_str));
        }
        
        // As a fallback, include basic %Downloads% wildcard
        if folder_conditions.is_empty() {
            folder_conditions.push("System.ItemFolderPathDisplay LIKE '%Downloads%'".into());
            folder_conditions.push("System.ItemFolderPathDisplay LIKE '%Documents%'".into());
            folder_conditions.push("System.ItemFolderPathDisplay LIKE '%Desktop%'".into());
        }
        
        let folder_clause = format!("({})", folder_conditions.join(" OR "));
        let query_sanitized = query.replace("'", "''");
        
        // SQL query for Windows Search using valid CONTAINS syntax
        let sql = format!(
            "SELECT TOP 15 System.ItemPathDisplay FROM SystemIndex WHERE CONTAINS(System.FileName, '\"\"*{}*\"\"') AND {}",
            query_sanitized, folder_clause
        );
        
        ps_script.push_str(&format!("$rs = $con.Execute(\"{}\"); ", sql));
        ps_script.push_str("while($rs -ne $null -and -not $rs.EOF) { Write-Output $rs.Fields.Item('System.ItemPathDisplay').Value; $rs.MoveNext(); }");
        
        let output = std::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(&ps_script)
            .output()
            .map_err(|e| e.to_string())?;
            
        let output_str = String::from_utf8_lossy(&output.stdout);
        let results: Vec<String> = output_str.lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
            
        let mut final_results = Vec::new();
        for path in results {
            let mut date_str = String::new();
            if let Ok(metadata) = std::fs::metadata(&path) {
                if let Ok(modified) = metadata.modified() {
                    let datetime: chrono::DateTime<chrono::Local> = modified.into();
                    date_str = datetime.format("%Y-%m-%d %H:%M").to_string();
                }
            }
            final_results.push(SearchFileResult { path, date: date_str });
        }
        return Ok(final_results);
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(vec![])
    }
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // When a second instance is launched, show the main window of the first
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }))
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![
        get_running_apps,
        get_installed_apps,
        categorize_app,
        focus_window,
        toggle_spotlight,
        hide_spotlight,
        launch_app,
        launch_app_with_args,
        open_folder,
        search_files,
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

      // Check for updates in the background on startup
      let update_handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
          use tauri_plugin_updater::UpdaterExt;
          match update_handle.updater() {
              Ok(updater) => match updater.check().await {
                  Ok(Some(update)) => {
                      log::info!("[Updater] New version available: {}", update.version);
                      let _ = update_handle.emit("update-available", &update.version);
                  }
                  Ok(None) => log::info!("[Updater] App is up to date"),
                  Err(e) => log::warn!("[Updater] Update check failed: {}", e),
              },
              Err(e) => log::warn!("[Updater] Updater init failed: {}", e),
          }
      });

      // Hide main window on close instead of quitting, show on dock click
      if let Some(main_window) = app.get_webview_window("main") {
          let win = main_window.clone();
          main_window.on_window_event(move |event| {
              if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                  api.prevent_close();
                  win.hide().unwrap();
              }
          });
      }

      // System tray icon — lets users show/hide the window and quit cleanly
      let show_item = MenuItem::with_id(app, "show", "Show CoolDesk", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

      TrayIconBuilder::new()
          .icon(app.default_window_icon().unwrap().clone())
          .menu(&tray_menu)
          .tooltip("CoolDesk")
          .on_menu_event(|app, event| match event.id.as_ref() {
              "show" => {
                  if let Some(window) = app.get_webview_window("main") {
                      let _ = window.show();
                      let _ = window.set_focus();
                  }
              }
              "quit" => {
                  app.exit(0);
              }
              _ => {}
          })
          .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent| {
              if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                  let app = tray.app_handle();
                  if let Some(window) = app.get_webview_window("main") {
                      if window.is_visible().unwrap_or(false) {
                          let _ = window.hide();
                      } else {
                          let _ = window.show();
                          let _ = window.set_focus();
                      }
                  }
              }
          })
          .build(app)?;

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
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app_handle, _event| {
        // macOS dock icon reopen handling would go here if needed
        // RunEvent::Reopen is macOS-specific and not available on Windows
    });
}

