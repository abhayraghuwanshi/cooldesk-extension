/**
 * syncContextService.js
 *
 * Fetches user data from the sidecar (workspaces + activity),
 * strips noise fields, deduplicates activity, and returns a compact
 * context string ready to be injected into LLM prompts.
 *
 * Nothing here is sent to any external server — the sidecar is localhost:4545.
 */

const SIDECAR_URL = 'http://127.0.0.1:4545';
const FETCH_TIMEOUT_MS = 3000;

// ─── Raw fetch helpers ─────────────────────────────────────────────────────

async function safeFetch(path) {
    try {
        const res = await fetch(`${SIDECAR_URL}${path}`, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

// ─── Cleaners ──────────────────────────────────────────────────────────────

/**
 * Strip IDs, timestamps, and duplicate URLs from workspace list.
 * Returns: [{ name, urls: [hostname, ...] }]
 */
function cleanWorkspaces(raw) {
    if (!Array.isArray(raw)) return [];

    return raw
        .filter(ws => ws.name && ws.urls?.length > 0)
        .map(ws => {
            const seen = new Set();
            const hosts = (ws.urls || [])
                .map(u => {
                    try { return new URL(u.url).hostname.replace(/^www\./, ''); } catch { return null; }
                })
                .filter(h => h && !seen.has(h) && seen.add(h));
            return { name: ws.name, urls: hosts };
        })
        .filter(ws => ws.urls.length > 0);
}

/**
 * Deduplicate activity by URL (keep entry with highest time),
 * sort by time desc, take top N.
 * Returns: [{ url, title, minutes }]
 */
function cleanActivity(raw, topN = 12) {
    if (!Array.isArray(raw)) return [];

    // Deduplicate: keep max time per URL
    const byUrl = new Map();
    for (const entry of raw) {
        if (!entry.url) continue;
        const key = entry.url.toLowerCase();
        const existing = byUrl.get(key);
        if (!existing || (entry.time || 0) > (existing.time || 0)) {
            byUrl.set(key, entry);
        }
    }

    return [...byUrl.values()]
        .sort((a, b) => (b.time || 0) - (a.time || 0))
        .slice(0, topN)
        .map(e => {
            let host = e.url;
            try { host = new URL(e.url).hostname.replace(/^www\./, ''); } catch { }
            const minutes = Math.round((e.time || 0) / 60000);
            // Extract a clean label from title: "Inbox (N) - user@email - Gmail" → "Gmail"
            let label = '';
            if (e.title) {
                const parts = e.title.split(' - ').map(s => s.trim()).filter(Boolean);
                const candidate = parts.length > 1 ? parts[parts.length - 1] : parts[0];
                if (candidate && !candidate.includes('@') && candidate.length <= 40) {
                    label = candidate;
                }
            }
            // Top sub-URLs already ranked by visit count from the tracker
            const subUrls = Array.isArray(e.topSubUrls) ? e.topSubUrls.slice(0, 4) : [];
            return { host, label, subUrls, minutes };
        })
        .filter(e => e.minutes > 0);
}

// ─── Context builder ───────────────────────────────────────────────────────

/**
 * Format cleaned data into a terse, token-efficient context block.
 */
function formatContext(workspaces, activity) {
    const lines = [];

    if (workspaces.length > 0) {
        lines.push('User workspaces:');
        for (const ws of workspaces) {
            lines.push(`- ${ws.name}: ${ws.urls.join(', ')}`);
        }
    }

    if (activity.length > 0) {
        lines.push('');
        lines.push('Most used sites (time spent):');
        for (const a of activity) {
            const appName = a.label && a.label.toLowerCase() !== a.host ? ` (${a.label})` : '';
            const subs = a.subUrls.length > 0 ? ` → ${a.subUrls.join(', ')}` : '';
            lines.push(`- ${a.host}${appName}${subs}: ${a.minutes}m`);
        }
    }

    return lines.join('\n');
}

// ─── Public API ────────────────────────────────────────────────────────────

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 min — data doesn't change fast

/**
 * Fetch workspaces + activity from sidecar, clean, and return as LLM context string.
 * Returns empty string if sidecar is not reachable.
 */
export async function buildSyncContext() {
    // Return cached value if fresh
    if (_cache !== null && Date.now() - _cacheTime < CACHE_TTL_MS) {
        return _cache;
    }

    const [wsData, actData] = await Promise.all([
        safeFetch('/workspaces'),
        safeFetch('/activity')
    ]);

    // /workspaces returns { workspaces: [...] } or raw array
    const rawWorkspaces = wsData?.workspaces ?? wsData ?? [];
    // /activity returns { activity: [...] } or raw array
    const rawActivity = actData?.activity ?? actData ?? [];

    const workspaces = cleanWorkspaces(rawWorkspaces);
    const activity = cleanActivity(rawActivity);

    const context = formatContext(workspaces, activity);

    _cache = context;
    _cacheTime = Date.now();
    return context;
}

/** Invalidate the cache (call after workspace save/delete). */
export function invalidateSyncContext() {
    _cache = null;
    _cacheTime = 0;
}
