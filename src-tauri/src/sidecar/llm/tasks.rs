/// Summarize text using the loaded LLM
pub async fn summarize(text: &str, max_length: usize) -> Result<String, String> {
    let prompt = format!(
        "Summarize the following text in {} sentences or less. Be concise and capture the main points:\n\n{}\n\nSummary:",
        max_length, text
    );
    super::inference::chat(&prompt).await
}

/// Categorize a URL/page into one of the given categories
pub async fn categorize(title: &str, url: &str, categories: Vec<String>) -> Result<String, String> {
    let prompt = format!(
        "Categorize the following webpage into one of these categories: {}\n\nTitle: {}\nURL: {}\n\nRespond with ONLY the category name, nothing else.\n\nCategory:",
        categories.join(", "), title, url
    );
    let response = super::inference::chat(&prompt).await?;
    let category = response.trim().to_lowercase();
    Ok(categories
        .iter()
        .find(|c| c.to_lowercase() == category)
        .cloned()
        .unwrap_or_else(|| "unknown".to_string()))
}

/// Answer a question about content
pub async fn answer_question(question: &str, content: &str) -> Result<String, String> {
    let prompt = format!(
        "Based on the following content, answer the question.\n\nContent:\n{}\n\nQuestion: {}\n\nAnswer:",
        content, question
    );
    super::inference::chat(&prompt).await
}
