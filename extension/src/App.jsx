import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { CreateWorkspaceModal } from './components/CreateWorkspaceModal';
import { ItemGrid } from './components/ItemGrid';
import { RelatedProductsSection } from './components/RelatedProductsSection';
import { SettingsModal } from './components/SettingsModal';
import { StatsView } from './components/StatsView';
import { WorkspaceFilters } from './components/WorkspaceFilters';
import { Header } from './components/Header';
import { AddToWorkspaceModal } from './components/AddToWorkspaceModal';


import { getSettings as getSettingsDB, listWorkspaces, saveSettings as saveSettingsDB, saveWorkspace, subscribeWorkspaceChanges } from './db';
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

  const [showAddLinkModal, setShowAddLinkModal] = useState(false)
  const [workspaceForLinkAdd, setWorkspaceForLinkAdd] = useState(null)


  const [currentTab, setCurrentTab] = useState(null)
  const [savedWorkspaces, setSavedWorkspaces] = useState([])

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

  const startEnrichment = async () => {
    setProgress({ running: true, processed: 0, total: 0, currentItem: '', apiHits: 0, error: '' })
    try {
      await chrome.runtime.sendMessage({
        action: 'runAiEnrichment',
        context: {
          items: data,
          workspaces: savedWorkspaces,
          settings: settings,
        },
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

  const handleOpenAddLinkModal = (workspace) => {
    setWorkspaceForLinkAdd(workspace);
    setShowAddLinkModal(true);
  };

  const handleCloseAddLinkModal = () => {
    setShowAddLinkModal(false);
    setWorkspaceForLinkAdd(null);
  };

  const handleSaveLink = async (workspaceId, newUrl) => {
    try {
      const workspaces = await listWorkspaces();
      const workspaceToUpdate = workspaces.find(ws => ws.id === workspaceId);

      if (!workspaceToUpdate) {
        console.error('Workspace not found');
        return;
      }

      // Avoid adding duplicate URLs
      if (workspaceToUpdate.urls.some(u => u.url === newUrl)) {
        console.log('URL already exists in this workspace.');
        handleCloseAddLinkModal();
        return;
      }

      const updatedWorkspace = {
        ...workspaceToUpdate,
        urls: [
          ...workspaceToUpdate.urls,
          {
            url: newUrl,
            title: newUrl, // Using URL as title for simplicity
            addedAt: Date.now(),
            favicon: getFaviconUrl(newUrl),
          },
        ],
      };

      await saveWorkspace(updatedWorkspace);
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

      {savedWorkspaces.length > 0 && (
        <section className="saved-workspaces">
          <h3>Saved Workspaces</h3>
          <WorkspaceFilters items={savedWorkspaces.map(ws => ({ workspaceGroup: ws.name }))} active={savedWsFilter} onChange={setSavedWsFilter} />
          <ItemGrid items={savedUrlsFlat} workspaces={savedWorkspaces} onAddRelated={handleAddRelated} onAddLink={handleOpenAddLinkModal} />
        </section>
      )}

      <WorkspaceFilters items={data} active={workspace} onChange={setWorkspace} />

      {progress.running && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress.total ? (progress.processed / progress.total) * 100 : 0}%` }} />
          <div className="progress-text">{progress.processed}/{progress.total} (API {progress.apiHits}) — {progress.currentItem}</div>
        </div>
      )}

      {progress.error && <div className="error">{progress.error}</div>}

      {loading ? (
        <div className="empty">Loading...</div>
      ) : workspace === 'All' ? (
        <>
          <StatsView items={data} search={search} workspace={workspace} onAddRelated={handleAddRelated} />
          <RelatedProductsSection relatedItems={relatedProducts} onClear={clearRelatedProducts} />
        </>
      ) : (
        <>
          <ItemGrid items={filtered} workspaces={savedWorkspaces} onAddRelated={handleAddRelated} />
          <RelatedProductsSection relatedItems={relatedProducts} onClear={clearRelatedProducts} />
        </>
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
