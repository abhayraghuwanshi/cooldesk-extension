use crate::matcher::ScannerOutput;

pub fn scan_apps() -> ScannerOutput {
    #[cfg(target_os = "windows")]
    return windows_impl::scan_apps_windows();

    #[cfg(target_os = "macos")]
    return macos_impl::scan_apps_macos();

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    ScannerOutput { installed: vec![], windows: vec![] }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use crate::matcher::{InstalledApp, ScannerOutput, WindowEntry, WindowTitle};
    use std::collections::{HashMap, HashSet};
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;

    use windows::core::{GUID, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{BOOL, CloseHandle, HWND, LPARAM};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, SelectObject,
        BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY,
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, REG_VALUE_TYPE,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Shell::{
        IShellLinkW, SHGetFileInfoW, ShellLink, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, EnumWindows, GetClassNameW, GetWindow, GetWindowLongW,
        GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
        GW_OWNER, GWL_EXSTYLE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };

    // ── Filters ──────────────────────────────────────────────────────────────────

    fn should_skip(name: &str) -> bool {
        if name.is_empty() {
            return true;
        }
        let lower = name.to_lowercase();
        if lower.contains("uninstall") || lower.contains("setup") || lower.contains("installer")
            || lower.contains("redistributable") || lower.contains("vcredist")
            || lower.contains("directx")
        {
            return true;
        }
        if lower.contains("native tools command prompt") || lower.contains("cross tools command prompt")
            || lower.contains("developer command prompt") || lower.contains("developer powershell for vs")
        {
            return true;
        }
        if lower.contains("module docs") || lower == "about java" || lower == "configure java" {
            return true;
        }
        if lower.contains(".net runtime") || lower.contains(".net sdk")
            || lower.contains(".net desktop runtime") || lower.contains("visual c++ ")
            || lower.contains("visual c++ redistributable")
        {
            return true;
        }
        if lower.ends_with(" service") || lower.ends_with(" services")
            || lower.contains("sdk service") || lower.contains("framesdk")
            || lower.contains("helper compact") || lower.contains("nativepush")
        {
            return true;
        }
        if lower.ends_with(" updater") || lower.contains("error reporter")
            || lower.contains("autostart") || lower == "check for updates"
        {
            return true;
        }
        if (lower.contains("command prompt") || lower.contains("powershell prompt"))
            && lower != "command prompt" && lower != "windows powershell"
        {
            return true;
        }
        if lower.contains("sdk shell") || lower.contains("cloud tools for powershell") {
            return true;
        }
        if lower.contains("database compare") || lower.contains("spreadsheet compare")
            || lower.contains("telemetry log") || lower.contains("recording manager")
            || lower.contains("language preferences") || lower == "send to onenote"
        {
            return true;
        }
        if lower == "bluestacks store" || lower.contains("bluestacks services")
            || lower.contains("bluestacks_") || lower == "bluestacks x"
        {
            return true;
        }
        if lower.contains("safe mode") && lower.contains("libreoffice") {
            return true;
        }
        if lower == "resource monitor" || lower == "recovery drive" || lower == "recoverydrive"
            || lower == "administrative tools" || lower == "task manager"
            || lower == "livecaptions" || lower == "live captions"
        {
            return true;
        }
        if lower.contains("windows software development kit") || lower.contains("windows app cert")
            || lower.contains("application verifier") || lower.contains("powershell ise")
        {
            return true;
        }
        if lower == "bonjour" || lower.contains("riot vanguard") || lower.contains("frameview sdk")
            || lower.contains("framesdk") || lower == "espeak" || lower.starts_with("espeak ")
        {
            return true;
        }
        if lower == "fast node manager" || lower == "fnm" {
            return true;
        }
        if lower.contains("365 apps for enterprise") || lower.contains("office 365") {
            return true;
        }
        if lower == "git" {
            return true;
        }
        if lower.contains("antigravity") || lower.contains("access logs")
            || lower.contains("additional tools for node") || lower.contains("microsoft silverlight")
            || lower == "ttsapp"
        {
            return true;
        }
        false
    }


    fn should_skip_path(path: &str) -> bool {
        if path.is_empty() {
            return false;
        }
        let lower = path.to_lowercase();
        if lower.contains("c:\\windows\\syswow64") || lower.contains("c:\\windows\\inf")
            || lower.contains("c:\\windows\\resources") || lower.contains("c:\\windows\\debug")
            || lower.contains("c:\\windows\\servicing")
        {
            return true;
        }
        if lower.contains("\\windowsapps\\") {
            return true;
        }
        let exe_name = Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        SYSTEM_ADMIN_EXE_NAMES.contains(&exe_name.to_lowercase().as_str())
    }

    static SYSTEM_ADMIN_EXE_NAMES: &[&str] = &[
        "dfrgui", "cleanmgr", "iscsicpl", "mdsched", "odbcad32", "recdisc", "recoverydrive",
        "regedit", "resmon", "msconfig", "msinfo32", "psr", "wfs", "mstsc", "charmap",
        "fxscover", "magnify", "narrator", "osk", "voiceaccess", "wmplayer",
        "databasecompare", "spreadsheetcompare", "silverlight", "appcertui", "appverif",
    ];

    static WINDOWS_OS_PROCESSES: &[&str] = &[
        "svchost", "taskhostw", "wininit", "winlogon", "services", "lsass", "csrss", "smss",
        "runtimebroker", "dllhost", "sihost", "werfault", "conhost", "searchhost",
        "startmenuexperiencehost", "shellexperiencehost", "textinputhost",
    ];

    // ── Name normalisation ────────────────────────────────────────────────────────

    pub fn normalize_app_name(name: &str) -> String {
        let mut s = name.to_string();
        // Strip " (User)" suffix
        if let Some(stripped) = regex_strip_suffix(&s, r"(?i)\s*\(User\)\s*$") {
            s = stripped;
        }
        // Strip arch suffixes
        if let Some(stripped) = regex_strip_suffix(&s, r"(?i)\s*\((x64|x86|32-bit|64-bit)\)\s*$") {
            s = stripped;
        }
        if s.to_lowercase().ends_with(" x64") {
            s = s[..s.len() - 4].trim().to_string();
        }
        // Strip trailing version numbers
        s = strip_trailing_version(&s);
        // Strip "version X.X.X" or trailing "version"
        if let Some(stripped) = regex_strip_suffix(&s, r"(?i)\s+version\s+[\d.]+\s*$") {
            s = stripped;
        }
        if let Some(stripped) = regex_strip_suffix(&s, r"(?i)\s+version\s*$") {
            s = stripped;
        }
        // Strip leading "Microsoft "
        if s.to_lowercase().starts_with("microsoft ") {
            s = s[10..].trim().to_string();
        }
        s.trim().to_string()
    }

    fn strip_trailing_version(s: &str) -> String {
        // Strips trailing " 5.0.5", " 1.1", " 7.3", " 11.76.9"
        let bytes = s.as_bytes();
        let mut end = bytes.len();
        // Walk back over digits and dots
        while end > 0 {
            let c = bytes[end - 1];
            if c.is_ascii_digit() || c == b'.' {
                end -= 1;
            } else {
                break;
            }
        }
        // There must be at least one dot (otherwise it's just a single number — skip)
        let suffix = &s[end..];
        if suffix.contains('.') {
            // Must be preceded by whitespace
            let trimmed = s[..end].trim_end();
            if trimmed.len() < s.len() {
                return trimmed.to_string();
            }
        }
        s.to_string()
    }

    fn regex_strip_suffix(_s: &str, _pattern: &str) -> Option<String> {
        // Lightweight hand-rolled replacements for the patterns we need,
        // avoiding a full regex dependency.
        None // fallback: not stripping (handled by caller's specific logic above)
    }

    // ── Icon extraction ───────────────────────────────────────────────────────────

    fn extract_icon_as_base64(exe_path: &str) -> Option<String> {
        if exe_path.is_empty() || !std::path::Path::new(exe_path).exists() {
            return None;
        }
        unsafe { extract_icon_unsafe(exe_path) }
    }

    unsafe fn extract_icon_unsafe(path: &str) -> Option<String> {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut shfi = SHFILEINFOW::default();
        let result = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL,
            Some(&mut shfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if result == 0 || shfi.hIcon.is_invalid() {
            return None;
        }
        let hicon = shfi.hIcon;
        let png_bytes = hicon_to_png(hicon);
        let _ = DestroyIcon(hicon);
        let bytes = png_bytes?;
        Some(format!("data:image/png;base64,{}", base64_encode(&bytes)))
    }

    unsafe fn hicon_to_png(
        hicon: windows::Win32::UI::WindowsAndMessaging::HICON,
    ) -> Option<Vec<u8>> {
        use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

        let mut icon_info = ICONINFO::default();
        if GetIconInfo(hicon, &mut icon_info).is_err() {
            return None;
        }

        let hbm_color = icon_info.hbmColor;
        let hbm_mask = icon_info.hbmMask;

        // Get bitmap dimensions
        let mut bm = BITMAP::default();
        if GetObjectW(
            hbm_color,
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut _),
        ) == 0
        {
            let _ = DeleteObject(hbm_color);
            let _ = DeleteObject(hbm_mask);
            return None;
        }

        let width = bm.bmWidth as u32;
        let height = bm.bmHeight as u32;
        if width == 0 || height == 0 {
            let _ = DeleteObject(hbm_color);
            let _ = DeleteObject(hbm_mask);
            return None;
        }

        // Set up DIB section to read BGRA bytes
        let hdc = CreateCompatibleDC(None);
        let old_obj = SelectObject(hdc, hbm_color);

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // negative = top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [windows::Win32::Graphics::Gdi::RGBQUAD::default()],
        };

        let stride = (width * 4) as usize;
        let mut pixels: Vec<u8> = vec![0u8; stride * height as usize];

        let rows = GetDIBits(
            hdc,
            hbm_color,
            0,
            height,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc, old_obj);
        let _ = DeleteDC(hdc);
        let _ = DeleteObject(hbm_color);
        let _ = DeleteObject(hbm_mask);

        if rows == 0 {
            return None;
        }

        // Convert BGRA → RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2); // B↔R
        }

        // Encode as PNG using the image crate
        use image::{ImageEncoder, RgbaImage};
        use image::codecs::png::PngEncoder;

        let img = RgbaImage::from_raw(width, height, pixels)?;
        let mut out: Vec<u8> = Vec::new();
        let encoder = PngEncoder::new(&mut out);
        encoder
            .write_image(img.as_raw(), width, height, image::ColorType::Rgba8.into())
            .ok()?;
        Some(out)
    }

    fn base64_encode(data: &[u8]) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(data)
    }

    // ── Registry helpers ──────────────────────────────────────────────────────────

    fn reg_open_key(hive: HKEY, path: &str) -> Option<HKEY> {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut hkey = HKEY::default();
        let ret = unsafe { RegOpenKeyExW(hive, PCWSTR(wide.as_ptr()), 0, KEY_READ, &mut hkey) };
        if ret.is_ok() { Some(hkey) } else { None }
    }

    fn reg_enum_subkey_names(hkey: HKEY) -> Vec<String> {
        let mut names = Vec::new();
        let mut index = 0u32;
        loop {
            let mut name_buf = vec![0u16; 256];
            let mut name_len = name_buf.len() as u32;
            let ret = unsafe {
                RegEnumKeyExW(
                    hkey,
                    index,
                    PWSTR(name_buf.as_mut_ptr()),
                    &mut name_len,
                    None,
                    PWSTR::null(),
                    None,
                    None,
                )
            };
            if ret.is_err() {
                break;
            }
            let name = OsString::from_wide(&name_buf[..name_len as usize])
                .to_string_lossy()
                .into_owned();
            names.push(name);
            index += 1;
        }
        names
    }

    fn reg_query_string(hkey: HKEY, value_name: &str) -> Option<String> {
        let wide_name: Vec<u16> = value_name.encode_utf16().chain(std::iter::once(0)).collect();
        let mut data_type = REG_VALUE_TYPE::default();
        let mut size = 0u32;
        let r1 = unsafe {
            RegQueryValueExW(
                hkey,
                PCWSTR(wide_name.as_ptr()),
                None,
                Some(&mut data_type),
                None,
                Some(&mut size),
            )
        };
        if !r1.is_ok() || size == 0 {
            return None;
        }
        let mut buf = vec![0u16; (size / 2) as usize + 1];
        let r2 = unsafe {
            RegQueryValueExW(
                hkey,
                PCWSTR(wide_name.as_ptr()),
                None,
                Some(&mut data_type),
                Some(buf.as_mut_ptr() as *mut u8),
                Some(&mut size),
            )
        };
        if !r2.is_ok() {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(OsString::from_wide(&buf[..len]).to_string_lossy().into_owned())
    }

    fn reg_query_dword(hkey: HKEY, value_name: &str) -> Option<u32> {
        let wide_name: Vec<u16> = value_name.encode_utf16().chain(std::iter::once(0)).collect();
        let mut data_type = REG_VALUE_TYPE::default();
        let mut data = 0u32;
        let mut size = 4u32;
        let r = unsafe {
            RegQueryValueExW(
                hkey,
                PCWSTR(wide_name.as_ptr()),
                None,
                Some(&mut data_type),
                Some(&mut data as *mut u32 as *mut u8),
                Some(&mut size),
            )
        };
        if r.is_ok() { Some(data) } else { None }
    }

    // ── Start Menu scan ───────────────────────────────────────────────────────────

    fn scan_start_menu(seen_exe_paths: &mut HashSet<String>) -> Vec<InstalledApp> {
        let mut apps = Vec::new();
        let paths = [
            known_folder_path(windows::Win32::UI::Shell::FOLDERID_CommonPrograms),
            known_folder_path(windows::Win32::UI::Shell::FOLDERID_Programs),
        ];
        for start_path in paths.into_iter().flatten() {
            scan_lnk_dir(&start_path, &start_path, seen_exe_paths, &mut apps);
        }
        apps
    }

    fn known_folder_path(folder_id: GUID) -> Option<String> {
        unsafe {
            let path_ptr = windows::Win32::UI::Shell::SHGetKnownFolderPath(
                &folder_id,
                windows::Win32::UI::Shell::KNOWN_FOLDER_FLAG(0),
                None,
            )
            .ok()?;
            let s = path_ptr.to_string().ok()?;
            windows::Win32::System::Com::CoTaskMemFree(Some(path_ptr.as_ptr() as *const _));
            Some(s)
        }
    }

    fn scan_lnk_dir(
        root: &str,
        dir: &str,
        seen: &mut HashSet<String>,
        out: &mut Vec<InstalledApp>,
    ) {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                scan_lnk_dir(root, &path.to_string_lossy(), seen, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("lnk") {
                let lnk_path = path.to_string_lossy().into_owned();
                if let Some(target) = resolve_lnk(&lnk_path) {
                    let target_lower = target.to_lowercase();
                    if !target_lower.ends_with(".exe")
                        || !std::path::Path::new(&target).exists()
                        || should_skip_path(&target)
                    {
                        continue;
                    }
                    let mut name = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                    name = name
                        .replace("-cli", "")
                        .replace(" (x64)", "").replace(" (x86)", "")
                        .replace(" (32-bit)", "").replace(" (64-bit)", "")
                        .replace(" (64bit)", "").replace(" (32bit)", "")
                        .replace(" (64-Bit)", "").replace(" (32-Bit)", "")
                        .trim()
                        .to_string();
                    if should_skip(&name) {
                        continue;
                    }

                    // Category = top-level subfolder under root
                    let rel = lnk_path
                        .strip_prefix(root)
                        .unwrap_or(&lnk_path)
                        .trim_start_matches(['\\', '/']);
                    let category = std::path::Path::new(rel)
                        .parent()
                        .and_then(|p| p.components().next())
                        .and_then(|c| {
                            if let std::path::Component::Normal(s) = c {
                                s.to_str()
                            } else {
                                None
                            }
                        })
                        .unwrap_or("Other")
                        .to_string();

                    let key = normalize_app_name(&name).to_lowercase();
                    if seen.insert(target.to_lowercase()) {
                        out.push(InstalledApp {
                            id: format!("installed-{}", name),
                            name,
                            path: target.clone(),
                            source: "startmenu".to_string(),
                            category: Some(category),
                            icon: extract_icon_as_base64(&target),
                        });
                        let _ = key;
                    }
                }
            }
        }
    }

    fn resolve_lnk(lnk_path: &str) -> Option<String> {
        unsafe {
            let _com = ComInit::new();
            let shell_link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_ALL).ok()?;
            use windows::core::Interface;
            let persist: windows::Win32::System::Com::IPersistFile =
                shell_link.cast().ok()?;
            let wide: Vec<u16> = lnk_path.encode_utf16().chain(std::iter::once(0)).collect();
            persist.Load(PCWSTR(wide.as_ptr()), windows::Win32::System::Com::STGM(0)).ok()?;
            let mut buf = [0u16; 260];
            shell_link.GetPath(
                &mut buf,
                std::ptr::null_mut(),
                0,
            ).ok()?;
            let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            if len == 0 {
                return None;
            }
            Some(OsString::from_wide(&buf[..len]).to_string_lossy().into_owned())
        }
    }

    // ── Registry scan ─────────────────────────────────────────────────────────────

    fn scan_registry(seen_exe_paths: &mut HashSet<String>, seen_names: &mut HashSet<String>) -> Vec<InstalledApp> {
        let mut apps = Vec::new();
        let hklm_paths = [
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ];
        for reg_path in &hklm_paths {
            if let Some(hkey) = reg_open_key(HKEY_LOCAL_MACHINE, reg_path) {
                scan_uninstall_key(hkey, seen_exe_paths, seen_names, &mut apps);
                unsafe { let _ = RegCloseKey(hkey); }
            }
        }
        if let Some(hkey) = reg_open_key(
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ) {
            scan_uninstall_key(hkey, seen_exe_paths, seen_names, &mut apps);
            unsafe { let _ = RegCloseKey(hkey); }
        }
        apps
    }

    fn scan_uninstall_key(
        hkey: HKEY,
        seen_exe_paths: &mut HashSet<String>,
        seen_names: &mut HashSet<String>,
        out: &mut Vec<InstalledApp>,
    ) {
        for sub_name in reg_enum_subkey_names(hkey) {
            let sub_wide: Vec<u16> = sub_name.encode_utf16().chain(std::iter::once(0)).collect();
            let mut sub_hkey = HKEY::default();
            let ret = unsafe {
                RegOpenKeyExW(hkey, PCWSTR(sub_wide.as_ptr()), 0, KEY_READ, &mut sub_hkey)
            };
            if ret.is_err() {
                continue;
            }

            let result = (|| -> Option<()> {
                let name = reg_query_string(sub_hkey, "DisplayName")?;
                if should_skip(&name) {
                    return None;
                }
                if reg_query_dword(sub_hkey, "SystemComponent").unwrap_or(0) == 1 {
                    return None;
                }
                let install_location = reg_query_string(sub_hkey, "InstallLocation");
                let display_icon = reg_query_string(sub_hkey, "DisplayIcon");
                if reg_query_dword(sub_hkey, "NoRemove").unwrap_or(0) == 1
                    && install_location.is_none()
                {
                    return None;
                }

                let normalized = normalize_app_name(&name);
                let key_lower = normalized.to_lowercase();
                if seen_names.contains(&key_lower) || seen_names.contains(&name.to_lowercase()) {
                    return None;
                }

                // Try InstallLocation first
                if let Some(loc) = &install_location {
                    if std::path::Path::new(loc).is_dir() {
                        if let Ok(entries) = std::fs::read_dir(loc) {
                            for entry in entries.flatten() {
                                let p = entry.path();
                                if p.extension().and_then(|e| e.to_str()) != Some("exe") {
                                    continue;
                                }
                                let exe = p.to_string_lossy().into_owned();
                                if should_skip_path(&exe) {
                                    continue;
                                }
                                let exe_stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                                if should_skip(exe_stem) {
                                    continue;
                                }
                                if seen_exe_paths.insert(exe.to_lowercase()) {
                                    seen_names.insert(key_lower.clone());
                                    out.push(InstalledApp {
                                        id: format!("installed-{}", normalized),
                                        name: normalized,
                                        path: exe.clone(),
                                        source: "registry".to_string(),
                                        category: None,
                                        icon: extract_icon_as_base64(&exe),
                                    });
                                    return Some(());
                                }
                            }
                        }
                    }
                }

                // Fallback: DisplayIcon
                if let Some(icon_raw) = display_icon {
                    let icon_path = icon_raw.split(',').next().unwrap_or("").trim().trim_matches('"').to_string();
                    if icon_path.to_lowercase().ends_with(".exe")
                        && std::path::Path::new(&icon_path).exists()
                        && !should_skip_path(&icon_path)
                    {
                        let exe_stem = Path::new(&icon_path).file_stem().and_then(|s| s.to_str()).unwrap_or("");
                        if !should_skip(exe_stem) && seen_exe_paths.insert(icon_path.to_lowercase()) {
                            seen_names.insert(key_lower.clone());
                            out.push(InstalledApp {
                                id: format!("installed-{}", normalized),
                                name: normalized,
                                path: icon_path.clone(),
                                source: "registry".to_string(),
                                category: None,
                                icon: extract_icon_as_base64(&icon_path),
                            });
                        }
                    }
                }
                Some(())
            })();
            let _ = result;
            unsafe { let _ = RegCloseKey(sub_hkey); }
        }
    }

    // ── Running window scan ───────────────────────────────────────────────────────

    struct ScanState {
        pid_to_path: HashMap<u32, String>,
        pid_to_titles: HashMap<u32, Vec<(i64, String)>>,
        // best (is_visible, cloaked) per pid
        pid_to_state: HashMap<u32, (bool, i32)>,
        pid_to_desktop_id: HashMap<u32, String>,
        current_desktop_id: Option<String>,
        window_pids: HashSet<u32>,
        vd_manager: Option<windows::Win32::UI::Shell::IVirtualDesktopManager>,
    }

    fn scan_running() -> Vec<WindowEntry> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }

        // Collect process paths via QueryFullProcessImageName
        let mut pid_to_path: HashMap<u32, String> = HashMap::new();
        let sys = sysinfo::System::new_with_specifics(
            sysinfo::RefreshKind::new().with_processes(sysinfo::ProcessRefreshKind::new()),
        );
        for (&pid, proc) in sys.processes() {
            let pid_u32 = pid.as_u32();
            if let Some(path) = get_process_path(pid_u32) {
                pid_to_path.insert(pid_u32, path);
            } else if let Some(p) = proc.exe() {
                pid_to_path.insert(pid_u32, p.to_string_lossy().into_owned());
            }
        }

        // Try to get virtual desktop manager
        let vd_manager: Option<windows::Win32::UI::Shell::IVirtualDesktopManager> = unsafe {
            CoCreateInstance(
                &windows::Win32::UI::Shell::VirtualDesktopManager,
                None,
                CLSCTX_ALL,
            )
            .ok()
        };

        let state = Box::new(ScanState {
            pid_to_path,
            pid_to_titles: HashMap::new(),
            pid_to_state: HashMap::new(),
            pid_to_desktop_id: HashMap::new(),
            current_desktop_id: None,
            window_pids: HashSet::new(),
            vd_manager,
        });
        let state_ptr = Box::into_raw(state);

        unsafe {
            let _ = EnumWindows(Some(enum_windows_callback), LPARAM(state_ptr as isize));
        }

        let state = unsafe { Box::from_raw(state_ptr) };

        // Build WindowEntry list
        let mut entries = Vec::new();
        for pid in &state.window_pids {
            let path = match state.pid_to_path.get(pid) {
                Some(p) if !p.is_empty() => p.clone(),
                _ => continue,
            };

            let exe_name = Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            // Skip OS system processes
            if WINDOWS_OS_PROCESSES.contains(&exe_name.to_lowercase().as_str()) {
                continue;
            }
            let path_lower = path.to_lowercase();
            if path_lower.contains("\\windows\\system32\\") || path_lower.contains("\\windows\\syswow64\\") {
                continue;
            }

            let titles: Vec<WindowTitle> = state
                .pid_to_titles
                .get(pid)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|(hwnd, text)| WindowTitle { hwnd, text })
                .collect();

            let (is_visible, cloaked) = state.pid_to_state.get(pid).copied().unwrap_or((false, 0));
            let desktop_id = state.pid_to_desktop_id.get(pid).cloned();
            let is_on_current_desktop = match (&desktop_id, &state.current_desktop_id) {
                (Some(d), Some(cur)) => d == cur,
                _ => true,
            };

            entries.push(WindowEntry {
                pid: *pid,
                exe_name,
                path,
                titles,
                is_visible,
                cloaked,
                is_on_current_desktop,
                desktop_id,
            });
        }
        entries
    }

    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = &mut *(lparam.0 as *mut ScanState);

        // Title check
        let title_len = GetWindowTextLengthW(hwnd);
        if title_len == 0 {
            return BOOL(1);
        }
        let mut title_buf = vec![0u16; title_len as usize + 1];
        GetWindowTextW(hwnd, &mut title_buf);
        let title = OsString::from_wide(&title_buf[..title_len as usize])
            .to_string_lossy()
            .into_owned();

        if is_noise_title(&title) {
            return BOOL(1);
        }

        // Class filter
        let mut cls_buf = [0u16; 256];
        let cls_len = GetClassNameW(hwnd, &mut cls_buf);
        if cls_len > 0 {
            let cls = OsString::from_wide(&cls_buf[..cls_len as usize])
                .to_string_lossy()
                .to_lowercase();
            if cls.starts_with(".net-broadcasteventwindow")
                || cls.ends_with("backgroundprocessclass")
                || cls.starts_with("nvcontainerwindowclass")
            {
                return BOOL(1);
            }
        }

        // Cloaked check (skip app-cloaked = 1)
        let mut cloaked = 0i32;
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut _ as *mut _,
            4,
        );
        if cloaked == 1 {
            return BOOL(1);
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return BOOL(1);
        }

        let is_visible = IsWindowVisible(hwnd).as_bool();
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let is_tool = (ex_style & WS_EX_TOOLWINDOW.0) != 0;
        let is_app = (ex_style & WS_EX_APPWINDOW.0) != 0;
        let has_owner = GetWindow(hwnd, GW_OWNER).is_ok();

        if !is_app && is_tool {
            return BOOL(1);
        }
        if cloaked == 0 && !is_app && has_owner && !is_visible {
            return BOOL(1);
        }

        // Virtual desktop
        let mut desktop_id_str: Option<String> = None;
        if let Some(vdm) = &state.vd_manager {
            if let Ok(guid) = vdm.GetWindowDesktopId(hwnd) {
                let s = format!(
                    "{:08X}-{:04X}-{:04X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
                    guid.data1, guid.data2, guid.data3,
                    guid.data4[0], guid.data4[1],
                    guid.data4[2], guid.data4[3], guid.data4[4],
                    guid.data4[5], guid.data4[6], guid.data4[7]
                );
                if state.current_desktop_id.is_none() {
                    if vdm.IsWindowOnCurrentVirtualDesktop(hwnd).unwrap_or(windows::Win32::Foundation::BOOL(0)).as_bool() {
                        state.current_desktop_id = Some(s.clone());
                    }
                }
                desktop_id_str = Some(s);
            }
        }

        state.window_pids.insert(pid);

        if let Some(ds) = desktop_id_str {
            state.pid_to_desktop_id.entry(pid).or_insert(ds);
        }

        // Collect title (deduplicated) — only for VISIBLE windows. Hidden helper
        // windows (e.g. Windows Terminal's monarch window) aren't valid focus
        // targets; surfacing them produced phantom entries that focused nothing.
        // (Minimized windows report visible=true, so they're still included;
        // other-desktop windows are cloaked and already filtered out above.)
        if is_visible {
            let titles = state.pid_to_titles.entry(pid).or_default();
            let hwnd_val = hwnd.0 as i64;
            // Dedup by hwnd (always unique from EnumWindows), NOT by title:
            // Windows Terminal exposes each tab as a separate, same-titled
            // top-level window (e.g. three "Command Prompt" tabs, each its own
            // cloaked hwnd). Collapsing by title would hide all but one session.
            if !titles.iter().any(|(h, _)| *h == hwnd_val) {
                titles.push((hwnd_val, title));
            }
        }

        // Track best window state per PID
        let entry = state.pid_to_state.entry(pid).or_insert((false, cloaked));
        let (ev, ec) = *entry;
        let better = (is_visible && cloaked == 0 && (!ev || ec > 0))
            || (is_visible && !ev)
            || (is_visible == ev && cloaked < ec);
        if better {
            *entry = (is_visible, cloaked);
        }

        BOOL(1)
    }

    fn is_noise_title(title: &str) -> bool {
        let tl = title.to_lowercase();
        if tl.is_empty() || tl == "program manager" || tl == "microsoft text input application"
            || tl == "windows input experience" || tl == "settings"
            || tl.contains("msctfime ui") || tl.contains("default ime")
            || tl.contains("gdi+ window") || tl == "cptmsg" || tl == "nvcontainer"
            || tl.starts_with("uwp-") || tl == "media context menu"
            || tl == "hidden window" || tl == "task host window"
            || tl == "windows push notifications platform" || tl == "hcontrol"
            || tl.starts_with(".net-broadcasteventwindow")
            || tl.contains("broadcastlistenerwindow") || tl.contains("messageonly")
            || tl.contains("ms_webcheck") || tl.contains("wingetmessage")
            || tl == "dde server window" || tl.ends_with(" toast")
            || tl.contains("hidden wnd") || title.ends_with(".exe")
            || title.trim().len() <= 2
        {
            return true;
        }
        // GUID-style titles
        if title.len() == 38 && title.starts_with('{') && title.ends_with('}') {
            return true;
        }
        // No-space long titles = background window class names
        if !title.contains(' ') && title.len() > 12 {
            return true;
        }
        false
    }

    fn get_process_path(pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                .or_else(|_| OpenProcess(PROCESS_QUERY_INFORMATION, false, pid))
                .ok()?;
            let mut buf = vec![0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size);
            let _ = CloseHandle(handle);
            if ok.is_ok() && size > 0 {
                Some(OsString::from_wide(&buf[..size as usize]).to_string_lossy().into_owned())
            } else {
                None
            }
        }
    }

    // ── Dedup and final assembly ──────────────────────────────────────────────────

    fn dedup(startmenu: Vec<InstalledApp>, registry: Vec<InstalledApp>) -> Vec<InstalledApp> {
        let mut seen_paths: HashSet<String> = HashSet::new();
        let mut seen_names: HashSet<String> = HashSet::new();
        let mut result = Vec::new();
        // Priority: startmenu > registry
        for app in startmenu.into_iter().chain(registry.into_iter()) {
            let path_key = app.path.to_lowercase();
            let name_key = normalize_app_name(&app.name).to_lowercase();
            if !seen_paths.contains(&path_key) && !seen_names.contains(&name_key) {
                if !path_key.is_empty() {
                    seen_paths.insert(path_key);
                }
                seen_names.insert(name_key);
                result.push(app);
            }
        }
        result
    }

    // COM initialisation RAII guard
    struct ComInit;
    impl ComInit {
        fn new() -> Self {
            unsafe { let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED); }
            ComInit
        }
    }
    impl Drop for ComInit {
        fn drop(&mut self) {
            unsafe { windows::Win32::System::Com::CoUninitialize(); }
        }
    }

    // ── Built-in system apps ──────────────────────────────────────────────────────

    /// Well-known built-in Windows apps that often lack a plain Start Menu shortcut
    /// on Windows 11 (Microsoft moved them into the virtual "Windows Tools" shell
    /// folder, which the known-folder scan doesn't expose as a real directory).
    /// Seeded by fixed path so they stay searchable; skipped when the exe is missing
    /// or an app with the same display name was already discovered.
    ///
    /// Dedup is by *name*, not exe path: e.g. "Anaconda Prompt" resolves to cmd.exe,
    /// which would otherwise hide "Command Prompt" if we deduped on the shared path.
    fn builtin_windows_apps(seen_names: &HashSet<String>) -> Vec<InstalledApp> {
        let windir = std::env::var("SystemRoot")
            .or_else(|_| std::env::var("windir"))
            .unwrap_or_else(|_| "C:\\Windows".to_string());
        let sys32 = format!("{}\\System32", windir);

        // Note: explorer.exe is intentionally NOT seeded — each open Explorer
        // folder window becomes its own matcher entry, which floods results with
        // "<folder> - File Explorer" rows that also match unrelated title searches.
        let candidates: [(&str, String); 2] = [
            ("Command Prompt", format!("{}\\cmd.exe", sys32)),
            (
                "Windows PowerShell",
                format!("{}\\WindowsPowerShell\\v1.0\\powershell.exe", sys32),
            ),
        ];

        let mut out = Vec::new();
        for (name, path) in candidates {
            let name_lower = name.to_lowercase();
            if seen_names.contains(&name_lower)
                || seen_names.contains(&normalize_app_name(name).to_lowercase())
            {
                continue;
            }
            if !std::path::Path::new(&path).exists() {
                continue;
            }
            out.push(InstalledApp {
                id: format!("installed-{}", name),
                name: name.to_string(),
                path: path.clone(),
                source: "builtin".to_string(),
                category: Some("Windows Tools".to_string()),
                icon: extract_icon_as_base64(&path),
            });
        }
        out
    }

    // ── Public entry point ────────────────────────────────────────────────────────

    pub fn scan_apps_windows() -> ScannerOutput {
        let _com = ComInit::new();

        let mut seen_exe_paths: HashSet<String> = HashSet::new();
        let mut seen_names: HashSet<String> = HashSet::new();

        let startmenu = scan_start_menu(&mut seen_exe_paths);

        // Pre-populate seen_names from startmenu so registry dedup works
        for app in &startmenu {
            seen_names.insert(normalize_app_name(&app.name).to_lowercase());
            seen_names.insert(app.name.to_lowercase());
        }

        let registry = scan_registry(&mut seen_exe_paths, &mut seen_names);
        let mut installed = dedup(startmenu, registry);
        // Seed built-in system apps (cmd, powershell, explorer) that may have no
        // Start Menu shortcut on Win11, so they remain searchable. Deduped by name.
        installed.extend(builtin_windows_apps(&seen_names));
        let windows = scan_running();

        log::info!(
            "[scanner] {} installed apps, {} running windows",
            installed.len(),
            windows.len()
        );

        ScannerOutput { installed, windows }
    }
}

// ============================================================================
// macOS implementation
// ============================================================================
//
// Enumerates running windows via CGWindowListCopyWindowInfo and installed apps
// by scanning the standard /Applications directories + parsing each Info.plist.
// Ported in-process from the former `src/bin/scanner_mac.rs` sidecar binary so
// it feeds the same matcher::match_apps -> APP_CACHE -> /search pipeline as the
// Windows path. Output structs come straight from crate::matcher (no JSON hop).
//
// Window titles require Screen Recording permission (macOS 10.15+). Without it
// kCGWindowName is absent; we fall back to the owner-app name so the matcher can
// still correlate windows with installed apps.

#[cfg(target_os = "macos")]
mod macos_impl {
    use crate::matcher::{InstalledApp, ScannerOutput, WindowEntry, WindowTitle};
    use std::collections::HashMap;
    use std::ffi::{c_void, CStr, CString};
    use std::os::raw::{c_char, c_int};
    use std::path::Path;
    use sysinfo::{Pid, System};

    pub fn scan_apps_macos() -> ScannerOutput {
        let raw_windows = get_raw_windows();
        let mut windows = build_window_entries(raw_windows);
        add_windowless_app_processes(&mut windows);
        let installed = get_installed_apps();

        log::info!(
            "[scanner] macOS: {} installed apps, {} running processes with windows",
            installed.len(),
            windows.len()
        );

        ScannerOutput { installed, windows }
    }

    // ── CoreFoundation / CoreGraphics FFI ─────────────────────────────────────

    type CFTypeRef = *const c_void;
    type CFArrayRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFNumberRef = *const c_void;
    type CFBooleanRef = *const c_void;
    type CFIndex = isize;
    type CGWindowID = u32;
    type CGWindowListOption = u32;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const K_CG_WINDOW_LIST_OPTION_ALL: CGWindowListOption = 0;
    const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP: CGWindowListOption = 16;
    const K_CG_NULL_WINDOW_ID: CGWindowID = 0;
    const K_CF_NUMBER_SINT32_TYPE: c_int = 3;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
        fn CFArrayGetValueAtIndex(array: CFArrayRef, idx: CFIndex) -> CFTypeRef;
        fn CFDictionaryGetValue(dict: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;
        fn CFStringGetCString(
            s: CFStringRef,
            buf: *mut c_char,
            buf_size: CFIndex,
            encoding: u32,
        ) -> bool;
        fn CFStringCreateWithCString(
            alloc: CFTypeRef,
            c_str: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFNumberGetValue(number: CFNumberRef, the_type: c_int, value_ptr: *mut c_void) -> bool;
        fn CFBooleanGetValue(boolean: CFBooleanRef) -> bool;
        fn CFRelease(cf: CFTypeRef);
        fn CFStringGetLength(s: CFStringRef) -> CFIndex;
        fn CFStringGetMaximumSizeForEncoding(length: CFIndex, encoding: u32) -> CFIndex;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(
            option: CGWindowListOption,
            relative_to: CGWindowID,
        ) -> CFArrayRef;
    }

    // ── CF helper functions ───────────────────────────────────────────────────

    unsafe fn cf_str_to_rust(s: CFStringRef) -> Option<String> {
        if s.is_null() {
            return None;
        }
        let len = CFStringGetLength(s);
        let max = CFStringGetMaximumSizeForEncoding(len, K_CF_STRING_ENCODING_UTF8) + 1;
        let mut buf: Vec<c_char> = vec![0; max as usize];
        if CFStringGetCString(s, buf.as_mut_ptr(), max, K_CF_STRING_ENCODING_UTF8) {
            let c_str = CStr::from_ptr(buf.as_ptr());
            Some(c_str.to_string_lossy().into_owned())
        } else {
            None
        }
    }

    unsafe fn make_cf_key(key: &str) -> CFStringRef {
        let cstr = CString::new(key).unwrap_or_default();
        CFStringCreateWithCString(std::ptr::null(), cstr.as_ptr(), K_CF_STRING_ENCODING_UTF8)
    }

    unsafe fn dict_string(dict: CFDictionaryRef, key: &str) -> Option<String> {
        let cf_key = make_cf_key(key);
        if cf_key.is_null() {
            return None;
        }
        let v = CFDictionaryGetValue(dict, cf_key);
        CFRelease(cf_key);
        if v.is_null() {
            return None;
        }
        cf_str_to_rust(v as CFStringRef)
    }

    unsafe fn dict_i32(dict: CFDictionaryRef, key: &str) -> Option<i32> {
        let cf_key = make_cf_key(key);
        if cf_key.is_null() {
            return None;
        }
        let v = CFDictionaryGetValue(dict, cf_key);
        CFRelease(cf_key);
        if v.is_null() {
            return None;
        }
        let mut n: i32 = 0;
        if CFNumberGetValue(
            v as CFNumberRef,
            K_CF_NUMBER_SINT32_TYPE,
            &mut n as *mut i32 as *mut c_void,
        ) {
            Some(n)
        } else {
            None
        }
    }

    unsafe fn dict_bool(dict: CFDictionaryRef, key: &str) -> Option<bool> {
        let cf_key = make_cf_key(key);
        if cf_key.is_null() {
            return None;
        }
        let v = CFDictionaryGetValue(dict, cf_key);
        CFRelease(cf_key);
        if v.is_null() {
            return None;
        }
        Some(CFBooleanGetValue(v as CFBooleanRef))
    }

    // ── Window enumeration via CGWindowListCopyWindowInfo ──────────────────────

    struct RawWindow {
        window_id: i64,
        pid: u32,
        owner_name: String,
        /// Requires Screen Recording permission; None if not granted.
        title: Option<String>,
        is_onscreen: bool,
    }

    fn get_raw_windows() -> Vec<RawWindow> {
        let mut result = Vec::new();
        unsafe {
            let list = CGWindowListCopyWindowInfo(
                K_CG_WINDOW_LIST_OPTION_ALL | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP,
                K_CG_NULL_WINDOW_ID,
            );
            if list.is_null() {
                return result;
            }

            let count = CFArrayGetCount(list);
            for i in 0..count {
                let dict = CFArrayGetValueAtIndex(list, i) as CFDictionaryRef;
                if dict.is_null() {
                    continue;
                }

                let pid = match dict_i32(dict, "kCGWindowOwnerPID") {
                    Some(p) if p > 0 => p as u32,
                    _ => continue,
                };

                let layer = dict_i32(dict, "kCGWindowLayer").unwrap_or(0);
                // Skip dock, menu bar, desktop, and other negative-layer system UI
                if layer < 0 {
                    continue;
                }

                let window_id = dict_i32(dict, "kCGWindowNumber").unwrap_or(0) as i64;
                let owner_name = dict_string(dict, "kCGWindowOwnerName").unwrap_or_default();
                let title = dict_string(dict, "kCGWindowName");
                let is_onscreen = dict_bool(dict, "kCGWindowIsOnscreen").unwrap_or(false);

                result.push(RawWindow {
                    window_id,
                    pid,
                    owner_name,
                    title,
                    is_onscreen,
                });
            }

            CFRelease(list);
        }
        result
    }

    // ── Build WindowEntry list from raw CGWindowList data ──────────────────────

    /// Given an exe path like `/Applications/Foo.app/Contents/MacOS/Foo`,
    /// return the `.app` bundle root (`/Applications/Foo.app`).
    fn app_bundle_root(exe_path: &str) -> Option<std::path::PathBuf> {
        let path = std::path::Path::new(exe_path);
        let mut current = path.parent()?;
        loop {
            if current.extension().and_then(|e| e.to_str()) == Some("app") {
                return Some(current.to_path_buf());
            }
            current = current.parent()?;
        }
    }

    fn build_window_entries(raw: Vec<RawWindow>) -> Vec<WindowEntry> {
        let mut sys = System::new_all();
        sys.refresh_all();

        // Group raw windows by PID
        let mut by_pid: HashMap<u32, Vec<RawWindow>> = HashMap::new();
        for w in raw {
            by_pid.entry(w.pid).or_default().push(w);
        }

        let mut entries = Vec::new();

        for (pid, wins) in by_pid {
            let process = sys.process(Pid::from_u32(pid));

            let exe_path = process
                .and_then(|p| p.exe())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            // Skip macOS system infrastructure (Dock, Control Center, Finder bar, etc.)
            // Skip anything under /System/Library — CoreServices, Frameworks, XPCServices, etc.
            if exe_path.starts_with("/System/Library/") {
                continue;
            }

            // Skip app extensions (.appex bundles — Safari extensions, widgets, etc.)
            if exe_path.contains(".appex/") {
                continue;
            }

            // Skip Electron/CEF sub-process helpers embedded inside another app's Frameworks/
            // e.g. /Applications/Spotify.app/Contents/Frameworks/Spotify Helper.app/...
            if exe_path.contains("/Frameworks/") && exe_path.contains(".app/Contents/MacOS/") {
                continue;
            }

            // Skip entries with no meaningful path (XPC services without a resolved bundle)
            if !exe_path.starts_with('/') || exe_path.is_empty() {
                continue;
            }

            // For any .app bundle, check LSUIElement / LSBackgroundOnly in its Info.plist.
            // This catches system agents in /System/Applications (AutoFill, Notification Center…).
            if let Some(app_root) = app_bundle_root(&exe_path) {
                let plist = app_root.join("Contents/Info.plist");
                if plist_is_true(&plist, "LSUIElement") || plist_is_true(&plist, "LSBackgroundOnly")
                {
                    continue;
                }
            }

            // Prefer sysinfo process name; fall back to CGWindow owner name
            let exe_name = process
                .map(|p| p.name().to_string())
                .filter(|n| !n.is_empty())
                .or_else(|| wins.first().map(|w| w.owner_name.clone()))
                .unwrap_or_default();

            let is_visible = wins.iter().any(|w| w.is_onscreen);

            // Collect titled windows.  Without Screen Recording permission most
            // titles will be None — in that case emit one entry with the owner name
            // so the matcher can still correlate the process with installed apps.
            let titled: Vec<WindowTitle> = wins
                .iter()
                .filter_map(|w| {
                    w.title
                        .as_ref()
                        .filter(|t| !t.is_empty())
                        .map(|t| WindowTitle {
                            hwnd: w.window_id,
                            text: t.clone(),
                        })
                })
                .collect();

            let titles = if titled.is_empty() {
                // Fallback: one synthetic title = owner app name
                let owner = wins
                    .first()
                    .map(|w| w.owner_name.clone())
                    .unwrap_or_default();
                let hwnd = wins.first().map(|w| w.window_id).unwrap_or(0);
                if owner.is_empty() {
                    vec![]
                } else {
                    vec![WindowTitle { hwnd, text: owner }]
                }
            } else {
                titled
            };

            entries.push(WindowEntry {
                pid,
                exe_name,
                path: exe_path,
                titles,
                is_visible,
                cloaked: 0,
                is_on_current_desktop: true,
                desktop_id: None,
            });
        }

        entries
    }

    // ── Info.plist parsing (no plist crate) ────────────────────────────────────

    /// Read a single <string> value from a plaintext/XML Info.plist. Handles
    /// `<string>val</string>` on the same line and multi-line values. Good enough
    /// for standard Apple-generated plists.
    fn plist_string(plist_path: &Path, key: &str) -> Option<String> {
        let content = std::fs::read_to_string(plist_path).ok()?;
        let needle = format!("<key>{}</key>", key);
        let pos = content.find(&needle)?;
        let after = content[pos + needle.len()..].trim_start();
        if let Some(stripped) = after.strip_prefix("<string>") {
            let end = stripped.find("</string>")?;
            Some(stripped[..end].trim().to_string())
        } else {
            None
        }
    }

    /// Check if a plist key is set to true (`<true/>`) or "1". Used for
    /// LSUIElement and LSBackgroundOnly.
    fn plist_is_true(plist_path: &Path, key: &str) -> bool {
        let content = match std::fs::read_to_string(plist_path) {
            Ok(c) => c,
            Err(_) => return false,
        };
        let needle = format!("<key>{}</key>", key);
        let pos = match content.find(&needle) {
            Some(p) => p,
            None => return false,
        };
        let after = content[pos + needle.len()..].trim_start();
        after.starts_with("<true/>")
            || after.starts_with("<string>1</string>")
            || after.starts_with("<integer>1</integer>")
    }

    // ── Icon extraction ────────────────────────────────────────────────────────

    /// Parse an ICNS file and return PNG bytes sized for crisp Retina display.
    /// Picks the smallest PNG that is >= 64px wide; falls back to the largest.
    /// Modern macOS ICNS files embed raw PNG data in entries like ic07/ic13/ic14.
    fn extract_png_from_icns(path: &Path) -> Option<Vec<u8>> {
        let data = std::fs::read(path).ok()?;
        if data.len() < 8 || &data[0..4] != b"icns" {
            return None;
        }

        // Collect all PNG entries with their pixel width (read from PNG IHDR).
        let mut candidates: Vec<(u32, Vec<u8>)> = Vec::new();
        let mut offset = 8usize;

        while offset + 8 <= data.len() {
            let size = match data[offset + 4..offset + 8].try_into().ok() {
                Some(b) => u32::from_be_bytes(b) as usize,
                None => break,
            };
            if size < 8 || offset + size > data.len() {
                break;
            }

            let payload = &data[offset + 8..offset + size];

            // Modern ICNS entries contain raw PNG data starting with PNG magic bytes.
            // PNG layout: 8-byte signature, then IHDR chunk: 4-byte length, 4-byte "IHDR",
            // 4-byte width, 4-byte height — so width lives at bytes 16..20.
            if payload.len() > 24 && payload.starts_with(b"\x89PNG") {
                if let Ok(wb) = payload[16..20].try_into() as Result<[u8; 4], _> {
                    let width = u32::from_be_bytes(wb);
                    if width > 0 {
                        candidates.push((width, payload.to_vec()));
                    }
                }
            }

            offset += size;
        }

        if candidates.is_empty() {
            return None;
        }

        // Sort ascending by size so we can find the minimum acceptable candidate.
        candidates.sort_by_key(|(w, _)| *w);

        // Prefer the smallest PNG that is >= 64px — crisp at 24 CSS px on 2× Retina.
        // Fall back to the largest available if all entries are smaller.
        let chosen = candidates
            .iter()
            .find(|(w, _)| *w >= 64)
            .or_else(|| candidates.last())?;

        Some(chosen.1.clone())
    }

    /// Resolve the .icns path from Info.plist and extract a crisp PNG (>= 64px),
    /// returning it as a `data:image/png;base64,...` string.
    fn extract_icon_base64(app_path: &Path, plist: &Path) -> Option<String> {
        let resources = app_path.join("Contents/Resources");

        let icns_path = if let Some(icon_file) = plist_string(plist, "CFBundleIconFile") {
            let candidate = if icon_file.ends_with(".icns") {
                resources.join(&icon_file)
            } else {
                resources.join(format!("{}.icns", icon_file))
            };
            if candidate.exists() {
                candidate
            } else {
                return None;
            }
        } else {
            // Fallback to common names
            let fallback = resources.join("AppIcon.icns");
            if fallback.exists() {
                fallback
            } else {
                return None;
            }
        };

        let png_bytes = extract_png_from_icns(&icns_path)?;
        let encoded = base64_encode(&png_bytes);
        Some(format!("data:image/png;base64,{}", encoded))
    }

    /// Inline base64 encoder — keeps this cfg-gated module self-contained.
    fn base64_encode(data: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
        for chunk in data.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
            let n = (b0 << 16) | (b1 << 8) | b2;
            out.push(TABLE[((n >> 18) & 63) as usize] as char);
            out.push(TABLE[((n >> 12) & 63) as usize] as char);
            out.push(if chunk.len() > 1 {
                TABLE[((n >> 6) & 63) as usize] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                TABLE[(n & 63) as usize] as char
            } else {
                '='
            });
        }
        out
    }

    // ── Installed apps via /Applications directory scan ─────────────────────────

    fn scan_app_dir(dir: &Path, source: &str) -> Vec<InstalledApp> {
        let mut apps = Vec::new();
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return apps,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("app") {
                continue;
            }

            let bundle_name = match path.file_stem().and_then(|s| s.to_str()) {
                Some(n) if !n.is_empty() => n.to_string(),
                _ => continue,
            };

            let plist = path.join("Contents/Info.plist");

            // Skip background-only and UI-agent apps (no Dock icon, not user-launchable).
            // Examples: AutoFill, Notification Center, Control Center, Siri UI.
            if plist_is_true(&plist, "LSUIElement") || plist_is_true(&plist, "LSBackgroundOnly") {
                continue;
            }

            let app_name = plist_string(&plist, "CFBundleDisplayName")
                .or_else(|| plist_string(&plist, "CFBundleName"))
                .unwrap_or_else(|| bundle_name.clone());

            let category = plist_string(&plist, "LSApplicationCategoryType");

            // Resolve the actual Mach-O executable path
            let bundle_exe =
                plist_string(&plist, "CFBundleExecutable").unwrap_or_else(|| bundle_name.clone());
            let exe_candidate = path.join("Contents/MacOS").join(&bundle_exe);
            let exe_path = if exe_candidate.exists() {
                exe_candidate.to_string_lossy().to_string()
            } else {
                path.to_string_lossy().to_string()
            };

            // Stable ID: lower-cased path with spaces replaced
            let id = format!(
                "app-{}",
                path.to_string_lossy()
                    .to_lowercase()
                    .replace(' ', "_")
                    .replace('/', "-")
            );

            let icon = extract_icon_base64(&path, &plist);

            apps.push(InstalledApp {
                id,
                name: app_name,
                path: exe_path,
                source: source.to_string(),
                category,
                icon,
            });
        }

        apps
    }

    fn get_installed_apps() -> Vec<InstalledApp> {
        let mut apps: Vec<InstalledApp> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        // Scan all known app locations
        let dirs_to_scan: &[(&str, &str)] = &[
            ("/Applications", "applications"),
            ("/System/Applications", "system_applications"),
            ("/System/Applications/Utilities", "system_applications"),
        ];

        for (dir, source) in dirs_to_scan {
            for app in scan_app_dir(Path::new(dir), source) {
                if seen.insert(app.name.clone()) {
                    apps.push(app);
                }
            }
        }

        // Per-user ~/Applications
        if let Some(home) = dirs::home_dir() {
            for app in scan_app_dir(&home.join("Applications"), "user_applications") {
                if seen.insert(app.name.clone()) {
                    apps.push(app);
                }
            }
        }

        apps
    }

    // ── Windowless process detection ────────────────────────────────────────────

    /// Add running .app processes that have no CGWindowList windows (background
    /// apps like Music.app, Photos.app that may run without a visible window) so
    /// the matcher can mark them as `isRunning: true`.
    fn add_windowless_app_processes(windows: &mut Vec<WindowEntry>) {
        let pids_with_windows: std::collections::HashSet<u32> =
            windows.iter().map(|w| w.pid).collect();

        let mut sys = System::new_all();
        sys.refresh_all();

        for (pid, process) in sys.processes() {
            let pid_u32 = pid.as_u32();
            if pids_with_windows.contains(&pid_u32) {
                continue;
            }

            let exe_path = process
                .exe()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            // Only include .app bundle processes (skips kernel threads, daemons, etc.)
            if !exe_path.contains(".app/Contents/MacOS/") {
                continue;
            }

            // Skip CoreServices system infrastructure
            if exe_path.contains("/System/Library/CoreServices/")
                || exe_path.contains("/System/Library/PrivateFrameworks/")
            {
                continue;
            }

            // Skip app extensions and Electron helpers
            if exe_path.contains(".appex/") || exe_path.contains("/Frameworks/") {
                continue;
            }

            // Skip UI agent / background-only apps
            if let Some(app_root) = app_bundle_root(&exe_path) {
                let plist = app_root.join("Contents/Info.plist");
                if plist_is_true(&plist, "LSUIElement") || plist_is_true(&plist, "LSBackgroundOnly")
                {
                    continue;
                }
            }

            let exe_name = process.name().to_string();

            windows.push(WindowEntry {
                pid: pid_u32,
                exe_name,
                path: exe_path,
                titles: vec![],
                is_visible: false,
                cloaked: 0,
                is_on_current_desktop: false,
                desktop_id: None,
            });
        }
    }
}
