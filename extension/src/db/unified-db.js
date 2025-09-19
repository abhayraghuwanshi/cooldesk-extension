/**
 * Unified Database Architecture for CoolDesk Extension
 * Consolidates all data into a single IndexedDB database with proper schema management
 */

// Single database configuration
export const DB_CONFIG = {
    NAME: 'cooldesk-unified-db',
    VERSION: 1,
    STORES: {
        WORKSPACES: 'workspaces',
        WORKSPACE_URLS: 'workspace_urls',
        NOTES: 'notes', 
        URL_NOTES: 'url_notes',
        PINS: 'pins',
        TIME_TRACKING: 'time_tracking',
        ACTIVITY_SERIES: 'activity_series',
        SETTINGS: 'settings',
        UI_STATE: 'ui_state',
        METADATA: 'metadata' // For tracking migrations, health, etc.
    }
}

// Schema definitions for each store
export const SCHEMAS = {
    [DB_CONFIG.STORES.WORKSPACES]: {
        keyPath: 'id',
        indexes: [
            { name: 'by_name', keyPath: 'name', options: { unique: false } },
            { name: 'by_createdAt', keyPath: 'createdAt', options: { unique: false } },
            { name: 'by_gridType', keyPath: 'gridType', options: { unique: false } },
            { name: 'by_updatedAt', keyPath: 'updatedAt', options: { unique: false } }
        ]
    },
    
    [DB_CONFIG.STORES.WORKSPACE_URLS]: {
        keyPath: 'url',
        indexes: [
            { name: 'by_workspaceIds', keyPath: 'workspaceIds', options: { unique: false, multiEntry: true } },
            { name: 'by_addedAt', keyPath: 'addedAt', options: { unique: false } },
            { name: 'by_title', keyPath: 'title', options: { unique: false } }
        ]
    },
    
    [DB_CONFIG.STORES.NOTES]: {
        keyPath: 'id',
        indexes: [
            { name: 'by_createdAt', keyPath: 'createdAt', options: { unique: false } },
            { name: 'by_updatedAt', keyPath: 'updatedAt', options: { unique: false } },
            { name: 'by_title', keyPath: 'title', options: { unique: false } },
            { name: 'by_tags', keyPath: 'tags', options: { unique: false, multiEntry: true } }
        ]
    },
    
    [DB_CONFIG.STORES.URL_NOTES]: {
        keyPath: 'id',
        indexes: [
            { name: 'by_url', keyPath: 'url', options: { unique: false } },
            { name: 'by_createdAt', keyPath: 'createdAt', options: { unique: false } },
            { name: 'by_url_createdAt', keyPath: ['url', 'createdAt'], options: { unique: false } }
        ]
    },
    
    [DB_CONFIG.STORES.PINS]: {
        keyPath: 'id',
        indexes: [
            { name: 'by_url', keyPath: 'url', options: { unique: true } },
            { name: 'by_createdAt', keyPath: 'createdAt', options: { unique: false } }
        ]
    },
    
    [DB_CONFIG.STORES.TIME_TRACKING]: {
        keyPath: 'url',
        indexes: [
            { name: 'by_sessionId', keyPath: 'sessionId', options: { unique: false } },
            { name: 'by_timestamp', keyPath: 'timestamp', options: { unique: false } },
            { name: 'by_url_timestamp', keyPath: ['url', 'timestamp'], options: { unique: false } }
        ]
    },
    
    [DB_CONFIG.STORES.ACTIVITY_SERIES]: {
        keyPath: 'id',
        indexes: [
            { name: 'by_url', keyPath: 'url', options: { unique: false } },
            { name: 'by_timestamp', keyPath: 'timestamp', options: { unique: false } },
            { name: 'by_sessionId', keyPath: 'sessionId', options: { unique: false } },
            { name: 'by_url_timestamp', keyPath: ['url', 'timestamp'], options: { unique: false } }
        ]
    },
    
    [DB_CONFIG.STORES.SETTINGS]: {
        keyPath: 'id',
        indexes: []
    },
    
    [DB_CONFIG.STORES.UI_STATE]: {
        keyPath: 'id', 
        indexes: []
    },
    
    [DB_CONFIG.STORES.METADATA]: {
        keyPath: 'key',
        indexes: [
            { name: 'by_type', keyPath: 'type', options: { unique: false } },
            { name: 'by_timestamp', keyPath: 'timestamp', options: { unique: false } }
        ]
    }
}

// Migration definitions
export const MIGRATIONS = {
    1: {
        description: 'Initial unified database schema',
        up: (db, transaction) => {
            console.log('[Migration v1] Creating unified database schema...')
            
            // Create all object stores with their schemas
            Object.entries(SCHEMAS).forEach(([storeName, schema]) => {
                if (!db.objectStoreNames.contains(storeName)) {
                    console.log(`[Migration v1] Creating store: ${storeName}`)
                    const store = db.createObjectStore(storeName, { keyPath: schema.keyPath })
                    
                    // Create indexes
                    schema.indexes.forEach(indexDef => {
                        try {
                            store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options)
                        } catch (error) {
                            console.warn(`[Migration v1] Failed to create index ${indexDef.name}:`, error)
                        }
                    })
                }
            })
            
            // Initialize metadata
            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 1,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
            
            metadataStore.put({
                key: 'created_at',
                value: Date.now(),
                type: 'system',
                timestamp: Date.now(),
                description: 'Database creation timestamp'
            })
        }
    }
    
    // Future migrations will be added here as version 2, 3, etc.
}

// Database connection singleton
let dbInstance = null
let dbPromise = null

/**
 * Get IndexedDB instance that works in both service worker and window contexts
 */
export function getIndexedDBInstance() {
    // Check for global indexedDB first (works in both contexts)
    if (typeof indexedDB !== 'undefined') {
        return indexedDB;
    }

    // In service worker context, try self
    if (typeof self !== 'undefined' && self.indexedDB) {
        return self.indexedDB;
    }

    // In window context, try window (but safely check if window exists)
    try {
        if (typeof window !== 'undefined' && window.indexedDB) {
            return window.indexedDB;
        }
    } catch (e) {
        // window is not defined in service worker, which is expected
        console.debug('[DB] Window not available in service worker context');
    }

    throw new Error('IndexedDB is not available in this context');
}

/**
 * Get the unified database instance
 */
export async function getUnifiedDB() {
    if (dbInstance && !dbInstance.closed) {
        return dbInstance
    }
    
    if (dbPromise) {
        return dbPromise
    }
    
    dbPromise = openUnifiedDB()
    
    try {
        dbInstance = await dbPromise
        return dbInstance
    } catch (error) {
        dbPromise = null
        throw error
    }
}

/**
 * Open the unified database with proper migration handling
 */
async function openUnifiedDB() {
    return new Promise((resolve, reject) => {
        console.log(`[Unified DB] Opening database: ${DB_CONFIG.NAME} v${DB_CONFIG.VERSION}`)
        
        const request = getIndexedDBInstance().open(DB_CONFIG.NAME, DB_CONFIG.VERSION)
        
        request.onerror = (event) => {
            const error = event.target.error
            console.error('[Unified DB] Failed to open database:', {
                name: error?.name,
                message: error?.message,
                code: error?.code
            })
            reject(error)
        }
        
        request.onblocked = (event) => {
            console.warn('[Unified DB] Database blocked - another connection is preventing upgrade')
            // Try to resolve after a delay, but don't reject immediately
            setTimeout(() => {
                if (!dbInstance) {
                    reject(new Error('Database upgrade blocked by another connection'))
                }
            }, 5000)
        }
        
        request.onsuccess = (event) => {
            const db = event.target.result
            console.log('[Unified DB] Successfully opened database')
            
            // Handle unexpected closure
            db.onclose = () => {
                console.warn('[Unified DB] Database connection closed unexpectedly')
                dbInstance = null
                dbPromise = null
            }
            
            // Handle version changes while open
            db.onversionchange = () => {
                console.warn('[Unified DB] Database version changed, closing connection')
                db.close()
                dbInstance = null
                dbPromise = null
            }
            
            resolve(db)
        }
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result
            const transaction = event.target.transaction
            const oldVersion = event.oldVersion
            const newVersion = event.newVersion
            
            console.log(`[Unified DB] Upgrading database from v${oldVersion} to v${newVersion}`)
            
            try {
                // Run migrations in sequence
                for (let version = oldVersion + 1; version <= newVersion; version++) {
                    if (MIGRATIONS[version]) {
                        console.log(`[Unified DB] Running migration v${version}: ${MIGRATIONS[version].description}`)
                        MIGRATIONS[version].up(db, transaction)
                    }
                }
                
                console.log(`[Unified DB] Successfully upgraded to v${newVersion}`)
            } catch (migrationError) {
                console.error('[Unified DB] Migration failed:', migrationError)
                throw migrationError
            }
        }
    })
}

/**
 * Close the unified database connection
 */
export function closeUnifiedDB() {
    if (dbInstance && !dbInstance.closed) {
        dbInstance.close()
    }
    dbInstance = null
    dbPromise = null
}

/**
 * Get database health and statistics
 */
export async function getDatabaseHealth() {
    try {
        const db = await getUnifiedDB()
        const health = {
            status: 'healthy',
            version: db.version,
            stores: {},
            timestamp: Date.now()
        }
        
        // Check each store
        const transaction = db.transaction(Object.values(DB_CONFIG.STORES), 'readonly')
        
        for (const storeName of Object.values(DB_CONFIG.STORES)) {
            try {
                const store = transaction.objectStore(storeName)
                const countRequest = store.count()
                
                health.stores[storeName] = await new Promise((resolve, reject) => {
                    countRequest.onsuccess = () => resolve({
                        count: countRequest.result,
                        indexes: Array.from(store.indexNames)
                    })
                    countRequest.onerror = () => reject(countRequest.error)
                })
            } catch (error) {
                health.stores[storeName] = { error: error.message }
                health.status = 'degraded'
            }
        }
        
        return health
    } catch (error) {
        return {
            status: 'error',
            error: error.message,
            timestamp: Date.now()
        }
    }
}