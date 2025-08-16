// Simple IndexedDB helper for workspaces
import { getHostWorkspaces, setHostWorkspaces } from './services/extensionApi';
// Object store: 'workspaces' with keyPath 'id'

const DB_NAME = 'cooldesk-db'
const DB_VERSION = 3
const STORE = 'workspaces'
const SETTINGS_STORE = 'settings'
const UI_STORE = 'ui'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(UI_STORE)) {
        db.createObjectStore(UI_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

export async function listWorkspaces() {
  const db = await openDB()
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
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
  // Mirror to host so Electron sees non-empty list immediately
  try {
    if (Array.isArray(items) && items.length) {
      await setHostWorkspaces(items);
    }
  } catch {}
  return items
}

export async function saveWorkspace(workspace) {
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.put(workspace)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
  // Mirror to chrome.storage.local as a lightweight backup to mitigate potential IDB loss
  try {
    const { workspacesBackupById } = await chrome.storage.local.get(['workspacesBackupById'])
    const next = (workspacesBackupById && typeof workspacesBackupById === 'object') ? workspacesBackupById : {}
    if (workspace && workspace.id) {
      next[workspace.id] = workspace
      await chrome.storage.local.set({ workspacesBackupById: next })
    }
  } catch {}
  // Mirror entire list to host so Electron app sees latest workspaces
  try {
    const all = await listWorkspaces();
    await setHostWorkspaces(all);
  } catch {}
  // Notify listeners via BroadcastChannel
  try {
    const bc = new BroadcastChannel('ws_db_changes')
    bc.postMessage({ type: 'workspacesChanged' })
    bc.close()
  } catch {}
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
