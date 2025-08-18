import React, { useEffect, useState } from 'react';
import { sendMessage, storageGet } from '../services/extensionApi';

export function SettingsModal({ show, onClose, settings, onSave }) {
  const [localSettings, setLocalSettings] = useState(settings)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  const handleSave = () => {
    onSave(localSettings)
  }

  if (!show) return null

  const categoriesRows = Array.isArray(localSettings?.categories)
    ? localSettings.categories.map((c) => (typeof c === 'string' ? { name: c, description: '' } : (c || {})))
    : []

  const handleSuggestCategories = async () => {
    setSuggesting(true)
    setError('')
    try {
      // Pull URLs from dashboard data (history + bookmarks)
      const { dashboardData } = await storageGet(['dashboardData'])
      const hist = Array.isArray(dashboardData?.history) ? dashboardData.history : []
      const bms = Array.isArray(dashboardData?.bookmarks) ? dashboardData.bookmarks : []
      const urls = [...hist, ...bms].map((it) => it?.url).filter(Boolean).slice(0, 150)
      if (!urls.length) {
        setError('No URLs available. Try Refresh Data first.')
        return
      }
      const resp = await sendMessage({ action: 'suggestCategories', urls }, { timeoutMs: 20000 })
      if (!resp?.ok) {
        setError(resp?.error || 'Failed to get suggestions')
        return
      }
      const cats = Array.isArray(resp.categories) ? resp.categories : []
      const rows = cats
        .map((c) => {
          if (typeof c === 'string') return { name: c.trim(), description: '' }
          const name = typeof c?.name === 'string' ? c.name.trim() : ''
          const description = typeof c?.description === 'string' ? c.description.trim() : ''
          return name ? { name, description } : null
        })
        .filter(Boolean)
      setLocalSettings((s) => ({ ...s, categories: rows }))
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setSuggesting(false)
    }
  }

  const handleAddCategoryRow = () => {
    const next = [...categoriesRows, { name: '', description: '' }]
    setLocalSettings({ ...localSettings, categories: next })
  }

  const handleChangeRow = (idx, field, value) => {
    const next = categoriesRows.slice()
    next[idx] = { ...next[idx], [field]: value }
    setLocalSettings({ ...localSettings, categories: next })
  }

  const handleRemoveRow = (idx) => {
    const next = categoriesRows.slice()
    next.splice(idx, 1)
    setLocalSettings({ ...localSettings, categories: next })
  }

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
          <span>Categories (name: description)</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {categoriesRows.map((row, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  style={{ flex: 1 }}
                  placeholder="Category name (e.g. AI & ML)"
                  value={row.name || ''}
                  onChange={(e) => handleChangeRow(idx, 'name', e.target.value)}
                />
                <input
                  style={{ flex: 2 }}
                  placeholder="Description (e.g. Tools with AI models, LLMs, etc.)"
                  value={row.description || ''}
                  onChange={(e) => handleChangeRow(idx, 'description', e.target.value)}
                />
                <button className="filter-btn" onClick={() => handleRemoveRow(idx)} title="Remove">✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="add-link-btn" onClick={handleAddCategoryRow} title="Add category row">+ Add</button>
              <button className="add-link-btn" onClick={handleSuggestCategories} disabled={suggesting} title="Suggest categories from your URLs">
                {suggesting ? 'Suggesting…' : 'AI Suggest'}
              </button>
            </div>
            {error && (
              <div style={{ marginTop: 6, color: '#ff6b6b', fontSize: 12 }}>{error}</div>
            )}
          </div>
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
