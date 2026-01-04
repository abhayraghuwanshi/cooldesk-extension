/**
 * Feature Extractor - Extract ML-ready features from activity data
 * Integrates with existing activity tracking in src/background/activity.js
 */

import { ML_CONFIG } from '../config.js';
import { FEATURE_SCHEMA, validateFeatures } from './featureSchema.js';

/**
 * Feature Extractor Class
 * Converts raw activity data into normalized feature vectors for ML models
 */
export class FeatureExtractor {
  /**
   * Extract features from activity data and session data
   * @param {string} url - The URL being analyzed
   * @param {Object} activityData - Activity data from activity.js
   * @param {Object} sessionData - Optional session data
   * @param {Object} options - Extraction options
   * @returns {Object} Feature object with raw and normalized values
   */
  static extractUrlFeatures(url, activityData, sessionData = {}, options = {}) {
    if (!activityData) {
      throw new Error('Activity data is required');
    }

    const features = {
      // Time-based features
      totalTimeSpent: activityData.time || 0,
      avgSessionDuration: this.calculateAvgSessionDuration(activityData),
      maxSessionDuration: this.calculateMaxSessionDuration(activityData),

      // Engagement features
      clickCount: activityData.clicks || 0,
      maxScrollDepth: activityData.scroll || 0,
      formSubmissions: activityData.forms || 0,
      engagementScore: this.calculateEngagementScore(activityData),

      // Visit patterns
      visitCount: activityData.visitCount || 0,
      returnVisits: activityData.returnVisits || 0,
      uniqueDaysVisited: this.getUniqueDaysCount(activityData),
      bounceRate: this.calculateBounceRate(activityData),

      // Temporal patterns
      avgVisitHour: this.calculateAvgVisitHour(activityData.visitTimes || []),
      visitHourVariance: this.calculateVariance(activityData.visitTimes || []),
      hoursSinceLastVisit: this.hoursSince(activityData.lastVisit),
      hoursSinceFirstVisit: this.hoursSince(activityData.firstVisit),

      // Content signals
      pageType: this.encodePageType(activityData.pageType),
      domain: this.extractDomain(url),
      hasTitle: !!activityData.title,

      // Explicit signals (strongest predictors)
      explicitlySaved: options.explicitlySaved || false,
      explicitlyRemoved: options.explicitlyRemoved || false,
      openedFromSaved: sessionData.openedFromSaved || 0,

      // Derived features
      engagementPerVisit: this.calculateEngagementPerVisit(activityData),
      timePerVisit: this.calculateTimePerVisit(activityData),
    };

    return features;
  }

  /**
   * Normalize features to 0-1 scale for ML model
   * @param {Object} features - Raw feature object
   * @returns {number[]} Normalized feature vector
   */
  static normalizeFeatures(features) {
    const normalized = FEATURE_SCHEMA.map(schema => {
      const value = features[schema.name];

      if (value === undefined || value === null) {
        return 0;
      }

      try {
        return schema.normalize(value);
      } catch (error) {
        console.error(`[ML] Error normalizing ${schema.name}:`, error.message);
        return 0;
      }
    });

    // Validate normalized features
    const validation = validateFeatures(normalized);
    if (!validation.valid) {
      throw new Error(`[ML] Feature validation failed: ${validation.error}`);
    }

    return normalized;
  }

  /**
   * Calculate engagement score using weighted formula
   * @param {Object} data - Activity data
   * @returns {number} Engagement score
   */
  static calculateEngagementScore(data) {
    const weights = ML_CONFIG.features.engagementWeight;

    return (
      (data.forms || 0) * weights.forms +
      (data.clicks || 0) * weights.clicks +
      (data.scroll || 0) * weights.scroll +
      ((data.time || 0) / ML_CONFIG.features.timeScale) * weights.time
    );
  }

  /**
   * Calculate bounce rate
   * @param {Object} data - Activity data
   * @returns {number} Bounce rate (0-1)
   */
  static calculateBounceRate(data) {
    const total = data.sessionDurations?.length || 0;
    if (total === 0) return 0;

    const bounced = data.bounced || 0;
    return bounced / total;
  }

  /**
   * Calculate average session duration
   * @param {Object} data - Activity data
   * @returns {number} Average duration in milliseconds
   */
  static calculateAvgSessionDuration(data) {
    const durations = data.sessionDurations || [];
    if (durations.length === 0) return 0;

    const sum = durations.reduce((a, b) => a + b, 0);
    return sum / durations.length;
  }

  /**
   * Calculate maximum session duration
   * @param {Object} data - Activity data
   * @returns {number} Max duration in milliseconds
   */
  static calculateMaxSessionDuration(data) {
    const durations = data.sessionDurations || [];
    if (durations.length === 0) return 0;

    return Math.max(...durations);
  }

  /**
   * Calculate average visit hour
   * @param {number[]} visitTimes - Array of visit hours (0-23)
   * @returns {number} Average hour
   */
  static calculateAvgVisitHour(visitTimes) {
    if (!visitTimes || visitTimes.length === 0) return 12; // Noon default

    const sum = visitTimes.reduce((a, b) => a + b, 0);
    return sum / visitTimes.length;
  }

  /**
   * Calculate variance in values
   * @param {number[]} values - Array of numbers
   * @returns {number} Variance
   */
  static calculateVariance(values) {
    if (!values || values.length === 0) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Calculate hours since timestamp
   * @param {number} timestamp - Timestamp in milliseconds
   * @returns {number} Hours since timestamp
   */
  static hoursSince(timestamp) {
    if (!timestamp) return Infinity;
    return (Date.now() - timestamp) / (1000 * 60 * 60);
  }

  /**
   * Get unique days count from visitDays set
   * @param {Object} data - Activity data
   * @returns {number} Number of unique days
   */
  static getUniqueDaysCount(data) {
    if (data.visitDays) {
      // Handle both Set and Array
      if (data.visitDays instanceof Set) {
        return data.visitDays.size;
      }
      if (Array.isArray(data.visitDays)) {
        return data.visitDays.length;
      }
    }
    return 0;
  }

  /**
   * Encode page type as numeric value
   * @param {string} pageType - Page type string
   * @returns {number} Encoded value (0-8)
   */
  static encodePageType(pageType) {
    const types = [
      'general',
      'tool',
      'docs',
      'article',
      'code',
      'social',
      'video',
      'email',
      'storage'
    ];

    const index = types.indexOf(pageType || 'general');
    return index >= 0 ? index : 0;
  }

  /**
   * Extract domain from URL
   * @param {string} url - URL string
   * @returns {string} Domain name
   */
  static extractDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  /**
   * Calculate engagement per visit
   * @param {Object} data - Activity data
   * @returns {number} Engagement per visit
   */
  static calculateEngagementPerVisit(data) {
    const visits = data.visitCount || 1;
    const clicks = data.clicks || 0;
    return clicks / Math.max(1, visits);
  }

  /**
   * Calculate time per visit
   * @param {Object} data - Activity data
   * @returns {number} Time per visit in milliseconds
   */
  static calculateTimePerVisit(data) {
    const visits = data.visitCount || 1;
    const time = data.time || 0;
    return time / Math.max(1, visits);
  }

  /**
   * Extract features and normalize in one step
   * @param {string} url - The URL
   * @param {Object} activityData - Activity data
   * @param {Object} sessionData - Session data
   * @param {Object} options - Options
   * @returns {number[]} Normalized feature vector
   */
  static extractAndNormalize(url, activityData, sessionData = {}, options = {}) {
    const features = this.extractUrlFeatures(url, activityData, sessionData, options);
    return this.normalizeFeatures(features);
  }

  /**
   * Create feature object with metadata
   * @param {string} url - The URL
   * @param {Object} activityData - Activity data
   * @param {Object} sessionData - Session data
   * @param {Object} options - Options
   * @returns {Object} Feature object with raw, normalized, and metadata
   */
  static createFeatureObject(url, activityData, sessionData = {}, options = {}) {
    const raw = this.extractUrlFeatures(url, activityData, sessionData, options);
    const normalized = this.normalizeFeatures(raw);

    return {
      url,
      raw,
      normalized,
      timestamp: Date.now(),
      activityDataPresent: !!activityData,
      sessionDataPresent: !!sessionData && Object.keys(sessionData).length > 0
    };
  }

  /**
   * Batch extract features for multiple URLs
   * @param {Array} urlDataPairs - Array of {url, activityData, sessionData, options}
   * @returns {Array} Array of normalized feature vectors
   */
  static batchExtract(urlDataPairs) {
    return urlDataPairs.map(({ url, activityData, sessionData, options }) => {
      try {
        return this.extractAndNormalize(url, activityData, sessionData, options);
      } catch (error) {
        console.error(`[ML] Failed to extract features for ${url}:`, error);
        return null;
      }
    }).filter(f => f !== null);
  }

  /**
   * Get feature summary statistics
   * @param {Object} features - Feature object
   * @returns {Object} Summary statistics
   */
  static getFeatureSummary(features) {
    const normalized = this.normalizeFeatures(features);

    return {
      mean: normalized.reduce((a, b) => a + b, 0) / normalized.length,
      min: Math.min(...normalized),
      max: Math.max(...normalized),
      nonZeroCount: normalized.filter(v => v !== 0).length,
      zeroCount: normalized.filter(v => v === 0).length
    };
  }
}
