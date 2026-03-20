//! macOS AppScanner
//!
//! Outputs JSON in the same format as the Windows AppScanner so that the
//! platform-agnostic AppMatcher (matcher.rs) can consume it unchanged:
//!
//! ```json
//! {
//!   "installed": [ { "id", "name", "path", "source", "category", "icon" } ],
//!   "windows":   [ { "pid", "exeName", "path", "titles": [{"hwnd","text"}],
//!                    "isVisible", "cloaked", "isOnCurrentDesktop", "desktopId" } ]
//! }
//! ```
//!
//! Window titles require Screen Recording permission (macOS 10.15+).
//! Without it kCGWindowName is absent; we fall back to the owner-app name so
//! the matcher can still associate windows with installed apps.

use std::collections::HashMap;
use std::ffi::{CStr, CString, c_void};
use std::os::raw::{c_char, c_int};
use std::path::Path;

use serde::Serialize;
use sysinfo::{Pid, System};

// ── Output structures (same schema as Windows AppScanner) ─────────────────────

#[derive(Serialize)]
struct ScannerOutput {
    installed: Vec<InstalledApp>,
    windows: Vec<WindowEntry>,
}

#[derive(Serialize, Clone)]
struct InstalledApp {
    id: String,
    name: String,
    path: String,
    source: String,
    category: Option<String>,
    icon: Option<String>,
}

#[derive(Serialize)]
struct WindowTitle {
    hwnd: i64,
    text: String,
}

#[derive(Serialize)]
struct WindowEntry {
    pid: u32,
    #[serde(rename = "exeName")]
    exe_name: String,
    path: String,
    titles: Vec<WindowTitle>,
    #[serde(rename = "isVisible")]
    is_visible: bool,
    /// Always 0 on macOS (no DWM equivalent)
    cloaked: i32,
    #[serde(rename = "isOnCurrentDesktop")]
    is_on_current_desktop: bool,
    /// Mission Control space UUID — null for now (private API required)
    #[serde(rename = "desktopId")]
    desktop_id: Option<String>,
}

// ── CoreFoundation / CoreGraphics FFI ─────────────────────────────────────────

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
    fn CFNumberGetValue(
        number: CFNumberRef,
        the_type: c_int,
        value_ptr: *mut c_void,
    ) -> bool;
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

// ── CF helper functions ───────────────────────────────────────────────────────

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
    CFStringCreateWithCString(
        std::ptr::null(),
        cstr.as_ptr(),
        K_CF_STRING_ENCODING_UTF8,
    )
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

// ── Window enumeration via CGWindowListCopyWindowInfo ─────────────────────────

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

// ── Build WindowEntry list from raw CGWindowList data ─────────────────────────

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

        // Prefer sysinfo process name; fall back to CGWindow owner name
        let exe_name = process
            .map(|p| p.name().to_string())
            .filter(|n| !n.is_empty())
            .or_else(|| wins.first().map(|w| w.owner_name.clone()))
            .unwrap_or_default();

        let is_visible = wins.iter().any(|w| w.is_onscreen);

        // Collect titled windows.  Without Screen Recording permission most
        // titles will be None — in that case emit one entry with the owner name
        // so AppMatcher can still correlate the process with installed apps.
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
            let owner = wins.first().map(|w| w.owner_name.clone()).unwrap_or_default();
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

// ── Installed apps via /Applications directory scan ───────────────────────────

/// Read a single <string> value from a plaintext/XML Info.plist without pulling
/// in a plist crate.  Handles both `<string>val</string>` on the same line and
/// multi-line values.  Good enough for standard Apple-generated plists.
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

// ── Icon extraction ───────────────────────────────────────────────────────────

/// Parse an ICNS file and return the bytes of the smallest embedded PNG entry.
/// Modern macOS ICNS files embed raw PNG data in entries like ic07/ic13/ic14.
fn extract_png_from_icns(path: &Path) -> Option<Vec<u8>> {
    let data = std::fs::read(path).ok()?;
    if data.len() < 8 || &data[0..4] != b"icns" {
        return None;
    }

    let mut best: Option<Vec<u8>> = None;
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

        // Modern ICNS entries contain raw PNG data starting with PNG magic bytes
        if payload.len() > 8 && payload.starts_with(b"\x89PNG") {
            // Keep the smallest PNG — best for icon thumbnail use and lower JSON weight
            if best.as_ref().map_or(true, |b: &Vec<u8>| payload.len() < b.len()) {
                best = Some(payload.to_vec());
            }
        }

        offset += size;
    }

    best
}

/// Resolve the .icns path from Info.plist and extract the smallest embedded PNG,
/// returning it as a `data:image/png;base64,...` string.
fn extract_icon_base64(app_path: &Path, plist: &Path) -> Option<String> {
    let resources = app_path.join("Contents/Resources");

    let icns_path = if let Some(icon_file) = plist_string(plist, "CFBundleIconFile") {
        let candidate = if icon_file.ends_with(".icns") {
            resources.join(&icon_file)
        } else {
            resources.join(format!("{}.icns", icon_file))
        };
        if candidate.exists() { candidate } else { return None; }
    } else {
        // Fallback to common names
        let fallback = resources.join("AppIcon.icns");
        if fallback.exists() { fallback } else { return None; }
    };

    let png_bytes = extract_png_from_icns(&icns_path)?;
    let encoded = base64_encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", encoded))
}

/// Inline base64 encoder — avoids a crate dependency in this standalone binary.
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
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

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

        let app_name = plist_string(&plist, "CFBundleDisplayName")
            .or_else(|| plist_string(&plist, "CFBundleName"))
            .unwrap_or_else(|| bundle_name.clone());

        let category = plist_string(&plist, "LSApplicationCategoryType");

        // Resolve the actual Mach-O executable path
        let bundle_exe = plist_string(&plist, "CFBundleExecutable")
            .unwrap_or_else(|| bundle_name.clone());
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

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() {
    let debug = std::env::args().any(|a| a == "--debug");

    let raw_windows = get_raw_windows();
    let windows = build_window_entries(raw_windows);
    let installed = get_installed_apps();

    if debug {
        eprintln!(
            "[AppScanner] {} installed apps, {} running processes with windows",
            installed.len(),
            windows.len()
        );
    }

    let output = ScannerOutput { installed, windows };

    match serde_json::to_string(&output) {
        Ok(json) => println!("{}", json),
        Err(e) => {
            eprintln!("[AppScanner] Serialization error: {}", e);
            println!(r#"{{"installed":[],"windows":[]}}"#);
        }
    }
}
