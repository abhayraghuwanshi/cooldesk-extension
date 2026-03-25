/**
 * Unified Database Architecture for CoolDesk Extension
 * Consolidates all data into a single IndexedDB database with proper schema management
 */

// Single database configuration
export const DB_CONFIG = {
    NAME: 'cooldesk-unified-db',
    VERSION: 11, // Added APPS store for unified local+web app list with categories
    STORES: {
        WORKSPACES: 'workspaces',
        WORKSPACE_URLS: 'workspace_urls',
        SCRAPED_CHATS: 'scraped_chats', // Cache for scraped AI chat links
        NOTES: 'notes',
        URL_NOTES: 'url_notes',
        PINS: 'pins',
        TIME_TRACKING: 'time_tracking',
        ACTIVITY_SERIES: 'activity_series', // Raw activity (hot data, last 48h)
        DAILY_ANALYTICS: 'daily_analytics', // Aggregated daily stats per URL
        UI_STATE: 'ui_state',
        SCRAPED_CONFIGS: 'scraped_configs', // New store for scraping rules
        DAILY_MEMORY: 'daily_memory', // Daily browsing summaries
        SETTINGS: 'settings', // Application settings
        DASHBOARD: 'dashboard', // Dashboard layout/widgets
        METADATA: 'metadata', // For tracking migrations, health, etc.
        APPS: 'apps' // Unified local + web apps with categories
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
            { name: 'by_title', keyPath: 'title', options: { unique: false } },
            { name: 'by_status', keyPath: 'status', options: { unique: false } }
        ]
    },

    [DB_CONFIG.STORES.SCRAPED_CHATS]: {
        keyPath: 'chatId',
        indexes: [
            { name: 'by_platform', keyPath: 'platform', options: { unique: false } },
            { name: 'by_scrapedAt', keyPath: 'scrapedAt', options: { unique: false } },
            { name: 'by_url', keyPath: 'url', options: { unique: false } },
            { name: 'by_platform_scrapedAt', keyPath: ['platform', 'scrapedAt'], options: { unique: false } }
        ]
    },

    [DB_CONFIG.STORES.SCRAPED_CONFIGS]: {
        keyPath: 'domain',
        indexes: [
            { name: 'by_updatedAt', keyPath: 'updatedAt', options: { unique: false } },
            { name: 'by_source', keyPath: 'source', options: { unique: false } } // 'manual', 'imported', 'auto'
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

    [DB_CONFIG.STORES.DAILY_ANALYTICS]: {
        keyPath: 'id', // Format: url_YYYY-MM-DD
        indexes: [
            { name: 'by_url', keyPath: 'url', options: { unique: false } },
            { name: 'by_date', keyPath: 'date', options: { unique: false } },
            { name: 'by_domain', keyPath: 'domain', options: { unique: false } },
            { name: 'by_totalTime', keyPath: 'totalTime', options: { unique: false } }
        ]
    },

    [DB_CONFIG.STORES.SETTINGS]: {
        keyPath: 'id',
        indexes: []
    },

    [DB_CONFIG.STORES.DASHBOARD]: {
        keyPath: 'id',
        indexes: []
    },

    [DB_CONFIG.STORES.UI_STATE]: {
        keyPath: 'id',
        indexes: []
    },

    [DB_CONFIG.STORES.DAILY_MEMORY]: {
        keyPath: 'id',
        indexes: [
            { name: 'by_userId', keyPath: 'userId', options: { unique: false } },
            { name: 'by_date', keyPath: 'date', options: { unique: false } },
            { name: 'by_userId_date', keyPath: ['userId', 'date'], options: { unique: true } }
        ]
    },

    [DB_CONFIG.STORES.METADATA]: {
        keyPath: 'key',
        indexes: [
            { name: 'by_type', keyPath: 'type', options: { unique: false } },
            { name: 'by_timestamp', keyPath: 'timestamp', options: { unique: false } }
        ]
    },

    [DB_CONFIG.STORES.APPS]: {
        keyPath: 'id', // Format: "local:<path-hash>" or "web:<url-hash>"
        indexes: [
            { name: 'by_type', keyPath: 'type', options: { unique: false } }, // 'local' | 'web'
            { name: 'by_category', keyPath: 'category', options: { unique: false } },
            { name: 'by_name', keyPath: 'name', options: { unique: false } },
            { name: 'by_path', keyPath: 'path', options: { unique: false } }, // For local apps
            { name: 'by_url', keyPath: 'url', options: { unique: false } }, // For web apps
            { name: 'by_lastUsed', keyPath: 'lastUsed', options: { unique: false } },
            { name: 'by_usageCount', keyPath: 'usageCount', options: { unique: false } },
            { name: 'by_type_category', keyPath: ['type', 'category'], options: { unique: false } }
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
    },

    2: {
        description: 'Add SCRAPED_CHATS store for AI chat link scraping',
        up: (db, transaction) => {
            console.log('[Migration v2] Adding SCRAPED_CHATS store...')

            // Create SCRAPED_CHATS store if it doesn't exist
            if (!db.objectStoreNames.contains(DB_CONFIG.STORES.SCRAPED_CHATS)) {
                const schema = SCHEMAS[DB_CONFIG.STORES.SCRAPED_CHATS]
                console.log('[Migration v2] Creating scraped_chats store')
                const store = db.createObjectStore(DB_CONFIG.STORES.SCRAPED_CHATS, { keyPath: schema.keyPath })

                // Create indexes
                schema.indexes.forEach(indexDef => {
                    try {
                        store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options)
                        console.log(`[Migration v2] Created index: ${indexDef.name}`)
                    } catch (error) {
                        console.warn(`[Migration v2] Failed to create index ${indexDef.name}:`, error)
                    }
                })

                console.log('[Migration v2] SCRAPED_CHATS store created successfully')
            }

            // Update metadata
            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 2,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
        }
    },

    // Future migrations will be added here as version 3, 4, etc.
    3: {
        description: 'Add SCRAPED_CONFIGS store for managing scraping rules',
        up: (db, transaction) => {
            console.log('[Migration v3] Adding SCRAPED_CONFIGS store...')

            if (!db.objectStoreNames.contains(DB_CONFIG.STORES.SCRAPED_CONFIGS)) {
                const schema = SCHEMAS[DB_CONFIG.STORES.SCRAPED_CONFIGS]
                console.log('[Migration v3] Creating scraped_configs store')
                const store = db.createObjectStore(DB_CONFIG.STORES.SCRAPED_CONFIGS, { keyPath: schema.keyPath })

                // Create indexes
                schema.indexes.forEach(indexDef => {
                    try {
                        store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options)
                        console.log(`[Migration v3] Created index: ${indexDef.name}`)
                    } catch (error) {
                        console.warn(`[Migration v3] Failed to create index ${indexDef.name}:`, error)
                    }
                })

                console.log('[Migration v3] SCRAPED_CONFIGS store created successfully')
            }

            // Update metadata
            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 3,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
        }
    },
    // Ensure SCRAPED_CONFIGS exists (retry/fix for v3)
    4: {
        description: 'Ensure SCRAPED_CONFIGS store exists',
        up: (db, transaction) => {
            if (!db.objectStoreNames.contains(DB_CONFIG.STORES.SCRAPED_CONFIGS)) {
                console.log('[Migration v4] Creating missing SCRAPED_CONFIGS store')
                const schema = SCHEMAS[DB_CONFIG.STORES.SCRAPED_CONFIGS]
                const store = db.createObjectStore(DB_CONFIG.STORES.SCRAPED_CONFIGS, { keyPath: schema.keyPath })

                schema.indexes.forEach(indexDef => {
                    store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options)
                })
            }
            // Update metadata
            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 4,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
        }
    },
    5: {
        description: 'Add DAILY_MEMORY store for everyday browse memory feature',
        up: (db, transaction) => {
            console.log('[Migration v5] Adding DAILY_MEMORY store...')

            if (!db.objectStoreNames.contains(DB_CONFIG.STORES.DAILY_MEMORY)) {
                const schema = SCHEMAS[DB_CONFIG.STORES.DAILY_MEMORY]
                console.log('[Migration v5] Creating daily_memory store')
                const store = db.createObjectStore(DB_CONFIG.STORES.DAILY_MEMORY, { keyPath: schema.keyPath })

                // Create indexes
                schema.indexes.forEach(indexDef => {
                    try {
                        store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options)
                        console.log(`[Migration v5] Created index: ${indexDef.name}`)
                    } catch (error) {
                        console.warn(`[Migration v5] Failed to create index ${indexDef.name}:`, error)
                    }
                })

                console.log('[Migration v5] DAILY_MEMORY store created successfully')
            }

            // Update metadata
            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 5,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
        }
    },

    6: {
        description: 'Ensure ALL stores exist (Settings fix)',
        up: (db, transaction) => {
            console.log('[Migration v6] Checking consistency of all stores...')

            Object.entries(SCHEMAS).forEach(([storeName, schema]) => {
                if (!db.objectStoreNames.contains(storeName)) {
                    console.log(`[Migration v6] Creating missing store: ${storeName}`)
                    const store = db.createObjectStore(storeName, { keyPath: schema.keyPath })

                    if (schema.indexes) {
                        schema.indexes.forEach(indexDef => {
                            try {
                                store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options)
                            } catch (error) {
                                console.warn(`[Migration v6] Failed to create index ${indexDef.name}:`, error)
                            }
                        })
                    }
                }
            })

            // Update metadata
            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 6,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
        }
    },

    7: {
        description: 'Add DASHBOARD store',
        up: (db, transaction) => {
            console.log('[Migration v7] Adding DASHBOARD store...')
            if (!db.objectStoreNames.contains(DB_CONFIG.STORES.DASHBOARD)) {
                const schema = SCHEMAS[DB_CONFIG.STORES.DASHBOARD]
                db.createObjectStore(DB_CONFIG.STORES.DASHBOARD, { keyPath: schema.keyPath })
            }

            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 7,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
        }
    },

    8: {
        description: 'Add DAILY_ANALYTICS store for aggregated activity data',
        up: (db, transaction) => {
            console.log('[Migration v8] Adding DAILY_ANALYTICS store...')

            if (!db.objectStoreNames.contains(DB_CONFIG.STORES.DAILY_ANALYTICS)) {
                const schema = SCHEMAS[DB_CONFIG.STORES.DAILY_ANALYTICS]
                console.log('[Migration v8] Creating daily_analytics store')
                const store = db.createObjectStore(DB_CONFIG.STORES.DAILY_ANALYTICS, { keyPath: schema.keyPath })

                schema.indexes.forEach(indexDef => {
                    try {
                        store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options)
                        console.log(`[Migration v8] Created index: ${indexDef.name}`)
                    } catch (error) {
                        console.warn(`[Migration v8] Failed to create index ${indexDef.name}:`, error)
                    }
                })

                console.log('[Migration v8] DAILY_ANALYTICS store created successfully')
            }

            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 8,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
        }
    },

    9: {
        description: 'Add status field (draft/active) to WORKSPACE_URLS for tiered qualification',
        up: (db, transaction) => {
            console.log('[Migration v9] Adding status field and index to workspace_urls...')

            try {
                const store = transaction.objectStore(DB_CONFIG.STORES.WORKSPACE_URLS)

                // Add by_status index if it doesn't already exist
                if (!store.indexNames.contains('by_status')) {
                    store.createIndex('by_status', 'status', { unique: false })
                    console.log('[Migration v9] Created by_status index')
                }

                // Backfill existing records: set status = 'active' for all existing URLs
                // (grandfathered in — they were already manually curated or qualified)
                store.openCursor().onsuccess = (event) => {
                    const cursor = event.target.result
                    if (!cursor) {
                        console.log('[Migration v9] Backfill complete')
                        return
                    }
                    if (!cursor.value.status) {
                        cursor.update({ ...cursor.value, status: 'active' })
                    }
                    cursor.continue()
                }
            } catch (err) {
                console.warn('[Migration v9] Error during status migration:', err)
            }

            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 9,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
        }
    },

    10: {
        description: 'Add APPS store for unified local + web apps with categories',
        up: (db, transaction) => {
            console.log('[Migration v10] Adding APPS store...')

            if (!db.objectStoreNames.contains(DB_CONFIG.STORES.APPS)) {
                const schema = SCHEMAS[DB_CONFIG.STORES.APPS]
                console.log('[Migration v10] Creating apps store')
                const store = db.createObjectStore(DB_CONFIG.STORES.APPS, { keyPath: schema.keyPath })

                schema.indexes.forEach(indexDef => {
                    try {
                        store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options)
                        console.log(`[Migration v10] Created index: ${indexDef.name}`)
                    } catch (error) {
                        console.warn(`[Migration v10] Failed to create index ${indexDef.name}:`, error)
                    }
                })

                console.log('[Migration v10] APPS store created successfully')
            }

            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 10,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
        }
    },

    11: {
        description: 'Ensure APPS store exists (fix for v10 migration)',
        up: (db, transaction) => {
            console.log('[Migration v11] Ensuring APPS store exists...')

            if (!db.objectStoreNames.contains(DB_CONFIG.STORES.APPS)) {
                const schema = SCHEMAS[DB_CONFIG.STORES.APPS]
                console.log('[Migration v11] Creating apps store')
                const store = db.createObjectStore(DB_CONFIG.STORES.APPS, { keyPath: schema.keyPath })

                schema.indexes.forEach(indexDef => {
                    try {
                        store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options)
                        console.log(`[Migration v11] Created index: ${indexDef.name}`)
                    } catch (error) {
                        console.warn(`[Migration v11] Failed to create index ${indexDef.name}:`, error)
                    }
                })

                console.log('[Migration v11] APPS store created successfully')
            } else {
                console.log('[Migration v11] APPS store already exists')
            }

            const metadataStore = transaction.objectStore(DB_CONFIG.STORES.METADATA)
            metadataStore.put({
                key: 'schema_version',
                value: 11,
                type: 'system',
                timestamp: Date.now(),
                description: 'Database schema version'
            })
        }
    }
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