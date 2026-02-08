/**
 * Electron Preload Script
 * Provides secure IPC bridge between renderer and main process
 * Supports both API (request-response) and Events (push notifications) patterns
 */

const { contextBridge, ipcRenderer } = require('electron');

// Whitelist of allowed event channels for security
const VALID_CHANNELS = [
    'workspaces-updated',
    'urls-updated',
    'settings-updated',
    'activity-updated',
    'notes-updated',
    'url-notes-updated',
    'pins-updated',
    'scraped-chats-updated',
    'scraped-configs-updated',
    'daily-memory-updated',
    'ui-state-updated',
    'tabs-updated',
    'dashboard-updated',
    'sync-status',
    'sync-conflict',
    'sync-error',
    'sync-complete',
    'spotlight-shown'
];

contextBridge.exposeInMainWorld('electronAPI', {
    // ==========================================
    // API PATTERN - Renderer asks Main (Request-Response)
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

    // Notes
    getNotes: () => ipcRenderer.invoke('sync:get-notes'),
    setNotes: (data) => ipcRenderer.invoke('sync:set-notes', data),

    // URL Notes
    getUrlNotes: () => ipcRenderer.invoke('sync:get-url-notes'),
    setUrlNotes: (data) => ipcRenderer.invoke('sync:set-url-notes', data),

    // Pins
    getPins: () => ipcRenderer.invoke('sync:get-pins'),
    setPins: (data) => ipcRenderer.invoke('sync:set-pins', data),

    // Scraped Chats
    getScrapedChats: () => ipcRenderer.invoke('sync:get-scraped-chats'),
    setScrapedChats: (data) => ipcRenderer.invoke('sync:set-scraped-chats', data),

    // Scraped Configs
    getScrapedConfigs: () => ipcRenderer.invoke('sync:get-scraped-configs'),
    setScrapedConfigs: (data) => ipcRenderer.invoke('sync:set-scraped-configs', data),

    // Daily Memory
    getDailyMemory: () => ipcRenderer.invoke('sync:get-daily-memory'),
    setDailyMemory: (data) => ipcRenderer.invoke('sync:set-daily-memory', data),

    // UI State (both naming conventions for compatibility)
    getUIState: () => ipcRenderer.invoke('sync:get-ui-state'),
    setUIState: (data) => ipcRenderer.invoke('sync:set-ui-state', data),
    getUiState: () => ipcRenderer.invoke('sync:get-ui-state'),
    setUiState: (data) => ipcRenderer.invoke('sync:set-ui-state', data),

    // Dashboard
    getDashboard: () => ipcRenderer.invoke('sync:get-dashboard'),
    setDashboard: (data) => ipcRenderer.invoke('sync:set-dashboard', data),

    // Tabs
    getTabs: () => ipcRenderer.invoke('sync:get-tabs'),
    setTabs: (data) => ipcRenderer.invoke('sync:set-tabs', data),

    // Full sync trigger
    triggerSync: () => ipcRenderer.invoke('sync:trigger-full'),

    // System operations
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    focusWindow: (pid) => ipcRenderer.invoke('focus-window', pid),
    getProcesses: () => ipcRenderer.invoke('get-processes'),

    // App discovery (cross-platform)
    getRunningApps: () => ipcRenderer.invoke('get-running-apps'),
    getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
    focusApp: (pid) => ipcRenderer.invoke('focus-app', pid),
    launchApp: (path) => ipcRenderer.invoke('launch-app', path),

    // App info
    getAppPath: () => ipcRenderer.invoke('get-app-path'),
    getVersion: () => ipcRenderer.invoke('get-version'),

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
        if (!VALID_CHANNELS.includes(channel)) {
            console.warn(`[Preload] Invalid channel: ${channel}`);
            return () => { };
        }

        const handler = (_event, data) => callback(data);
        ipcRenderer.on(channel, handler);

        // Return cleanup function
        return () => ipcRenderer.removeListener(channel, handler);
    },

    /**
     * One-time event listener
     * @param {string} channel - Event channel name
     * @param {Function} callback - Handler function
     */
    once: (channel, callback) => {
        if (!VALID_CHANNELS.includes(channel)) {
            console.warn(`[Preload] Invalid channel for once: ${channel}`);
            return;
        }

        ipcRenderer.once(channel, (_event, data) => callback(data));
    },

    /**
     * Send a message to main process (fire-and-forget)
     * @param {string} channel - Channel name
     * @param {any} data - Data to send
     */
    send: (channel, data) => {
        const validSendChannels = [
            'sync:request-push',
            'sync:notify-change',
            'log:info',
            'log:error'
        ];

        if (validSendChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        } else {
            console.warn(`[Preload] Invalid send channel: ${channel}`);
        }
    },

    // ==========================================
    // RUNTIME MESSAGE BRIDGE (for chrome.runtime.sendMessage compatibility)
    // ==========================================

    /**
     * Send a message and get a response (mimics chrome.runtime.sendMessage)
     * @param {object} message - Message object
     * @returns {Promise<any>} Response from main process
     */
    sendMessage: (message) => ipcRenderer.invoke('runtime:send-message', message),

    /**
     * Add a message listener (mimics chrome.runtime.onMessage.addListener)
     * @param {Function} callback - Message handler
     * @returns {Function} Remove listener function
     */
    onMessage: (callback) => {
        const handler = (_event, message, sender) => {
            // Create a sendResponse function that sends back via IPC
            const sendResponse = (response) => {
                ipcRenderer.send('runtime:message-response', { response });
            };
            callback(message, sender, sendResponse);
        };

        ipcRenderer.on('runtime:message', handler);

        return () => ipcRenderer.removeListener('runtime:message', handler);
    }
});

// Log when preload script is loaded
console.log('[Electron Preload] Script loaded successfully');
