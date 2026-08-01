/**
 * WebSocket connection manager for real-time sync
 * Handles connection to Electron app's WebSocket server
 */

import { getWebSocketUrl, isHostSyncEnabled, getDeviceId, detectBrowser, browsersMatch } from './syncConfig';
import { jumpKeyOf, markJumpHandled, wasJumpRecentlyHandled } from './jumpGuard';

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
            case 'cooldesk-updated':
                // The CoolDesk plugin wrote a project's .cooldesk/ folder. Carries
                // { path, project } so listeners can re-read just that project.
                this.emit('cooldesk', payload);
                break;
            case 'sync-request':
                this.emit('sync-request', payload);
                break;
            case 'sync-complete':
                this.emit('sync-complete', { timestamp });
                break;
            case 'jump-to-tab':
                this.handleJumpToTab(payload).catch(() => {});
                break;
            case 'close-tab':
                this.handleCloseTab(payload).catch(() => {});
                break;
            case 'native-focus-done':
                // Rust native focus completed — re-activate the tab so the browser shows it
                // (it may have restored its last-focused tab during the desktop switch).
                // The ack is broadcast to every connected browser, so only the browser
                // that asked may act: this tab id means something else in the others.
                if (payload?.tabId && typeof chrome !== 'undefined' && chrome.tabs?.update
                    && browsersMatch(payload.browser, detectBrowser())) {
                    chrome.tabs.update(payload.tabId, { active: true }).catch(() => {});
                }
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
     * Handle jump-to-tab request from the desktop app.
     * Resolves the tab by id (with a cross-browser url guard) or url, activates
     * it, then asks the desktop app for OS-level focus.
     * @param {object} payload - { tabId, windowId, url, deviceId, browser }
     */
    async handleJumpToTab(payload) {
        const { tabId, windowId, url, deviceId, browser } = payload || {};
        const myBrowser = detectBrowser();

        console.log(`[SyncWS][${myBrowser}] Jump-to-tab:`, tabId);

        // Only handle in browser extension context (not Electron)
        if (typeof chrome !== 'undefined' && chrome.tabs?.update) {
            // Route by deviceId — it is unique per browser instance, so only the
            // browser that owns the tab acts. Tab ids are small per-browser
            // integers that collide freely across browsers, so without this every
            // open browser would activate an unrelated tab of its own and then
            // fight the others for the foreground.
            //
            // `routed` records that the jump was addressed to this instance
            // *precisely*. When it was, the tab id is authoritative and must be
            // trusted as-is: second-guessing it against the url turns a working
            // jump into a no-op whenever the tab has navigated since the last tab
            // push (up to 30s stale), or the url merely differs by a trailing
            // slash, a fragment, or a redirect.
            let routed = false;
            if (deviceId) {
                try {
                    const myDeviceId = await getDeviceId();
                    if (myDeviceId && deviceId !== myDeviceId) return;
                    routed = !!myDeviceId;
                } catch { /* fall through to the browser/url guards */ }
            } else if (!browsersMatch(browser, myBrowser)) {
                return;
            }
            if (!tabId && !url) return;

            // Only collapses a genuine double-delivery of one broadcast (the
            // bridge's WS push and its 1s HTTP poll can both carry it). Kept
            // short on purpose: re-activating an already-active tab is harmless,
            // so a missed dedupe costs nothing, while a window long enough to
            // swallow a deliberate second click is a bug the user feels.
            const jumpKey = jumpKeyOf(tabId, url);
            if (wasJumpRecentlyHandled(jumpKey)) return;

            try {
                let tab = null;
                if (tabId) {
                    try {
                        const candidate = await chrome.tabs.get(tabId);
                        // Unrouted jumps only: a matching id in the wrong browser
                        // points at an unrelated tab, so make the url prove it.
                        if (!routed && url && candidate?.url) {
                            if (candidate.url.split('?')[0] === url.split('?')[0]) tab = candidate;
                        } else {
                            tab = candidate;
                        }
                    } catch { /* stale tabId or belongs to another browser */ }
                }
                // URL fallback — stale tabId. Settling for any tab on the same
                // host is fine when the jump was routed to us precisely, but on
                // an ambiguous jump it is how an unrelated browser grabs focus
                // for a page it merely happens to have open, so require the exact
                // url there.
                if (!tab && url) {
                    const hostname = (() => { try { return new URL(url).hostname; } catch { return null; } })();
                    if (hostname) {
                        const matches = await chrome.tabs.query({ url: `*://${hostname}/*` });
                        tab = matches.find(t => t.url?.split('?')[0] === url.split('?')[0])
                            || (routed ? matches[0] : null)
                            || null;
                    }
                }
                if (!tab) return;

                markJumpHandled(jumpKey);
                const targetWindowId = windowId || tab.windowId;

                // Activate the resolved tab (the url fallback may have found a
                // different id than the one that was broadcast)
                await chrome.tabs.update(tab.id, { active: true });

                // Focus the window — best effort, silently ignored cross-desktop
                // (Rust SwitchToThisWindow handles the actual desktop switch)
                if (targetWindowId && chrome.windows?.update) {
                    try { await chrome.windows.update(targetWindowId, { focused: true }); } catch { }
                }

                // Get window bounds so Tauri can find the exact HWND (handles multiple browser windows)
                let bounds = null;
                if (targetWindowId && chrome.windows?.get) {
                    try {
                        const win = await chrome.windows.get(targetWindowId);
                        if (win) bounds = { left: win.left, top: win.top, width: win.width, height: win.height };
                    } catch { }
                }

                // Tell sidecar to do native OS focus — bounds let it find the correct
                // window HWND, and the browser id tells it whose process to look in.
                // tabId is included so Rust sends native-focus-done back, triggering tab re-activation.
                this.send('request-native-focus', { browser: myBrowser, tabId: tab.id, bounds });

                console.log(`[SyncWS][${myBrowser}] Jumped to tab:`, tab.id);
            } catch (e) {
                // Silent fail for cross-browser tab IDs (expected when both Chrome+Edge receive the jump)
                if (!e.message?.includes('No tab with id')) {
                    console.warn(`[SyncWS][${myBrowser}] Jump failed:`, e.message);
                }
            }
        } else {
            console.log(`[SyncWS][${myBrowser}] Not in extension context, skipping`);
        }
    }

    /**
     * Handle close-tab request from the desktop spotlight.
     * Resolves the tab by id (with cross-browser URL guard) or URL, then removes it.
     * @param {object} payload - { tabId, url, deviceId, browser }
     */
    async handleCloseTab(payload) {
        const { tabId, url, deviceId } = payload || {};

        // Only handle in browser extension context (not the desktop frontend)
        if (typeof chrome === 'undefined' || !chrome.tabs?.remove) {
            console.log('[SyncWS] Not in extension context, skipping close-tab');
            return;
        }

        // Route by deviceId — it's unique per browser instance and encodes the
        // browser as a prefix (e.g. "edge-…", "brave-…"), so this works for any
        // browser without hardcoding chrome/edge. Only the owning instance acts.
        if (deviceId) {
            try {
                const myDeviceId = await getDeviceId();
                if (myDeviceId && deviceId !== myDeviceId) return;
            } catch { /* fall through to tabId/url resolution */ }
        }
        if (!tabId && !url) return;

        try {
            let tab = null;
            // 1. Fast path: direct tabId lookup with cross-browser URL guard
            if (tabId) {
                try {
                    const candidate = await chrome.tabs.get(tabId);
                    if (url && candidate?.url) {
                        if (candidate.url.split('?')[0] === url.split('?')[0]) tab = candidate;
                    } else {
                        tab = candidate;
                    }
                } catch { /* stale tabId or belongs to another browser */ }
            }
            // 2. URL fallback — stale tabId or wrong browser
            if (!tab && url) {
                const hostname = (() => { try { return new URL(url).hostname; } catch { return null; } })();
                if (hostname) {
                    const matches = await chrome.tabs.query({ url: `*://${hostname}/*` });
                    tab = matches.find(t => t.url?.split('?')[0] === url.split('?')[0]) || matches[0] || null;
                }
            }
            if (!tab) return;

            await chrome.tabs.remove(tab.id);
            console.log('[SyncWS] Closed tab:', tab.id);
        } catch (e) {
            if (!e.message?.includes('No tab with id')) {
                console.warn('[SyncWS] Close failed:', e.message);
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
