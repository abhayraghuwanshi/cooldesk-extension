//! Cross-platform window focus module
//!
//! # Platform Support
//! - **Windows**: Full support via Win32 APIs (SetForegroundWindow, AttachThreadInput, etc.)
//! - **macOS**: Support via AppleScript (osascript)
//! - **Linux X11**: Support via xdotool (must be installed)
//! - **Linux Wayland**: Not supported (Wayland security model prevents focusing arbitrary windows)
//!
//! # Compilation
//!
//! ## Windows
//! No extra setup needed. Uses the `windows` crate.
//!
//! ## macOS
//! No extra setup needed. Uses `osascript` which is pre-installed on all Macs.
//!
//! ## Linux
//! Requires `xdotool` to be installed:
//! ```sh
//! # Ubuntu/Debian
//! sudo apt install xdotool
//!
//! # Fedora
//! sudo dnf install xdotool
//!
//! # Arch
//! sudo pacman -S xdotool
//! ```
//!
//! # Usage
//! ```rust
//! use focus::{focus_window_by_hwnd, focus_window_by_pid};
//!
//! // Focus by window handle (Windows only)
//! focus_window_by_hwnd(hwnd)?;
//!
//! // Focus by process ID (cross-platform)
//! focus_window_by_pid(1234, Some("firefox"))?;
//! ```
//!
//! Platform code lives in per-OS submodules (`windows`, `mac`, `linux`) behind
//! this file's shared error type and the `focus_window_by_hwnd` /
//! `focus_window_by_pid` signatures each of them implements.

/// Executable stems that identify a browser, keyed by the id the extension sends.
///
/// The id arrives as a deviceId prefix ("brave"), an exe name ("msedge.exe"), or
/// an older build's coarse label, so it is normalised before lookup. Returning
/// exact stems matters: the previous substring match meant "edge" also matched
/// `msedgewebview2.exe`, so a browser focus that missed would foreground whatever
/// WebView2-hosted app enumerated first — an unrelated window stealing focus.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn browser_exe_stems(id: &str) -> Vec<String> {
    let clean = id.trim().to_lowercase();
    let clean = clean.trim_end_matches(".exe");
    let stems: &[&str] = match clean {
        "edge" | "msedge" | "microsoft edge" => &["msedge"],
        "chrome" | "chromium" | "google chrome" => &["chrome", "chromium"],
        "brave" | "brave-browser" => &["brave"],
        "vivaldi" => &["vivaldi"],
        "opera" | "opr" => &["opera"],
        "firefox" => &["firefox"],
        "arc" => &["arc"],
        "safari" => &["safari"],
        // Not a browser we know — focus by the name we were given
        other => return vec![other.to_string()],
    };
    stems.iter().map(|s| s.to_string()).collect()
}

/// Exact (stem) match of a process name against the candidates. Case-insensitive
/// and `.exe`-insensitive, but never a substring match — see `browser_exe_stems`.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn process_name_matches(process_name: &str, stems: &[String]) -> bool {
    let n = process_name.to_lowercase();
    let n = n.trim_end_matches(".exe");
    stems.iter().any(|s| s == n)
}

#[derive(Debug)]
#[allow(dead_code)]
pub enum FocusError {
    WindowNotFound,
    PlatformNotSupported,
    CommandFailed(String),
    InvalidHandle,
}

impl std::fmt::Display for FocusError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FocusError::WindowNotFound => write!(f, "No window found for the given PID"),
            FocusError::PlatformNotSupported => write!(f, "Window focusing not supported on this platform (Wayland?)"),
            FocusError::CommandFailed(msg) => write!(f, "Focus command failed: {}", msg),
            FocusError::InvalidHandle => write!(f, "Invalid window handle"),
        }
    }
}

impl std::error::Error for FocusError {}

pub type FocusResult<T> = Result<T, FocusError>;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
pub use mac::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod other {
    use super::*;

    pub fn focus_window_by_hwnd(_hwnd: isize) -> FocusResult<()> {
        Err(FocusError::PlatformNotSupported)
    }

    pub fn focus_window_by_pid(_pid: u32, _process_name: Option<&str>, _path: Option<&str>) -> FocusResult<()> {
        Err(FocusError::PlatformNotSupported)
    }
}
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub use other::*;

/// Convenience function that handles both HWND and PID modes. `path` is the
/// app's executable path when known — macOS uses it to resolve the exact
/// `.app` bundle via `open <bundle path>` instead of guessing an app name for
/// Launch Services, which fails whenever the process name differs from the
/// bundle's registered display name (VS Code's process is "Code", but its
/// bundle is "Visual Studio Code.app" — `open -a Code` fails outright).
pub fn focus_window(
    hwnd: Option<isize>,
    pid: Option<u32>,
    process_name: Option<&str>,
    path: Option<&str>,
) -> FocusResult<()> {
    if let Some(h) = hwnd {
        if let Ok(()) = focus_window_by_hwnd(h) {
            return Ok(());
        }
    }

    if let Some(p) = pid {
        return focus_window_by_pid(p, process_name, path);
    }

    Err(FocusError::WindowNotFound)
}

#[cfg(not(target_os = "windows"))]
pub fn close_window(_hwnd: Option<isize>, _pid: Option<u32>) -> FocusResult<()> {
    Err(FocusError::PlatformNotSupported)
}

/// Find the OS window handle for a browser window by matching its screen bounds.
/// Used to target a specific browser window precisely when multiple windows are open.
/// Returns None on non-Windows platforms or when no match is found.
#[cfg(not(target_os = "windows"))]
pub fn find_hwnd_by_bounds(
    _process_name: &str,
    _x: i32,
    _y: i32,
    _width: i32,
    _height: i32,
) -> Option<isize> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "windows")]
    fn test_focus_nonexistent_pid() {
        // Should return WindowNotFound for a PID that doesn't exist
        let result = focus_window_by_pid(999999, None, None);
        assert!(matches!(result, Err(FocusError::WindowNotFound)));
    }

    #[test]
    fn test_focus_error_display() {
        let err = FocusError::WindowNotFound;
        assert_eq!(err.to_string(), "No window found for the given PID");
    }
}
