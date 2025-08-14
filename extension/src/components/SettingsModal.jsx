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
        <h3>Settings</h3>
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
