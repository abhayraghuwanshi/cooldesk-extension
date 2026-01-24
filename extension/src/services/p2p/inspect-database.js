/**
 * Helper script to verify and inspect team databases in IndexedDB
 * Open browser console and run: checkTeamDatabases()
 */

import { p2pStorage } from './storageService.js';
import { p2pSyncService } from './syncService.js';
import { teamManager } from './teamManager.js';

/**
 * Check all team databases in IndexedDB
 */
async function checkTeamDatabases() {
    console.log('=== Checking Team Databases ===\n');

    // Initialize team manager
    await teamManager.init();
    const teams = teamManager.getTeams();

    console.log(`Found ${teams.length} team(s):\n`);

    for (const team of teams) {
        console.log(`📁 Team: ${team.name}`);
        console.log(`   ID: ${team.id}`);
        console.log(`   Database: team-db-${team.id}`);

        try {
            // Check if database exists
            const databases = await indexedDB.databases();
            const dbExists = databases.some(db => db.name === `team-db-${team.id}`);

            if (dbExists) {
                console.log(`   ✅ Database exists in IndexedDB`);

                // Try to get the storage
                const doc = p2pStorage.getDoc(team.id);
                if (doc) {
                    console.log(`   ✅ Y.Doc initialized`);

                    // Check collections
                    const savedData = doc.getArray('saved-data');
                    const serverData = doc.getArray('server-data');
                    const sharedItems = doc.getArray('shared-items');
                    const sharedNotices = doc.getArray('shared-notices');
                    const teamMembers = doc.getMap('team-members');
                    const teamContext = doc.getMap('team-context');

                    console.log(`   📊 Collections:`);
                    console.log(`      - saved-data: ${savedData.length} items`);
                    console.log(`      - server-data: ${serverData.length} items`);
                    console.log(`      - shared-items: ${sharedItems.length} items`);
                    console.log(`      - shared-notices: ${sharedNotices.length} items`);
                    console.log(`      - team-members: ${teamMembers.size} members`);
                    console.log(`      - team-context: ${teamContext.size} entries`);
                } else {
                    console.log(`   ⚠️  Y.Doc not initialized yet`);
                    console.log(`   💡 Run: await initializeTeamDatabase('${team.id}')`);
                }
            } else {
                console.log(`   ❌ Database does not exist yet`);
                console.log(`   💡 Run: await initializeTeamDatabase('${team.id}')`);
            }
        } catch (error) {
            console.error(`   ❌ Error checking database:`, error);
        }

        console.log('');
    }

    console.log('=== End of Database Check ===');
}

/**
 * Initialize a team's database
 */
async function initializeTeamDatabase(teamId) {
    console.log(`Initializing database for team: ${teamId}...`);

    try {
        const team = teamManager.getTeam(teamId);
        if (!team) {
            console.error(`❌ Team ${teamId} not found`);
            return false;
        }

        // Initialize storage (this creates the IndexedDB database)
        const doc = await p2pStorage.initializeTeamStorage(teamId);
        console.log(`✅ Database initialized: team-db-${teamId}`);

        // Connect to P2P sync
        await p2pSyncService.connectTeam(teamId, team.encryptionKey);
        console.log(`✅ Connected to P2P sync`);

        // Verify collections exist
        const savedData = doc.getArray('saved-data');
        const serverData = doc.getArray('server-data');

        console.log(`✅ Collections created:`);
        console.log(`   - saved-data: ${savedData.length} items`);
        console.log(`   - server-data: ${serverData.length} items`);

        return true;
    } catch (error) {
        console.error(`❌ Failed to initialize database:`, error);
        return false;
    }
}

/**
 * List all IndexedDB databases
 */
async function listAllDatabases() {
    console.log('=== All IndexedDB Databases ===\n');

    try {
        const databases = await indexedDB.databases();

        if (databases.length === 0) {
            console.log('No databases found');
            return;
        }

        databases.forEach((db, index) => {
            console.log(`${index + 1}. ${db.name} (version ${db.version || 'unknown'})`);
        });

        console.log(`\nTotal: ${databases.length} database(s)`);

        // Filter team databases
        const teamDbs = databases.filter(db => db.name.startsWith('team-db-'));
        console.log(`\nTeam databases: ${teamDbs.length}`);
        teamDbs.forEach(db => {
            const teamId = db.name.replace('team-db-', '');
            console.log(`   - ${db.name} (Team ID: ${teamId})`);
        });
    } catch (error) {
        console.error('❌ Error listing databases:', error);
    }

    console.log('\n=== End of Database List ===');
}

/**
 * Inspect a specific team database
 */
async function inspectTeamDatabase(teamId) {
    console.log(`=== Inspecting team-db-${teamId} ===\n`);

    try {
        const dbName = `team-db-${teamId}`;

        // Open the database
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        console.log(`Database: ${db.name}`);
        console.log(`Version: ${db.version}`);
        console.log(`Object Stores: ${db.objectStoreNames.length}`);

        // List object stores
        for (let i = 0; i < db.objectStoreNames.length; i++) {
            const storeName = db.objectStoreNames[i];
            console.log(`\n📦 Object Store: ${storeName}`);

            // Get count
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const count = await new Promise((resolve, reject) => {
                const request = store.count();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            console.log(`   Items: ${count}`);

            // List indexes
            if (store.indexNames.length > 0) {
                console.log(`   Indexes: ${Array.from(store.indexNames).join(', ')}`);
            }
        }

        db.close();
        console.log('\n=== End of Inspection ===');
    } catch (error) {
        console.error('❌ Error inspecting database:', error);
    }
}

// Export to window for console access
window.checkTeamDatabases = checkTeamDatabases;
window.initializeTeamDatabase = initializeTeamDatabase;
window.listAllDatabases = listAllDatabases;
window.inspectTeamDatabase = inspectTeamDatabase;

console.log('🔍 Database inspection tools loaded!');
console.log('Available commands:');
console.log('  - checkTeamDatabases()          // Check all team databases');
console.log('  - listAllDatabases()            // List all IndexedDB databases');
console.log('  - initializeTeamDatabase(id)    // Initialize a team database');
console.log('  - inspectTeamDatabase(id)       // Inspect a specific team database');
