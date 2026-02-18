# Bidirectional Sync Plan: Browser Extension ↔ Electron Desktop App

## Executive Summary

This plan outlines the implementation of robust bidirectional synchronization between the Chrome extension and Electron desktop app, while fixing existing Chrome API compatibility issues.

---

## Phase 1: Fix Chrome API Polyfill Issues (Critical)

### Problem 1.1: Callback vs Promise Pattern Mismatch

**Location:** `src/services/chromePolyfill.js:68`

**Issue:** The polyfill's `tabs.query` returns a Promise, but `App.jsx:204` calls it with a callback pattern.

**Fix:**
```javascript
// Before
query: async () => [],

// After - Support both callback and promise patterns
query: (queryInfo, callback) => {
    const result = [];
    if (typeof callback === 'function') {
        setTimeout(() => callback(result), 0);
        return;
    }
    return Promise.resolve(result);
},
```

### Problem 1.2: Partial Chrome Object Detection

**Location:** `src/services/chromePolyfill.js:105`

**Issue:** Polyfill only initializes when `chrome` is completely undefined. In some Electron contexts, `chrome` may exist but be incomplete.

**Fix:**
```javascript
// Before
if (typeof window.chrome === 'undefined' || !window.chrome) {

// After - Check for specific API availability
export function initChromePolyfill() {
    if (typeof window === 'undefined') return;

    window.chrome = window.chrome || {};

    // Always ensure storage API exists
    if (!window.chrome.storage?.local?.get) {
        console.log('[Chrome Polyfill] Adding storage API');
        window.chrome.storage = createStorageAPI();
    }

    // Always ensure tabs API exists
    if (!window.chrome.tabs?.query) {
        console.log('[Chrome Polyfill] Adding tabs API');
        window.chrome.tabs = createTabsAPI();
    }

    // Always ensure runtime API exists
    if (!window.chrome.runtime?.sendMessage) {
        console.log('[Chrome Polyfill] Adding runtime API');
        window.chrome.runtime = createRuntimeAPI();
    }
}
```

### Problem 1.3: Direct Chrome API Usage Bypassing Abstraction

**Location:** `src/App.jsx:1013`

**Issue:** Direct `chrome.storage.local.get()` call instead of using `storageGet()` abstraction.

**Fix:** Replace with abstraction layer call:
```javascript
// Before
const legacy = await chrome.storage.local.get(['workspaces'])

// After
const legacy = await storageGet(['workspaces'])
```

---

## Phase 2: Enhance Electron Main Process

### 2.0: Understanding IPC Patterns - API vs Events

Before implementing, it's critical to understand the two IPC communication patterns:

#### **API Pattern (Request-Response)**
Use `ipcRenderer.invoke()` / `ipcMain.handle()` when the **renderer asks for data**.

```javascript
// Renderer asks Main for data
const workspaces = await window.electronAPI.getWorkspaces();

// Renderer sends data to Main
await window.electronAPI.setWorkspaces(newData);
```

**Characteristics:**
- Returns a Promise with the result
- Synchronous request-response flow
- Built-in error handling via Promise rejection
- Use for: fetching data, saving data, CRUD operations

#### **Events Pattern (Push Notifications)**
Use `ipcRenderer.on()` / `mainWindow.webContents.send()` when **Main pushes updates to Renderer**.

```javascript
// Main process pushes update to Renderer
mainWindow.webContents.send('workspaces-updated', newData);

// Renderer listens for push updates
window.electronAPI.subscribe('workspaces-updated', (data) => {
    console.log('External update received:', data);
});
```

**Characteristics:**
- Fire-and-forget from sender's perspective
- No direct return value
- Use for: real-time updates, external sync notifications, status changes

#### **When to Use Each Pattern in Sync**

| Scenario | Pattern | Why |
|----------|---------|-----|
| App opens, needs current data | API (`invoke`) | Renderer initiates, needs response |
| User saves workspace | API (`invoke`) | Renderer initiates, needs confirmation |
| Browser extension syncs via HTTP | Event (`send`) | Main receives external data, pushes to renderer |
| Background sync completes | Event (`send`) | Main notifies renderer of status change |
| Conflict detected | Event (`send`) | Main alerts renderer to take action |

#### **Complete Preload Script with Both Patterns**

```javascript
// electron-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // ==========================================
    // API PATTERN - Renderer asks Main
    // ==========================================

    // Workspaces
    getWorkspaces: () => ipcRenderer.invoke('sync:get-workspaces'),
    setWorkspaces: (data) => ipcRenderer.invoke('sync:set-workspaces', data),

    // URLs
    getUrls: () => ipcRenderer.invoke('sync:get-urls'),
    setUrls: (data) => ipcRenderer.invoke('sync:set-urls', data),

    // Settings
    getSettings: () => ipcRenderer.invoke('sync:get-settings'),
    setSettings: (data) => ipcRenderer.invoke('sync:set-settings', data),

    // Activity
    getActivity: (since) => ipcRenderer.invoke('sync:get-activity', since),
    setActivity: (data) => ipcRenderer.invoke('sync:set-activity', data),

    // System
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    focusWindow: (pid) => ipcRenderer.invoke('focus-window', pid),
    getProcesses: () => ipcRenderer.invoke('get-processes'),

    // ==========================================
    // EVENTS PATTERN - Main pushes to Renderer
    // ==========================================

    /**
     * Subscribe to push events from main process
     * @param {string} channel - Event channel name
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function for cleanup
     */
    subscribe: (channel, callback) => {
        // Whitelist of allowed channels for security
        const validChannels = [
            'workspaces-updated',
            'urls-updated',
            'settings-updated',
            'activity-updated',
            'sync-status',
            'sync-conflict',
            'sync-error'
        ];

        if (!validChannels.includes(channel)) {
            console.warn(`[Preload] Invalid channel: ${channel}`);
            return () => {};
        }

        const handler = (_, data) => callback(data);
        ipcRenderer.on(channel, handler);

        // Return cleanup function
        return () => ipcRenderer.removeListener(channel, handler);
    },

    /**
     * One-time event listener
     */
    once: (channel, callback) => {
        const validChannels = ['sync-complete', 'sync-error'];
        if (!validChannels.includes(channel)) return;

        ipcRenderer.once(channel, (_, data) => callback(data));
    }
});
```

#### **Main Process Handlers**

```javascript
// electron-main.js - IPC Handlers

const { ipcMain } = require('electron');

// ==========================================
// API HANDLERS - Respond to Renderer requests
// ==========================================

ipcMain.handle('sync:get-workspaces', async () => {
    return syncData.workspaces;
});

ipcMain.handle('sync:set-workspaces', async (_, data) => {
    syncData.workspaces = data;
    saveData();

    // Notify other windows/tabs if needed
    broadcastToAllWindows('workspaces-updated', data);

    return { ok: true };
});

// ==========================================
// PUSH EVENTS - Notify Renderer of external changes
// ==========================================

// Call this when HTTP server receives data from browser extension
function notifyRendererOfExternalUpdate(type, data) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send(`${type}-updated`, data);
}

// Example: HTTP endpoint receives sync from extension
app.post('/workspaces', (req, res) => {
    syncData.workspaces = req.body;
    saveData();

    // Push to renderer via EVENT (not API)
    notifyRendererOfExternalUpdate('workspaces', syncData.workspaces);

    res.status(204).end();
});
```

#### **React Hook Usage**

```javascript
// src/hooks/useSync.js
import { useEffect, useState, useCallback } from 'react';

export function useSync() {
    const [workspaces, setWorkspaces] = useState([]);
    const [syncStatus, setSyncStatus] = useState('idle');

    useEffect(() => {
        if (!window.electronAPI) return;

        // Initial load via API pattern
        window.electronAPI.getWorkspaces().then(setWorkspaces);

        // Subscribe to push events for external updates
        const unsubWorkspaces = window.electronAPI.subscribe(
            'workspaces-updated',
            (data) => {
                console.log('[Sync] External update received');
                setWorkspaces(data);
            }
        );

        const unsubStatus = window.electronAPI.subscribe(
            'sync-status',
            setSyncStatus
        );

        // Cleanup subscriptions on unmount
        return () => {
            unsubWorkspaces();
            unsubStatus();
        };
    }, []);

    // Save uses API pattern (needs confirmation)
    const saveWorkspaces = useCallback(async (data) => {
        if (!window.electronAPI) return { ok: false };

        const result = await window.electronAPI.setWorkspaces(data);
        if (result.ok) {
            setWorkspaces(data); // Optimistic update
        }
        return result;
    }, []);

    return { workspaces, syncStatus, saveWorkspaces };
}
```

---

### 2.1: Add HTTP Server for Host Sync API

**Location:** `electron-main.js`

**New Features:**
- Built-in Express/Fastify server on port 4000
- REST API endpoints matching existing extensionApi expectations
- In-memory + file-based persistence for desktop data

**Implementation:**
```javascript
// electron-main.js additions
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(app.getPath('userData'), 'sync-data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const server = express();
server.use(cors());
server.use(express.json({ limit: '50mb' }));

// Data stores (in-memory + file persistence)
let syncData = {
    workspaces: [],
    urls: [],
    settings: {},
    activity: [],
    dashboard: {}
};

// Load persisted data on startup
function loadData() {
    const dataFile = path.join(DATA_DIR, 'sync-data.json');
    if (fs.existsSync(dataFile)) {
        syncData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    }
}

function saveData() {
    const dataFile = path.join(DATA_DIR, 'sync-data.json');
    fs.writeFileSync(dataFile, JSON.stringify(syncData, null, 2));
}

// API Endpoints
server.get('/workspaces', (req, res) => res.json(syncData.workspaces));
server.post('/workspaces', (req, res) => {
    syncData.workspaces = req.body;
    saveData();
    broadcastToRenderer('workspaces-updated', syncData.workspaces);
    res.status(204).end();
});

// ... similar for /urls, /settings, /activity, /dashboard

// WebSocket for real-time updates
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        handleWebSocketMessage(ws, data);
    });
});

server.listen(4000, '127.0.0.1', () => {
    console.log('[Electron] Sync server running on port 4000');
});
```

### 2.2: Add IPC Bridge for Renderer Communication

**New IPC Channels:**
```javascript
// Main process
ipcMain.handle('sync:get-workspaces', () => syncData.workspaces);
ipcMain.handle('sync:set-workspaces', (_, data) => {
    syncData.workspaces = data;
    saveData();
    return { ok: true };
});

ipcMain.handle('sync:get-urls', () => syncData.urls);
ipcMain.handle('sync:set-urls', (_, data) => {
    syncData.urls = data;
    saveData();
    return { ok: true };
});

// ... similar for all data types
```

### 2.3: Add Preload Script for Secure IPC

**New File:** `electron-preload.js`
```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Sync operations
    getWorkspaces: () => ipcRenderer.invoke('sync:get-workspaces'),
    setWorkspaces: (data) => ipcRenderer.invoke('sync:set-workspaces', data),
    getUrls: () => ipcRenderer.invoke('sync:get-urls'),
    setUrls: (data) => ipcRenderer.invoke('sync:set-urls', data),
    getSettings: () => ipcRenderer.invoke('sync:get-settings'),
    setSettings: (data) => ipcRenderer.invoke('sync:set-settings', data),
    getActivity: (since) => ipcRenderer.invoke('sync:get-activity', since),
    setActivity: (data) => ipcRenderer.invoke('sync:set-activity', data),

    // Event subscriptions
    onWorkspacesUpdated: (callback) => {
        ipcRenderer.on('workspaces-updated', (_, data) => callback(data));
    },
    onUrlsUpdated: (callback) => {
        ipcRenderer.on('urls-updated', (_, data) => callback(data));
    },
    onSettingsUpdated: (callback) => {
        ipcRenderer.on('settings-updated', (_, data) => callback(data));
    },

    // System operations
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    focusWindow: (pid) => ipcRenderer.invoke('focus-window', pid),
    getProcesses: () => ipcRenderer.invoke('get-processes')
});
```

---

## Phase 3: Create Unified Sync Service

### 3.1: New Sync Orchestrator

**New File:** `src/services/syncOrchestrator.js`

```javascript
/**
 * Unified Sync Orchestrator
 * Handles bidirectional sync between Browser Extension ↔ Electron App
 *
 * Data Flow:
 * 1. Local Change → IndexedDB → Sync Queue → Host API / IPC
 * 2. Remote Change → WebSocket/IPC Event → Merge → IndexedDB → UI Update
 */

import { isElectronApp, isExtension } from './environmentDetector';
import * as db from '../db/index';
import { setHostWorkspaces, getHostWorkspaces } from './extensionApi';

class SyncOrchestrator {
    constructor() {
        this.pendingChanges = new Map();
        this.syncInProgress = false;
        this.lastSyncTime = {};
        this.listeners = new Set();
    }

    /**
     * Initialize sync based on environment
     */
    async init() {
        if (isElectronApp()) {
            this.initElectronSync();
        } else if (isExtension()) {
            this.initExtensionSync();
        }

        // Subscribe to local DB changes
        this.subscribeToDBChanges();
    }

    /**
     * Electron app: Use IPC for sync
     */
    initElectronSync() {
        if (!window.electronAPI) return;

        // Listen for remote changes
        window.electronAPI.onWorkspacesUpdated((data) => {
            this.handleRemoteWorkspacesUpdate(data);
        });

        window.electronAPI.onUrlsUpdated((data) => {
            this.handleRemoteUrlsUpdate(data);
        });

        window.electronAPI.onSettingsUpdated((data) => {
            this.handleRemoteSettingsUpdate(data);
        });
    }

    /**
     * Extension: Use HTTP/WebSocket for sync
     */
    initExtensionSync() {
        // WebSocket connection for real-time updates
        this.connectWebSocket();

        // Periodic sync as fallback
        setInterval(() => this.periodicSync(), 30000);
    }

    /**
     * Push local changes to remote
     */
    async pushChanges(type, data) {
        if (isElectronApp() && window.electronAPI) {
            // Use IPC
            switch (type) {
                case 'workspaces':
                    return window.electronAPI.setWorkspaces(data);
                case 'urls':
                    return window.electronAPI.setUrls(data);
                case 'settings':
                    return window.electronAPI.setSettings(data);
            }
        } else {
            // Use HTTP API
            switch (type) {
                case 'workspaces':
                    return setHostWorkspaces(data);
                case 'urls':
                    return setHostUrls(data);
                case 'settings':
                    return setHostSettings(data);
            }
        }
    }

    /**
     * Pull remote changes
     */
    async pullChanges(type) {
        if (isElectronApp() && window.electronAPI) {
            switch (type) {
                case 'workspaces':
                    return window.electronAPI.getWorkspaces();
                case 'urls':
                    return window.electronAPI.getUrls();
                case 'settings':
                    return window.electronAPI.getSettings();
            }
        } else {
            switch (type) {
                case 'workspaces':
                    return getHostWorkspaces();
                case 'urls':
                    return getHostUrls();
                case 'settings':
                    return getHostSettings();
            }
        }
    }

    /**
     * Merge strategy for conflicts
     * Default: Last-write-wins with timestamp comparison
     */
    mergeData(local, remote, type) {
        // Use updatedAt timestamps for conflict resolution
        const merged = new Map();

        // Add all remote items
        for (const item of remote) {
            merged.set(item.id, item);
        }

        // Merge local items (override if newer)
        for (const item of local) {
            const existing = merged.get(item.id);
            if (!existing || (item.updatedAt > existing.updatedAt)) {
                merged.set(item.id, item);
            }
        }

        return Array.from(merged.values());
    }

    /**
     * Full bidirectional sync
     */
    async fullSync() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;

        try {
            // Sync workspaces
            const localWorkspaces = await db.listWorkspaces();
            const remoteWorkspaces = await this.pullChanges('workspaces');
            const mergedWorkspaces = this.mergeData(
                localWorkspaces.data || [],
                remoteWorkspaces.workspaces || [],
                'workspaces'
            );

            // Update both sides with merged data
            await db.bulkSaveWorkspaces(mergedWorkspaces);
            await this.pushChanges('workspaces', mergedWorkspaces);

            // Sync URLs
            const localUrls = await db.listAllUrls();
            const remoteUrls = await this.pullChanges('urls');
            const mergedUrls = this.mergeData(
                localUrls || [],
                remoteUrls.urls || [],
                'urls'
            );

            await db.bulkSaveUrls(mergedUrls);
            await this.pushChanges('urls', mergedUrls);

            // Sync Settings
            const localSettings = await db.getSettings();
            const remoteSettings = await this.pullChanges('settings');
            const mergedSettings = { ...remoteSettings.settings, ...localSettings };

            await db.saveSettings(mergedSettings);
            await this.pushChanges('settings', mergedSettings);

            this.lastSyncTime.full = Date.now();
            this.notifyListeners('sync-complete');

        } catch (error) {
            console.error('[SyncOrchestrator] Full sync failed:', error);
            this.notifyListeners('sync-error', error);
        } finally {
            this.syncInProgress = false;
        }
    }
}

export const syncOrchestrator = new SyncOrchestrator();
```

### 3.2: Environment Detector

**New File:** `src/services/environmentDetector.js`

```javascript
/**
 * Detect runtime environment
 */

export function isElectronApp() {
    return typeof window !== 'undefined' &&
           (window.electronAPI !== undefined ||
            navigator.userAgent.includes('Electron'));
}

export function isExtension() {
    return typeof chrome !== 'undefined' &&
           chrome.runtime &&
           chrome.runtime.id !== undefined;
}

export function isBrowserApp() {
    return !isElectronApp() && !isExtension();
}

export function getEnvironment() {
    if (isElectronApp()) return 'electron';
    if (isExtension()) return 'extension';
    return 'browser';
}
```

---

## Phase 4: Update Chrome Polyfill for Full Compatibility

### 4.1: Enhanced Polyfill

**Updated File:** `src/services/chromePolyfill.js`

```javascript
/**
 * Chrome API Polyfill for Electron
 * Provides comprehensive implementations of chrome.* APIs
 */

const PREFIX = 'chrome_storage_';
const listeners = {
    runtime: [],
    storage: []
};

// Storage API with change notifications
const createStorageAPI = () => ({
    local: {
        async get(keys) {
            const result = {};
            const keyArray = Array.isArray(keys) ? keys :
                            (typeof keys === 'string' ? [keys] :
                            Object.keys(keys || {}));

            for (const key of keyArray) {
                try {
                    const item = localStorage.getItem(PREFIX + key);
                    if (item !== null) {
                        result[key] = JSON.parse(item);
                    }
                } catch (e) {
                    console.warn(`[Chrome Polyfill] Failed to get ${key}:`, e);
                }
            }
            return result;
        },

        async set(items) {
            const changes = {};
            for (const [key, value] of Object.entries(items || {})) {
                try {
                    const oldValue = localStorage.getItem(PREFIX + key);
                    localStorage.setItem(PREFIX + key, JSON.stringify(value));
                    changes[key] = {
                        oldValue: oldValue ? JSON.parse(oldValue) : undefined,
                        newValue: value
                    };
                } catch (e) {
                    console.warn(`[Chrome Polyfill] Failed to set ${key}:`, e);
                }
            }
            // Notify listeners
            notifyStorageChange(changes, 'local');
        },

        async remove(keys) {
            const keyArray = Array.isArray(keys) ? keys : [keys];
            const changes = {};
            for (const key of keyArray) {
                try {
                    const oldValue = localStorage.getItem(PREFIX + key);
                    localStorage.removeItem(PREFIX + key);
                    if (oldValue) {
                        changes[key] = {
                            oldValue: JSON.parse(oldValue),
                            newValue: undefined
                        };
                    }
                } catch (e) {
                    console.warn(`[Chrome Polyfill] Failed to remove ${key}:`, e);
                }
            }
            notifyStorageChange(changes, 'local');
        },

        async clear() {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(PREFIX)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
        }
    },
    onChanged: {
        addListener: (callback) => listeners.storage.push(callback),
        removeListener: (callback) => {
            const idx = listeners.storage.indexOf(callback);
            if (idx > -1) listeners.storage.splice(idx, 1);
        }
    }
});

function notifyStorageChange(changes, areaName) {
    for (const listener of listeners.storage) {
        try {
            listener(changes, areaName);
        } catch (e) {
            console.warn('[Chrome Polyfill] Storage listener error:', e);
        }
    }
}

// Tabs API - Support both callback and promise patterns
const createTabsAPI = () => ({
    query: (queryInfo, callback) => {
        // In Electron, we can use IPC to get actual window info
        const result = [];

        if (window.electronAPI?.getTabs) {
            window.electronAPI.getTabs().then(tabs => {
                if (typeof callback === 'function') {
                    callback(tabs || []);
                }
            });
            return window.electronAPI.getTabs();
        }

        if (typeof callback === 'function') {
            setTimeout(() => callback(result), 0);
            return;
        }
        return Promise.resolve(result);
    },

    update: (tabId, updateProps, callback) => {
        if (typeof callback === 'function') {
            setTimeout(() => callback(), 0);
            return;
        }
        return Promise.resolve();
    },

    create: (createProps, callback) => {
        // Open URL in system browser
        if (createProps?.url) {
            if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(createProps.url);
            } else {
                window.open(createProps.url, '_blank');
            }
        }
        if (typeof callback === 'function') {
            setTimeout(() => callback({ id: -1, url: createProps?.url }), 0);
            return;
        }
        return Promise.resolve({ id: -1, url: createProps?.url });
    },

    remove: (tabIds, callback) => {
        if (typeof callback === 'function') {
            setTimeout(() => callback(), 0);
            return;
        }
        return Promise.resolve();
    },

    onUpdated: {
        addListener: () => {},
        removeListener: () => {}
    },

    onRemoved: {
        addListener: () => {},
        removeListener: () => {}
    },

    onActivated: {
        addListener: () => {},
        removeListener: () => {}
    }
});

// Runtime API
const createRuntimeAPI = () => ({
    sendMessage: (message, callback) => {
        // In Electron, route to IPC
        if (window.electronAPI?.sendMessage) {
            window.electronAPI.sendMessage(message).then(response => {
                if (typeof callback === 'function') {
                    callback(response);
                }
            });
            return window.electronAPI.sendMessage(message);
        }

        const response = {};
        if (typeof callback === 'function') {
            setTimeout(() => callback(response), 0);
        }
        return Promise.resolve(response);
    },

    onMessage: {
        addListener: (listener) => listeners.runtime.push(listener),
        removeListener: (listener) => {
            const idx = listeners.runtime.indexOf(listener);
            if (idx > -1) listeners.runtime.splice(idx, 1);
        }
    },

    // Simulate extension ID for compatibility checks
    id: 'electron-app-polyfill',

    lastError: null,

    getManifest: () => ({
        name: 'CoolDesk Desktop',
        version: '1.0.0'
    }),

    getURL: (path) => {
        // Return file:// or app:// URL for Electron
        return path.startsWith('/') ? path : `/${path}`;
    }
});

// Windows API
const createWindowsAPI = () => ({
    update: (windowId, updateProps, callback) => {
        if (typeof callback === 'function') {
            setTimeout(() => callback(), 0);
            return;
        }
        return Promise.resolve();
    },

    getCurrent: (callback) => {
        const win = { id: 1, focused: true, type: 'normal' };
        if (typeof callback === 'function') {
            setTimeout(() => callback(win), 0);
            return;
        }
        return Promise.resolve(win);
    }
});

// History API (use IndexedDB activity data)
const createHistoryAPI = () => ({
    search: async (query, callback) => {
        // Could integrate with activity_series from IndexedDB
        const results = [];
        if (typeof callback === 'function') {
            setTimeout(() => callback(results), 0);
            return;
        }
        return Promise.resolve(results);
    },

    getVisits: async (details, callback) => {
        const results = [];
        if (typeof callback === 'function') {
            setTimeout(() => callback(results), 0);
            return;
        }
        return Promise.resolve(results);
    }
});

// Bookmarks API (use workspaces/urls from IndexedDB)
const createBookmarksAPI = () => ({
    getTree: async (callback) => {
        const tree = [];
        if (typeof callback === 'function') {
            setTimeout(() => callback(tree), 0);
            return;
        }
        return Promise.resolve(tree);
    },

    search: async (query, callback) => {
        const results = [];
        if (typeof callback === 'function') {
            setTimeout(() => callback(results), 0);
            return;
        }
        return Promise.resolve(results);
    }
});

// Initialize polyfill
export function initChromePolyfill() {
    if (typeof window === 'undefined') return;

    // Create chrome object if missing
    window.chrome = window.chrome || {};

    // Polyfill storage if missing or incomplete
    if (!window.chrome.storage?.local?.get) {
        console.log('[Chrome Polyfill] Adding storage API');
        window.chrome.storage = createStorageAPI();
    }

    // Polyfill tabs if missing
    if (!window.chrome.tabs?.query) {
        console.log('[Chrome Polyfill] Adding tabs API');
        window.chrome.tabs = createTabsAPI();
    }

    // Polyfill runtime if missing
    if (!window.chrome.runtime?.sendMessage) {
        console.log('[Chrome Polyfill] Adding runtime API');
        window.chrome.runtime = createRuntimeAPI();
    }

    // Polyfill windows if missing
    if (!window.chrome.windows?.update) {
        console.log('[Chrome Polyfill] Adding windows API');
        window.chrome.windows = createWindowsAPI();
    }

    // Polyfill history if missing
    if (!window.chrome.history?.search) {
        console.log('[Chrome Polyfill] Adding history API');
        window.chrome.history = createHistoryAPI();
    }

    // Polyfill bookmarks if missing
    if (!window.chrome.bookmarks?.getTree) {
        console.log('[Chrome Polyfill] Adding bookmarks API');
        window.chrome.bookmarks = createBookmarksAPI();
    }

    console.log('[Chrome Polyfill] Initialization complete');
}

// Helper to emit runtime messages (for IPC bridge)
export function emitRuntimeMessage(message, sender = {}) {
    for (const listener of listeners.runtime) {
        try {
            listener(message, sender, () => {});
        } catch (e) {
            console.warn('[Chrome Polyfill] Runtime listener error:', e);
        }
    }
}
```

---

## Phase 5: Implement Real-Time Sync

### 5.1: WebSocket Manager for Extension

**New File:** `src/services/syncWebSocket.js`

```javascript
/**
 * WebSocket connection manager for real-time sync
 */

class SyncWebSocket {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.listeners = new Map();
    }

    connect(url = 'ws://127.0.0.1:4000') {
        if (this.ws?.readyState === WebSocket.OPEN) return;

        try {
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                console.log('[SyncWS] Connected');
                this.reconnectAttempts = 0;
                this.emit('connected');
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (e) {
                    console.warn('[SyncWS] Invalid message:', e);
                }
            };

            this.ws.onclose = () => {
                console.log('[SyncWS] Disconnected');
                this.emit('disconnected');
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.warn('[SyncWS] Error:', error);
            };

        } catch (e) {
            console.error('[SyncWS] Connection failed:', e);
            this.scheduleReconnect();
        }
    }

    handleMessage(data) {
        const { type, payload } = data;

        switch (type) {
            case 'workspaces-updated':
                this.emit('workspaces', payload);
                break;
            case 'urls-updated':
                this.emit('urls', payload);
                break;
            case 'settings-updated':
                this.emit('settings', payload);
                break;
            case 'activity-updated':
                this.emit('activity', payload);
                break;
            case 'sync-request':
                this.emit('sync-request', payload);
                break;
        }
    }

    send(type, payload) {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            console.warn('[SyncWS] Cannot send, not connected');
            return false;
        }

        this.ws.send(JSON.stringify({ type, payload }));
        return true;
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
    }

    off(event, callback) {
        this.listeners.get(event)?.delete(callback);
    }

    emit(event, data) {
        this.listeners.get(event)?.forEach(cb => {
            try { cb(data); } catch (e) { console.warn('[SyncWS] Listener error:', e); }
        });
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[SyncWS] Max reconnect attempts reached');
            return;
        }

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;

        setTimeout(() => this.connect(), delay);
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

export const syncWebSocket = new SyncWebSocket();
```

### 5.2: BroadcastChannel for Multi-Tab Sync

**New File:** `src/services/syncBroadcast.js`

```javascript
/**
 * BroadcastChannel for syncing between browser tabs/windows
 */

const CHANNEL_NAME = 'cooldesk-sync';

class SyncBroadcast {
    constructor() {
        this.channel = null;
        this.listeners = new Map();
        this.init();
    }

    init() {
        if (typeof BroadcastChannel === 'undefined') return;

        this.channel = new BroadcastChannel(CHANNEL_NAME);

        this.channel.onmessage = (event) => {
            const { type, payload, source } = event.data;

            // Ignore own messages
            if (source === this.id) return;

            this.emit(type, payload);
        };
    }

    get id() {
        if (!this._id) {
            this._id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
        return this._id;
    }

    broadcast(type, payload) {
        if (!this.channel) return;

        this.channel.postMessage({
            type,
            payload,
            source: this.id,
            timestamp: Date.now()
        });
    }

    on(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(callback);
    }

    off(type, callback) {
        this.listeners.get(type)?.delete(callback);
    }

    emit(type, payload) {
        this.listeners.get(type)?.forEach(cb => {
            try { cb(payload); } catch (e) { console.warn('[SyncBC] Listener error:', e); }
        });
    }
}

export const syncBroadcast = new SyncBroadcast();
```

---

## Phase 6: Update App.jsx Integration

### 6.1: Add Sync Hook

**New File:** `src/hooks/useSync.js`

```javascript
import { useEffect, useState, useCallback } from 'react';
import { syncOrchestrator } from '../services/syncOrchestrator';
import { isElectronApp, isExtension } from '../services/environmentDetector';

export function useSync() {
    const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, error
    const [lastSyncTime, setLastSyncTime] = useState(null);
    const [syncEnabled, setSyncEnabled] = useState(true);

    useEffect(() => {
        // Initialize sync on mount
        syncOrchestrator.init();

        // Subscribe to sync events
        const handleSyncComplete = () => {
            setSyncStatus('idle');
            setLastSyncTime(Date.now());
        };

        const handleSyncError = (error) => {
            setSyncStatus('error');
            console.error('[useSync] Sync error:', error);
        };

        const handleSyncStart = () => {
            setSyncStatus('syncing');
        };

        syncOrchestrator.on('sync-complete', handleSyncComplete);
        syncOrchestrator.on('sync-error', handleSyncError);
        syncOrchestrator.on('sync-start', handleSyncStart);

        return () => {
            syncOrchestrator.off('sync-complete', handleSyncComplete);
            syncOrchestrator.off('sync-error', handleSyncError);
            syncOrchestrator.off('sync-start', handleSyncStart);
        };
    }, []);

    const triggerSync = useCallback(async () => {
        if (!syncEnabled) return;
        await syncOrchestrator.fullSync();
    }, [syncEnabled]);

    const toggleSync = useCallback((enabled) => {
        setSyncEnabled(enabled);
    }, []);

    return {
        syncStatus,
        lastSyncTime,
        syncEnabled,
        triggerSync,
        toggleSync,
        isElectron: isElectronApp(),
        isExtension: isExtension()
    };
}
```

### 6.2: Update App.jsx

```javascript
// Add to App.jsx imports
import { useSync } from './hooks/useSync';

// Inside App component
const { syncStatus, lastSyncTime, triggerSync, isElectron } = useSync();

// Add sync status indicator (optional UI)
// Add manual sync button in settings
```

---

## Phase 7: Database Updates

### 7.1: Add Sync Metadata to Records

Update `src/db/unified-db.js` to include sync metadata:

```javascript
// Add to workspace schema
{
    id: 'ws_123',
    name: 'My Workspace',
    // ... existing fields
    syncedAt: null,      // Last sync timestamp
    localUpdatedAt: 0,   // Local modification time
    remoteUpdatedAt: 0,  // Remote modification time
    syncStatus: 'synced' // synced | pending | conflict
}
```

### 7.2: Add Bulk Operations

```javascript
// Add to unified-api.js
export async function bulkSaveWorkspaces(workspaces) {
    const db = await getDB();
    const tx = db.transaction('workspaces', 'readwrite');

    for (const ws of workspaces) {
        await tx.store.put({
            ...ws,
            localUpdatedAt: Date.now()
        });
    }

    await tx.done;
    notifyWorkspaceChange();
}

export async function bulkSaveUrls(urls) {
    const db = await getDB();
    const tx = db.transaction('workspace_urls', 'readwrite');

    for (const url of urls) {
        await tx.store.put({
            ...url,
            localUpdatedAt: Date.now()
        });
    }

    await tx.done;
}
```

---

## Phase 8: Testing & Validation

### 8.1: Test Scenarios

1. **Extension → Electron Sync**
   - Create workspace in extension
   - Verify it appears in Electron app
   - Modify in extension, verify update propagates

2. **Electron → Extension Sync**
   - Create workspace in Electron
   - Verify it appears in extension
   - Modify in Electron, verify update propagates

3. **Conflict Resolution**
   - Modify same workspace in both simultaneously
   - Verify last-write-wins or proper merge

4. **Offline Resilience**
   - Make changes while Electron is offline
   - Reconnect and verify sync completes

5. **Multi-Tab Sync**
   - Open multiple extension tabs
   - Make change in one, verify others update

### 8.2: Debug Logging

Add comprehensive logging:
```javascript
// Add to all sync operations
console.log('[Sync]', {
    operation: 'push',
    type: 'workspaces',
    count: data.length,
    timestamp: Date.now()
});
```

---

## Implementation Order

1. **Phase 1** - Fix Chrome API issues (immediate, critical)
2. **Phase 4** - Update Chrome Polyfill (immediate, critical)
3. **Phase 2** - Enhance Electron main process (required for sync)
4. **Phase 3** - Create Sync Orchestrator (core sync logic)
5. **Phase 5** - Real-time sync (WebSocket/BroadcastChannel)
6. **Phase 6** - App.jsx integration
7. **Phase 7** - Database updates
8. **Phase 8** - Testing

---

## Files to Create/Modify

### New Files:
- `electron-preload.js`
- `src/services/syncOrchestrator.js`
- `src/services/environmentDetector.js`
- `src/services/syncWebSocket.js`
- `src/services/syncBroadcast.js`
- `src/hooks/useSync.js`

### Modified Files:
- `electron-main.js` (add HTTP server, IPC handlers)
- `src/services/chromePolyfill.js` (enhanced polyfill)
- `src/App.jsx` (fix direct chrome calls, add sync integration)
- `src/db/unified-db.js` (add sync metadata)
- `src/db/unified-api.js` (add bulk operations)
- `package.json` (add express, ws dependencies for Electron)

---

## Dependencies to Add

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.14.2",
    "cors": "^2.8.5"
  }
}
```

---

## Risk Mitigation

1. **Data Loss Prevention**
   - Always merge, never overwrite blindly
   - Keep local backup before sync
   - Transaction-based updates

2. **Performance**
   - Debounce sync operations
   - Batch updates
   - Incremental sync (only changed items)

3. **Security**
   - Localhost-only HTTP server
   - No external network exposure
   - Validate all incoming data

4. **Backwards Compatibility**
   - Extension works without Electron
   - Electron works without extension
   - Graceful degradation
