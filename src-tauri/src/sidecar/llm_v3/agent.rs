use crate::sidecar::data::SyncData;
use crate::sidecar::llm_v3::tools::{
    GetPinnedItems, GetRecentActivity, SearchWorkspaces, SuggestWorkspaces,
};
use rig::completion::Prompt;
use rig::providers::{anthropic, openai};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

// =============================================================================
// RESPONSE
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAgentResponse {
    pub ok: bool,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub provider: &'static str,
}

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const SYSTEM_PROMPT: &str = r#"You are CoolDesk AI, a desktop assistant that helps users manage workspaces and browsing.

Use the available tools to fetch data when needed, then give clear, helpful responses.
- For workspace queries: use search_workspaces
- For activity/history: use get_recent_activity
- For suggestions: use suggest_workspaces or get_pinned_items
- Only call tools you actually need for the user's question."#;

// =============================================================================
// CLOUD AGENT
// =============================================================================

pub struct CloudAgent {
    sync_data: Arc<RwLock<SyncData>>,
}

impl CloudAgent {
    pub fn new(sync_data: Arc<RwLock<SyncData>>) -> Self {
        Self { sync_data }
    }

    pub async fn chat(&self, user_message: &str) -> CloudAgentResponse {
        let api_key = match crate::sidecar::llm_v3::config::get_api_key() {
            Some(k) => k,
            None => {
                return CloudAgentResponse {
                    ok: false,
                    content: String::new(),
                    error: Some(
                        "No API key configured. Add your OpenAI key in Settings → AI.".to_string(),
                    ),
                    provider: "openai",
                };
            }
        };

        let config = crate::sidecar::llm_v3::config::load_config();
        let provider = config.provider.as_str();
        let model = config.model.as_str();

        let sd = self.sync_data.clone();
        let result = match provider {
            "anthropic" => {
                let client = anthropic::Client::new(&api_key, "https://api.anthropic.com", None, "2023-06-01");
                let agent = client
                    .agent(model)
                    .preamble(SYSTEM_PROMPT)
                    .max_tokens(2048)
                    .tool(SearchWorkspaces { sync_data: sd.clone() })
                    .tool(GetRecentActivity { sync_data: sd.clone() })
                    .tool(SuggestWorkspaces { sync_data: sd.clone() })
                    .tool(GetPinnedItems { sync_data: sd })
                    .build();
                agent.prompt(user_message).await.map_err(|e| e.to_string())
            }
            "gemini" => {
                // Use Google's official OpenAI-compatible endpoint — no trailing slash
                let client = openai::Client::from_url(
                    &api_key,
                    "https://generativelanguage.googleapis.com/v1beta/openai",
                );
                let agent = client
                    .agent(model)
                    .preamble(SYSTEM_PROMPT)
                    .tool(SearchWorkspaces { sync_data: sd.clone() })
                    .tool(GetRecentActivity { sync_data: sd.clone() })
                    .tool(SuggestWorkspaces { sync_data: sd.clone() })
                    .tool(GetPinnedItems { sync_data: sd })
                    .build();
                agent.prompt(user_message).await.map_err(|e| e.to_string())
            }
            _ => {
                let client = openai::Client::new(&api_key);
                let agent = client
                    .agent(model)
                    .preamble(SYSTEM_PROMPT)
                    .max_tokens(2048)
                    .tool(SearchWorkspaces { sync_data: sd.clone() })
                    .tool(GetRecentActivity { sync_data: sd.clone() })
                    .tool(SuggestWorkspaces { sync_data: sd.clone() })
                    .tool(GetPinnedItems { sync_data: sd })
                    .build();
                agent.prompt(user_message).await.map_err(|e| e.to_string())
            }
        };

        match result {
            Ok(response) => {
                log::info!("[CloudAgent] {} response ({} chars)", provider, response.len());
                CloudAgentResponse {
                    ok: true,
                    content: response,
                    error: None,
                    provider: "cloud",
                }
            }
            Err(e) => {
                log::error!("[CloudAgent] {} error: {}", provider, e);
                CloudAgentResponse {
                    ok: false,
                    content: String::new(),
                    error: Some(format!("{} error: {}", provider, e)),
                    provider: "cloud",
                }
            }
        }
    }
}
