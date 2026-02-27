/**
 * Nano AI Service
 * Core service for Chrome's built-in Gemini Nano AI
 * Provides: URL classification, text summarization, natural language search
 */

import { APPSTORE_VERSION } from '../data/appstoreVersion.js';

// Configuration
const CONFIG = {
    SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
    MAX_RETRIES: 2,
    CLASSIFY_TIMEOUT: 30000,   // 30s - Nano can be slow on first use
    SUMMARIZE_TIMEOUT: 60000,  // 60s - Summarization needs more time for long content
    SEARCH_TIMEOUT: 30000,     // 30s - Search ranking can take time
    BATCH_DELAY: 100, // ms between batch items
};

// Classification queue for debouncing
let classificationQueue = new Map();
let classificationTimer = null;
const CLASSIFICATION_DEBOUNCE = 500;

/**
 * Get the LanguageModel API entry point
 * Supports both new (self.LanguageModel) and old (self.ai.languageModel) APIs
 */
function getModelEntryPoint() {
    if (typeof self !== 'undefined' && self.LanguageModel) return self.LanguageModel;
    if (typeof self !== 'undefined' && self.ai?.languageModel) return self.ai.languageModel;
    if (typeof window !== 'undefined' && window.LanguageModel) return window.LanguageModel;
    if (typeof window !== 'undefined' && window.ai?.languageModel) return window.ai.languageModel;
    return null;
}

export const NanoAIService = {
    _session: null,
    _sessionCreatedAt: null,
    _availability: 'unknown',
    _initPromise: null,

    /**
     * Initialize the service - check availability
     */
    async init() {
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            try {
                const model = getModelEntryPoint();
                if (!model) {
                    console.log('[NanoAI] API not available, checking LocalAI...');
                    const localAvailable = await LocalAIService.isAvailable();
                    this._availability = localAvailable ? 'local' : 'no';
                    return { available: localAvailable, source: localAvailable ? 'local' : 'none' };
                }

                // Check availability
                if (model.availability) {
                    const avail = await model.availability({
                        expectedInputs: [{ type: 'text', languages: ['en'] }],
                        expectedOutputs: [{ type: 'text', languages: ['en'] }]
                    });
                    this._availability = avail;

                    // If Nano is not readily available, check Local AI as a better alternative than 'no'
                    if (avail !== 'available' && avail !== 'readily') {
                        const localAvailable = await LocalAIService.isAvailable();
                        if (localAvailable) this._availability = 'local';
                    }

                    console.log('[NanoAI] Availability:', this._availability);
                    return { available: this._availability === 'available' || this._availability === 'local', status: this._availability };
                }

                // Fallback for older API
                if (model.capabilities) {
                    const caps = await model.capabilities();
                    this._availability = caps.available;
                    if (this._availability !== 'readily') {
                        const localAvailable = await LocalAIService.isAvailable();
                        if (localAvailable) this._availability = 'local';
                    }
                    return { available: this._availability === 'readily' || this._availability === 'local', status: this._availability };
                }

                // Final fallback
                const localAvailable = await LocalAIService.isAvailable();
                this._availability = localAvailable ? 'local' : 'no';
                return { available: localAvailable, source: localAvailable ? 'local' : 'none' };
            } catch (e) {
                console.warn('[NanoAI] Init failed, checking LocalAI fallback:', e);
                const localAvailable = await LocalAIService.isAvailable();
                this._availability = localAvailable ? 'local' : 'error';
                return { available: localAvailable, reason: 'error', error: e.message };
            }
        })();

        return this._initPromise;
    },

    /**
     * Check if Nano is ready to use
     */
    isAvailable() {
        return this._availability === 'available' || this._availability === 'readily' || this._availability === 'local';
    },

    /**
     * Check which AI source is being used
     */
    getSource() {
        if (this._availability === 'available' || this._availability === 'readily') return 'nano';
        if (this._availability === 'local') return 'local';
        return 'none';
    },

    /**
     * Get or create a session (lazy, cached)
     */
    async getSession() {
        // If we are in local fallback mode, we don't need a Nano session
        if (this._availability === 'local') return null;

        // Check if session is stale
        if (this._session && this._sessionCreatedAt) {
            const age = Date.now() - this._sessionCreatedAt;
            if (age > CONFIG.SESSION_TIMEOUT) {
                console.log('[NanoAI] Session expired, creating new one');
                this._session = null;
            }
        }

        if (this._session) return this._session;

        const model = getModelEntryPoint();
        if (!model) {
            // Check if we can use local
            const available = await LocalAIService.isAvailable();
            if (available) {
                this._availability = 'local';
                return null;
            }
            throw new Error('No AI available (Nano missing and LocalAI not reachable)');
        }

        // Check availability first
        if (!this.isAvailable()) {
            await this.init();
            if (!this.isAvailable()) {
                throw new Error(`Nano AI not ready: ${this._availability}`);
            }
        }

        try {
            this._session = await model.create({
                expectedInputs: [{ type: 'text', languages: ['en'] }],
                expectedOutputs: [{ type: 'text', languages: ['en'] }]
            });
            this._sessionCreatedAt = Date.now();
            console.log('[NanoAI] Session created');
            return this._session;
        } catch (e) {
            console.error('[NanoAI] Session creation failed:', e);
            throw e;
        }
    },

    /**
     * Run a prompt with timeout
     */
    async prompt(text, timeout = 30000) {
        if (this._availability === 'local') {
            return LocalAIService.chat(text, { timeout });
        }

        const session = await this.getSession();
        const startTime = Date.now();
        console.log(`[NanoAI] Starting prompt (timeout: ${timeout}ms, text length: ${text.length})`);

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                console.warn(`[NanoAI] Prompt timed out after ${timeout}ms`);
                reject(new Error(`Nano AI prompt timeout after ${timeout}ms`));
            }, timeout);

            session.prompt(text)
                .then(result => {
                    clearTimeout(timeoutId);
                    console.log(`[NanoAI] Prompt completed in ${Date.now() - startTime}ms`);
                    resolve(result);
                })
                .catch(err => {
                    clearTimeout(timeoutId);
                    reject(err);
                });
        });
    },

    /**
     * Summarize text content
     * @param {string} text - Text to summarize
     * @param {number} maxLength - Maximum summary length in words
     * @returns {Promise<string>} Summary
     */
    async summarize(text, maxLength = 100) {
        if (!text || text.trim().length < 50) {
            return text?.trim() || '';
        }

        if (this._availability === 'local') {
            return LocalAIService.summarize(text, maxLength);
        }

        // Truncate very long text to avoid token limits
        const truncated = text.length > 8000 ? text.slice(0, 8000) + '...' : text;

        const prompt = `Summarize the following text in ${maxLength} words or less. Be concise and capture the key points:

${truncated}

Summary:`;

        try {
            const result = await this.prompt(prompt, CONFIG.SUMMARIZE_TIMEOUT);
            return result?.trim() || 'Could not generate summary';
        } catch (e) {
            console.error('[NanoAI] Summarize failed:', e);
            throw e;
        }
    },

    /**
     * Classify a URL into a workspace/category
     * @param {string} url - URL to classify
     * @param {Object} context - Context for classification
     * @param {string[]} context.workspaces - Existing workspace names
     * @param {string} context.title - Page title (optional)
     * @returns {Promise<Object>} Classification result
     */
    async classifyUrl(url, context = {}) {
        const { workspaces = [], title = '' } = context;

        if (this._availability === 'local') {
            const category = await LocalAIService.categorize(title, url, workspaces);
            return {
                category,
                isNew: !workspaces.includes(category),
                confidence: 'high',
                source: 'local'
            };
        }

        // Build workspace list for context
        const workspaceList = workspaces.length > 0
            ? workspaces.slice(0, 20).join(', ')
            : 'productivity, development, social, entertainment, shopping, finance, education, health, news, other';

        const prompt = `Classify this URL into one category.

URL: ${url}
${title ? `Title: ${title}` : ''}

Available categories: ${workspaceList}

Rules:
1. Return ONLY the category name, nothing else
2. Use an existing category if it fits
3. If none fit well, suggest a new short category name (1-2 words)

Category:`;

        try {
            const result = await this.prompt(prompt, CONFIG.CLASSIFY_TIMEOUT);
            const category = result?.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();

            if (!category || category.length > 30) {
                return { category: 'other', confidence: 'low' };
            }

            // Check if it matches an existing workspace
            const matchedWorkspace = workspaces.find(w =>
                w.toLowerCase() === category ||
                w.toLowerCase().includes(category) ||
                category.includes(w.toLowerCase())
            );

            return {
                category: matchedWorkspace || category,
                isNew: !matchedWorkspace,
                confidence: matchedWorkspace ? 'high' : 'medium',
                source: 'nano',
                version: APPSTORE_VERSION
            };
        } catch (e) {
            console.error('[NanoAI] Classify failed:', e);
            return { category: 'other', confidence: 'low', error: e.message };
        }
    },

    /**
     * Queue URL for classification (debounced)
     */
    queueClassification(url, context, callback) {
        classificationQueue.set(url, { context, callback });

        if (classificationTimer) {
            clearTimeout(classificationTimer);
        }

        classificationTimer = setTimeout(() => {
            this._processClassificationQueue();
        }, CLASSIFICATION_DEBOUNCE);
    },

    async _processClassificationQueue() {
        const queue = new Map(classificationQueue);
        classificationQueue.clear();
        classificationTimer = null;

        for (const [url, { context, callback }] of queue) {
            try {
                const result = await this.classifyUrl(url, context);
                if (callback) callback(null, result);
            } catch (e) {
                if (callback) callback(e, null);
            }
            // Small delay between items
            await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY));
        }
    },

    /**
     * Natural language search - rank results by semantic relevance
     * @param {string} query - Natural language query
     * @param {Array} items - Items to search (must have title/url)
     * @param {number} limit - Max results to return
     * @returns {Promise<Array>} Ranked results
     */
    async naturalLanguageSearch(query, items, limit = 10) {
        if (!items || items.length === 0) return [];
        if (!query || query.trim().length < 3) return items.slice(0, limit);

        if (this._availability === 'local') {
            const results = await LocalAIService.smartSearch(query, items, limit);
            return (results || []).map(item => ({
                ...item,
                _aiMatched: true,
                _aiRank: item._aiRank || 1
            }));
        }

        // Take top candidates for AI ranking (limit to avoid token limits)
        const candidates = items.slice(0, 30);

        const itemList = candidates.map((item, i) =>
            `${i + 1}. ${item.title || item.url || 'Untitled'}`
        ).join('\n');

        const prompt = `Given this search query: "${query}"

Rank these items by relevance (most relevant first). Return ONLY the numbers of the top ${limit} most relevant items, separated by commas.

Items:
${itemList}

Most relevant (numbers only):`;

        try {
            const result = await this.prompt(prompt, CONFIG.SEARCH_TIMEOUT);

            // Parse the numbers from response
            const numbers = result.match(/\d+/g)?.map(Number) || [];
            const validNumbers = numbers.filter(n => n >= 1 && n <= candidates.length);

            if (validNumbers.length === 0) {
                return candidates.slice(0, limit);
            }

            // Build ranked results
            const ranked = [];
            const seen = new Set();

            for (const num of validNumbers) {
                const idx = num - 1;
                if (!seen.has(idx) && candidates[idx]) {
                    ranked.push({
                        ...candidates[idx],
                        _aiRank: ranked.length + 1,
                        _aiMatched: true
                    });
                    seen.add(idx);
                }
                if (ranked.length >= limit) break;
            }

            return ranked;
        } catch (e) {
            console.error('[NanoAI] NL Search failed:', e);
            return candidates.slice(0, limit);
        }
    },

    /**
     * Get current dictionary version
     */
    getDictionaryVersion() {
        return APPSTORE_VERSION;
    },

    /**
     * Get availability status
     */
    getStatus() {
        return {
            availability: this._availability,
            hasSession: !!this._session,
            sessionAge: this._sessionCreatedAt ? Date.now() - this._sessionCreatedAt : null,
            dictionaryVersion: APPSTORE_VERSION
        };
    },

    /**
     * Destroy session (cleanup)
     */
    destroy() {
        if (this._session?.destroy) {
            this._session.destroy();
        }
        this._session = null;
        this._sessionCreatedAt = null;
        classificationQueue.clear();
        if (classificationTimer) {
            clearTimeout(classificationTimer);
            classificationTimer = null;
        }
    }
};

export default NanoAIService;
