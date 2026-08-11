use crate::matcher::ScannerOutput;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod mac;

pub fn scan_apps() -> ScannerOutput {
    #[cfg(target_os = "windows")]
    return windows::scan_apps_windows();

    #[cfg(target_os = "macos")]
    return mac::scan_apps_macos();

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    ScannerOutput { installed: vec![], windows: vec![] }
}
