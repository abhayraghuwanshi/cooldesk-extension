// Linux (X11) window-focus implementation via `xdotool`. Not supported under
// Wayland — its security model prevents focusing arbitrary windows. See
// `focus.rs` for the module-level overview and public API.

use super::*;
use std::process::Command;

/// Focus a window by X11 window ID
/// Use `xdotool search --pid <pid>` to get window IDs
pub fn focus_window_by_hwnd(window_id: isize) -> FocusResult<()> {
    // Check if we're on Wayland
    if is_wayland() {
        return Err(FocusError::PlatformNotSupported);
    }

    let result = Command::new("xdotool")
        .args(["windowactivate", "--sync", &window_id.to_string()])
        .output();

    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("command not found") || stderr.contains("No such file") {
                Err(FocusError::CommandFailed(
                    "xdotool not installed. Run: sudo apt install xdotool".to_string()
                ))
            } else {
                Err(FocusError::CommandFailed(stderr.to_string()))
            }
        }
        Err(e) => Err(FocusError::CommandFailed(e.to_string())),
    }
}

/// Focus a window by process ID using xdotool
pub fn focus_window_by_pid(pid: u32, process_name: Option<&str>) -> FocusResult<()> {
    if is_wayland() {
        return Err(FocusError::PlatformNotSupported);
    }

    // Method 1: Search by PID
    let result = Command::new("xdotool")
        .args(["search", "--pid", &pid.to_string()])
        .output();

    if let Ok(output) = result {
        if output.status.success() {
            let window_ids = String::from_utf8_lossy(&output.stdout);
            if let Some(window_id) = window_ids.lines().next() {
                if !window_id.is_empty() {
                    return focus_window_by_hwnd(window_id.parse().unwrap_or(0));
                }
            }
        }
    }

    // Method 2: Search by name if provided
    if let Some(name) = process_name {
        let result = Command::new("xdotool")
            .args(["search", "--name", name])
            .output();

        if let Ok(output) = result {
            if output.status.success() {
                let window_ids = String::from_utf8_lossy(&output.stdout);
                if let Some(window_id) = window_ids.lines().next() {
                    if !window_id.is_empty() {
                        return focus_window_by_hwnd(window_id.parse().unwrap_or(0));
                    }
                }
            }
        }
    }

    Err(FocusError::WindowNotFound)
}

fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        && std::env::var("XDG_SESSION_TYPE")
            .map(|v| v == "wayland")
            .unwrap_or(false)
}
