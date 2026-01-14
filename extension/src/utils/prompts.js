// Centralized prompt templates for the extension
// Add new prompt builders here to keep background.js lean and maintainable

/**
 * Build the enrichment/classification prompt for a given URL.
 * @param {number} minutesSpent - Whole minutes the user spent on the site (context).
 * @param {string} cleaned - Normalized URL (scheme + eTLD+1).
 * @param {object} [opts]
 * @param {string[]} [opts.categoryList] - Optional override for Category List.
 * @param {string[]} [opts.workspaceList] - Optional override for Workspace List.
 * @returns {string}
 */
export function buildEnrichmentPrompt(minutesSpent, cleaned, opts = {}) {
    const defaultWorkspaces = ['Code & Versioning', 'Cloud & Infrastructure', 'AI & ML', 'DevOps & Automation', 'Testing & Quality', 'Data & Analytics', 'Design & UX', 'Project & Team'];
    const wsList = Array.isArray(opts.workspaceList) && opts.workspaceList.length ? opts.workspaceList : defaultWorkspaces;
    const wsDescriptions = (opts && typeof opts.workspaceDescriptions === 'object' && opts.workspaceDescriptions) || {};
    const listWithDesc = wsList.map((w) => {
        const desc = typeof wsDescriptions[w] === 'string' && wsDescriptions[w].trim() ? wsDescriptions[w].trim() : '';
        return desc ? `- ${w}: ${desc}` : `- ${w}`;
    }).join('\n');

    return `ROLE:\nYou help decide which workspaces a URL belongs to.\n\nTASK:\nGiven the input URL (normalized) and the list of available workspaces (with optional descriptions), decide which workspaces this URL should be added to. You may select zero, one, or multiple workspaces.\n\nCONSTRAINTS:\n- Return ONLY a single JSON object. No prose, no markdown, no code fences.\n- Keys and values must be valid JSON. No trailing commas.\n- "workspace_group" must be an array of zero or more items from the workspace list (exact names).\n- "justification" must be a concise one-liner explaining the choice.\n\nWORKSPACE LIST (name: optional description):\n${listWithDesc}\n\nOUTPUT SCHEMA (JSON):\n{\n  "workspace_group": string[],\n  "justification": string\n}\n\nINPUT URL:\n${cleaned}`;
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

/**
 * Build a prompt to suggest a concise list of category/workspace names from a set of URLs.
 * Returns JSON strictly as: { "categories": string[] }
 */
export function buildCategoryListPrompt(urls, { max = 12 } = {}) {
    const capped = (Array.isArray(urls) ? urls : []).slice(0, 150);
    return `You are helping organize browser URLs into a small set of practical categories (which also double as workspaces).\n\nRequirements:\n- Propose between 6 and ${Math.max(6, max)} short, distinct category names.\n- Provide a concise description (<= 12 words) for each category that explains what URLs fit.\n- Names should be reusable buckets like "Cloud & Infrastructure", "AI & ML", etc.\n- Output strictly valid JSON only, no prose, no markdown.\n- DO NOT include any examples except the JSON payload.\n\nSchema:\n{\n  "categories": { "name": string, "description": string }[]\n}\n\nInput URLs:\n${capped.join('\n')}`;
}


