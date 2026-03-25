/**
 * Unified App Database Service
 * Manages local (desktop) and web apps in a single store with categories
 */

import { getUnifiedDB, DB_CONFIG } from './unified-db.js'

// Standard categories (must match Rust categorize.rs)
export const APP_CATEGORIES = [
    'Developer Tools',
    'Browsers',
    'Communication',
    'Music',
    'Video',
    'Graphics & Design',
    'Games',
    'Productivity',
    'Finance',
    'Education',
    'News',
    'Health & Fitness',
    'Travel',
    'Shopping',
    'Utilities',
    'Other'
]

/**
 * Generate a consistent ID for an app
 */
function generateAppId(type, identifier) {
    // Simple hash for consistency
    const hash = identifier.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0)
        return a & a
    }, 0)
    return `${type}:${Math.abs(hash).toString(36)}`
}

/**
 * Get all apps from the database
 */
export async function getAllApps() {
    const db = await getUnifiedDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.STORES.APPS, 'readonly')
        const store = tx.objectStore(DB_CONFIG.STORES.APPS)
        const request = store.getAll()
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })
}

/**
 * Get apps by category
 */
export async function getAppsByCategory(category) {
    const db = await getUnifiedDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.STORES.APPS, 'readonly')
        const store = tx.objectStore(DB_CONFIG.STORES.APPS)
        const index = store.index('by_category')
        const request = index.getAll(category)
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })
}

/**
 * Get apps by type (local or web)
 */
export async function getAppsByType(type) {
    const db = await getUnifiedDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.STORES.APPS, 'readonly')
        const store = tx.objectStore(DB_CONFIG.STORES.APPS)
        const index = store.index('by_type')
        const request = index.getAll(type)
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })
}

/**
 * Get grouped apps by category
 */
export async function getAppsGroupedByCategory() {
    const apps = await getAllApps()
    const grouped = {}

    for (const category of APP_CATEGORIES) {
        grouped[category] = []
    }

    for (const app of apps) {
        const cat = app.category || 'Other'
        if (!grouped[cat]) grouped[cat] = []
        grouped[cat].push(app)
    }

    // Sort each category by usage
    for (const cat of Object.keys(grouped)) {
        grouped[cat].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
    }

    return grouped
}

/**
 * Add or update a single app
 */
export async function upsertApp(app) {
    const db = await getUnifiedDB()
    const now = Date.now()

    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.STORES.APPS, 'readwrite')
        const store = tx.objectStore(DB_CONFIG.STORES.APPS)

        // Get existing to preserve usage stats
        const getReq = store.get(app.id)
        getReq.onsuccess = () => {
            const existing = getReq.result
            const record = {
                ...app,
                usageCount: existing?.usageCount || 0,
                lastUsed: existing?.lastUsed || null,
                createdAt: existing?.createdAt || now,
                updatedAt: now
            }

            const putReq = store.put(record)
            putReq.onsuccess = () => resolve(record)
            putReq.onerror = () => reject(putReq.error)
        }
        getReq.onerror = () => reject(getReq.error)
    })
}

/**
 * Bulk upsert apps (for syncing from backend)
 */
export async function bulkUpsertApps(apps) {
    const db = await getUnifiedDB()
    const now = Date.now()

    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.STORES.APPS, 'readwrite')
        const store = tx.objectStore(DB_CONFIG.STORES.APPS)
        let completed = 0

        for (const app of apps) {
            const getReq = store.get(app.id)
            getReq.onsuccess = () => {
                const existing = getReq.result
                const record = {
                    ...app,
                    usageCount: existing?.usageCount || 0,
                    lastUsed: existing?.lastUsed || null,
                    createdAt: existing?.createdAt || now,
                    updatedAt: now
                }
                store.put(record)
                completed++
            }
        }

        tx.oncomplete = () => resolve(completed)
        tx.onerror = () => reject(tx.error)
    })
}

/**
 * Record app usage (updates lastUsed and usageCount)
 */
export async function recordAppUsage(appId) {
    const db = await getUnifiedDB()
    const now = Date.now()

    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.STORES.APPS, 'readwrite')
        const store = tx.objectStore(DB_CONFIG.STORES.APPS)

        const getReq = store.get(appId)
        getReq.onsuccess = () => {
            const app = getReq.result
            if (!app) {
                resolve(null)
                return
            }

            app.usageCount = (app.usageCount || 0) + 1
            app.lastUsed = now
            app.updatedAt = now

            const putReq = store.put(app)
            putReq.onsuccess = () => resolve(app)
            putReq.onerror = () => reject(putReq.error)
        }
        getReq.onerror = () => reject(getReq.error)
    })
}

/**
 * Update app category
 */
export async function updateAppCategory(appId, category, source = 'manual') {
    const db = await getUnifiedDB()
    const now = Date.now()

    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.STORES.APPS, 'readwrite')
        const store = tx.objectStore(DB_CONFIG.STORES.APPS)

        const getReq = store.get(appId)
        getReq.onsuccess = () => {
            const app = getReq.result
            if (!app) {
                reject(new Error('App not found'))
                return
            }

            app.category = category
            app.categorySource = source
            app.updatedAt = now

            const putReq = store.put(app)
            putReq.onsuccess = () => resolve(app)
            putReq.onerror = () => reject(putReq.error)
        }
        getReq.onerror = () => reject(getReq.error)
    })
}

/**
 * Sync local apps from Tauri backend
 * Call this on app startup and periodically
 */
export async function syncLocalApps() {
    // Check if we're in Tauri environment
    console.log('[AppDB] syncLocalApps called, Tauri available:', !!window.__TAURI__)

    if (!window.__TAURI__) {
        console.log('[AppDB] Not in Tauri environment, skipping local app sync')
        return []
    }

    const { invoke } = window.__TAURI__.core

    try {
        console.log('[AppDB] Syncing local apps from backend...')
        const backendApps = await invoke('get_running_apps')

        console.log('[AppDB] Raw backend response:', typeof backendApps, Array.isArray(backendApps) ? backendApps.length : backendApps)

        if (!Array.isArray(backendApps)) {
            console.warn('[AppDB] Invalid response from get_running_apps:', backendApps)
            return []
        }

        if (backendApps.length > 0) {
            console.log('[AppDB] Sample app from backend:', backendApps[0])
        }

        // Transform to our schema
        const apps = backendApps.map(app => {
            const id = generateAppId('local', app.path || app.name)
            return {
                id,
                type: 'local',
                name: app.name,
                path: app.path,
                icon: app.icon || null,
                category: app.category || 'Other',
                categorySource: app.categorySource || 'startmenu',
                isRunning: app.isRunning || false,
                pid: app.pid || null,
                source: app.source // 'startmenu', 'registry', 'programfiles'
            }
        })

        // Categorize apps that don't have a category yet
        const uncategorized = apps.filter(a => !a.category || a.category === 'Other')
        if (uncategorized.length > 0) {
            await categorizeLocalApps(uncategorized)
        }

        console.log('[AppDB] About to save apps to IndexedDB:', apps.length)
        if (apps.length > 0) {
            console.log('[AppDB] Sample transformed app:', apps[0])
        }

        await bulkUpsertApps(apps)
        console.log(`[AppDB] Synced ${apps.length} local apps to IndexedDB`)

        return apps
    } catch (error) {
        console.error('[AppDB] Failed to sync local apps:', error)
        return []
    }
}

/**
 * Categorize local apps using Rust backend
 */
async function categorizeLocalApps(apps) {
    if (!window.__TAURI__) return

    const { invoke } = window.__TAURI__.core

    for (const app of apps) {
        try {
            const result = await invoke('categorize_app', {
                name: app.name,
                path: app.path
            })
            if (result && result.category) {
                app.category = result.category
                app.categorySource = result.source
                app.categoryConfidence = result.confidence
            }
        } catch (e) {
            // Categorization failed, keep default
            console.debug(`[AppDB] Categorization failed for ${app.name}:`, e)
        }
    }
}

/**
 * Add a web app (from workspace or bookmark)
 */
export async function addWebApp({ url, name, icon, category, workspaceId }) {
    const id = generateAppId('web', url)

    const app = {
        id,
        type: 'web',
        name: name || new URL(url).hostname,
        url,
        icon: icon || null,
        category: category || 'Other',
        categorySource: workspaceId ? 'workspace' : 'manual',
        workspaceId: workspaceId || null
    }

    return upsertApp(app)
}

/**
 * Import web apps from workspaces
 * Call this to sync workspace URLs as web apps
 */
export async function syncWebAppsFromWorkspaces() {
    try {
        const db = await getUnifiedDB()

        // Get all workspaces
        const workspaces = await new Promise((resolve, reject) => {
            const tx = db.transaction(DB_CONFIG.STORES.WORKSPACES, 'readonly')
            const store = tx.objectStore(DB_CONFIG.STORES.WORKSPACES)
            const req = store.getAll()
            req.onsuccess = () => resolve(req.result || [])
            req.onerror = () => reject(req.error)
        })

        // Get all workspace URLs
        const urls = await new Promise((resolve, reject) => {
            const tx = db.transaction(DB_CONFIG.STORES.WORKSPACE_URLS, 'readonly')
            const store = tx.objectStore(DB_CONFIG.STORES.WORKSPACE_URLS)
            const req = store.getAll()
            req.onsuccess = () => resolve(req.result || [])
            req.onerror = () => reject(req.error)
        })

        console.log(`[AppDB] Found ${workspaces.length} workspaces and ${urls.length} URLs`)
        if (workspaces.length > 0) {
            console.log('[AppDB] Sample workspace:', workspaces[0])
        }
        if (urls.length > 0) {
            console.log('[AppDB] Sample URL:', urls[0])
        }

        // Create workspace ID -> name map
        const wsMap = new Map(workspaces.map(ws => [ws.id, ws]))

        // Convert URLs to web apps
        const webApps = []
        for (const urlEntry of urls) {
            try {
                // Find associated workspace for category
                const wsId = urlEntry.workspaceIds?.[0]
                const workspace = wsId ? wsMap.get(wsId) : null
                const category = workspace?.name || 'Other'

                let hostname = 'unknown'
                try {
                    hostname = new URL(urlEntry.url).hostname
                } catch {
                    hostname = urlEntry.url?.substring(0, 30) || 'unknown'
                }

                webApps.push({
                    id: generateAppId('web', urlEntry.url),
                    type: 'web',
                    name: urlEntry.title || hostname,
                    url: urlEntry.url,
                    icon: urlEntry.favicon || null,
                    category,
                    categorySource: 'workspace',
                    workspaceId: wsId || null
                })
            } catch (e) {
                console.warn('[AppDB] Failed to process URL entry:', e)
            }
        }

        if (webApps.length > 0) {
            await bulkUpsertApps(webApps)
        }
        console.log(`[AppDB] Synced ${webApps.length} web apps from workspaces`)

        return webApps
    } catch (error) {
        console.error('[AppDB] Failed to sync web apps:', error)
        return []
    }
}

/**
 * Search apps by name
 */
export async function searchApps(query, options = {}) {
    const { type, category, limit = 50 } = options
    const apps = await getAllApps()
    const queryLower = query.toLowerCase()

    let results = apps.filter(app => {
        if (type && app.type !== type) return false
        if (category && app.category !== category) return false
        return app.name.toLowerCase().includes(queryLower)
    })

    // Sort by relevance (exact match first, then by usage)
    results.sort((a, b) => {
        const aExact = a.name.toLowerCase() === queryLower
        const bExact = b.name.toLowerCase() === queryLower
        if (aExact && !bExact) return -1
        if (!aExact && bExact) return 1
        return (b.usageCount || 0) - (a.usageCount || 0)
    })

    return results.slice(0, limit)
}

/**
 * Delete an app by ID
 */
export async function deleteApp(appId) {
    const db = await getUnifiedDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_CONFIG.STORES.APPS, 'readwrite')
        const store = tx.objectStore(DB_CONFIG.STORES.APPS)
        const request = store.delete(appId)
        request.onsuccess = () => resolve(true)
        request.onerror = () => reject(request.error)
    })
}

/**
 * Get app stats
 */
export async function getAppStats() {
    const apps = await getAllApps()

    const stats = {
        total: apps.length,
        byType: { local: 0, web: 0 },
        byCategory: {},
        recentlyUsed: [],
        mostUsed: []
    }

    for (const app of apps) {
        stats.byType[app.type] = (stats.byType[app.type] || 0) + 1
        stats.byCategory[app.category] = (stats.byCategory[app.category] || 0) + 1
    }

    // Get recently used (last 10)
    stats.recentlyUsed = [...apps]
        .filter(a => a.lastUsed)
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .slice(0, 10)

    // Get most used (top 10)
    stats.mostUsed = [...apps]
        .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
        .slice(0, 10)

    return stats
}

/**
 * Initialize app database - call on app startup
 */
export async function initAppDatabase() {
    console.log('[AppDB] Initializing app database...')

    try {
        // Ensure database is open and migrated
        const db = await getUnifiedDB()
        console.log('[AppDB] Database opened, stores:', Array.from(db.objectStoreNames))

        // Check if APPS store exists
        if (!db.objectStoreNames.contains('apps')) {
            console.warn('[AppDB] APPS store not found! DB version:', db.version)
            return { total: 0, byType: {}, byCategory: {}, error: 'APPS store missing' }
        }

        // Sync local apps from Tauri (will skip if not in Tauri)
        console.log('[AppDB] Checking Tauri environment:', !!window.__TAURI__)
        const localApps = await syncLocalApps()
        console.log('[AppDB] Local apps synced:', localApps.length)

        // Sync web apps from workspaces
        console.log('[AppDB] Starting web apps sync from workspaces...')
        const webApps = await syncWebAppsFromWorkspaces()
        console.log('[AppDB] Web apps synced:', webApps.length, webApps)

        const stats = await getAppStats()
        console.log('[AppDB] Initialized:', stats)

        return stats
    } catch (error) {
        console.error('[AppDB] Initialization failed:', error)
        return { total: 0, byType: {}, byCategory: {}, error: error.message }
    }
}
