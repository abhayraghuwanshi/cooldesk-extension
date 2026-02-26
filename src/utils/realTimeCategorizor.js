/**
 * Real-time URL categorization on tab changes
 * Optimized with in-memory caching, debouncing, and idle-time processing
 */

import { needsReclassification } from '../data/appstoreVersion.js';
import categoryManager from '../data/categories.js';
import { addUrlToWorkspace, getUrlRecord, listWorkspaces, saveWorkspace, upsertUrl } from '../db/index.js';
import { NanoAIService } from '../services/nanoAIService.js';
import GenericUrlParser from './GenericUrlParser.js';
import { getBaseDomainFromUrl } from './helpers.js';
import { isUrlQualified, normalizeUrlForCategory } from './urlQualification.js';

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

// Nano AI classification queue (for uncategorized URLs)
const nanoClassificationQueue = new Map();
let nanoInitialized = false;

// URLs/patterns that should NOT be classified or saved
const SKIP_URL_PATTERNS = [
  // Search engines and results
  /^https?:\/\/(www\.)?google\.[a-z.]+\/search/i,
  /^https?:\/\/(www\.)?bing\.com\/search/i,
  /^https?:\/\/(www\.)?duckduckgo\.com\/\?/i,
  /^https?:\/\/search\.yahoo\.com/i,
  /^https?:\/\/(www\.)?baidu\.com\/s/i,
  // Browser internal pages
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^about:/i,
  /^edge:\/\//i,
  /^brave:\/\//i,
  // Auth and login flows (temporary)
  /\/oauth/i,
  /\/auth\//i,
  /\/login/i,
  /\/signin/i,
  /\/callback/i,
  /accounts\.google\.com/i,
  // Empty or data URLs
  /^data:/i,
  /^javascript:/i,
  /^blob:/i,
  // Error pages
  /\/404/i,
  /\/error/i,
  // Tracking/analytics
  /doubleclick\.net/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  // Local development
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\.0\.0\.1/i,
  /^https?:\/\/0\.0\.0\.0/i,
  // Cloudflare challenge pages
  /__cf_chl/i,
  /\/cdn-cgi\//i,
  // URL shorteners (redirect, not real content)
  /^https?:\/\/(t\.co|bit\.ly|goo\.gl|tinyurl\.com|ow\.ly|is\.gd|buff\.ly)\//i,
  // Auth success/callback pages
  /\/auth-success/i,
  /\/auth\/callback/i,
  /\/sso\//i,
  // Bare search engine homepages (no meaningful path)
  /^https?:\/\/(www\.)?(google|bing)\.[a-z.]+\/?$/i,
  /^https?:\/\/(www\.)?(google|bing)\.[a-z.]+\/\?[^/]*$/i,
  // Session/token/state URLs
  /[?&](state|code|token|nonce|session)=/i,
  // Rewards/loyalty pages
  /rewards\.bing\.com/i,
  /rewards\.microsoft\.com/i
];

/**
 * Check if a URL should be skipped (not classified/saved)
 * @param {string} url - URL to check
 * @returns {boolean} True if URL should be skipped
 */
function shouldSkipUrl(url) {
  if (!url) return true;

  // Check against skip patterns
  for (const pattern of SKIP_URL_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }

  // Skip URLs with too many query parameters (likely tracking/temp)
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;
    if (params.toString().length > 500) {
      return true; // Very long query string = probably tracking
    }
    // Skip if URL has common tracking params
    if (params.has('utm_source') || params.has('fbclid') || params.has('gclid')) {
      // Don't skip entirely, but don't save these - just classify
      // Actually, let's be lenient and just skip tracking-heavy URLs
    }
  } catch {
    return true; // Invalid URL
  }

  return false;
}

/**
 * Check if a URL should be classified with Nano AI
 * @param {string} url - URL to check
 * @returns {Promise<boolean>}
 */
async function shouldClassifyWithNano(url) {
  try {
    // First check if URL should be skipped entirely
    if (shouldSkipUrl(url)) {
      return false;
    }

    // Check if Nano is available
    if (!nanoInitialized) {
      const status = await NanoAIService.init();
      nanoInitialized = true;
      if (!status.available) {
        return false;
      }
    }

    if (!NanoAIService.isAvailable()) {
      return false;
    }

    // Check if URL already has a Nano classification
    const urlRecord = await getUrlRecord(url);
    if (urlRecord?.extra?.ai?.source === 'nano') {
      // Check if it needs reclassification due to dictionary update
      return needsReclassification(urlRecord);
    }

    return true; // Not classified yet, should use Nano
  } catch (e) {
    console.warn('[RealTime] Error checking Nano eligibility:', e);
    return false;
  }
}

/**
 * Queue a URL for Nano AI classification
 * @param {string} url - URL to classify
 * @param {string} title - Page title
 */
function queueNanoClassification(url, title) {
  // Double-check: don't queue URLs that should be skipped
  if (shouldSkipUrl(url)) {
    console.debug(`[RealTime] Skipping Nano classification for filtered URL: ${url.slice(0, 50)}...`);
    return;
  }

  nanoClassificationQueue.set(url, { title, timestamp: Date.now() });

  // Process queue with debounce
  setTimeout(async () => {
    if (!nanoClassificationQueue.has(url)) return;

    const data = nanoClassificationQueue.get(url);
    nanoClassificationQueue.delete(url);

    try {
      // Get workspace names for context
      const workspaces = await listWorkspaces();
      const workspaceNames = (workspaces?.data || workspaces || [])
        .map(ws => ws.name)
        .filter(Boolean);

      // Classify with Nano
      const result = await NanoAIService.classifyUrl(url, {
        workspaces: workspaceNames,
        title: data.title
      });

      if (result && result.category && result.category !== 'other') {
        console.log(`[RealTime] 🤖 Nano classified "${url}" as "${result.category}"`);

        // Store the classification in URL record
        await upsertUrl({
          url,
          extra: {
            ai: {
              nanoCategory: result.category,
              isNew: result.isNew,
              confidence: result.confidence,
              source: 'nano',
              version: result.version,
              classifiedAt: Date.now()
            }
          }
        });

        // If category matches an existing workspace, add the URL
        if (!result.isNew && workspaceNames.includes(result.category)) {
          const ws = (workspaces?.data || workspaces || []).find(
            w => w.name.toLowerCase() === result.category.toLowerCase()
          );
          if (ws) {
            await addUrlToWorkspace(url, ws.id, {
              title: data.title || url,
              addedAt: Date.now()
            });
            console.log(`[RealTime] ➕ Added Nano-classified URL to workspace: ${result.category}`);
          }
        }
      }
    } catch (e) {
      console.error('[RealTime] Nano classification failed:', e);
    }
  }, 2000); // 2s delay for Nano classification
}

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

      // 2. Platform-Specific URL Check (Skip all platform-specific URLs - let scrapper handle them)
      // This includes: GitHub, Figma, Notion, ChatGPT, Claude, Gemini, Perplexity, etc.
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();

        // Skip if GenericUrlParser has a specific config for this domain
        // These are handled by the scrapper, not real-time categorization
        if (!GenericUrlParser.shouldUseGenericCategorization(url)) {
          // console.log(`[RealTime] Skipping platform-specific URL for scrapper: ${hostname}`);
          return;
        }
      } catch { return; }

      // Also skip common development and productivity platforms not in GenericUrlParser config
      const skipDomains = [
        'github.com', 'gitlab.com', 'bitbucket.org',  // Code hosting
        'figma.com', 'canva.com', 'miro.com',         // Design tools
        'notion.so', 'coda.io', 'airtable.com',      // Productivity
        'slack.com', 'discord.com', 'teams.microsoft.com', // Communication
        'trello.com', 'asana.com', 'linear.app', 'jira.atlassian.com', // Project management
        'vercel.com', 'netlify.com', 'heroku.com',   // Deployment
        'stackoverflow.com', 'reddit.com',           // Q&A / Forums
      ];
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        if (skipDomains.some(d => hostname === d || hostname.endsWith('.' + d))) {
          // console.log(`[RealTime] Skipping known platform for scrapper: ${hostname}`);
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

      // 4b. If uncategorized, try Nano AI classification
      if (!parsed && category === 'uncategorized') {
        // Check if we should use Nano AI
        const shouldUseNano = await shouldClassifyWithNano(url);
        if (shouldUseNano) {
          // Queue for Nano classification (async, non-blocking)
          queueNanoClassification(url, enhancedTitle);
        }
        // Still skip for now - Nano result will be used on next visit
        return;
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

        // Normalize URL for category-based workspaces (strip paths/queries)
        const isCategoryBased = category !== 'uncategorized';
        const normalizedUrl = normalizeUrlForCategory(urlToStore, isCategoryBased);

        // Check if URL is qualified based on activity data
        const qualified = await isUrlQualified(normalizedUrl, category);
        if (!qualified) {
          // console.log(`[RealTime] ⏳ URL not yet qualified: ${normalizedUrl} (category: ${category})`);
          return; // Activity tracking continues, will re-check on next visit
        }

        // Domain-level dedup: check if this base domain already exists
        const baseDomain = getBaseDomainFromUrl(normalizedUrl);
        try {
          const { getWorkspace } = await import('../db/index.js');
          const ws = await getWorkspace(existingId);
          if (ws?.urls?.some(u => {
            try { return getBaseDomainFromUrl(u.url) === baseDomain; }
            catch { return false; }
          })) {
            // Domain already tracked in this workspace, skip
            return;
          }
        } catch (e) {
          // If workspace lookup fails, proceed with adding
          console.warn('[RealTime] Dedup check failed, proceeding:', e);
        }

        console.log(`[RealTime] ➕ Adding qualified URL to existing workspace: "${workspaceName}" (${existingId})`);

        await addUrlToWorkspace(normalizedUrl, existingId, {
          title: enhancedTitle || parsed.title || new URL(normalizedUrl).hostname,
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

      // 6. Create New Workspace - only if URL is qualified
      // Normalize URL for category-based workspaces
      const isCategoryBased = category !== 'uncategorized';
      const normalizedUrl = normalizeUrlForCategory(urlToStore, isCategoryBased);

      // Check qualification before creating workspace
      const qualified = await isUrlQualified(normalizedUrl, category);
      if (!qualified) {
        // console.log(`[RealTime] ⏳ Skipping workspace creation - URL not qualified: ${normalizedUrl}`);
        return;
      }

      console.log(`[RealTime] 🆕 Creating new workspace: "${workspaceName}" from ${normalizedUrl}`);

      const newId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cacheWorkspace(workspaceName, newId); // Update cache immediately

      const workspace = {
        id: newId,
        name: parsed.workspace,
        description: `${parsed.platform.name} workspace`,
        createdAt: Date.now(),
        urls: [{
          url: normalizedUrl,
          title: enhancedTitle || parsed.title || new URL(normalizedUrl).hostname,
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
      await addUrlToWorkspace(normalizedUrl, workspace.id, {
        title: enhancedTitle || parsed.title || 'Untitled',
        favicon: parsed.favicon,
        addedAt: Date.now()
      });

      console.log(`[RealTime] Workspace actions completed for "${workspaceName}"`);

      // Broadcast change
      try {
        const bc = new BroadcastChannel('ws_db_changes');
        bc.postMessage({ type: 'workspacesChanged', realTime: true });
        bc.close();
      } catch (e) { }

    } catch (error) {
      console.error('[RealTime] Error processing URL:', error);
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

    console.log('[RealTime] Setup listeners complete. Waiting for tab events...');

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
