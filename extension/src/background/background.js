// MV3 background service worker (type: module)
import { cleanupOldTimeSeriesData, getAllActivity, getSettings, getTimeSeriesStorageStats, listAllUrls, listWorkspaces } from '../db.js';
import { buildCategoryListPrompt, buildEnrichmentPromptForWorkspace } from '../prompts.js';
import { setHostActivity, setHostUrls, setHostWorkspaces, storageGetWithTTL } from '../services/extensionApi.js';
// Modular background pieces
import './ai.js';
import './runtimeListeners.js';
import './sidepanel.js';
import './workspaces.js';

async function main() {
  console.log('[Background] Main function started');



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

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.ping === 'bg') {
      sendResponse({ pong: true, time: Date.now() })
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
          const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
          if (!geminiApiKey) {
            sendResponse({ ok: false, error: 'Add a Gemini API key in Settings.' });
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
          // For privacy and better clustering, send only the origin (scheme + host) to the model
          const origins = (() => {
            const out = [];
            const seen = new Set();
            for (const u of urls) {
              try {
                const o = new URL(u).origin;
                if (!seen.has(o)) { seen.add(o); out.push(o); }
              } catch { /* ignore invalid */ }
            }
            return out;
          })();
          const prompt = buildCategoryListPrompt(origins.length ? origins : urls, { max: 12 });
          const s = await getSettings();
          const model = (s?.modelName || 'gemini-1.5-flash').trim();
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${geminiApiKey}`;
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

          const s = await getSettings();
          const model = (s?.modelName || 'gemini-1.5-flash').trim();
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${geminiApiKey}`;
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
  })

  // Log storage readiness once
  chrome.storage.local.get(null).then(() => {
    console.log('[Background] Storage ready')
  })


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

}

main()
  .then(() => {
    console.log('[Background] Main function executed successfully');
    console.log('[Background] Service worker is ready for connections');
  })
  .catch(e => {
    console.error('[Background] Main function failed:', e);
    console.error('[Background] Stack trace:', e.stack);
  });
