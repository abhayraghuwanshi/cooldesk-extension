//! Tool System for LLM v2
//!
//! Implements tools that the agent can use to interact with user data
//! and perform actions.

use crate::sidecar::data::SyncData;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

// =============================================================================
// TOOL TRAIT
// =============================================================================

/// Definition of a tool for the LLM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// Name of the tool
    pub name: String,
    /// Description of what the tool does
    pub description: String,
    /// Parameters schema (JSON Schema format)
    pub parameters: Value,
}

/// Result of a tool execution
#[derive(Debug, Clone)]
pub struct ToolResult {
    /// Whether the tool succeeded
    pub success: bool,
    /// Result content (for success) or error message (for failure)
    pub content: String,
}

impl ToolResult {
    pub fn success(content: String) -> Self {
        Self {
            success: true,
            content,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            content: message,
        }
    }
}

/// Trait for implementing tools
#[async_trait]
pub trait Tool: Send + Sync {
    /// Get the tool's name
    fn name(&self) -> &str;

    /// Get the tool definition for the LLM
    fn definition(&self) -> ToolDefinition;

    /// Execute the tool with given arguments
    async fn execute(&self, arguments: Value) -> ToolResult;
}

// =============================================================================
// SEARCH WORKSPACES TOOL
// =============================================================================

/// Tool for searching user's workspaces
pub struct SearchWorkspacesTool {
    sync_data: Arc<RwLock<SyncData>>,
}

impl SearchWorkspacesTool {
    pub fn new(sync_data: Arc<RwLock<SyncData>>) -> Self {
        Self { sync_data }
    }
}

#[async_trait]
impl Tool for SearchWorkspacesTool {
    fn name(&self) -> &str {
        "search_workspaces"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "search_workspaces".to_string(),
            description: "Search through user's workspaces and their URLs. Use this to find workspaces by name or content.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query to find workspaces"
                    }
                },
                "required": ["query"]
            }),
        }
    }

    async fn execute(&self, arguments: Value) -> ToolResult {
        let query = arguments
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let query_lower = query.to_lowercase();

        let data = self.sync_data.read().await;

        let matching_workspaces: Vec<_> = data
            .workspaces
            .iter()
            .filter(|w| {
                w.name.to_lowercase().contains(&query_lower)
                    || w.urls.iter().any(|u| {
                        u.url.to_lowercase().contains(&query_lower)
                            || u.title
                                .as_ref()
                                .map(|t| t.to_lowercase().contains(&query_lower))
                                .unwrap_or(false)
                    })
            })
            .take(5)
            .collect();

        if matching_workspaces.is_empty() {
            return ToolResult::success(format!(
                "No workspaces found matching '{}'. User has {} total workspaces.",
                query,
                data.workspaces.len()
            ));
        }

        let result: Vec<String> = matching_workspaces
            .iter()
            .map(|w| {
                let urls: Vec<String> = w
                    .urls
                    .iter()
                    .take(3)
                    .map(|u| {
                        format!(
                            "  - {}",
                            u.title.as_deref().unwrap_or(&u.url)
                        )
                    })
                    .collect();
                format!(
                    "Workspace: {} ({} URLs)\n{}",
                    w.name,
                    w.urls.len(),
                    urls.join("\n")
                )
            })
            .collect();

        ToolResult::success(format!(
            "Found {} matching workspaces:\n\n{}",
            matching_workspaces.len(),
            result.join("\n\n")
        ))
    }
}

// =============================================================================
// SEARCH NOTES TOOL
// =============================================================================

/// Tool for searching user's notes
pub struct SearchNotesTool {
    sync_data: Arc<RwLock<SyncData>>,
}

impl SearchNotesTool {
    pub fn new(sync_data: Arc<RwLock<SyncData>>) -> Self {
        Self { sync_data }
    }
}

#[async_trait]
impl Tool for SearchNotesTool {
    fn name(&self) -> &str {
        "search_notes"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "search_notes".to_string(),
            description: "Search through user's notes. Use this to find notes by content or title.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query to find notes"
                    }
                },
                "required": ["query"]
            }),
        }
    }

    async fn execute(&self, arguments: Value) -> ToolResult {
        let query = arguments
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let query_lower = query.to_lowercase();

        let data = self.sync_data.read().await;

        let matching_notes: Vec<_> = data
            .notes
            .iter()
            .filter(|n| {
                n.title
                    .as_ref()
                    .map(|t| t.to_lowercase().contains(&query_lower))
                    .unwrap_or(false)
                    || n.content
                        .as_ref()
                        .map(|c| c.to_lowercase().contains(&query_lower))
                        .unwrap_or(false)
                    || n.text
                        .as_ref()
                        .map(|t| t.to_lowercase().contains(&query_lower))
                        .unwrap_or(false)
            })
            .take(5)
            .collect();

        if matching_notes.is_empty() {
            return ToolResult::success(format!(
                "No notes found matching '{}'. User has {} total notes.",
                query,
                data.notes.len()
            ));
        }

        let result: Vec<String> = matching_notes
            .iter()
            .map(|n| {
                let title = n.title.as_deref().unwrap_or("Untitled");
                let preview = n
                    .content
                    .as_ref()
                    .or(n.text.as_ref())
                    .map(|c| {
                        let preview: String = c.chars().take(100).collect();
                        if c.len() > 100 {
                            format!("{}...", preview)
                        } else {
                            preview
                        }
                    })
                    .unwrap_or_default();
                format!("Note: {}\n  {}", title, preview)
            })
            .collect();

        ToolResult::success(format!(
            "Found {} matching notes:\n\n{}",
            matching_notes.len(),
            result.join("\n\n")
        ))
    }
}

// =============================================================================
// GET RECENT ACTIVITY TOOL
// =============================================================================

/// Tool for getting recent browsing activity
pub struct GetRecentActivityTool {
    sync_data: Arc<RwLock<SyncData>>,
}

impl GetRecentActivityTool {
    pub fn new(sync_data: Arc<RwLock<SyncData>>) -> Self {
        Self { sync_data }
    }
}

#[async_trait]
impl Tool for GetRecentActivityTool {
    fn name(&self) -> &str {
        "get_recent_activity"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "get_recent_activity".to_string(),
            description: "Get the user's recent browsing activity. Use this to understand what the user has been doing recently.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "number",
                        "description": "Maximum number of activities to return (default: 10)"
                    }
                }
            }),
        }
    }

    async fn execute(&self, arguments: Value) -> ToolResult {
        let limit = arguments
            .get("limit")
            .and_then(|v| v.as_u64())
            .unwrap_or(10) as usize;

        let data = self.sync_data.read().await;

        let recent: Vec<_> = data.activity.iter().rev().take(limit).collect();

        if recent.is_empty() {
            return ToolResult::success("No recent activity found.".to_string());
        }

        let result: Vec<String> = recent
            .iter()
            .filter_map(|a| {
                let title = a.title.as_deref().unwrap_or("Unknown");
                let activity_type = a.activity_type.as_deref().unwrap_or("visit");
                Some(format!("- {} [{}]", title, activity_type))
            })
            .collect();

        ToolResult::success(format!(
            "Recent activity ({} items):\n{}",
            recent.len(),
            result.join("\n")
        ))
    }
}

// =============================================================================
// GET PINNED ITEMS TOOL
// =============================================================================

/// Tool for getting user's pinned items
pub struct GetPinnedItemsTool {
    sync_data: Arc<RwLock<SyncData>>,
}

impl GetPinnedItemsTool {
    pub fn new(sync_data: Arc<RwLock<SyncData>>) -> Self {
        Self { sync_data }
    }
}

#[async_trait]
impl Tool for GetPinnedItemsTool {
    fn name(&self) -> &str {
        "get_pinned_items"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "get_pinned_items".to_string(),
            description: "Get the user's pinned/bookmarked items. These are important URLs the user has saved.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn execute(&self, _arguments: Value) -> ToolResult {
        let data = self.sync_data.read().await;

        if data.pins.is_empty() {
            return ToolResult::success("No pinned items found.".to_string());
        }

        let result: Vec<String> = data
            .pins
            .iter()
            .take(10)
            .map(|p| {
                let title = p.title.as_deref().unwrap_or(&p.url);
                format!("- {}", title)
            })
            .collect();

        ToolResult::success(format!(
            "Pinned items ({} total):\n{}",
            data.pins.len(),
            result.join("\n")
        ))
    }
}

// =============================================================================
// WEB SEARCH TOOL
// =============================================================================

/// Search result from web search
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Tool for searching the web using DuckDuckGo
pub struct WebSearchTool {
    max_results: usize,
}

impl WebSearchTool {
    pub fn new(max_results: usize) -> Self {
        Self { max_results }
    }

    /// Perform DuckDuckGo search via HTML scraping
    async fn search_duckduckgo(&self, query: &str) -> Result<Vec<WebSearchResult>, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let url = format!(
            "https://html.duckduckgo.com/html/?q={}",
            urlencoding::encode(query)
        );

        log::debug!("[WebSearch] Fetching: {}", url);

        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                return Err("Rate limited by DuckDuckGo, please wait".to_string());
            }
            return Err(format!("HTTP error: {}", response.status()));
        }

        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        Ok(self.parse_html(&body))
    }

    /// Parse DuckDuckGo HTML to extract search results
    fn parse_html(&self, html: &str) -> Vec<WebSearchResult> {
        let mut results = Vec::new();
        let mut seen_urls = HashSet::new();

        // Strategy 1: Look for result links with uddg parameter (redirect URLs)
        for segment in html.split("uddg=") {
            if results.len() >= self.max_results {
                break;
            }

            if let Some(end) = segment.find(|c| c == '&' || c == '"' || c == '\'') {
                let encoded_url = &segment[..end];
                if let Ok(url) = urlencoding::decode(encoded_url) {
                    let url_str = url.to_string();
                    if url_str.starts_with("http")
                        && !url_str.contains("duckduckgo.com")
                        && !seen_urls.contains(&url_str)
                    {
                        seen_urls.insert(url_str.clone());
                        results.push(WebSearchResult {
                            title: Self::extract_domain(&url_str).unwrap_or_else(|| "Result".to_string()),
                            url: url_str,
                            snippet: "Search result from DuckDuckGo".to_string(),
                        });
                    }
                }
            }
        }

        // Strategy 2: Look for result__url class
        if results.len() < self.max_results {
            for segment in html.split("result__url") {
                if results.len() >= self.max_results {
                    break;
                }

                if let Some(href_start) = segment.find("href=\"") {
                    let after_href = &segment[href_start + 6..];
                    if let Some(href_end) = after_href.find('"') {
                        let href = &after_href[..href_end];
                        let url = if href.starts_with("//") {
                            format!("https:{}", href)
                        } else if href.starts_with("http") {
                            href.to_string()
                        } else {
                            continue;
                        };

                        if !url.contains("duckduckgo.com") && !seen_urls.contains(&url) {
                            seen_urls.insert(url.clone());
                            results.push(WebSearchResult {
                                title: Self::extract_domain(&url).unwrap_or_else(|| "Result".to_string()),
                                url,
                                snippet: "Search result".to_string(),
                            });
                        }
                    }
                }
            }
        }

        // Strategy 3: Direct URL extraction
        if results.len() < self.max_results {
            for segment in html.split("https://") {
                if results.len() >= self.max_results {
                    break;
                }

                if let Some(end) = segment.find(|c: char| {
                    c == '"' || c == '\'' || c == '<' || c == '>' || c == ' ' || c == ')'
                }) {
                    let domain_path = &segment[..end];
                    if !domain_path.starts_with("duckduckgo")
                        && !domain_path.contains("cdn.")
                        && !domain_path.contains(".js")
                        && !domain_path.contains(".css")
                        && !domain_path.contains(".png")
                        && !domain_path.contains(".ico")
                        && domain_path.contains('.')
                        && domain_path.len() > 5
                    {
                        let url = format!("https://{}", domain_path);
                        if !seen_urls.contains(&url) {
                            seen_urls.insert(url.clone());
                            results.push(WebSearchResult {
                                title: Self::extract_domain(&url).unwrap_or_else(|| "Result".to_string()),
                                url,
                                snippet: "Search result".to_string(),
                            });
                        }
                    }
                }
            }
        }

        results.into_iter().take(self.max_results).collect()
    }

    /// Extract domain from URL
    fn extract_domain(url: &str) -> Option<String> {
        url.split("//")
            .nth(1)?
            .split('/')
            .next()
            .map(|s| s.to_string())
    }
}

#[async_trait]
impl Tool for WebSearchTool {
    fn name(&self) -> &str {
        "web_search"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "web_search".to_string(),
            description: "Search the web using DuckDuckGo. Use this to find current information about any topic from the internet.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query to find information about"
                    }
                },
                "required": ["query"]
            }),
        }
    }

    async fn execute(&self, arguments: Value) -> ToolResult {
        let query = arguments
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if query.is_empty() {
            return ToolResult::error("Search query is required".to_string());
        }

        log::info!("[WebSearch] Searching for: {}", query);

        // Add small delay to avoid rate limiting
        tokio::time::sleep(Duration::from_millis(500)).await;

        match self.search_duckduckgo(query).await {
            Ok(results) => {
                if results.is_empty() {
                    ToolResult::success(format!("No results found for: {}", query))
                } else {
                    let formatted: Vec<String> = results
                        .iter()
                        .enumerate()
                        .map(|(i, r)| {
                            format!(
                                "{}. {}\n   URL: {}\n   {}",
                                i + 1,
                                r.title,
                                r.url,
                                r.snippet
                            )
                        })
                        .collect();

                    ToolResult::success(format!(
                        "Web search results for '{}':\n\n{}",
                        query,
                        formatted.join("\n\n")
                    ))
                }
            }
            Err(e) => ToolResult::error(format!("Web search failed: {}", e)),
        }
    }
}

// =============================================================================
// TOOL REGISTRY
// =============================================================================

/// Registry of all available tools
pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
}

impl ToolRegistry {
    /// Create a new empty registry
    pub fn new() -> Self {
        Self { tools: Vec::new() }
    }

    /// Create a registry with default tools
    pub fn with_defaults(sync_data: Arc<RwLock<SyncData>>) -> Self {
        let mut registry = Self::new();
        registry.register(Box::new(SearchWorkspacesTool::new(sync_data.clone())));
        registry.register(Box::new(SearchNotesTool::new(sync_data.clone())));
        registry.register(Box::new(GetRecentActivityTool::new(sync_data.clone())));
        registry.register(Box::new(GetPinnedItemsTool::new(sync_data)));
        registry.register(Box::new(WebSearchTool::new(5))); // Web search with max 5 results
        registry
    }

    /// Register a tool
    pub fn register(&mut self, tool: Box<dyn Tool>) {
        self.tools.push(tool);
    }

    /// Get all tool definitions
    pub fn get_definitions(&self) -> Vec<ToolDefinition> {
        self.tools.iter().map(|t| t.definition()).collect()
    }

    /// Get a tool by name
    pub fn get_tool(&self, name: &str) -> Option<&dyn Tool> {
        self.tools.iter().find(|t| t.name() == name).map(|t| t.as_ref())
    }

    /// Execute a tool by name
    pub async fn execute(&self, name: &str, arguments: Value) -> Option<ToolResult> {
        if let Some(tool) = self.get_tool(name) {
            Some(tool.execute(arguments).await)
        } else {
            None
        }
    }

    /// Format tool definitions for the system prompt
    pub fn format_for_prompt(&self) -> String {
        let definitions = self.get_definitions();

        if definitions.is_empty() {
            return String::new();
        }

        let tool_descriptions: Vec<String> = definitions
            .iter()
            .map(|t| {
                format!(
                    "- {}: {}",
                    t.name, t.description
                )
            })
            .collect();

        format!(
            r#"
You have access to the following tools:
{}

To use a tool, respond with:
<tool>tool_name</tool><args>{{"param": "value"}}</args>

After receiving tool results, incorporate them into your response.
"#,
            tool_descriptions.join("\n")
        )
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_definition() {
        let sync_data = Arc::new(RwLock::new(SyncData::default()));
        let tool = SearchWorkspacesTool::new(sync_data);

        let def = tool.definition();
        assert_eq!(def.name, "search_workspaces");
        assert!(!def.description.is_empty());
    }

    #[test]
    fn test_tool_registry() {
        let sync_data = Arc::new(RwLock::new(SyncData::default()));
        let registry = ToolRegistry::with_defaults(sync_data);

        let definitions = registry.get_definitions();
        assert!(definitions.len() >= 4);

        assert!(registry.get_tool("search_workspaces").is_some());
        assert!(registry.get_tool("nonexistent").is_none());
    }

    #[test]
    fn test_format_for_prompt() {
        let sync_data = Arc::new(RwLock::new(SyncData::default()));
        let registry = ToolRegistry::with_defaults(sync_data);

        let prompt = registry.format_for_prompt();
        assert!(prompt.contains("search_workspaces"));
        assert!(prompt.contains("<tool>"));
    }
}
