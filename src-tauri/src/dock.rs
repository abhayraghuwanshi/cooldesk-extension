// Workspace Layout — Phase 1: the AppBar dock.
//
// Reserves a strip of the primary monitor's work area for CoolDesk via the
// native Windows AppBar API (`SHAppBarMessage`) — the same mechanism the
// taskbar uses. Once the strip is reserved, Windows itself shrinks the usable
// work area, so *maximized* application windows automatically resize to fit
// beside CoolDesk. We do NOT track or resize individual windows here (that's the
// FancyZones-style hard path the feature spec explicitly rejects); we claim the
// work area and let Windows do the rest.
//
// The strip can sit on any edge: "left"/"right" reserve a vertical panel,
// "top"/"bottom" reserve a horizontal taskbar-style bar.
//
// Only the maximized case is guaranteed. Restored (floating) windows that
// overlap the strip are left alone by design.

#[cfg(windows)]
pub fn set_dock(raw_hwnd: isize, edge: &str, thickness: i32) -> Result<(i32, i32, i32, i32), String> {
    imp::set_dock(raw_hwnd, edge, thickness)
}

#[cfg(windows)]
pub fn remove_dock() {
    imp::remove_dock();
}

/// Work area (monitor minus taskbar/appbars) of the monitor hosting the given
/// window, as (x, y, width, height) in physical pixels.
#[cfg(windows)]
pub fn work_area(raw_hwnd: isize) -> Option<(i32, i32, i32, i32)> {
    imp::work_area(raw_hwnd)
}

// Non-Windows stubs. The callers in lib.rs are all `#[cfg(windows)]`-gated, so
// these are never invoked off Windows — they exist only so the module compiles.
#[cfg(not(windows))]
pub fn set_dock(_raw_hwnd: isize, _edge: &str, _thickness: i32) -> Result<(i32, i32, i32, i32), String> {
    Err("Workspace dock is only supported on Windows".into())
}

#[cfg(not(windows))]
pub fn remove_dock() {}

#[cfg(not(windows))]
pub fn work_area(_raw_hwnd: isize) -> Option<(i32, i32, i32, i32)> {
    None
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::sync::Mutex;

    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::UI::Shell::{
        SHAppBarMessage, ABE_BOTTOM, ABE_LEFT, ABE_RIGHT, ABE_TOP, ABM_NEW, ABM_QUERYPOS,
        ABM_REMOVE, ABM_SETPOS, APPBARDATA,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        RegisterWindowMessageW, SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW,
    };

    // Holds the window handle (as isize) while an AppBar registration is live, so
    // a later remove/re-apply knows to tear down the previous one first. `None`
    // means no AppBar is currently registered.
    static REGISTERED: Mutex<Option<isize>> = Mutex::new(None);

    fn hwnd_from_isize(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }

    // A private message id the shell uses to notify the AppBar of state changes
    // (full-screen apps, other AppBars moving, etc.). We register a valid id so
    // `ABM_NEW` is well-formed; handling the notifications is a later phase.
    fn callback_msg() -> u32 {
        unsafe { RegisterWindowMessageW(w!("CoolDeskWorkspaceAppBar")) }
    }

    fn base_abd(hwnd: HWND) -> APPBARDATA {
        APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: hwnd,
            uCallbackMessage: callback_msg(),
            uEdge: ABE_LEFT,
            rc: RECT::default(),
            lParam: LPARAM(0),
        }
    }

    fn monitor_info(hwnd: HWND) -> Option<MONITORINFO> {
        unsafe {
            let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
            let mut mi = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            GetMonitorInfoW(hmon, &mut mi).as_bool().then_some(mi)
        }
    }

    pub fn work_area(raw_hwnd: isize) -> Option<(i32, i32, i32, i32)> {
        let mi = monitor_info(hwnd_from_isize(raw_hwnd))?;
        let rc = mi.rcWork;
        Some((rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top))
    }

    // Unregisters the current AppBar (if any) and releases its reserved work
    // area. Safe to call when nothing is registered.
    pub fn remove_dock() {
        let mut guard = REGISTERED.lock().unwrap();
        if let Some(raw) = guard.take() {
            unsafe {
                let mut abd = base_abd(hwnd_from_isize(raw));
                SHAppBarMessage(ABM_REMOVE, &mut abd);
            }
        }
    }

    pub fn set_dock(raw_hwnd: isize, edge: &str, thickness: i32) -> Result<(i32, i32, i32, i32), String> {
        // Clean re-apply: drop any prior registration first so we don't stack
        // reserved strips (e.g. when only the thickness or edge changed).
        remove_dock();

        let thickness = thickness.max(1);
        unsafe {
            let hwnd = hwnd_from_isize(raw_hwnd);

            // Reserve on the monitor the window currently lives on, falling back
            // to the primary monitor. V1 manages a single monitor's work area.
            let mon = monitor_info(hwnd).ok_or("GetMonitorInfoW failed")?.rcMonitor;

            let mut abd = base_abd(hwnd);
            abd.uEdge = match edge {
                "left" => ABE_LEFT,
                "top" => ABE_TOP,
                "bottom" => ABE_BOTTOM,
                _ => ABE_RIGHT,
            };
            abd.rc = mon;

            // Register the AppBar, then ask the shell for a proposed rectangle
            // (it adjusts for the taskbar and any other AppBars already docked).
            SHAppBarMessage(ABM_NEW, &mut abd);
            abd.rc = mon;
            SHAppBarMessage(ABM_QUERYPOS, &mut abd);

            // Constrain the proposed rect to our thickness on the docked edge.
            match edge {
                "left" => abd.rc.right = abd.rc.left + thickness,
                "top" => abd.rc.bottom = abd.rc.top + thickness,
                "bottom" => abd.rc.top = abd.rc.bottom - thickness,
                _ => abd.rc.left = abd.rc.right - thickness,
            }

            // Commit the reservation. This is what shrinks the work area, so
            // maximized windows begin fitting beside us. The shell may nudge the
            // rect again, so we position the window to whatever it returns.
            SHAppBarMessage(ABM_SETPOS, &mut abd);
            let rc = abd.rc;

            let (x, y, cx, cy) = (rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top);
            SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                x,
                y,
                cx,
                cy,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
            .map_err(|e| format!("SetWindowPos failed: {e}"))?;

            *REGISTERED.lock().unwrap() = Some(raw_hwnd);
            Ok((x, y, cx, cy))
        }
    }
}
