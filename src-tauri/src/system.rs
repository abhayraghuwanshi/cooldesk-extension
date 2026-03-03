use std::collections::HashMap;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::sync::Mutex;
use windows::core::GUID;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::System::Com::{CoInitializeEx, CoCreateInstance, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::IVirtualDesktopManager;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE, GW_OWNER,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, GetForegroundWindow, IsIconic, GetWindowRect
};
use sysinfo::{System, Pid};
use serde::Serialize;

// CLSID for VirtualDesktopManager
const CLSID_VIRTUAL_DESKTOP_MANAGER: GUID = GUID::from_u128(0xaa509086_5ca9_4c25_8f95_589d3c07b48a);

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

#[derive(Clone)]
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
pub struct VirtualDesktopHelper {
    manager: Option<IVirtualDesktopManager>,
}

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

struct EnumData {
    windows: Vec<TaskbarWindow>,
}

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

pub async fn get_focused_app_info() -> Option<RunningApp> {
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
    }
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

        // For each (PID, desktop) keep the window with the longest title.
        // Browsers like Chrome/Edge run many windows under one PID; the longest
        // title is typically the most descriptive one (e.g. "YouTube – Google Chrome"
        // beats a bare "Google Chrome" from another window), which matters for search.
        let mut best: std::collections::HashMap<(u32, Option<String>), TaskbarWindow> =
            std::collections::HashMap::new();
        for win in data.windows {
            let key = (win.pid, win.desktop_id.clone());
            let entry = best.entry(key).or_insert_with(|| win.clone());
            if win.title.len() > entry.title.len() {
                *entry = win;
            }
        }

        let mut apps = Vec::new();
        for ((pid, _), win) in best {
            if let Some(process) = sys.process(Pid::from_u32(pid)) {
                let desktop_number = vd_helper.get_desktop_number(&win.desktop_id);
                apps.push(RunningApp {
                    id: format!("win-{}", win.handle.0 as isize),
                    name: process.name().to_string(),
                    title: win.title,
                    path: process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                    pid,
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
