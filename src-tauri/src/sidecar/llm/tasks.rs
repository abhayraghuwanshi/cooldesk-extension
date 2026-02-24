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

/// Group browsing items into smart workspace categories
/// Returns JSON with groups and suggestions
pub async fn group_workspaces(items: &str, context: &str, custom_prompt: Option<&str>) -> Result<String, String> {
    let instruction = if let Some(prompt) = custom_prompt {
        format!(
            "{}\n\n{}\n\nHere are the user's browsing items:\n{}\n\nRespond with ONLY a valid JSON object. Do NOT wrap the JSON in markdown blocks (e.g. ```json).",
            prompt, context, items
        )
    } else {
        format!(
            r#"You are organizing a user's browsing activity into smart workspace groups.
{}

Group these browsing items into 4-8 project/topic categories based on their relevance.
If external context is provided, prioritize grouping items that relate to that context.
Return ONLY ONE valid JSON object with the exact format below. Do NOT wrap the JSON in markdown blocks and do NOT return multiple objects.

{{
  "groups": [
    {{
      "name": "Group Name",
      "items": [1, 2, 3]
    }}
  ],
  "suggestions": [
    "helpful suggestion 1"
  ]
}}

Items:
{}

JSON:"#,
            context, items
        )
    };

    let response = super::inference::chat(&instruction).await?;
    
    // Clean up markdown wrapping if the LLM still includes it
    let mut cleaned = response.trim();
    if cleaned.starts_with("```json") {
        cleaned = cleaned.trim_start_matches("```json").trim();
    } else if cleaned.starts_with("```") {
        cleaned = cleaned.trim_start_matches("```").trim();
    }
    if cleaned.ends_with("```") {
        cleaned = cleaned.trim_end_matches("```").trim();
    }

    Ok(cleaned.to_string())
}

/// Suggest related URLs/resources based on current workspace context
pub async fn suggest_related(workspace_urls: &str, history: &str) -> Result<String, String> {
    let prompt = format!(
        r#"Based on the user's current workspace URLs and browsing history, suggest 3-5 related resources they might find useful.

Current Workspace URLs:
{}

Recent History:
{}

Return ONLY a JSON array of suggestions:
[{{"title":"Suggested Resource","reason":"Why this is relevant"}}]

JSON:"#,
        workspace_urls, history
    );
    super::inference::chat(&prompt).await
}
