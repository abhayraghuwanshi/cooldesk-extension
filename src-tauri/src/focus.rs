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

#[derive(Debug)]
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

// ============================================================================
// Windows Implementation
// ============================================================================

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetForegroundWindow,
        GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindow, SwitchToThisWindow, SW_RESTORE, SW_SHOW,
    };
    use windows::Win32::System::Threading::{GetCurrentThreadId, AttachThreadInput};

    /// Focus a window by its handle (HWND)
    pub fn focus_window_by_hwnd(hwnd: isize) -> FocusResult<()> {
        let hwnd = HWND(hwnd as *mut _);
        focus_window_aggressive(hwnd);
        Ok(())
    }

    /// Focus a window by process ID, optionally with process name fallback
    pub fn focus_window_by_pid(pid: u32, process_name: Option<&str>) -> FocusResult<()> {
        // Try by PID first
        if try_focus_pid(pid) {
            return Ok(());
        }

        // Fallback: try by process name if provided
        if let Some(name) = process_name {
            let name_clean = name.trim_end_matches(".exe");

            // Use sysinfo to find processes by name
            use sysinfo::{System, ProcessRefreshKind};
            let mut sys = System::new();
            sys.refresh_processes_specifics(ProcessRefreshKind::new());

            for (proc_pid, process) in sys.processes() {
                if process.name().to_lowercase().contains(&name_clean.to_lowercase()) {
                    if try_focus_pid(proc_pid.as_u32()) {
                        return Ok(());
                    }
                }
            }
        }

        Err(FocusError::WindowNotFound)
    }

    fn try_focus_pid(pid: u32) -> bool {
        use std::sync::atomic::{AtomicBool, Ordering};

        static FOUND: AtomicBool = AtomicBool::new(false);
        FOUND.store(false, Ordering::SeqCst);

        // Store the target PID in a thread-local for the callback
        thread_local! {
            static TARGET_PID: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
        }
        TARGET_PID.with(|p| p.set(pid));

        unsafe extern "system" fn enum_callback(hwnd: HWND, _: windows::Win32::Foundation::LPARAM) -> windows::Win32::Foundation::BOOL {
            let mut window_pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut window_pid));

            let target = TARGET_PID.with(|p| p.get());

            if window_pid == target {
                let len = GetWindowTextLengthW(hwnd);
                let visible = IsWindowVisible(hwnd).as_bool();

                if len > 0 || visible {
                    focus_window_aggressive(hwnd);
                    FOUND.store(true, Ordering::SeqCst);
                    return windows::Win32::Foundation::FALSE; // Stop enumeration
                }
            }
            windows::Win32::Foundation::TRUE // Continue
        }

        unsafe {
            let _ = EnumWindows(Some(enum_callback), windows::Win32::Foundation::LPARAM(0));
        }

        FOUND.load(Ordering::SeqCst)
    }

    fn focus_window_aggressive(hwnd: HWND) {
        unsafe {
            // Simulate Alt key press/release to allow SetForegroundWindow
            simulate_alt_key();

            let foreground = GetForegroundWindow();
            let mut unused_pid: u32 = 0;
            let foreground_thread = GetWindowThreadProcessId(foreground, Some(&mut unused_pid));
            let current_thread = GetCurrentThreadId();

            // Attach to foreground thread
            let attached = if foreground_thread != current_thread {
                AttachThreadInput(current_thread, foreground_thread, true).as_bool()
            } else {
                false
            };

            // Restore if minimized
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }

            // Method 1: SwitchToThisWindow (works across virtual desktops)
            SwitchToThisWindow(hwnd, true);

            // Small delay
            std::thread::sleep(std::time::Duration::from_millis(50));

            // Method 2: BringWindowToTop + SetForegroundWindow
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);

            // Method 3: Show window
            let _ = ShowWindow(hwnd, SW_SHOW);

            // Detach
            if attached {
                let _ = AttachThreadInput(current_thread, foreground_thread, false);
            }
        }
    }

    fn simulate_alt_key() {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            keybd_event, KEYEVENTF_KEYUP, VK_MENU,
        };
        unsafe {
            keybd_event(VK_MENU.0 as u8, 0, Default::default(), 0);
            keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        }
    }
}

// ============================================================================
// macOS Implementation
// ============================================================================

#[cfg(target_os = "macos")]
mod platform {
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
}

// ============================================================================
// Linux Implementation
// ============================================================================

#[cfg(target_os = "linux")]
mod platform {
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
}

// ============================================================================
// Unsupported platforms
// ============================================================================

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;

    pub fn focus_window_by_hwnd(_hwnd: isize) -> FocusResult<()> {
        Err(FocusError::PlatformNotSupported)
    }

    pub fn focus_window_by_pid(_pid: u32, _process_name: Option<&str>) -> FocusResult<()> {
        Err(FocusError::PlatformNotSupported)
    }
}

// ============================================================================
// Public API
// ============================================================================

pub use platform::*;

/// Convenience function that handles both HWND and PID modes
/// Similar to the original AppFocus.exe CLI interface
pub fn focus_window(hwnd: Option<isize>, pid: Option<u32>, process_name: Option<&str>) -> FocusResult<()> {
    if let Some(h) = hwnd {
        return focus_window_by_hwnd(h);
    }

    if let Some(p) = pid {
        return focus_window_by_pid(p, process_name);
    }

    Err(FocusError::WindowNotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "windows")]
    fn test_focus_nonexistent_pid() {
        // Should return WindowNotFound for a PID that doesn't exist
        let result = focus_window_by_pid(999999, None);
        assert!(matches!(result, Err(FocusError::WindowNotFound)));
    }
}
