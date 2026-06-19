use crate::sidecar::data::SyncData;
use rig::{completion::ToolDefinition, tool::Tool};
use serde::Deserialize;
use std::fmt;
use std::sync::Arc;
use tokio::sync::RwLock;

// Shared error type for all v3 tools
#[derive(Debug)]
pub struct V3ToolError(pub String);

impl fmt::Display for V3ToolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for V3ToolError {}

// =============================================================================
// SEARCH WORKSPACES
// =============================================================================

#[derive(Clone)]
pub struct SearchWorkspaces {
    pub sync_data: Arc<RwLock<SyncData>>,
}

#[derive(Deserialize)]
pub struct SearchWorkspacesArgs {
    pub query: String,
}

impl Tool for SearchWorkspaces {
    const NAME: &'static str = "search_workspaces";
    type Error = V3ToolError;
    type Args = SearchWorkspacesArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Search through the user's saved workspaces by name or URL content."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query (workspace name or URL keyword). Pass empty string to list all."
                    }
                },
                "required": ["query"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let query = args.query.to_lowercase();
        let data = self.sync_data.read().await;

        let matches: Vec<_> = data
            .workspaces
            .iter()
            .filter(|w| {
                query.is_empty()
                    || w.name.to_lowercase().contains(&query)
                    || w.urls.iter().any(|u| {
                        u.url.to_lowercase().contains(&query)
                            || u.title
                                .as_ref()
                                .map(|t| t.to_lowercase().contains(&query))
                                .unwrap_or(false)
                    })
            })
            .take(8)
            .collect();

        if matches.is_empty() {
            return Ok(format!(
                "No workspaces found for '{}'. Total workspaces: {}.",
                args.query,
                data.workspaces.len()
            ));
        }

        let result: Vec<String> = matches
            .iter()
            .map(|w| {
                let urls: Vec<String> = w
                    .urls
                    .iter()
                    .take(4)
                    .map(|u| {
                        format!("  - {}", u.title.as_deref().unwrap_or(&u.url))
                    })
                    .collect();
                format!("Workspace: {} ({} URLs)\n{}", w.name, w.urls.len(), urls.join("\n"))
            })
            .collect();

        Ok(result.join("\n\n"))
    }
}

// =============================================================================
// GET RECENT ACTIVITY
// =============================================================================

#[derive(Clone)]
pub struct GetRecentActivity {
    pub sync_data: Arc<RwLock<SyncData>>,
}

#[derive(Deserialize)]
pub struct GetRecentActivityArgs {
    #[serde(default = "default_activity_limit")]
    pub limit: usize,
}

fn default_activity_limit() -> usize {
    15
}

impl Tool for GetRecentActivity {
    const NAME: &'static str = "get_recent_activity";
    type Error = V3ToolError;
    type Args = GetRecentActivityArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Get the user's recent browsing activity to understand what they've been working on.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max number of activity items to return (default 15)"
                    }
                }
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let data = self.sync_data.read().await;

        let items: Vec<String> = data
            .activity
            .iter()
            .rev()
            .take(args.limit)
            .filter_map(|a| {
                let url = a.url.as_ref()?;
                if !url.starts_with("http") || url.contains("chrome-extension://") {
                    return None;
                }
                let title = a.title.as_deref().unwrap_or("Unknown");
                Some(format!("- {} ({})", title, url))
            })
            .collect();

        if items.is_empty() {
            return Ok("No recent browsing activity found.".to_string());
        }

        Ok(format!("Recent activity ({} items):\n{}", items.len(), items.join("\n")))
    }
}

// =============================================================================
// SUGGEST WORKSPACES
// =============================================================================

#[derive(Clone)]
pub struct SuggestWorkspaces {
    pub sync_data: Arc<RwLock<SyncData>>,
}

#[derive(Deserialize)]
pub struct SuggestWorkspacesArgs {}

impl Tool for SuggestWorkspaces {
    const NAME: &'static str = "suggest_workspaces";
    type Error = V3ToolError;
    type Args = SuggestWorkspacesArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Analyze the user's browsing activity and suggest new workspace organization ideas.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn call(&self, _args: Self::Args) -> Result<Self::Output, Self::Error> {
        let data = self.sync_data.read().await;

        let existing: Vec<&str> = data.workspaces.iter().map(|w| w.name.as_str()).collect();

        let recent_urls: Vec<String> = data
            .activity
            .iter()
            .rev()
            .take(50)
            .filter_map(|a| {
                let url = a.url.as_ref()?;
                if !url.starts_with("http") || url.contains("chrome-extension://") {
                    return None;
                }
                let title = a.title.as_deref().unwrap_or("Untitled");
                Some(format!("- {} ({})", title, url))
            })
            .collect();

        if recent_urls.is_empty() {
            return Ok("Not enough activity data to suggest workspaces.".to_string());
        }

        Ok(format!(
            "Existing workspaces: {}\n\nRecent browsing (to base suggestions on):\n{}",
            if existing.is_empty() {
                "none".to_string()
            } else {
                existing.join(", ")
            },
            recent_urls.join("\n")
        ))
    }
}

// =============================================================================
// GET PINNED ITEMS
// =============================================================================

#[derive(Clone)]
pub struct GetPinnedItems {
    pub sync_data: Arc<RwLock<SyncData>>,
}

#[derive(Deserialize)]
pub struct GetPinnedItemsArgs {}

impl Tool for GetPinnedItems {
    const NAME: &'static str = "get_pinned_items";
    type Error = V3ToolError;
    type Args = GetPinnedItemsArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Get the user's pinned/bookmarked items.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn call(&self, _args: Self::Args) -> Result<Self::Output, Self::Error> {
        let data = self.sync_data.read().await;

        if data.pins.is_empty() {
            return Ok("No pinned items found.".to_string());
        }

        let items: Vec<String> = data
            .pins
            .iter()
            .take(10)
            .map(|p| format!("- {}", p.title.as_deref().unwrap_or(&p.url)))
            .collect();

        Ok(format!("Pinned items ({} total):\n{}", data.pins.len(), items.join("\n")))
    }
}

// =============================================================================
// SEARCH TABS  (currently-open browser tabs across the user's devices)
// =============================================================================

#[derive(Clone)]
pub struct SearchTabs {
    pub sync_data: Arc<RwLock<SyncData>>,
}

#[derive(Deserialize)]
pub struct SearchTabsArgs {
    #[serde(default)]
    pub query: String,
}

impl Tool for SearchTabs {
    const NAME: &'static str = "search_tabs";
    type Error = V3ToolError;
    type Args = SearchTabsArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Search the user's CURRENTLY OPEN browser tabs by title or URL keyword. \
                Pass an empty string to list all open tabs. Returns full URLs you can put into a workspace."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Keyword to match in tab title or URL. Empty string lists all open tabs."
                    }
                }
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let q = args.query.to_lowercase();
        let data = self.sync_data.read().await;

        let items: Vec<String> = data
            .tabs
            .iter()
            .filter(|t| t.url.starts_with("http") && !t.url.contains("chrome-extension://"))
            .filter(|t| {
                q.is_empty()
                    || t.title.to_lowercase().contains(&q)
                    || t.url.to_lowercase().contains(&q)
            })
            .take(40)
            .map(|t| {
                let title = if t.title.is_empty() { t.url.as_str() } else { t.title.as_str() };
                format!("- {} | {}", title, t.url)
            })
            .collect();

        if items.is_empty() {
            return Ok(format!(
                "No open tabs match '{}'. Total open tabs: {}.",
                args.query,
                data.tabs.len()
            ));
        }

        Ok(format!("Open tabs ({} shown):\n{}", items.len(), items.join("\n")))
    }
}

// =============================================================================
// SEARCH HISTORY  (recent browsing activity, filtered by query)
// =============================================================================

#[derive(Clone)]
pub struct SearchHistory {
    pub sync_data: Arc<RwLock<SyncData>>,
}

#[derive(Deserialize)]
pub struct SearchHistoryArgs {
    #[serde(default)]
    pub query: String,
    #[serde(default = "default_history_limit")]
    pub limit: usize,
}

fn default_history_limit() -> usize {
    25
}

impl Tool for SearchHistory {
    const NAME: &'static str = "search_history";
    type Error = V3ToolError;
    type Args = SearchHistoryArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Search the user's recent browsing history by keyword (matches title or URL). \
                Use this to find sites they've visited that aren't currently open. Returns full URLs."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Keyword to match in history title or URL. Empty string returns the most recent items."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max items to return (default 25)."
                    }
                }
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let q = args.query.to_lowercase();
        let data = self.sync_data.read().await;

        let items: Vec<String> = data
            .activity
            .iter()
            .rev()
            .filter_map(|a| {
                let url = a.url.as_ref()?;
                if !url.starts_with("http") || url.contains("chrome-extension://") {
                    return None;
                }
                let title = a.title.as_deref().unwrap_or("Untitled");
                if q.is_empty()
                    || title.to_lowercase().contains(&q)
                    || url.to_lowercase().contains(&q)
                {
                    Some(format!("- {} | {}", title, url))
                } else {
                    None
                }
            })
            .take(args.limit.clamp(1, 60))
            .collect();

        if items.is_empty() {
            return Ok(format!("No history matches '{}'.", args.query));
        }

        Ok(format!("History matches ({} shown):\n{}", items.len(), items.join("\n")))
    }
}

// =============================================================================
// SEARCH APPS  (running desktop apps — editors, tools; browsers excluded)
// =============================================================================

#[derive(Clone)]
pub struct SearchApps;

#[derive(Deserialize)]
pub struct SearchAppsArgs {
    #[serde(default)]
    pub query: String,
}

impl Tool for SearchApps {
    const NAME: &'static str = "search_apps";
    type Error = V3ToolError;
    type Args = SearchAppsArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Search the user's RUNNING desktop apps (editors, IDEs, tools — browsers excluded) \
                by name. Empty string lists all running apps. The window title often reveals the open \
                project/file, useful for grouping a coding workspace."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Keyword to match in app name or window title. Empty string lists all running apps."
                    }
                }
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let q = args.query.to_lowercase();
        let apps = crate::system::get_visible_apps_info().await;

        let mut seen = std::collections::HashSet::new();
        let items: Vec<String> = apps
            .iter()
            .filter(|a| !crate::system::is_browser(&a.name))
            .filter(|a| {
                q.is_empty()
                    || a.name.to_lowercase().contains(&q)
                    || a.title.to_lowercase().contains(&q)
            })
            .filter_map(|a| {
                let name = a.name.trim_end_matches(".exe").to_string();
                if !seen.insert(name.to_lowercase()) {
                    return None;
                }
                let title: String = a.title.chars().take(60).collect();
                if title.is_empty() {
                    Some(format!("- {}", name))
                } else {
                    Some(format!("- {} (window: {})", name, title))
                }
            })
            .take(30)
            .collect();

        if items.is_empty() {
            return Ok(format!("No running apps match '{}'.", args.query));
        }

        Ok(format!("Running apps ({} shown):\n{}", items.len(), items.join("\n")))
    }
}

// =============================================================================
// GET OPEN PROJECTS  (local folders/projects open in code editors)
// =============================================================================

#[derive(Clone)]
pub struct GetOpenProjects;

#[derive(Deserialize)]
pub struct GetOpenProjectsArgs {}

/// Map an editor's process name to the editor key the frontend understands
/// (used as the `editor` field of a folder, e.g. "vscode" / "cursor").
fn editor_key_for(app_name: &str) -> &'static str {
    let n = app_name.to_lowercase();
    if n.contains("cursor") { "cursor" }
    else if n.contains("windsurf") { "windsurf" }
    else if n.contains("webstorm") { "webstorm" }
    else if n.contains("pycharm") { "pycharm" }
    else if n.contains("goland") { "goland" }
    else if n.contains("intellij") || n.contains("idea") { "idea" }
    else { "vscode" } // "code" / "visual studio code" and any other editor
}

const EDITOR_HINTS: &[&str] = &[
    "code", "cursor", "windsurf", "intellij", "idea", "webstorm", "pycharm",
    "goland", "phpstorm", "rider", "clion", "rubymine", "sublime", "zed",
];

const TERMINAL_HINTS: &[&str] = &[
    "mintty", "windowsterminal", "wt", "cmd", "powershell", "pwsh", "conhost",
    "bash", "alacritty", "wezterm", "kitty",
];

/// Parse the project/root folder out of a code-editor window title. Editors use
/// the template "file - root - AppName" (or " — " / " – " separators), so the
/// folder is the second-to-last segment. A 2-segment "file - AppName" title means
/// no folder is open. Also handles the "root (Workspace) - AppName" form.
fn project_from_editor_title(title: &str) -> Option<String> {
    // Normalise the three separators VS Code / JetBrains use to a single one.
    let norm = title.replace(" — ", " \u{1} ").replace(" – ", " \u{1} ").replace(" - ", " \u{1} ");
    let parts: Vec<&str> = norm.split(" \u{1} ").map(|s| s.trim()).filter(|s| !s.is_empty()).collect();

    let pick = if let Some(ws) = parts.iter().find(|p| p.ends_with("(Workspace)")) {
        ws.trim_end_matches("(Workspace)").trim()
    } else if parts.len() >= 3 {
        parts[parts.len() - 2]
    } else {
        return None;
    };

    let clean = pick.trim_start_matches(['●', '•', '*', ' ']).trim();
    if clean.is_empty() || clean.len() >= 60 { None } else { Some(clean.to_string()) }
}

/// Extract a filesystem path embedded in a window title (terminal CWD, Explorer).
/// Handles MSYS/Git-Bash "/c/Users/..." and Windows "C:\Users\..." forms.
fn path_from_title(title: &str) -> Option<String> {
    // MSYS / Git-Bash: /c/Users/... or /d/projects/...
    let bytes = title.as_bytes();
    for i in 0..bytes.len().saturating_sub(3) {
        if bytes[i] == b'/' && bytes[i + 1].is_ascii_alphabetic() && bytes[i + 2] == b'/' {
            let rest = &title[i..];
            return Some(rest.split_whitespace().next().unwrap_or(rest).to_string());
        }
        // Windows drive: C:\... or C:/...
        if bytes[i].is_ascii_alphabetic() && bytes[i + 1] == b':' && (bytes[i + 2] == b'\\' || bytes[i + 2] == b'/') {
            let rest = &title[i..];
            return Some(rest.split_whitespace().next().unwrap_or(rest).to_string());
        }
    }
    None
}

/// Last meaningful path segment, e.g. "/c/Users/raghu/projects/extension" -> "extension".
fn folder_name_from_path(path: &str) -> String {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .find(|s| !s.is_empty())
        .unwrap_or(path)
        .to_string()
}

/// Convert an MSYS/Git-Bash path ("/c/Users/x") to a Windows path ("C:\Users\x").
fn msys_to_windows(p: &str) -> String {
    let b = p.as_bytes();
    if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b'/' {
        let drive = (b[1] as char).to_ascii_uppercase();
        return format!("{}:\\{}", drive, p[3..].replace('/', "\\"));
    }
    p.replace('/', "\\")
}

/// Walk up from a directory looking for a project root marker, so a terminal sitting
/// in ".../extension/scripts" resolves to the repo root ".../extension".
fn find_project_root(start: &std::path::Path) -> Option<std::path::PathBuf> {
    const MARKERS: &[&str] = &[".git", "Cargo.toml", "package.json", "go.mod", "pyproject.toml", ".hg"];
    let mut cur = Some(start);
    let mut depth = 0;
    while let Some(dir) = cur {
        if MARKERS.iter().any(|m| dir.join(m).exists()) {
            return Some(dir.to_path_buf());
        }
        depth += 1;
        if depth > 8 { break; }
        cur = dir.parent();
    }
    None
}

/// Given a path pulled from a window title, return (folder name, display path),
/// preferring the enclosing project/repo root when one is found on disk.
fn describe_folder(raw_path: &str) -> (String, String) {
    let win = msys_to_windows(raw_path);
    if let Some(root) = find_project_root(std::path::Path::new(&win)) {
        let name = root
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| folder_name_from_path(raw_path));
        return (name, root.to_string_lossy().to_string());
    }
    (folder_name_from_path(raw_path), win)
}

impl Tool for GetOpenProjects {
    const NAME: &'static str = "get_open_projects";
    type Error = V3ToolError;
    type Args = GetOpenProjectsArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List the LOCAL FOLDERS / projects the user currently has open — parsed from \
                code-editor window titles (VS Code, Cursor, IntelliJ…), terminal working directories, \
                and File Explorer. Use these for the `folders` field of a workspace; pass the exact \
                name, the editor key, and the path when one is shown."
                .to_string(),
            parameters: serde_json::json!({ "type": "object", "properties": {} }),
        }
    }

    async fn call(&self, _args: Self::Args) -> Result<Self::Output, Self::Error> {
        let apps = crate::system::get_visible_apps_info().await;

        let mut seen = std::collections::HashSet::new();
        let mut items: Vec<String> = Vec::new();

        for a in &apps {
            let name_lower = a.name.to_lowercase();
            let is_editor = EDITOR_HINTS.iter().any(|h| name_lower.contains(h));
            let is_terminal = TERMINAL_HINTS.iter().any(|h| name_lower.contains(h));
            let is_explorer = name_lower.contains("explorer");

            // 1) Editor → project name (+ path if the title also carries one).
            if is_editor {
                if let Some(project) = project_from_editor_title(&a.title) {
                    if seen.insert(project.to_lowercase()) {
                        let path = path_from_title(&a.title);
                        match path {
                            Some(p) => items.push(format!(
                                "- project \"{}\" (editor: {}, path: {})",
                                project, editor_key_for(&a.name), p
                            )),
                            None => items.push(format!(
                                "- project \"{}\" (editor: {})",
                                project, editor_key_for(&a.name)
                            )),
                        }
                    }
                    continue;
                }
            }

            // 2) Terminal / Explorer → real folder path, resolved to its repo root.
            if is_terminal || is_explorer {
                if let Some(path) = path_from_title(&a.title) {
                    let (folder, display) = describe_folder(&path);
                    if folder.len() > 1 && seen.insert(folder.to_lowercase()) {
                        let src = if is_terminal { "terminal" } else { "explorer" };
                        items.push(format!(
                            "- folder \"{}\" (path: {}, open in: {})",
                            folder, display, src
                        ));
                    }
                }
            }
        }

        items.truncate(20);
        if items.is_empty() {
            return Ok("No local projects or folders are currently open (no editor/terminal exposed a path)."
                .to_string());
        }

        Ok(format!("Open local projects/folders ({}):\n{}", items.len(), items.join("\n")))
    }
}
