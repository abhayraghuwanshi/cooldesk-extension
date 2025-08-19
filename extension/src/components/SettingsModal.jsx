import React, { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFloppyDisk, faTrash } from '@fortawesome/free-solid-svg-icons';
import { deleteWorkspaceById, listWorkspaces, saveWorkspace, subscribeWorkspaceChanges } from '../db';
import { sendMessage, storageGet } from '../services/extensionApi';
import { CreateWorkspaceModal } from './CreateWorkspaceModal';

export function SettingsModal({ show, onClose, settings, onSave }) {
  const [localSettings, setLocalSettings] = useState(settings)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState('')
  const [workspaces, setWorkspaces] = useState([])
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  // Load workspaces from IndexedDB and subscribe to changes
  useEffect(() => {
    if (!show) return;
    let unsub = null;
    (async () => {
      try {
        const list = await listWorkspaces();
        setWorkspaces(Array.isArray(list) ? list : []);
      } catch { setWorkspaces([]); }
    })();
    unsub = subscribeWorkspaceChanges(async () => {
      try {
        const list = await listWorkspaces();
        setWorkspaces(Array.isArray(list) ? list : []);
      } catch { }
    });
    return () => { try { unsub && unsub(); } catch { } };
  }, [show]);

  const handleSave = () => {
    // Do not mirror workspaces into settings; workspaces are the source of truth
    const { categories, ...rest } = (localSettings || {});
    onSave(rest);
  }

  // Derived rows for inline editing of workspaces
  const editableWorkspaces = useMemo(() => {
    return (Array.isArray(workspaces) ? workspaces : []).map(w => ({
      id: w.id,
      name: w.name || '',
      description: w.description || '',
    }));
  }, [workspaces]);

  if (!show) return null

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
      // Instead of storing in settings, create/update workspaces directly
      const existing = Array.isArray(workspaces) ? workspaces : []
      const norm = (s) => (s || '').trim().toLowerCase()
      for (const row of rows) {
        const found = existing.find(w => norm(w.name) === norm(row.name))
        const ws = found ? { ...found, description: row.description || found.description || '' } : {
          id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
          name: row.name,
          description: row.description || '',
          createdAt: Date.now(),
          urls: [],
          context: {},
        }
        try { await saveWorkspace(ws) } catch { }
      }
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setSuggesting(false)
    }
  }

  const handleUpdateWorkspaceField = (id, field, value) => {
    setWorkspaces(ws => ws.map(w => w.id === id ? { ...w, [field]: value } : w))
  }

  const handleSaveWorkspaceRow = async (id) => {
    try {
      const w = workspaces.find(x => x.id === id)
      if (!w) return
      const payload = {
        id: w.id,
        name: (w.name || '').trim() || 'Workspace',
        description: (w.description || '').trim(),
        createdAt: w.createdAt || Date.now(),
        urls: Array.isArray(w.urls) ? w.urls : [],
        context: typeof w.context === 'object' && w.context ? w.context : {},
      }
      await saveWorkspace(payload)
    } catch (e) { /* ignore */ }
  }

  const handleDeleteWorkspace = async (id) => {
    try {
      await deleteWorkspaceById(id)
    } catch { }
  }

  const handleOpenCreateWorkspace = () => setShowCreateWorkspace(true)
  const handleCloseCreateWorkspace = () => setShowCreateWorkspace(false)
  const handleCreateWorkspace = async (name, description) => {
    const ws = {
      id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
      name,
      description,
      createdAt: Date.now(),
      urls: [],
      context: {},
    }
    await saveWorkspace(ws)
    setShowCreateWorkspace(false)
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
          <span>Workspaces</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {editableWorkspaces.map((row) => (
              <div key={row.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  style={{ flex: 1 }}
                  placeholder="Workspace name"
                  value={row.name}
                  onChange={(e) => handleUpdateWorkspaceField(row.id, 'name', e.target.value)}
                />
                <input
                  style={{ flex: 2 }}
                  placeholder="Description"
                  value={row.description}
                  onChange={(e) => handleUpdateWorkspaceField(row.id, 'description', e.target.value)}
                />
                <button
                  className="filter-btn"
                  onClick={() => handleSaveWorkspaceRow(row.id)}
                  title="Save"
                  aria-label="Save workspace"
                >
                  <FontAwesomeIcon icon={faFloppyDisk} />
                </button>
                <button
                  className="filter-btn"
                  onClick={() => handleDeleteWorkspace(row.id)}
                  title="Delete"
                  aria-label="Delete workspace"
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="add-link-btn" onClick={handleOpenCreateWorkspace} title="Create workspace">+ Add Workspace</button>
              <button className="add-link-btn" onClick={handleSuggestCategories} disabled={suggesting} title="AI-suggest workspaces from your URLs">
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

        <CreateWorkspaceModal
          show={showCreateWorkspace}
          onClose={handleCloseCreateWorkspace}
          onCreate={handleCreateWorkspace}
          currentTab={null}
        />
      </div>
    </div>
  )
}
