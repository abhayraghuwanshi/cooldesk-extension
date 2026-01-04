/**
 * Feature Store - Cache computed features to avoid recomputation
 */

import { ML_CONFIG } from '../config.js';

/**
 * Feature Store Class
 * Manages caching of computed features with TTL
 */
export class FeatureStore {
  constructor() {
    this.cache = new Map(); // url -> {features, timestamp}
    this.maxSize = ML_CONFIG.performance.maxCachedEmbeddings;
    this.ttl = ML_CONFIG.categorization.cacheTimeout;
  }

  /**
   * Store features for a URL
   * @param {string} url - The URL
   * @param {Object} features - Feature object (raw and normalized)
   */
  set(url, features) {
    // Check cache size and evict oldest if needed
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(url, {
      features,
      timestamp: Date.now()
    });
  }

  /**
   * Get cached features for a URL
   * @param {string} url - The URL
   * @returns {Object|null} Cached features or null if expired/missing
   */
  get(url) {
    const cached = this.cache.get(url);

    if (!cached) {
      return null;
    }

    // Check if expired
    const age = Date.now() - cached.timestamp;
    if (age > this.ttl) {
      this.cache.delete(url);
      return null;
    }

    return cached.features;
  }

  /**
   * Check if features exist and are fresh
   * @param {string} url - The URL
   * @returns {boolean} True if cached and fresh
   */
  has(url) {
    return this.get(url) !== null;
  }

  /**
   * Evict oldest entry from cache
   */
  evictOldest() {
    let oldestUrl = null;
    let oldestTime = Infinity;

    for (const [url, data] of this.cache) {
      if (data.timestamp < oldestTime) {
        oldestTime = data.timestamp;
        oldestUrl = url;
      }
    }

    if (oldestUrl) {
      this.cache.delete(oldestUrl);
    }
  }

  /**
   * Clear expired entries
   */
  clearExpired() {
    const now = Date.now();
    const toDelete = [];

    for (const [url, data] of this.cache) {
      if (now - data.timestamp > this.ttl) {
        toDelete.push(url);
      }
    }

    toDelete.forEach(url => this.cache.delete(url));

    return toDelete.length;
  }

  /**
   * Clear all cached features
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilization: (this.cache.size / this.maxSize * 100).toFixed(1) + '%'
    };
  }

  /**
   * Persist cache to storage
   */
  async save() {
    try {
      const cacheData = {};

      for (const [url, data] of this.cache) {
        cacheData[url] = data;
      }

      await chrome.storage.local.set({
        ml_featureCache: cacheData,
        ml_featureCache_savedAt: Date.now()
      });

      console.log('[ML] Feature cache saved');
    } catch (error) {
      console.error('[ML] Failed to save feature cache:', error.message);
    }
  }

  /**
   * Load cache from storage
   */
  async load() {
    try {
      const result = await chrome.storage.local.get([
        'ml_featureCache',
        'ml_featureCache_savedAt'
      ]);

      if (!result.ml_featureCache) {
        console.log('[ML] No feature cache found in storage');
        return false;
      }

      const savedAt = result.ml_featureCache_savedAt || 0;
      const age = Date.now() - savedAt;

      // Don't load if saved cache is too old
      if (age > this.ttl) {
        console.log('[ML] Saved feature cache is too old, discarding');
        return false;
      }

      // Restore cache
      const cacheData = result.ml_featureCache;
      for (const [url, data] of Object.entries(cacheData)) {
        this.cache.set(url, data);
      }

      console.log('[ML] Feature cache loaded');
      return true;

    } catch (error) {
      console.error('[ML] Failed to load feature cache:', error.message);
      return false;
    }
  }
}

// Export singleton instance
export const featureStore = new FeatureStore();
