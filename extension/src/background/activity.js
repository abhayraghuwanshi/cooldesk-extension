// Activity tracking, time series, and session management
import { cleanupOldTimeSeriesData, getAllActivity, getTimeSeriesStorageStats, putActivityRow, putActivityTimeSeriesEvent } from '../db/activityTimeSeries-db.js';
import { setHostActivity } from '../services/extensionApi.js';
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

// Helper to identify audio streaming sites
function isAudioStreamingSite(url) {
    const audioSites = [
        'spotify.com', 'music.youtube.com', 'soundcloud.com', 'pandora.com',
        'apple.com/music', 'tidal.com', 'deezer.com', 'bandcamp.com',
        'last.fm', 'mixcloud.com', 'tunein.com'
    ];
    return audioSites.some(site => url.includes(site));
}

// Activity tracking state
let currentActive = { tabId: null, url: null, since: 0 };
let activityData = {}; // { [cleanedUrl]: { time, scroll, clicks, forms } }
const activityDirty = new Set();
const MAX_ACTIVITY_POST = 50; // limit rows per flush

// Session tracking for time series
let currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
let sessionStartTime = Date.now();
let sessionEvents = new Map(); // Track events per URL in current session
let urlSessions = new Map(); // Track ongoing sessions per URL to avoid duplicates
let urlSessionIds = new Map(); // Track consistent session IDs per URL

// Flush activity batch to database
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

// Accumulate time for a URL
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

// Tab event handlers
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

// Initialize activity tracking
export function initializeActivityTracking() {
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

    // Set up event listeners
    chrome.tabs.onActivated.addListener((activeInfo) => handleActivated(activeInfo.tabId));
    chrome.windows.onFocusChanged.addListener(handleFocusChanged);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

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
    });
}

// Handle activity messages from content scripts
export function handleActivityMessage(msg, sender) {
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
}

// Message handlers for activity-related requests
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

    // Handle activity tracking messages from content scripts
    if (msg.type && sender.tab) {
        handleActivityMessage(msg, sender);
    }
});

// Initialize activity tracking
export function initializeActivity() {
    initializeActivityTracking();
}

// Export activity data for other modules
export { accumulateTime, activityData, currentActive };

