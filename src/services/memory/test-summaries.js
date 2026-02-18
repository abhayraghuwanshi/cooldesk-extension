/**
 * Test script to generate daily summaries
 * Run this in the browser console to populate DAILY_MEMORY
 */

import { generateRecentSummaries, generateTodaySummary, getAllSummaries } from './dailySummaryGenerator.js';

async function testDailySummaries() {
    console.log('🧪 Testing Daily Summary Generation...\n');

    try {
        // Generate summary for today
        console.log('📝 Generating summary for today...');
        const todaySummary = await generateTodaySummary();
        console.log('✅ Today\'s summary:', todaySummary);
        console.log(`   Summary text: "${todaySummary.summary}"`);
        console.log(`   Sessions: ${todaySummary.sessionIds.length}`);
        console.log(`   Notes: ${todaySummary.noteCount}`);
        console.log(`   Highlights: ${todaySummary.highlightCount}\n`);

        // Generate summaries for last 7 days
        console.log('📅 Generating summaries for last 7 days...');
        const recentSummaries = await generateRecentSummaries(7);
        console.log(`✅ Generated ${recentSummaries.length} summaries\n`);

        // Retrieve all summaries
        console.log('📊 Retrieving all summaries...');
        const allSummaries = await getAllSummaries();
        console.log(`✅ Total summaries in database: ${allSummaries.length}`);

        allSummaries.forEach(summary => {
            console.log(`   ${summary.date}: ${summary.summary}`);
        });

        return allSummaries;
    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    }
}

// Run test
console.log('Starting daily summary test...');
testDailySummaries()
    .then(summaries => {
        console.log(`\n✅ Test complete! Generated ${summaries.length} summaries.`);
        console.log('You can now check the DAILY_MEMORY store in IndexedDB.');
    })
    .catch(err => console.error('\n❌ Test failed:', err));
