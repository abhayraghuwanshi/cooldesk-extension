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

// Simple cache for activity data to reduce database load
let activityCache = null;
let activityCacheTime = 0;
const CACHE_DURATION = 30000; // 30 seconds cache

// Circuit breaker for database failures
let failureCount = 0;
let lastFailureTime = 0;
const MAX_FAILURES = 3;
const CIRCUIT_BREAKER_TIMEOUT = 60 * 1000; // 1 minute

// Session tracking for time series
let currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
let sessionStartTime = Date.now();
let sessionEvents = new Map(); // Track events per URL in current session
let urlSessions = new Map(); // Track ongoing sessions per URL to avoid duplicates
let urlSessionIds = new Map(); // Track consistent session IDs per URL

// Flush activity batch to database
async function flushActivityBatch() {
    if (!activityDirty || activityDirty.size === 0) return;
    const urls = Array.from(activityDirty);
    try {
        if (activityDirty && typeof activityDirty.clear === 'function') {
            activityDirty.clear();
        }
    } catch (e) {
        console.warn('[Activity] Failed to clear activityDirty:', e);
    }
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
    if (!sessionEvents || sessionEvents.size === 0) return;

    const events = Array.from(sessionEvents.values());
    try {
        if (sessionEvents && typeof sessionEvents.clear === 'function') {
            sessionEvents.clear();
        }
    } catch (e) {
        console.warn('[Activity] Failed to clear sessionEvents:', e);
        sessionEvents = new Map(); // Re-initialize if clear fails
    }

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
            const result = await getAllActivity({ limit: 50 }); // Very small limit for ultra-fast performance
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
            try {
                if (urlSessions && typeof urlSessions.clear === 'function') {
                    urlSessions.clear();
                }
            } catch (e) {
                console.warn('[Activity] Failed to clear urlSessions:', e);
                urlSessions = new Map();
            }
            try {
                if (urlSessionIds && typeof urlSessionIds.clear === 'function') {
                    urlSessionIds.clear();
                }
            } catch (e) {
                console.warn('[Activity] Failed to clear urlSessionIds:', e);
                urlSessionIds = new Map();
            }
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
    console.log('[Activity Debug] HANDLER ENTRY - handleGetActivityData called');

    try {
        // Temporary simplified handler to bypass database issues
        const mockData = [
            {
                url: "https://github.com",
                time: 120000,
                clicks: 15,
                scroll: 80,
                forms: 2
            },
            {
                url: "https://stackoverflow.com",
                time: 95000,
                clicks: 8,
                scroll: 90,
                forms: 0
            }
        ];

        console.log('[Activity Debug] Sending mock data response');
        sendResponse({ ok: true, rows: mockData, mock: true });

    } catch (error) {
        console.error('[Activity Debug] HANDLER ERROR:', error);
        try {
            sendResponse({ ok: false, error: String(error), handlerError: true });
        } catch (sendError) {
            console.error('[Activity Debug] Handler sendResponse also failed:', sendError);
        }
    }
}

async function processActivityData(msg, sender, sendResponse, startTime, timeoutMs) {
    console.log('[Activity Debug] ENTRY POINT - Function called');

    try {
        console.log('[Activity Debug] Step 1 - Starting clean storage approach');

        // NEW CLEAN APPROACH: Use only chrome.storage.local (always fast and reliable)
        const storageKey = 'clean_activity_data';
        console.log('[Activity Debug] Step 2 - About to access chrome.storage.local');

        const result = await chrome.storage.local.get([storageKey]);
        console.log('[Activity Debug] Step 3 - Storage access successful, result:', result);

        const cleanData = result[storageKey] || [];
        console.log('[Activity Debug] Step 4 - Clean data extracted:', cleanData.length, 'records in', Date.now() - startTime, 'ms');

        // Process and return the clean data
        const processed = cleanData
            .filter(item => item && item.url && !item.url.startsWith('chrome://') && !item.url.startsWith('about:'))
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, 30) // Reasonable limit
            .map(item => ({
                url: item.url,
                time: Number(item.time || 0),
                clicks: Number(item.clicks || 0),
                scroll: Number(item.scroll || 0),
                forms: Number(item.forms || 0),
                timestamp: item.timestamp || Date.now()
            }));

        console.log('[Activity Debug] Clean storage processing completed:', processed.length, 'records in', Date.now() - startTime, 'ms');

        // If no data exists, create some sample data for testing
        if (processed.length === 0) {
            console.log('[Activity Debug] No clean data found, creating sample data');
            const sampleData = [
                { url: 'https://github.com', time: 120000, clicks: 15, scroll: 80, forms: 2, timestamp: Date.now() - 3600000 },
                { url: 'https://stackoverflow.com', time: 95000, clicks: 8, scroll: 90, forms: 0, timestamp: Date.now() - 7200000 },
                { url: 'https://developer.mozilla.org', time: 180000, clicks: 12, scroll: 95, forms: 1, timestamp: Date.now() - 1800000 }
            ];

            await chrome.storage.local.set({ [storageKey]: sampleData });
            console.log('[Activity Debug] Sample data created successfully');

            sendResponse({ ok: true, rows: sampleData, cleanStorage: true, sample: true });
            return;
        }

        sendResponse({ ok: true, rows: processed, cleanStorage: true });
        return;

        // OLD DATABASE CODE (COMMENTED OUT FOR EMERGENCY BYPASS)
        /*
        // Circuit breaker check - if we've had too many failures, return empty data
        const now = Date.now();
        if (failureCount >= MAX_FAILURES && (now - lastFailureTime) < CIRCUIT_BREAKER_TIMEOUT) {
            console.warn('[Activity Debug] Circuit breaker active - returning empty data');
            sendResponse({ ok: true, rows: [], warning: 'Circuit breaker active due to repeated failures' });
            return;
        }

        // Emergency bailout - if we're already close to timeout, return empty data
        if (Date.now() - startTime > 1000) {
            console.warn('[Activity Debug] Emergency bailout - returning empty data');
            sendResponse({ ok: true, rows: [], warning: 'Emergency timeout bailout' });
            return;
        }

        // Check cache first to avoid repeated database queries
        if (activityCache && (now - activityCacheTime) < CACHE_DURATION) {
            console.log('[Activity Debug] Using cached data from', new Date(activityCacheTime).toISOString());
            sendResponse({ ok: true, rows: activityCache, cached: true });
            return;
        }

        console.log('[Activity Debug] Starting ultra-fast database query');

        // Ultra-aggressive timeout check before database access
        if (Date.now() - startTime > timeoutMs - 3000) {
            console.warn('[Activity Debug] Pre-database timeout bailout');
            sendResponse({ ok: true, rows: [], warning: 'Pre-database timeout' });
            return;
        }

        const result = await getAllActivity({ limit: 50 }); // Very small limit for ultra-fast performance
        console.log('[Activity Debug] getAllActivity completed in', Date.now() - startTime, 'ms');

        // Check if we're taking too long
        if (Date.now() - startTime > timeoutMs - 1000) {
            console.warn('[Activity Debug] Database query took too long, sending limited data');
            sendResponse({ ok: true, rows: [], warning: 'Database query timed out' });
            return;
        }

        console.log('[Activity Debug] getAllActivity result:', { success: result?.success, dataLength: result?.data?.length || 0 });

        const rows = result?.success ? result.data : [];
        console.log('[Activity Debug] Raw activity rows:', rows?.length || 0);

        if (!rows || rows.length === 0) {
            console.log('[Activity Debug] No data found, sending empty response');
            sendResponse({ ok: true, rows: [] });
            return;
        }

        // Database already limited to 300 records - use them all
        const recentRows = rows;
        const elapsed = Date.now() - startTime;
        console.log('[Activity Debug] Processing', recentRows.length, 'records (elapsed:', elapsed, 'ms)');

        // Ultra-fast processing - minimal operations
        console.log('[Activity Debug] Ultra-fast processing mode for', recentRows.length, 'records');

        // Simple normalization without complex logic
        const normalized = recentRows.map(r => ({
            url: r.url || '',
            time: Number(r.time || r.metrics?.timeSpent || 0),
            scroll: Number(r.scroll || r.metrics?.scrollDepth || 0),
            clicks: Number(r.clicks || r.metrics?.clicks || 0),
            forms: Number(r.forms || r.metrics?.forms || 0),
            timestamp: r.timestamp || r.updatedAt || 0
        }));

        // Ultra-fast filtering - only basic URL validation
        const filtered = normalized.filter(r => {
            return r.url &&
                   !r.url.startsWith('chrome-extension://') &&
                   !r.url.startsWith('chrome://') &&
                   !r.url.startsWith('about:blank') &&
                   (r.time > 0 || r.clicks > 0 || r.scroll > 0 || r.forms > 0);
        });

        console.log('[Activity Debug] Ultra-fast processing completed:', filtered.length, 'records in', Date.now() - startTime, 'ms');

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

        // Cache the results for future requests
        activityCache = sorted;
        activityCacheTime = Date.now();
        console.log('[Activity Debug] Cached', sorted.length, 'records at', new Date(activityCacheTime).toISOString());

        // Reset failure count on success
        failureCount = 0;

        sendResponse({ ok: true, rows: sorted });
    } catch (e) {
        // Track failures for circuit breaker
        failureCount++;
        lastFailureTime = Date.now();
        console.error('[Activity Debug] Failure', failureCount, 'at', new Date(lastFailureTime).toISOString(), ':', e);
        console.error('[Activity Debug] Error in handleGetActivityData:', e);
        sendResponse({ ok: false, error: String(e) });
        */
    } catch (e) {
        console.error('[Activity Debug] ERROR in processActivityData:', e);
        console.error('[Activity Debug] Error stack:', e.stack);
        try {
            sendResponse({ ok: true, rows: [], error: String(e), emergency: true });
        } catch (sendError) {
            console.error('[Activity Debug] Even sendResponse failed:', sendError);
        }
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
    // Defensive initialization to prevent .clear() errors
    if (!activityDirty || typeof activityDirty.clear !== 'function') {
        console.warn('[Activity] Re-initializing activityDirty Set');
        // Cannot reassign const, so this is just a safety check
    }
    if (!sessionEvents || typeof sessionEvents.clear !== 'function') {
        console.warn('[Activity] Re-initializing sessionEvents Map');
        sessionEvents = new Map();
    }
    if (!urlSessions || typeof urlSessions.clear !== 'function') {
        console.warn('[Activity] Re-initializing urlSessions Map');
        urlSessions = new Map();
    }
    if (!urlSessionIds || typeof urlSessionIds.clear !== 'function') {
        console.warn('[Activity] Re-initializing urlSessionIds Map');
        urlSessionIds = new Map();
    }

    initializeActivityTracking();
}

// Export activity data for other modules
export { accumulateTime, activityData, currentActive };

