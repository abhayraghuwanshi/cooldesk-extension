//! LLM Client for v2
//!
//! Wraps the llama-cpp-2 engine to provide a higher-level chat interface
//! with conversation history support.

use super::conversation::PromptBuilder;
use super::memory::ChatMessage;
use crate::sidecar::llm::engine;

// =============================================================================
// LOCAL LLAMA CLIENT
// =============================================================================

/// Client wrapper for the local llama-cpp-2 engine
pub struct LocalLlamaClient {
    /// Default max tokens for generation
    max_tokens: u32,
}

impl LocalLlamaClient {
    /// Create a new client with default settings
    pub fn new() -> Self {
        Self { max_tokens: 2048 }
    }

    /// Set the maximum tokens for generation
    pub fn with_max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    /// Send a chat request with conversation history
    ///
    /// Takes a list of messages and returns the assistant's response.
    pub async fn chat(&self, messages: &[ChatMessage], system_prompt: &str) -> Result<String, String> {
        let prompt_builder = PromptBuilder::new(system_prompt);
        let prompt = prompt_builder.build(messages, None);

        engine::engine_chat(prompt, self.max_tokens).await
    }

    /// Send a chat request with long-term memory context
    pub async fn chat_with_context(
        &self,
        messages: &[ChatMessage],
        system_prompt: &str,
        long_term_context: Option<&str>,
    ) -> Result<String, String> {
        let prompt_builder = PromptBuilder::new(system_prompt);
        let prompt = prompt_builder.build(messages, long_term_context);

        engine::engine_chat(prompt, self.max_tokens).await
    }

    /// Send a simple prompt without history
    pub async fn complete(&self, prompt: &str) -> Result<String, String> {
        engine::engine_chat(prompt.to_string(), self.max_tokens).await
    }

    /// Check if a model is loaded
    pub async fn is_model_loaded() -> Result<bool, String> {
        let status = crate::sidecar::llm::models::get_status().await?;
        Ok(status.model_loaded)
    }
}

impl Default for LocalLlamaClient {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

/// Response from a chat request
#[derive(Debug, Clone)]
pub struct ChatResponse {
    /// The assistant's response text
    pub content: String,
    /// Whether tools were called (for future use)
    pub tool_calls: Option<Vec<ParsedToolCall>>,
}

impl ChatResponse {
    pub fn text(content: String) -> Self {
        Self {
            content,
            tool_calls: None,
        }
    }

    pub fn with_tools(content: String, tool_calls: Vec<ParsedToolCall>) -> Self {
        Self {
            content,
            tool_calls: Some(tool_calls),
        }
    }
}

/// A parsed tool call from the model's response
#[derive(Debug, Clone)]
pub struct ParsedToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

// =============================================================================
// TOOL CALL PARSER
// =============================================================================

/// Parser for extracting tool calls from model responses
pub struct ToolCallParser;

impl ToolCallParser {
    /// Parse tool calls from a response string
    ///
    /// Looks for patterns like:
    /// - `<tool>tool_name</tool><args>{"key": "value"}</args>`
    /// - `[TOOL: tool_name]({"key": "value"})`
    /// - JSON with "tool_call" field
    pub fn parse(response: &str) -> Option<Vec<ParsedToolCall>> {
        // Try XML-style format
        if let Some(calls) = Self::parse_xml_format(response) {
            return Some(calls);
        }

        // Try markdown-style format
        if let Some(calls) = Self::parse_markdown_format(response) {
            return Some(calls);
        }

        // Try JSON format
        if let Some(calls) = Self::parse_json_format(response) {
            return Some(calls);
        }

        None
    }

    fn parse_xml_format(response: &str) -> Option<Vec<ParsedToolCall>> {
        let mut calls = Vec::new();

        // Standard tags
        let tool_start = "<tool>";
        let tool_end = "</tool>";
        let args_start = "<args>";
        let args_end = "</args>";

        let mut remaining = response;
        while let Some(ts) = remaining.find(tool_start) {
            let start_of_tool_content = ts + tool_start.len();
            let after_ts = &remaining[start_of_tool_content..];
            
            if let Some(te) = after_ts.find(tool_end) {
                let tool_name = after_ts[..te].trim();
                let after_te = &after_ts[te + tool_end.len()..];

                if let Some(as_) = after_te.find(args_start) {
                    let after_as = &after_te[as_ + args_start.len()..];
                    if let Some(ae) = after_as.find(args_end) {
                        let mut args_str = after_as[..ae].trim().to_string();
                        
                        // Handle fancy quotes (Smart Quotes) generated by some LLMs
                        args_str = args_str.replace('“', "\"").replace('”', "\"").replace('‘', "'").replace('’', "'");
                        
                        // Clean up escaped characters if they were double-escaped
                        if args_str.contains("\\\"") {
                             args_str = args_str.replace("\\\"", "\"");
                        }

                        if let Ok(args) = serde_json::from_str(&args_str) {
                            calls.push(ParsedToolCall {
                                name: tool_name.to_string(),
                                arguments: args,
                            });
                        } else {
                            // Last ditch: if it's not JSON, maybe it's just a raw query string
                            // Some models just put the query in the args tag instead of JSON
                            calls.push(ParsedToolCall {
                                name: tool_name.to_string(),
                                arguments: serde_json::json!({ "query": args_str }),
                            });
                        }
                        remaining = &after_as[ae + args_end.len()..];
                        continue;
                    }
                }
            }
            break;
        }

        if calls.is_empty() {
            None
        } else {
            Some(calls)
        }
    }

    fn parse_markdown_format(response: &str) -> Option<Vec<ParsedToolCall>> {
        let mut calls = Vec::new();

        // Look for [TOOL: name](args) pattern
        let pattern = "[TOOL:";
        let mut remaining = response;

        while let Some(start) = remaining.find(pattern) {
            let after_pattern = &remaining[start + pattern.len()..];
            if let Some(name_end) = after_pattern.find(']') {
                let tool_name = after_pattern[..name_end].trim();
                let after_name = &after_pattern[name_end + 1..];

                if after_name.starts_with('(') {
                    if let Some(args_end) = after_name.find(')') {
                        let args_str = &after_name[1..args_end];
                        if let Ok(args) = serde_json::from_str(args_str) {
                            calls.push(ParsedToolCall {
                                name: tool_name.to_string(),
                                arguments: args,
                            });
                        }
                        remaining = &after_name[args_end + 1..];
                        continue;
                    }
                }
            }
            break;
        }

        if calls.is_empty() {
            None
        } else {
            Some(calls)
        }
    }

    fn parse_json_format(response: &str) -> Option<Vec<ParsedToolCall>> {
        // Try to parse the entire response as JSON with tool_calls
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(response) {
            if let Some(tool_calls) = json.get("tool_calls").and_then(|v| v.as_array()) {
                let calls: Vec<ParsedToolCall> = tool_calls
                    .iter()
                    .filter_map(|tc| {
                        let name = tc.get("name")?.as_str()?;
                        let arguments = tc.get("arguments").cloned().unwrap_or(serde_json::json!({}));
                        Some(ParsedToolCall {
                            name: name.to_string(),
                            arguments,
                        })
                    })
                    .collect();

                if !calls.is_empty() {
                    return Some(calls);
                }
            }
        }

        None
    }

    /// Extract the text response (without tool calls) from a response
    pub fn extract_text(response: &str) -> String {
        // Remove tool call markers and return clean text
        let mut text = response.to_string();

        // Remove XML-style tool calls
        while let Some(start) = text.find("<tool>") {
            if let Some(end_marker_start) = text[start..].find("</args>") {
                let end = start + end_marker_start + "</args>".len();
                text.replace_range(start..end, "");
            } else if let Some(end_marker_start) = text[start..].find("</tool>") {
                 // Handle cases where <args> might be missing or broken
                let end = start + end_marker_start + "</tool>".len();
                 text.replace_range(start..end, "");
            } else {
                break;
            }
        }
        
        // Remove XML-style thoughts
        while let Some(start) = text.find("<thought>") {
            if let Some(end_marker_start) = text[start..].find("</thought>") {
                let end = start + end_marker_start + "</thought>".len();
                text.replace_range(start..end, "");
            } else {
                // If it forgot to close the thought block, remove everything till the end
                text.replace_range(start.., "");
                break;
            }
        }

        // Remove markdown-style tool calls
        while let Some(start) = text.find("[TOOL:") {
            if let Some(paren_start_rel) = text[start..].find('(') {
                let paren_start = start + paren_start_rel;
                if let Some(paren_end_rel) = text[paren_start..].find(')') {
                    let end = paren_start + paren_end_rel + 1;
                    text.replace_range(start..end, "");
                    continue;
                }
            }
            // If no closing paren, just remove the TOOL tag
            if let Some(tag_end_rel) = text[start..].find(']') {
                let end = start + tag_end_rel + 1;
                text.replace_range(start..end, "");
                continue;
            }
            break;
        }

        text.trim().to_string()
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xml_tool_parsing() {
        let response = r#"I'll search for that. <tool>search_workspaces</tool><args>{"query": "rust"}</args> Here are the results."#;

        let calls = ToolCallParser::parse(response);
        assert!(calls.is_some());

        let calls = calls.unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "search_workspaces");
    }

    #[test]
    fn test_extract_text() {
        let response = r#"I'll search for that. <tool>search</tool><args>{}</args> Done!"#;
        let text = ToolCallParser::extract_text(response);
        assert_eq!(text, "I'll search for that.  Done!");
    }

    #[test]
    fn test_no_tool_calls() {
        let response = "This is just a regular response without any tool calls.";
        let calls = ToolCallParser::parse(response);
        assert!(calls.is_none());
    }
}
