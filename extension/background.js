// MV3 background service worker (type: module)

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
  console.log('[AI][collect] Collecting history (last 30 days, max 500)...')
  const startTime = Date.now() - DAYS_30
  const results = await chrome.history.search({ text: '', startTime, maxResults: 500 })
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

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed - populating data')
  await populateAndStore()
})

chrome.runtime.onStartup?.addListener(async () => {
  console.log('[Background] Startup - ensuring data present')
  const { dashboardData } = await chrome.storage.local.get(['dashboardData'])
  if (!dashboardData || (!dashboardData.bookmarks?.length && !dashboardData.history?.length)) {
    await populateAndStore()
  }
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.ping === 'bg') {
    sendResponse({ pong: true, time: Date.now() })
    return true
  }
  if (msg?.action === 'populateData') {
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
        if (!geminiApiKey) {
          chrome.runtime.sendMessage({ action: 'aiError', error: 'Gemini API key not set. Open Settings to add it.' })
          console.warn('[AI][enrich] Aborting: missing API key')
          return
        }
        const rawHistory = dashboardData?.history || []
        const limit = Number.isFinite(historyMaxResults) && historyMaxResults > 0 ? historyMaxResults : rawHistory.length
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

  if (msg?.action === 'getTimeSpent') {
    sendResponse({ ok: true, timeSpent });
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

// ---- IndexedDB persistent cache for AI enrichment ----
function openAiDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('devlink-ai', 1)
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains('enrichments')) {
        const store = db.createObjectStore('enrichments', { keyPath: 'url' })
        store.createIndex('timestamp', 'timestamp')
      }
      if (!db.objectStoreNames.contains('timeTracking')) {
        db.createObjectStore('timeTracking', { keyPath: 'url' })
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
  const prompt = `### INSTRUCTIONS ###\n\n**Persona:**\nYou are an expert AI assistant specializing in software development tools and developer productivity workflows.\n\n**Core Task:**\nAnalyze the given URL and classify it according to the schema. Also provide a concise user-centric suggestion informed by how much time the user spent on this site.\n\n**Rules:**\n1. Determine the tool/platform the URL represents.\n2. Assign exactly one primary_category from the Category List.\n3. Assign zero or more secondary_categories.\n4. Assign exactly one workspace_group from the Workspace List.\n5. Provide a concise justification.\n6. Suggest 1 short actionable suggestion (max 140 chars) in plain text under the 'suggestion' field. Consider user time spent: ${minutesSpent} minutes.\n7. Suggest 3-5 relevant suggested_tags in lowercase.\n8. Return a single well-formed JSON using the Output Schema.\n\n**Output Schema (JSON):**\n{\n  "tool_name": "The common name of the tool or platform.",\n  "primary_category": "The single most fitting category from the list.",\n  "secondary_categories": ["An array of other relevant categories from the list."],\n  "workspace_group": "The single high-level bucket from the workspace list.",\n  "justification": "A brief, one-sentence explanation for your categorization choices.",\n  "suggested_tags": ["An array of 3-5 relevant lowercase keywords."],\n  "suggestion": "One concise actionable recommendation for the user."\n}\n\n**Category List:**\n*   Source Control & Versioning\n*   Cloud & Infrastructure\n*   Code Assistance & AI Coding\n*   Documentation & Knowledge Search\n*   Testing & QA Automation\n*   Project Management & Collaboration\n*   Data Analysis & Visualization\n*   DevOps & CI/CD\n*   UI/UX & Design\n*   APIs & Integrations\n*   Learning & Upskilling\n*   AI & Machine Learning\n*   Security & Compliance\n*   Monitoring & Observability\n*   Local Development & Environments\n*   Package Management\n*   Database Management\n*   Communication\n\n**Workspace List:**\n*   Code & Versioning\n*   Cloud & Infrastructure\n*   AI & ML\n*   DevOps & Automation\n*   Testing & Quality\n*   Data & Analytics\n*   Design & UX\n*   Project & Team\n\n### URL TO CLASSIFY ###\n\n${cleaned}`;
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
