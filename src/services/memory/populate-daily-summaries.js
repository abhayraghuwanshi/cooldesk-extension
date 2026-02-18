/**
 * Manual Daily Summary Population Script
 * Run this in the browser console (DevTools) to manually populate daily_memory table
 * 
 * Usage:
 * 1. Open the extension page (chrome-extension://...)
 * 2. Open DevTools (F12)
 * 3. Copy and paste this entire file into the console
 * 4. Run: await populateDailySummaries(7) // for last 7 days
 */

import { DB_CONFIG, getUnifiedDB } from '../db/unified-db.js';
import { generateRecentSummaries, generateTodaySummary } from '../services/memory/dailySummaryGenerator.js';

/**
 * Populate daily summaries for the last N days
 */
async function populateDailySummaries(days = 7) {
    console.log(`[PopulateDailySummaries] Generating summaries for last ${days} days...`);

    try {
        const summaries = await generateRecentSummaries(days);
        console.log(`[PopulateDailySummaries]  Generated ${summaries.length} summaries`);

        // Verify data was stored
        const db = await getUnifiedDB();
        const transaction = db.transaction([DB_CONFIG.STORES.DAILY_MEMORY], 'readonly');
        const store = transaction.objectStore(DB_CONFIG.STORES.DAILY_MEMORY);

        const count = await new Promise((resolve, reject) => {
            const request = store.count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        console.log(`[PopulateDailySummaries] ✅ Total records in daily_memory: ${count}`);
        console.log('[PopulateDailySummaries] You can now check the daily_memory store in IndexedDB');

        return { success: true, generated: summaries.length, total: count };
    } catch (error) {
        console.error('[PopulateDailySummaries] Error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Generate summary for today only
 */
async function populateToday() {
    console.log('[PopulateToday] Generating summary for today...');

    try {
        const summary = await generateTodaySummary();
        console.log('[PopulateToday] ✅ Generated summary:', summary);
        return { success: true, summary };
    } catch (error) {
        console.error('[PopulateToday] ❌ Error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * View all summaries in the database
 */
async function viewAllSummaries() {
    console.log('[ViewSummaries] Fetching all summaries...');

    try {
        const db = await getUnifiedDB();
        const transaction = db.transaction([DB_CONFIG.STORES.DAILY_MEMORY], 'readonly');
        const store = transaction.objectStore(DB_CONFIG.STORES.DAILY_MEMORY);

        const summaries = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });

        console.log(`[ViewSummaries] Found ${summaries.length} summaries:`);
        summaries.forEach(s => {
            console.log(`  📅 ${s.date}: ${s.summary}`);
            console.log(`     Sessions: ${s.sessionIds.length}, Notes: ${s.noteCount}, Highlights: ${s.highlightCount}`);
        });

        return summaries;
    } catch (error) {
        console.error('[ViewSummaries] ❌ Error:', error);
        return [];
    }
}

// Export functions for console use
window.populateDailySummaries = populateDailySummaries;
window.populateToday = populateToday;
window.viewAllSummaries = viewAllSummaries;

console.log('✅ Daily Summary Population Script Loaded!');
console.log('');
console.log('Available commands:');
console.log('  await populateDailySummaries(7)  - Generate summaries for last 7 days');
console.log('  await populateToday()            - Generate summary for today only');
console.log('  await viewAllSummaries()         - View all summaries in database');
console.log('');
