// Workspace Layout — Phase 1: the AppBar dock.
//
// Reserves a vertical strip of the primary monitor's work area for CoolDesk via
// the native Windows AppBar API (`SHAppBarMessage`) — the same mechanism the
// taskbar uses. Once the strip is reserved, Windows itself shrinks the usable
// work area, so *maximized* application windows automatically resize to fit
// beside CoolDesk. We do NOT track or resize individual windows here (that's the
// FancyZones-style hard path the feature spec explicitly rejects); we claim the
// work area and let Windows do the rest.
//
// Only the maximized case is guaranteed. Restored (floating) windows that
// overlap the strip are left alone by design.

#[cfg(windows)]
pub fn set_dock(raw_hwnd: isize, side_right: bool, width: i32) -> Result<(i32, i32, i32, i32), String> {
    imp::set_dock(raw_hwnd, side_right, width)
}

#[cfg(windows)]
pub fn remove_dock() {
    imp::remove_dock();
}

// Non-Windows stubs. The callers in lib.rs are all `#[cfg(windows)]`-gated, so
// these are never invoked off Windows — they exist only so the module compiles.
#[cfg(not(windows))]
pub fn set_dock(_raw_hwnd: isize, _side_right: bool, _width: i32) -> Result<(i32, i32, i32, i32), String> {
    Err("Workspace dock is only supported on Windows".into())
}

#[cfg(not(windows))]
pub fn remove_dock() {}

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
        SHAppBarMessage, ABE_LEFT, ABE_RIGHT, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS,
        APPBARDATA,
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

    pub fn set_dock(raw_hwnd: isize, side_right: bool, width: i32) -> Result<(i32, i32, i32, i32), String> {
        // Clean re-apply: drop any prior registration first so we don't stack
        // reserved strips (e.g. when only the width or side changed).
        remove_dock();

        let width = width.max(1);
        unsafe {
            let hwnd = hwnd_from_isize(raw_hwnd);

            // Reserve on the monitor the window currently lives on, falling back
            // to the primary monitor. V1 manages a single monitor's work area.
            let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
            let mut mi = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(hmon, &mut mi).as_bool() {
                return Err("GetMonitorInfoW failed".into());
            }
            let mon = mi.rcMonitor;

            let mut abd = base_abd(hwnd);
            abd.uEdge = if side_right { ABE_RIGHT } else { ABE_LEFT };
            abd.rc = mon;

            // Register the AppBar, then ask the shell for a proposed rectangle
            // (it adjusts for the taskbar and any other AppBars already docked).
            SHAppBarMessage(ABM_NEW, &mut abd);
            abd.rc = mon;
            SHAppBarMessage(ABM_QUERYPOS, &mut abd);

            // Constrain the proposed rect to our width on the docked edge.
            if side_right {
                abd.rc.left = abd.rc.right - width;
            } else {
                abd.rc.right = abd.rc.left + width;
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
