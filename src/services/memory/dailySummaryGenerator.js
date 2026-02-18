/**
 * Daily Summary Generator Service
 * Generates daily summaries of browsing activity
 */

import { DB_CONFIG, getUnifiedDB } from '../../db/unified-db.js';
import { validateAndSanitize } from '../../db/validation.js';
import { getSessionsByDateRange } from './sessionBuilder.js';

/**
 * Generate daily summary for a specific date
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} userId - User ID (default: 'default')
 * @returns {Promise<Object>} Generated summary
 */
export async function generateDailySummary(date, userId = 'default') {
    const db = await getUnifiedDB();

    // Parse date to get timestamp range
    const startOfDay = new Date(date).setHours(0, 0, 0, 0);
    const endOfDay = new Date(date).setHours(23, 59, 59, 999);

    try {
        // Get sessions for the day
        const sessions = await getSessionsByDateRange(startOfDay, endOfDay);

        // Get notes and highlights
        const { noteCount, highlightCount } = await getNotesAndHighlights(db, startOfDay, endOfDay);

        // Get top URLs
        const topUrls = await getTopUrls(db, startOfDay, endOfDay);

        // Generate summary text
        const summary = generateSummaryText(sessions, noteCount, highlightCount, topUrls);

        // Create summary object
        const dailySummary = {
            id: `daily_${date}`,
            userId,
            date,
            sessionIds: sessions.map(s => s.sessionId),
            topUrls: topUrls.slice(0, 20),
            noteCount,
            highlightCount,
            summary,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        // Validate
        const validation = validateAndSanitize(dailySummary, 'dailyMemory');
        if (!validation.valid) {
            console.error('[DailySummary] Validation failed:', validation.errors);
            throw new Error('Invalid daily summary data');
        }

        // Store in database
        const transaction = db.transaction([DB_CONFIG.STORES.DAILY_MEMORY], 'readwrite');
        const store = transaction.objectStore(DB_CONFIG.STORES.DAILY_MEMORY);

        await new Promise((resolve, reject) => {
            const request = store.put(validation.sanitized);
            request.onsuccess = () => resolve(validation.sanitized);
            request.onerror = () => reject(request.error);
        });

        console.log(`[DailySummary] Generated summary for ${date}`);
        return validation.sanitized;
    } catch (error) {
        console.error('[DailySummary] Failed to generate summary:', error);
        throw error;
    }
}

/**
 * Get notes and highlights count for date range
 */
async function getNotesAndHighlights(db, startDate, endDate) {
    let noteCount = 0;
    let highlightCount = 0;

    // Count from NOTES
    const notesTransaction = db.transaction([DB_CONFIG.STORES.NOTES], 'readonly');
    const notesStore = notesTransaction.objectStore(DB_CONFIG.STORES.NOTES);
    const notesIndex = notesStore.index('by_createdAt');

    const notes = await new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(startDate, endDate);
        const request = notesIndex.getAll(range);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });

    noteCount += notes.length;

    // Count from URL_NOTES
    const urlNotesTransaction = db.transaction([DB_CONFIG.STORES.URL_NOTES], 'readonly');
    const urlNotesStore = urlNotesTransaction.objectStore(DB_CONFIG.STORES.URL_NOTES);
    const urlNotesIndex = urlNotesStore.index('by_createdAt');

    const urlNotes = await new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(startDate, endDate);
        const request = urlNotesIndex.getAll(range);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });

    urlNotes.forEach(note => {
        if (note.type === 'highlight') {
            highlightCount++;
        } else {
            noteCount++;
        }
    });

    return { noteCount, highlightCount };
}

/**
 * Get top URLs by visit count
 */
async function getTopUrls(db, startDate, endDate) {
    const transaction = db.transaction([DB_CONFIG.STORES.ACTIVITY_SERIES], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
    const index = store.index('by_timestamp');

    const activities = await new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(startDate, endDate);
        const request = index.getAll(range);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });

    // Count visits per URL
    const urlCounts = new Map();
    activities.forEach(activity => {
        const count = urlCounts.get(activity.url) || 0;
        urlCounts.set(activity.url, count + 1);
    });

    // Sort by count and get top URLs
    const sortedUrls = Array.from(urlCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([url, visits]) => ({
            url,
            visits,
            title: activities.find(a => a.url === url)?.title || new URL(url).hostname
        }));

    return sortedUrls;
}

/**
 * Generate human-readable summary text
 */
function generateSummaryText(sessions, noteCount, highlightCount, topUrls) {
    const parts = [];

    // Sessions summary
    if (sessions.length > 0) {
        parts.push(`You had ${sessions.length} browsing session${sessions.length > 1 ? 's' : ''}`);
    }

    // Top domains
    if (topUrls.length > 0) {
        const topDomains = [...new Set(topUrls.slice(0, 3).map(u => {
            try {
                return new URL(u.url).hostname;
            } catch {
                return null;
            }
        }).filter(Boolean))];

        if (topDomains.length > 0) {
            parts.push(`visiting ${topDomains.join(', ')}`);
        }
    }

    // Notes and highlights
    const contentParts = [];
    if (noteCount > 0) {
        contentParts.push(`${noteCount} note${noteCount > 1 ? 's' : ''}`);
    }
    if (highlightCount > 0) {
        contentParts.push(`${highlightCount} highlight${highlightCount > 1 ? 's' : ''}`);
    }

    if (contentParts.length > 0) {
        parts.push(`You created ${contentParts.join(' and ')}`);
    }

    return parts.join('. ') + (parts.length > 0 ? '.' : 'No activity recorded.');
}

/**
 * Generate summary for today
 */
export async function generateTodaySummary(userId = 'default') {
    const today = new Date().toISOString().split('T')[0];
    return generateDailySummary(today, userId);
}

/**
 * Generate summaries for the last N days
 */
export async function generateRecentSummaries(days = 7, userId = 'default') {
    const summaries = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        try {
            const summary = await generateDailySummary(dateStr, userId);
            summaries.push(summary);
        } catch (error) {
            console.warn(`[DailySummary] Failed to generate summary for ${dateStr}:`, error);
        }
    }

    return summaries;
}

/**
 * Get daily summary for a specific date
 */
export async function getDailySummary(date, userId = 'default') {
    const db = await getUnifiedDB();
    const transaction = db.transaction([DB_CONFIG.STORES.DAILY_MEMORY], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.DAILY_MEMORY);
    const index = store.index('by_userId_date');

    return new Promise((resolve, reject) => {
        const request = index.get([userId, date]);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all summaries for a user
 */
export async function getAllSummaries(userId = 'default', limit = 30) {
    const db = await getUnifiedDB();
    const transaction = db.transaction([DB_CONFIG.STORES.DAILY_MEMORY], 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.DAILY_MEMORY);
    const index = store.index('by_userId');

    return new Promise((resolve, reject) => {
        const request = index.getAll(userId, limit);
        request.onsuccess = () => {
            const summaries = request.result || [];
            // Sort by date descending
            summaries.sort((a, b) => b.date.localeCompare(a.date));
            resolve(summaries);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Schedule daily summary generation
 * Should be called once per day (e.g., at midnight)
 */
export function scheduleDailySummary() {
    // Calculate time until next midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow - now;

    console.log(`[DailySummary] Scheduling next summary in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);

    // Schedule for midnight
    setTimeout(async () => {
        try {
            // Generate summary for yesterday
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const dateStr = yesterday.toISOString().split('T')[0];

            await generateDailySummary(dateStr);
            console.log(`[DailySummary] Auto-generated summary for ${dateStr}`);
        } catch (error) {
            console.error('[DailySummary] Auto-generation failed:', error);
        }

        // Schedule next run
        scheduleDailySummary();
    }, msUntilMidnight);
}
