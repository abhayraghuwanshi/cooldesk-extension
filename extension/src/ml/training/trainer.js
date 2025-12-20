/**
 * Model Trainer - Main training pipeline for auto-save model
 * Orchestrates data preparation, training, and evaluation
 */

import { ML_CONFIG } from '../config.js';
import { AutoSaveModel } from '../models/autoSaveModel.js';
import { DataPreparation } from './dataPreparation.js';
import { prepareEnhancedTrainingData } from './historyDataPreparation.js';

/**
 * Model Trainer Class
 * Handles end-to-end model training workflow
 */
export class ModelTrainer {
  /**
   * Train the auto-save model
   * @param {Object} options - Training options
   * @returns {Promise<Object>} Training results
   */
  static async trainAutoSaveModel(options = {}) {
    console.log('[ML] ========================================');
    console.log('[ML] Starting auto-save model training...');
    console.log('[ML] ========================================');

    const startTime = Date.now();

    try {
      // 1. Check if ML is enabled
      const settings = await chrome.storage.local.get([
        ML_CONFIG.storage.enabled,
        ML_CONFIG.storage.autoSaveEnabled
      ]);

      if (settings[ML_CONFIG.storage.enabled] === false) {
        return {
          success: false,
          reason: 'ml_disabled',
          message: 'ML features are disabled in settings'
        };
      }

      if (settings[ML_CONFIG.storage.autoSaveEnabled] === false) {
        return {
          success: false,
          reason: 'autosave_disabled',
          message: 'Auto-save feature is disabled in settings'
        };
      }

      // 2. Prepare training data
      console.log('[ML] Step 1: Preparing training data...');

      // Use enhanced data preparation if history is enabled
      const useHistory = ML_CONFIG.training.useHistory !== false && options.useHistory !== false;

      let dataResult;
      if (useHistory) {
        console.log('[ML] Using enhanced data preparation with browser history...');
        dataResult = await prepareEnhancedTrainingData({
          useHistory: true,
          maxHistoryItems: ML_CONFIG.training.maxHistoryItems || 10000,
          minExamples: ML_CONFIG.autoSave.minExamples,
          testSplitRatio: 0.2,
          ...options.dataOptions
        });

        // Convert to DataPreparation format
        if (dataResult.success) {
          const { trainExamples, testExamples } = dataResult;

          dataResult = {
            success: true,
            train: {
              features: trainExamples.map(ex => ex.features),
              labels: trainExamples.map(ex => ex.label)
            },
            test: {
              features: testExamples.map(ex => ex.features),
              labels: testExamples.map(ex => ex.label)
            },
            stats: {
              numFeatures: trainExamples[0]?.features.length || 0,
              totalExamples: trainExamples.length + testExamples.length,
              positiveExamples: trainExamples.filter(ex => ex.label === 1).length +
                testExamples.filter(ex => ex.label === 1).length,
              negativeExamples: trainExamples.filter(ex => ex.label === 0).length +
                testExamples.filter(ex => ex.label === 0).length,
              categorySummary: dataResult.categorySummary,
              historyUsed: true,
              historyItems: dataResult.historyItems
            }
          };
        }
      } else {
        console.log('[ML] Using standard data preparation (no history)...');
        dataResult = await DataPreparation.prepareTrainingData({
          minExamples: ML_CONFIG.autoSave.minExamples,
          balanceDataset: true,
          trainTestSplit: 0.8,
          minConfidence: 0.5,
          ...options.dataOptions
        });
      }

      if (!dataResult.success) {
        console.warn('[ML] Data preparation failed:', dataResult.message || dataResult.error);
        return {
          success: false,
          reason: dataResult.reason || dataResult.error,
          message: dataResult.message
        };
      }

      const { train, test, stats } = dataResult;

      console.log('[ML] Step 1 ✅ Data prepared:', {
        trainExamples: train.labels.length,
        testExamples: test.labels.length,
        features: stats.numFeatures,
        historyUsed: stats.historyUsed || false,
        historyItems: stats.historyItems || 0
      });

      // 3. Initialize and train model
      console.log('[ML] Step 2: Training model...');
      console.log('[ML] Training auto-save model on', train.labels.length, 'examples,', stats.numFeatures, 'features');

      const model = new AutoSaveModel();
      console.log('[ML] Model initialized, starting training...');

      const trainingResult = await model.train(
        train.features,
        train.labels,
        {
          epochs: ML_CONFIG.autoSave.trainingEpochs,
          learningRate: ML_CONFIG.autoSave.learningRate,
          batchSize: ML_CONFIG.performance.batchSize,
          verbose: true,
          ...options.trainingOptions
        }
      );

      console.log('[ML] Training completed, result:', trainingResult);

      if (!trainingResult.success) {
        return {
          success: false,
          reason: 'training_failed',
          message: 'Model training failed'
        };
      }

      console.log('[ML] Step 2 ✅ Model trained');

      // 4. Evaluate on test set
      console.log('[ML] Step 3: Evaluating model...');

      const evaluation = this.evaluateModel(model, test.features, test.labels);

      console.log('[ML] Step 3 ✅ Evaluation complete:', {
        accuracy: (evaluation.accuracy * 100).toFixed(1) + '%',
        precision: (evaluation.precision * 100).toFixed(1) + '%',
        recall: (evaluation.recall * 100).toFixed(1) + '%'
      });

      // 5. Save model
      console.log('[ML] Step 4: Saving model...');

      const saved = await model.save();

      if (!saved) {
        console.warn('[ML] Failed to save model');
      } else {
        console.log('[ML] Step 4 ✅ Model saved');
      }

      // 6. Update training timestamp
      await chrome.storage.local.set({
        [ML_CONFIG.storage.lastTraining]: Date.now()
      });

      // 7. Store training metrics
      await this.saveTrainingMetrics({
        timestamp: Date.now(),
        dataStats: stats,
        trainingResult,
        evaluation,
        featureImportance: model.getFeatureImportance().slice(0, 10) // Top 10
      });

      const totalTime = Date.now() - startTime;

      console.log('[ML] ========================================');
      console.log('[ML] ✅ Training complete!');
      console.log('[ML] Total time:', totalTime, 'ms');
      console.log('[ML] Accuracy:', (evaluation.accuracy * 100).toFixed(1) + '%');
      console.log('[ML] ========================================');

      return {
        success: true,
        examples: train.labels.length + test.labels.length,
        trainExamples: train.labels.length,
        testExamples: test.labels.length,
        trainingTime: totalTime,
        accuracy: evaluation.accuracy,
        precision: evaluation.precision,
        recall: evaluation.recall,
        f1Score: evaluation.f1Score,
        stats,
        evaluation
      };

    } catch (error) {
      console.error('[ML] Training failed with error:', error);
      console.error('[ML] Error stack:', error.stack);

      return {
        success: false,
        error: error.message,
        stack: error.stack
      };
    }
  }

  /**
   * Evaluate model on test data
   * @param {AutoSaveModel} model - Trained model
   * @param {number[][]} testFeatures - Test features
   * @param {number[]} testLabels - Test labels
   * @returns {Object} Evaluation metrics
   */
  static evaluateModel(model, testFeatures, testLabels) {
    let truePositives = 0;
    let trueNegatives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    const predictions = [];

    for (let i = 0; i < testFeatures.length; i++) {
      const features = testFeatures[i];
      const actualLabel = testLabels[i];

      const probability = model.predictProbability(features);
      const predictedLabel = model.shouldAutoSave(features) ? 1 : 0;

      predictions.push({
        probability,
        predicted: predictedLabel,
        actual: actualLabel
      });

      if (predictedLabel === 1 && actualLabel === 1) {
        truePositives++;
      } else if (predictedLabel === 0 && actualLabel === 0) {
        trueNegatives++;
      } else if (predictedLabel === 1 && actualLabel === 0) {
        falsePositives++;
      } else if (predictedLabel === 0 && actualLabel === 1) {
        falseNegatives++;
      }
    }

    const total = testFeatures.length;
    const accuracy = (truePositives + trueNegatives) / total;
    const precision = truePositives / (truePositives + falsePositives) || 0;
    const recall = truePositives / (truePositives + falseNegatives) || 0;
    const f1Score = 2 * (precision * recall) / (precision + recall) || 0;

    return {
      accuracy,
      precision,
      recall,
      f1Score,
      confusionMatrix: {
        truePositives,
        trueNegatives,
        falsePositives,
        falseNegatives
      },
      total,
      predictions
    };
  }

  /**
   * Save training metrics to storage
   * @param {Object} metrics - Training metrics
   */
  static async saveTrainingMetrics(metrics) {
    try {
      // Get existing metrics
      const result = await chrome.storage.local.get([ML_CONFIG.storage.metrics]);
      const existingMetrics = result[ML_CONFIG.storage.metrics] || { history: [] };

      // Add new metrics
      existingMetrics.history.push(metrics);
      existingMetrics.latest = metrics;

      // Keep only last 10 training sessions
      if (existingMetrics.history.length > 10) {
        existingMetrics.history = existingMetrics.history.slice(-10);
      }

      await chrome.storage.local.set({
        [ML_CONFIG.storage.metrics]: existingMetrics
      });

      console.log('[ML] Training metrics saved');
    } catch (error) {
      console.error('[ML] Failed to save training metrics:', error);
    }
  }

  /**
   * Get training metrics from storage
   * @returns {Promise<Object>} Training metrics
   */
  static async getTrainingMetrics() {
    try {
      const result = await chrome.storage.local.get([ML_CONFIG.storage.metrics]);
      return result[ML_CONFIG.storage.metrics] || { history: [], latest: null };
    } catch (error) {
      console.error('[ML] Failed to get training metrics:', error);
      return { history: [], latest: null };
    }
  }

  /**
   * Check if model needs retraining
   * @returns {Promise<boolean>} True if should retrain
   */
  static async shouldRetrain() {
    try {
      const result = await chrome.storage.local.get([
        ML_CONFIG.storage.lastTraining
      ]);

      const lastTraining = result[ML_CONFIG.storage.lastTraining];

      if (!lastTraining) {
        console.log('[ML] No previous training found, should train');
        return true;
      }

      const timeSinceTraining = Date.now() - lastTraining;
      const minInterval = ML_CONFIG.training.minTimeBetweenTraining;

      if (timeSinceTraining < minInterval) {
        console.log('[ML] Too soon to retrain:', {
          hoursSince: (timeSinceTraining / (1000 * 60 * 60)).toFixed(1),
          minHours: (minInterval / (1000 * 60 * 60)).toFixed(1)
        });
        return false;
      }

      console.log('[ML] Enough time passed, can retrain');
      return true;

    } catch (error) {
      console.error('[ML] Error checking if should retrain:', error);
      return false;
    }
  }

  /**
   * Train model only if needed
   * @param {Object} options - Training options
   * @returns {Promise<Object>} Training results or skip reason
   */
  static async trainIfNeeded(options = {}) {
    const should = await this.shouldRetrain();

    if (!should) {
      return {
        success: false,
        skipped: true,
        reason: 'too_soon',
        message: 'Not enough time since last training'
      };
    }

    return this.trainAutoSaveModel(options);
  }
}
