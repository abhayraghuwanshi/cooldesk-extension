const URL_NOTES_STORE = 'urlNotes'
const DB_NAME = 'UrlNotesDB'
const DB_VERSION = 1

let dbCache = null

/**
 * Open or create the IndexedDB database
 */
async function openDB() {
    if (dbCache) return dbCache

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = (event) => {
            const db = event.target.result
            if (!db.objectStoreNames.contains(URL_NOTES_STORE)) {
                const store = db.createObjectStore(URL_NOTES_STORE, { keyPath: 'id' })
                try {
                    store.createIndex('url', 'url', { unique: false })
                    store.createIndex('by_createdAt', 'createdAt', { unique: false })
                } catch { }
            }
        }
        request.onsuccess = () => {
            dbCache = request.result
            resolve(dbCache)
        }
        request.onerror = (event) => {
            console.error('[DB Debug] Database open failed:', event.target.error)
            reject(event.target.error)
        }
    })
}



export async function saveUrlNote(note) {
    if (!note || !note.url) return
    const db = await openDB()
    const withDefaults = { ...note }
    if (!withDefaults.id) {
        try { withDefaults.id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `urlnote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` } catch { withDefaults.id = `urlnote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }
    }
    if (!withDefaults.createdAt) withDefaults.createdAt = Date.now()
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(URL_NOTES_STORE, 'readwrite')
            const store = tx.objectStore(URL_NOTES_STORE)
            const req = store.put(withDefaults)
            req.onsuccess = () => {
                console.log('[DB Debug] URL note saved successfully:', withDefaults.id)
                resolve(true)
            }
            req.onerror = (event) => {
                console.error('[DB Debug] Failed to save URL note:', event.target.error)
                reject(event.target.error)
            }
            tx.onerror = (event) => {
                console.error('[DB Debug] Transaction failed:', event.target.error)
                reject(event.target.error)
            }
        } catch (error) {
            console.error('[DB Debug] Exception in saveUrlNote:', error)
            reject(error)
        }
    })
}

/** Update a URL note */
export async function updateUrlNote(note) {
    if (!note || !note.id) return
    const db = await openDB()
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(URL_NOTES_STORE, 'readwrite')
            const store = tx.objectStore(URL_NOTES_STORE)
            const req = store.put({ ...note, updatedAt: Date.now() })
            req.onsuccess = () => resolve()
            req.onerror = () => resolve()
        } catch { resolve() }
    })
}

/** Delete a URL note */
export async function deleteUrlNote(noteId) {
    if (!noteId) return
    const db = await openDB()
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(URL_NOTES_STORE, 'readwrite')
            const store = tx.objectStore(URL_NOTES_STORE)
            const req = store.delete(noteId)
            req.onsuccess = () => resolve()
            req.onerror = () => resolve()
        } catch { resolve() }
    })
}

/** Get all URL notes across all URLs */
export async function getAllUrlNotes() {
    const db = await openDB()
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(URL_NOTES_STORE, 'readonly')
            const store = tx.objectStore(URL_NOTES_STORE)
            const req = store.getAll()
            req.onsuccess = () => {
                const arr = Array.isArray(req.result) ? req.result : []
                arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                resolve(arr)
            }
            req.onerror = () => resolve([])
        } catch { resolve([]) }
    })
}

export async function getUrlNotes(url) {
    if (!url) return []
    const db = await openDB()
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(URL_NOTES_STORE, 'readonly')
            const store = tx.objectStore(URL_NOTES_STORE)
            const index = store.index('url')
            const req = index.getAll(url)
            req.onsuccess = () => {
                const arr = Array.isArray(req.result) ? req.result : []
                console.log('[DB Debug] Retrieved notes for URL:', url, 'Count:', arr.length)
                if (arr.length > 0) {
                    console.log('[DB Debug] Sample note:', arr[0])
                }
                arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                resolve(arr)
            }
            req.onerror = (event) => {
                console.error('[DB Debug] Failed to get URL notes:', event.target.error)
                resolve([])
            }
        } catch (error) {
            console.error('[DB Debug] Exception in getUrlNotes:', error)
            resolve([])
        }
    })
}
