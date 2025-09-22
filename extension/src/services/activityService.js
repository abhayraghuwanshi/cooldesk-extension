import { listPings, getAllActivity } from '../db/index.js';

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

        if (result && result.success && Array.isArray(result.data)) {
            const rows = result.data.map(r => ({
                url: String(r?.url || ''),
                time: Number(r?.time) || 0,
                clicks: Number(r?.clicks) || 0,
                scroll: Number(r?.scroll) || 0,
                forms: Number(r?.forms) || 0
            }))
            .filter(row => row.time > 0 || row.clicks > 0 || row.scroll > 0 || row.forms > 0)
            .sort((a, b) => b.time - a.time);

            console.log('[ActivityService] Loaded', rows.length, 'activity items from IndexedDB');
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
            .filter(row => row.time > 0 || row.clicks > 0 || row.scroll > 0 || row.forms > 0)
            .sort((a, b) => b.time - a.time);

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