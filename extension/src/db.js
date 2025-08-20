// Simple IndexedDB helper for workspaces and url index
import { getHostWorkspaces, setHostWorkspaces } from './services/extensionApi';
// Object store: 'workspaces' with keyPath 'id'

const DB_NAME = 'cooldesk-db'
// Bump version to run migration for new 'urls' store
const DB_VERSION = 6
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
      // Time series activity store for analytics
      if (!db.objectStoreNames.contains('activityTimeSeries')) {
        const tsStore = db.createObjectStore('activityTimeSeries', { keyPath: 'id' })
        try {
          tsStore.createIndex('by_url', 'url', { unique: false })
          tsStore.createIndex('by_timestamp', 'timestamp', { unique: false })
          tsStore.createIndex('by_sessionId', 'sessionId', { unique: false })
          tsStore.createIndex('by_url_timestamp', ['url', 'timestamp'], { unique: false })
        } catch {}
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

// ===== Time Series Activity APIs =====

export async function putActivityTimeSeriesEvent(event) {
  if (!event || !event.url || !event.timestamp) return;
  const db = await openDB();
  await new Promise((resolve) => {
    try {
      const tx = db.transaction('activityTimeSeries', 'readwrite');
      const store = tx.objectStore('activityTimeSeries');
      const req = store.put(event);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export async function getActivityTimeSeriesByUrl(url, startTime = 0, endTime = Date.now()) {
  const db = await openDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('activityTimeSeries', 'readonly');
      const store = tx.objectStore('activityTimeSeries');
      const index = store.index('by_url_timestamp');
      const range = IDBKeyRange.bound([url, startTime], [url, endTime]);
      const req = index.getAll(range);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

export async function getActivityTimeSeriesByTimeRange(startTime, endTime = Date.now()) {
  const db = await openDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('activityTimeSeries', 'readonly');
      const store = tx.objectStore('activityTimeSeries');
      const index = store.index('by_timestamp');
      const range = IDBKeyRange.bound(startTime, endTime);
      const req = index.getAll(range);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

// Data retention and cleanup
export async function cleanupOldTimeSeriesData(retentionDays = 30) {
  const db = await openDB();
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('activityTimeSeries', 'readwrite');
      const store = tx.objectStore('activityTimeSeries');
      const index = store.index('by_timestamp');
      const range = IDBKeyRange.upperBound(cutoffTime);
      
      let deletedCount = 0;
      const request = index.openCursor(range);
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          console.log(`[Cleanup] Deleted ${deletedCount} old time series events`);
          resolve(deletedCount);
        }
      };
      
      request.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

export async function getTimeSeriesStorageStats() {
  const db = await openDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('activityTimeSeries', 'readonly');
      const store = tx.objectStore('activityTimeSeries');
      const countRequest = store.count();
      
      countRequest.onsuccess = () => {
        const totalEvents = countRequest.result;
        const estimatedSizeMB = (totalEvents * 0.5) / 1024; // ~500 bytes per event
        
        // Get oldest and newest timestamps
        const index = store.index('by_timestamp');
        const oldestRequest = index.openCursor();
        const newestRequest = index.openCursor(null, 'prev');
        
        let oldest = null, newest = null;
        
        oldestRequest.onsuccess = (e) => {
          if (e.target.result) oldest = e.target.result.value.timestamp;
          
          newestRequest.onsuccess = (e2) => {
            if (e2.target.result) newest = e2.target.result.value.timestamp;
            
            resolve({
              totalEvents,
              estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
              oldestEvent: oldest,
              newestEvent: newest,
              spanDays: oldest && newest ? Math.round((newest - oldest) / (24 * 60 * 60 * 1000)) : 0
            });
          };
        };
      };
      
      countRequest.onerror = () => resolve({ totalEvents: 0, estimatedSizeMB: 0 });
    } catch {
      resolve({ totalEvents: 0, estimatedSizeMB: 0 });
    }
  });
}

export async function getActivityAnalytics(url = null, days = 7) {
  const endTime = Date.now();
  const startTime = endTime - (days * 24 * 60 * 60 * 1000);
  
  // Limit query size for performance
  const MAX_EVENTS = 10000;
  let events = url 
    ? await getActivityTimeSeriesByUrl(url, startTime, endTime)
    : await getActivityTimeSeriesByTimeRange(startTime, endTime);
    
  // Sample data if too large
  if (events.length > MAX_EVENTS) {
    const step = Math.ceil(events.length / MAX_EVENTS);
    events = events.filter((_, i) => i % step === 0);
    console.warn(`[Analytics] Sampled ${events.length} events from ${events.length * step} total`);
  }
    
  // Aggregate analytics
  const analytics = {
    totalTime: 0,
    totalClicks: 0,
    totalForms: 0,
    avgScrollDepth: 0,
    sessionsCount: new Set(),
    dailyBreakdown: {},
    hourlyPattern: Array(24).fill(0),
    topUrls: {},
  };
  
  events.forEach(event => {
    const { metrics, sessionId, timestamp } = event;
    analytics.totalTime += metrics.timeSpent || 0;
    analytics.totalClicks += metrics.clicks || 0;
    analytics.totalForms += metrics.forms || 0;
    analytics.sessionsCount.add(sessionId);
    
    // Daily breakdown
    const day = new Date(timestamp).toDateString();
    if (!analytics.dailyBreakdown[day]) {
      analytics.dailyBreakdown[day] = { time: 0, clicks: 0, forms: 0, sessions: new Set() };
    }
    analytics.dailyBreakdown[day].time += metrics.timeSpent || 0;
    analytics.dailyBreakdown[day].clicks += metrics.clicks || 0;
    analytics.dailyBreakdown[day].forms += metrics.forms || 0;
    analytics.dailyBreakdown[day].sessions.add(sessionId);
    
    // Hourly pattern
    const hour = new Date(timestamp).getHours();
    analytics.hourlyPattern[hour] += metrics.timeSpent || 0;
    
    // Top URLs
    if (!url) {
      if (!analytics.topUrls[event.url]) {
        analytics.topUrls[event.url] = { time: 0, clicks: 0, forms: 0 };
      }
      analytics.topUrls[event.url].time += metrics.timeSpent || 0;
      analytics.topUrls[event.url].clicks += metrics.clicks || 0;
      analytics.topUrls[event.url].forms += metrics.forms || 0;
    }
  });
  
  // Convert sets to counts
  analytics.sessionsCount = analytics.sessionsCount.size;
  Object.keys(analytics.dailyBreakdown).forEach(day => {
    analytics.dailyBreakdown[day].sessions = analytics.dailyBreakdown[day].sessions.size;
  });
  
  // Calculate average scroll depth
  const scrollEvents = events.filter(e => e.metrics.scrollDepth > 0);
  analytics.avgScrollDepth = scrollEvents.length > 0 
    ? scrollEvents.reduce((sum, e) => sum + e.metrics.scrollDepth, 0) / scrollEvents.length 
    : 0;
    
  return {
    ...analytics,
    sampledData: events.length < (url ? 1000 : 5000), // Indicate if data was sampled
    queriedEvents: events.length
  };
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
