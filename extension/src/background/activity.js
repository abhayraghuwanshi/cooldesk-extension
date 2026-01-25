// Activity tracking, time series, and session management
import { cleanupOldTimeSeriesData, getAllActivity, getTimeSeriesStorageStats, getUrlAnalytics, putActivityTimeSeriesEvent } from '../db/index.js';
import { setHostActivity } from '../services/extensionApi.js';
import { getUrlParts } from '../utils/helpers.js';
// import { autoSavePredictor } from '../ml/inference/autoSavePredictor.js'; // DISABLED - ML modules removed


// Helper function to clean URLs (returns base domain for app-like aggregation)
function cleanUrl(url) {
    try {
        const parts = getUrlParts(url);
        return parts?.key || new URL(url).hostname; // scheme + eTLD+1 (e.g., https://github.com) or fallback
    } catch {
        try { return new URL(url).hostname; } catch { return null; }
    }
}

// Helper function to initialize activity data structure
function initActivityData(url = '') {
    let domain = '';
    try {
        domain = new URL(url).hostname.replace('www.', '');
    } catch {
        domain = '';
    }

    return {
        time: 0,
        scroll: 0,
        clicks: 0,
        forms: 0,
        visitCount: 0,
        returnVisits: 0,
        lastVisit: 0,
        visitTimes: [], // Array of visit hours (0-23) for pattern detection
        sessionDurations: [], // Array of individual session durations
        bounced: 0, // Count of sessions < 5s with no interaction
        title: '',
        domain: domain,
        pageType: '', // 'article', 'tool', 'dashboard', etc.
        firstVisit: Date.now(),
        visitDays: new Set() // Set of day strings (YYYY-MM-DD) for return visit tracking
    };
}

// Helper function to classify page type from URL
function classifyPageType(url, title = '') {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();

    // Specific subdomain/path patterns for better granularity
    // Google services - distinguish by subdomain
    if (urlLower.includes('mail.google.com')) return 'email';
    if (urlLower.includes('drive.google.com')) return 'storage';
    if (urlLower.includes('docs.google.com')) return 'docs';
    if (urlLower.includes('sheets.google.com')) return 'tool';
    if (urlLower.includes('calendar.google.com')) return 'tool';
    if (urlLower.includes('meet.google.com')) return 'video';

    // GitHub - distinguish by path
    if (urlLower.includes('github.com')) {
        if (urlLower.includes('/issues') || urlLower.includes('/pull')) return 'code-review';
        if (urlLower.includes('/actions') || urlLower.includes('/settings')) return 'tool';
        if (urlLower.includes('/wiki') || titleLower.includes('readme')) return 'docs';
        return 'code';
    }

    // General patterns
    const patterns = {
        tool: /app\.|tool\.|editor\.|admin\.|dashboard|console\.|analytics\./i,
        docs: /docs\.|documentation|api\.|reference|guide|wiki/i,
        article: /blog\.|article\.|post\.|news\.|medium\.com/i,
        social: /twitter\.|x\.com|facebook\.|linkedin\.|reddit\.|instagram\./i,
        code: /gitlab\.|stackoverflow\.|codepen\.|repl\.it|codesandbox/i,
        video: /youtube\.|vimeo\.|twitch\./i,
        shopping: /amazon\.|ebay\.|shop\.|store\./i,
        email: /outlook\.|mail\./i,
        storage: /dropbox\.|onedrive\.|drive\./i
    };

    for (const [type, pattern] of Object.entries(patterns)) {
        if (pattern.test(urlLower) || pattern.test(titleLower)) {
            return type;
        }
    }

    return 'general';
}

// Enhanced URL filtering to exclude system and low-value URLs
function isValidTrackingUrl(url) {
    if (!url || typeof url !== 'string') return false;

    // System URLs to exclude
    const systemPrefixes = [
        'chrome://', 'edge://', 'about:', 'moz-extension://',
        'chrome-extension://', 'extension://', 'file://'
    ];

    // Low-value domains to exclude
    const excludeDomains = [
        'newtab', 'extensions', 'settings', 'blank'
    ];

    // Check system prefixes
    if (systemPrefixes.some(prefix => url.startsWith(prefix))) {
        return false;
    }

    // Check if it's a meaningful URL (has domain)
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname.toLowerCase();

        // Exclude if domain is in exclude list or is empty
        if (!domain || excludeDomains.some(exclude => domain.includes(exclude))) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

// Calculate engagement score based on user interactions
function calculateEngagementScore(data) {
    const time = Number(data.time) || 0;
    const clicks = Number(data.clicks) || 0;
    const scroll = Number(data.scroll) || 0;
    const forms = Number(data.forms) || 0;

    // Weighted scoring: forms > clicks > scroll > time
    const score = (
        forms * 100 +      // Form submissions are high-value interactions
        clicks * 10 +      // Clicks show active engagement
        scroll * 0.5 +     // Scrolling shows content consumption
        (time / 1000) * 0.1 // Time has lowest weight (per second)
    );

    return Math.round(score * 100) / 100; // Round to 2 decimal places
}

// Check if session has minimum engagement to be worth tracking
function hasMinimumEngagement(data) {
    const time = Number(data.time) || 0;
    const clicks = Number(data.clicks) || 0;
    const scroll = Number(data.scroll) || 0;
    const forms = Number(data.forms) || 0;

    // Minimum thresholds for tracking
    return (
        time >= 5000 ||    // At least 5 seconds
        clicks >= 2 ||     // At least 2 clicks
        scroll >= 25 ||    // At least 25% scroll
        forms >= 1         // Any form submission
    );
}

// Helper to identify audio streaming sites - DEPRECATED (Using generic heartbeat)
function isAudioStreamingSite(url) {
    // Legacy fallback list
    const audioSites = [
        'spotify.com', 'music.youtube.com', 'soundcloud.com', 'pandora.com',
        'apple.com/music', 'tidal.com', 'deezer.com', 'bandcamp.com',
        'last.fm', 'mixcloud.com', 'tunein.com', 'youtube.com', 'twitch.tv', 'vimeo.com'
    ];
    return audioSites.some(site => url.includes(site));
}

// Activity tracking state
let currentActive = { tabId: null, url: null, since: 0 };
let activityData = {}; // { [cleanedUrl]: { time, scroll, clicks, forms, visitCount, returnVisits, lastVisit, visitTimes, sessionDurations, bounced, title, domain, pageType, firstVisit, visitDays } }
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
let tabSessions = new Map(); // Track sessions per tab ID to prevent duplicates
let sessionStartTimes = new Map(); // Track session start times for bounce detection
let sessionHadInteraction = new Map(); // Track if session had any interaction

// Memory optimization: Limit Map sizes to prevent unbounded growth
const MAX_MAP_SIZE = 100; // Maximum entries per Map
const MAX_ACTIVITY_DATA_SIZE = 200; // Maximum URLs to track in activityData

// Helper function to enforce Map size limits with LRU eviction
function enforceMapSizeLimit(map, maxSize = MAX_MAP_SIZE) {
    if (map.size > maxSize) {
        // Remove oldest 20% of entries (LRU eviction)
        const entriesToRemove = Math.floor(maxSize * 0.2);
        const iterator = map.keys();
        for (let i = 0; i < entriesToRemove; i++) {
            const key = iterator.next().value;
            if (key !== undefined) map.delete(key);
        }
    }
}

// Create unique session ID using tab ID and URL
function createTabSessionId(tabId, url) {
    const cleaned = cleanUrl(url);
    if (!cleaned || !tabId) return null;

    // Create deterministic session ID: tab_<tabId>_<urlHash>_<day>
    // Use a simple hash to keep the ID short while being unique
    const urlHash = simpleHash(cleaned).toString(36).substring(0, 8);
    const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000)); // Same day = same session
    return `tab_${tabId}_${urlHash}_${day}`;
}

// Simple hash function for URL to session ID conversion
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

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
            // DISABLED: Let tab-based time series system handle all persistence
            // await putActivityRow(payload);
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

    // ML Auto-Save DISABLED - ML modules have been removed
    // for (const url of urls) {
    //     const data = activityData[url];
    //     if (!data) continue;
    //     if (hasMinimumEngagement(data)) {
    //         (async () => {
    //             try {
    //                 await autoSavePredictor.autoSaveIfNeeded(url, data, {});
    //             } catch (err) {
    //                 console.debug('[ML] Auto-save check failed:', err.message);
    //             }
    //         })();
    //     }
    // }
}

// Flush time series events to database
async function flushTimeSeriesEvents() {
    if (!sessionEvents || sessionEvents.size === 0) return;

    const events = Array.from(sessionEvents.values());

    // Filter out invalid events before processing
    const validEvents = events.filter(event => {
        const hasData = event.timeSpent > 0 || event.clicks > 0 || event.forms > 0 || event.scrollDepth > 0;
        const hasValidUrl = event.url && isValidTrackingUrl(event.url);
        return hasData && hasValidUrl;
    });

    if (validEvents.length === 0) {
        console.log('[TimeSeries] No valid events to flush');
        try {
            if (sessionEvents && typeof sessionEvents.clear === 'function') {
                sessionEvents.clear();
            }
        } catch (e) {
            console.warn('[Activity] Failed to clear sessionEvents:', e);
            sessionEvents = new Map();
        }
        return;
    }

    console.log('[TimeSeries] Flushing', validEvents.length, 'valid events out of', events.length, 'total');

    try {
        if (sessionEvents && typeof sessionEvents.clear === 'function') {
            sessionEvents.clear();
        }
    } catch (e) {
        console.warn('[Activity] Failed to clear sessionEvents:', e);
        sessionEvents = new Map(); // Re-initialize if clear fails
    }

    for (const event of validEvents) {
        // Use tab-based session ID if available, otherwise fall back to URL-based
        const baseSessionId = event.tabSessionId || urlSessionIds.get(event.url) || currentSessionId;

        // For tab-based sessions, use the session ID directly as the event ID to ensure single record per tab+URL+day
        // This ensures the same tab+URL combination always updates the same database record
        const eventId = event.tabSessionId ? event.tabSessionId : `${baseSessionId}_${event.lastSeen}_${Math.random().toString(36).substr(2, 6)}`;

        const timeSeriesEvent = {
            id: eventId,
            url: event.url,
            timestamp: event.lastSeen, // Always update to latest timestamp
            sessionId: baseSessionId,
            metrics: {
                timeSpent: event.timeSpent, // Accumulated total time
                clicks: event.clicks, // Accumulated total clicks
                scrollDepth: event.scrollDepth, // Max scroll depth reached
                forms: event.forms, // Accumulated total forms
                interactions: [...new Set(event.interactions)] // Dedupe interactions
            },
            context: {
                tabId: currentActive.tabId,
                sessionStart: event.firstSeen, // Keep original start time
                duration: event.lastSeen - event.firstSeen, // Total session duration
                continued: event.sessionContinued || false,
                lastUpdate: Date.now() // Track when this record was last updated
            }
        };

        try {
            // Since we're using consistent IDs, this will either create or update the existing record
            await putActivityTimeSeriesEvent(timeSeriesEvent);
            console.log('[TimeSeries] Stored/updated session:', eventId, 'time:', event.timeSpent);
        } catch (e) {
            console.warn('[TimeSeries] Failed to store event:', e);
        }
    }
}

// Accumulate time for a URL
async function accumulateTime(url, now = Date.now()) {
    if (!url || !currentActive.since) return;

    // Enhanced URL validation
    if (!isValidTrackingUrl(url)) {
        console.log('[Activity Debug] Skipping invalid URL:', url);
        return;
    }

    const cleaned = cleanUrl(url);
    if (!cleaned) return;

    const delta = Math.max(0, now - currentActive.since);

    // Debug logging for tracking
    if (delta > 1000) {
        console.log(`[Activity Debug] Tracking ${delta}ms for ${cleaned} (Active: ${currentActive.url === url})`);
    }

    // Initialize activity data if needed
    if (!activityData[cleaned]) {
        activityData[cleaned] = initActivityData(url);
    }

    // Track visit metadata
    const currentHour = new Date(now).getHours();
    const currentDay = new Date(now).toISOString().split('T')[0]; // YYYY-MM-DD

    // Check if this is a new session (30 min gap)
    const isNewSession = now - (activityData[cleaned].lastVisit || 0) > 30 * 60 * 1000;

    // Update visit count and times (only on new session start)
    if (isNewSession) {
        activityData[cleaned].visitCount = (activityData[cleaned].visitCount || 0) + 1;
        activityData[cleaned].visitTimes.push(currentHour);

        // Track unique days for return visits
        const previousSize = activityData[cleaned].visitDays.size;
        activityData[cleaned].visitDays.add(currentDay);
        if (activityData[cleaned].visitDays.size > previousSize) {
            activityData[cleaned].returnVisits = activityData[cleaned].visitDays.size - 1;
        }

        // Start tracking new session for bounce detection
        sessionStartTimes.set(cleaned, now);
        sessionHadInteraction.set(cleaned, false);
    }

    // Check for bounce when session ends (URL change or tab switch)
    const previousUrl = Array.from(sessionStartTimes.keys()).find(u => u !== cleaned);
    if (previousUrl && sessionStartTimes.has(previousUrl)) {
        const sessionStart = sessionStartTimes.get(previousUrl);
        const sessionDuration = now - sessionStart;
        const hadInteraction = sessionHadInteraction.get(previousUrl);

        // Bounce = session < 5s with no interactions
        if (sessionDuration < 5000 && !hadInteraction) {
            activityData[previousUrl].bounced = (activityData[previousUrl].bounced || 0) + 1;
        }

        // Store session duration
        if (!activityData[previousUrl].sessionDurations) {
            activityData[previousUrl].sessionDurations = [];
        }
        activityData[previousUrl].sessionDurations.push(sessionDuration);

        // Clean up old session tracking
        sessionStartTimes.delete(previousUrl);
        sessionHadInteraction.delete(previousUrl);
    }

    activityData[cleaned].lastVisit = now;

    // Smart time tracking logic
    const isCurrentlyActive = currentActive.url === url;
    const sessionEvent = sessionEvents.get(cleaned);

    // Check for audio activity (from generic heartbeats or legacy whitelist)
    const isAudioSite = isAudioStreamingSite(cleaned);
    const hasAudioActivity = sessionEvent ? sessionEvent.hasAudio : false;

    // Track time if:
    // 1. Currently active tab (visual engagement)
    // 2. Audio is PLAYING (detected via heartbeat) - Generic Support
    // 3. Audio site fallback (legacy)
    const shouldTrackTime = isCurrentlyActive || (hasAudioActivity === true);

    if (shouldTrackTime) {
        // Simplified time weighting
        const timeWeight = isCurrentlyActive ? 1.0 : 0.5; // Reduced from 0.3 to 0.5 for background audio
        const weightedDelta = Math.floor(delta * timeWeight);

        activityData[cleaned].time = (activityData[cleaned].time || 0) + weightedDelta;

        // Only mark dirty if engagement meets minimum threshold
        if (hasMinimumEngagement(activityData[cleaned])) {
            activityDirty.add(cleaned);
        }
    } else {
        // Not tracking time for this URL
        return;
    }

    // Track time series event using tab-based sessions
    const tabSessionId = createTabSessionId(currentActive.tabId, url);
    if (!tabSessionId) return;

    const existingTabSession = tabSessions.get(tabSessionId);
    const SESSION_CONTINUITY_MS = 30 * 60 * 1000; // 30 minutes for same tab

    if (!sessionEvents.has(cleaned)) {
        // Check if we should continue an existing tab session
        const shouldContinue = existingTabSession && (now - existingTabSession.lastSeen) < SESSION_CONTINUITY_MS;

        // Use tab-based session ID
        urlSessionIds.set(cleaned, tabSessionId);

        sessionEvents.set(cleaned, {
            url: cleaned,
            timeSpent: shouldContinue ? existingTabSession.timeSpent : 0,
            clicks: shouldContinue ? existingTabSession.clicks : 0,
            scrollDepth: shouldContinue ? existingTabSession.scrollDepth : 0,
            forms: shouldContinue ? existingTabSession.forms : 0,
            interactions: shouldContinue ? [...existingTabSession.interactions] : [],
            firstSeen: shouldContinue ? existingTabSession.firstSeen : now,
            lastSeen: now,
            sessionContinued: shouldContinue,
            hasAudio: shouldContinue ? existingTabSession.hasAudio : false,
            isAudioSite: isAudioSite,
            tabSessionId: tabSessionId  // FIXED: Add tab session ID
        });

        // Memory optimization: Enforce size limits
        enforceMapSizeLimit(sessionEvents);
        enforceMapSizeLimit(urlSessionIds);
    }

    if (!sessionEvent) return;

    // Apply time weight for session tracking too
    const timeWeight = isCurrentlyActive ? 1.0 : 0.3;
    const weightedDelta = Math.floor(delta * timeWeight);

    sessionEvent.timeSpent += weightedDelta;
    sessionEvent.lastSeen = now;

    // Update persistent tab session tracking
    tabSessions.set(tabSessionId, {
        timeSpent: sessionEvent.timeSpent,
        clicks: sessionEvent.clicks,
        scrollDepth: sessionEvent.scrollDepth,
        forms: sessionEvent.forms,
        interactions: sessionEvent.interactions,
        firstSeen: sessionEvent.firstSeen,
        lastSeen: now,
        hasAudio: sessionEvent.hasAudio,
        isAudioSite: sessionEvent.isAudioSite,
        tabId: currentActive.tabId,
        url: cleaned
    });

    // Also maintain urlSessions for backward compatibility
    urlSessions.set(cleaned, tabSessions.get(tabSessionId));

    // Memory optimization: Enforce size limits
    enforceMapSizeLimit(tabSessions);
    enforceMapSizeLimit(urlSessions);
    enforceMapSizeLimit(urlSessionIds);
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

        // Store page title and classify page type
        if (tab?.url) {
            const cleaned = cleanUrl(tab.url);
            if (cleaned && activityData[cleaned]) {
                activityData[cleaned].title = tab.title || '';
                if (!activityData[cleaned].pageType) {
                    activityData[cleaned].pageType = classifyPageType(tab.url, tab.title || '');
                }
            }
        }
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

    // Update title and page type when available
    if (changeInfo.title && currentActive.url) {
        const cleaned = cleanUrl(currentActive.url);
        if (cleaned && activityData[cleaned]) {
            activityData[cleaned].title = changeInfo.title;
            if (!activityData[cleaned].pageType) {
                activityData[cleaned].pageType = classifyPageType(currentActive.url, changeInfo.title);
            }
        }
    }
}

// Initialize activity tracking
export function initializeActivityTracking() {
    let flushIntervalId = null;
    let isUserActive = true;

    // Start flush interval
    const startFlushInterval = () => {
        if (!flushIntervalId) {
            flushIntervalId = setInterval(() => {
                if (isUserActive) {
                    flushActivityBatch().catch(() => { });
                    flushTimeSeriesEvents().catch(() => { });
                }
            }, 5000);
        }
    };

    // Stop flush interval
    const stopFlushInterval = () => {
        if (flushIntervalId) {
            clearInterval(flushIntervalId);
            flushIntervalId = null;
        }
    };

    // Start the interval initially
    startFlushInterval();

    // NOTE: Daily cleanup is now handled by chrome.alarms in background.js
    // Removed duplicate 24-hour setInterval to reduce CPU usage

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

    // Pause/resume time counting AND flush interval based on OS idle state
    chrome.idle.onStateChanged.addListener((state) => {
        const now = Date.now();
        if (state === 'idle' || state === 'locked') {
            // User is idle - pause flushing to save CPU
            isUserActive = false;

            if (currentActive.url) accumulateTime(currentActive.url, now);
            currentActive.since = 0;
            flushActivityBatch().catch(() => { });
            flushTimeSeriesEvents().catch(() => { });
            // Clear sessions on idle (natural session break)
            try {
                if (urlSessions && typeof urlSessions.clear === 'function') {
                    urlSessions.clear();
                }
                if (tabSessions && typeof tabSessions.clear === 'function') {
                    tabSessions.clear();
                }
            } catch (e) {
                console.warn('[Activity] Failed to clear urlSessions/tabSessions:', e);
                urlSessions = new Map();
                tabSessions = new Map();
            }
            try {
                if (urlSessionIds && typeof urlSessionIds.clear === 'function') {
                    urlSessionIds.clear();
                }
                if (sessionEvents && typeof sessionEvents.clear === 'function') {
                    sessionEvents.clear();
                }
            } catch (e) {
                console.warn('[Activity] Failed to clear urlSessionIds/sessionEvents:', e);
                urlSessionIds = new Map();
                sessionEvents = new Map();
            }

            // Memory optimization: Clear old activityData entries
            const activityDataKeys = Object.keys(activityData);
            if (activityDataKeys.length > MAX_ACTIVITY_DATA_SIZE) {
                // Keep only the most recently visited URLs
                const sorted = activityDataKeys
                    .map(url => ({ url, lastVisit: activityData[url]?.lastVisit || 0 }))
                    .sort((a, b) => b.lastVisit - a.lastVisit)
                    .slice(0, MAX_ACTIVITY_DATA_SIZE);

                const newActivityData = {};
                sorted.forEach(({ url }) => {
                    newActivityData[url] = activityData[url];
                });
                activityData = newActivityData;
            }

            // Start new session when returning from idle
            currentSessionId = `session_${now}_${Math.random().toString(36).substr(2, 9)}`;
            sessionStartTime = now;
        } else if (state === 'active') {
            // User is active - resume flushing
            isUserActive = true;

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

    // Enhanced URL validation
    if (!isValidTrackingUrl(sender.tab.url)) {
        console.log('[Activity Debug] Skipping message - invalid tracking URL:', sender.tab.url);
        return;
    }

    const cleaned = cleanUrl(sender.tab.url);
    if (!cleaned) {
        console.log('[Activity Debug] Skipping message - could not clean URL:', sender.tab.url);
        return;
    }

    console.log('[Activity Debug] Processing activity for URL:', cleaned, 'type:', msg.type);

    if (!activityData[cleaned]) {
        activityData[cleaned] = initActivityData(sender.tab.url);
    }

    // Create tab-based session ID for this message
    const tabSessionId = createTabSessionId(sender.tab.id, sender.tab.url);
    const existingTabSession = tabSessions.get(tabSessionId);

    if (!sessionEvents.has(cleaned)) {
        // Check if we should continue existing tab session
        const now = Date.now();
        const shouldContinue = existingTabSession && (now - existingTabSession.lastSeen) < (30 * 60 * 1000);

        sessionEvents.set(cleaned, {
            url: cleaned,
            timeSpent: shouldContinue ? existingTabSession.timeSpent : 0,
            clicks: shouldContinue ? existingTabSession.clicks : 0,
            scrollDepth: shouldContinue ? existingTabSession.scrollDepth : 0,
            forms: shouldContinue ? existingTabSession.forms : 0,
            interactions: shouldContinue ? [...existingTabSession.interactions] : [],
            firstSeen: shouldContinue ? existingTabSession.firstSeen : now,
            lastSeen: now,
            hasAudio: shouldContinue ? existingTabSession.hasAudio : false,
            isAudioSite: isAudioStreamingSite(cleaned),
            tabSessionId: tabSessionId
        });
        console.log('[Activity Debug] Created/continued tab session for:', cleaned, 'tabId:', sender.tab.id);
    }
    const sessionEvent = sessionEvents.get(cleaned);

    if (msg.type !== 'visibility') {
        // Mark that this session had interaction (for bounce tracking)
        sessionHadInteraction.set(cleaned, true);

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
            case 'audioDetected': // Legacy Event
            case 'audioHeartbeat': // Generic Event
                sessionEvent.hasAudio = msg.playing !== false;
                sessionEvent.lastSeen = Date.now();

                // If Playing audio in background, we need to accumulate time explicitly
                // because accumulateTime() normally only runs for currentActive.url unless triggered here
                if (sessionEvent.hasAudio && currentActive.url !== sender.tab.url) {
                    // Force accumulation for this background tab
                    // timeWeight will be determined by activity logic (0.5 for background)
                    const fakeNow = Date.now();
                    // Delta is roughly the heartbeat interval (5000ms) or calc from last seen
                    accumulateTime(sender.tab.url, fakeNow, true); // Add force flag if needed, or just call it
                }
                break;
            case 'navigation':
                // SPA Navigation (History API)
                if (cleaned && activityData[cleaned]) {
                    // Just update last seen to keep session alive
                    sessionEvent.lastSeen = Date.now();
                    console.log('[Activity Debug] SPA Navigation detected for', cleaned);
                }
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

        // Calculate engagement score for better tracking
        const engagementScore = calculateEngagementScore(activityData[cleaned]);
        console.log('[Activity Debug] Engagement score for', cleaned, ':', engagementScore);

        // Only mark for persistence if engagement meets minimum threshold
        if (hasMinimumEngagement(activityData[cleaned])) {
            activityDirty.add(cleaned);
            console.log('[Activity Debug] Added to dirty set (meets engagement threshold):', cleaned);

            // Update persistent tab session with engagement score
            if (tabSessionId) {
                tabSessions.set(tabSessionId, {
                    timeSpent: sessionEvent.timeSpent,
                    clicks: sessionEvent.clicks,
                    scrollDepth: sessionEvent.scrollDepth,
                    forms: sessionEvent.forms,
                    interactions: sessionEvent.interactions,
                    firstSeen: sessionEvent.firstSeen,
                    lastSeen: sessionEvent.lastSeen,
                    hasAudio: sessionEvent.hasAudio,
                    isAudioSite: sessionEvent.isAudioSite,
                    engagementScore: engagementScore,
                    tabId: sender.tab.id,
                    url: cleaned
                });

                // Also maintain urlSessions for backward compatibility
                urlSessions.set(cleaned, tabSessions.get(tabSessionId));

                // Memory optimization: Enforce size limits
                enforceMapSizeLimit(tabSessions);
                enforceMapSizeLimit(urlSessions);
            }
        } else {
            console.log('[Activity Debug] Skipping persistence (below engagement threshold):', cleaned);
        }
    }
}

// Message handling functions for activity-related requests (called from main background script)
export async function handleGetActivityData(msg, sender, sendResponse) {
    console.log('[Activity Debug] HANDLER ENTRY - handleGetActivityData called');

    try {
        // Method 1: Filter by specific URL (Primary Use Case for Popover)
        if (msg.url) {
            const requestedCleaned = cleanUrl(msg.url);
            console.log('[Activity Debug] Fetching persistent analytics for:', msg.url, '->', requestedCleaned);

            // fetch from DB (Persistent)
            // fetch from DB (Persistent) with 3s timeout
            const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ success: false, timeout: true }), 3000));
            const dbPromise = getUrlAnalytics(msg.url).catch(err => ({ success: false, error: err }));

            const dbStats = await Promise.race([dbPromise, timeoutPromise]);

            if (dbStats.timeout) {
                console.warn('[Activity Debug] DB fetch timed out for:', msg.url);
            }

            console.log('[Activity Debug] DB Stats result:', JSON.stringify(dbStats));

            // Fetch from Memory (Current Session - not yet flushed)
            const memoryData = activityData[requestedCleaned];
            console.log('[Activity Debug] Memory data check complete');

            // Merge Memory into DB Stats for most up-to-date view
            // Note: DB stats are from 'activity_series', which are flushed events.
            // 'activityData' is the current aggregation buffer.

            // Unwrap data from error handler wrapper
            const responseStats = { ...(dbStats?.data || dbStats || {}) };
            console.log('[Activity Debug] Unwrapped stats:', responseStats);

            if (memoryData) {
                console.log('[Activity Debug] Merging memory data');
                // If we have current session data, we might want to display it.
                // However, simple summing might double-count if the session was partially flushed.
                // For now, let's trust the DB stats as the "committed" truth, 
                // but if DB is empty (0 visits), use memory.
                if (responseStats.totalVisits === 0 && memoryData.visitCount > 0) {
                    responseStats.totalVisits = memoryData.visitCount;
                    responseStats.totalTime = memoryData.time;
                    responseStats.lastVisit = memoryData.lastVisit;
                }
            }

            console.log('[Activity Debug] Returning combined stats:', responseStats);

            sendResponse({
                ok: true,
                rows: [responseStats], // Return as array to match expected format
                fromDb: true
            });
            return;
        }

        // Method 2: Get All Activity (Legacy/Dashboard Use Case)
        // Use in-memory activity data (background scripts can't access IndexedDB easily)
        console.log('[Activity Debug] Using in-memory activity data for bulk request');
        // ... (rest of legacy logic remains if needed, but primary use is msg.url)

        const memoryRows = Object.entries(activityData).map(([url, data]) => ({
            url,
            time: data.time || 0,
            clicks: data.clicks || 0,
            scroll: data.scroll || 0,
            forms: data.forms || 0,
            visitCount: data.visitCount || 0,
            returnVisits: data.returnVisits || 0,
            lastVisit: data.lastVisit || 0,
            visitTimes: data.visitTimes || [],
            sessionDurations: data.sessionDurations || [],
            bounced: data.bounced || 0,
            title: data.title || '',
            domain: data.domain || '',
            pageType: data.pageType || 'general',
            firstVisit: data.firstVisit || 0,
            visitDays: Array.from(data.visitDays || [])
        }));

        const finalRows = memoryRows
            .filter(row => row.time > 0 || row.clicks > 0 || row.scroll > 0 || row.forms > 0)
            .sort((a, b) => b.time - a.time);

        sendResponse({ ok: true, rows: finalRows, fromMemory: true });

    } catch (error) {
        console.error('[Activity Debug] HANDLER ERROR:', error);
        sendResponse({ ok: false, error: String(error) });
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

        sendResponse({ ok: true, rows: sorted });@
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
    if (!tabSessions || typeof tabSessions.clear !== 'function') {
        console.warn('[Activity] Re-initializing tabSessions Map');
        tabSessions = new Map();
    }

    initializeActivityTracking();
}

// Export activity data for other modules
export { accumulateTime, activityData, currentActive };

