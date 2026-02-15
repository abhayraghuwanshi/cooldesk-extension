/**
 * Unified Sync Orchestrator
 * Handles bidirectional sync between Browser Extension ↔ Electron App
 *
 * Data Flow:
 * 1. Local Change → IndexedDB → Sync Queue → Host API / IPC
 * 2. Remote Change → WebSocket/IPC Event → Merge → IndexedDB → UI Update
 */

import {
    getDashboard,
    getSettings as getSettingsDB, // used for pins
    getUIState,
    listAllUrlNotes,
    listDailyMemory,
    listNotes,
    listPins,
    listScrapedChats,
    listScrapingConfigs,
    listWorkspaces,
    saveDailyMemory,
    saveDashboard,
    saveNote,
    saveScrapedChat,
    saveScrapingConfig,
    saveSettings as saveSettingsDB,
    saveUIState,
    saveUrlNote,
    saveWorkspace,
    upsertPing
} from '../db/index';
import { getEnvironment, isElectronApp, isExtension } from './environmentDetector';
import {
    getHostDailyMemory,
    getHostDashboard,
    getHostNotes,
    getHostPins,
    getHostScrapedChats,
    getHostScrapedConfigs,
    getHostSettings,
    getHostTabs,
    getHostUiState,
    getHostUrlNotes,
    getHostUrls,
    getHostWorkspaces,
    setHostDailyMemory,
    setHostDashboard,
    setHostNotes,
    setHostPins,
    setHostScrapedChats,
    setHostScrapedConfigs,
    setHostSettings,
    setHostTabs,
    setHostUiState,
    setHostUrlNotes,
    setHostUrls,
    setHostWorkspaces
} from './extensionApi';
import { getDeviceId, isHostSyncEnabled, loadSyncConfig } from './syncConfig';
import { syncWebSocket } from './syncWebSocket';

class SyncOrchestrator {
    constructor() {
        this.pendingChanges = new Map();
        this.syncInProgress = false;
        this.isApplyingRemoteUpdate = false;
        this.lastSyncTime = {};
        this.lastPushTime = {}; // Track when we last pushed each data type
        this.listeners = new Set();
        this.initialized = false;
        this.syncInterval = null;
        this.tabDebounceTimer = null;
        this.tabEventListeners = []; // Store references for cleanup
        this.wsEventUnsubscribers = []; // Store WebSocket unsubscribe functions
        this.dbChannels = []; // Store BroadcastChannel references
        this.PUSH_DEBOUNCE_MS = 5000; // Minimum time between pushes of same type (5s to prevent sync loops)
    }

    /**
     * Initialize sync based on environment
     */
    async init() {
        if (this.initialized) return;

        // Ensure sync config is loaded from storage first
        await loadSyncConfig();

        const env = getEnvironment();
        console.log('[SyncOrchestrator] Initializing for environment:', env);
        console.log('[SyncOrchestrator] Host sync enabled:', isHostSyncEnabled());
        console.log('[SyncOrchestrator] isExtension:', isExtension());
        console.log('[SyncOrchestrator] isElectronApp:', isElectronApp());

        if (isElectronApp()) {
            this.initElectronSync();
        } else if (isExtension() && isHostSyncEnabled()) {
            await this.initExtensionSync();
        } else if (isHostSyncEnabled()) {
            // Browser mode with host sync enabled - still try to connect
            console.log('[SyncOrchestrator] Browser mode with host sync, attempting connection');
            await this.initExtensionSync();
        } else {
            console.log('[SyncOrchestrator] Sync initialization skipped (disabled or unknown environment)');
        }

        this.initialized = true;
        console.log('[SyncOrchestrator] Initialization complete');
    }

    /**
     * Electron app: Use IPC for sync
     */
    initElectronSync() {
        if (!window.electronAPI) {
            console.warn('[SyncOrchestrator] electronAPI not available');
            return;
        }

        console.log('[SyncOrchestrator] Setting up Electron IPC sync');

        // Setup database change listeners to push local changes to main process
        this.setupDbListeners();

        // Do initial data pull from main process
        this.pullInitialDataFromMain();

        // Listen for remote changes via IPC events
        const eventMap = {
            'workspaces-updated': (data) => this.handleRemoteWorkspacesUpdate(data),
            'urls-updated': (data) => this.handleRemoteUrlsUpdate(data),
            'settings-updated': (data) => this.handleRemoteSettingsUpdate(data),
            'tabs-updated': (data) => this.handleRemoteTabsUpdate(data),
            'notes-updated': (data) => this.handleRemoteNotesUpdate(data),
            'url-notes-updated': (data) => this.handleRemoteUrlNotesUpdate(data),
            'pins-updated': (data) => this.handleRemotePinsUpdate(data),
            'scraped-chats-updated': (data) => this.handleRemoteScrapedChatsUpdate(data),
            'scraped-configs-updated': (data) => this.handleRemoteScrapedConfigsUpdate(data),
            'daily-memory-updated': (data) => this.handleRemoteDailyMemoryUpdate(data),
            'ui-state-updated': (data) => this.handleRemoteUiStateUpdate(data),
            'dashboard-updated': (data) => this.handleRemoteDashboardUpdate(data),
            'sync-complete': (data) => this.notifyListeners('sync-complete', data)
        };

        Object.entries(eventMap).forEach(([event, handler]) => {
            window.electronAPI.subscribe(event, async (data) => {
                console.log(`[SyncOrchestrator] ${event} from IPC`);
                this.isApplyingRemoteUpdate = true;
                try {
                    await handler(data);
                } finally {
                    this.isApplyingRemoteUpdate = false;
                }
            });
        });
    }

    /**
     * Pull initial data from Electron main process on startup
     */
    async pullInitialDataFromMain() {
        if (!window.electronAPI) return;

        console.log('[SyncOrchestrator] Pulling initial data from Electron main process');

        try {
            // Pull all data types from main process via IPC
            const dataFetchers = [
                { type: 'workspaces', getter: 'getWorkspaces', handler: this.handleRemoteWorkspacesUpdate.bind(this) },
                { type: 'notes', getter: 'getNotes', handler: this.handleRemoteNotesUpdate.bind(this) },
                { type: 'url-notes', getter: 'getUrlNotes', handler: this.handleRemoteUrlNotesUpdate.bind(this) },
                { type: 'pins', getter: 'getPins', handler: this.handleRemotePinsUpdate.bind(this) },
                { type: 'scraped-chats', getter: 'getScrapedChats', handler: this.handleRemoteScrapedChatsUpdate.bind(this) },
                { type: 'scraped-configs', getter: 'getScrapedConfigs', handler: this.handleRemoteScrapedConfigsUpdate.bind(this) },
                { type: 'daily-memory', getter: 'getDailyMemory', handler: this.handleRemoteDailyMemoryUpdate.bind(this) },
                { type: 'settings', getter: 'getSettings', handler: this.handleRemoteSettingsUpdate.bind(this) },
                { type: 'ui-state', getter: 'getUiState', handler: this.handleRemoteUiStateUpdate.bind(this) },
                { type: 'dashboard', getter: 'getDashboard', handler: this.handleRemoteDashboardUpdate.bind(this) },
                { type: 'tabs', getter: 'getTabs', handler: this.handleRemoteTabsUpdate.bind(this) }
            ];

            for (const { type, getter, handler } of dataFetchers) {
                try {
                    if (typeof window.electronAPI[getter] === 'function') {
                        const data = await window.electronAPI[getter]();
                        if (data && (Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0)) {
                            console.log(`[SyncOrchestrator] Pulled ${type}:`, Array.isArray(data) ? data.length : 'object');
                            await handler(data);
                        }
                    }
                } catch (err) {
                    console.warn(`[SyncOrchestrator] Failed to pull ${type}:`, err);
                }
            }

            console.log('[SyncOrchestrator] Initial data pull complete');
        } catch (error) {
            console.error('[SyncOrchestrator] Error pulling initial data:', error);
        }
    }

    /**
     * Extension: Use HTTP/WebSocket for sync
     */
    async initExtensionSync() {
        console.log('[SyncOrchestrator] Setting up Extension WebSocket sync (initExtensionSync called)');
        console.log('[SyncOrchestrator] Setting up Extension WebSocket sync');

        // Connect to WebSocket
        const connected = await syncWebSocket.connect();

        if (connected) {
            // Listen for remote changes
            const wsEvents = {
                'workspaces': (data) => this.handleRemoteWorkspacesUpdate(data),
                'urls': (data) => this.handleRemoteUrlsUpdate(data),
                'settings': (data) => this.handleRemoteSettingsUpdate(data),
                'tabs': (data) => this.handleRemoteTabsUpdate(data),
                'notes': (data) => this.handleRemoteNotesUpdate(data),
                'url-notes': (data) => this.handleRemoteUrlNotesUpdate(data),
                'pins': (data) => this.handleRemotePinsUpdate(data),
                'scraped-chats': (data) => this.handleRemoteScrapedChatsUpdate(data),
                'scraped-configs': (data) => this.handleRemoteScrapedConfigsUpdate(data),
                'daily-memory': (data) => this.handleRemoteDailyMemoryUpdate(data),
                'ui-state': (data) => this.handleRemoteUiStateUpdate(data),
                'dashboard': (data) => this.handleRemoteDashboardUpdate(data),
                'activity': (data) => this.handleRemoteActivityUpdate(data),
                'sync-state': (data) => this.handleSyncState(data),
                'sync-complete': (data) => this.notifyListeners('sync-complete', data),
                'jump-to-tab': (data) => this.handleRemoteJumpToTab(data)
            };

            // Store unsubscribe functions for cleanup
            Object.entries(wsEvents).forEach(([event, handler]) => {
                const wrappedHandler = async (data) => {
                    this.isApplyingRemoteUpdate = true;
                    try {
                        await handler(data);
                    } finally {
                        this.isApplyingRemoteUpdate = false;
                    }
                };
                const unsubscribe = syncWebSocket.on(event, wrappedHandler);
                if (typeof unsubscribe === 'function') {
                    this.wsEventUnsubscribers.push(unsubscribe);
                }
            });

            // FIRST: Push tabs immediately - this is what users see first in the app
            if (isExtension()) {
                console.log('[SyncOrchestrator] Pushing tabs FIRST (highest priority)...');
                this.syncLocalTabs(); // Tabs first!
            }

            // THEN: Full sync for other data (workspaces, notes, etc.) - runs in background
            console.log('[SyncOrchestrator] Connection established, starting full sync...');
            this.fullSync().catch(err => console.error('[SyncOrchestrator] Initial full sync failed:', err));
        }

        // Periodic sync as fallback (every 60 seconds - reduced from 30s for performance)
        this.syncInterval = setInterval(() => {
            if (isHostSyncEnabled() && !this.syncInProgress) {
                this.periodicSync();
            }
        }, 60000);

        // Tab Event Listeners - only in extension context
        if (isExtension() && chrome.tabs) {
            const tabEvents = [
                chrome.tabs.onCreated,
                chrome.tabs.onUpdated,
                chrome.tabs.onRemoved,
                chrome.tabs.onActivated,
                chrome.tabs.onMoved,
                chrome.tabs.onDetached,
                chrome.tabs.onAttached
            ];

            const debouncedSyncTabs = () => {
                if (this.tabDebounceTimer) clearTimeout(this.tabDebounceTimer);
                this.tabDebounceTimer = setTimeout(() => {
                    this.syncLocalTabs();
                }, 1000); // 1s debounce for responsive updates
            };

            // Store listener references for cleanup
            tabEvents.forEach(evt => {
                if (evt && evt.addListener) {
                    evt.addListener(debouncedSyncTabs);
                    this.tabEventListeners.push({ event: evt, handler: debouncedSyncTabs });
                }
            });
        }

        // --- Database Change Listeners (BroadcastChannel) ---
        this.setupDbListeners();
    }

    setupDbListeners() {
        const channels = [
            { name: 'ws_db_changes', events: ['workspacesChanged', 'pinsChanged', 'dailyMemoryChanged', 'dailyNotesChanged'] },
            { name: 'settings_db_changes', events: ['settingsChanged'] },
            { name: 'dashboard_db_changes', events: ['dashboardChanged'] },
            { name: 'scraped_chats_db_changes', events: ['scrapedChatsChanged'] },
            { name: 'scraped_configs_db_changes', events: ['scrapedConfigsChanged'] },
            { name: 'notes_db_changes', events: ['notesChanged'] },
            { name: 'url_notes_db_changes', events: ['urlNotesChanged'] },
            { name: 'ui_state_db_changes', events: ['uiStateChanged'] }
        ];

        this.dbChannels = channels.map(({ name, events }) => {
            const bc = new BroadcastChannel(name);
            bc.onmessage = (ev) => {
                if (events.includes(ev.data.type)) {
                    this.handleDbChange(ev.data.type, ev.data);
                }
            };
            return bc;
        });
    }

    async handleDbChange(type, data) {
        // In Electron mode, always sync to main process
        // In extension mode, check if host sync is enabled
        const shouldSync = isElectronApp() || isHostSyncEnabled();
        if (!shouldSync || this.syncInProgress || this.isApplyingRemoteUpdate) return;

        // Map DB event type to sync type for consistent debounce tracking
        const syncTypeMap = {
            'workspacesChanged': 'workspaces',
            'pinsChanged': 'pins',
            'settingsChanged': 'settings',
            'dashboardChanged': 'dashboard',
            'scrapedChatsChanged': 'scraped-chats',
            'scrapedConfigsChanged': 'scraped-configs',
            'notesChanged': 'notes',
            'urlNotesChanged': 'url-notes',
            'dailyMemoryChanged': 'daily-memory',
            'uiStateChanged': 'ui-state'
        };
        const syncType = syncTypeMap[type] || type;

        // Debounce: skip if we pushed this type recently
        const now = Date.now();
        const lastPush = this.lastPushTime[syncType] || 0;
        if (now - lastPush < this.PUSH_DEBOUNCE_MS) {
            // console.log(`[SyncOrchestrator] Skipping ${type} push (debounced)`);
            return;
        }

        console.log('[SyncOrchestrator] DB change detected:', type);

        try {
            switch (type) {
                case 'workspacesChanged':
                    const workspaces = await listWorkspaces();
                    await this.pushChanges('workspaces', Array.isArray(workspaces) ? workspaces : []);
                    break;
                case 'pinsChanged':
                    const pins = await listPins();
                    await this.pushChanges('pins', Array.isArray(pins) ? pins : []);
                    break;
                case 'settingsChanged':
                    const settings = await getSettingsDB();
                    await this.pushChanges('settings', settings || {});
                    break;
                case 'dashboardChanged':
                    const dashboard = await getDashboard();
                    await this.pushChanges('dashboard', dashboard || {});
                    break;
                case 'scrapedChatsChanged':
                    const chats = await listScrapedChats();
                    await this.pushChanges('scraped-chats', Array.isArray(chats) ? chats : []);
                    break;
                case 'scrapedConfigsChanged':
                    const configs = await listScrapingConfigs();
                    await this.pushChanges('scraped-configs', Array.isArray(configs) ? configs : []);
                    break;
                case 'notesChanged':
                    const notes = await listNotes();
                    await this.pushChanges('notes', Array.isArray(notes) ? notes : []);
                    break;
                case 'urlNotesChanged':
                    const urlNotes = await listAllUrlNotes();
                    await this.pushChanges('url-notes', Array.isArray(urlNotes) ? urlNotes : []);
                    break;
                case 'dailyMemoryChanged':
                    // For daily memory, we might want to sync ALL or just the changed one.
                    // Syncing all for simplicity and consistency
                    const memories = await listDailyMemory();
                    await this.pushChanges('daily-memory', Array.isArray(memories) ? memories : []);
                    break;
                case 'uiStateChanged':
                    const uiState = await getUIState();
                    await this.pushChanges('ui-state', uiState || {});
                    break;
            }
        } catch (e) {
            console.warn(`[SyncOrchestrator] Failed to sync changes for ${type}:`, e);
        }
    }

    /**
     * Sync local tabs to remote
     */
    async syncLocalTabs() {
        console.log('[SyncOrchestrator] syncLocalTabs called. HostSyncEnabled:', isHostSyncEnabled(), 'isExtension:', isExtension());
        if (!isHostSyncEnabled()) return;
        // Only sync tabs from extension context, not Electron
        if (!isExtension()) return;

        try {
            const tabs = await chrome.tabs.query({});
            console.log(`[SyncOrchestrator] Found ${tabs?.length || 0} local tabs`);

            if (!Array.isArray(tabs)) return;

            const cleanTabs = tabs
                .filter(t => t && t.url && !t.url.startsWith('chrome://'))
                .map(t => ({
                    id: t.id,
                    url: t.url,
                    title: t.title || '',
                    active: t.active || false,
                    favIconUrl: t.favIconUrl || '',
                    windowId: t.windowId,
                    lastAccessed: t.lastAccessed
                }));

            console.log(`[SyncOrchestrator] Syncing ${cleanTabs.length} tabs after filtering`);
            if (cleanTabs.length > 0) {
                await this.pushChanges('tabs', cleanTabs);
            } else {
                console.log('[SyncOrchestrator] No valid tabs to sync (all filtered)');
            }
        } catch (e) {
            console.warn('[SyncOrchestrator] Failed to sync local tabs:', e);
        }
    }

    /**
     * Handle full sync state from server
     */
    async handleSyncState(data) {
        if (!data) return;

        try {
            const handlers = {
                workspaces: this.handleRemoteWorkspacesUpdate,
                urls: this.handleRemoteUrlsUpdate,
                settings: this.handleRemoteSettingsUpdate,
                tabs: this.handleRemoteTabsUpdate,
                notes: this.handleRemoteNotesUpdate,
                urlNotes: this.handleRemoteUrlNotesUpdate,
                pins: this.handleRemotePinsUpdate,
                scrapedChats: this.handleRemoteScrapedChatsUpdate,
                scrapedConfigs: this.handleRemoteScrapedConfigsUpdate,
                dailyMemory: this.handleRemoteDailyMemoryUpdate,
                uiState: this.handleRemoteUiStateUpdate,
                dashboard: this.handleRemoteDashboardUpdate
            };

            for (const [key, handler] of Object.entries(handlers)) {
                if (data[key]) {
                    await handler.call(this, data[key]);
                }
            }
        } catch (error) {
            console.error('[SyncOrchestrator] Error handling sync state:', error);
        }
    }

    /**
     * Generic merge and save helper
     */
    async handleGenericUpdate(remoteData, listFn, saveFn, type) {
        if (!Array.isArray(remoteData)) return;

        try {
            // Mark this type as recently synced to prevent push-back loops
            this.lastPushTime[type] = Date.now();

            // Get local data
            const localResult = await listFn();
            const localData = Array.isArray(localResult) ? localResult : (localResult?.data || []);

            // Merge
            const merged = this.mergeData(localData, remoteData, type);

            // Save merged
            for (const item of merged) {
                await saveFn(item, { skipNotify: true });
            }

            this.lastSyncTime[type] = Date.now();
            this.notifyListeners(`${type}-synced`, merged);
        } catch (error) {
            console.error(`[SyncOrchestrator] Error handling ${type} update:`, error);
        }
    }

    // Specific handlers using generic helper
    async handleRemoteWorkspacesUpdate(data) {
        await this.handleGenericUpdate(data, listWorkspaces, saveWorkspace, 'workspaces');
    }

    async handleRemoteNotesUpdate(data) {
        await this.handleGenericUpdate(data, listNotes, saveNote, 'notes');
    }

    async handleRemoteUrlNotesUpdate(data) {
        await this.handleGenericUpdate(data, listAllUrlNotes, saveUrlNote, 'url-notes');
    }

    async handleRemotePinsUpdate(data) {
        // pins usually use upsertPing
        await this.handleGenericUpdate(data, listPins, upsertPing, 'pins');
    }

    async handleRemoteScrapedChatsUpdate(data) {
        await this.handleGenericUpdate(data, listScrapedChats, saveScrapedChat, 'scraped-chats');
    }

    async handleRemoteScrapedConfigsUpdate(data) {
        await this.handleGenericUpdate(data, listScrapingConfigs, saveScrapingConfig, 'scraped-configs');
    }

    async handleRemoteDailyMemoryUpdate(data) {
        await this.handleGenericUpdate(data, listDailyMemory, saveDailyMemory, 'daily-memory');
    }

    async handleRemoteUrlsUpdate(remoteUrls) {
        if (!Array.isArray(remoteUrls)) return;
        try {
            this.lastSyncTime.urls = Date.now();
            this.notifyListeners('urls-synced', remoteUrls);
        } catch (error) {
            console.error('[SyncOrchestrator] Error handling URLs update:', error);
        }
    }

    async handleRemoteSettingsUpdate(remoteSettings) {
        if (!remoteSettings || typeof remoteSettings !== 'object') return;
        try {
            const localSettings = await getSettingsDB() || {};
            const merged = { ...localSettings, ...remoteSettings };
            await saveSettingsDB(merged, { skipNotify: true });
            this.lastSyncTime.settings = Date.now();
            this.notifyListeners('settings-synced', merged);
        } catch (error) {
            console.error('[SyncOrchestrator] Error handling settings update:', error);
        }
    }

    async handleRemoteTabsUpdate(remoteTabs) {
        if (!Array.isArray(remoteTabs)) return;
        this.lastSyncTime.tabs = Date.now();
        this.notifyListeners('tabs-synced', remoteTabs);
    }

    async handleRemoteUiStateUpdate(remoteState) {
        if (!remoteState || typeof remoteState !== 'object') return;
        try {
            const localState = await getUIState() || {};
            const merged = { ...localState, ...remoteState };
            await saveUIState(merged, { skipNotify: true });
            this.lastSyncTime.uiState = Date.now();
            this.notifyListeners('ui-state-synced', merged);
        } catch (error) {
            console.error('[SyncOrchestrator] Error handling UI state update:', error);
        }
    }

    async handleRemoteDashboardUpdate(remoteDashboard) {
        if (!remoteDashboard || typeof remoteDashboard !== 'object') return;
        try {
            const localDashboard = await getDashboard() || {};
            const merged = { ...localDashboard, ...remoteDashboard };
            await saveDashboard(merged, { skipNotify: true });
            this.lastSyncTime.dashboard = Date.now();
            this.notifyListeners('dashboard-synced', merged);
        } catch (error) {
            console.error('[SyncOrchestrator] Error handling dashboard update:', error);
        }
    }

    async handleRemoteActivityUpdate(remoteActivity) {
        if (!remoteActivity) return;
        const activities = Array.isArray(remoteActivity) ? remoteActivity : [remoteActivity];

        try {
            for (const activity of activities) {
                // Ensure unique ID if missing
                if (!activity.id) activity.id = `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                await putActivityTimeSeriesEvent(activity);
            }

            this.lastSyncTime.activity = Date.now();
            this.notifyListeners('activity-synced', activities);
        } catch (error) {
            console.error('[SyncOrchestrator] Error handling activity update:', error);
        }
    }


    /**
     * Push local changes to remote
     */
    async pushChanges(type, data) {
        // Special case for tabs: we want to segment them by device
        let payload = data;
        if (type === 'tabs') {
            const deviceId = await getDeviceId();
            console.log('[SyncOrchestrator] Pushing tabs for device:', deviceId, 'Count:', data?.length);
            payload = { deviceId, tabs: data };
        }

        // Map type to API methods
        const apiMap = {
            'workspaces': { ipc: 'setWorkspaces', ws: 'pushWorkspaces', http: setHostWorkspaces },
            'urls': { ipc: 'setUrls', ws: 'pushUrls', http: setHostUrls },
            'settings': { ipc: 'setSettings', ws: 'pushSettings', http: setHostSettings },
            'tabs': { ipc: 'setTabs', ws: 'pushTabs', http: setHostTabs },
            'notes': { ipc: 'setNotes', ws: 'pushNotes', http: setHostNotes },
            'url-notes': { ipc: 'setUrlNotes', ws: 'pushUrlNotes', http: setHostUrlNotes },
            'pins': { ipc: 'setPins', ws: 'pushPins', http: setHostPins },
            'scraped-chats': { ipc: 'setScrapedChats', ws: 'pushScrapedChats', http: setHostScrapedChats },
            'scraped-configs': { ipc: 'setScrapedConfigs', ws: 'pushScrapedConfigs', http: setHostScrapedConfigs },
            'daily-memory': { ipc: 'setDailyMemory', ws: 'pushDailyMemory', http: setHostDailyMemory },
            'ui-state': { ipc: 'setUiState', ws: 'pushUiState', http: setHostUiState },
            'dashboard': { ipc: 'setDashboard', ws: 'pushDashboard', http: setHostDashboard }
        };

        const config = apiMap[type];
        if (!config) return { ok: false, error: 'Unknown type' };

        // Track push time to prevent loops
        this.lastPushTime[type] = Date.now();

        if (isElectronApp() && window.electronAPI) {
            if (window.electronAPI[config.ipc]) {
                return window.electronAPI[config.ipc](payload);
            }
        } else if (isExtension() && isHostSyncEnabled()) {
            // Try WebSocket first, fall back to HTTP
            if (syncWebSocket.isConnected() && syncWebSocket[config.ws]) {
                const sent = syncWebSocket[config.ws](payload);
                console.log(`[SyncOrchestrator] Pushed ${type} via WebSocket:`, sent);
                return sent ? { ok: true } : { ok: false, error: 'WS send failed' };
            }
            // Fall back to HTTP if WebSocket not connected
            if (config.http) {
                console.log(`[SyncOrchestrator] Pushing ${type} via HTTP (WS not connected)`);
                return config.http(payload);
            }
        }

        return { ok: false, error: 'No sync method available' };
    }

    /**
     * Pull remote changes
     */
    async pullChanges(type) {
        const apiMap = {
            'workspaces': { ipc: 'getWorkspaces', http: getHostWorkspaces, key: 'workspaces' },
            'urls': { ipc: 'getUrls', http: getHostUrls, key: 'urls' },
            'settings': { ipc: 'getSettings', http: getHostSettings, key: 'settings' },
            'tabs': { ipc: 'getTabs', http: getHostTabs, key: 'tabs' },
            'notes': { ipc: 'getNotes', http: getHostNotes, key: 'notes' },
            'url-notes': { ipc: 'getUrlNotes', http: getHostUrlNotes, key: 'urlNotes' },
            'pins': { ipc: 'getPins', http: getHostPins, key: 'pins' },
            'scraped-chats': { ipc: 'getScrapedChats', http: getHostScrapedChats, key: 'scrapedChats' },
            'scraped-configs': { ipc: 'getScrapedConfigs', http: getHostScrapedConfigs, key: 'scrapedConfigs' },
            'daily-memory': { ipc: 'getDailyMemory', http: getHostDailyMemory, key: 'dailyMemory' },
            'ui-state': { ipc: 'getUiState', http: getHostUiState, key: 'uiState' },
            'dashboard': { ipc: 'getDashboard', http: getHostDashboard, key: 'dashboard' }
        };

        const config = apiMap[type];
        if (!config) return { ok: false, error: 'Unknown type' };

        if (isElectronApp() && window.electronAPI) {
            if (window.electronAPI[config.ipc]) {
                const res = await window.electronAPI[config.ipc]();
                return { ok: true, [config.key]: res };
            }
        } else if (isExtension() && isHostSyncEnabled()) {
            return config.http();
        }

        return { ok: false, error: 'No sync method available' };
    }

    /**
     * Merge strategy for conflicts
     * Default: Last-write-wins with timestamp comparison
     * Workspaces: Merge by NAME (case-insensitive) to handle multi-browser sync
     */
    mergeData(local, remote, type) {
        if (!Array.isArray(local)) local = [];
        if (!Array.isArray(remote)) remote = [];

        // Special handling for workspaces - merge by name, not ID
        if (type === 'workspaces') {
            return this.mergeWorkspacesByName(local, remote);
        }

        const merged = new Map();

        // Determine the ID field based on type
        // scraped-chats uses 'chatId', scraped-configs uses 'domain', others use 'id'
        const getItemId = (item) => {
            if (type === 'scraped-chats') return item.chatId;
            if (type === 'scraped-configs') return item.domain;
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

            // Use updatedAt for conflict resolution (scrapedAt for scraped chats)
            const remoteTime = item.updatedAt || item.scrapedAt || item.createdAt || 0;
            const localTime = existing?.updatedAt || existing?.scrapedAt || existing?.createdAt || 0;

            if (!existing || remoteTime >= localTime) {
                merged.set(itemId, item);
            }
        }

        return Array.from(merged.values());
    }

    /**
     * Merge workspaces by NAME (case-insensitive) instead of ID
     * This handles multi-browser sync where Chrome and Edge create workspaces
     * with different IDs but the same name (e.g., "Social", "Shopping")
     */
    mergeWorkspacesByName(local, remote) {
        const merged = new Map(); // key: lowercase name

        // Helper to normalize URL for deduplication
        const normalizeUrl = (url) => {
            if (!url) return null;
            try {
                const u = new URL(url.startsWith('http') ? url : `https://${url}`);
                // Normalize: lowercase hostname, remove www, remove trailing slash
                return `${u.protocol}//${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
            } catch {
                return url.toLowerCase();
            }
        };

        // Helper to deduplicate URLs within a workspace
        const dedupeUrls = (urls) => {
            if (!Array.isArray(urls)) return [];
            const seen = new Map(); // normalizedUrl -> urlObject
            for (const urlObj of urls) {
                const normalized = normalizeUrl(urlObj?.url);
                if (!normalized) continue;
                const existing = seen.get(normalized);
                // Keep the one with more data or newer timestamp
                if (!existing) {
                    seen.set(normalized, urlObj);
                } else {
                    const existingTime = existing.addedAt || existing.createdAt || 0;
                    const newTime = urlObj.addedAt || urlObj.createdAt || 0;
                    // Prefer the one with title, or newer
                    if ((!existing.title && urlObj.title) || newTime > existingTime) {
                        seen.set(normalized, urlObj);
                    }
                }
            }
            return Array.from(seen.values());
        };

        // Add all local workspaces
        for (const ws of local) {
            if (!ws?.name) continue;
            const key = ws.name.toLowerCase().trim();
            merged.set(key, { ...ws, urls: dedupeUrls(ws.urls) });
        }

        // Merge remote workspaces
        for (const ws of remote) {
            if (!ws?.name) continue;
            const key = ws.name.toLowerCase().trim();
            const existing = merged.get(key);

            if (!existing) {
                // New workspace
                merged.set(key, { ...ws, urls: dedupeUrls(ws.urls) });
            } else {
                // Merge: combine URLs, keep newer metadata
                const remoteTime = ws.updatedAt || ws.createdAt || 0;
                const localTime = existing.updatedAt || existing.createdAt || 0;

                // Combine URLs from both, then dedupe
                const combinedUrls = [...(existing.urls || []), ...(ws.urls || [])];
                const dedupedUrls = dedupeUrls(combinedUrls);

                // Use metadata from the newer one, but keep the older ID for consistency
                const mergedWs = remoteTime > localTime
                    ? { ...ws, id: existing.id, urls: dedupedUrls }
                    : { ...existing, urls: dedupedUrls, updatedAt: Math.max(remoteTime, localTime) };

                merged.set(key, mergedWs);
            }
        }

        return Array.from(merged.values());
    }

    /**
     * Handle jump-to-tab command from remote (Electron)
     */
    async handleRemoteJumpToTab(data) {
        if (!data || !data.tabId) return;

        console.log('[SyncOrchestrator] Handling remote jump-to-tab:', data);

        // Only run in extension context
        if (!isExtension() || !chrome.tabs) return;

        try {
            // activate tab
            await chrome.tabs.update(data.tabId, { active: true });

            // focus window
            if (data.windowId) {
                await chrome.windows.update(data.windowId, { focused: true });
            } else {
                // If no windowId provided, try to find the tab's window
                const tab = await chrome.tabs.get(data.tabId);
                if (tab && tab.windowId) {
                    await chrome.windows.update(tab.windowId, { focused: true });
                }
            }
        } catch (error) {
            console.error('[SyncOrchestrator] Failed to jump to tab:', error);
        }
    }

    /**
     * Full bidirectional sync
     */
    async fullSync() {
        if (this.syncInProgress) {
            console.log('[SyncOrchestrator] Sync already in progress');
            return { ok: false, error: 'Sync in progress' };
        }

        this.syncInProgress = true;
        this.notifyListeners('sync-start');

        try {
            console.log('[SyncOrchestrator] Starting full sync');

            // Define sync steps
            const syncSteps = [
                { type: 'workspaces', list: listWorkspaces, save: saveWorkspace },
                { type: 'notes', list: listNotes, save: saveNote },
                { type: 'url-notes', list: listAllUrlNotes, save: saveUrlNote },
                { type: 'pins', list: listPins, save: upsertPing },
                { type: 'scraped-chats', list: listScrapedChats, save: saveScrapedChat },
                { type: 'scraped-configs', list: listScrapingConfigs, save: saveScrapingConfig },
                { type: 'daily-memory', list: listDailyMemory, save: saveDailyMemory }
            ];

            // 1. Sync Lists
            for (const step of syncSteps) {
                try {
                    // Mark as recently pushed to prevent loops
                    this.lastPushTime[step.type] = Date.now();

                    // Local
                    const localRes = await step.list();
                    const localData = Array.isArray(localRes) ? localRes : (localRes?.data || []);

                    // Remote
                    const remoteRes = await this.pullChanges(step.type);
                    // Map key from response (e.g. 'scrapedChats' for 'scraped-chats')
                    // We can check the pullChanges map or just iterate keys
                    const remoteData = Object.values(remoteRes).find(v => Array.isArray(v)) || [];

                    // Merge
                    const merged = this.mergeData(localData, remoteData, step.type);

                    // Save Local (with skipNotify to prevent triggering another sync)
                    for (const item of merged) {
                        await step.save(item, { skipNotify: true });
                    }

                    // Push Remote
                    await this.pushChanges(step.type, merged);
                } catch (e) {
                    console.error(`[Sync] Failed to sync ${step.type}:`, e);
                }
            }

            // 2. Sync Settings (Object)
            try {
                this.lastPushTime['settings'] = Date.now();
                const localSettings = await getSettingsDB() || {};
                const remoteSettingsRes = await this.pullChanges('settings');
                const remoteSettings = remoteSettingsRes?.settings || {};
                const mergedSettings = { ...remoteSettings, ...localSettings };
                await saveSettingsDB(mergedSettings, { skipNotify: true });
                await this.pushChanges('settings', mergedSettings);
            } catch (e) {
                console.error('[Sync] Failed to sync settings:', e);
            }

            // 3. Sync UI State (Object)
            try {
                this.lastPushTime['ui-state'] = Date.now();
                const localState = await getUIState() || {};
                const remoteStateRes = await this.pullChanges('ui-state');
                const remoteState = remoteStateRes?.uiState || {};
                const mergedState = { ...remoteState, ...localState };
                await saveUIState(mergedState, { skipNotify: true });
                await this.pushChanges('ui-state', mergedState);
            } catch (e) {
                console.error('[Sync] Failed to sync UI state:', e);
            }

            // 4. Sync Dashboard (Object)
            try {
                this.lastPushTime['dashboard'] = Date.now();
                const localDashboard = await getDashboard() || {};
                const remoteDashboardRes = await this.pullChanges('dashboard');
                const remoteDashboard = remoteDashboardRes?.dashboard || {};
                const mergedDashboard = { ...remoteDashboard, ...localDashboard };
                await saveDashboard(mergedDashboard, { skipNotify: true });
                await this.pushChanges('dashboard', mergedDashboard);
            } catch (e) {
                console.error('[Sync] Failed to sync Dashboard:', e);
            }

            // 5. Sync Tabs (Push only if extension)
            if (isExtension()) {
                await this.syncLocalTabs();
            } else {
                const remoteTabsRes = await this.pullChanges('tabs');
                if (remoteTabsRes?.tabs) {
                    this.notifyListeners('tabs-synced', remoteTabsRes.tabs);
                }
            }

            this.lastSyncTime.full = Date.now();
            this.notifyListeners('sync-complete', { timestamp: Date.now() });

            console.log('[SyncOrchestrator] Full sync complete');
            return { ok: true, timestamp: Date.now() };

        } catch (error) {
            console.error('[SyncOrchestrator] Full sync failed:', error);
            this.notifyListeners('sync-error', error);
            return { ok: false, error: error.message };
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Periodic sync (lighter weight than full sync)
     */
    async periodicSync() {
        if (!isHostSyncEnabled()) return;

        try {
            // Just pull latest state
            if (syncWebSocket.isConnected()) {
                syncWebSocket.requestState();
            }
        } catch (error) {
            console.warn('[SyncOrchestrator] Periodic sync failed:', error);
        }
    }

    /**
     * Push workspaces to remote
     */
    async syncWorkspaces(workspaces) {
        return this.pushChanges('workspaces', workspaces);
    }

    /**
     * Push settings to remote
     */
    async syncSettings(settings) {
        return this.pushChanges('settings', settings);
    }

    /**
     * Push tabs to remote
     */
    async syncTabs(tabs) {
        return this.pushChanges('tabs', tabs);
    }

    /**
     * Sync notes - fetches current notes and pushes to remote
     */
    async syncNotes() {
        try {
            const notes = await listNotes();
            return this.pushChanges('notes', Array.isArray(notes) ? notes : []);
        } catch (e) {
            console.error('[SyncOrchestrator] Failed to sync notes:', e);
            return { ok: false, error: e.message };
        }
    }

    /**
     * Sync URL notes - fetches current URL notes and pushes to remote
     */
    async syncUrlNotes() {
        try {
            const urlNotes = await listAllUrlNotes();
            return this.pushChanges('url-notes', Array.isArray(urlNotes) ? urlNotes : []);
        } catch (e) {
            console.error('[SyncOrchestrator] Failed to sync URL notes:', e);
            return { ok: false, error: e.message };
        }
    }

    /**
     * Subscribe to sync events
     */
    on(event, callback) {
        this.listeners.add({ event, callback });
        return () => this.off(event, callback);
    }

    /**
     * Unsubscribe from sync events
     */
    off(event, callback) {
        this.listeners.forEach(listener => {
            if (listener.event === event && listener.callback === callback) {
                this.listeners.delete(listener);
            }
        });
    }

    /**
     * Notify listeners of event
     */
    notifyListeners(event, data) {
        this.listeners.forEach(listener => {
            if (listener.event === event) {
                try {
                    listener.callback(data);
                } catch (e) {
                    console.warn('[SyncOrchestrator] Listener error:', e);
                }
            }
        });

        // Also dispatch DOM events for UI components listening on window
        // Map sync events to the DOM events that UI components expect
        const domEventMap = {
            'notes-synced': 'notes-updated',
            'url-notes-synced': 'notes-updated' // url-notes should also trigger notes-updated
        };

        const domEventName = domEventMap[event];
        if (domEventName && typeof window !== 'undefined') {
            try {
                window.dispatchEvent(new CustomEvent(domEventName, {
                    detail: { source: 'sync', data }
                }));
                console.log(`[SyncOrchestrator] Dispatched DOM event: ${domEventName}`);
            } catch (e) {
                // May fail in service worker context
            }
        }
    }

    /**
     * Get sync status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            syncInProgress: this.syncInProgress,
            lastSyncTime: this.lastSyncTime,
            environment: getEnvironment(),
            wsConnected: syncWebSocket.isConnected()
        };
    }

    /**
     * Cleanup - IMPORTANT: Call this to prevent memory leaks
     */
    destroy() {
        // Clear sync interval
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }

        // Clear tab debounce timer
        if (this.tabDebounceTimer) {
            clearTimeout(this.tabDebounceTimer);
            this.tabDebounceTimer = null;
        }

        // Remove Chrome tab event listeners
        this.tabEventListeners.forEach(({ event, handler }) => {
            try {
                if (event && event.removeListener) {
                    event.removeListener(handler);
                }
            } catch (e) {
                console.warn('[SyncOrchestrator] Failed to remove tab listener:', e);
            }
        });
        this.tabEventListeners = [];

        // Unsubscribe WebSocket listeners
        this.wsEventUnsubscribers.forEach(unsubscribe => {
            try {
                if (typeof unsubscribe === 'function') {
                    unsubscribe();
                }
            } catch (e) {
                console.warn('[SyncOrchestrator] Failed to unsubscribe WS listener:', e);
            }
        });
        this.wsEventUnsubscribers = [];

        // Close BroadcastChannels
        if (this.dbChannels && Array.isArray(this.dbChannels)) {
            this.dbChannels.forEach(bc => {
                try {
                    bc.close();
                } catch (e) {
                    console.warn('[SyncOrchestrator] Failed to close BroadcastChannel:', e);
                }
            });
            this.dbChannels = [];
        }

        // Disconnect WebSocket
        syncWebSocket.disconnect();

        // Clear listeners
        this.listeners.clear();
        this.pendingChanges.clear();

        this.initialized = false;
        console.log('[SyncOrchestrator] Destroyed and cleaned up');
    }
}

// Export singleton instance
export const syncOrchestrator = new SyncOrchestrator();
