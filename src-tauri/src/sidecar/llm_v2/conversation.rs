//! Conversation Management for LLM v2
//!
//! Prompt building utilities for LLM conversations.

use super::memory::ChatMessage;

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
}
