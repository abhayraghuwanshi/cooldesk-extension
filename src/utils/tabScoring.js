import { getUrlAnalytics } from '../db/index.js';
import { getUrlParts } from './helpers.js';

// Helper function to clean URLs (same as activity.js)
function cleanUrl(url) {
    try {
        const parts = getUrlParts(url);
        return parts?.key || new URL(url).hostname;
    } catch {
        try { return new URL(url).hostname; } catch { return null; }
    }
}

// Calculate recency score (0-100) based on time since last visit
function calculateRecencyScore(timeSinceLastVisit) {
    const minutes = timeSinceLastVisit / (1000 * 60);

    if (minutes < 5) return 100;           // Last 5 minutes
    if (minutes < 60) return 80;           // Last hour
    if (minutes < 24 * 60) return 60;      // Last 24 hours
    if (minutes < 7 * 24 * 60) return 40;  // Last week
    return 20;                              // Older
}

// Calculate frequency score (0-100) based on visit count
function calculateFrequencyScore(visitCount) {
    if (!visitCount) return 0;
    // Diminishing returns: 10 visits = 100, 5 visits = 50, etc.
    return Math.min(100, visitCount * 10);
}

// Calculate engagement score (0-100) based on interactions
function calculateEngagementScore(activity) {
    const time = Number(activity.time) || 0;
    const clicks = Number(activity.clicks) || 0;
    const scroll = Number(activity.scroll) || 0;
    const forms = Number(activity.forms) || 0;

    // Weighted scoring
    const rawScore = (
        forms * 100 +           // Form submissions are high-value
        clicks * 10 +           // Clicks show active engagement
        scroll * 0.5 +          // Scrolling shows content consumption
        (time / 1000) * 0.1     // Time (per second)
    );

    // Normalize to 0-100 scale (assume 1000 is "perfect" engagement)
    return Math.min(100, (rawScore / 1000) * 100);
}

// Calculate session quality score (0-100)
function calculateSessionQualityScore(activity) {
    const returnVisits = Number(activity.returnVisits) || 0;
    const sessionDurations = activity.sessionDurations || [];

    // Return visits score (0-50)
    const returnVisitsScore = Math.min(50, returnVisits * 10);

    // Average session duration score (0-50)
    let avgSessionScore = 0;
    if (sessionDurations.length > 0) {
        const avgDuration = sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length;
        const avgMinutes = avgDuration / (1000 * 60);
        // 5+ minutes = 50 points, 1 minute = 10 points
        avgSessionScore = Math.min(50, avgMinutes * 10);
    }

    return returnVisitsScore + avgSessionScore;
}

// Calculate composite score for a tab
function calculateTabScore(tab, activityData) {
    if (!tab || !tab.url) return 0;

    const url = cleanUrl(tab.url);
    if (!url) return 10; // Baseline score for tabs without valid URLs

    const activity = activityData[url] || {};

    // Special bonuses
    let bonus = 0;
    if (tab.active) bonus += 1000;  // Active tab always on top
    if (tab.pinned) bonus += 500;   // Pinned tabs near top

    // Penalty for system URLs
    if (tab.url.startsWith('chrome://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:')) {
        return -1000;
    }

    // If no activity data, return baseline + bonus
    if (!activity.lastVisit) {
        return 10 + bonus;
    }

    // Calculate component scores
    const timeSinceLastVisit = Date.now() - (activity.lastVisit || 0);
    const recencyScore = calculateRecencyScore(timeSinceLastVisit);
    const frequencyScore = calculateFrequencyScore(activity.visitCount);
    const engagementScore = calculateEngagementScore(activity);
    const sessionQualityScore = calculateSessionQualityScore(activity);

    // Weighted composite score
    const baseScore = (
        recencyScore * 0.35 +
        frequencyScore * 0.25 +
        engagementScore * 0.25 +
        sessionQualityScore * 0.15
    );

    return baseScore + bonus;
}

// Cache for activity data
let activityCache = null;
let activityCacheTime = 0;
const CACHE_DURATION = 30000; // 30 seconds

// Fetch activity data with caching
async function getActivityData() {
    const now = Date.now();

    // Return cached data if still valid
    if (activityCache && (now - activityCacheTime) < CACHE_DURATION) {
        return activityCache;
    }

    try {
        const result = await getUrlAnalytics();
        const data = result?.data || result || [];

        // Ensure data is an array
        const dataArray = Array.isArray(data) ? data : [];

        // Convert array to object keyed by URL
        const activityMap = {};
        dataArray.forEach(item => {
            if (item && item.url) {
                activityMap[item.url] = item;
            }
        });

        activityCache = activityMap;
        activityCacheTime = now;

        return activityMap;
    } catch (error) {
        console.error('[TabScoring] Failed to fetch activity data:', error);
        return {};
    }
}

// Main function: Score and sort tabs
export async function scoreAndSortTabs(tabs) {
    if (!tabs || tabs.length === 0) return [];

    // Fetch activity data
    const activityData = await getActivityData();

    // Calculate scores for all tabs
    const tabsWithScores = tabs.map(tab => ({
        ...tab,
        _score: calculateTabScore(tab, activityData)
    }));

    // Sort by score (descending), tie-breaker by id
    const sorted = tabsWithScores.sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return (a.id || 0) - (b.id || 0); // fallback tie-breaker
    });

    // Remove score property before returning
    return sorted.map(({ _score, ...tab }) => tab);
}

// Export individual scoring functions for testing
export {
    calculateEngagementScore, calculateFrequencyScore, calculateRecencyScore, calculateSessionQualityScore,
    calculateTabScore
};

