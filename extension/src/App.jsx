import { library } from '@fortawesome/fontawesome-svg-core';
import {
  faBroom,
  faClone,
  faGear,
  faGlobe,
  faHistory,
  faPlus,
  faRotateRight,
  faThumbtack,
  faTrash,
  faTriangleExclamation,
  faUndo
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css'; // MUST BE LAST to override theme backgrounds
import { ItemGrid } from './components/ItemGrid';
import { AddToWorkspaceModal } from './components/popups/AddToWorkspaceModal';
import { CreateWorkspaceModal } from './components/popups/CreateWorkspaceModal';
import { SettingsModal } from './components/popups/SettingsModal';
import { ProjectGrid } from './components/ProjectGrid';
import WorkspacePillList from './components/WorkspacePillList.jsx';
import './search.css';
import './styles/components.css';
import './styles/theme.css';
import './styles/themes/components-vars.css';

// Add icons to the library
library.add(
  faPlus,
  faTrash,
  faTriangleExclamation,
  faBroom,
  faClone,
  faGear,
  faGlobe,
  faHistory,
  faRotateRight,
  faThumbtack,
  faUndo
);

import { AIChatsSection } from './components/default/AIChats';
import { CurrentTabsSection } from './components/default/CurrentTabsSection';
import { SearchPanel } from './components/default/SearchPanel';
import { SimpleNotes } from './components/default/SimpleNotes';
import { WorkspaceSection } from './components/default/WorkspaceSection';
import { DraggableSections } from './components/DraggableSections';
import { OnboardingTour } from './components/onboarding/OnboardingTour';
import { AddLinkFlow } from './components/popups/AddLinkFlow';
import { getDisplaySettings } from './components/settings/DisplayData';
import VoiceNavigationChatGPT from './components/toolbar/VoiceNavigationChatGPT';
import categoryManager from './data/categories';
import { addUrlToWorkspace, getSettings as getSettingsDB, getUIState, listWorkspaces, saveSettings as saveSettingsDB, saveUIState, saveWorkspace, subscribeWorkspaceChanges, updateItemWorkspace } from './db/index.js';
import { useDashboardData } from './hooks/useDashboardData';
import { useOnboarding } from './hooks/useOnboarding';
import { getHostDashboard, getHostSettings, getProcesses, hasRuntime, onMessage, openOptionsPage, sendMessage, setHostSettings, setHostTabs, storageGet, storageRemove, storageSet, tabs } from './services/extensionApi';
import { createSharedWorkspaceClient } from './services/sharedWorkspaceService.js';
import { getFaviconUrl, getUrlParts } from './utils';
import { initializeFontSize, setAndSaveFontSize } from './utils/fontUtils';
import GenericUrlParser from './utils/GenericUrlParser';
import './utils/realTimeCategorizor'; // Auto-enables real-time categorization@

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

export default function App() {
  const SHARED_TEAM_ID = 'demo-team';
  const SHARED_USER_ID = 'demo-user';
  const SHARED_WS_URL = 'wss://YOUR_WORKER_URL';
  const { data, loading, refreshing, populate } = useDashboardData()
  const [workspace, setWorkspace] = useState('')
  const [themeClass, setThemeClass] = useState('bg-ai-quantum') // Default theme
  const [search, setSearch] = useState('')
  const [focusSearchTick, setFocusSearchTick] = useState(0)
  const [showDeskMetaReminder, setShowDeskMetaReminder] = useState(false);
  const [settings, setSettings] = useState({ geminiApiKey: '', modelName: '', visitCountThreshold: '', historyDays: '' })
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [addingToWorkspace, setAddingToWorkspace] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Onboarding hook
  const { shouldShowOnboarding, completeOnboarding, skipOnboarding, startOnboarding } = useOnboarding();

  const [showAddLinkModal, setShowAddLinkModal] = useState(false)
  const [workspaceForLinkAdd, setWorkspaceForLinkAdd] = useState(null)


  const [currentTab, setCurrentTab] = useState(null)
  const [savedWorkspaces, setSavedWorkspaces] = useState([])
  const [showCurrentWorkspace, setShowCurrentWorkspace] = useState(true)
  const [activeTab, setActiveTab] = useState('workspace') // 'workspace' | 'saved'
  const [activeSection, setActiveSection] = useState(0) // Index for ActivityPanel sections
  const activeSectionTimeoutRef = useRef(null)
  const sharedClientRef = useRef(null)
  const [processes, setProcesses] = useState([])
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const [fontSize, setFontSize] = useState('medium')

  // Wallpaper settings
  const [wallpaperEnabled, setWallpaperEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('wallpaperEnabled');
      return saved === 'true';
    } catch {
      return false;
    }
  });
  const [wallpaperUrl, setWallpaperUrl] = useState(() => {
    try {
      return localStorage.getItem('wallpaperUrl') || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1920&q=80';
    } catch {
      return 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1920&q=80';
    }
  });
  const [wallpaperOpacity, setWallpaperOpacity] = useState(() => {
    try {
      const saved = localStorage.getItem('wallpaperOpacity');
      return saved ? parseFloat(saved) : 0.3;
    } catch {
      return 0.3;
    }
  });

  // Pinned workspaces
  const [pinnedWorkspaces, setPinnedWorkspaces] = useState([])
  const [activePinnedWorkspace, setActivePinnedWorkspace] = useState(() => {
    try {
      const saved = localStorage.getItem('activePinnedWorkspace');
      return saved || null;
    } catch {
      return null;
    }
  })

  // Visibility state for Pings and Feed sections
  const [showPingsSection, setShowPingsSection] = useState(() => {
    try {
      const saved = localStorage.getItem('showPingsSection');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  })
  const [showFeedSection, setShowFeedSection] = useState(() => {
    try {
      const saved = localStorage.getItem('showFeedSection');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  })

  // Display settings state
  const [displaySettings, setDisplaySettings] = useState(() => getDisplaySettings())


  // Auto-reset active section after 5 seconds of inactivity
  useEffect(() => {
    // Clear existing timeout
    if (activeSectionTimeoutRef.current) {
      clearTimeout(activeSectionTimeoutRef.current);
    }

    // Set new timeout to reset to first section (index 0) after 5 seconds
    activeSectionTimeoutRef.current = setTimeout(() => {
      setActiveSection(0);
    }, 5000);

    // Cleanup on unmount
    return () => {
      if (activeSectionTimeoutRef.current) {
        clearTimeout(activeSectionTimeoutRef.current);
      }
    };
  }, [activeSection]); // Re-run whenever activeSection changes

  const handleShareWorkspaceUrl = (workspaceName) => {
    if (!workspaceName) return;
    try {
      if (!SHARED_TEAM_ID || !SHARED_USER_ID || !SHARED_WS_URL) {
        console.warn('[App] Shared workspace config missing');
        return;
      }

      if (!sharedClientRef.current) {
        sharedClientRef.current = createSharedWorkspaceClient({
          teamId: SHARED_TEAM_ID,
          userId: SHARED_USER_ID,
          wsUrl: SHARED_WS_URL,
        });
        sharedClientRef.current.connect();
      }

      if (typeof chrome !== 'undefined' && chrome?.tabs?.query) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabsList) => {
          try {
            const [tab] = Array.isArray(tabsList) ? tabsList : [];
            if (!tab || !tab.url) return;
            const title = tab.title || tab.url;
            sharedClientRef.current?.addUrl(tab.url, title, null);
            console.log('[App] Shared current tab URL to team workspace:', {
              workspaceName,
              url: tab.url,
            });
          } catch (err) {
            console.warn('[App] Failed to share URL to team workspace:', err);
          }
        });
      }
    } catch (e) {
      console.warn('Failed to handle share workspace URL action:', e);
    }
  };

  // Window resize handler for responsive behavior
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-focus document on load to enable keyboard shortcuts
  useEffect(() => {
    // Ensure the document can receive keyboard events immediately
    if (document.body && !document.activeElement || document.activeElement === document.body) {
      // Focus the body or a focusable element to enable keyboard shortcuts
      document.body.focus();
      // Also set tabindex to make body focusable if needed
      if (!document.body.hasAttribute('tabindex')) {
        document.body.setAttribute('tabindex', '-1');
      }
    }
  }, []);

  // Listen for display settings changes
  useEffect(() => {
    const handleDisplaySettingsChange = (event) => {
      setDisplaySettings(event.detail || getDisplaySettings());
    };

    window.addEventListener('displaySettingsChanged', handleDisplaySettingsChange);
    return () => {
      window.removeEventListener('displaySettingsChanged', handleDisplaySettingsChange);
    };
  }, []);


  // Helper function to create/append category-based workspaces with incremental support
  // options: { urlTimes: Map<string, number>, categoryLastCheck: Record<string, number> }
  const createCategoryBasedWorkspaces = (urls, existingWorkspaces, options = {}) => {
    const categoryGroups = new Map();
    const existingNames = new Set(existingWorkspaces.map(ws => ws.name?.toLowerCase()));
    const urlTimes = options.urlTimes instanceof Map ? options.urlTimes : new Map();
    const categoryLastCheck = (options && typeof options === 'object' && options.categoryLastCheck) ? options.categoryLastCheck : {};
    const maxTimeByCategory = new Map();
    const urlsToAppendByName = new Map(); // workspaceName -> Set(url)

    const normalizeForCategory = (rawUrl) => {
      if (!rawUrl) return null;
      try {
        const urlObj = rawUrl.startsWith('http') ? new URL(rawUrl) : new URL(`https://${rawUrl}`);
        const hostname = urlObj.hostname.replace(/^www\./, '').toLowerCase();
        if (!hostname) return null;
        const protocol = urlObj.protocol === 'http:' ? 'https:' : urlObj.protocol;
        const canonicalUrl = `${protocol}//${hostname}`;
        return { hostname, canonicalUrl };
      } catch {
        return null;
      }
    };

    const domainTimes = new Map();
    if (urlTimes instanceof Map) {
      urlTimes.forEach((ts, originalUrl) => {
        const normalized = normalizeForCategory(originalUrl);
        if (!normalized) return;
        const timestamp = Number(ts) || 0;
        if (timestamp <= 0) return;
        const prev = Number(domainTimes.get(normalized.hostname) || 0);
        if (timestamp > prev) {
          domainTimes.set(normalized.hostname, timestamp);
        }
      });
    }

    // Group URLs by category
    urls.forEach(url => {
      if (!url) return;

      // Filter out URLs that should be excluded (OAuth, login, settings, etc.)
      if (GenericUrlParser.shouldExclude(url)) return;

      const normalized = normalizeForCategory(url);
      if (!normalized) return;

      const category = categoryManager.categorizeUrl(url);
      if (category === 'uncategorized') return;

      // Skip if GenericUrlParser can handle this URL (to avoid duplicates)
      const parsed = GenericUrlParser.parse(url);
      if (parsed) return;

      // Incremental: only include URLs newer than the last processed timestamp for this category
      const t = Number(domainTimes.get(normalized.hostname) || urlTimes.get(url) || 0);
      const lastT = Number(categoryLastCheck?.[category] || 0);
      if (t && lastT && t <= lastT) return;

      const categoryDisplayName = category.charAt(0).toUpperCase() + category.slice(1);

      if (!categoryGroups.has(category)) {
        categoryGroups.set(category, {
          category,
          displayName: categoryDisplayName,
          urls: [],
          domains: new Set()
        });
      }

      const group = categoryGroups.get(category);
      if (!group.domains.has(normalized.hostname)) {
        group.domains.add(normalized.hostname);
        group.urls.push(normalized.canonicalUrl);
      }

      // Track max timestamp seen per category so caller can persist progress
      if (t) {
        const prevCatTime = Number(maxTimeByCategory.get(category) || 0);
        if (t > prevCatTime) maxTimeByCategory.set(category, t);
      }

      // If workspace already exists, also collect URLs to append later
      if (existingNames.has(categoryDisplayName.toLowerCase())) {
        if (!urlsToAppendByName.has(categoryDisplayName)) urlsToAppendByName.set(categoryDisplayName, new Set());
        urlsToAppendByName.get(categoryDisplayName).add(normalized.canonicalUrl);
      }
    });

    // Convert groups to workspace configurations
    const workspacesToCreate = [];
    for (const [category, group] of categoryGroups) {
      if (group.urls.length === 0) continue;

      const categoryData = categoryManager.getCategory(category);
      // Only create a new workspace if it doesn't already exist
      if (!existingNames.has(group.displayName.toLowerCase())) {
        const workspaceConfig = {
          name: group.displayName,
          description: `${group.displayName} websites`,
          gridType: 'ItemGrid',
          urls: group.urls.map(url => ({
            url,
            title: new URL(url).hostname,
            addedAt: Date.now(),
            favicon: getFaviconUrl(url, 32)
          }))
        };

        workspacesToCreate.push(workspaceConfig);
        existingNames.add(group.displayName.toLowerCase());
      }
    }

    // Flatten url sets to arrays for caller
    const urlsToAppend = {};
    urlsToAppendByName.forEach((set, name) => { urlsToAppend[name] = Array.from(set); });

    return { workspacesToCreate, maxTimeByCategory, urlsToAppend };
  };

  // Auto-create platform-based workspaces from URLs in history/bookmarks
  useEffect(() => {
    const autoCreatePlatformWorkspaces = async () => {
      try {
        // Check if auto-creation is enabled (default: true, but user can disable)
        const ui = await getUIState();
        const autoCreateEnabled = ui?.autoCreateWorkspaces !== false; // default true
        if (!autoCreateEnabled) {
          console.log('⏸️ Auto-workspace creation is disabled');
          return;
        }

        // ENHANCED: Scan browser history directly instead of relying only on dashboard data
        let urls = [];
        const urlTimes = new Map();

        // Try to get URLs from browser history API (for chat platforms)
        const browserAPI = typeof chrome !== 'undefined' && chrome?.history ? chrome : null;
        if (browserAPI) {
          try {
            const endTime = Date.now();
            const startTime = endTime - (30 * 24 * 60 * 60 * 1000); // Last 30 days

            console.log('[AutoCreate] Scanning browser history for chat platforms...');
            const historyItems = await browserAPI.history.search({
              text: '',
              startTime: startTime,
              endTime: endTime,
              maxResults: 2000
            });

            console.log(`[AutoCreate] Found ${historyItems.length} history items`);

            // Extract URLs and timestamps
            for (const item of historyItems) {
              if (item.url) {
                urls.push(item.url);
                const t = item.lastVisitTime || Date.now();
                const prev = urlTimes.get(item.url) || 0;
                if (t > prev) urlTimes.set(item.url, t);
              }
            }

            console.log(`[AutoCreate] Extracted ${urls.length} URLs from history`);
          } catch (err) {
            console.warn('[AutoCreate] Failed to scan browser history:', err);
          }
        }

        // Fallback: Also include URLs from dashboard data if history scan failed
        if (urls.length === 0 && data && Array.isArray(data)) {
          console.log('[AutoCreate] Falling back to dashboard data');
          urls = data.map(item => item.url).filter(Boolean);
          for (const it of data) {
            const u = it?.url;
            if (!u) continue;
            const t = Number(it?.lastVisitTime || it?.dateAdded || 0) || 0;
            const prev = Number(urlTimes.get(u) || 0);
            if (t > prev) urlTimes.set(u, t);
          }
        }

        if (urls.length === 0) {
          console.log('[AutoCreate] No URLs found to process');
          return;
        }

        // Compute dataset hash
        const dataHash = JSON.stringify(urls.slice().sort()).slice(0, 50);
        const lastHash = ui?.lastAutoCreateHash;
        // URL times already built above
        const workspacesResult = await listWorkspaces();
        const existingWorkspaces = workspacesResult?.success ? workspacesResult.data : [];

        // Ensure existingWorkspaces is an array
        if (!Array.isArray(existingWorkspaces)) {
          console.warn('existingWorkspaces is not an array:', existingWorkspaces);
          return;
        }

        // Create platform-specific workspaces (GitHub, ChatGPT, etc.)
        const platformWorkspacesToCreate = await GenericUrlParser.createWorkspacesFromUrls(urls, existingWorkspaces);

        // Filter URLs that should use generic categorization (not handled by GenericUrlParser)
        const urlsForCategorization = urls.filter(url => GenericUrlParser.shouldUseGenericCategorization(url));

        // Load last per-category checkpoint from UI state (support nested shape)
        const categoryLastCheck = (ui?.categoryLastCheck) || (ui?.data?.categoryLastCheck) || {};

        // Create category-based workspaces (Social, Shopping, etc.) for remaining URLs, incrementally
        const { workspacesToCreate: categoryWorkspacesToCreate, maxTimeByCategory, urlsToAppend } = createCategoryBasedWorkspaces(
          urlsForCategorization,
          [...existingWorkspaces, ...platformWorkspacesToCreate],
          { urlTimes, categoryLastCheck }
        );

        // Append new URLs to existing category workspaces (incremental)
        let appendedCount = 0;
        if (urlsToAppend && typeof urlsToAppend === 'object') {
          for (const [wsName, list] of Object.entries(urlsToAppend)) {
            if (!Array.isArray(list) || list.length === 0) continue;
            const target = existingWorkspaces.find(w => (w?.name || '').toLowerCase() === wsName.toLowerCase());
            if (!target || !target.id) continue;
            for (const url of list) {
              try {
                await addUrlToWorkspace(url, target.id, {
                  title: new URL(url).hostname,
                  favicon: getFaviconUrl(url, 32),
                  addedAt: Date.now()
                });
                appendedCount++;
              } catch (e) {
                console.warn(`Failed to append URL to workspace ${wsName}:`, e);
              }
            }
          }
        }

        // If nothing to create/append and dataset hasn't changed, skip
        if ((platformWorkspacesToCreate.length === 0 && categoryWorkspacesToCreate.length === 0 && appendedCount === 0) && lastHash === dataHash) {
          console.log('⏭️ Nothing new to auto-create for this dataset');
          return;
        }

        // Combine both types
        const workspacesToCreate = [...platformWorkspacesToCreate, ...categoryWorkspacesToCreate];
        const createdWorkspaces = [];

        for (const workspaceData of workspacesToCreate) {
          try {
            const workspace = {
              id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              createdAt: Date.now(),
              ...workspaceData
            };

            await saveWorkspace(workspace);
            createdWorkspaces.push(workspace);

            // Index URLs
            for (const urlObj of workspace.urls) {
              try {
                await addUrlToWorkspace(urlObj.url, workspace.id, {
                  title: urlObj.title,
                  favicon: urlObj.favicon,
                  addedAt: urlObj.addedAt
                });
              } catch (error) {
                console.warn(`Failed to index URL ${urlObj.url}:`, error);
              }
            }
          } catch (error) {
            console.error(`Failed to create workspace ${workspaceData.name}:`, error);
          }
        }

        if (createdWorkspaces.length > 0) {
          console.log(`✅ Auto-created ${createdWorkspaces.length} platform workspaces:`,
            createdWorkspaces.map(w => w.name));

          // Refresh the saved workspaces list
          const refreshedResult = await listWorkspaces();
          const refreshed = refreshedResult?.success ? refreshedResult.data : [];
          setSavedWorkspaces(Array.isArray(refreshed) ? refreshed : []);
        }

        // Remember that we processed this data set and advance per-category checkpoints
        const maxMapObj = (() => { try { return Object.fromEntries(maxTimeByCategory); } catch { return {}; } })();
        const mergedCategoryLastCheck = { ...(ui?.categoryLastCheck || ui?.data?.categoryLastCheck || {}), ...maxMapObj };
        await saveUIState({ ...ui, lastAutoCreateHash: dataHash, categoryLastCheck: mergedCategoryLastCheck });
      } catch (error) {
        console.warn('Failed to auto-create platform workspaces:', error);
      }
    };

    // Run on mount and when data changes
    const timeoutId = setTimeout(autoCreatePlatformWorkspaces, 3000);
    return () => clearTimeout(timeoutId);
  }, [data]);


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

  // Load pinned workspaces from storage on mount
  useEffect(() => {
    (async () => {
      try {
        const { pinnedWorkspaces: storedPins } = await storageGet(['pinnedWorkspaces']);
        if (Array.isArray(storedPins)) setPinnedWorkspaces(storedPins);
      } catch { }
    })();
  }, [])

  const savePinnedWorkspaces = async (list) => {
    try { await storageSet({ pinnedWorkspaces: list }); } catch { }
  };

  // Persist active workspace to localStorage
  useEffect(() => {
    try {
      if (activePinnedWorkspace) {
        localStorage.setItem('activePinnedWorkspace', activePinnedWorkspace);
      } else {
        localStorage.removeItem('activePinnedWorkspace');
      }
    } catch { }
  }, [activePinnedWorkspace]);

  // Persist Pings and Feed section visibility to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('showPingsSection', String(showPingsSection));
    } catch { }
  }, [showPingsSection]);

  useEffect(() => {
    try {
      localStorage.setItem('showFeedSection', String(showFeedSection));
    } catch { }
  }, [showFeedSection]);

  // Persist wallpaper settings and toggle body class
  useEffect(() => {
    try {
      console.log('[App] Wallpaper enabled changed to:', wallpaperEnabled);
      localStorage.setItem('wallpaperEnabled', String(wallpaperEnabled));

      // Toggle wallpaper-enabled class on body to override theme backgrounds
      if (wallpaperEnabled) {
        document.body.classList.add('wallpaper-enabled');
      } else {
        document.body.classList.remove('wallpaper-enabled');
      }
    } catch { }
  }, [wallpaperEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem('wallpaperUrl', wallpaperUrl);
    } catch { }
  }, [wallpaperUrl]);

  useEffect(() => {
    try {
      localStorage.setItem('wallpaperOpacity', String(wallpaperOpacity));
    } catch { }
  }, [wallpaperOpacity]);

  useEffect(() => {
    if (!activePinnedWorkspace) return;
    if (!Array.isArray(pinnedWorkspaces) || pinnedWorkspaces.includes(activePinnedWorkspace)) return;
    setActivePinnedWorkspace(pinnedWorkspaces[0] ?? null);
  }, [pinnedWorkspaces, activePinnedWorkspace])

  const togglePinWorkspace = (name) => {
    if (!name || typeof name !== 'string') return;
    setPinnedWorkspaces((prev) => {
      const exists = prev.includes(name);
      const next = exists ? prev.filter(n => n !== name) : [...prev, name];
      savePinnedWorkspaces(next);
      return next;
    });
  };

  const unpinWorkspace = (name) => {
    if (!name) return;
    setPinnedWorkspaces((prev) => {
      const next = prev.filter(n => n !== name);
      savePinnedWorkspaces(next);
      return next;
    });
  };


  // Handle font size changes
  const handleFontSizeChange = (fontSizeId) => {
    setFontSize(fontSizeId);
    setAndSaveFontSize(fontSizeId);
  };


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
          // Check if this is a workspace command
          if (q.startsWith('workspace:')) {
            const workspaceName = q.replace('workspace:', '').trim();
            if (workspaceName) {
              setWorkspace(workspaceName);
              console.log('[App] Switching to workspace from search:', workspaceName);
            }
          } else {
            // Regular search query
            setSearch(q)
          }
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

      // Initialize theme and typography on app startup
      ; (async () => {
        try {
          const savedTheme = localStorage.getItem('cooldesk-theme');
          const savedFontFamily = localStorage.getItem('cooldesk-font-family');

          const body = document.body;

          // Apply theme
          const themeClasses = [
            'bg-ai-midnight-nebula',
            'bg-cosmic-aurora',
            'bg-sunset-horizon',
            'bg-forest-depths',
            'bg-minimal-dark',
            'bg-ocean-depths',
            'bg-cherry-blossom',
            'bg-arctic-frost',
            'bg-volcanic-ember',
            'bg-neon-cyberpunk',
            'bg-white-cred',
            'bg-orange-warm',
            'bg-brown-earth',
            'bg-royal-purple',
            'bg-golden-honey',
            'bg-mint-sage',
            'bg-crimson-fire'
          ];

          // Remove all theme classes
          themeClasses.forEach(cls => body.classList.remove(cls));

          // Apply saved theme or default to ai-quantum
          const themeToApply = savedTheme || 'ai-quantum';
          const newThemeClass = `bg-${themeToApply}`;
          body.classList.add(newThemeClass);
          setThemeClass(newThemeClass);

          // Initialize font size using utility
          const initialFontSize = initializeFontSize();
          setFontSize(initialFontSize);

          // Apply font family
          const fontFamilies = [
            { id: 'system', family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif' },
            { id: 'inter', family: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' },
            { id: 'roboto', family: 'Roboto, -apple-system, BlinkMacSystemFont, sans-serif' },
            { id: 'poppins', family: 'Poppins, -apple-system, BlinkMacSystemFont, sans-serif' },
            { id: 'jetbrains', family: 'JetBrains Mono, Consolas, Monaco, monospace' }
          ];

          if (savedFontFamily) {
            const fontFamilyObj = fontFamilies.find(f => f.id === savedFontFamily);
            if (fontFamilyObj) {
              body.style.fontFamily = fontFamilyObj.family;
            }
          }

        } catch (e) {
          console.warn('Failed to apply saved preferences:', e);
        }
      })()

      // Load saved workspaces initially from IndexedDB
      ; (async () => {
        try {
          let workspacesResult = await listWorkspaces()
          let workspaces = workspacesResult?.success ? workspacesResult.data : []
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
                let workspacesResult = await listWorkspaces()
                workspaces = workspacesResult?.success ? workspacesResult.data : []
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
      if (req?.action === 'updateData') {
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
        const workspacesResult = await listWorkspaces()
        const workspaces = workspacesResult?.success ? workspacesResult.data : []
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
        const uiData = ui?.data || ui;
        console.log('[App] Initial restoration, UI data:', uiData);

        if (uiData?.lastActiveTab === 'workspace' || uiData?.lastActiveTab === 'saved') {
          setActiveTab(uiData.lastActiveTab);
        }
        if (typeof uiData?.lastWorkspace === 'string' && uiData.lastWorkspace) {
          setWorkspace(uiData.lastWorkspace);
        }
      } catch { }
    })();
  }, [])

  // Restore workspace selection after savedWorkspaces are loaded
  useEffect(() => {
    if (savedWorkspaces.length === 0) return; // Wait for workspaces to load

    (async () => {
      try {
        const ui = await getUIState();
        console.log('[App] Full UI state:', ui);

        // Handle nested data structure
        const uiData = ui?.data || ui;
        console.log('[App] UI data:', uiData);
        console.log('[App] Workspace restoration check:', {
          currentWorkspace: workspace,
          savedLastWorkspace: uiData?.lastWorkspace,
          availableWorkspaces: savedWorkspaces.map(ws => ws?.name)
        });

        if (typeof uiData?.lastWorkspace === 'string' && uiData.lastWorkspace && uiData.lastWorkspace !== 'All') {
          // Check if the saved workspace still exists
          const exists = savedWorkspaces.some(ws => (ws?.name || '').trim().toLowerCase() === (uiData.lastWorkspace || '').trim().toLowerCase());
          console.log('[App] Workspace exists check:', { exists, lastWorkspace: uiData.lastWorkspace });

          if (exists) {
            console.log('[App] Restoring workspace:', uiData.lastWorkspace);
            setWorkspace(uiData.lastWorkspace);
          }
        }
      } catch (error) {
        console.error('[App] Workspace restoration error:', error);
      }
    })();
  }, [savedWorkspaces])

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
    console.log('[App] Persisting workspace change:', { activeTab, workspace });
    (async () => {
      try {
        await saveUIState({ lastActiveTab: activeTab, lastWorkspace: workspace });
        console.log('[App] Workspace persisted successfully');
      } catch (error) {
        console.error('[App] Failed to persist workspace:', error);
      }
    })();
  }, [workspace])

  // When opening the Create Workspace modal, fetch current tab for auto-suggest
  useEffect(() => {
    if (showCreateWorkspace) {
      getCurrentTabInfo()
    }
  }, [showCreateWorkspace])


  // Items to build the workspace filter options from saved workspaces
  const filterItems = useMemo(() => {
    return savedWorkspaces.map(ws => ({ workspaceGroup: ws.name }));
  }, [savedWorkspaces])

  // Reset workspace if the current one doesn't exist
  useEffect(() => {
    if (!workspace && savedWorkspaces.length > 0) {
      setWorkspace(savedWorkspaces[0]?.name || '');
    } else if (workspace) {
      const exists = savedWorkspaces.some(ws => (ws?.name || '').trim().toLowerCase() === (workspace || '').trim().toLowerCase());
      if (!exists) setWorkspace(savedWorkspaces[0]?.name || '');
    }
  }, [savedWorkspaces, workspace])

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
      const workspacesResult = await listWorkspaces();
      const workspaces = workspacesResult?.success ? workspacesResult.data : [];
      try { console.log('[App] handleAddSavedUrlToWorkspace: existing workspaces', { count: Array.isArray(workspaces) ? workspaces.length : 0 }); } catch { }
      const norm = (s) => (s || '').trim().toLowerCase();
      let ws = workspaces.find(w => norm(w.name) === norm(workspaceName));
      if (!ws) {
        ws = {
          id: Date.now().toString(),
          name: workspaceName,
          description: '',
          createdAt: Date.now(),
          urls: []
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
      const refreshedResult = await listWorkspaces();
      const refreshed = refreshedResult?.success ? refreshedResult.data : [];
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
      const workspacesResult = await listWorkspaces();
      const workspaces = workspacesResult?.success ? workspacesResult.data : [];
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
      const refreshedResult = await listWorkspaces();
      const refreshed = refreshedResult?.success ? refreshedResult.data : [];
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
      const workspacesResult = await listWorkspaces();
      const workspaces = workspacesResult?.success ? workspacesResult.data : [];
      const norm = (s) => (s || '').trim().toLowerCase();
      let ws = workspaces.find(w => norm(w.name) === norm(workspaceName));
      if (!ws) {
        ws = {
          id: Date.now().toString(),
          name: workspaceName,
          description: '',
          createdAt: Date.now(),
          urls: [],
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
          const refreshedResult = await listWorkspaces();
          const refreshed = refreshedResult?.success ? refreshedResult.data : [];
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
      const workspacesResult = await listWorkspaces();
      const workspaces = workspacesResult?.success ? workspacesResult.data : [];
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
              urls: []
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
      const wsResult = await listWorkspaces();
      const ws = wsResult?.success ? wsResult.data : [];
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

  // Merge history/bookmarks with saved URLs and de-duplicate by URL
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
    if (!workspace) return [];
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
    if (!workspace) return [];
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


  // Render the appropriate grid component based on workspace grid type
  const renderWorkspaceGrid = (workspaceObj, items) => {
    const gridType = workspaceObj?.gridType || 'ItemGrid'; // Default to ItemGrid

    console.log(`[App] Rendering grid type: ${gridType} for workspace: ${workspaceObj?.name}`);

    switch (gridType) {
      case 'ProjectGrid':
        return (
          <div className="content-section section">
            <ProjectGrid
              items={items}
              workspaces={savedWorkspaces}
              onAddRelated={handleAddRelated}
              onAddLink={() => handleOpenAddLinkModal(workspace)}
              onDelete={workspace !== 'All' ? handleDeleteFromWorkspace : undefined}
            />
          </div>
        );

      case 'ItemGrid':
        return (
          <div className="content-section section">
            <WorkspacePillList
              items={items}
              onDelete={workspace !== 'All' ? handleDeleteFromWorkspace : undefined}
              onPin={togglePinWorkspace}
              onAddToWorkspace={(url, workspaceName) => {
                if (!url || !workspaceName) return;
                const primaryItem = Array.isArray(items) ? items.find((it) => it?.url === url) : null;
                const itemForSave = primaryItem || {
                  id: url,
                  url,
                  title: (() => {
                    try { return new URL(url).hostname; } catch { return url; }
                  })(),
                  favicon: getFaviconUrl(url)
                };
                return handleAddItemToWorkspace(itemForSave, workspaceName);
              }}
              onAddToBookmarks={(chip) => handleAddRelated(chip.url, chip.title)}
            />
          </div>
        );

      case 'ItemGrid1':
      default:
        return (
          <div className="content-section section">
            <ItemGrid
              items={items}
              workspaces={savedWorkspaces}
              onAddRelated={handleAddRelated}
              onAddLink={() => handleOpenAddLinkModal(workspace)}
              onDelete={handleDeleteFromWorkspace}
              allItems={data}
              savedItems={savedUrlsFlat}
              currentWorkspace={workspace || ''}
              onAddItem={handleAddItemToWorkspace}
              onAddSavedItem={handleAddSavedUrlToWorkspace}
            />
          </div>
        );
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
        }]
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


  // Determine if we should show vertical header (responsive or user preference)
  const shouldShowVertical = windowWidth < 700;

  // Define all draggable sections
  const allSections = useMemo(() => [
    // {
    //   id: 'quick-access',
    //   component: (
    //     <ErrorBoundary key="quick-access">
    //       <QuickAccess displaySettings={displaySettings} initialShowPings={showPingsSection} initialShowFeed={showFeedSection} />
    //     </ErrorBoundary>
    //   )
    // },
    // {
    //   id: 'shared-workspace',
    //   component: (
    //     <div className="shared-workspace-container section" key="shared-workspace">
    //       <ErrorBoundary>
    //         <SharedWorkspace
    //           teamId="demo-team"
    //           userId="demo-user"
    //           wsUrl="wss://cooldesk-team-sync.raghuwanshi-abhay405.workers.dev"
    //         />
    //       </ErrorBoundary>
    //     </div>
    //   )
    // },
    // {
    //   id: 'pinned-workspace',
    //   component: (
    //     <div className="pinned-workspace-container section" key="pinned-workspace">
    //       {displaySettings.pinnedWorkspaces !== false && (
    //         <ErrorBoundary>
    //           <PinnedWorkspace
    //             items={pinnedWorkspaces}
    //             active={activePinnedWorkspace}
    //             onSelect={(name) => setActivePinnedWorkspace(name)}
    //             onUnpin={unpinWorkspace}
    //             workspaces={savedWorkspaces}
    //             onReorder={(order) => {
    //               if (Array.isArray(order)) {
    //                 setPinnedWorkspace s(order);
    //                 try { savePinnedWorkspaces(order); } catch { }
    //               }
    //             }}
    //           />
    //         </ErrorBoundary>
    //       )}
    //     </div>
    //   )
    // },
    {
      id: 'workspace-section',
      component: (
        <div className="workspace-filters-section section" key="workspace-section">
          <WorkspaceSection
            displaySettings={displaySettings}
            workspace={workspace}
            setWorkspace={setWorkspace}
            filterItems={filterItems}
            createWorkspace={createWorkspace}
            togglePinWorkspace={togglePinWorkspace}
            handleOpenAddLinkModal={handleOpenAddLinkModal}
            pinnedWorkspaces={pinnedWorkspaces}
            handleShareWorkspaceUrl={handleShareWorkspaceUrl}
            savedWorkspaces={savedWorkspaces}
            mergedWorkspaceItems={mergedWorkspaceItems}
            renderWorkspaceGrid={renderWorkspaceGrid}
          />
        </div>
      )
    },
    {
      id: 'voice-navigation',
      component: displaySettings.voiceNavigationSection !== false && (
        <div key="voice-navigation" className="section" data-onboarding="voice-navigation-section">
          <ErrorBoundary>
            <VoiceNavigationChatGPT />
          </ErrorBoundary>
        </div>
      )
    },
    {
      id: 'active-tabs',
      component: displaySettings.currentTabsSection !== false && (
        <div key="active-tabs" data-onboarding="current-tabs-section">
          <ErrorBoundary>
            <CurrentTabsSection />
          </ErrorBoundary>
        </div>
      )
    },
    {
      id: 'ai-chats',
      component: displaySettings.aiChatsSection !== false && (
        <div key="ai-chats" data-onboarding="ai-chats-section">
          <ErrorBoundary>
            <AIChatsSection />
          </ErrorBoundary>
        </div>
      )
    },
    {
      id: 'notes',
      component: displaySettings.notesSection !== false && (
        <div key="notes" data-onboarding="notes-section">
          <ErrorBoundary>
            <SimpleNotes />
          </ErrorBoundary>
        </div>
      )
    },
    // {
    //   id: 'notice-board',
    //   component: displaySettings.noticeBoard !== false && (
    //     <div key="notice-board">
    //       <ErrorBoundary>
    //         <GlassNoticeBoard hideNoticeBoard={displaySettings.noticeBoard === false} />
    //       </ErrorBoundary>
    //     </div>
    //   )
    // },
  ].filter(section => section.component !== false), [
    displaySettings,
    showPingsSection,
    showFeedSection,
    pinnedWorkspaces,
    activePinnedWorkspace,
    savedWorkspaces,
    workspace,
    filterItems,
    mergedWorkspaceItems,
  ]);

  return (
    <div className={`popup-wrap ${themeClass} ${wallpaperEnabled ? 'wallpaper-enabled' : ''}`} style={{
      '--section-spacing': '24px',
      '--card-spacing': '16px',
      position: 'relative'
    }}>
      {/* Settings Button - Top Right */}
      <button
        data-onboarding="settings-button"
        onClick={() => setShowSettings(true)}
        title="Settings"
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          width: '48px',
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '12px',
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
          border: '1px solid var(--border-primary, rgba(255, 255, 255, 0.1))',
          color: 'var(--text, #e5e7eb)',
          cursor: 'pointer',
          zIndex: 1000,
          transition: 'all 0.2s ease',
          backdropFilter: 'blur(12px)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--interactive-hover, rgba(255, 255, 255, 0.15))';
          e.currentTarget.style.transform = 'scale(1.05)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--glass-bg, rgba(255, 255, 255, 0.1))';
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        <FontAwesomeIcon icon={faGear} style={{ fontSize: '20px' }} />
      </button>

      {/* Wallpaper Background */}
      {wallpaperEnabled && (
        <>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundImage: `url(${wallpaperUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              opacity: wallpaperOpacity,
              zIndex: -2,
              pointerEvents: 'none'
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backdropFilter: 'blur(8px)',
              zIndex: -1,
              pointerEvents: 'none'
            }}
          />
        </>
      )}

      {/* Main Content Area with conditional wrapper */}
      <div>

        {/* Chrome/Edge-style Search Panel */}
        <div className="search-panel-section section" style={{ marginTop: '15vh' }}>
          <ErrorBoundary>
            <SearchPanel />
          </ErrorBoundary>
        </div>

        {/* All draggable sections below the search */}
        <DraggableSections sections={allSections} storageKey="mainSectionOrder" />

        <div style={{ marginTop: 'var(--section-spacing)' }}>
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
        </div>

        <div style={{ marginTop: 'var(--section-spacing)' }}>
          <AddToWorkspaceModal
            show={showAddLinkModal}
            workspace={workspaceForLinkAdd}
            onClose={handleCloseAddLinkModal}
            onSave={handleSaveLink}
            suggestions={data.filter(it => !it.workspaceGroup)}
          />
        </div>

        <div style={{ marginTop: 'var(--section-spacing)' }}>
          <CreateWorkspaceModal
            show={showCreateWorkspace}
            onClose={() => setShowCreateWorkspace(false)}
            onCreate={createWorkspace}
            currentTab={currentTab}
          />
        </div>

        <div style={{ marginTop: 'var(--section-spacing)' }}>
          <SettingsModal
            show={showSettings}
            onClose={() => setShowSettings(false)}
            settings={settings}
            onSave={saveSettings}
            fontSize={fontSize}
            onFontSizeChange={handleFontSizeChange}
            onStartOnboarding={startOnboarding}
            wallpaperEnabled={wallpaperEnabled}
            wallpaperUrl={wallpaperUrl}
            wallpaperOpacity={wallpaperOpacity}
            onWallpaperEnabledChange={setWallpaperEnabled}
            onWallpaperUrlChange={setWallpaperUrl}
            onWallpaperOpacityChange={setWallpaperOpacity}
          />
        </div>

        {/* Onboarding Tour */}
        <div style={{ marginTop: 'var(--section-spacing)' }}>
          {shouldShowOnboarding && (
            <OnboardingTour
              onComplete={completeOnboarding}
              onSkip={skipOnboarding}
            />
          )}
        </div>
      </div>
    </div>
  )
}
