/**
 * Migration Manager for Database Schema Changes
 * Handles data migration from old separate databases to unified schema
 */

import { DB_CONFIG, getUnifiedDB, getIndexedDBInstance } from './unified-db.js'

/**
 * Legacy database configurations that need migration
 */
const LEGACY_DATABASES = {
    'cooldesk-db': { version: 9, stores: ['settings', 'ui'] },
    'workspacesDB': { version: 2, stores: ['workspaces'] },
    'UrlNotesDB': { version: 2, stores: ['urlNotes'] },
    'NotesDB': { version: 1, stores: ['notes'] },
    'cooldesk-pins-db': { version: 1, stores: ['pins'] },
    'TimeTrackingDB': { version: 1, stores: ['timeTracking'] },
    'ActivityTimeSeriesDB': { version: 1, stores: ['activityTimeSeries'] },
    'workspaceUrlsDB': { version: 1, stores: ['workspaceUrls'] }
}

/**
 * Data migration mappings from legacy to unified schema
 */
const MIGRATION_MAPPINGS = {
    // Workspaces migration
    workspaces: {
        legacyStore: 'workspaces',
        unifiedStore: DB_CONFIG.STORES.WORKSPACES,
        transform: (legacyData) => ({
            id: legacyData.id,
            name: legacyData.name,
            gridType: legacyData.gridType || 'ItemGrid',
            createdAt: legacyData.createdAt || Date.now(),
            updatedAt: legacyData.updatedAt || Date.now(),
            urls: legacyData.urls || [],
            description: legacyData.description || ''
        })
    },
    
    // URL Notes migration  
    urlNotes: {
        legacyStore: 'urlNotes',
        unifiedStore: DB_CONFIG.STORES.URL_NOTES,
        transform: (legacyData) => ({
            id: legacyData.id || generateId(),
            url: legacyData.url,
            content: legacyData.content || legacyData.note || '',
            title: legacyData.title || '',
            createdAt: legacyData.createdAt || Date.now(),
            updatedAt: legacyData.updatedAt || Date.now(),
            tags: legacyData.tags || []
        })
    },
    
    // Notes migration
    notes: {
        legacyStore: 'notes', 
        unifiedStore: DB_CONFIG.STORES.NOTES,
        transform: (legacyData) => ({
            id: legacyData.id,
            title: legacyData.title || '',
            content: legacyData.content || '',
            tags: legacyData.tags || [],
            createdAt: legacyData.createdAt || Date.now(),
            updatedAt: legacyData.updatedAt || Date.now()
        })
    },
    
    // Pins migration
    pins: {
        legacyStore: 'pins',
        unifiedStore: DB_CONFIG.STORES.PINS, 
        transform: (legacyData) => ({
            id: legacyData.id || legacyData.url,
            url: legacyData.url,
            title: legacyData.title || '',
            favicon: legacyData.favicon || '',
            createdAt: legacyData.createdAt || Date.now()
        })
    },
    
    // Time tracking migration
    timeTracking: {
        legacyStore: 'timeTracking',
        unifiedStore: DB_CONFIG.STORES.TIME_TRACKING,
        transform: (legacyData) => ({
            url: legacyData.url,
            sessionId: legacyData.sessionId,
            timestamp: legacyData.timestamp || Date.now(),
            timeSpent: legacyData.timeSpent || 0,
            metrics: legacyData.metrics || {}
        })
    },
    
    // Activity series migration
    activityTimeSeries: {
        legacyStore: 'activityTimeSeries', 
        unifiedStore: DB_CONFIG.STORES.ACTIVITY_SERIES,
        transform: (legacyData) => ({
            id: legacyData.id || generateId(),
            url: legacyData.url,
            timestamp: legacyData.timestamp,
            sessionId: legacyData.sessionId,
            metrics: legacyData.metrics || {}
        })
    },
    
    // Workspace URLs migration
    workspaceUrls: {
        legacyStore: 'workspaceUrls',
        unifiedStore: DB_CONFIG.STORES.WORKSPACE_URLS,
        transform: (legacyData) => ({
            url: legacyData.url,
            title: legacyData.title || '',
            favicon: legacyData.favicon || '', 
            workspaceIds: legacyData.workspaceIds || [],
            addedAt: legacyData.addedAt || legacyData.createdAt || Date.now(),
            extra: legacyData.extra || {}
        })
    },
    
    // Settings migration
    settings: {
        legacyStore: 'settings',
        unifiedStore: DB_CONFIG.STORES.SETTINGS,
        transform: (legacyData, key = 'default') => ({
            id: key,
            ...legacyData.value || legacyData,
            updatedAt: Date.now()
        })
    },
    
    // UI state migration
    ui: {
        legacyStore: 'ui',
        unifiedStore: DB_CONFIG.STORES.UI_STATE,
        transform: (legacyData, key = 'default') => ({
            id: key,
            ...legacyData.value || legacyData,
            updatedAt: Date.now()
        })
    }
}

/**
 * Check if migration is needed by detecting legacy databases
 */
export async function isMigrationNeeded() {
    try {
        // Check if unified DB already exists and has data
        const unifiedDB = await getUnifiedDB()
        const metadataStore = unifiedDB.transaction(DB_CONFIG.STORES.METADATA, 'readonly')
            .objectStore(DB_CONFIG.STORES.METADATA)
        
        const migrationStatus = await new Promise((resolve) => {
            const req = metadataStore.get('migration_completed')
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => resolve(null)
        })
        
        if (migrationStatus?.value === true) {
            console.log('[Migration] Migration already completed')
            return false
        }
        
        // Check for legacy databases
        const legacyDBs = await Promise.all(
            Object.keys(LEGACY_DATABASES).map(dbName => checkLegacyDatabase(dbName))
        )
        
        const hasLegacyData = legacyDBs.some(db => db.hasData)
        console.log('[Migration] Legacy data found:', hasLegacyData)
        
        return hasLegacyData
    } catch (error) {
        console.error('[Migration] Error checking migration status:', error)
        return false
    }
}

/**
 * Check if a legacy database exists and has data
 */
async function checkLegacyDatabase(dbName) {
    return new Promise((resolve) => {
        const request = getIndexedDBInstance().open(dbName)
        
        request.onsuccess = async () => {
            const db = request.result
            let hasData = false
            
            try {
                const storeNames = Array.from(db.objectStoreNames)
                if (storeNames.length > 0) {
                    const tx = db.transaction(storeNames, 'readonly')
                    
                    for (const storeName of storeNames) {
                        const store = tx.objectStore(storeName)
                        const count = await new Promise((resolve) => {
                            const countReq = store.count()
                            countReq.onsuccess = () => resolve(countReq.result)
                            countReq.onerror = () => resolve(0)
                        })
                        
                        if (count > 0) {
                            hasData = true
                            break
                        }
                    }
                }
            } catch (error) {
                console.warn(`[Migration] Error checking legacy DB ${dbName}:`, error)
            }
            
            db.close()
            resolve({ dbName, hasData, storeNames: Array.from(db.objectStoreNames) })
        }
        
        request.onerror = () => {
            console.log(`[Migration] Legacy DB ${dbName} does not exist`)
            resolve({ dbName, hasData: false, storeNames: [] })
        }
    })
}

/**
 * Perform complete data migration from legacy databases
 */
export async function performMigration(progressCallback = null) {
    console.log('[Migration] Starting data migration...')
    
    const migrationResult = {
        success: false,
        migratedRecords: 0,
        errors: [],
        startTime: Date.now(),
        endTime: null
    }
    
    try {
        const unifiedDB = await getUnifiedDB()
        
        // Record migration start
        await recordMigrationMetadata('migration_started', {
            timestamp: Date.now(),
            legacyDatabases: Object.keys(LEGACY_DATABASES)
        })
        
        progressCallback?.({ stage: 'started', progress: 0 })
        
        // Migrate each legacy database
        let totalProgress = 0
        const totalSteps = Object.keys(LEGACY_DATABASES).length
        
        for (const [dbName, config] of Object.entries(LEGACY_DATABASES)) {
            console.log(`[Migration] Migrating database: ${dbName}`)
            
            try {
                const result = await migrateLegacyDatabase(dbName, config)
                migrationResult.migratedRecords += result.recordCount
                
                totalProgress++
                progressCallback?.({
                    stage: 'migrating',
                    progress: (totalProgress / totalSteps) * 100,
                    currentDB: dbName,
                    recordsImported: result.recordCount
                })
                
            } catch (error) {
                console.error(`[Migration] Failed to migrate ${dbName}:`, error)
                migrationResult.errors.push({ database: dbName, error: error.message })
            }
        }
        
        // Migration completed
        migrationResult.success = migrationResult.errors.length === 0
        migrationResult.endTime = Date.now()
        
        await recordMigrationMetadata('migration_completed', {
            timestamp: Date.now(),
            success: migrationResult.success,
            recordsImported: migrationResult.migratedRecords,
            errors: migrationResult.errors.length,
            duration: migrationResult.endTime - migrationResult.startTime
        })
        
        progressCallback?.({
            stage: 'completed',
            progress: 100,
            success: migrationResult.success
        })
        
        console.log('[Migration] Migration completed:', migrationResult)
        
        return migrationResult
        
    } catch (error) {
        console.error('[Migration] Migration failed:', error)
        migrationResult.success = false
        migrationResult.endTime = Date.now()
        migrationResult.errors.push({ stage: 'general', error: error.message })
        
        await recordMigrationMetadata('migration_failed', {
            timestamp: Date.now(),
            error: error.message
        })
        
        return migrationResult
    }
}

/**
 * Migrate a single legacy database
 */
async function migrateLegacyDatabase(dbName, config) {
    return new Promise((resolve, reject) => {
        const request = getIndexedDBInstance().open(dbName)
        
        request.onsuccess = async () => {
            const legacyDB = request.result
            let recordCount = 0
            
            try {
                const storeNames = Array.from(legacyDB.objectStoreNames)
                
                for (const storeName of storeNames) {
                    const mapping = Object.values(MIGRATION_MAPPINGS).find(
                        m => m.legacyStore === storeName
                    )
                    
                    if (mapping) {
                        const count = await migrateStore(legacyDB, storeName, mapping)
                        recordCount += count
                    }
                }
                
                legacyDB.close()
                resolve({ recordCount })
                
            } catch (error) {
                legacyDB.close()
                reject(error)
            }
        }
        
        request.onerror = () => reject(request.error)
    })
}

/**
 * Migrate a single object store
 */
async function migrateStore(legacyDB, storeName, mapping) {
    const unifiedDB = await getUnifiedDB()
    
    // Get all data from legacy store
    const legacyData = await new Promise((resolve, reject) => {
        const tx = legacyDB.transaction(storeName, 'readonly')
        const store = tx.objectStore(storeName)
        const req = store.getAll()
        
        req.onsuccess = () => resolve(req.result || [])
        req.onerror = () => reject(req.error)
    })
    
    if (legacyData.length === 0) return 0
    
    // Transform and insert into unified database
    const tx = unifiedDB.transaction(mapping.unifiedStore, 'readwrite')
    const unifiedStore = tx.objectStore(mapping.unifiedStore)
    
    let recordCount = 0
    
    for (const record of legacyData) {
        try {
            const transformedRecord = mapping.transform(record)
            await new Promise((resolve, reject) => {
                const req = unifiedStore.put(transformedRecord)
                req.onsuccess = () => {
                    recordCount++
                    resolve()
                }
                req.onerror = () => reject(req.error)
            })
        } catch (error) {
            console.warn(`[Migration] Failed to migrate record from ${storeName}:`, error, record)
        }
    }
    
    console.log(`[Migration] Migrated ${recordCount} records from ${storeName} to ${mapping.unifiedStore}`)
    return recordCount
}

/**
 * Record migration metadata
 */
async function recordMigrationMetadata(key, value) {
    try {
        const unifiedDB = await getUnifiedDB()
        const tx = unifiedDB.transaction(DB_CONFIG.STORES.METADATA, 'readwrite')
        const store = tx.objectStore(DB_CONFIG.STORES.METADATA)
        
        await new Promise((resolve, reject) => {
            const req = store.put({
                key,
                value,
                type: 'migration',
                timestamp: Date.now()
            })
            req.onsuccess = () => resolve()
            req.onerror = () => reject(req.error)
        })
    } catch (error) {
        console.error('[Migration] Failed to record metadata:', error)
    }
}

/**
 * Clean up legacy databases after successful migration
 */
export async function cleanupLegacyDatabases(confirmationCallback = null) {
    const shouldCleanup = confirmationCallback 
        ? await confirmationCallback() 
        : confirm('Delete legacy databases after successful migration? This cannot be undone.')
    
    if (!shouldCleanup) {
        console.log('[Migration] Legacy database cleanup skipped by user')
        return { cleaned: false, reason: 'user_cancelled' }
    }
    
    const results = {
        cleaned: true,
        deletedDatabases: [],
        errors: []
    }
    
    for (const dbName of Object.keys(LEGACY_DATABASES)) {
        try {
            await new Promise((resolve, reject) => {
                const deleteReq = getIndexedDBInstance().deleteDatabase(dbName)
                
                deleteReq.onsuccess = () => {
                    console.log(`[Migration] Deleted legacy database: ${dbName}`)
                    results.deletedDatabases.push(dbName)
                    resolve()
                }
                
                deleteReq.onerror = () => reject(deleteReq.error)
                deleteReq.onblocked = () => {
                    console.warn(`[Migration] Deletion of ${dbName} blocked`)
                    setTimeout(() => reject(new Error('Deletion blocked')), 5000)
                }
            })
        } catch (error) {
            console.error(`[Migration] Failed to delete legacy database ${dbName}:`, error)
            results.errors.push({ database: dbName, error: error.message })
        }
    }
    
    await recordMigrationMetadata('legacy_cleanup', {
        timestamp: Date.now(),
        deletedDatabases: results.deletedDatabases,
        errors: results.errors
    })
    
    return results
}

/**
 * Generate a unique ID
 */
function generateId() {
    try {
        return crypto.randomUUID()
    } catch {
        return `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }
}