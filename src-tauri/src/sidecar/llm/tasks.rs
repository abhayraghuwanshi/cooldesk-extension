/// Summarize text using the loaded LLM
pub async fn summarize(text: &str, max_length: usize) -> Result<String, String> {
    let prompt = format!(
        r#"Summarize the following text concisely.

RULES:
1. Use exactly {max_length} sentence(s) or fewer
2. Focus on the main point or key takeaway
3. Be direct - no filler words like "This article discusses..."
4. Keep technical terms if relevant

TEXT:
{text}

SUMMARY:"#,
        max_length = max_length,
        text = text
    );
    super::inference::chat(&prompt).await
}

/// Categorize a URL/page into one of the given categories
pub async fn categorize(title: &str, url: &str, categories: Vec<String>) -> Result<String, String> {
    // Build category list with indices for clarity
    let category_list = categories
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{}. {}", i + 1, c))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        r#"You are a URL categorizer. Analyze the title and URL to determine the best category.

AVAILABLE CATEGORIES:
{category_list}

EXAMPLES:
- "React Hooks Tutorial - reactjs.org" → Development
- "Nike Air Max 90 - nike.com/shoes/air-max" → Shopping
- "How to Make Pasta - YouTube" → Entertainment
- "JIRA-1234: Fix login bug - atlassian.net" → Work
- "GitHub - facebook/react: A JavaScript library" → Development
- "Amazon.com: Wireless Mouse" → Shopping
- "Netflix - Watch TV Shows Online" → Entertainment
- "Google Docs - Quarterly Report" → Work
- "Stack Overflow - How to center a div" → Development
- "Spotify - Web Player" → Entertainment

RULES:
1. Return ONLY the exact category name from the list above
2. Match based on the domain AND title content
3. If truly ambiguous, pick the most likely category

Title: {title}
URL: {url}

Category:"#,
        category_list = category_list,
        title = title,
        url = url
    );

    let response = super::inference::chat(&prompt).await?;

    // Clean and match the response
    let raw_response = response.trim();

    // Try exact match first (case-insensitive)
    if let Some(cat) = categories.iter().find(|c| c.eq_ignore_ascii_case(raw_response)) {
        return Ok(cat.clone());
    }

    // Try partial match (response contains category name)
    for cat in &categories {
        if raw_response.to_lowercase().contains(&cat.to_lowercase()) {
            return Ok(cat.clone());
        }
    }

    // Try matching category number (e.g., "1" or "1.")
    let cleaned = raw_response.trim_end_matches('.').trim();
    if let Ok(num) = cleaned.parse::<usize>() {
        if num >= 1 && num <= categories.len() {
            return Ok(categories[num - 1].clone());
        }
    }

    // Fallback to first category or "Other" if available
    Ok(categories
        .iter()
        .find(|c| c.eq_ignore_ascii_case("other"))
        .cloned()
        .unwrap_or_else(|| categories.first().cloned().unwrap_or_else(|| "Unknown".to_string())))
}

/// Answer a question about content
pub async fn answer_question(question: &str, content: &str) -> Result<String, String> {
    let prompt = format!(
        "Based on the following content, answer the question.\n\nContent:\n{}\n\nQuestion: {}\n\nAnswer:",
        content, question
    );
    super::inference::chat(&prompt).await
}

/// Group browsing items or project ideas into smart workspace categories
/// Returns JSON with groups and suggestions
pub async fn group_workspaces(items: &str, context: &str, custom_prompt: Option<&str>) -> Result<String, String> {
    let instruction = if let Some(prompt) = custom_prompt {
        format!(
            r#"{prompt}

{context}

Here are the items to organize:
{items}

Return ONLY a valid JSON object with this EXACT format — no other keys, no markdown fences:
{{
  "groups": [
    {{
      "name": "Project Name",
      "description": "Short 1-sentence description",
      "items": [1, 3, 5]
    }}
  ],
  "suggestions": ["Optional tip for the user"]
}}

JSON:"#,
            prompt = prompt,
            context = context,
            items = items
        )
    } else {
        format!(
            r#"You are an expert project manager and researcher.
Your goal is to organize a list of items (URLs, notes, or project ideas) into logical, focused project workspaces.

Context: {}

Organize these items into 3-6 distinct project categories. Think deeply about the relationship between items.
If an item doesn't fit a clear group, create an "Inbox" or "Misc" group.

Return ONLY a valid JSON object with the exact format below:
{{
  "groups": [
    {{
      "name": "Project Name (Concise, e.g., 'Web Design Research')",
      "description": "Short 1-sentence description of the project goal",
      "items": [1, 5, 8] // The 1-based indices from the input list
    }}
  ],
  "suggestions": [
    "A helpful recommendation for the user (e.g., 'Check GitHub for similar repos', 'Read more about X')"
  ]
}}

Items to organize:
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

/// Enhance a URL with a better title, description, and tags
pub async fn enhance_url(title: &str, url: &str, content_hint: Option<&str>) -> Result<String, String> {
    let context = content_hint.unwrap_or("No content provided");
    let prompt = format!(
        r#"Enhance the following URL information for a productivity dashboard.
URL: {}
Current Title: {}
Page Content/Hint: {}

Generate a professional, concise title, a 1-sentence description, and 3-5 relevant tags.
Return ONLY a valid JSON object:
{{
  "title": "Cleaned & Better Title",
  "description": "What this page is actually about in 1 sentence.",
  "tags": ["productivity", "tools", "design"],
  "category": "One optimal category name"
}}

JSON:"#,
        url, title, context
    );
    
    let response = super::inference::chat(&prompt).await?;
    
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

/// Suggest workspace names based on a list of URLs
pub async fn suggest_workspaces(urls_json: &str) -> Result<String, String> {
    let prompt = format!(
        r#"Analyze these browser tabs and suggest 3-5 cohesive workspace/project names.
Tabs:
{}

Return ONLY a JSON array of names:
["Project Alpha", "Researching X", "Personal Portfolio"]

JSON:"#,
        urls_json
    );
    super::inference::chat(&prompt).await
}

/// Parse a natural language command into structured action
pub async fn parse_command(command: &str, context: &str) -> Result<String, String> {
    let prompt = format!(
        r#"Parse the following user command for a productivity assistant.
Context: {}
Command: "{}"

Determine the intent and parameters.
Return ONLY a valid JSON object:
{{
  "intent": "create_workspace|add_url|search|summarize|other",
  "params": {{}},
  "thought": "Short explanation of your reasoning"
}}

JSON:"#,
        context, command
    );
    super::inference::chat(&prompt).await
}

/// Group workspaces with feedback-enhanced suggestions
/// Uses learned URL affinities and patterns to improve grouping
pub async fn group_workspaces_with_feedback(
    items: &str,
    context: &str,
    url_affinities: Option<&[(String, String, f64)]>,
    workspace_suggestions: Option<&[(String, f64)]>,
) -> Result<String, String> {
    // Build enhanced context with learned patterns
    let mut enhanced_context = context.to_string();

    // Add learned affinities hint
    if let Some(affinities) = url_affinities {
        if !affinities.is_empty() {
            let affinity_hints: Vec<String> = affinities
                .iter()
                .filter(|(_, _, score)| *score > 0.5)
                .take(5)
                .map(|(u1, u2, score)| {
                    format!("- {} and {} are often grouped together (score: {:.2})",
                        extract_domain(u1), extract_domain(u2), score)
                })
                .collect();

            if !affinity_hints.is_empty() {
                enhanced_context.push_str("\n\nLearned URL patterns:\n");
                enhanced_context.push_str(&affinity_hints.join("\n"));
            }
        }
    }

    // Add workspace suggestion hints
    if let Some(suggestions) = workspace_suggestions {
        if !suggestions.is_empty() {
            let suggestion_hints: Vec<String> = suggestions
                .iter()
                .take(3)
                .map(|(name, score)| format!("- \"{}\" (confidence: {:.2})", name, score))
                .collect();

            enhanced_context.push_str("\n\nSuggested workspace names based on history:\n");
            enhanced_context.push_str(&suggestion_hints.join("\n"));
        }
    }

    // Call the regular grouping with enhanced context
    group_workspaces(items, &enhanced_context, None).await
}

/// Helper to extract domain from URL for display
fn extract_domain(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_else(|| url.to_string())
}
