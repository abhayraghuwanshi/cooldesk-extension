// MV3 background service worker (type: module)
import { getSettings, upsertUrl, getUIState, listWorkspaces, saveWorkspace, addUrlToWorkspace, putActivityRow, putTimeRow, getAllActivity, getAllTimeRows } from './db.js';
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

  // ---- One-time migration to final schema ----
  async function migrateToFinalSchema() {
    console.time('[Schema] migrateToFinalSchema');
    try {
      const norm = (s) => (s || '').trim().toLowerCase();
      const { dashboardData } = await chrome.storage.local.get(['dashboardData']);
      const bookmarks = Array.isArray(dashboardData?.bookmarks) ? dashboardData.bookmarks : [];
      const history = Array.isArray(dashboardData?.history) ? dashboardData.history : [];
      const items = [...bookmarks, ...history];
      const workspaces = await listWorkspaces();
      const wsByName = new Map();
      for (const w of (Array.isArray(workspaces) ? workspaces : [])) wsByName.set(norm(w.name), w);

      for (const it of items) {
        const rawUrl = it?.url;
        const cleaned = cleanUrl(rawUrl);
        if (!cleaned) continue;
        const wsName = typeof it?.workspaceGroup === 'string' ? it.workspaceGroup : null;
        let wsObj = null;
        if (wsName && wsName !== 'All' && wsName !== 'Unknown') {
          wsObj = wsByName.get(norm(wsName)) || null;
          if (!wsObj) {
            wsObj = { id: Date.now().toString(), name: wsName, description: '', createdAt: Date.now(), context: {}, systemPrompt: '' };
            await saveWorkspace(wsObj);
            wsByName.set(norm(wsName), wsObj);
          }
        }

        const title = it.title || cleaned;
        const domain = (() => { try { return new URL(cleaned).hostname; } catch { return null; } })();
        const favicon = domain ? `https://www.google.com/s2/favicons?sz=64&domain=${domain}` : undefined;
        const addedAt = typeof it.addedAt === 'number' ? it.addedAt : (typeof it.lastVisitTime === 'number' ? it.lastVisitTime : Date.now());

        // Ensure URL exists with membership and metadata
        if (wsObj?.id) {
          await addUrlToWorkspace(cleaned, wsObj.id, { title, favicon, addedAt, extra: { tags: [], category: [] } });
          // Also ensure canonical doc records the membership and AI data
          const aiClean = extractAiFromItem(it);
          await upsertUrl({ url: cleaned, workspaceIds: [String(wsObj.id)], title, favicon, addedAt, extra: { ai: aiClean } });
        } else {
          // No workspace: still upsert metadata and AI
          const aiClean = extractAiFromItem(it);
          await upsertUrl({ url: cleaned, title, favicon, addedAt, extra: { ai: aiClean } });
        }
      }
      console.timeEnd('[Schema] migrateToFinalSchema');
    } catch (e) {
      console.warn('[Schema] migration failed', e);
      console.timeEnd('[Schema] migrateToFinalSchema');
      throw e;
    }
  }

  function extractAiFromItem(it) {
    if (!it) return undefined;
    const ai = {};
    if (typeof it.summary === 'string') ai.summary = it.summary;
    if (it.category && typeof it.category?.name === 'string') ai.category = it.category;
    if (Array.isArray(it.tags)) ai.tags = it.tags;
    if (typeof it.toolName === 'string') ai.toolName = it.toolName;
    if (Array.isArray(it.secondaryCategories)) ai.secondaryCategories = it.secondaryCategories;
    if (typeof it.suggestion === 'string') ai.suggestion = it.suggestion;
    if (typeof it.timestamp === 'number') ai.timestamp = it.timestamp;
    return Object.keys(ai).length ? ai : undefined;
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
      // Run schema migration once if not done
      try {
        const { schemaMigrated } = await chrome.storage.local.get(['schemaMigrated']);
        if (!schemaMigrated) {
          await migrateToFinalSchema();
          await chrome.storage.local.set({ schemaMigrated: true });
        }
      } catch { /* ignore */ }
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

    if (msg?.action === 'getTimeSpent') {
      sendResponse({ ok: true, timeSpent });
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
    if (msg?.action === 'migrateFinalSchema') {
      (async () => {
        try {
          await migrateToFinalSchema();
          await chrome.storage.local.set({ schemaMigrated: true });
          sendResponse({ ok: true });
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
        const payload = { url, time: timeSpent[url] || 0, updatedAt: Date.now(), ...activityData[url] };
        await putActivityRow(payload);
      } catch (e) {
        // If write fails, keep it dirty for next round
        activityDirty.add(url);
      }
    }
  }

  // Periodic flush every 5s
  setInterval(() => { flushActivityBatch().catch(() => { }) }, 5000);
  (async () => {
    try {
      const allRecords = await getAllTimeRows();
      timeSpent = (Array.isArray(allRecords) ? allRecords : []).reduce((acc, record) => {
        if (record && record.url) acc[record.url] = Number(record.time) || 0;
        return acc;
      }, {});
      console.log('[Background] Time tracking data loaded from cooldesk-db');
    } catch {
      timeSpent = {};
    }
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
    await putTimeRow({ url: cleaned, time: newTime });
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
      flushActivityBatch().catch(() => { });
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
        suggestion: typeof aiData.suggestion === 'string' ? aiData.suggestion : null,
        timestamp: Date.now(),
      }

      // Upsert enrichment into canonical URLs store as extra.ai (no workspace coupling)
      try {
        await upsertUrl({ url: cleaned, extra: { ai: adapted } })
      } catch (e) {
        console.warn('[Background] upsertUrl(extra.ai) failed', e)
      }
      console.debug(`[AI] Enrichment saved to urls.extra.ai for ${cleaned}`)
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
      if (!hostPollTimer) hostPollTimer = setInterval(() => { pollOnceForAction().catch(() => {}) }, HOST_POLL_INTERVAL_MS);
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
        drainQueuedActionsOnConnect().catch(() => {});
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
