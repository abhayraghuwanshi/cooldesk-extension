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
    #[allow(dead_code)]
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

/// Helper to parse tool arguments into a struct
pub fn parse_args<T: for<'de> serde::Deserialize<'de>>(tool_name: &str, args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("Invalid arguments for {}: {}", tool_name, e))
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
        #[derive(Deserialize)]
        struct Args { query: String }
        let args = match parse_args::<Args>(self.name(), arguments) {
            Ok(a) => a,
            Err(e) => return ToolResult::error(e),
        };

        let query_lower = args.query.to_lowercase();

        let data = self.sync_data.read().await;

        log::info!("[Tool:search_workspaces] Query: '{}', Total workspaces: {}", args.query, data.workspaces.len());

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
            .take(6)
            .collect();

        if matching_workspaces.is_empty() {
            return ToolResult::success(format!(
                "No workspaces found matching '{}'. User has {} total workspaces.",
                args.query,
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
        #[derive(Deserialize)]
        struct Args { query: String }
        let args = match parse_args::<Args>(self.name(), arguments) {
            Ok(a) => a,
            Err(e) => return ToolResult::error(e),
        };

        let query_lower = args.query.to_lowercase();

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
                args.query,
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
                    },
                    "query": {
                        "type": "string",
                        "description": "Optional search query to filter recent activity"
                    }
                }
            }),
        }
    }

    async fn execute(&self, arguments: Value) -> ToolResult {
        #[derive(Deserialize)]
        struct Args {
            #[serde(default = "default_limit")]
            limit: usize,
            #[serde(default)]
            query: String,
        }
        fn default_limit() -> usize { 10 }

        let args = match parse_args::<Args>(self.name(), arguments) {
            Ok(a) => a,
            Err(e) => return ToolResult::error(e),
        };

        let query_lower = args.query.to_lowercase();
        let data = self.sync_data.read().await;

        log::info!("[Tool:get_recent_activity] Limit: {}, Total activities: {}", args.limit, data.activity.len());

        let recent: Vec<_> = data.activity.iter().rev()
            .filter(|a| {
                if query_lower.is_empty() { return true; }
                let title_match = a.title.as_ref().map(|t| t.to_lowercase().contains(&query_lower)).unwrap_or(false);
                let url_match = a.url.as_ref().map(|u| u.to_lowercase().contains(&query_lower)).unwrap_or(false);
                title_match || url_match
            })
            .take(args.limit)
            .collect();

        if recent.is_empty() {
            return ToolResult::success(format!("No recent activity found{}.", if query_lower.is_empty() { "" } else { " matching that query" }));
        }

        let result: Vec<String> = recent
            .iter()
            .filter_map(|a| {
                let title = a.title.as_deref().unwrap_or("Unknown");
                let activity_type = a.activity_type.as_deref().unwrap_or("visit");
                let url = a.url.as_deref().unwrap_or("Unknown");
                Some(format!("- {} [{}] (URL: {})", title, activity_type, url))
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

        // DuckDuckGo HTML Structure:
        // Titles are in <a class="result__a" href="...">The Title</a>
        // Snippets are in <div class="result__snippet">The snippet text...</div>
        // Redirect URLs are in the href, often starting with //duckduckgo.com/l/?uddg=...

        let segments: Vec<&str> = html.split("class=\"result__a\"").collect();
        for segment in segments.iter().skip(1) {
             if results.len() >= self.max_results { break; }

             // 1. Extract Href
             let href = if let Some(h_start) = segment.find("href=\"") {
                 let after_h = &segment[h_start + 6..];
                 if let Some(h_end) = after_h.find('"') {
                     let mut raw_url = after_h[..h_end].to_string();
                     // If it's a redirect link, extract the target
                     if raw_url.contains("uddg=") {
                         if let Some(pos) = raw_url.find("uddg=") {
                             let encoded = &raw_url[pos + 5..].split('&').next().unwrap_or("");
                             if let Ok(decoded) = urlencoding::decode(encoded) {
                                 raw_url = decoded.to_string();
                             }
                         }
                     }
                     // Clean up protocol-relative URLs
                     if raw_url.starts_with("//") {
                         raw_url = format!("https:{}", raw_url);
                     }
                     raw_url
                 } else { continue; }
             } else { continue; };

             if href.contains("duckduckgo.com") || seen_urls.contains(&href) || !href.starts_with("http") { continue; }

             // 2. Extract Title
             let title = if let Some(t_start) = segment.find('>') {
                 let after_t = &segment[t_start + 1..];
                 if let Some(t_end) = after_t.find("</a>") {
                     after_t[..t_end].replace("&amp;", "&").replace("&quot;", "\"").replace("&#x27;", "'")
                 } else { "Result".to_string() }
             } else { "Result".to_string() };

             // 3. Extract Snippet (look ahead in next few characters of HTML)
             // This is harder since it's outside the split but we can try to find the next result__snippet
             let snippet = if let Some(s_start) = segment.find("result__snippet") {
                  let after_s = &segment[s_start..];
                  if let Some(c_start) = after_s.find('>') {
                      let after_c = &after_s[c_start + 1..];
                      if let Some(c_end) = after_c.find("</div>") {
                          after_c[..c_end].replace("&amp;", "&").replace("&quot;", "\"").replace("&#x27;", "'")
                      } else { "No snippet available".to_string() }
                  } else { "No snippet available".to_string() }
             } else { "Search result".to_string() };

             seen_urls.insert(href.clone());
             results.push(WebSearchResult {
                 title,
                 url: href,
                 snippet,
             });
        }

        // If no results via specific classes, fallback to older uddg strategy
        if results.is_empty() {
            log::info!("[WebSearch] Class-based parsing failed, falling back to uddg split");
            for segment in html.split("uddg=") {
                if results.len() >= self.max_results { break; }
                if let Some(end) = segment.find(|c| c == '&' || c == '"' || c == '\'') {
                    let encoded_url = &segment[..end];
                    if let Ok(url) = urlencoding::decode(encoded_url) {
                        let url_str = url.to_string();
                        if url_str.starts_with("http") && !url_str.contains("duckduckgo.com") && !seen_urls.contains(&url_str) {
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
        #[derive(Deserialize)]
        struct Args { query: String }
        let args = match parse_args::<Args>(self.name(), arguments) {
            Ok(a) => a,
            Err(e) => return ToolResult::error(e),
        };

        if args.query.is_empty() {
             return ToolResult::error("Search query is required".to_string());
        }

        log::info!("[WebSearch] Searching for: {}", args.query);

        // Add small delay to avoid rate limiting
        tokio::time::sleep(Duration::from_millis(500)).await;

        match self.search_duckduckgo(&args.query).await {
            Ok(results) => {
                if results.is_empty() {
                    ToolResult::success(format!("No results found for: {}", args.query))
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
                        args.query,
                        formatted.join("\n\n")
                    ))
                }
            }
            Err(e) => ToolResult::error(format!("Web search failed: {}", e)),
        }
    }
}

// =============================================================================
// READ URL TOOL
// =============================================================================

/// Tool for reading content of a URL
pub struct ReadUrlTool;

impl ReadUrlTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for ReadUrlTool {
    fn name(&self) -> &str {
        "read_url"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "read_url".to_string(),
            description: "Read the content of a specific web page. Use this to 'chat' with a website or extract detailed information from a link.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL of the page to read"
                    }
                },
                "required": ["url"]
            }),
        }
    }

    async fn execute(&self, arguments: Value) -> ToolResult {
        #[derive(Deserialize)]
        struct Args { url: String }
        let args = match parse_args::<Args>(self.name(), arguments) {
            Ok(a) => a,
            Err(e) => return ToolResult::error(e),
        };

        if !args.url.starts_with("http") {
             return ToolResult::error("Invalid URL: must start with http or https".to_string());
        }

        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build() {
                Ok(c) => c,
                Err(e) => return ToolResult::error(format!("Failed to create client: {}", e)),
            };

        match client.get(&args.url).send().await {
            Ok(response) => {
                match response.text().await {
                    Ok(html) => {
                        // Very simple HTML tag stripping
                        let mut text = String::with_capacity(html.len() / 2);
                        let mut in_tag = false;
                        let mut tag_level = 0;
                        
                        for c in html.chars() {
                            if c == '<' {
                                in_tag = true;
                                tag_level += 1;
                                continue;
                            }
                            if c == '>' {
                                tag_level -= 1;
                                if tag_level <= 0 {
                                    tag_level = 0;
                                    in_tag = false;
                                    text.push(' ');
                                }
                                continue;
                            }
                            if !in_tag {
                                text.push(c);
                            }
                        }

                        // Clean up whitespace
                        let cleaned: String = text
                            .split_whitespace()
                            .collect::<Vec<_>>()
                            .join(" ");

                        // Limit length to avoid context overflow
                        let final_text = if cleaned.len() > 3000 {
                            format!("{}... [Truncated]", &cleaned[..3000])
                        } else {
                            cleaned
                        };

                        if final_text.trim().is_empty() {
                            ToolResult::success("Page read successfully but no text content found (it might be a heavy JS app or image-based).".to_string())
                        } else {
                            ToolResult::success(final_text)
                        }
                    }
                    Err(e) => ToolResult::error(format!("Failed to read text: {}", e)),
                }
            }
            Err(e) => ToolResult::error(format!("Failed to fetch URL: {}", e)),
        }
    }
}

// =============================================================================
// SUGGEST WORKSPACES TOOL (Smart Analysis)
// =============================================================================

/// Tool that analyzes activity and suggests workspace organization
pub struct SuggestWorkspacesTool {
    sync_data: Arc<RwLock<SyncData>>,
}

impl SuggestWorkspacesTool {
    pub fn new(sync_data: Arc<RwLock<SyncData>>) -> Self {
        Self { sync_data }
    }

    /// Extract domain from URL
    fn extract_domain(url: &str) -> Option<String> {
        url.split("//")
            .nth(1)?
            .split('/')
            .next()
            .map(|d| d.replace("www.", ""))
    }

    /// Categorize a URL based on domain patterns
    fn categorize_url(url: &str, title: Option<&str>) -> &'static str {
        let url_lower = url.to_lowercase();
        let title_lower = title.map(|t| t.to_lowercase()).unwrap_or_default();

        // Development
        if url_lower.contains("github.com") || url_lower.contains("gitlab")
            || url_lower.contains("stackoverflow") || url_lower.contains("docs.rs")
            || title_lower.contains("documentation") || url_lower.contains("npmjs")
            || url_lower.contains("crates.io") {
            return "Development";
        }

        // AI/ML
        if url_lower.contains("openai") || url_lower.contains("anthropic")
            || url_lower.contains("huggingface") || url_lower.contains("claude")
            || title_lower.contains("ai") || title_lower.contains("llm")
            || url_lower.contains("chatgpt") {
            return "AI & ML";
        }

        // Social
        if url_lower.contains("twitter.com") || url_lower.contains("x.com")
            || url_lower.contains("linkedin") || url_lower.contains("facebook")
            || url_lower.contains("reddit.com") || url_lower.contains("discord") {
            return "Social";
        }

        // Video/Entertainment
        if url_lower.contains("youtube.com") || url_lower.contains("netflix")
            || url_lower.contains("twitch") || url_lower.contains("spotify") {
            return "Entertainment";
        }

        // Shopping
        if url_lower.contains("amazon") || url_lower.contains("ebay")
            || url_lower.contains("shopping") || title_lower.contains("buy")
            || title_lower.contains("cart") {
            return "Shopping";
        }

        // News/Reading
        if url_lower.contains("news") || url_lower.contains("medium.com")
            || url_lower.contains("substack") || url_lower.contains("blog") {
            return "Reading";
        }

        // Finance
        if url_lower.contains("bank") || url_lower.contains("finance")
            || url_lower.contains("trading") || url_lower.contains("crypto") {
            return "Finance";
        }

        "General"
    }
}

#[async_trait]
impl Tool for SuggestWorkspacesTool {
    fn name(&self) -> &str {
        "suggest_workspaces"
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "suggest_workspaces".to_string(),
            description: "Analyze browsing activity and suggest new workspace organization. Call this when user asks for workspace suggestions.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn execute(&self, _arguments: Value) -> ToolResult {
        let data = self.sync_data.read().await;

        log::info!("[Tool:suggest_workspaces] Analyzing {} workspaces, {} activities",
            data.workspaces.len(), data.activity.len());

        // Get existing workspace names
        let existing_names: HashSet<String> = data.workspaces
            .iter()
            .map(|w| w.name.to_lowercase())
            .collect();

        // Analyze recent activity and group by category
        let mut category_urls: std::collections::HashMap<&str, Vec<(String, String)>> = std::collections::HashMap::new();

        for activity in data.activity.iter().rev().take(50) {
            if let Some(url) = &activity.url {
                let title = activity.title.as_deref().unwrap_or("Untitled");
                let category = Self::categorize_url(url, Some(title));

                category_urls
                    .entry(category)
                    .or_default()
                    .push((url.clone(), title.to_string()));
            }
        }

        // Generate suggestions
        let mut suggestions = Vec::new();

        for (category, urls) in &category_urls {
            // Skip if category already has a workspace
            if existing_names.contains(&category.to_lowercase()) {
                continue;
            }

            // Only suggest if there are enough URLs in this category
            if urls.len() >= 3 {
                let sample_urls: Vec<String> = urls.iter()
                    .take(3)
                    .map(|(_, title)| format!("  - {}", title))
                    .collect();

                suggestions.push(format!(
                    "**{}** ({} related sites)\n{}",
                    category,
                    urls.len(),
                    sample_urls.join("\n")
                ));
            }
        }

        // Also check for domain clusters
        let mut domain_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for activity in data.activity.iter().rev().take(100) {
            if let Some(url) = &activity.url {
                if let Some(domain) = Self::extract_domain(url) {
                    *domain_counts.entry(domain).or_default() += 1;
                }
            }
        }

        // Find frequently visited domains not in existing workspaces
        let frequent_domains: Vec<_> = domain_counts.iter()
            .filter(|(_, count)| **count >= 5)
            .filter(|(domain, _)| !existing_names.iter().any(|w| domain.contains(w.as_str())))
            .take(3)
            .collect();

        if !frequent_domains.is_empty() {
            let domain_list: Vec<String> = frequent_domains.iter()
                .map(|(d, c)| format!("  - {} ({} visits)", d, c))
                .collect();
            suggestions.push(format!(
                "**Frequent Sites** (consider grouping)\n{}",
                domain_list.join("\n")
            ));
        }

        // Build response
        let mut response = String::new();

        response.push_str(&format!("You have {} existing workspaces.\n\n", data.workspaces.len()));

        if suggestions.is_empty() {
            response.push_str("Your workspaces look well organized! No new suggestions at this time.");
        } else {
            response.push_str("**Suggested New Workspaces:**\n\n");
            response.push_str(&suggestions.join("\n\n"));
            response.push_str("\n\nWould you like me to create any of these workspaces?");
        }

        ToolResult::success(response)
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
        registry.register(Box::new(GetPinnedItemsTool::new(sync_data.clone())));
        registry.register(Box::new(SuggestWorkspacesTool::new(sync_data))); // Smart workspace suggestions
        registry.register(Box::new(WebSearchTool::new(5))); // Web search with max 5 results
        registry.register(Box::new(ReadUrlTool::new())); // Read URL content
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
                // Simplified format to save tokens
                format!("- {}: {}", t.name, t.description)
            })
            .collect();

        format!(
            r#"Tools:
{}

Format: <tool>name</tool><args>{{"key": "value"}}</args>"#,
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
