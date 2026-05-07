use std::collections::{HashMap, HashSet};
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Clone)]
pub struct ScannerOutput {
    pub installed: Vec<InstalledApp>,
    pub windows: Vec<WindowEntry>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
    pub path: String,
    pub source: String,
    pub category: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct WindowTitle {
    pub hwnd: i64,
    pub text: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct WindowEntry {
    pub pid: u32,
    #[serde(rename = "exeName")]
    pub exe_name: String,
    pub path: String,
    pub titles: Vec<WindowTitle>,
    #[serde(rename = "isVisible")]
    pub is_visible: bool,
    pub cloaked: i32,
    #[serde(rename = "isOnCurrentDesktop")]
    pub is_on_current_desktop: bool,
    #[serde(rename = "desktopId")]
    pub desktop_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AppEntry {
    pub id: String,
    pub name: String,
    pub title: String,
    pub titles: Vec<String>,
    pub path: String,
    #[serde(rename = "type")]
    pub app_type: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(rename = "isRunning")]
    pub is_running: bool,
    pub pid: u32,
    pub hwnd: i64,
    pub cloaked: i32,
    #[serde(rename = "isVisible")]
    pub is_visible: bool,
    #[serde(rename = "isOnCurrentDesktop")]
    pub is_on_current_desktop: bool,
    #[serde(rename = "desktopId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

fn normalize_path(p: &str) -> String {
    p.to_lowercase().replace('\\', "/")
}

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

fn window_score(w: &WindowEntry) -> u32 {
    match (w.is_visible, w.cloaked) {
        (true, 0) => 0,
        (true, _) => 1,
        (false, 0) => 2,
        _ => 3,
    }
}

fn pick_best_idx(idxs: &[usize], windows: &[WindowEntry]) -> usize {
    *idxs.iter().min_by_key(|&&i| window_score(&windows[i])).unwrap()
}

fn contains_word(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let mut start = 0;
    while let Some(pos) = haystack[start..].find(needle) {
        let abs = start + pos;
        let before_ok = abs == 0 || !haystack.as_bytes()[abs - 1].is_ascii_alphanumeric();
        let after_ok = abs + needle.len() >= haystack.len()
            || !haystack.as_bytes()[abs + needle.len()].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        start = abs + 1;
        if start >= haystack.len() {
            break;
        }
    }
    false
}

fn meaningful_titles<'a>(
    titles: &'a [WindowTitle],
    exe_name: &str,
    app_name: &str,
) -> Vec<&'a WindowTitle> {
    let exe_lower = exe_name.to_lowercase();
    let app_lower = app_name.to_lowercase();
    let filtered: Vec<&WindowTitle> = titles
        .iter()
        .filter(|wt| {
            let t = wt.text.to_lowercase();
            contains_word(&t, &exe_lower) || contains_word(&t, &app_lower)
        })
        .collect();
    if filtered.is_empty() {
        titles.iter().max_by_key(|wt| wt.text.len()).into_iter().collect()
    } else {
        filtered
    }
}

fn title_matches_app(norm_title: &str, norm_app_name: &str) -> bool {
    if !norm_title.starts_with(norm_app_name) {
        return false;
    }
    let rest = &norm_title[norm_app_name.len()..];
    if let Some(next_char) = rest.chars().next() {
        if next_char.is_alphanumeric() {
            return false;
        }
    }
    true
}

pub fn match_apps(scanner_data: ScannerOutput) -> Vec<AppEntry> {
    let installed = &scanner_data.installed;
    let windows = &scanner_data.windows;

    let mut path_to_windows: HashMap<String, Vec<usize>> = HashMap::new();
    let mut name_to_windows: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, w) in windows.iter().enumerate() {
        path_to_windows.entry(normalize_path(&w.path)).or_default().push(i);
        name_to_windows.entry(w.exe_name.to_lowercase()).or_default().push(i);
    }

    let mut matched_pids: HashSet<u32> = HashSet::new();
    let mut claimed_win_indices: HashSet<usize> = HashSet::new();
    let mut result: Vec<AppEntry> = Vec::new();

    for app in installed {
        let app_path_norm = normalize_path(&app.path);
        let app_exe = exe_basename(&app.path);
        let app_name_norm = normalize_text(&app.name);

        let mut matched_idx: Option<usize> = None;

        if let Some(idxs) = path_to_windows.get(&app_path_norm) {
            matched_idx = Some(pick_best_idx(idxs, windows));
        }

        if matched_idx.is_none() {
            if let Some(idxs) = name_to_windows.get(&app_exe) {
                matched_idx = Some(pick_best_idx(idxs, windows));
            }
        }

        if matched_idx.is_none() && !app_name_norm.is_empty() {
            'outer: for (i, w) in windows.iter().enumerate() {
                for wt in &w.titles {
                    if title_matches_app(&normalize_text(&wt.text), &app_name_norm) {
                        matched_idx = Some(i);
                        break 'outer;
                    }
                }
            }
        }

        if let Some(idx) = matched_idx {
            if claimed_win_indices.contains(&idx) {
                result.push(AppEntry {
                    id: app.id.clone(),
                    name: app.name.clone(),
                    title: app.name.clone(),
                    titles: vec![],
                    path: app.path.clone(),
                    app_type: "app".to_string(),
                    source: app.source.clone(),
                    category: app.category.clone(),
                    is_running: false,
                    pid: 0,
                    hwnd: 0,
                    cloaked: 0,
                    is_visible: false,
                    is_on_current_desktop: false,
                    desktop_id: None,
                    icon: app.icon.clone(),
                });
                continue;
            }
            claimed_win_indices.insert(idx);

            let win = &windows[idx];
            matched_pids.insert(win.pid);

            let all_title_texts: Vec<String> = win.titles.iter().map(|wt| wt.text.clone()).collect();
            let exe_name = exe_basename(&win.path);
            let show_titles = meaningful_titles(&win.titles, &exe_name, &app.name);

            if show_titles.len() <= 1 {
                let title = show_titles.first().map(|wt| wt.text.clone()).unwrap_or_else(|| app.name.clone());
                let hwnd = show_titles.first().map(|wt| wt.hwnd).unwrap_or(0);
                result.push(AppEntry {
                    id: app.id.clone(),
                    name: app.name.clone(),
                    title,
                    titles: all_title_texts,
                    path: app.path.clone(),
                    app_type: "app".to_string(),
                    source: app.source.clone(),
                    category: app.category.clone(),
                    is_running: true,
                    pid: win.pid,
                    hwnd,
                    cloaked: win.cloaked,
                    is_visible: win.is_visible,
                    is_on_current_desktop: win.is_on_current_desktop,
                    desktop_id: win.desktop_id.clone(),
                    icon: app.icon.clone(),
                });
            } else {
                for wt in show_titles {
                    result.push(AppEntry {
                        id: format!("{}-hwnd-{}", app.id, wt.hwnd),
                        name: app.name.clone(),
                        title: wt.text.clone(),
                        titles: all_title_texts.clone(),
                        path: app.path.clone(),
                        app_type: "app".to_string(),
                        source: app.source.clone(),
                        category: app.category.clone(),
                        is_running: true,
                        pid: win.pid,
                        hwnd: wt.hwnd,
                        cloaked: win.cloaked,
                        is_visible: win.is_visible,
                        is_on_current_desktop: win.is_on_current_desktop,
                        desktop_id: win.desktop_id.clone(),
                        icon: app.icon.clone(),
                    });
                }
            }
        } else {
            result.push(AppEntry {
                id: app.id.clone(),
                name: app.name.clone(),
                title: app.name.clone(),
                titles: vec![],
                path: app.path.clone(),
                app_type: "app".to_string(),
                source: app.source.clone(),
                category: app.category.clone(),
                is_running: false,
                pid: 0,
                hwnd: 0,
                cloaked: 0,
                is_visible: false,
                is_on_current_desktop: false,
                desktop_id: None,
                icon: app.icon.clone(),
            });
        }
    }

    for w in windows {
        if matched_pids.contains(&w.pid) {
            continue;
        }
        let all_title_texts: Vec<String> = w.titles.iter().map(|wt| wt.text.clone()).collect();
        let show_titles = meaningful_titles(&w.titles, &w.exe_name, &w.exe_name);

        if show_titles.len() <= 1 {
            let title = show_titles.first().map(|wt| wt.text.clone()).unwrap_or_else(|| w.exe_name.clone());
            let hwnd = show_titles.first().map(|wt| wt.hwnd).unwrap_or(0);
            result.push(AppEntry {
                id: format!("app-{}", w.pid),
                name: w.exe_name.clone(),
                title,
                titles: all_title_texts,
                path: w.path.clone(),
                app_type: "app".to_string(),
                source: "running".to_string(),
                category: None,
                is_running: true,
                pid: w.pid,
                hwnd,
                cloaked: w.cloaked,
                is_visible: w.is_visible,
                is_on_current_desktop: w.is_on_current_desktop,
                desktop_id: w.desktop_id.clone(),
                icon: None,
            });
        } else {
            for wt in show_titles {
                result.push(AppEntry {
                    id: format!("app-{}-hwnd-{}", w.pid, wt.hwnd),
                    name: w.exe_name.clone(),
                    title: wt.text.clone(),
                    titles: all_title_texts.clone(),
                    path: w.path.clone(),
                    app_type: "app".to_string(),
                    source: "running".to_string(),
                    category: None,
                    is_running: true,
                    pid: w.pid,
                    hwnd: wt.hwnd,
                    cloaked: w.cloaked,
                    is_visible: w.is_visible,
                    is_on_current_desktop: w.is_on_current_desktop,
                    desktop_id: w.desktop_id.clone(),
                    icon: None,
                });
            }
        }
    }

    log::info!(
        "[matcher] {} installed + {} windows → {} entries ({} running)",
        installed.len(),
        windows.len(),
        result.len(),
        result.iter().filter(|a| a.is_running).count()
    );

    result
}
