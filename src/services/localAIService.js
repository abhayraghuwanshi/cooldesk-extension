/**
 * Local AI Service - Browser Extension Client
 *
 * Communicates with the Electron app's local LLM via WebSocket.
 * Falls back gracefully when Electron app is not running.
 */

import { getWebSocketUrl, isHostSyncEnabled } from './syncConfig.js';

// ==========================================
// STATE
// ==========================================

let ws = null;
let isConnected = false;
let pendingRequests = new Map();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

// ==========================================
// CONNECTION
// ==========================================

/**
 * Connect to Electron app's WebSocket server
 * @returns {Promise<boolean>} Whether connection succeeded
 */
export async function connect() {
    if (isConnected && ws?.readyState === WebSocket.OPEN) {
        return true;
    }

    if (!isHostSyncEnabled()) {
        console.log('[LocalAI] Host sync not enabled, skipping connection');
        return false;
    }

    return new Promise((resolve) => {
        try {
            const wsUrl = getWebSocketUrl();
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log('[LocalAI] Connected to Electron');
                isConnected = true;
                reconnectAttempts = 0;
                // Identify this client to the sidecar
                try { ws.send(JSON.stringify({ type: 'identify', client: 'localAI' })); } catch { }
                resolve(true);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                } catch (e) {
                    console.warn('[LocalAI] Invalid message:', e);
                }
            };

            ws.onclose = () => {
                console.log('[LocalAI] Disconnected from Electron');
                isConnected = false;
                ws = null;
            };

            ws.onerror = (error) => {
                console.warn('[LocalAI] WebSocket error:', error);
                isConnected = false;
                resolve(false);
            };

            // Timeout connection attempt
            setTimeout(() => {
                if (!isConnected) {
                    ws?.close();
                    resolve(false);
                }
            }, 5000);

        } catch (error) {
            console.warn('[LocalAI] Connection error:', error);
            resolve(false);
        }
    });
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(data) {
    const { type, payload } = data;

    // Check for pending request
    if (payload?.requestId && pendingRequests.has(payload.requestId)) {
        const { resolve, reject } = pendingRequests.get(payload.requestId);
        pendingRequests.delete(payload.requestId);

        if (payload.ok === false) {
            reject(new Error(payload.error || 'Unknown error'));
        } else {
            resolve(payload);
        }
        return;
    }

    // Handle broadcast messages
    switch (type) {
        case 'llm-status':
        case 'llm-models':
        case 'llm-model-loaded':
            // These are responses to requests
            break;
        case 'llm-progress':
            // Emit progress event
            window.dispatchEvent(new CustomEvent('llm-progress', { detail: payload }));
            break;
        default:
            // Other messages handled elsewhere
            break;
    }
}

/**
 * Send a request and wait for response
 */
async function request(type, payload = {}, timeout = 60000) {
    if (!isConnected) {
        const connected = await connect();
        if (!connected) {
            throw new Error('Not connected to Electron app. Please ensure CoolDesk desktop app is running.');
        }
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error('Request timeout'));
        }, timeout);

        pendingRequests.set(requestId, {
            resolve: (data) => {
                clearTimeout(timer);
                resolve(data);
            },
            reject: (err) => {
                clearTimeout(timer);
                reject(err);
            }
        });

        ws.send(JSON.stringify({
            type,
            payload: { ...payload, requestId }
        }));
    });
}

// ==========================================
// PUBLIC API
// ==========================================

/**
 * Check if local AI is available
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
    try {
        const connected = await connect();
        if (!connected) return false;

        const status = await getStatus();
        return status.initialized === true;
    } catch {
        return false;
    }
}

/**
 * Get LLM status
 * @returns {Promise<Object>}
 */
export async function getStatus() {
    return request('llm-get-status');
}

/**
 * Get available models
 * @returns {Promise<Object>}
 */
export async function getModels() {
    return request('llm-get-models');
}

/**
 * Load a model
 * @param {string} modelName
 * @returns {Promise<Object>}
 */
export async function loadModel(modelName) {
    return request('llm-load-model', { modelName }, 120000); // 2 min timeout for loading
}

/**
 * Chat with the LLM
 * @param {string} prompt
 * @param {Object} options
 * @returns {Promise<string>}
 */
export async function chat(prompt, options = {}) {
    const result = await request('llm-chat', { prompt, options });
    return result.response;
}

/**
 * Summarize text
 * @param {string} text
 * @param {number} maxLength
 * @returns {Promise<string>}
 */
export async function summarize(text, maxLength = 3) {
    const result = await request('llm-summarize', { text, maxLength });
    return result.summary;
}

/**
 * Categorize a URL
 * @param {string} title
 * @param {string} url
 * @param {string[]} categories
 * @returns {Promise<string>}
 */
export async function categorize(title, url, categories) {
    const result = await request('llm-categorize', { title, url, categories });
    return result.category;
}

/**
 * Parse a natural language command
 * @param {string} command
 * @param {Object} context
 * @returns {Promise<Object>}
 */
export async function parseCommand(command, context = {}) {
    const result = await request('llm-parse-command', { command, context });
    return result.parsed;
}

// ==========================================
// CO-WORKING AGENT CAPABILITIES
// ==========================================

/**
 * Batch categorize multiple URLs
 * @param {Array<{title: string, url: string}>} items
 * @param {string[]} categories
 * @returns {Promise<Array>}
 */
export async function batchCategorize(items, categories) {
    const result = await request('llm-batch-categorize', { items, categories });
    return result.results;
}

/**
 * Smart search using AI
 * @param {string} query
 * @param {Array} items
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function smartSearch(query, items, limit = 10) {
    const result = await request('llm-smart-search', { query, items, limit });
    return result.results;
}

/**
 * Get workspace suggestions based on URLs
 * @param {Array<{title: string, url: string}>} urls
 * @returns {Promise<Array>}
 */
export async function suggestWorkspaces(urls) {
    const result = await request('llm-suggest-workspaces', { urls });
    return result.suggestions;
}

/**
 * Generate a daily briefing
 * @param {Object} context
 * @returns {Promise<string>}
 */
export async function generateBriefing(context = {}) {
    const result = await request('llm-generate-briefing', { context });
    return result.briefing;
}

/**
 * Handle an agent request (natural language to action)
 * @param {string} userInput
 * @param {Object} context
 * @returns {Promise<Object>}
 */
export async function agentRequest(userInput, context = {}) {
    const result = await request('llm-agent-request', { userInput, context });
    return result.result;
}

/**
 * Disconnect from WebSocket
 */
export function disconnect() {
    if (ws) {
        ws.close();
        ws = null;
    }
    isConnected = false;
    pendingRequests.clear();
}

// Export connection state
export function getConnectionState() {
    return {
        isConnected,
        reconnectAttempts
    };
}
