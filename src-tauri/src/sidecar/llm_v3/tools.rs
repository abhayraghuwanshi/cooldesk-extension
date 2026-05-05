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
