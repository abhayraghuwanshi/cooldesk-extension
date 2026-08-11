// macOS window-focus implementation: AppleScript via `osascript`. See
// `focus.rs` for the module-level overview and public API.

use super::*;
use std::process::Command;

/// Focus a window by its handle - not directly supported on macOS
/// Use focus_window_by_pid instead
pub fn focus_window_by_hwnd(_hwnd: isize) -> FocusResult<()> {
    Err(FocusError::PlatformNotSupported)
}

/// Focus a window by process ID using AppleScript
pub fn focus_window_by_pid(pid: u32, process_name: Option<&str>) -> FocusResult<()> {
    // Method 1: Try by PID using System Events
    let script = format!(
        r#"tell application "System Events"
            set targetProcess to first process whose unix id is {}
            set frontmost of targetProcess to true
        end tell"#,
        pid
    );

    let result = Command::new("osascript")
        .args(["-e", &script])
        .output();

    match result {
        Ok(output) if output.status.success() => return Ok(()),
        _ => {}
    }

    // Method 2: Try by app name if provided
    if let Some(name) = process_name {
        let app_name = name.trim_end_matches(".app").trim_end_matches(".exe");
        // Strip " to prevent breaking out of the AppleScript string literal.
        // App names never legitimately contain double-quotes.
        let app_name = app_name.replace('"', "");
        let script = format!(
            r#"tell application "{}" to activate"#,
            app_name
        );

        let result = Command::new("osascript")
            .args(["-e", &script])
            .output();

        match result {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(FocusError::CommandFailed(stderr.to_string()));
            }
            Err(e) => return Err(FocusError::CommandFailed(e.to_string())),
        }
    }

    Err(FocusError::WindowNotFound)
}
