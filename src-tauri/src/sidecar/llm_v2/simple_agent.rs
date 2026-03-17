//! Simple Agent - Context Injection Model
//!
//! Instead of complex tool routing, we:
//! 1. Build compact JSON context from SyncData
//! 2. Pass context + user query to LLM
//! 3. Let the model naturally understand and respond
//!
//! The model is smart enough to handle workspace management,
//! URL suggestions, and search without explicit tools.

use crate::sidecar::data::SyncData;
use crate::sidecar::llm::engine;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

// =============================================================================
// RESPONSE TYPES
// =============================================================================

/// Response from the simple agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleAgentResponse {
    pub ok: bool,
    pub response: String,
    /// Optional actions the model wants to perform
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub actions: Vec<AgentAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Actions the agent can suggest (parsed from response)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAction {
    #[serde(rename = "type")]
    pub action_type: String, // "add_url", "create_workspace", "remove_url", etc.
    pub workspace: Option<String>,
    pub url: Option<String>,
    pub title: Option<String>,
    pub data: Option<serde_json::Value>,
}

// =============================================================================
// CONTEXT BUILDER
// =============================================================================

/// Builds a compact context string from SyncData
pub struct ContextBuilder;

impl ContextBuilder {
    /// Build context from SyncData (compact format to save tokens)
    pub fn build(data: &SyncData, include_activity: bool) -> String {
        let mut parts = Vec::new();

        // 1. Workspaces (most important)
        if !data.workspaces.is_empty() {
            let ws_list: Vec<String> = data.workspaces.iter()
                .map(|w| {
                    let urls: Vec<&str> = w.urls.iter()
                        .filter_map(|u| {
                            // Filter out non-web URLs
                            let url = &u.url;
                            if url.starts_with("http") &&
                               !url.contains("chrome-extension://") &&
                               !url.contains("vscode://") &&
                               !url.contains("file://") {
                                Some(Self::extract_domain(url))
                            } else {
                                None
                            }
                        })
                        .take(8) // Max 8 URLs per workspace
                        .collect();
                    format!("- {}: {}", w.name, urls.join(", "))
                })
                .collect();
            parts.push(format!("WORKSPACES:\n{}", ws_list.join("\n")));
        }

        // 2. Current tabs (if available)
        if !data.tabs.is_empty() {
            let tabs: Vec<String> = data.tabs.iter()
                .filter(|t| t.url.starts_with("http"))
                .take(10)
                .map(|t| {
                    let title = if t.title.len() > 40 {
                        format!("{}...", &t.title[..40])
                    } else {
                        t.title.clone()
                    };
                    format!("- {} ({})", title, Self::extract_domain(&t.url))
                })
                .collect();
            if !tabs.is_empty() {
                parts.push(format!("CURRENT TABS:\n{}", tabs.join("\n")));
            }
        }

        // 3. Recent activity (optional, for suggestions) - include FULL URLs for suggestions
        if include_activity && !data.activity.is_empty() {
            let activity: Vec<String> = data.activity.iter()
                .rev() // Most recent first
                .filter_map(|a| {
                    let url = a.url.as_ref()?;
                    // Filter out non-web and IDE URLs
                    if !url.starts_with("http") ||
                       url.contains("chrome-extension://") ||
                       url.contains("localhost") ||
                       a.title.as_ref().map(|t| t.contains("Visual Studio Code")).unwrap_or(false) {
                        return None;
                    }
                    let title = a.title.as_ref()
                        .map(|t| if t.len() > 50 { format!("{}...", &t[..50]) } else { t.clone() })
                        .unwrap_or_else(|| Self::extract_domain(url).to_string());
                    // Include full URL for suggestions
                    Some(format!("- {} | {}", title, url))
                })
                .take(20) // More URLs for better suggestions
                .collect();
            if !activity.is_empty() {
                parts.push(format!("RECENT HISTORY (title | url):\n{}", activity.join("\n")));
            }
        }

        // 4. Notes summary (if any)
        if !data.notes.is_empty() {
            parts.push(format!("NOTES: {} notes available", data.notes.len()));
        }

        // 5. Pins
        if !data.pins.is_empty() {
            let pins: Vec<String> = data.pins.iter()
                .take(5)
                .map(|p| Self::extract_domain(&p.url).to_string())
                .collect();
            parts.push(format!("PINNED: {}", pins.join(", ")));
        }

        parts.join("\n\n")
    }

    /// Extract domain from URL
    fn extract_domain(url: &str) -> &str {
        url.split("//")
            .nth(1)
            .and_then(|s| s.split('/').next())
            .map(|s| s.trim_start_matches("www."))
            .unwrap_or(url)
    }
}

// =============================================================================
// SIMPLE AGENT
// =============================================================================

const SYSTEM_PROMPT: &str = r#"You are CoolDesk AI, a desktop assistant for managing browser workspaces and tabs.

The user's data is provided as context. Based on this:
- Answer questions about their workspaces, tabs, and browsing
- Suggest URLs that fit existing workspaces (based on category/theme)
- Help organize tabs into workspaces
- Provide helpful, concise responses

For modifications, include a JSON action block at the end:
```json
{"action": "add_url", "workspace": "Name", "url": "https://...", "title": "..."}
```

Be conversational and helpful. Use the context to give personalized suggestions."#;

/// Simple agent that uses context injection instead of tools
pub struct SimpleAgent {
    sync_data: Arc<RwLock<SyncData>>,
}

impl SimpleAgent {
    pub fn new(sync_data: Arc<RwLock<SyncData>>) -> Self {
        Self { sync_data }
    }

    /// Process a chat message
    pub async fn chat(&self, user_message: &str) -> SimpleAgentResponse {
        // 1. Build context from SyncData
        let data = self.sync_data.read().await;

        // Include activity for suggestion and workspace queries
        let msg_lower = user_message.to_lowercase();
        let needs_activity = msg_lower.contains("suggest") ||
                            msg_lower.contains("recommend") ||
                            msg_lower.contains("add") ||
                            msg_lower.contains("new url") ||
                            msg_lower.contains("history") ||
                            msg_lower.contains("workspace") ||
                            msg_lower.contains("group") ||
                            msg_lower.contains("organize");

        let context = ContextBuilder::build(&data, needs_activity);
        drop(data); // Release lock

        log::info!("[SimpleAgent] Context built: {} chars", context.len());

        // 2. Build full prompt
        let full_prompt = format!(
            "{}\n\n---\nUSER DATA:\n{}\n---\n\nUser: {}\n\nAssistant:",
            SYSTEM_PROMPT,
            context,
            user_message
        );

        // 3. Ensure model is loaded (auto-load if needed)
        if let Err(e) = crate::sidecar::llm::models::ensure_model_loaded().await {
            return SimpleAgentResponse {
                ok: false,
                response: String::new(),
                actions: vec![],
                error: Some(e),
            };
        }

        // 4. Send to LLM (use higher token limit for JSON responses with URLs)
        match engine::engine_chat(full_prompt, 2048).await {
            Ok(response) => {
                // Update last-used timestamp to prevent idle unload
                crate::sidecar::llm::models::touch_last_used().await;

                // 5. Parse any actions from response
                let actions = Self::parse_actions(&response);
                let clean_response = Self::clean_response(&response);

                SimpleAgentResponse {
                    ok: true,
                    response: clean_response,
                    actions,
                    error: None,
                }
            }
            Err(e) => SimpleAgentResponse {
                ok: false,
                response: String::new(),
                actions: vec![],
                error: Some(e),
            },
        }
    }

    /// Parse JSON actions from response
    fn parse_actions(response: &str) -> Vec<AgentAction> {
        let mut actions = Vec::new();

        // Look for JSON blocks
        if let Some(start) = response.find("```json") {
            let after_marker = &response[start + 7..];
            if let Some(end) = after_marker.find("```") {
                let json_str = after_marker[..end].trim();
                if let Ok(action) = serde_json::from_str::<AgentAction>(json_str) {
                    actions.push(action);
                }
            }
        }

        // Also try to find inline JSON objects with "action" key
        for line in response.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('{') && trimmed.contains("\"action\"") {
                if let Ok(action) = serde_json::from_str::<AgentAction>(trimmed) {
                    actions.push(action);
                }
            }
        }

        actions
    }

    /// Clean response (remove JSON action blocks for display, but keep data JSON)
    fn clean_response(response: &str) -> String {
        let mut result = response.to_string();

        // Only remove ```json blocks that contain "action" key (agent action blocks)
        // Keep other JSON blocks (like workspace grouping responses)
        while let Some(start) = result.find("```json") {
            let after_marker = &result[start + 7..];
            if let Some(end_rel) = after_marker.find("```") {
                let json_content = &after_marker[..end_rel];
                // Only remove if it looks like an action block (contains "action" key)
                if json_content.contains("\"action\"") {
                    let end = start + 7 + end_rel + 3;
                    let final_end = if result.len() > end && result[end..].starts_with('\n') { end + 1 } else { end };
                    result.replace_range(start..final_end.min(result.len()), "");
                    continue;
                }
            }
            // If not an action block, don't remove - break to avoid infinite loop
            break;
        }

        result.trim().to_string()
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_domain() {
        assert_eq!(ContextBuilder::extract_domain("https://www.github.com/user/repo"), "github.com");
        assert_eq!(ContextBuilder::extract_domain("https://claude.ai/chat"), "claude.ai");
    }

    #[test]
    fn test_parse_actions() {
        let response = r#"Here's a suggestion:
```json
{"action": "add_url", "workspace": "AI", "url": "https://perplexity.ai"}
```"#;
        let actions = SimpleAgent::parse_actions(response);
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].action_type, "add_url");
    }

    #[test]
    fn test_clean_response() {
        let response = r#"I suggest adding perplexity.ai to your AI workspace.
```json
{"action": "add_url", "workspace": "AI", "url": "https://perplexity.ai"}
```"#;
        let clean = SimpleAgent::clean_response(response);
        assert!(!clean.contains("```json"));
        assert!(clean.contains("perplexity.ai"));
    }
}
