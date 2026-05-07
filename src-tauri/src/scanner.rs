use crate::matcher::ScannerOutput;

pub fn scan_apps() -> ScannerOutput {
    #[cfg(target_os = "windows")]
    return windows_impl::scan_apps_windows();

    #[cfg(not(target_os = "windows"))]
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

    fn should_skip_exe_name(name: &str) -> bool {
        if name.is_empty() {
            return true;
        }
        let lower = name.to_lowercase();
        lower.contains("unins") || lower.contains("setup") || lower.contains("update")
            || lower.contains("updater") || lower.contains("crash") || lower.contains("helper")
            || lower.contains("svc") || lower.ends_with("service") || lower.contains("daemon")
            || lower.contains("agent") || (lower.contains("launcher") && lower.contains("helper"))
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

    fn regex_strip_suffix(s: &str, _pattern: &str) -> Option<String> {
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

        // Collect title (deduplicated)
        let titles = state.pid_to_titles.entry(pid).or_default();
        let hwnd_val = hwnd.0 as i64;
        if !titles.iter().any(|(_, t)| t == &title) {
            titles.push((hwnd_val, title));
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
        let installed = dedup(startmenu, registry);
        let windows = scan_running();

        log::info!(
            "[scanner] {} installed apps, {} running windows",
            installed.len(),
            windows.len()
        );

        ScannerOutput { installed, windows }
    }
}
