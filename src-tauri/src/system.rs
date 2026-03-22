#[cfg(target_os = "windows")]
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::ffi::OsString;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStringExt;
#[cfg(target_os = "windows")]
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use windows::core::GUID;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{CoInitializeEx, CoCreateInstance, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::IVirtualDesktopManager;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE, GW_OWNER,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, GetForegroundWindow, IsIconic, GetWindowRect
};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use sysinfo::{System, Pid};
use serde::Serialize;

// ── macOS CoreFoundation / CoreGraphics FFI ───────────────────────────────────
#[cfg(target_os = "macos")]
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

// CLSID for VirtualDesktopManager
#[cfg(target_os = "windows")]
const CLSID_VIRTUAL_DESKTOP_MANAGER: GUID = GUID::from_u128(0xaa509086_5ca9_4c25_8f95_589d3c07b48a);

#[cfg(target_os = "windows")]
lazy_static::lazy_static! {
    static ref DESKTOP_CACHE: Mutex<HashMap<String, u32>> = Mutex::new(HashMap::new());
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunningApp {
    pub id: String,
    pub name: String,
    pub title: String,
    pub path: String,
    pub pid: u32,
    pub icon: Option<String>,
    pub handle: String, // HWND as string
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub desktop_id: Option<String>,      // Virtual desktop GUID
    pub desktop_number: Option<u32>,      // Desktop number (1, 2, 3, etc.)
    pub is_on_current_desktop: bool,      // Whether window is on current virtual desktop
}

#[cfg(target_os = "windows")]
pub struct TaskbarWindow {
    pub pid: u32,
    pub title: String,
    pub handle: HWND,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub desktop_id: Option<String>,
    pub is_on_current_desktop: bool,
}

/// Helper to get virtual desktop info for a window
#[cfg(target_os = "windows")]
pub struct VirtualDesktopHelper {
    manager: Option<IVirtualDesktopManager>,
}

#[cfg(target_os = "windows")]
impl VirtualDesktopHelper {
    pub fn new() -> Self {
        unsafe {
            // Initialize COM (ignore if already initialized)
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

            // Create the VirtualDesktopManager instance
            let manager: Result<IVirtualDesktopManager, _> = CoCreateInstance(
                &CLSID_VIRTUAL_DESKTOP_MANAGER,
                None,
                CLSCTX_ALL,
            );

            Self {
                manager: manager.ok(),
            }
        }
    }

    /// Check if a window is on the current virtual desktop
    pub fn is_on_current_desktop(&self, hwnd: HWND) -> bool {
        if let Some(ref manager) = self.manager {
            unsafe {
                manager.IsWindowOnCurrentVirtualDesktop(hwnd).unwrap_or(false.into()).as_bool()
            }
        } else {
            true // If we can't access virtual desktop API, assume current desktop
        }
    }

    /// Get the desktop GUID for a window
    pub fn get_desktop_id(&self, hwnd: HWND) -> Option<String> {
        if let Some(ref manager) = self.manager {
            unsafe {
                if let Ok(guid) = manager.GetWindowDesktopId(hwnd) {
                    // Format GUID as string
                    return Some(format!(
                        "{:08X}-{:04X}-{:04X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
                        guid.data1, guid.data2, guid.data3,
                        guid.data4[0], guid.data4[1], guid.data4[2], guid.data4[3],
                        guid.data4[4], guid.data4[5], guid.data4[6], guid.data4[7]
                    ));
                }
            }
        }
        None
    }

    /// Get desktop number (1-based) from desktop ID
    /// This maintains a cache of seen desktops in order of discovery
    pub fn get_desktop_number(&self, desktop_id: &Option<String>) -> Option<u32> {
        if let Some(id) = desktop_id {
            let mut cache = DESKTOP_CACHE.lock().unwrap();
            let next_num = cache.len() as u32 + 1;
            let num = *cache.entry(id.clone()).or_insert(next_num);
            Some(num)
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
struct EnumData {
    windows: Vec<TaskbarWindow>,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let data = &mut *(lparam.0 as *mut EnumData);

    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }

    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;

    if (ex_style & WS_EX_TOOLWINDOW.0) != 0 && (ex_style & WS_EX_APPWINDOW.0) == 0 {
        return BOOL(1);
    }

    if let Ok(owner) = GetWindow(hwnd, GW_OWNER) {
        if owner.0 != std::ptr::null_mut() && (ex_style & WS_EX_APPWINDOW.0) == 0 {
            return BOOL(1);
        }
    }

    let title_len = GetWindowTextLengthW(hwnd);
    if title_len == 0 {
        return BOOL(1);
    }

    let mut buffer: Vec<u16> = vec![0; (title_len + 1) as usize];
    let len = GetWindowTextW(hwnd, &mut buffer);
    let title = OsString::from_wide(&buffer[..len as usize])
        .to_string_lossy()
        .to_string();

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    if pid > 0 {
        let mut rect = RECT::default();
        let _ = unsafe { GetWindowRect(hwnd, &mut rect) };
        data.windows.push(TaskbarWindow {
            pid,
            title,
            handle: hwnd,
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            desktop_id: None,
            is_on_current_desktop: true,
        });
    }

    BOOL(1)
}

#[cfg(target_os = "windows")]
pub fn get_taskbar_windows() -> HashMap<u32, String> {
    let mut data = EnumData { windows: Vec::new() };

    unsafe {
        let _ = EnumWindows(
            Some(enum_callback),
            LPARAM(&mut data as *mut EnumData as isize),
        );
    }

    let mut result: HashMap<u32, String> = HashMap::new();
    for win in data.windows {
        result
            .entry(win.pid)
            .and_modify(|existing| {
                if win.title.len() > existing.len() {
                    *existing = win.title.clone();
                }
            })
            .or_insert(win.title);
    }
    result
}

#[cfg(target_os = "windows")]
pub fn get_foreground_window_pid() -> Option<u32> {
    let mut pid: u32 = 0;
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 != std::ptr::null_mut() {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
    }
    if pid > 0 { Some(pid) } else { None }
}

#[cfg(target_os = "windows")]
pub fn get_window_title(pid: u32) -> String {
    let mut data = EnumData { windows: Vec::new() };
    unsafe {
        let _ = EnumWindows(
            Some(enum_callback),
            LPARAM(&mut data as *mut EnumData as isize),
        );
    }
    data.windows.into_iter()
        .find(|w| w.pid == pid)
        .map(|w| w.title)
        .unwrap_or_default()
}

/// macOS: get PID of the frontmost app via osascript (no extra crates needed).
#[cfg(target_os = "macos")]
fn macos_frontmost_pid() -> Option<u32> {
    let output = std::process::Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get unix id of first process whose frontmost is true"])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&output.stdout);
    s.trim().parse::<u32>().ok()
}

/// macOS: get the topmost window title for a given PID via CGWindowListCopyWindowInfo.
#[cfg(target_os = "macos")]
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

pub async fn get_focused_app_info() -> Option<RunningApp> {
    #[cfg(target_os = "macos")]
    {
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
        return None;
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(pid) = get_foreground_window_pid() {
            let mut sys = System::new_all();
            sys.refresh_all();

            if let Some(process) = sys.process(Pid::from_u32(pid)) {
                let name = process.name().to_string();
                let title = get_window_title(pid);

                let mut rect = RECT::default();
                let hwnd = unsafe { GetForegroundWindow() };
                let _ = unsafe { GetWindowRect(hwnd, &mut rect) };

                // Get virtual desktop info
                let vd_helper = VirtualDesktopHelper::new();
                let desktop_id = vd_helper.get_desktop_id(hwnd);
                let desktop_number = vd_helper.get_desktop_number(&desktop_id);
                let is_on_current_desktop = vd_helper.is_on_current_desktop(hwnd);

                return Some(RunningApp {
                    id: format!("app-{}", pid),
                    name,
                    title: if title.is_empty() { process.name().to_string() } else { title },
                    path: process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                    pid,
                    icon: None,
                    handle: format!("{:?}", hwnd),
                    x: rect.left,
                    y: rect.top,
                    width: rect.right - rect.left,
                    height: rect.bottom - rect.top,
                    desktop_id,
                    desktop_number,
                    is_on_current_desktop,
                });
            }
        }
        return None;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    None
}

pub async fn get_visible_apps_info() -> Vec<RunningApp> {
    #[cfg(target_os = "windows")]
    {
        let vd_helper = VirtualDesktopHelper::new();
        let mut data = EnumData { windows: Vec::new() };

        unsafe {
            let _ = EnumWindows(
                Some(enum_callback_visible_only),
                LPARAM(&mut data as *mut EnumData as isize),
            );
        }

        // Now add desktop info to each window
        for win in &mut data.windows {
            win.desktop_id = vd_helper.get_desktop_id(win.handle);
            win.is_on_current_desktop = vd_helper.is_on_current_desktop(win.handle);
        }

        let mut sys = System::new_all();
        sys.refresh_all();

        // Deduplicate by PID
        let mut apps = Vec::new();
        let mut seen_pids = std::collections::HashSet::new();

        for win in data.windows {
            if seen_pids.contains(&win.pid) { continue; }
            seen_pids.insert(win.pid);

            if let Some(process) = sys.process(Pid::from_u32(win.pid)) {
                let desktop_number = vd_helper.get_desktop_number(&win.desktop_id);
                apps.push(RunningApp {
                    id: format!("win-{}", win.handle.0 as isize),
                    name: process.name().to_string(),
                    title: win.title,
                    path: process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                    pid: win.pid,
                    icon: None,
                    handle: format!("{:?}", win.handle),
                    x: win.x,
                    y: win.y,
                    width: win.width,
                    height: win.height,
                    desktop_id: win.desktop_id,
                    desktop_number,
                    is_on_current_desktop: win.is_on_current_desktop,
                });
            }
        }
        return apps;
    }
    #[cfg(not(target_os = "windows"))]
    Vec::new()
}

/// Get ALL apps across all virtual desktops (removes cloaked filter)
pub async fn get_all_desktop_apps_info() -> Vec<RunningApp> {
    #[cfg(target_os = "windows")]
    {
        let vd_helper = VirtualDesktopHelper::new();
        let mut data = EnumData { windows: Vec::new() };

        unsafe {
            let _ = EnumWindows(
                Some(enum_callback_all_desktops),
                LPARAM(&mut data as *mut EnumData as isize),
            );
        }

        // Add desktop info to each window
        for win in &mut data.windows {
            win.desktop_id = vd_helper.get_desktop_id(win.handle);
            win.is_on_current_desktop = vd_helper.is_on_current_desktop(win.handle);
        }

        let mut sys = System::new_all();
        sys.refresh_all();

        // Deduplicate by PID + desktop (same app can be on multiple desktops)
        let mut apps = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for win in data.windows {
            let key = (win.pid, win.desktop_id.clone());
            if seen.contains(&key) { continue; }
            seen.insert(key);

            if let Some(process) = sys.process(Pid::from_u32(win.pid)) {
                let desktop_number = vd_helper.get_desktop_number(&win.desktop_id);
                apps.push(RunningApp {
                    id: format!("win-{}", win.handle.0 as isize),
                    name: process.name().to_string(),
                    title: win.title,
                    path: process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                    pid: win.pid,
                    icon: None,
                    handle: format!("{:?}", win.handle),
                    x: win.x,
                    y: win.y,
                    width: win.width,
                    height: win.height,
                    desktop_id: win.desktop_id,
                    desktop_number,
                    is_on_current_desktop: win.is_on_current_desktop,
                });
            }
        }
        return apps;
    }
    #[cfg(not(target_os = "windows"))]
    Vec::new()
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_callback_visible_only(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let data = &mut *(lparam.0 as *mut EnumData);

    // 1. Basic visibility check
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }

    // 2. Minimized check
    if IsIconic(hwnd).as_bool() {
        return BOOL(1);
    }

    // 3. Cloaked check (Windows 10+ virtual desktops, etc.)
    let mut cloaked: u32 = 0;
    let _ = DwmGetWindowAttribute(
        hwnd,
        DWMWA_CLOAKED,
        &mut cloaked as *mut u32 as *mut std::ffi::c_void,
        std::mem::size_of::<u32>() as u32,
    );
    if cloaked != 0 {
        return BOOL(1);
    }

    // 4. Rect check (Hidden background windows often have 0 area)
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_ok() {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return BOOL(1);
        }
    }

    // 5. Tool window filtering
    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if (ex_style & WS_EX_TOOLWINDOW.0) != 0 && (ex_style & WS_EX_APPWINDOW.0) == 0 {
        return BOOL(1);
    }

    // 6. Owner check (Child/Owned windows usually shouldn't be main entries)
    if let Ok(owner) = GetWindow(hwnd, GW_OWNER) {
        if owner.0 != std::ptr::null_mut() && (ex_style & WS_EX_APPWINDOW.0) == 0 {
            return BOOL(1);
        }
    }

    // 7. Empty title check
    let title_len = GetWindowTextLengthW(hwnd);
    if title_len == 0 {
        return BOOL(1);
    }

    let mut buffer: Vec<u16> = vec![0; (title_len + 1) as usize];
    let len = GetWindowTextW(hwnd, &mut buffer);
    let title = OsString::from_wide(&buffer[..len as usize])
        .to_string_lossy()
        .to_string();

    // 8. Final title filter for common noise
    let title_lower = title.to_lowercase();
    if title_lower == "settings" || title_lower == "microsoft text input application" || 
       title_lower == "program manager" || title_lower == "windows input experience" {
        return BOOL(1);
    }

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    if pid > 0 {
        let mut rect = RECT::default();
        let _ = unsafe { GetWindowRect(hwnd, &mut rect) };
        data.windows.push(TaskbarWindow {
            pid,
            title,
            handle: hwnd,
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            desktop_id: None,  // Filled in later
            is_on_current_desktop: true,  // Filled in later
        });
    }

    BOOL(1)
}

/// Callback for enumerating windows across ALL virtual desktops (no cloaked filter)
#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_callback_all_desktops(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let data = &mut *(lparam.0 as *mut EnumData);

    // 1. Basic visibility check
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }

    // 2. Skip minimized (they don't have rect anyway)
    if IsIconic(hwnd).as_bool() {
        return BOOL(1);
    }

    // NOTE: We skip the cloaked check here to get windows on other desktops

    // 3. Rect check (Hidden background windows often have 0 area)
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_ok() {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return BOOL(1);
        }
    }

    // 4. Tool window filtering
    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if (ex_style & WS_EX_TOOLWINDOW.0) != 0 && (ex_style & WS_EX_APPWINDOW.0) == 0 {
        return BOOL(1);
    }

    // 5. Owner check
    if let Ok(owner) = GetWindow(hwnd, GW_OWNER) {
        if owner.0 != std::ptr::null_mut() && (ex_style & WS_EX_APPWINDOW.0) == 0 {
            return BOOL(1);
        }
    }

    // 6. Empty title check
    let title_len = GetWindowTextLengthW(hwnd);
    if title_len == 0 {
        return BOOL(1);
    }

    let mut buffer: Vec<u16> = vec![0; (title_len + 1) as usize];
    let len = GetWindowTextW(hwnd, &mut buffer);
    let title = OsString::from_wide(&buffer[..len as usize])
        .to_string_lossy()
        .to_string();

    // 7. Final title filter for common noise
    let title_lower = title.to_lowercase();
    if title_lower == "settings" || title_lower == "microsoft text input application" ||
       title_lower == "program manager" || title_lower == "windows input experience" {
        return BOOL(1);
    }

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    if pid > 0 {
        let mut rect = RECT::default();
        let _ = unsafe { GetWindowRect(hwnd, &mut rect) };
        data.windows.push(TaskbarWindow {
            pid,
            title,
            handle: hwnd,
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            desktop_id: None,  // Filled in later
            is_on_current_desktop: true,  // Filled in later
        });
    }

    BOOL(1)
}

pub fn is_browser(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("chrome") || 
    lower.contains("msedge") || 
    lower.contains("firefox") || 
    lower.contains("brave") || 
    lower.contains("opera") ||
    lower.contains("safari")
}
