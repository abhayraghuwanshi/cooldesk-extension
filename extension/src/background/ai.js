import { addUrlToWorkspace, getSettings, getUrlNotes, listWorkspaces, saveWorkspace } from '../db/index.js';
import { createCircuitBreaker, getUrlParts } from '../utils/helpers.js';
import { buildCategoryListPrompt, buildEnrichmentPromptForWorkspace } from '../utils/prompts.js';
import { activityData } from './activity.js';

// Helper function to clean URLs
function cleanUrl(url) {
    try {
        const parts = getUrlParts(url);
        return parts?.key || null; // scheme + eTLD+1
    } catch {
        return null;
    }
}

// Circuit-breaker variant: use this to try the guarded flow without removing legacy
export async function getAiEnrichmentCB(url, apiKey) {
    const cleaned = cleanUrl(url)
    if (!cleaned) return { summary: 'Invalid URL', category: { name: 'Error', icon: '❌' }, tags: [] }
    console.debug(`[AI] Enrichment (CB): calling Gemini API for ${cleaned}`)

    // Same category/workspace context gathering as legacy
    let opts = {};
    try {
        const settings = await getSettings();
        const cats = Array.isArray(settings?.categories) ? settings.categories : [];
        const catRows = cats.map((c) => (typeof c === 'string' ? { name: String(c).trim(), description: '' } : (c || {})))
            .filter((r) => r && typeof r.name === 'string' && r.name.trim());
        if (catRows.length) {
            const names = catRows.map((r) => r.name.trim());
            const descMap = catRows.reduce((acc, r) => { acc[r.name.trim()] = String(r.description || '').trim(); return acc; }, {});
            opts.workspaceList = names;
            opts.workspaceDescriptions = descMap;
        }
    } catch { }
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
            }
        } catch { }
    }
    if (!opts.workspaceList) {
        try {
            const ws = await listWorkspaces();
            const names = (Array.isArray(ws) ? ws : []).map(w => String(w?.name || '').trim()).filter(Boolean);
            const descMap = (Array.isArray(ws) ? ws : []).reduce((acc, w) => { const n = String(w?.name || '').trim(); if (n) acc[n] = String(w?.description || '').trim(); return acc; }, {});
            if (names.length) {
                opts.workspaceList = names;
                opts.workspaceDescriptions = descMap;
            }
        } catch { }
    }

    const s = await getSettings();
    const model = (s?.modelName || 'gemini-1.5-flash').trim();
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`

    // Build the same prompt as legacy uses (reuse variables present in legacy scope)
    const ms = activityData[cleaned]?.time || 0
    const minutesSpent = Math.round(ms / 60000)
    const workspaceList = Array.isArray(opts.workspaceList) ? opts.workspaceList : []
    const descriptions = opts.workspaceDescriptions || {}
    const prompt = `You are an assistant helping organize a developer's browsing history into workspaces. Classify the site and provide a short justification.
URL: ${cleaned}
Minutes spent recently: ${minutesSpent}
Known workspaces: ${JSON.stringify(workspaceList)}
Workspace descriptions: ${JSON.stringify(descriptions)}

Return strictly JSON: { "workspace_group": string[] (or empty), "justification": string }`;

    const timeoutMs = 15000
    console.time(`[AI][api][CB] ${cleaned}`)
    let data = null
    try {
        data = await geminiBreaker.exec(async () => {
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
                if (resp.status === 401 || resp.status === 403) {
                    const t = await resp.text().catch(() => '')
                    throw Object.assign(new Error(`Auth ${resp.status}`), { code: 'AUTH', details: t })
                }
                if (!resp.ok) {
                    const t = await resp.text().catch(() => '')
                    throw Object.assign(new Error(`API ${resp.status}`), { code: 'HTTP', status: resp.status, details: t })
                }
                return await resp.json()
            } catch (e) {
                clearTimeout(timeoutId)
                throw e
            }
        })
    } catch (e) {
        console.timeEnd(`[AI][api][CB] ${cleaned}`)
        if (e?.code === 'AUTH') {
            console.warn(`[AI][api][CB] Auth error for ${cleaned}`, e?.details?.slice?.(0, 200) || '')
            return { summary: `Auth error`, category: { name: 'Error', icon: '❌' }, tags: [], __fatalAuth: true }
        }
        if (e?.code === 'CIRCUIT_OPEN') {
            console.warn('[AI][api][CB] Circuit open; skipping request')
            return { summary: 'API temporarily disabled (circuit open). Try later.', category: { name: 'Error', icon: '⏸️' }, tags: [] }
        }
        const reason = e?.message || 'Request failed'
        console.warn('[AI][api][CB] Failure', reason)
        return { summary: `API error: ${reason}`, category: { name: 'Error', icon: '❌' }, tags: [] }
    }

    console.timeEnd(`[AI][api][CB] ${cleaned}`)
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const rawJson = text.replace(/```json|```/g, '').trim()
    let aiData = {}
    try { aiData = JSON.parse(rawJson) } catch { }

    const workspaceGroup = Array.isArray(aiData.workspace_group)
        ? aiData.workspace_group.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())
        : []
    const adapted = {
        summary: typeof aiData.justification === 'string' && aiData.justification ? aiData.justification : 'No summary available.',
        workspaceGroup,
        timestamp: Date.now(),
    }

    try { await upsertUrl({ url: cleaned, extra: { ai: adapted } }) } catch (e) { console.warn('[Background][CB] upsertUrl(extra.ai) failed', e) }
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
                    try { await saveWorkspace(ws); } catch (e) { console.warn('[AI][enrich][CB] saveWorkspace failed', e); }
                    byName.set(key, ws);
                }
                try { await addUrlToWorkspace(cleaned, ws.id, { addedAt: Date.now() }); } catch (e) { console.warn('[AI][enrich][CB] addUrlToWorkspace failed', e); }
            }
        }
    } catch (e) { console.warn('[AI][enrich][CB] Persisting AI workspace membership failed', e) }

    console.debug(`[AI][CB] Enrichment saved to urls.extra.ai for ${cleaned}`)
    return { ...adapted, __apiHit: true }
}


const geminiBreaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxRequests: 1 });

// Split array into sequential chunks
function chunkArray(arr, size) {
    const n = Math.max(1, Number(size) || 1)
    const out = []
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
    return out
}

// Create a simple stable hash for categories list
function simpleHash(str) {
    let h = 0
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i), h |= 0
    return String(h)
}

function normalizeCategoriesForHash(cats) {
    const rows = (Array.isArray(cats) ? cats : []).map((c) => {
        if (typeof c === 'string') return { name: c.trim(), description: '' }
        return { name: String(c?.name || '').trim(), description: String(c?.description || '').trim() }
    }).filter((r) => r.name)
    rows.sort((a, b) => a.name.localeCompare(b.name))
    return JSON.stringify(rows)
}

async function haveCategoriesChanged() {
    try {
        const settings = await getSettings()
        const key = simpleHash(normalizeCategoriesForHash(settings?.categories))
        const { categoriesHash } = await chrome.storage.local.get(['categoriesHash'])
        if (categoriesHash !== key) {
            await chrome.storage.local.set({ categoriesHash: key, lastCategoryChangeAt: Date.now() })
            return true
        }
        return false
    } catch { return false }
}

// Decide if an origin should be (re)enriched based on existing urls.extra.ai and lookbac
// Up to 5 suggestions based on current screen context and base URL
export async function getAiSuggestions(urls, apiKey, currentActive) {
    const cleanedUrls = (Array.isArray(urls) ? urls : [urls]).map(cleanUrl).filter(Boolean);
    if (cleanedUrls.length === 0) return [];

    const primaryUrl = cleanedUrls[0];
    const current = currentActive?.url ? cleanUrl(currentActive.url) : null;

    const context = {
        workspace_urls: cleanedUrls,
        current_screen_url: current,
    };

    const prompt = `You are assisting a developer inside a Chrome extension. Given the context JSON below, which contains a list of URLs from the user's current workspace, propose up to 5 helpful https URLs to open next. Your suggestions should be highly relevant to the collection of URLs provided. Format strictly as JSON: { "suggestions": [ { "url": string, "label": string, "suggestion": string } ] } where label is a short name and suggestion is a one-line reason. Do not include markdown fences.\n\nCONTEXT:\n${JSON.stringify(context, null, 2)}`;
    const settings = await getSettings();
    const model = (settings?.modelName || 'gemini-1.5-flash').trim();
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`
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

// Separate lightweight AI suggestion API
export async function getAiSuggestion(url, apiKey) {
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

export async function getAiEnrichment(url, apiKey) {
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
    // If still no workspaces, skip AI enrichment to avoid unnecessary API calls
    ;
    const s = await getSettings();
    const model = (s?.modelName || 'gemini-1.5-flash').trim();
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`
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
            // Stop immediately on auth/permission errors
            if (resp.status === 401 || resp.status === 403) {
                const t = await resp.text().catch(() => '')
                console.warn(`[AI][api] Auth error ${resp.status} for ${cleaned}`, t?.slice?.(0, 200) || '')
                console.timeEnd(`[AI][api] ${cleaned}`)
                return { summary: `Auth error ${resp.status}`, category: { name: 'Error', icon: '❌' }, tags: [], __fatalAuth: true }
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



// Initialize AI message handlers
export function initializeAI() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.action === 'enrichWithAI') {
            // Fire-and-forget; UI listens to aiProgress/aiComplete
            ; (async () => {
                try {
                    console.time('[AI][enrich] enrichWithAI')
                    console.log('[AI][enrich] Received enrichWithAI message')
                    const { dashboardData, geminiApiKey, geminiAuthErrorAt } = await chrome.storage.local.get(['dashboardData', 'geminiApiKey', 'geminiAuthErrorAt'])
                    const settings = await getSettings();
                    if (!geminiApiKey) {
                        chrome.runtime.sendMessage({ action: 'aiError', error: 'Gemini API key not set. Open Settings to add it.' })
                        console.warn('[AI][enrich] Aborting: missing API key')
                        return
                    }
                    // Short-circuit if there was a recent auth failure to avoid spamming API with a bad key
                    try {
                        const cooldownMs = 60_000
                        const last = Number(geminiAuthErrorAt) || 0
                        if (last && Date.now() - last < cooldownMs) {
                            const wait = Math.ceil((cooldownMs - (Date.now() - last)) / 1000)
                            chrome.runtime.sendMessage({ action: 'aiError', error: `Recent auth error detected. Try again in ~${wait}s after fixing the API key.` })
                            console.warn('[AI][enrich] Aborting: recent auth error cooldown active')
                            return
                        }
                    } catch { }
                    // Do not change workspace memberships during enrichment
                    // We intentionally avoid resolving/creating any target workspace here.
                    const targetWorkspace = null;

                    const rawHistory = dashboardData?.history || []
                    // Time-based lookback using new settings.historyDays only
                    const daysFromSettings = Number(settings?.historyDays)
                    const days = Number.isFinite(daysFromSettings) && daysFromSettings > 0 ? daysFromSettings : 30
                    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
                    const history = rawHistory.filter((h) => Number(h?.lastVisitTime) >= cutoff)
                    console.log('[AI][enrich] Using historyDays lookback:', { fromSettings: settings?.historyDays, chosenDays: days, cutoff })
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
                    const MAX_ITEMS_PER_RUN = 8
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
                        const ai = await getAiEnrichmentCB(it.url, geminiApiKey)
                        if (ai && ai.__fatalAuth) {
                            try { await chrome.storage.local.set({ geminiAuthErrorAt: Date.now() }) } catch { }
                            chrome.runtime.sendMessage({ action: 'aiError', error: 'Invalid or unauthorized Gemini API key. Stopping enrichment.' })
                            console.warn('[AI][enrich] Stopping due to auth error')
                            break
                        }
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

                        // Check if there are URL notes for this item and include them in AI context
                        try {
                            // Use statically imported getUrlNotes (imported at top of file)
                            const urlNotes = await getUrlNotes(it.url)
                            if (urlNotes && urlNotes.length > 0) {
                                // Add URL notes context to the enriched data
                                merged.urlNotesContext = {
                                    count: urlNotes.length,
                                    hasVoiceNotes: urlNotes.some(n => n.type === 'voice'),
                                    hasScreenshots: urlNotes.some(n => n.type === 'screenshot'),
                                    hasTextNotes: urlNotes.some(n => n.type === 'text'),
                                    recentNotes: urlNotes.slice(0, 3).map(n => ({
                                        type: n.type,
                                        text: n.text || n.description,
                                        selectedText: n.selectedText,
                                        createdAt: n.createdAt
                                    }))
                                }
                            }
                        } catch (e) {
                            console.warn('[AI][enrich] Failed to load URL notes for context:', e)
                        }

                        processed += 1
                        chrome.runtime.sendMessage({ action: 'aiProgress', processed, total, currentItem: it.title || it.url, apiHits })
                        if (processed >= MAX_ITEMS_PER_RUN) {
                            console.log(`[AI][enrich] Reached cap ${MAX_ITEMS_PER_RUN}; stopping early`)
                            break
                        }
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

                    const { dashboardData, geminiApiKey } = await chrome.storage.local.get(['dashboardData', 'geminiApiKey'])
                    const settings = await getSettings();
                    if (!geminiApiKey) {
                        chrome.runtime.sendMessage({ action: 'aiError', error: 'Gemini API key not set. Open Settings to add it.' })
                        console.warn('[AI][enrich] Aborting: missing API key')
                        return
                    }
                    // Short-circuit if there was a recent auth failure to avoid spamming API with a bad key
                    try {
                        const { geminiAuthErrorAt } = await chrome.storage.local.get(['geminiAuthErrorAt']);
                        const cooldownMs = 60_000
                        const last = Number(geminiAuthErrorAt) || 0
                        if (last && Date.now() - last < cooldownMs) {
                            const wait = Math.ceil((cooldownMs - (Date.now() - last)) / 1000)
                            chrome.runtime.sendMessage({ action: 'aiError', error: `Recent auth error detected. Try again in ~${wait}s after fixing the API key.` })
                            console.warn('[AI][enrich][cat] Aborting: recent auth error cooldown active')
                            return
                        }
                    } catch { }

                    const rawHistory = dashboardData?.history || []
                    // Time-based lookback using new settings.historyDays only
                    const daysFromSettings = Number(settings?.historyDays)
                    const days = Number.isFinite(daysFromSettings) && daysFromSettings > 0 ? daysFromSettings : 30
                    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
                    const history = rawHistory.filter((h) => Number(h?.lastVisitTime) >= cutoff)
                    console.log('[AI][enrich][cat] Using historyDays lookback:', { fromSettings: settings?.historyDays, chosenDays: days, cutoff })
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
                    const MAX_ITEMS_PER_RUN = 8
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
                        const ai = await getAiEnrichmentCB(normalized, geminiApiKey)
                        if (ai && ai.__fatalAuth) {
                            try { await chrome.storage.local.set({ geminiAuthErrorAt: Date.now() }) } catch { }
                            chrome.runtime.sendMessage({ action: 'aiError', error: 'Invalid or unauthorized Gemini API key. Stopping enrichment.' })
                            console.warn('[AI][enrich][cat] Stopping due to auth error')
                            break
                        }
                        if (ai && ai.__apiHit) apiHits += 1
                        const { __apiHit, workspaceGroup: _ignoredWG, ...aiRest } = ai || {}
                        const merged = { ...it, ...aiRest, workspaceGroup: category, cleanUrl: normalized }
                        const idx = indexByUrl.get(it.url)
                        if (typeof idx === 'number') {
                            enrichedHistory[idx] = merged
                        }
                        processed += 1
                        chrome.runtime.sendMessage({ action: 'aiProgress', processed, total, currentItem: it.title || it.url, apiHits })
                        if (processed >= MAX_ITEMS_PER_RUN) {
                            console.log(`[AI][enrich][cat] Reached cap ${MAX_ITEMS_PER_RUN}; stopping early`)
                            break
                        }
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

        if (msg?.action === 'aiAutoCategorize') {
            ; (async () => {
                try {
                    console.time('[AI][auto] aiAutoCategorize')
                    const { dashboardData, geminiApiKey, geminiAuthErrorAt } = await chrome.storage.local.get(['dashboardData', 'geminiApiKey', 'geminiAuthErrorAt'])
                    if (!geminiApiKey) {
                        sendResponse({ ok: false, error: 'Gemini API key not set. Open Settings to add it.' });
                        return;
                    }
                    // Honor recent auth cooldown
                    try {
                        const cooldownMs = 60_000
                        const last = Number(geminiAuthErrorAt) || 0
                        if (last && Date.now() - last < cooldownMs) {
                            const wait = Math.ceil((cooldownMs - (Date.now() - last)) / 1000)
                            sendResponse({ ok: false, error: `Recent auth error detected. Try again in ~${wait}s after fixing the API key.` })
                            return
                        }
                    } catch { }

                    const settings = await getSettings();
                    const changed = await haveCategoriesChanged();
                    const BATCH_SIZE = 10

                    let candidates = []
                    if (changed) {
                        // Delta backfill: consider all known origins from URL index
                        const all = await listAllUrls()
                        const seen = new Set()
                        for (const rec of Array.isArray(all) ? all : []) {
                            const u = cleanUrl(rec?.url || '')
                            if (u && !seen.has(u)) { seen.add(u); candidates.push(u) }
                        }
                    } else {
                        // New-only: consider recent history, skip origins already enriched
                        const rawHistory = dashboardData?.history || []
                        const daysFromSettings = Number(settings?.historyDays)
                        const days = Number.isFinite(daysFromSettings) && daysFromSettings > 0 ? daysFromSettings : 30
                        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
                        const recent = rawHistory.filter((h) => Number(h?.lastVisitTime) >= cutoff)
                        const seen = new Set()
                        // Collect deduped cleaned origins from history
                        const origins = []
                        for (const it of recent) {
                            const u = cleanUrl(it?.url)
                            if (u && !seen.has(u)) { seen.add(u); origins.push(u) }
                        }
                        // Filter to origins that have NEVER been enriched (no 24h freshness window)
                        for (const u of origins) {
                            try {
                                const rec = await getUrlRecord(u)
                                const ai = rec && rec.extra && rec.extra.ai
                                if (!ai || !ai.timestamp) candidates.push(u)
                            } catch { candidates.push(u) }
                        }
                    }

                    // Dedupe final candidates again for safety
                    candidates = Array.from(new Set(candidates))
                    const total = candidates.length
                    if (!total) {
                        sendResponse({ ok: false, error: changed ? 'No origins to delta backfill.' : 'No new origins to enrich.' })
                        return
                    }

                    chrome.runtime.sendMessage({ action: 'aiProgress', processed: 0, total, currentItem: 'Starting…', apiHits: 0 })
                    let processed = 0
                    let apiHits = 0
                    const MAX_ITEMS_PER_RUN = 8
                    const batches = chunkArray(candidates, BATCH_SIZE)
                    let stopEarly = false
                    for (const batch of batches) {
                        for (const origin of batch) {
                            const ai = await getAiEnrichmentCB(origin, geminiApiKey)
                            if (ai && ai.__fatalAuth) {
                                try { await chrome.storage.local.set({ geminiAuthErrorAt: Date.now() }) } catch { }
                                chrome.runtime.sendMessage({ action: 'aiError', error: 'Invalid or unauthorized Gemini API key. Stopping.' })
                                console.warn('[AI][auto] Stopping due to auth error')
                                console.timeEnd('[AI][auto] aiAutoCategorize')
                                return
                            }
                            if (ai && ai.__apiHit) apiHits += 1
                            processed += 1
                            chrome.runtime.sendMessage({ action: 'aiProgress', processed, total, currentItem: origin, apiHits })
                            if (processed >= MAX_ITEMS_PER_RUN) { stopEarly = true; break }
                        }
                        if (stopEarly) break
                        await new Promise((r) => setTimeout(r, 250))
                    }

                    chrome.runtime.sendMessage({ action: 'aiComplete' })
                    chrome.runtime.sendMessage({ action: 'updateData' })
                    console.timeEnd('[AI][auto] aiAutoCategorize')
                    sendResponse({ ok: true, processed, total, apiHits, mode: changed ? 'delta' : 'newOnly' })
                } catch (e) {
                    console.error('[Background] aiAutoCategorize failed', e)
                    chrome.runtime.sendMessage({ action: 'aiError', error: String(e) })
                    sendResponse({ ok: false, error: String(e) })
                }
            })()
            return true
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
    });
}

// Export AI utilities for other modules
export { cleanUrl };
