use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

// ── AppScanner output structures ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ScannerOutput {
    installed: Vec<InstalledApp>,
    windows: Vec<WindowEntry>,
}

#[derive(Debug, Deserialize, Clone)]
struct InstalledApp {
    id: String,
    name: String,
    path: String,
    source: String,
    icon: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct WindowEntry {
    pid: u32,
    #[serde(rename = "exeName")]
    exe_name: String,
    path: String,
    titles: Vec<String>,
    #[serde(rename = "isVisible")]
    is_visible: bool,
    cloaked: i32,
    #[serde(rename = "isOnCurrentDesktop")]
    is_on_current_desktop: bool,
    #[serde(rename = "desktopId")]
    desktop_id: Option<String>,
}

// ── Output structure (same schema Electron reads today) ────────────────────────

#[derive(Debug, Serialize)]
struct AppEntry {
    id: String,
    name: String,
    title: String,
    path: String,
    #[serde(rename = "type")]
    app_type: String,
    source: String,
    #[serde(rename = "isRunning")]
    is_running: bool,
    pid: u32,
    cloaked: i32,
    #[serde(rename = "isVisible")]
    is_visible: bool,
    #[serde(rename = "isOnCurrentDesktop")]
    is_on_current_desktop: bool,
    #[serde(rename = "desktopId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    desktop_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

fn normalize_path(p: &str) -> String {
    p.to_lowercase().replace('\\', "/")
}

/// Lowercase and collapse internal whitespace.
fn normalize_text(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut result = String::with_capacity(lower.len());
    let mut last_space = false;
    for c in lower.chars() {
        if c.is_whitespace() {
            if !last_space && !result.is_empty() {
                result.push(' ');
                last_space = true;
            }
        } else {
            result.push(c);
            last_space = false;
        }
    }
    result.trim_end().to_string()
}

fn exe_basename(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
}

/// Lower score = better window state (prefer visible + uncloaked).
fn window_score(w: &WindowEntry) -> u32 {
    match (w.is_visible, w.cloaked) {
        (true, 0) => 0,
        (true, _) => 1,
        (false, 0) => 2,
        _ => 3,
    }
}

fn pick_best_idx(idxs: &[usize], windows: &[WindowEntry]) -> usize {
    *idxs
        .iter()
        .min_by_key(|&&i| window_score(&windows[i]))
        .unwrap()
}

/// Priority 3: the normalized window title must START WITH the normalized app
/// name, and the next character (if any) must not be alphanumeric (so "code"
/// doesn't match "codeium").
fn title_matches_app(norm_title: &str, norm_app_name: &str) -> bool {
    if !norm_title.starts_with(norm_app_name) {
        return false;
    }
    let rest = &norm_title[norm_app_name.len()..];
    if let Some(next_char) = rest.chars().next() {
        if next_char.is_alphanumeric() {
            return false; // app name is prefix of a longer word
        }
    }
    true
}

// ── Main ───────────────────────────────────────────────────────────────────────

fn main() {
    // Check for --input <file> or --json <data> arguments
    let args: Vec<String> = std::env::args().collect();
    let mut input = String::new();

    if let Some(pos) = args.iter().position(|a| a == "--input") {
        if let Some(path) = args.get(pos + 1) {
            if let Ok(data) = std::fs::read_to_string(path) {
                input = data;
            } else {
                eprintln!("[AppMatcher] Failed to read input file: {}", path);
            }
        }
    } else if let Some(pos) = args.iter().position(|a| a == "--json") {
        if let Some(data) = args.get(pos + 1) {
            input = data.clone();
        }
    }

    if input.is_empty() {
        // Fall back to stdin
        if let Err(e) = std::io::stdin().read_to_string(&mut input) {
            eprintln!("[AppMatcher] Failed to read stdin: {}", e);
            println!("[]");
            return;
        }
    }

    let scanner_data: ScannerOutput = match serde_json::from_str(&input) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[AppMatcher] Failed to parse AppScanner output: {}", e);
            eprintln!(
                "[AppMatcher] stdin snippet: {}",
                &input[..input.len().min(500)]
            );
            println!("[]");
            return;
        }
    };

    let installed = &scanner_data.installed;
    let windows = &scanner_data.windows;

    // Build lookup maps: normalized_path / exe_name → [index into windows]
    let mut path_to_windows: HashMap<String, Vec<usize>> = HashMap::new();
    let mut name_to_windows: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, w) in windows.iter().enumerate() {
        path_to_windows
            .entry(normalize_path(&w.path))
            .or_default()
            .push(i);
        name_to_windows
            .entry(w.exe_name.to_lowercase())
            .or_default()
            .push(i);
    }

    let mut matched_pids: HashSet<u32> = HashSet::new();
    let mut result: Vec<AppEntry> = Vec::new();

    for app in installed {
        let app_path_norm = normalize_path(&app.path);
        let app_exe = exe_basename(&app.path);
        let app_name_norm = normalize_text(&app.name);

        let mut matched_idx: Option<usize> = None;

        // Priority 1 — exact path match
        if let Some(idxs) = path_to_windows.get(&app_path_norm) {
            matched_idx = Some(pick_best_idx(idxs, windows));
        }

        // Priority 2 — exe name match (less strict than path)
        if matched_idx.is_none() {
            if let Some(idxs) = name_to_windows.get(&app_exe) {
                // Pick the best window among all processes with this exe name
                matched_idx = Some(pick_best_idx(idxs, windows));
            }
        }

        // Priority 3 — title-prefix match (strict)
        if matched_idx.is_none() && !app_name_norm.is_empty() {
            'outer: for (i, w) in windows.iter().enumerate() {
                for title in &w.titles {
                    if title_matches_app(&normalize_text(title), &app_name_norm) {
                        matched_idx = Some(i);
                        break 'outer;
                    }
                }
            }
        }

        if let Some(idx) = matched_idx {
            let win = &windows[idx];
            matched_pids.insert(win.pid);

            // Use the longest title as display title
            let title = win
                .titles
                .iter()
                .max_by_key(|t| t.len())
                .cloned()
                .unwrap_or_else(|| app.name.clone());

            result.push(AppEntry {
                id: app.id.clone(),
                name: app.name.clone(),
                title,
                path: app.path.clone(),
                app_type: "app".to_string(),
                source: app.source.clone(),
                is_running: true,
                pid: win.pid,
                cloaked: win.cloaked,
                is_visible: win.is_visible,
                is_on_current_desktop: win.is_on_current_desktop,
                desktop_id: win.desktop_id.clone(),
                icon: app.icon.clone(),
            });
        } else {
            result.push(AppEntry {
                id: app.id.clone(),
                name: app.name.clone(),
                title: app.name.clone(),
                path: app.path.clone(),
                app_type: "app".to_string(),
                source: app.source.clone(),
                is_running: false,
                pid: 0,
                cloaked: 0,
                is_visible: false,
                is_on_current_desktop: false,
                desktop_id: None,
                icon: app.icon.clone(),
            });
        }
    }

    // Orphan discovery — window PIDs not matched to any installed app
    for w in windows {
        if !matched_pids.contains(&w.pid) {
            let display_name = w
                .titles
                .iter()
                .max_by_key(|t| t.len())
                .cloned()
                .unwrap_or_else(|| w.exe_name.clone());

            result.push(AppEntry {
                id: format!("app-{}", w.pid),
                name: display_name.clone(),
                title: display_name,
                path: w.path.clone(),
                app_type: "app".to_string(),
                source: "running".to_string(),
                is_running: true,
                pid: w.pid,
                cloaked: w.cloaked,
                is_visible: w.is_visible,
                is_on_current_desktop: w.is_on_current_desktop,
                desktop_id: w.desktop_id.clone(),
                icon: None,
            });
        }
    }

    let running_count = result.iter().filter(|a| a.is_running).count();
    let orphan_count = result.iter().filter(|a| a.source == "running").count();
    eprintln!(
        "[AppMatcher] scanner: {} installed, {} windows -> {} total ({} running, {} orphans)",
        installed.len(),
        windows.len(),
        result.len(),
        running_count,
        orphan_count
    );

    match serde_json::to_string(&result) {
        Ok(json) => println!("{}", json),
        Err(e) => {
            eprintln!("[AppMatcher] Serialization error: {}", e);
            println!("[]");
        }
    }
}
