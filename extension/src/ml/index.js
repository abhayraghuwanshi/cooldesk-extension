/**
 * ML Engine - Main entry point for machine learning functionality
 * Initializes Transformers.js and provides embedding capabilities
 */

import { ML_CONFIG } from './config.js';

import { env, pipeline } from '@xenova/transformers';

// Static import for service worker compatibility
let transformersInstance = null;

async function loadTransformers() {
  if (!transformersInstance) {
    try {
      transformersInstance = { pipeline, env };

      // Configure for Chrome extension service worker environment
      transformersInstance.env.allowLocalModels = false;
      transformersInstance.env.useBrowserCache = true;
      transformersInstance.env.allowRemoteModels = true;
      transformersInstance.env.backends.onnx.wasm.proxy = false; // Disable worker proxy in service worker

      return true;
    } catch (error) {
      console.error('[ML] Failed to load Transformers.js:', error);
      return false;
    }
  }
  return true;
}

/**
 * Main ML Engine class
 * Handles model initialization and provides ML capabilities
 */
class MLEngine {
  constructor() {
    this.initialized = false;
    this.embedder = null;
    this.initializationPromise = null;
    this.initializationError = null;
  }

  /**
   * Initialize the ML engine
   * Loads embedding model for semantic understanding
   * @returns {Promise<boolean>} Success status
   */
  async initialize() {
    // Return existing initialization if in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Already initialized
    if (this.initialized) {
      return true;
    }

    // Already failed
    if (this.initializationError) {
      console.warn('[ML] Previous initialization failed:', this.initializationError);
      return false;
    }

    this.initializationPromise = this._initialize();
    return this.initializationPromise;
  }

  async _initialize() {
    try {
      console.log('[ML] Initializing ML engine...');

      // Check if ML is enabled
      const settings = await chrome.storage.local.get([ML_CONFIG.storage.enabled]);
      if (settings[ML_CONFIG.storage.enabled] === false) {
        console.log('[ML] ML features disabled in settings');
        return false;
      }

      // Load Transformers.js library
      console.log('[ML] Loading Transformers.js...');
      const loaded = await loadTransformers();
      if (!loaded) {
        console.warn('[ML] Failed to load Transformers.js, embeddings will not be available');
        // Continue without embeddings - auto-save model doesn't require them
        this.initialized = true;
        return true;
      }

      // Embeddings are optional for Phase 1 (only needed for Phase 2 categorization)
      // Skip embedding model loading to avoid service worker issues
      console.log('[ML] Transformers.js loaded, skipping embedding model for now');
      console.log('[ML] Note: Embedding model will be loaded on-demand for categorization');

      this.initialized = true;
      console.log('[ML] ✅ ML engine initialized successfully (without embeddings)');

      // Store initialization timestamp
      await chrome.storage.local.set({
        ml_initialized: Date.now(),
        ml_engine_version: '1.0.0',
        ml_embeddings_available: false // Will be true in Phase 2
      });

      return true;

    } catch (error) {
      console.error('[ML] Failed to initialize ML engine:', error);
      console.error('[ML] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });

      this.initializationError = error;
      this.initialized = false;

      // Store error for debugging
      await chrome.storage.local.set({
        ml_initialization_error: {
          message: error.message,
          timestamp: Date.now()
        }
      }).catch(() => { });

      return false;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Get embedding vector for text
   * NOTE: Not needed for Phase 1 (auto-save only). Will be implemented in Phase 2 for categorization.
   * @param {string} text - Input text to embed
   * @param {Object} options - Embedding options
   * @returns {Promise<number[]>} Embedding vector
   */
  async getEmbedding(text, options = {}) {
    throw new Error('[ML] Embeddings not yet implemented. Phase 1 (auto-save) does not require embeddings. Will be added in Phase 2 for categorization.');

    // Phase 2 implementation will go here:
    /*
    if (!this.initialized) {
      await this.initialize();
    }

    // Load embedding model on-demand
    if (!this.embedder) {
      console.log('[ML] Loading embedding model on-demand...');
      await loadTransformers();

      this.embedder = await transformersInstance.pipeline(
        'feature-extraction',
        ML_CONFIG.categorization.embeddingModel,
        { quantized: true }
      );
    }

    const result = await this.embedder(text, {
      pooling: options.pooling || 'mean',
      normalize: options.normalize !== false
    });

    return Array.from(result.data);
    */
  }

  /**
   * Get embeddings for multiple texts (batch processing)
   * NOTE: Not needed for Phase 1. Will be implemented in Phase 2.
   * @param {string[]} texts - Array of texts to embed
   * @param {Object} options - Embedding options
   * @returns {Promise<number[][]>} Array of embedding vectors
   */
  async getEmbeddings(texts, options = {}) {
    throw new Error('[ML] Batch embeddings not yet implemented. Will be added in Phase 2 for categorization.');
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {number[]} a - First vector
   * @param {number[]} b - Second vector
   * @returns {number} Similarity score (0-1)
   */
  cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Get ML engine status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      initialized: this.initialized,
      hasEmbedder: !!this.embedder,
      error: this.initializationError?.message || null,
      model: ML_CONFIG.categorization.embeddingModel
    };
  }

  /**
   * Reset the ML engine
   */
  async reset() {
    this.initialized = false;
    this.embedder = null;
    this.initializationPromise = null;
    this.initializationError = null;

    console.log('[ML] Engine reset');
  }
}

// Export singleton instance
export const mlEngine = new MLEngine();

// Export for testing
export { MLEngine };

