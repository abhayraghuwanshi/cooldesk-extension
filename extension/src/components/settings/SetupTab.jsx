import { faCheckCircle, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';

// Inject keyframes for pulse animation
const styleId = 'setup-tab-animations';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `;
  document.head.appendChild(style);
}

const SetupTab = ({
  localSettings,
  setLocalSettings,
  markEdited,
  basicSaved,
  setBasicSaved,
  suggesting,
  error,
  setError,
  handleSuggestCategories,
  saveSettingsDB,
  storageSet
}) => {
  // State for AI Provider
  const [capabilities, setCapabilities] = React.useState({ available: 'no', default: false, reason: '' });
  const [downloadProgress, setDownloadProgress] = React.useState(null);

  React.useEffect(() => {
    checkCapabilities();
  }, [localSettings.aiProvider]);

  const getModelEntryPoint = () => {
    // Check self.LanguageModel first (newer API), then window.ai.languageModel
    if (self.LanguageModel) return self.LanguageModel;
    if (self.ai?.languageModel) return self.ai.languageModel;
    return null;
  };

  const checkCapabilities = async () => {
    try {
      const model = getModelEntryPoint();
      if (!model) {
        setCapabilities({ available: 'no', default: false, reason: 'api-missing' });
        return;
      }

      // Use availability() API (the standard for newer Chrome versions)
      // Pass the same language options that will be used in create()
      if (model.availability) {
        const avail = await model.availability({
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }]
        });
        // Possible values: 'available', 'downloadable', 'downloading', 'no'
        setCapabilities({
          available: avail, // Store raw value
          default: false,
          reason: 'ok',
          raw: avail
        });
        return;
      }

      // Fallback to older capabilities() API
      if (model.capabilities) {
        const caps = await model.capabilities();
        setCapabilities({
          available: caps.available, // 'readily', 'after-download', 'no'
          default: caps.default,
          reason: 'ok'
        });
        return;
      }

      setCapabilities({ available: 'no', default: false, reason: 'api-outdated' });
    } catch (e) {
      console.warn('AI capabilities check failed:', e);
      setCapabilities({ available: 'no', default: false, reason: 'error', error: e.message });
    }
  };

  // Test Model State
  const [testInput, setTestInput] = React.useState('');
  const [testOutput, setTestOutput] = React.useState('');
  const [isTesting, setIsTesting] = React.useState(false);
  const [downloadStatus, setDownloadStatus] = React.useState('');

  const handleTestModel = async () => {
    if (!testInput.trim()) return;

    setIsTesting(true);
    setTestOutput('');
    setDownloadStatus('Checking model availability...');
    setDownloadProgress(null);

    try {
      console.log('[SetupTab] Starting model test...');

      if (localSettings.aiProvider === 'cloud') {
        setTestOutput('Cloud testing not implemented in this preview. Please use local provider to test download.');
        setDownloadStatus('');
        setIsTesting(false);
        return;
      }

      const model = getModelEntryPoint();
      if (!model) {
        throw new Error('Window.ai API not supported in this browser version.');
      }

      // Check availability first - this is required before calling create
      // Pass the same language options that will be used in create()
      const languageOptions = {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }]
      };

      let availability = 'unknown';
      if (model.availability) {
        availability = await model.availability(languageOptions);
        console.log('[SetupTab] Model availability:', availability);

        // Update status based on availability
        if (availability === 'available') {
          setDownloadStatus('Model ready. Creating session...');
        } else if (availability === 'downloadable') {
          setDownloadStatus('Model needs to be downloaded. Starting download...');
        } else if (availability === 'downloading') {
          setDownloadStatus('Model is already downloading...');
        } else {
          throw new Error(`Model not available. Status: ${availability}`);
        }
      }

      console.log('[SetupTab] Creating AI session...');

      // Create session with monitor callback for download progress
      // Use same languageOptions passed to availability()
      const handleProgress = (e) => {
        console.log('[SetupTab] Download progress event:', e);
        const { loaded, total } = e;

        let percent = 0;
        if (typeof total === "number" && total > 0) {
          percent = (loaded / total) * 100;
        } else if (typeof loaded === "number" && loaded <= 1) {
          // Handle ratio case where loaded is already a fraction 0-1
          percent = loaded * 100;
        }
        const clamped = Math.min(100, Math.max(0, percent));

        setDownloadProgress(clamped);
        if (clamped === 0) {
          setDownloadStatus('Download starting... (Check chrome://components for progress)');
        } else {
          setDownloadStatus(`Downloading model: ${Math.floor(clamped)}%`);
        }
      };

      const session = await model.create({
        ...languageOptions,
        monitor: (monitor) => {
          console.log('[SetupTab] Monitor object received:', monitor);

          // Try both methods: property setter and addEventListener
          if (monitor) {
            // Method 1: Use ondownloadprogress property
            if ('ondownloadprogress' in monitor) {
              monitor.ondownloadprogress = handleProgress;
            }
            // Method 2: Also try addEventListener as backup
            if (monitor.addEventListener) {
              monitor.addEventListener("downloadprogress", handleProgress);
            }
          }
        },
      });

      // Update capabilities after successful session creation
      if (availability === 'downloadable' || availability === 'downloading') {
        setCapabilities(prev => ({ ...prev, available: 'available' }));
      }

      setDownloadStatus('Running prompt...');
      console.log('[SetupTab] Session created. Running prompt...');
      const result = await session.prompt(testInput);
      setTestOutput(result);
      setDownloadStatus('');
      setDownloadProgress(null);
      console.log('[SetupTab] Prompt complete.');
    } catch (e) {
      console.error('[SetupTab] Test failed:', e);
      setTestOutput(`Error: ${e.message}`);
      setDownloadStatus('');
      setDownloadProgress(null);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveSettings = async () => {
    setError('');
    const key = String(localSettings?.geminiApiKey || '').trim();

    // Validate if Cloud provider is selected
    const provider = localSettings?.aiProvider || 'chrome';
    if (provider === 'cloud' && !key) {
      setError('Gemini API Key is required for Cloud provider');
      return;
    }

    const payload = {
      geminiApiKey: key,
      modelName: String(localSettings?.modelName || '').trim(),
      visitCountThreshold: Number(localSettings?.visitCountThreshold) || 0,
      historyDays: Number(localSettings?.historyDays) || 30,

      // New Settings
      aiProvider: provider, // 'chrome', 'edge', 'cloud'
      useOnDeviceAi: localSettings?.useOnDeviceAi || false,
    };

    try {
      await Promise.all([
        saveSettingsDB(payload),
        storageSet(payload),
      ]);
      setBasicSaved(true);
    } catch (e) {
      setError(String(e?.message || e) || 'Failed to save settings');
    }
  };

  const inputStyle = {
    padding: '16px 20px',
    background: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '12px',
    color: '#e5e7eb',
    fontSize: '16px',
    outline: 'none',
    transition: 'all 0.2s ease'
  };

  const inputFocusHandlers = {
    onFocus: (e) => {
      e.target.style.borderColor = '#34C759';
      e.target.style.background = 'rgba(255, 255, 255, 0.15)';
    },
    onBlur: (e) => {
      e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
      e.target.style.background = 'rgba(255, 255, 255, 0.1)';
    }
  };

  // Helper to get provider status
  const getProviderStatus = (id) => {
    if (id === 'chrome') {
      const isReady = capabilities.available === 'available' || capabilities.available === 'readily';
      const needsDownload = capabilities.available === 'downloadable' || capabilities.available === 'after-download';
      const isDownloading = capabilities.available === 'downloading';
      const apiMissing = capabilities.reason === 'api-missing' || capabilities.available === 'no';

      if (isReady) return { text: 'Ready', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)' };
      if (isDownloading) return { text: 'Downloading', color: '#facc15', bg: 'rgba(250, 204, 21, 0.15)' };
      if (needsDownload) return { text: 'Need Setup', color: '#facc15', bg: 'rgba(250, 204, 21, 0.15)' };
      if (apiMissing) return { text: 'Need Setup', color: '#f87171', bg: 'rgba(248, 113, 113, 0.15)' };
      return { text: 'Unavailable', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.15)' };
    }
    if (id === 'edge') return { text: 'Beta', color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.15)' };
    if (id === 'cloud') return { text: 'API Key', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' };
    return null;
  };

  const providers = [
    {
      id: 'chrome',
      label: 'Local AI',
      subtitle: 'Gemini Nano',
      icon: '🖥️',
      features: ['Free', 'Private', 'Offline'],
      recommended: true
    },
    {
      id: 'cloud',
      label: 'Cloud AI',
      subtitle: 'Gemini API',
      icon: '☁️',
      features: ['Powerful', 'Always Available'],
      recommended: false
    },
    {
      id: 'edge',
      label: 'Edge AI',
      subtitle: 'Phi Model',
      icon: '⚡',
      features: ['Microsoft Edge'],
      recommended: false
    }
  ];

  return (
    <div>
      {/* Provider Selection - Horizontal Cards */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {providers.map(p => {
            const isSelected = localSettings.aiProvider === p.id;
            const status = getProviderStatus(p.id);

            return (
              <div
                key={p.id}
                onClick={() => { setLocalSettings({ ...localSettings, aiProvider: p.id }); markEdited(); }}
                style={{
                  flex: 1,
                  padding: '14px 16px',
                  borderRadius: 12,
                  background: isSelected
                    ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2))'
                    : 'rgba(255,255,255,0.03)',
                  border: `2px solid ${isSelected ? '#3b82f6' : 'transparent'}`,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                {/* Recommended Badge */}
                {p.recommended && (
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#4ade80',
                    background: 'rgba(74, 222, 128, 0.15)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    Best
                  </div>
                )}

                {/* Header Row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>{p.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{p.subtitle}</div>
                  </div>
                </div>

                {/* Status Badge */}
                {status && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    color: status.color,
                    background: status.bg,
                    padding: '3px 8px',
                    borderRadius: 4
                  }}>
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: status.color,
                      animation: status.text === 'Downloading' ? 'pulse 1.5s infinite' : 'none'
                    }} />
                    {status.text}
                  </div>
                )}

                {/* Feature Tags */}
                <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                  {p.features.map((f, i) => (
                    <span key={i} style={{
                      fontSize: 9,
                      color: '#9ca3af',
                      background: 'rgba(255,255,255,0.05)',
                      padding: '2px 6px',
                      borderRadius: 3
                    }}>
                      {f}
                    </span>
                  ))}
                </div>

                {/* Selection Indicator */}
                {isSelected && (
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)'
                  }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Dynamic Fields based on Provider */}
      {localSettings.aiProvider === 'cloud' ? (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>Gemini API Key</span>
            <input
              value={localSettings.geminiApiKey || ''}
              onChange={(e) => { setLocalSettings({ ...localSettings, geminiApiKey: e.target.value }); markEdited(); }}
              placeholder="Enter your Gemini API key..."
              style={inputStyle}
              {...inputFocusHandlers}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>Model Name</span>
            <input
              value={localSettings.modelName || ''}
              onChange={(e) => { setLocalSettings({ ...localSettings, modelName: e.target.value }); markEdited(); }}
              placeholder="e.g., gemini-1.5-pro"
              style={inputStyle}
              {...inputFocusHandlers}
            />
          </label>
        </>
      ) : (
        <div style={{ gridColumn: '1 / -1', padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12 }}>
          {/* Step Progress Indicator */}
          {(() => {
            // Determine current step based on capabilities
            const apiEnabled = capabilities.reason !== 'api-missing' && capabilities.available !== 'no';
            const modelDownloaded = capabilities.available === 'available' || capabilities.available === 'readily';
            const isDownloading = capabilities.available === 'downloading' || downloadProgress !== null;
            const needsDownload = capabilities.available === 'downloadable' || capabilities.available === 'after-download';

            const currentStep = !apiEnabled ? 1 : (modelDownloaded ? 3 : 2);

            const steps = [
              { num: 1, label: 'Enable API', icon: '🚩' },
              { num: 2, label: 'Download Model', icon: '📥' },
              { num: 3, label: 'Ready to Use', icon: '✨' }
            ];

            return (
              <>
                {/* Step Progress Bar */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
                    {/* Progress Line Background */}
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '10%',
                      right: '10%',
                      height: 3,
                      background: 'rgba(255,255,255,0.1)',
                      transform: 'translateY(-50%)',
                      zIndex: 0
                    }} />
                    {/* Progress Line Active */}
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '10%',
                      width: currentStep === 1 ? '0%' : currentStep === 2 ? '40%' : '80%',
                      height: 3,
                      background: 'linear-gradient(90deg, #4ade80, #3b82f6)',
                      transform: 'translateY(-50%)',
                      transition: 'width 0.5s ease',
                      zIndex: 1
                    }} />

                    {steps.map((step) => {
                      const isCompleted = step.num < currentStep;
                      const isCurrent = step.num === currentStep;
                      const isActive = isCompleted || isCurrent;

                      return (
                        <div key={step.num} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, flex: 1 }}>
                          <div style={{
                            width: 44,
                            height: 44,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 18,
                            background: isCompleted ? 'linear-gradient(135deg, #4ade80, #22c55e)' :
                                        isCurrent ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)' :
                                        'rgba(255,255,255,0.1)',
                            border: `2px solid ${isCompleted ? '#4ade80' : isCurrent ? '#3b82f6' : 'rgba(255,255,255,0.2)'}`,
                            boxShadow: isActive ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none',
                            transition: 'all 0.3s ease'
                          }}>
                            {isCompleted ? <FontAwesomeIcon icon={faCheckCircle} style={{ color: '#fff' }} /> : step.icon}
                          </div>
                          <div style={{
                            marginTop: 8,
                            fontSize: 12,
                            fontWeight: isCurrent ? 600 : 400,
                            color: isActive ? '#fff' : '#6b7280',
                            textAlign: 'center'
                          }}>
                            {step.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Step Content */}
                <div style={{
                  background: 'rgba(0,0,0,0.2)',
                  borderRadius: 12,
                  padding: 20,
                  border: '1px solid rgba(255,255,255,0.1)'
                }}>
                  {/* Step 1: Enable API */}
                  {currentStep === 1 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <span style={{ fontSize: 24 }}>🚩</span>
                        <div>
                          <h3 style={{ margin: 0, color: '#fff', fontSize: 16 }}>Step 1: Enable Chrome AI Flags</h3>
                          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af' }}>Configure Chrome to enable the built-in AI API</p>
                        </div>
                      </div>

                      <div style={{ background: 'rgba(59, 130, 246, 0.1)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                        <div style={{ fontSize: 13, color: '#e5e7eb', marginBottom: 12 }}>
                          Open <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4 }}>chrome://flags</code> and enable:
                        </div>
                        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <li style={{ color: '#e5e7eb' }}>
                            <strong>Prompt API for Gemini Nano</strong>
                            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Search "Prompt API" → Set to "Enabled"</div>
                          </li>
                          <li style={{ color: '#e5e7eb' }}>
                            <strong>Enables optimization guide on device</strong>
                            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Search "optimization guide" → Set to "Enabled BypassPerfRequirement"</div>
                          </li>
                        </ol>
                      </div>

                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => {
                            // Can't directly open chrome:// URLs, show instruction
                            setTestOutput('Copy and paste "chrome://flags" into a new tab address bar');
                          }}
                          style={{
                            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                            border: 'none',
                            borderRadius: 8,
                            padding: '10px 20px',
                            color: 'white',
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: 'pointer'
                          }}
                        >
                          How to Open Flags
                        </button>
                        <button
                          onClick={checkCapabilities}
                          style={{
                            background: 'rgba(255,255,255,0.1)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: 8,
                            padding: '10px 20px',
                            color: '#e5e7eb',
                            fontSize: 14,
                            cursor: 'pointer'
                          }}
                        >
                          Check Again
                        </button>
                        <a
                          href="https://developer.chrome.com/docs/ai/get-started"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 13, color: '#60a5fa' }}
                        >
                          View Guide →
                        </a>
                      </div>

                      {testOutput && (
                        <div style={{ marginTop: 12, padding: 10, background: 'rgba(250, 204, 21, 0.1)', borderRadius: 6, fontSize: 13, color: '#facc15' }}>
                          {testOutput}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 2: Download Model */}
                  {currentStep === 2 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <span style={{ fontSize: 24 }}>📥</span>
                        <div>
                          <h3 style={{ margin: 0, color: '#fff', fontSize: 16 }}>Step 2: Download AI Model</h3>
                          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af' }}>
                            {isDownloading ? 'Downloading Gemini Nano (~1.5GB)...' : 'Download the Gemini Nano model to your device'}
                          </p>
                        </div>
                      </div>

                      {/* Download Progress */}
                      {(isDownloading || downloadProgress !== null) ? (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ color: '#e5e7eb', fontSize: 14 }}>
                              {downloadStatus || 'Downloading...'}
                            </span>
                            <span style={{ color: '#4ade80', fontSize: 14, fontWeight: 600 }}>
                              {downloadProgress !== null ? `${Math.floor(downloadProgress)}%` : '...'}
                            </span>
                          </div>
                          <div style={{ height: 12, background: 'rgba(255,255,255,0.1)', borderRadius: 6, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${downloadProgress || 0}%`,
                              background: 'linear-gradient(90deg, #4ade80, #3b82f6, #8b5cf6)',
                              borderRadius: 6,
                              transition: 'width 0.3s ease',
                              boxShadow: '0 0 10px rgba(74, 222, 128, 0.5)'
                            }} />
                          </div>
                          <div style={{ marginTop: 12, padding: 10, background: 'rgba(59, 130, 246, 0.1)', borderRadius: 6, fontSize: 12, color: '#93c5fd' }}>
                            <strong>Note:</strong> Download continues in background even if you close this tab.
                            Check progress at <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: 3 }}>chrome://components</code>
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ background: 'rgba(74, 222, 128, 0.1)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                            <div style={{ fontSize: 13, color: '#e5e7eb', marginBottom: 8 }}>
                              The AI model needs to be downloaded once. After that, it works completely offline!
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: '#9ca3af' }}>
                              <li>Size: ~1.5 GB</li>
                              <li>Stored locally in Chrome's data folder</li>
                              <li>Download continues in background</li>
                            </ul>
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 12 }}>
                        <input
                          value={testInput}
                          onChange={(e) => setTestInput(e.target.value)}
                          placeholder="Test prompt (e.g. 'Say hello')"
                          style={{ ...inputStyle, flex: 1, padding: '10px 16px', fontSize: 14 }}
                          onKeyDown={(e) => e.key === 'Enter' && handleTestModel()}
                        />
                        <button
                          onClick={handleTestModel}
                          disabled={isTesting}
                          style={{
                            background: isTesting ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #4ade80, #22c55e)',
                            border: 'none',
                            borderRadius: 8,
                            padding: '10px 24px',
                            color: 'white',
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: isTesting ? 'wait' : 'pointer',
                            minWidth: 140
                          }}
                        >
                          {isTesting ? 'Downloading...' : needsDownload ? 'Start Download' : 'Test Model'}
                        </button>
                      </div>

                      {testOutput && !testOutput.startsWith('Error') && (
                        <div style={{ marginTop: 12, padding: 12, background: 'rgba(74, 222, 128, 0.1)', borderRadius: 8, fontSize: 13, color: '#4ade80' }}>
                          <strong>Response:</strong> {testOutput}
                        </div>
                      )}
                      {testOutput && testOutput.startsWith('Error') && (
                        <div style={{ marginTop: 12, padding: 12, background: 'rgba(239, 68, 68, 0.1)', borderRadius: 8, fontSize: 13, color: '#f87171' }}>
                          {testOutput}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 3: Ready */}
                  {currentStep === 3 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <span style={{ fontSize: 24 }}>✨</span>
                        <div>
                          <h3 style={{ margin: 0, color: '#4ade80', fontSize: 16 }}>Ready to Use!</h3>
                          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af' }}>Chrome AI is fully configured and ready</p>
                        </div>
                      </div>

                      <div style={{ background: 'rgba(74, 222, 128, 0.1)', borderRadius: 8, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <FontAwesomeIcon icon={faCheckCircle} style={{ color: '#4ade80', fontSize: 24 }} />
                        <div>
                          <div style={{ color: '#4ade80', fontWeight: 600 }}>Gemini Nano is ready</div>
                          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>AI suggestions will use your local model - fast & private!</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 12 }}>
                        <input
                          value={testInput}
                          onChange={(e) => setTestInput(e.target.value)}
                          placeholder="Try a test prompt..."
                          style={{ ...inputStyle, flex: 1, padding: '10px 16px', fontSize: 14 }}
                          onKeyDown={(e) => e.key === 'Enter' && handleTestModel()}
                        />
                        <button
                          onClick={handleTestModel}
                          disabled={isTesting || !testInput.trim()}
                          style={{
                            background: isTesting ? 'rgba(255,255,255,0.1)' : '#3b82f6',
                            border: 'none',
                            borderRadius: 8,
                            padding: '10px 24px',
                            color: 'white',
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: isTesting || !testInput.trim() ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {isTesting ? 'Running...' : 'Test'}
                        </button>
                      </div>

                      {testOutput && (
                        <div style={{
                          marginTop: 12,
                          padding: 12,
                          background: testOutput.startsWith('Error') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                          borderRadius: 8,
                          fontSize: 13,
                          color: testOutput.startsWith('Error') ? '#f87171' : '#93c5fd'
                        }}>
                          {testOutput}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>History Lookback</span>
        <select
          value={Number(localSettings.historyDays) || 30}
          onChange={(e) => { setLocalSettings({ ...localSettings, historyDays: Number(e.target.value) }); markEdited(); }}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </label>

      <div style={{ display: 'flex', gap: 16, marginTop: 32, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          className="add-link-btn"
          onClick={handleSaveSettings}
          title="Save AI settings"
          style={{
            background: '#34C759',
            border: 'none',
            borderRadius: '16px',
            padding: '16px 32px',
            color: 'white',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: '0 4px 16px rgba(52, 199, 89, 0.3)'
          }}
          onMouseEnter={(e) => {
            e.target.style.transform = 'translateY(-1px)';
            e.target.style.boxShadow = '0 4px 12px rgba(52, 199, 89, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = '0 2px 8px rgba(52, 199, 89, 0.3)';
          }}
        >
          Save Settings
        </button>

        <button
          className="add-link-btn"
          onClick={handleSuggestCategories}
          disabled={suggesting || (localSettings.aiProvider === 'cloud' && !String(localSettings?.geminiApiKey || '').trim())}
          title="AI-suggest workspaces from your URLs"
          style={{
            background: suggesting || (localSettings.aiProvider === 'cloud' && !String(localSettings?.geminiApiKey || '').trim())
              ? 'rgba(255, 255, 255, 0.05)'
              : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: 'none',
            borderRadius: '16px',
            padding: '16px 32px',
            color: suggesting || (localSettings.aiProvider === 'cloud' && !String(localSettings?.geminiApiKey || '').trim()) ? '#9ca3af' : 'white',
            fontSize: '16px',
            fontWeight: '600',
            cursor: suggesting || (localSettings.aiProvider === 'cloud' && !String(localSettings?.geminiApiKey || '').trim()) ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            opacity: suggesting || (localSettings.aiProvider === 'cloud' && !String(localSettings?.geminiApiKey || '').trim()) ? 0.6 : 1,
            boxShadow: suggesting || (localSettings.aiProvider === 'cloud' && !String(localSettings?.geminiApiKey || '').trim())
              ? 'none'
              : '0 4px 16px rgba(102, 126, 234, 0.3)'
          }}
          onMouseEnter={(e) => {
            if (!suggesting && (localSettings.aiProvider !== 'cloud' || String(localSettings?.geminiApiKey || '').trim())) {
              e.target.style.transform = 'translateY(-1px)';
              e.target.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (!suggesting && (localSettings.aiProvider !== 'cloud' || String(localSettings?.geminiApiKey || '').trim())) {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 4px 16px rgba(102, 126, 234, 0.3)';
            }
          }}
        >
          {suggesting ? '✨ Generating...' : '✨ AI Suggest Workspaces'}
        </button>

        {!basicSaved && (
          <div style={{ fontSize: '14px', color: '#ffd500', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FontAwesomeIcon icon={faExclamationTriangle} />Not saved yet
          </div>
        )}

        {basicSaved && (
          <div style={{ fontSize: '14px', color: '#34C759', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FontAwesomeIcon icon={faCheckCircle} />Saved
          </div>
        )}
      </div>

      {error && (
        <div style={{
          marginTop: '16px',
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: '8px',
          color: '#f87171',
          fontSize: '14px',
          textAlign: 'center'
        }}>
          {error}
        </div>
      )}
    </div>
  );
};

export default SetupTab;