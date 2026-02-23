
// Shim for window.electron to work with Tauri + Sidecar
// Maps existing Electron usage to Tauri Invokes (System) and Sidecar Fetch/WS (Data/AI)

import { invoke } from '@tauri-apps/api/core';

// Sidecar Sync/LLM endpoints are on localhost:4000
const SIDECAR_URL = 'http://localhost:4000';
const WS_URL = 'ws://localhost:4000';

let ws = null;
const listeners = new Map(); // channel -> Set<callback>

// Initialize WebSocket connection to Sidecar
function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log('[TauriShim] WS Connected');
        // Identify this client to the sidecar
        try { ws.send(JSON.stringify({ type: 'identify', client: 'tauri-frontend' })); } catch { }
    };

    ws.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);
            // msg format from sidecar: { type, payload }
            // Electron format expected: (event, arg) -> but frontend usually subscribes to 'channel'

            // Handle native focus request from extension
            if (msg.type === 'native-focus' && msg.payload?.browser) {
                console.log('[TauriShim] Native focus requested for:', msg.payload.browser);
                try {
                    await invoke('focus_window', { pid: 0, name: msg.payload.browser });
                } catch (e) {
                    console.warn('[TauriShim] Native focus failed:', e);
                }
                return;
            }

            // Map sidecar types to electron channels
            // e.g. 'workspaces-updated' -> 'workspaces-updated'

            // Sidecar sends: { type: 'workspaces-updated', payload: [...] }
            // Frontend generic subscriber: electron.subscribe(channel, cb)

            if (listeners.has(msg.type)) {
                listeners.get(msg.type).forEach(cb => cb(msg.payload)); // Pass payload directly
            }

            // Handle specific structured messages like LLM responses
            if (msg.type.startsWith('llm-')) {
                if (listeners.has(msg.type)) {
                    listeners.get(msg.type).forEach(cb => cb(msg.payload));
                }
            }

        } catch (e) {
            console.error('[TauriShim] WS Error:', e);
        }
    };

    ws.onclose = () => {
        console.log('[TauriShim] WS Closed, reconnecting...');
        setTimeout(connectWebSocket, 3000);
    };
}

// Ensure connection starts
// Ensure connection starts
if (typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)) {
    connectWebSocket();
}

const electronAPI = {
    // ==========================================
    // SYNC / DATA (via Sidecar)
    // ==========================================

    getWorkspaces: async () => {
        const res = await fetch(`${SIDECAR_URL}/workspaces`);
        return res.json();
    },

    setWorkspaces: async (data) => {
        await fetch(`${SIDECAR_URL}/workspaces`, { method: 'POST', body: JSON.stringify(data) });
        return { ok: true };
    },

    getUrls: async () => (await fetch(`${SIDECAR_URL}/urls`)).json(),
    setUrls: async (data) => { await fetch(`${SIDECAR_URL}/urls`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    getSettings: async () => (await fetch(`${SIDECAR_URL}/settings`)).json(),
    saveSettings: async (data) => { await fetch(`${SIDECAR_URL}/settings`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    // ... Map other getters/setters similarly ...
    getTabs: async () => (await fetch(`${SIDECAR_URL}/tabs`)).json(),
    setTabs: async (data) => { await fetch(`${SIDECAR_URL}/tabs`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    // Missing Sync/Data Getters & Setters
    getNotes: async () => (await fetch(`${SIDECAR_URL}/notes`)).json(),
    setNotes: async (data) => { await fetch(`${SIDECAR_URL}/notes`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    getUrlNotes: async () => (await fetch(`${SIDECAR_URL}/url-notes`)).json(),
    setUrlNotes: async (data) => { await fetch(`${SIDECAR_URL}/url-notes`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    getPins: async () => (await fetch(`${SIDECAR_URL}/pins`)).json(),
    setPins: async (data) => { await fetch(`${SIDECAR_URL}/pins`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    getScrapedChats: async () => (await fetch(`${SIDECAR_URL}/scraped-chats`)).json(),
    setScrapedChats: async (data) => { await fetch(`${SIDECAR_URL}/scraped-chats`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    getScrapedConfigs: async () => (await fetch(`${SIDECAR_URL}/scraped-configs`)).json(),
    setScrapedConfigs: async (data) => { await fetch(`${SIDECAR_URL}/scraped-configs`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    getDailyMemory: async () => (await fetch(`${SIDECAR_URL}/daily-memory`)).json(),
    setDailyMemory: async (data) => { await fetch(`${SIDECAR_URL}/daily-memory`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    getUiState: async () => (await fetch(`${SIDECAR_URL}/ui-state`)).json(),
    setUiState: async (data) => { await fetch(`${SIDECAR_URL}/ui-state`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    getDashboard: async () => (await fetch(`${SIDECAR_URL}/dashboard`)).json(),
    setDashboard: async (data) => { await fetch(`${SIDECAR_URL}/dashboard`, { method: 'POST', body: JSON.stringify(data) }); return { ok: true }; },

    // Activity
    getActivity: async () => (await fetch(`${SIDECAR_URL}/activity`)).json(),

    // ==========================================
    // LLM / AI (via Sidecar)
    // ==========================================
    llm: {
        getModels: async () => (await fetch(`${SIDECAR_URL}/llm/models`)).json(),
        getStatus: async () => (await fetch(`${SIDECAR_URL}/llm/status`)).json(),
        downloadModel: async (modelName) => {
            const res = await fetch(`${SIDECAR_URL}/llm/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelName })
            });
            return res.json();
        },
        loadModel: async (modelName) => {
            const res = await fetch(`${SIDECAR_URL}/llm/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelName })
            });
            return res.json();
        },
        unloadModel: async () => {
            const res = await fetch(`${SIDECAR_URL}/llm/unload`, { method: 'POST' });
            return res.json();
        },
        onProgress: (callback) => {
            // Subscribe to all LLM events
            const handler = (payload) => callback(payload);
            const events = ['llm-download-progress', 'llm-loading', 'llm-loaded', 'llm-error'];

            events.forEach(auth => {
                if (!listeners.has(auth)) listeners.set(auth, new Set());
                listeners.get(auth).add(handler);
            });

            // Return unsubscribe function
            return () => {
                events.forEach(auth => {
                    const set = listeners.get(auth);
                    if (set) set.delete(handler);
                });
            };
        }
    },

    // ==========================================
    // SYSTEM (via Tauri Rust)
    // ==========================================

    getRunningApps: async () => {
        // Rust command (we need to implement 'get_running_apps')
        // Or if using Sidecar for scanning? 
        // Plan said: "Port get-running-apps" to Rust
        try {
            return await invoke('get_running_apps');
        } catch (e) {
            console.warn('getRunningApps failed:', e);
            return [];
        }
    },

    getInstalledApps: async () => {
        try {
            return await invoke('get_installed_apps');
        } catch (e) {
            console.warn('getInstalledApps failed:', e);
            return [];
        }
    },

    focusWindow: async (pid) => {
        return await invoke('focus_window', { pid });
    },

    toggleSpotlight: async () => {
        return await invoke('toggle_spotlight');
    },

    openExternal: async (url) => {
        // Use Tauri shell open
        const { open } = await import('@tauri-apps/plugin-shell');
        return open(url);
    },

    // ==========================================
    // IPC / MESSAGING
    // ==========================================

    sendMessage: async (msg) => {
        // Handle Spotlight commands
        if (msg?.type === 'SPOTLIGHT_HIDE') {
            return await invoke('toggle_spotlight');
        }

        // Handle Tab commands
        if (msg?.type === 'SEARCH_TABS') {
            // Re-use logic from getTabs
            const tabs = await (await fetch(`${SIDECAR_URL}/tabs`)).json();
            // Filter if query exists
            if (msg.query) {
                const q = msg.query.toLowerCase();
                return { results: tabs.filter(t => t.title?.toLowerCase().includes(q) || t.url?.toLowerCase().includes(q)) };
            }
            return { results: tabs };
        }

        if (msg?.type === 'JUMP_TO_TAB') {
            console.log('[Shim] JUMP_TO_TAB requested:', msg.tabId);
            try {
                // Fire-and-forget: sidecar broadcasts to browser extensions for chrome.tabs.update
                fetch(`${SIDECAR_URL}/cmd/jump-to-tab`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tabId: msg.tabId, windowId: msg.windowId })
                }).catch(() => { });

                // Hide spotlight immediately
                invoke('hide_spotlight').catch(() => invoke('toggle_spotlight').catch(() => { }));

                // Focus the correct browser using _deviceId (e.g. "chrome-abc123" → "chrome")
                if (msg._deviceId) {
                    const browserKey = msg._deviceId.split('-')[0];
                    const processMap = {
                        chrome: 'chrome', edge: 'msedge', brave: 'brave',
                        firefox: 'firefox', opera: 'opera', vivaldi: 'vivaldi'
                    };
                    const processName = processMap[browserKey];
                    if (processName) {
                        invoke('focus_window', { pid: 0, name: processName }).catch(() => { });
                    }
                }

                return { success: true };
            } catch (e) {
                console.error('[Shim] JUMP_TO_TAB failed:', e);
                return { success: false, error: e.message };
            }
        }

        // Handle Workspace commands
        if (msg?.type === 'SEARCH_WORKSPACES') {
            const workspaces = await (await fetch(`${SIDECAR_URL}/workspaces`)).json();
            const wsResults = [];
            const q = (msg.query || '').toLowerCase();

            workspaces.forEach(ws => {
                // 1. Match Workspace Name
                if (ws.name?.toLowerCase().includes(q) || ws.description?.toLowerCase().includes(q)) {
                    wsResults.push({
                        id: ws.id,
                        title: ws.name,
                        description: `${(ws.urls || []).length} items`,
                        type: 'workspace',
                        favicon: null
                    });
                }

                // 2. Match URLs inside Workspace
                if (ws.urls && Array.isArray(ws.urls)) {
                    ws.urls.forEach(u => {
                        const uTitle = (u.title || '').toLowerCase();
                        const uUrl = (u.url || '').toLowerCase();
                        if (uTitle.includes(q) || uUrl.includes(q)) {
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

            return { results: wsResults.slice(0, 20) };
        }

        // Handle History commands (Activity Log)
        if (msg?.type === 'SEARCH_HISTORY') {
            const q = (msg.query || '').toLowerCase();
            // Fetch activity from sidecar
            const activity = await (await fetch(`${SIDECAR_URL}/activity`)).json();

            // Filter for unique URLs that match query
            const seenUrls = new Set();
            const results = activity
                .filter(a => {
                    if (!a.data?.url) return false;
                    if (seenUrls.has(a.data.url)) return false;
                    const matches = (a.data.title || '').toLowerCase().includes(q) ||
                        (a.data.url || '').toLowerCase().includes(q);
                    if (matches) seenUrls.add(a.data.url);
                    return matches;
                })
                .map(a => ({
                    id: `hist-${a.id}`,
                    title: a.data.title,
                    url: a.data.url,
                    type: 'history',
                    description: 'Recent History',
                    favicon: a.data.favicon,
                    lastVisitTime: a.timestamp
                }))
                .slice(0, msg.maxResults || 20);

            return { results };
        }

        // Handle Bookmark commands (Pins + Saved URLs)
        if (msg?.type === 'SEARCH_BOOKMARKS') {
            const q = (msg.query || '').toLowerCase();
            const [pins, urls] = await Promise.all([
                (await fetch(`${SIDECAR_URL}/pins`)).json(),
                (await fetch(`${SIDECAR_URL}/urls`)).json()
            ]);

            const results = [];

            // Add Pins
            (pins.spotlight_pins || []).forEach(p => {
                if ((p.title || p.name || '').toLowerCase().includes(q) || (p.url || '').toLowerCase().includes(q)) {
                    results.push({
                        ...p,
                        id: `pin-${p.url || p.name}`,
                        type: 'bookmark',
                        description: 'Pinned Item'
                    });
                }
            });

            // Add Saved URLs
            (urls || []).forEach(u => {
                if ((u.title || '').toLowerCase().includes(q) || (u.url || '').toLowerCase().includes(q)) {
                    results.push({
                        id: `saved-${u.id}`,
                        title: u.title,
                        url: u.url,
                        type: 'bookmark',
                        description: 'Saved URL',
                        favicon: u.favicon
                    });
                }
            });

            return { results: results.slice(0, msg.maxResults || 20) };
        }

        // Handle Note commands
        if (msg?.action === 'saveUrlNote') {
            await fetch(`${SIDECAR_URL}/url-notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(msg.note)
            });
            return { success: true };
        }

        // Default: Log unhandled
        console.warn('[Shim] Unhandled sendMessage:', msg);
        return { success: false, error: 'Unhandled message type' };
    },

    // App Management
    launchApp: async (path) => {
        try {
            return await invoke('launch_app', { path });
        } catch (e) {
            console.error('Failed to launch app:', e);
        }
    },

    focusApp: async (pid, name) => {
        return await invoke('focus_window', { pid, name });
    },

    // ==========================================
    // LLM (via Sidecar WebSocket)
    // ==========================================

    llm: {
        getStatus: () => {
            if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'llm-get-status' }));
            // Getting response is async via listener 'llm-status'
            // Electron implementation was invoke (promise).
            // This is a mismatch. Electron keys were:
            // llm: { getStatus: () => ipcRenderer.invoke('llm:get-status') }

            // We need to bridge Promise <-> WS
            return new Promise((resolve, reject) => {
                // One-time listener? Or simple fetch?
                // Sidecar supports HTTP for simple gets? No, WS for LLM.
                // We'll need a request/response correlation ID map if we want to support generic invoke-like behavior via WS.
                // OR just use fetch for status if we add it to HTTP.
                // For now, let's assume we might need to Refactor Frontend LLM calls to be event driven OR implement Req/Res over WS.
                // Electron implementation was request/response.

                // Hack: use a temporary listener
                const handler = (e, payload) => {
                    resolve(payload);
                    // cleanup? listeners is a Map<string, Set>.
                };
                // Adding 'once' support to listeners map would be needed. 
                // For MVP, let's just return a mock or fix this later.
                console.warn('llm.getStatus via WS promise not fully implemented shim');
                resolve({ initialized: true }); // Mock
            });
        },

        chat: async (prompt, options) => {
            const requestId = Date.now().toString();
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'llm-chat', payload: { prompt, options, requestId } }));
            }

            // Wait for specific requestId response
            return new Promise((resolve) => {
                const check = (e, payload) => {
                    if (payload.requestId === requestId) {
                        // remove listener
                        resolve(payload.response || payload);
                    }
                };
                // register check...
            });
        },

        // ...
    },

    // ==========================================
    // EVENTS
    // ==========================================

    subscribe: (channel, callback) => {
        if (!listeners.has(channel)) {
            listeners.set(channel, new Set());
        }
        listeners.get(channel).add(callback);

        // Return unsubscribe function
        return () => {
            const set = listeners.get(channel);
            if (set) set.delete(callback);
        };
    },

    on: (channel, callback) => {
        // Same as subscribe
        if (!listeners.has(channel)) {
            listeners.set(channel, new Set());
        }
        listeners.get(channel).add(callback);
    },

    off: (channel, callback) => {
        const set = listeners.get(channel);
        if (set) set.delete(callback);
    }
};

// Expose globally
// Expose globally if running in Tauri (checking both public and internal objects)
if (typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)) {
    window.electronAPI = electronAPI;
    // Also legacy window.electron if used
    window.electron = electronAPI;
    console.log('[ElectronShim] Initialized window.electronAPI');
}
