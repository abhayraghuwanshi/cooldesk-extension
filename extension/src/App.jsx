import { faEye, faEyeSlash, faPenToSquare, faPlus, faRotateRight, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import { AddToWorkspaceModal } from './components/AddToWorkspaceModal';
import { CreateWorkspaceModal } from './components/CreateWorkspaceModal';
import { Header } from './components/Header';
import { ItemGrid } from './components/ItemGrid';
import { RelatedProductsSection } from './components/RelatedProductsSection';
import { SettingsModal } from './components/SettingsModal';
import { SystemPrompt } from './components/SystemPrompt';
import { WorkspaceFilters } from './components/WorkspaceFilters';


import ActivityPanel from './components/ActivityPanel';
import { AddLinkFlow } from './components/AddLinkFlow';
import { getSettings as getSettingsDB, getUIState, listWorkspaces, saveSettings as saveSettingsDB, saveUIState, saveWorkspace, subscribeWorkspaceChanges, updateItemWorkspace } from './db';
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
        </div>
      );
    }
    return this.props.children;
  }
}

// Main App Component
export default function App() {
  const { data, loading, populate } = useDashboardData()
  const [workspace, setWorkspace] = useState('All')
  const [search, setSearch] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState({ geminiApiKey: '', serverUrl: '', visitCountThreshold: '', historyMaxResults: '' })
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
  const [processes, setProcesses] = useState([])

  // Side panel visibility control via runtime messages
  const [showPanel, setShowPanel] = useState(false)
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

  // Populate settings on load from host (Electron app API), then mirror locally
  useEffect(() => {
    (async () => {
      try {
        const res = await getHostSettings();
        if (res?.ok && res.settings && Object.keys(res.settings).length) {
          const s = res.settings;
          setSettings({
            geminiApiKey: s.geminiApiKey || '',
            serverUrl: (s.serverUrl || '').replace(/\/$/, ''),
            visitCountThreshold: Number.isFinite(s.visitCountThreshold) ? String(s.visitCountThreshold) : '',
            historyMaxResults: Number.isFinite(s.historyMaxResults) ? String(s.historyMaxResults) : ''
          });
          try {
            await saveSettingsDB(s);
            await storageSet(s);
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

  // Items to build the unified workspace filter options
  const filterItems = useMemo(() => {
    // merge history/data workspaces with saved workspace names
    const extras = savedWorkspaces.map(ws => ({ workspaceGroup: ws.name }));
    // Ensure 'All' is available as a selectable option
    const all = [{ workspaceGroup: 'All' }];
    return [...all, ...data, ...extras];
  }, [data, savedWorkspaces])

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
      // Only use explicit workspaceGroup; do not fallback to category.name
      const itemWorkspace = it.workspaceGroup
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
      }
      // Prevent duplicate URL entries
      if (!Array.isArray(ws.urls)) ws.urls = [];
      if (ws.urls.some(u => u.url === newUrl)) {
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
      await saveWorkspace(updated);
      const refreshed = await listWorkspaces();
      setSavedWorkspaces(Array.isArray(refreshed) ? refreshed : []);
    } catch (e) {
      console.error('Failed to add URL to workspace:', e);
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

  const handleAddItemToWorkspace = async (item, workspaceName) => {
    try {
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
      } catch { }
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
    // Open the in-page AddLinkFlow so the user can search history/bookmarks to add
    setAddingToWorkspace(resolved.name);
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
    const sourceWorkspaces = workspace === 'All'
      ? savedWorkspaces
      : savedWorkspaces.filter(ws => ws.name === workspace);

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

      // Close modal and refresh data
      setShowCreateWorkspace(false)
      // populate() reloads history/bookmarks, not needed for saved workspaces
    } catch (err) {
      console.error('Error creating workspace:', err)
    }
  }

  const handleWorspaceFilterChange = useEffect(() => {

  }, [workspace, savedWorkspaces]);

  return (
    <div className="popup-wrap bg-ai-midnight-nebula">
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

      {/* Saved Workspaces section */}
      {/* {(savedWorkspaces.length > 0 ? (
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

            <button onClick={() => handleOpenAddLinkModal(workspace)} className="add-link-btn">+ Add Link</button>
            <button onClick={startEnrichment} className="add-link-btn">Organize using AI</button>
          </div>
          {showSavedWorkspaces && (
            <>
              <ItemGrid key={`saved-${workspace}`} items={savedUrlsFlat} workspaces={savedWorkspaces} onAddRelated={handleAddRelated} onAddLink={handleOpenAddLinkModal} />
            </>
          )}
        </section>
      ) : (
        <div className="empty">No saved workspaces</div>
      ))} */}

      {/* All items view */}
      {workspace === 'All' && (
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
                            onError={(e) => { try { e.currentTarget.style.display = 'none'; } catch {} }}
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
                        {p.path}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {loading ? (
            <div className="empty">Loading...</div>
          ) : (
            <>
              {/* <ItemGrid items={allItemsCombined} workspaces={savedWorkspaces} onAddRelated={handleAddRelated} onAddLink={handleOpenAddLinkModal} /> */}
              <ErrorBoundary>
                <ActivityPanel />
              </ErrorBoundary>
            </>
          )}
        </>
      )}

      {/* Workspace section (only when a specific workspace is selected) */}
      {workspace !== 'All' && (
        loading ? (
          <div className="empty">Loading...</div>
        ) : (
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
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setShowSystemPrompt(v => !v)}
                  className="add-link-btn ai-button"
                  aria-label={showSystemPrompt ? 'Hide prompt' : 'Show prompt'}
                  title={showSystemPrompt ? 'Hide prompt' : 'Show prompt'}
                  style={{ padding: '4px 8px' }}
                >
                  <FontAwesomeIcon icon={faPenToSquare} />
                </button>
                <button
                  onClick={() => setShowCurrentWorkspace(v => !v)}
                  className="add-link-btn ai-button"
                  aria-label={showCurrentWorkspace ? 'Hide workspace' : 'Show workspace'}
                  title={showCurrentWorkspace ? 'Hide workspace' : 'Show workspace'}
                  style={{ padding: '4px 8px' }}
                >
                  <FontAwesomeIcon icon={showCurrentWorkspace ? faEyeSlash : faEye} />
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
                  onClick={startEnrichment}
                  className="add-link-btn ai-button"
                  aria-label="Organize using AI"
                  title="Organize using AI"
                  style={{ padding: '4px 8px' }}
                >
                  <FontAwesomeIcon icon={faWandMagicSparkles} />
                </button>
              </div>
            </div>
            {showCurrentWorkspace && (
              <>
                <ItemGrid items={mergedWorkspaceItems} workspaces={savedWorkspaces} onAddRelated={handleAddRelated} onAddLink={() => handleOpenAddLinkModal(workspace)} onDelete={handleDeleteFromWorkspace} />
                <RelatedProductsSection relatedItems={relatedProducts} onClear={clearRelatedProducts} />
              </>
            )}
          </>
        )
      )}

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
              currentWorkspace={addingToWorkspace}
              onAdd={handleAddItemToWorkspace}
              onAddSaved={handleAddSavedUrlToWorkspace}
              onCancel={() => setAddingToWorkspace(null)}
            />
          </div>
        </div>
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
