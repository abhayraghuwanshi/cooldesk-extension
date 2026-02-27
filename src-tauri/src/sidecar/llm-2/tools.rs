//! # Tools Module
//!
//! This module implements the web search tool using DuckDuckGo.
//! It demonstrates several important Rust and async patterns:
//! - Trait implementation (Rig's Tool trait)
//! - Async/await for non-blocking I/O
//! - Structured error handling with thiserror
//! - Serde for JSON serialization/deserialization

use rig::completion::ToolDefinition;
use rig::tool::Tool;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use tracing::{debug, info, warn};

// =============================================================================
// CUSTOM ERROR TYPE
// =============================================================================
/// # Rust Concept: Custom Error Types with thiserror
///
/// thiserror is a derive macro that makes creating custom error types easy.
/// Each variant represents a different kind of error that can occur.
/// The #[error("...")] attribute defines the error message.
///
/// This is better than using strings because:
/// 1. The compiler checks we handle all error cases
/// 2. We can match on specific error types
/// 3. Errors are self-documenting
///
/// Note: For Rig's Tool trait, our error must implement std::error::Error,
/// which thiserror provides automatically via the derive macro.
#[derive(Error, Debug)]
pub enum SearchError {
    #[error("Failed to perform web search: {0}")]
    SearchFailed(String),

    #[error("Rate limited by search provider, please wait")]
    RateLimited,

    #[allow(dead_code)] // May be used in future enhancements
    #[error("No search results found for query: {0}")]
    NoResults(String),

    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
}

// =============================================================================
// SEARCH RESULT STRUCT
// =============================================================================
/// Represents a single search result from the web.
///
/// # Rust Concept: Derive Macros for Serialization
///
/// - Serialize: Convert struct to JSON (or other formats)
/// - Deserialize: Parse JSON into struct
/// - Clone: Create deep copies
/// - Debug: Pretty-print with {:?}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    /// The title of the search result
    pub title: String,

    /// The URL of the result
    pub url: String,

    /// A snippet/description of the content
    pub snippet: String,
}

// =============================================================================
// WEB SEARCH TOOL
// =============================================================================
/// The web search tool that uses DuckDuckGo for free searches.
///
/// # Rust Concept: Struct with Private Fields
///
/// By not making fields `pub`, we encapsulate the implementation.
/// Users can only create this through `new()` and use the public methods.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchTool {
    /// Maximum results to return per search
    max_results: usize,
}

impl WebSearchTool {
    /// Create a new WebSearchTool with the specified max results.
    ///
    /// # Rust Concept: Associated Functions (Constructors)
    ///
    /// Functions that don't take `self` are called "associated functions".
    /// `new()` is a convention for constructor-like functions.
    /// They're called with `Type::new()` syntax.
    ///
    /// # Arguments
    /// * `max_results` - Maximum number of search results to return
    ///
    /// # Example
    /// ```
    /// let search_tool = WebSearchTool::new(5);
    /// ```
    pub fn new(max_results: usize) -> Self {
        Self { max_results }
    }

    /// Perform a web search using DuckDuckGo.
    ///
    /// # Rust Concept: Async Functions
    ///
    /// `async fn` defines a function that can be paused and resumed.
    /// Inside async functions, you use `.await` to wait for async operations.
    /// This allows efficient handling of I/O without blocking threads.
    pub async fn search(&self, query: &str) -> Result<Vec<SearchResult>, SearchError> {
        info!(query = %query, "Performing web search");

        // Rate limiting: wait a bit before making the request
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Use DuckDuckGo HTML search
        let results = self.search_duckduckgo(query).await?;

        if results.is_empty() {
            warn!(query = %query, "No search results found");
        } else {
            info!(query = %query, count = results.len(), "Search completed");
        }

        Ok(results)
    }

    /// Internal method to perform DuckDuckGo search via HTML scraping.
    ///
    /// Note: We use HTML scraping because DuckDuckGo doesn't have a free web search API.
    /// The duckduckgo_search crate's library API returns empty results.
    async fn search_duckduckgo(&self, query: &str) -> Result<Vec<SearchResult>, SearchError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()?;

        let url = format!(
            "https://html.duckduckgo.com/html/?q={}",
            urlencoding::encode(query)
        );

        debug!(url = %url, "Fetching search results");

        let response = client.get(&url).send().await?;

        if !response.status().is_success() {
            if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                return Err(SearchError::RateLimited);
            }
            return Err(SearchError::SearchFailed(format!(
                "HTTP {}",
                response.status()
            )));
        }

        let body = response.text().await?;
        let results = self.parse_html(&body);

        Ok(results.into_iter().take(self.max_results).collect())
    }

    /// Parse DuckDuckGo HTML to extract results.
    /// Uses multiple strategies to handle different HTML formats.
    fn parse_html(&self, html: &str) -> Vec<SearchResult> {
        let mut results = Vec::new();
        let mut seen_urls = std::collections::HashSet::new();

        // Strategy 1: Look for result links with the uddg parameter (redirect URLs)
        for segment in html.split("uddg=") {
            if results.len() >= self.max_results {
                break;
            }

            // Find the end of the encoded URL
            if let Some(end) = segment.find(|c| c == '&' || c == '"' || c == '\'') {
                let encoded_url = &segment[..end];
                if let Ok(url) = urlencoding::decode(encoded_url) {
                    let url_str = url.to_string();
                    if url_str.starts_with("http")
                        && !url_str.contains("duckduckgo.com")
                        && !seen_urls.contains(&url_str)
                    {
                        seen_urls.insert(url_str.clone());
                        results.push(SearchResult {
                            title: extract_domain(&url_str).unwrap_or_else(|| "Result".to_string()),
                            url: url_str,
                            snippet: "Search result from DuckDuckGo".to_string(),
                        });
                    }
                }
            }
        }

        // Strategy 2: Look for result__url class which contains visible URLs
        if results.len() < self.max_results {
            for segment in html.split("result__url") {
                if results.len() >= self.max_results {
                    break;
                }

                // Look for href after this marker
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
                            results.push(SearchResult {
                                title: extract_domain(&url).unwrap_or_else(|| "Result".to_string()),
                                url,
                                snippet: "Search result".to_string(),
                            });
                        }
                    }
                }
            }
        }

        // Strategy 3: Direct URL extraction - find any https:// URLs
        if results.len() < self.max_results {
            for segment in html.split("https://") {
                if results.len() >= self.max_results {
                    break;
                }

                if let Some(end) = segment.find(|c: char| {
                    c == '"' || c == '\'' || c == '<' || c == '>' || c == ' ' || c == ')'
                }) {
                    let domain_path = &segment[..end];
                    // Filter out internal/tracking URLs
                    if !domain_path.starts_with("duckduckgo")
                        && !domain_path.starts_with("improving.duckduckgo")
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
                            results.push(SearchResult {
                                title: extract_domain(&url).unwrap_or_else(|| "Result".to_string()),
                                url,
                                snippet: "Search result".to_string(),
                            });
                        }
                    }
                }
            }
        }

        // Deduplicate and return
        results.into_iter().take(self.max_results).collect()
    }
}

/// Extract the domain name from a URL.
fn extract_domain(url: &str) -> Option<String> {
    url.split("//")
        .nth(1)?
        .split('/')
        .next()
        .map(|s| s.to_string())
}

// =============================================================================
// RIG TOOL TRAIT IMPLEMENTATION
// =============================================================================
/// Input arguments for the search tool.
#[derive(Debug, Deserialize, Serialize)]
pub struct SearchArgs {
    /// The search query to execute
    pub query: String,
}

/// Implement the Tool trait for WebSearchTool.
/// This makes it compatible with Rig's agent system.
///
/// # Rust Concept: Implementing Traits
///
/// Traits are like interfaces in other languages - they define behavior.
/// For Rig 0.27, the Tool trait requires:
/// - NAME: A static string identifier
/// - Error: Must implement std::error::Error
/// - Args: Input type that deserializes from JSON
/// - Output: Return type that serializes to JSON
/// - definition(): Async method returning tool metadata
/// - call(): Async method that executes the tool
impl Tool for WebSearchTool {
    const NAME: &'static str = "web_search";

    type Args = SearchArgs;
    type Output = String;
    type Error = SearchError;

    /// Returns the tool definition that describes this tool to the LLM.
    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Search the web using DuckDuckGo. Use this to find current information about any topic.".to_string(),
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

    /// Execute the search tool.
    ///
    /// Note: In Rig 0.27, call() only takes &self and args (no state parameter).
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let results = self.search(&args.query).await?;

        if results.is_empty() {
            return Ok(format!("No results found for: {}", args.query));
        }

        let formatted: String = results
            .iter()
            .enumerate()
            .map(|(i, r)| {
                format!(
                    "{}. **{}**\n   URL: {}\n   {}\n",
                    i + 1,
                    r.title,
                    r.url,
                    r.snippet
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        Ok(format!(
            "## Search Results for: {}\n\n{}",
            args.query, formatted
        ))
    }
}

// =============================================================================
// UNIT TESTS
// =============================================================================
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_web_search_tool_creation() {
        let tool = WebSearchTool::new(5);
        assert_eq!(tool.max_results, 5);
    }

    #[test]
    fn test_extract_domain() {
        assert_eq!(
            extract_domain("https://www.example.com/page"),
            Some("www.example.com".to_string())
        );
        assert_eq!(
            extract_domain("https://rust-lang.org/learn"),
            Some("rust-lang.org".to_string())
        );
    }

    #[test]
    fn test_search_result_serialization() {
        let result = SearchResult {
            title: "Test".to_string(),
            url: "https://test.com".to_string(),
            snippet: "A test result".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("Test"));
    }
}
