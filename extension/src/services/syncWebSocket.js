/**
 * WebSocket connection manager for real-time sync
 * Handles connection to Electron app's WebSocket server
 */

import { getWebSocketUrl, isHostSyncEnabled } from './syncConfig';

class SyncWebSocket {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.listeners = new Map();
        this.connectionPromise = null;
        this.isConnecting = false;
    }

    /**
     * Connect to WebSocket server
     * @param {string} url - Optional custom URL
     * @returns {Promise<boolean>}
     */
    connect(url) {
        // Don't connect if host sync is disabled
        if (!isHostSyncEnabled()) {
            console.warn('[SyncWS] Host sync is DISABLED in config, skipping connection');
            console.log('[SyncWS] Current config:', JSON.stringify(require('./syncConfig').getSyncConfig?.() || {}));
            return Promise.resolve(false);
        }

        // Return existing connection promise if connecting
        if (this.isConnecting && this.connectionPromise) {
            return this.connectionPromise;
        }

        // Already connected
        if (this.ws?.readyState === WebSocket.OPEN) {
            return Promise.resolve(true);
        }

        this.isConnecting = true;
        const wsUrl = url || getWebSocketUrl();

        this.connectionPromise = new Promise((resolve) => {
            try {
                console.log('[SyncWS] Connecting to:', wsUrl);
                this.ws = new WebSocket(wsUrl);

                const connectionTimeout = setTimeout(() => {
                    if (this.ws?.readyState !== WebSocket.OPEN) {
                        console.warn('[SyncWS] Connection timeout');
                        this.ws?.close();
                        this.isConnecting = false;
                        resolve(false);
                    }
                }, 5000);

                this.ws.onopen = () => {
                    clearTimeout(connectionTimeout);
                    console.log('[SyncWS] Connected');
                    this.reconnectAttempts = 0;
                    this.isConnecting = false;
                    this.emit('connected');
                    resolve(true);
                };

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleMessage(data);
                    } catch (e) {
                        console.warn('[SyncWS] Invalid message:', e);
                    }
                };

                this.ws.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    console.log('[SyncWS] Disconnected:', event.code, event.reason);
                    this.isConnecting = false;
                    this.emit('disconnected', { code: event.code, reason: event.reason });
                    this.scheduleReconnect();
                    resolve(false);
                };

                this.ws.onerror = (error) => {
                    clearTimeout(connectionTimeout);
                    console.warn('[SyncWS] Error:', error);
                    this.isConnecting = false;
                    this.emit('error', error);
                };

            } catch (e) {
                console.error('[SyncWS] Connection failed:', e);
                this.isConnecting = false;
                this.scheduleReconnect();
                resolve(false);
            }
        });

        return this.connectionPromise;
    }

    /**
     * Handle incoming WebSocket message
     * @param {object} data
     */
    handleMessage(data) {
        const { type, payload, timestamp } = data;

        console.log('[SyncWS] Message received:', type);

        switch (type) {
            case 'sync-state':
                this.emit('sync-state', payload);
                break;
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
            case 'notes-updated':
                this.emit('notes', payload);
                break;
            case 'url-notes-updated':
                this.emit('url-notes', payload);
                break;
            case 'pins-updated':
                this.emit('pins', payload);
                break;
            case 'scraped-chats-updated':
                this.emit('scraped-chats', payload);
                break;
            case 'scraped-configs-updated':
                this.emit('scraped-configs', payload);
                break;
            case 'daily-memory-updated':
                this.emit('daily-memory', payload);
                break;
            case 'ui-state-updated':
                this.emit('ui-state', payload);
                break;
            case 'dashboard-updated':
                this.emit('dashboard', payload);
                break;
            case 'tabs-updated':
                this.emit('tabs', payload);
                break;
            case 'sync-request':
                this.emit('sync-request', payload);
                break;
            case 'sync-complete':
                this.emit('sync-complete', { timestamp });
                break;
            case 'jump-to-tab':
                // Handle tab switching request from Electron desktop app
                this.handleJumpToTab(payload);
                break;
            default:
                console.log('[SyncWS] Unknown message type:', type);
        }
    }

    /**
     * Send message to server
     * @param {string} type - Message type
     * @param {any} payload - Message payload
     * @returns {boolean} - Whether message was sent
     */
    send(type, payload) {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            console.warn('[SyncWS] Cannot send, not connected');
            return false;
        }

        try {
            this.ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
            return true;
        } catch (e) {
            console.error('[SyncWS] Send failed:', e);
            return false;
        }
    }

    /**
     * Push workspaces to server
     * @param {Array} workspaces
     * @returns {boolean}
     */
    pushWorkspaces(workspaces) {
        return this.send('push-workspaces', workspaces);
    }

    /**
     * Push URLs to server
     * @param {Array} urls
     * @returns {boolean}
     */
    pushUrls(urls) {
        return this.send('push-urls', urls);
    }

    /**
     * Push settings to server
     * @param {object} settings
     * @returns {boolean}
     */
    pushSettings(settings) {
        return this.send('push-settings', settings);
    }

    /**
     * Push activity
     */
    pushActivity(activity) {
        return this.send('push-activity', activity);
    }

    /**
     * Push notes
     */
    pushNotes(notes) {
        return this.send('push-notes', notes);
    }

    /**
     * Push URL notes
     */
    pushUrlNotes(urlNotes) {
        return this.send('push-url-notes', urlNotes);
    }

    /**
     * Push pins
     */
    pushPins(pins) {
        return this.send('push-pins', pins);
    }

    /**
     * Push scraped chats
     */
    pushScrapedChats(chats) {
        return this.send('push-scraped-chats', chats);
    }

    /**
     * Push scraped configs
     */
    pushScrapedConfigs(configs) {
        return this.send('push-scraped-configs', configs);
    }

    /**
     * Push daily memory
     */
    pushDailyMemory(memory) {
        return this.send('push-daily-memory', memory);
    }

    /**
     * Push UI state
     */
    pushUiState(state) {
        return this.send('push-ui-state', state);
    }

    /**
     * Push dashboard
     */
    pushDashboard(dashboard) {
        return this.send('push-dashboard', dashboard);
    }

    /**
     * Push tabs
     * @param {object|Array} tabsPayload - Either { deviceId, tabs: [...] } or legacy array
     */
    pushTabs(tabsPayload) {
        const count = Array.isArray(tabsPayload) ? tabsPayload.length : tabsPayload?.tabs?.length;
        const deviceId = Array.isArray(tabsPayload) ? 'unknown' : tabsPayload?.deviceId;
        console.log(`[SyncWS] Pushing ${count} tabs from device: ${deviceId}`);
        return this.send('push-tabs', tabsPayload);
    }

    /**
     * Handle jump-to-tab request from Electron desktop app
     * @param {object} payload - { tabId, windowId }
     */
    async handleJumpToTab(payload) {
        const { tabId, windowId } = payload;
        console.log('[SyncWS] Received jump-to-tab request:', tabId);

        // Only handle in browser extension context (not Electron)
        if (typeof chrome !== 'undefined' && chrome.tabs?.update) {
            try {
                // Activate the tab
                await chrome.tabs.update(tabId, { active: true });

                // Focus the window if windowId provided
                if (windowId && chrome.windows?.update) {
                    await chrome.windows.update(windowId, { focused: true });
                } else {
                    // Get the tab to find its window
                    const tab = await chrome.tabs.get(tabId);
                    if (tab?.windowId && chrome.windows?.update) {
                        await chrome.windows.update(tab.windowId, { focused: true });
                    }
                }

                console.log('[SyncWS] Successfully jumped to tab:', tabId);
            } catch (e) {
                console.warn('[SyncWS] Failed to jump to tab:', e);
            }
        }
    }

    /**
     * Request current state from server
     * @returns {boolean}
     */
    requestState() {
        return this.send('request-state', {});
    }

    /**
     * Add event listener
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        // Return unsubscribe function for cleanup
        return () => this.off(event, callback);
    }

    /**
     * Remove event listener
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
        this.listeners.get(event)?.delete(callback);
    }

    /**
     * Emit event to listeners
     * @param {string} event
     * @param {any} data
     */
    emit(event, data) {
        this.listeners.get(event)?.forEach(cb => {
            try {
                cb(data);
            } catch (e) {
                console.warn('[SyncWS] Listener error:', e);
            }
        });
    }

    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        if (!isHostSyncEnabled()) return;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[SyncWS] Max reconnect attempts reached');
            this.emit('max-reconnects');
            return;
        }

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;

        console.log(`[SyncWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        setTimeout(() => this.connect(), delay);
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnecting = false;
        this.connectionPromise = null;
    }

    /**
     * Check if connected
     * @returns {boolean}
     */
    isConnected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * Reset reconnection attempts
     */
    resetReconnectAttempts() {
        this.reconnectAttempts = 0;
    }
}

// Export singleton instance
export const syncWebSocket = new SyncWebSocket();
