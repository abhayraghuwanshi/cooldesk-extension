import { useEffect, useState } from 'react';

/**
 * ML Dashboard Component
 * Shows ML training status, auto-saved URLs, recommendations, and configuration
 */
export default function MLDashboard() {
  const [mlStatus, setMlStatus] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [autoSavedUrls, setAutoSavedUrls] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [urlRecommendations, setUrlRecommendations] = useState([]);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingDetails, setTrainingDetails] = useState(null);
  const [config, setConfig] = useState({
    enabled: true,
    threshold: 0.7,
    minVisits: 3,
    minTimeSpent: 30000,
  });

  // Load ML status and configuration
  useEffect(() => {
    loadMLData();
    const interval = setInterval(loadMLData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const loadMLData = async () => {
    try {
      // Get ML status from storage
      const result = await chrome.storage.local.get([
        'ml_autoSaveModel',
        'ml_lastTraining',
        'ml_metrics',
        'ml_enabled',
        'ml_config',
        'ml_initialized',
        'ml_embeddings_available'
      ]);

      setMlStatus({
        initialized: !!result.ml_initialized,
        modelTrained: !!result.ml_autoSaveModel,
        lastTraining: result.ml_lastTraining,
        embeddingsAvailable: result.ml_embeddings_available || false,
        enabled: result.ml_enabled !== false
      });

      setMetrics(result.ml_metrics || null);

      // Load config
      if (result.ml_config) {
        setConfig(prev => ({ ...prev, ...result.ml_config }));
      }

      // Get auto-saved URLs from "Smart Saved" workspace
      chrome.runtime.sendMessage({ type: 'ML_GET_AUTOSAVED_URLS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.debug('[ML Dashboard] Error getting auto-saved URLs:', chrome.runtime.lastError);
          return;
        }
        if (response?.success && response.urls) {
          setAutoSavedUrls(response.urls);
        }
      });

      // Get recommendations
      chrome.runtime.sendMessage({ type: 'ML_GET_RECOMMENDATIONS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.debug('[ML Dashboard] Error getting recommendations:', chrome.runtime.lastError);
          return;
        }
        if (response?.success && response.recommendations) {
          setRecommendations(response.recommendations);
        }
      });

      // Get training details
      chrome.runtime.sendMessage({ type: 'ML_GET_TRAINING_DETAILS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.debug('[ML Dashboard] Error getting training details:', chrome.runtime.lastError);
          return;
        }
        if (response?.success && response.details) {
          setTrainingDetails(response.details);
        }
      });

      // Get URL recommendations
      chrome.runtime.sendMessage({ type: 'ML_GET_URL_RECOMMENDATIONS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.debug('[ML Dashboard] Error getting URL recommendations:', chrome.runtime.lastError);
          return;
        }
        if (response?.success && response.recommendations) {
          setUrlRecommendations(response.recommendations);
        }
      });

    } catch (error) {
      console.error('[ML Dashboard] Error loading ML data:', error);
    }
  };

  // Trigger manual training
  const handleTrainNow = async () => {
    setIsTraining(true);

    // Add timeout to prevent button from getting stuck
    const timeout = setTimeout(() => {
      setIsTraining(false);
      alert('⏰ Training timed out. Please check console for errors and try again.');
    }, 60000); // 60 second timeout

    chrome.runtime.sendMessage({ type: 'ML_TRAIN_NOW' }, (response) => {
      clearTimeout(timeout);
      setIsTraining(false);

      if (chrome.runtime.lastError) {
        console.error('[ML Dashboard] Chrome runtime error:', chrome.runtime.lastError);
        alert(`❌ Training Failed\n\nChrome Error: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (response?.success) {
        alert(`✅ Training Complete!\n\nExamples: ${response.examples}\nAccuracy: ${(response.accuracy * 100).toFixed(1)}%`);
        loadMLData(); // Reload data
      } else {
        alert(`❌ Training Failed\n\n${response?.error || response?.reason || 'Unknown error'}`);
      }
    });
  };

  // Update configuration
  const handleConfigChange = async (key, value) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);

    // Save to storage
    await chrome.storage.local.set({
      ml_enabled: newConfig.enabled,
      ml_config: {
        threshold: newConfig.threshold,
        minVisits: newConfig.minVisits,
        minTimeSpent: newConfig.minTimeSpent
      }
    });

    // Update in-memory config
    chrome.runtime.sendMessage({
      type: 'ML_UPDATE_CONFIG',
      config: newConfig
    }, (response) => {
      if (response?.success) {
        console.log('[ML Dashboard] Config updated');
      }
    });
  };

  // Format timestamp
  const formatTime = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  // Format duration
  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  const cardStyle = {
    backgroundColor: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
    backdropFilter: 'blur(10px)',
    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.2))',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '16px',
    color: 'var(--text-primary, #fff)'
  };

  const buttonStyle = {
    backgroundColor: '#3b82f6',
    color: 'white',
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '14px',
    transition: 'all 0.2s'
  };

  const disabledButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#9ca3af',
    cursor: 'not-allowed'
  };

  return (
    <div className="section ml-dashboard" style={{ padding: '16px' }}>
      <h2 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary, #fff)' }}>
        🤖 ML Auto-Save Dashboard
      </h2>

      {/* Status Card */}
      <div style={cardStyle}>
        <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>Training Status</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '4px' }}>Engine Status</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: mlStatus?.initialized ? '#10b981' : '#ef4444' }}>
              {mlStatus?.initialized ? '✅ Initialized' : '❌ Not Initialized'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '4px' }}>Model Status</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: mlStatus?.modelTrained ? '#10b981' : '#f59e0b' }}>
              {mlStatus?.modelTrained ? '✅ Trained' : '⏳ Not Trained'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '4px' }}>Last Training</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
              {formatTime(mlStatus?.lastTraining)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '4px' }}>ML Features</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: mlStatus?.enabled ? '#10b981' : '#ef4444' }}>
              {mlStatus?.enabled ? '✅ Enabled' : '❌ Disabled'}
            </div>
          </div>
        </div>

        {/* Training Metrics */}
        {metrics && (
          <div style={{ padding: '16px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', marginBottom: '16px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '12px' }}>Model Performance</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>Accuracy</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  {(metrics.accuracy * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>Precision</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  {(metrics.precision * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>Recall</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  {(metrics.recall * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>F1 Score</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  {(metrics.f1Score * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>Examples</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  {metrics.trainingExamples || 0}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Training Button */}
        <button
          onClick={handleTrainNow}
          disabled={isTraining}
          style={isTraining ? disabledButtonStyle : buttonStyle}
        >
          {isTraining ? '⏳ Training...' : '🚀 Train Now'}
        </button>
      </div>

      {/* Training Data Summary */}
      {trainingDetails?.dataStats && (
        <div style={cardStyle}>
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>📊 Training Data Feed</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ padding: '12px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
              <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>Total Examples</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#3b82f6' }}>
                {trainingDetails.dataStats.totalExamples || 0}
              </div>
            </div>
            <div style={{ padding: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>Positive (Save)</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981' }}>
                {trainingDetails.dataStats.positiveExamples || 0}
              </div>
            </div>
            <div style={{ padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>Negative (Skip)</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ef4444' }}>
                {trainingDetails.dataStats.negativeExamples || 0}
              </div>
            </div>
            <div style={{ padding: '12px', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
              <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>History Items</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f59e0b' }}>
                {trainingDetails.dataStats.historyItems || 0}
              </div>
            </div>
          </div>

          {trainingDetails.dataStats.categorySummary && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '14px' }}>Category Distribution</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                {Object.entries(trainingDetails.dataStats.categorySummary)
                  .sort(([, a], [, b]) => (b.total || b) - (a.total || a))
                  .slice(0, 8)
                  .map(([category, data]) => {
                    // Handle both formats: object {total, positive, negative} or plain number
                    const total = typeof data === 'object' ? data.total : data;
                    const positive = typeof data === 'object' ? data.positive : null;
                    const negative = typeof data === 'object' ? data.negative : null;

                    return (
                      <div key={category} style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '6px', fontSize: '12px' }}>
                        <div style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>{category}</div>
                        <div style={{ opacity: 0.7 }}>{total} items</div>
                        {positive !== null && (
                          <div style={{ fontSize: '10px', opacity: 0.5, marginTop: '2px' }}>
                            ✓ {positive} | ✗ {negative}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Feature Importance */}
      {trainingDetails?.featureImportance && trainingDetails.featureImportance.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>🎯 What Matters Most</h3>
          <div style={{ fontSize: '13px', opacity: 0.7, marginBottom: '16px' }}>
            Top features the model uses to predict if you'll save a URL
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {trainingDetails.featureImportance.slice(0, 8).map((item, idx) => {
              const maxImportance = trainingDetails.featureImportance[0].importance;
              const percentage = (item.importance / maxImportance) * 100;

              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ minWidth: '30px', fontSize: '14px', fontWeight: 'bold', opacity: 0.5 }}>
                    #{idx + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 'bold' }}>
                        {item.feature.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </div>
                      <div style={{ fontSize: '12px', opacity: 0.7 }}>
                        {item.importance.toFixed(3)}
                      </div>
                    </div>
                    <div style={{ height: '6px', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${percentage}%`,
                        backgroundColor: idx < 3 ? '#3b82f6' : idx < 6 ? '#10b981' : '#f59e0b',
                        transition: 'width 0.3s'
                      }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Next Steps */}
      {mlStatus?.modelTrained && (
        <div style={cardStyle}>
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>🚀 What You Can Do Next</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ padding: '14px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#3b82f6' }}>✅ Let ML Work for You</div>
              <div style={{ fontSize: '13px', opacity: 0.9, lineHeight: '1.5' }}>
                Your model is trained and running! It will automatically analyze new pages you visit and save the ones it thinks you'll want, based on your browsing patterns.
              </div>
            </div>

            <div style={{ padding: '14px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#10b981' }}>📊 Check Smart Saved</div>
              <div style={{ fontSize: '13px', opacity: 0.9, lineHeight: '1.5' }}>
                Review URLs that were automatically saved in the "Smart Saved" workspace below. Remove any that don't match your interests to improve future predictions.
              </div>
            </div>

            <div style={{ padding: '14px', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#f59e0b' }}>⚙️ Fine-Tune Settings</div>
              <div style={{ fontSize: '13px', opacity: 0.9, lineHeight: '1.5' }}>
                Adjust the threshold below - lower it (50-60%) to save more URLs, raise it (80-90%) to be more selective. The current setting is {(config.threshold * 100).toFixed(0)}%.
              </div>
            </div>

            <div style={{ padding: '14px', backgroundColor: 'rgba(168, 85, 247, 0.1)', borderRadius: '8px', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#a855f7' }}>🔄 Retrain Periodically</div>
              <div style={{ fontSize: '13px', opacity: 0.9, lineHeight: '1.5' }}>
                As your interests evolve, retrain the model every few days to adapt to new patterns. Click "Train Now" above after saving/removing more URLs.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Smart URL Recommendations */}
      {mlStatus?.modelTrained && (
        <div style={cardStyle}>
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>🎯 URLs You Might Want to Save</h3>
          <div style={{ fontSize: '13px', opacity: 0.7, marginBottom: '16px' }}>
            Based on your last 2 hours of browsing - Click to open
          </div>

          {urlRecommendations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', opacity: 0.6 }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
              <div style={{ marginBottom: '8px' }}>No URL recommendations yet</div>
              <div style={{ fontSize: '12px' }}>
                Browse more pages and the ML model will suggest URLs you might want to save
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '600px', overflowY: 'auto' }}>
              {urlRecommendations.map((rec, idx) => {
                // Color code based on confidence
                const confidenceColor = rec.probability > 0.8 ? '#10b981' :
                  rec.probability > 0.7 ? '#3b82f6' : '#f59e0b';

                const confidenceBg = rec.probability > 0.8 ? 'rgba(16, 185, 129, 0.1)' :
                  rec.probability > 0.7 ? 'rgba(59, 130, 246, 0.1)' : 'rgba(245, 158, 11, 0.1)';

                const confidenceBorder = rec.probability > 0.8 ? 'rgba(16, 185, 129, 0.3)' :
                  rec.probability > 0.7 ? 'rgba(59, 130, 246, 0.3)' : 'rgba(245, 158, 11, 0.3)';

                return (
                  <div
                    key={idx}
                    onClick={() => chrome.tabs.create({ url: rec.url })}
                    style={{
                      padding: '12px',
                      backgroundColor: confidenceBg,
                      border: `1px solid ${confidenceBorder}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'start',
                      gap: '12px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateX(4px)';
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateX(0)';
                      e.currentTarget.style.backgroundColor = confidenceBg;
                    }}
                  >
                    {/* Favicon */}
                    <img
                      src={rec.favicon}
                      alt=""
                      style={{
                        width: '24px',
                        height: '24px',
                        flexShrink: 0,
                        borderRadius: '4px'
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '4px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {rec.title}
                        </div>
                        <div style={{
                          padding: '2px 8px',
                          backgroundColor: confidenceColor,
                          color: 'white',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          marginLeft: '8px',
                          flexShrink: 0
                        }}>
                          {(rec.probability * 100).toFixed(0)}%
                        </div>
                      </div>

                      <div style={{ fontSize: '12px', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '6px' }}>
                        {rec.domain}
                      </div>

                      <div style={{ fontSize: '11px', opacity: 0.6, fontStyle: 'italic' }}>
                        {rec.reason}
                      </div>

                      {/* Stats */}
                      <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '10px', opacity: 0.5 }}>
                        <span>👁️ {rec.visitCount} visits</span>
                        <span>🕒 {formatTime(rec.lastVisit)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Configuration Card */}
      <div style={cardStyle}>
        <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>Configuration</h3>

        {/* Enable/Disable Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', padding: '12px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px' }}>
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Enable ML Auto-Save</div>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>
              Automatically save URLs based on ML predictions
            </div>
          </div>
          <label style={{ position: 'relative', display: 'inline-block', width: '50px', height: '24px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => handleConfigChange('enabled', e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: config.enabled ? '#3b82f6' : '#ccc',
              transition: '0.3s',
              borderRadius: '24px'
            }}>
              <span style={{
                position: 'absolute',
                height: '18px',
                width: '18px',
                left: config.enabled ? '26px' : '3px',
                bottom: '3px',
                backgroundColor: 'white',
                transition: '0.3s',
                borderRadius: '50%'
              }}></span>
            </span>
          </label>
        </div>

        {/* Threshold Slider */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>Auto-Save Threshold</div>
              <div style={{ fontSize: '12px', opacity: 0.7 }}>
                Minimum confidence to auto-save (higher = more selective)
              </div>
            </div>
            <div style={{ fontWeight: 'bold', color: '#3b82f6', fontSize: '16px' }}>
              {(config.threshold * 100).toFixed(0)}%
            </div>
          </div>
          <input
            type="range"
            min="50"
            max="95"
            value={config.threshold * 100}
            onChange={(e) => handleConfigChange('threshold', parseFloat(e.target.value) / 100)}
            style={{ width: '100%', accentColor: '#3b82f6' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', opacity: 0.6, marginTop: '4px' }}>
            <span>50% (Aggressive)</span>
            <span>95% (Conservative)</span>
          </div>
        </div>

        {/* Min Visits */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>Minimum Visits</div>
              <div style={{ fontSize: '12px', opacity: 0.7 }}>
                Required visits before considering auto-save
              </div>
            </div>
            <div style={{ fontWeight: 'bold', color: '#3b82f6', fontSize: '16px' }}>
              {config.minVisits}
            </div>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            value={config.minVisits}
            onChange={(e) => handleConfigChange('minVisits', parseInt(e.target.value))}
            style={{ width: '100%', accentColor: '#3b82f6' }}
          />
        </div>

        {/* Min Time Spent */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>Minimum Time Spent</div>
              <div style={{ fontSize: '12px', opacity: 0.7 }}>
                Required time before considering auto-save
              </div>
            </div>
            <div style={{ fontWeight: 'bold', color: '#3b82f6', fontSize: '16px' }}>
              {formatDuration(config.minTimeSpent)}
            </div>
          </div>
          <input
            type="range"
            min="10000"
            max="300000"
            step="10000"
            value={config.minTimeSpent}
            onChange={(e) => handleConfigChange('minTimeSpent', parseInt(e.target.value))}
            style={{ width: '100%', accentColor: '#3b82f6' }}
          />
        </div>
      </div>

      {/* Auto-Saved URLs */}
      <div style={cardStyle}>
        <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>
          Auto-Saved URLs ({autoSavedUrls.length})
        </h3>
        {autoSavedUrls.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', opacity: 0.6 }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
            <div style={{ marginBottom: '8px' }}>No URLs auto-saved yet</div>
            <div style={{ fontSize: '12px' }}>
              Browse and interact with pages to collect data, then train the model
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {autoSavedUrls.map((url, idx) => (
              <div
                key={idx}
                style={{
                  padding: '12px',
                  borderBottom: idx < autoSavedUrls.length - 1 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}
              >
                <img
                  src={`https://www.google.com/s2/favicons?domain=${new URL(url.url).hostname}&sz=32`}
                  alt=""
                  style={{ width: '24px', height: '24px', flexShrink: 0 }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {url.title || new URL(url.url).hostname}
                  </div>
                  <div style={{ fontSize: '12px', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {url.url}
                  </div>
                </div>
                {url.confidence && (
                  <div style={{
                    padding: '4px 8px',
                    backgroundColor: url.confidence > 0.8 ? '#dcfce7' : '#fef3c7',
                    color: url.confidence > 0.8 ? '#166534' : '#92400e',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    flexShrink: 0
                  }}>
                    {(url.confidence * 100).toFixed(0)}%
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Smart Recommendations */}
      <div style={cardStyle}>
        <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>💡 Smart Insights & Recommendations</h3>
        <div style={{ fontSize: '13px', opacity: 0.7, marginBottom: '16px' }}>
          Based on your browsing history and ML model analysis
        </div>
        {recommendations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', opacity: 0.6 }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>💡</div>
            <div style={{ marginBottom: '8px' }}>No recommendations yet</div>
            <div style={{ fontSize: '12px' }}>
              Train the model and browse more to get personalized recommendations
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {recommendations.map((rec, idx) => {
              // Determine styling based on type
              let bgColor, borderColor, badgeColor, badgeText, badgeBg;

              switch (rec.type) {
                case 'insight':
                  bgColor = 'rgba(59, 130, 246, 0.1)';
                  borderColor = 'rgba(59, 130, 246, 0.3)';
                  badgeColor = '#3b82f6';
                  badgeText = 'Insight';
                  badgeBg = 'rgba(59, 130, 246, 0.2)';
                  break;
                case 'action':
                  bgColor = 'rgba(245, 158, 11, 0.1)';
                  borderColor = 'rgba(245, 158, 11, 0.3)';
                  badgeColor = '#f59e0b';
                  badgeText = 'Action';
                  badgeBg = 'rgba(245, 158, 11, 0.2)';
                  break;
                case 'performance':
                  bgColor = 'rgba(16, 185, 129, 0.1)';
                  borderColor = 'rgba(16, 185, 129, 0.3)';
                  badgeColor = '#10b981';
                  badgeText = 'Performance';
                  badgeBg = 'rgba(16, 185, 129, 0.2)';
                  break;
                default:
                  bgColor = 'rgba(255, 255, 255, 0.05)';
                  borderColor = 'rgba(255, 255, 255, 0.1)';
                  badgeColor = '#8b5cf6';
                  badgeText = 'Info';
                  badgeBg = 'rgba(139, 92, 246, 0.2)';
              }

              return (
                <div
                  key={idx}
                  style={{
                    padding: '14px',
                    backgroundColor: bgColor,
                    borderRadius: '8px',
                    border: `1px solid ${borderColor}`,
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', flex: 1 }}>{rec.title}</div>
                    {rec.type && (
                      <div style={{
                        padding: '2px 8px',
                        backgroundColor: badgeBg,
                        color: badgeColor,
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        marginLeft: '8px',
                        whiteSpace: 'nowrap'
                      }}>
                        {badgeText}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: '13px', opacity: 0.9, lineHeight: '1.5' }}>{rec.description}</div>
                  {rec.score && (
                    <div style={{
                      marginTop: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <div style={{ fontSize: '11px', opacity: 0.7 }}>Confidence:</div>
                      <div style={{ flex: 1, height: '4px', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${rec.score * 100}%`,
                          backgroundColor: badgeColor,
                          transition: 'width 0.3s'
                        }} />
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: badgeColor }}>
                        {(rec.score * 100).toFixed(0)}%
                      </div>
                    </div>
                  )}
                  {rec.category && (
                    <div style={{
                      marginTop: '8px',
                      fontSize: '11px',
                      opacity: 0.6,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      Category: {rec.category}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
