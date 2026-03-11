/// Chat with the loaded LLM model
pub async fn chat(prompt: &str) -> Result<String, String> {
    super::engine::engine_chat(prompt.to_string(), 2048).await
}

/// Chat with streaming (placeholder - returns full response for now)
pub async fn chat_stream(_prompt: &str) -> Result<(), String> {
    Ok(())
}

/// Get text embedding (placeholder)
pub async fn get_embedding(_text: &str) -> Result<Vec<f32>, String> {
    Ok(vec![0.0; 128])
}
