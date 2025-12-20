/**
 * ML Configuration - Adjustable parameters for ML models
 */

export const ML_CONFIG = {
  // Auto-save model settings
  autoSave: {
    threshold: 0.7,          // Prediction threshold (0.5-0.95)
    minVisits: 3,            // Min visits before prediction
    minTimeSpent: 30000,     // Min time (ms) before prediction
    trainingEpochs: 100,     // Training iterations
    learningRate: 0.01,      // Learning rate for gradient descent
    minExamples: 10,         // Minimum training examples required
  },

  // Categorization model settings
  categorization: {
    similarityThreshold: 0.7, // Min similarity for auto-categorize (0-1)
    minWorkspaceUrls: 3,      // Min URLs before embedding workspace
    embeddingModel: 'Xenova/all-MiniLM-L6-v2', // Transformers.js model
    embeddingDimension: 384,  // Output dimension
    cacheTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days
  },

  // Training schedule
  training: {
    scheduleInterval: 24 * 60 * 60 * 1000, // 24 hours
    autoTrainOnStartup: true,
    startupDelay: 60000,      // Wait 1 minute after startup
    minTimeBetweenTraining: 12 * 60 * 60 * 1000, // 12 hours minimum
    positiveThreshold: 0.7,      // Score >= this = positive label (implicit)
    negativeThreshold: 0.3,      // Score <= this = negative label (implicit)
    useHistory: true,            // Use browser history for training
    maxHistoryItems: 10000,      // Max history items to fetch
  },

  // Feature extraction
  features: {
    numFeatures: 21,          // Total number of features
    timeScale: 1000,          // Convert ms to seconds
    engagementWeight: {
      forms: 100,
      clicks: 10,
      scroll: 0.5,
      time: 0.1
    }
  },

  // Performance settings
  performance: {
    batchSize: 32,            // Training batch size
    maxCachedEmbeddings: 1000, // Max URL embeddings to cache
    embeddingBatchSize: 10,   // Process embeddings in batches
  },

  // Storage keys
  storage: {
    autoSaveModel: 'ml_autoSaveModel',
    categoryModel: 'ml_categoryModel',
    workspaceEmbeddings: 'ml_workspaceEmbeddings',
    urlEmbeddings: 'ml_urlEmbeddings',
    lastTraining: 'ml_lastTraining',
    userCorrections: 'ml_userCorrections',
    negativeSignals: 'ml_negativeSignals',
    metrics: 'ml_metrics',
    enabled: 'ml_enabled',
    autoSaveEnabled: 'ml_autoSave_enabled',
    categorizeEnabled: 'ml_categorize_enabled',
  }
};

// Feature names for debugging and visualization
export const FEATURE_NAMES = [
  'totalTimeSpent',
  'avgSessionDuration',
  'maxSessionDuration',
  'clickCount',
  'maxScrollDepth',
  'formSubmissions',
  'engagementScore',
  'visitCount',
  'returnVisits',
  'uniqueDaysVisited',
  'bounceRate',
  'avgVisitHour',
  'visitHourVariance',
  'hoursSinceLastVisit',
  'hoursSinceFirstVisit',
  'pageType',
  'explicitlySaved',
  'explicitlyRemoved',
  'openedFromSaved',
  'engagementPerVisit',
  'timePerVisit'
];
