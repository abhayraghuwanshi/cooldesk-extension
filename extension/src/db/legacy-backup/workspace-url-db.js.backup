const URLS_STORE = 'workspaceUrls'
const DB_NAME = 'workspaceUrlsDB'
const DB_VERSION = 1

let dbCache = null

async function openWorkspaceUrlDB() {
    if (dbCache) return dbCache

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result
            if (!db.objectStoreNames.contains(URLS_STORE)) {
                const store = db.createObjectStore(URLS_STORE, { keyPath: 'url' })
                try {
                    store.createIndex('by_url', 'url', { unique: false })
                    store.createIndex('by_createdAt', 'createdAt', { unique: false })
                    store.createIndex('by_workspaceIds', 'workspaceIds', { unique: false, multiEntry: true })
                } catch { }
            }
        }
        
        request.onsuccess = (event) => {
            dbCache = event.target.result
            resolve(dbCache)
        }
        
        request.onerror = (event) => {
            console.error('[WorkspaceURL DB] Database open failed:', event.target.error)
            reject(event.target.error)
        }
    })
}

export async function getUrlRecord(url) {
    if (!url) return null
    const db = await openWorkspaceUrlDB()
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(URLS_STORE, 'readonly')
            const store = tx.objectStore(URLS_STORE)
            const req = store.get(url)
            req.onsuccess = () => resolve(req.result || null)
            req.onerror = () => resolve(null)
        } catch { resolve(null) }
    })
}

/** Upsert a URL document. Merges with existing where appropriate. */
export async function upsertUrl(doc) {
    const url = doc && doc.url
    if (!url) return
    const db = await openWorkspaceUrlDB()
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(URLS_STORE, 'readwrite')
            const store = tx.objectStore(URLS_STORE)
            const getReq = store.get(url)
            getReq.onsuccess = () => {
                const existing = getReq.result || null
                const merged = existing ? { ...existing } : { url, workspaceIds: [] }
                if (doc.title) merged.title = doc.title
                if (doc.favicon) merged.favicon = doc.favicon
                if (typeof doc.addedAt === 'number' && !merged.addedAt) merged.addedAt = doc.addedAt
                // Deep-merge extra object to preserve existing fields (e.g., tags/category) when adding ai
                if (doc && Object.prototype.hasOwnProperty.call(doc, 'extra')) {
                    const prevExtra = (existing && typeof existing.extra === 'object' && existing.extra) ? existing.extra : {}
                    const nextExtra = (doc && typeof doc.extra === 'object' && doc.extra) ? doc.extra : {}
                    merged.extra = { ...prevExtra, ...nextExtra }
                }
                if (Array.isArray(doc.workspaceIds)) {
                    const setIds = new Set(Array.isArray(merged.workspaceIds) ? merged.workspaceIds : [])
                    for (const id of doc.workspaceIds) setIds.add(String(id))
                    merged.workspaceIds = Array.from(setIds)
                }
                const putReq = store.put(merged)
                putReq.onsuccess = () => resolve()
                putReq.onerror = () => resolve()
            }
            getReq.onerror = () => resolve()
        } catch { resolve() }
    })
    try { const bc = new BroadcastChannel('urls_db_changes'); bc.postMessage({ type: 'urlsChanged' }); bc.close() } catch { }
}

/** Add URL to a workspace (idempotent). Creates doc if missing. */
export async function addUrlToWorkspace(url, wsId, meta = {}) {
    if (!url || !wsId) return
    const db = await openWorkspaceUrlDB()
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(URLS_STORE, 'readwrite')
            const store = tx.objectStore(URLS_STORE)
            const getReq = store.get(url)
            getReq.onsuccess = () => {
                const existing = getReq.result || { url, workspaceIds: [] }
                const setIds = new Set(Array.isArray(existing.workspaceIds) ? existing.workspaceIds : [])
                setIds.add(String(wsId))
                const next = { ...existing, ...meta, workspaceIds: Array.from(setIds) }
                const putReq = store.put(next)
                putReq.onsuccess = () => resolve()
                putReq.onerror = () => resolve()
            }
            getReq.onerror = () => resolve()
        } catch { resolve() }
    })
    try { const bc = new BroadcastChannel('urls_db_changes'); bc.postMessage({ type: 'urlsChanged' }); bc.close() } catch { }
}

/** Remove URL from a workspace. Optionally delete record if empty. */
export async function removeUrlFromWorkspace(url, wsId, { deleteIfOrphan = true } = {}) {
    if (!url || !wsId) return
    const db = await openWorkspaceUrlDB()
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(URLS_STORE, 'readwrite')
            const store = tx.objectStore(URLS_STORE)
            const getReq = store.get(url)
            getReq.onsuccess = () => {
                const existing = getReq.result
                if (!existing) { resolve(); return }
                const nextIds = (existing.workspaceIds || []).filter(id => String(id) !== String(wsId))
                if (deleteIfOrphan && nextIds.length === 0) {
                    const delReq = store.delete(url)
                    delReq.onsuccess = () => resolve()
                    delReq.onerror = () => resolve()
                } else {
                    const putReq = store.put({ ...existing, workspaceIds: nextIds })
                    putReq.onsuccess = () => resolve()
                    putReq.onerror = () => resolve()
                }
            }
            getReq.onerror = () => resolve()
        } catch { resolve() }
    })
    try { const bc = new BroadcastChannel('urls_db_changes'); bc.postMessage({ type: 'urlsChanged' }); bc.close() } catch { }
}

/** List all URL docs in a workspace (via multiEntry index). */
export async function listUrlsByWorkspace(wsId) {
    if (!wsId) return []
    const db = await openWorkspaceUrlDB()
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(URLS_STORE, 'readonly')
            const store = tx.objectStore(URLS_STORE)
            const idx = store.index('workspaceIds')
            const req = idx.getAll(String(wsId))
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : [])
            req.onerror = () => resolve([])
        } catch { resolve([]) }
    })
}

/** List all URL docs. */
export async function listAllUrls() {
    const db = await openWorkspaceUrlDB()
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(URLS_STORE, 'readonly')
            const store = tx.objectStore(URLS_STORE)
            const req = store.getAll()
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : [])
            req.onerror = () => resolve([])
        } catch { resolve([]) }
    })
}
