/**
 * Data Preparation - Prepare training data from activity logs and labels
 */

import { getAllActivity } from '../../db/index.js';
import { FeatureExtractor } from '../features/featureExtractor.js';
import { LabelGenerator } from './labelGenerator.js';

/**
 * Data Preparation Class
 * Handles data collection, feature extraction, and train/test splitting
 */
export class DataPreparation {
  /**
   * Prepare complete training dataset
   * @param {Object} options - Preparation options
   * @returns {Promise<Object>} Prepared dataset
   */
  static async prepareTrainingData(options = {}) {
    const {
      minExamples = 10,
      balanceDataset = true,
      trainTestSplit = 0.8,
      minConfidence = 0.5
    } = options;

    console.log('[ML] Preparing training data...');

    try {
      // 1. Load activity data from database
      const activityResult = await getAllActivity({ limit: 2000 });

      if (!activityResult.success || !activityResult.data) {
        throw new Error('Failed to load activity data');
      }

      const activityArray = activityResult.data;
      console.log(`[ML] Loaded ${activityArray.length} activity records from database`);

      // Convert to keyed object
      const activityData = {};
      for (const row of activityArray) {
        if (row.url) {
          activityData[row.url] = row;
        }
      }

      console.log(`[ML] Activity data converted: ${Object.keys(activityData).length} unique URLs`);

      // 2. Generate labels
      const labels = await LabelGenerator.generateLabels(activityData);
      console.log(`[ML] Generated ${labels.size} labels`);

      // Filter to only labeled data
      const labeledLabels = LabelGenerator.filterLabeled(labels, minConfidence);
      console.log(`[ML] Filtered to ${labeledLabels.size} labeled examples (confidence >= ${minConfidence})`);

      if (labeledLabels.size < minExamples) {
        return {
          success: false,
          error: 'insufficient_data',
          message: `Need at least ${minExamples} labeled examples, got ${labeledLabels.size}`
        };
      }

      // 3. Balance dataset if requested
      const finalLabels = balanceDataset
        ? LabelGenerator.balanceDataset(labeledLabels)
        : labeledLabels;

      console.log(`[ML] Final dataset size: ${finalLabels.size}`);

      // 4. Extract features for all labeled URLs
      const examples = [];

      for (const [url, labelInfo] of finalLabels) {
        const urlActivityData = activityData[url];

        if (!urlActivityData) {
          console.warn(`[ML] No activity data for labeled URL: ${url}`);
          continue;
        }

        try {
          const features = FeatureExtractor.extractAndNormalize(
            url,
            urlActivityData,
            {},
            {
              explicitlySaved: labelInfo.reason?.includes('saved'),
              explicitlyRemoved: labelInfo.reason?.includes('removed')
            }
          );

          examples.push({
            url,
            features,
            label: labelInfo.label,
            confidence: labelInfo.confidence,
            reason: labelInfo.reason
          });

        } catch (error) {
          console.error(`[ML] Failed to extract features for ${url}:`, error);
        }
      }

      console.log(`[ML] Extracted features for ${examples.length} examples`);

      if (examples.length < minExamples) {
        return {
          success: false,
          error: 'feature_extraction_failed',
          message: `Only ${examples.length} examples after feature extraction`
        };
      }

      // 5. Shuffle examples
      const shuffled = this.shuffle(examples);

      // 6. Split into train/test
      const splitIndex = Math.floor(shuffled.length * trainTestSplit);
      const trainExamples = shuffled.slice(0, splitIndex);
      const testExamples = shuffled.slice(splitIndex);

      // 7. Separate features and labels
      const trainData = {
        features: trainExamples.map(e => e.features),
        labels: trainExamples.map(e => e.label),
        urls: trainExamples.map(e => e.url)
      };

      const testData = {
        features: testExamples.map(e => e.features),
        labels: testExamples.map(e => e.label),
        urls: testExamples.map(e => e.url)
      };

      // 8. Calculate statistics
      const stats = this.calculateDatasetStats(trainData, testData);

      console.log('[ML] ✅ Dataset prepared:', stats);

      return {
        success: true,
        train: trainData,
        test: testData,
        stats,
        examples: shuffled
      };

    } catch (error) {
      console.error('[ML] Data preparation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate dataset statistics
   * @param {Object} trainData - Training data
   * @param {Object} testData - Test data
   * @returns {Object} Statistics
   */
  static calculateDatasetStats(trainData, testData) {
    const trainPositive = trainData.labels.filter(l => l === 1).length;
    const trainNegative = trainData.labels.filter(l => l === 0).length;
    const testPositive = testData.labels.filter(l => l === 1).length;
    const testNegative = testData.labels.filter(l => l === 0).length;

    return {
      total: trainData.labels.length + testData.labels.length,
      train: {
        total: trainData.labels.length,
        positive: trainPositive,
        negative: trainNegative,
        positiveRate: ((trainPositive / trainData.labels.length) * 100).toFixed(1) + '%'
      },
      test: {
        total: testData.labels.length,
        positive: testPositive,
        negative: testNegative,
        positiveRate: ((testPositive / testData.labels.length) * 100).toFixed(1) + '%'
      },
      numFeatures: trainData.features[0]?.length || 0
    };
  }

  /**
   * Shuffle array
   * @param {Array} array - Array to shuffle
   * @returns {Array} Shuffled copy
   */
  static shuffle(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Create k-fold cross-validation splits
   * @param {Object[]} examples - Training examples
   * @param {number} k - Number of folds
   * @returns {Array} Array of {train, test} splits
   */
  static createKFolds(examples, k = 5) {
    const shuffled = this.shuffle(examples);
    const foldSize = Math.floor(shuffled.length / k);
    const folds = [];

    for (let i = 0; i < k; i++) {
      const testStart = i * foldSize;
      const testEnd = i === k - 1 ? shuffled.length : (i + 1) * foldSize;

      const test = shuffled.slice(testStart, testEnd);
      const train = [
        ...shuffled.slice(0, testStart),
        ...shuffled.slice(testEnd)
      ];

      folds.push({
        fold: i + 1,
        train: {
          features: train.map(e => e.features),
          labels: train.map(e => e.label)
        },
        test: {
          features: test.map(e => e.features),
          labels: test.map(e => e.label)
        }
      });
    }

    return folds;
  }

  /**
   * Augment dataset with synthetic examples (future enhancement)
   * @param {Object[]} examples - Training examples
   * @param {number} augmentFactor - How many synthetic examples per real example
   * @returns {Object[]} Augmented examples
   */
  static augmentDataset(examples, augmentFactor = 0.5) {
    // Future: Add noise, interpolate between examples, etc.
    return examples; // Placeholder
  }
}
