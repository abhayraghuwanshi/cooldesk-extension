/**
 * Auto-Save Predictor - Inference module for auto-save predictions
 * Uses trained model to predict which URLs should be auto-saved
 */

import { AutoSaveModel } from '../models/autoSaveModel.js';
import { FeatureExtractor } from '../features/featureExtractor.js';
import { featureStore } from '../features/featureStore.js';
import { saveWorkspace, listWorkspaces } from '../../db/index.js';
import { ML_CONFIG } from '../config.js';

/**
 * Auto-Save Predictor Class
 * Handles inference and auto-saving logic
 */
export class AutoSavePredictor {
  constructor() {
    this.model = new AutoSaveModel();
    this.initialized = false;
    this.initializationPromise = null;
  }

  /**
   * Initialize the predictor by loading the trained model
   * @returns {Promise<boolean>} Success status
   */
  async initialize() {
    // Return existing initialization if in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    if (this.initialized) {
      return true;
    }

    this.initializationPromise = this._initialize();
    return this.initializationPromise;
  }

  async _initialize() {
    try {
      console.log('[ML] Initializing auto-save predictor...');

      // Check if feature is enabled
      const settings = await chrome.storage.local.get([
        ML_CONFIG.storage.enabled,
        ML_CONFIG.storage.autoSaveEnabled
      ]);

      if (settings[ML_CONFIG.storage.enabled] === false ||
          settings[ML_CONFIG.storage.autoSaveEnabled] === false) {
        console.log('[ML] Auto-save disabled in settings');
        return false;
      }

      // Load trained model
      const loaded = await this.model.load();

      if (!loaded) {
        console.log('[ML] No trained model found, predictor not initialized');
        return false;
      }

      // Load feature cache
      await featureStore.load();

      this.initialized = true;
      console.log('[ML] ✅ Auto-save predictor initialized');

      return true;

    } catch (error) {
      console.error('[ML] Failed to initialize predictor:', error);
      return false;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Predict if a URL should be auto-saved
   * @param {string} url - The URL
   * @param {Object} activityData - Activity data from activity.js
   * @param {Object} sessionData - Optional session data
   * @returns {Promise<Object|null>} Prediction result or null
   */
  async predictUrl(url, activityData, sessionData = {}) {
    if (!this.initialized) {
      const initialized = await this.initialize();
      if (!initialized) {
        return null;
      }
    }

    try {
      // Check cache first
      let features = featureStore.get(url);

      if (!features) {
        // Extract features
        const featureObj = FeatureExtractor.createFeatureObject(
          url,
          activityData,
          sessionData,
          {
            explicitlySaved: false,
            explicitlyRemoved: false
          }
        );

        features = featureObj;

        // Cache for future use
        featureStore.set(url, features);
      }

      // Make prediction
      const probability = this.model.predictProbability(features.normalized);
      const shouldSave = this.model.shouldAutoSave(features.normalized);
      const confidence = Math.abs(probability - 0.5) * 2; // 0 = uncertain, 1 = very certain

      return {
        shouldSave,
        probability,
        confidence,
        features: features.raw, // For debugging
        threshold: this.model.threshold
      };

    } catch (error) {
      console.error('[ML] Prediction failed for', url, ':', error);
      return null;
    }
  }

  /**
   * Auto-save a URL if prediction indicates it should be saved
   * @param {string} url - The URL
   * @param {Object} activityData - Activity data
   * @param {Object} sessionData - Session data
   * @returns {Promise<Object>} Result {saved, prediction, workspace}
   */
  async autoSaveIfNeeded(url, activityData, sessionData = {}) {
    try {
      // Make prediction
      const prediction = await this.predictUrl(url, activityData, sessionData);

      if (!prediction) {
        return {
          saved: false,
          reason: 'prediction_failed',
          prediction: null
        };
      }

      if (!prediction.shouldSave) {
        return {
          saved: false,
          reason: 'low_score',
          prediction
        };
      }

      // Check if already saved
      const alreadySaved = await this.isUrlSaved(url);

      if (alreadySaved) {
        return {
          saved: false,
          reason: 'already_saved',
          alreadySaved: true,
          prediction
        };
      }

      // Auto-save to "Smart Saved" workspace
      const saved = await this.saveToSmartWorkspace(url, activityData, prediction);

      if (saved) {
        console.log(`[ML] ✅ Auto-saved URL (score: ${prediction.probability.toFixed(2)}):`, url);
        return {
          saved: true,
          prediction,
          workspace: 'Smart Saved'
        };
      } else {
        return {
          saved: false,
          reason: 'save_failed',
          prediction
        };
      }

    } catch (error) {
      console.error('[ML] Auto-save check failed for', url, ':', error);
      return {
        saved: false,
        error: error.message,
        prediction: null
      };
    }
  }

  /**
   * Check if URL is already saved in any workspace
   * @param {string} url - The URL
   * @returns {Promise<boolean>} True if already saved
   */
  async isUrlSaved(url) {
    try {
      const workspacesResult = await listWorkspaces();
      const workspaces = workspacesResult?.success ? workspacesResult.data : [];

      const normalizedUrl = this.normalizeUrl(url);

      for (const workspace of workspaces) {
        if (workspace.urls && Array.isArray(workspace.urls)) {
          for (const urlObj of workspace.urls) {
            if (this.normalizeUrl(urlObj.url) === normalizedUrl) {
              return true;
            }
          }
        }
      }

      return false;

    } catch (error) {
      console.error('[ML] Failed to check if URL is saved:', error);
      return false;
    }
  }

  /**
   * Save URL to Smart Saved workspace
   * @param {string} url - The URL
   * @param {Object} activityData - Activity data
   * @param {Object} prediction - Prediction result
   * @returns {Promise<boolean>} Success status
   */
  async saveToSmartWorkspace(url, activityData, prediction) {
    try {
      const workspacesResult = await listWorkspaces();
      const workspaces = workspacesResult?.success ? workspacesResult.data : [];

      // Find or create Smart Saved workspace
      let smartWorkspace = workspaces.find(ws => ws.name === 'Smart Saved');

      if (!smartWorkspace) {
        // Create Smart Saved workspace
        smartWorkspace = {
          id: `ws_smart_${Date.now()}`,
          name: 'Smart Saved',
          icon: '🤖',
          color: '#10b981',
          urls: [],
          createdAt: Date.now(),
          autoCreated: true,
          mlGenerated: true,
          description: 'Automatically saved URLs based on your browsing patterns'
        };
      }

      // Add URL to workspace
      const urlEntry = {
        url,
        title: activityData.title || this.extractTitle(url),
        domain: activityData.domain || this.extractDomain(url),
        favicon: `chrome://favicon/${url}`,
        addedAt: Date.now(),
        mlScore: prediction.probability,
        mlConfidence: prediction.confidence,
        autoAdded: true,
        source: 'ml_auto_save'
      };

      smartWorkspace.urls = smartWorkspace.urls || [];
      smartWorkspace.urls.push(urlEntry);

      // Update workspace
      const saved = await saveWorkspace(smartWorkspace);

      return saved.success === true;

    } catch (error) {
      console.error('[ML] Failed to save to Smart Saved workspace:', error);
      return false;
    }
  }

  /**
   * Batch predict multiple URLs
   * @param {Array} urlDataPairs - Array of {url, activityData, sessionData}
   * @returns {Promise<Array>} Array of predictions
   */
  async predictBatch(urlDataPairs) {
    if (!this.initialized) {
      await this.initialize();
    }

    const predictions = [];

    for (const { url, activityData, sessionData } of urlDataPairs) {
      try {
        const prediction = await this.predictUrl(url, activityData, sessionData);
        predictions.push({
          url,
          prediction
        });
      } catch (error) {
        console.error(`[ML] Batch prediction failed for ${url}:`, error);
        predictions.push({
          url,
          prediction: null,
          error: error.message
        });
      }
    }

    return predictions;
  }

  /**
   * Normalize URL for comparison
   * @param {string} url - The URL
   * @returns {string} Normalized URL
   */
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
    } catch {
      return url;
    }
  }

  /**
   * Extract domain from URL
   * @param {string} url - The URL
   * @returns {string} Domain
   */
  extractDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  /**
   * Extract title from URL (fallback)
   * @param {string} url - The URL
   * @returns {string} Title
   */
  extractTitle(url) {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.split('/').filter(Boolean).pop();
      return path || urlObj.hostname;
    } catch {
      return url;
    }
  }

  /**
   * Get predictor status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      initialized: this.initialized,
      modelTrained: this.model.trained,
      modelStatus: this.model.getStatus(),
      cacheStats: featureStore.getStats()
    };
  }

  /**
   * Reset the predictor
   */
  async reset() {
    this.initialized = false;
    this.model.reset();
    featureStore.clear();
    console.log('[ML] Predictor reset');
  }
}

// Export singleton instance
export const autoSavePredictor = new AutoSavePredictor();
