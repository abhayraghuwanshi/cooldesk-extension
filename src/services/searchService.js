import { listWorkspaces } from '../db/unified-api';

/**
 * High-Speed Search Service
 * Implements Federated Search pattern:
 * 1. Local Index (Instant, from chrome.storage.local or in-memory cache)
 * 2. Background Fallback (Slow, IPC)
 * 3. Desktop Integration (Future)
 */

const DB_NAME = 'cooldesk-unified-db';
const DB_VERSION = 2;
const SEARCH_INDEX_KEY = 'search_index';

// ==========================================
// ELECTRON IN-MEMORY CACHE
// Avoids repeated IPC calls - data loaded once, searched locally
// ==========================================
let electronDataCache = {
  tabs: [],
  workspaces: [],
  runningApps: [],
  installedApps: [],
  history: [],
  bookmarks: [],
  lastRefresh: {
    tabs: 0,
    runningApps: 0,
    workspaces: 0,
    installedApps: 0,
    history: 0,
    bookmarks: 0
  }
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Normalize app name for matching (strips spaces, dots, exes, etc)
function normalizeAppName(name) {
  return (name || '').toLowerCase()
    .replace(/\.exe$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

// ==========================================
// PERSISTENT APP MAPPING CACHE
// Learns which processes belong to which apps over time
// e.g., "DBeaver" -> "javaw.exe", "Canva" -> "msedge.exe"
// ==========================================
let appProcessMapping = {}; // { "dbeaver": { processName: "javaw", path: "...", lastSeen: timestamp } }

// Load mapping from localStorage if available
function loadAppMapping() {
  try {
    const stored = localStorage.getItem('app_process_mapping');
    if (stored) {
      appProcessMapping = JSON.parse(stored);
      console.log('[SearchService] Loaded app mapping cache:', Object.keys(appProcessMapping).length, 'entries');
    }
  } catch (e) {
    console.warn('[SearchService] Failed to load app mapping:', e);
  }
}

// Save mapping to localStorage
function saveAppMapping() {
  try {
    localStorage.setItem('app_process_mapping', JSON.stringify(appProcessMapping));
  } catch (e) {
    console.warn('[SearchService] Failed to save app mapping:', e);
  }
}

// Learn from successful matches
function learnAppMapping(appName, runningApp) {
  if (!appName || !runningApp) return;

  const key = normalizeAppName(appName);
  const processName = runningApp.name;
  const processPath = runningApp.path;

  // Update mapping
  appProcessMapping[key] = {
    processName: processName,
    path: processPath,
    lastSeen: Date.now()
  };

  // Save to localStorage (debounced via setTimeout to avoid too many writes)
  if (!window.saveAppMappingTimeout) {
    window.saveAppMappingTimeout = setTimeout(() => {
      saveAppMapping();
      window.saveAppMappingTimeout = null;
    }, 1000);
  }
}

// Initialize mapping cache on load
if (typeof localStorage !== 'undefined') {
  loadAppMapping();
}

// Print AppMatcher results in DevTools so you can inspect matching in-browser
if (typeof window !== 'undefined' && window.electronAPI?.subscribe) {
  window.electronAPI.subscribe('debug-running-apps', (apps) => {
    console.log('[AppMatcher] Running apps from matcher (' + apps.length + ' total):');
    console.table(apps);
  });
}

// Different TTLs for different data types
const CACHE_TTL = {
  tabs: 5000,              // 5 seconds - dynamic, changes frequently
  runningApps: 5000,       // 5 seconds - dynamic, changes frequently
  workspaces: 60000,       // 1 minute - semi-static
  installedApps: 86400000, // 24 hours - very static, rarely changes
  history: 120000,         // 2 minutes - semi-static
  bookmarks: 300000        // 5 minutes - semi-static
};

// Track if sidecar is available to avoid repeated failed calls
let sidecarAvailable = null; // null = unknown, true/false = known state
let sidecarLastCheck = 0;
const SIDECAR_CHECK_INTERVAL = 60000; // Re-check every 60 seconds

/**
 * Check if sidecar is available (with caching)
 */
async function isSidecarAvailable() {
  const now = Date.now();
  const interval = sidecarAvailable === false ? 5000 : SIDECAR_CHECK_INTERVAL;
  if (sidecarAvailable !== null && now - sidecarLastCheck < interval) {
    return sidecarAvailable;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('http://localhost:4000/health', { signal: controller.signal });
    clearTimeout(timeoutId);
    sidecarAvailable = res.ok;
  } catch {
    sidecarAvailable = false;
  }
  sidecarLastCheck = now;
  return sidecarAvailable;
}

/**
 * Check if specific cache is fresh
 */
function isCacheFresh(type) {
  const lastRefresh = electronDataCache.lastRefresh[type] || 0;
  const ttl = CACHE_TTL[type] || 30000;
  return Date.now() - lastRefresh < ttl;
}

// Check if running in Electron
function isElectron() {
  return typeof window !== 'undefined' && window.electronAPI;
}

/**
 * Load all searchable data into memory cache (Electron/Tauri only)
 * Smart refresh - only fetches stale data based on TTL
 */
export async function refreshElectronCache(forceRefresh = false) {
  if (!isElectron()) return;

  const now = Date.now();
  const startTime = performance.now();

  // Helper to add timeout to promises
  const withTimeout = (promise, ms, fallback = []) =>
    Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => resolve(fallback), ms))
    ]);

  const refreshPromises = [];

  // 1. DYNAMIC DATA: Tabs & Running Apps (refresh if stale or forced)
  if (forceRefresh || !isCacheFresh('runningApps')) {
    refreshPromises.push(
      withTimeout(window.electronAPI.getRunningApps?.().catch(() => []), 3000)
        .then(apps => {
          if (Array.isArray(apps)) {
            electronDataCache.runningApps = apps;
            electronDataCache.lastRefresh.runningApps = now;
            const runningCount = apps.filter(a => a.isRunning).length;
            const visibleCount = apps.filter(a => a.isRunning && a.isVisible && !a.cloaked).length;
            console.log(`[SearchService] Loaded ${apps.length} apps (${runningCount} running, ${visibleCount} visible):`, apps.filter(a => a.isRunning).map(a => a.name).join(', '));
            if (apps.length > 0) {
              console.table(apps.filter(a => a.isRunning).map(a => ({
                name: a.name,
                pid: a.pid,
                visible: a.isVisible,
                cloaked: a.cloaked,
                title: a.title
              })));
            }
          }
        })
    );
  }

  // 2. INSTALLED APPS: Only refresh if cache is empty or expired (24h)
  if (electronDataCache.installedApps.length === 0 || !isCacheFresh('installedApps')) {
    if (window.electronAPI?.getInstalledApps) {
      refreshPromises.push(
        withTimeout(window.electronAPI.getInstalledApps().catch(e => {
          console.error('[SearchService] getInstalledApps error:', e);
          return [];
        }), 10000)
          .then(apps => {
            if (Array.isArray(apps) && apps.length > 0) {
              electronDataCache.installedApps = apps;
              electronDataCache.lastRefresh.installedApps = now;
              console.log(`[SearchService] Loaded ${apps.length} installed apps`);
            } else {
              console.warn('[SearchService] getInstalledApps returned empty or invalid:', apps);
            }
          })
      );
    } else {
      console.warn('[SearchService] getInstalledApps not available');
    }
  }

  // 3. SIDECAR DATA: Only fetch if sidecar is available
  const sidecarUp = await isSidecarAvailable();
  console.log('[SearchService] Sidecar available:', sidecarUp);

  if (sidecarUp) {
    // Tabs from sidecar
    if (forceRefresh || !isCacheFresh('tabs')) {
      refreshPromises.push(
        withTimeout(window.electronAPI.getTabs?.().catch(e => { console.error('[SearchService] getTabs error:', e); return []; }), 1000)
          .then(tabs => {
            console.log('[SearchService] Got tabs:', tabs?.length || 0);
            electronDataCache.tabs = Array.isArray(tabs) ? tabs : [];
            electronDataCache.lastRefresh.tabs = now;
          })
      );
    }

    // Workspaces from sidecar
    if (forceRefresh || !isCacheFresh('workspaces')) {
      refreshPromises.push(
        withTimeout(
          window.electronAPI.sendMessage?.({ type: 'SEARCH_WORKSPACES', query: '', maxResults: 100 })
            .then(r => Array.isArray(r?.results) ? r.results : []).catch(() => []),
          1500
        ).then(ws => {
          electronDataCache.workspaces = ws;
          electronDataCache.lastRefresh.workspaces = now;
        })
      );
    }

    // History from sidecar (background, lower priority)
    if (!isCacheFresh('history')) {
      refreshPromises.push(
        withTimeout(
          window.electronAPI.sendMessage?.({ type: 'SEARCH_HISTORY', query: '', maxResults: 100 })
            .then(r => { console.log('[SearchService] Got history:', r?.results?.length || 0); return Array.isArray(r?.results) ? r.results : []; })
            .catch(e => { console.error('[SearchService] history error:', e); return []; }),
          2000
        ).then(h => {
          electronDataCache.history = h;
          electronDataCache.lastRefresh.history = now;
        })
      );
    }

    // Bookmarks from sidecar (background, lower priority)
    if (!isCacheFresh('bookmarks')) {
      refreshPromises.push(
        withTimeout(
          window.electronAPI.sendMessage?.({ type: 'SEARCH_BOOKMARKS', query: '', maxResults: 100 })
            .then(r => { console.log('[SearchService] Got bookmarks:', r?.results?.length || 0); return Array.isArray(r?.results) ? r.results : []; })
            .catch(e => { console.error('[SearchService] bookmarks error:', e); return []; }),
          2000
        ).then(b => {
          electronDataCache.bookmarks = b;
          electronDataCache.lastRefresh.bookmarks = now;
        })
      );
    }
  } else {
    console.log('[SearchService] Sidecar NOT available - skipping tabs/history/bookmarks fetch');
  }

  // Wait for all refreshes
  if (refreshPromises.length > 0) {
    await Promise.allSettled(refreshPromises);
  }
}

/**
 * Call the Rust /search/unified endpoint — returns unified findings from LanceDB.
 */
async function searchUnifiedFromBackend(query, maxResults = 20, contextUrls = null) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    let url = `http://localhost:4000/search/unified?q=${encodeURIComponent(query)}&limit=${maxResults}`;
    if (contextUrls && contextUrls.length > 0) {
      url += `&context_urls=${encodeURIComponent(contextUrls.join(','))}`;
    }

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(item => {
      // Map LanceDB results back to frontend expectations
      if (item.type === 'app') {
        const app = item.metadata;
        const windowTitles = Array.isArray(app.titles) && app.titles.length > 0 ? app.titles : null;
        const description = app.isRunning
          ? (windowTitles ? windowTitles.join(' · ') : 'Running')
          : 'Application';

        return {
          ...item,
          id: app.id || `app-${app.name}`,
          description,
          isRunning: !!app.isRunning,
          icon: app.icon,
        };
      }

      // For other types (tabs, workspaces, history), we use the LanceDB metadata directly
      return {
        ...item,
        // Ensure description/favicon mapping if needed
        favicon: item.metadata?.favicon || item.metadata?.favIconUrl,
      };
    });
  } catch (e) {
    console.error('[SearchService] Unified search failed:', e);
    return [];
  }
}

/**
 * Local cache search for non-app items (tabs, workspaces, history, bookmarks).
 * Apps are handled by the Rust backend via searchAppsFromBackend().
 */
function searchElectronCache(query) {
  if (!query || !query.trim()) return [];

  const results = [];
  const q = query.toLowerCase();

  // Search tabs
  for (const tab of electronDataCache.tabs) {
    const titleMatch = (tab.title || '').toLowerCase().includes(q);
    const urlMatch = (tab.url || '').toLowerCase().includes(q);
    if (titleMatch || urlMatch) {
      results.push({
        id: tab.id || tab.tabId,
        title: tab.title,
        url: tab.url,
        description: 'Active Tab',
        type: 'tab',
        favicon: tab.favIconUrl || tab.favicon,
        tabId: tab.id || tab.tabId,
        score: titleMatch ? 80 : 60
      });
    }
  }

  // Search workspaces
  for (const ws of electronDataCache.workspaces) {
    const nameMatch = (ws.title || ws.name || '').toLowerCase().includes(q);
    const descMatch = (ws.description || '').toLowerCase().includes(q);
    if (nameMatch || descMatch) {
      results.push({
        id: ws.id,
        title: ws.title || ws.name,
        url: ws.url,
        description: ws.description || 'Workspace',
        type: ws.type || 'workspace',
        favicon: ws.favicon,
        score: nameMatch ? 70 : 50
      });
    }
  }

  // Search cached history (if available)
  for (const h of electronDataCache.history) {
    const titleMatch = (h.title || '').toLowerCase().includes(q);
    const urlMatch = (h.url || '').toLowerCase().includes(q);
    if (titleMatch || urlMatch) {
      results.push({
        id: h.id || `hist-${h.url}`,
        title: h.title,
        url: h.url,
        description: 'History',
        type: 'history',
        favicon: h.favicon,
        score: titleMatch ? 55 : 40
      });
    }
  }

  // Search cached bookmarks (if available)
  for (const b of electronDataCache.bookmarks) {
    const titleMatch = (b.title || '').toLowerCase().includes(q);
    const urlMatch = (b.url || '').toLowerCase().includes(q);
    if (titleMatch || urlMatch) {
      results.push({
        id: b.id || `bm-${b.url}`,
        title: b.title,
        url: b.url,
        description: 'Bookmark',
        type: 'bookmark',
        favicon: b.favicon,
        score: titleMatch ? 65 : 45
      });
    }
  }

  // Sort by score
  results.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Log final unique results with visibility info
  console.log(`[SearchService] Search results for "${query}" (${results.length} total):`);
  if (results.length > 0) {
    console.table(results.map(r => ({
      title: r.title,
      score: r.score,
      type: r.type,
      isRunning: r.isRunning ?? false,
      isVisible: r.isVisible ?? false,
      cloaked: r.cloaked ?? 0,
      pid: r.pid ?? null,
      description: (r.description || '').slice(0, 50)
    })));
  }

  return results;
}



// --- HELPER: Is Content Script? ---
function isContentScript() {
  return typeof chrome !== 'undefined' && chrome.runtime && !chrome.tabs;
}

// --- HELPER: Advanced Fuzzy Scoring ---
/**
 * Production-grade fuzzy matching with multiple strategies
 * Returns score 0-100 based on match quality
 */
export function fuzzyScore(text, query) {
  if (!text || !query) return 0;

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // EXACT MATCH: Highest priority
  if (textLower === queryLower) return 100;

  // STARTS WITH: Very high priority
  if (textLower.startsWith(queryLower)) return 95;

  // WORD BOUNDARY MATCH: e.g., "vs" matches "Visual Studio"
  const textWords = textLower.split(/[\s\-_\.]+/).filter(w => w.length > 0);
  const queryWords = queryLower.split(/[\s\-_\.]+/).filter(w => w.length > 0);

  // Check if query words match start of text words
  if (queryWords.length === 1) {
    const hasWordStart = textWords.some(w => w.startsWith(queryLower));
    if (hasWordStart) return 90;
  }

  // ACRONYM MATCH: e.g., "vsc" matches "Visual Studio Code"
  if (queryLower.length >= 2 && textWords.length > 1) {
    const acronym = textWords.map(w => w[0]).join('');
    if (acronym === queryLower) return 85;
    if (acronym.startsWith(queryLower)) return 82;
  }

  // CONTAINS MATCH: Full query appears in text
  if (textLower.includes(queryLower)) return 75;

  // MULTI-WORD MATCH: All query words appear in text
  if (queryWords.length > 1) {
    const allWordsMatch = queryWords.every(qw =>
      textLower.includes(qw) || textWords.some(tw => tw.startsWith(qw))
    );
    if (allWordsMatch) {
      // Boost score if words appear in order
      let lastIndex = -1;
      let inOrder = true;
      for (const qw of queryWords) {
        const index = textLower.indexOf(qw, lastIndex + 1);
        if (index === -1 || index <= lastIndex) {
          inOrder = false;
          break;
        }
        lastIndex = index;
      }
      return inOrder ? 70 : 65;
    }
  }

  // SUBSTRING MATCH: Query is part of a word
  const hasSubstring = textWords.some(w => w.includes(queryLower));
  if (hasSubstring) return 60;

  // CHARACTER SEQUENCE MATCH: Characters appear in order (fuzzy)
  let queryIdx = 0;
  let matchCount = 0;
  let consecutiveMatches = 0;
  let maxConsecutive = 0;

  for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) {
      matchCount++;
      consecutiveMatches++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveMatches);
      queryIdx++;
    } else {
      consecutiveMatches = 0;
    }
  }

  // All characters found in order
  if (queryIdx === queryLower.length) {
    const completeness = matchCount / queryLower.length;
    const consecutiveBonus = maxConsecutive / queryLower.length;
    return Math.floor(30 + (completeness * 20) + (consecutiveBonus * 10));
  }

  return 0;
}

// --- PROVIDER 1: Local Index (High Speed) ---
// Returns NULL if the index is completely missing or corrupted.
// Returns ARRAY (possibly empty) if index exists.
async function searchLocalIndex(query, typeFilter = null) {
  try {
    const data = await chrome.storage.local.get(SEARCH_INDEX_KEY);
    const indexData = data[SEARCH_INDEX_KEY];

    if (!indexData || !indexData.items) {
      // console.warn('[SearchService] Local index empty or missing');
      return null; // SIGNAL: Index Missing
    }

    // Check freshness (optional warning)
    // if (Date.now() - indexData.timestamp > 10 * 60 * 1000) console.warn('[SearchService] Index stale');

    const items = indexData.items;
    const results = [];

    // Filter Loop (Synchronous & Fast)
    for (const item of items) {
      // Filter by type if requested
      if (typeFilter && item.t !== typeFilter) continue;

      // Match
      // Start with base score from indexer
      let baseScore = item.scoreBase || 0;

      // Compute fuzzy score based on query
      // Search across all relevant fields including category
      const matchScore = Math.max(
        fuzzyScore(item.l, query), // l = label/title
        fuzzyScore(item.d, query), // d = description
        fuzzyScore(item.u, query), // u = url
        fuzzyScore(item.c, query)  // c = category (e.g., workspace name)
      );

      if (matchScore > 0) {
        // Expand item back to Full Result Format
        results.push({
          id: item.i,
          title: item.l,
          url: item.u,
          description: item.d,
          type: item.t,
          icon: getIconForType(item.t), // Use stored icon 'f' if available? Indexer stores 'f' as favicon
          favicon: item.f,
          category: item.c,
          tabId: item.tabId, // Include tabId for tab switching
          score: baseScore + matchScore
        });
      }
    }

    // Sort by combined score
    return results.sort((a, b) => b.score - a.score);

  } catch (e) {
    console.error('[SearchService] Local index search failed', e);
    return null; // Treat as missing
  }
}

// --- PROVIDER 2: Desktop App (Placeholder) ---
async function searchDesktop(query) {
  // TODO: Implement chrome.runtime.sendNativeMessage
  // For now, return empty to not block
  return [];
}


// --- MAIN API: Quick Search ---
export async function quickSearch(query, maxResults = 15, contextUrls = null) {
  if (!query || !query.trim()) return [];
  const trimmedQuery = query.trim();

  // ELECTRON/TAURI: unified search from LanceDB + local cache fallback
  if (isElectron()) {
    // Try sidecar first if available
    const sidecarUp = await isSidecarAvailable();
    let unifiedResults = [];

    if (sidecarUp) {
      unifiedResults = await searchUnifiedFromBackend(trimmedQuery, maxResults, contextUrls);
    }

    let cacheResults = [];
    // Supplement with local cache search to ensure nothing is missed
    cacheResults = searchElectronCache(trimmedQuery);

    // Refresh stale cache data for next search (non-blocking)
    if (!isCacheFresh('tabs') || !isCacheFresh('workspaces')) {
      refreshElectronCache().catch(() => { });
    }

    // Combined results and add virtual "Search Google" fallback
    const combined = [...unifiedResults, ...cacheResults];

    // Deduplicate and Sort
    const sorted = deduplicateByUrl(combined)
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    // Append virtual "Search Google" result
    // We always include this if there's a query, to give the user a clear fallback
    sorted.push({
      id: `web-search-${trimmedQuery}`,
      title: `Search Google for "${trimmedQuery}"`,
      description: 'Open in default browser',
      type: 'web_search',
      favicon: null,
      score: 10, // Lower priority than local matches, but always there
      url: `https://www.google.com/search?q=${encodeURIComponent(trimmedQuery)}`
    });

    return sorted.slice(0, maxResults);
  }

  // CHROME EXTENSION: Try Local Index FIRST
  const localResults = await searchLocalIndex(query);

  if (localResults !== null) {
    // Index Exists. Even if 0 results, we trust it.
    const dedupedResults = deduplicateByUrl(localResults);
    const typeCount = {};
    localResults.forEach(r => { typeCount[r.type] = (typeCount[r.type] || 0) + 1; });
    console.log(`[SearchService] Fast local hit: ${dedupedResults.length} results (from ${localResults.length}), types:`, typeCount);
    return dedupedResults.slice(0, maxResults);
  }

  // Index Missing -> Rebuild Trigger + Fallback
  console.log('[SearchService] Local index missing, triggering rebuild & fallback...');

  // Trigger rebuild in background (fire and forget) - Chrome only
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'REBUILD_INDEX' }).catch(() => { });
  }

  // Use Fallback while index builds
  try {
    const [tabs, history, bookmarks, workspaces] = await Promise.all([
      searchTabsFallback(query),
      searchHistoryFallback(query),
      searchBookmarksFallback(query),
      searchWorkspacesFallback(query)
    ]);

    const all = [...tabs, ...history, ...bookmarks, ...workspaces];
    // Deduplicate by URL - keep highest scored item for each URL
    const deduped = deduplicateByUrl(all);
    return deduped.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, maxResults);

  } catch (e) {
    console.warn('[SearchService] Fallback failed', e);
    return [];
  }
}

// --- Specific API wrappers (Used by other components or granular UI) ---

export async function searchTabs(query) {
  // Try local first
  const local = await searchLocalIndex(query, 'tab');
  if (local !== null) return local; // Trust index (even if empty)
  return searchTabsFallback(query); // Only if index bad
}

export async function searchHistory(query) {
  const local = await searchLocalIndex(query, 'history');
  if (local !== null) return local;
  return searchHistoryFallback(query);
}

export async function searchBookmarks(query) {
  const local = await searchLocalIndex(query, 'bookmark');
  if (local !== null) return local;
  return searchBookmarksFallback(query);
}

export async function searchWorkspaces(query) {
  // Try local first (workspace and workspace-url)
  const localWs = await searchLocalIndex(query, 'workspace');
  const localUrls = await searchLocalIndex(query, 'workspace-url');

  // If index exists (not null), rely on it.
  if (localWs !== null || localUrls !== null) {
    const ws = localWs || [];
    const urls = localUrls || [];
    return [...ws, ...urls].sort((a, b) => b.score - a.score);
  }

  // Fallback: Direct DB Access
  return searchWorkspacesFallback(query);
}


// --- FALLBACKS (Old Logic) ---
async function searchWorkspacesFallback(query) {
  // 1. Try Electron IPC (Desktop App)
  if (window.electronAPI && window.electronAPI.sendMessage) {
    try {
      const response = await window.electronAPI.sendMessage({ type: 'SEARCH_WORKSPACES', query, maxResults: 20 });
      // Always return an array - response.results may be undefined
      return Array.isArray(response?.results) ? response.results : [];
    } catch (e) {
      console.warn('IPC Search Workspaces failed', e);
      return []; // Return empty array on error in Electron mode
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      const result = await new Promise((resolve) => {
        let responded = false;
        // Short timeout for IPC
        const timeout = setTimeout(() => {
          if (!responded) { responded = true; resolve([]); }
        }, 1000);

        chrome.runtime.sendMessage({ type: 'SEARCH_WORKSPACES', query, maxResults: 20 }, (response) => {
          if (responded) return;
          responded = true;
          clearTimeout(timeout);
          if (response && Array.isArray(response.results)) {
            resolve(response.results);
          } else {
            resolve([]); // Return empty array instead of null
          }
        });
      });
      // Only return if we got results, otherwise fall through to local fallback
      if (result.length > 0) return result;
    } catch (e) {
      console.warn('IPC Search failed', e);
    }
  }

  // 2. Local Fallback (Extension/Web)
  try {
    const response = await listWorkspaces();
    let workspaces = Array.isArray(response) ? response : (response?.data || []);
    if (!Array.isArray(workspaces)) workspaces = [];
    const results = [];

    // Search Workspace Names AND internal URLs
    for (const ws of workspaces) {
      // Score the Workspace Itself
      const wsScore = Math.max(
        fuzzyScore(ws.name, query),
        fuzzyScore(ws.description || '', query)
      );

      if (wsScore > 0) {
        results.push({
          id: ws.id,
          title: ws.name,
          url: null, // Workspaces don't have a single URL
          description: ws.description || `${ws.urls ? ws.urls.length : 0} items`,
          type: 'workspace',
          icon: ws.icon || '📁',
          favicon: null,
          score: wsScore
        });
      }

      // Search URLs inside
      if (ws.urls && Array.isArray(ws.urls) && query.length > 2) {
        ws.urls.forEach(u => {
          const uTitle = u.title || new URL(u.url).hostname;
          const uScore = Math.max(
            fuzzyScore(uTitle, query),
            fuzzyScore(u.url, query)
          );

          if (uScore > 0) {
            results.push({
              id: `${ws.id}_${u.url}`,
              title: uTitle,
              url: u.url,
              description: `in ${ws.name}`,
              type: 'workspace-url',
              favicon: u.favicon || null,
              score: uScore,
              workspaceId: ws.id
            });
          }
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  } catch (e) {
    console.warn('[SearchService] Workspace fallback failed', e);
    return [];
  }
}

async function searchTabsFallback(query) {
  // Electron Mode
  if (window.electronAPI && window.electronAPI.invoke) {
    try {
      const tabs = await window.electronAPI.invoke('sync:get-tabs');
      if (!Array.isArray(tabs)) return [];

      return tabs.filter(t => {
        const q = query.toLowerCase();
        return (t.title && t.title.toLowerCase().includes(q)) ||
          (t.url && t.url.toLowerCase().includes(q));
      }).map(t => ({
        id: t.id,
        title: t.title,
        url: t.url,
        description: 'Active Tab',
        type: 'tab',
        icon: t.favIconUrl || '🔵',
        favicon: t.favIconUrl,
        score: Math.max(fuzzyScore(t.title, query), fuzzyScore(t.url, query))
      }));
    } catch (e) {
      console.warn('[SearchService] Electron tab search failed', e);
      return [];
    }
  }

  // Extension Mode
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return new Promise((resolve) => {
      let responded = false;
      // Use a wrapping promise to handle the message passing
      chrome.runtime.sendMessage({ type: 'SEARCH_TABS', query }, (response) => {
        if (responded) return;
        responded = true;
        resolve(Array.isArray(response?.results) ? response.results : []);
      });
      setTimeout(() => { if (!responded) { responded = true; resolve([]); } }, 1000);
    });
  }
  return Promise.resolve([]);
}

function searchHistoryFallback(query) {
  // Electron IPC
  if (window.electronAPI && window.electronAPI.sendMessage) {
    return window.electronAPI.sendMessage({ type: 'SEARCH_HISTORY', query, maxResults: 15 })
      .then(res => Array.isArray(res?.results) ? res.results : [])
      .catch(() => []);
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return new Promise((resolve) => {
      let responded = false;
      chrome.runtime.sendMessage({ type: 'SEARCH_HISTORY', query, maxResults: 10 }, (response) => {
        if (responded) return;
        responded = true;
        resolve(Array.isArray(response?.results) ? response.results : []);
      });
      setTimeout(() => { if (!responded) { responded = true; resolve([]); } }, 1000);
    });
  }
  return Promise.resolve([]);
}

function searchBookmarksFallback(query) {
  // Electron IPC
  if (window.electronAPI && window.electronAPI.sendMessage) {
    return window.electronAPI.sendMessage({ type: 'SEARCH_BOOKMARKS', query, maxResults: 15 })
      .then(res => Array.isArray(res?.results) ? res.results : [])
      .catch(() => []);
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return new Promise((resolve) => {
      let responded = false;
      chrome.runtime.sendMessage({ type: 'SEARCH_BOOKMARKS', query, maxResults: 10 }, (response) => {
        if (responded) return;
        responded = true;
        resolve(Array.isArray(response?.results) ? response.results : []);
      });
      setTimeout(() => { if (!responded) { responded = true; resolve([]); } }, 1000);
    });
  }
  return Promise.resolve([]);
}

// --- Helpers ---

/**
 * Deduplicate results by URL, keeping the highest scored item for each URL
 * @param {Array} results - Search results array
 * @returns {Array} Deduplicated results
 */
function deduplicateByUrl(results) {
  const urlMap = new Map();

  for (const item of results) {
    if (!item.url) {
      // Items without URL (like commands) - keep as-is using id
      const key = item.id || Math.random().toString();
      if (!urlMap.has(key)) {
        urlMap.set(key, item);
      }
      continue;
    }

    // Normalize URL for comparison (remove trailing slash, fragment)
    const normalizedUrl = normalizeUrl(item.url);

    if (!urlMap.has(normalizedUrl)) {
      urlMap.set(normalizedUrl, item);
    } else {
      // Keep the one with higher score, or prefer tabs over history
      const existing = urlMap.get(normalizedUrl);
      const shouldReplace =
        (item.score || 0) > (existing.score || 0) ||
        (item.type === 'tab' && existing.type !== 'tab');

      if (shouldReplace) {
        urlMap.set(normalizedUrl, item);
      }
    }
  }

  return Array.from(urlMap.values());
}

/**
 * Normalize URL for deduplication comparison
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Remove trailing slash, fragment, and common tracking params
    let normalized = u.origin + u.pathname.replace(/\/$/, '') + u.search;
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function getIconForType(type) {
  const icons = {
    'tab': '🔵',
    'history': '📜',
    'bookmark': '⭐',
    'workspace': '📁',
    'workspace-url': '🔗',
    'note': '📝',
    'url-note': '📌',
    'highlight': '🖍️',
    'scraped-chat': '💬',
    'command': '⚡'
  };
  return icons[type] || '🔍';
}

// --- Legacy DB Helpers (kept for reference or deep integration) ---
// Not used by default quickSearch anymore, but might be needed if direct DB access is restored.
function openDatabase() { /* ... */ }

// --- Natural Language Search (Nano AI Enhanced) ---

/**
 * Detect if a query is natural language (vs simple keyword)
 * @param {string} query - Search query
 * @returns {boolean}
 */
export function isNaturalLanguageQuery(query) {
  if (!query || query.length < 10) return false;

  // Check for question words
  const questionWords = ['what', 'where', 'how', 'when', 'why', 'which', 'find', 'show', 'get'];
  const queryLower = query.toLowerCase();
  if (questionWords.some(w => queryLower.startsWith(w + ' '))) return true;

  // Check for question mark
  if (query.includes('?')) return true;

  // Check for phrases (3+ words)
  const words = query.trim().split(/\s+/);
  if (words.length >= 3) return true;

  return false;
}

/**
 * Natural language search using Nano AI for semantic ranking
 * Falls back to quickSearch if Nano is unavailable
 * @param {string} query - Natural language query
 * @param {number} maxResults - Max results to return
 * @returns {Promise<Array>} Search results with AI ranking
 */
export async function naturalLanguageSearch(query, maxResults = 15, contextUrls = null) {
  if (!query || !query.trim()) return [];

  console.log('[SearchService] naturalLanguageSearch:', query);

  // First, get regular search results
  const baseResults = await quickSearch(query, 30, contextUrls);

  // If not a natural language query or no results, return base results
  if (!isNaturalLanguageQuery(query) || baseResults.length === 0) {
    return baseResults.slice(0, maxResults);
  }

  // Try to use Nano AI for semantic ranking
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'NANO_AI_SEARCH',
      query: query,
      items: baseResults.map(r => ({
        title: r.title || '',
        url: r.url || '',
        description: r.description || '',
        type: r.type
      })),
      limit: maxResults
    });

    if (response?.success && response.results?.length > 0) {
      console.log('[SearchService] Nano AI ranked results:', response.results.length);

      // Map back to full result objects
      return response.results.map((aiResult, idx) => {
        const original = baseResults.find(r =>
          r.title === aiResult.title && r.url === aiResult.url
        ) || baseResults[idx];

        return {
          ...original,
          ...aiResult,
          _aiRanked: true
        };
      });
    }
  } catch (e) {
    console.warn('[SearchService] Nano AI search failed, using base results:', e);
  }

  return baseResults.slice(0, maxResults);
}

export default {
  quickSearch,
  searchTabs,
  searchHistory,
  searchBookmarks,
  searchWorkspaces,
  naturalLanguageSearch,
  isNaturalLanguageQuery
};
