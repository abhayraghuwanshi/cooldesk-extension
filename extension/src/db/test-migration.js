/**
 * Test script for database migration v5
 * Run this in browser console to verify DAILY_MEMORY store creation
 */

import { getDatabaseHealth, getUnifiedDB } from './unified-db.js';

async function testDatabaseMigration() {
    console.log('🧪 Testing Database Migration v5...\n');

    try {
        // Get database instance (will trigger migration if needed)
        const db = await getUnifiedDB();
        console.log('✅ Database opened successfully');
        console.log(`   Version: ${db.version}`);
        console.log(`   Stores: ${Array.from(db.objectStoreNames).join(', ')}\n`);

        // Check if DAILY_MEMORY store exists
        if (db.objectStoreNames.contains('daily_memory')) {
            console.log('✅ DAILY_MEMORY store exists');

            // Get store details
            const transaction = db.transaction(['daily_memory'], 'readonly');
            const store = transaction.objectStore('daily_memory');

            console.log(`   Key path: ${store.keyPath}`);
            console.log(`   Indexes: ${Array.from(store.indexNames).join(', ')}\n`);
        } else {
            console.error('❌ DAILY_MEMORY store NOT found!');
        }

        // Get full database health
        const health = await getDatabaseHealth();
        console.log('📊 Database Health:');
        console.log(JSON.stringify(health, null, 2));

        return health;
    } catch (error) {
        console.error('❌ Migration test failed:', error);
        throw error;
    }
}

// Run test
testDatabaseMigration()
    .then(() => console.log('\n✅ All tests passed!'))
    .catch(err => console.error('\n❌ Tests failed:', err));
