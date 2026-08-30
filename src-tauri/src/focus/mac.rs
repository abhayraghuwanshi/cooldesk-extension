// macOS window-focus implementation: AppleScript via `osascript`. See
// `focus.rs` for the module-level overview and public API.

use super::*;
use std::process::Command;

/// Focus a window by its handle - not directly supported on macOS
/// Use focus_window_by_pid instead
pub fn focus_window_by_hwnd(_hwnd: isize) -> FocusResult<()> {
    Err(FocusError::PlatformNotSupported)
}

/// The `.app` bundle a Unix executable path lives inside, e.g.
/// ".../Visual Studio Code.app/Contents/MacOS/Code" → ".../Visual Studio Code.app".
/// Every macOS app executable is nested this way, so this is exact — no name
/// guessing involved.
fn app_bundle_path(exe_path: &str) -> Option<&str> {
    let idx = exe_path.find(".app/")?;
    Some(&exe_path[..idx + 4])
}

/// Focus a window by process ID.
pub fn focus_window_by_pid(pid: u32, process_name: Option<&str>, path: Option<&str>) -> FocusResult<()> {
    // Method 0: `open <bundle path>` — identifies the exact app by its bundle
    // on disk, sidestepping Launch Services name lookup entirely. This is the
    // only method here that can't be defeated by a process/display name
    // mismatch (e.g. VS Code's process is "Code", not "Visual Studio Code"),
    // and — like Method 1 — needs no Automation/Apple Events permission.
    if let Some(exe_path) = path {
        if let Some(bundle) = app_bundle_path(exe_path) {
            let result = Command::new("open").arg(bundle).output();
            if let Ok(output) = &result {
                if output.status.success() {
                    return Ok(());
                }
            }
        }
    }

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

/// Gracefully close an app by asking it to quit via AppleScript — matches the
/// Windows WM_CLOSE behavior (lets the app run its own save-prompt flow)
/// rather than force-killing it. macOS windows have no `hwnd` concept in this
/// codebase, so only `pid` is used.
pub fn close_window(_hwnd: Option<isize>, pid: Option<u32>) -> FocusResult<()> {
    let pid = pid.ok_or(FocusError::WindowNotFound)?;

    // Resolve the running process's name from its PID, then ask *that* app
    // (not "System Events") to quit — only the real app can show its own
    // unsaved-changes prompt.
    let name_script = format!(
        r#"tell application "System Events" to name of first process whose unix id is {}"#,
        pid
    );
    if let Ok(name_output) = Command::new("osascript").args(["-e", &name_script]).output() {
        if name_output.status.success() {
            let app_name = String::from_utf8_lossy(&name_output.stdout).trim().replace('"', "");
            if !app_name.is_empty() {
                let quit_script = format!(r#"tell application "{}" to quit"#, app_name);
                if let Ok(quit_output) = Command::new("osascript").args(["-e", &quit_script]).output() {
                    if quit_output.status.success() {
                        return Ok(());
                    }
                }
            }
        }
    }

    // Fallback: SIGTERM the process directly, best-effort when it can't be
    // addressed by name (e.g. a headless helper System Events doesn't list).
    let result = Command::new("kill").arg(pid.to_string()).output();
    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(FocusError::CommandFailed(String::from_utf8_lossy(&output.stderr).to_string())),
        Err(e) => Err(FocusError::CommandFailed(e.to_string())),
    }
}
