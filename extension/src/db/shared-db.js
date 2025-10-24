// Shared workspaces database - separate from personal workspaces
import { withErrorHandling } from './error-handler.js'

const SHARED_DB_NAME = 'CoolDeskSharedDB'
const SHARED_DB_VERSION = 1
const SHARED_STORE_NAME = 'sharedWorkspaces'

let sharedDb = null

// Initialize shared database
const initSharedDB = async () => {
  if (sharedDb) return sharedDb

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARED_DB_NAME, SHARED_DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      sharedDb = request.result
      resolve(sharedDb)
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result

      // Create shared workspaces store
      if (!db.objectStoreNames.contains(SHARED_STORE_NAME)) {
        const store = db.createObjectStore(SHARED_STORE_NAME, { keyPath: 'id' })
        store.createIndex('source', 'source', { unique: false })
        store.createIndex('sharedBy', 'sharedBy', { unique: false })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
        store.createIndex('groupKey', 'groupKey', { unique: false })
      }
    }
  })
}

// Save shared workspace to local DB
export const saveSharedWorkspace = withErrorHandling(async (workspace) => {
  const db = await initSharedDB()
  const transaction = db.transaction([SHARED_STORE_NAME], 'readwrite')
  const store = transaction.objectStore(SHARED_STORE_NAME)
  
  const sharedWorkspace = {
    ...workspace,
    localSavedAt: Date.now(),
    type: 'shared'
  }
  
  console.log('[SharedDB] Saving workspace:', sharedWorkspace)
  
  return new Promise((resolve, reject) => {
    const request = store.put(sharedWorkspace)
    request.onsuccess = () => {
      console.log('[SharedDB] Workspace saved successfully:', sharedWorkspace.id)
      resolve(sharedWorkspace)
    }
    request.onerror = () => {
      console.error('[SharedDB] Error saving workspace:', request.error)
      reject(request.error)
    }
  })
})

// Get all shared workspaces from local DB
export const listSharedWorkspaces = withErrorHandling(async (options = {}) => {
  const db = await initSharedDB()
  const transaction = db.transaction([SHARED_STORE_NAME], 'readonly')
  const store = transaction.objectStore(SHARED_STORE_NAME)
  
  const workspaces = await new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })

  console.log('[SharedDB] Raw workspaces from DB:', workspaces)

  // Apply filters
  let filtered = workspaces

  if (options.groupKey) {
    filtered = filtered.filter(w => w.groupKey === options.groupKey)
  }

  if (options.source) {
    filtered = filtered.filter(w => w.source === options.source)
  }

  // Sort by most recent
  filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))

  console.log('[SharedDB] Filtered workspaces:', filtered)
  return { data: filtered, count: filtered.length }
})

// Delete shared workspace from local DB
export const deleteSharedWorkspace = withErrorHandling(async (id) => {
  const db = await initSharedDB()
  const transaction = db.transaction([SHARED_STORE_NAME], 'readwrite')
  const store = transaction.objectStore(SHARED_STORE_NAME)
  
  await store.delete(id)
  return { success: true }
})

// Clear all shared workspaces
export const clearSharedWorkspaces = withErrorHandling(async () => {
  const db = await initSharedDB()
  const transaction = db.transaction([SHARED_STORE_NAME], 'readwrite')
  const store = transaction.objectStore(SHARED_STORE_NAME)
  
  console.log('[SharedDB] Clearing all shared workspaces')
  
  return new Promise((resolve, reject) => {
    const request = store.clear()
    request.onsuccess = () => {
      console.log('[SharedDB] All shared workspaces cleared')
      resolve({ success: true })
    }
    request.onerror = () => {
      console.error('[SharedDB] Error clearing workspaces:', request.error)
      reject(request.error)
    }
  })
})

// Sync shared workspaces from Dropbox to local DB
export const syncSharedWorkspacesFromDropbox = withErrorHandling(async (dropboxData) => {
  console.log('[SharedDB] Syncing from Dropbox:', dropboxData)
  
  const workspaces = dropboxData?.workspaces || []
  console.log('[SharedDB] Workspaces to sync:', workspaces)
  
  // Clear existing and save new data
  await clearSharedWorkspaces()
  
  const savedWorkspaces = []
  for (const workspace of workspaces) {
    if (workspace.shared === true || workspace.source === 'context-menu-share') {
      const saved = await saveSharedWorkspace({
        ...workspace,
        groupKey: dropboxData.groupKey || 'public',
        sharedBy: dropboxData.sharedBy || 'unknown',
        syncedAt: Date.now()
      })
      savedWorkspaces.push(saved)
    }
  }
  
  console.log('[SharedDB] Saved workspaces:', savedWorkspaces)
  return { data: savedWorkspaces, count: savedWorkspaces.length }
})

// Get shared workspaces grouped by type (workspace vs individual links)
export const getGroupedSharedWorkspaces = withErrorHandling(async () => {
  const result = await listSharedWorkspaces()
  console.log('[SharedDB] Grouping result:', result)
  
  // Handle different result formats
  let workspaces = []
  if (Array.isArray(result)) {
    workspaces = result
  } else if (result?.success && result?.data?.data && Array.isArray(result.data.data)) {
    workspaces = result.data.data
  } else if (result?.success && Array.isArray(result?.data)) {
    workspaces = result.data
  } else if (result?.data && Array.isArray(result.data)) {
    workspaces = result.data
  } else if (result?.workspaces && Array.isArray(result.workspaces)) {
    workspaces = result.workspaces
  } else {
    console.log('[SharedDB] No workspaces found for grouping:', result)
    workspaces = []
  }
  
  console.log('[SharedDB] Workspaces to group:', workspaces)
  
  const grouped = {
    workspaces: [], // Full workspaces with multiple URLs
    links: [],      // Individual shared links
    apps: []        // App-style grouped items
  }
  
  // Ensure workspaces is an array before using forEach
  if (Array.isArray(workspaces)) {
    workspaces.forEach(item => {
      if (item.urls && Array.isArray(item.urls) && item.urls.length > 1) {
        // Multi-URL workspace
        grouped.workspaces.push(item)
      } else if (item.urls && Array.isArray(item.urls) && item.urls.length === 1) {
        // Single link
        grouped.links.push(item)
      } else {
        // Individual item
        grouped.links.push(item)
      }
    })
  }
  
  // Group links by domain for app-style display
  const domainGroups = {}
  if (Array.isArray(grouped.links)) {
    grouped.links.forEach(link => {
      try {
        const url = link.url || link.urls?.[0]?.url
        if (url) {
          const domain = new URL(url).hostname.replace('www.', '')
          if (!domainGroups[domain]) {
            domainGroups[domain] = {
              domain,
              items: [],
              favicon: link.favicon,
              count: 0
            }
          }
          domainGroups[domain].items.push(link)
          domainGroups[domain].count++
        }
      } catch (e) {
        // Invalid URL, add to miscellaneous
        if (!domainGroups['misc']) {
          domainGroups['misc'] = { domain: 'misc', items: [], count: 0 }
        }
        domainGroups['misc'].items.push(link)
        domainGroups['misc'].count++
      }
    })
  }
  
  grouped.apps = Object.values(domainGroups)
  
  console.log('[SharedDB] Final grouped data:', grouped)
  return grouped
})
