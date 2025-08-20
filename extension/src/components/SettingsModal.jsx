import { faFloppyDisk, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useMemo, useState } from 'react';
import { deleteWorkspaceById, listWorkspaces, saveSettings as saveSettingsDB, saveWorkspace, subscribeWorkspaceChanges } from '../db';
import { sendMessage, storageGet, storageSet } from '../services/extensionApi';
import { CreateWorkspaceModal } from './CreateWorkspaceModal';

export function SettingsModal({ show, onClose, settings, onSave }) {
  const [localSettings, setLocalSettings] = useState(settings)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState('')
  const [workspaces, setWorkspaces] = useState([])
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [basicSaved, setBasicSaved] = useState(Boolean((settings?.geminiApiKey || '').trim()))

  useEffect(() => {
    setLocalSettings(settings)
    setBasicSaved(Boolean((settings?.geminiApiKey || '').trim()))
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
    // Require Gemini API key
    if (!String(rest.geminiApiKey || '').trim()) {
      setError('Gemini API Key is required');
      return;
    }
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

  const handleTabChange = async (nextIndex) => {
    // Guard: require an explicit Save & Continue before accessing Workspaces
    if (nextIndex !== 0 && !basicSaved) {
      setError('Please press "Save & Continue" in Basic to proceed to Workspaces')
      return
    }
    setActiveTab(nextIndex)
  }

  // Track edits in Basic and mark unsaved
  const markEdited = () => setBasicSaved(false)

  const handleSuggestCategories = async () => {
    setSuggesting(true)
    setError('')
    try {
      // Ensure settings were explicitly saved before AI actions
      if (!basicSaved) {
        setError('Please Save & Continue in Basic before using AI Suggest')
        return
      }
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
        {error && (
          <div style={{
            marginBottom: 10,
            color: '#ff6b6b',
            fontSize: 12,
            background: '#241b1b',
            border: '1px solid #3a2222',
            padding: '6px 8px',
            borderRadius: 6,
          }}>
            {error}
          </div>
        )}
        <Tabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          disabledTitles={basicSaved ? [] : ['Workspaces']}
        >
          <TabItem title="Basic">
            <label>
              <span>Gemini API Key</span>
              <input
                value={localSettings.geminiApiKey}
                onChange={(e) => { setLocalSettings({ ...localSettings, geminiApiKey: e.target.value }); markEdited(); }}
                placeholder="sk-..."
                required
              />
            </label>
            <label>
              <span>Model Name</span>
              <input
                value={localSettings.modelName || ''}
                onChange={(e) => { setLocalSettings({ ...localSettings, modelName: e.target.value }); markEdited(); }}
                placeholder="e.g., gemini-1.5-pro"
              />
            </label>
            <label>
              <span>Visit Count Threshold</span>
              <input
                type="number"
                min="0"
                value={localSettings.visitCountThreshold}
                onChange={(e) => { setLocalSettings({ ...localSettings, visitCountThreshold: e.target.value }); markEdited(); }}
              />
            </label>
            <label>
              <span>History Lookback</span>
              <select
                value={typeof localSettings.historyDays === 'number' && localSettings.historyDays > 0 ? localSettings.historyDays : (localSettings.historyDays || 30)}
                onChange={(e) => { setLocalSettings({ ...localSettings, historyDays: Number(e.target.value) }); markEdited(); }}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: '#0f1522',
                  border: '1px solid #273043',
                  color: '#e5e7eb',
                  borderRadius: 6,
                  outline: 'none',
                }}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <button
                className="add-link-btn"
                onClick={async () => {
                  setError('')
                  const key = String(localSettings?.geminiApiKey || '').trim()
                  if (!key) {
                    setError('Gemini API Key is required')
                    return
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
                  }
                  try {
                    await Promise.all([
                      saveSettingsDB(payload),
                      storageSet(payload),
                    ])
                    setBasicSaved(true)
                    setActiveTab(1) // jump to Workspaces
                  } catch (e) {
                    setError(String(e?.message || e) || 'Failed to save settings')
                  }
                }}
                title="Save Basic settings and continue to Workspaces"
              >
                Save & Continue
              </button>
              {!basicSaved && (
                <div style={{ fontSize: 12, color: '#ffd500' }}>Not saved yet</div>
              )}
              {basicSaved && (
                <div style={{ fontSize: 12, color: '#7bd88f' }}>Saved</div>
              )}
            </div>
          </TabItem>
          <TabItem title="Workspaces">
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
                  <button className="add-link-btn" onClick={handleOpenCreateWorkspace} title="Create workspace">Add</button>
                  <button className="add-link-btn" onClick={handleSuggestCategories} disabled={suggesting || !(String(localSettings?.geminiApiKey || '').trim())} title="AI-suggest workspaces from your URLs">
                    {suggesting ? 'Suggesting…' : 'AI Suggest'}
                  </button>
                </div>
              </div>
            </label>
          </TabItem>
        </Tabs>

        {/* Removed global Save button; use Save & Continue in Basic tab */}

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

// Simple Tabs components local to this file
function Tabs({ children, activeTab: controlledActiveTab, onTabChange, disabledTitles = [] }) {
  const [internalTab, setInternalTab] = useState(0);
  const activeTab = (typeof controlledActiveTab === 'number') ? controlledActiveTab : internalTab;
  const setActiveTab = (typeof onTabChange === 'function') ? onTabChange : setInternalTab;
  return (
    <div>
      <div className="tab-list" role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {React.Children.map(children, (child, index) => (
          <button
            key={index}
            role="tab"
            aria-selected={activeTab === index}
            onClick={() => {
              const title = child.props.title
              const isDisabled = Array.isArray(disabledTitles) && disabledTitles.includes(title)
              if (isDisabled) return
              setActiveTab(index)
            }}
            disabled={Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)}
            className="filter-btn"
            style={{
              padding: '6px 10px',
              background: (Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)) ? '#0b101a' : (activeTab === index ? '#1b2331' : '#0f1522'),
              border: '1px solid #273043',
              borderBottomColor: activeTab === index ? '#4a90e2' : '#273043',
              opacity: (Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)) ? 0.6 : 1,
              cursor: (Array.isArray(disabledTitles) && disabledTitles.includes(child.props.title)) ? 'not-allowed' : 'pointer',
            }}
          >
            {child.props.title}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {React.Children.map(children, (child, index) => (
          <div key={index} role="tabpanel" hidden={activeTab !== index}>
            {child.props.children}
          </div>
        ))}
      </div>
    </div>
  );
}

function TabItem({ title, children }) {
  return <>{children}</>;
}
