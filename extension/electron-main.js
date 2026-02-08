/**
 * Electron Main Process
 * This file creates and manages the desktop application window
 * Includes HTTP server for browser extension sync and IPC handlers
 */

import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let spotlightWindow;
let httpServer;
let wss;

// ==========================================
// SYNC DATA STORAGE
// ==========================================

const DATA_DIR = join(app.getPath('userData'), 'sync-data');

// Ensure data directory exists
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
    urlNotes: [],       // Added
    pins: [],           // Added
    scrapedChats: [],   // Added
    scrapedConfigs: [], // Added
    dailyMemory: [],    // Added
    uiState: {},
    dashboard: {},
    tabs: [],
    lastUpdated: {}
};

// Load persisted data on startup
function loadData() {
    try {
        if (existsSync(DATA_FILE)) {
            const content = readFileSync(DATA_FILE, 'utf-8');
            const loaded = JSON.parse(content);
            // Merge with default structure to ensure all keys exist
            syncData = { ...syncData, ...loaded };
            console.log('[Electron] Loaded sync data from disk');
        }
    } catch (error) {
        console.warn('[Electron] Failed to load sync data:', error);
    }
}

// Save data to disk
function saveData() {
    try {
        writeFileSync(DATA_FILE, JSON.stringify(syncData, null, 2));
    } catch (error) {
        console.warn('[Electron] Failed to save sync data:', error);
    }
}

// Notify renderer of external updates
function notifyRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// Broadcast to all WebSocket clients
function broadcastToClients(type, payload) {
    if (!wss) return;
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    wss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
        }
    });
}

// ==========================================
// HTTP SERVER FOR BROWSER EXTENSION SYNC
// ==========================================

function startHttpServer() {
    const PORT = 4000;

    httpServer = createServer((req, res) => {
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

        // Parse JSON body for POST requests
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

    // WebSocket server for real-time updates
    wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
        console.log('[Electron] WebSocket client connected');

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                handleWebSocketMessage(ws, data);
            } catch (error) {
                console.warn('[Electron] Invalid WebSocket message:', error);
            }
        });

        ws.on('close', () => {
            console.log('[Electron] WebSocket client disconnected');
        });

        // Send current state on connection
        ws.send(JSON.stringify({
            type: 'sync-state',
            payload: {
                workspaces: syncData.workspaces,
                tabs: syncData.tabs,
                settings: syncData.settings,
                lastUpdated: syncData.lastUpdated
                // Note: Full state might be too large to send on connect
            }
        }));
    });

    httpServer.listen(PORT, '127.0.0.1', () => {
        console.log(`[Electron] Sync server running on http://127.0.0.1:${PORT}`);
    });

    httpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.warn(`[Electron] Port ${PORT} already in use, sync server disabled`);
        } else {
            console.error('[Electron] HTTP server error:', error);
        }
    });
}

function handleGetRequest(path, url, res) {
    res.setHeader('Content-Type', 'application/json');

    switch (path) {
        case '/workspaces':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.workspaces));
            break;

        case '/urls':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.urls));
            break;

        case '/settings':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.settings));
            break;

        case '/activity':
            const since = url.searchParams.get('since');
            let activity = syncData.activity;
            if (since) {
                const sinceMs = parseInt(since, 10);
                activity = activity.filter(a => (a.timestamp || 0) > sinceMs);
            }
            res.writeHead(200);
            res.end(JSON.stringify(activity));
            break;

        case '/notes':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.notes));
            break;

        case '/url-notes':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.urlNotes));
            break;

        case '/pins':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.pins));
            break;

        case '/scraped-chats':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.scrapedChats));
            break;

        case '/scraped-configs':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.scrapedConfigs));
            break;

        case '/daily-memory':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.dailyMemory));
            break;

        case '/ui-state':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.uiState));
            break;

        case '/dashboard':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.dashboard));
            break;

        case '/tabs':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.tabs));
            break;

        case '/health':
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
            break;

        default:
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
    }
}

function handlePostRequest(path, data, res) {
    switch (path) {
        case '/workspaces':
            syncData.workspaces = Array.isArray(data) ? data : [];
            syncData.lastUpdated.workspaces = Date.now();
            saveData();
            notifyRenderer('workspaces-updated', syncData.workspaces);
            broadcastToClients('workspaces-updated', syncData.workspaces);
            res.writeHead(204);
            res.end();
            break;

        case '/urls':
            syncData.urls = Array.isArray(data) ? data : [];
            syncData.lastUpdated.urls = Date.now();
            saveData();
            notifyRenderer('urls-updated', syncData.urls);
            broadcastToClients('urls-updated', syncData.urls);
            res.writeHead(204);
            res.end();
            break;

        case '/settings':
            syncData.settings = { ...syncData.settings, ...data };
            syncData.lastUpdated.settings = Date.now();
            saveData();
            notifyRenderer('settings-updated', syncData.settings);
            broadcastToClients('settings-updated', syncData.settings);
            res.writeHead(204);
            res.end();
            break;

        case '/activity':
            const activities = Array.isArray(data) ? data : [data];
            syncData.activity = [...syncData.activity, ...activities].slice(-1000); // Keep last 1000
            syncData.lastUpdated.activity = Date.now();
            saveData();
            notifyRenderer('activity-updated', activities);
            broadcastToClients('activity-updated', activities);
            res.writeHead(204);
            res.end();
            break;

        case '/notes':
            syncData.notes = Array.isArray(data) ? data : [];
            syncData.lastUpdated.notes = Date.now();
            saveData();
            notifyRenderer('notes-updated', syncData.notes);
            broadcastToClients('notes-updated', syncData.notes);
            res.writeHead(204);
            res.end();
            break;

        case '/url-notes':
            syncData.urlNotes = Array.isArray(data) ? data : [];
            syncData.lastUpdated.urlNotes = Date.now();
            saveData();
            notifyRenderer('url-notes-updated', syncData.urlNotes);
            broadcastToClients('url-notes-updated', syncData.urlNotes);
            res.writeHead(204);
            res.end();
            break;

        case '/pins':
            syncData.pins = Array.isArray(data) ? data : [];
            syncData.lastUpdated.pins = Date.now();
            saveData();
            notifyRenderer('pins-updated', syncData.pins);
            broadcastToClients('pins-updated', syncData.pins);
            res.writeHead(204);
            res.end();
            break;

        case '/scraped-chats':
            syncData.scrapedChats = Array.isArray(data) ? data : [];
            syncData.lastUpdated.scrapedChats = Date.now();
            saveData();
            notifyRenderer('scraped-chats-updated', syncData.scrapedChats);
            broadcastToClients('scraped-chats-updated', syncData.scrapedChats);
            res.writeHead(204);
            res.end();
            break;

        case '/scraped-configs':
            syncData.scrapedConfigs = Array.isArray(data) ? data : [];
            syncData.lastUpdated.scrapedConfigs = Date.now();
            saveData();
            notifyRenderer('scraped-configs-updated', syncData.scrapedConfigs);
            broadcastToClients('scraped-configs-updated', syncData.scrapedConfigs);
            res.writeHead(204);
            res.end();
            break;

        case '/daily-memory':
            syncData.dailyMemory = Array.isArray(data) ? data : [];
            syncData.lastUpdated.dailyMemory = Date.now();
            saveData();
            notifyRenderer('daily-memory-updated', syncData.dailyMemory);
            broadcastToClients('daily-memory-updated', syncData.dailyMemory);
            res.writeHead(204);
            res.end();
            break;

        case '/ui-state':
            syncData.uiState = { ...syncData.uiState, ...data };
            saveData();
            notifyRenderer('ui-state-updated', syncData.uiState);
            broadcastToClients('ui-state-updated', syncData.uiState);
            res.writeHead(204);
            res.end();
            break;

        case '/dashboard':
            syncData.dashboard = { ...syncData.dashboard, ...data };
            saveData();
            notifyRenderer('dashboard-updated', syncData.dashboard);
            broadcastToClients('dashboard-updated', syncData.dashboard);
            res.writeHead(204);
            res.end();
            break;

        case '/tabs':
            syncData.tabs = Array.isArray(data) ? data : [];
            syncData.lastUpdated.tabs = Date.now();
            saveData();
            notifyRenderer('tabs-updated', syncData.tabs);
            broadcastToClients('tabs-updated', syncData.tabs);
            res.writeHead(204);
            res.end();
            break;

        case '/sync':
            // Full sync request - merge incoming data
            if (data.workspaces) {
                syncData.workspaces = mergeArrayById(syncData.workspaces, data.workspaces);
                syncData.lastUpdated.workspaces = Date.now();
            }
            if (data.urls) {
                syncData.urls = mergeArrayById(syncData.urls, data.urls);
                syncData.lastUpdated.urls = Date.now();
            }
            if (data.tabs) {
                syncData.tabs = data.tabs;
                syncData.lastUpdated.tabs = Date.now();
            }
            if (data.settings) {
                syncData.settings = { ...syncData.settings, ...data.settings };
                syncData.lastUpdated.settings = Date.now();
            }
            if (data.notes) {
                syncData.notes = mergeArrayById(syncData.notes, data.notes);
                syncData.lastUpdated.notes = Date.now();
            }
            if (data.urlNotes) {
                syncData.urlNotes = mergeArrayById(syncData.urlNotes, data.urlNotes);
                syncData.lastUpdated.urlNotes = Date.now();
            }
            if (data.pins) {
                syncData.pins = mergeArrayById(syncData.pins, data.pins);
                syncData.lastUpdated.pins = Date.now();
            }
            if (data.scrapedChats) {
                syncData.scrapedChats = mergeArrayById(syncData.scrapedChats, data.scrapedChats, 'scrapedChats');
                syncData.lastUpdated.scrapedChats = Date.now();
            }
            if (data.scrapedConfigs) {
                syncData.scrapedConfigs = mergeArrayById(syncData.scrapedConfigs, data.scrapedConfigs, 'scrapedConfigs');
                syncData.lastUpdated.scrapedConfigs = Date.now();
            }
            if (data.dailyMemory) {
                syncData.dailyMemory = mergeArrayById(syncData.dailyMemory, data.dailyMemory);
                syncData.lastUpdated.dailyMemory = Date.now();
            }

            saveData();
            notifyRenderer('sync-complete', { timestamp: Date.now() });
            res.writeHead(200);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                ok: true,
                ...syncData
            }));
            break;

        default:
            res.writeHead(404);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Not found' }));
    }
}

function handleWebSocketMessage(ws, data) {
    const { type, payload } = data;

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

        case 'push-workspaces':
            syncData.workspaces = payload;
            syncData.lastUpdated.workspaces = Date.now();
            saveData();
            notifyRenderer('workspaces-updated', syncData.workspaces);
            broadcastToClients('workspaces-updated', syncData.workspaces);
            break;

        case 'push-urls':
            syncData.urls = payload;
            syncData.lastUpdated.urls = Date.now();
            saveData();
            notifyRenderer('urls-updated', syncData.urls);
            broadcastToClients('urls-updated', syncData.urls);
            break;

        case 'push-settings':
            syncData.settings = { ...syncData.settings, ...payload };
            syncData.lastUpdated.settings = Date.now();
            saveData();
            notifyRenderer('settings-updated', syncData.settings);
            broadcastToClients('settings-updated', syncData.settings);
            break;

        case 'push-dashboard':
            syncData.dashboard = payload;
            saveData();
            notifyRenderer('dashboard-updated', syncData.dashboard);
            broadcastToClients('dashboard-updated', syncData.dashboard);
            break;

        case 'push-tabs':
            console.log(`[Electron] Received push-tabs with ${Array.isArray(payload) ? payload.length : 'invalid'} tabs`);
            syncData.tabs = Array.isArray(payload) ? payload : [];
            syncData.lastUpdated.tabs = Date.now();
            saveData(); // Optional for volatile data
            notifyRenderer('tabs-updated', syncData.tabs);
            broadcastToClients('tabs-updated', syncData.tabs);
            break;

        case 'push-activity':
            const activities = Array.isArray(payload) ? payload : [payload];
            syncData.activity = [...syncData.activity, ...activities].slice(-1000);
            syncData.lastUpdated.activity = Date.now();
            saveData();
            notifyRenderer('activity-updated', activities);
            broadcastToClients('activity-updated', activities);
            break;

        case 'push-notes':
            syncData.notes = payload;
            syncData.lastUpdated.notes = Date.now();
            saveData();
            notifyRenderer('notes-updated', syncData.notes);
            broadcastToClients('notes-updated', syncData.notes);
            break;

        case 'push-url-notes':
            syncData.urlNotes = payload;
            syncData.lastUpdated.urlNotes = Date.now();
            saveData();
            notifyRenderer('url-notes-updated', syncData.urlNotes);
            broadcastToClients('url-notes-updated', syncData.urlNotes);
            break;

        case 'push-pins':
            syncData.pins = payload;
            syncData.lastUpdated.pins = Date.now();
            saveData();
            notifyRenderer('pins-updated', syncData.pins);
            broadcastToClients('pins-updated', syncData.pins);
            break;

        case 'push-scraped-chats':
            syncData.scrapedChats = payload;
            syncData.lastUpdated.scrapedChats = Date.now();
            saveData();
            notifyRenderer('scraped-chats-updated', syncData.scrapedChats);
            broadcastToClients('scraped-chats-updated', syncData.scrapedChats);
            break;

        case 'push-scraped-configs':
            syncData.scrapedConfigs = payload;
            syncData.lastUpdated.scrapedConfigs = Date.now();
            saveData();
            notifyRenderer('scraped-configs-updated', syncData.scrapedConfigs);
            broadcastToClients('scraped-configs-updated', syncData.scrapedConfigs);
            break;

        case 'push-daily-memory':
            syncData.dailyMemory = payload;
            syncData.lastUpdated.dailyMemory = Date.now();
            saveData();
            notifyRenderer('daily-memory-updated', syncData.dailyMemory);
            broadcastToClients('daily-memory-updated', syncData.dailyMemory);
            break;

        case 'push-ui-state':
            syncData.uiState = { ...syncData.uiState, ...payload };
            saveData();
            notifyRenderer('ui-state-updated', syncData.uiState);
            broadcastToClients('ui-state-updated', syncData.uiState);
            break;

        default:
            console.log('[Electron] Unknown WebSocket message type:', type);
    }
}

// Merge arrays by ID (last-write-wins based on updatedAt)
// type parameter determines which field to use as ID
function mergeArrayById(local, remote, type = 'default') {
    const merged = new Map();

    // Determine the ID field based on type
    const getItemId = (item) => {
        if (type === 'scrapedChats') return item.chatId;
        if (type === 'scrapedConfigs') return item.domain;
        return item.id;
    };

    // Add all local items
    for (const item of local) {
        const itemId = getItemId(item);
        if (itemId) {
            merged.set(itemId, item);
        }
    }

    // Merge remote items (override if newer or doesn't exist)
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

// ==========================================
// WINDOW CREATION
// ==========================================

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: join(__dirname, 'electron-preload.js'),
            webSecurity: false, // Allow loading local resources
        },
        backgroundColor: '#0f172a',
        titleBarStyle: 'default',
        icon: join(__dirname, 'public', 'icon-128.png'),
    });

    // Load the app
    if (process.env.NODE_ENV === 'development') {
        // Development: load from Vite dev server
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        // Production: load from built files
        mainWindow.loadFile(join(__dirname, 'dist-electron', 'index.html'));
    }

    // Handle window events
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Handle external links
    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

function createSpotlightWindow() {
    // Get primary display for centering
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    spotlightWindow = new BrowserWindow({
        width: 800,
        height: 600,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: true,
        show: false, // Hidden by default
        center: true,
        hasShadow: false, // We render our own shadow in CSS for better control
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: join(__dirname, 'electron-preload.js'),
            // webSecurity: false, // Consistent with main window
        }
    });

    // Load the app with spotlight hash
    if (process.env.NODE_ENV === 'development') {
        spotlightWindow.loadURL('http://localhost:5173/#/spotlight');
    } else {
        spotlightWindow.loadFile(join(__dirname, 'dist-electron', 'index.html'), { hash: '/spotlight' });
    }

    // Hide instead of close on blur (optional, but good for spotlight feel)
    // spotlightWindow.on('blur', () => {
    //     spotlightWindow.hide();
    // });
}

function toggleSpotlight() {
    if (!spotlightWindow || spotlightWindow.isDestroyed()) {
        // If the window doesn't exist or is destroyed, we can't toggle it.
        // This implies createSpotlightWindow() should be called at startup.
        return;
    }
    // Force reload to ensure hash is applied if somehow lost, or just set hash
    // But for transparency we need to match the 'isSpotlight' check in App.jsx
    // which checks window.location.hash.
    // If we just hide/show, the hash stays.
    if (spotlightWindow.isVisible()) {
        spotlightWindow.hide();
    } else {
        // Re-center if needed (optional)
        spotlightWindow.center();
        spotlightWindow.show();
        spotlightWindow.focus();
        // Send reset message to clear query?
    }
}

// ==========================================
// IPC HANDLERS
// ==========================================

// Sync data handlers - API pattern (request-response)
ipcMain.handle('sync:get-workspaces', () => syncData.workspaces);
ipcMain.handle('sync:set-workspaces', (_event, data) => {
    syncData.workspaces = Array.isArray(data) ? data : [];
    syncData.lastUpdated.workspaces = Date.now();
    saveData();
    broadcastToClients('workspaces-updated', syncData.workspaces);
    return { ok: true };
});

ipcMain.handle('sync:get-urls', () => syncData.urls);
ipcMain.handle('sync:set-urls', (_event, data) => {
    syncData.urls = Array.isArray(data) ? data : [];
    syncData.lastUpdated.urls = Date.now();
    saveData();
    broadcastToClients('urls-updated', syncData.urls);
    return { ok: true };
});

ipcMain.handle('sync:get-settings', () => syncData.settings);
ipcMain.handle('sync:set-settings', (_event, data) => {
    syncData.settings = { ...syncData.settings, ...data };
    syncData.lastUpdated.settings = Date.now();
    saveData();
    broadcastToClients('settings-updated', syncData.settings);
    return { ok: true };
});

ipcMain.handle('sync:get-activity', (_event, since) => {
    if (since) {
        return syncData.activity.filter(a => (a.timestamp || 0) > since);
    }
    return syncData.activity;
});
ipcMain.handle('sync:set-activity', (_event, data) => {
    const activities = Array.isArray(data) ? data : [data];
    syncData.activity = [...syncData.activity, ...activities].slice(-1000);
    syncData.lastUpdated.activity = Date.now();
    saveData();
    broadcastToClients('activity-updated', activities);
    return { ok: true };
});

ipcMain.handle('sync:get-notes', () => syncData.notes);
ipcMain.handle('sync:set-notes', (_event, data) => {
    syncData.notes = Array.isArray(data) ? data : [];
    syncData.lastUpdated.notes = Date.now();
    saveData();
    broadcastToClients('notes-updated', syncData.notes);
    return { ok: true };
});

ipcMain.handle('sync:get-url-notes', () => syncData.urlNotes);
ipcMain.handle('sync:set-url-notes', (_event, data) => {
    syncData.urlNotes = Array.isArray(data) ? data : [];
    syncData.lastUpdated.urlNotes = Date.now();
    saveData();
    broadcastToClients('url-notes-updated', syncData.urlNotes);
    return { ok: true };
});

ipcMain.handle('sync:get-pins', () => syncData.pins);
ipcMain.handle('sync:set-pins', (_event, data) => {
    syncData.pins = Array.isArray(data) ? data : [];
    syncData.lastUpdated.pins = Date.now();
    saveData();
    broadcastToClients('pins-updated', syncData.pins);
    return { ok: true };
});

ipcMain.handle('sync:get-scraped-chats', () => syncData.scrapedChats);
// Runtime Message Handler (Bridge for chrome.runtime.sendMessage)
ipcMain.handle('runtime:send-message', async (_event, message) => {
    // console.log('[Electron] Received runtime message:', message.type);

    switch (message.type) {
        case 'SEARCH_TABS':
            // Search in synced tabs
            const queryTabs = (message.query || '').toLowerCase();
            return {
                results: syncData.tabs
                    .filter(t => t.title?.toLowerCase().includes(queryTabs) || t.url?.toLowerCase().includes(queryTabs))
                    .map(t => ({
                        id: t.id,
                        title: t.title,
                        url: t.url,
                        description: 'Open Tab',
                        type: 'tab',
                        favicon: t.favIconUrl || t.favicon, // SyncOrchestrator sends favIconUrl
                        tabId: t.id
                    }))
                    .slice(0, 10)
            };

        case 'SEARCH_HISTORY':
            // Search in synced activity/history
            const queryHist = (message.query || '').toLowerCase();
            return {
                results: syncData.activity
                    .filter(a => a.title?.toLowerCase().includes(queryHist) || a.url?.toLowerCase().includes(queryHist))
                    .map(a => {
                        const timestamp = a.lastVisitTime || a.timestamp || Date.now();
                        return {
                            id: a.id || timestamp,
                            title: a.title || a.url, // Fallback to URL if title is missing
                            url: a.url,
                            // description: new Date(timestamp).toLocaleDateString(), // Don't show date
                            type: 'history',
                            favicon: a.favicon || a.favIconUrl
                        };
                    })
                    .slice(0, 10)
            };

        case 'SEARCH_BOOKMARKS':
            // Search in synced pins
            const queryBook = (message.query || '').toLowerCase();
            const pins = syncData.pins
                .filter(p => p.title?.toLowerCase().includes(queryBook))
                .map(p => ({
                    id: p.id || p.url,
                    title: p.title,
                    url: p.url,
                    type: 'bookmark',
                    favicon: p.favicon || p.icon
                }));
            return { results: pins.slice(0, 10) };

        case 'SEARCH_WORKSPACES':
            // Search in synced workspaces and their URLs
            const queryWs = (message.query || '').toLowerCase();
            const wsResults = [];

            // Search Workspace Names
            if (syncData.workspaces) {
                // 1. Workspace Containers
                syncData.workspaces.forEach(ws => {
                    if (ws.name?.toLowerCase().includes(queryWs)) {
                        wsResults.push({
                            id: ws.id,
                            title: ws.name,
                            description: `${(ws.urls || []).length} items`,
                            type: 'workspace',
                            favicon: null // Generic icon in UI
                        });
                    }

                    // 2. URLs inside Workspaces
                    if (ws.urls && Array.isArray(ws.urls)) {
                        ws.urls.forEach(u => {
                            const uTitle = (u.title || '').toLowerCase();
                            const uUrl = (u.url || '').toLowerCase();

                            if (uTitle.includes(queryWs) || uUrl.includes(queryWs)) {
                                wsResults.push({
                                    id: `${ws.id}_${u.url}`,
                                    title: u.title || new URL(u.url).hostname,
                                    url: u.url,
                                    description: `in ${ws.name}`,
                                    type: 'workspace-url',
                                    favicon: u.favicon || null,
                                    workspaceId: ws.id
                                });
                            }
                        });
                    }
                });
            }
            return { results: wsResults.slice(0, 20) };

        case 'NANO_AI_SEARCH':
            // Mock AI search for now, or just return items
            return { success: true, results: [] };

        case 'JUMP_TO_TAB':
            // Handle tab switching - broadcast to browser extensions via WebSocket
            console.log('[Electron] JUMP_TO_TAB request for tabId:', message.tabId);

            // Hide spotlight FIRST
            if (spotlightWindow && !spotlightWindow.isDestroyed()) {
                spotlightWindow.hide();
            }

            // On Windows, minimize main window to allow browser to take foreground focus
            // Windows prevents background apps from stealing focus, but minimizing works
            if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.minimize();
            }

            // Small delay to ensure Electron windows are out of the way
            // before browser tries to focus
            setTimeout(() => {
                // Broadcast to all connected browser extensions to switch to this tab
                broadcastToClients('jump-to-tab', {
                    tabId: message.tabId,
                    windowId: message.windowId
                });
            }, 50);

            return { success: true };

        case 'EXECUTE_COMMAND':
            console.log('[Electron] Execute command:', message.commandValue);
            return { success: true };

        case 'SPOTLIGHT_HIDE':
            spotlightWindow?.hide();
            return { ok: true };

        default:
            // console.log('[Electron] Runtime message received:', message);
            return { success: false, error: 'Unknown message type' };
    }
});

ipcMain.handle('sync:set-scraped-chats', (_event, data) => {
    syncData.scrapedChats = Array.isArray(data) ? data : [];
    syncData.lastUpdated.scrapedChats = Date.now();
    saveData();
    broadcastToClients('scraped-chats-updated', syncData.scrapedChats);
    return { ok: true };
});

ipcMain.handle('sync:get-scraped-configs', () => syncData.scrapedConfigs);
ipcMain.handle('sync:set-scraped-configs', (_event, data) => {
    syncData.scrapedConfigs = Array.isArray(data) ? data : [];
    syncData.lastUpdated.scrapedConfigs = Date.now();
    saveData();
    broadcastToClients('scraped-configs-updated', syncData.scrapedConfigs);
    return { ok: true };
});

ipcMain.handle('sync:get-daily-memory', () => syncData.dailyMemory);
ipcMain.handle('sync:set-daily-memory', (_event, data) => {
    syncData.dailyMemory = Array.isArray(data) ? data : [];
    syncData.lastUpdated.dailyMemory = Date.now();
    saveData();
    broadcastToClients('daily-memory-updated', syncData.dailyMemory);
    return { ok: true };
});

ipcMain.handle('sync:set-ui-state', (_event, data) => {
    syncData.uiState = { ...syncData.uiState, ...data };
    saveData();
    broadcastToClients('ui-state-updated', syncData.uiState);
    return { ok: true };
});
ipcMain.handle('sync:get-ui-state', () => syncData.uiState);

ipcMain.handle('sync:get-dashboard', () => syncData.dashboard);
ipcMain.handle('sync:set-dashboard', (_event, data) => {
    syncData.dashboard = { ...syncData.dashboard, ...data };
    saveData();
    broadcastToClients('dashboard-updated', syncData.dashboard);
    return { ok: true };
});

ipcMain.handle('sync:get-tabs', () => syncData.tabs);
ipcMain.handle('sync:set-tabs', (_event, data) => {
    syncData.tabs = Array.isArray(data) ? data : [];
    syncData.lastUpdated.tabs = Date.now();
    // saveData(); // Optional
    broadcastToClients('tabs-updated', syncData.tabs);
    return { ok: true };
});

ipcMain.handle('sync:trigger-full', () => {
    // Trigger full sync by broadcasting current state
    broadcastToClients('sync-state', {
        workspaces: syncData.workspaces,
        urls: syncData.urls,
        settings: syncData.settings,
        tabs: syncData.tabs,
        notes: syncData.notes,
        urlNotes: syncData.urlNotes,
        pins: syncData.pins,
        scrapedChats: syncData.scrapedChats,
        scrapedConfigs: syncData.scrapedConfigs,
        dailyMemory: syncData.dailyMemory,
        uiState: syncData.uiState,
        lastUpdated: syncData.lastUpdated
    });
    return { ok: true, lastUpdated: syncData.lastUpdated };
});

// System handlers
ipcMain.handle('get-app-path', () => app.getPath('userData'));
ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('open-external', (_event, url) => {
    if (url && typeof url === 'string') {
        shell.openExternal(url);
        return { ok: true };
    }
    return { ok: false, error: 'Invalid URL' };
});

ipcMain.handle('focus-window', (_event, pid) => {
    // Focus window is not directly supported in Electron
    // Could use native modules like 'node-window-manager' if needed
    console.log('[Electron] Focus window requested for PID:', pid);
    return { ok: false, error: 'Not implemented' };
});

ipcMain.handle('get-processes', () => {
    // Return empty array - could integrate with system process list
    return [];
});



// ==========================================
// APP LIFECYCLE
// ==========================================

app.whenReady().then(() => {
    // Load persisted data
    loadData();

    // Start HTTP server for extension sync
    startHttpServer();

    // Create main window
    createWindow();
    createSpotlightWindow();

    // Register Global Shortcut
    // Alt+Space is reserved by Windows. Alt+Shift+S is hard to press.
    // Using Alt+K as a common "Command Palette" style shortcut.
    const shortcut = 'Alt+K';
    const ret = globalShortcut.register(shortcut, () => {
        console.log('[Electron] Global shortcut triggered:', shortcut);
        toggleSpotlight();
    });

    if (!ret) {
        console.error(`[Electron] Global shortcut registration failed for ${shortcut}`);
    } else {
        console.log(`[Electron] Global shortcut registered: ${shortcut}`);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    // Save data before quitting
    saveData();

    // Close HTTP server
    if (httpServer) {
        httpServer.close();
    }
});

// Log startup
console.log('[Electron] App starting...');
console.log('[Electron] User data path:', app.getPath('userData'));
