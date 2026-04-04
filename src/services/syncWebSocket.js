/**
 * WebSocket connection manager for real-time sync
 * Handles connection to Electron app's WebSocket server
 */

import { getWebSocketUrl, isHostSyncEnabled } from './syncConfig';

class SyncWebSocket {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 1000000; // Practically endless retries
        this.reconnectDelay = 500; // Faster initial reconnect (was 1000ms)
        this.listeners = new Map();
        this.connectionPromise = null;
        this.isConnecting = false;
        this.clientId = null; // Set by server on connect
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

                    // Keep the Service Worker alive and the WebSocket open
                    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
                    this.keepAliveInterval = setInterval(() => {
                        if (this.ws?.readyState === WebSocket.OPEN) {
                            try {
                                this.ws.send(JSON.stringify({
                                    type: 'ping',
                                    timestamp: Date.now(),
                                    clientId: this.clientId
                                }));
                            } catch (e) { }
                        }
                    }, 25000); // 25 seconds ping

                    this.emit('connected');
                    resolve(true);
                };

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'pong' || data.type === 'ping') return; // Ignore raw keep-alives internally
                        this.handleMessage(data);
                    } catch (e) {
                        console.warn('[SyncWS] Invalid message:', e);
                    }
                };

                this.ws.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
                    console.log('[SyncWS] Disconnected:', event.code, event.reason);
                    this.isConnecting = false;
                    this.emit('disconnected', { code: event.code, reason: event.reason });
                    this.scheduleReconnect();
                    resolve(false);
                };

                this.ws.onerror = (error) => {
                    clearTimeout(connectionTimeout);
                    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
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
        const { type, payload, timestamp, clientId } = data;

        // Capture clientId from server's welcome/sync-state message
        if (clientId && !clientId.startsWith('exclude:') && !this.clientId) {
            this.clientId = clientId;
            console.log('[SyncWS] Client ID assigned:', clientId);
        }

        // Check if this message should be excluded for this client (sender exclusion)
        if (clientId && clientId.startsWith('exclude:')) {
            const excludedClient = clientId.substring(8); // Remove "exclude:" prefix
            if (excludedClient === this.clientId) {
                // console.log('[SyncWS] Skipping message (sender exclusion):', type);
                return; // Skip this message - we sent it
            }
        }

        // console.log('[SyncWS] Message received:', type);

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
                // Handled exclusively by bridge.js (has deviceId guard + URL fallback).
                // Do not handle here to avoid duplicate focus across multiple WS connections.
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
            // Include clientId so server can exclude sender from broadcast
            this.ws.send(JSON.stringify({
                type,
                payload,
                timestamp: Date.now(),
                clientId: this.clientId
            }));
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
        const isEdge = navigator.userAgent.includes('Edg');
        const browserName = isEdge ? 'Edge' :
            navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Browser';
        const browserExeName = isEdge ? 'msedge' : 'chrome';

        console.log(`[SyncWS][${browserName}] Jump-to-tab:`, tabId);

        // Only handle in browser extension context (not Electron)
        if (typeof chrome !== 'undefined' && chrome.tabs?.update) {
            try {
                // Quick check if tab exists (fast fail for cross-browser broadcasts)
                const tab = await chrome.tabs.get(tabId);
                if (!tab) return;

                const targetWindowId = windowId || tab.windowId;

                // Activate tab and focus window
                await Promise.all([
                    chrome.tabs.update(tabId, { active: true }),
                    targetWindowId && chrome.windows?.update
                        ? chrome.windows.update(targetWindowId, { focused: true })
                        : Promise.resolve()
                ]);

                // Get window bounds so Tauri can find the exact HWND (handles multiple browser windows)
                let bounds = null;
                if (targetWindowId && chrome.windows?.get) {
                    try {
                        const win = await chrome.windows.get(targetWindowId);
                        if (win) bounds = { left: win.left, top: win.top, width: win.width, height: win.height };
                    } catch (_) {}
                }

                // Tell sidecar to do native focus — bounds let it pick the correct OS window
                this.send('request-native-focus', { browser: browserExeName, tabId, bounds });

                console.log(`[SyncWS][${browserName}] Jumped to tab:`, tabId);
            } catch (e) {
                // Silent fail for cross-browser tab IDs
                if (!e.message?.includes('No tab with id')) {
                    console.warn(`[SyncWS][${browserName}] Jump failed:`, e.message);
                }
            }
        } else {
            console.log(`[SyncWS][${browserName}] Not in extension context, skipping`);
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

        // Cap delay at 30 seconds for long-term retrying
        const calculatedDelay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        const delay = Math.min(calculatedDelay, 30000);
        this.reconnectAttempts++;

        // Less noisy logging for long-running disconnected states
        if (this.reconnectAttempts % 10 === 0 || this.reconnectAttempts < 5) {
            console.log(`[SyncWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        }
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
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
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
