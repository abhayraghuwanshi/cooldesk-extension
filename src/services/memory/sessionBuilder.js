/**
 * Session Builder Service
 * Manages browsing sessions using existing ACTIVITY_SERIES data
 */

import { DB_CONFIG, getUnifiedDB } from '../../db/unified-db.js';

/**
 * Get all activities for a specific session
 * @param {string} sessionId - The session ID to query
 * @returns {Promise<Array>} Array of activity records
 */
export async function getSessionActivities(sessionId) {
    const db = await getUnifiedDB();
    const transaction = db.transaction([DB_CONFIG.STORES.ACTIVITY_SERIES], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
    const index = store.index('by_sessionId');

    return new Promise((resolve, reject) => {
        const request = index.getAll(sessionId);
        request.onsuccess = () => {
            const activities = request.result || [];
            // Sort by timestamp
            activities.sort((a, b) => a.timestamp - b.timestamp);
            resolve(activities);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Link notes to a session by adding to sessionMetadata
 * @param {string} sessionId - The session ID
 * @param {Array<string>} noteIds - Array of note IDs to link
 */
export async function linkNotesToSession(sessionId, noteIds) {
    const db = await getUnifiedDB();
    const transaction = db.transaction([DB_CONFIG.STORES.ACTIVITY_SERIES], 'readwrite');
    const store = transaction.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
    const index = store.index('by_sessionId');

    return new Promise((resolve, reject) => {
        const request = index.getAll(sessionId);
        request.onsuccess = () => {
            const activities = request.result || [];

            // Update first activity with session metadata
            if (activities.length > 0) {
                const firstActivity = activities[0];
                firstActivity.sessionMetadata = firstActivity.sessionMetadata || {};
                firstActivity.sessionMetadata.noteIds = [
                    ...(firstActivity.sessionMetadata.noteIds || []),
                    ...noteIds
                ];

                const updateRequest = store.put(firstActivity);
                updateRequest.onsuccess = () => resolve(firstActivity);
                updateRequest.onerror = () => reject(updateRequest.error);
            } else {
                resolve(null);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Link highlights to a session
 * @param {string} sessionId - The session ID
 * @param {Array<string>} highlightIds - Array of highlight IDs to link
 */
export async function linkHighlightsToSession(sessionId, highlightIds) {
    const db = await getUnifiedDB();
    const transaction = db.transaction([DB_CONFIG.STORES.ACTIVITY_SERIES], 'readwrite');
    const store = transaction.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
    const index = store.index('by_sessionId');

    return new Promise((resolve, reject) => {
        const request = index.getAll(sessionId);
        request.onsuccess = () => {
            const activities = request.result || [];

            if (activities.length > 0) {
                const firstActivity = activities[0];
                firstActivity.sessionMetadata = firstActivity.sessionMetadata || {};
                firstActivity.sessionMetadata.highlightIds = [
                    ...(firstActivity.sessionMetadata.highlightIds || []),
                    ...highlightIds
                ];

                const updateRequest = store.put(firstActivity);
                updateRequest.onsuccess = () => resolve(firstActivity);
                updateRequest.onerror = () => reject(updateRequest.error);
            } else {
                resolve(null);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Detect if a new session should start based on time gap
 * @param {number} currentTime - Current timestamp
 * @param {number} lastActivityTime - Last activity timestamp
 * @returns {boolean} True if new session should start
 */
export function detectSessionBoundary(currentTime, lastActivityTime) {
    const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes
    return (currentTime - lastActivityTime) > SESSION_GAP_MS;
}

/**
 * Get all active sessions (sessions with recent activity)
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 30 minutes)
 * @param {number} limit - Maximum number of activities to fetch (default: 200)
 * @returns {Promise<Array>} Array of active session IDs with their activities
 */
export async function getActiveSessions(maxAgeMs = 30 * 60 * 1000, limit = 200) {
    const db = await getUnifiedDB();
    const transaction = db.transaction([DB_CONFIG.STORES.ACTIVITY_SERIES], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
    const index = store.index('by_timestamp');

    const cutoffTime = Date.now() - maxAgeMs;

    return new Promise((resolve, reject) => {
        const activities = [];
        // Use cursor in reverse order (newest first) with limit for efficiency
        const request = index.openCursor(IDBKeyRange.lowerBound(cutoffTime), 'prev');

        request.onsuccess = (event) => {
            const cursor = event.target.result;

            if (cursor && activities.length < limit) {
                activities.push(cursor.value);
                cursor.continue();
            } else {
                // Group by sessionId
                const sessionMap = new Map();
                activities.forEach(activity => {
                    if (!sessionMap.has(activity.sessionId)) {
                        sessionMap.set(activity.sessionId, []);
                    }
                    sessionMap.get(activity.sessionId).push(activity);
                });

                // Convert to array and sort each session's activities
                const sessions = Array.from(sessionMap.entries()).map(([sessionId, acts]) => ({
                    sessionId,
                    activities: acts.sort((a, b) => a.timestamp - b.timestamp),
                    startTime: Math.min(...acts.map(a => a.timestamp)),
                    endTime: Math.max(...acts.map(a => a.timestamp)),
                    metadata: acts[0]?.sessionMetadata || {}
                }));

                // Sort sessions by endTime descending (most recent first)
                sessions.sort((a, b) => b.endTime - a.endTime);

                resolve(sessions);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get sessions within a date range
 * @param {number} startDate - Start timestamp
 * @param {number} endDate - End timestamp
 * @returns {Promise<Array>} Array of sessions
 */
export async function getSessionsByDateRange(startDate, endDate) {
    const db = await getUnifiedDB();
    const transaction = db.transaction([DB_CONFIG.STORES.ACTIVITY_SERIES], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
    const index = store.index('by_timestamp');

    return new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(startDate, endDate);
        const request = index.getAll(range);

        request.onsuccess = () => {
            const activities = request.result || [];

            // Group by sessionId
            const sessionMap = new Map();
            activities.forEach(activity => {
                if (!sessionMap.has(activity.sessionId)) {
                    sessionMap.set(activity.sessionId, []);
                }
                sessionMap.get(activity.sessionId).push(activity);
            });

            // Convert to array with session details
            const sessions = Array.from(sessionMap.entries()).map(([sessionId, acts]) => {
                acts.sort((a, b) => a.timestamp - b.timestamp);
                return {
                    sessionId,
                    activities: acts,
                    startTime: acts[0].timestamp,
                    endTime: acts[acts.length - 1].timestamp,
                    urls: [...new Set(acts.map(a => a.url))],
                    metadata: acts[0]?.sessionMetadata || {}
                };
            });

            // Sort by start time
            sessions.sort((a, b) => b.startTime - a.startTime);
            resolve(sessions);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Generate a new session ID
 * @returns {string} New session ID
 */
export function generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
