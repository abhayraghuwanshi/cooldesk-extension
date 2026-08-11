use serde::Serialize;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod mac;

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

pub async fn get_focused_app_info() -> Option<RunningApp> {
    #[cfg(target_os = "macos")]
    return mac::get_focused_app_info();

    #[cfg(target_os = "windows")]
    return windows::get_focused_app_info();

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    None
}

pub async fn get_visible_apps_info() -> Vec<RunningApp> {
    #[cfg(target_os = "windows")]
    return windows::get_visible_apps_info();

    #[cfg(not(target_os = "windows"))]
    Vec::new()
}

/// Get ALL apps across all virtual desktops (removes cloaked filter)
pub async fn get_all_desktop_apps_info() -> Vec<RunningApp> {
    #[cfg(target_os = "windows")]
    return windows::get_all_desktop_apps_info();

    #[cfg(not(target_os = "windows"))]
    Vec::new()
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
