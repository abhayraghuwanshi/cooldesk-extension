// Centralized prompt templates for the extension
// Add new prompt builders here to keep background.js lean and maintainable

/**
 * Build the enrichment/classification prompt for a given URL.
 * @param {number} minutesSpent - Whole minutes the user spent on the site (context).
 * @param {string} cleaned - Normalized URL (scheme + eTLD+1).
 * @returns {string}
 */
export function buildEnrichmentPrompt(minutesSpent, cleaned) {
    return `ROLE:\nYou are an expert assistant for developer productivity tools.\n\nTASK:\nClassify the URL and propose a helpful next action. Use the site time context: ${minutesSpent} minutes.\n\nCONSTRAINTS:\n- Return ONLY a single JSON object. No prose, no markdown, no code fences.\n- Keys and values must be valid JSON. No trailing commas.\n- "primary_category" must be one item from Category List.\n- "secondary_categories" may be empty or multiple items from Category List.\n- "workspace_group" must be one item from Workspace List.\n- "suggested_tags" must be 3-5 lowercase keywords.\n- "suggestion" must be <= 140 chars, imperative, and user-centric.\n\nCATEGORY LIST:\nSource Control & Versioning | Cloud & Infrastructure | Code Assistance & AI Coding | Documentation & Knowledge Search | Testing & QA Automation | Project Management & Collaboration | Data Analysis & Visualization | DevOps & CI/CD | UI/UX & Design | APIs & Integrations | Learning & Upskilling | AI & Machine Learning | Security & Compliance | Monitoring & Observability | Local Development & Environments | Package Management | Database Management | Communication\n\nWORKSPACE LIST:\nCode & Versioning | Cloud & Infrastructure | AI & ML | DevOps & Automation | Testing & Quality | Data & Analytics | Design & UX | Project & Team\n\nOUTPUT SCHEMA (JSON):\n{\n  "tool_name": string,\n  "primary_category": string,\n  "secondary_categories": string[],\n  "workspace_group": string,\n  "justification": string,\n  "suggested_tags": string[],\n  "suggestion": string\n}\n\nINPUT URL:\n${cleaned}`;
}

export function buildEnrichmentPromptForWorkspace(workspace, urls) {
    const prompt = `You are a senior software developer specializing in building organized, maintainable systems for categorizing and tagging resources.
    
    I will send you a list of URLs.
    Your task is to:
    
    1. Indicate whether the URL belongs to my workspace category "${workspace}" (Yes/No).
    2. Output **only** valid JSON (no extra text), as an array of objects with the following fields:
       {
         "url": "<URL>",
         "included": true/false
       }
    
    Rules:
    - Be consistent in category naming (reuse exact wording if it applies to multiple URLs).
    - If a URL can belong to multiple categories, choose the most relevant one.
    - If unsure, make the best guess based on the domain name or context.
    - Never add comments or explanations, only JSON.
    
    Example Input:
    ${urls.join('\n')}
    
    Example Output:
    [
      { "url": "<URL>", "included": true },
      { "url": "<URL>", "included": false },
      { "url": "<URL>", "included": false }
    ]
    `;
    return prompt;

}


