import React, { useState, useEffect } from 'react';

export function SettingsModal({ show, onClose, settings, onSave }) {
  const [localSettings, setLocalSettings] = useState(settings)

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  const handleSave = () => {
    onSave(localSettings)
  }

  if (!show) return null

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div
          className="modal-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            paddingBottom: 8,
            borderBottom: '1px solid #273043',
            marginBottom: 10,
          }}
        >
          <h3 style={{ margin: 0 }}>Settings</h3>
          <button
            onClick={onClose}
            className="cancel-btn"
            aria-label="Close"
            title="Close"
            style={{ padding: '4px 8px' }}
          >
            ×
          </button>
        </div>
        <label>
          <span>Gemini API Key</span>
          <input
            value={localSettings.geminiApiKey}
            onChange={(e) => setLocalSettings({ ...localSettings, geminiApiKey: e.target.value })}
            placeholder="sk-..."
          />
        </label>
        <label>
          <span>API Server URL (optional)</span>
          <input
            value={localSettings.serverUrl}
            onChange={(e) => setLocalSettings({ ...localSettings, serverUrl: e.target.value })}
            placeholder="https://..."
          />
        </label>
        <label>
          <span>Visit Count Threshold</span>
          <input
            type="number"
            min="0"
            value={localSettings.visitCountThreshold}
            onChange={(e) => setLocalSettings({ ...localSettings, visitCountThreshold: e.target.value })}
          />
        </label>
        <label>
          <span>History Fetch Limit</span>
          <input
            type="number"
            min="10"
            value={localSettings.historyMaxResults}
            onChange={(e) => setLocalSettings({ ...localSettings, historyMaxResults: e.target.value })}
          />
        </label>
        <div className="modal-actions">
          <button className="filter-btn" onClick={onClose}>Cancel</button>
          <button className="filter-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
