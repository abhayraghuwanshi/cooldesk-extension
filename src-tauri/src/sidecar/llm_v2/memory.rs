//! Memory Management for LLM v2
//!
//! Handles both short-term (session) and long-term (persistent) memory.
//!
//! Note: Some functions are kept for future use but currently unused.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Maximum messages to keep in a conversation session (rolling window)
const DEFAULT_MAX_MESSAGES: usize = 20;

/// Maximum facts to keep in long-term memory
const MAX_LONG_TERM_FACTS: usize = 100;

// =============================================================================
// CHAT MESSAGE
// =============================================================================

/// A single message in a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// Unique message ID
    pub id: String,
    /// Role: "user", "assistant", "system", or "tool"
    pub role: String,
    /// Message content
    pub content: String,
    /// When the message was created
    pub timestamp: i64,
    /// Tool calls made by the assistant (if any)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    /// Tool result (if this is a tool response)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_result: Option<String>,
    /// Name of the tool (for tool messages)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
}

impl ChatMessage {
    /// Create a new user message
    pub fn user(content: &str) -> Self {
        Self {
            id: generate_id(),
            role: "user".to_string(),
            content: content.to_string(),
            timestamp: Utc::now().timestamp_millis(),
            tool_calls: None,
            tool_result: None,
            tool_name: None,
        }
    }

    /// Create a new assistant message
    pub fn assistant(content: &str) -> Self {
        Self {
            id: generate_id(),
            role: "assistant".to_string(),
            content: content.to_string(),
            timestamp: Utc::now().timestamp_millis(),
            tool_calls: None,
            tool_result: None,
            tool_name: None,
        }
    }

    /// Create a new assistant message with tool calls
    #[allow(dead_code)]
    pub fn assistant_with_tools(content: &str, tool_calls: Vec<ToolCall>) -> Self {
        Self {
            id: generate_id(),
            role: "assistant".to_string(),
            content: content.to_string(),
            timestamp: Utc::now().timestamp_millis(),
            tool_calls: Some(tool_calls),
            tool_result: None,
            tool_name: None,
        }
    }

    /// Create a new system message
    #[allow(dead_code)]
    pub fn system(content: &str) -> Self {
        Self {
            id: generate_id(),
            role: "system".to_string(),
            content: content.to_string(),
            timestamp: Utc::now().timestamp_millis(),
            tool_calls: None,
            tool_result: None,
            tool_name: None,
        }
    }

    /// Create a tool result message
    pub fn tool_response(tool_name: &str, result: &str) -> Self {
        Self {
            id: generate_id(),
            role: "tool".to_string(),
            content: result.to_string(),
            timestamp: Utc::now().timestamp_millis(),
            tool_calls: None,
            tool_result: Some(result.to_string()),
            tool_name: Some(tool_name.to_string()),
        }
    }
}

// =============================================================================
// TOOL CALL
// =============================================================================

/// Represents a tool call made by the assistant
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    /// Tool call ID
    pub id: String,
    /// Name of the tool
    pub name: String,
    /// Arguments as JSON string
    pub arguments: String,
}

impl ToolCall {
    #[allow(dead_code)]
    pub fn new(name: &str, arguments: &str) -> Self {
        Self {
            id: generate_id(),
            name: name.to_string(),
            arguments: arguments.to_string(),
        }
    }
}

// =============================================================================
// CONVERSATION SESSION
// =============================================================================

/// A conversation session containing message history
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSession {
    /// Unique session ID
    pub id: String,
    /// Optional title for the session
    pub title: Option<String>,
    /// Messages in the session
    pub messages: Vec<ChatMessage>,
    /// When the session was created
    pub created_at: i64,
    /// When the session was last updated
    pub updated_at: i64,
    /// Maximum messages to keep (rolling window)
    #[serde(default = "default_max_messages")]
    pub max_messages: usize,
}

fn default_max_messages() -> usize {
    DEFAULT_MAX_MESSAGES
}

impl ConversationSession {
    /// Create a new empty session
    pub fn new() -> Self {
        let now = Utc::now().timestamp_millis();
        Self {
            id: generate_id(),
            title: None,
            messages: Vec::new(),
            created_at: now,
            updated_at: now,
            max_messages: DEFAULT_MAX_MESSAGES,
        }
    }

    /// Create a new session with a specific ID
    pub fn with_id(id: &str) -> Self {
        let now = Utc::now().timestamp_millis();
        Self {
            id: id.to_string(),
            title: None,
            messages: Vec::new(),
            created_at: now,
            updated_at: now,
            max_messages: DEFAULT_MAX_MESSAGES,
        }
    }

    /// Add a message to the session
    pub fn add_message(&mut self, message: ChatMessage) {
        self.messages.push(message);
        self.updated_at = Utc::now().timestamp_millis();

        // Trim to max messages (keep most recent)
        if self.messages.len() > self.max_messages {
            let remove_count = self.messages.len() - self.max_messages;
            self.messages.drain(0..remove_count);
        }
    }

    /// Get messages for context building (excludes system messages for counting)
    #[allow(dead_code)]
    pub fn get_context_messages(&self) -> Vec<&ChatMessage> {
        self.messages.iter().collect()
    }

    /// Generate a title from the first user message
    pub fn generate_title(&mut self) {
        if self.title.is_none() {
            if let Some(first_user_msg) = self.messages.iter().find(|m| m.role == "user") {
                // Take first 50 chars of first user message
                let title: String = first_user_msg
                    .content
                    .chars()
                    .take(50)
                    .collect();
                self.title = Some(if title.len() < first_user_msg.content.len() {
                    format!("{}...", title)
                } else {
                    title
                });
            }
        }
    }
}

impl Default for ConversationSession {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// LONG-TERM MEMORY
// =============================================================================

/// A fact stored in long-term memory
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFact {
    /// Unique fact ID
    pub id: String,
    /// The fact content
    pub content: String,
    /// Source conversation ID (if applicable)
    pub source: Option<String>,
    /// Category/tag for the fact
    pub category: Option<String>,
    /// When the fact was created
    pub created_at: i64,
}

impl MemoryFact {
    pub fn new(content: &str, source: Option<&str>, category: Option<&str>) -> Self {
        Self {
            id: generate_id(),
            content: content.to_string(),
            source: source.map(String::from),
            category: category.map(String::from),
            created_at: Utc::now().timestamp_millis(),
        }
    }
}

/// Long-term memory storage
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LongTermMemory {
    /// Stored facts about the user and context
    pub facts: Vec<MemoryFact>,
    /// When memory was last updated
    pub updated_at: i64,
}

impl LongTermMemory {
    pub fn new() -> Self {
        Self {
            facts: Vec::new(),
            updated_at: Utc::now().timestamp_millis(),
        }
    }

    /// Add a fact to memory
    pub fn add_fact(&mut self, fact: MemoryFact) {
        self.facts.push(fact);
        self.updated_at = Utc::now().timestamp_millis();

        // Trim oldest facts if over limit
        if self.facts.len() > MAX_LONG_TERM_FACTS {
            self.facts.remove(0);
        }
    }

    /// Get facts relevant to a query (simple keyword match for now)
    pub fn get_relevant_facts(&self, query: &str, limit: usize) -> Vec<&MemoryFact> {
        let query_lower = query.to_lowercase();
        let query_words: Vec<&str> = query_lower.split_whitespace().collect();

        let mut scored_facts: Vec<(&MemoryFact, usize)> = self
            .facts
            .iter()
            .map(|fact| {
                let fact_lower = fact.content.to_lowercase();
                let score = query_words
                    .iter()
                    .filter(|word| fact_lower.contains(*word))
                    .count();
                (fact, score)
            })
            .filter(|(_, score)| *score > 0)
            .collect();

        // Sort by score descending
        scored_facts.sort_by(|a, b| b.1.cmp(&a.1));

        scored_facts
            .into_iter()
            .take(limit)
            .map(|(fact, _)| fact)
            .collect()
    }

    /// Get all facts in a category
    #[allow(dead_code)]
    pub fn get_facts_by_category(&self, category: &str) -> Vec<&MemoryFact> {
        self.facts
            .iter()
            .filter(|f| f.category.as_deref() == Some(category))
            .collect()
    }
}

// =============================================================================
// MEMORY MANAGER
// =============================================================================

/// Main memory manager handling both short-term and long-term memory
pub struct MemoryManager {
    /// Active conversation sessions (short-term)
    sessions: HashMap<String, ConversationSession>,
    /// Long-term persistent memory
    long_term: LongTermMemory,
    /// Flag indicating if memory was modified since last save
    dirty: bool,
}

impl MemoryManager {
    /// Create a new memory manager
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            long_term: LongTermMemory::new(),
            dirty: false,
        }
    }

    /// Create with existing long-term memory
    #[allow(dead_code)]
    pub fn with_long_term(long_term: LongTermMemory) -> Self {
        Self {
            sessions: HashMap::new(),
            long_term,
            dirty: false,
        }
    }

    // -------------------------------------------------------------------------
    // Session Management
    // -------------------------------------------------------------------------

    /// Create a new conversation session
    pub fn create_session(&mut self) -> String {
        let session = ConversationSession::new();
        let id = session.id.clone();
        self.sessions.insert(id.clone(), session);
        self.dirty = true;
        id
    }

    /// Create a session with a specific ID
    pub fn create_session_with_id(&mut self, id: &str) -> &ConversationSession {
        let session = ConversationSession::with_id(id);
        self.sessions.insert(id.to_string(), session);
        self.dirty = true;
        self.sessions.get(id).unwrap()
    }

    /// Get a session by ID
    pub fn get_session(&self, session_id: &str) -> Option<&ConversationSession> {
        self.sessions.get(session_id)
    }

    /// Get a mutable session by ID
    pub fn get_session_mut(&mut self, session_id: &str) -> Option<&mut ConversationSession> {
        self.dirty = true;
        self.sessions.get_mut(session_id)
    }

    /// Get or create a session
    pub fn get_or_create_session(&mut self, session_id: &str) -> &mut ConversationSession {
        if !self.sessions.contains_key(session_id) {
            self.create_session_with_id(session_id);
        }
        self.dirty = true;
        self.sessions.get_mut(session_id).unwrap()
    }

    /// Add a message to a session
    #[allow(dead_code)]
    pub fn add_message(&mut self, session_id: &str, message: ChatMessage) {
        let session = self.get_or_create_session(session_id);
        session.add_message(message);
        self.dirty = true;
    }

    /// Delete a session
    pub fn delete_session(&mut self, session_id: &str) -> bool {
        let removed = self.sessions.remove(session_id).is_some();
        if removed {
            self.dirty = true;
        }
        removed
    }

    /// List all sessions
    pub fn list_sessions(&self) -> Vec<&ConversationSession> {
        self.sessions.values().collect()
    }

    /// Clear all sessions
    #[allow(dead_code)]
    pub fn clear_sessions(&mut self) {
        self.sessions.clear();
        self.dirty = true;
    }

    // -------------------------------------------------------------------------
    // Long-term Memory
    // -------------------------------------------------------------------------

    /// Add a fact to long-term memory
    pub fn add_fact(&mut self, content: &str, source: Option<&str>, category: Option<&str>) {
        let fact = MemoryFact::new(content, source, category);
        self.long_term.add_fact(fact);
        self.dirty = true;
    }

    /// Get relevant facts for a query
    pub fn get_relevant_facts(&self, query: &str, limit: usize) -> Vec<&MemoryFact> {
        self.long_term.get_relevant_facts(query, limit)
    }

    /// Get all long-term facts
    pub fn get_all_facts(&self) -> &[MemoryFact] {
        &self.long_term.facts
    }

    /// Get the long-term memory
    #[allow(dead_code)]
    pub fn get_long_term_memory(&self) -> &LongTermMemory {
        &self.long_term
    }

    /// Clear all long-term memory
    pub fn clear_long_term_memory(&mut self) {
        self.long_term = LongTermMemory::new();
        self.dirty = true;
    }

    // -------------------------------------------------------------------------
    // Persistence
    // -------------------------------------------------------------------------

    /// Check if memory has been modified
    #[allow(dead_code)]
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Mark memory as clean (after saving)
    #[allow(dead_code)]
    pub fn mark_clean(&mut self) {
        self.dirty = false;
    }

    /// Export sessions for persistence
    pub fn export_sessions(&self) -> Vec<ConversationSession> {
        self.sessions.values().cloned().collect()
    }

    /// Import sessions from persistence
    pub fn import_sessions(&mut self, sessions: Vec<ConversationSession>) {
        for session in sessions {
            self.sessions.insert(session.id.clone(), session);
        }
    }

    /// Export long-term memory for persistence
    pub fn export_long_term(&self) -> &LongTermMemory {
        &self.long_term
    }

    /// Set long-term memory from persistence
    pub fn set_long_term(&mut self, memory: LongTermMemory) {
        self.long_term = memory;
    }
}

impl Default for MemoryManager {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// SHARED MEMORY STATE
// =============================================================================

/// Thread-safe shared memory manager
pub type SharedMemoryManager = Arc<RwLock<MemoryManager>>;

/// Create a new shared memory manager
#[allow(dead_code)]
pub fn create_shared_memory() -> SharedMemoryManager {
    Arc::new(RwLock::new(MemoryManager::new()))
}

// =============================================================================
// HELPERS
// =============================================================================

/// Generate a unique ID
fn generate_id() -> String {
    format!(
        "{}-{}",
        Utc::now().timestamp_millis(),
        rand::random::<u16>()
    )
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_message_creation() {
        let user_msg = ChatMessage::user("Hello");
        assert_eq!(user_msg.role, "user");
        assert_eq!(user_msg.content, "Hello");

        let assistant_msg = ChatMessage::assistant("Hi there!");
        assert_eq!(assistant_msg.role, "assistant");
    }

    #[test]
    fn test_session_message_limit() {
        let mut session = ConversationSession::new();
        session.max_messages = 3;

        for i in 0..5 {
            session.add_message(ChatMessage::user(&format!("Message {}", i)));
        }

        assert_eq!(session.messages.len(), 3);
        assert!(session.messages[0].content.contains("2")); // Oldest kept
    }

    #[test]
    fn test_memory_manager_sessions() {
        let mut manager = MemoryManager::new();

        let session_id = manager.create_session();
        manager.add_message(&session_id, ChatMessage::user("Hello"));
        manager.add_message(&session_id, ChatMessage::assistant("Hi!"));

        let session = manager.get_session(&session_id).unwrap();
        assert_eq!(session.messages.len(), 2);
    }

    #[test]
    fn test_long_term_memory() {
        let mut manager = MemoryManager::new();

        manager.add_fact("User prefers dark mode", None, Some("preferences"));
        manager.add_fact("User works on Rust projects", None, Some("context"));

        let facts = manager.get_relevant_facts("dark mode", 5);
        assert_eq!(facts.len(), 1);
        assert!(facts[0].content.contains("dark mode"));
    }
}
