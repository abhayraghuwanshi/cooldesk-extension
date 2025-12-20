/**
 * Label Generator - Generate training labels from user behavior
 * Analyzes activity patterns and workspace data to label URLs as valuable or not
 */

import { listWorkspaces } from '../../db/index.js';
import { ML_CONFIG } from '../config.js';

/**
 * Label Generator Class
 * Creates training labels based on implicit and explicit user signals
 */
export class LabelGenerator {
  /**
   * Generate labels for all URLs in activity data
   * @param {Object} activityData - Activity data keyed by URL
   * @returns {Promise<Map>} Map of url -> {label, confidence, reason}
   */
  static async generateLabels(activityData) {
    const labels = new Map();

    try {
      // Get saved workspaces to identify explicitly saved URLs
      const workspacesResult = await listWorkspaces();
      const workspaces = workspacesResult?.success ? workspacesResult.data : [];
      const savedUrls = new Set();
      const removedUrls = new Set();

      // Collect explicitly saved URLs
      workspaces.forEach(ws => {
        if (ws.urls && Array.isArray(ws.urls)) {
          ws.urls.forEach(urlObj => {
            const normalized = this.normalizeUrl(urlObj.url);
            savedUrls.add(normalized);
          });
        }
      });

      // Get user corrections (removed URLs)
      const storage = await chrome.storage.local.get([
        ML_CONFIG.storage.negativeSignals,
        ML_CONFIG.storage.userCorrections
      ]);

      const negativeSignals = storage[ML_CONFIG.storage.negativeSignals] || [];
      negativeSignals.forEach(signal => {
        if (signal.url) {
          removedUrls.add(this.normalizeUrl(signal.url));
        }
      });

      console.log('[ML] Label generation:', {
        activityUrls: Object.keys(activityData).length,
        savedUrls: savedUrls.size,
        removedUrls: removedUrls.size
      });

      // Generate labels for each URL
      for (const [url, data] of Object.entries(activityData)) {
        const normalized = this.normalizeUrl(url);
        const isSaved = savedUrls.has(normalized);
        const isRemoved = removedUrls.has(normalized);

        const labelInfo = this.labelUrl(url, data, isSaved, isRemoved);
        labels.set(url, labelInfo);
      }

      // Log label distribution
      const distribution = this.getLabelDistribution(labels);
      console.log('[ML] Label distribution:', distribution);

      return labels;

    } catch (error) {
      console.error('[ML] Failed to generate labels:', error);
      return labels;
    }
  }

  /**
   * Label a single URL based on behavior signals
   * @param {string} url - The URL
   * @param {Object} data - Activity data for this URL
   * @param {boolean} isSaved - Explicitly saved by user
   * @param {boolean} isRemoved - Explicitly removed by user
   * @returns {Object} Label info {label, confidence, reason}
   */
  static labelUrl(url, data, isSaved, isRemoved) {
    const reasons = [];

    // POSITIVE LABEL (valuable URL)
    if (isSaved) {
      return {
        label: 1,
        confidence: 1.0,
        reason: 'explicitly_saved'
      };
    }

    // Strong engagement patterns
    if (data.visitCount >= 5 && data.returnVisits >= 2) {
      reasons.push('frequent_returns');
    }

    if (data.time > 300000 && data.scroll > 50) {
      reasons.push('deep_engagement');
    }

    if (data.forms > 0 && data.visitCount >= 2) {
      reasons.push('form_usage');
    }

    if ((data.openedFromSaved || 0) >= 3) {
      reasons.push('opened_from_saved');
    }

    // High engagement score
    const engagementScore = this.calculateEngagement(data);
    if (engagementScore > 500) {
      reasons.push('high_engagement');
    }

    // Low bounce rate indicates quality
    const bounceRate = this.calculateBounceRate(data);
    if (bounceRate < 0.3 && data.visitCount >= 3) {
      reasons.push('low_bounce_rate');
    }

    // NEGATIVE LABEL (not valuable)
    if (isRemoved) {
      return {
        label: 0,
        confidence: 1.0,
        reason: 'explicitly_removed'
      };
    }

    // Negative patterns
    const negativeReasons = [];

    if (bounceRate > 0.7) {
      negativeReasons.push('high_bounce_rate');
    }

    if (data.visitCount >= 3 && data.time < 30000) {
      negativeReasons.push('low_time_multiple_visits');
    }

    if (data.visitCount === 1 && data.time < 10000 && data.clicks === 0) {
      negativeReasons.push('single_quick_bounce');
    }

    // Determine final label
    if (reasons.length >= 2) {
      // Multiple positive signals
      return {
        label: 1,
        confidence: this.calculateConfidence(data, false, reasons.length),
        reason: reasons.join(', ')
      };
    }

    if (negativeReasons.length >= 2) {
      // Multiple negative signals
      return {
        label: 0,
        confidence: this.calculateConfidence(data, false, negativeReasons.length),
        reason: negativeReasons.join(', ')
      };
    }

    // Ambiguous - not enough signals
    return {
      label: null,
      confidence: 0,
      reason: 'insufficient_data'
    };
  }

  /**
   * Calculate confidence score for label
   * @param {Object} data - Activity data
   * @param {boolean} explicitSignal - Has explicit user signal
   * @param {number} signalCount - Number of signals detected
   * @returns {number} Confidence (0-1)
   */
  static calculateConfidence(data, explicitSignal, signalCount = 0) {
    if (explicitSignal) return 1.0;

    // Base confidence on data quality and signal count
    const dataPoints = [
      data.visitCount > 0,
      data.time > 0,
      data.clicks > 0,
      data.sessionDurations?.length > 0,
      data.returnVisits > 0
    ].filter(Boolean).length;

    const dataQuality = dataPoints / 5;
    const signalStrength = Math.min(signalCount / 3, 1);

    return Math.min((dataQuality * 0.5 + signalStrength * 0.5), 0.9);
  }

  /**
   * Calculate engagement score
   * @param {Object} data - Activity data
   * @returns {number} Engagement score
   */
  static calculateEngagement(data) {
    return (
      (data.forms || 0) * 100 +
      (data.clicks || 0) * 10 +
      (data.scroll || 0) * 0.5 +
      ((data.time || 0) / 1000) * 0.1
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
    return (data.bounced || 0) / total;
  }

  /**
   * Normalize URL for comparison
   * @param {string} url - The URL
   * @returns {string} Normalized URL
   */
  static normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      // Remove query params and hash for comparison
      return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
    } catch {
      return url;
    }
  }

  /**
   * Get label distribution statistics
   * @param {Map} labels - Label map
   * @returns {Object} Distribution stats
   */
  static getLabelDistribution(labels) {
    const stats = {
      positive: 0,
      negative: 0,
      unlabeled: 0,
      total: labels.size,
      avgConfidence: 0
    };

    let totalConfidence = 0;
    let labeledCount = 0;

    for (const labelInfo of labels.values()) {
      if (labelInfo.label === 1) {
        stats.positive++;
        totalConfidence += labelInfo.confidence;
        labeledCount++;
      } else if (labelInfo.label === 0) {
        stats.negative++;
        totalConfidence += labelInfo.confidence;
        labeledCount++;
      } else {
        stats.unlabeled++;
      }
    }

    stats.avgConfidence = labeledCount > 0
      ? (totalConfidence / labeledCount).toFixed(2)
      : 0;

    stats.positiveRate = stats.total > 0
      ? ((stats.positive / stats.total) * 100).toFixed(1) + '%'
      : '0%';

    stats.negativeRate = stats.total > 0
      ? ((stats.negative / stats.total) * 100).toFixed(1) + '%'
      : '0%';

    return stats;
  }

  /**
   * Filter labels to get only labeled examples
   * @param {Map} labels - Label map
   * @param {number} minConfidence - Minimum confidence threshold
   * @returns {Map} Filtered labels
   */
  static filterLabeled(labels, minConfidence = 0) {
    const filtered = new Map();

    for (const [url, labelInfo] of labels) {
      if (labelInfo.label !== null && labelInfo.confidence >= minConfidence) {
        filtered.set(url, labelInfo);
      }
    }

    return filtered;
  }

  /**
   * Balance dataset by undersampling majority class
   * @param {Map} labels - Label map
   * @returns {Map} Balanced labels
   */
  static balanceDataset(labels) {
    const positive = [];
    const negative = [];

    for (const [url, labelInfo] of labels) {
      if (labelInfo.label === 1) {
        positive.push([url, labelInfo]);
      } else if (labelInfo.label === 0) {
        negative.push([url, labelInfo]);
      }
    }

    const minCount = Math.min(positive.length, negative.length);

    if (minCount === 0) {
      console.warn('[ML] Cannot balance dataset - one class is empty');
      return labels;
    }

    // Shuffle and sample
    const shuffled = {
      positive: this.shuffle(positive).slice(0, minCount),
      negative: this.shuffle(negative).slice(0, minCount)
    };

    const balanced = new Map([
      ...shuffled.positive,
      ...shuffled.negative
    ]);

    console.log('[ML] Dataset balanced:', {
      original: { positive: positive.length, negative: negative.length },
      balanced: { positive: minCount, negative: minCount }
    });

    return balanced;
  }

  /**
   * Shuffle array
   * @param {Array} array - Array to shuffle
   * @returns {Array} Shuffled array
   */
  static shuffle(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
