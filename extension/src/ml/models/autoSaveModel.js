/**
 * Auto-Save Model - Lightweight logistic regression classifier
 * Predicts whether a URL should be auto-saved based on user behavior
 * No TensorFlow.js needed - pure JavaScript implementation for speed
 */

import { FEATURE_NAMES, ML_CONFIG } from '../config.js';

/**
 * Auto-Save Model Class
 * Binary classifier using logistic regression
 */
export class AutoSaveModel {
  constructor() {
    this.weights = null;
    this.bias = 0;
    this.threshold = ML_CONFIG.autoSave.threshold;
    this.trained = false;
    this.trainingHistory = [];
    this.version = '1.0.0';
  }

  /**
   * Train the model using gradient descent
   * @param {number[][]} features - Training features (normalized)
   * @param {number[]} labels - Training labels (0 or 1)
   * @param {Object} options - Training options
   * @returns {Object} Training results
   */
  async train(features, labels, options = {}) {
    const {
      epochs = ML_CONFIG.autoSave.trainingEpochs,
      learningRate = ML_CONFIG.autoSave.learningRate,
      batchSize = ML_CONFIG.performance.batchSize,
      verbose = true,
      timeoutMs = 300000 // 5 minute timeout
    } = options;

    // Validate inputs
    if (!features || !labels || features.length !== labels.length) {
      throw new Error('Invalid training data');
    }

    if (features.length === 0) {
      throw new Error('Empty training data');
    }

    const numFeatures = features[0].length;
    console.log(`[ML] Training auto-save model on ${features.length} examples, ${numFeatures} features`);

    // Initialize weights
    this.weights = new Array(numFeatures).fill(0);
    this.bias = 0;
    this.trainingHistory = [];

    // Training loop
    const startTime = Date.now();

    for (let epoch = 0; epoch < epochs; epoch++) {
      let epochLoss = 0;
      let correct = 0;

      // Mini-batch training
      for (let i = 0; i < features.length; i += batchSize) {
        const batchEnd = Math.min(i + batchSize, features.length);
        const batchFeatures = features.slice(i, batchEnd);
        const batchLabels = labels.slice(i, batchEnd);

        // Compute gradients for batch
        const { loss, accuracy } = this.trainBatch(
          batchFeatures,
          batchLabels,
          learningRate
        );

        epochLoss += loss;
        correct += accuracy * batchFeatures.length;
      }

      // Calculate epoch metrics
      const avgLoss = epochLoss / features.length;
      const accuracy = correct / features.length;

      this.trainingHistory.push({
        epoch,
        loss: avgLoss,
        accuracy
      });

      // Log progress
      if (verbose && (epoch % 10 === 0 || epoch === epochs - 1)) {
        console.log(`[ML] Epoch ${epoch}/${epochs}: Loss=${avgLoss.toFixed(4)}, Accuracy=${(accuracy * 100).toFixed(1)}%`);
      }
    }

    const trainingTime = Date.now() - startTime;
    this.trained = true;

    const finalMetrics = this.trainingHistory[this.trainingHistory.length - 1];

    console.log('[ML] Training completed in', trainingTime, 'ms');

    return {
      success: true,
      epochs,
      finalLoss: finalMetrics.loss,
      finalAccuracy: finalMetrics.accuracy,
      trainingTime,
      numFeatures: this.weights.length
    };
  }

  /**
   * Train on a single batch
   * @param {number[][]} batchFeatures - Batch features
   * @param {number[]} batchLabels - Batch labels
   * @param {number} learningRate - Learning rate
   * @returns {Object} Batch metrics
   */
  trainBatch(batchFeatures, batchLabels, learningRate) {
    let batchLoss = 0;
    let correct = 0;

    const gradientWeights = new Array(this.weights.length).fill(0);
    let gradientBias = 0;

    // Compute gradients
    for (let i = 0; i < batchFeatures.length; i++) {
      const x = batchFeatures[i];
      const y = batchLabels[i];

      // Forward pass
      const prediction = this.sigmoid(this.computeScore(x));
      const error = prediction - y;

      // Loss (binary cross-entropy)
      const loss = -y * Math.log(prediction + 1e-7) - (1 - y) * Math.log(1 - prediction + 1e-7);
      batchLoss += loss;

      // Accuracy
      if ((prediction >= 0.5 && y === 1) || (prediction < 0.5 && y === 0)) {
        correct++;
      }

      // Accumulate gradients
      for (let j = 0; j < x.length; j++) {
        gradientWeights[j] += error * x[j];
      }
      gradientBias += error;
    }

    // Update weights (average gradients)
    const batchSize = batchFeatures.length;
    for (let j = 0; j < this.weights.length; j++) {
      this.weights[j] -= learningRate * (gradientWeights[j] / batchSize);
    }
    this.bias -= learningRate * (gradientBias / batchSize);

    return {
      loss: batchLoss / batchSize,
      accuracy: correct / batchSize
    };
  }

  /**
   * Compute raw score for features
   * @param {number[]} features - Feature vector
   * @returns {number} Raw score
   */
  computeScore(features) {
    if (!this.weights) {
      throw new Error('Model not trained');
    }

    let score = this.bias;
    for (let i = 0; i < features.length; i++) {
      score += this.weights[i] * features[i];
    }

    return score;
  }

  /**
   * Predict probability for features
   * @param {number[]} features - Feature vector (normalized)
   * @returns {number} Probability (0-1)
   */
  predictProbability(features) {
    if (!this.trained) {
      throw new Error('Model not trained');
    }

    const score = this.computeScore(features);
    return this.sigmoid(score);
  }

  /**
   * Predict class for features
   * @param {number[]} features - Feature vector (normalized)
   * @returns {boolean} Should auto-save
   */
  shouldAutoSave(features) {
    const probability = this.predictProbability(features);
    return probability > this.threshold;
  }

  /**
   * Batch predictions
   * @param {number[][]} featuresArray - Array of feature vectors
   * @returns {Object[]} Array of {probability, shouldSave, confidence}
   */
  predictBatch(featuresArray) {
    return featuresArray.map(features => {
      const probability = this.predictProbability(features);
      const shouldSave = probability > this.threshold;
      const confidence = Math.abs(probability - 0.5) * 2; // 0 = uncertain, 1 = certain

      return {
        probability,
        shouldSave,
        confidence
      };
    });
  }

  /**
   * Sigmoid activation function
   * @param {number} x - Input value
   * @returns {number} Sigmoid output (0-1)
   */
  sigmoid(x) {
    // Clip to prevent overflow
    const clipped = Math.max(-500, Math.min(500, x));
    return 1 / (1 + Math.exp(-clipped));
  }

  /**
   * Get feature importance scores
   * @returns {Object[]} Array of {feature, weight, importance}
   */
  getFeatureImportance() {
    if (!this.weights) {
      return [];
    }

    return FEATURE_NAMES.map((name, i) => ({
      feature: name,
      weight: this.weights[i],
      importance: Math.abs(this.weights[i])
    }))
      .sort((a, b) => b.importance - a.importance);
  }

  /**
   * Serialize model to JSON
   * @returns {Object} Serialized model
   */
  toJSON() {
    return {
      weights: this.weights,
      bias: this.bias,
      threshold: this.threshold,
      trained: this.trained,
      trainingHistory: this.trainingHistory,
      version: this.version,
      timestamp: Date.now()
    };
  }

  /**
   * Deserialize model from JSON
   * @param {Object} data - Serialized model data
   */
  fromJSON(data) {
    this.weights = data.weights;
    this.bias = data.bias;
    this.threshold = data.threshold || ML_CONFIG.autoSave.threshold;
    this.trained = data.trained || false;
    this.trainingHistory = data.trainingHistory || [];
    this.version = data.version || '1.0.0';
  }

  /**
   * Save model to chrome.storage
   * @returns {Promise<boolean>} Success status
   */
  async save() {
    try {
      const data = this.toJSON();
      await chrome.storage.local.set({
        [ML_CONFIG.storage.autoSaveModel]: data
      });

      console.log('[ML] Model saved');
      return true;
    } catch (error) {
      console.error('[ML] Failed to save model:', error.message);
      return false;
    }
  }

  /**
   * Load model from chrome.storage
   * @returns {Promise<boolean>} Success status
   */
  async load() {
    try {
      const result = await chrome.storage.local.get([
        ML_CONFIG.storage.autoSaveModel
      ]);

      if (!result[ML_CONFIG.storage.autoSaveModel]) {
        return false;
      }

      this.fromJSON(result[ML_CONFIG.storage.autoSaveModel]);
      console.log('[ML] Model loaded');
      return true;
    } catch (error) {
      console.error('[ML] Failed to load model:', error.message);
      return false;
    }
  }

  /**
   * Get model status and stats
   * @returns {Object} Model status
   */
  getStatus() {
    return {
      trained: this.trained,
      hasWeights: !!this.weights,
      numFeatures: this.weights?.length || 0,
      threshold: this.threshold,
      version: this.version,
      trainingEpochs: this.trainingHistory.length
    };
  }

  /**
   * Reset the model
   */
  reset() {
    this.weights = null;
    this.bias = 0;
    this.trained = false;
    this.trainingHistory = [];
    console.log('[ML] Model reset');
  }
}
