import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { AddToWorkspaceModal } from './components/AddToWorkspaceModal';
import { CreateWorkspaceModal } from './components/CreateWorkspaceModal';
import { Header } from './components/Header';
import { ItemGrid } from './components/ItemGrid';
import { RelatedProductsSection } from './components/RelatedProductsSection';
import { SettingsModal } from './components/SettingsModal';
import { StatsView } from './components/StatsView';
import { SystemPrompt } from './components/SystemPrompt';
import { WorkspaceFilters } from './components/WorkspaceFilters';


import { AddLinkFlow } from './components/AddLinkFlow';
import { getSettings as getSettingsDB, listWorkspaces, saveSettings as saveSettingsDB, saveWorkspace, subscribeWorkspaceChanges, updateItemWorkspace } from './db';
import { useDashboardData } from './hooks/useDashboardData';
import { getDomainFromUrl, getFaviconUrl } from './utils';

// Main App Component
export default function App() {
  const { data, loading, populate } = useDashboardData()
  const [workspace, setWorkspace] = useState('All')
  const [search, setSearch] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState({ geminiApiKey: '', serverUrl: '', visitCountThreshold: '', historyMaxResults: '' })
  const [progress, setProgress] = useState({ running: false, processed: 0, total: 0, currentItem: '', apiHits: 0, error: '' })
  const [relatedProducts, setRelatedProducts] = useState([])
  const [savedWsFilter, setSavedWsFilter] = useState('All')
  const [loadingRelated, setLoadingRelated] = useState(false)
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [addingToWorkspace, setAddingToWorkspace] = useState(null);

  const [showAddLinkModal, setShowAddLinkModal] = useState(false)
  const [workspaceForLinkAdd, setWorkspaceForLinkAdd] = useState(null)


  const [currentTab, setCurrentTab] = useState(null)
  const [savedWorkspaces, setSavedWorkspaces] = useState([])
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [showSavedWorkspaces, setShowSavedWorkspaces] = useState(true)
  const [showCurrentWorkspace, setShowCurrentWorkspace] = useState(true)
  const [activeTab, setActiveTab] = useState('workspace') // 'workspace' | 'saved'

  useEffect(() => {
    // Load settings initially from IndexedDB
    (async () => {
      const s = await getSettingsDB()
      const { geminiApiKey, serverUrl, visitCountThreshold, historyMaxResults } = s || {}
      setSettings({
        geminiApiKey: geminiApiKey || '',
        serverUrl: serverUrl || '',
        visitCountThreshold: Number.isFinite(visitCountThreshold) ? String(visitCountThreshold) : '',
        historyMaxResults: Number.isFinite(historyMaxResults) ? String(historyMaxResults) : ''
      })
    })()

      // Load saved workspaces initially from IndexedDB
      ; (async () => {
        try {
          let workspaces = await listWorkspaces()
          // One-time migration from chrome.storage.local -> IndexedDB
          if (!Array.isArray(workspaces) || workspaces.length === 0) {
            try {
              const legacy = await chrome.storage.local.get(['workspaces'])
              const legacyList = Array.isArray(legacy?.workspaces) ? legacy.workspaces : []
              if (legacyList.length) {
                // Save each to IndexedDB
                for (const w of legacyList) {
                  try { await saveWorkspace(w) } catch { }
                }
                workspaces = await listWorkspaces()
              }
            } catch { }
          }
          setSavedWorkspaces(Array.isArray(workspaces) ? workspaces : [])
        } catch (e) {
          console.error('Failed to load workspaces:', e)
        }
      })()

    const onMsg = (req) => {
      if (req?.action === 'aiProgress') {
        setProgress((p) => ({ ...p, running: true, processed: req.processed || 0, total: req.total || 0, currentItem: req.currentItem || '', apiHits: req.apiHits || 0 }))
      } else if (req?.action === 'aiComplete') {
        setProgress((p) => ({ ...p, running: false }))
      } else if (req?.action === 'aiError') {
        setProgress({ running: false, processed: 0, total: 0, currentItem: '', apiHits: 0, error: req.error || 'Unknown error' })
        setTimeout(() => setProgress((p) => ({ ...p, error: '' })), 4000)
      } else if (req?.action === 'updateData') {
        // data reloaded via hook
      }
    }
    chrome.runtime.onMessage.addListener(onMsg)

    // Subscribe to IndexedDB changes via BroadcastChannel
    const unsubscribe = subscribeWorkspaceChanges(async () => {
      try {
        const workspaces = await listWorkspaces()
        setSavedWorkspaces(Array.isArray(workspaces) ? workspaces : [])
      } catch (e) {
        console.error('Failed to refresh workspaces:', e)
      }
    })

    return () => {
      chrome.runtime.onMessage.removeListener(onMsg)
      unsubscribe && unsubscribe()
    }
  }, [])

  // When opening the Create Workspace modal, fetch current tab for auto-suggest
  useEffect(() => {
    if (showCreateWorkspace) {
      getCurrentTabInfo()
    }
  }, [showCreateWorkspace])

  // Options for keyboard navigation (must be declared before effects that depend on them)
  const workspaceOptions = useMemo(() => {
    const set = new Set(['All'])
    for (const it of data) {
      const g = it.workspaceGroup || (it.category && typeof it.category === 'object' ? it.category.name : null)
      if (g) set.add(g)
    }
    return Array.from(set)
  }, [data])

  const savedWorkspaceOptions = useMemo(() => {
    return ['All', ...savedWorkspaces.map(ws => ws.name)]
  }, [savedWorkspaces])

  // When user changes the Saved filter, ensure the Saved section is visible
  useEffect(() => {
    // Switch to 'All' so Saved section shows up while user is interacting with Saved filter
    if (workspace !== 'All') setWorkspace('All')
    // Ensure the Saved section is expanded so the user sees the change
    setShowSavedWorkspaces(true)
  }, [savedWsFilter])

  // Keyboard shortcuts for tab navigation
  useEffect(() => {
    const onKey = (e) => {
      // Ignore when typing in inputs/contentEditable
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : ''
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return
      // Ctrl+1 => Workspace, Ctrl+2 => Saved (Windows/Linux)
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === '1') { setActiveTab('workspace'); e.preventDefault(); }
        if (e.key === '2') { setActiveTab('saved'); e.preventDefault(); }
        if (e.key === 'ArrowRight') { setActiveTab((t) => (t === 'workspace' ? 'saved' : 'workspace')); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { setActiveTab((t) => (t === 'saved' ? 'workspace' : 'saved')); e.preventDefault(); }
      }
      // Alt+Left/Right toggles tabs (to avoid conflicting with card navigation)
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.key === 'ArrowRight') { setActiveTab((t) => (t === 'workspace' ? 'saved' : 'workspace')); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { setActiveTab((t) => (t === 'saved' ? 'workspace' : 'saved')); e.preventDefault(); }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTab])

  const filtered = useMemo(() => {
    const s = search.toLowerCase()
    return data.filter((it) => {
      // Check workspaceGroup or fallback to category.name
      const itemWorkspace = it.workspaceGroup || (it.category && typeof it.category === 'object' ? it.category.name : null)
      const inWs = workspace === 'All' || itemWorkspace === workspace
      const inSearch = !s || it.title?.toLowerCase().includes(s) || it.summary?.toLowerCase().includes(s) || it.url?.toLowerCase().includes(s)
      return inWs && inSearch
    })
  }, [data, workspace, search])


  const saveSettings = async (newSettings) => {
    try {
      const payload = {};
      if (newSettings.geminiApiKey?.trim()) payload.geminiApiKey = newSettings.geminiApiKey.trim();
      if (newSettings.serverUrl?.trim()) payload.serverUrl = newSettings.serverUrl.trim().replace(/\/$/, '');
      if (newSettings.visitCountThreshold !== '') payload.visitCountThreshold = Number(newSettings.visitCountThreshold) || 0;
      if (newSettings.historyMaxResults !== '') payload.historyMaxResults = Number(newSettings.historyMaxResults) || 1000;

      // Save to IndexedDB
      await saveSettingsDB(payload);
      // Mirror to chrome.storage.local for background/service worker compatibility
      try { await chrome.storage.local.set(payload) } catch (e) { console.warn('Could not save settings to chrome.storage.local', e) }

      setSettings(newSettings);
      setShowSettings(false);

      // Notify background script about the changes
      await chrome.runtime.sendMessage({
        action: 'settingsUpdated',
        settings: newSettings,
      });
    } catch (err) {
      if (err.message.includes('Receiving end does not exist')) {
        console.warn('Could not notify background script of settings change. It might be inactive.');
      } else {
        console.error('Error saving settings:', err);
      }
    }
  };

  // Delete URL(s) from the current workspace
  const handleDeleteFromWorkspace = async (baseUrl, values) => {
    try {
      if (!workspace || workspace === 'All') return;
      const norm = (s) => (s || '').trim().toLowerCase();
      const workspaces = await listWorkspaces();
      const ws = workspaces.find(w => norm(w.name) === norm(workspace));
      if (!ws) return;

      const urlsToRemove = new Set(values && values.length ? values.map(v => v.url) : [baseUrl]);
      const updated = {
        ...ws,
        urls: (ws.urls || []).filter(u => !urlsToRemove.has(u.url)),
      };
      await saveWorkspace(updated);
      const refreshed = await listWorkspaces();
      setSavedWorkspaces(Array.isArray(refreshed) ? refreshed : []);
    } catch (e) {
      console.error('Failed to delete from workspace:', e);
    }
  };

  const startEnrichment = async () => {
    setProgress({ running: true, processed: 0, total: 0, currentItem: '', apiHits: 0, error: '' })
    try {
      await chrome.runtime.sendMessage({
        action: 'enrichWithAI'
      })
    } catch (err) {
      if (err.message.includes('Receiving end does not exist')) {
        const error = 'Could not connect to the background service.'
        setProgress({ running: false, processed: 0, total: 0, currentItem: '', apiHits: 0, error })
        setTimeout(() => setProgress((p) => ({ ...p, error: '' })), 4000)
      } else {
        console.error('Error starting enrichment:', err)
      }
    }
  }

  const handleAddItemToWorkspace = async (item, workspaceName) => {
    await updateItemWorkspace(item.id, workspaceName);
    // Refresh data to reflect the change
    populate();
    setAddingToWorkspace(null);
  };

  const openInTab = () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage()
  }

  const handleAddRelated = async (url, title) => {
    setLoadingRelated(true);
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getRelated',
        context: { url, title, settings },
      });
      if (response?.ok) {
        setRelatedProducts(response.related);
      } else {
        console.error('Failed to get related products:', response?.error);
      }
    } catch (err) {
      if (err.message.includes('Receiving end does not exist')) {
        console.warn('Could not get related products. Service worker might be inactive.');
      } else {
        console.error('Error getting related products:', err);
      }
    } finally {
      setLoadingRelated(false);
    }
  };

  const clearRelatedProducts = () => {
    setRelatedProducts([])
  }

  // Save updated workspace (including systemPrompt) and refresh list
  const handleSaveWorkspacePrompt = async (updatedWorkspace) => {
    try {
      await saveWorkspace(updatedWorkspace);
      const ws = await listWorkspaces();
      setSavedWorkspaces(Array.isArray(ws) ? ws : []);
    } catch (e) {
      console.error('Failed to save workspace prompt', e);
    }
  }

  const handleOpenAddLinkModal = (ws) => {
    // Accept either a workspace object or a workspace name
    let resolved = ws;
    if (ws && typeof ws === 'string') {
      const norm = (s) => (s || '').trim().toLowerCase();
      resolved = savedWorkspaces.find(w => norm(w.name) === norm(ws));
      if (!resolved) {
        // Create a temporary workspace object (by name) to allow adding links
        resolved = { id: `name:${ws}`, name: ws, description: '', urls: [] };
      }
    }
    if (!resolved) {
      console.warn('Workspace not found for AddToWorkspaceModal:', ws);
      return;
    }
    setWorkspaceForLinkAdd(resolved);
    setShowAddLinkModal(true);
  };

  const handleCloseAddLinkModal = () => {
    setShowAddLinkModal(false);
    setWorkspaceForLinkAdd(null);
  };

  const handleSaveLink = async (workspaceId, newUrl) => {
    try {
      const workspaces = await listWorkspaces();
      let workspaceToUpdate = workspaces.find(ws => ws.id === workspaceId);

      // If not found by id, try resolving by name (when id is of form name:WorkspaceName)
      if (!workspaceToUpdate) {
        const byName = (typeof workspaceForLinkAdd?.name === 'string') ? workspaceForLinkAdd.name : null;
        if (byName) {
          const norm = (s) => (s || '').trim().toLowerCase();
          workspaceToUpdate = workspaces.find(ws => norm(ws.name) === norm(byName)) || null;
          if (!workspaceToUpdate) {
            // Create a new workspace
            workspaceToUpdate = {
              id: Date.now().toString(),
              name: byName,
              description: '',
              createdAt: Date.now(),
              urls: [],
              context: {},
            };
          }
        }
      }

      if (!workspaceToUpdate) {
        console.error('Workspace not found and could not resolve name');
        return;
      }

      // Avoid adding duplicate URLs
      if (Array.isArray(workspaceToUpdate.urls) && workspaceToUpdate.urls.some(u => u.url === newUrl)) {
        console.log('URL already exists in this workspace.');
        handleCloseAddLinkModal();
        return;
      }

      const updatedWorkspace = {
        ...workspaceToUpdate,
        urls: [
          ...(workspaceToUpdate.urls || []),
          {
            url: newUrl,
            title: newUrl, // Using URL as title for simplicity
            addedAt: Date.now(),
            favicon: getFaviconUrl(newUrl),
          },
        ],
      };

      await saveWorkspace(updatedWorkspace);
      // Refresh local list so the newly created workspace appears immediately
      const ws = await listWorkspaces();
      setSavedWorkspaces(Array.isArray(ws) ? ws : []);
      handleCloseAddLinkModal();
    } catch (err) {
      console.error('Error saving link to workspace:', err);
    }
  };

  // Flatten saved workspaces' URLs into items suitable for ItemGrid
  const savedUrlsFlat = useMemo(() => {
    const sourceWorkspaces = savedWsFilter === 'All'
      ? savedWorkspaces
      : savedWorkspaces.filter(ws => ws.name === savedWsFilter);

    return sourceWorkspaces.flatMap(ws =>
      (ws.urls || []).map(u => ({
        ...u,
        workspaceGroup: ws.name, // for filtering
        id: `${ws.id}-${u.url}` // for unique key
      }))
    );
  }, [savedWorkspaces, savedWsFilter]);

  // Saved items for the currently selected workspace (by name)
  const workspaceSavedItems = useMemo(() => {
    if (!workspace || workspace === 'All') return [];
    const ws = savedWorkspaces.find(w => (w?.name || '').trim().toLowerCase() === (workspace || '').trim().toLowerCase());
    if (!ws) return [];
    return (ws.urls || []).map(u => ({
      ...u,
      workspaceGroup: ws.name,
      id: `${ws.id}-${u.url}`,
    }));
  }, [savedWorkspaces, workspace]);

  // Merge history/data items in this workspace with saved URLs for this workspace
  const mergedWorkspaceItems = useMemo(() => {
    if (workspace === 'All') return filtered;
    const byUrl = new Map();
    for (const it of filtered) {
      if (it?.url) byUrl.set(it.url, it);
    }
    for (const it of workspaceSavedItems) {
      if (it?.url && !byUrl.has(it.url)) byUrl.set(it.url, it);
    }
    return Array.from(byUrl.values());
  }, [filtered, workspace, workspaceSavedItems]);

  const getCurrentTabInfo = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      setCurrentTab(tab)
      return tab
    } catch (err) {
      console.error('Error getting current tab:', err)
      return null
    }
  }

  const createWorkspace = async (workspaceName, description) => {
    try {
      const tab = await getCurrentTabInfo()
      if (!tab) return

      const workspace = {
        id: Date.now().toString(),
        name: workspaceName,
        description: description,
        createdAt: Date.now(),
        urls: [{
          url: tab.url,
          title: tab.title,
          addedAt: Date.now(),
          favicon: getFaviconUrl(tab.url)
        }],
        context: {
          domain: getDomainFromUrl(tab.url),
          createdFrom: 'current_tab'
        }
      }

      // Save to IndexedDB
      await saveWorkspace(workspace)

      // Update local state optimistically
      setSavedWorkspaces((prev) => {
        const exists = prev.some(w => w.id === workspace.id)
        return exists ? prev : [...prev, workspace]
      })

      // Close modal and refresh data
      setShowCreateWorkspace(false)
      // populate() reloads history/bookmarks, not needed for saved workspaces
    } catch (err) {
      console.error('Error creating workspace:', err)
    }
  }

  return (
    <div className="popup-wrap">
      <Header
        search={search}
        setSearch={setSearch}
        populate={populate}
        setShowSettings={setShowSettings}
        startEnrichment={startEnrichment}
        progress={progress}
        setShowCreateWorkspace={setShowCreateWorkspace}
        openInTab={openInTab}
      />

      {/* {savedWorkspaces.length > 0 && (
        <section className="saved-workspaces">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Saved Workspaces</h3>
            <button
              onClick={() => setShowSavedWorkspaces(v => !v)}
              className="add-link-btn"
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid #273043',
                background: '#1b2331',
                color: '#e5e7eb',
                fontSize: 12,
                lineHeight: '16px',
                cursor: 'pointer'
              }}
              title={showSavedWorkspaces ? 'Hide saved workspaces' : 'Show saved workspaces'}
            >
              {showSavedWorkspaces ? 'Hide' : 'Show'}
            </button>
          </div>
          {showSavedWorkspaces && (
            <>
              <WorkspaceFilters items={savedWorkspaces.map(ws => ({ workspaceGroup: ws.name }))} active={savedWsFilter} onChange={setSavedWsFilter} />
              <ItemGrid items={savedUrlsFlat} workspaces={savedWorkspaces} onAddRelated={handleAddRelated} onAddLink={handleOpenAddLinkModal} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setAddingToWorkspace(workspace)}
                  className="add-link-btn"
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: '1px solid #273043',
                    background: '#1b2331',
                    color: '#e5e7eb',
                    fontSize: 12,
                    lineHeight: '16px',
                    cursor: 'pointer'
                  }}
                  title="Add link"
                >
                  +
                </button>
                <button
                  onClick={startEnrichment}
                  className="add-link-btn"
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: '1px solid #273043',
                    background: '#1b2331',
                    color: '#e5e7eb',
                    fontSize: 12,
                    lineHeight: '16px',
                    cursor: 'pointer'
                  }}
                  title="Organize using AI"
                >
                  Enhance
                </button>
              </div>
              
      {/* Filters */}
      <div style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Workspace:</span>
          <WorkspaceFilters items={data} active={workspace} onChange={setWorkspace} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Saved:</span>
          <WorkspaceFilters items={savedWorkspaces.map(ws => ({ workspaceGroup: ws.name }))} active={savedWsFilter} onChange={setSavedWsFilter} />
        </div>
      </div>


      {progress.running && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress.total ? (progress.processed / progress.total) * 100 : 0}%` }} />
          <div className="progress-text">{progress.processed}/{progress.total} (API {progress.apiHits}) — {progress.currentItem}</div>
        </div>
      )}

      {progress.error && <div className="error">{progress.error}</div>}

      {/* Saved Workspaces section */}
      {workspace === 'All' && (savedWorkspaces.length > 0 ? (
        <section className="saved-workspaces">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>
              Saved Workspaces
              {savedWsFilter && savedWsFilter !== 'All' && (
                <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.8 }}>
                  • Filter: {savedWsFilter} ({savedUrlsFlat.length})
                </span>
              )}
            </h3>
            <button
              onClick={() => setShowSavedWorkspaces(v => !v)}
              className="add-link-btn"
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid #273043',
                background: '#1b2331',
                color: '#e5e7eb',
                fontSize: 12,
                lineHeight: '16px',
                cursor: 'pointer'
              }}
              title={showSavedWorkspaces ? 'Hide saved workspaces' : 'Show saved workspaces'}
            >
              {showSavedWorkspaces ? 'Hide' : 'Show'}
            </button>
          </div>
          {showSavedWorkspaces && (
            <>
              <ItemGrid key={`saved-${savedWsFilter}`} items={savedUrlsFlat} workspaces={savedWorkspaces} onAddRelated={handleAddRelated} onAddLink={handleOpenAddLinkModal} />
            </>
          )}
        </section>
      ) : (
        <div className="empty">No saved workspaces</div>
      ))}

      {/* Workspace section (only when a specific workspace is selected) */}
      {workspace !== 'All' && (
        loading ? (
          <div className="empty">Loading...</div>
        ) : (
          <>
            {showSystemPrompt && (
              <SystemPrompt
                workspaceName={workspace}
                workspaces={savedWorkspaces}
                onSave={handleSaveWorkspacePrompt}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 0 8px' }}>
              <span style={{ opacity: 0.85, fontSize: 12 }}>Workspace: {workspace} ({mergedWorkspaceItems.length})</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowSystemPrompt(v => !v)} className="add-link-btn">
                  {showSystemPrompt ? 'Hide Prompt' : 'Prompt'}
                </button>
                <button onClick={() => setShowCurrentWorkspace(v => !v)} className="add-link-btn">
                  {showCurrentWorkspace ? 'Hide Workspace' : 'Show Workspace'}
                </button>
              </div>
            </div>
            {showCurrentWorkspace && (
              <>
                <ItemGrid items={mergedWorkspaceItems} workspaces={savedWorkspaces} onAddRelated={handleAddRelated} onAddLink={() => handleOpenAddLinkModal(workspace)} onDelete={handleDeleteFromWorkspace} />
                <RelatedProductsSection relatedItems={relatedProducts} onClear={clearRelatedProducts} />
                <div style={{ display: 'flex', gap: 8, marginTop: '14px' }}>
                  <button onClick={() => handleOpenAddLinkModal(workspace)} className="add-link-btn">+ Add Link</button>
                  <button onClick={startEnrichment} className="add-link-btn">Organize using AI</button>
                </div>
              </>
            )}
          </>
        )
      )}

      {addingToWorkspace && (
        <AddLinkFlow
          allItems={data}
          currentWorkspace={addingToWorkspace}
          onAdd={handleAddItemToWorkspace}
          onCancel={() => setAddingToWorkspace(null)}
        />
      )}

      {loadingRelated && (
        <div className="loading-related">
          <div className="loading-spinner"></div>
          <span>Finding related products...</span>
        </div>
      )}

      <AddToWorkspaceModal
        show={showAddLinkModal}
        workspace={workspaceForLinkAdd}
        onClose={handleCloseAddLinkModal}
        onSave={handleSaveLink}
        suggestions={data.filter(it => !it.workspaceGroup)}
      />

      <CreateWorkspaceModal
        show={showCreateWorkspace}
        onClose={() => setShowCreateWorkspace(false)}
        onCreate={createWorkspace}
        currentTab={currentTab}
      />

      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={saveSettings}
      />


    </div>
  )
}
