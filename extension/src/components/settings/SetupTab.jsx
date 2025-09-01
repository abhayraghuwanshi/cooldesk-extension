import { faCheckCircle, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';

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
  const handleSaveSettings = async () => {
    setError('');
    const key = String(localSettings?.geminiApiKey || '').trim();
    if (!key) {
      setError('Gemini API Key is required');
      return;
    }
    
    const payload = {
      geminiApiKey: key,
      modelName: String(localSettings?.modelName || '').trim(),
      visitCountThreshold: (localSettings?.visitCountThreshold === '' || localSettings?.visitCountThreshold == null)
        ? 0
        : Number(localSettings.visitCountThreshold) || 0,
      historyDays: (localSettings?.historyDays === '' || localSettings?.historyDays == null)
        ? 30
        : Number(localSettings.historyDays) || 30,
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

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>Gemini API Key</span>
          <input
            value={localSettings.geminiApiKey}
            onChange={(e) => { setLocalSettings({ ...localSettings, geminiApiKey: e.target.value }); markEdited(); }}
            placeholder="Enter your Gemini API key..."
            required
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
        
        <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>Visit Count Threshold</span>
          <input
            type="number"
            min="0"
            value={localSettings.visitCountThreshold}
            onChange={(e) => { setLocalSettings({ ...localSettings, visitCountThreshold: e.target.value }); markEdited(); }}
            style={inputStyle}
            {...inputFocusHandlers}
          />
        </label>
        
        <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>History Lookback</span>
          <select
            value={typeof localSettings.historyDays === 'number' && localSettings.historyDays > 0 ? localSettings.historyDays : (localSettings.historyDays || 30)}
            onChange={(e) => { setLocalSettings({ ...localSettings, historyDays: Number(e.target.value) }); markEdited(); }}
            style={{
              ...inputStyle,
              cursor: 'pointer'
            }}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
      </div>
      
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
          disabled={suggesting || !(String(localSettings?.geminiApiKey || '').trim())}
          title="AI-suggest workspaces from your URLs"
          style={{
            background: suggesting || !(String(localSettings?.geminiApiKey || '').trim()) 
              ? 'rgba(255, 255, 255, 0.05)' 
              : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: 'none',
            borderRadius: '16px',
            padding: '16px 32px',
            color: suggesting || !(String(localSettings?.geminiApiKey || '').trim()) ? '#9ca3af' : 'white',
            fontSize: '16px',
            fontWeight: '600',
            cursor: suggesting || !(String(localSettings?.geminiApiKey || '').trim()) ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            opacity: suggesting || !(String(localSettings?.geminiApiKey || '').trim()) ? 0.6 : 1,
            boxShadow: suggesting || !(String(localSettings?.geminiApiKey || '').trim()) 
              ? 'none' 
              : '0 4px 16px rgba(102, 126, 234, 0.3)'
          }}
          onMouseEnter={(e) => {
            if (!suggesting && String(localSettings?.geminiApiKey || '').trim()) {
              e.target.style.transform = 'translateY(-1px)';
              e.target.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (!suggesting && String(localSettings?.geminiApiKey || '').trim()) {
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