/**
 * Search Indexer - Background Service
 * Proactively builds a local search index in chrome.storage.local
 * enabling instant "Zero Latency" search for the UI.
 * 
 * Enriched with Activity Data for smart ranking.
 */
import { getAllActivity, listAllUrlNotes, listNotes, listScrapedChats, listWorkspaces } from '../db/index.js';

const STORAGE_KEY = 'search_index';
const MAX_HISTORY = 200;
const MAX_BOOKMARKS = 500;
const MAX_ACTIVITY_ITEMS = 500;
const DEBOUNCE_MS = 2000;

let debounceTimer = null;
let isIndexing = false;

/**
 * Initialize the Search Indexer
 * Sets up listeners for Tabs, History, Bookmarks, and DB changes.
 */
export function initializeSearchIndexer() {
    try {
        console.log('[SearchIndexer] Initializing...');

        // 1. Tab Listeners
        if (chrome.tabs) {
            chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
                if (changeInfo.status === 'complete' || changeInfo.title) triggerIndexRebuild();
            });
            chrome.tabs.onRemoved.addListener(() => triggerIndexRebuild());
            chrome.tabs.onCreated.addListener(() => triggerIndexRebuild());
        }

        // 2. History Listeners
        if (chrome.history) {
            chrome.history.onVisited.addListener(() => triggerIndexRebuild());
            chrome.history.onVisitRemoved.addListener(() => triggerIndexRebuild());
        }

        // 3. Bookmark Listeners
        if (chrome.bookmarks) {
            chrome.bookmarks.onCreated.addListener(() => triggerIndexRebuild());
            chrome.bookmarks.onRemoved.addListener(() => triggerIndexRebuild());
            chrome.bookmarks.onChanged.addListener(() => triggerIndexRebuild());
            chrome.bookmarks.onMoved.addListener(() => triggerIndexRebuild());
        }

        // 4. Database Listeners (via BroadcastChannel)
        try {
            const bc = new BroadcastChannel('ws_db_changes');
            bc.onmessage = () => triggerIndexRebuild();

            const bcSettings = new BroadcastChannel('settings_db_changes');
            bcSettings.onmessage = () => triggerIndexRebuild();
        } catch (e) {
            console.warn('[SearchIndexer] BroadcastChannel not supported', e);
        }

        // Initial build
        triggerIndexRebuild();

    } catch (e) {
        console.error('[SearchIndexer] Failed to initialize:', e);
    }
}

export function triggerIndexRebuild() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(buildIndex, DEBOUNCE_MS);
}

export async function forceIndexRebuild() {
    if (debounceTimer) clearTimeout(debounceTimer);
    return buildIndex();
}

/**
 * Core Indexing Logic
 */
async function buildIndex() {
    if (isIndexing) return;
    isIndexing = true;
    const startTime = Date.now();

    try {
        // console.log('[SearchIndexer] Building index...');

        // 1. Fetch all data
        const [
            tabs,
            historyItems,
            bookmarkTree,
            workspaces,
            notes,
            scrapedChats,
            urlNotes,
            activityResult
        ] = await Promise.all([
            fetchTabs(),
            fetchHistory(),
            fetchBookmarks(),
            listWorkspaces().catch(e => []),
            listNotes().catch(e => []),
            listScrapedChats().catch(e => []),
            listAllUrlNotes().catch(e => []),
            getAllActivity({ limit: MAX_ACTIVITY_ITEMS, sortBy: 'time' }).catch(e => ({ data: [] }))
        ]);

        // Optimize Activity Map
        // Map domain -> activityScore
        const activityMap = new Map();
        const activityRows = activityResult?.data || (Array.isArray(activityResult) ? activityResult : []);

        // Ensure activityRows is an array before calling forEach
        if (Array.isArray(activityRows)) {
            activityRows.forEach(row => {
                // row.url is usually the domain/key
                if (!row || !row.url) return;

                // Calculate Boost Score
                const timeScore = Math.min((Number(row.time) || 0) / 60000, 20); // up to 20 pts (1 pt per min)
                const visitScore = Math.min((Number(row.visitCount) || 0) * 1, 15); // up to 15 pts
                const clickScore = Math.min((Number(row.clicks) || 0) * 1, 10); // up to 10 pts

                const totalBoost = Math.floor(timeScore + visitScore + clickScore);
                activityMap.set(row.url, totalBoost);
            });
        }

        // 2. Normalize Data
        let index = [];

        // Helper to get domain boost
        const getBoost = (url) => {
            if (!url) return 0;
            try {
                const hostname = new URL(url).hostname;
                // Try exact hostname
                if (activityMap.has(hostname)) return activityMap.get(hostname);
                // Try without www
                const domain = hostname.replace('www.', '');
                if (activityMap.has(domain)) return activityMap.get(domain);
                return 0;
            } catch { return 0; }
        };

        // Helper to filter out low-value URLs (signin, login, etc.)
        const isLowValueUrl = (url) => {
            if (!url) return false;
            const urlLower = url.toLowerCase();
            const pathLower = urlLower.split('?')[0]; // Ignore query params

            // Exclude common utility/auth pages
            const excludePatterns = [
                '/signin', '/login', '/auth', '/logout', '/register', '/signup',
                '/password', '/reset', '/verify', '/confirm', '/activate',
                '/oauth', '/sso', '/saml', '/callback', '/redirect',
                '/error', '/404', '/403', '/500',
                'accounts.google.com', 'login.microsoftonline.com',
                'auth0.com/login', 'okta.com/login'
            ];

            return excludePatterns.some(pattern => pathLower.includes(pattern));
        };

        // --- TABS ---
        if (Array.isArray(tabs)) {
            tabs.forEach(tab => {
                // Skip low-value URLs
                if (isLowValueUrl(tab.url)) return;

                index.push({
                    i: `tab_${tab.id}`,
                    t: 'tab',
                    l: tab.title,
                    u: tab.url,
                    d: 'Open Tab',
                    f: tab.favIconUrl,
                    c: 'Open Tab',
                    tabId: tab.id, // Add tabId for tab switching
                    scoreBase: 150 + (index.length < 5 ? 10 : 0) // Higher priority for active tabs
                });
            });
        }

        // --- WORKSPACES ---
        // Handle both array format and { success, data } format from listWorkspaces
        const workspaceList = Array.isArray(workspaces) ? workspaces : (workspaces?.data || []);
        console.log('[SearchIndexer] Workspaces fetched:', workspaceList.length);
        if (workspaceList.length > 0) {
            let totalUrls = 0;
            workspaceList.forEach(ws => {
                console.log('[SearchIndexer] Processing workspace:', ws.name, 'with', (ws.urls || []).length, 'URLs');
                index.push({
                    i: `ws_${ws.id}`,
                    t: 'workspace',
                    l: ws.name,
                    d: `${(ws.urls || []).length} items`,
                    c: 'Workspace',
                    scoreBase: 110 // Higher priority for workspaces
                });

                (ws.urls || []).forEach(urlItem => {
                    const url = typeof urlItem === 'string' ? urlItem : urlItem.url;
                    const title = typeof urlItem === 'string' ? '' : urlItem.title;
                    if (url && !isLowValueUrl(url)) { // Skip low-value URLs
                        totalUrls++;
                        index.push({
                            i: `ws_link_${ws.id}_${url}`,
                            t: 'workspace-url',
                            l: title || url,
                            u: url,
                            d: `in ${ws.name}`,
                            f: typeof urlItem === 'object' ? urlItem.favicon : null,
                            c: 'Saved Link',
                            scoreBase: 120 + getBoost(url) // Higher priority for saved items
                        });
                    }
                });
            });
            console.log('[SearchIndexer] Total workspace URLs indexed:', totalUrls);
        } else {
            console.warn('[SearchIndexer] No workspaces found to index!');
        }

        // --- COMMANDS REMOVED ---
        // Commands are no longer indexed to avoid weird/old suggestions
        // Users can still execute commands by typing them directly

        // --- NOTES ---
        if (Array.isArray(notes)) {
            notes.forEach(note => {
                index.push({
                    i: `note_${note.id}`,
                    t: 'note',
                    l: note.title || 'Untitled Note',
                    d: (note.content || '').substring(0, 50),
                    c: 'Note',
                    scoreBase: 80
                });
            });
        }

        // --- URL NOTES ---
        if (Array.isArray(urlNotes)) {
            urlNotes.forEach(note => {
                index.push({
                    i: `urlnote_${note.id}`,
                    t: note.type === 'highlight' ? 'highlight' : 'url-note',
                    l: note.text ? note.text.substring(0, 50) : 'URL Note',
                    u: note.url,
                    d: note.url,
                    c: note.type === 'highlight' ? 'Highlight' : 'URL Note',
                    scoreBase: 75 + getBoost(note.url)
                });
            });
        }

        // --- HISTORY ---
        if (Array.isArray(historyItems)) {
            historyItems.forEach(h => {
                // Skip low-value URLs
                if (isLowValueUrl(h.url)) return;

                const boost = getBoost(h.url);
                index.push({
                    i: `hist_${h.id}`,
                    t: 'history',
                    l: h.title || h.url,
                    u: h.url,
                    d: h.url,
                    c: 'History',
                    v: h.visitCount,
                    scoreBase: 70 + Math.min(h.visitCount || 0, 20) + boost // Better scoring for frequently visited
                });
            });
        }

        // --- BOOKMARKS ---
        const flatBookmarks = flattenBookmarks(bookmarkTree);
        if (Array.isArray(flatBookmarks)) {
            flatBookmarks.forEach(b => {
                // Skip low-value URLs
                if (isLowValueUrl(b.url)) return;

                index.push({
                    i: `bm_${b.id}`,
                    t: 'bookmark',
                    l: b.title,
                    u: b.url,
                    d: b.url,
                    c: 'Bookmark',
                    scoreBase: 90 + getBoost(b.url) // Higher priority for bookmarks
                });
            });
        }

        // --- SCRAPED CHATS ---
        if (Array.isArray(scrapedChats)) {
            scrapedChats.forEach(chat => {
                // Skip low-value URLs
                if (isLowValueUrl(chat.url)) return;

                index.push({
                    i: `chat_${chat.chatId}`,
                    t: 'scraped-chat',
                    l: chat.title || 'AI Chat',
                    u: chat.url,
                    d: `from ${chat.platform}`,
                    c: 'AI Chat',
                    scoreBase: 60 + getBoost(chat.url)
                });
            });
        }

        // 3. Deduplicate by URL - keep highest scored entry
        const urlMap = new Map();
        index.forEach(item => {
            if (!item.u) {
                // No URL (workspace, note, etc.) - keep as is
                urlMap.set(item.i, item);
                return;
            }

            const existing = urlMap.get(item.u);
            if (!existing || item.scoreBase > existing.scoreBase) {
                // Keep the higher scored entry
                urlMap.set(item.u, item);
            }
        });

        // Convert back to array
        index = Array.from(urlMap.values());
        console.log(`[SearchIndexer] Deduplicated: ${index.length} unique items`);

        // 4. Save to Storage
        const payload = {
            timestamp: Date.now(),
            items: index
        };

        await chrome.storage.local.set({ [STORAGE_KEY]: payload });
        console.log(`[SearchIndexer] Rebuilt index: ${index.length} items with activity data.`);

    } catch (e) {
        console.error('[SearchIndexer] Build failed:', e);
    } finally {
        isIndexing = false;
    }
}

// --- Helpers ---

async function fetchTabs() {
    if (!chrome.tabs) return [];
    try {
        return await chrome.tabs.query({});
    } catch (e) { return []; }
}

async function fetchHistory() {
    if (!chrome.history) return [];
    try {
        return await chrome.history.search({
            text: '',
            maxResults: MAX_HISTORY,
            startTime: Date.now() - (90 * 24 * 60 * 60 * 1000) // 90 days instead of 30
        });
    } catch (e) { return []; }
}

async function fetchBookmarks() {
    if (!chrome.bookmarks) return [];
    try {
        return await chrome.bookmarks.getTree();
    } catch (e) { return []; }
}

function flattenBookmarks(nodes) {
    let result = [];
    if (!nodes) return result;

    const traverse = (node) => {
        if (node.url) {
            result.push(node);
            if (result.length >= MAX_BOOKMARKS) return;
        }
        if (node.children) {
            node.children.forEach(traverse);
        }
    };

    if (Array.isArray(nodes)) {
        nodes.forEach(traverse);
    } else {
        traverse(nodes);
    }
    return result;
}
