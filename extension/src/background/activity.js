// Activity tracking, time series, and session management
import { cleanupOldTimeSeriesData, getAllActivity, getTimeSeriesStorageStats, putActivityRow, putActivityTimeSeriesEvent } from '../db/index.js';
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
            const result = await getAllActivity();
            const rows = result?.success ? result.data : [];
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
    if (!sender.tab?.url || !msg.type) {
        console.log('[Activity Debug] Skipping message - missing URL or type:', { hasUrl: !!sender.tab?.url, hasType: !!msg.type });
        return;
    }
    
    const cleaned = cleanUrl(sender.tab.url);
    if (!cleaned) {
        console.log('[Activity Debug] Skipping message - could not clean URL:', sender.tab.url);
        return;
    }
    
    console.log('[Activity Debug] Processing activity for URL:', cleaned, 'type:', msg.type);
    
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
        console.log('[Activity Debug] Created new session for:', cleaned);
    }
    const sessionEvent = sessionEvents.get(cleaned);

    if (msg.type !== 'visibility') {
        switch (msg.type) {
            case 'scroll':
                // Fix: Content script sends 'scrollPercent' but we were looking for 'depth'
                const scrollValue = Math.round((msg.scrollPercent || msg.depth || 0) * 100); // Convert to percentage
                activityData[cleaned].scroll = Math.max(activityData[cleaned].scroll || 0, scrollValue);
                sessionEvent.scrollDepth = Math.max(sessionEvent.scrollDepth, scrollValue);
                sessionEvent.interactions.push('scroll');
                sessionEvent.lastSeen = Date.now();
                console.log('[Activity Debug] Updated scroll for', cleaned, 'to', scrollValue);
                break;
            case 'click':
                activityData[cleaned].clicks = (activityData[cleaned].clicks || 0) + 1;
                sessionEvent.clicks += 1;
                sessionEvent.interactions.push('click');
                sessionEvent.lastSeen = Date.now();
                console.log('[Activity Debug] Incremented clicks for', cleaned, 'to', activityData[cleaned].clicks);
                break;
            case 'formSubmit':
                activityData[cleaned].forms = (activityData[cleaned].forms || 0) + 1;
                sessionEvent.forms += 1;
                sessionEvent.interactions.push('form');
                sessionEvent.lastSeen = Date.now();
                console.log('[Activity Debug] Incremented forms for', cleaned, 'to', activityData[cleaned].forms);
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

// Message handling functions for activity-related requests (called from main background script)
export async function handleGetActivityData(msg, sender, sendResponse) {
    const startTime = Date.now();
    const timeoutMs = 5000; // 5 second internal timeout

    try {
        console.log('[Activity Debug] Starting handleGetActivityData with', timeoutMs, 'ms timeout');

        // Allow overriding cutoff via chrome.storage.local: activityDays (number)
        const { activityDays } = await chrome.storage.local.get(['activityDays']);
        const days = Number.isFinite(Number(activityDays)) && Number(activityDays) > 0 ? Number(activityDays) : 30;
        const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

        console.log('[Activity Debug] Getting activity data with cutoff:', new Date(cutoffMs).toISOString());

        const result = await getAllActivity();
        console.log('[Activity Debug] getAllActivity completed in', Date.now() - startTime, 'ms');
        console.log('[Activity Debug] getAllActivity result:', { success: result?.success, dataLength: result?.data?.length || 0 });

        const rows = result?.success ? result.data : [];
        console.log('[Activity Debug] Raw activity rows:', rows?.length || 0);

        if (!rows || rows.length === 0) {
            console.log('[Activity Debug] No data found, sending empty response');
            sendResponse({ ok: true, rows: [] });
            return;
        }

        // Limit processing to avoid timeout - take most recent records first
        const recentRows = rows.slice(0, 500); // Process max 500 records for last 30 days
        console.log('[Activity Debug] Processing', recentRows.length, 'of', rows.length, 'total records');

        // Transform and filter recent activity data to handle both legacy and new time-series formats
        const normalized = recentRows.map((r, index) => {
            // Normalize the record format for frontend consumption
            const result = {
                url: r.url,
                time: r.time || r.metrics?.timeSpent || 0,
                scroll: r.scroll || r.metrics?.scrollDepth || 0,
                clicks: r.clicks || r.metrics?.clicks || 0,
                forms: r.forms || r.metrics?.forms || 0,
                updatedAt: r.updatedAt || r.timestamp || 0,
                timestamp: r.timestamp || r.updatedAt || 0
            };

            // Only log first 3 records to avoid spam
            if (index < 3) {
                console.log('[Activity Debug] Normalized record', index + 1, ':', {
                    url: result.url,
                    time: result.time,
                    timestamp: result.timestamp,
                    timestampDate: new Date(result.timestamp).toISOString()
                });
            }

            return result;
        });

        console.log('[Activity Debug] Normalized records:', normalized.length, 'in', Date.now() - startTime, 'ms');

        let acceptedCount = 0;
        let rejectedCount = 0;

        const filtered = normalized.filter(r => {
            // Skip URLs that are empty or problematic browser internals
            if (!r.url) {
                if (rejectedCount < 2) console.log('[Activity Debug] Skipping empty URL');
                rejectedCount++;
                return false;
            }

            // Skip some browser internals but keep useful ones like new tab pages
            if (r.url.startsWith('chrome-extension://') ||
                r.url.startsWith('chrome://settings') ||
                r.url.startsWith('chrome://extensions') ||
                r.url.startsWith('about:blank')) {
                if (rejectedCount < 2) console.log('[Activity Debug] Skipping browser internal URL:', r.url.substring(0, 50));
                rejectedCount++;
                return false;
            }

            // Check recency using updatedAt/timestamp
            const timestamp = r.updatedAt || r.timestamp || 0;
            const isRecent = timestamp > 0 && timestamp >= cutoffMs;
            const hasActivity = (Number(r.time) || 0) > 0;
            const hasInteractions = (Number(r.clicks) || 0) > 0 || (Number(r.scroll) || 0) > 0 || (Number(r.forms) || 0) > 0;

            // More lenient filtering: keep if has any activity/interaction OR is somewhat recent (30 days)
            const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
            const isRecentlyActive = timestamp > recentThreshold;
            const shouldKeep = isRecent || hasActivity || hasInteractions || isRecentlyActive;

            if (shouldKeep) {
                if (acceptedCount < 3) {
                    console.log('[Activity Debug] ACCEPTED record for', r.url?.substring(0, 50), {
                        time: r.time,
                        clicks: r.clicks,
                        scroll: r.scroll,
                        timestampDate: timestamp ? new Date(timestamp).toISOString() : 'none'
                    });
                }
                acceptedCount++;
            } else {
                if (rejectedCount < 3) {
                    console.log('[Activity Debug] REJECTED record for', r.url?.substring(0, 50), {
                        timestamp,
                        hasActivity,
                        hasInteractions,
                        isRecentlyActive
                    });
                }
                rejectedCount++;
            }

            return shouldKeep;
        });

        console.log(`[Activity Debug] Filtering completed: ${acceptedCount} accepted, ${rejectedCount} rejected, ${filtered.length} total`);

        // Sort by time descending to keep most relevant first
        const sorted = filtered.sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));

        const totalTime = Date.now() - startTime;
        console.log(`[Activity Debug] Processing completed in ${totalTime}ms: ${sorted.length} final records`);

        // Check if we're approaching timeout
        if (totalTime > timeoutMs - 500) {
            console.warn(`[Activity Debug] Processing took ${totalTime}ms, close to ${timeoutMs}ms timeout`);
        }

        if (sorted.length > 0) {
            sorted.slice(0, 3).forEach((r, i) => {
                console.log(`[Activity Debug] Top ${i + 1}:`, {
                    url: r.url?.substring(0, 50),
                    time: r.time,
                    clicks: r.clicks,
                    scroll: r.scroll
                });
            });
        }

        sendResponse({ ok: true, rows: sorted });
    } catch (e) {
        console.error('[Activity Debug] Error in handleGetActivityData:', e);
        sendResponse({ ok: false, error: String(e) });
    }
}

export async function handleGetTimeSeriesStats(msg, sender, sendResponse) {
    try {
        const stats = await getTimeSeriesStorageStats();
        sendResponse({ ok: true, stats });
    } catch (e) {
        sendResponse({ ok: false, error: String(e) });
    }
}

export async function handleCleanupTimeSeriesData(msg, sender, sendResponse) {
    try {
        const retentionDays = typeof msg.retentionDays === 'number' ? msg.retentionDays : 30;
        const deleted = await cleanupOldTimeSeriesData(retentionDays);
        sendResponse({ ok: true, deleted });
    } catch (e) {
        sendResponse({ ok: false, error: String(e) });
    }
}

export function handleActivityContentScriptMessage(msg, sender) {
    // Skip daily notes, text selection, and side panel messages - they should be handled by the main background script
    if (msg.type === 'updateDailyNotes' || 
        msg.type === 'getDailyNotes' || 
        msg.type === 'deleteSelection' || 
        msg.type === 'textSelected' || 
        msg.type === 'textDeselected' ||
        msg.type === 'openSidePanel') {
        return false;
    }
    
    // Handle activity tracking messages from content scripts
    if (msg.type && sender.tab) {
        console.log('[Activity Debug] Processing content script message:', {
            type: msg.type,
            url: sender.tab.url,
            tabId: sender.tab.id,
            hasExtraData: Object.keys(msg).length > 2
        });
        handleActivityMessage(msg, sender);
        return true;
    }
    return false;
}

// Initialize activity tracking
export function initializeActivity() {
    initializeActivityTracking();
}

// Export activity data for other modules
export { accumulateTime, activityData, currentActive };

