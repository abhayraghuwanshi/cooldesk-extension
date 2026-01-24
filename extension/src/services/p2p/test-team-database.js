/**
 * Test file for saved-data and server-data collections
 * Run this in the browser console to test the new functionality
 */

import { p2pStorage } from './services/p2p/storageService.js';

async function testSavedData(teamId) {
    console.log('=== Testing Saved Data ===');

    try {
        // Test 1: Add saved data
        console.log('Test 1: Adding saved data...');
        const bookmark = await p2pStorage.addSavedData(teamId, {
            type: 'bookmark',
            title: 'Test Bookmark',
            url: 'https://example.com',
            tags: ['test', 'demo'],
            createdBy: 'test-user'
        });
        console.log('✓ Added bookmark:', bookmark);

        // Test 2: Get all saved data
        console.log('\nTest 2: Getting all saved data...');
        const savedDataArray = p2pStorage.getSharedSavedData(teamId);
        const allItems = savedDataArray.toArray();
        console.log('✓ Total items:', allItems.length);
        console.log('Items:', allItems);

        // Test 3: Update saved data
        console.log('\nTest 3: Updating saved data...');
        const updated = p2pStorage.updateSavedData(teamId, bookmark.id, {
            title: 'Updated Test Bookmark',
            tags: ['test', 'demo', 'updated']
        });
        console.log('✓ Updated item:', updated);

        // Test 4: Subscribe to changes
        console.log('\nTest 4: Subscribing to changes...');
        const unsubscribe = p2pStorage.subscribeToSavedData(teamId, (changes) => {
            console.log('✓ Received changes:', changes);
        });

        // Add another item to trigger the subscription
        await p2pStorage.addSavedData(teamId, {
            type: 'note',
            title: 'Test Note',
            content: 'This is a test note',
            createdBy: 'test-user'
        });

        // Wait a bit for the subscription to fire
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 5: Delete saved data
        console.log('\nTest 5: Deleting saved data...');
        const deleted = p2pStorage.deleteSavedData(teamId, bookmark.id);
        console.log('✓ Deleted:', deleted);

        // Unsubscribe
        unsubscribe();

        console.log('\n✅ All saved data tests passed!');
        return true;
    } catch (error) {
        console.error('❌ Saved data test failed:', error);
        return false;
    }
}

async function testServerData(teamId) {
    console.log('\n=== Testing Server Data ===');

    try {
        // Test 1: Add server data
        console.log('Test 1: Adding server data...');
        const apiData = await p2pStorage.addServerData(teamId, {
            source: 'test-api',
            type: 'webhook',
            payload: { message: 'Test webhook data' },
            metadata: { test: true }
        });
        console.log('✓ Added server data:', apiData);

        // Test 2: Get all server data
        console.log('\nTest 2: Getting all server data...');
        const serverDataArray = p2pStorage.getSharedServerData(teamId);
        const allData = serverDataArray.toArray();
        console.log('✓ Total items:', allData.length);
        console.log('Items:', allData);

        // Test 3: Update server data
        console.log('\nTest 3: Updating server data...');
        const updated = p2pStorage.updateServerData(teamId, apiData.id, {
            status: 'processed',
            metadata: { test: true, processed: true }
        });
        console.log('✓ Updated item:', updated);

        // Test 4: Subscribe to changes
        console.log('\nTest 4: Subscribing to changes...');
        const unsubscribe = p2pStorage.subscribeToServerData(teamId, (changes) => {
            console.log('✓ Received changes:', changes);
        });

        // Add another item to trigger the subscription
        await p2pStorage.addServerData(teamId, {
            source: 'test-api-2',
            type: 'event',
            payload: { event: 'test' }
        });

        // Wait a bit for the subscription to fire
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 5: Delete server data
        console.log('\nTest 5: Deleting server data...');
        const deleted = p2pStorage.deleteServerData(teamId, apiData.id);
        console.log('✓ Deleted:', deleted);

        // Unsubscribe
        unsubscribe();

        console.log('\n✅ All server data tests passed!');
        return true;
    } catch (error) {
        console.error('❌ Server data test failed:', error);
        return false;
    }
}

async function runAllTests(teamId) {
    console.log('Starting tests for team:', teamId);
    console.log('=====================================\n');

    const savedDataPassed = await testSavedData(teamId);
    const serverDataPassed = await testServerData(teamId);

    console.log('\n=====================================');
    console.log('Test Results:');
    console.log('Saved Data:', savedDataPassed ? '✅ PASSED' : '❌ FAILED');
    console.log('Server Data:', serverDataPassed ? '✅ PASSED' : '❌ FAILED');
    console.log('=====================================');

    return savedDataPassed && serverDataPassed;
}

// Export for use in console
window.testTeamDatabase = runAllTests;

console.log('Test functions loaded!');
console.log('Usage: testTeamDatabase("your-team-id")');
