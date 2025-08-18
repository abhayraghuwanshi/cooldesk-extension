// Simple IndexedDB helper for workspaces and url index
import { getHostWorkspaces, setHostWorkspaces } from './services/extensionApi';
// Object store: 'workspaces' with keyPath 'id'

const DB_NAME = 'cooldesk-db'
// Bump version to run migration for new 'urls' store
const DB_VERSION = 5
const STORE = 'workspaces'
const URLS_STORE = 'urls'
const SETTINGS_STORE = 'settings'
const UI_STORE = 'ui'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
      // New canonical URL store with membership via multiEntry index
      let urlsStore
      if (!db.objectStoreNames.contains(URLS_STORE)) {
        urlsStore = db.createObjectStore(URLS_STORE, { keyPath: 'url' })
        try {
          urlsStore.createIndex('workspaceIds', 'workspaceIds', { multiEntry: true })
        } catch {}
        try {
          urlsStore.createIndex('by_addedAt', 'addedAt', { unique: false })
        } catch {}
      } else {
        urlsStore = req.transaction.objectStore(URLS_STORE)
        // Ensure indexes exist (idempotent across versions)
        try { if (!urlsStore.indexNames.contains('workspaceIds')) urlsStore.createIndex('workspaceIds', 'workspaceIds', { multiEntry: true }) } catch {}
        try { if (!urlsStore.indexNames.contains('by_addedAt')) urlsStore.createIndex('by_addedAt', 'addedAt', { unique: false }) } catch {}
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(UI_STORE)) {
        db.createObjectStore(UI_STORE, { keyPath: 'id' })
      }
      // New stores for consolidated activity/time tracking
      if (!db.objectStoreNames.contains('activity')) {
        db.createObjectStore('activity', { keyPath: 'url' })
      }
      if (!db.objectStoreNames.contains('timeTracking')) {
        db.createObjectStore('timeTracking', { keyPath: 'url' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

// ===== Activity/Time APIs =====

export async function putActivityRow(record) {
  if (!record || !record.url) return;
  const db = await openDB();
  await new Promise((resolve) => {
    try {
      const tx = db.transaction('activity', 'readwrite');
      const store = tx.objectStore('activity');
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export async function getAllActivity() {
  const db = await openDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('activity', 'readonly');
      const store = tx.objectStore('activity');
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

export async function putTimeRow(record) {
  if (!record || !record.url) return;
  const db = await openDB();
  await new Promise((resolve) => {
    try {
      const tx = db.transaction('timeTracking', 'readwrite');
      const store = tx.objectStore('timeTracking');
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export async function getTimeRow(url) {
  if (!url) return null;
  const db = await openDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('timeTracking', 'readonly');
      const store = tx.objectStore('timeTracking');
      const req = store.get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function getAllTimeRows() {
  const db = await openDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('timeTracking', 'readonly');
      const store = tx.objectStore('timeTracking');
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

export async function listWorkspaces() {
  const db = await openDB()
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const req = store.getAll()
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : [])
    req.onerror = () => reject(req.error)
  })
  // Mirror to host in background; do not block UI if host is unavailable
  try {
    if (Array.isArray(items) && items.length) {
      (async () => { try { await setHostWorkspaces(items); } catch {} })();
    }
  } catch {}
  // If IndexedDB is empty, try to restore from chrome.storage.local backup
  if (!items || items.length === 0) {
    try {
      const { workspacesBackupById } = await chrome.storage.local.get(['workspacesBackupById'])
      const values = workspacesBackupById && typeof workspacesBackupById === 'object'
        ? Object.values(workspacesBackupById)
        : []
      if (values && values.length) {
        // Repopulate IDB from backup for durability
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        await Promise.all(values.map(v => new Promise((resolve) => {
          const putReq = store.put(v)
          putReq.onsuccess = () => resolve()
          putReq.onerror = () => resolve() // ignore individual errors
        })))
        return values
      }
    } catch {}
    // Fallback to host (Electron app) if available
    try {
      const host = await getHostWorkspaces();
      const list = host?.ok && Array.isArray(host.workspaces) ? host.workspaces : [];
      if (list.length) {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        await Promise.all(list.map(v => new Promise((resolve) => {
          const putReq = store.put(v)
          putReq.onsuccess = () => resolve()
          putReq.onerror = () => resolve()
        })))
        return list
      }
    } catch {}
  }
  // Mirror to host in background; do not block UI if host is unavailable (secondary path)
  try {
    if (Array.isArray(items) && items.length) {
      (async () => { try { await setHostWorkspaces(items); } catch {} })();
    }
  } catch {}
  return items
}

export async function saveWorkspace(workspace) {
  const db = await openDB()
  try { console.log('[db.saveWorkspace] start', { id: workspace?.id, name: workspace?.name, urls: Array.isArray(workspace?.urls) ? workspace.urls.length : 0 }); } catch {}
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.put(workspace)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
  try { console.log('[db.saveWorkspace] wrote to IDB'); } catch {}
  // Mirror to chrome.storage.local as a lightweight backup to mitigate potential IDB loss
  try {
    const { workspacesBackupById } = await chrome.storage.local.get(['workspacesBackupById'])
    const next = (workspacesBackupById && typeof workspacesBackupById === 'object') ? workspacesBackupById : {}
    if (workspace && workspace.id) {
      next[workspace.id] = workspace
      await chrome.storage.local.set({ workspacesBackupById: next })
    }
    try { console.log('[db.saveWorkspace] mirrored to chrome.storage.local'); } catch {}
  } catch (e) { try { console.warn('[db.saveWorkspace] mirror to chrome.storage.local failed', e); } catch {} }
  // Mirror entire list to host so Electron app sees latest workspaces (non-blocking)
  try {
    (async () => {
      try {
        const all = await listWorkspaces();
        await setHostWorkspaces(all);
        try { console.log('[db.saveWorkspace] mirrored to host, count:', Array.isArray(all) ? all.length : 0); } catch {}
      } catch (e) { try { console.warn('[db.saveWorkspace] mirror to host failed', e); } catch {} }
    })();
  } catch {}
  // Notify listeners via BroadcastChannel
  try {
    const bc = new BroadcastChannel('ws_db_changes')
    bc.postMessage({ type: 'workspacesChanged' })
    bc.close()
    try { console.log('[db.saveWorkspace] broadcasted ws_db_changes'); } catch {}
  } catch (e) { try { console.warn('[db.saveWorkspace] broadcast failed', e); } catch {} }
}

export function subscribeWorkspaceChanges(callback) {
  let bc
  try {
    bc = new BroadcastChannel('ws_db_changes')
    bc.onmessage = (ev) => {
      if (ev?.data?.type === 'workspacesChanged') callback()
    }
  } catch {}
  return () => {
    try { bc && bc.close() } catch {}
  }
}

// Settings helpers
export async function getSettings() {
  const db = await openDB()
  const existing = await new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readonly')
    const store = tx.objectStore(SETTINGS_STORE)
    const req = store.get('default')
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
  if (existing) return existing.value || {}
  // Migration from chrome.storage.local if present
  try {
    const legacy = await chrome.storage.local.get(['geminiApiKey', 'serverUrl', 'visitCountThreshold', 'historyMaxResults', 'historyDays'])
    const value = {
      geminiApiKey: legacy.geminiApiKey || '',
      serverUrl: legacy.serverUrl || '',
      visitCountThreshold: typeof legacy.visitCountThreshold === 'number' ? legacy.visitCountThreshold : '',
      historyMaxResults: typeof legacy.historyMaxResults === 'number' ? legacy.historyMaxResults : '',
      historyDays: typeof legacy.historyDays === 'number' ? legacy.historyDays : ''
    }
    await saveSettings(value)
    return value
  } catch {
    return {}
  }
}

export async function saveSettings(value) {
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite')
    const store = tx.objectStore(SETTINGS_STORE)
    const req = store.put({ id: 'default', value })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
  try {
    const bc = new BroadcastChannel('settings_db_changes')
    bc.postMessage({ type: 'settingsChanged' })
    bc.close()
  } catch {}
}

// UI state helpers (persist selected tab/workspace)
export async function getUIState() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UI_STORE, 'readonly')
    const store = tx.objectStore(UI_STORE)
    const req = store.get('default')
    req.onsuccess = () => resolve((req.result && req.result.value) || {})
    req.onerror = () => reject(req.error)
  })
}

export async function saveUIState(value) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UI_STORE, 'readwrite')
    const store = tx.objectStore(UI_STORE)
    const req = store.put({ id: 'default', value })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// Delete a workspace by its id
export async function deleteWorkspaceById(id) {
  if (!id) return;
  const db = await openDB();
  // Delete from IndexedDB
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
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

export function subscribeSettingsChanges(callback) {
  let bc
  try {
    bc = new BroadcastChannel('settings_db_changes')
    bc.onmessage = (ev) => {
      if (ev?.data?.type === 'settingsChanged') callback()
    }
  } catch {}
  return () => {
    try { bc && bc.close() } catch {}
  }
}

// ===== URL index APIs =====

/** Get a URL record by key */
export async function getUrlRecord(url) {
  if (!url) return null
  const db = await openDB()
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('urls', 'readonly')
      const store = tx.objectStore('urls')
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
  const db = await openDB()
  await new Promise((resolve) => {
    try {
      const tx = db.transaction('urls', 'readwrite')
      const store = tx.objectStore('urls')
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
  try { const bc = new BroadcastChannel('urls_db_changes'); bc.postMessage({ type: 'urlsChanged' }); bc.close() } catch {}
}

/** Add URL to a workspace (idempotent). Creates doc if missing. */
export async function addUrlToWorkspace(url, wsId, meta = {}) {
  if (!url || !wsId) return
  const db = await openDB()
  await new Promise((resolve) => {
    try {
      const tx = db.transaction('urls', 'readwrite')
      const store = tx.objectStore('urls')
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
  try { const bc = new BroadcastChannel('urls_db_changes'); bc.postMessage({ type: 'urlsChanged' }); bc.close() } catch {}
}

/** Remove URL from a workspace. Optionally delete record if empty. */
export async function removeUrlFromWorkspace(url, wsId, { deleteIfOrphan = true } = {}) {
  if (!url || !wsId) return
  const db = await openDB()
  await new Promise((resolve) => {
    try {
      const tx = db.transaction('urls', 'readwrite')
      const store = tx.objectStore('urls')
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
  try { const bc = new BroadcastChannel('urls_db_changes'); bc.postMessage({ type: 'urlsChanged' }); bc.close() } catch {}
}

/** List all URL docs in a workspace (via multiEntry index). */
export async function listUrlsByWorkspace(wsId) {
  if (!wsId) return []
  const db = await openDB()
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('urls', 'readonly')
      const store = tx.objectStore('urls')
      const idx = store.index('workspaceIds')
      const req = idx.getAll(String(wsId))
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : [])
      req.onerror = () => resolve([])
    } catch { resolve([]) }
  })
}

/** List all URL docs. */
export async function listAllUrls() {
  const db = await openDB()
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('urls', 'readonly')
      const store = tx.objectStore('urls')
      const req = store.getAll()
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : [])
      req.onerror = () => resolve([])
    } catch { resolve([]) }
  })
}
