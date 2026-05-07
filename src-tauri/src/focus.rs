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
        BringWindowToTop, EnumWindows, GetAncestor,
        GetForegroundWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindow, SwitchToThisWindow, GA_ROOT, SW_RESTORE, SW_SHOW,
    };

    /// Focus a window by its handle (HWND)
    pub fn focus_window_by_hwnd(hwnd: isize) -> FocusResult<()> {
        let hwnd = normalize_focus_hwnd(HWND(hwnd as *mut _));
        if focus_window_aggressive(hwnd, None) {
            Ok(())
        } else {
            Err(FocusError::CommandFailed("Failed to bring target window to foreground".to_string()))
        }
    }

    /// Focus a window by process ID, optionally with process name fallback
    pub fn focus_window_by_pid(pid: u32, process_name: Option<&str>) -> FocusResult<()> {
        // Try by PID first (Win32 SetForegroundWindow path)
        if try_focus_pid(pid) {
            return Ok(());
        }

        // For MSIX/packaged apps (e.g. Windows Terminal) Win32 focus can fail
        // even though the window exists. Try the shell activation path: this calls
        // IApplicationActivationManager::ActivateApplication, the same channel
        // Windows uses when you click the taskbar button, so the app's WinUI
        // activation handler receives it cleanly with no focus race.
        if let Some(aumid) = get_aumid_for_pid(pid) {
            log::info!("[Focus] Packaged app detected (AUMID: {}), trying shell activation", aumid);
            if activate_via_aumid(&aumid) {
                return Ok(());
            }
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
                    if focus_window_aggressive(hwnd, Some(ctx.target_pid)) {
                        ctx.found = true;
                        return windows::Win32::Foundation::FALSE; // Stop enumeration
                    }
                }
            }
            windows::Win32::Foundation::TRUE // Continue
        }

        unsafe {
            let _ = EnumWindows(Some(enum_callback), LPARAM(&mut ctx as *mut Ctx as isize));
        }

        ctx.found
    }

    /// Returns the AUMID for a packaged (MSIX) process, or None for plain Win32 apps.
    fn get_aumid_for_pid(pid: u32) -> Option<String> {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

            // First call: null buffer → get required length
            let mut len: u32 = 0;
            let _ = GetApplicationUserModelId(
                handle,
                &mut len,
                windows::core::PWSTR(std::ptr::null_mut()),
            );

            if len == 0 {
                let _ = CloseHandle(handle);
                return None;
            }

            let mut buf = vec![0u16; len as usize];
            let err = GetApplicationUserModelId(
                handle,
                &mut len,
                windows::core::PWSTR(buf.as_mut_ptr()),
            );
            let _ = CloseHandle(handle);

            // ERROR_SUCCESS = WIN32_ERROR(0)
            if err.0 != 0 {
                return None;
            }

            let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            let aumid = String::from_utf16_lossy(&buf[..end]);
            if aumid.is_empty() { None } else { Some(aumid) }
        }
    }

    /// Activate a packaged app via IApplicationActivationManager — the "building
    /// manager" path. Windows routes the request through the app's own activation
    /// channel (same as clicking the taskbar button), so WinUI apps like Windows
    /// Terminal handle it cleanly without a focus race.
    ///
    /// ⚠ For multi-instance apps (Windows Terminal's default) this may open a
    /// new window rather than focusing the existing one. Prefer Win32
    /// SetForegroundWindow for a specific known HWND; use this only as a fallback.
    fn activate_via_aumid(aumid: &str) -> bool {
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{IApplicationActivationManager, ACTIVATEOPTIONS};
        use windows::core::GUID;

        // CLSID_ApplicationActivationManager = {45BA127D-10A8-46EA-8AB7-56EA9078943C}
        const CLSID_AAM: GUID = GUID {
            data1: 0x45BA_127D,
            data2: 0x10A8,
            data3: 0x46EA,
            data4: [0x8A, 0xB7, 0x56, 0xEA, 0x90, 0x78, 0x94, 0x3C],
        };

        unsafe {
            // Ignore S_FALSE / RPC_E_CHANGED_MODE — thread may already have COM.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

            let manager: windows::core::Result<IApplicationActivationManager> =
                CoCreateInstance(&CLSID_AAM, None, CLSCTX_ALL);

            let manager = match manager {
                Ok(m) => m,
                Err(e) => {
                    log::warn!("[Focus] IApplicationActivationManager unavailable: {}", e);
                    return false;
                }
            };

            // &HSTRING implements Param<PCWSTR>; PWSTR(null) for empty arguments.
            let aumid_h = windows::core::HSTRING::from(aumid);
            // ActivateApplication returns Result<u32> where the u32 is the new PID.
            match manager.ActivateApplication(
                &aumid_h,
                windows::core::PWSTR(std::ptr::null_mut()),
                ACTIVATEOPTIONS(0),
            ) {
                Ok(new_pid) => {
                    log::info!(
                        "[Focus] AUMID activation ok: '{}' → new_pid={}",
                        aumid, new_pid
                    );
                    true
                }
                Err(e) => {
                    log::warn!("[Focus] AUMID activation failed for '{}': {}", aumid, e);
                    false
                }
            }
        }
    }

    fn normalize_focus_hwnd(hwnd: HWND) -> HWND {
        unsafe {
            let root = GetAncestor(hwnd, GA_ROOT);
            if root.0.is_null() { hwnd } else { root }
        }
    }

    fn foreground_matches_target(target_hwnd: HWND, target_pid: Option<u32>) -> bool {
        unsafe {
            let foreground = GetForegroundWindow();
            if foreground == target_hwnd {
                return true;
            }

            let foreground_root = normalize_focus_hwnd(foreground);
            if foreground_root == target_hwnd {
                return true;
            }

            if let Some(pid) = target_pid {
                let mut foreground_pid: u32 = 0;
                GetWindowThreadProcessId(foreground, Some(&mut foreground_pid));
                if foreground_pid == pid {
                    return true;
                }
                let mut foreground_root_pid: u32 = 0;
                GetWindowThreadProcessId(foreground_root, Some(&mut foreground_root_pid));
                if foreground_root_pid == pid {
                    return true;
                }
            }

            false
        }
    }

    /// Check whether a window lives on the current virtual desktop.
    /// Returns true as a safe default if the COM query fails.
    fn is_window_on_current_desktop(hwnd: HWND) -> bool {
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::IVirtualDesktopManager;
        use windows::core::GUID;

        // CLSID_VirtualDesktopManager = {AA509086-5CA9-4C25-8F95-589D3C07B48A}
        const CLSID_VDM: GUID = GUID {
            data1: 0xaa509086,
            data2: 0x5ca9,
            data3: 0x4c25,
            data4: [0x8f, 0x95, 0x58, 0x9d, 0x3c, 0x07, 0xb4, 0x8a],
        };

        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let mgr: windows::core::Result<IVirtualDesktopManager> =
                CoCreateInstance(&CLSID_VDM, None, CLSCTX_ALL);
            match mgr {
                Ok(m) => m.IsWindowOnCurrentVirtualDesktop(hwnd)
                    .map(|b| b.as_bool())
                    .unwrap_or(true),
                Err(_) => true,
            }
        }
    }

    fn focus_window_aggressive(hwnd: HWND, target_pid: Option<u32>) -> bool {
        let hwnd = normalize_focus_hwnd(hwnd);
        unsafe {
            let before_foreground = normalize_focus_hwnd(GetForegroundWindow());
            let mut before_pid: u32 = 0;
            GetWindowThreadProcessId(before_foreground, Some(&mut before_pid));

            // Restore if minimized
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }

            // Detect virtual desktop to tune sleep duration only.
            // SwitchToThisWindow is always called — it works for both same-desktop
            // and cross-desktop. Never skip it: if COM detection fails and returns
            // true (same desktop), cross-desktop windows would get no focus attempt.
            let on_current_desktop = is_window_on_current_desktop(hwnd);
            log::info!("[Focus] hwnd={:?} on_current_desktop={}", hwnd.0, on_current_desktop);

            // AllowSetForegroundWindow(ASFW_ANY) was pre-called from hide_spotlight,
            // so the subsequent SetForegroundWindow will succeed without the old
            // SendInput(VK_MENU) workaround (which was unreliable from a bg thread).
            // fAltTab=FALSE = direct launcher-style activation (not Alt+Tab switcher).
            SwitchToThisWindow(hwnd, false);

            // Longer sleep for cross-desktop to allow the desktop animation to finish.
            let switch_sleep_ms = if on_current_desktop { 50 } else { 150 };
            std::thread::sleep(std::time::Duration::from_millis(switch_sleep_ms));

            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
            let _ = ShowWindow(hwnd, SW_SHOW);

            std::thread::sleep(std::time::Duration::from_millis(100));
            let mut focused = foreground_matches_target(hwnd, target_pid);

            if !focused {
                let _ = SetForegroundWindow(hwnd);
                std::thread::sleep(std::time::Duration::from_millis(80));
                focused = foreground_matches_target(hwnd, target_pid);
            }

            let after_foreground = normalize_focus_hwnd(GetForegroundWindow());
            let mut after_pid: u32 = 0;
            GetWindowThreadProcessId(after_foreground, Some(&mut after_pid));

            log::info!(
                "[Focus] target_hwnd={:?} target_pid={:?} cross_desktop={} before_pid={} after_pid={} success={}",
                hwnd.0, target_pid, !on_current_desktop, before_pid, after_pid, focused
            );

            focused
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
        if let Ok(()) = focus_window_by_hwnd(h) {
            return Ok(());
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
        tolerance: i32,
        result: Option<isize>,
    }

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

        let t = ctx.tolerance;
        if (log_left - ctx.x).abs() <= t
            && (log_top - ctx.y).abs() <= t
            && (log_w - ctx.w).abs() <= t
            && (log_h - ctx.h).abs() <= t
        {
            ctx.result = Some(hwnd.0 as isize);
            return BOOL(0); // stop enumeration
        }
        BOOL(1)
    }

    // Pass 1: tight tolerance (20px) — avoids matching a neighbouring window
    let mut ctx = SearchCtx { pids: pids.clone(), x, y, w: width, h: height, tolerance: 20, result: None };
    unsafe { let _ = EnumWindows(Some(callback), LPARAM(&mut ctx as *mut SearchCtx as isize)); }

    if ctx.result.is_some() {
        log::info!("[Focus] find_hwnd_by_bounds: matched '{}' at ({},{} {}x{}) with tight tolerance", process_name, x, y, width, height);
        return ctx.result;
    }

    // Pass 2: relaxed tolerance (50px) — handles fractional DPI and slight window drift
    let mut ctx2 = SearchCtx { pids, x, y, w: width, h: height, tolerance: 50, result: None };
    unsafe { let _ = EnumWindows(Some(callback), LPARAM(&mut ctx2 as *mut SearchCtx as isize)); }

    if ctx2.result.is_some() {
        log::info!("[Focus] find_hwnd_by_bounds: matched '{}' at ({},{} {}x{}) with relaxed tolerance", process_name, x, y, width, height);
    } else {
        log::warn!("[Focus] find_hwnd_by_bounds: no match for '{}' at ({},{} {}x{})", process_name, x, y, width, height);
    }
    ctx2.result
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
