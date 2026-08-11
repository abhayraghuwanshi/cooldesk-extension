// macOS running/focused-app lookups: frontmost-process PID via `osascript`,
// window title via CGWindowListCopyWindowInfo. See `system.rs` for the
// module-level overview and public API.

use sysinfo::{System, Pid};

use super::RunningApp;

// ── CoreFoundation / CoreGraphics FFI ─────────────────────────────────────
mod mac_ffi {
    use std::os::raw::{c_char, c_int, c_void};

    pub type CFTypeRef = *const c_void;
    pub type CFArrayRef = *const c_void;
    pub type CFDictionaryRef = *const c_void;
    pub type CFStringRef = *const c_void;
    pub type CFNumberRef = *const c_void;
    pub type CFIndex = isize;
    pub type CGWindowID = u32;
    pub type CGWindowListOption = u32;

    pub const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    pub const K_CG_WINDOW_LIST_OPTION_ON_SCREEN: CGWindowListOption = 1;
    pub const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP: CGWindowListOption = 16;
    pub const K_CG_NULL_WINDOW_ID: CGWindowID = 0;
    pub const K_CF_NUMBER_SINT32_TYPE: c_int = 3;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
        pub fn CFArrayGetValueAtIndex(array: CFArrayRef, idx: CFIndex) -> CFTypeRef;
        pub fn CFDictionaryGetValue(dict: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;
        pub fn CFStringGetCString(
            s: CFStringRef,
            buf: *mut c_char,
            buf_size: CFIndex,
            encoding: u32,
        ) -> bool;
        pub fn CFStringCreateWithCString(
            alloc: CFTypeRef,
            c_str: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        pub fn CFNumberGetValue(
            number: CFNumberRef,
            the_type: c_int,
            value_ptr: *mut c_void,
        ) -> bool;
        pub fn CFRelease(cf: CFTypeRef);
        pub fn CFStringGetLength(s: CFStringRef) -> CFIndex;
        pub fn CFStringGetMaximumSizeForEncoding(length: CFIndex, encoding: u32) -> CFIndex;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGWindowListCopyWindowInfo(
            option: CGWindowListOption,
            relative_to: CGWindowID,
        ) -> CFArrayRef;
    }
}

/// Get PID of the frontmost app via osascript (no extra crates needed).
fn macos_frontmost_pid() -> Option<u32> {
    let output = std::process::Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get unix id of first process whose frontmost is true"])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&output.stdout);
    s.trim().parse::<u32>().ok()
}

/// Get the topmost window title for a given PID via CGWindowListCopyWindowInfo.
fn macos_window_title_for_pid(pid: u32) -> Option<String> {
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_void};
    use mac_ffi::*;

    unsafe {
        let list = CGWindowListCopyWindowInfo(
            K_CG_WINDOW_LIST_OPTION_ON_SCREEN | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP,
            K_CG_NULL_WINDOW_ID,
        );
        if list.is_null() { return None; }

        let count = CFArrayGetCount(list);
        let mut found_title: Option<String> = None;

        'outer: for i in 0..count {
            let dict = CFArrayGetValueAtIndex(list, i) as CFDictionaryRef;
            if dict.is_null() { continue; }

            // Read PID
            let key_pid = CString::new("kCGWindowOwnerPID").unwrap();
            let cf_key = CFStringCreateWithCString(std::ptr::null(), key_pid.as_ptr(), K_CF_STRING_ENCODING_UTF8);
            let pid_val = CFDictionaryGetValue(dict, cf_key);
            CFRelease(cf_key);
            if pid_val.is_null() { continue; }
            let mut win_pid: i32 = 0;
            if !CFNumberGetValue(pid_val as CFNumberRef, K_CF_NUMBER_SINT32_TYPE, &mut win_pid as *mut i32 as *mut c_void) {
                continue;
            }
            if win_pid as u32 != pid { continue; }

            // Read layer — skip dock/menu-bar entries
            let key_layer = CString::new("kCGWindowLayer").unwrap();
            let cf_layer = CFStringCreateWithCString(std::ptr::null(), key_layer.as_ptr(), K_CF_STRING_ENCODING_UTF8);
            let layer_val = CFDictionaryGetValue(dict, cf_layer);
            CFRelease(cf_layer);
            let mut layer: i32 = 0;
            if !layer_val.is_null() {
                CFNumberGetValue(layer_val as CFNumberRef, K_CF_NUMBER_SINT32_TYPE, &mut layer as *mut i32 as *mut c_void);
            }
            if layer < 0 { continue; }

            // Read window title (requires Screen Recording permission)
            let key_name = CString::new("kCGWindowName").unwrap();
            let cf_name_key = CFStringCreateWithCString(std::ptr::null(), key_name.as_ptr(), K_CF_STRING_ENCODING_UTF8);
            let name_val = CFDictionaryGetValue(dict, cf_name_key);
            CFRelease(cf_name_key);
            if name_val.is_null() { break 'outer; }

            let cf_name = name_val as CFStringRef;
            let len = CFStringGetLength(cf_name);
            let max = CFStringGetMaximumSizeForEncoding(len, K_CF_STRING_ENCODING_UTF8) + 1;
            let mut buf: Vec<c_char> = vec![0; max as usize];
            if CFStringGetCString(cf_name, buf.as_mut_ptr(), max, K_CF_STRING_ENCODING_UTF8) {
                let title = CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned();
                if !title.is_empty() {
                    found_title = Some(title);
                }
            }
            break 'outer;
        }

        CFRelease(list);
        found_title
    }
}

pub fn get_focused_app_info() -> Option<RunningApp> {
    let pid = macos_frontmost_pid()?;
    let mut sys = System::new_all();
    sys.refresh_all();
    if let Some(process) = sys.process(Pid::from_u32(pid)) {
        let name = process.name().to_string();
        let path = process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let title = macos_window_title_for_pid(pid).unwrap_or_else(|| name.clone());
        return Some(RunningApp {
            id: format!("app-{}", pid),
            name,
            title,
            path,
            pid,
            icon: None,
            handle: format!("{}", pid),
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            desktop_id: None,
            desktop_number: None,
            is_on_current_desktop: true,
        });
    }
    None
}
