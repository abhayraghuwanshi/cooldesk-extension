import { faPlus, faRotateRight, faTrash, faTriangleExclamation, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { AddToWorkspaceModal } from './components/AddToWorkspaceModal';
import { CreateWorkspaceModal } from './components/CreateWorkspaceModal';
import { Header } from './components/Header';
import { ItemGrid } from './components/ItemGrid';
import { RelatedProductsSection } from './components/RelatedProductsSection';
import { SettingsModal } from './components/SettingsModal';
import { SyncControlsModal } from './components/SyncControlsModal';
import { SystemPrompt } from './components/SystemPrompt';
import { WorkspaceFilters } from './components/WorkspaceFilters';
import './search.css';


import { ActivityPanel } from './components/ActivityPanel';
import { AddLinkFlow } from './components/AddLinkFlow';
import { deleteWorkspaceById, getSettings as getSettingsDB, getUIState, listWorkspaces, saveSettings as saveSettingsDB, saveUIState, saveWorkspace, subscribeWorkspaceChanges, updateItemWorkspace } from './db';
import { useDashboardData } from './hooks/useDashboardData';
import { focusWindow, getHostDashboard, getHostSettings, getProcesses, hasRuntime, onMessage, openOptionsPage, sendMessage, setHostSettings, setHostTabs, storageGet, storageRemove, storageSet, tabs } from './services/extensionApi';
import { getDomainFromUrl, getFaviconUrl, getUrlParts } from './utils';

// Simple error boundary to prevent entire app crash due to child errors
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error" style={{ marginTop: 8 }}>
          <div>Something went wrong while rendering this section.</div>
          {this.state.error && (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
              {String(this.state.error.message || this.state.error)}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button
              className="add-link-btn"
              style={{ padding: '4px 8px' }}
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Main App Component
export default function App() {
  const { data, loading, refreshing, populate } = useDashboardData()
  const [workspace, setWorkspace] = useState('All')
  const [search, setSearch] = useState('')
  const [focusSearchTick, setFocusSearchTick] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState({ geminiApiKey: '', modelName: '', visitCountThreshold: '', historyDays: '' })
  const [progress, setProgress] = useState({ running: false, processed: 0, total: 0, currentItem: '', apiHits: 0, error: '' })
  const [relatedProducts, setRelatedProducts] = useState([])
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
  const [activeSection, setActiveSection] = useState(0) // Index for ActivityPanel sections
  const [processes, setProcesses] = useState([])
  const [showSyncControls, setShowSyncControls] = useState(false)

  // Keep a live ref of progress.running so interval callbacks see the latest value
  const progressRunningRef = useRef(false);
  useEffect(() => { progressRunningRef.current = !!progress.running; }, [progress.running]);

  // UI state: dismissible settings warning
  const [dismissedSettingsWarning, setDismissedSettingsWarning] = useState(false)


  // Side panel visibility control via runtime messages (default: open)
  const [showPanel, setShowPanel] = useState(true)
  useEffect(() => {
    const handler = (req) => {
      switch (req?.action) {
        case 'showPanel': setShowPanel(true); break;
        case 'hidePanel': setShowPanel(false); break;
        case 'togglePanel': setShowPanel(v => !v); break;
        default: break;
      }
    };
    if (hasRuntime()) {
      onMessage.add(handler);
      return () => onMessage.remove(handler);
    } else {
      // Fallback in app/non-extension context: show panel by default
      setShowPanel(true);
      return () => { };
    }
  }, [])

  // Auto Sync: when enabled in UI state, trigger Bulk Sync on load and periodically
  useEffect(() => {
    let disposed = false;
    let intervalId = null;
    (async () => {
      try {
        const ui = await getUIState();
        const initialOn = ui?.autoSync === true || ui?.autoSync === undefined; // default ON if missing
        if (initialOn && !disposed && !progressRunningRef.current) {
          try { await handleBulkSync(); } catch { /* ignore */ }
        }

        // Schedule periodic bulk runs; check latest UI state each tick
        const PERIOD_MS = 5 * 60 * 1000; // 5 minutes
        intervalId = setInterval(async () => {
          if (disposed) return;
          try {
            const latest = await getUIState();
            const enabled = latest?.autoSync === true || latest?.autoSync === undefined; // default ON if missing
            if (enabled && !progressRunningRef.current) {
              handleBulkSync();
            }
          } catch { /* ignore */ }
        }, PERIOD_MS);
      } catch { /* ignore */ }
    })();
    return () => { disposed = true; if (intervalId) clearInterval(intervalId); };
  }, [])

  // Populate settings on load from host (Electron app API), then mirror locally
  useEffect(() => {
    (async () => {
      try {
        const res = await getHostSettings();
        if (res?.ok && res.settings && Object.keys(res.settings).length) {
          const s = res.settings;
          setSettings({
            geminiApiKey: s.geminiApiKey || '',
            modelName: s.modelName || '',
            visitCountThreshold: Number.isFinite(s.visitCountThreshold) ? String(s.visitCountThreshold) : ''
          });
          try {
            const payload = {
              ...(s.geminiApiKey ? { geminiApiKey: s.geminiApiKey } : {}),
              ...(s.modelName ? { modelName: s.modelName } : {}),
              ...(Number.isFinite(s.visitCountThreshold) ? { visitCountThreshold: s.visitCountThreshold } : {}),
            };
            await saveSettingsDB(payload);
            await storageSet(payload);
          } catch { }
        }
      } catch { }
    })();
  }, [])

  // Populate dashboard on load from host and notify listeners
  useEffect(() => {
    (async () => {
      try {
        const res = await getHostDashboard();
        const dash = res?.ok ? res.dashboard : null;
        if (dash && (Array.isArray(dash.history) || Array.isArray(dash.bookmarks))) {
          try {
            await storageSet({ dashboardData: dash });
            await sendMessage({ action: 'updateData' });
          } catch { }
        }
      } catch { }
    })();
  }, [])

  // Poll running processes from the host app
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await getProcesses();
        if (!cancelled && Array.isArray(list)) setProcesses(list);
      } catch {
        // ignore
      }
    };
    // Always attempt an initial load
    load();
    // Use lower frequency inside Chrome extension to reduce traffic
    const intervalMs = hasRuntime() ? 30000 : 15000;
    const id = setInterval(load, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [])

  // Mirror Chrome tabs to host (/tabs) so Electron app can read them
  useEffect(() => {
    // Only in extension context with chrome.tabs available
    const canUseTabs = typeof chrome !== 'undefined' && chrome?.tabs;
    if (!canUseTabs) return;

    let disposed = false;

    const pushTabs = async () => {
      try {
        const res = await tabs.query({});
        if (!disposed && res?.ok && Array.isArray(res.tabs)) {
          await setHostTabs(res.tabs);
        }
      } catch { /* noop */ }
    };

    // Initial push
    pushTabs();

    // Periodic sync
    const interval = setInterval(pushTabs, 15000);

    // Event-driven sync
    const handlers = [];
    try {
      if (chrome.tabs?.onCreated?.addListener) {
        const h = () => pushTabs();
        chrome.tabs.onCreated.addListener(h); handlers.push(['onCreated', h]);
      }
      if (chrome.tabs?.onUpdated?.addListener) {
        const h = () => pushTabs();
        chrome.tabs.onUpdated.addListener(h); handlers.push(['onUpdated', h]);
      }
      if (chrome.tabs?.onRemoved?.addListener) {
        const h = () => pushTabs();
        chrome.tabs.onRemoved.addListener(h); handlers.push(['onRemoved', h]);
      }
      if (chrome.tabs?.onActivated?.addListener) {
        const h = () => pushTabs();
        chrome.tabs.onActivated.addListener(h); handlers.push(['onActivated', h]);
      }
    } catch { /* ignore */ }

    return () => {
      disposed = true;
      clearInterval(interval);
      try {
        for (const [evt, h] of handlers) {
          const obj = chrome.tabs?.[evt];
          if (obj?.removeListener) obj.removeListener(h);
        }
      } catch { /* ignore */ }
    };
  }, [])

  // Prefill search from URL (?q=...) when opened in side panel or new tab
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const q = (params.get('q') || '').trim()
      if (q) setSearch(q)
    } catch { }
  }, [])

  // Also hydrate from chrome.storage.local 'pendingQuery' (set by Header when opening side panel)
  useEffect(() => {
    (async () => {
      try {
        const { pendingQuery } = await storageGet(['pendingQuery'])
        const q = (pendingQuery || '').trim()
        if (q) {
          setSearch(q)
          // Clear after consumption
          try { await storageRemove('pendingQuery') } catch { }
        }
      } catch { }
    })()
  }, [])

  useEffect(() => {
    // Load settings initially from IndexedDB
    (async () => {
      const s = await getSettingsDB()
      const { geminiApiKey, modelName, visitCountThreshold, historyDays } = s || {}
      setSettings({
        geminiApiKey: geminiApiKey || '',
        modelName: modelName || '',
        visitCountThreshold: Number.isFinite(visitCountThreshold) ? String(visitCountThreshold) : '',
        historyDays: Number.isFinite(historyDays) ? String(historyDays) : ''
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

      // After loading local settings, mirror to host so app sees them
      ; (async () => {
        try {
          const s = await getSettingsDB();
          if (s && Object.keys(s).length) {
            await setHostSettings(s);
          }
        } catch { }
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
      } else if (req?.action === 'focusSearch') {
        // Trigger focusing the bottom search box
        setFocusSearchTick((t) => t + 1);
      }
    }
    onMessage.add(onMsg)

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
      onMessage.remove(onMsg)
      unsubscribe && unsubscribe()
    }
  }, [])

  // Restore last selected tab and workspace on mount (IndexedDB)
  useEffect(() => {
    (async () => {
      try {
        const ui = await getUIState();
        if (ui?.lastActiveTab === 'workspace' || ui?.lastActiveTab === 'saved') {
          setActiveTab(ui.lastActiveTab);
        }
        if (typeof ui?.lastWorkspace === 'string' && ui.lastWorkspace) {
          setWorkspace(ui.lastWorkspace);
        }
      } catch { }
    })();
  }, [])

  // Persist activeTab whenever it changes (IndexedDB)
  useEffect(() => {
    (async () => {
      try {
        await saveUIState({ lastActiveTab: activeTab, lastWorkspace: workspace });
      } catch { }
    })();
  }, [activeTab])

  // Persist selected workspace whenever it changes (IndexedDB)
  useEffect(() => {
    (async () => {
      try {
        await saveUIState({ lastActiveTab: activeTab, lastWorkspace: workspace });
      } catch { }
    })();
  }, [workspace])

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
      const g = it.workspaceGroup
      if (g) set.add(g)
    }
    return Array.from(set)
  }, [data])

  // Items to build the workspace filter options: only saved workspaces + 'All'
  const filterItems = useMemo(() => {
    const all = [{ workspaceGroup: 'All' }];
    const extras = savedWorkspaces.map(ws => ({ workspaceGroup: ws.name }));
    return [...all, ...extras];
  }, [savedWorkspaces])

  // Guard: if current workspace isn't a saved workspace (and not 'All'), reset to 'All'
  useEffect(() => {
    if (workspace === 'All') return;
    const exists = savedWorkspaces.some(ws => (ws?.name || '').trim().toLowerCase() === (workspace || '').trim().toLowerCase());
    if (!exists) setWorkspace('All');
  }, [savedWorkspaces])

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
    const norm = (v) => (v || '').trim().toLowerCase()
    const active = norm(workspace)
    return data.filter((it) => {
      // Only use explicit workspaceGroup; do not fallback to category.name
      const itemWorkspace = norm(it.workspaceGroup)
      const inWs = active === 'all' || itemWorkspace === active
      const inSearch = !s || it.title?.toLowerCase().includes(s) || it.summary?.toLowerCase().includes(s) || it.url?.toLowerCase().includes(s)
      return inWs && inSearch
    })
  }, [data, workspace, search])


  const saveSettings = async (newSettings) => {
    try {
      const payload = {};
      if (newSettings.geminiApiKey?.trim()) payload.geminiApiKey = newSettings.geminiApiKey.trim();
      if (newSettings.modelName?.trim()) payload.modelName = newSettings.modelName.trim();
      if (newSettings.visitCountThreshold !== '') payload.visitCountThreshold = Number(newSettings.visitCountThreshold) || 0;
      if (newSettings.historyDays !== '') payload.historyDays = Number(newSettings.historyDays) || 30;

      // Save to IndexedDB
      await saveSettingsDB(payload);
      // Mirror to storage for background/service worker compatibility
      try { await storageSet(payload) } catch (e) { console.warn('Could not save settings to storage', e) }
      // Push to host so Electron app stays in sync
      try { await setHostSettings(payload) } catch { }

      setSettings(newSettings);
      setShowSettings(false);

      // Notify background script about the changes
      try {
        await sendMessage({ action: 'settingsUpdated', settings: newSettings })
      } catch (e) { /* ignore */ }
    } catch (err) {
      if (err.message.includes('Receiving end does not exist')) {
        console.warn('Could not notify background script of settings change. It might be inactive.');
      } else {
        console.error('Error saving settings:', err);
      }
    }
  };

  // Save an arbitrary URL (not from history/bookmarks) into a workspace by name
  const handleAddSavedUrlToWorkspace = async (newUrl, workspaceName) => {
    try {
      try { console.log('[App] handleAddSavedUrlToWorkspace: start', { newUrl, workspaceName }); } catch { }
      const workspaces = await listWorkspaces();
      try { console.log('[App] handleAddSavedUrlToWorkspace: existing workspaces', { count: Array.isArray(workspaces) ? workspaces.length : 0 }); } catch { }
      const norm = (s) => (s || '').trim().toLowerCase();
      let ws = workspaces.find(w => norm(w.name) === norm(workspaceName));
      if (!ws) {
        ws = {
          id: Date.now().toString(),
          name: workspaceName,
          description: '',
          createdAt: Date.now(),
          urls: [],
          context: {},
        };
        try { console.log('[App] handleAddSavedUrlToWorkspace: creating new workspace', { id: ws.id, name: ws.name }); } catch { }
      } else {
        try { console.log('[App] handleAddSavedUrlToWorkspace: found workspace', { id: ws.id, name: ws.name, urls: (ws.urls || []).length }); } catch { }
      }
      // Prevent duplicate URL entries
      if (!Array.isArray(ws.urls)) ws.urls = [];
      if (ws.urls.some(u => u.url === newUrl)) {
        try { console.warn('[App] handleAddSavedUrlToWorkspace: duplicate URL, skipping'); } catch { }
        setAddingToWorkspace(null);
        return;
      }
      const updated = {
        ...ws,
        urls: [
          ...ws.urls,
          { url: newUrl, title: newUrl, addedAt: Date.now(), favicon: getFaviconUrl(newUrl) },
        ],
      };
      try { console.log('[App] handleAddSavedUrlToWorkspace: saving workspace', { id: updated.id, name: updated.name, urls: updated.urls.length }); } catch { }
      await saveWorkspace(updated);
      try { console.log('[App] handleAddSavedUrlToWorkspace: save complete, reloading list'); } catch { }
      const refreshed = await listWorkspaces();
      try {
        console.log('[App] handleAddSavedUrlToWorkspace: refreshed workspaces', { count: Array.isArray(refreshed) ? refreshed.length : 0 });
      } catch { }
      setSavedWorkspaces(Array.isArray(refreshed) ? refreshed : []);
      try { alert('Link added to workspace'); } catch { }
    } catch (e) {
      console.error('Failed to add URL to workspace:', e);
      try { alert('Failed to add link. See console for details.'); } catch { }
    } finally {
      setAddingToWorkspace(null);
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

      // Remove any saved URL that either:
      // - exactly matches one of the group's value URLs, or
      // - has the same normalized base (scheme + eTLD+1) as the group base
      const urlsToRemove = new Set(values && values.length ? values.map(v => v.url) : [baseUrl]);
      const baseKey = getUrlParts(baseUrl).key;
      const updated = {
        ...ws,
        urls: (ws.urls || []).filter(u => {
          const uKey = getUrlParts(u.url).key;
          const matchByBase = uKey === baseKey;
          const matchByExact = urlsToRemove.has(u.url);
          return !(matchByBase || matchByExact);
        }),
      };
      await saveWorkspace(updated);
      // Also re-categorize underlying items to 'Unknown' so they no longer belong to this workspace
      try {
        const syntheticPrefix = `${ws.id}-`;
        const toUpdate = Array.isArray(values) ? values.filter(v => typeof v?.id === 'string' ? !v.id.startsWith(syntheticPrefix) : !!v?.id) : [];
        await Promise.all(toUpdate.map(v => updateItemWorkspace(v.id, 'Unknown')));
      } catch { }
      const refreshed = await listWorkspaces();
      setSavedWorkspaces(Array.isArray(refreshed) ? refreshed : []);
      
      // Trigger data refresh to update UI
      try {
        await sendMessage({ action: 'updateData' });
        populate(); // Refresh the dashboard data
      } catch (e) {
        console.warn('Failed to refresh data after deletion:', e);
      }
    } catch (e) {
      console.error('Failed to delete from workspace:', e);
    }
  };

  const startEnrichment = async () => {
    setProgress({ running: true, processed: 0, total: 0, currentItem: '', apiHits: 0, error: '' })
    try {
      const res = await sendMessage({ action: 'enrichWithAI' })
      if (!res?.ok) throw new Error(res?.error || 'Failed to start enrichment')
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

  const startCategoryEnrichment = async (category) => {
    setProgress({ running: true, processed: 0, total: 0, currentItem: '', apiHits: 0, error: '' })
    try {
      const res = await sendMessage({ action: 'enrichWithAICategory', category })
      if (!res?.ok) throw new Error(res?.error || 'Failed to start category enrichment')
    } catch (err) {
      if (err.message.includes('Receiving end does not exist')) {
        const error = 'Could not connect to the background service.'
        setProgress({ running: false, processed: 0, total: 0, currentItem: '', apiHits: 0, error })
        setTimeout(() => setProgress((p) => ({ ...p, error: '' })), 4000)
      } else {
        console.error('Error starting category enrichment:', err)
      }
    }
  }

  // Handlers for SyncControlsModal (granular pre-control layer)
  const handleBulkSync = async () => {
    await startEnrichment();
  };
  const handleRecategorize = async () => {
    // For now, reuse enrichment pipeline; background should respect recategorization flags if any
    await startEnrichment();
  };
  const handleSingleCategorySync = async (category) => {
    await startCategoryEnrichment(category);
  };

  const handleAddItemToWorkspace = async (item, workspaceName) => {
    try {
      try { console.log('[App] handleAddItemToWorkspace: start', { itemId: item?.id, url: item?.url, workspaceName }); } catch { }
      // 1) Tag the history/bookmark item
      await updateItemWorkspace(item.id, workspaceName);
      // Optimistically patch storage.dashboardData so UI updates immediately
      try {
        const { dashboardData } = await storageGet(['dashboardData']);
        if (dashboardData && Array.isArray(dashboardData.history)) {
          const patch = (arr) => arr.map((it) => it.url === item.url ? { ...it, workspaceGroup: workspaceName } : it);
          const updated = {
            ...dashboardData,
            history: patch(dashboardData.history || []),
            bookmarks: patch(dashboardData.bookmarks || []),
          };
          await storageSet({ dashboardData: updated });
          // Notify listeners to reload data
          await sendMessage({ action: 'updateData' });
        }
      } catch (e) { try { console.warn('[App] handleAddItemToWorkspace: storage patch failed', e); } catch { } }

      // 2) Also persist URL into saved Workspaces (so workspace view shows it)
      const workspaces = await listWorkspaces();
      const norm = (s) => (s || '').trim().toLowerCase();
      let ws = workspaces.find(w => norm(w.name) === norm(workspaceName));
      if (!ws) {
        ws = {
          id: Date.now().toString(),
          name: workspaceName,
          description: '',
          createdAt: Date.now(),
          urls: [],
          context: {},
        };
        try { console.log('[App] handleAddItemToWorkspace: creating new workspace', { id: ws.id, name: ws.name }); } catch { }
      }
      const url = item?.url;
      if (url) {
        if (!Array.isArray(ws.urls)) ws.urls = [];
        const already = ws.urls.some(u => u.url === url);
        if (!already) {
          ws = {
            ...ws,
            urls: [
              ...ws.urls,
              { url, title: item.title || url, addedAt: Date.now(), favicon: getFaviconUrl(url) },
            ],
          };
          try { console.log('[App] handleAddItemToWorkspace: saving workspace with new URL', { id: ws.id, name: ws.name, urls: ws.urls.length }); } catch { }
          await saveWorkspace(ws);
          const refreshed = await listWorkspaces();
          setSavedWorkspaces(Array.isArray(refreshed) ? refreshed : []);
        } else {
          try { console.log('[App] handleAddItemToWorkspace: URL already saved, skipping save'); } catch { }
        }
      }
    } catch (e) {
      console.error('Failed to add item to workspace:', e);
    } finally {
      setAddingToWorkspace(null);
    }
  };

  const openInTab = async () => {
    try { await openOptionsPage() } catch { /* noop */ }
  }

  const handleAddRelated = async (url, title) => {
    setLoadingRelated(true);
    try {
      const response = await sendMessage({ action: 'getRelated', context: { url, title, settings } })
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

  // Delete the currently selected workspace entirely
  const handleDeleteWorkspace = async () => {
    try {
      const name = (workspace || '').trim();
      if (!name || name.toLowerCase() === 'all') {
        try { alert('Please select a specific workspace to delete.'); } catch { }
        return;
      }
      const confirmMsg = `Delete workspace "${name}"? This cannot be undone.`;
      const confirmed = (() => { try { return window.confirm(confirmMsg); } catch { return true; } })();
      if (!confirmed) return;

      const norm = (s) => (s || '').trim().toLowerCase();
      const wsObj = savedWorkspaces.find(w => norm(w.name) === norm(name));
      if (!wsObj) {
        try { alert('Workspace not found.'); } catch { }
        return;
      }

      // Recategorize underlying items tagged to this workspace to 'Unknown' (best-effort)
      try {
        const candidates = Array.isArray(data) ? data.filter(it => norm(it.workspaceGroup) === norm(name)) : [];
        const valid = candidates.filter(it => typeof it?.id === 'string' && it.id);
        await Promise.all(valid.map(it => updateItemWorkspace(it.id, 'Unknown')));
        // Patch local storage/dashboard data optimistically
        try {
          const { dashboardData } = await storageGet(['dashboardData']);
          if (dashboardData) {
            const patch = (arr) => (Array.isArray(arr) ? arr.map(it => norm(it.workspaceGroup) === norm(name) ? { ...it, workspaceGroup: 'Unknown' } : it) : arr);
            await storageSet({ dashboardData: { ...dashboardData, history: patch(dashboardData.history), bookmarks: patch(dashboardData.bookmarks) } });
            await sendMessage({ action: 'updateData' });
          }
        } catch { }
      } catch { }

      // Delete workspace from IndexedDB/backup and broadcast
      await deleteWorkspaceById(wsObj.id);

      // Refresh list and switch to All
      const refreshed = await listWorkspaces();
      setSavedWorkspaces(Array.isArray(refreshed) ? refreshed : []);
      setWorkspace('All');
    } catch (e) {
      console.error('Failed to delete workspace:', e);
      try { alert('Failed to delete workspace. See console for details.'); } catch { }
    }
  };

  const handleOpenAddLinkModal = (ws) => {
    try {
      // Accept either a workspace object or a workspace name
      let resolved = ws;
      if (ws && typeof ws === 'string') {
        const norm = (s) => (s || '').trim().toLowerCase();
        resolved = savedWorkspaces.find(w => norm(w.name) === norm(ws));
        if (!resolved) {
          console.warn('Workspace not found for AddToWorkspaceModal:', ws);
          return;
        }
      }
      // Prevent adding links to the reserved "All" view
      const nameLower = (resolved?.name || '').trim().toLowerCase();
      if (nameLower === 'all') {
        try { alert('Please select a specific workspace before adding links.'); } catch { }
        return;
      }
      // Open the in-page AddLinkFlow so the user can search history/bookmarks to add
      setAddingToWorkspace(resolved.name);
      try { console.log('[App] handleOpenAddLinkModal: modal opened', { addingTo: resolved.name }); } catch { }
    } catch (e) {
      console.error('Failed to open add link modal:', e);
    }
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
    const norm = (v) => (v || '').trim().toLowerCase()
    const active = norm(workspace)
    const sourceWorkspaces = active === 'all'
      ? savedWorkspaces
      : savedWorkspaces.filter(ws => norm(ws.name) === active);

    return sourceWorkspaces.flatMap(ws =>
      (ws.urls || []).map(u => ({
        ...u,
        workspaceGroup: ws.name, // for filtering
        id: `${ws.id}-${u.url}` // for unique key
      }))
    );
  }, [savedWorkspaces, workspace]);

  // For 'All' view, merge history/bookmarks with all saved URLs and de-duplicate by URL
  const allItemsCombined = useMemo(() => {
    const map = new Map();
    for (const it of filtered) {
      if (it?.url) map.set(it.url, it);
    }
    for (const it of savedUrlsFlat) {
      if (it?.url && !map.has(it.url)) map.set(it.url, it);
    }
    return Array.from(map.values());
  }, [filtered, savedUrlsFlat]);

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
      const res = await tabs.query({ active: true, currentWindow: true })
      const tab = (res.ok && Array.isArray(res.tabs) && res.tabs.length) ? res.tabs[0] : null
      if (tab) setCurrentTab(tab)
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

      // Switch current filter to the newly created workspace so subsequent actions apply to it
      setWorkspace(workspaceName)

      // Close modal and refresh data
      setShowCreateWorkspace(false)
      // populate() reloads history/bookmarks, not needed for saved workspaces
    } catch (err) {
      console.error('Error creating workspace:', err)
    }
  }

  // (Removed) handleWorkspaceFilterChange: unused effect placeholder

  // Open the extension side panel and pass the current query via storage
  const openInSidePanel = async (overrideQuery) => {
    try {
      const q = (overrideQuery != null ? String(overrideQuery) : search || '').trim();
      try { await chrome.storage.local.set({ pendingQuery: q }); } catch { }
      if (chrome?.sidePanel?.setOptions) {
        await chrome.sidePanel.setOptions({ path: 'index.html', enabled: true });
      }
      if (chrome?.windows?.getCurrent && chrome?.sidePanel?.open) {
        const win = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: win.id });
      }
    } catch (err) {
      console.error('Open side panel failed:', err);
      try {
        const q = (overrideQuery != null ? String(overrideQuery) : search || '').trim();
        try { await chrome.storage.local.set({ pendingQuery: q }); } catch { }
        if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' });
      } catch { }
    }
  };

  return (
    <div className="popup-wrap bg-ai-midnight-nebula" style={{ paddingBottom: 64 }}>
      <SyncControlsModal
        show={showSyncControls}
        onClose={() => setShowSyncControls(false)}
        onBulkSync={handleBulkSync}
        onRecategorize={handleRecategorize}
        onSingleCategorySync={handleSingleCategorySync}
        categories={(Array.isArray(savedWorkspaces) ? savedWorkspaces : []).map(ws => ws.name).filter(Boolean)}
        progress={progress}
      />

      {/* Warning: Require Gemini API key for AI features */}
      {(() => {
        const missingApi = !(settings?.geminiApiKey || '').trim();
        const shouldShow = missingApi && !dismissedSettingsWarning;
        if (!shouldShow) return null;
        return (
          <div
            role="alert"
            style={{
              margin: '8px 0 4px',
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(255, 193, 7, 0.12)',
              border: '1px solid rgba(255, 193, 7, 0.35)',
              color: 'rgb(255, 213, 0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <div style={{ fontSize: 13, lineHeight: 1.3, color: '#ffd500' }}>Add a Gemini API key in Settings to enable AI features.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="add-link-btn"
                style={{ padding: '4px 8px' }}
                onClick={() => setShowSettings(true)}
              >
                Open Settings
              </button>
              <button
                className="icon-btn"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => setDismissedSettingsWarning(true)}
                style={{ padding: '4px 8px' }}
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })()}

      {/* Filters */}
      <div style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* <span style={{ fontSize: 12, opacity: 0.8 }}>Workspace:</span> */}
          <WorkspaceFilters items={filterItems} active={workspace} onChange={setWorkspace} />
          {/* Reload data */}
          <button
            onClick={() => { try { populate(); } catch { } }}
            className="icon-btn"
            aria-label="Reload"
            title="Reload"
            style={{ padding: '4px 8px' }}
          >
            <FontAwesomeIcon icon={faRotateRight} />
          </button>
        </div>
      </div>


      {progress.running && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress.total ? (progress.processed / progress.total) * 100 : 0}%` }} />
          <div className="progress-text">{progress.processed}/{progress.total} (API {progress.apiHits}) — {progress.currentItem}</div>
        </div>
      )}

      {progress.error && <div className="error">{progress.error}</div>}

      {/* Workspace section (only when a specific workspace is selected) */}
      {workspace !== 'All' && (
        <>
          {showSystemPrompt && (
            <div
              className="modal-overlay"
              onClick={(e) => { if (e.target === e.currentTarget) setShowSystemPrompt(false) }}
            >
              <div className="modal">
                <div
                  className="modal-header"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 8, paddingBottom: 8, borderBottom: '1px solid #273043', marginBottom: 10,
                  }}
                >
                  <h3 style={{ margin: 0 }}>Workspace Instructions</h3>
                  <button
                    onClick={() => setShowSystemPrompt(false)}
                    className="cancel-btn"
                    aria-label="Close"
                    title="Close"
                    style={{ padding: '4px 8px' }}
                  >
                    ×
                  </button>
                </div>
                <SystemPrompt
                  workspaceName={workspace}
                  workspaces={savedWorkspaces}
                  onSave={handleSaveWorkspacePrompt}
                  candidateUrls={mergedWorkspaceItems.map(i => i.url).filter(Boolean)}
                />
              </div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 0 8px' }}>
            <span style={{ opacity: 0.85, fontSize: 12 }}> {workspace} ({mergedWorkspaceItems.length})</span>
            {refreshing && (
              <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>Syncing…</span>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              {/* <button
                onClick={() => setShowSystemPrompt(v => !v)}
                className="add-link-btn ai-button"
                aria-label={showSystemPrompt ? 'Hide prompt' : 'Show prompt'}
                title={showSystemPrompt ? 'Hide prompt' : 'Show prompt'}
                style={{ padding: '4px 8px' }}
              >
                <FontAwesomeIcon icon={faPenToSquare} />
              </button> */}
              {/* <button
                onClick={() => setShowCurrentWorkspace(v => !v)}
                className="add-link-btn ai-button"
                aria-label={showCurrentWorkspace ? 'Hide workspace' : 'Show workspace'}
                title={showCurrentWorkspace ? 'Hide workspace' : 'Show workspace'}
                style={{ padding: '4px 8px' }}
              >
                <FontAwesomeIcon icon={showCurrentWorkspace ? faEyeSlash : faEye} />
              </button> */}
              <button
                onClick={() => startCategoryEnrichment(workspace)}
                className="add-link-btn ai-button"
                aria-label={`Add recent links to ${workspace}`}
                title={`Add recent links to ${workspace}`}
                style={{ padding: '4px 8px' }}
              >
                <FontAwesomeIcon icon={faWandMagicSparkles} />
              </button>

              <button
                onClick={() => handleOpenAddLinkModal(workspace)}
                className="add-link-btn ai-button"
                aria-label="Add link"
                title="Add link"
                style={{ padding: '4px 8px' }}
              >
                <FontAwesomeIcon icon={faPlus} />
              </button>
              <button
                onClick={handleDeleteWorkspace}
                className="add-link-btn ai-button"
                aria-label="Delete workspace (irreversible)"
                title="Delete workspace (irreversible)"
                style={{ padding: '4px 8px' }}
                disabled={!workspace || workspace.toLowerCase() === 'all'}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            </div>
          </div>
          {showCurrentWorkspace && (
            <>
              <ItemGrid
                items={workspace === 'All' ? allItemsCombined : mergedWorkspaceItems}
                workspaces={savedWorkspaces}
                onAddRelated={handleAddRelated}
                onAddLink={() => handleOpenAddLinkModal(workspace)}
                onDelete={workspace !== 'All' ? handleDeleteFromWorkspace : undefined}
              />
              <RelatedProductsSection relatedItems={relatedProducts} onClear={clearRelatedProducts} />
            </>
          )}
        </>
      )}

      <>
        {/* Running Apps (Electron/app mode) - show regardless of dashboard loading */}
        {Array.isArray(processes) && processes.length > 0 && (
          <section className="saved-workspaces" style={{ margin: '6px 0 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>Running Apps</h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {processes.map((p, idx) => (
                <div
                  key={p.pid || p.processId || idx}
                  className="card"
                  style={{ padding: 10, cursor: 'pointer', border: '1px solid #e5e7eb', borderRadius: 8 }}
                  title="Click to focus this app"
                  onClick={async () => {
                    try { await focusWindow(p.pid ?? p.processId); } catch { }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {p.iconUrl && (
                        <img
                          src={p.iconUrl}
                          alt=""
                          width={16}
                          height={16}
                          style={{ borderRadius: 3, objectFit: 'cover' }}
                          onError={(e) => { try { e.currentTarget.style.display = 'none'; } catch { } }}
                        />
                      )}
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {p.title || p.name || p.processName || 'Unknown App'}
                      </div>
                    </div>
                    <button
                      style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', cursor: 'pointer' }}
                      title="Focus this app"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try { await focusWindow(p.pid ?? p.processId); } catch { }
                      }}
                    >
                      Go
                    </button>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    PID: {p.pid ?? p.processId ?? 'n/a'}
                  </div>
                  {p.path && (
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.path}>
                      {p.path?.split(/[\\/]/).pop()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Always render content; hydration refreshes in background */}
        <>
          <ErrorBoundary>
            <ActivityPanel activeSection={activeSection} />
          </ErrorBoundary>
        </>
      </>



      {addingToWorkspace && (
        <div
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setAddingToWorkspace(null) }}
        >
          <div className="modal">
            <div
              className="modal-header"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8, paddingBottom: 8, borderBottom: '1px solid #273043', marginBottom: 10,
              }}
            >
              <h3 style={{ margin: 0 }}>Add to "{addingToWorkspace}"</h3>
              <button
                onClick={() => setAddingToWorkspace(null)}
                className="cancel-btn"
                aria-label="Close"
                title="Close"
                style={{ padding: '4px 8px' }}
              >
                ×
              </button>
            </div>
            <AddLinkFlow
              allItems={data}
              savedItems={savedWorkspaces.flatMap(ws => (ws.urls || []).map(u => ({
                ...u,
                workspaceGroup: ws.name,
                id: `${ws.id}-${u.url}`,
              })))}
              currentWorkspace={addingToWorkspace}
              onAdd={handleAddItemToWorkspace}
              onAddSaved={handleAddSavedUrlToWorkspace}
              onCancel={() => setAddingToWorkspace(null)}
            />
          </div>
        </div>
      )}

      <Header
        search={search}
        setSearch={setSearch}
        populate={populate}
        setShowSettings={setShowSettings}
        openSyncControls={() => setShowSyncControls(true)}
        progress={progress}
        setShowCreateWorkspace={setShowCreateWorkspace}
        openInTab={openInTab}
        isFooter={true}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
      />

      {/* <div className="bottom-search">
        <div className="bottom-search-inner">
          <SearchBox
            search={search}
            setSearch={setSearch}
            openInSidePanel={openInSidePanel}
            focusSignal={focusSearchTick}
          />
        </div>
      </div> */}

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
