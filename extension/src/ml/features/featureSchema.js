/**
 * Feature Schema - Definitions for ML features extracted from activity data
 */

import { ML_CONFIG, FEATURE_NAMES } from '../config.js';

/**
 * Feature definitions with metadata
 * Each feature has: name, type, normalization method, importance
 */
export const FEATURE_SCHEMA = [
  {
    name: 'totalTimeSpent',
    type: 'numeric',
    unit: 'milliseconds',
    normalize: (value) => Math.log1p(value / ML_CONFIG.features.timeScale),
    importance: 'high',
    description: 'Total time spent on URL across all sessions'
  },
  {
    name: 'avgSessionDuration',
    type: 'numeric',
    unit: 'milliseconds',
    normalize: (value) => Math.log1p(value / ML_CONFIG.features.timeScale),
    importance: 'high',
    description: 'Average duration of each session'
  },
  {
    name: 'maxSessionDuration',
    type: 'numeric',
    unit: 'milliseconds',
    normalize: (value) => Math.log1p(value / ML_CONFIG.features.timeScale),
    importance: 'medium',
    description: 'Longest single session duration'
  },
  {
    name: 'clickCount',
    type: 'numeric',
    unit: 'count',
    normalize: (value) => Math.log1p(value),
    importance: 'high',
    description: 'Total number of clicks'
  },
  {
    name: 'maxScrollDepth',
    type: 'numeric',
    unit: 'percentage',
    normalize: (value) => value / 100, // 0-1 scale
    importance: 'medium',
    description: 'Maximum scroll depth reached'
  },
  {
    name: 'formSubmissions',
    type: 'numeric',
    unit: 'count',
    normalize: (value) => Math.log1p(value),
    importance: 'high',
    description: 'Number of form submissions'
  },
  {
    name: 'engagementScore',
    type: 'numeric',
    unit: 'score',
    normalize: (value) => Math.min(value / 1000, 1), // Cap at 1
    importance: 'very_high',
    description: 'Weighted engagement score'
  },
  {
    name: 'visitCount',
    type: 'numeric',
    unit: 'count',
    normalize: (value) => Math.log1p(value),
    importance: 'high',
    description: 'Number of visits to this URL'
  },
  {
    name: 'returnVisits',
    type: 'numeric',
    unit: 'count',
    normalize: (value) => Math.log1p(value),
    importance: 'high',
    description: 'Number of return visits on different days'
  },
  {
    name: 'uniqueDaysVisited',
    type: 'numeric',
    unit: 'count',
    normalize: (value) => Math.log1p(value),
    importance: 'high',
    description: 'Number of unique days visited'
  },
  {
    name: 'bounceRate',
    type: 'numeric',
    unit: 'ratio',
    normalize: (value) => value, // Already 0-1
    importance: 'medium',
    description: 'Proportion of bounced sessions'
  },
  {
    name: 'avgVisitHour',
    type: 'numeric',
    unit: 'hour',
    normalize: (value) => value / 24, // 0-1 scale
    importance: 'low',
    description: 'Average hour of day when visited'
  },
  {
    name: 'visitHourVariance',
    type: 'numeric',
    unit: 'variance',
    normalize: (value) => value / 144, // Normalize by max variance
    importance: 'low',
    description: 'Variance in visit times'
  },
  {
    name: 'hoursSinceLastVisit',
    type: 'numeric',
    unit: 'hours',
    normalize: (value) => Math.min(value / 168, 1), // Cap at 1 week
    importance: 'medium',
    description: 'Hours since last visit'
  },
  {
    name: 'hoursSinceFirstVisit',
    type: 'numeric',
    unit: 'hours',
    normalize: (value) => Math.min(value / 720, 1), // Cap at 30 days
    importance: 'medium',
    description: 'Hours since first visit'
  },
  {
    name: 'pageType',
    type: 'categorical',
    unit: 'encoded',
    normalize: (value) => value / 8, // 0-1 scale (9 page types)
    importance: 'medium',
    description: 'Type of page (tool, docs, article, etc.)'
  },
  {
    name: 'explicitlySaved',
    type: 'boolean',
    unit: 'binary',
    normalize: (value) => value ? 1 : 0,
    importance: 'very_high',
    description: 'User explicitly saved this URL'
  },
  {
    name: 'explicitlyRemoved',
    type: 'boolean',
    unit: 'binary',
    normalize: (value) => value ? 1 : 0,
    importance: 'very_high',
    description: 'User explicitly removed this URL'
  },
  {
    name: 'openedFromSaved',
    type: 'numeric',
    unit: 'count',
    normalize: (value) => Math.log1p(value),
    importance: 'high',
    description: 'Times opened from saved items'
  },
  {
    name: 'engagementPerVisit',
    type: 'numeric',
    unit: 'ratio',
    normalize: (value) => value / 10, // Normalize
    importance: 'medium',
    description: 'Average engagement per visit'
  },
  {
    name: 'timePerVisit',
    type: 'numeric',
    unit: 'milliseconds',
    normalize: (value) => Math.log1p(value / ML_CONFIG.features.timeScale),
    importance: 'medium',
    description: 'Average time per visit'
  }
];

// Validate schema matches feature names
if (FEATURE_SCHEMA.length !== FEATURE_NAMES.length) {
  console.error('[ML] Feature schema length mismatch!', {
    schemaLength: FEATURE_SCHEMA.length,
    namesLength: FEATURE_NAMES.length
  });
}

// Create feature index map for fast lookup
export const FEATURE_INDEX = FEATURE_NAMES.reduce((acc, name, index) => {
  acc[name] = index;
  return acc;
}, {});

/**
 * Get feature metadata by name
 * @param {string} featureName - Name of the feature
 * @returns {Object|null} Feature metadata
 */
export function getFeatureMetadata(featureName) {
  return FEATURE_SCHEMA.find(f => f.name === featureName) || null;
}

/**
 * Validate feature vector
 * @param {number[]} features - Feature vector to validate
 * @returns {Object} Validation result
 */
export function validateFeatures(features) {
  if (!Array.isArray(features)) {
    return { valid: false, error: 'Features must be an array' };
  }

  if (features.length !== FEATURE_NAMES.length) {
    return {
      valid: false,
      error: `Expected ${FEATURE_NAMES.length} features, got ${features.length}`
    };
  }

  // Check for NaN or Infinity
  for (let i = 0; i < features.length; i++) {
    if (!Number.isFinite(features[i])) {
      return {
        valid: false,
        error: `Invalid value at index ${i} (${FEATURE_NAMES[i]}): ${features[i]}`
      };
    }
  }

  return { valid: true };
}

/**
 * Get feature importance weights
 * @returns {number[]} Importance weights (0-1 scale)
 */
export function getFeatureImportanceWeights() {
  const importanceMap = {
    'very_high': 1.0,
    'high': 0.8,
    'medium': 0.6,
    'low': 0.4
  };

  return FEATURE_SCHEMA.map(f => importanceMap[f.importance] || 0.5);
}
