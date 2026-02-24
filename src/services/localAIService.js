/**
 * Local AI Service - Browser Extension Client
 *
 * Communicates with the sidecar's local LLM via WebSocket.
 * Works in both browser extension and Tauri desktop app.
 * Falls back gracefully when sidecar is not running.
 */

// Default sidecar WebSocket URL
const SIDECAR_WS_URL = 'ws://127.0.0.1:4000';
const SIDECAR_HTTP_URL = 'http://127.0.0.1:4000';

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
 * Connect to sidecar's WebSocket server
 * @returns {Promise<boolean>} Whether connection succeeded
 */
export async function connect() {
    if (isConnected && ws?.readyState === WebSocket.OPEN) {
        return true;
    }

    // First check if sidecar is running via HTTP health check
    try {
        const health = await fetch(`${SIDECAR_HTTP_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
        });
        if (!health.ok) {
            console.log('[LocalAI] Sidecar health check failed');
            return false;
        }
    } catch (e) {
        console.log('[LocalAI] Sidecar not reachable:', e.message);
        return false;
    }

    return new Promise((resolve) => {
        try {
            ws = new WebSocket(SIDECAR_WS_URL);

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

    console.log('[LocalAI] Received message:', type, payload?.requestId);

    // Check for pending request by requestId in payload
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

    // Handle response types that map to request types
    // The sidecar sends 'llm-status' in response to 'llm-get-status', etc.
    const responseTypeMap = {
        'llm-status': 'llm-get-status',
        'llm-models': 'llm-get-models',
        'llm-model-loaded': 'llm-load-model',
        'llm-chat-response': 'llm-chat'
    };

    // For responses without requestId, try to match by type (legacy support)
    if (responseTypeMap[type] && !payload?.requestId) {
        // Find any pending request of the corresponding type
        for (const [reqId, req] of pendingRequests.entries()) {
            if (req.type === responseTypeMap[type]) {
                pendingRequests.delete(reqId);
                if (payload?.ok === false) {
                    req.reject(new Error(payload?.error || 'Unknown error'));
                } else {
                    req.resolve(payload);
                }
                return;
            }
        }
    }

    // Handle broadcast messages
    switch (type) {
        case 'llm-progress':
            // Emit progress event
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('llm-progress', { detail: payload }));
            }
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
            throw new Error('Not connected to sidecar. Please ensure CoolDesk desktop app is running.');
        }
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log('[LocalAI] Sending request:', type, 'requestId:', requestId);

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingRequests.delete(requestId);
            console.error('[LocalAI] Request timeout for:', type, requestId);
            reject(new Error('Request timeout'));
        }, timeout);

        pendingRequests.set(requestId, {
            type, // Store the request type for matching responses without requestId
            resolve: (data) => {
                clearTimeout(timer);
                console.log('[LocalAI] Request resolved:', type, requestId);
                resolve(data);
            },
            reject: (err) => {
                clearTimeout(timer);
                console.error('[LocalAI] Request rejected:', type, requestId, err);
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
        console.log('[LocalAI] Checking availability...');
        const connected = await connect();
        console.log('[LocalAI] Connected:', connected);
        if (!connected) return false;

        const status = await getStatus();
        console.log('[LocalAI] Status:', status);
        // initialized can be true even if model not loaded yet
        return status.initialized === true || status.modelLoaded === true;
    } catch (e) {
        console.error('[LocalAI] isAvailable error:', e);
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
    const result = await request('llm-get-models');
    // Server wraps models in { models: {...}, ok: true, requestId }
    return result.models || result;
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
 * Group browsing items into smart workspace categories
 * @param {string} items - Formatted string of browsing items
 * @param {string} context - External context (workspace URLs, etc.)
 * @param {string} customPrompt - Optional custom AI prompt
 * @returns {Promise<Object>} - { groups: [...], suggestions: [...] }
 */
export async function groupWorkspaces(items, context = '', customPrompt = null) {
    const result = await request('llm-group-workspaces', {
        items,
        context,
        customPrompt
    }, 90000); // 90s timeout for complex grouping

    // Parse the JSON response from LLM
    if (result.result) {
        try {
            const jsonMatch = result.result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.warn('[LocalAI] Failed to parse group response:', e);
        }
    }
    return { groups: [], suggestions: [] };
}

/**
 * Get related resource suggestions based on workspace context
 * @param {string} workspaceUrls - Formatted string of workspace URLs
 * @param {string} history - Recent browsing history
 * @returns {Promise<Array>} - Array of { title, reason }
 */
export async function suggestRelated(workspaceUrls, history = '') {
    const result = await request('llm-suggest-related', {
        workspaceUrls,
        history
    }, 60000);

    // Parse the JSON array response
    if (result.suggestions) {
        try {
            const jsonMatch = result.suggestions.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.warn('[LocalAI] Failed to parse suggestions:', e);
        }
    }
    return [];
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

// ==========================================
// TASK NAMING (Task-First Tab Modeling)
// ==========================================

/**
 * Generate a concise task name based on tab titles and URLs
 * @param {Object} task - Task object with tabIds
 * @returns {Promise<string|null>} - Generated task name (2-4 words) or null on failure
 */
export async function nameTask(task) {
    if (!task?.tabIds || task.tabIds.length === 0) {
        return null;
    }

    // Check if AI is available
    const available = await isAvailable();
    if (!available) {
        console.log('[LocalAI] AI not available for task naming');
        return null;
    }

    try {
        // Gather tab information
        const tabInfos = [];
        for (const tabId of task.tabIds.slice(0, 5)) { // Limit to 5 tabs for brevity
            try {
                const tab = await chrome.tabs.get(tabId);
                if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
                    let domain = '';
                    try {
                        domain = new URL(tab.url).hostname.replace('www.', '');
                    } catch { }
                    tabInfos.push({
                        title: tab.title || '',
                        domain
                    });
                }
            } catch {
                // Tab might be closed, skip it
            }
        }

        if (tabInfos.length === 0) {
            return null;
        }

        // Build prompt
        const tabDescriptions = tabInfos
            .map(t => `"${t.title}" (${t.domain})`)
            .join(', ');

        const prompt = `Based on these browser tabs: ${tabDescriptions}

Generate a concise task name (2-4 words) that describes what the user is working on.
Just respond with the task name, nothing else. Examples: "React Hooks Research", "Bug Fix Investigation", "Shopping Comparison"`;

        const result = await request('llm-chat', {
            prompt,
            options: { maxTokens: 20 }
        }, 15000);

        const name = result?.response?.trim();

        // Validate response (should be reasonable length)
        if (name && name.length > 0 && name.length <= 50 && name.split(/\s+/).length <= 6) {
            console.log('[LocalAI] Generated task name:', name);
            return name;
        }

        return null;
    } catch (e) {
        console.warn('[LocalAI] Task naming failed:', e.message);
        return null;
    }
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
