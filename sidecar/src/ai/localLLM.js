/**
 * Local LLM Service using node-llama-cpp
 * Provides on-device AI capabilities for CoolDesk
 *
 * Features:
 * - Chat/conversation
 * - Text summarization
 * - Embeddings for semantic search
 * - Streaming responses
 * - Function calling (structured JSON output)
 */

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import http from 'http';
import https from 'https';
import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==========================================
// CONFIGURATION
// ==========================================

const CONFIG = {
    // Model storage directory - Use local 'models' dir in sidecar
    MODELS_DIR: join(process.cwd(), 'models'),

    // Default model (good balance of size/quality)
    DEFAULT_MODEL: 'llama-3.2-1b-instruct.Q4_K_M.gguf',

    // Model download URLs (Hugging Face) - Using bartowski's quantizations which are reliable
    MODEL_URLS: {
        // Llama 3.2 1B (800MB) - Good balance for most systems
        'llama-3.2-1b-instruct.Q4_K_M.gguf':
            'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',

        // Qwen2.5 1.5B (1GB) - Good quality, reasonable size
        'qwen2.5-1.5b-instruct.Q4_K_M.gguf':
            'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',

        // SmolLM2 1.7B (1GB) - Lightweight but capable
        'smollm2-1.7b-instruct.Q4_K_M.gguf':
            'https://huggingface.co/bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf',

        // Qwen2.5 0.5B (400MB) - Ultra light
        'qwen2.5-0.5b-instruct.Q4_K_M.gguf':
            'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf'
    },

    // Model info (for UI display)
    MODEL_INFO: {
        'llama-3.2-1b-instruct.Q4_K_M.gguf': {
            name: 'Llama 3.2 1B',
            size: '800 MB',
            ram: '2-3 GB',
            quality: 'Good',
            speed: 'Fast',
            description: 'Recommended - Good balance'
        },
        'qwen2.5-1.5b-instruct.Q4_K_M.gguf': {
            name: 'Qwen2.5 1.5B',
            size: '1 GB',
            ram: '2-4 GB',
            quality: 'Good',
            speed: 'Fast',
            description: 'Strong reasoning ability'
        },
        'smollm2-1.7b-instruct.Q4_K_M.gguf': {
            name: 'SmolLM2 1.7B',
            size: '1 GB',
            ram: '2-4 GB',
            quality: 'Good',
            speed: 'Fast',
            description: 'Efficient and capable'
        },
        'qwen2.5-0.5b-instruct.Q4_K_M.gguf': {
            name: 'Qwen2.5 0.5B',
            size: '400 MB',
            ram: '1-2 GB',
            quality: 'Basic',
            speed: 'Ultra Fast',
            description: 'Ultra light, simple tasks'
        }
    },

    // Inference settings (minimal context for maximum compatibility)
    CONTEXT_SIZE: 1024,  // Reduced from 2048 to minimize memory usage
    MAX_TOKENS: 256,     // Shorter responses
    TEMPERATURE: 0.7,
    TOP_P: 0.9,

    // Timeouts
    LOAD_TIMEOUT: 120000,  // 2 minutes for model loading
    INFERENCE_TIMEOUT: 60000  // 1 minute for inference
};

// ==========================================
// STATE
// ==========================================

let llama = null;
let model = null;
let context = null;
let chatSession = null;
let currentModelName = null;
let isLoading = false;
let loadProgress = 0;

// Event listeners for progress updates
const progressListeners = new Set();

// ==========================================
// INITIALIZATION
// ==========================================

/**
 * Initialize the LLM service
 * @returns {Promise<boolean>} Whether initialization succeeded
 */
export async function initializeLLM() {
    try {
        // Ensure models directory exists
        if (!existsSync(CONFIG.MODELS_DIR)) {
            mkdirSync(CONFIG.MODELS_DIR, { recursive: true });
        }

        // Initialize llama.cpp
        llama = await getLlama();
        console.log('[LocalLLM] Initialized llama.cpp');

        return true;
    } catch (error) {
        console.error('[LocalLLM] Failed to initialize:', error);
        return false;
    }
}

/**
 * Get available models (downloaded and available for download)
 * @returns {Object} Model status information
 */
export function getAvailableModels() {
    const models = {};

    for (const [filename, info] of Object.entries(CONFIG.MODEL_INFO)) {
        const modelPath = join(CONFIG.MODELS_DIR, filename);
        const isDownloaded = existsSync(modelPath);
        let fileSize = 0;

        if (isDownloaded) {
            try {
                fileSize = statSync(modelPath).size;
            } catch (e) {
                // Ignore
            }
        }

        models[filename] = {
            ...info,
            filename,
            downloaded: isDownloaded,
            fileSize,
            isLoaded: currentModelName === filename,
            downloadUrl: CONFIG.MODEL_URLS[filename]
        };
    }

    return models;
}

/**
 * Get current model status
 * @returns {Object} Current status
 */
export function getStatus() {
    return {
        initialized: !!llama,
        modelLoaded: !!model,
        currentModel: currentModelName,
        isLoading,
        loadProgress,
        modelsDir: CONFIG.MODELS_DIR
    };
}

// ==========================================
// MODEL MANAGEMENT
// ==========================================

/**
 * Get expected model size (approximate, in bytes)
 */
const MODEL_SIZES = {
    'llama-3.2-1b-instruct.Q4_K_M.gguf': 800000000,    // ~800 MB
    'qwen2.5-1.5b-instruct.Q4_K_M.gguf': 1000000000,   // ~1 GB
    'smollm2-1.7b-instruct.Q4_K_M.gguf': 1000000000,   // ~1 GB
    'qwen2.5-0.5b-instruct.Q4_K_M.gguf': 400000000     // ~400 MB
};

/**
 * Check if a downloaded model file is valid (not corrupted/incomplete)
 */
function isModelValid(modelPath, modelName) {
    if (!existsSync(modelPath)) return false;

    try {
        const stats = statSync(modelPath);
        const expectedSize = MODEL_SIZES[modelName];

        // If we know the expected size, check if file is at least 90% of it
        if (expectedSize) {
            const minSize = expectedSize * 0.9;
            if (stats.size < minSize) {
                console.log(`[LocalLLM] Model file too small: ${stats.size} bytes (expected ~${expectedSize})`);
                return false;
            }
        }

        // Basic check: file should be at least 100MB for any model
        if (stats.size < 100000000) {
            console.log(`[LocalLLM] Model file suspiciously small: ${stats.size} bytes`);
            return false;
        }

        return true;
    } catch (e) {
        console.warn('[LocalLLM] Error checking model file:', e);
        return false;
    }
}

/**
 * Delete a corrupted/incomplete model file
 */
function deleteModel(modelPath) {
    try {
        if (existsSync(modelPath)) {
            unlinkSync(modelPath);
            console.log('[LocalLLM] Deleted corrupted model:', modelPath);
        }
    } catch (e) {
        console.warn('[LocalLLM] Failed to delete model:', e);
    }
}

/**
 * Download a model from Hugging Face
 * @param {string} modelName - Model filename
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<string>} Path to downloaded model
 */
export async function downloadModel(modelName, onProgress = () => { }) {
    const url = CONFIG.MODEL_URLS[modelName];
    if (!url) {
        throw new Error(`Unknown model: ${modelName}`);
    }

    const modelPath = join(CONFIG.MODELS_DIR, modelName);

    // Check if already downloaded AND valid
    if (existsSync(modelPath)) {
        if (isModelValid(modelPath, modelName)) {
            console.log('[LocalLLM] Model already exists and is valid:', modelPath);
            onProgress(100);
            return modelPath;
        } else {
            console.log('[LocalLLM] Model file corrupted/incomplete, re-downloading...');
            deleteModel(modelPath);
        }
    }

    console.log('[LocalLLM] Downloading model:', modelName);

    return new Promise((resolve, reject) => {
        const file = createWriteStream(modelPath);
        let downloadedBytes = 0;
        let totalBytes = 0;

        const handleResponse = (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                console.log('[LocalLLM] Following redirect to:', redirectUrl);
                const protocol = redirectUrl.startsWith('https') ? https : http;
                protocol.get(redirectUrl, handleResponse).on('error', reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Download failed: HTTP ${response.statusCode}`));
                return;
            }

            totalBytes = parseInt(response.headers['content-length'], 10) || 0;

            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (totalBytes > 0) {
                    const progress = Math.round((downloadedBytes / totalBytes) * 100);
                    onProgress(progress);
                    notifyProgress('download', progress, modelName);
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log('[LocalLLM] Download complete:', modelPath);
                onProgress(100);
                resolve(modelPath);
            });
        };

        https.get(url, handleResponse).on('error', (err) => {
            file.close();
            reject(err);
        });
    });
}

/**
 * Load a model into memory
 * @param {string} modelName - Model filename (optional, uses default)
 * @returns {Promise<boolean>} Whether loading succeeded
 */
export async function loadModel(modelName = CONFIG.DEFAULT_MODEL) {
    if (isLoading) {
        throw new Error('Model is already loading');
    }

    if (currentModelName === modelName && model) {
        console.log('[LocalLLM] Model already loaded:', modelName);
        return true;
    }

    const modelPath = join(CONFIG.MODELS_DIR, modelName);

    // Download if not present
    if (!existsSync(modelPath)) {
        console.log('[LocalLLM] Model not found, downloading...');
        await downloadModel(modelName, (progress) => {
            loadProgress = progress * 0.5; // Download is 0-50%
            notifyProgress('loading', loadProgress, modelName);
        });
    }

    isLoading = true;
    loadProgress = 50;
    notifyProgress('loading', loadProgress, modelName);

    try {
        // Unload previous model if any
        if (model) {
            await unloadModel();
        }

        // Ensure llama is initialized
        if (!llama) {
            await initializeLLM();
        }

        console.log('[LocalLLM] Loading model:', modelPath);

        // Load the model - start with CPU only to avoid GPU memory issues
        // GPU acceleration can be enabled later if needed
        model = await llama.loadModel({
            modelPath,
            gpuLayers: 0 // CPU only - more compatible, avoids GPU memory errors
        });

        loadProgress = 80;
        notifyProgress('loading', loadProgress, modelName);

        // Create context
        context = await model.createContext({
            contextSize: CONFIG.CONTEXT_SIZE
        });

        // Create chat session with system prompt
        chatSession = new LlamaChatSession({
            contextSequence: context.getSequence(),
            systemPrompt: `You are CoolDesk AI, a helpful desktop assistant integrated into a productivity application. Your role is to assist users with questions, tasks, and information needs.

Guidelines:
- Provide accurate, concise, and relevant answers
- Be direct and get to the point quickly
- If you don't know something, admit it honestly instead of guessing
- Refuse requests for harmful, illegal, or unethical content
- Keep responses brief (2-3 sentences) unless more detail is specifically requested
- Use simple language and avoid unnecessary jargon
- For code or technical questions, provide practical, working solutions

Remember: You're a local AI assistant focused on being helpful, honest, and efficient.`
        });

        currentModelName = modelName;
        loadProgress = 100;
        isLoading = false;
        notifyProgress('loaded', 100, modelName);

        console.log('[LocalLLM] Model loaded successfully');
        return true;

    } catch (error) {
        isLoading = false;
        loadProgress = 0;
        console.error('[LocalLLM] Failed to load model:', error);
        notifyProgress('error', 0, modelName, error.message);
        throw error;
    }
}

/**
 * Unload current model from memory
 */
export async function unloadModel() {
    if (chatSession) {
        chatSession = null;
    }
    if (context) {
        await context.dispose();
        context = null;
    }
    if (model) {
        await model.dispose();
        model = null;
    }
    currentModelName = null;
    console.log('[LocalLLM] Model unloaded');
}

// ==========================================
// INFERENCE
// ==========================================

/**
 * Generate a chat response
 * @param {string} prompt - User prompt
 * @param {Object} options - Generation options
 * @returns {Promise<string>} Generated response
 */
export async function chat(prompt, options = {}) {
    if (!model || !chatSession) {
        throw new Error('Model not loaded. Call loadModel() first.');
    }

    const response = await chatSession.prompt(prompt, {
        maxTokens: options.maxTokens || CONFIG.MAX_TOKENS,
        temperature: options.temperature || CONFIG.TEMPERATURE,
        topP: options.topP || CONFIG.TOP_P
    });

    return response;
}

/**
 * Generate a chat response with streaming
 * @param {string} prompt - User prompt
 * @param {Function} onToken - Callback for each token
 * @param {Object} options - Generation options
 * @returns {Promise<string>} Full response
 */
export async function chatStream(prompt, onToken, options = {}) {
    if (!model || !chatSession) {
        throw new Error('Model not loaded. Call loadModel() first.');
    }

    let fullResponse = '';

    for await (const token of chatSession.promptStream(prompt, {
        maxTokens: options.maxTokens || CONFIG.MAX_TOKENS,
        temperature: options.temperature || CONFIG.TEMPERATURE,
        topP: options.topP || CONFIG.TOP_P
    })) {
        fullResponse += token;
        onToken(token);
    }

    return fullResponse;
}

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within token limit, keeping beginning and end
 */
function truncateForContext(text, maxTokens = 800) {
    const estimated = estimateTokens(text);
    if (estimated <= maxTokens) return text;

    // Keep roughly equal parts from beginning and end
    const maxChars = maxTokens * 4;
    const halfChars = Math.floor(maxChars / 2) - 50; // Leave room for "..." marker

    const beginning = text.slice(0, halfChars);
    const end = text.slice(-halfChars);

    return `${beginning}\n\n[... content truncated for length ...]\n\n${end}`;
}

/**
 * Split long text into chunks for processing
 */
function chunkText(text, maxTokensPerChunk = 600) {
    const maxChars = maxTokensPerChunk * 4;
    const chunks = [];

    // Split by paragraphs first
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';

    for (const para of paragraphs) {
        if ((currentChunk + para).length > maxChars && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = para;
        } else {
            currentChunk += (currentChunk ? '\n\n' : '') + para;
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

/**
 * Summarize text - handles long text by chunking
 * @param {string} text - Text to summarize
 * @param {number} maxLength - Maximum summary length in sentences
 * @returns {Promise<string>} Summary
 */
export async function summarize(text, maxLength = 3) {
    if (!text || text.trim().length === 0) {
        return '';
    }

    const estimatedTokens = estimateTokens(text);

    // If text fits in context, summarize directly
    if (estimatedTokens < 700) {
        const prompt = `Summarize the following text in ${maxLength} sentences or less. Be concise and capture the main points:

${text}

Summary:`;
        return await chat(prompt, { maxTokens: 256, temperature: 0.3 });
    }

    // For longer text, use chunked summarization
    const chunks = chunkText(text, 500);

    if (chunks.length === 1) {
        // Single chunk but still long - truncate intelligently
        const truncated = truncateForContext(text, 700);
        const prompt = `Summarize the following text in ${maxLength} sentences or less. Be concise and capture the main points:

${truncated}

Summary:`;
        return await chat(prompt, { maxTokens: 256, temperature: 0.3 });
    }

    // Multiple chunks - summarize each, then combine
    console.log(`[LocalLLM] Summarizing ${chunks.length} chunks...`);
    const chunkSummaries = [];

    for (let i = 0; i < Math.min(chunks.length, 5); i++) { // Limit to 5 chunks max
        const chunkPrompt = `Summarize this text section in 1-2 sentences:

${chunks[i]}

Summary:`;
        const summary = await chat(chunkPrompt, { maxTokens: 100, temperature: 0.3 });
        chunkSummaries.push(summary.trim());
    }

    // Combine chunk summaries into final summary
    const combinedSummaries = chunkSummaries.join(' ');
    const finalPrompt = `Combine these summaries into a coherent ${maxLength}-sentence summary:

${combinedSummaries}

Final summary:`;

    return await chat(finalPrompt, { maxTokens: 256, temperature: 0.3 });
}

/**
 * Categorize a URL/page
 * @param {string} title - Page title
 * @param {string} url - Page URL
 * @param {string[]} categories - Available categories
 * @returns {Promise<string>} Category
 */
export async function categorize(title, url, categories) {
    const prompt = `Categorize the following webpage into one of these categories: ${categories.join(', ')}

Title: ${title}
URL: ${url}

Respond with ONLY the category name, nothing else.

Category:`;

    const response = await chat(prompt, { maxTokens: 32, temperature: 0.1 });
    const category = response.trim().toLowerCase();

    // Find matching category (case-insensitive)
    return categories.find(c => c.toLowerCase() === category) || 'unknown';
}

/**
 * Answer a question about content
 * @param {string} question - User question
 * @param {string} content - Context content
 * @returns {Promise<string>} Answer
 */
export async function answerQuestion(question, content) {
    const prompt = `Based on the following content, answer the question.

Content:
${content}

Question: ${question}

Answer:`;

    return await chat(prompt, { maxTokens: 512, temperature: 0.5 });
}

/**
 * Execute a natural language command
 * @param {string} command - Natural language command
 * @param {Object} context - Available context (tabs, workspaces, etc.)
 * @returns {Promise<Object>} Parsed command
 */
export async function parseCommand(command) {
    const prompt = `Parse the following command and return a JSON object with the action and parameters.

Available actions:
- open_url: Open a URL (params: url)
- close_tab: Close a tab (params: tabId or title match)
- search: Search for something (params: query, type: tabs|history|bookmarks)
- create_workspace: Create a workspace (params: name)
- summarize: Summarize a page (params: tabId or url)
- switch_workspace: Switch to a workspace (params: name)

Command: "${command}"

Return ONLY valid JSON, no explanation:`;

    const response = await chat(prompt, { maxTokens: 128, temperature: 0.1 });

    try {
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error('No valid JSON in response');
    } catch (e) {
        console.warn('[LocalLLM] Failed to parse command response:', response);
        return { action: 'unknown', raw: command };
    }
}

/**
 * Generate embeddings for text (for semantic search)
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} Embedding vector
 */
export async function getEmbedding(text) {
    if (!model) {
        throw new Error('Model not loaded');
    }

    // Create embedding context if model supports it
    const embeddingContext = await model.createEmbeddingContext();
    const embedding = await embeddingContext.getEmbeddingFor(text);
    await embeddingContext.dispose();

    return Array.from(embedding.vector);
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Similarity score (0-1)
 */
export function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ==========================================
// PROGRESS NOTIFICATIONS
// ==========================================

/**
 * Add a progress listener
 * @param {Function} listener - Callback(type, progress, modelName, error)
 * @returns {Function} Remove listener function
 */
export function onProgress(listener) {
    progressListeners.add(listener);
    return () => progressListeners.delete(listener);
}

function notifyProgress(type, progress, modelName, error = null) {
    for (const listener of progressListeners) {
        try {
            listener(type, progress, modelName, error);
        } catch (e) {
            console.warn('[LocalLLM] Progress listener error:', e);
        }
    }
}

// ==========================================
// CLEANUP
// ==========================================

/**
 * Cleanup all resources
 */
export async function cleanup() {
    await unloadModel();
    if (llama) {
        llama = null;
    }
    progressListeners.clear();
    console.log('[LocalLLM] Cleanup complete');
}

// ==========================================
// CO-WORKING AGENT CAPABILITIES
// ==========================================

/**
 * Batch categorize multiple URLs
 * @param {Array<{title: string, url: string}>} items - URLs to categorize
 * @param {string[]} categories - Available categories
 * @returns {Promise<Array<{title: string, url: string, category: string}>>}
 */
export async function batchCategorize(items, categories) {
    if (!items || items.length === 0) return [];

    const results = [];
    const batchSize = 3; // Process 3 at a time to avoid context overflow

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);

        // Build a single prompt for the batch
        const itemsList = batch.map((item, idx) =>
            `${idx + 1}. "${item.title}" - ${item.url}`
        ).join('\n');

        const prompt = `Categorize each URL into one of: ${categories.join(', ')}

URLs:
${itemsList}

Reply with ONLY the category for each, one per line (e.g., "1. Work"):`;

        try {
            const response = await chat(prompt, { maxTokens: 64, temperature: 0.1 });

            // Parse response lines
            const lines = response.trim().split('\n');
            batch.forEach((item, idx) => {
                const line = lines[idx] || '';
                // Extract category from "1. Category" or just "Category"
                const match = line.match(/(?:\d+\.\s*)?(.+)/);
                const category = match ? match[1].trim().toLowerCase() : 'unknown';
                const matchedCategory = categories.find(c =>
                    c.toLowerCase() === category ||
                    category.includes(c.toLowerCase())
                ) || 'unknown';

                results.push({ ...item, category: matchedCategory });
            });
        } catch (e) {
            // On error, mark batch as unknown
            batch.forEach(item => results.push({ ...item, category: 'unknown' }));
        }
    }

    return results;
}

/**
 * Smart search - find relevant items based on natural language query
 * @param {string} query - Natural language search query
 * @param {Array<{title: string, url: string, category?: string}>} items - Items to search
 * @param {number} limit - Max results
 * @returns {Promise<Array>} Matching items with relevance scores
 */
export async function smartSearch(query, items, limit = 10) {
    if (!items || items.length === 0) return [];

    // For small lists, let LLM rank them
    if (items.length <= 20) {
        const itemsList = items.map((item, idx) =>
            `${idx + 1}. ${item.title} (${item.category || 'uncategorized'})`
        ).join('\n');

        const prompt = `Given the search query "${query}", rank the most relevant items.
Return ONLY the numbers of the top ${Math.min(limit, items.length)} most relevant items, comma-separated.

Items:
${itemsList}

Relevant item numbers:`;

        try {
            const response = await chat(prompt, { maxTokens: 64, temperature: 0.1 });
            const numbers = response.match(/\d+/g) || [];

            return numbers
                .slice(0, limit)
                .map(n => parseInt(n) - 1)
                .filter(idx => idx >= 0 && idx < items.length)
                .map(idx => ({ ...items[idx], relevance: 1 - (numbers.indexOf(String(idx + 1)) * 0.1) }));
        } catch (e) {
            return items.slice(0, limit);
        }
    }

    // For larger lists, use keyword extraction + filtering
    const keywordPrompt = `Extract 3-5 search keywords from: "${query}"
Return ONLY keywords, comma-separated:`;

    try {
        const keywordsResponse = await chat(keywordPrompt, { maxTokens: 32, temperature: 0.1 });
        const keywords = keywordsResponse.toLowerCase().split(',').map(k => k.trim());

        // Score items by keyword matches
        const scored = items.map(item => {
            const text = `${item.title} ${item.url} ${item.category || ''}`.toLowerCase();
            const score = keywords.filter(kw => text.includes(kw)).length;
            return { ...item, relevance: score / keywords.length };
        });

        return scored
            .filter(item => item.relevance > 0)
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, limit);
    } catch (e) {
        return items.slice(0, limit);
    }
}

/**
 * Suggest workspace organization based on URLs
 * @param {Array<{title: string, url: string}>} urls - URLs to analyze
 * @returns {Promise<Array<{name: string, description: string, urls: string[]}>>}
 */
export async function suggestWorkspaces(urls) {
    if (!urls || urls.length === 0) return [];

    // Sample URLs if too many
    const sample = urls.length > 30 ? urls.slice(0, 30) : urls;

    const urlList = sample.map(u => `- ${u.title}: ${u.url}`).join('\n');

    const prompt = `Analyze these URLs and suggest 3-5 workspace categories to organize them.

URLs:
${urlList}

Return JSON array like: [{"name": "Work", "description": "Work related sites", "keywords": ["github", "jira"]}]
JSON only:`;

    try {
        const response = await chat(prompt, { maxTokens: 256, temperature: 0.5 });
        const jsonMatch = response.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
            const suggestions = JSON.parse(jsonMatch[0]);

            // Match URLs to suggestions based on keywords
            return suggestions.map(suggestion => {
                const keywords = suggestion.keywords || [];
                const matchedUrls = urls.filter(u => {
                    const text = `${u.title} ${u.url}`.toLowerCase();
                    return keywords.some(kw => text.includes(kw.toLowerCase()));
                }).map(u => u.url);

                return {
                    name: suggestion.name,
                    description: suggestion.description,
                    urls: matchedUrls
                };
            });
        }
    } catch (e) {
        console.warn('[LocalLLM] Workspace suggestion failed:', e);
    }

    return [];
}

/**
 * Generate a daily briefing/summary
 * @param {Object} context - Context with recent activity
 * @returns {Promise<string>} Briefing text
 */
export async function generateBriefing(context = {}) {
    const { recentUrls = [], topSites = [], pendingTasks = [] } = context;

    let contextText = '';

    if (recentUrls.length > 0) {
        contextText += `Recent activity:\n${recentUrls.slice(0, 5).map(u => `- ${u.title}`).join('\n')}\n\n`;
    }

    if (topSites.length > 0) {
        contextText += `Most visited:\n${topSites.slice(0, 3).map(s => `- ${s.title} (${s.visits} visits)`).join('\n')}\n\n`;
    }

    if (pendingTasks.length > 0) {
        contextText += `Pending tasks:\n${pendingTasks.slice(0, 5).map(t => `- ${t}`).join('\n')}\n\n`;
    }

    if (!contextText) {
        return "Good day! Ready to help you stay organized.";
    }

    const prompt = `Based on this user activity, write a brief (2-3 sentence) friendly morning briefing:

${contextText}

Briefing:`;

    try {
        return await chat(prompt, { maxTokens: 128, temperature: 0.7 });
    } catch (e) {
        return "Good day! Ready to help you stay organized.";
    }
}

/**
 * Agent action handler - interprets user intent and suggests actions
 * @param {string} userInput - User's natural language input
 * @param {Object} context - Current app context
 * @returns {Promise<Object>} Suggested action(s)
 */
export async function handleAgentRequest(userInput, context = {}) {
    const { workspaces = [], urls = [], currentWorkspace = null } = context;

    const prompt = `You are CoolDesk AI assistant. Parse this user request and return a JSON action.

Available actions:
- search: {action: "search", query: "...", scope: "all"|"workspace"|"history"}
- categorize: {action: "categorize", urls: "selected"|"all"|"uncategorized"}
- summarize: {action: "summarize", target: "page"|"workspace"}
- organize: {action: "organize", suggestion: true}
- open: {action: "open", target: "url"|"workspace", value: "..."}
- create: {action: "create", type: "workspace", name: "..."}
- answer: {action: "answer", response: "..."}

Current context:
- Workspaces: ${workspaces.slice(0, 5).map(w => w.name).join(', ') || 'none'}
- Current workspace: ${currentWorkspace || 'none'}
- URLs count: ${urls.length}

User: "${userInput}"

Return ONLY valid JSON:`;

    try {
        const response = await chat(prompt, { maxTokens: 128, temperature: 0.2 });
        const jsonMatch = response.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (e) {
        console.warn('[LocalLLM] Agent request parsing failed:', e);
    }

    // Fallback to simple answer
    return { action: 'answer', response: "I'm not sure how to help with that. Try asking me to search, categorize URLs, or organize your workspace." };
}

// Export config for UI
export { CONFIG };

