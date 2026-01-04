/**
 * Enhanced Data Preparation with Browser History
 * Combines last year of browser history with existing activity tracking and predefined categories
 */

import categoryManager from '../../data/categories.js';
import { getAllActivity, listWorkspaces } from '../../db/index.js';
import { ML_CONFIG } from '../config.js';
import { FeatureExtractor } from '../features/featureExtractor.js';

/**
 * Fetch browser history from the last year
 * @param {number} maxResults - Maximum number of history items to fetch
 * @returns {Promise<Array>} History items
 */
async function fetchBrowserHistory(maxResults = 10000) {
  try {
    const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);

    const historyItems = await chrome.history.search({
      text: '',
      startTime: oneYearAgo,
      maxResults: maxResults
    });

    console.log(`[ML] Fetched ${historyItems.length} history items from last year`);
    return historyItems;
  } catch (error) {
    console.error('[ML] Failed to fetch browser history:', error);
    return [];
  }
}

/**
 * Enrich history items with visit details and time spent
 * @param {Array} historyItems - Raw history items
 * @returns {Promise<Array>} Enriched history items
 */
async function enrichHistoryWithVisits(historyItems) {
  const enrichedItems = [];

  for (const item of historyItems) {
    try {
      const visits = await chrome.history.getVisits({ url: item.url });

      // Calculate time spent estimation from visits
      let totalTimeSpent = 0;
      visits.sort((a, b) => a.visitTime - b.visitTime);

      for (let i = 0; i < visits.length - 1; i++) {
        const timeDiff = visits[i + 1].visitTime - visits[i].visitTime;
        // Only count if next visit was within 30 minutes (reasonable session)
        if (timeDiff < 30 * 60 * 1000) {
          totalTimeSpent += timeDiff;
        }
      }

      enrichedItems.push({
        url: item.url,
        title: item.title,
        visitCount: item.visitCount || visits.length,
        lastVisitTime: item.lastVisitTime,
        typedCount: item.typedCount || 0,
        visits: visits,
        estimatedTimeSpent: totalTimeSpent,
        // Engagement signals from visit patterns
        hasDirectVisits: visits.some(v => v.transition === 'typed' || v.transition === 'auto_bookmark'),
        hasBookmark: visits.some(v => v.transition === 'auto_bookmark'),
        isFrequentlyReturned: visits.length >= 5,
      });
    } catch (error) {
      console.debug(`[ML] Failed to get visits for ${item.url}:`, error.message);
      enrichedItems.push({
        url: item.url,
        title: item.title,
        visitCount: item.visitCount || 1,
        lastVisitTime: item.lastVisitTime,
        typedCount: item.typedCount || 0,
        visits: [],
        estimatedTimeSpent: 0,
        hasDirectVisits: false,
        hasBookmark: false,
        isFrequentlyReturned: false
      });
    }
  }

  return enrichedItems;
}

/**
 * Categorize history items using predefined categories
 * @param {Array} enrichedHistory - Enriched history items
 * @returns {Array} Categorized history items
 */
function categorizeHistory(enrichedHistory) {
  return enrichedHistory.map(item => {
    const category = categoryManager.categorizeUrl(item.url);
    return {
      ...item,
      category,
      isCategorized: category !== 'uncategorized'
    };
  });
}

/**
 * Merge history data with existing activity tracking data
 * @param {Array} categorizedHistory - Categorized history items
 * @param {Array} activityRecords - Existing activity tracking data
 * @returns {Array} Merged dataset
 */
function mergeWithActivityData(categorizedHistory, activityRecords) {
  // Safety check: ensure activityRecords is an array
  if (!Array.isArray(activityRecords)) {
    console.warn('[ML] activityRecords is not an array, using empty array');
    activityRecords = [];
  }

  const activityMap = new Map();

  // Index activity data by URL
  activityRecords.forEach(record => {
    activityMap.set(record.url, record);
  });

  return categorizedHistory.map(historyItem => {
    const activityData = activityMap.get(historyItem.url);

    if (activityData) {
      // Has both history and activity tracking data
      return {
        url: historyItem.url,
        title: historyItem.title || activityData.title,
        category: historyItem.category,
        isCategorized: historyItem.isCategorized,
        // Combine data from both sources
        visitCount: Math.max(historyItem.visitCount, activityData.visitCount || 0),
        timeSpent: Math.max(historyItem.estimatedTimeSpent, activityData.time || 0),
        clicks: activityData.clicks || 0,
        scroll: activityData.scroll || 0,
        forms: activityData.forms || 0,
        lastVisit: Math.max(historyItem.lastVisitTime, activityData.lastVisit || 0),
        hasDirectVisits: historyItem.hasDirectVisits,
        hasBookmark: historyItem.hasBookmark,
        isFrequentlyReturned: historyItem.isFrequentlyReturned,
        // Activity-specific data
        activityTracked: true,
        activityData: activityData
      };
    } else {
      // Only has history data
      return {
        url: historyItem.url,
        title: historyItem.title,
        category: historyItem.category,
        isCategorized: historyItem.isCategorized,
        visitCount: historyItem.visitCount,
        timeSpent: historyItem.estimatedTimeSpent,
        clicks: 0,
        scroll: 0,
        forms: 0,
        lastVisit: historyItem.lastVisitTime,
        hasDirectVisits: historyItem.hasDirectVisits,
        hasBookmark: historyItem.hasBookmark,
        isFrequentlyReturned: historyItem.isFrequentlyReturned,
        activityTracked: false,
        activityData: null
      };
    }
  });
}

/**
 * Generate labels using enhanced data (activity + history + categories)
 * @param {Array} mergedData - Merged dataset
 * @param {Map} savedUrls - URLs explicitly saved by user
 * @param {Set} removedUrls - URLs explicitly removed by user
 * @returns {Array} Labeled examples
 */
function generateEnhancedLabels(mergedData, savedUrls, removedUrls) {
  const labeled = [];

  for (const item of mergedData) {
    const isSaved = savedUrls.has(item.url);
    const isRemoved = removedUrls.has(item.url);

    // Get base label from explicit actions
    let label = null;
    let confidence = 0.5;
    let reason = 'unknown';

    if (isSaved) {
      label = 1;
      confidence = 1.0;
      reason = 'explicitly_saved';
    } else if (isRemoved) {
      label = 0;
      confidence = 1.0;
      reason = 'explicitly_removed';
    } else {
      // Implicit labeling based on engagement patterns and category
      const engagementScore = calculateEngagementScore(item);

      // Category boost: Categorized URLs are more likely to be valuable
      const categoryBoost = item.isCategorized ? 0.15 : 0;

      // Bookmark/direct visit boost: Strong signal of intent
      const intentBoost = (item.hasBookmark ? 0.2 : 0) + (item.hasDirectVisits ? 0.1 : 0);

      const finalScore = engagementScore + categoryBoost + intentBoost;

      if (finalScore >= ML_CONFIG.training.positiveThreshold) {
        label = 1;
        confidence = Math.min(finalScore, 0.9);
        reason = 'high_engagement_with_category';
      } else if (finalScore <= ML_CONFIG.training.negativeThreshold) {
        label = 0;
        confidence = Math.min(1 - finalScore, 0.9);
        reason = 'low_engagement';
      }
    }

    if (label !== null) {
      labeled.push({
        url: item.url,
        title: item.title,
        label,
        confidence,
        reason,
        category: item.category,
        data: item
      });
    }
  }

  console.log(`[ML] Generated ${labeled.length} labeled examples from ${mergedData.length} items`);
  console.log(`[ML] Label distribution:`, {
    positive: labeled.filter(l => l.label === 1).length,
    negative: labeled.filter(l => l.label === 0).length,
    byCate: categorizeByReason(labeled)
  });

  return labeled;
}

/**
 * Calculate engagement score from combined data
 * @param {Object} item - Merged data item
 * @returns {number} Engagement score (0-1)
 */
function calculateEngagementScore(item) {
  let score = 0;

  // Time spent (0-0.3)
  if (item.timeSpent > 300000) score += 0.3; // >5 minutes
  else if (item.timeSpent > 60000) score += 0.2; // >1 minute
  else if (item.timeSpent > 10000) score += 0.1; // >10 seconds

  // Visit frequency (0-0.3)
  if (item.visitCount >= 10) score += 0.3;
  else if (item.visitCount >= 5) score += 0.2;
  else if (item.visitCount >= 3) score += 0.1;

  // Interaction depth (0-0.2)
  if (item.clicks > 10) score += 0.1;
  if (item.scroll > 50) score += 0.05;
  if (item.forms > 0) score += 0.05;

  // Return visits (0-0.2)
  if (item.isFrequentlyReturned) score += 0.2;

  return Math.min(score, 1.0);
}

/**
 * Categorize labeled examples by reason
 * @param {Array} labeled - Labeled examples
 * @returns {Object} Counts by reason
 */
function categorizeByReason(labeled) {
  const counts = {};
  labeled.forEach(item => {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
  });
  return counts;
}

/**
 * Prepare enhanced training dataset using history + activity + categories
 * @param {Object} options - Preparation options
 * @returns {Promise<Object>} Training dataset
 */
export async function prepareEnhancedTrainingData(options = {}) {
  const {
    useHistory = true,
    maxHistoryItems = 10000,
    minExamples = ML_CONFIG.autoSave.minExamples,
    testSplitRatio = 0.2
  } = options;

  console.log('[ML] Starting enhanced data preparation...');
  console.log('[ML] Options:', { useHistory, maxHistoryItems, minExamples });

  try {
    // Step 1: Load existing activity data (using statically imported function)
    const activityRecords = await getAllActivity();
    console.log(`[ML] Loaded ${Array.isArray(activityRecords) ? activityRecords.length : 0} activity records`);

    // Step 2: Fetch and enrich browser history
    let mergedData = [];

    if (useHistory) {
      console.log('[ML] Fetching browser history...');
      const historyItems = await fetchBrowserHistory(maxHistoryItems);

      console.log('[ML] Enriching history with visit details...');
      const enrichedHistory = await enrichHistoryWithVisits(historyItems);

      console.log('[ML] Categorizing history...');
      const categorizedHistory = categorizeHistory(enrichedHistory);

      console.log('[ML] Merging with activity data...');
      mergedData = mergeWithActivityData(categorizedHistory, activityRecords);
    } else {
      // Just use activity data with categorization
      const safeActivityRecords = Array.isArray(activityRecords) ? activityRecords : [];
      mergedData = categorizeHistory(safeActivityRecords.map(record => ({
        url: record.url,
        title: record.title,
        visitCount: record.visitCount || 1,
        estimatedTimeSpent: record.time || 0,
        ...record
      })));
    }

    console.log(`[ML] Total merged dataset: ${mergedData.length} items`);

    // Step 3: Get saved and removed URLs (using statically imported function)
    const workspacesResult = await listWorkspaces();
    const workspaces = Array.isArray(workspacesResult)
      ? workspacesResult
      : (workspacesResult?.workspaces || []);

    const savedUrls = new Set();
    const removedUrls = new Set();

    for (const workspace of workspaces) {
      if (workspace.urls) {
        workspace.urls.forEach(url => savedUrls.add(url));
      }
    }

    // Removed URL tracking relies on engagement patterns for now

    // Step 4: Generate enhanced labels
    const labeledExamples = generateEnhancedLabels(mergedData, savedUrls, removedUrls);

    if (labeledExamples.length < minExamples) {
      return {
        success: false,
        reason: 'insufficient_data',
        message: `Need at least ${minExamples} labeled examples, got ${labeledExamples.length}`,
        available: labeledExamples.length
      };
    }

    // Step 5: Extract features
    console.log('[ML] Extracting features...');
    const examples = labeledExamples.map(item => {
      const features = FeatureExtractor.extractUrlFeatures(
        item.url,
        item.data.activityData || {
          time: item.data.timeSpent,
          clicks: item.data.clicks,
          scroll: item.data.scroll,
          forms: item.data.forms,
          visitCount: item.data.visitCount
        },
        {},
        { includeCategory: true, category: item.category }
      );

      // Normalize features into array format for ML model
      const normalizedFeatures = FeatureExtractor.normalizeFeatures(features);

      return {
        url: item.url,
        features: normalizedFeatures,
        label: item.label,
        confidence: item.confidence,
        reason: item.reason,
        category: item.category
      };
    });

    // Step 6: Balance dataset
    const positive = examples.filter(ex => ex.label === 1);
    const negative = examples.filter(ex => ex.label === 0);

    console.log(`[ML] Dataset balance: ${positive.length} positive, ${negative.length} negative`);

    // Undersample majority class to balance
    let balanced = [];
    if (positive.length > negative.length * 2) {
      // Too many positives, undersample
      const sampledPositive = positive.sort(() => Math.random() - 0.5).slice(0, negative.length * 2);
      balanced = [...sampledPositive, ...negative];
    } else if (negative.length > positive.length * 2) {
      // Too many negatives, undersample
      const sampledNegative = negative.sort(() => Math.random() - 0.5).slice(0, positive.length * 2);
      balanced = [...positive, ...sampledNegative];
    } else {
      balanced = examples;
    }

    // Shuffle
    balanced.sort(() => Math.random() - 0.5);

    // Step 7: Split into train/test
    const splitIndex = Math.floor(balanced.length * (1 - testSplitRatio));
    const trainExamples = balanced.slice(0, splitIndex);
    const testExamples = balanced.slice(splitIndex);

    console.log(`[ML] ✅ Enhanced data preparation complete`);
    console.log(`[ML] Training: ${trainExamples.length}, Test: ${testExamples.length}`);

    return {
      success: true,
      trainExamples,
      testExamples,
      totalExamples: balanced.length,
      categorySummary: generateCategorySummary(examples),
      historyUsed: useHistory,
      historyItems: useHistory ? mergedData.length : 0
    };

  } catch (error) {
    console.error('[ML] Enhanced data preparation failed:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to prepare enhanced training data'
    };
  }
}

/**
 * Generate summary of categories in dataset
 * @param {Array} examples - Training examples
 * @returns {Object} Category summary
 */
function generateCategorySummary(examples) {
  const summary = {};
  examples.forEach(ex => {
    if (!summary[ex.category]) {
      summary[ex.category] = { total: 0, positive: 0, negative: 0 };
    }
    summary[ex.category].total++;
    if (ex.label === 1) summary[ex.category].positive++;
    else summary[ex.category].negative++;
  });
  return summary;
}
