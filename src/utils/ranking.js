/**
 * Workspace Ranking Algorithm (Activity Score)
 * 
 * Implements the linear activity score logic used in WorkspaceList.jsx
 * to ensure consistent ranking across the application.
 * 
 * Score = (Visits * 10) + (Hours * 50) + RecencyBonus
 */

/**
 * Calculates the activity score for a workspace.
 * 
 * @param {Object} analytics Aggregated analytics for the workspace
 * @param {number} analytics.totalVisits Total number of visits
 * @param {number} analytics.totalTime Total duration in ms
 * @param {number} analytics.lastActive Timestamp of the last activity (from URL visits only)
 * @returns {number} The calculated activity score
 */
export function calculateActivityScore(analytics) {
    if (!analytics) return 0;

    const { totalVisits = 0, totalTime = 0, lastActive = 0 } = analytics;

    // If no activity (visits/time/lastActive are 0), score is 0.
    // We do NOT use createdAt here to avoid inflating empty workspaces.
    if (totalVisits === 0 && totalTime === 0 && lastActive === 0) {
        return 0;
    }

    // 1. Visit Score: 10 points per visit
    const visitScore = totalVisits * 10;

    // 2. Duration Score: 50 points per hour
    const hoursSpent = totalTime / (1000 * 60 * 60);
    const durationScore = hoursSpent * 50;

    // 3. Recency Bonus: 0-100 points based on days since last active
    let recencyBonus = 0;
    if (lastActive > 0) {
        const daysSinceLastActive = (Date.now() - lastActive) / (1000 * 60 * 60 * 24);
        // Linear decay: 100 points for today, 0 points after 30 days
        recencyBonus = Math.max(0, 100 - (daysSinceLastActive * 3.33));
    }

    return Math.round(visitScore + durationScore + recencyBonus);
}

/**
 * Sorts an array of workspaces by their calculated activity score.
 * 
 * @param {Array} workspaces Array of workspace objects
 * @param {Function} getAnalyticsForWorkspace Async function to retrive analytics for a workspace
 * @returns {Promise<Array>} Sorted workspaces with an attached _score property
 */
export async function sortWorkspacesByActivity(workspaces, getAnalyticsForWorkspace) {
    if (!workspaces || workspaces.length === 0) return [];

    const scored = await Promise.all(workspaces.map(async (ws) => {
        let analytics = { totalVisits: 0, totalTime: 0, lastActive: 0 };

        try {
            const data = await getAnalyticsForWorkspace(ws);
            if (data) {
                // Ensure we use the data returned, but fallbacks to 0 if missing
                analytics = {
                    totalVisits: data.totalVisits || 0,
                    totalTime: data.totalTime || 0,
                    lastActive: data.lastActive || 0
                };
            }
        } catch (e) {
            console.warn('Failed to get analytics for ranking:', e);
        }

        const score = calculateActivityScore(analytics);

        // For tie-breaking (especially 0-score items), we use the workspace's
        // own timestamp (updatedAt or createdAt) as a fallback.
        // This ensures "New Workspace" (score 0) is above "Old Empty Workspace" (score 0).
        const fallbackTimestamp = ws.updatedAt || ws.createdAt || 0;
        const lastActiveForTieBreak = analytics.lastActive || fallbackTimestamp;

        return {
            ...ws,
            _score: score,
            _tieBreaker: lastActiveForTieBreak
        };
    }));

    // Sort descending by score, then by tie-breaker
    return scored.sort((a, b) => {
        const scoreDiff = b._score - a._score;
        if (Math.abs(scoreDiff) > 0.1) return scoreDiff; // Float safety
        return b._tieBreaker - a._tieBreaker;
    });
}
