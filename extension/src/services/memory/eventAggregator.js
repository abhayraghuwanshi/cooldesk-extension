/**
 * Event Aggregator Service
 * Aggregates events from multiple stores into unified timeline
 */

import { DB_CONFIG, getUnifiedDB } from '../../db/unified-db.js';

/**
 * Get all memory events within a date range
 * @param {Object} filters - Filter options
 * @param {number} filters.startDate - Start timestamp
 * @param {number} filters.endDate - End timestamp
 * @param {Array<string>} filters.types - Event types to include ['visit', 'note', 'highlight', 'save']
 * @param {number} filters.limit - Max events to return
 * @param {number} filters.offset - Pagination offset
 * @returns {Promise<Array>} Array of events sorted by timestamp
 */
export async function getMemoryEvents(filters = {}) {
    const {
        startDate = Date.now() - (7 * 24 * 60 * 60 * 1000), // Last 7 days
        endDate = Date.now(),
        types = ['visit', 'note', 'highlight', 'save'],
        limit = 50,
        offset = 0
    } = filters;

    const events = [];
    const db = await getUnifiedDB();

    try {
        // Fetch visits from ACTIVITY_SERIES
        if (types.includes('visit')) {
            const visits = await getVisitEvents(db, startDate, endDate);
            events.push(...visits);
        }

        // Fetch notes from NOTES and URL_NOTES
        if (types.includes('note')) {
            const notes = await getNoteEvents(db, startDate, endDate);
            events.push(...notes);
        }

        // Fetch highlights from URL_NOTES
        if (types.includes('highlight')) {
            const highlights = await getHighlightEvents(db, startDate, endDate);
            events.push(...highlights);
        }

        // Fetch saves from WORKSPACE_URLS
        if (types.includes('save')) {
            const saves = await getSaveEvents(db, startDate, endDate);
            events.push(...saves);
        }

        // Sort by timestamp descending (newest first)
        events.sort((a, b) => b.timestamp - a.timestamp);

        // Apply pagination
        return events.slice(offset, offset + limit);
    } catch (error) {
        console.error('[EventAggregator] Failed to fetch events:', error);
        return [];
    }
}

/**
 * Get visit events from ACTIVITY_SERIES
 */
async function getVisitEvents(db, startDate, endDate) {
    const transaction = db.transaction([DB_CONFIG.STORES.ACTIVITY_SERIES], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
    const index = store.index('by_timestamp');

    console.log('[EventAggregator] Fetching visits from:', {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        startTimestamp: startDate,
        endTimestamp: endDate
    });

    return new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(startDate, endDate);
        const request = index.getAll(range);

        request.onsuccess = () => {
            let activities = request.result || [];
            console.log('[EventAggregator] Raw activities from index query:', activities.length, activities);

            // FALLBACK: If index query returns nothing, try getting ALL and filter manually
            if (activities.length === 0) {
                console.log('[EventAggregator] Index returned 0 results, trying direct store.getAll()...');
                const allRequest = store.getAll();

                allRequest.onsuccess = () => {
                    const allActivities = allRequest.result || [];
                    console.log('[EventAggregator] ALL activities in store:', allActivities.length, allActivities);

                    // Filter manually by timestamp
                    activities = allActivities.filter(a =>
                        a.timestamp >= startDate && a.timestamp <= endDate
                    );
                    console.log('[EventAggregator] Manually filtered activities:', activities.length, activities);

                    const events = activities.map(activity => ({
                        id: activity.id,
                        type: 'visit',
                        timestamp: activity.timestamp,
                        url: activity.url,
                        sessionId: activity.sessionId,
                        metadata: activity.metrics || {}
                    }));

                    console.log('[EventAggregator] Transformed to visit events:', events.length, events);
                    resolve(events);
                };

                allRequest.onerror = () => {
                    console.error('[EventAggregator] Error in fallback getAll:', allRequest.error);
                    resolve([]); // Return empty array on error
                };
            } else {
                const events = activities.map(activity => ({
                    id: activity.id,
                    type: 'visit',
                    timestamp: activity.timestamp,
                    url: activity.url,
                    sessionId: activity.sessionId,
                    metadata: activity.metrics || {}
                }));

                console.log('[EventAggregator] Transformed to visit events:', events.length, events);
                resolve(events);
            }
        };

        request.onerror = () => {
            console.error('[EventAggregator] Error fetching visits:', request.error);
            reject(request.error);
        };
    });
}

/**
 * Get note events from NOTES and URL_NOTES
 */
async function getNoteEvents(db, startDate, endDate) {
    const events = [];

    // Get from NOTES
    const notesTransaction = db.transaction([DB_CONFIG.STORES.NOTES], 'readonly');
    const notesStore = notesTransaction.objectStore(DB_CONFIG.STORES.NOTES);
    const notesIndex = notesStore.index('by_createdAt');

    const notes = await new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(startDate, endDate);
        const request = notesIndex.getAll(range);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });

    events.push(...notes.map(note => ({
        id: note.id,
        type: 'note',
        timestamp: note.createdAt,
        url: note.url || null,
        textContent: note.text || note.content || '',
        metadata: {
            title: note.title,
            noteType: note.type
        }
    })));

    // Get from URL_NOTES (excluding highlights)
    const urlNotesTransaction = db.transaction([DB_CONFIG.STORES.URL_NOTES], 'readonly');
    const urlNotesStore = urlNotesTransaction.objectStore(DB_CONFIG.STORES.URL_NOTES);
    const urlNotesIndex = urlNotesStore.index('by_createdAt');

    const urlNotes = await new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(startDate, endDate);
        const request = urlNotesIndex.getAll(range);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });

    // Filter out highlights
    const nonHighlightNotes = urlNotes.filter(note => note.type !== 'highlight');
    events.push(...nonHighlightNotes.map(note => ({
        id: note.id,
        type: 'note',
        timestamp: note.createdAt,
        url: note.url,
        textContent: note.text || note.content || note.selectedText || '',
        metadata: {
            title: note.title,
            noteType: note.type
        }
    })));

    return events;
}

/**
 * Get highlight events from URL_NOTES
 */
async function getHighlightEvents(db, startDate, endDate) {
    const transaction = db.transaction([DB_CONFIG.STORES.URL_NOTES], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.URL_NOTES);
    const index = store.index('by_createdAt');

    return new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(startDate, endDate);
        const request = index.getAll(range);

        request.onsuccess = () => {
            const urlNotes = request.result || [];
            const highlights = urlNotes
                .filter(note => note.type === 'highlight')
                .map(note => ({
                    id: note.id,
                    type: 'highlight',
                    timestamp: note.createdAt,
                    url: note.url,
                    textContent: note.selectedText || note.text || '',
                    metadata: {
                        title: note.title
                    }
                }));
            resolve(highlights);
        };

        request.onerror = () => reject(request.error);
    });
}

/**
 * Get save events from WORKSPACE_URLS
 */
async function getSaveEvents(db, startDate, endDate) {
    const transaction = db.transaction([DB_CONFIG.STORES.WORKSPACE_URLS], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.WORKSPACE_URLS);
    const index = store.index('by_addedAt');

    return new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(startDate, endDate);
        const request = index.getAll(range);

        request.onsuccess = () => {
            const workspaceUrls = request.result || [];
            const events = workspaceUrls.map(item => ({
                id: item.url,
                type: 'save',
                timestamp: item.addedAt,
                url: item.url,
                metadata: {
                    title: item.title,
                    workspaceIds: item.workspaceIds
                }
            }));
            resolve(events);
        };

        request.onerror = () => reject(request.error);
    });
}

/**
 * Get event count by type
 * @param {number} startDate - Start timestamp
 * @param {number} endDate - End timestamp
 * @returns {Promise<Object>} Count by type
 */
export async function getEventCounts(startDate, endDate) {
    const events = await getMemoryEvents({
        startDate,
        endDate,
        types: ['visit', 'note', 'highlight', 'save'],
        limit: 10000 // Get all for counting
    });

    const counts = {
        visit: 0,
        note: 0,
        highlight: 0,
        save: 0,
        total: events.length
    };

    events.forEach(event => {
        counts[event.type]++;
    });

    return counts;
}
