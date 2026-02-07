/**
 * Chrome API Polyfill for Electron
 * Provides comprehensive implementations of chrome.* APIs
 * Supports both callback and promise patterns for compatibility
 */

const PREFIX = 'chrome_storage_';
const listeners = {
    runtime: [],
    storage: []
};

// Notify storage change listeners
function notifyStorageChange(changes, areaName) {
    for (const listener of listeners.storage) {
        try {
            listener(changes, areaName);
        } catch (e) {
            console.warn('[Chrome Polyfill] Storage listener error:', e);
        }
    }
}

// Storage API with change notifications
const createStorageAPI = () => ({
    local: {
        get(keys, callback) {
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

            // Support both callback and promise patterns
            if (typeof callback === 'function') {
                setTimeout(() => callback(result), 0);
                return;
            }
            return Promise.resolve(result);
        },

        set(items, callback) {
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

            if (typeof callback === 'function') {
                setTimeout(() => callback(), 0);
                return;
            }
            return Promise.resolve();
        },

        remove(keys, callback) {
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

            if (typeof callback === 'function') {
                setTimeout(() => callback(), 0);
                return;
            }
            return Promise.resolve();
        },

        clear(callback) {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(PREFIX)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));

            if (typeof callback === 'function') {
                setTimeout(() => callback(), 0);
                return;
            }
            return Promise.resolve();
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

const tabListeners = {
    onUpdated: [],
    onCreated: [],
    onRemoved: [],
    onActivated: []
};

function notifyTabListeners() {
    // specific args don't matter for TabManagement as it just refreshes
    tabListeners.onUpdated.forEach(cb => cb());
    tabListeners.onCreated.forEach(cb => cb());
    tabListeners.onRemoved.forEach(cb => cb());
    tabListeners.onActivated.forEach(cb => cb());
}

// Subscribe to global sync updates to trigger listeners
if (typeof window !== 'undefined' && window.electronAPI?.subscribe) {
    window.electronAPI.subscribe('tabs-updated', () => {
        console.log('[Chrome Polyfill] Tabs updated, notifying listeners');
        notifyTabListeners();
    });
}

// Tabs API - Support both callback and promise patterns
const createTabsAPI = () => ({
    query: (queryInfo, callback) => {
        // ... (existing query implementation)
        // In Electron, we can use IPC to get actual window info if available
        const result = [];

        if (typeof window !== 'undefined' && window.electronAPI?.getTabs) {
            const promise = window.electronAPI.getTabs();
            if (typeof callback === 'function') {
                promise.then(tabs => callback(tabs || []));
                return;
            }
            return promise;
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
        // ... (existing create implementation)
        // Open URL in system browser
        if (createProps?.url) {
            if (typeof window !== 'undefined' && window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(createProps.url);
            } else if (typeof window !== 'undefined') {
                window.open(createProps.url, '_blank');
            }
        }
        const tab = { id: -1, url: createProps?.url };
        if (typeof callback === 'function') {
            setTimeout(() => callback(tab), 0);
            return;
        }
        return Promise.resolve(tab);
    },

    remove: (tabIds, callback) => {
        if (typeof callback === 'function') {
            setTimeout(() => callback(), 0);
            return;
        }
        return Promise.resolve();
    },

    duplicate: (tabId, callback) => {
        if (typeof callback === 'function') {
            setTimeout(() => callback(), 0);
            return;
        }
        return Promise.resolve();
    },

    reload: (tabId, reloadProperties, callback) => {
        // ... (existing reload implementation)
        // Handle optional reloadProperties parameter
        const cb = typeof reloadProperties === 'function' ? reloadProperties : callback;
        if (typeof cb === 'function') {
            setTimeout(() => cb(), 0);
            return;
        }
        return Promise.resolve();
    },

    onUpdated: {
        addListener: (cb) => tabListeners.onUpdated.push(cb),
        removeListener: (cb) => {
            const idx = tabListeners.onUpdated.indexOf(cb);
            if (idx > -1) tabListeners.onUpdated.splice(idx, 1);
        }
    },

    onRemoved: {
        addListener: (cb) => tabListeners.onRemoved.push(cb),
        removeListener: (cb) => {
            const idx = tabListeners.onRemoved.indexOf(cb);
            if (idx > -1) tabListeners.onRemoved.splice(idx, 1);
        }
    },

    onActivated: {
        addListener: (cb) => tabListeners.onActivated.push(cb),
        removeListener: (cb) => {
            const idx = tabListeners.onActivated.indexOf(cb);
            if (idx > -1) tabListeners.onActivated.splice(idx, 1);
        }
    },

    onCreated: { // Missing but useful
        addListener: (cb) => tabListeners.onCreated.push(cb),
        removeListener: (cb) => {
            const idx = tabListeners.onCreated.indexOf(cb);
            if (idx > -1) tabListeners.onCreated.splice(idx, 1);
        }
    },

    onMoved: { addListener: () => { }, removeListener: () => { } },
    onDetached: { addListener: () => { }, removeListener: () => { } },
    onAttached: { addListener: () => { }, removeListener: () => { } }
});

// Runtime API
const createRuntimeAPI = () => ({
    sendMessage: (message, responseCallback) => {
        // Handle optional options parameter
        const callback = typeof responseCallback === 'function' ? responseCallback :
            (typeof message === 'function' ? message : null);

        // In Electron, route to IPC if available
        if (typeof window !== 'undefined' && window.electronAPI?.sendMessage) {
            const promise = window.electronAPI.sendMessage(message);
            if (typeof callback === 'function') {
                promise.then(response => callback(response));
                return;
            }
            return promise;
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
    },

    openOptionsPage: (callback) => {
        if (typeof callback === 'function') {
            setTimeout(() => callback(), 0);
            return;
        }
        return Promise.resolve();
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

    getCurrent: (getInfo, callback) => {
        const cb = typeof getInfo === 'function' ? getInfo : callback;
        const win = { id: 1, focused: true, type: 'normal' };
        if (typeof cb === 'function') {
            setTimeout(() => cb(win), 0);
            return;
        }
        return Promise.resolve(win);
    },

    getAll: (getInfo, callback) => {
        const cb = typeof getInfo === 'function' ? getInfo : callback;
        const windows = [{ id: 1, focused: true, type: 'normal' }];
        if (typeof cb === 'function') {
            setTimeout(() => cb(windows), 0);
            return;
        }
        return Promise.resolve(windows);
    }
});

// History API (returns empty results in Electron)
const createHistoryAPI = () => ({
    search: (query, callback) => {
        const results = [];
        if (typeof callback === 'function') {
            setTimeout(() => callback(results), 0);
            return;
        }
        return Promise.resolve(results);
    },

    getVisits: (details, callback) => {
        const results = [];
        if (typeof callback === 'function') {
            setTimeout(() => callback(results), 0);
            return;
        }
        return Promise.resolve(results);
    },

    addUrl: (details, callback) => {
        if (typeof callback === 'function') {
            setTimeout(() => callback(), 0);
            return;
        }
        return Promise.resolve();
    },

    deleteUrl: (details, callback) => {
        if (typeof callback === 'function') {
            setTimeout(() => callback(), 0);
            return;
        }
        return Promise.resolve();
    }
});

// Bookmarks API (returns empty results in Electron)
const createBookmarksAPI = () => ({
    getTree: (callback) => {
        const tree = [];
        if (typeof callback === 'function') {
            setTimeout(() => callback(tree), 0);
            return;
        }
        return Promise.resolve(tree);
    },

    search: (query, callback) => {
        const results = [];
        if (typeof callback === 'function') {
            setTimeout(() => callback(results), 0);
            return;
        }
        return Promise.resolve(results);
    },

    getRecent: (numberOfItems, callback) => {
        const results = [];
        if (typeof callback === 'function') {
            setTimeout(() => callback(results), 0);
            return;
        }
        return Promise.resolve(results);
    }
});

// Initialize polyfill - checks for specific API availability
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
            listener(message, sender, () => { });
        } catch (e) {
            console.warn('[Chrome Polyfill] Runtime listener error:', e);
        }
    }
}
