/**
 * ML Engine - Main entry point for machine learning functionality
 * Initializes Transformers.js and provides embedding capabilities
 */

import { ML_CONFIG } from './config.js';

// Transformers.js is available as a dependency for Phase 2 categorization features
// Phase 1 (auto-save) does not require it

/**
 * Main ML Engine class
 * Handles model initialization and provides ML capabilities
 */
class MLEngine {
  constructor() {
    this.initialized = false;
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

      this.initialized = true;
      console.log('[ML] ✅ ML engine initialized');

      // Store initialization timestamp
      await chrome.storage.local.set({
        ml_initialized: Date.now(),
        ml_engine_version: '1.0.0'
      });

      return true;

    } catch (error) {
      console.error('[ML] Failed to initialize ML engine:', error);
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
      error: this.initializationError?.message || null
    };
  }

  /**
   * Reset the ML engine
   */
  async reset() {
    this.initialized = false;
    this.initializationPromise = null;
    this.initializationError = null;

    console.log('[ML] Engine reset');
  }
}

// Export singleton instance
export const mlEngine = new MLEngine();

// Export for testing
export { MLEngine };

