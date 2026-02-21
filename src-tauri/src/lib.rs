use sysinfo::System;
use tauri_plugin_shell::ShellExt;
use serde::Serialize;
use tauri::Manager; // Import Manager trait
use std::collections::HashMap;

// Rust sidecar server module
mod sidecar;

#[derive(Serialize, Clone)]
struct RunningApp {
    id: String,
    name: String,
    title: String,
    path: String,
    pid: u32,
    icon: Option<String>,
}

#[cfg(target_os = "windows")]
mod windows_taskbar {
    use std::collections::HashMap;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE, GW_OWNER,
        WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };

    pub struct TaskbarWindow {
        pub pid: u32,
        pub title: String,
    }

    struct EnumData {
        windows: Vec<TaskbarWindow>,
    }

    unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let data = &mut *(lparam.0 as *mut EnumData);

        // Check if window is visible
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;

        // Skip tool windows unless they have APPWINDOW style
        if (ex_style & WS_EX_TOOLWINDOW.0) != 0 && (ex_style & WS_EX_APPWINDOW.0) == 0 {
            return BOOL(1);
        }

        // Skip owned windows unless they have APPWINDOW style
        if let Ok(owner) = GetWindow(hwnd, GW_OWNER) {
            if owner.0 != std::ptr::null_mut() && (ex_style & WS_EX_APPWINDOW.0) == 0 {
                return BOOL(1);
            }
        }

        // Skip windows with empty titles
        let title_len = GetWindowTextLengthW(hwnd);
        if title_len == 0 {
            return BOOL(1);
        }

        // Get window title
        let mut buffer: Vec<u16> = vec![0; (title_len + 1) as usize];
        let len = GetWindowTextW(hwnd, &mut buffer);
        let title = OsString::from_wide(&buffer[..len as usize])
            .to_string_lossy()
            .to_string();

        // Get process ID
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        if pid > 0 {
            data.windows.push(TaskbarWindow { pid, title });
        }

        BOOL(1)
    }

    pub fn get_taskbar_windows() -> HashMap<u32, String> {
        let mut data = EnumData { windows: Vec::new() };

        unsafe {
            let _ = EnumWindows(
                Some(enum_callback),
                LPARAM(&mut data as *mut EnumData as isize),
            );
        }

        // Deduplicate by PID, keeping the longest title
        let mut result: HashMap<u32, String> = HashMap::new();
        for win in data.windows {
            result
                .entry(win.pid)
                .and_modify(|existing| {
                    if win.title.len() > existing.len() {
                        *existing = win.title.clone();
                    }
                })
                .or_insert(win.title);
        }
        result
    }
}

#[tauri::command]
async fn get_running_apps() -> Vec<RunningApp> {
    #[cfg(target_os = "windows")]
    {
        // Get taskbar-visible window PIDs
        let taskbar_windows = windows_taskbar::get_taskbar_windows();

        if taskbar_windows.is_empty() {
            return Vec::new();
        }

        let mut sys = System::new_all();
        sys.refresh_all();

        // Filter processes to only those with taskbar windows
        let mut apps: HashMap<String, RunningApp> = HashMap::new();

        for (pid, process) in sys.processes() {
            let pid_u32 = pid.as_u32();
            if let Some(window_title) = taskbar_windows.get(&pid_u32) {
                let name = process.name().to_string();
                let name_lower = name.to_lowercase();

                // Normalize name by removing .exe suffix for comparison
                let name_normalized = name_lower.trim_end_matches(".exe");

                // Skip known system/helper processes
                if name_normalized.contains("helper") || name_normalized.contains("renderer") ||
                   name_normalized.contains("broker") || name_normalized.contains("crashpad") ||
                   name_normalized == "applicationframehost" || name_normalized == "textinputhost" ||
                   name_normalized == "shellexperiencehost" || name_normalized == "searchhost" ||
                   name_normalized == "systemsettings" || name_normalized == "lockapp" ||
                   name_normalized == "startmenuexperiencehost" || name_normalized == "runtimebroker" ||
                   name_normalized == "smartscreen" || name_normalized == "securityhealthsystray" ||
                   name_normalized == "ctfmon" || name_normalized == "conhost" ||
                   name_normalized == "searchui" || name_normalized == "sihost" ||
                   name_normalized == "taskhostw" || name_normalized == "dwm" ||
                   name_normalized.starts_with("msedgewebview2") {
                    continue;
                }

                // Deduplicate by app name, keep the one with better title
                let entry = apps.entry(name_lower.clone()).or_insert_with(|| RunningApp {
                    id: format!("app-{}", pid_u32),
                    name: name.clone(),
                    title: window_title.clone(),
                    path: process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                    pid: pid_u32,
                    icon: None,
                });

                // Update if this instance has a longer title
                if window_title.len() > entry.title.len() {
                    entry.title = window_title.clone();
                    entry.pid = pid_u32;
                    entry.id = format!("app-{}", pid_u32);
                }
            }
        }

        apps.into_values().collect()
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Fallback for non-Windows: return all processes (original behavior)
        let mut sys = System::new_all();
        sys.refresh_all();

        sys.processes().iter().map(|(pid, process)| {
            RunningApp {
                id: pid.to_string(),
                name: process.name().to_string(),
                title: process.name().to_string(),
                path: process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                pid: pid.as_u32(),
                icon: None,
            }
        }).collect()
    }
}

#[tauri::command]
async fn get_installed_apps(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let output = app.shell().command("AppScanner")
        .output()
        .await
        .map_err(|e| e.to_string())?;
    
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // println!("[AppScanner] Raw Output: {}", stdout); // DEBUG LOG
        serde_json::from_str(&stdout).map_err(|e| e.to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("AppScanner failed: {}", stderr);
        Err(format!("AppScanner failed: {}", stderr))
    }
}

#[tauri::command]
async fn focus_window(app: tauri::AppHandle, pid: u32, name: Option<String>) -> Result<(), String> {
    let mut command = app.shell().command("AppFocus");
    command = command.args([pid.to_string()]);
    
    if let Some(n) = name {
        command = command.args([n]);
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
        launch_app
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

