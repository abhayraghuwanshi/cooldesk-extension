// Data collection and storage operations (bookmarks, history)
import { addUrlToWorkspace, getSettings, listWorkspaces, saveWorkspace } from '../db/index.js';
import { storageGetWithTTL, storageSetWithTTL } from '../services/extensionApi.js';
import GenericUrlParser from '../utils/GenericUrlParser.js';

// Global variable to track last populate time
let globalLastPopulateTime = 0;

// Collect bookmarks from Chrome API
async function collectBookmarks() {
  console.log('[AI][collect] Collecting bookmarks...')
  const tree = await chrome.bookmarks.getTree()
  const out = []
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.url) {
        out.push({
          title: n.title || new URL(n.url).hostname,
          url: n.url,
          dateAdded: n.dateAdded || Date.now(),
          tags: [],
          workspaceGroup: undefined,
          type: 'Bookmark',
        })
      }
      if (n.children) walk(n.children)
    }
  }
  walk(tree)
  console.log(`[AI][collect] Bookmarks collected: ${out.length}`)
  return out
}

// Collect history from Chrome API
async function collectHistory() {
  // Read user-configured inputs from IndexedDB settings store
  const settings = await getSettings();
  const daysNum = Number(settings?.historyDays);
  const days = Number.isFinite(daysNum) && daysNum > 0 ? daysNum : 30;
  const maxResults = 2000; // fixed cap to avoid huge payloads
  console.log(`[AI][collect] Collecting history (last ${days} days, max ${maxResults})...`, { rawDays: settings?.historyDays })
  const startTime = Date.now() - (1000 * 60 * 60 * 24 * days);
  const results = await chrome.history.search({ text: '', startTime, maxResults })
  console.log(`[AI][collect] History collected: ${results.length}`)

  return results.map((h) => ({
    title: h.title || (h.url ? new URL(h.url).hostname : 'Untitled'),
    url: h.url,
    lastVisitTime: h.lastVisitTime || Date.now(),
    visitCount: h.visitCount || 1,
    tags: [],
    workspaceGroup: undefined,
    type: 'History',
  }))
}


// Auto-populate workspaces from history data
async function autoPopulateWorkspaces(historyData) {
  if (!historyData || !historyData.length) {
    console.log('[Onboarding] ⚠️ No history data provided to auto-populate');
    return;
  }

  try {
    console.log(`[Onboarding] 🚀 Starting workspace auto-population with ${historyData.length} items...`);

    // 1. Get existing workspaces to avoid duplicates
    const wsResult = await listWorkspaces();
    const existingWorkspaces = wsResult?.success ? wsResult.data : [];
    console.log(`[Onboarding] Found ${existingWorkspaces.length} existing workspaces`);

    // 2. Extract URLs
    const historyUrls = historyData.map(h => h.url);

    // 3. Generate Workspace Suggestions
    console.log('[Onboarding] 🔍 Analyzing URLs for workspace suggestions...');
    const suggestedWorkspaces = await GenericUrlParser.createWorkspacesFromUrls(historyUrls, existingWorkspaces);

    // 4. Create Workspaces
    if (suggestedWorkspaces.length > 0) {
      console.log(`[Onboarding] ✨ Creating ${suggestedWorkspaces.length} auto-generated workspaces`);

      let createdCount = 0;
      for (const ws of suggestedWorkspaces) {
        // Determine ID
        const wsId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Construct workspace object
        const workspace = {
          id: wsId,
          name: ws.name,
          description: ws.description,
          gridType: ws.gridType || 'ProjectGrid',
          createdAt: Date.now(),
          urls: [], // We'll add URLs individually to ensure proper indexing
          context: {
            createdFrom: 'onboarding_scan',
            autoCreated: true
          }
        };

        await saveWorkspace(workspace);
        console.log(`[Onboarding] ✅ Created workspace: "${ws.name}"`);

        // Add URLs to the workspace
        if (ws.urls && ws.urls.length) {
          let addedUrls = 0;
          for (const urlData of ws.urls) {
            try {
              await addUrlToWorkspace(urlData.url, wsId, {
                title: urlData.title,
                favicon: urlData.favicon,
                addedAt: urlData.addedAt
              });
              addedUrls++;
            } catch (e) { /* ignore individual url errors */ }
          }
          console.log(`[Onboarding]    Indexed ${addedUrls} URLs in "${ws.name}"`);
        }
        createdCount++;
      }

      console.log(`[Onboarding] 🎉 Successfully created ${createdCount} workspaces`);

      // Notify UI
      const bc = new BroadcastChannel('ws_db_changes');
      bc.postMessage({ type: 'workspacesChanged', source: 'onboarding' });
      bc.close();
    } else {
      console.log('[Onboarding] ℹ️ No new workspaces suggestion from history (all covered or excluded)');
    }

  } catch (e) {
    console.error('[Onboarding] ❌ Failed to auto-populate workspaces:', e);
  }
}

// Main data population function
export async function populateAndStore() {
  // Safeguard to prevent repeated calls within a short timeframe
  const POPULATE_COOLDOWN_MS = 10000; // 10 seconds
  const now = Date.now();
  if (now - globalLastPopulateTime < POPULATE_COOLDOWN_MS) {
    console.log('[Background] Populate cooldown active in function, skipping...');
    return { ok: true, skipped: true, reason: 'cooldown' };
  }
  globalLastPopulateTime = now;

  try {
    console.time('[AI][populate] populateAndStore')
    const [bookmarks, history] = await Promise.all([collectBookmarks(), collectHistory()])
    const dashboardData = { bookmarks, history };

    // Persist in background (non-blocking) and notify UI immediately with fresh data
    storageSetWithTTL('dashboardData', dashboardData).catch(() => { /* ignore */ });

    // Send data inline so UI can render without waiting for storage write
    chrome.runtime.sendMessage({ action: 'updateData', dashboardData })

    // TRIGGER ONBOARDING WORKSPACE CREATION (Async/Non-blocking)
    // Only run if we actually found history
    if (history.length > 0) {
      autoPopulateWorkspaces(history).catch(err => {
        console.warn('[Background] Auto-populate workspaces failed (non-fatal):', err);
      });
    }

    const res = { ok: true, counts: { bookmarks: bookmarks.length, history: history.length } }
    console.log('[AI][populate] Stored counts:', res.counts)
    console.timeEnd('[AI][populate] populateAndStore')
    return res
  } catch (e) {
    console.error('[Background] Failed to populate data', e)
    return { ok: false, error: String(e) }
  }
}

// Initialize data collection
export function initializeDataCollection() {
  // Cooldown period in milliseconds to prevent repetitive calls
  const POPULATE_COOLDOWN_MS = 10000; // 10 seconds
  let lastPopulateTime = 0;

  chrome.runtime.onInstalled.addListener(async () => {
    console.log('[Background] Extension installed - populating data')
    try {
      await seedGitHubConfig();
      await populateAndStore()
    } catch (e) {
      console.error('[Background] Error during onInstalled populate:', e)
    }
  })

  chrome.runtime.onStartup?.addListener(async () => {
    console.log('[Background] Startup - ensuring data present')
    try {
      // Check cache with TTL (30 minutes)
      const { data: dashboardData, expired } = await storageGetWithTTL('dashboardData', 30 * 60 * 1000);
      if (expired || !dashboardData || (!dashboardData.bookmarks?.length && !dashboardData.history?.length)) {
        console.log('[Background] Dashboard cache expired or empty, repopulating...');
        await populateAndStore();
      }
    } catch (e) {
      console.error('[Background] Error during onStartup:', e);
    }
  })

  // Handle populate data requests
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.action === 'populateData') {
      const now = Date.now();
      if (now - lastPopulateTime < POPULATE_COOLDOWN_MS) {
        console.log('[Background] Populate cooldown active, skipping...');
        sendResponse({ ok: true, skipped: true, reason: 'cooldown' });
        return true;
      }
      lastPopulateTime = now;
      populateAndStore().then((res) => sendResponse(res))
      return true
    }
    // Return false for messages this handler doesn't process
    return false;
  });
}

// Initialize data collection
export function initializeData() {
  console.log('[Background] Initializing data handlers...');
  initializeDataCollection();
}


// Seed GitHub scraping configuration
async function seedGitHubConfig() {
  const GITHUB_HOST = 'github.com';
  try {
    const result = await chrome.storage.local.get('domainSelectors');
    const selectors = result.domainSelectors || {};

    if (!selectors[GITHUB_HOST]) {
      console.log('[Background] Seeding GitHub scraping config...');
      selectors[GITHUB_HOST] = {
        selector: "ul li a[href]",
        container: "ul",
        links: "li a[href]",
        sample: {
          title: "cooldesk-extension",
          url: "https://github.com/abhayraghuwanshi/cooldesk-extension"
        },
        excludedPatterns: [
          "/topics/*",
          "/security",
          "/features",
          "/site/terms",
          "/site/privacy",
          "/contact",
          "/about"
        ],
        excludedDomains: [
          "docs.github.com",
          "status.github.com"
        ],
        savedAt: Date.now(),
        source: 'seed'
      };
      await chrome.storage.local.set({ domainSelectors: selectors });
    }
  } catch (e) {
    console.error('[Background] Failed to seed GitHub config:', e);
  }
}

export { collectBookmarks, collectHistory, seedGitHubConfig };


