/**
 * Context Linker Service
 * Links notes and highlights to browsing sessions based on time proximity
 */

import { DB_CONFIG, getUnifiedDB } from '../../db/unified-db.js';
import { linkHighlightsToSession, linkNotesToSession } from './sessionBuilder.js';

/**
 * Link a note to its session based on timestamp proximity
 * @param {Object} note - Note object with createdAt timestamp
 * @param {number} windowMs - Time window in milliseconds (default: 5 minutes)
 * @returns {Promise<string|null>} Session ID if linked, null otherwise
 */
export async function linkNoteToSession(note, windowMs = 5 * 60 * 1000) {
    const db = await getUnifiedDB();
    const noteTime = note.createdAt;

    // Find activities within time window
    const transaction = db.transaction([DB_CONFIG.STORES.ACTIVITY_SERIES], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
    const index = store.index('by_timestamp');

    const startTime = noteTime - windowMs;
    const endTime = noteTime + windowMs;

    return new Promise(async (resolve, reject) => {
        const range = IDBKeyRange.bound(startTime, endTime);
        const request = index.getAll(range);

        request.onsuccess = async () => {
            const activities = request.result || [];

            if (activities.length === 0) {
                resolve(null);
                return;
            }

            // Find closest activity by timestamp
            let closestActivity = activities[0];
            let minDiff = Math.abs(activities[0].timestamp - noteTime);

            activities.forEach(activity => {
                const diff = Math.abs(activity.timestamp - noteTime);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestActivity = activity;
                }
            });

            // If note has a URL, prefer activities with matching URL
            if (note.url) {
                const matchingUrlActivity = activities.find(a => a.url === note.url);
                if (matchingUrlActivity) {
                    closestActivity = matchingUrlActivity;
                }
            }

            // Link note to session
            try {
                await linkNotesToSession(closestActivity.sessionId, [note.id]);
                console.log(`[ContextLinker] Linked note ${note.id} to session ${closestActivity.sessionId}`);
                resolve(closestActivity.sessionId);
            } catch (error) {
                console.error('[ContextLinker] Failed to link note:', error);
                reject(error);
            }
        };

        request.onerror = () => reject(request.error);
    });
}

/**
 * Link a highlight to its session
 * @param {Object} highlight - Highlight object with createdAt timestamp
 * @param {number} windowMs - Time window in milliseconds (default: 5 minutes)
 * @returns {Promise<string|null>} Session ID if linked, null otherwise
 */
export async function linkHighlightToSession(highlight, windowMs = 5 * 60 * 1000) {
    const db = await getUnifiedDB();
    const highlightTime = highlight.createdAt;

    const transaction = db.transaction([DB_CONFIG.STORES.ACTIVITY_SERIES], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
    const index = store.index('by_timestamp');

    const startTime = highlightTime - windowMs;
    const endTime = highlightTime + windowMs;

    return new Promise(async (resolve, reject) => {
        const range = IDBKeyRange.bound(startTime, endTime);
        const request = index.getAll(range);

        request.onsuccess = async () => {
            const activities = request.result || [];

            if (activities.length === 0) {
                resolve(null);
                return;
            }

            // For highlights, URL matching is critical
            let targetActivity = null;

            if (highlight.url) {
                targetActivity = activities.find(a => a.url === highlight.url);
            }

            // Fallback to closest by time
            if (!targetActivity) {
                targetActivity = activities[0];
                let minDiff = Math.abs(activities[0].timestamp - highlightTime);

                activities.forEach(activity => {
                    const diff = Math.abs(activity.timestamp - highlightTime);
                    if (diff < minDiff) {
                        minDiff = diff;
                        targetActivity = activity;
                    }
                });
            }

            // Link highlight to session
            try {
                await linkHighlightsToSession(targetActivity.sessionId, [highlight.id]);
                console.log(`[ContextLinker] Linked highlight ${highlight.id} to session ${targetActivity.sessionId}`);
                resolve(targetActivity.sessionId);
            } catch (error) {
                console.error('[ContextLinker] Failed to link highlight:', error);
                reject(error);
            }
        };

        request.onerror = () => reject(request.error);
    });
}

/**
 * Batch link multiple notes to sessions
 * @param {Array<Object>} notes - Array of note objects
 * @returns {Promise<Object>} Results with linked and unlinked counts
 */
export async function batchLinkNotes(notes) {
    const results = {
        linked: 0,
        unlinked: 0,
        errors: []
    };

    for (const note of notes) {
        try {
            const sessionId = await linkNoteToSession(note);
            if (sessionId) {
                results.linked++;
            } else {
                results.unlinked++;
            }
        } catch (error) {
            results.errors.push({ noteId: note.id, error: error.message });
        }
    }

    console.log(`[ContextLinker] Batch link results:`, results);
    return results;
}

/**
 * Batch link multiple highlights to sessions
 * @param {Array<Object>} highlights - Array of highlight objects
 * @returns {Promise<Object>} Results with linked and unlinked counts
 */
export async function batchLinkHighlights(highlights) {
    const results = {
        linked: 0,
        unlinked: 0,
        errors: []
    };

    for (const highlight of highlights) {
        try {
            const sessionId = await linkHighlightToSession(highlight);
            if (sessionId) {
                results.linked++;
            } else {
                results.unlinked++;
            }
        } catch (error) {
            results.errors.push({ highlightId: highlight.id, error: error.message });
        }
    }

    console.log(`[ContextLinker] Batch link results:`, results);
    return results;
}

/**
 * Auto-link recent notes and highlights (last 24 hours)
 * Useful for background processing
 */
export async function autoLinkRecent() {
    const db = await getUnifiedDB();
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

    try {
        // Get recent notes
        const notesTransaction = db.transaction([DB_CONFIG.STORES.NOTES, DB_CONFIG.STORES.URL_NOTES], 'readonly');
        const notesStore = notesTransaction.objectStore(DB_CONFIG.STORES.NOTES);
        const urlNotesStore = notesTransaction.objectStore(DB_CONFIG.STORES.URL_NOTES);

        const notesIndex = notesStore.index('by_createdAt');
        const urlNotesIndex = urlNotesStore.index('by_createdAt');

        const notes = await new Promise((resolve, reject) => {
            const request = notesIndex.getAll(IDBKeyRange.lowerBound(oneDayAgo));
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });

        const urlNotes = await new Promise((resolve, reject) => {
            const request = urlNotesIndex.getAll(IDBKeyRange.lowerBound(oneDayAgo));
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });

        // Separate highlights from notes
        const highlights = urlNotes.filter(n => n.type === 'highlight');
        const regularNotes = [...notes, ...urlNotes.filter(n => n.type !== 'highlight')];

        // Link them
        const noteResults = await batchLinkNotes(regularNotes);
        const highlightResults = await batchLinkHighlights(highlights);

        console.log('[ContextLinker] Auto-link complete:', {
            notes: noteResults,
            highlights: highlightResults
        });

        return {
            notes: noteResults,
            highlights: highlightResults
        };
    } catch (error) {
        console.error('[ContextLinker] Auto-link failed:', error);
        throw error;
    }
}
