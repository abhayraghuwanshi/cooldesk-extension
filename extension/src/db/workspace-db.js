import { getHostWorkspaces, setHostWorkspaces } from '../services/extensionApi';

const DB_NAME = 'workspacesDB'
const DB_VERSION = 2
const WORKSPACES_STORE = 'workspaces'

let dbCache = null

async function openWorkspaceDB() {
    if (dbCache) return dbCache

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = (event) => {
            const db = event.target.result
            if (!db.objectStoreNames.contains(WORKSPACES_STORE)) {
                const store = db.createObjectStore(WORKSPACES_STORE, { keyPath: 'id' })
                try {
                    store.createIndex('by_name', 'name', { unique: false })
                    store.createIndex('by_createdAt', 'createdAt', { unique: false })
                    store.createIndex('by_gridType', 'gridType', { unique: false })
                } catch { }
            } else {
                // Handle migration for existing stores
                const transaction = event.target.transaction
                if (transaction) {
                    const store = transaction.objectStore(WORKSPACES_STORE)
                    try {
                        // Add new indexes if they don't exist
                        if (!store.indexNames.contains('by_gridType')) {
                            store.createIndex('by_gridType', 'gridType', { unique: false })
                        }
                        if (!store.indexNames.contains('by_name')) {
                            store.createIndex('by_name', 'name', { unique: false })
                        }
                    } catch { /* ignore index creation errors */ }
                }
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

export async function listWorkspaces() {
    const db = await openWorkspaceDB()
    const items = await new Promise((resolve, reject) => {
        const tx = db.transaction(WORKSPACES_STORE, 'readonly')
        const store = tx.objectStore(WORKSPACES_STORE)
        const req = store.getAll()
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : [])
        req.onerror = () => reject(req.error)
    })
    // Mirror to host in background; do not block UI if host is unavailable
    try {
        if (Array.isArray(items) && items.length) {
            (async () => { try { await setHostWorkspaces(items); } catch { } })();
        }
    } catch { }
    // If IndexedDB is empty, try to restore from chrome.storage.local backup
    if (!items || items.length === 0) {
        try {
            const { workspacesBackupById } = await chrome.storage.local.get(['workspacesBackupById'])
            const values = workspacesBackupById && typeof workspacesBackupById === 'object'
                ? Object.values(workspacesBackupById)
                : []
            if (values && values.length) {
                // Repopulate IDB from backup for durability
                const tx = db.transaction(WORKSPACES_STORE, 'readwrite')
                const store = tx.objectStore(WORKSPACES_STORE)
                await Promise.all(values.map(v => new Promise((resolve) => {
                    const putReq = store.put(v)
                    putReq.onsuccess = () => resolve()
                    putReq.onerror = () => resolve() // ignore individual errors
                })))
                return values
            }
        } catch { }
        // Fallback to host (Electron app) if available
        try {
            const host = await getHostWorkspaces();
            const list = host?.ok && Array.isArray(host.workspaces) ? host.workspaces : [];
            if (list.length) {
                const tx = db.transaction(WORKSPACES_STORE, 'readwrite')
                const store = tx.objectStore(WORKSPACES_STORE)
                await Promise.all(list.map(v => new Promise((resolve) => {
                    const putReq = store.put(v)
                    putReq.onsuccess = () => resolve()
                    putReq.onerror = () => resolve()
                })))
                return list
            }
        } catch { }
    }
    // Mirror to host in background; do not block UI if host is unavailable (secondary path)
    try {
        if (Array.isArray(items) && items.length) {
            (async () => { try { await setHostWorkspaces(items); } catch { } })();
        }
    } catch { }
    return items
}

export async function saveWorkspace(workspace) {
    const db = await openWorkspaceDB()
    
    // Ensure workspace has required fields with defaults
    const workspaceToSave = {
        ...workspace,
        gridType: workspace.gridType || 'ItemGrid', // Default to ItemGrid
        createdAt: workspace.createdAt || Date.now(),
        updatedAt: Date.now()
    }
    
    try { console.log('[db.saveWorkspace] start', { 
        id: workspaceToSave?.id, 
        name: workspaceToSave?.name, 
        gridType: workspaceToSave?.gridType,
        urls: Array.isArray(workspaceToSave?.urls) ? workspaceToSave.urls.length : 0 
    }); } catch { }
    
    await new Promise((resolve, reject) => {
        const tx = db.transaction(WORKSPACES_STORE, 'readwrite')
        const store = tx.objectStore(WORKSPACES_STORE)
        const req = store.put(workspaceToSave)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
    })
    try { console.log('[db.saveWorkspace] wrote to IDB'); } catch { }
    // Mirror to chrome.storage.local as a lightweight backup to mitigate potential IDB loss
    try {
        const { workspacesBackupById } = await chrome.storage.local.get(['workspacesBackupById'])
        const next = (workspacesBackupById && typeof workspacesBackupById === 'object') ? workspacesBackupById : {}
        if (workspaceToSave && workspaceToSave.id) {
            next[workspaceToSave.id] = workspaceToSave
            await chrome.storage.local.set({ workspacesBackupById: next })
        }
        try { console.log('[db.saveWorkspace] mirrored to chrome.storage.local'); } catch { }
    } catch (e) { try { console.warn('[db.saveWorkspace] mirror to chrome.storage.local failed', e); } catch { } }
    // Mirror entire list to host so Electron app sees latest workspaces (non-blocking)
    try {
        (async () => {
            try {
                const all = await listWorkspaces();
                await setHostWorkspaces(all);
                try { console.log('[db.saveWorkspace] mirrored to host, count:', Array.isArray(all) ? all.length : 0); } catch { }
            } catch (e) { try { console.warn('[db.saveWorkspace] mirror to host failed', e); } catch { } }
        })();
    } catch { }
    // Notify listeners via BroadcastChannel
    try {
        const bc = new BroadcastChannel('ws_db_changes')
        bc.postMessage({ type: 'workspacesChanged' })
        bc.close()
        try { console.log('[db.saveWorkspace] broadcasted ws_db_changes'); } catch { }
    } catch (e) { try { console.warn('[db.saveWorkspace] broadcast failed', e); } catch { } }
}

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

// Delete a workspace by its id
export async function deleteWorkspaceById(id) {
    if (!id) return;
    const db = await openWorkspaceDB();
    // Delete from IndexedDB
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(WORKSPACES_STORE, 'readwrite');
            const store = tx.objectStore(WORKSPACES_STORE);
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
        } catch { resolve(); }
    });
    // Remove from chrome.storage.local backup map if present
    try {
        const { workspacesBackupById } = await chrome.storage.local.get(['workspacesBackupById']);
        if (workspacesBackupById && typeof workspacesBackupById === 'object' && workspacesBackupById[id]) {
            const next = { ...workspacesBackupById };
            delete next[id];
            await chrome.storage.local.set({ workspacesBackupById: next });
        }
    } catch { /* ignore */ }
    // Mirror full list to host in background (non-blocking)
    try {
        (async () => {
            try {
                const list = await listWorkspaces();
                await setHostWorkspaces(list);
            } catch { }
        })();
    } catch { }
    // Notify listeners
    try {
        const bc = new BroadcastChannel('ws_db_changes');
        bc.postMessage({ type: 'workspacesChanged' });
        bc.close();
    } catch { }
}

export async function updateWorkspaceGridType(workspaceId, gridType) {
    if (!workspaceId || !gridType) return;
    
    try {
        const db = await openWorkspaceDB();
        
        // Get the existing workspace
        const existingWorkspace = await new Promise((resolve) => {
            const tx = db.transaction(WORKSPACES_STORE, 'readonly');
            const store = tx.objectStore(WORKSPACES_STORE);
            const req = store.get(workspaceId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
        
        if (!existingWorkspace) {
            console.warn('[updateWorkspaceGridType] Workspace not found:', workspaceId);
            return;
        }
        
        // Update with new grid type
        const updatedWorkspace = {
            ...existingWorkspace,
            gridType,
            updatedAt: Date.now()
        };
        
        await new Promise((resolve, reject) => {
            const tx = db.transaction(WORKSPACES_STORE, 'readwrite');
            const store = tx.objectStore(WORKSPACES_STORE);
            const req = store.put(updatedWorkspace);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
        
        console.log('[updateWorkspaceGridType] Updated workspace grid type:', workspaceId, gridType);
        
        // Notify listeners
        try {
            const bc = new BroadcastChannel('ws_db_changes');
            bc.postMessage({ type: 'workspacesChanged' });
            bc.close();
        } catch { }
        
    } catch (e) {
        console.error('Error updating workspace grid type:', e);
    }
}

export async function updateItemWorkspace(itemId, workspaceName) {
    try {
        const { dashboardData } = await chrome.storage.local.get(['dashboardData']);
        if (!dashboardData) return;

        const bookmarks = dashboardData.bookmarks || [];
        const history = dashboardData.history || [];

        let itemUpdated = false;

        const newBookmarks = bookmarks.map(item => {
            if (item.id === itemId) {
                itemUpdated = true;
                return { ...item, workspaceGroup: workspaceName };
            }
            return item;
        });

        let newHistory = history;
        if (!itemUpdated) {
            newHistory = history.map(item => {
                if (item.id === itemId) {
                    itemUpdated = true;
                    return { ...item, workspaceGroup: workspaceName };
                }
                return item;
            });
        }

        if (itemUpdated) {
            await chrome.storage.local.set({
                dashboardData: { ...dashboardData, bookmarks: newBookmarks, history: newHistory }
            });
        }
    } catch (e) {
        console.error('Error updating item workspace:', e);
    }
}

