use std::collections::HashMap;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE, GW_OWNER,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, GetForegroundWindow, IsIconic, GetWindowRect
};
use sysinfo::{System, Pid};
use serde::Serialize;

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
}

pub struct TaskbarWindow {
    pub pid: u32,
    pub title: String,
    pub handle: HWND,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
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
                });
            }
        }
    }
    None
}

pub async fn get_visible_apps_info() -> Vec<RunningApp> {
    #[cfg(target_os = "windows")]
    {
        let mut data = EnumData { windows: Vec::new() };
        unsafe {
            let _ = EnumWindows(
                Some(enum_callback_visible_only),
                LPARAM(&mut data as *mut EnumData as isize),
            );
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
