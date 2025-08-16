// MV3 background service worker (type: module)
import { getSettings } from './db.js';
import { buildEnrichmentPrompt, buildEnrichmentPromptForWorkspace } from './prompts.js';
import { getRedirectDecision } from './services/extensionApi.js';

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
    const ms = timeSpent[primaryUrl] || 0;
    const minutesSpent = Math.round(ms / 60000);
    const current = currentActive?.url ? cleanUrl(currentActive.url) : null;

    const context = {
      workspace_urls: cleanedUrls,
      current_screen_url: current,
      minutes_spent_on_primary_url: minutesSpent,
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
      await chrome.storage.local.set({ dashboardData: { bookmarks, history } })
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
      const { dashboardData } = await chrome.storage.local.get(['dashboardData'])
      if (!dashboardData || (!dashboardData.bookmarks?.length && !dashboardData.history?.length)) {
        await populateAndStore()
      }
    } catch (e) {
      console.error('[Background] Error during onStartup:', e)
    }
  })

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Interaction messages from content script
    if (msg && msg.url && msg.type) {
      const cleaned = cleanUrl(msg.url);
      if (cleaned) {
        if (!activityData[cleaned]) activityData[cleaned] = { time: timeSpent[cleaned] || 0, scroll: 0, clicks: 0, forms: 0 };
        switch (msg.type) {
          case 'scroll':
            activityData[cleaned].scroll = Math.max(activityData[cleaned].scroll || 0, Number(msg.scrollPercent) || 0);
            break;
          case 'click':
            activityData[cleaned].clicks = (activityData[cleaned].clicks || 0) + 1;
            break;
          case 'formSubmit':
            activityData[cleaned].forms = (activityData[cleaned].forms || 0) + 1;
            break;
          case 'visibility':
            if (typeof msg.visible === 'boolean' && currentActive.url === msg.url) {
              if (!msg.visible) {
                accumulateTime(currentActive.url, Date.now());
                currentActive.since = 0;
              } else {
                currentActive.since = Date.now();
              }
            }
            break;
        }
        // Mark for batched persistence
        activityDirty.add(cleaned);
      }
      // Do not consume other handlers
    }
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
          const rawHistory = dashboardData?.history || []
          const fromSettings = Number(settings?.historyMaxResults)
          const fromLocal = Number(historyMaxResults)
          const limit = Number.isFinite(fromSettings) && fromSettings > 0
            ? fromSettings
            : (Number.isFinite(fromLocal) && fromLocal > 0 ? fromLocal : rawHistory.length)
          console.log('[AI][enrich] Using historyMaxResults limit:', { fromSettings: settings?.historyMaxResults, fromLocal: historyMaxResults, chosen: limit })
          const history = rawHistory.slice(0, limit)
          const total = history.length
          if (!total) {
            chrome.runtime.sendMessage({ action: 'aiError', error: 'No History items to enrich. Try Refresh Data first.' })
            console.warn('[AI][enrich] Aborting: no history items to enrich')
            return
          }

          let processed = 0
          let apiHits = 0
          const enrichedHistory = []
          // Emit initial progress so UI shows total count immediately
          chrome.runtime.sendMessage({ action: 'aiProgress', processed, total, currentItem: 'Starting…', apiHits })
          console.log(`[AI][enrich] Starting enrichment loop. total=${total}`)
          for (const it of history) {
            const ai = await getAiEnrichment(it.url, geminiApiKey)
            if (ai && ai.__apiHit) apiHits += 1
            const { __apiHit, ...aiClean } = ai || {}
            enrichedHistory.push({ ...it, ...aiClean, cleanUrl: cleanUrl(it.url) })
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
      return true;
    }

    if (msg?.action === 'categorizeWorkspaceUrls') {
      ;(async () => {
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
            try { arr = JSON.parse(rawJson); } catch {}
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

    if (msg?.action === 'getTimeSpent') {
      sendResponse({ ok: true, timeSpent });
      return true;
    }
    if (msg?.action === 'getActivityData') {
      (async () => {
        try {
          const db = await openAiDb();
          const tx = db.transaction('activity', 'readonly');
          const store = tx.objectStore('activity');
          const rows = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
          });
          sendResponse({ ok: true, rows });
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
  let timeSpent = {};
  let activityData = {}; // { [cleanedUrl]: { time, scroll, clicks, forms } }
  const activityDirty = new Set();

  async function flushActivityBatch() {
    if (activityDirty.size === 0) return;
    const urls = Array.from(activityDirty);
    activityDirty.clear();
    for (const url of urls) {
      try {
        const payload = { url, time: timeSpent[url] || 0, ...activityData[url] };
        await putActivityToDb(payload);
      } catch (e) {
        // If write fails, keep it dirty for next round
        activityDirty.add(url);
      }
    }
  }

  // Periodic flush every 5s
  setInterval(() => { flushActivityBatch().catch(() => {}) }, 5000);
  (async () => {
    const db = await openAiDb();
    const tx = db.transaction('timeTracking', 'readonly');
    const store = tx.objectStore('timeTracking');
    const allRecords = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    timeSpent = allRecords.reduce((acc, record) => {
      acc[record.url] = record.time;
      return acc;
    }, {});
    console.log('[Background] Time tracking data loaded from IndexedDB');
  })();

  function cleanUrl(url) {
    try {
      const u = new URL(url)
      // Reduce to scheme + eTLD+1 like https://example.com
      const parts = u.hostname.split('.')
      const domain = parts.length >= 2 ? parts.slice(-2).join('.') : u.hostname
      return `${u.protocol}//${domain}`
    } catch {
      return null
    }
  }

  async function accumulateTime(url, now = Date.now()) {
    if (!url || !currentActive.since) return;
    const cleaned = cleanUrl(url);
    if (!cleaned) return;
    const delta = Math.max(0, now - currentActive.since);
    const newTime = (timeSpent[cleaned] || 0) + delta;
    timeSpent[cleaned] = newTime;
    await putTimeToDb({ url: cleaned, time: newTime });
    // Mirror into activity aggregation and mark dirty
    if (!activityData[cleaned]) activityData[cleaned] = { time: newTime, scroll: 0, clicks: 0, forms: 0 };
    else activityData[cleaned].time = newTime;
    activityDirty.add(cleaned);
  }

  async function handleActivated(tabId) {
    const now = Date.now()
    if (currentActive.tabId && currentActive.url) accumulateTime(currentActive.url, now)
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
      if (currentActive.url) accumulateTime(currentActive.url, now)
      currentActive.since = 0
    } else {
      if (currentActive.tabId && currentActive.url) currentActive.since = now
    }
  }

  function handleTabUpdated(tabId, changeInfo, tab) {
    if (tabId !== currentActive.tabId) return
    if (changeInfo.status === 'loading' && currentActive.url) {
      accumulateTime(currentActive.url, Date.now())
      currentActive.since = Date.now()
    }
    if (changeInfo.url) {
      currentActive.url = changeInfo.url
      if (!currentActive.since) currentActive.since = Date.now()
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
      flushActivityBatch().catch(() => {});
    } else if (state === 'active') {
      if (currentActive.tabId && currentActive.url) currentActive.since = now;
      flushActivityBatch().catch(() => {});
    }
  })

  // ---- IndexedDB persistent cache for AI enrichment ----
  function openAiDb() {
    return new Promise((resolve, reject) => {
      // Bump version to 2 to ensure new stores (e.g., 'activity') are created for existing users
      const request = indexedDB.open('devlink-ai', 2)
      request.onupgradeneeded = (event) => {
        const db = event.target.result
        if (!db.objectStoreNames.contains('enrichments')) {
          const store = db.createObjectStore('enrichments', { keyPath: 'url' })
          store.createIndex('timestamp', 'timestamp')
        }
        if (!db.objectStoreNames.contains('timeTracking')) {
          db.createObjectStore('timeTracking', { keyPath: 'url' })
        }
        if (!db.objectStoreNames.contains('activity')) {
          db.createObjectStore('activity', { keyPath: 'url' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async function getEnrichmentFromDb(cleanedUrl) {
    const db = await openAiDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('enrichments', 'readonly')
      const store = tx.objectStore('enrichments')
      const req = store.get(cleanedUrl)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  }

  async function putEnrichmentToDb(record) {
    const db = await openAiDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('enrichments', 'readwrite')
      const store = tx.objectStore('enrichments')
      const req = store.put(record)
      req.onsuccess = () => resolve(true)
      req.onerror = () => reject(req.error)
    })
  }

  async function getTimeFromDb(url) {
    const db = await openAiDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('timeTracking', 'readonly');
      const store = tx.objectStore('timeTracking');
      const req = store.get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function putTimeToDb(record) {
    const db = await openAiDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('timeTracking', 'readwrite');
      const store = tx.objectStore('timeTracking');
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function putActivityToDb(record) {
    const db = await openAiDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('activity', 'readwrite');
      const store = tx.objectStore('activity');
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  const ENRICHMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

  async function getAiEnrichment(url, apiKey) {
    const cleaned = cleanUrl(url)
    if (!cleaned) return { summary: 'Invalid URL', category: { name: 'Error', icon: '❌' }, tags: [] }

    try {
      const cached = await getEnrichmentFromDb(cleaned)
      if (cached && Date.now() - (cached.timestamp || 0) < ENRICHMENT_TTL_MS) {
        const { url: _u, ...rest } = cached
        console.debug(`[AI][cache] HIT ${cleaned}`)
        return rest
      }
    } catch (e) {
      console.warn('[Background] IndexedDB read failed', e)
    }

    console.debug(`[AI][cache] MISS ${cleaned} — calling Gemini API`)
    const ms = timeSpent[cleaned] || 0
    const minutesSpent = Math.round(ms / 60000)
    const prompt = buildEnrichmentPrompt(minutesSpent, cleaned)
;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
    const controller = new AbortController()
    const timeoutMs = 15000
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    console.time(`[AI][api] ${cleaned}`)
    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const t = await resp.text().catch(() => '')
        console.timeEnd(`[AI][api] ${cleaned}`)
        console.warn(`[AI][api] Non-OK ${resp.status} for ${cleaned}`)
        return { summary: `API error ${resp.status}`, category: { name: 'Error', icon: '❌' }, tags: [] }
      }
      const data = await resp.json()
      console.timeEnd(`[AI][api] ${cleaned}`)
      clearTimeout(timeoutId)
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const rawJson = text.replace(/```json|```/g, '').trim()
      let aiData = {}
      try { aiData = JSON.parse(rawJson) } catch { }

      const adapted = {
        summary: aiData.justification || 'No summary available.',
        category: { name: aiData.primary_category || 'Uncategorized', icon: '✨' },
        tags: Array.isArray(aiData.suggested_tags) ? aiData.suggested_tags : [],
        toolName: aiData.tool_name || null,
        secondaryCategories: Array.isArray(aiData.secondary_categories) ? aiData.secondary_categories : [],
        workspaceGroup: aiData.workspace_group || null,
        suggestion: typeof aiData.suggestion === 'string' ? aiData.suggestion : null,
        timestamp: Date.now(),
      }

      try { await putEnrichmentToDb({ url: cleaned, ...adapted }) } catch (e) { console.warn('[Background] IndexedDB write failed', e) }
      console.debug(`[AI][cache] WRITE ${cleaned}`)
      return { ...adapted, __apiHit: true }
    } catch (e) {
      console.timeEnd(`[AI][api] ${cleaned}`)
      clearTimeout(timeoutId)
      const reason = e?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : (e?.message || String(e))
      console.warn(`[AI][api] Failed for ${cleaned}: ${reason}`)
      return { summary: `Error: ${reason}`, category: { name: 'Error', icon: '❌' }, tags: [] }
    }
  }

  // Open popup UI as a full tab by default when clicking the icon
  const APP_URL = chrome.runtime.getURL('index.html')

  async function openOrFocusApp() {
    try {
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
        // Leave existing tab as-is (do not activate) to avoid taskbar highlight
        return;
      }
      // Open in background (not active) to avoid taskbar highlight
      await chrome.tabs.create({ url, active: false });
    } catch (e) {
      console.warn('[Bridge] openOrFocusUrlInChrome failed:', e);
    }
  }

  function startHostActionPolling() {
    const INTERVAL_MS = 200; // faster reaction to host enqueued opens
    async function pollOnce() {
      try {
        const res = await fetch('http://127.0.0.1:4000/actions/next');
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const action = data?.action;
        if (action && action.type === 'open' && action.url) {
          await openOrFocusUrlInChrome(action.url);
        }
      } catch { /* ignore transient errors */ }
    }
    setInterval(() => { pollOnce().catch(() => {}) }, INTERVAL_MS);
  }

  // Start polling bridge
  startHostActionPolling();

  // Separate lightweight AI suggestion API (keeps enrichment unchanged)
  async function getAiSuggestion(url, apiKey) {
    const cleaned = cleanUrl(url)
    if (!cleaned) return { suggestedUrl: null, suggestion: null }
    const ms = timeSpent[cleaned] || 0
    const minutesSpent = Math.round(ms / 60000)
    const prompt = `You are assisting a developer. Given a base URL, propose a single https URL on the same site that would be the most helpful next page (e.g., docs, dashboard, search, relevant deep link). Return strictly JSON with fields: { "suggested_url": string, "suggestion": string }. Consider user time on site: ${minutesSpent} minutes.\n\nURL: ${cleaned}`
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
