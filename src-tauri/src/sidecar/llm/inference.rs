/// Chat with the loaded LLM model
pub async fn chat(_prompt: &str) -> Result<String, String> {
    #[cfg(feature = "llm")]
    return super::engine::engine_chat(_prompt.to_string(), 2048).await;
    #[cfg(not(feature = "llm"))]
    Err("LLM feature not compiled in this build".to_string())
}
