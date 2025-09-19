// Data collection and storage operations (bookmarks, history)
import { getSettings } from '../db/index.js';
import { storageGetWithTTL, storageSetWithTTL } from '../services/extensionApi.js';

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
  const maxResults = 1000; // fixed cap to avoid huge payloads
  console.log(`[AI][collect] Collecting history (last ${days} days, max ${maxResults})...`, { rawDays: settings?.historyDays })
  const startTime = Date.now() - (1000 * 60 * 60 * 24 * days);
  const results = await chrome.history.search({ text: '', startTime, maxResults })
  console.log(`[AI][collect] History collected: ${results.length}`)

  // Debug: Check for ChatGPT URLs in collected history
  const chatgptUrls = results.filter(h =>
    h.url && (h.url.includes('chatgpt.com') || h.url.includes('chat.openai.com'))
  );
  console.log(`[AI][collect] ChatGPT URLs found in history: ${chatgptUrls.length}`);
  if (chatgptUrls.length > 0) {
    console.log('[AI][collect] Sample ChatGPT URLs:', chatgptUrls.slice(0, 3).map(u => ({
      url: u.url,
      title: u.title
    })));
  }

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
    // Use TTL cache (30 minutes). Fire-and-forget to avoid blocking UI.
    storageSetWithTTL('dashboardData', dashboardData).catch(() => { /* ignore */ });
    // Send data inline so UI can render without waiting for storage write
    chrome.runtime.sendMessage({ action: 'updateData', dashboardData })
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

export { collectBookmarks, collectHistory };
