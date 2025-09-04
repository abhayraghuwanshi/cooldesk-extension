const DB_NAME = 'NotesDB'
const DB_VERSION = 1
const NOTES_STORE = 'notes'

let dbCache = null

/**
 * Open or create the IndexedDB database
 */
async function openDB() {
    if (dbCache) return dbCache

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onerror = () => {
            console.error('Failed to open notes database:', request.error)
            reject(request.error)
        }

        request.onsuccess = () => {
            dbCache = request.result
            
            // Handle unexpected database closure
            dbCache.onclose = () => {
                console.warn('Notes database connection closed unexpectedly')
                dbCache = null
            }

            // Handle version change while database is open
            dbCache.onversionchange = () => {
                console.warn('Notes database version changed, closing connection')
                dbCache.close()
                dbCache = null
            }

            resolve(dbCache)
        }

        request.onupgradeneeded = (event) => {
            const db = event.target.result
            
            // Create notes object store if it doesn't exist
            if (!db.objectStoreNames.contains(NOTES_STORE)) {
                const store = db.createObjectStore(NOTES_STORE, { 
                    keyPath: 'id'
                })
                
                // Create indexes for efficient querying
                store.createIndex('createdAt', 'createdAt', { unique: false })
                store.createIndex('updatedAt', 'updatedAt', { unique: false })
                store.createIndex('title', 'title', { unique: false })
                store.createIndex('tags', 'tags', { unique: false, multiEntry: true })
                
                console.log('Created notes object store with indexes')
            }
        }

        request.onblocked = () => {
            console.warn('Notes database upgrade blocked by another connection')
        }
    })
}
export async function listNotes() {
    const db = await openDB()
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(NOTES_STORE, 'readonly')
            const store = tx.objectStore(NOTES_STORE)
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

/** Upsert a note by id; enforce cap of 200 notes (trim oldest) */
export async function upsertNote(note) {
    if (!note || !note.id) return
    const db = await openDB()
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(NOTES_STORE, 'readwrite')
            const store = tx.objectStore(NOTES_STORE)
            const putReq = store.put({ ...note, createdAt: note.createdAt || Date.now(), updatedAt: Date.now() })
            putReq.onsuccess = () => resolve()
            putReq.onerror = () => resolve()
        } catch { resolve() }
    })

    // Enforce cap of 200 by trimming oldest
    const all = await listNotes()
    if (all.length > 200) {
        const toDelete = all.slice(200) // already sorted desc
        const db2 = await openDB()
        await Promise.all(toDelete.map(n => new Promise((resolve) => {
            try {
                const tx = db2.transaction(NOTES_STORE, 'readwrite')
                const store = tx.objectStore(NOTES_STORE)
                const delReq = store.delete(n.id)
                delReq.onsuccess = () => resolve()
                delReq.onerror = () => resolve()
            } catch { resolve() }
        })))
    }
}

/** Delete a note by id */
export async function deleteNote(id) {
    if (!id) return
    const db = await openDB()
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(NOTES_STORE, 'readwrite')
            const store = tx.objectStore(NOTES_STORE)
            const req = store.delete(id)
            req.onsuccess = () => resolve()
            req.onerror = () => resolve()
        } catch { resolve() }
    })
}

/** Get a single note by id */
export async function getNote(id) {
    if (!id) return null
    const db = await openDB()
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(NOTES_STORE, 'readonly')
            const store = tx.objectStore(NOTES_STORE)
            const req = store.get(id)
            req.onsuccess = () => resolve(req.result || null)
            req.onerror = () => resolve(null)
        } catch { resolve(null) }
    })
}

/** Search notes by title or content */
export async function searchNotes(query) {
    if (!query) return []
    const allNotes = await listNotes()
    const searchTerm = query.toLowerCase()
    
    return allNotes.filter(note => {
        return (note.title && note.title.toLowerCase().includes(searchTerm)) ||
               (note.content && note.content.toLowerCase().includes(searchTerm)) ||
               (note.tags && note.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
    })
}

/** Get notes by tag */
export async function getNotesByTag(tag) {
    if (!tag) return []
    const db = await openDB()
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(NOTES_STORE, 'readonly')
            const store = tx.objectStore(NOTES_STORE)
            const index = store.index('tags')
            const req = index.getAll(tag)
            req.onsuccess = () => {
                const arr = Array.isArray(req.result) ? req.result : []
                arr.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
                resolve(arr)
            }
            req.onerror = () => resolve([])
        } catch { resolve([]) }
    })
}

/** Get all unique tags from notes */
export async function getAllTags() {
    const allNotes = await listNotes()
    const tagSet = new Set()
    
    allNotes.forEach(note => {
        if (note.tags && Array.isArray(note.tags)) {
            note.tags.forEach(tag => tagSet.add(tag))
        }
    })
    
    return Array.from(tagSet).sort()
}

/** Clear all notes (use with caution) */
export async function clearAllNotes() {
    const db = await openDB()
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(NOTES_STORE, 'readwrite')
            const store = tx.objectStore(NOTES_STORE)
            const req = store.clear()
            req.onsuccess = () => resolve()
            req.onerror = () => resolve()
        } catch { resolve() }
    })
}

/** Get database statistics */
export async function getStats() {
    const allNotes = await listNotes()
    const tags = await getAllTags()
    
    return {
        totalNotes: allNotes.length,
        totalTags: tags.length,
        oldestNote: allNotes.length > 0 ? new Date(Math.min(...allNotes.map(n => n.createdAt || 0))) : null,
        newestNote: allNotes.length > 0 ? new Date(Math.max(...allNotes.map(n => n.createdAt || 0))) : null,
        lastUpdated: allNotes.length > 0 ? new Date(Math.max(...allNotes.map(n => n.updatedAt || n.createdAt || 0))) : null
    }
}

/** Close database connection */
export function closeDB() {
    if (dbCache) {
        dbCache.close()
        dbCache = null
    }
}
