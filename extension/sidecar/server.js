
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

// Local LLM imports
import * as localLLM from './localLLM.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==========================================
// SYNC DATA STORAGE
// ==========================================

const DATA_DIR = join(process.cwd(), 'sync-data');
if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}
const DATA_FILE = join(DATA_DIR, 'sync-data.json');

// In-memory sync data store
let syncData = {
    workspaces: [],
    urls: [],
    settings: {},
    activity: [],
    notes: [],
    urlNotes: [],
    pins: [],
    scrapedChats: [],
    scrapedConfigs: [],
    dailyMemory: [],
    uiState: {},
    dashboard: {},
    // Tabs stored per device: Map<deviceId, Tab[]>
    // Note: This Map is NOT persisted to disk (tabs are transient)
    // It's reconstructed from connected browser extensions on startup
    deviceTabsMap: new Map(),
    tabs: [], // Aggregated view of all device tabs
    lastUpdated: {}
};

/**
 * Recompute aggregated tabs from deviceTabsMap
 */
function recomputeAggregatedTabs() {
    // Safety check: ensure deviceTabsMap is a proper Map
    if (!(syncData.deviceTabsMap instanceof Map)) {
        console.warn('[Sidecar] deviceTabsMap was not a Map, reinitializing...');
        syncData.deviceTabsMap = new Map();
    }

    const allTabs = [];
    for (const [deviceId, devTabs] of syncData.deviceTabsMap.entries()) {
        // Add deviceId to each tab for tracking
        const tabsWithDevice = devTabs.map(t => ({ ...t, _deviceId: deviceId }));
        allTabs.push(...tabsWithDevice);
    }
    syncData.tabs = allTabs;
    syncData.lastUpdated.tabs = Date.now();
    console.log(`[Sidecar] Recomputed tabs: ${allTabs.length} total from ${syncData.deviceTabsMap.size} devices`);
    return allTabs;
}

// Load persisted data on startup
function loadData() {
    try {
        if (existsSync(DATA_FILE)) {
            // NO_OP - view file firstng file content firsteadFileSync(DATA_FILE, 'utf-8');
            const content = readFileSync(DATA_FILE, 'utf-8');
            const loaded = JSON.parse(content);
            // Merge with default structure to ensure all keys exist
            // BUT preserve deviceTabsMap as a Map (it's not persisted)
            const preservedMap = syncData.deviceTabsMap;
            syncData = { ...syncData, ...loaded };
            // Restore the Map - it gets destroyed by JSON parse/spread
            syncData.deviceTabsMap = preservedMap;
            // Also ensure tabs array is fresh (will be populated by connected browsers)
            syncData.tabs = [];
            console.log('[Sidecar] Loaded sync data from disk');
        }
    } catch (error) {
        console.warn('[Sidecar] Failed to load sync data:', error);
    }
}

// Save data to disk
function saveData() {
    try {
        // We cannot save the Map directly, so it will be lost on JSON.stringify
        // This is intended as tabs are transient
        writeFileSync(DATA_FILE, JSON.stringify(syncData, null, 2));
    } catch (error) {
        console.warn('[Sidecar] Failed to save sync data:', error);
    }
}

// Load data immediately
loadData();

// ==========================================
// CHANGE DETECTION FOR SYNC
// ==========================================

// Hash tracking to avoid broadcasting unchanged data
const lastBroadcastHash = {};

function simpleHash(data) {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
}

function hasDataChanged(type, data) {
    const currentHash = simpleHash(data);
    const lastHash = lastBroadcastHash[type];
    if (currentHash === lastHash) {
        return false;
    }
    lastBroadcastHash[type] = currentHash;
    return true;
}

// ==========================================
// MERGE HELPERS
// ==========================================

// Merge arrays by ID (last-write-wins based on updatedAt)
function mergeArrayById(local, remote, type = 'default') {
    const merged = new Map();

    const getItemId = (item) => {
        if (type === 'scrapedChats') return item.chatId;
        if (type === 'scrapedConfigs') return item.domain;
        return item.id;
    };

    for (const item of local) {
        const itemId = getItemId(item);
        if (itemId) merged.set(itemId, item);
    }

    for (const item of remote) {
        const itemId = getItemId(item);
        if (!itemId) continue;
        const existing = merged.get(itemId);
        const remoteTime = item.updatedAt || item.scrapedAt || item.createdAt || 0;
        const localTime = existing?.updatedAt || existing?.scrapedAt || existing?.createdAt || 0;

        if (!existing || remoteTime >= localTime) {
            merged.set(itemId, item);
        }
    }

    return Array.from(merged.values());
}

function mergeWorkspacesByName(local, remote) {
    const merged = new Map();

    const normalizeUrl = (url) => {
        if (!url) return null;
        try {
            const u = new URL(url.startsWith('http') ? url : `https://${url}`);
            return `${u.protocol}//${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
        } catch {
            return url.toLowerCase();
        }
    };

    const dedupeUrls = (urls) => {
        if (!Array.isArray(urls)) return [];
        const seen = new Map();
        for (const urlObj of urls) {
            const normalized = normalizeUrl(urlObj?.url);
            if (!normalized) continue;
            const existing = seen.get(normalized);
            if (!existing) {
                seen.set(normalized, urlObj);
            } else {
                const existingTime = existing.addedAt || existing.createdAt || 0;
                const newTime = urlObj.addedAt || urlObj.createdAt || 0;
                if ((!existing.title && urlObj.title) || newTime > existingTime) {
                    seen.set(normalized, urlObj);
                }
            }
        }
        return Array.from(seen.values());
    };

    for (const ws of local) {
        if (!ws?.name) continue;
        const key = ws.name.toLowerCase().trim();
        merged.set(key, { ...ws, urls: dedupeUrls(ws.urls) });
    }

    for (const ws of remote) {
        if (!ws?.name) continue;
        const key = ws.name.toLowerCase().trim();
        const existing = merged.get(key);

        if (!existing) {
            merged.set(key, { ...ws, urls: dedupeUrls(ws.urls) });
        } else {
            const remoteTime = ws.updatedAt || ws.createdAt || 0;
            const localTime = existing.updatedAt || existing.createdAt || 0;
            const combinedUrls = [...(existing.urls || []), ...(ws.urls || [])];
            const dedupedUrls = dedupeUrls(combinedUrls);

            const mergedWs = remoteTime > localTime
                ? { ...ws, id: existing.id, urls: dedupedUrls }
                : { ...existing, urls: dedupedUrls, updatedAt: Math.max(remoteTime, localTime) };

            merged.set(key, mergedWs);
        }
    }

    return Array.from(merged.values());
}

// ==========================================
// HTTP SERVER
// ==========================================

const PORT = 4000;
let wss;

function broadcastToClients(type, payload) {
    if (!wss) return;
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    wss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
        }
    });
}

const httpServer = createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = body ? JSON.parse(body) : {};
                handlePostRequest(path, data, res);
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } else if (req.method === 'GET') {
        handleGetRequest(path, url, res);
    } else {
        res.writeHead(405);
        res.end();
    }
});

// WebSocket server with increased payload limit (100MB for large syncs)
wss = new WebSocketServer({
    server: httpServer,
    maxPayload: 100 * 1024 * 1024 // 100MB
});

wss.on('connection', (ws, req) => {
    // Track client info for debugging
    ws.clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    ws.clientType = 'unknown';
    ws.connectedAt = new Date().toISOString();
    ws.messageCount = 0;

    // Log all current clients for debugging
    const clientSummary = Array.from(wss.clients).map(c => c.clientType || 'unknown').join(', ');
    console.log(`[Sidecar] Client connected: ${ws.clientId} | Total: ${wss.clients.size} | Types: [${clientSummary}]`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            ws.messageCount++;

            // Identify client type from messages
            if (data.type === 'identify' && data.client) {
                // Explicit identification message
                ws.clientType = data.client;
                console.log(`[Sidecar] Client ${ws.clientId} identified as: ${ws.clientType}`);
                return; // Don't process further
            }

            if (ws.clientType === 'unknown' && data.type) {
                if (data.type === 'push-tabs' || data.type === 'push-workspaces' || data.type === 'push-activity') {
                    ws.clientType = 'syncWebSocket';
                } else if (data.type === 'request-state' || data.type === 'request.state') {
                    ws.clientType = 'extensionApi';
                } else if (data.type === 'action') {
                    ws.clientType = 'bridge';
                } else if (data.type === 'llm-request') {
                    ws.clientType = 'localAI';
                } else {
                    ws.clientType = `other:${data.type}`;
                }
                console.log(`[Sidecar] Client ${ws.clientId} identified as: ${ws.clientType}`);
            }
            handleWebSocketMessage(ws, data);
        } catch (error) {
            console.warn('[Sidecar] Invalid WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        console.log(`[Sidecar] Client disconnected: ${ws.clientId} (${ws.clientType}, ${ws.messageCount} msgs)`);
    });

    ws.on('error', (error) => {
        console.warn(`[Sidecar] WebSocket error for ${ws.clientId}:`, error.message);
    });

    // Warn about unidentified clients after 5 seconds
    setTimeout(() => {
        if (ws.readyState === ws.OPEN && ws.clientType === 'unknown') {
            console.log(`[Sidecar] WARNING: Client ${ws.clientId} still unidentified after 5s (${ws.messageCount} msgs)`);
        }
    }, 5000);

    // Send current state
    ws.send(JSON.stringify({
        type: 'sync-state',
        payload: {
            workspaces: syncData.workspaces,
            tabs: syncData.tabs,
            settings: syncData.settings,
            lastUpdated: syncData.lastUpdated
        }
    }));
});

httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`[Sidecar] Server running on http://127.0.0.1:${PORT}`);
});

httpServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.warn(`[Sidecar] Port ${PORT} already in use!`);
    } else {
        console.error('[Sidecar] HTTP server error:', error);
    }
});

// Initialize LLM
localLLM.initializeLLM().catch(err => {
    console.error('[Sidecar] Failed to initialize Local LLM:', err);
});

// ==========================================
// REQUEST HANDLERS
// ==========================================

async function handleGetRequest(path, url, res) {
    res.setHeader('Content-Type', 'application/json');

    // Map basic paths to syncData keys
    const simplePaths = {
        '/workspaces': 'workspaces',
        '/urls': 'urls',
        '/settings': 'settings',
        '/notes': 'notes',
        '/url-notes': 'urlNotes',
        '/pins': 'pins',
        '/scraped-chats': 'scrapedChats',
        '/scraped-configs': 'scrapedConfigs',
        '/daily-memory': 'dailyMemory',
        '/ui-state': 'uiState',
        '/dashboard': 'dashboard',
        '/tabs': 'tabs'
    };

    if (simplePaths[path]) {
        res.writeHead(200);
        res.end(JSON.stringify(syncData[simplePaths[path]]));
        return;
    }

    if (path === '/activity') {
        const since = url.searchParams.get('since');
        let activity = syncData.activity;
        if (since) {
            const sinceMs = parseInt(since, 10);
            activity = activity.filter(a => (a.timestamp || 0) > sinceMs);
        }
        res.writeHead(200);
        res.end(JSON.stringify(activity));
        return;
    }

    if (path === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
        return;
    }

    if (path.startsWith('/llm/')) {
        if (path === '/llm/models') {
            const models = await localLLM.getModels();
            res.writeHead(200);
            res.end(JSON.stringify(models));
            return;
        }
        if (path === '/llm/status') {
            const status = await localLLM.getStatus();
            res.writeHead(200);
            res.end(JSON.stringify(status));
            return;
        }
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
}

async function handlePostRequest(path, data, res) {
    const notifyAndUpdate = (key, payload, mergeFn) => {
        if (mergeFn) {
            syncData[key] = mergeFn(syncData[key], payload);
        } else if (Array.isArray(syncData[key])) {
            // For arrays like urls/notes/etc if no mergeFn provided, usually replace or special handle
            // But existing logic varied. Let's simplify:
            // If payload is array, replace (unless merge logic specific)
            syncData[key] = Array.isArray(payload) ? payload : [];
        } else {
            // Object merge
            syncData[key] = { ...syncData[key], ...payload };
        }

        syncData.lastUpdated[key] = Date.now();
        saveData();

        // Notify clients via WS
        // Note: Electron used `notifyRenderer` (IPC) and `broadcastToClients` (WS).
        // Here, everything is WS.
        broadcastToClients(`${key.replace(/([A-Z])/g, "-$1").toLowerCase()}-updated`, syncData[key]);
    };

    // Command handlers
    if (path === '/cmd/jump-to-tab') {
        const { tabId, windowId } = data;
        if (tabId) {
            console.log(`[Sidecar] Broadcasting jump-to-tab: ${tabId}`);
            broadcastToClients('jump-to-tab', { tabId, windowId });
            res.writeHead(200);
            res.end(JSON.stringify({ success: true }));
        } else {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing tabId' }));
        }
        return;
    }

    // LLM handlers
    if (path.startsWith('/llm/')) {
        try {
            if (path === '/llm/download') {
                const { modelName } = data;
                // Pass progress callback if supported
                const result = await localLLM.downloadModel(modelName, (progress) => {
                    broadcastToClients('llm-download-progress', { modelName, progress });
                });
                res.writeHead(200);
                res.end(JSON.stringify(result));
                return;
            }
            if (path === '/llm/load') {
                const { modelName } = data;
                broadcastToClients('llm-loading', { modelName });
                const result = await localLLM.loadModel(modelName);
                if (result.ok) {
                    broadcastToClients('llm-loaded', { modelName });
                } else {
                    broadcastToClients('llm-error', { error: result.error });
                }
                res.writeHead(200);
                res.end(JSON.stringify(result));
                return;
            }
            if (path === '/llm/unload') {
                const result = await localLLM.unloadModel();
                broadcastToClients('llm-unloaded', {});
                res.writeHead(200);
                res.end(JSON.stringify(result));
                return;
            }
        } catch (e) {
            console.error('[Sidecar] LLM Error:', e);
            broadcastToClients('llm-error', { error: e.message });
            res.writeHead(500);
            res.end(JSON.stringify({ ok: false, error: e.message }));
            return;
        }
    }

    switch (path) {
        case '/workspaces':
            const incomingWorkspaces = Array.isArray(data) ? data : [];
            syncData.workspaces = mergeWorkspacesByName(syncData.workspaces, incomingWorkspaces);
            syncData.lastUpdated.workspaces = Date.now();
            saveData();
            broadcastToClients('workspaces-updated', syncData.workspaces);
            break;

        case '/urls': notifyAndUpdate('urls', data); break;
        case '/settings': notifyAndUpdate('settings', data); break;

        case '/activity':
            const activities = Array.isArray(data) ? data : [data];
            syncData.activity = [...syncData.activity, ...activities].slice(-1000);
            syncData.lastUpdated.activity = Date.now();
            saveData();
            broadcastToClients('activity-updated', activities);
            break;

        case '/notes': notifyAndUpdate('notes', data); break;
        case '/url-notes': notifyAndUpdate('urlNotes', data); break;
        case '/pins': notifyAndUpdate('pins', data); break;
        case '/scraped-chats': notifyAndUpdate('scrapedChats', data); break;
        case '/scraped-configs': notifyAndUpdate('scrapedConfigs', data); break;
        case '/daily-memory': notifyAndUpdate('dailyMemory', data); break;
        case '/ui-state': notifyAndUpdate('uiState', data); break;
        case '/dashboard': notifyAndUpdate('dashboard', data); break;

        case '/tabs':
            let httpTabs = [];
            let httpDeviceId = 'http-unknown';
            if (Array.isArray(data)) {
                httpTabs = data;
            } else if (data && Array.isArray(data.tabs)) {
                httpTabs = data.tabs;
                httpDeviceId = data.deviceId || 'http-unknown';
            }
            syncData.deviceTabsMap.set(httpDeviceId, httpTabs);
            recomputeAggregatedTabs();
            broadcastToClients('tabs-updated', syncData.tabs);
            break;

        case '/sync':
            // Full sync merge logic (simplified for sidecar)
            if (data.workspaces) syncData.workspaces = mergeWorkspacesByName(syncData.workspaces, data.workspaces);
            if (data.urls) syncData.urls = mergeArrayById(syncData.urls, data.urls);
            if (data.tabs) syncData.tabs = data.tabs;
            if (data.settings) syncData.settings = { ...syncData.settings, ...data.settings };
            if (data.notes) syncData.notes = mergeArrayById(syncData.notes, data.notes);
            // ... (other fields)
            saveData();
            broadcastToClients('sync-complete', { timestamp: Date.now() });
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, ...syncData }));
            return;

        default:
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
    }

    // Switch handles remaining routes or returns 404 default
    res.writeHead(204);
    res.end();
}

function handleWebSocketMessage(ws, data) {
    const { type, payload } = data;

    // Helper to process LLM request
    const handleLLM = (promptStr) => {
        localLLM.chat(promptStr).then(res => {
            ws.send(JSON.stringify({ type: 'llm-response', payload: res }));
        });
    };

    switch (type) {
        case 'request-state':
            ws.send(JSON.stringify({
                type: 'sync-state',
                payload: {
                    workspaces: syncData.workspaces,
                    tabs: syncData.tabs,
                    urls: syncData.urls,
                    settings: syncData.settings,
                    lastUpdated: syncData.lastUpdated
                }
            }));
            break;

        // Sync push handlers
        case 'push-workspaces':
            syncData.workspaces = mergeWorkspacesByName(syncData.workspaces, payload);
            if (hasDataChanged('workspaces', syncData.workspaces)) {
                saveData();
                broadcastToClients('workspaces-updated', syncData.workspaces);
            }
            break;

        // ... (Implement other push-* handlers similar to above)
        case 'push-urls':
            syncData.urls = mergeArrayById(syncData.urls, payload, 'urls');
            if (hasDataChanged('urls', syncData.urls)) {
                saveData();
                broadcastToClients('urls-updated', syncData.urls);
            }
            break;

        case 'push-settings':
            syncData.settings = { ...syncData.settings, ...payload };
            if (hasDataChanged('settings', syncData.settings)) {
                saveData();
                broadcastToClients('settings-updated', syncData.settings);
            }
            break;

        case 'push-notes':
            syncData.notes = mergeArrayById(syncData.notes, payload, 'notes');
            if (hasDataChanged('notes', syncData.notes)) {
                saveData();
                broadcastToClients('notes-updated', syncData.notes);
            }
            break;

        case 'push-url-notes':
            syncData.urlNotes = mergeArrayById(syncData.urlNotes, payload, 'urlNotes');
            if (hasDataChanged('url-notes', syncData.urlNotes)) {
                saveData();
                broadcastToClients('url-notes-updated', syncData.urlNotes);
            }
            break;

        case 'push-pins':
            syncData.pins = mergeArrayById(syncData.pins, payload, 'pins');
            if (hasDataChanged('pins', syncData.pins)) {
                saveData();
                broadcastToClients('pins-updated', syncData.pins);
            }
            break;

        case 'push-scraped-chats':
            syncData.scrapedChats = mergeArrayById(syncData.scrapedChats, payload, 'scrapedChats');
            if (hasDataChanged('scraped-chats', syncData.scrapedChats)) {
                saveData();
                broadcastToClients('scraped-chats-updated', syncData.scrapedChats);
            }
            break;

        case 'push-scraped-configs':
            syncData.scrapedConfigs = mergeArrayById(syncData.scrapedConfigs, payload, 'scrapedConfigs');
            if (hasDataChanged('scraped-configs', syncData.scrapedConfigs)) {
                saveData();
                broadcastToClients('scraped-configs-updated', syncData.scrapedConfigs);
            }
            break;

        case 'push-daily-memory':
            syncData.dailyMemory = mergeArrayById(syncData.dailyMemory, payload, 'dailyMemory');
            if (hasDataChanged('daily-memory', syncData.dailyMemory)) {
                saveData();
                broadcastToClients('daily-memory-updated', syncData.dailyMemory);
            }
            break;

        case 'push-ui-state':
            syncData.uiState = { ...syncData.uiState, ...payload };
            if (hasDataChanged('ui-state', syncData.uiState)) {
                saveData();
                broadcastToClients('ui-state-updated', syncData.uiState);
            }
            break;

        case 'push-dashboard':
            // Sanitize payload to prevent recursive 'data' key
            const safePayload = { ...payload };
            if (safePayload.data) {
                console.warn('[Sidecar] Blocked recursive dashboard.data payload');
                delete safePayload.data;
            }
            syncData.dashboard = { ...syncData.dashboard, ...safePayload };
            if (hasDataChanged('dashboard', syncData.dashboard)) {
                saveData();
                broadcastToClients('dashboard-updated', syncData.dashboard);
            }
            break;

        case 'push-activity':
            const activities = Array.isArray(payload) ? payload : [payload];
            syncData.activity = [...syncData.activity, ...activities].slice(-1000);
            saveData();
            broadcastToClients('activity-updated', activities);
            break;

        case 'push-tabs':
            let wsTabs = [];
            let wsDeviceId = 'ws-unknown';
            if (Array.isArray(payload)) wsTabs = payload;
            else if (payload && Array.isArray(payload.tabs)) {
                wsTabs = payload.tabs;
                wsDeviceId = payload.deviceId || 'ws-unknown';
            }
            syncData.deviceTabsMap.set(wsDeviceId, wsTabs);
            recomputeAggregatedTabs();
            if (hasDataChanged('tabs', syncData.tabs)) {
                broadcastToClients('tabs-updated', syncData.tabs);
            }
            break;

        // LLM Handlers
        case 'llm-get-status':
            // Logic matches electron-main.js
            ws.send(JSON.stringify({ type: 'llm-status', payload: localLLM.getStatus() }));
            break;

        case 'llm-get-models':
            ws.send(JSON.stringify({ type: 'llm-models', payload: localLLM.getAvailableModels() }));
            break;

        case 'llm-load-model':
            localLLM.loadModel(payload.modelName)
                .then(() => ws.send(JSON.stringify({ type: 'llm-model-loaded', payload: { ok: true } })))
                .catch(err => ws.send(JSON.stringify({ type: 'llm-model-loaded', payload: { ok: false, error: err.message } })));
            break;

        case 'llm-chat':
            localLLM.chat(payload.prompt, payload.options || {})
                .then(response => ws.send(JSON.stringify({
                    type: 'llm-chat-response',
                    payload: { ok: true, response, requestId: payload.requestId }
                })))
                .catch(err => ws.send(JSON.stringify({
                    type: 'llm-chat-response',
                    payload: { ok: false, error: err.message, requestId: payload.requestId }
                })));
            break;

        case 'llm-chat-stream':
            const { requestId } = payload; // Assuming payload has requestId
            localLLM.chatStream(payload.prompt, (token) => {
                ws.send(JSON.stringify({ type: 'llm-token', payload: { requestId, token } }));
            }, payload.options || {})
                .then(response => ws.send(JSON.stringify({ type: 'llm-complete', payload: { requestId, response } })))
                .catch(err => ws.send(JSON.stringify({ type: 'llm-error', payload: { requestId, error: err.message } })));
            break;

        case 'llm-summarize':
            localLLM.summarize(payload.text, payload.maxLength)
                .then(summary => ws.send(JSON.stringify({ type: 'llm-summary', payload: { ok: true, summary, requestId: payload.requestId } })))
                .catch(err => ws.send(JSON.stringify({ type: 'llm-summary', payload: { ok: false, error: err.message, requestId: payload.requestId } })));
            break;

        case 'llm-categorize':
            localLLM.categorize(payload.title, payload.url, payload.categories)
                .then(category => ws.send(JSON.stringify({ type: 'llm-category', payload: { ok: true, category, requestId: payload.requestId } })))
                .catch(err => ws.send(JSON.stringify({ type: 'llm-category', payload: { ok: false, error: err.message, requestId: payload.requestId } })));
            break;

        case 'llm-batch-categorize':
            localLLM.batchCategorize(payload.items, payload.categories)
                .then(results => ws.send(JSON.stringify({ type: 'llm-batch-category', payload: { ok: true, results, requestId: payload.requestId } })))
                .catch(err => ws.send(JSON.stringify({ type: 'llm-batch-category', payload: { ok: false, error: err.message, requestId: payload.requestId } })));
            break;

        case 'llm-answer':
            localLLM.answerQuestion(payload.question, payload.content)
                .then(answer => ws.send(JSON.stringify({ type: 'llm-answer', payload: { ok: true, answer, requestId: payload.requestId } })))
                .catch(err => ws.send(JSON.stringify({ type: 'llm-answer', payload: { ok: false, error: err.message, requestId: payload.requestId } })));
            break;

        case 'llm-parse-command':
            localLLM.parseCommand(payload.command)
                .then(parsed => ws.send(JSON.stringify({ type: 'llm-command-parsed', payload: { ok: true, parsed, requestId: payload.requestId } })))
                .catch(err => ws.send(JSON.stringify({ type: 'llm-command-parsed', payload: { ok: false, error: err.message, requestId: payload.requestId } })));
            break;
    }
}

// Global LLM Progress Listener
localLLM.onProgress((type, progress, modelName, error) => {
    broadcastToClients('llm-progress', { type, progress, modelName, error });
});

