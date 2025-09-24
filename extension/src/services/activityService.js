import { listPings, getAllActivity } from '../db/index.js';

// Enhanced URL filtering to exclude system and low-value URLs
function isValidTrackingUrl(url) {
    if (!url || typeof url !== 'string') return false;

    // System URLs to exclude
    const systemPrefixes = [
        'chrome://', 'edge://', 'about:', 'moz-extension://',
        'chrome-extension://', 'extension://', 'file://'
    ];

    // Low-value domains to exclude
    const excludeDomains = [
        'newtab', 'extensions', 'settings', 'blank'
    ];

    // Check system prefixes
    if (systemPrefixes.some(prefix => url.startsWith(prefix))) {
        return false;
    }

    // Check if it's a meaningful URL (has domain)
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname.toLowerCase();

        // Exclude if domain is in exclude list or is empty
        if (!domain || excludeDomains.some(exclude => domain.includes(exclude))) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

// Calculate engagement score based on user interactions
function calculateEngagementScore(data) {
    const time = Number(data.time) || 0;
    const clicks = Number(data.clicks) || 0;
    const scroll = Number(data.scroll) || 0;
    const forms = Number(data.forms) || 0;

    // Weighted scoring: forms > clicks > scroll > time
    const score = (
        forms * 100 +      // Form submissions are high-value interactions
        clicks * 10 +      // Clicks show active engagement
        scroll * 0.5 +     // Scrolling shows content consumption
        (time / 1000) * 0.1 // Time has lowest weight (per second)
    );

    return Math.round(score * 100) / 100; // Round to 2 decimal places
}

// Check if session has minimum engagement to be worth tracking
function hasMinimumEngagement(data) {
    const time = Number(data.time) || 0;
    const clicks = Number(data.clicks) || 0;
    const scroll = Number(data.scroll) || 0;
    const forms = Number(data.forms) || 0;

    // Minimum thresholds for tracking
    return (
        time >= 5000 ||    // At least 5 seconds
        clicks >= 2 ||     // At least 2 clicks
        scroll >= 25 ||    // At least 25% scroll
        forms >= 1         // Any form submission
    );
}

/**
 * Get pins data directly from database
 * @returns {Promise<Array>} Array of pin objects
 */
export async function getPins() {
    try {
        const result = await listPings();
        const pingsData = result?.data || result || [];
        const all = Array.isArray(pingsData) ? pingsData : [];
        // Sort newest first
        all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return all;
    } catch (error) {
        console.error('[ActivityService] Error loading pins:', error);
        return [];
    }
}

/**
 * Get activity data from chrome.storage.local
 * @returns {Promise<Array>} Array of activity objects
 */
export async function getActivityData() {
    try {
        // First try to get data directly from IndexedDB using getAllActivity
        console.log('[ActivityService] Fetching activity data from IndexedDB');
        const result = await getAllActivity({ limit: 100 });
        console.log('[ActivityService] Raw result from database:', { success: result?.success, dataLength: result?.data?.length, sampleData: result?.data?.slice(0, 2) });

        if (result && result.success && Array.isArray(result.data)) {
            const rows = result.data.map(r => ({
                url: String(r?.url || ''),
                // Handle both old format (direct properties) and new format (metrics object)
                time: Number(r?.time || r?.metrics?.timeSpent) || 0,
                clicks: Number(r?.clicks || r?.metrics?.clicks) || 0,
                scroll: Number(r?.scroll || r?.metrics?.scrollDepth) || 0,
                forms: Number(r?.forms || r?.metrics?.forms) || 0
            }))
            .filter(row => {
                // Enhanced filtering for better data quality
                return isValidTrackingUrl(row.url) && hasMinimumEngagement(row);
            })
            .map(row => {
                // Add engagement score to each row
                return {
                    ...row,
                    engagementScore: calculateEngagementScore(row)
                };
            })
            .sort((a, b) => {
                // Sort by engagement score for better relevance
                return (b.engagementScore || 0) - (a.engagementScore || 0);
            });

            console.log('[ActivityService] Loaded', rows.length, 'activity items from IndexedDB after filtering');
            console.log('[ActivityService] Sample filtered data:', rows.slice(0, 3));
            return rows;
        }

        // Fallback: try chrome.storage.local
        if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
            console.log('[ActivityService] Falling back to chrome.storage.local');
            const storageResult = await chrome.storage.local.get(['clean_activity_data']);
            const activityData = storageResult.clean_activity_data || {};

            const rows = Object.entries(activityData).map(([url, data]) => ({
                url,
                time: data.time || 0,
                clicks: data.clicks || 0,
                scroll: data.scroll || 0,
                forms: data.forms || 0
            }))
            .filter(row => isValidTrackingUrl(row.url) && hasMinimumEngagement(row))
            .map(row => ({
                ...row,
                engagementScore: calculateEngagementScore(row)
            }))
            .sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0));

            console.log('[ActivityService] Loaded', rows.length, 'activity items from storage');
            return rows;
        }

        // Final fallback: try message-based approach for compatibility
        console.log('[ActivityService] Falling back to message-based approach');
        return await getActivityDataViaMessage();
    } catch (error) {
        console.error('[ActivityService] Error loading activity data:', error);
        return [];
    }
}

/**
 * Fallback: Get activity data via chrome message (for compatibility)
 * @returns {Promise<Array>} Array of activity objects
 */
async function getActivityDataViaMessage() {
    try {
        if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
            return [];
        }

        const resp = await new Promise((resolve) => {
            let resolved = false;

            const timeoutId = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    resolve({ ok: false, error: 'Request timeout' });
                }
            }, 3000);

            chrome.runtime.sendMessage({ action: 'getActivityData' }, (response) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeoutId);

                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(response || { ok: false, error: 'No response received' });
                    }
                }
            });
        });

        if (resp && resp.ok && Array.isArray(resp.rows)) {
            return resp.rows.map(r => ({
                url: r.url,
                time: Number(r.time) || 0,
                scroll: Number(r.scroll) || 0,
                clicks: Number(r.clicks) || 0,
                forms: Number(r.forms) || 0
            }));
        }

        return [];
    } catch (error) {
        console.error('[ActivityService] Message-based fallback failed:', error);
        return [];
    }
}

/**
 * Get combined pins and activity data for feed sections
 * @returns {Promise<{pins: Array, activity: Array}>}
 */
export async function getCombinedData() {
    try {
        const [pins, activity] = await Promise.all([
            getPins(),
            getActivityData()
        ]);

        return { pins, activity };
    } catch (error) {
        console.error('[ActivityService] Error getting combined data:', error);
        return { pins: [], activity: [] };
    }
}