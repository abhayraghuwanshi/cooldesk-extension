//! CoolDesk Agent - Main Agent Implementation
//!
//! The agent orchestrates conversations with:
//! - Memory management (short-term + long-term)
//! - Tool execution
//! - Multi-turn conversation handling

use super::client::{LocalLlamaClient, ToolCallParser};
use super::conversation::PromptBuilder;
use super::memory::{ChatMessage, MemoryManager, SharedMemoryManager};
use super::tools::{ToolRegistry, ToolResult};
use crate::sidecar::data::SyncData;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

// =============================================================================
// CONSTANTS
// =============================================================================

/// Default system prompt for the agent
const DEFAULT_SYSTEM_PROMPT: &str = r#"You are CoolDesk AI, a desktop assistant that helps users with their browser workspaces, notes, and activity.

IMPORTANT: You MUST use tools to answer questions about the user's data. You do NOT have direct access to their workspaces, notes, or activity - you MUST call a tool first.

When asked about workspaces, notes, URLs, or recent activity, you MUST respond with a tool call like this:
<tool>search_workspaces</tool><args>{"query": ""}</args>

Available tools:
- search_workspaces: Search user's workspaces and URLs (use empty query "" to list all)
- search_notes: Search user's notes
- get_recent_activity: Get recent browsing activity
- get_pinned_items: Get pinned/favorite items
- web_search: Search the web for external information

NEVER make up or guess information about the user's data. If asked about workspaces, notes, or activity, ALWAYS use a tool first.

Example - if user asks "What workspaces do I have?", respond with:
<tool>search_workspaces</tool><args>{"query": ""}</args>"#;

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
    pub max_tokens: u32,
    /// Maximum tool iterations per request
    pub max_tool_iterations: usize,
    /// Maximum context messages to include
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
    pub fn with_config(sync_data: Arc<RwLock<SyncData>>, config: AgentConfig) -> Self {
        Self {
            config,
            memory: Arc::new(RwLock::new(MemoryManager::new())),
            tools: ToolRegistry::with_defaults(sync_data),
            client: LocalLlamaClient::new(),
        }
    }

    /// Create an agent with existing memory
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

    /// Detect which tools should be proactively called based on the query
    fn detect_required_tools(message: &str) -> Vec<(&'static str, serde_json::Value)> {
        let lower = message.to_lowercase();
        let mut tools = Vec::new();

        // Check for workspace-related queries
        if lower.contains("workspace")
            || lower.contains("tab")
            || lower.contains("url")
            || lower.contains("site")
            || lower.contains("website")
            || lower.contains("browser")
            || lower.contains("what do i have")
            || lower.contains("show me")
            || lower.contains("list")
        {
            tools.push(("search_workspaces", serde_json::json!({"query": ""})));
        }

        // Check for notes-related queries
        if lower.contains("note") || lower.contains("written") || lower.contains("wrote") {
            tools.push(("search_notes", serde_json::json!({"query": ""})));
        }

        // Check for activity-related queries
        if lower.contains("recent")
            || lower.contains("activity")
            || lower.contains("history")
            || lower.contains("visited")
            || lower.contains("lately")
        {
            tools.push(("get_recent_activity", serde_json::json!({"limit": 10})));
        }

        // Check for pinned items
        if lower.contains("pin")
            || lower.contains("favorite")
            || lower.contains("saved")
            || lower.contains("bookmark")
        {
            tools.push(("get_pinned_items", serde_json::json!({})));
        }

        // Check for web search (external info)
        if lower.contains("search the web")
            || lower.contains("search web")
            || lower.contains("web search")
            || lower.contains("look up")
            || lower.contains("google")
            || lower.contains("find online")
            || lower.contains("search for")
            || lower.contains("search online")
            || lower.starts_with("what is ")
            || lower.starts_with("who is ")
            || lower.starts_with("how to ")
            || lower.starts_with("find ")
        {
            // Extract search query from the message
            // Remove common prefixes to get cleaner query
            let query = message
                .to_lowercase()
                .replace("search the web for", "")
                .replace("search web for", "")
                .replace("search for", "")
                .replace("look up", "")
                .replace("find online", "")
                .replace("google", "")
                .trim()
                .to_string();
            let query = if query.is_empty() { message.to_string() } else { query };
            tools.push(("web_search", serde_json::json!({"query": query})));
        }

        tools
    }

    /// Process a chat message and return a response
    pub async fn chat(&self, session_id: &str, user_message: &str) -> Result<AgentResponse, String> {
        // Add user message to session
        {
            let mut memory = self.memory.write().await;
            let session = memory.get_or_create_session(session_id);
            session.add_message(ChatMessage::user(user_message));
            session.generate_title();
        }

        // Get conversation history and long-term context
        let (messages, long_term_context) = {
            let memory = self.memory.read().await;
            let messages = memory
                .get_session(session_id)
                .map(|s| s.messages.clone())
                .unwrap_or_default();

            // Get relevant long-term facts
            let facts = memory.get_relevant_facts(user_message, self.config.max_long_term_facts);
            let context = if facts.is_empty() {
                None
            } else {
                Some(
                    facts
                        .iter()
                        .map(|f| format!("- {}", f.content))
                        .collect::<Vec<_>>()
                        .join("\n"),
                )
            };

            (messages, context)
        };

        // Proactively detect and execute required tools
        let required_tools = Self::detect_required_tools(user_message);
        let mut tools_used = Vec::new();
        let mut current_messages = messages;
        let mut tool_context = String::new();

        // Execute detected tools proactively
        for (tool_name, arguments) in required_tools {
            log::info!("[Agent] Proactively executing tool: {}", tool_name);
            tools_used.push(tool_name.to_string());

            if let Some(result) = self.tools.execute(tool_name, arguments).await {
                // Add tool result to context
                tool_context.push_str(&format!("\n\n[Data from {}]:\n{}", tool_name, result.content));
                current_messages.push(ChatMessage::tool_response(tool_name, &result.content));
            }
        }

        // Build system prompt (simpler since we already have tool results)
        let system_prompt = if tool_context.is_empty() {
            self.config.system_prompt.clone()
        } else {
            // When we have tool results, use a simpler prompt without tool instructions
            format!(
                r#"You are CoolDesk AI, a helpful desktop assistant.

Here is the data from the user's CoolDesk:
{}

Based on this data, answer the user's question naturally and concisely. DO NOT use any <tool> tags - the data has already been retrieved for you. Just respond conversationally using the information provided above."#,
                tool_context
            )
        };

        // Generate response with tool context
        let final_response = self
            .client
            .chat_with_context(
                &current_messages,
                &system_prompt,
                long_term_context.as_deref(),
            )
            .await?;

        // Save assistant response to session
        {
            let mut memory = self.memory.write().await;
            if let Some(session) = memory.get_session_mut(session_id) {
                session.add_message(ChatMessage::assistant(&final_response));
            }
        }

        Ok(AgentResponse {
            content: final_response,
            session_id: session_id.to_string(),
            tools_used,
            complete: true,
        })
    }

    /// Quick chat without session (stateless)
    pub async fn quick_chat(&self, message: &str) -> Result<String, String> {
        let messages = vec![ChatMessage::user(message)];

        self.client
            .chat(&messages, &self.config.system_prompt)
            .await
    }
}

// =============================================================================
// AGENT BUILDER
// =============================================================================

/// Builder for creating agents with custom configuration
pub struct AgentBuilder {
    config: AgentConfig,
    memory: Option<SharedMemoryManager>,
}

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
