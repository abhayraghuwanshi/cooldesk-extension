// Linux installed-app + running-window scanner. See `scanner.rs` for the
// module-level overview; output feeds `matcher::match_apps`.
//
// "Installed apps" come from parsing `.desktop` files (the freedesktop.org
// Desktop Entry Specification) across the standard XDG application
// directories, mirroring how every Linux app launcher/menu builds its list.
// "Running windows" come from `crate::linux_ewmh` (X11/EWMH) — see that
// module's doc comment for the Wayland caveat.
//
// Icon resolution is intentionally modest: a `.desktop` `Icon=` value is
// usually a bare theme name (e.g. `firefox`), not a path, and fully
// resolving that requires walking the XDG icon theme cascade (index.theme
// inheritance, per-size directories, svg/xpm formats). This only checks a
// fixed set of common hicolor sizes plus `/usr/share/pixmaps`, and only
// reads `.png` (no SVG rasterizer or XPM decoder here) — good enough for
// most default-theme apps, `None` (no crash) otherwise, same tolerance the
// matcher already has for mac/Windows apps with no resolvable icon.

use crate::linux_ewmh::{self, EwmhWindow};
use crate::matcher::{InstalledApp, ScannerOutput, WindowEntry, WindowTitle};
use std::path::{Path, PathBuf};

pub fn scan_apps_linux(extra_dirs: &[String]) -> ScannerOutput {
    let installed = get_installed_apps(extra_dirs);
    let windows = get_window_entries();

    log::info!(
        "[scanner] Linux: {} installed apps, {} windows",
        installed.len(),
        windows.len()
    );

    ScannerOutput { installed, windows }
}

// ── Running windows via X11/EWMH ────────────────────────────────────────────

/// Strip the " (deleted)" suffix the kernel appends to `/proc/<pid>/exe`
/// when the backing binary was removed/replaced after the process started
/// (common after a package upgrade) — otherwise it leaks into the basename
/// the matcher compares against.
fn clean_proc_exe(raw: String) -> String {
    raw.strip_suffix(" (deleted)").map(str::to_string).unwrap_or(raw)
}

fn proc_exe_path(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{}/exe", pid))
        .ok()
        .map(|p| clean_proc_exe(p.to_string_lossy().into_owned()))
}

fn window_entry_from(w: &EwmhWindow, current_desktop: Option<u32>) -> WindowEntry {
    let path = proc_exe_path(w.pid).unwrap_or_default();
    let exe_name = Path::new(&path)
        .file_stem()
        .and_then(|n| n.to_str())
        .map(str::to_string)
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| w.wm_class.clone());

    let titles = if w.title.is_empty() {
        Vec::new()
    } else {
        vec![WindowTitle { hwnd: w.id as i64, text: w.title.clone() }]
    };

    WindowEntry {
        pid: w.pid,
        exe_name,
        path,
        titles,
        is_visible: w.is_visible,
        cloaked: 0,
        is_on_current_desktop: match (w.desktop, current_desktop) {
            (None, _) | (_, None) => true,
            (Some(d), Some(cur)) => d == cur,
        },
        desktop_id: w.desktop.map(|d| d.to_string()),
    }
}

fn get_window_entries() -> Vec<WindowEntry> {
    let snap = linux_ewmh::snapshot();
    snap.windows
        .iter()
        .filter(|w| w.pid > 0)
        .map(|w| window_entry_from(w, snap.current_desktop))
        .collect()
}

// ── Desktop entry parsing (freedesktop.org spec, no ini crate) ─────────────

struct DesktopEntry {
    name: String,
    /// First whitespace/quote-delimited token of `Exec=`, field codes
    /// (`%f`, `%U`, ...) stripped by construction since we only ever take
    /// the leading token, never the rest of the command line.
    exec_bin: String,
    icon: Option<String>,
    categories: Option<String>,
}

fn exec_leading_token(exec: &str) -> String {
    let exec = exec.trim();
    for quote in ['"', '\''] {
        if let Some(rest) = exec.strip_prefix(quote) {
            if let Some(end) = rest.find(quote) {
                return rest[..end].to_string();
            }
        }
    }
    exec.split_whitespace().next().unwrap_or("").to_string()
}

fn parse_desktop_entry(content: &str) -> Option<DesktopEntry> {
    let mut in_desktop_entry = false;
    let mut entry_type: Option<&str> = None;
    let mut name = None;
    let mut exec = None;
    let mut icon = None;
    let mut categories = None;
    let mut no_display = false;
    let mut hidden = false;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(section) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            in_desktop_entry = section == "Desktop Entry";
            continue;
        }
        if !in_desktop_entry {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let (key, value) = (key.trim(), value.trim());
        match key {
            "Type" => entry_type = Some(value),
            "Name" => name = Some(value.to_string()),
            "Exec" => exec = Some(value.to_string()),
            "Icon" => icon = Some(value.to_string()),
            "Categories" => categories = Some(value.trim_matches(';').to_string()),
            "NoDisplay" => no_display = value.eq_ignore_ascii_case("true"),
            "Hidden" => hidden = value.eq_ignore_ascii_case("true"),
            _ => {}
        }
    }

    if entry_type != Some("Application") || no_display || hidden {
        return None;
    }
    let name = name?;
    let exec_bin = exec_leading_token(&exec?);
    if exec_bin.is_empty() {
        return None;
    }

    Some(DesktopEntry { name, exec_bin, icon, categories })
}

// ── Icon resolution ──────────────────────────────────────────────────────

const ICON_THEME_ROOTS: &[&str] = &["/usr/share/icons/hicolor", "/usr/local/share/icons/hicolor"];
const ICON_SIZES: &[&str] = &["256x256", "128x128", "64x64", "48x48", "32x32"];

fn find_themed_icon(name: &str) -> Option<PathBuf> {
    for root in ICON_THEME_ROOTS {
        for size in ICON_SIZES {
            let candidate = Path::new(root).join(size).join("apps").join(format!("{}.png", name));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let pixmap = Path::new("/usr/share/pixmaps").join(format!("{}.png", name));
    if pixmap.is_file() {
        return Some(pixmap);
    }
    None
}

fn resolve_icon_base64(icon: &str) -> Option<String> {
    let path = if icon.starts_with('/') {
        let p = PathBuf::from(icon);
        if p.extension().and_then(|e| e.to_str()) == Some("png") && p.is_file() {
            p
        } else {
            return None;
        }
    } else {
        find_themed_icon(icon)?
    };

    let bytes = std::fs::read(&path).ok()?;
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:image/png;base64,{}", encoded))
}

// ── Installed apps via .desktop file directories ────────────────────────────

fn scan_desktop_dir(dir: &Path, source: &str, seen: &mut std::collections::HashSet<String>) -> Vec<InstalledApp> {
    let mut apps = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return apps,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let Some(desktop) = parse_desktop_entry(&content) else { continue };
        if !seen.insert(desktop.name.clone()) {
            continue;
        }

        let id = format!(
            "app-{}",
            path.to_string_lossy().to_lowercase().replace(' ', "_").replace('/', "-")
        );
        let icon = desktop.icon.and_then(|i| resolve_icon_base64(&i));

        apps.push(InstalledApp {
            id,
            name: desktop.name,
            path: desktop.exec_bin,
            source: source.to_string(),
            category: desktop.categories,
            icon,
        });
    }

    apps
}

fn get_installed_apps(extra_dirs: &[String]) -> Vec<InstalledApp> {
    let mut apps: Vec<InstalledApp> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut dirs_to_scan: Vec<(PathBuf, &str)> = vec![
        (PathBuf::from("/usr/share/applications"), "applications"),
        (PathBuf::from("/usr/local/share/applications"), "applications"),
        (PathBuf::from("/var/lib/flatpak/exports/share/applications"), "flatpak"),
        (PathBuf::from("/var/lib/snapd/desktop/applications"), "snap"),
    ];

    if let Some(home) = dirs::home_dir() {
        dirs_to_scan.push((home.join(".local/share/applications"), "user_applications"));
        dirs_to_scan.push((
            home.join(".local/share/flatpak/exports/share/applications"),
            "flatpak",
        ));
    }

    for (dir, source) in &dirs_to_scan {
        apps.extend(scan_desktop_dir(dir, source, &mut seen));
    }

    // User-linked folders (Settings → Folders & Index, "include apps" on) —
    // same `.desktop`-file scan, for locations outside the standard XDG set.
    for dir in extra_dirs {
        apps.extend(scan_desktop_dir(Path::new(dir), "linked_folder", &mut seen));
    }

    apps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_normal_app_entry() {
        let content = "\
[Desktop Entry]
Type=Application
Name=Firefox
Exec=firefox %u
Icon=firefox
Categories=Network;WebBrowser;
";
        let entry = parse_desktop_entry(content).expect("should parse");
        assert_eq!(entry.name, "Firefox");
        assert_eq!(entry.exec_bin, "firefox");
        assert_eq!(entry.icon.as_deref(), Some("firefox"));
        assert_eq!(entry.categories.as_deref(), Some("Network;WebBrowser"));
    }

    #[test]
    fn skips_no_display_entries() {
        let content = "\
[Desktop Entry]
Type=Application
Name=Background Helper
Exec=helper
NoDisplay=true
";
        assert!(parse_desktop_entry(content).is_none());
    }

    #[test]
    fn skips_hidden_entries() {
        let content = "\
[Desktop Entry]
Type=Application
Name=Removed App
Exec=removed
Hidden=true
";
        assert!(parse_desktop_entry(content).is_none());
    }

    #[test]
    fn skips_non_application_entries() {
        let content = "\
[Desktop Entry]
Type=Link
Name=Some Link
URL=https://example.com
";
        assert!(parse_desktop_entry(content).is_none());
    }

    #[test]
    fn ignores_localized_name_keys() {
        let content = "\
[Desktop Entry]
Type=Application
Name=Editor
Name[fr]=Éditeur
Exec=editor
";
        let entry = parse_desktop_entry(content).expect("should parse");
        assert_eq!(entry.name, "Editor");
    }

    #[test]
    fn handles_quoted_exec_with_spaces() {
        let content = "\
[Desktop Entry]
Type=Application
Name=Spaced App
Exec=\"/opt/spaced app/bin/run\" %U
";
        let entry = parse_desktop_entry(content).expect("should parse");
        assert_eq!(entry.exec_bin, "/opt/spaced app/bin/run");
    }

    #[test]
    fn handles_exec_with_flags_before_field_codes() {
        let content = "\
[Desktop Entry]
Type=Application
Name=Code
Exec=/usr/bin/code --unity-launch %F
";
        let entry = parse_desktop_entry(content).expect("should parse");
        assert_eq!(entry.exec_bin, "/usr/bin/code");
    }

    #[test]
    fn rejects_missing_name_or_exec() {
        let no_name = "[Desktop Entry]\nType=Application\nExec=foo\n";
        assert!(parse_desktop_entry(no_name).is_none());

        let no_exec = "[Desktop Entry]\nType=Application\nName=Foo\n";
        assert!(parse_desktop_entry(no_exec).is_none());
    }

    #[test]
    fn strips_deleted_suffix_from_proc_exe() {
        assert_eq!(clean_proc_exe("/usr/bin/foo (deleted)".to_string()), "/usr/bin/foo");
        assert_eq!(clean_proc_exe("/usr/bin/foo".to_string()), "/usr/bin/foo");
    }
}
