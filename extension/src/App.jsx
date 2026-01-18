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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css'; // MUST BE LAST to override theme backgrounds
import { CoolDeskContainer } from './components/cooldesk/CoolDeskContainer';
import { SettingsModal } from './components/popups/SettingsModal';
import './search.css';
import './styles/bento-layout.css';
import './styles/components.css';
import './styles/theme.css';
import './styles/themes/components-vars.css';
import './styles/wallpaper-enhancements.css';

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

import { OnboardingTour } from './components/onboarding/OnboardingTour';
import categoryManager from './data/categories';
import { addUrlToWorkspace, getSettings as getSettingsDB, getUIState, getWorkspace, listWorkspaces, saveSettings as saveSettingsDB, saveUIState, saveWorkspace, subscribeWorkspaceChanges } from './db/index.js';
import { useDashboardData } from './hooks/useDashboardData';
import { useOnboarding } from './hooks/useOnboarding';
import { hasRuntime, onMessage, sendMessage, storageGet, storageRemove, storageSet } from './services/extensionApi';
import { cryptoUtils } from './services/p2p/cryptoUtils';
import { p2pSyncService } from './services/p2p/syncService';
import { teamManager } from './services/p2p/teamManager';
import { createSharedWorkspaceClient } from './services/sharedWorkspaceService.js';
import { getFaviconUrl } from './utils';
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
  const { data, loading, refreshing, populate } = useDashboardData()
  const [workspace, setWorkspace] = useState('')
  const [themeClass, setThemeClass] = useState('bg-crimson-fire') // Default theme
  const [search, setSearch] = useState('')
  const [focusSearchTick, setFocusSearchTick] = useState(0)
  const [settings, setSettings] = useState({ geminiApiKey: '', modelName: '', visitCountThreshold: '', historyDays: '' })
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [addingToWorkspace, setAddingToWorkspace] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Onboarding hook
  const { shouldShowOnboarding, completeOnboarding, skipOnboarding, startOnboarding } = useOnboarding();

  const [savedWorkspaces, setSavedWorkspaces] = useState([])
  const [activeTab, setActiveTab] = useState('workspace') // 'workspace' | 'saved'
  const [activeSection, setActiveSection] = useState(0) // Index for ActivityPanel sections
  const activeSectionTimeoutRef = useRef(null)
  const sharedClientRef = useRef(null)
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
      if (exists) {
        // Unpin: allow
        const next = prev.filter(n => n !== name);
        savePinnedWorkspaces(next);
        return next;
      } else {
        // Pin: enforce max 2
        // FIFO: remove first (oldest) if we have 2 or more
        let next = [...prev, name];
        if (next.length > 2) {
          next = next.slice(next.length - 2); // Keep last 2 (newest)
        }
        savePinnedWorkspaces(next);
        return next;
      }
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


  // NOTE: Disabled host settings sync (Electron app not running)
  // Settings are loaded from local IndexedDB/storage only
  useEffect(() => {
    // No-op: Host sync is disabled by default
    return () => { };
  }, [])

  // NOTE: Disabled host dashboard sync (Electron app not running)
  // Dashboard data is loaded from local storage only
  useEffect(() => {
    // No-op: Host sync is disabled by default
    return () => { };
  }, [])

  // Poll running processes from the host app
  // NOTE: Disabled since host sync is not enabled (Electron app not running)
  // This eliminates unnecessary failed network requests every 60 seconds
  useEffect(() => {
    // No-op: Host sync is disabled by default
    // This will be re-enabled when Electron host integration is implemented
    return () => { };
  }, [])

  // Mirror Chrome tabs to host (/tabs) so Electron app can read them
  // NOTE: Disabled since host sync is not enabled (Electron app not running)
  // This eliminates unnecessary network requests on every tab event
  useEffect(() => {
    // No-op: Host sync is disabled by default
    // This will be re-enabled when Electron host integration is implemented
    return () => { };
  }, []);

  // Initialize P2P Sync Service
  useEffect(() => {
    p2pSyncService.init().catch(err => {
      console.warn('Failed to initialize P2P Sync:', err);
    });
  }, []);

  // Prefill search from URL (?q=...) when opened in side panel or new tab
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const q = (params.get('q') || '').trim()
      if (q) setSearch(q)

      // Handle Team Invite (Protected)
      const inviteParam = params.get('invite');
      if (inviteParam) {
        // Delay slightly to ensure app is ready
        setTimeout(async () => {
          try {
            // Ask for PIN
            const pin = window.prompt('Enter the PIN to unlock this team invite:');
            if (!pin) return; // User cancelled

            // Decrypt
            const payload = cryptoUtils.decryptWithPin(inviteParam, pin);
            if (!payload || !payload.name || !payload.secret) {
              throw new Error('Invalid invite data');
            }

            // Join Team
            await teamManager.init();
            await teamManager.addTeam(payload.name, payload.secret);

            alert(`Successfully joined team: ${payload.name}`);

            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch (err) {
            console.error('Invite failed:', err);
            alert('Failed to join team. Incorrect PIN or invalid link.');
          }
        }, 500);
      }

      // Handle Team Join (Safe Link - Name only)
      const joinTeamName = params.get('join_team');
      if (joinTeamName) {
        // We can't auto-join, but we can open the settings tab and pre-fill
        // For now, let's just alert user what to do since we don't have deep-link to specific tab implemented yet
        setTimeout(() => {
          alert(`You've been invited to join "${joinTeamName}".\n\nPlease go to Settings > Teams > Join / Create and enter the Team Name and Secret Phrase provided to you.`);
        }, 500);
      }

      // Handle Add Workspace (from Store/URL)
      const action = params.get('action');
      const dataParam = params.get('data');
      if (action === 'add_workspace' && dataParam) {
        setTimeout(async () => {
          try {
            // Decode Base64
            const jsonString = atob(dataParam);
            const workspaceData = JSON.parse(jsonString);

            // Validate
            if (!workspaceData.name || !Array.isArray(workspaceData.urls)) {
              throw new Error('Invalid workspace data');
            }

            // Confirm with user
            if (!confirm(`Do you want to add the workspace "${workspaceData.name}"?`)) {
              return;
            }

            // Create Workspace
            const newWorkspaceId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const newWorkspace = {
              id: newWorkspaceId,
              name: workspaceData.name,
              description: workspaceData.description || `Imported from store`,
              createdAt: Date.now(),
              gridType: 'ItemGrid',
              urls: workspaceData.urls || [], // Ensure URLs are included in the workspace object
              icon: workspaceData.icon || 'globe' // Default icon
            };

            await saveWorkspace(newWorkspace);

            // Add URLs
            let addedCount = 0;
            for (const item of workspaceData.urls) {
              if (!item.url) continue;
              try {
                await addUrlToWorkspace(item.url, newWorkspaceId, {
                  title: item.title || new URL(item.url).hostname,
                  favicon: getFaviconUrl(item.url, 32),
                  addedAt: Date.now()
                });
                addedCount++;
              } catch (err) {
                console.warn(`Failed to add URL ${item.url}:`, err);
              }
            }

            // Clean URL first
            window.history.replaceState({}, document.title, window.location.pathname);

            // Refresh the workspace list manually
            console.log('[App] Refreshing workspace list...');

            // Short delay to ensure IDB consistency
            await new Promise(r => setTimeout(r, 100));

            // Force a large limit to bypass potential defaults
            const refreshedResult = await listWorkspaces({ limit: 1000 });
            console.log('[App] Refreshed result:', refreshedResult);

            if (refreshedResult?.success) {
              console.log('[App] Updating savedWorkspaces state with:', refreshedResult.data);
              setSavedWorkspaces(refreshedResult.data);
              setActiveTab('saved');

              // Verification check
              const found = refreshedResult.data.find(w => w.id === newWorkspaceId);
              if (found) {
                console.log('[App] Verified new workspace is in the list:', found);
              } else {
                console.error('[App] CRITICAL: New workspace NOT found in refreshed list!');
                console.log('[App] New Workspace ID:', newWorkspaceId);
                console.log('[App] List IDs:', refreshedResult.data.map(w => w.id));

                // DEEP DEBUG: Check if it exists at all
                try {
                  const directCheck = await getWorkspace(newWorkspaceId);
                  console.log('[App] Direct getWorkspace check:', directCheck);
                  if (directCheck) {
                    console.error('[App] It exists in DB but not in list! Sorting/Pagination issue?');
                  } else {
                    console.error('[App] It does NOT exist in DB! Write failed silently/rolled back.');
                  }
                } catch (e) {
                  console.error('[App] Direct check failed:', e);
                }
              }
            } else {
              console.error('[App] Failed to refresh workspace list');
            }

            // Also reload dashboard data if needed
            if (populate) {
              console.log('[App] Repopulating dashboard data...');
              populate();
            }

            // Show alert LAST so we don't block anything
            alert(`Successfully added workspace "${workspaceData.name}" with ${addedCount} items.`);

          } catch (err) {
            console.error('Failed to add workspace from URL:', err);
            window.history.replaceState({}, document.title, window.location.pathname);
            alert('Failed to add workspace. Invalid link or data.');
          }
        }, 500);
      }
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

          // Apply saved theme or default to crimson-fire
          const themeToApply = savedTheme || 'crimson-fire';
          const newThemeClass = `bg-${themeToApply}`;
          body.classList.add(newThemeClass);
          setThemeClass(newThemeClass);

          // Initialize font settings (size and family) using utility
          const initialFontSize = initializeFontSize();
          setFontSize(initialFontSize);

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

    // NOTE: Disabled host settings mirroring (Electron app not running)
    // Settings are only stored locally

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
      // NOTE: Disabled host settings push (Electron app not running)

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


  return (
    <div className={`popup-wrap ${themeClass} ${wallpaperEnabled ? 'wallpaper-enabled' : ''}`} style={{
      '--section-spacing': '24px',
      '--card-spacing': '16px',
      position: 'relative'
    }}>
      {/* Cooldesk UI */}
      <CoolDeskContainer
        savedWorkspaces={savedWorkspaces}
        onOpenWorkspace={(ws) => {
          setWorkspace(ws.name);
          console.log('[CoolDesk] Opening workspace:', ws.name);
        }}
        onOpenAllWorkspace={(ws) => {
          // Open all URLs in workspace
          if (ws.urls && Array.isArray(ws.urls)) {
            ws.urls.forEach((urlObj) => {
              if (urlObj.url) {
                window.open(urlObj.url, '_blank');
              }
            });
          }
        }}
        onCreateWorkspace={async (workspaceData) => {
          if (workspaceData && workspaceData.name) {
            const newId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const newWorkspace = {
              id: newId,
              name: workspaceData.name,
              icon: workspaceData.icon || 'globe',
              description: '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              urls: workspaceData.urls || [],
              gridType: 'ItemGrid'
            };

            try {
              await saveWorkspace(newWorkspace);
              console.log('[App] Created workspace via GlobalAddButton:', newWorkspace);

              // Refresh list
              const refreshedResult = await listWorkspaces({ limit: 1000 });
              if (refreshedResult?.success) {
                setSavedWorkspaces(refreshedResult.data);
                // Optionally switch to it
                // setWorkspace(newWorkspace.name);
              }
            } catch (err) {
              console.error('Failed to create workspace:', err);
              alert('Failed to create workspace');
            }
          } else {
            // Legacy or fallback behavior
            setShowCreateWorkspace(true);
          }
        }}
        onAddUrlToWorkspace={async (workspaceId, urlData) => {
          try {
            // Find workspace by ID
            const workspace = savedWorkspaces.find(ws => ws.id === workspaceId);
            if (!workspace) {
              console.error('Workspace not found:', workspaceId);
              return;
            }

            // Add URL using existing handler
            await handleAddSavedUrlToWorkspace(urlData.url, workspace.name);
            console.log('[CoolDesk] Added URL to workspace:', { workspace: workspace.name, url: urlData.url });
          } catch (error) {
            console.error('[CoolDesk] Failed to add URL:', error);
          }
        }}
        onAddNote={async (noteText) => {
          // Note: Integrate with your notes system
          // For now, just log it
          console.log('[CoolDesk] Adding note:', noteText);
          // You can add this to SimpleNotes or NotesWidget
        }}
        onSearch={(query) => {
          setSearch(query);
          console.log('[CoolDesk] Search:', query);
        }}
        onOpenSettings={() => {
          setShowSettings(true);
        }}
        themeClass={themeClass}
        wallpaperEnabled={wallpaperEnabled}
        wallpaperUrl={wallpaperUrl}
        wallpaperOpacity={wallpaperOpacity}
        pinnedWorkspaces={pinnedWorkspaces}
        onTogglePin={togglePinWorkspace}
      />

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

      {/* Onboarding Tour */}
      {shouldShowOnboarding && (
        <OnboardingTour
          onComplete={completeOnboarding}
          onSkip={skipOnboarding}
        />
      )}
    </div>
  )
}
