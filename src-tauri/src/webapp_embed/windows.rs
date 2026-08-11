// Raw Win32 layer for glue-embedding: window tagging/clipping/z-order and
// Chromium browser discovery. See `webapp_embed.rs` for the module-level
// overview and the Tauri commands that drive this.

use windows::core::w;
use windows::Win32::Foundation::{BOOL, HANDLE, HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateRectRgn, SetWindowRgn};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetPropW, GetWindow, GetWindowLongW, IsWindow,
    IsWindowVisible, PostMessageW, SetPropW, SetWindowLongW, SetWindowPos, ShowWindow,
    GWL_STYLE, GW_HWNDPREV, HWND_TOP, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNA, WM_CLOSE, WS_CAPTION, WS_MAXIMIZEBOX,
    WS_MINIMIZEBOX, WS_THICKFRAME,
};

/// Window property stamped onto every adopted window. Properties survive
/// our process dying, so a fresh instance can recognize glue windows with
/// certainty (unlike heuristics — Electron apps are also captionless
/// Chromium windows) and sweep them even without the persist file.
fn tag_window(hwnd: isize) {
    unsafe {
        let _ = SetPropW(HWND(hwnd as *mut _), w!("CoolDeskGlueEmbed"), HANDLE(1 as *mut _));
    }
}

pub fn is_tagged(hwnd: isize) -> bool {
    unsafe { GetPropW(HWND(hwnd as *mut _), w!("CoolDeskGlueEmbed")).0 as usize != 0 }
}

/// Clip the window to a sub-rectangle (insets from each edge, window-
/// relative px). All-zero insets clear the region. This is what keeps a
/// glued window from painting over the toolbar while the tile scrolls
/// under it — the native window can't be z-ordered below page content,
/// but it can be cut to the visible part of the slot.
pub fn apply_clip(hwnd: isize, w: i32, h: i32, top: i32, right: i32, bottom: i32, left: i32) {
    unsafe {
        let target = HWND(hwnd as *mut _);
        if top == 0 && right == 0 && bottom == 0 && left == 0 {
            let _ = SetWindowRgn(target, None, true);
        } else {
            // Ownership of the region transfers to the system on success.
            let rgn = CreateRectRgn(left, top, (w - right).max(left), (h - bottom).max(top));
            let _ = SetWindowRgn(target, rgn, true);
        }
    }
}

/// Collect top-level Chromium windows ("Chrome_WidgetWin_1" is the frame
/// class for Chrome, Edge, Brave, …). Hidden ones are included on demand —
/// orphaned glue windows may have been left in the hidden state.
pub fn chromium_windows(include_hidden: bool) -> Vec<isize> {
    struct Ctx {
        found: Vec<isize>,
        include_hidden: bool,
    }
    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = unsafe { &mut *(lparam.0 as *mut Ctx) };
        if ctx.include_hidden || unsafe { IsWindowVisible(hwnd) }.as_bool() {
            let mut class_buf = [0u16; 64];
            let len = unsafe { GetClassNameW(hwnd, &mut class_buf) } as usize;
            let class = String::from_utf16_lossy(&class_buf[..len]);
            if class.starts_with("Chrome_WidgetWin") {
                ctx.found.push(hwnd.0 as isize);
            }
        }
        BOOL(1)
    }
    let mut ctx = Ctx { found: Vec::new(), include_hidden };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut Ctx as isize));
    }
    ctx.found
}

/// Adopt bookkeeping applied to every glued window.
pub fn mark_adopted(hwnd: isize) {
    tag_window(hwnd);
    strip_frame(hwnd);
}

pub fn is_alive(hwnd: isize) -> bool {
    unsafe { IsWindow(HWND(hwnd as *mut _)).as_bool() }
}

pub fn is_chromium_window(hwnd: isize) -> bool {
    let mut class_buf = [0u16; 64];
    let len = unsafe { GetClassNameW(HWND(hwnd as *mut _), &mut class_buf) } as usize;
    String::from_utf16_lossy(&class_buf[..len]).starts_with("Chrome_WidgetWin")
}

/// Strip the caption/resize frame so the adopted window reads as an
/// embedded panel rather than a floating app window.
pub fn strip_frame(hwnd: isize) {
    unsafe {
        let h = HWND(hwnd as *mut _);
        let style = GetWindowLongW(h, GWL_STYLE) as u32;
        let stripped = style
            & !(WS_CAPTION.0 | WS_THICKFRAME.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0);
        SetWindowLongW(h, GWL_STYLE, stripped as i32);
        // hwndinsertafter is ignored with SWP_NOZORDER — pass null.
        let _ = SetWindowPos(
            h,
            HWND::default(),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

/// Move/size the glued window (physical px) and keep it z-ordered directly
/// above the CoolDesk main window without stealing focus.
pub fn set_bounds(hwnd: isize, main_hwnd: isize, x: i32, y: i32, w: i32, h: i32) {
    unsafe {
        let target = HWND(hwnd as *mut _);
        let main = HWND(main_hwnd as *mut _);
        let _ = ShowWindow(target, SW_SHOWNA);
        // The window directly above main in z-order; inserting after it
        // lands the glued window between it and main (= directly above
        // main). If main is on top, HWND_TOP achieves the same.
        let above_main = GetWindow(main, GW_HWNDPREV).ok().map(|p| p.0 as isize);
        match above_main {
            Some(p) if p == hwnd => {
                // Already in the right slot — just move.
                let _ = SetWindowPos(
                    target,
                    HWND::default(),
                    x,
                    y,
                    w,
                    h,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
            Some(p) => {
                let _ = SetWindowPos(target, HWND(p as *mut _), x, y, w, h, SWP_NOACTIVATE);
            }
            None => {
                let _ = SetWindowPos(target, HWND_TOP, x, y, w, h, SWP_NOACTIVATE);
            }
        }
    }
}

pub fn hide(hwnd: isize) {
    unsafe {
        let _ = ShowWindow(HWND(hwnd as *mut _), SW_HIDE);
    }
}

pub fn close(hwnd: isize) {
    unsafe {
        let _ = PostMessageW(HWND(hwnd as *mut _), WM_CLOSE, WPARAM(0), LPARAM(0));
    }
}

/// Locate an installed Chromium browser executable, preferring Edge
/// (always present on Win11), then Chrome.
pub fn find_browser_exe() -> Option<std::path::PathBuf> {
    let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
    let pf = std::env::var("ProgramFiles").unwrap_or_default();
    let local = std::env::var("LocalAppData").unwrap_or_default();
    let candidates = [
        format!("{}\\Microsoft\\Edge\\Application\\msedge.exe", pf86),
        format!("{}\\Microsoft\\Edge\\Application\\msedge.exe", pf),
        format!("{}\\Google\\Chrome\\Application\\chrome.exe", pf),
        format!("{}\\Google\\Chrome\\Application\\chrome.exe", pf86),
        format!("{}\\Google\\Chrome\\Application\\chrome.exe", local),
    ];
    candidates
        .iter()
        .map(std::path::PathBuf::from)
        .find(|p| p.exists())
}
