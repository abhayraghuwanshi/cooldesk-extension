use crate::sidecar::data::SyncData;
use rig::completion::Prompt;
use rig::providers::{anthropic, openai};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

// =============================================================================
// RESPONSE TYPES (same shape as v2 for drop-in compatibility)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleAgentV3Response {
    pub ok: bool,
    pub response: String,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub actions: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub provider: &'static str,
}

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const SYSTEM_PROMPT: &str = r#"You are CoolDesk AI, a desktop assistant for managing browser workspaces and tabs.

The user's data is provided as context. Based on this:
- Answer questions about their workspaces, tabs, and browsing
- Suggest URLs that fit existing workspaces (based on category/theme)
- Help organize tabs into workspaces
- Provide helpful, concise responses

For workspace modifications, include a JSON action block at the end:
```json
{"action": "add_url", "workspace": "Name", "url": "https://...", "title": "..."}
```

Be conversational and helpful. Use the context to give personalized suggestions."#;

// =============================================================================
// SIMPLE AGENT V3
// =============================================================================

pub struct SimpleAgentV3 {
    sync_data: Arc<RwLock<SyncData>>,
}

impl SimpleAgentV3 {
    pub fn new(sync_data: Arc<RwLock<SyncData>>) -> Self {
        Self { sync_data }
    }

    pub async fn chat(&self, user_message: &str) -> SimpleAgentV3Response {
        let api_key = match crate::sidecar::llm_v3::config::get_api_key() {
            Some(k) => k,
            None => {
                return SimpleAgentV3Response {
                    ok: false,
                    response: String::new(),
                    actions: vec![],
                    error: Some(
                        "No API key configured. Add your OpenAI key in Settings → AI.".to_string(),
                    ),
                    provider: "openai",
                };
            }
        };

        // Build context from SyncData
        let context = {
            let data = self.sync_data.read().await;
            let msg_lower = user_message.to_lowercase();
            let needs_activity = msg_lower.contains("suggest")
                || msg_lower.contains("recommend")
                || msg_lower.contains("add")
                || msg_lower.contains("history")
                || msg_lower.contains("workspace")
                || msg_lower.contains("organize")
                || msg_lower.contains("group");
            build_context(&data, needs_activity)
        };

        log::info!("[SimpleAgentV3] context={} chars", context.len());

        // Full prompt = context block + user message
        let full_message = if context.is_empty() {
            user_message.to_string()
        } else {
            format!("USER DATA:\n{}\n\n---\n\n{}", context, user_message)
        };

        let config = crate::sidecar::llm_v3::config::load_config();
        let response_result = call_llm(&api_key, &config.provider, &config.model, SYSTEM_PROMPT, &full_message).await;

        match response_result {
            Ok(response) => {
                let actions = parse_actions(&response);
                let clean = clean_response(&response);
                SimpleAgentV3Response {
                    ok: true,
                    response: clean,
                    actions,
                    error: None,
                    provider: "openai",
                }
            }
            Err(e) => {
                log::error!("[SimpleAgentV3] error: {}", e);
                SimpleAgentV3Response {
                    ok: false,
                    response: String::new(),
                    actions: vec![],
                    error: Some(format!("Cloud AI error: {}", e)),
                    provider: "openai",
                }
            }
        }
    }
}

// =============================================================================
// PROVIDER DISPATCH
// =============================================================================

/// Call the right cloud LLM based on provider name.
async fn call_llm(
    api_key: &str,
    provider: &str,
    model: &str,
    system_prompt: &str,
    message: &str,
) -> Result<String, String> {
    match provider {
        "anthropic" => {
            let client = anthropic::Client::new(api_key, "https://api.anthropic.com", None, "2023-06-01");
            let agent = client
                .agent(model)
                .preamble(system_prompt)
                .max_tokens(2048)
                .build();
            agent.prompt(message).await.map_err(|e| e.to_string())
        }
        "gemini" => {
            // Use Google's official OpenAI-compatible endpoint — no trailing slash
            let client = openai::Client::from_url(
                api_key,
                "https://generativelanguage.googleapis.com/v1beta/openai",
            );
            let agent = client.agent(model).preamble(system_prompt).build();
            agent.prompt(message).await.map_err(|e| e.to_string())
        }
        _ => {
            // Default: OpenAI
            let client = openai::Client::new(api_key);
            let agent = client
                .agent(model)
                .preamble(system_prompt)
                .max_tokens(2048)
                .build();
            agent.prompt(message).await.map_err(|e| e.to_string())
        }
    }
}

// =============================================================================
// CONTEXT BUILDER
// =============================================================================

fn build_context(data: &SyncData, needs_activity: bool) -> String {
    let mut parts = Vec::new();

    if !data.workspaces.is_empty() {
        let ws_list: Vec<String> = data
            .workspaces
            .iter()
            .map(|w| {
                let urls: Vec<&str> = w
                    .urls
                    .iter()
                    .filter_map(|u| {
                        if u.url.starts_with("http")
                            && !u.url.contains("chrome-extension://")
                            && !u.url.contains("vscode://")
                        {
                            Some(extract_domain(&u.url))
                        } else {
                            None
                        }
                    })
                    .take(8)
                    .collect();
                format!("- {}: {}", w.name, urls.join(", "))
            })
            .collect();
        parts.push(format!("WORKSPACES:\n{}", ws_list.join("\n")));
    }

    if !data.tabs.is_empty() {
        let tabs: Vec<String> = data
            .tabs
            .iter()
            .filter(|t| t.url.starts_with("http"))
            .take(10)
            .map(|t| {
                let title = if t.title.len() > 40 {
                    format!("{}...", &t.title[..40])
                } else {
                    t.title.clone()
                };
                format!("- {} ({})", title, extract_domain(&t.url))
            })
            .collect();
        if !tabs.is_empty() {
            parts.push(format!("CURRENT TABS:\n{}", tabs.join("\n")));
        }
    }

    if needs_activity && !data.activity.is_empty() {
        let activity: Vec<String> = data
            .activity
            .iter()
            .rev()
            .filter_map(|a| {
                let url = a.url.as_ref()?;
                if !url.starts_with("http") || url.contains("chrome-extension://") {
                    return None;
                }
                let title = a
                    .title
                    .as_ref()
                    .map(|t| {
                        if t.len() > 50 {
                            format!("{}...", &t[..50])
                        } else {
                            t.clone()
                        }
                    })
                    .unwrap_or_else(|| extract_domain(url).to_string());
                Some(format!("- {} | {}", title, url))
            })
            .take(20)
            .collect();
        if !activity.is_empty() {
            parts.push(format!("RECENT HISTORY (title | url):\n{}", activity.join("\n")));
        }
    }

    if !data.notes.is_empty() {
        parts.push(format!("NOTES: {} notes available", data.notes.len()));
    }

    if !data.pins.is_empty() {
        let pins: Vec<&str> = data
            .pins
            .iter()
            .take(5)
            .map(|p| extract_domain(&p.url))
            .collect();
        parts.push(format!("PINNED: {}", pins.join(", ")));
    }

    parts.join("\n\n")
}

fn extract_domain(url: &str) -> &str {
    url.split("//")
        .nth(1)
        .and_then(|s| s.split('/').next())
        .map(|s| s.trim_start_matches("www."))
        .unwrap_or(url)
}

// =============================================================================
// RESPONSE CLEANUP
// =============================================================================

fn parse_actions(response: &str) -> Vec<serde_json::Value> {
    let mut actions = Vec::new();
    if let Some(start) = response.find("```json") {
        let after = &response[start + 7..];
        if let Some(end) = after.find("```") {
            let json_str = after[..end].trim();
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                if val.get("action").is_some() {
                    actions.push(val);
                }
            }
        }
    }
    actions
}

fn clean_response(response: &str) -> String {
    let mut result = response.to_string();
    while let Some(start) = result.find("```json") {
        let after_start = start + 7;
        if let Some(end_rel) = result[after_start..].find("```") {
            let json_content = &result[after_start..after_start + end_rel];
            if json_content.contains("\"action\"") {
                let end = after_start + end_rel + 3;
                let final_end = if result.len() > end && result[end..].starts_with('\n') {
                    end + 1
                } else {
                    end
                };
                result.replace_range(start..final_end.min(result.len()), "");
                continue;
            }
        }
        break;
    }
    result.trim().to_string()
}
