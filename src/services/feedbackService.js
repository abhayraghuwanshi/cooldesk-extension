/**
 * Feedback Service - RAG-based implicit feedback collection
 *
 * Communicates with the Tauri backend to:
 * - Record user interactions with search results (accepted, rejected, etc.)
 * - Track URL-workspace associations for pattern learning
 * - Get workspace suggestions based on learned patterns
 * - Retrieve URL affinity scores for related content
 */

const SIDECAR_URL = 'http://localhost:4545';

// ==========================================
// Core Feedback Recording
// ==========================================

/**
 * Record a feedback event when user interacts with a suggestion
 * @param {Object} params
 * @param {string} params.suggestionType - 'workspace_group' | 'url_to_workspace' | 'related_resource' | 'tab_category'
 * @param {string} params.action - 'accepted' | 'rejected' | 'modified' | 'ignored' | 'previewed'
 * @param {string} params.suggestionContent - The content that was suggested (URL, workspace name, etc.)
 * @param {string} [params.contextWorkspace] - Active workspace when suggestion was made
 * @param {string[]} [params.contextUrls] - Active URLs when suggestion was made
 * @param {number} [params.responseTimeMs] - Time between showing suggestion and user action
 */
export async function recordFeedbackEvent({
    suggestionType,
    action,
    suggestionContent,
    contextWorkspace,
    contextUrls = [],
    responseTimeMs
}) {
    try {
        const response = await fetch(`${SIDECAR_URL}/feedback/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                suggestion_type: suggestionType,
                action,
                suggestion_content: suggestionContent,
                context_workspace: contextWorkspace,
                context_urls: contextUrls,
                response_time_ms: responseTimeMs
            })
        });
        return response.ok;
    } catch (e) {
        console.debug('[Feedback] Failed to record event:', e.message);
        return false;
    }
}

/**
 * Record when user selects a search result (positive feedback)
 * @param {Object} item - The selected search result item
 * @param {number} [displayedAtMs] - When the result was displayed (for response time calculation)
 */
export async function recordSearchSelection(item, displayedAtMs) {
    const responseTimeMs = displayedAtMs ? Date.now() - displayedAtMs : undefined;

    // Determine suggestion type based on item type
    let suggestionType = 'related_resource';
    if (item.type === 'workspace') suggestionType = 'workspace_group';
    else if (item.type === 'tab') suggestionType = 'tab_category';
    else if (item.type === 'app') suggestionType = 'related_resource';

    return recordFeedbackEvent({
        suggestionType,
        action: 'accepted',
        suggestionContent: item.url || item.name || item.title,
        responseTimeMs
    });
}

/**
 * Record when user ignores/dismisses search results
 * @param {Object[]} results - The results that were shown but not selected
 */
export async function recordSearchIgnored(results) {
    // Only record for first few results (most relevant)
    const topResults = results.slice(0, 3);

    for (const item of topResults) {
        await recordFeedbackEvent({
            suggestionType: 'related_resource',
            action: 'ignored',
            suggestionContent: item.url || item.name || item.title
        });
    }
}

// ==========================================
// URL-Workspace Pattern Learning
// ==========================================

/**
 * Record that a URL was added to a workspace (for pattern learning)
 * @param {string} url - The URL
 * @param {string} title - Page title
 * @param {string} workspaceName - The workspace it was added to
 */
export async function recordUrlWorkspace(url, title, workspaceName) {
    try {
        const response = await fetch(`${SIDECAR_URL}/feedback/url-workspace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, title, workspace_name: workspaceName })
        });
        return response.ok;
    } catch (e) {
        console.debug('[Feedback] Failed to record URL-workspace:', e.message);
        return false;
    }
}

/**
 * Get workspace suggestions for a URL based on learned patterns
 * @param {string} url - The URL to get suggestions for
 * @param {string} title - Page title
 * @param {number} [count=3] - Number of suggestions to return
 * @returns {Promise<Array<{workspace_name: string, score: number}>>}
 */
export async function suggestWorkspaceForUrl(url, title, count = 3) {
    try {
        const response = await fetch(`${SIDECAR_URL}/feedback/suggest-workspace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, title, count })
        });

        if (!response.ok) return [];

        const data = await response.json();
        return data.suggestions || [];
    } catch (e) {
        console.debug('[Feedback] Failed to get workspace suggestions:', e.message);
        return [];
    }
}

// ==========================================
// URL Affinity & Grouping
// ==========================================

/**
 * Record explicit grouping feedback (when user groups/ungroups URLs)
 * @param {string} url1 - First URL
 * @param {string} url2 - Second URL
 * @param {boolean} positive - true if grouped together, false if separated
 */
export async function recordGroupingFeedback(url1, url2, positive) {
    try {
        const response = await fetch(`${SIDECAR_URL}/feedback/grouping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url1, url2, positive })
        });
        return response.ok;
    } catch (e) {
        console.debug('[Feedback] Failed to record grouping:', e.message);
        return false;
    }
}

/**
 * Get affinity score between two URLs (how related they are)
 * @param {string} url1 - First URL
 * @param {string} url2 - Second URL
 * @returns {Promise<{affinity: number, related_urls: Array<{url: string, affinity: number}>}>}
 */
export async function getUrlAffinity(url1, url2) {
    try {
        const params = new URLSearchParams({ url1, url2 });
        const response = await fetch(`${SIDECAR_URL}/feedback/affinity?${params}`);

        if (!response.ok) return { affinity: 0, related_urls: [] };

        return response.json();
    } catch (e) {
        console.debug('[Feedback] Failed to get affinity:', e.message);
        return { affinity: 0, related_urls: [] };
    }
}

/**
 * Get URLs related to a given URL based on learned patterns
 * @param {string} url - The URL to find related content for
 * @returns {Promise<Array<{url: string, affinity: number}>>}
 */
export async function getRelatedUrls(url) {
    const result = await getUrlAffinity(url, url);
    return result.related_urls || [];
}

// ==========================================
// Statistics & Debugging
// ==========================================

/**
 * Get feedback statistics by suggestion type
 * @returns {Promise<{stats_by_type: Object, total_events: number}>}
 */
export async function getFeedbackStats() {
    try {
        const response = await fetch(`${SIDECAR_URL}/feedback/stats`);
        if (!response.ok) return { stats_by_type: {}, total_events: 0 };
        return response.json();
    } catch (e) {
        console.debug('[Feedback] Failed to get stats:', e.message);
        return { stats_by_type: {}, total_events: 0 };
    }
}

/**
 * Get recent feedback events (for debugging)
 * @param {number} [limit=20] - Number of events to return
 * @returns {Promise<Array>}
 */
export async function getRecentEvents(limit = 20) {
    try {
        const response = await fetch(`${SIDECAR_URL}/feedback/events?limit=${limit}`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.debug('[Feedback] Failed to get events:', e.message);
        return [];
    }
}

/**
 * Force save feedback state to disk
 */
export async function saveFeedbackState() {
    try {
        await fetch(`${SIDECAR_URL}/feedback/save`, { method: 'POST' });
    } catch (e) {
        console.debug('[Feedback] Failed to save state:', e.message);
    }
}

// ==========================================
// Boost Score Calculation (for RAG)
// ==========================================

/**
 * Calculate a boost score for search results based on user feedback history
 * Higher score = user has positively interacted with similar content before
 *
 * @param {Object} item - Search result item
 * @param {Array<{url: string, affinity: number}>} relatedUrls - Pre-fetched related URLs
 * @returns {number} Boost multiplier (1.0 = no boost, >1.0 = positive boost)
 */
export function calculateFeedbackBoost(item, relatedUrls = []) {
    let boost = 1.0;

    if (!item.url) return boost;

    // Check if this URL has positive affinity with recently accessed URLs
    const matchingRelated = relatedUrls.find(r =>
        item.url.includes(r.url) || r.url.includes(item.url)
    );

    if (matchingRelated) {
        // Affinity ranges from -1 to 1, map to 0.5 to 1.5 boost
        boost += matchingRelated.affinity * 0.5;
    }

    return Math.max(0.5, Math.min(2.0, boost)); // Clamp between 0.5x and 2x
}

export default {
    recordFeedbackEvent,
    recordSearchSelection,
    recordSearchIgnored,
    recordUrlWorkspace,
    suggestWorkspaceForUrl,
    recordGroupingFeedback,
    getUrlAffinity,
    getRelatedUrls,
    getFeedbackStats,
    getRecentEvents,
    saveFeedbackState,
    calculateFeedbackBoost
};
