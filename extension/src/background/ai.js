// AI-related background handlers and functions
import { getSettings } from '../db.js';
import { getUrlParts } from '../utils.js';

// Helper function to clean URLs
function cleanUrl(url) {
    try {
        const parts = getUrlParts(url);
        return parts?.key || null; // scheme + eTLD+1
    } catch {
        return null;
    }
}

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



// Export AI functions for use by background.js
export { cleanUrl };
