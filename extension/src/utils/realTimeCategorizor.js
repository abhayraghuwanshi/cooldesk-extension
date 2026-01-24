/**
 * Real-time URL categorization on tab changes
 * Optimized with in-memory caching, debouncing, and idle-time processing
 */

import categoryManager from '../data/categories.js';
import { addUrlToWorkspace, listWorkspaces, saveWorkspace } from '../db/index.js';
import GenericUrlParser from './GenericUrlParser.js';

// --- State Management ---
// Cache of known workspace domains/IDs to avoid DB lookups
// Cache of known workspace domains/IDs to avoid DB lookups
const workspaceCache = new Map();
let workspaceCacheInitialized = false;

// Cache of URLs categorized in this session to prevent re-processing
const sessionUrlCache = new Set();
const MAX_SESSION_CACHE = 500;

// Debouncing and Queue
let debounceTimer = null;
const DEBOUNCE_DELAY = 1500; // 1.5s wait after navigation stops
const processingQueue = new Map(); // url -> {title, tabId, timestamp}

/**
 * Initialize the workspace cache from DB
 */
async function initializeWorkspaceCache() {
  if (workspaceCacheInitialized) return;
  try {
    const res = await listWorkspaces();
    if (res && res.success && Array.isArray(res.data)) {
      res.data.forEach(ws => {
        // Cache by name (lowercase) -> ID
        if (ws.name && ws.id) workspaceCache.set(ws.name.toLowerCase(), ws.id);
      });
      workspaceCacheInitialized = true;
      console.log(`[RealTime] Workspace cache initialized with ${workspaceCache.size} items`);
    }
  } catch (e) {
    console.warn('[RealTime] Failed to initialize workspace cache:', e);
  }
}

/**
 * Add a workspace to cache manually (e.g. after creation)
 * @param {string} name 
 * @param {string} id
 */
function cacheWorkspace(name, id) {
  if (name && id) workspaceCache.set(name.toLowerCase(), id);
}

/**
 * Set up real-time URL categorization
 */
function getBrowserAPI() {
  if (typeof chrome !== 'undefined' && chrome?.tabs) return chrome;
  if (typeof browser !== 'undefined' && browser?.tabs) return browser;
  if (typeof msBrowser !== 'undefined' && msBrowser?.tabs) return msBrowser;
  return null;
}

export function setupRealTimeCategorizor() {
  const browserAPI = getBrowserAPI();
  if (!browserAPI) {
    console.log('Real-time categorization requires WebExtension context');
    return null;
  }

  let isSetup = false;

  // Initialize cache on startup
  console.log('[RealTime] 🚀 Initializing Real-Time Categorizor...');
  initializeWorkspaceCache();


  // Listen for external workspace updates to keep cache loose-sync
  try {
    const bc = new BroadcastChannel('ws_db_changes');
    bc.onmessage = (ev) => {
      if (ev.data?.type === 'workspacesChanged' && !ev.data.realTime) {
        // If changed by someone else, re-init cache
        workspaceCacheInitialized = false;
        initializeWorkspaceCache();
      }
    };
  } catch (e) { /* ignore */ }


  /**
   * Core processing logic - executed after debounce
   */
  const processUrl = async (url, title, tabId) => {
    if (!url || GenericUrlParser.shouldExclude(url)) return;

    // 1. Session Cache Check
    if (sessionUrlCache.has(url)) {
      // console.log('[RealTime] Skipping cached URL:', url);
      return;
    }

    try {
      // Add to session cache immediately to prevent double-processing
      sessionUrlCache.add(url);
      if (sessionUrlCache.size > MAX_SESSION_CACHE) {
        const it = sessionUrlCache.values();
        sessionUrlCache.delete(it.next().value);
      }

      // 2. Chat Platform Check (Skip auto-creation for known chat apps, let specific parsers handle if needed)
      const chatDomains = ['chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        if (chatDomains.some(d => hostname.endsWith(d))) {
          // console.log(`[RealTime] Skipping auto-workspace for chat: ${hostname}`);
          return;
        }
      } catch { return; }

      // 3. AI/History Enrichment
      let enhancedTitle = title;
      // Only enrich if we really need it (e.g. title is generic)
      if (!title || GenericUrlParser.isGenericTitle(title)) {
        const enriched = await GenericUrlParser.enrichWithHistory(url, title, browserAPI);
        enhancedTitle = enriched.title;
      }

      // 4. Categorization & Parsing
      const category = categoryManager.categorizeUrl(url);
      let parsed = GenericUrlParser.parse(url, enhancedTitle);


      // Fallback to Category-based workspace
      if (!parsed && category !== 'uncategorized') {
        const categoryDisplayName = category.charAt(0).toUpperCase() + category.slice(1);

        // Icon mapping
        const categoryIcons = {
          ai: '🤖',
          finance: '💰',
          shopping: '🛍️',
          education: '🎓',
          entertainment: '🎬',
          travel: '✈️',
          social: '💬',
          utilities: '🛠️',
          creativity: '🎨',
          food: '🍔',
          health: '🏥',
          information: '📰',
          productivity: '⚡'
        };

        parsed = {
          url,
          platform: {
            id: category,
            name: categoryDisplayName,
            icon: categoryIcons[category] || '🌐',
            color: '#6c757d',
            domain: new URL(url).hostname
          },
          workspace: categoryDisplayName,
          title: enhancedTitle || new URL(url).hostname,
          details: { type: 'website', category },
          favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`,
          timestamp: Date.now()
        };
      }

      if (!parsed) {
        // console.debug(`[RealTime] ⏭️ Skipped: No parser or category for ${url}`);
        return;
      }

      // 5. Workspace Existence Check (Fast In-Memory)
      // Ensure cache is ready
      if (!workspaceCacheInitialized) await initializeWorkspaceCache();

      const workspaceName = parsed.workspace;
      const workspaceKey = workspaceName.toLowerCase();

      // For category-based workspaces, normalize URL to base domain
      let urlToStore = url;
      if (category !== 'uncategorized') {
        try {
          const urlObj = new URL(url);
          // Strip www. subdomain to treat www.imdb.com and imdb.com as same
          let hostname = urlObj.hostname;
          if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
          }
          urlToStore = `${urlObj.protocol}//${hostname}`;
        } catch (e) {
          urlToStore = url;
        }
      }

      if (workspaceCache.has(workspaceKey)) {
        const existingId = workspaceCache.get(workspaceKey);
        console.log(`[RealTime] ➕ Adding to existing workspace: "${workspaceName}" (${existingId})`);

        await addUrlToWorkspace(urlToStore, existingId, {
          title: enhancedTitle || parsed.title || new URL(urlToStore).hostname,
          favicon: parsed.favicon,
          addedAt: Date.now()
        });

        // Broadcast change
        try {
          const bc = new BroadcastChannel('ws_db_changes');
          bc.postMessage({ type: 'workspacesChanged', realTime: true });
          bc.close();
        } catch (e) { }

        return;
      }

      // 6. Create New Workspace
      console.log(`[RealTime] 🆕 Creating new workspace: "${workspaceName}" from ${urlToStore}`);

      const newId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cacheWorkspace(workspaceName, newId); // Update cache immediately

      const workspace = {
        id: newId,
        name: parsed.workspace,
        description: `${parsed.platform.name} workspace`,
        createdAt: Date.now(),
        urls: [{
          url: urlToStore,
          title: enhancedTitle || parsed.title || new URL(urlToStore).hostname,
          addedAt: Date.now(),
          favicon: parsed.favicon
        }],
        context: {
          platform: parsed.platform,
          details: parsed.details,
          category: category,
          createdFrom: 'real_time',
          autoCreated: true
        }
      };

      await saveWorkspace(workspace);
      await addUrlToWorkspace(url, workspace.id, {
        title: enhancedTitle || parsed.title || 'Untitled',
        favicon: parsed.favicon,
        addedAt: Date.now()
      });

      console.log(`[RealTime] ✅ Workspace actions completed for "${workspaceName}"`);

      // Broadcast change
      try {
        const bc = new BroadcastChannel('ws_db_changes');
        bc.postMessage({ type: 'workspacesChanged', realTime: true });
        bc.close();
      } catch (e) { }

    } catch (error) {
      console.error('[RealTime] ❌ Error processing URL:', error);
    }
  };

  /**
   * Queue a URL for processing
   */
  const queueUrl = (url, title, tabId) => {
    // Dedup in queue
    processingQueue.set(url, { title, tabId, timestamp: Date.now() });

    // Debounce execution
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // Process queue
      const batch = Array.from(processingQueue.entries());
      processingQueue.clear();

      // Process serially (or could be parallel, but serial is safer for DB)
      (async () => {
        for (const [qUrl, data] of batch) {
          await processUrl(qUrl, data.title, data.tabId);
        }
      })();

    }, DEBOUNCE_DELAY);
  };

  const setupListeners = () => {
    if (isSetup) return;
    isSetup = true;

    // Listen to tab updates - FILTERED strict
    browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      // Only trigger if URL changed explicitly or status complete.
      // Ignore 'loading' status if URL didn't change.
      if (changeInfo.url) {
        queueUrl(changeInfo.url, tab.title || '', tabId);
      } else if (changeInfo.status === 'complete' && tab.url) {
        queueUrl(tab.url, tab.title || '', tabId);
      }
    });

    // On Activated (Tab Switch)
    browserAPI.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const tab = await browserAPI.tabs.get(activeInfo.tabId);
        if (tab?.url) queueUrl(tab.url, tab.title || '', activeInfo.tabId);
      } catch (e) { }
    });

    console.log('[RealTime] ✅ Setup listeners complete. Waiting for tab events...');

  };

  return {
    enable: setupListeners,
    categorizeNow: queueUrl, // Use queue even for manual calls to respect debounce
    isSetup: () => isSetup
  };
}

/**
 * Categorize current active tab immediately
 */
export async function categorizeCurrentTab() {
  const browserAPI = getBrowserAPI();
  if (!browserAPI) return false;

  try {
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && !GenericUrlParser.shouldExclude(tab.url)) {
      const categorizer = setupRealTimeCategorizor();
      if (categorizer) categorizer.categorizeNow(tab.url, tab.title, tab.id);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to categorize current tab:', error);
    return false;
  }
}

// Auto-setup
const browserAPI = getBrowserAPI();
if (browserAPI) {
  const categorizer = setupRealTimeCategorizor();
  setTimeout(() => {
    try { categorizer?.enable(); } catch (e) { }
  }, 1000); // slight delay to let background start up
}

// Export for console/debugging
try {
  if (typeof window !== 'undefined') {
    window.realTimeCategorizor = {
      setup: setupRealTimeCategorizor,
      categorizeNow: categorizeCurrentTab,
      cacheStats: () => ({ workspaces: workspaceCache.size, sessionUrls: sessionUrlCache.size })
    };
  }
} catch (e) { }
