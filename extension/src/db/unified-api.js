/**
 * Unified Database API Layer
 * Production-ready interface that replaces all existing database files
 * Provides consistent, validated, error-handled database operations
 */

import { getUrlParts } from '../utils/helpers.js'
import { ErrorSeverity, ErrorStrategy, handleDatabaseError, withErrorHandling } from './error-handler.js'
import { cleanupLegacyDatabases, isMigrationNeeded, performMigration } from './migration-manager.js'
import { closeUnifiedDB, DB_CONFIG, getUnifiedDB } from './unified-db.js'
import { validateAndSanitize } from './validation.js'

/**
 * Initialize the unified database system
 * This should be called when the extension starts
 */
export async function initializeDatabase() {
    try {
        console.log('[Unified API] Initializing database system...')

        // Check if migration is needed
        const needsMigration = await isMigrationNeeded()

        if (needsMigration) {
            console.log('[Unified API] Migration required, starting data migration...')

            const migrationResult = await performMigration((progress) => {
                console.log(`[Unified API] Migration progress: ${progress.stage} - ${progress.progress}%`)
            })

            if (migrationResult.success) {
                console.log(`[Unified API] Migration completed successfully, imported ${migrationResult.migratedRecords} records`)

                // Optionally clean up legacy databases
                try {
                    await cleanupLegacyDatabases(() => true) // Auto-cleanup
                    console.log('[Unified API] Legacy databases cleaned up')
                } catch (error) {
                    console.warn('[Unified API] Legacy cleanup failed:', error)
                }
            } else {
                console.error('[Unified API] Migration failed:', migrationResult.errors)
                throw new Error('Database migration failed')
            }
        }

        // Ensure database is open and ready
        const db = await getUnifiedDB()
        console.log(`[Unified API] Database initialized successfully (version ${db.version})`)

        return { success: true, migrated: needsMigration }
    } catch (error) {
        console.error('[Unified API] Database initialization failed:', error)
        return await handleDatabaseError(error, {
            operation: 'initialize',
            severity: ErrorSeverity.CRITICAL,
            strategy: ErrorStrategy.FAIL_FAST
        })
    }
}

// ===== WORKSPACE OPERATIONS =====

/**
 * List all workspaces with optional filtering
 */
export const listWorkspaces = withErrorHandling(async (options = {}) => {
    const { limit, offset, sortBy = 'updatedAt', sortOrder = 'desc' } = options

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.WORKSPACES, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.WORKSPACES)

    let results = []

    if (sortBy === 'name') {
        const index = store.index('by_name')
        const request = index.getAll()
        results = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || [])
            request.onerror = () => reject(request.error)
        })
    } else if (sortBy === 'createdAt') {
        const index = store.index('by_createdAt')
        const request = index.getAll()
        results = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || [])
            request.onerror = () => reject(request.error)
        })
    } else {
        // Default to getting all and sorting by updatedAt
        const request = store.getAll()
        results = await new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const res = request.result || []
                // console.log(`[Unified API] listWorkspaces raw count: ${res.length}`)
                resolve(res)
            }
            request.onerror = () => reject(request.error)
        })
    }

    // Sort results
    if (sortBy === 'updatedAt' || sortBy === 'createdAt') {
        results.sort((a, b) => {
            const aTime = a[sortBy] || 0
            const bTime = b[sortBy] || 0
            return sortOrder === 'desc' ? bTime - aTime : aTime - bTime
        })
    }

    // Apply pagination
    if (offset) results = results.slice(offset)
    if (limit) results = results.slice(0, limit)

    return results
}, {
    operation: 'listWorkspaces',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => []
})

/**
 * Get a single workspace by ID
 */
export const getWorkspace = withErrorHandling(async (id) => {
    if (!id) throw new Error('Workspace ID is required')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.WORKSPACES, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.WORKSPACES)

    const request = store.get(id)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'getWorkspace',
    severity: ErrorSeverity.LOW
})

/**
 * Save or update a workspace
 */
export const saveWorkspace = withErrorHandling(async (workspaceData, options = {}) => {
    // Validate and sanitize data
    const workspace = validateAndSanitize(workspaceData, 'workspace')

    // Deduplicate URLs array by URL string (keep first occurrence)
    if (Array.isArray(workspace.urls) && workspace.urls.length > 0) {
        const seenUrls = new Set()
        workspace.urls = workspace.urls.filter(u => {
            if (!u?.url || seenUrls.has(u.url)) return false
            seenUrls.add(u.url)
            return true
        })
    }

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.WORKSPACES, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.WORKSPACES)

    const request = store.put(workspace)

    // Use transaction events for more reliable persistence check
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
            console.log(`[Unified API] Saved workspace: ${workspace.name} (${workspace.id})`)

            // Notify listeners
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('ws_db_changes')
                    bc.postMessage({ type: 'workspacesChanged' })
                    bc.close()
                } catch { }
            }

            resolve(workspace)
        }

        tx.onerror = () => reject(tx.error)
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'saveWorkspace',
    severity: ErrorSeverity.MEDIUM,
    strategy: ErrorStrategy.RETRY,
    maxRetries: 3
})

/**
 * Delete a workspace by ID
 */
export const deleteWorkspace = withErrorHandling(async (id) => {
    if (!id) throw new Error('Workspace ID is required')

    const db = await getUnifiedDB()
    const tx = db.transaction([DB_CONFIG.STORES.WORKSPACES, DB_CONFIG.STORES.WORKSPACE_URLS], 'readwrite')

    // Delete workspace
    const workspaceStore = tx.objectStore(DB_CONFIG.STORES.WORKSPACES)
    const deleteWorkspaceReq = workspaceStore.delete(id)

    // Remove workspace ID from URLs
    const urlStore = tx.objectStore(DB_CONFIG.STORES.WORKSPACE_URLS)
    const urlIndex = urlStore.index('by_workspaceIds')
    const urlsReq = urlIndex.getAll(id)

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
            console.log(`[Unified API] Deleted workspace: ${id}`)

            // Notify listeners
            try {
                const bc = new BroadcastChannel('ws_db_changes')
                bc.postMessage({ type: 'workspacesChanged' })
                bc.close()
            } catch { }

            resolve(true)
        }

        tx.onerror = () => reject(tx.error)

        // Handle URL cleanup
        urlsReq.onsuccess = () => {
            const urls = urlsReq.result || []
            urls.forEach(urlDoc => {
                const updatedWorkspaceIds = urlDoc.workspaceIds.filter(wsId => wsId !== id)
                if (updatedWorkspaceIds.length === 0) {
                    // Delete URL if no workspaces remain
                    urlStore.delete(urlDoc.url)
                } else {
                    // Update URL with remaining workspace IDs
                    urlStore.put({ ...urlDoc, workspaceIds: updatedWorkspaceIds })
                }
            })
        }
    })
}, {
    operation: 'deleteWorkspace',
    severity: ErrorSeverity.MEDIUM,
    strategy: ErrorStrategy.RETRY
})

// ===== WORKSPACE URL OPERATIONS =====

/**
 * Add URL to workspace
 */
export const addUrlToWorkspace = withErrorHandling(async (url, workspaceId, metadata = {}) => {
    if (!url || !workspaceId) throw new Error('URL and workspace ID are required')

    const urlData = validateAndSanitize({
        url,
        title: metadata.title || '',
        favicon: metadata.favicon || '',
        workspaceIds: [workspaceId],
        addedAt: metadata.addedAt || Date.now(),
        extra: metadata.extra || {}
    }, 'workspaceUrl')

    const db = await getUnifiedDB()
    const tx = db.transaction([DB_CONFIG.STORES.WORKSPACE_URLS, DB_CONFIG.STORES.WORKSPACES], 'readwrite')
    const urlStore = tx.objectStore(DB_CONFIG.STORES.WORKSPACE_URLS)
    const workspaceStore = tx.objectStore(DB_CONFIG.STORES.WORKSPACES)

    // Get existing URL or create new
    const getUrlReq = urlStore.get(url)
    const getWorkspaceReq = workspaceStore.get(workspaceId)

    return new Promise((resolve, reject) => {
        let urlDoc
        let workspace

        getUrlReq.onsuccess = () => {
            const existing = getUrlReq.result

            if (existing) {
                // Add workspace ID if not already present
                const workspaceIds = new Set(existing.workspaceIds)
                workspaceIds.add(workspaceId)
                urlDoc = {
                    ...existing,
                    ...metadata,
                    workspaceIds: Array.from(workspaceIds)
                }
            } else {
                urlDoc = urlData
            }

            // Update workspace_urls store
            urlStore.put(urlDoc)
        }

        getWorkspaceReq.onsuccess = () => {
            workspace = getWorkspaceReq.result

            if (workspace) {
                // Ensure urls array exists
                if (!Array.isArray(workspace.urls)) {
                    workspace.urls = []
                }

                // Check if URL already exists in workspace
                const existingIndex = workspace.urls.findIndex(u => u.url === url)

                const urlEntry = {
                    url,
                    title: metadata.title || url,
                    addedAt: metadata.addedAt || Date.now(),
                    favicon: metadata.favicon || `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`
                }

                if (existingIndex >= 0) {
                    // Update existing entry
                    workspace.urls[existingIndex] = {
                        ...workspace.urls[existingIndex],
                        ...urlEntry
                    }
                } else {
                    // Add new entry
                    workspace.urls.push(urlEntry)
                }

                // Update workspace's updatedAt timestamp
                workspace.updatedAt = Date.now()

                // Save updated workspace
                workspaceStore.put(workspace)
            }
        }

        tx.oncomplete = () => {
            // console.log(`[Unified API] Added URL to workspace: ${url} -> ${workspaceId}`)
            resolve(urlDoc)
        }

        tx.onerror = () => reject(tx.error)
        getUrlReq.onerror = () => reject(getUrlReq.error)
        getWorkspaceReq.onerror = () => reject(getWorkspaceReq.error)
    })
}, {
    operation: 'addUrlToWorkspace',
    severity: ErrorSeverity.MEDIUM
})

/**
 * List URLs in a workspace
 */
export const listWorkspaceUrls = withErrorHandling(async (workspaceId, options = {}) => {
    if (!workspaceId) throw new Error('Workspace ID is required')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.WORKSPACE_URLS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.WORKSPACE_URLS)
    const index = store.index('by_workspaceIds')

    const request = index.getAll(workspaceId)

    let results = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })

    // Apply sorting
    if (options.sortBy === 'addedAt') {
        results.sort((a, b) => {
            const order = options.sortOrder === 'asc' ? 1 : -1
            return ((b.addedAt || 0) - (a.addedAt || 0)) * order
        })
    }

    return results
}, {
    operation: 'listWorkspaceUrls',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => []
})

// ===== SCRAPED CHATS OPERATIONS =====

/**
 * List all scraped AI chats with optional filtering
 */
export const listScrapedChats = withErrorHandling(async (options = {}) => {
    const { platform, limit, offset, sortBy = 'scrapedAt', sortOrder = 'desc' } = options

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_CHATS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS)

    let results = []

    if (platform) {
        // Filter by platform using index
        const index = store.index('by_platform')
        const request = index.getAll(platform)
        results = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || [])
            request.onerror = () => reject(request.error)
        })
    } else {
        // Get all chats
        const request = store.getAll()
        results = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || [])
            request.onerror = () => reject(request.error)
        })
    }

    // Sort results
    if (sortBy === 'scrapedAt') {
        results.sort((a, b) => {
            const aTime = a.scrapedAt || 0
            const bTime = b.scrapedAt || 0
            return sortOrder === 'desc' ? bTime - aTime : aTime - bTime
        })
    } else if (sortBy === 'title') {
        results.sort((a, b) => {
            const aTitle = (a.title || '').toLowerCase()
            const bTitle = (b.title || '').toLowerCase()
            return sortOrder === 'desc' ? bTitle.localeCompare(aTitle) : aTitle.localeCompare(bTitle)
        })
    }

    // Apply pagination
    if (offset) results = results.slice(offset)
    if (limit) results = results.slice(0, limit)

    return results
}, {
    operation: 'listScrapedChats',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => []
})

/**
 * Get a single scraped chat by ID
 */
export const getScrapedChat = withErrorHandling(async (chatId) => {
    if (!chatId) throw new Error('Chat ID is required')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_CHATS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS)

    const request = store.get(chatId)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'getScrapedChat',
    severity: ErrorSeverity.LOW
})

/**
 * Save or update a scraped chat
 */
export const saveScrapedChat = withErrorHandling(async (chatData, options = {}) => {
    // Validate and sanitize data (strict: false allows extra fields from sync)
    const chat = validateAndSanitize(chatData, 'scrapedChat', { strict: false })

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_CHATS, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS)

    const request = store.put(chat)

    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            console.log(`[Unified API] Saved scraped chat: ${chat.title} (${chat.chatId})`)

            // Notify listeners
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('scraped_chats_db_changes')
                    bc.postMessage({ type: 'scrapedChatsChanged' })
                    bc.close()
                } catch { }
            }

            resolve(chat)
        }
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'saveScrapedChat',
    severity: ErrorSeverity.MEDIUM,
    strategy: ErrorStrategy.RETRY,
    maxRetries: 3
})

/**
 * Delete a scraped chat by ID
 */
export const deleteScrapedChat = withErrorHandling(async (chatId) => {
    if (!chatId) throw new Error('Chat ID is required')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_CHATS, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS)

    const request = store.delete(chatId)

    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            console.log(`[Unified API] Deleted scraped chat: ${chatId}`)

            // Notify listeners
            try {
                const bc = new BroadcastChannel('scraped_chats_db_changes')
                bc.postMessage({ type: 'scrapedChatsChanged' })
                bc.close()
            } catch { }

            resolve(true)
        }
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'deleteScrapedChat',
    severity: ErrorSeverity.MEDIUM
})

/**
 * Delete all scraped chats for a specific platform
 */
export const deleteScrapedChatsByPlatform = withErrorHandling(async (platform) => {
    if (!platform) throw new Error('Platform is required')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_CHATS, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS)
    const index = store.index('by_platform')

    // Get all chats for this platform
    const chatsRequest = index.getAll(platform)

    return new Promise((resolve, reject) => {
        chatsRequest.onsuccess = () => {
            const chats = chatsRequest.result || []
            let deletedCount = 0

            // Delete each chat
            chats.forEach(chat => {
                const deleteReq = store.delete(chat.chatId)
                deleteReq.onsuccess = () => deletedCount++
            })

            tx.oncomplete = () => {
                console.log(`[Unified API] Deleted ${deletedCount} chats from ${platform}`)

                // Notify listeners
                try {
                    const bc = new BroadcastChannel('scraped_chats_db_changes')
                    bc.postMessage({ type: 'scrapedChatsChanged' })
                    bc.close()
                } catch { }

                resolve(deletedCount)
            }
            tx.onerror = () => reject(tx.error)
        }
        chatsRequest.onerror = () => reject(chatsRequest.error)
    })
}, {
    operation: 'deleteScrapedChatsByPlatform',
    severity: ErrorSeverity.MEDIUM
})

/**
 * Get stats for scraped chats (count per platform)
 */
export const getScrapedChatStats = withErrorHandling(async () => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_CHATS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CHATS)
    const platformIndex = store.index('by_platform')

    const byPlatform = {}

    await new Promise((resolve, reject) => {
        const keyRequest = platformIndex.openKeyCursor(null, 'nextunique')
        const platforms = []

        keyRequest.onsuccess = (event) => {
            const cursor = event.target.result
            if (cursor) {
                platforms.push(cursor.key)
                cursor.continue()
            } else {
                // Now count each
                Promise.all(platforms.map(p =>
                    new Promise((res) => {
                        const countReq = platformIndex.count(p)
                        countReq.onsuccess = () => res({ platform: p, count: countReq.result })
                        countReq.onerror = () => res({ platform: p, count: 0 })
                    })
                )).then(counts => {
                    counts.forEach(c => byPlatform[c.platform] = c.count)
                    resolve()
                }).catch(reject)
            }
        }
        keyRequest.onerror = () => reject(keyRequest.error)
    })

    return byPlatform
}, {
    operation: 'getScrapedChatStats',
    severity: ErrorSeverity.LOW,
    fallbackFunction: () => ({})
})

// ===== NOTES OPERATIONS =====

/**
 * List all notes with optional filtering
 */
export const listNotes = withErrorHandling(async (options = {}) => {
    const { limit = 200, offset = 0, sortBy = 'updatedAt' } = options

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.NOTES, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.NOTES)

    const request = store.getAll()
    let results = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })

    // Sort and paginate
    results.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0))

    return results.slice(offset, offset + limit)
}, {
    operation: 'listNotes',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => []
})

/**
 * Save or update a note
 */
export const saveNote = withErrorHandling(async (noteData, options = {}) => {
    const note = validateAndSanitize(noteData, 'note')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.NOTES, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.NOTES)

    return new Promise((resolve, reject) => {
        // Enforce note limit of 200 by cleaning oldest - do this within the transaction
        const getAllRequest = store.getAll()

        getAllRequest.onsuccess = () => {
            const allNotes = getAllRequest.result || []

            // If we have too many notes, delete the oldest ones
            if (allNotes.length >= 200) {
                // Sort by creation time (oldest first)
                allNotes.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
                const toDelete = allNotes.slice(0, allNotes.length - 199) // Keep 199, delete rest

                // Delete old notes within the same transaction
                toDelete.forEach(oldNote => {
                    store.delete(oldNote.id)
                })
            }

            // Now save the new note
            const putRequest = store.put(note)
            putRequest.onsuccess = () => {
                // Notify listeners
                if (!options.skipNotify) {
                    try {
                        const bc = new BroadcastChannel('notes_db_changes')
                        bc.postMessage({ type: 'notesChanged' })
                        bc.close()
                    } catch { }
                }
                resolve(note)
            }
            putRequest.onerror = () => reject(putRequest.error)
        }

        getAllRequest.onerror = () => reject(getAllRequest.error)
    })
}, {
    operation: 'saveNote',
    severity: ErrorSeverity.MEDIUM
})

// ===== URL NOTES OPERATIONS =====

/**
 * Get notes for a specific URL
 */
export const getUrlNotes = withErrorHandling(async (url) => {
    if (!url) return []

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.URL_NOTES, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.URL_NOTES)
    const index = store.index('by_url')

    const request = index.getAll(url)
    const results = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })

    return results.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}, {
    operation: 'getUrlNotes',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => []
})

/**
 * Save a URL note
 */
export const saveUrlNote = withErrorHandling(async (noteData, options = {}) => {
    const note = validateAndSanitize({
        id: noteData.id || generateId(),
        ...noteData
    }, 'urlNote')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.URL_NOTES, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.URL_NOTES)

    const request = store.put(note)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            // Notify listeners
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('url_notes_db_changes')
                    bc.postMessage({ type: 'urlNotesChanged' })
                    bc.close()
                } catch { }
            }
            resolve(note)
        }
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'saveUrlNote',
    severity: ErrorSeverity.MEDIUM
})


/**
 * List all URL notes
 */
export const listAllUrlNotes = withErrorHandling(async () => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.URL_NOTES, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.URL_NOTES)

    const request = store.getAll()
    const results = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })

    return results.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}, {
    operation: 'listAllUrlNotes',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => []
})
// ===== SETTINGS & UI STATE =====

/**
 * Get settings
 */
export const getSettings = withErrorHandling(async () => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SETTINGS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.SETTINGS)

    const request = store.get('default')
    const result = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })

    return result || {
        id: 'default',
        geminiApiKey: '',
        modelName: '',
        visitCountThreshold: '',
        historyDays: '',
        updatedAt: Date.now()
    }
}, {
    operation: 'getSettings',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => ({
        id: 'default',
        geminiApiKey: '',
        modelName: '',
        visitCountThreshold: '',
        historyDays: '',
        updatedAt: Date.now()
    })
})

/**
 * Save settings
 */
export const saveSettings = withErrorHandling(async (settingsData, options = {}) => {
    const settings = validateAndSanitize({
        id: 'default',
        ...settingsData,
        updatedAt: Date.now()
    }, 'settings')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SETTINGS, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.SETTINGS)

    const request = store.put(settings)

    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            // Notify settings change
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('settings_db_changes')
                    bc.postMessage({ type: 'settingsChanged' })
                    bc.close()
                } catch { }
            }

            resolve(settings)
        }
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'saveSettings',
    severity: ErrorSeverity.MEDIUM
})

/**
 * Get UI state
 */
export const getUIState = withErrorHandling(async () => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.UI_STATE, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.UI_STATE)

    const request = store.get('default')
    const result = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })

    // Flatten any nested 'data' properties to fix corrupted state
    const flattenData = (obj) => {
        if (!obj || typeof obj !== 'object') return obj

        let flattened = { ...obj }
        while (flattened.data && typeof flattened.data === 'object' && !Array.isArray(flattened.data)) {
            const { data, ...rest } = flattened
            flattened = { ...rest, ...data }
        }

        return flattened
    }

    const flattened = result ? flattenData(result) : null

    return flattened || {
        id: 'default',
        selectedTab: null,
        selectedWorkspace: null,
        viewMode: 'grid',
        updatedAt: Date.now()
    }
}, {
    operation: 'getUIState',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => ({
        id: 'default',
        selectedTab: null,
        selectedWorkspace: null,
        viewMode: 'grid',
        updatedAt: Date.now()
    })
})

/**
 * Save UI state
 */
export const saveUIState = withErrorHandling(async (uiStateData, options = {}) => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.UI_STATE, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.UI_STATE)

    // Flatten any nested 'data' properties to prevent tree-like nesting
    const flattenData = (obj) => {
        if (!obj || typeof obj !== 'object') return obj

        // If there's a nested 'data' property, flatten it
        let flattened = { ...obj }
        while (flattened.data && typeof flattened.data === 'object' && !Array.isArray(flattened.data)) {
            const { data, ...rest } = flattened
            flattened = { ...rest, ...data }
        }

        return flattened
    }

    const flatNew = flattenData(uiStateData)

    // Check if this is a partial update (only a few fields) or full state (has id)
    // If it's a full state object, don't merge - just replace
    const isFullState = flatNew && flatNew.id === 'default'

    let merged
    if (isFullState) {
        // Full state replacement - don't merge to avoid double-nesting
        merged = {
            ...flatNew,
            updatedAt: Date.now()
        }
    } else {
        // Partial update - merge with existing
        const existing = await new Promise((resolve) => {
            try {
                const getReq = store.get('default')
                getReq.onsuccess = () => resolve(getReq.result || null)
                getReq.onerror = () => resolve(null)
            } catch {
                resolve(null)
            }
        })

        const flatExisting = flattenData(existing)

        merged = {
            id: 'default',
            ...(flatExisting || {}),
            ...(flatNew || {}),
            updatedAt: Date.now()
        }
    }

    const uiState = validateAndSanitize(merged, 'uiState', { strict: false })

    const request = store.put(uiState)

    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            // Notify listeners
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('ui_state_db_changes')
                    bc.postMessage({ type: 'uiStateChanged' })
                    bc.close()
                } catch { }
            }
            resolve(uiState)
        }
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'saveUIState',
    severity: ErrorSeverity.MEDIUM
})
export const putActivityTimeSeriesEvent = withErrorHandling(async (eventData, options = {}) => {
    console.log('[DB Debug] putActivityTimeSeriesEvent called with:', {
        id: eventData.id,
        url: eventData.url,
        timestamp: eventData.timestamp,
        hasMetrics: !!eventData.metrics
    })

    const event = validateAndSanitize({
        id: eventData.id || generateId(),
        timestamp: eventData.timestamp || Date.now(),
        sessionId: eventData.sessionId || `session_${Date.now()}`,
        ...eventData
    }, 'activitySeries')

    console.log('[DB Debug] Event after validation:', {
        id: event.id,
        url: event.url,
        timestamp: event.timestamp,
        sessionId: event.sessionId,
        time: event.time,
        metrics: event.metrics
    })

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.ACTIVITY_SERIES, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES)

    console.log('[DB Debug] About to store event in:', DB_CONFIG.STORES.ACTIVITY_SERIES)

    const request = store.put(event)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            console.log('[DB Debug] Successfully stored activity event:', event.id)

            // Notify listeners
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('activity_db_changes')
                    bc.postMessage({ type: 'activityChanged', data: event })
                    bc.close()
                } catch (e) {
                    console.error('[DB Debug] Failed to broadcast activity change:', e)
                }
            }

            resolve(event)
        }
        request.onerror = () => {
            console.error('[DB Debug] Error storing activity event:', request.error)
            reject(request.error)
        }
    })
}, {
    operation: 'putActivityTimeSeriesEvent',
    severity: ErrorSeverity.LOW
})

/**
 * Put activity row (for legacy compatibility)
 */
export const putActivityRow = putActivityTimeSeriesEvent

/**
 * Get all activity data (ultra-fast version for small datasets)
 */
export const getAllActivity = withErrorHandling(async (options = {}) => {
    const startTime = Date.now()
    const { limit = 100 } = options // Much smaller limit for speed

    console.log('[DB Debug] getAllActivity called - ultra-fast mode')

    try {
        const db = await getUnifiedDB()

        // Use the fastest possible approach - direct getAll with immediate resolve
        const tx = db.transaction(DB_CONFIG.STORES.ACTIVITY_SERIES, 'readonly')
        const store = tx.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES)

        // Set a 2-second timeout on the entire operation
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database operation timeout')), 2000)
        })

        const dataPromise = new Promise((resolve, reject) => {
            const request = store.getAll()

            request.onsuccess = () => {
                const data = request.result || []
                console.log('[DB Debug] Fast retrieval:', data.length, 'records in', Date.now() - startTime, 'ms')

                // Quick sort and limit - no complex operations
                const sorted = data
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                    .slice(0, limit)

                resolve(sorted)
            }

            request.onerror = () => {
                console.error('[DB Debug] Fast retrieval error:', request.error)
                reject(request.error)
            }
        })

        // Race between data retrieval and timeout
        const results = await Promise.race([dataPromise, timeoutPromise])

        console.log('[DB Debug] getAllActivity completed in', Date.now() - startTime, 'ms, returning', results.length, 'records')
        return results

    } catch (error) {
        console.error('[DB Debug] getAllActivity failed:', error)
        // Return empty array immediately on any error
        return []
    }
}, {
    operation: 'getAllActivity',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => {
        console.log('[DB Debug] Using fallback - returning empty array')
        return []
    }
})

/**
 * Clean up old time series data (DEPRECATED - use aggregateAndCleanupActivity instead)
 * This function now calls aggregateAndCleanupActivity to preserve data
 */
export const cleanupOldTimeSeriesData = withErrorHandling(async (retentionDays = 30) => {
    // Convert days to ms (but use 48h minimum to keep recent data for ResumeWork widget)
    const retentionMs = Math.max(48 * 60 * 60 * 1000, retentionDays * 24 * 60 * 60 * 1000)

    console.log(`[Cleanup] Aggregating and cleaning data older than ${retentionDays} days`)

    // Use the new aggregation function that preserves data
    const result = await aggregateAndCleanupActivity(retentionMs)

    console.log(`[Cleanup] Aggregated ${result.aggregated} records, deleted ${result.deleted} old events`)
    return result.deleted
}, {
    operation: 'cleanupOldTimeSeriesData',
    severity: ErrorSeverity.LOW
})

/**
 * Get time series storage statistics
 */
export const getTimeSeriesStorageStats = withErrorHandling(async () => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.ACTIVITY_SERIES, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES)

    const countRequest = store.count()
    const totalEvents = await new Promise((resolve, reject) => {
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error)
    })

    const estimatedSizeMB = (totalEvents * 0.5) / 1024 // ~500 bytes per event

    // Get oldest and newest timestamps
    const index = store.index('by_timestamp')
    const oldestRequest = index.openCursor()
    const newestRequest = index.openCursor(null, 'prev')

    const oldest = await new Promise((resolve) => {
        oldestRequest.onsuccess = (e) => {
            if (e.target.result) resolve(e.target.result.value.timestamp)
            else resolve(null)
        }
        oldestRequest.onerror = () => resolve(null)
    })

    const newest = await new Promise((resolve) => {
        newestRequest.onsuccess = (e) => {
            if (e.target.result) resolve(e.target.result.value.timestamp)
            else resolve(null)
        }
        newestRequest.onerror = () => resolve(null)
    })

    return {
        totalEvents,
        estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
        oldestEvent: oldest,
        newestEvent: newest,
        spanDays: oldest && newest ? Math.round((newest - oldest) / (24 * 60 * 60 * 1000)) : 0
    }
}, {
    operation: 'getTimeSeriesStorageStats',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => ({ totalEvents: 0, estimatedSizeMB: 0 })
})

/**
 * List all workspace URLs (legacy compatibility)
 */
export const listAllUrls = withErrorHandling(async () => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.WORKSPACE_URLS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.WORKSPACE_URLS)

    const request = store.getAll()
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'listAllUrls',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => []
})

/**
 * Get URL record (legacy compatibility)
 */
export const getUrlRecord = withErrorHandling(async (url) => {
    if (!url) return null

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.WORKSPACE_URLS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.WORKSPACE_URLS)

    const request = store.get(url)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'getUrlRecord',
    severity: ErrorSeverity.LOW
})

/**
 * Upsert URL (legacy compatibility)
 */
export const upsertUrl = withErrorHandling(async (urlData) => {
    if (!urlData?.url) throw new Error('URL is required')

    return await addUrlToWorkspace(urlData.url, urlData.workspaceIds?.[0] || 'default', {
        title: urlData.title,
        favicon: urlData.favicon,
        extra: urlData.extra
    })
}, {
    operation: 'upsertUrl',
    severity: ErrorSeverity.MEDIUM
})

/**
 * Delete URL note
 */
export const deleteUrlNote = withErrorHandling(async (noteId) => {
    if (!noteId) throw new Error('Note ID is required')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.URL_NOTES, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.URL_NOTES)

    const request = store.delete(noteId)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(true)
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'deleteUrlNote',
    severity: ErrorSeverity.MEDIUM
})

/**
 * Delete a note (legacy compatibility)
 */
export const deleteNote = withErrorHandling(async (noteId) => {
    if (!noteId) throw new Error('Note ID is required')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.NOTES, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.NOTES)

    const request = store.delete(noteId)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(true)
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'deleteNote',
    severity: ErrorSeverity.MEDIUM
})

/**
 * Upsert a note (legacy compatibility)
 */
export const upsertNote = saveNote

/**
 * List pins (legacy compatibility)
 */
export const listPings = withErrorHandling(async (options = {}) => {
    const { limit = 12 } = options

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.PINS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.PINS)

    const request = store.getAll()
    let results = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })

    // Sort by creation time and limit
    results.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

    return results.slice(0, limit)
}, {
    operation: 'listPings',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => []
})

/**
 * Upsert a pin (legacy compatibility)
 */
export const upsertPing = withErrorHandling(async (pingData, options = {}) => {
    const pin = validateAndSanitize({
        id: pingData.id || pingData.url,
        url: pingData.url,
        title: pingData.title || '',
        favicon: pingData.favicon || '',
        createdAt: pingData.createdAt || Date.now()
    }, 'pin')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.PINS, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.PINS)

    return new Promise((resolve, reject) => {
        // Save the new pin directly without enforcing any limit
        const putRequest = store.put(pin)
        putRequest.onsuccess = () => {
            // Notify listeners
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('ws_db_changes')
                    bc.postMessage({ type: 'pinsChanged' })
                    bc.close()
                } catch { }
            }
            resolve(pin)
        }
        putRequest.onerror = () => reject(putRequest.error)
    })
}, {
    operation: 'upsertPing',
    severity: ErrorSeverity.MEDIUM
})

/**
 * Delete a pin (legacy compatibility)
 */
export const deletePing = withErrorHandling(async (pinId) => {
    if (!pinId) throw new Error('Pin ID is required')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.PINS, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.PINS)

    const request = store.delete(pinId)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            // Notify listeners
            try {
                const bc = new BroadcastChannel('ws_db_changes')
                bc.postMessage({ type: 'pinsChanged' })
                bc.close()
            } catch { }
            resolve(true)
        }
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'deletePing',
    severity: ErrorSeverity.MEDIUM
})

/**
 * Delete workspace by ID (enhanced version)
 */
export const deleteWorkspaceById = deleteWorkspace

/**
 * Update workspace grid type
 */
export const updateWorkspaceGridType = withErrorHandling(async (workspaceId, gridType) => {
    if (!workspaceId || !gridType) throw new Error('Workspace ID and grid type are required')

    // Get existing workspace
    const workspace = await getWorkspace(workspaceId)
    if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
    }

    // Update with new grid type
    const updatedWorkspace = {
        ...workspace,
        gridType,
        updatedAt: Date.now()
    }

    return await saveWorkspace(updatedWorkspace)
}, {
    operation: 'updateWorkspaceGridType',
    severity: ErrorSeverity.MEDIUM
})

/**
 * Update item workspace assignment (legacy compatibility)
 */
export const updateItemWorkspace = withErrorHandling(async (itemId, workspaceName) => {
    if (!itemId) throw new Error('Item ID is required')

    try {
        // This function operates on dashboardData in chrome.storage.local
        const { dashboardData } = await chrome.storage.local.get(['dashboardData'])
        if (!dashboardData) return

        const bookmarks = dashboardData.bookmarks || []
        const history = dashboardData.history || []

        let itemUpdated = false

        const newBookmarks = bookmarks.map(item => {
            if (item.id === itemId) {
                itemUpdated = true
                return { ...item, workspaceGroup: workspaceName }
            }
            return item
        })

        let newHistory = history
        if (!itemUpdated) {
            newHistory = history.map(item => {
                if (item.id === itemId) {
                    itemUpdated = true
                    return { ...item, workspaceGroup: workspaceName }
                }
                return item
            })
        }

        if (itemUpdated) {
            await chrome.storage.local.set({
                dashboardData: {
                    ...dashboardData,
                    bookmarks: newBookmarks,
                    history: newHistory
                }
            })
        }

        return itemUpdated
    } catch (error) {
        console.error('Error updating item workspace:', error)
        return false
    }
}, {
    operation: 'updateItemWorkspace',
    severity: ErrorSeverity.MEDIUM
})

// ===== UTILITY FUNCTIONS =====

/**
 * Get database health and statistics
 */
export const getDatabaseHealth = withErrorHandling(async () => {
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
}, {
    operation: 'getDatabaseHealth',
    severity: ErrorSeverity.LOW
})

/**
 * Subscribe to workspace changes
 */
export function subscribeWorkspaceChanges(callback) {
    let bc
    try {
        bc = new BroadcastChannel('ws_db_changes')
        bc.onmessage = (ev) => {
            if (ev?.data?.type === 'workspacesChanged') callback()
        }
    } catch { }
    return () => {
        try { bc && bc.close() } catch { }
    }
}

/**
 * Subscribe to pins changes
 */
export function subscribePinsChanges(callback) {
    let bc
    try {
        bc = new BroadcastChannel('ws_db_changes')
        bc.onmessage = (ev) => {
            if (ev?.data?.type === 'pinsChanged') callback()
        }
    } catch { }
    return () => {
        try { bc && bc.close() } catch { }
    }
}

/**
 * Subscribe to daily notes changes
 */
export function subscribeDailyNotesChanges(callback) {
    let bc
    try {
        bc = new BroadcastChannel('ws_db_changes')
        bc.onmessage = (ev) => {
            if (ev?.data?.type === 'dailyNotesChanged') callback(ev.data.date)
        }
    } catch { }
    return () => {
        try { bc && bc.close() } catch { }
    }
}

/**
 * Subscribe to settings changes
 */
export function subscribeSettingsChanges(callback) {
    let bc
    try {
        bc = new BroadcastChannel('settings_db_changes')
        bc.onmessage = (ev) => {
            if (ev?.data?.type === 'settingsChanged') callback()
        }
    } catch { }
    return () => {
        try { bc && bc.close() } catch { }
    }
}

/**
 * Close database connection
 */
export function closeDatabaseConnection() {
    closeUnifiedDB()
}

/**
 * Generate unique ID
 */
function generateId() {
    try {
        return crypto.randomUUID()
    } catch {
        return `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }
}


export async function getTimeSeriesDataRange(startTime, endTime) {
    const db = await getUnifiedDB();
    const transaction = db.transaction(['activity_timeseries'], 'readonly'); // Ensure store name matches your schema
    const store = transaction.objectStore('activity_timeseries');
    const index = store.index('timestamp'); // Ensure you have an index on 'timestamp'
    const range = IDBKeyRange.bound(startTime, endTime);

    return new Promise((resolve, reject) => {
        const request = index.getAll(range);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get detailed analytics for a specific URL
 * Aggregates visits, time spent, and dates from activity series
 */
export const getUrlAnalytics = withErrorHandling(async (url) => {
    if (!url) return null;

    const db = await getUnifiedDB();
    const tx = db.transaction(DB_CONFIG.STORES.ACTIVITY_SERIES, 'readonly');
    const store = tx.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES);
    const index = store.index('by_url');

    // Use centralized URL normalization to match how activity.js saves data
    const targetUrls = [url];
    try {
        const parts = getUrlParts(url);
        if (parts && parts.key && parts.key !== url) {
            targetUrls.push(parts.key);
        }
    } catch (e) {
        console.warn('Failed to parse URL for analytics:', e);
    }

    // console.log('[Unified API Debug] getUrlAnalytics searching for:', targetUrls);
    const results = await Promise.all(targetUrls.map(u =>
        new Promise((resolve) => {
            const req = index.getAll(u);
            req.onsuccess = () => {
                // console.log(`[Unified API Debug] Found ${req.result?.length || 0} events for ${u}`);
                resolve(req.result || []);
            };
            req.onerror = () => {
                console.warn(`[Unified API Debug] Error fetching for ${u}:`, req.error);
                resolve([]);
            }
        })
    ));

    const events = results.flat();
    // console.log('[Unified API Debug] Total events found:', events.length);

    return new Promise((resolve) => {
        if (events.length === 0) {
            resolve({
                totalVisits: 0,
                totalTime: 0,
                firstVisit: null,
                lastVisit: null,
                lastActive: null
            });
            return;
        }

        // Calculate stats
        let totalTime = 0;
        let firstVisit = events[0].timestamp;
        let lastVisit = events[0].timestamp;
        let visitCount = 0;

        // Track unique session IDs to count visits accurately
        const seenSessions = new Set();

        // Initialize daily stats map
        const dailyMap = new Map();

        events.forEach(event => {
            // Visit Counting
            // Prioritize sessionId if available, otherwise fallback to timestamp differentiation
            if (event.sessionId) {
                if (!seenSessions.has(event.sessionId)) {
                    visitCount++;
                    seenSessions.add(event.sessionId);
                }
            } else {
                // Legacy support or missing sessionId: count every event as a visit? 
                // Better: count as visit if significantly different timestamp
                visitCount++;
            }

            // Time aggregation
            // Priority: metrics.timeSpent (from activity.js) > metrics.activeTime > legacy event.time
            const duration =
                event.metrics?.timeSpent ||
                event.metrics?.activeTime ||
                event.metrics?.duration ||
                event.time ||
                0;

            const timeValue = (typeof duration === 'number' ? duration : 0);
            totalTime += timeValue;

            // Log significant events to help debugging
            if (timeValue > 0) {
                // console.log(`[Unified API Debug] Event time: ${timeValue}ms`, event.id);
            }

            // Date ranges
            if (event.timestamp < firstVisit) firstVisit = event.timestamp;
            if (event.timestamp > lastVisit) lastVisit = event.timestamp;

            // Daily aggregation: Count visits even if time is 0
            const dateKey = new Date(event.timestamp).toISOString().split('T')[0];
            if (!dailyMap.has(dateKey)) {
                dailyMap.set(dateKey, 0);
            }
            dailyMap.set(dateKey, dailyMap.get(dateKey) + timeValue);
        });

        // Ensure at least 1 visit if events exist
        if (visitCount === 0 && events.length > 0) visitCount = events.length;

        // Convert map to sorted array for chart
        // Fill in last 14 days even if empty for continuity
        const dailyStats = [];
        const today = new Date();
        for (let i = 13; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const dateKey = d.toISOString().split('T')[0];
            dailyStats.push({
                date: dateKey,
                time: dailyMap.get(dateKey) || 0,
                label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            });
        }

        resolve({
            totalVisits: visitCount,
            totalTime, // in milliseconds
            firstVisit,
            lastVisit,
            lastActive: lastVisit,
            dailyStats // New field
        });
    });
}, {
    operation: 'getUrlAnalytics',
    severity: ErrorSeverity.LOW,
    fallbackFunction: () => ({ totalVisits: 0, totalTime: 0 })
});

// ===== SCRAPED CONFIG OPERATIONS =====

/**
 * List all scraping configs
 */
export const listScrapingConfigs = withErrorHandling(async (options = {}) => {
    const { limit, offset, sortBy = 'updatedAt', sortOrder = 'desc' } = options

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_CONFIGS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CONFIGS)

    let results = await new Promise((resolve, reject) => {
        const request = store.getAll()
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })

    // Sort
    if (sortBy) {
        results.sort((a, b) => {
            const aVal = a[sortBy] || 0
            const bVal = b[sortBy] || 0
            return sortOrder === 'desc' ? (bVal > aVal ? 1 : -1) : (aVal > bVal ? 1 : -1)
        })
    }

    // Paginate
    if (offset) results = results.slice(offset)
    if (limit) results = results.slice(0, limit)

    return results
}, {
    operation: 'listScrapingConfigs',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => []
})

/**
 * Get scraping config for a domain
 */
export const getScrapingConfig = withErrorHandling(async (domain) => {
    if (!domain) throw new Error('Domain is required')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_CONFIGS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CONFIGS)

    const request = store.get(domain)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'getScrapingConfig',
    severity: ErrorSeverity.LOW
})

/**
 * Save scraping config
 * Also syncs to chrome.storage.local for content scripts
 */
export const saveScrapingConfig = withErrorHandling(async (configData, options = {}) => {
    // Validate
    const config = validateAndSanitize(configData, 'scrapedConfig')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_CONFIGS, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CONFIGS)

    const request = store.put(config)

    return new Promise((resolve, reject) => {
        request.onsuccess = async () => {
            console.log(`[Unified API] Saved scraping config for: ${config.domain}`)

            // Notify listeners
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('scraped_configs_db_changes')
                    bc.postMessage({ type: 'scrapedConfigsChanged' })
                    bc.close()
                } catch { }
            }

            // SYNC TO chrome.storage.local
            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    const storage = await chrome.storage.local.get('domainSelectors')
                    const selectors = storage.domainSelectors || {}
                    selectors[config.domain] = {
                        ...config, // Persist all validated fields
                        enabled: config.enabled !== false, // Default to true if undefined
                        savedAt: config.updatedAt // Use updatedAt as savedAt
                    }
                    await chrome.storage.local.set({ domainSelectors: selectors })
                    console.log(`[Unified API] Synced config to chrome.storage.local for ${config.domain}`)
                }
            } catch (e) {
                console.warn('[Unified API] Failed to sync to chrome.storage.local:', e)
            }

            resolve(config)
        }
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'saveScrapingConfig',
    severity: ErrorSeverity.MEDIUM,
    strategy: ErrorStrategy.RETRY
})

/**
 * Delete scraping config
 */
export const deleteScrapingConfig = withErrorHandling(async (domain, options = {}) => {
    if (!domain) throw new Error('Domain is required')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_CONFIGS, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_CONFIGS)

    const request = store.delete(domain)

    return new Promise((resolve, reject) => {
        request.onsuccess = async () => {
            console.log(`[Unified API] Deleted scraping config for: ${domain}`)

            // Notify listeners
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('scraped_configs_db_changes')
                    bc.postMessage({ type: 'scrapedConfigsChanged' })
                    bc.close()
                } catch { }
            }

            // SYNC TO chrome.storage.local
            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    const storage = await chrome.storage.local.get('domainSelectors')
                    const selectors = storage.domainSelectors || {}
                    if (selectors[domain]) {
                        delete selectors[domain]
                        await chrome.storage.local.set({ domainSelectors: selectors })
                        console.log(`[Unified API] Removed config from chrome.storage.local for ${domain}`)
                    }
                }
            } catch (e) {
                console.warn('[Unified API] Failed to sync delete to chrome.storage.local:', e)
            }

            resolve(true)
        }
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'deleteScrapingConfig',
    severity: ErrorSeverity.MEDIUM
})

/**
 * Get daily memory
 */
export const getDailyMemory = withErrorHandling(async (date) => {
    if (!date) return [] // or all?

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.DAILY_MEMORY, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.DAILY_MEMORY)

    // Assuming ID is date string or we filter by date property
    // If store uses date as key:
    const request = store.get(date)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'getDailyMemory',
    severity: ErrorSeverity.LOW
})

/**
 * Save daily memory
 */
export const saveDailyMemory = withErrorHandling(async (memoryData, options = {}) => {
    const memory = validateAndSanitize(memoryData, 'dailyMemory')

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.DAILY_MEMORY, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.DAILY_MEMORY)

    const request = store.put(memory)
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            // Notify listeners
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('ws_db_changes')
                    bc.postMessage({ type: 'dailyMemoryChanged', date: memory.date })
                    bc.close()
                } catch { }
            }
            resolve(memory)
        }
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'saveDailyMemory',
    severity: ErrorSeverity.MEDIUM
})

/**
 * List all daily memories (for sync)
 */
export const listDailyMemory = withErrorHandling(async () => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.DAILY_MEMORY, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.DAILY_MEMORY)

    const request = store.getAll()
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'listDailyMemory',
    severity: ErrorSeverity.LOW,
    fallbackFunction: () => []
})

/**
 * List all pins (alias for listPings with better name)
 */
export const listPins = listPings


// ===== DASHBOARD OPERATIONS =====

/**
 * Get dashboard state
 */
export const getDashboard = withErrorHandling(async () => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.DASHBOARD, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.DASHBOARD)

    const request = store.get('default')
    const result = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })

    return result || { id: 'default' }
}, {
    operation: 'getDashboard',
    severity: ErrorSeverity.LOW,
    strategy: ErrorStrategy.FALLBACK,
    fallbackFunction: () => ({ id: 'default' })
})

/**
 * Save dashboard state
 */
export const saveDashboard = withErrorHandling(async (dashboardData, options = {}) => {
    const dashboard = {
        id: 'default',
        ...dashboardData,
        updatedAt: Date.now()
    }

    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.DASHBOARD, 'readwrite')
    const store = tx.objectStore(DB_CONFIG.STORES.DASHBOARD)

    const request = store.put(dashboard)

    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            // Notify dashboard change
            if (!options.skipNotify) {
                try {
                    const bc = new BroadcastChannel('dashboard_db_changes')
                    bc.postMessage({ type: 'dashboardChanged' })
                    bc.close()
                } catch { }
            }
            resolve(dashboard)
        }
        request.onerror = () => reject(request.error)
    })
}, {
    operation: 'saveDashboard',
    severity: ErrorSeverity.MEDIUM
})

// ===== DAILY ANALYTICS OPERATIONS =====

/**
 * Aggregate activity data from ACTIVITY_SERIES into DAILY_ANALYTICS
 * Call this before cleaning up old data to preserve historical stats
 * @param {number} olderThanMs - Aggregate records older than this (default: 48 hours)
 * @returns {Promise<{aggregated: number, deleted: number}>}
 */
export const aggregateAndCleanupActivity = withErrorHandling(async (olderThanMs = 48 * 60 * 60 * 1000) => {
    const db = await getUnifiedDB()
    const cutoffTime = Date.now() - olderThanMs

    console.log('[Analytics] Starting aggregation for records older than', new Date(cutoffTime).toISOString())

    // Step 1: Read all old activity records
    const readTx = db.transaction(DB_CONFIG.STORES.ACTIVITY_SERIES, 'readonly')
    const readStore = readTx.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES)
    const index = readStore.index('by_timestamp')

    const oldRecords = await new Promise((resolve, reject) => {
        const range = IDBKeyRange.upperBound(cutoffTime)
        const request = index.getAll(range)
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })

    if (oldRecords.length === 0) {
        console.log('[Analytics] No old records to aggregate')
        return { aggregated: 0, deleted: 0 }
    }

    console.log('[Analytics] Found', oldRecords.length, 'records to aggregate')

    // Step 2: Aggregate by URL + date
    const aggregationMap = new Map() // key: "url_YYYY-MM-DD"

    for (const record of oldRecords) {
        const url = record.url
        if (!url) continue

        const date = new Date(record.timestamp).toISOString().split('T')[0] // YYYY-MM-DD
        const key = `${url}_${date}`

        let domain = ''
        try {
            domain = new URL(url).hostname.replace('www.', '')
        } catch { }

        if (!aggregationMap.has(key)) {
            aggregationMap.set(key, {
                id: key,
                url: url,
                domain: domain,
                date: date,
                totalTime: 0,
                visits: 0,
                totalClicks: 0,
                totalForms: 0,
                maxScrollDepth: 0,
                sessions: new Set(),
                peakHours: new Map(), // hour -> time spent
                firstSeen: record.timestamp,
                lastSeen: record.timestamp
            })
        }

        const agg = aggregationMap.get(key)

        // Aggregate metrics
        const timeSpent = record.metrics?.timeSpent || record.time || 0
        agg.totalTime += timeSpent
        agg.visits += 1
        agg.totalClicks += record.metrics?.clicks || record.clicks || 0
        agg.totalForms += record.metrics?.forms || record.forms || 0
        agg.maxScrollDepth = Math.max(agg.maxScrollDepth, record.metrics?.scrollDepth || record.scroll || 0)

        if (record.sessionId) {
            agg.sessions.add(record.sessionId)
        }

        // Track peak hours
        const hour = new Date(record.timestamp).getHours()
        agg.peakHours.set(hour, (agg.peakHours.get(hour) || 0) + timeSpent)

        // Update time bounds
        if (record.timestamp < agg.firstSeen) agg.firstSeen = record.timestamp
        if (record.timestamp > agg.lastSeen) agg.lastSeen = record.timestamp
    }

    // Step 3: Write aggregated data to DAILY_ANALYTICS
    const writeTx = db.transaction(DB_CONFIG.STORES.DAILY_ANALYTICS, 'readwrite')
    const writeStore = writeTx.objectStore(DB_CONFIG.STORES.DAILY_ANALYTICS)

    let aggregatedCount = 0

    for (const [key, agg] of aggregationMap) {
        // Find peak hour
        let peakHour = 0
        let peakTime = 0
        for (const [hour, time] of agg.peakHours) {
            if (time > peakTime) {
                peakTime = time
                peakHour = hour
            }
        }

        // Check if we already have data for this URL+date and merge
        const existing = await new Promise((resolve) => {
            const req = writeStore.get(key)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => resolve(null)
        })

        const finalRecord = {
            id: key,
            url: agg.url,
            domain: agg.domain,
            date: agg.date,
            totalTime: (existing?.totalTime || 0) + agg.totalTime,
            visits: (existing?.visits || 0) + agg.visits,
            uniqueSessions: (existing?.uniqueSessions || 0) + agg.sessions.size,
            totalClicks: (existing?.totalClicks || 0) + agg.totalClicks,
            totalForms: (existing?.totalForms || 0) + agg.totalForms,
            maxScrollDepth: Math.max(existing?.maxScrollDepth || 0, agg.maxScrollDepth),
            peakHour: peakHour,
            firstSeen: Math.min(existing?.firstSeen || agg.firstSeen, agg.firstSeen),
            lastSeen: Math.max(existing?.lastSeen || agg.lastSeen, agg.lastSeen),
            aggregatedAt: Date.now()
        }

        await new Promise((resolve, reject) => {
            const req = writeStore.put(finalRecord)
            req.onsuccess = () => {
                aggregatedCount++
                resolve()
            }
            req.onerror = () => reject(req.error)
        })
    }

    await new Promise((resolve) => {
        writeTx.oncomplete = resolve
    })

    console.log('[Analytics] Aggregated', aggregatedCount, 'URL-date combinations')

    // Step 4: Delete old records from ACTIVITY_SERIES
    const deleteTx = db.transaction(DB_CONFIG.STORES.ACTIVITY_SERIES, 'readwrite')
    const deleteStore = deleteTx.objectStore(DB_CONFIG.STORES.ACTIVITY_SERIES)
    const deleteIndex = deleteStore.index('by_timestamp')

    let deletedCount = 0

    await new Promise((resolve, reject) => {
        const range = IDBKeyRange.upperBound(cutoffTime)
        const request = deleteIndex.openCursor(range)

        request.onsuccess = (event) => {
            const cursor = event.target.result
            if (cursor) {
                cursor.delete()
                deletedCount++
                cursor.continue()
            } else {
                resolve()
            }
        }
        request.onerror = () => reject(request.error)
    })

    console.log('[Analytics] Deleted', deletedCount, 'old records from ACTIVITY_SERIES')

    return { aggregated: aggregatedCount, deleted: deletedCount }
}, {
    operation: 'aggregateAndCleanupActivity',
    severity: ErrorSeverity.LOW
})

/**
 * Get daily analytics for a URL
 * @param {string} url - The URL to get analytics for
 * @param {number} days - Number of days to look back (default: 30)
 */
export const getDailyAnalytics = withErrorHandling(async (url, days = 30) => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.DAILY_ANALYTICS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.DAILY_ANALYTICS)
    const index = store.index('by_url')

    const records = await new Promise((resolve, reject) => {
        const request = index.getAll(url)
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })

    // Filter to last N days
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)
    const cutoffStr = cutoffDate.toISOString().split('T')[0]

    const filtered = records.filter(r => r.date >= cutoffStr)
    filtered.sort((a, b) => a.date.localeCompare(b.date))

    return filtered
}, {
    operation: 'getDailyAnalytics',
    severity: ErrorSeverity.LOW,
    fallbackFunction: () => []
})

/**
 * Get analytics summary across all URLs for a date range
 * @param {number} days - Number of days to look back
 */
export const getAnalyticsSummary = withErrorHandling(async (days = 7) => {
    const db = await getUnifiedDB()
    const tx = db.transaction(DB_CONFIG.STORES.DAILY_ANALYTICS, 'readonly')
    const store = tx.objectStore(DB_CONFIG.STORES.DAILY_ANALYTICS)
    const index = store.index('by_date')

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)
    const cutoffStr = cutoffDate.toISOString().split('T')[0]

    const records = await new Promise((resolve, reject) => {
        const range = IDBKeyRange.lowerBound(cutoffStr)
        const request = index.getAll(range)
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })

    // Aggregate by domain
    const domainStats = new Map()
    let totalTime = 0
    let totalVisits = 0

    for (const record of records) {
        totalTime += record.totalTime || 0
        totalVisits += record.visits || 0

        if (!domainStats.has(record.domain)) {
            domainStats.set(record.domain, {
                domain: record.domain,
                totalTime: 0,
                visits: 0,
                urls: new Set()
            })
        }

        const ds = domainStats.get(record.domain)
        ds.totalTime += record.totalTime || 0
        ds.visits += record.visits || 0
        ds.urls.add(record.url)
    }

    // Convert to sorted array
    const topDomains = Array.from(domainStats.values())
        .map(d => ({ ...d, uniqueUrls: d.urls.size }))
        .sort((a, b) => b.totalTime - a.totalTime)
        .slice(0, 20)

    return {
        totalTime,
        totalVisits,
        uniqueDomains: domainStats.size,
        topDomains,
        days
    }
}, {
    operation: 'getAnalyticsSummary',
    severity: ErrorSeverity.LOW,
    fallbackFunction: () => ({ totalTime: 0, totalVisits: 0, uniqueDomains: 0, topDomains: [], days: 0 })
})
