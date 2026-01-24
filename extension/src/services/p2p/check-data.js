/**
 * Quick script to check if saved-data and server-data exist in the team database
 * Run this in the browser console
 */

import { p2pStorage } from './services/p2p/storageService.js';
import { teamManager } from './services/p2p/teamManager.js';

async function checkTeamData() {
    await teamManager.init();
    const teams = teamManager.getTeams();

    console.log('=== Checking Team Data ===\n');

    for (const team of teams) {
        console.log(`📁 Team: ${team.name} (${team.id})`);

        try {
            // Check if storage is initialized
            const doc = p2pStorage.getDoc(team.id);
            if (!doc) {
                console.log('   ⚠️  Storage not initialized yet');
                console.log('   Run: await p2pStorage.initializeTeamStorage("' + team.id + '")');
                continue;
            }

            // Check all collections
            const sharedItems = doc.getArray('shared-items');
            const sharedNotices = doc.getArray('shared-notices');
            const savedData = doc.getArray('saved-data');
            const serverData = doc.getArray('server-data');
            const teamMembers = doc.getMap('team-members');
            const teamContext = doc.getMap('team-context');

            console.log('   📊 Collections:');
            console.log('      - shared-items:', sharedItems.length, 'items');
            console.log('      - shared-notices:', sharedNotices.length, 'items');
            console.log('      - saved-data:', savedData.length, 'items ⭐');
            console.log('      - server-data:', serverData.length, 'items ⭐');
            console.log('      - team-members:', teamMembers.size, 'members');
            console.log('      - team-context:', teamContext.size, 'entries');

            // Show actual data
            if (savedData.length > 0) {
                console.log('\n   💾 Saved Data:');
                savedData.toArray().forEach((item, i) => {
                    console.log(`      ${i + 1}. ${item.title || 'Untitled'} (${item.type})`);
                });
            }

            if (serverData.length > 0) {
                console.log('\n   🌐 Server Data:');
                serverData.toArray().forEach((item, i) => {
                    console.log(`      ${i + 1}. ${item.source} - ${item.type} (${item.status})`);
                });
            }

        } catch (error) {
            console.error('   ❌ Error:', error.message);
        }

        console.log('');
    }
}

// Export to window
window.checkTeamData = checkTeamData;

console.log('✅ Loaded! Run: checkTeamData()');
