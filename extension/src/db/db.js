const DB_NAME = 'cooldesk-db'
// Bump version to run migration for new 'urls' store and urlNotes store
const DB_VERSION = 9
const SETTINGS_STORE = 'settings'
const UI_STORE = 'ui'

let dbPromise = null

export function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    console.log('[DB Debug] Opening database:', DB_NAME, 'version:', DB_VERSION)
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    
    req.onupgradeneeded = (event) => {
      console.log('[DB Debug] Database upgrade needed, creating stores...')
      const db = req.result
      // New canonical URL store with membership via multiEntry index
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(UI_STORE)) {
        db.createObjectStore(UI_STORE, { keyPath: 'id' })
      }
      // New stores for consolidated activity/time tracking
      // Time series activity store for analytics
    }
    
    req.onsuccess = () => {
      console.log('[DB Debug] Database opened successfully')
      resolve(req.result)
    }
    
    req.onerror = (event) => {
      console.error('[DB Debug] Database open failed:', event.target.error)
      reject(req.error)
    }
  })
  
  return dbPromise
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
    const legacy = await chrome.storage.local.get(['geminiApiKey', 'modelName', 'serverUrl', 'visitCountThreshold', 'historyDays'])
    const value = {
      geminiApiKey: legacy.geminiApiKey || '',
      modelName: (typeof legacy.modelName === 'string' && legacy.modelName.trim()) ? legacy.modelName.trim() : '',
      visitCountThreshold: typeof legacy.visitCountThreshold === 'number' ? legacy.visitCountThreshold : '',
      historyDays: typeof legacy.historyDays === 'number' ? legacy.historyDays : ''
    }
    // If modelName is empty but legacy serverUrl exists and looks like a Google models endpoint, attempt to infer model name
    if (!value.modelName && typeof legacy.serverUrl === 'string' && legacy.serverUrl.trim()) {
      try {
        const u = new URL(legacy.serverUrl.trim())
        const parts = u.pathname.split('/')
        const idx = parts.findIndex((p) => p === 'models')
        if (idx >= 0 && parts[idx + 1]) {
          const raw = parts[idx + 1]
          value.modelName = decodeURIComponent(raw.replace(/:generateContent$/, ''))
        }
      } catch { /* ignore */ }
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
  } catch { }
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
