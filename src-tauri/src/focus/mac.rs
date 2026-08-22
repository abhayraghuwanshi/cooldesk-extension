// macOS window-focus implementation: AppleScript via `osascript`. See
// `focus.rs` for the module-level overview and public API.

use super::*;
use std::process::Command;

/// Focus a window by its handle - not directly supported on macOS
/// Use focus_window_by_pid instead
pub fn focus_window_by_hwnd(_hwnd: isize) -> FocusResult<()> {
    Err(FocusError::PlatformNotSupported)
}

/// Focus a window by process ID.
pub fn focus_window_by_pid(pid: u32, process_name: Option<&str>) -> FocusResult<()> {
    // Method 1: `open -a <name>` — the same LaunchServices "open application"
    // path Finder/the Dock use for a Dock-icon click. This is NOT equivalent
    // to AppleScript `activate`: for an app that's running but currently has
    // zero windows (e.g. Music.app launched headlessly as a login-item media
    // helper for AirPlay/media-key handling, never having shown its UI),
    // `open -a` reliably triggers the app's reopen-and-show-main-window
    // behavior, matching what clicking the real Dock icon does — whereas
    // `activate` can just bring the (still windowless) process forward with
    // nothing to see. It also needs no Automation/Apple Events permission,
    // unlike everything below.
    if let Some(name) = process_name {
        let app_name = name.trim_end_matches(".app").trim_end_matches(".exe");
        let result = Command::new("open").args(["-a", app_name]).output();
        if let Ok(output) = &result {
            if output.status.success() {
                return Ok(());
            }
        }
    }

    // Method 2: AppleScript `activate` by name — covers apps `open -a` can't
    // resolve by that name but System Events can still address by identity.
    if let Some(name) = process_name {
        // Strip " to prevent breaking out of the AppleScript string literal.
        // App names never legitimately contain double-quotes.
        let app_name = name
            .trim_end_matches(".app")
            .trim_end_matches(".exe")
            .replace('"', "");
        let script = format!(r#"tell application "{}" to activate"#, app_name);

        let result = Command::new("osascript").args(["-e", &script]).output();

        if let Ok(output) = &result {
            if output.status.success() {
                return Ok(());
            }
        }
    }

    // Method 3: System Events by PID — last resort. This only flips
    // window-server frontmost state — it does NOT trigger an app's
    // reopen-a-window behavior, so it can report success for a windowless
    // process without actually showing anything. Used only when we have no
    // app name, or both methods above failed.
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
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(FocusError::CommandFailed(stderr.to_string()))
        }
        Err(e) => Err(FocusError::CommandFailed(e.to_string())),
    }
}
