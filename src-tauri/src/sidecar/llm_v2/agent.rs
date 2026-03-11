//! CoolDesk Agent - Main Agent Implementation
//!
//! The agent orchestrates conversations with:
//! - Memory management (short-term + long-term)
//! - Tool execution
//! - Multi-turn conversation handling

use super::client::{LocalLlamaClient, ToolCallParser};
use super::memory::{ChatMessage, MemoryManager, SharedMemoryManager};
use super::tools::ToolRegistry;
use crate::sidecar::data::SyncData;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

// =============================================================================
// CONSTANTS
// =============================================================================

/// Default system prompt for the agent
const DEFAULT_SYSTEM_PROMPT: &str = r#"You are CoolDesk AI, a desktop assistant that helps users manage workspaces and browsing.

RULES:
1. Use tools to get data. Never guess.
2. After tool results, give your final answer immediately.
3. Tool format: <tool>name</tool><args>{"key": "value"}</args>

WHICH TOOL TO USE:
- "suggest workspace" or "organize" -> suggest_workspaces
- "what workspaces" or "list workspaces" -> search_workspaces with empty query
- "recent activity" or "what was I doing" -> get_recent_activity
- "search for X" on web -> web_search
"#;

/// Maximum tool call iterations per request
const MAX_TOOL_ITERATIONS: usize = 3;

// =============================================================================
// AGENT RESPONSE
// =============================================================================

/// Response from the agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResponse {
    /// The response text
    pub content: String,
    /// Session ID for this conversation
    pub session_id: String,
    /// Tools that were used
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tools_used: Vec<String>,
    /// Whether the response is complete
    pub complete: bool,
}

// =============================================================================
// AGENT CONFIG
// =============================================================================

/// Configuration for the agent
#[derive(Debug, Clone)]
pub struct AgentConfig {
    /// System prompt
    pub system_prompt: String,
    /// Maximum tokens for generation
    #[allow(dead_code)]
    pub max_tokens: u32,
    /// Maximum tool iterations per request
    pub max_tool_iterations: usize,
    /// Maximum context messages to include
    #[allow(dead_code)]
    pub max_context_messages: usize,
    /// Maximum long-term facts to include
    pub max_long_term_facts: usize,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
            max_tokens: 2048,
            max_tool_iterations: MAX_TOOL_ITERATIONS,
            max_context_messages: 10,
            max_long_term_facts: 5,
        }
    }
}

// =============================================================================
// COOLDESK AGENT
// =============================================================================

/// The main CoolDesk agent
pub struct CoolDeskAgent {
    /// Configuration
    config: AgentConfig,
    /// Memory manager
    memory: SharedMemoryManager,
    /// Tool registry
    tools: ToolRegistry,
    /// LLM client
    client: LocalLlamaClient,
}

impl CoolDeskAgent {
    /// Create a new agent with sync data access
    pub fn new(sync_data: Arc<RwLock<SyncData>>) -> Self {
        Self {
            config: AgentConfig::default(),
            memory: Arc::new(RwLock::new(MemoryManager::new())),
            tools: ToolRegistry::with_defaults(sync_data),
            client: LocalLlamaClient::new(),
        }
    }

    /// Create an agent with custom config
    #[allow(dead_code)]
    pub fn with_config(sync_data: Arc<RwLock<SyncData>>, config: AgentConfig) -> Self {
        Self {
            config,
            memory: Arc::new(RwLock::new(MemoryManager::new())),
            tools: ToolRegistry::with_defaults(sync_data),
            client: LocalLlamaClient::new(),
        }
    }

    /// Create an agent with existing memory
    #[allow(dead_code)]
    pub fn with_memory(sync_data: Arc<RwLock<SyncData>>, memory: SharedMemoryManager) -> Self {
        Self {
            config: AgentConfig::default(),
            memory,
            tools: ToolRegistry::with_defaults(sync_data),
            client: LocalLlamaClient::new(),
        }
    }

    /// Get the shared memory manager
    pub fn memory(&self) -> SharedMemoryManager {
        self.memory.clone()
    }

    // -------------------------------------------------------------------------
    // Session Management
    // -------------------------------------------------------------------------

    /// Create a new conversation session
    pub async fn create_session(&self) -> String {
        let mut memory = self.memory.write().await;
        memory.create_session()
    }

    /// Get session history
    pub async fn get_session_history(&self, session_id: &str) -> Vec<ChatMessage> {
        let memory = self.memory.read().await;
        memory
            .get_session(session_id)
            .map(|s| s.messages.clone())
            .unwrap_or_default()
    }

    /// Clear a session's history
    #[allow(dead_code)]
    pub async fn clear_session(&self, session_id: &str) -> bool {
        let mut memory = self.memory.write().await;
        if let Some(session) = memory.get_session_mut(session_id) {
            session.messages.clear();
            session.title = None;
            true
        } else {
            false
        }
    }

    /// Delete a session
    pub async fn delete_session(&self, session_id: &str) -> bool {
        let mut memory = self.memory.write().await;
        memory.delete_session(session_id)
    }

    // -------------------------------------------------------------------------
    // Long-term Memory
    // -------------------------------------------------------------------------

    /// Add a fact to long-term memory
    pub async fn add_memory_fact(&self, content: &str, category: Option<&str>) {
        let mut memory = self.memory.write().await;
        memory.add_fact(content, None, category);
    }

    /// Get all long-term memory facts
    pub async fn get_memory_facts(&self) -> Vec<super::memory::MemoryFact> {
        let memory = self.memory.read().await;
        memory.get_all_facts().to_vec()
    }

    /// Clear long-term memory
    pub async fn clear_long_term_memory(&self) {
        let mut memory = self.memory.write().await;
        memory.clear_long_term_memory();
    }

    // -------------------------------------------------------------------------
    // Chat
    // -------------------------------------------------------------------------



    /// Process a chat message and return a response
    /// Uses SIMPLE MODE: pre-fetch data based on query, single LLM call
    pub async fn chat(&self, session_id: &str, user_message: &str) -> Result<AgentResponse, String> {
        // Add user message to session
        {
            let mut memory = self.memory.write().await;
            let session = memory.get_or_create_session(session_id);
            session.add_message(ChatMessage::user(user_message));
            session.generate_title();
        }

        let msg_lower = user_message.to_lowercase();
        let mut tools_used = Vec::new();

        // SIMPLE MODE: Pre-fetch relevant data based on query keywords
        // No complex agentic loops - just get data and respond in one shot
        let context_data = self.get_context_for_query(&msg_lower, &mut tools_used).await;

        log::info!("[Agent] Simple mode: fetched {} chars context, tools: {:?}", context_data.len(), tools_used);

        // Build simple prompt
        let system_prompt = self.build_simple_prompt();

        // Get conversation history (limited)
        let messages = {
            let memory = self.memory.read().await;
            memory.get_session(session_id)
                .map(|s| s.messages.iter().rev().take(6).cloned().collect::<Vec<_>>())
                .map(|mut v| { v.reverse(); v })
                .unwrap_or_default()
        };

        // Single LLM call with data already included
        let response_text = self
            .client
            .chat_with_context(&messages, &system_prompt, Some(&context_data))
            .await?;

        let final_content = ToolCallParser::extract_text(&response_text);

        // Save response
        {
            let mut memory = self.memory.write().await;
            if let Some(session) = memory.get_session_mut(session_id) {
                session.add_message(ChatMessage::assistant(&final_content));
            }
        }

        Ok(AgentResponse {
            content: final_content,
            session_id: session_id.to_string(),
            tools_used,
            complete: true,
        })
    }

    /// Pre-fetch relevant data based on query keywords
    async fn get_context_for_query(&self, query: &str, tools_used: &mut Vec<String>) -> String {
        let mut context_parts = Vec::new();

        // Workspace suggestions
        if query.contains("suggest") || query.contains("organize") || query.contains("recommend") {
            if let Some(result) = self.tools.execute("suggest_workspaces", serde_json::json!({})).await {
                tools_used.push("suggest_workspaces".to_string());
                context_parts.push(result.content);
            }
        }
        // List/show workspaces
        else if query.contains("workspace") || query.contains("list") || query.contains("show") {
            if let Some(result) = self.tools.execute("search_workspaces", serde_json::json!({"query": ""})).await {
                tools_used.push("search_workspaces".to_string());
                context_parts.push(format!("Your workspaces:\n{}", result.content));
            }
        }
        // Activity queries
        else if query.contains("activity") || query.contains("doing") || query.contains("recent") || query.contains("browse") {
            if let Some(result) = self.tools.execute("get_recent_activity", serde_json::json!({"limit": 15})).await {
                tools_used.push("get_recent_activity".to_string());
                context_parts.push(result.content);
            }
        }
        // Notes
        else if query.contains("note") {
            if let Some(result) = self.tools.execute("search_notes", serde_json::json!({"query": ""})).await {
                tools_used.push("search_notes".to_string());
                context_parts.push(result.content);
            }
        }
        // Pinned/bookmarks
        else if query.contains("pin") || query.contains("bookmark") || query.contains("saved") {
            if let Some(result) = self.tools.execute("get_pinned_items", serde_json::json!({})).await {
                tools_used.push("get_pinned_items".to_string());
                context_parts.push(result.content);
            }
        }
        // Default: workspace overview
        else {
            if let Some(result) = self.tools.execute("search_workspaces", serde_json::json!({"query": ""})).await {
                tools_used.push("search_workspaces".to_string());
                context_parts.push(format!("Your workspaces:\n{}", result.content));
            }
        }

        context_parts.join("\n\n")
    }

    /// Build a simple prompt - no tools, just respond based on data
    fn build_simple_prompt(&self) -> String {
        r#"You are CoolDesk AI, a helpful desktop assistant for managing workspaces and browsing.

The user's data is provided below. Based on this data:
- Give a helpful, friendly, and concise response
- If the data shows workspace suggestions, explain each briefly
- If showing activity or workspaces, highlight key points
- Be conversational and direct"#.to_string()
    }
}

// =============================================================================
// AGENT BUILDER
// =============================================================================

/// Builder for creating agents with custom configuration
#[allow(dead_code)]
pub struct AgentBuilder {
    config: AgentConfig,
    memory: Option<SharedMemoryManager>,
}

#[allow(dead_code)]
impl AgentBuilder {
    pub fn new() -> Self {
        Self {
            config: AgentConfig::default(),
            memory: None,
        }
    }

    pub fn system_prompt(mut self, prompt: &str) -> Self {
        self.config.system_prompt = prompt.to_string();
        self
    }

    pub fn max_tokens(mut self, max: u32) -> Self {
        self.config.max_tokens = max;
        self
    }

    pub fn max_tool_iterations(mut self, max: usize) -> Self {
        self.config.max_tool_iterations = max;
        self
    }

    pub fn max_context_messages(mut self, max: usize) -> Self {
        self.config.max_context_messages = max;
        self
    }

    pub fn with_memory(mut self, memory: SharedMemoryManager) -> Self {
        self.memory = Some(memory);
        self
    }

    pub fn build(self, sync_data: Arc<RwLock<SyncData>>) -> CoolDeskAgent {
        let memory = self
            .memory
            .unwrap_or_else(|| Arc::new(RwLock::new(MemoryManager::new())));

        CoolDeskAgent {
            config: self.config,
            memory,
            tools: ToolRegistry::with_defaults(sync_data),
            client: LocalLlamaClient::new(),
        }
    }
}

impl Default for AgentBuilder {
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

    #[tokio::test]
    async fn test_session_creation() {
        let sync_data = Arc::new(RwLock::new(SyncData::default()));
        let agent = CoolDeskAgent::new(sync_data);

        let session_id = agent.create_session().await;
        assert!(!session_id.is_empty());

        let history = agent.get_session_history(&session_id).await;
        assert!(history.is_empty());
    }

    #[tokio::test]
    async fn test_memory_facts() {
        let sync_data = Arc::new(RwLock::new(SyncData::default()));
        let agent = CoolDeskAgent::new(sync_data);

        agent.add_memory_fact("User prefers dark mode", Some("preferences")).await;

        let facts = agent.get_memory_facts().await;
        assert_eq!(facts.len(), 1);
        assert!(facts[0].content.contains("dark mode"));
    }

    #[test]
    fn test_agent_builder() {
        let sync_data = Arc::new(RwLock::new(SyncData::default()));

        let agent = AgentBuilder::new()
            .system_prompt("Custom prompt")
            .max_tokens(1024)
            .max_tool_iterations(5)
            .build(sync_data);

        assert_eq!(agent.config.system_prompt, "Custom prompt");
        assert_eq!(agent.config.max_tokens, 1024);
        assert_eq!(agent.config.max_tool_iterations, 5);
    }
}
