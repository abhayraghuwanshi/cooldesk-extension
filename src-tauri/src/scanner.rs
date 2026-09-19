use crate::matcher::ScannerOutput;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "linux")]
mod linux;

/// `extra_dirs` are user-linked folders (Settings → Folders & Index, with
/// "include apps" on) to search for installed apps alongside each
/// platform's standard locations — for apps in places the OS-standard scan
/// doesn't look (a portable-apps folder, an external drive, ...).
pub fn scan_apps(extra_dirs: &[String]) -> ScannerOutput {
    #[cfg(target_os = "windows")]
    return windows::scan_apps_windows(extra_dirs);

    #[cfg(target_os = "macos")]
    return mac::scan_apps_macos(extra_dirs);

    #[cfg(target_os = "linux")]
    return linux::scan_apps_linux(extra_dirs);

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = extra_dirs;
        ScannerOutput { installed: vec![], windows: vec![] }
    }
}
