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
        BringWindowToTop, EnumWindows,
        GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindow, SwitchToThisWindow, SW_RESTORE, SW_SHOW,
    };

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
        use windows::Win32::Foundation::LPARAM;

        struct Ctx {
            target_pid: u32,
            found: bool,
        }

        let mut ctx = Ctx { target_pid: pid, found: false };

        unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> windows::Win32::Foundation::BOOL {
            let ctx = &mut *(lparam.0 as *mut Ctx);
            let mut window_pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut window_pid));

            if window_pid == ctx.target_pid {
                let len = GetWindowTextLengthW(hwnd);
                let visible = IsWindowVisible(hwnd).as_bool();

                // Require both a non-empty title AND visible — avoids focusing
                // invisible GPU/renderer helper windows that browsers spawn.
                if len > 0 && visible {
                    focus_window_aggressive(hwnd);
                    ctx.found = true;
                    return windows::Win32::Foundation::FALSE; // Stop enumeration
                }
            }
            windows::Win32::Foundation::TRUE // Continue
        }

        unsafe {
            let _ = EnumWindows(Some(enum_callback), LPARAM(&mut ctx as *mut Ctx as isize));
        }

        ctx.found
    }

    fn focus_window_aggressive(hwnd: HWND) {
        unsafe {
            // Restore if minimized
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }

            // SwitchToThisWindow handles cross-virtual-desktop switching without
            // AttachThreadInput (which caused "Default IME not responding" errors).
            SwitchToThisWindow(hwnd, true);

            // Brief delay so the desktop switch can complete
            std::thread::sleep(std::time::Duration::from_millis(50));

            // Bypass Windows foreground lock using SendInput (not deprecated keybd_event).
            // Simulating a key event convinces Windows to grant SetForegroundWindow permission
            // without merging thread input queues (safe for IME).
            use windows::Win32::UI::Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_MENU,
            };
            let inputs = [
                INPUT { r#type: INPUT_KEYBOARD, Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                    ki: KEYBDINPUT { wVk: VK_MENU, wScan: 0, dwFlags: Default::default(), time: 0, dwExtraInfo: 0 }
                }},
                INPUT { r#type: INPUT_KEYBOARD, Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                    ki: KEYBDINPUT { wVk: VK_MENU, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 }
                }},
            ];
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);

            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
            let _ = ShowWindow(hwnd, SW_SHOW);
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
        let result = focus_window_by_hwnd(h);
        match result {
            Ok(()) => return Ok(()),
            // PlatformNotSupported means hwnd focus isn't available (e.g. macOS where
            // we store CGWindowID in hwnd but can't activate by it directly).
            // Fall through to the PID / name approach instead.
            Err(FocusError::PlatformNotSupported) => {}
            Err(e) => return Err(e),
        }
    }

    if let Some(p) = pid {
        return focus_window_by_pid(p, process_name);
    }

    Err(FocusError::WindowNotFound)
}

/// Find the OS window handle for a browser window by matching its screen bounds.
/// Used to target a specific browser window precisely when multiple windows are open.
/// Returns None on non-Windows platforms or when no match is found.
#[cfg(target_os = "windows")]
pub fn find_hwnd_by_bounds(process_name: &str, x: i32, y: i32, width: i32, height: i32) -> Option<isize> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
    };
    use sysinfo::{ProcessRefreshKind, System};

    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new());
    let name_clean = process_name.trim_end_matches(".exe").to_lowercase();
    let pids: Vec<u32> = sys
        .processes()
        .iter()
        .filter(|(_, p)| p.name().to_lowercase().contains(&name_clean))
        .map(|(pid, _)| pid.as_u32())
        .collect();

    if pids.is_empty() {
        return None;
    }

    struct SearchCtx {
        pids: Vec<u32>,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        result: Option<isize>,
    }

    let mut ctx = SearchCtx { pids, x, y, w: width, h: height, result: None };

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut SearchCtx);
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if !ctx.pids.contains(&pid) || !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        // Prefer DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS) over GetWindowRect.
        // On Windows 10/11, GetWindowRect includes the invisible DWM shadow/extended frame
        // (~7px on each side) while Chrome's chrome.windows.get() reports visible bounds.
        // DWMWA_EXTENDED_FRAME_BOUNDS returns the actual visible rect in physical pixels.
        use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
        use windows::Win32::UI::HiDpi::GetDpiForWindow;
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let got_rect = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut std::ffi::c_void,
            std::mem::size_of::<RECT>() as u32,
        ).is_ok();
        // Fallback to GetWindowRect if DWM attribute unavailable (e.g. minimised)
        if !got_rect {
            if GetWindowRect(hwnd, &mut rect).is_err() {
                return BOOL(1);
            }
        }

        // Convert physical pixels → logical pixels using per-window DPI.
        // Chrome API reports logical (CSS) pixels; Win32 reports physical pixels.
        let dpi = GetDpiForWindow(hwnd) as f64;
        let scale = if dpi > 0.0 { dpi / 96.0 } else { 1.0 };
        let log_left = (rect.left  as f64 / scale).round() as i32;
        let log_top  = (rect.top   as f64 / scale).round() as i32;
        let log_w    = ((rect.right  - rect.left) as f64 / scale).round() as i32;
        let log_h    = ((rect.bottom - rect.top)  as f64 / scale).round() as i32;

        const TOLERANCE: i32 = 20;
        if (log_left - ctx.x).abs() <= TOLERANCE
            && (log_top - ctx.y).abs() <= TOLERANCE
            && (log_w - ctx.w).abs() <= TOLERANCE
            && (log_h - ctx.h).abs() <= TOLERANCE
        {
            ctx.result = Some(hwnd.0 as isize);
            return BOOL(0);
        }
        BOOL(1)
    }

    unsafe {
        let _ = EnumWindows(Some(callback), LPARAM(&mut ctx as *mut SearchCtx as isize));
    }

    ctx.result
}

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
        let result = focus_window_by_pid(999999, None);
        assert!(matches!(result, Err(FocusError::WindowNotFound)));
    }
}
