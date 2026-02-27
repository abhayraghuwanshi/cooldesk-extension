//! Conversation Management for LLM v2
//!
//! High-level conversation operations and session lifecycle management.

use super::memory::{ChatMessage, ConversationSession, MemoryManager, SharedMemoryManager};
use serde::{Deserialize, Serialize};

// =============================================================================
// CONVERSATION MANAGER
// =============================================================================

/// High-level conversation management operations
pub struct ConversationManager {
    memory: SharedMemoryManager,
}

impl ConversationManager {
    /// Create a new conversation manager
    pub fn new(memory: SharedMemoryManager) -> Self {
        Self { memory }
    }

    /// Create a new conversation session
    pub async fn create_session(&self) -> String {
        let mut memory = self.memory.write().await;
        memory.create_session()
    }

    /// Get a session by ID
    pub async fn get_session(&self, session_id: &str) -> Option<ConversationSession> {
        let memory = self.memory.read().await;
        memory.get_session(session_id).cloned()
    }

    /// Delete a session
    pub async fn delete_session(&self, session_id: &str) -> bool {
        let mut memory = self.memory.write().await;
        memory.delete_session(session_id)
    }

    /// List all sessions with summary info
    pub async fn list_sessions(&self) -> Vec<SessionSummary> {
        let memory = self.memory.read().await;
        memory
            .list_sessions()
            .iter()
            .map(|s| SessionSummary {
                id: s.id.clone(),
                title: s.title.clone(),
                message_count: s.messages.len(),
                created_at: s.created_at,
                updated_at: s.updated_at,
            })
            .collect()
    }

    /// Add a user message and get the updated session
    pub async fn add_user_message(&self, session_id: &str, content: &str) -> ConversationSession {
        let mut memory = self.memory.write().await;
        let session = memory.get_or_create_session(session_id);
        session.add_message(ChatMessage::user(content));
        session.generate_title();
        session.clone()
    }

    /// Add an assistant message
    pub async fn add_assistant_message(&self, session_id: &str, content: &str) {
        let mut memory = self.memory.write().await;
        if let Some(session) = memory.get_session_mut(session_id) {
            session.add_message(ChatMessage::assistant(content));
        }
    }

    /// Get conversation history for prompt building
    pub async fn get_history(&self, session_id: &str) -> Vec<ChatMessage> {
        let memory = self.memory.read().await;
        memory
            .get_session(session_id)
            .map(|s| s.messages.clone())
            .unwrap_or_default()
    }

    /// Clear conversation history for a session (but keep the session)
    pub async fn clear_history(&self, session_id: &str) {
        let mut memory = self.memory.write().await;
        if let Some(session) = memory.get_session_mut(session_id) {
            session.messages.clear();
            session.title = None;
        }
    }
}

// =============================================================================
// SESSION SUMMARY
// =============================================================================

/// Summary information about a session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: Option<String>,
    pub message_count: usize,
    pub created_at: i64,
    pub updated_at: i64,
}

// =============================================================================
// PROMPT BUILDER
// =============================================================================

/// Builds prompts with conversation context
pub struct PromptBuilder {
    system_prompt: String,
    max_context_messages: usize,
}

impl PromptBuilder {
    /// Create a new prompt builder
    pub fn new(system_prompt: &str) -> Self {
        Self {
            system_prompt: system_prompt.to_string(),
            max_context_messages: 10,
        }
    }

    /// Set maximum context messages
    pub fn with_max_context(mut self, max: usize) -> Self {
        self.max_context_messages = max;
        self
    }

    /// Build a prompt from conversation history
    ///
    /// Returns a formatted string suitable for the LLM with conversation context.
    pub fn build(&self, messages: &[ChatMessage], long_term_context: Option<&str>) -> String {
        let mut parts = Vec::new();

        // System prompt first
        parts.push(format!("System: {}", self.system_prompt));

        // Add long-term memory context if available
        if let Some(context) = long_term_context {
            if !context.is_empty() {
                parts.push(format!(
                    "\nRelevant context from memory:\n{}",
                    context
                ));
            }
        }

        // Add conversation history (last N messages)
        let start_idx = messages.len().saturating_sub(self.max_context_messages);
        for msg in &messages[start_idx..] {
            match msg.role.as_str() {
                "user" => parts.push(format!("\nUser: {}", msg.content)),
                "assistant" => parts.push(format!("\nAssistant: {}", msg.content)),
                "tool" => {
                    if let Some(tool_name) = &msg.tool_name {
                        parts.push(format!("\nTool ({}): {}", tool_name, msg.content));
                    }
                }
                _ => {}
            }
        }

        // Add prompt for assistant response
        parts.push("\nAssistant:".to_string());

        parts.join("")
    }

    /// Build a prompt for the llama-cpp-2 chat template format
    ///
    /// Returns messages in the format expected by apply_chat_template.
    pub fn build_chat_messages(
        &self,
        messages: &[ChatMessage],
        long_term_context: Option<&str>,
    ) -> Vec<(String, String)> {
        let mut chat_messages = Vec::new();

        // Build enhanced system prompt with long-term context
        let mut system_content = self.system_prompt.clone();
        if let Some(context) = long_term_context {
            if !context.is_empty() {
                system_content.push_str(&format!(
                    "\n\nRelevant context from memory:\n{}",
                    context
                ));
            }
        }
        chat_messages.push(("system".to_string(), system_content));

        // Add conversation history
        let start_idx = messages.len().saturating_sub(self.max_context_messages);
        for msg in &messages[start_idx..] {
            match msg.role.as_str() {
                "user" => {
                    chat_messages.push(("user".to_string(), msg.content.clone()));
                }
                "assistant" => {
                    chat_messages.push(("assistant".to_string(), msg.content.clone()));
                }
                "tool" => {
                    // Include tool results as part of the conversation
                    if let Some(tool_name) = &msg.tool_name {
                        chat_messages.push((
                            "user".to_string(),
                            format!("[Tool Result from {}]: {}", tool_name, msg.content),
                        ));
                    }
                }
                _ => {}
            }
        }

        chat_messages
    }
}

impl Default for PromptBuilder {
    fn default() -> Self {
        Self::new("You are CoolDesk AI, a helpful desktop assistant. Be concise and helpful.")
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prompt_builder() {
        let builder = PromptBuilder::new("You are a helpful assistant.");

        let messages = vec![
            ChatMessage::user("Hello"),
            ChatMessage::assistant("Hi there!"),
            ChatMessage::user("How are you?"),
        ];

        let prompt = builder.build(&messages, None);

        assert!(prompt.contains("You are a helpful assistant"));
        assert!(prompt.contains("User: Hello"));
        assert!(prompt.contains("Assistant: Hi there!"));
        assert!(prompt.contains("User: How are you?"));
    }

    #[test]
    fn test_prompt_builder_with_context() {
        let builder = PromptBuilder::new("Assistant");

        let messages = vec![ChatMessage::user("What's my preference?")];

        let prompt = builder.build(&messages, Some("User prefers dark mode"));

        assert!(prompt.contains("User prefers dark mode"));
    }

    #[test]
    fn test_chat_messages_format() {
        let builder = PromptBuilder::new("System prompt");

        let messages = vec![
            ChatMessage::user("Hello"),
            ChatMessage::assistant("Hi!"),
        ];

        let chat_msgs = builder.build_chat_messages(&messages, None);

        assert_eq!(chat_msgs.len(), 3); // system + user + assistant
        assert_eq!(chat_msgs[0].0, "system");
        assert_eq!(chat_msgs[1].0, "user");
        assert_eq!(chat_msgs[2].0, "assistant");
    }
}
