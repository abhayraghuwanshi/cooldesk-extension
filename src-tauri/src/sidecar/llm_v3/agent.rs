use crate::sidecar::data::SyncData;
use crate::sidecar::llm_v3::tools::{
    GetOpenProjects, GetPinnedItems, GetRecentActivity, SearchApps, SearchHistory, SearchTabs,
    SearchWorkspaces, SuggestWorkspaces,
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
- For open tabs: use search_tabs
- For browsing history: use search_history or get_recent_activity
- For running desktop apps: use search_apps
- For suggestions: use suggest_workspaces or get_pinned_items
- Only call tools you actually need for the user's question."#;

/// System prompt for the agentic workspace-suggestion loop. The model is told to
/// INVESTIGATE with tools first, then emit strict JSON in the schema the frontend
/// (`useWorkspaceAgent`) parses. URLs must be full and real (taken from tool
/// results), never invented.
const SUGGEST_SYSTEM_PROMPT: &str = r#"You are CoolDesk AI. Your job is to design 2-4 focused browser+app workspaces for the user.

FIRST investigate the user's real context using the tools — do not guess:
- search_tabs("") to see what's currently open
- search_apps("") to see running desktop apps (editors, IDEs, tools)
- get_open_projects() to see the LOCAL FOLDERS/projects open in code editors — use these for "folders"
- suggest_workspaces() for a per-domain engagement rollup + the pages the user spends the most time on
- search_history(keyword) / get_recent_activity for engagement-ranked sites not currently open
- search_workspaces("") to avoid duplicating workspaces that already exist

THEN group related tabs, apps and projects into workspaces. Activity results are annotated
with engagement like "[12m active, 5 visits, 3 days]" — weight high-engagement pages and
the top domains from suggest_workspaces heavily; they reveal what the user truly works on.
Ignore one-off, low-engagement pages unless they clearly complete a theme.

Respond with ONLY a JSON object — no prose, no markdown fences — in EXACTLY this schema:
{"groups":[{
  "name":"Workspace Name",
  "description":"one short sentence",
  "urls":[{"url":"https://full-url-from-tools","title":"Title"}],
  "apps":["VS Code","Slack"],
  "folders":[{"name":"project-name","editor":"vscode","path":"/c/Users/.../project"}],
  "suggestedUrls":[{"url":"https://...","title":"Title","reason":"why it fits"}]
}]}

Rules:
- "urls": FULL real URLs taken from search_tabs / search_history results — never invent them.
- Prioritise pages with the strongest engagement signal when choosing what belongs together.
- "apps": app names exactly as returned by search_apps (no browsers).
- "folders": local projects from get_open_projects — use the exact name, editor key, and path it returns (include "path" when shown).
- "suggestedUrls": 2-4 useful URLs not already open. Prefer real pages from the user's history/pins (via search_history / get_pinned_items) over generic well-known sites; only fall back to inventing a well-known URL when history has no good fit.
- Keep each workspace focused on one theme. Omit empty fields rather than padding them."#;

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
                    .max_tokens(2048)
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

    /// Agentic workspace-suggestion loop. The model investigates the user's
    /// context with the local-search tools (tabs / apps / history / workspaces)
    /// across multiple turns, then returns workspace groups as JSON. The frontend
    /// parses `content` for the `{"groups":[...]}` object.
    pub async fn suggest(&self, user_request: &str) -> CloudAgentResponse {
        let api_key = match crate::sidecar::llm_v3::config::get_api_key() {
            Some(k) => k,
            None => {
                return CloudAgentResponse {
                    ok: false,
                    content: String::new(),
                    error: Some(
                        "No AI API key configured. Add your key in Settings → AI.".to_string(),
                    ),
                    provider: "cloud",
                };
            }
        };

        let config = crate::sidecar::llm_v3::config::load_config();
        let provider = config.provider.as_str();
        let model = config.model.as_str();

        // The user's free-text intent (may be empty → general suggestions).
        let message = if user_request.trim().is_empty() {
            "Suggest workspaces from my current tabs, running apps and recent activity.".to_string()
        } else {
            user_request.to_string()
        };

        // Up to this many tool-call rounds before the model must produce its answer.
        const MAX_TURNS: usize = 8;

        let sd = self.sync_data.clone();
        let result = match provider {
            "anthropic" => {
                let client =
                    anthropic::Client::new(&api_key, "https://api.anthropic.com", None, "2023-06-01");
                let agent = client
                    .agent(model)
                    .preamble(SUGGEST_SYSTEM_PROMPT)
                    .max_tokens(4096)
                    .tool(SearchTabs { sync_data: sd.clone() })
                    .tool(SearchApps)
                    .tool(GetOpenProjects)
                    .tool(SearchHistory { sync_data: sd.clone() })
                    .tool(SearchWorkspaces { sync_data: sd.clone() })
                    .tool(GetRecentActivity { sync_data: sd.clone() })
                    .tool(SuggestWorkspaces { sync_data: sd.clone() })
                    .tool(GetPinnedItems { sync_data: sd })
                    .build();
                run_tool_loop(&agent, &message, self.sync_data.clone(), MAX_TURNS).await
            }
            "gemini" => {
                let client = openai::Client::from_url(
                    &api_key,
                    "https://generativelanguage.googleapis.com/v1beta/openai",
                );
                let agent = client
                    .agent(model)
                    .preamble(SUGGEST_SYSTEM_PROMPT)
                    .max_tokens(4096)
                    .tool(SearchTabs { sync_data: sd.clone() })
                    .tool(SearchApps)
                    .tool(GetOpenProjects)
                    .tool(SearchHistory { sync_data: sd.clone() })
                    .tool(SearchWorkspaces { sync_data: sd.clone() })
                    .tool(GetRecentActivity { sync_data: sd.clone() })
                    .tool(SuggestWorkspaces { sync_data: sd.clone() })
                    .tool(GetPinnedItems { sync_data: sd })
                    .build();
                run_tool_loop(&agent, &message, self.sync_data.clone(), MAX_TURNS).await
            }
            _ => {
                let client = openai::Client::new(&api_key);
                let agent = client
                    .agent(model)
                    .preamble(SUGGEST_SYSTEM_PROMPT)
                    .max_tokens(4096)
                    .tool(SearchTabs { sync_data: sd.clone() })
                    .tool(SearchApps)
                    .tool(GetOpenProjects)
                    .tool(SearchHistory { sync_data: sd.clone() })
                    .tool(SearchWorkspaces { sync_data: sd.clone() })
                    .tool(GetRecentActivity { sync_data: sd.clone() })
                    .tool(SuggestWorkspaces { sync_data: sd.clone() })
                    .tool(GetPinnedItems { sync_data: sd })
                    .build();
                run_tool_loop(&agent, &message, self.sync_data.clone(), MAX_TURNS).await
            }
        };

        match result {
            Ok(response) => {
                log::info!("[CloudAgent] suggest ({}) response ({} chars)", provider, response.len());
                CloudAgentResponse {
                    ok: true,
                    content: response,
                    error: None,
                    provider: "cloud",
                }
            }
            Err(e) => {
                log::error!("[CloudAgent] suggest ({}) error: {}", provider, e);
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

// =============================================================================
// MANUAL MULTI-TURN TOOL LOOP
// rig 0.9.1's `Agent::prompt` does a single completion and returns the raw tool
// output without feeding it back to the model — i.e. no agentic loop. We drive
// the loop ourselves: send a completion, execute any tool calls the model asked
// for, feed the results back, and repeat until the model returns plain text.
// =============================================================================

async fn run_tool_loop<M: rig::completion::CompletionModel>(
    agent: &rig::agent::Agent<M>,
    initial: &str,
    sync_data: Arc<RwLock<SyncData>>,
    max_turns: usize,
) -> Result<String, String> {
    use rig::completion::message::{AssistantContent, Message};
    use rig::completion::Completion;

    let mut history: Vec<Message> = Vec::new();
    let mut turn_input: Message = Message::user(initial);

    for turn in 0..max_turns {
        let resp = agent
            .completion(turn_input.clone(), history.clone())
            .await
            .map_err(|e| e.to_string())?
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let mut assistant_text = String::new();
        let mut calls: Vec<String> = Vec::new();
        let mut results: Vec<String> = Vec::new();

        for content in resp.choice.into_iter() {
            match content {
                AssistantContent::Text(t) => assistant_text.push_str(&t.text),
                AssistantContent::ToolCall(call) => {
                    log::info!("[CloudAgent] tool call: {}", call.function.name);
                    let name = call.function.name;
                    let args = call.function.arguments;
                    let output = dispatch_tool(&name, args.clone(), &sync_data).await;
                    calls.push(format!("{}({})", name, args));
                    results.push(format!("### Result of {}({})\n{}", name, args, output));
                }
            }
        }

        // No tools requested → the model has produced its final answer.
        if results.is_empty() {
            return Ok(assistant_text);
        }

        // Replay the exchange as PLAIN TEXT rather than typed tool-call messages.
        // Round-tripping provider tool-call parts breaks on Gemini 3, which rejects
        // a replayed functionCall without its thought_signature — a field rig 0.9
        // does not model. A text transcript avoids that on every provider.
        log::info!("[CloudAgent] turn {} ran {} tool(s)", turn, results.len());
        history.push(turn_input);
        let assistant_summary = if assistant_text.is_empty() {
            format!("Calling tools: {}", calls.join(", "))
        } else {
            format!("{}\n\nCalling tools: {}", assistant_text, calls.join(", "))
        };
        history.push(Message::assistant(assistant_summary));
        turn_input = Message::user(format!(
            "Tool results below. Call more tools if you still need data; otherwise give your final answer.\n\n{}",
            results.join("\n\n")
        ));
    }

    Err("reached the tool-call limit without a final answer".to_string())
}

/// Execute one tool by name against the live data and return its text output
/// (errors are returned as text so the model can recover).
async fn dispatch_tool(
    name: &str,
    args: serde_json::Value,
    sync_data: &Arc<RwLock<SyncData>>,
) -> String {
    use crate::sidecar::llm_v3::tools::*;
    use rig::tool::Tool;

    let result: Result<String, String> = match name {
        "search_tabs" => match serde_json::from_value::<SearchTabsArgs>(args) {
            Ok(a) => SearchTabs { sync_data: sync_data.clone() }.call(a).await.map_err(|e| e.to_string()),
            Err(e) => Err(format!("invalid args: {e}")),
        },
        "search_apps" => match serde_json::from_value::<SearchAppsArgs>(args) {
            Ok(a) => SearchApps.call(a).await.map_err(|e| e.to_string()),
            Err(e) => Err(format!("invalid args: {e}")),
        },
        "get_open_projects" => match serde_json::from_value::<GetOpenProjectsArgs>(args) {
            Ok(a) => GetOpenProjects.call(a).await.map_err(|e| e.to_string()),
            Err(e) => Err(format!("invalid args: {e}")),
        },
        "search_history" => match serde_json::from_value::<SearchHistoryArgs>(args) {
            Ok(a) => SearchHistory { sync_data: sync_data.clone() }.call(a).await.map_err(|e| e.to_string()),
            Err(e) => Err(format!("invalid args: {e}")),
        },
        "search_workspaces" => match serde_json::from_value::<SearchWorkspacesArgs>(args) {
            Ok(a) => SearchWorkspaces { sync_data: sync_data.clone() }.call(a).await.map_err(|e| e.to_string()),
            Err(e) => Err(format!("invalid args: {e}")),
        },
        "get_recent_activity" => match serde_json::from_value::<GetRecentActivityArgs>(args) {
            Ok(a) => GetRecentActivity { sync_data: sync_data.clone() }.call(a).await.map_err(|e| e.to_string()),
            Err(e) => Err(format!("invalid args: {e}")),
        },
        "suggest_workspaces" => match serde_json::from_value::<SuggestWorkspacesArgs>(args) {
            Ok(a) => SuggestWorkspaces { sync_data: sync_data.clone() }.call(a).await.map_err(|e| e.to_string()),
            Err(e) => Err(format!("invalid args: {e}")),
        },
        "get_pinned_items" => match serde_json::from_value::<GetPinnedItemsArgs>(args) {
            Ok(a) => GetPinnedItems { sync_data: sync_data.clone() }.call(a).await.map_err(|e| e.to_string()),
            Err(e) => Err(format!("invalid args: {e}")),
        },
        other => Err(format!("unknown tool: {other}")),
    };

    result.unwrap_or_else(|e| format!("Tool '{}' error: {}", name, e))
}
