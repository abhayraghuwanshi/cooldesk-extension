// MV3 background service worker (type: module)
import { addUrlToWorkspace, cleanupOldTimeSeriesData, getAllActivity, getSettings, getTimeSeriesStorageStats, listAllUrls, listWorkspaces, putActivityRow, putActivityTimeSeriesEvent, saveWorkspace, upsertUrl } from './db.js';
import { buildCategoryListPrompt, buildEnrichmentPrompt, buildEnrichmentPromptForWorkspace } from './prompts.js';
import { getRedirectDecision, setHostActivity, setHostUrls, setHostWorkspaces, storageGetWithTTL, storageSetWithTTL } from './services/extensionApi.js';
import { getUrlParts } from './utils.js';

// Global variable to track last populate time
let globalLastPopulateTime = 0;

async function main() {
  console.log('[Background] Main function started');

  const DAYS_30 = 1000 * 60 * 60 * 24 * 30

  // Up to 5 suggestions based on current screen context and base URL
  async function getAiSuggestions(urls, apiKey) {
    const cleanedUrls = (Array.isArray(urls) ? urls : [urls]).map(cleanUrl).filter(Boolean);
    if (cleanedUrls.length === 0) return [];

    const primaryUrl = cleanedUrls[0];
    const current = currentActive?.url ? cleanUrl(currentActive.url) : null;

    const context = {
      workspace_urls: cleanedUrls,
      current_screen_url: current,
    };

    const prompt = `You are assisting a developer inside a Chrome extension. Given the context JSON below, which contains a list of URLs from the user's current workspace, propose up to 5 helpful https URLs to open next. Your suggestions should be highly relevant to the collection of URLs provided. Format strictly as JSON: { "suggestions": [ { "url": string, "label": string, "suggestion": string } ] } where label is a short name and suggestion is a one-line reason. Do not include markdown fences.\n\nCONTEXT:\n${JSON.stringify(context, null, 2)}`;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
    const controller = new AbortController()
    const timeoutMs = 12000
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const t = await resp.text().catch(() => '')
        console.warn('[AI][suggest*] Non-OK', resp.status, t?.slice?.(0, 200))
        return [{ url: primaryUrl, label: 'Home', suggestion: 'Open base site' }]
      }
      const data = await resp.json()
      clearTimeout(timeoutId)
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const rawJson = text.replace(/```json|```/g, '').trim()
      let obj = {}
      try { obj = JSON.parse(rawJson) } catch { }
      const arr = Array.isArray(obj.suggestions) ? obj.suggestions : []
      const normalized = arr
        .filter((s) => s && typeof s.url === 'string' && s.url.startsWith('http'))
        .slice(0, 5)
        .map((s) => ({ url: s.url, label: s.label || 'Suggested', suggestion: typeof s.suggestion === 'string' ? s.suggestion : null }))
      return normalized.length ? normalized : [{ url: primaryUrl, label: 'Home', suggestion: 'Open base site' }]
    } catch (e) {
      clearTimeout(timeoutId)
      const reason = e?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : (e?.message || String(e))
      console.warn('[AI][suggest*] Failed', reason)
      return [{ url: primaryUrl, label: 'Home', suggestion: 'Open base site' }]
    }
  }


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

  async function collectHistory() {
    // Read user-configured inputs from IndexedDB settings store
    const settings = await getSettings();
    let daysNum = Number(settings?.historyDays);
    let maxResultsNum = Number(settings?.historyMaxResults);
    // Fallback to chrome.storage.local if DB settings missing
    if (!Number.isFinite(daysNum) || daysNum <= 0 || !Number.isFinite(maxResultsNum) || maxResultsNum <= 0) {
      const legacy = await chrome.storage.local.get(['historyDays', 'historyMaxResults']);
      if (!Number.isFinite(daysNum) || daysNum <= 0) daysNum = Number(legacy?.historyDays);
      if (!Number.isFinite(maxResultsNum) || maxResultsNum <= 0) maxResultsNum = Number(legacy?.historyMaxResults);
      console.log('[AI][collect] Using legacy storage fallback for history params', { legacyDays: legacy?.historyDays, legacyMaxResults: legacy?.historyMaxResults });
    }
    const days = Number.isFinite(daysNum) && daysNum > 0 ? daysNum : 30;
    const maxResults = Number.isFinite(maxResultsNum) && maxResultsNum > 0 ? maxResultsNum : 500;
    console.log(`[AI][collect] Collecting history (last ${days} days, max ${maxResults})...`, { rawDays: settings?.historyDays, rawMaxResults: settings?.historyMaxResults })
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

  async function populateAndStore() {
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
      // Use TTL cache (30 minutes)
      await storageSetWithTTL('dashboardData', dashboardData);
      chrome.runtime.sendMessage({ action: 'updateData' })
      const res = { ok: true, counts: { bookmarks: bookmarks.length, history: history.length } }
      console.log('[AI][populate] Stored counts:', res.counts)
      console.timeEnd('[AI][populate] populateAndStore')
      return res
    } catch (e) {
      console.error('[Background] Failed to populate data', e)
      return { ok: false, error: String(e) }
    }
  }

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

      // Periodic cleanup of old time series data (run on startup)
      try {
        const stats = await getTimeSeriesStorageStats();
        console.log('[Background] Time series storage:', stats);

        // Auto-cleanup if data is getting large (>50MB or >30 days)
        if (stats.estimatedSizeMB > 50 || stats.spanDays > 30) {
          const deleted = await cleanupOldTimeSeriesData(30); // Keep 30 days
          console.log(`[Background] Auto-cleanup: removed ${deleted} old events`);
        }
      } catch (e) {
        console.warn('[Background] Time series cleanup failed:', e);
      }
    } catch (e) {
      console.error('[Background] Error during onStartup:', e);
    }
  })

  // Track activity from content scripts
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender.tab?.url || !msg.type) return;
    const cleaned = cleanUrl(sender.tab.url);
    if (!cleaned) return;
    if (!activityData[cleaned]) activityData[cleaned] = { time: 0, scroll: 0, clicks: 0, forms: 0 };
    if (!sessionEvents.has(cleaned)) {
      sessionEvents.set(cleaned, {
        url: cleaned,
        timeSpent: 0,
        clicks: 0,
        scrollDepth: 0,
        forms: 0,
        interactions: [],
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        hasAudio: false,
        isAudioSite: isAudioStreamingSite(cleaned)
      });
    }
    const sessionEvent = sessionEvents.get(cleaned);

    if (msg.type !== 'visibility') {
      switch (msg.type) {
        case 'scroll':
          activityData[cleaned].scroll = Math.max(activityData[cleaned].scroll || 0, msg.depth || 0);
          sessionEvent.scrollDepth = Math.max(sessionEvent.scrollDepth, msg.depth || 0);
          sessionEvent.interactions.push('scroll');
          sessionEvent.lastSeen = Date.now();
          break;
        case 'click':
          activityData[cleaned].clicks = (activityData[cleaned].clicks || 0) + 1;
          sessionEvent.clicks += 1;
          sessionEvent.interactions.push('click');
          sessionEvent.lastSeen = Date.now();
          break;
        case 'formSubmit':
          activityData[cleaned].forms = (activityData[cleaned].forms || 0) + 1;
          sessionEvent.forms += 1;
          sessionEvent.interactions.push('form');
          sessionEvent.lastSeen = Date.now();
          break;
        case 'audioDetected':
          sessionEvent.hasAudio = true;
          sessionEvent.lastSeen = Date.now();
          break;
        case 'visibility':
          if (typeof msg.visible === 'boolean' && currentActive.url === msg.url) {
            const now = Date.now();
            if (!msg.visible) {
              // Tab became hidden - stop time tracking and flush
              accumulateTime(currentActive.url, now);
              flushTimeSeriesEvents().catch(() => { });
              currentActive.since = 0;
            } else {
              // Tab became visible - resume time tracking
              currentActive.since = now;
            }
          }
          break;
      }
      // Mark for batched persistence and update persistent session
      activityDirty.add(cleaned);
      urlSessions.set(cleaned, {
        timeSpent: sessionEvent.timeSpent,
        clicks: sessionEvent.clicks,
        scrollDepth: sessionEvent.scrollDepth,
        forms: sessionEvent.forms,
        interactions: sessionEvent.interactions,
        firstSeen: sessionEvent.firstSeen,
        lastSeen: sessionEvent.lastSeen,
        hasAudio: sessionEvent.hasAudio,
        isAudioSite: sessionEvent.isAudioSite
      });
    }
    // Do not consume other handlers
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.ping === 'bg') {
      sendResponse({ pong: true, time: Date.now() })
      return true
    }
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
    if (msg?.action === 'enrichWithAI') {
      // Fire-and-forget; UI listens to aiProgress/aiComplete
      ; (async () => {
        try {
          console.time('[AI][enrich] enrichWithAI')
          console.log('[AI][enrich] Received enrichWithAI message')
          const { dashboardData, geminiApiKey, historyMaxResults } = await chrome.storage.local.get(['dashboardData', 'geminiApiKey', 'historyMaxResults'])
          const settings = await getSettings();
          if (!geminiApiKey) {
            chrome.runtime.sendMessage({ action: 'aiError', error: 'Gemini API key not set. Open Settings to add it.' })
            console.warn('[AI][enrich] Aborting: missing API key')
            return
          }
          // Do not change workspace memberships during enrichment
          // We intentionally avoid resolving/creating any target workspace here.
          const targetWorkspace = null;

          const rawHistory = dashboardData?.history || []
          const fromSettings = Number(settings?.historyMaxResults)
          const fromLocal = Number(historyMaxResults)
          const limit = Number.isFinite(fromSettings) && fromSettings > 0
            ? fromSettings
            : (Number.isFinite(fromLocal) && fromLocal > 0 ? fromLocal : rawHistory.length)
          console.log('[AI][enrich] Using historyMaxResults limit:', { fromSettings: settings?.historyMaxResults, fromLocal: historyMaxResults, chosen: limit })
          const history = rawHistory.slice(0, limit)
          // Only enrich items that are not categorized yet (empty or 'Unknown')
          const needsEnrichment = history.filter((it) => {
            const g = (it?.workspaceGroup || '').trim().toLowerCase()
            return !g || g === 'unknown'
          })
          // Dedupe: process only the first item per hostname in this run
          const buckets = new Map()
          for (const it of needsEnrichment) {
            let host = 'unknown'
            try { host = new URL(it.url).hostname || 'unknown' } catch { }
            if (!buckets.has(host)) buckets.set(host, [])
            buckets.get(host).push(it)
          }
          const diversified = []
          for (const [_, arr] of buckets) {
            if (arr.length) diversified.push(arr[0])
          }
          const total = diversified.length
          if (!total) {
            chrome.runtime.sendMessage({ action: 'aiError', error: 'No uncategorized items to enrich.' })
            console.warn('[AI][enrich] Aborting: no uncategorized items to enrich')
            return
          }

          let processed = 0
          let apiHits = 0
          const enrichedHistory = [...history]
          // Build index by URL for quick replacement
          const indexByUrl = new Map()
          for (let i = 0; i < history.length; i++) {
            const u = history[i]?.url
            if (u) indexByUrl.set(u, i)
          }
          // Emit initial progress so UI shows total count immediately
          chrome.runtime.sendMessage({ action: 'aiProgress', processed, total, currentItem: 'Starting…', apiHits })
          console.log(`[AI][enrich] Starting enrichment loop. total=${total}`)
          console.log('[AI][enrich] One-per-host dedupe:', { hosts: Array.from(buckets.keys()).length, total })
          for (const it of diversified) {
            const ai = await getAiEnrichment(it.url, geminiApiKey)
            if (ai && ai.__apiHit) apiHits += 1
            // Do not overwrite workspaceGroup in UI/history; only persist AI in urls.extra.ai
            const { __apiHit, workspaceGroup: _ignoredWG, ...aiClean } = ai || {}
            const merged = { ...it, ...aiClean, cleanUrl: cleanUrl(it.url) }
            const idx = indexByUrl.get(it.url)
            if (typeof idx === 'number') {
              enrichedHistory[idx] = merged
            }
            // Note: we no longer mutate workspace membership during enrichment.
            // AI details are persisted by getAiEnrichment() into urls.extra.ai only.
            processed += 1
            chrome.runtime.sendMessage({ action: 'aiProgress', processed, total, currentItem: it.title || it.url, apiHits })
            if (processed % 10 === 0 || processed === total) {
              console.log(`[AI][enrich] Progress: ${processed}/${total} (API hits=${apiHits})`)
            }
          }

          await chrome.storage.local.set({ dashboardData: { ...(dashboardData || {}), history: enrichedHistory } })
          console.log(`[AI][enrich] Stored enriched history: ${enrichedHistory.length} items`)
          chrome.runtime.sendMessage({ action: 'aiComplete' })
          chrome.runtime.sendMessage({ action: 'updateData' })
          console.timeEnd('[AI][enrich] enrichWithAI')
        } catch (e) {
          console.error('[Background] enrichWithAI failed', e)
          chrome.runtime.sendMessage({ action: 'aiError', error: String(e) })
          console.timeEnd('[AI][enrich] enrichWithAI')
        }
      })()
      sendResponse({ ok: true })
      return true
    }

    if (msg?.action === 'enrichWithAICategory') {
      // Category-specific enrichment: take a few recent uncategorized items and assign to the given category
      ; (async () => {
        try {
          const category = (msg.category || '').trim()
          console.time('[AI][enrich] enrichWithAICategory')
          console.log('[AI][enrich] Received enrichWithAICategory message', { category })
          if (!category || category.toLowerCase() === 'all') {
            chrome.runtime.sendMessage({ action: 'aiError', error: 'Please select a specific category (not All).' })
            console.warn('[AI][enrich] Aborting: invalid category')
            return
          }

          const { dashboardData, geminiApiKey, historyMaxResults } = await chrome.storage.local.get(['dashboardData', 'geminiApiKey', 'historyMaxResults'])
          const settings = await getSettings();
          if (!geminiApiKey) {
            chrome.runtime.sendMessage({ action: 'aiError', error: 'Gemini API key not set. Open Settings to add it.' })
            console.warn('[AI][enrich] Aborting: missing API key')
            return
          }

          const rawHistory = dashboardData?.history || []
          const fromSettings = Number(settings?.historyMaxResults)
          const fromLocal = Number(historyMaxResults)
          const limit = Number.isFinite(fromSettings) && fromSettings > 0
            ? fromSettings
            : (Number.isFinite(fromLocal) && fromLocal > 0 ? fromLocal : rawHistory.length)
          console.log('[AI][enrich][cat] Using historyMaxResults limit:', { fromSettings: settings?.historyMaxResults, fromLocal: historyMaxResults, chosen: limit })

          const history = rawHistory.slice(0, limit)
          // Only enrich items that are not categorized yet (empty or 'Unknown')
          const needsEnrichment = history.filter((it) => {
            const g = (it?.workspaceGroup || '').trim().toLowerCase()
            return !g || g === 'unknown'
          })

          // Dedupe by hostname to diversify
          const buckets = new Map()
          for (const it of needsEnrichment) {
            let host = 'unknown'
            try { host = new URL(it.url).hostname || 'unknown' } catch { }
            if (!buckets.has(host)) buckets.set(host, [])
            buckets.get(host).push(it)
          }
          const diversified = []
          for (const [_, arr] of buckets) {
            if (arr.length) diversified.push(arr[0])
          }

          const total = diversified.length
          if (!total) {
            chrome.runtime.sendMessage({ action: 'aiError', error: `No recent uncategorized items to add to "${category}".` })
            console.warn('[AI][enrich] Aborting: no items to enrich for category')
            return
          }

          let processed = 0
          let apiHits = 0
          const enrichedHistory = [...history]
          const indexByUrl = new Map()
          for (let i = 0; i < history.length; i++) {
            const u = history[i]?.url
            if (u) indexByUrl.set(u, i)
          }

          chrome.runtime.sendMessage({ action: 'aiProgress', processed, total, currentItem: 'Starting…', apiHits })
          console.log(`[AI][enrich][cat] Starting enrichment loop. total=${total}, category=${category}`)

          for (const it of diversified) {
            const normalized = cleanUrl(it.url)
            const ai = await getAiEnrichment(normalized, geminiApiKey)
            if (ai && ai.__apiHit) apiHits += 1
            const { __apiHit, workspaceGroup: _ignoredWG, ...aiRest } = ai || {}
            const merged = { ...it, ...aiRest, workspaceGroup: category, cleanUrl: normalized }
            const idx = indexByUrl.get(it.url)
            if (typeof idx === 'number') {
              enrichedHistory[idx] = merged
            }
            processed += 1
            chrome.runtime.sendMessage({ action: 'aiProgress', processed, total, currentItem: it.title || it.url, apiHits })
          }

          await chrome.storage.local.set({ dashboardData: { ...(dashboardData || {}), history: enrichedHistory } })
          console.log(`[AI][enrich][cat] Stored enriched history (category=${category}): ${enrichedHistory.length} items`)
          chrome.runtime.sendMessage({ action: 'aiComplete' })
          chrome.runtime.sendMessage({ action: 'updateData' })
          console.timeEnd('[AI][enrich] enrichWithAICategory')
        } catch (e) {
          console.error('[Background] enrichWithAICategory failed', e)
          chrome.runtime.sendMessage({ action: 'aiError', error: String(e) })
          console.timeEnd('[AI][enrich] enrichWithAICategory')
        }
      })()
      sendResponse({ ok: true })
      return true
    }
    if (msg?.action === 'getSuggestionFor') {
      ; (async () => {
        try {
          const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
          const urls = msg.urls; // Expect an array of URLs
          if (!urls || !Array.isArray(urls) || urls.length === 0) {
            sendResponse({ ok: false, error: 'Missing or invalid urls array' });
            return;
          }
          if (!geminiApiKey) {
            sendResponse({ ok: false, error: 'Missing API key' });
            return;
          }
          const list = await getAiSuggestions(urls, geminiApiKey);
          const first = list?.[0];
          const suggestedUrl = first?.url || cleanUrl(urls[0]);
          sendResponse({ ok: true, suggestedUrl, suggestion: first?.suggestion || null, suggestions: JSON.stringify({ suggestions: list || [] }) });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();

      // One-time backfill: mirror workspaces to host so Electron app sees them after host restart
      ; (async () => {
        try {
          const { workspacesMirroredOnce } = await chrome.storage.local.get(['workspacesMirroredOnce']);
          if (!workspacesMirroredOnce) {
            const all = await listWorkspaces();
            if (Array.isArray(all) && all.length) {
              try { await setHostWorkspaces(all); } catch { }
              await chrome.storage.local.set({ workspacesMirroredOnce: true });
              try { console.log('[Background] Backfilled workspaces to host:', all.length); } catch { }
            }
          }
        } catch (e) {
          try { console.warn('[Background] Workspaces backfill failed', e); } catch { }
        }
      })();

      // One-time backfill: mirror canonical URL index to host (titles, favicons, memberships)
      ; (async () => {
        try {
          const { urlsMirroredOnce } = await chrome.storage.local.get(['urlsMirroredOnce']);
          if (!urlsMirroredOnce) {
            const urls = await listAllUrls();
            if (Array.isArray(urls) && urls.length) {
              // Send in modest chunks to avoid large payloads
              const CHUNK = 100;
              for (let i = 0; i < urls.length; i += CHUNK) {
                const slice = urls.slice(i, i + CHUNK);
                try { await setHostUrls(slice); } catch { }
              }
              await chrome.storage.local.set({ urlsMirroredOnce: true });
              try { console.log('[Background] Backfilled URLs to host:', urls.length); } catch { }
            }
          }
        } catch (e) {
          try { console.warn('[Background] URLs backfill failed', e); } catch { }
        }
      })();
      return true;
    }

    if (msg?.action === 'suggestCategories') {
      ; (async () => {
        try {
          const { geminiApiKey, serverUrl } = await chrome.storage.local.get(['geminiApiKey', 'serverUrl']);
          // If a custom serverUrl is provided, use it without requiring an API key.
          // Otherwise, require a Gemini API key for the default API.
          if (!(typeof serverUrl === 'string' && serverUrl.trim()) && !geminiApiKey) {
            sendResponse({ ok: false, error: 'Provide either a Server URL or a Gemini API key in Settings.' });
            return;
          }
          const urlsRaw = Array.isArray(msg.urls) ? msg.urls.filter(Boolean).slice(0, 150) : [];
          const cleanedUrls = urlsRaw
            .map((u) => cleanUrl(u))
            .filter(Boolean);
          // Dedupe while preserving order
          const seen = new Set();
          const urls = cleanedUrls.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
          if (!urls.length) {
            sendResponse({ ok: false, error: 'No URLs provided' });
            return;
          }
          const prompt = buildCategoryListPrompt(urls, { max: 12 });
          const hasServer = (typeof serverUrl === 'string' && serverUrl.trim());
          const defaultApi = hasServer ? '' : `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
          let apiUrl = hasServer ? serverUrl.trim() : defaultApi;
          if (hasServer) {
            try {
              const u = new URL(apiUrl);
              const isGoogle = u.hostname.includes('generativelanguage.googleapis.com');
              const hasKeyParam = u.searchParams.has('key');
              if (isGoogle && !hasKeyParam) {
                if (geminiApiKey) {
                  u.searchParams.set('key', geminiApiKey);
                  apiUrl = u.toString();
                } else {
                  sendResponse({ ok: false, error: 'Google API URL provided without API key. Add a Gemini API key in Settings or use a proxy server URL.' });
                  return;
                }
              }
            } catch { /* ignore URL parse errors and use raw apiUrl */ }
          }
          const controller = new AbortController();
          const timeoutMs = 20000;
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const resp = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
              signal: controller.signal,
            });
            if (!resp.ok) {
              const t = await resp.text().catch(() => '');
              clearTimeout(timeoutId);
              sendResponse({ ok: false, error: `API error ${resp.status}`, details: t?.slice?.(0, 200) || '' });
              return;
            }
            const data = await resp.json();
            clearTimeout(timeoutId);
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const rawJson = text.replace(/```json|```/g, '').trim();
            let obj = {};
            try { obj = JSON.parse(rawJson); } catch { }
            let categories = [];
            if (Array.isArray(obj?.categories)) {
              categories = obj.categories
                .map((c) => {
                  if (typeof c === 'string' && c.trim()) return { name: c.trim(), description: '' };
                  const name = typeof c?.name === 'string' ? c.name.trim() : '';
                  const description = typeof c?.description === 'string' ? c.description.trim() : '';
                  return name ? { name, description } : null;
                })
                .filter(Boolean)
                .slice(0, 20);
            }
            sendResponse({ ok: true, categories });
          } catch (e) {
            clearTimeout(timeoutId);
            const reason = e?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : (e?.message || String(e));
            sendResponse({ ok: false, error: reason });
          }
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }

    if (msg?.action === 'categorizeWorkspaceUrls') {
      ; (async () => {
        try {
          const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
          if (!geminiApiKey) {
            sendResponse({ ok: false, error: 'Missing API key' });
            return;
          }
          const workspace = typeof msg.workspace === 'string' && msg.workspace ? msg.workspace : 'Workspace';
          const urls = Array.isArray(msg.urls) ? msg.urls.filter(Boolean).slice(0, 100) : [];
          if (!urls.length) {
            sendResponse({ ok: false, error: 'No URLs provided' });
            return;
          }
          const override = typeof msg.systemPrompt === 'string' && msg.systemPrompt.trim() ? msg.systemPrompt : null;
          // Always include the URL list in the prompt body so the model has concrete inputs
          const basePrompt = override || buildEnrichmentPromptForWorkspace(workspace, urls);
          const prompt = `${basePrompt}\n\nInput URLs:\n${urls.join('\n')}`;

          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
          const controller = new AbortController();
          const timeoutMs = 15000;
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const resp = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
              signal: controller.signal,
            });
            if (!resp.ok) {
              const t = await resp.text().catch(() => '');
              clearTimeout(timeoutId);
              sendResponse({ ok: false, error: `API error ${resp.status}`, details: t?.slice?.(0, 200) || '' });
              return;
            }
            const data = await resp.json();
            clearTimeout(timeoutId);
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const rawJson = text.replace(/```json|```/g, '').trim();
            let arr = [];
            try { arr = JSON.parse(rawJson); } catch { }
            const results = (Array.isArray(arr) ? arr : []).map((it) => {
              const u = typeof it?.url === 'string' ? it.url : null;
              const included = typeof it?.included === 'boolean' ? it.included : false;
              return u ? { url: u, included } : null;
            }).filter(Boolean);
            sendResponse({ ok: true, results });
          } catch (e) {
            clearTimeout(timeoutId);
            const reason = e?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : (e?.message || String(e));
            sendResponse({ ok: false, error: reason });
          }
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }

    if (msg?.action === 'getActivityData') {
      (async () => {
        try {
          // Allow overriding cutoff via chrome.storage.local: activityDays (number)
          const { activityDays } = await chrome.storage.local.get(['activityDays']);
          const days = Number.isFinite(Number(activityDays)) && Number(activityDays) > 0 ? Number(activityDays) : 90;
          const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

          const rows = await getAllActivity();

          // Filter to recent activity; if updatedAt is missing (older records), keep them only if we have non-zero time
          const recent = (Array.isArray(rows) ? rows : [])
            .filter(r => {
              const ua = Number(r?.updatedAt);
              if (Number.isFinite(ua)) return ua >= cutoffMs;
              return (Number(r?.time) || 0) > 0; // legacy fallback
            })
            // Sort by time descending to keep most relevant first
            .sort((a, b) => (Number(b?.time) || 0) - (Number(a?.time) || 0));

          sendResponse({ ok: true, rows: recent });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }

    if (msg?.action === 'getTimeSeriesStats') {
      (async () => {
        try {
          const stats = await getTimeSeriesStorageStats();
          sendResponse({ ok: true, stats });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }

    if (msg?.action === 'cleanupTimeSeriesData') {
      (async () => {
        try {
          const retentionDays = typeof msg.retentionDays === 'number' ? msg.retentionDays : 30;
          const deleted = await cleanupOldTimeSeriesData(retentionDays);
          sendResponse({ ok: true, deleted });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
  })

  // Log storage readiness once
  chrome.storage.local.get(null).then(() => {
    console.log('[Background] Storage ready')
  })

  // ---- Active tab time tracking (for context-aware prompts) ----
  let currentActive = { tabId: null, url: null, since: 0 }
  let activityData = {}; // { [cleanedUrl]: { time, scroll, clicks, forms } }
  const activityDirty = new Set();
  const MAX_ACTIVITY_POST = 50; // limit rows per flush

  // Session tracking for time series
  let currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let sessionStartTime = Date.now();
  let sessionEvents = new Map(); // Track events per URL in current session
  let urlSessions = new Map(); // Track ongoing sessions per URL to avoid duplicates
  let urlSessionIds = new Map(); // Track consistent session IDs per URL

  async function flushActivityBatch() {
    if (activityDirty.size === 0) return;
    const urls = Array.from(activityDirty);
    activityDirty.clear();
    const batch = [];
    for (const url of urls) {
      try {
        const payload = { url, time: activityData[url]?.time || 0, updatedAt: Date.now(), ...activityData[url] };
        await putActivityRow(payload);
        batch.push({ url: payload.url, time: payload.time || 0, scroll: Number(payload.scroll) || 0, clicks: Number(payload.clicks) || 0, forms: Number(payload.forms) || 0, updatedAt: payload.updatedAt });
      } catch (e) {
        // If write fails, keep it dirty for next round
        activityDirty.add(url);
      }
    }
    // Fire-and-forget POST to Electron host (safe no-op if unavailable)
    if (batch.length) {
      // sort by time desc and cap to top 50
      const top = batch
        .slice()
        .sort((a, b) => (Number(b.time || 0) - Number(a.time || 0)))
        .slice(0, MAX_ACTIVITY_POST);
      try { await setHostActivity(top); } catch { /* ignore */ }
    }
  }

  // Flush time series events to database
  async function flushTimeSeriesEvents() {
    if (sessionEvents.size === 0) return;

    const events = Array.from(sessionEvents.values());
    sessionEvents.clear();

    for (const event of events) {
      if (event.timeSpent > 0 || event.clicks > 0 || event.forms > 0 || event.scrollDepth > 0) {
        // Use consistent session ID for this URL
        const baseSessionId = urlSessionIds.get(event.url) || currentSessionId;
        // Create unique event ID with random suffix to prevent duplicates
        const uniqueEventId = `${baseSessionId}_${event.lastSeen}_${Math.random().toString(36).substr(2, 6)}`;

        const timeSeriesEvent = {
          id: uniqueEventId,
          url: event.url,
          timestamp: event.lastSeen,
          sessionId: baseSessionId,
          metrics: {
            timeSpent: event.timeSpent,
            clicks: event.clicks,
            scrollDepth: event.scrollDepth,
            forms: event.forms,
            interactions: [...new Set(event.interactions)] // Dedupe interactions
          },
          context: {
            tabId: currentActive.tabId,
            sessionStart: event.firstSeen,
            duration: event.lastSeen - event.firstSeen,
            continued: event.sessionContinued || false
          }
        };

        try {
          await putActivityTimeSeriesEvent(timeSeriesEvent);
        } catch (e) {
          console.warn('[TimeSeries] Failed to store event:', e);
        }
      }
    }
  }

  // Periodic flush every 5s
  setInterval(() => {
    flushActivityBatch().catch(() => { });
    flushTimeSeriesEvents().catch(() => { });
  }, 5000);

  // Daily cleanup of old time series data (every 24 hours)
  setInterval(async () => {
    try {
      const stats = await getTimeSeriesStorageStats();
      if (stats.estimatedSizeMB > 25) { // Cleanup if >25MB
        const deleted = await cleanupOldTimeSeriesData(30);
        console.log(`[Background] Daily cleanup: removed ${deleted} old events, size: ${stats.estimatedSizeMB}MB`);
      }
    } catch (e) {
      console.warn('[Background] Daily cleanup failed:', e);
    }
  }, 24 * 60 * 60 * 1000); // 24 hours

  // One-time backfill: mirror existing local activity to host so Electron can display historical data
  (async () => {
    try {
      const { activityMirroredOnce } = await chrome.storage.local.get(['activityMirroredOnce']);
      if (activityMirroredOnce) return;
      const rows = await getAllActivity();
      const list = (Array.isArray(rows) ? rows : [])
        .map(r => ({
          url: String(r?.url || ''),
          time: Number(r?.time) || 0,
          scroll: Number(r?.scroll) || 0,
          clicks: Number(r?.clicks) || 0,
          forms: Number(r?.forms) || 0,
          updatedAt: Number(r?.updatedAt) || Date.now(),
        }))
        .filter(r => r.url)
        .sort((a, b) => (b.time || 0) - (a.time || 0));
      if (!list.length) return;
      // Send in chunks of MAX_ACTIVITY_POST
      for (let i = 0; i < list.length; i += MAX_ACTIVITY_POST) {
        const chunk = list.slice(i, i + MAX_ACTIVITY_POST);
        try { await setHostActivity(chunk); } catch { /* ignore per-chunk */ }
      }
      await chrome.storage.local.set({ activityMirroredOnce: true });
      console.log(`[Background] Backfilled ${list.length} activity rows to host`);
    } catch (e) {
      console.warn('[Background] Activity backfill skipped/failed', e);
    }
  })();

  function cleanUrl(url) {
    try {
      const parts = getUrlParts(url);
      return parts?.key || null; // scheme + eTLD+1
    } catch {
      return null;
    }
  }

  // Helper to identify audio streaming sites
  function isAudioStreamingSite(url) {
    const audioSites = [
      'spotify.com', 'music.youtube.com', 'soundcloud.com', 'pandora.com',
      'apple.com/music', 'tidal.com', 'deezer.com', 'bandcamp.com',
      'last.fm', 'mixcloud.com', 'tunein.com'
    ];
    return audioSites.some(site => url.includes(site));
  }

  async function accumulateTime(url, now = Date.now()) {
    if (!url || !currentActive.since) return;
    const cleaned = cleanUrl(url);
    if (!cleaned) return;

    const delta = Math.max(0, now - currentActive.since);
    if (!activityData[cleaned]) activityData[cleaned] = { time: 0, scroll: 0, clicks: 0, forms: 0 };

    // Smart time tracking logic
    const isCurrentlyActive = currentActive.url === url;
    const sessionEvent = sessionEvents.get(cleaned);
    const isAudioSite = isAudioStreamingSite(cleaned);
    const hasAudioActivity = sessionEvent?.hasAudio || false;

    // Track time if:
    // 1. Currently active tab (visual engagement)
    // 2. Audio site with detected audio activity (background music)
    const shouldTrackTime = isCurrentlyActive || (isAudioSite && hasAudioActivity);

    if (shouldTrackTime) {
      // For background audio, apply reduced weight (30% of full time)
      const timeWeight = isCurrentlyActive ? 1.0 : 0.3;
      const weightedDelta = Math.floor(delta * timeWeight);

      activityData[cleaned].time = (activityData[cleaned].time || 0) + weightedDelta;
      activityDirty.add(cleaned);
    } else {
      // Not tracking time for this URL
      return;
    }

    // Track time series event - continue existing session if within 5 minutes
    const SESSION_CONTINUITY_MS = 5 * 60 * 1000; // 5 minutes
    const existingSession = urlSessions.get(cleaned);

    if (!sessionEvents.has(cleaned)) {
      // Check if we should continue an existing session or start new one
      const shouldContinue = existingSession && (now - existingSession.lastSeen) < SESSION_CONTINUITY_MS;

      // Get or create consistent session ID for this URL
      if (!urlSessionIds.has(cleaned) || !shouldContinue) {
        urlSessionIds.set(cleaned, `url_${cleaned.replace(/[^a-zA-Z0-9]/g, '_')}_${now}`);
      }

      sessionEvents.set(cleaned, {
        url: cleaned,
        timeSpent: shouldContinue ? existingSession.timeSpent : 0,
        clicks: shouldContinue ? existingSession.clicks : 0,
        scrollDepth: shouldContinue ? existingSession.scrollDepth : 0,
        forms: shouldContinue ? existingSession.forms : 0,
        interactions: shouldContinue ? [...existingSession.interactions] : [],
        firstSeen: shouldContinue ? existingSession.firstSeen : now,
        lastSeen: now,
        sessionContinued: shouldContinue,
        hasAudio: shouldContinue ? existingSession.hasAudio : false,
        isAudioSite: isAudioSite
      });
    }

    if (!sessionEvent) return;

    // Apply time weight for session tracking too
    const timeWeight = isCurrentlyActive ? 1.0 : 0.3;
    const weightedDelta = Math.floor(delta * timeWeight);

    sessionEvent.timeSpent += weightedDelta;
    sessionEvent.lastSeen = now;

    // Update persistent session tracking
    urlSessions.set(cleaned, {
      timeSpent: sessionEvent.timeSpent,
      clicks: sessionEvent.clicks,
      scrollDepth: sessionEvent.scrollDepth,
      forms: sessionEvent.forms,
      interactions: sessionEvent.interactions,
      firstSeen: sessionEvent.firstSeen,
      lastSeen: now,
      hasAudio: sessionEvent.hasAudio,
      isAudioSite: sessionEvent.isAudioSite
    });
  }

  async function handleActivated(tabId) {
    const now = Date.now()
    // Flush time for previously active tab
    if (currentActive.tabId && currentActive.url) {
      accumulateTime(currentActive.url, now)
      // Flush session events for background tab
      flushTimeSeriesEvents().catch(() => { });
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      currentActive = { tabId, url: tab?.url || null, since: now }
    } catch {
      currentActive = { tabId, url: null, since: now }
    }
  }

  function handleFocusChanged(windowId) {
    const now = Date.now()
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      // Window lost focus - stop time tracking
      if (currentActive.url) {
        accumulateTime(currentActive.url, now)
        flushTimeSeriesEvents().catch(() => { });
      }
      currentActive.since = 0
    } else {
      // Window gained focus - resume time tracking
      if (currentActive.tabId && currentActive.url) currentActive.since = now
    }
  }

  function handleTabUpdated(tabId, changeInfo, tab) {
    if (tabId !== currentActive.tabId) return

    const now = Date.now()

    if (changeInfo.status === 'loading' && currentActive.url) {
      // Page is loading - flush current session
      accumulateTime(currentActive.url, now)
      flushTimeSeriesEvents().catch(() => { });
      currentActive.since = now
    }

    if (changeInfo.url) {
      // URL changed - flush old URL session and start new
      if (currentActive.url && currentActive.url !== changeInfo.url) {
        accumulateTime(currentActive.url, now)
        flushTimeSeriesEvents().catch(() => { });
      }
      currentActive.url = changeInfo.url
      currentActive.since = now
    }
  }

  chrome.tabs.onActivated.addListener((activeInfo) => handleActivated(activeInfo.tabId))
  chrome.windows.onFocusChanged.addListener(handleFocusChanged)
  chrome.tabs.onUpdated.addListener(handleTabUpdated)

  // ---- Global redirect integration with Electron host ----
  const redirectInFlight = new Set(); // guard per-tab to avoid loops
  function isHttpUrl(u) {
    try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; }
  }

  async function maybeRedirect(tabId, rawUrl) {
    if (!tabId || !rawUrl || redirectInFlight.has(tabId)) return;
    if (!isHttpUrl(rawUrl)) return;
    // Do not try to redirect our own extension pages
    if (rawUrl.startsWith(chrome.runtime.getURL(''))) return;
    try {
      redirectInFlight.add(tabId);
      const decision = await getRedirectDecision(rawUrl);
      const target = decision?.ok && typeof decision?.target === 'string' && decision.target ? decision.target : null;
      if (target && target !== rawUrl) {
        // Navigate without activating to keep it passive
        try { await chrome.tabs.update(tabId, { url: target, active: false }); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    finally {
      // Slight delay to prevent immediate re-trigger in onUpdated
      setTimeout(() => redirectInFlight.delete(tabId), 300);
    }
  }

  // Redirect when a new tab is created with a URL (or pendingUrl)
  chrome.tabs.onCreated.addListener((tab) => {
    const url = tab?.pendingUrl || tab?.url;
    if (url) maybeRedirect(tab.id, url);
  });

  // Redirect on updates when a navigational URL appears
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo?.url || tab?.pendingUrl || tab?.url;
    if (url) maybeRedirect(tabId, url);
  });

  // Pause/resume time counting based on OS idle state
  chrome.idle.onStateChanged.addListener((state) => {
    const now = Date.now();
    if (state === 'idle' || state === 'locked') {
      if (currentActive.url) accumulateTime(currentActive.url, now);
      currentActive.since = 0;
      flushActivityBatch().catch(() => { });
      flushTimeSeriesEvents().catch(() => { });
      // Clear URL sessions on idle (natural session break)
      urlSessions.clear();
      urlSessionIds.clear();
      // Start new session when returning from idle
      currentSessionId = `session_${now}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStartTime = now;
    } else if (state === 'active') {
      if (currentActive.tabId && currentActive.url) currentActive.since = now;
      flushActivityBatch().catch(() => { });
    }
  })

  // (Legacy devlink-ai migration code removed after successful migration)



  async function getAiEnrichment(url, apiKey) {
    const cleaned = cleanUrl(url)
    if (!cleaned) return { summary: 'Invalid URL', category: { name: 'Error', icon: '❌' }, tags: [] }
    // Skip legacy enrichment cache; rely on urls.extra.ai
    console.debug(`[AI] Enrichment: calling Gemini API for ${cleaned}`)
    const ms = activityData[cleaned]?.time || 0
    const minutesSpent = Math.round(ms / 60000)
    // Build workspace list and descriptions to guide classification
    let opts = {};
    // 1) Prefer user Settings categories (name + description)
    try {
      const settings = await getSettings();
      const cats = Array.isArray(settings?.categories) ? settings.categories : [];
      const catRows = cats
        .map((c) => (typeof c === 'string' ? { name: String(c).trim(), description: '' } : (c || {})))
        .filter((r) => r && typeof r.name === 'string' && r.name.trim());
      if (catRows.length) {
        const names = catRows.map((r) => r.name.trim());
        const descMap = catRows.reduce((acc, r) => { acc[r.name.trim()] = String(r.description || '').trim(); return acc; }, {});
        opts.workspaceList = names;
        opts.workspaceDescriptions = descMap;
        try { console.debug('[AI][enrich] Using Settings categories', { count: names.length }); } catch { }
      }
    } catch { /* ignore */ }
    // 2) Else, fall back to chrome.storage.local mirror (if present)
    if (!opts.workspaceList) {
      try {
        const { categories } = await chrome.storage.local.get(['categories']);
        const catRows = Array.isArray(categories) ? categories.map((c) => (typeof c === 'string' ? { name: String(c).trim(), description: '' } : (c || {}))) : [];
        const rows = catRows.filter((r) => r && typeof r.name === 'string' && r.name.trim());
        if (rows.length) {
          const names = rows.map((r) => r.name.trim());
          const descMap = rows.reduce((acc, r) => { acc[r.name.trim()] = String(r.description || '').trim(); return acc; }, {});
          opts.workspaceList = names;
          opts.workspaceDescriptions = descMap;
          try { console.debug('[AI][enrich] Using storage.local categories', { count: names.length }); } catch { }
        }
      } catch { /* ignore */ }
    }
    // 3) Else, fall back to DB workspaces
    if (!opts.workspaceList) {
      try {
        const ws = await listWorkspaces();
        const names = (Array.isArray(ws) ? ws : []).map(w => String(w?.name || '').trim()).filter(Boolean);
        const descMap = (Array.isArray(ws) ? ws : []).reduce((acc, w) => {
          const n = String(w?.name || '').trim();
          if (n) acc[n] = String(w?.description || '').trim();
          return acc;
        }, {});
        if (names.length) {
          opts.workspaceList = names;
          opts.workspaceDescriptions = descMap;
          try { console.debug('[AI][enrich] Using DB workspaces', { count: names.length }); } catch { }
        }
      } catch { /* ignore */ }
    }
    // 4) If still nothing, buildEnrichmentPrompt will fall back to defaults
    // Build a privacy-safe URL for the prompt: strip query/hash and redact ID-like path segments
    function maskUrlSensitiveParts(raw) {
      try {
        const u = new URL(raw);
        u.search = '';
        u.hash = '';
        const redact = (seg) => {
          const s = (seg || '').trim();
          if (!s) return s;
          if (/^[0-9a-fA-F-]{24,}$/.test(s)) return '{id}'; // hex/uuid-like
          if (/^[0-9]{9,}$/.test(s)) return '{n}'; // long numeric IDs
          if (s.length > 32) return '{id}'; // overly long tokens
          if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s)) return '{email}';
          if (/^(token|session|auth|key|apikey)$/i.test(s)) return '{redacted}';
          return s;
        };
        const parts = u.pathname.split('/').map(redact);
        u.pathname = parts.join('/');
        return u.toString();
      } catch {
        return cleaned; // fallback to cleaned origin/path
      }
    }
    const maskedForPrompt = maskUrlSensitiveParts(url);
    const prompt = buildEnrichmentPrompt(minutesSpent, maskedForPrompt, opts)
      ; try { console.debug('[AI][enrich] Prompt workspace list size', { size: Array.isArray(opts.workspaceList) ? opts.workspaceList.length : 0 }); } catch { }
    ;
    const { serverUrl } = await chrome.storage.local.get(['serverUrl']);
    const defaultApi = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
    let apiUrl = (typeof serverUrl === 'string' && serverUrl.trim()) ? serverUrl.trim() : defaultApi
    if (typeof serverUrl === 'string' && serverUrl.trim()) {
      try {
        const u = new URL(apiUrl)
        const isGoogle = u.hostname.includes('generativelanguage.googleapis.com')
        const hasKey = u.searchParams.has('key')
        if (isGoogle && !hasKey) {
          if (apiKey) {
            u.searchParams.set('key', apiKey)
            apiUrl = u.toString()
          } else {
            console.warn('[AI] Google API URL provided without API key in getAiEnrichment')
            return { summary: 'API key required for Google endpoint', category: { name: 'Error', icon: '❌' }, tags: [] }
          }
        }
      } catch { /* ignore URL parse errors */ }
    }
    console.time(`[AI][api] ${cleaned}`)
    const timeoutMs = 15000
    const maxRetries = 2
    let lastError = null
    let data = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        if (resp.ok) {
          data = await resp.json()
          break
        }
        // Retry on 429 and 5xx
        if (resp.status === 429 || (resp.status >= 500 && resp.status <= 599)) {
          const delay = 500 * Math.pow(2, attempt) // 500ms, 1000ms, 2000ms
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        // Non-retryable
        const t = await resp.text().catch(() => '')
        console.warn(`[AI][api] Non-OK ${resp.status} for ${cleaned}`, t?.slice?.(0, 200) || '')
        console.timeEnd(`[AI][api] ${cleaned}`)
        return { summary: `API error ${resp.status}`, category: { name: 'Error', icon: '❌' }, tags: [] }
      } catch (e) {
        clearTimeout(timeoutId)
        lastError = e
        // If aborted due to timeout, allow retry with backoff
        if (e?.name === 'AbortError' && attempt < maxRetries) {
          const delay = 500 * Math.pow(2, attempt)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        break
      }
    }
    if (!data) {
      console.timeEnd(`[AI][api] ${cleaned}`)
      const reason = lastError?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : (lastError?.message || 'Rate limited / server error')
      return { summary: `API error: ${reason}`, category: { name: 'Error', icon: '❌' }, tags: [] }
    }
    console.timeEnd(`[AI][api] ${cleaned}`)
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const rawJson = text.replace(/```json|```/g, '').trim()
    let aiData = {}
    try { aiData = JSON.parse(rawJson) } catch { }

    const workspaceGroup = Array.isArray(aiData.workspace_group) ? aiData.workspace_group.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
    const adapted = {
      summary: typeof aiData.justification === 'string' && aiData.justification ? aiData.justification : 'No summary available.',
      workspaceGroup,
      timestamp: Date.now(),
    }

    // Upsert enrichment into canonical URLs store as extra.ai (no workspace coupling)
    try {
      await upsertUrl({ url: cleaned, extra: { ai: adapted } })
    } catch (e) {
      console.warn('[Background] upsertUrl(extra.ai) failed', e)
    }
    // Persist workspace membership based on AI response: create workspaces if missing and add URL
    try {
      if (Array.isArray(workspaceGroup) && workspaceGroup.length) {
        const norm = (s) => (s || '').trim().toLowerCase();
        const existing = await listWorkspaces();
        const byName = new Map();
        for (const w of (Array.isArray(existing) ? existing : [])) {
          if (w && typeof w.name === 'string') byName.set(norm(w.name), w);
        }
        for (const name of workspaceGroup) {
          const key = norm(name);
          if (!key) continue;
          let ws = byName.get(key) || null;
          if (!ws) {
            ws = { id: Date.now().toString(), name, description: '', createdAt: Date.now(), urls: [], context: {} };
            try { await saveWorkspace(ws); } catch (e) { console.warn('[AI][enrich] saveWorkspace failed', e); }
            byName.set(key, ws);
          }
          try { await addUrlToWorkspace(cleaned, ws.id, { addedAt: Date.now() }); } catch (e) { console.warn('[AI][enrich] addUrlToWorkspace failed', e); }
        }
      }
    } catch (e) {
      console.warn('[AI][enrich] Persisting AI workspace membership failed', e);
    }
    console.debug(`[AI] Enrichment saved to urls.extra.ai for ${cleaned}`)
    return { ...adapted, __apiHit: true }
  }

  // Open popup UI as a full tab by default when clicking the icon
  const APP_URL = chrome.runtime.getURL('index.html')

  async function openOrFocusApp() {
    try {
      // Prefer opening the Side Panel (tray) on the current active tab
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
        if (activeTab && chrome?.sidePanel?.open) {
          await chrome.sidePanel.setOptions({ tabId: activeTab.id, path: 'index.html', enabled: true })
          await chrome.sidePanel.open({ tabId: activeTab.id })
          return
        }
      } catch { /* fall through to tab/window fallback */ }

      const tabs = await chrome.tabs.query({ url: APP_URL })
      if (tabs && tabs.length > 0) {
        const t = tabs[0]
        await chrome.tabs.update(t.id, { active: true })
        await chrome.windows.update(t.windowId, { focused: true })
      } else {
        await chrome.tabs.create({ url: APP_URL })
      }
    } catch (e) {
      console.warn('[Background] Failed to open/focus app tab, falling back to options page', e)
      try { chrome.runtime.openOptionsPage() } catch { }
    }
  }

  chrome.action.onClicked.addListener(async (tab) => {
    // Open sidebar instead of popup/tab
    try {
      await chrome.sidePanel.open({ tabId: tab.id })
    } catch (error) {
      console.log('Sidebar not supported, falling back to tab:', error)
      openOrFocusApp()
    }
  })

  // Enable sidebar for all tabs
  chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (!tab.url) return
    try {
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'index.html',
        enabled: true
      })
    } catch (error) {
      // Sidebar not supported in this context
    }
  })

  // ---- Host bridge: consume queued actions from Electron API ----
  async function openOrFocusUrlInChrome(url) {
    try {
      if (!url) return;
      const target = new URL(url).href;
      const all = await chrome.tabs.query({});
      const match = all.find(t => {
        try { return t.url && new URL(t.url).href === target; } catch { return false; }
      }) || null;
      if (match) {
        // Activate the existing tab and focus its window so the user sees it
        try { await chrome.tabs.update(match.id, { active: true }); } catch { }
        if (typeof match.windowId === 'number') {
          try { await chrome.windows.update(match.windowId, { focused: true }); } catch { }
        }
        return;
      }
      // Create a new active tab and focus the window
      const created = await chrome.tabs.create({ url, active: true });
      if (created && typeof created.windowId === 'number') {
        try { await chrome.windows.update(created.windowId, { focused: true }); } catch { }
      }
    } catch (e) {
      console.warn('[Bridge] openOrFocusUrlInChrome failed:', e);
    }
  }

  // Poller (used only when WS is disconnected)
  let hostPollTimer = null;
  const HOST_POLL_INTERVAL_MS = 500;
  // Cooldown to avoid hammering when backend is down
  let hostCooldownUntil = 0; // epoch ms
  async function pollOnceForAction() {
    // Respect cooldown window
    if (Date.now() < hostCooldownUntil) return;
    try {
      const res = await fetch('http://127.0.0.1:4000/actions/next');
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const action = data?.action;
      if (action && action.type === 'open' && action.url) {
        // Show the app tray first, then navigate/open the target tab
        try { await openOrFocusApp(); } catch { }
        await openOrFocusUrlInChrome(action.url);
      }
    } catch (e) {
      // If backend is unreachable, enter cooldown and stop polling temporarily
      hostCooldownUntil = Date.now() + 30000; // 30s cooldown
      try { ensureHostPolling(false); } catch { }
    }
  }
  function ensureHostPolling(active) {
    if (active) {
      if (Date.now() < hostCooldownUntil) return; // don't start during cooldown
      if (!hostPollTimer) hostPollTimer = setInterval(() => { pollOnceForAction().catch(() => { }) }, HOST_POLL_INTERVAL_MS);
    } else {
      if (hostPollTimer) { clearInterval(hostPollTimer); hostPollTimer = null; }
    }
  }

  // Start polling bridge
  // WebSocket-based bridge (event-driven) with auto-reconnect
  let hostWs = null;
  let hostWsConnected = false;
  let hostWsReconnectTimer = null;
  let hostWsReconnectDelay = 1500; // starts at 1.5s, doubles up to max
  const HOST_WS_RECONNECT_MAX = 60000; // 60s

  async function drainQueuedActionsOnConnect(maxLoops = 10) {
    // Drain any queued actions that were enqueued while WS was disconnected
    for (let i = 0; i < maxLoops; i++) {
      const before = performance.now();
      await pollOnceForAction();
      // Small break to avoid hammering server
      const elapsed = performance.now() - before;
      if (elapsed < 10) await new Promise(r => setTimeout(r, 10));
      // Heuristic: if no more actions, server returns null; pollOnceForAction will no-op. We break when two quick iterations did nothing.
    }
  }

  function startHostActionWS() {
    try {
      if (hostWs && (hostWs.readyState === WebSocket.OPEN || hostWs.readyState === WebSocket.CONNECTING)) return;
      // Skip attempting WS during cooldown
      if (Date.now() < hostCooldownUntil) return;
      hostWs = new WebSocket('ws://127.0.0.1:4000');
      hostWs.onopen = () => {
        hostWsConnected = true;
        if (hostWsReconnectTimer) { clearTimeout(hostWsReconnectTimer); hostWsReconnectTimer = null; }
        // Reset backoff on successful connect
        hostWsReconnectDelay = 1500;
        hostCooldownUntil = 0;
        // Stop HTTP polling when WS is healthy
        ensureHostPolling(false);
        // Drain any actions queued while offline
        drainQueuedActionsOnConnect().catch(() => { });
      };
      hostWs.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg && msg.type === 'action') {
            const a = msg.payload || {};
            const t = a.type || null;
            if (t === 'open') {
              const url = (a.payload && a.payload.url) || a.url || null;
              if (url) {
                // Show the app tray first, then navigate/open the target tab
                try { await openOrFocusApp(); } catch { }
                await openOrFocusUrlInChrome(url);
              }
            }
          }
        } catch { /* ignore malformed frames */ }
      };
      const scheduleReconnect = () => {
        hostWsConnected = false;
        if (hostWsReconnectTimer) return; // already scheduled
        // Backoff and also set a cooldown to pause polling during retry window
        const delay = Math.min(hostWsReconnectDelay, HOST_WS_RECONNECT_MAX);
        hostCooldownUntil = Date.now() + delay;
        hostWsReconnectTimer = setTimeout(() => {
          hostWsReconnectTimer = null;
          startHostActionWS();
        }, delay);
        // Exponential backoff for next attempt
        hostWsReconnectDelay = Math.min(hostWsReconnectDelay * 2, HOST_WS_RECONNECT_MAX);
        // While disconnected, keep a lightweight HTTP poller running to avoid missed opens
        ensureHostPolling(true);
      };
      hostWs.onclose = scheduleReconnect;
      hostWs.onerror = scheduleReconnect;
    } catch {
      // If construction fails, retry later
      if (!hostWsReconnectTimer) {
        const delay = Math.min(hostWsReconnectDelay, HOST_WS_RECONNECT_MAX);
        hostCooldownUntil = Date.now() + delay;
        hostWsReconnectTimer = setTimeout(() => {
          hostWsReconnectTimer = null;
          startHostActionWS();
        }, delay);
        hostWsReconnectDelay = Math.min(hostWsReconnectDelay * 2, HOST_WS_RECONNECT_MAX);
      }
    }
  }

  // Prefer WS events; leave HTTP polling available as a fallback for debugging
  startHostActionWS();

  // Separate lightweight AI suggestion API (keeps enrichment unchanged)
  async function getAiSuggestion(url, apiKey) {
    const cleaned = cleanUrl(url)
    if (!cleaned) return { suggestedUrl: null, suggestion: null }
    const prompt = `You are assisting a developer. Given a base URL, propose a single https URL on the same site that would be the most helpful next page (e.g., docs, dashboard, search, relevant deep link). Return strictly JSON with fields: { "suggested_url": string, "suggestion": string }.\n\nURL: ${cleaned}`
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
    const controller = new AbortController()
    const timeoutMs = 12000
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const t = await resp.text().catch(() => '')
        console.warn('[AI][suggest] Non-OK', resp.status, t?.slice?.(0, 200))
        return { suggestedUrl: cleaned, suggestion: null }
      }
      const data = await resp.json()
      clearTimeout(timeoutId)
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const rawJson = text.replace(/```json|```/g, '').trim()
      let obj = {}
      try { obj = JSON.parse(rawJson) } catch { }
      const suggestedUrl = typeof obj.suggested_url === 'string' && obj.suggested_url.startsWith('http') ? obj.suggested_url : cleaned
      const suggestion = typeof obj.suggestion === 'string' ? obj.suggestion : null
      return { suggestedUrl, suggestion, __apiHit: true }
    } catch (e) {
      clearTimeout(timeoutId)
      const reason = e?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : (e?.message || String(e))
      console.warn('[AI][suggest] Failed', reason)
      return { suggestedUrl: cleaned, suggestion: null }
    }
  }

}

console.log('[Background] Starting background script initialization...');

main()
  .then(() => {
    console.log('[Background] Main function executed successfully');
    console.log('[Background] Service worker is ready for connections');
  })
  .catch(e => {
    console.error('[Background] Main function failed:', e);
    console.error('[Background] Stack trace:', e.stack);
  });
