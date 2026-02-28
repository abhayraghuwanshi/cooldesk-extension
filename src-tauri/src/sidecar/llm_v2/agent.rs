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
const DEFAULT_SYSTEM_PROMPT: &str = r#"You are CoolDesk AI, a powerful and highly capable advanced desktop assistant.
Your primary goal is to help users seamlessly manage their workspaces, categorize their browsing activity, organize notes, and boost their productivity.

Rules & Capabilities:
1. MANDATORY: ALWAYS call a tool if you need information about the user's data, workspaces, notes, or external content. DO NOT guess or hallucinate user data.
2. YOU CAN CALL MULTIPLE TOOLS AT ONCE. If you need 2 different pieces of information, output both tool calls in the SAME turn! DO NOT provide a final answer to the user until you have all the facts.
3. ALWAYS THOUGHT FIRST: Before you use a tool or provide an answer, use a `<thought>...</thought>` block to reason about what data you need and what you are doing.
4. When asked to "suggest a new workspace", "organize my tabs", or "what workspaces do I have", YOU MUST DO EXACTLY THIS:
   - Call `search_workspaces` with an empty query AND call `get_recent_activity` AT THE SAME TIME.
   - Example Output:
     <thought>I need to search their existing workspaces and see their recent activity before I can suggest a new workspace.</thought>
     <tool>search_workspaces</tool><args>{"query": ""}</args>
     <tool>get_recent_activity</tool><args>{"limit": 25}</args>
   - WAIT for both tool results to return in your conversation history.
   - ONLY AFTER reviewing both results, analyze the collected URLs and logically group related domains or topics into new workspace suggestions. Provide clear reasons for your suggestions.
5. Always use EXACTLY the `<tool>tool_name</tool><args>{"key": "value"}</args>` format.
6. If the user asks a question you don't confidently know the answer to, use `web_search` to find accurate information.
7. Provide concise, clear, and actionable responses.
"#;

/// Maximum tool call iterations per request
const MAX_TOOL_ITERATIONS: usize = 7;

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



    /// Process a chat message and return a response
    pub async fn chat(&self, session_id: &str, user_message: &str) -> Result<AgentResponse, String> {
        // Add user message to session
        {
            let mut memory = self.memory.write().await;
            let session = memory.get_or_create_session(session_id);
            session.add_message(ChatMessage::user(user_message));
            session.generate_title();
        }

        let mut tools_used = Vec::new();
        let mut iteration = 0;
        let mut final_content = String::new();

        while iteration < self.config.max_tool_iterations {
            iteration += 1;

            // 1. Get current conversation state
            let (messages, long_term_context) = {
                let memory = self.memory.read().await;
                let messages = memory.get_session(session_id).map(|s| s.messages.clone()).unwrap_or_default();
                let facts = memory.get_relevant_facts(user_message, self.config.max_long_term_facts);
                let context = if facts.is_empty() {
                    None
                } else {
                    Some(facts.iter().map(|f| format!("- {}", f.content)).collect::<Vec<_>>().join("\n"))
                };
                (messages, context)
            };

            // 2. Build current system prompt with tool context
            let mut system_prompt = self.config.system_prompt.clone();
            system_prompt.push_str("\n\n");
            system_prompt.push_str(&self.tools.format_for_prompt());

            let response_text = self
                .client
                .chat_with_context(&messages, &system_prompt, long_term_context.as_deref())
                .await?;

            // 3. Parse for tool calls
            if let Some(tool_calls) = ToolCallParser::parse(&response_text) {
                log::info!("[Agent] Model requested {} tool(s)", tool_calls.len());
                
                // Add assistant's tool-call message to memory (for context in next turn)
                {
                    let mut memory = self.memory.write().await;
                    if let Some(session) = memory.get_session_mut(session_id) {
                        session.add_message(ChatMessage::assistant(&response_text));
                    }
                }

                // Execute each tool
                for call in tool_calls {
                    tools_used.push(call.name.clone());
                    log::info!("[Agent] Executing tool: {} with {:?}", call.name, call.arguments);

                    if let Some(result) = self.tools.execute(&call.name, call.arguments).await {
                        // Add tool response to memory
                        let mut memory = self.memory.write().await;
                        if let Some(session) = memory.get_session_mut(session_id) {
                            session.add_message(ChatMessage::tool_response(&call.name, &result.content));
                        }
                    } else {
                        let mut memory = self.memory.write().await;
                        if let Some(session) = memory.get_session_mut(session_id) {
                            session.add_message(ChatMessage::tool_response(&call.name, "Error: Tool not found"));
                        }
                    }
                }
                
                // Continue loop to let model see tool results
                continue;
            } else {
                // No more tool calls, we have the final answer
                // Clean the text to hide any internal <thought> blocks from the user
                final_content = ToolCallParser::extract_text(&response_text);
                break;
            }
        }

        // If we hit max iterations, try to extract whatever text we have or provide a fallback
        if final_content.is_empty() {
             final_content = "I reached my maximum reasoning limit. How else can I help?".to_string();
        }

        // Save final assistant response to session
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
