import {
  faBookmark,
  faCheck,
  faClock,
  faDesktop,
  faFolder,
  faFolderOpen,
  faGlobe,
  faLink,
  faPlay,
  faPlus,
  faFolderPlus,
  faSearch,
  faStar,
  faTimes,
  faTrash,
  faWandMagicSparkles
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { runningAppsService } from '../../../services/runningAppsService';
import { safeGetHostname, enrichRunningAppsWithIcons } from '../../../utils/helpers';

import { faCode, faFileLines } from '@fortawesome/free-solid-svg-icons';

const ICONS = [
  { key: 'folder', icon: faFolder },
  { key: 'folder-open', icon: faFolderOpen },
  { key: 'globe', icon: faGlobe },
  { key: 'link', icon: faLink },
  { key: 'star', icon: faStar }
];

const TYPE_CONFIG = {
  url: { icon: faGlobe, label: 'URL', color: '#60a5fa' },
  app: { icon: faDesktop, label: 'App', color: '#22c55e' },
  tab: { icon: faLink, label: 'Tab', color: '#60a5fa' },
  history: { icon: faClock, label: 'History', color: '#a78bfa' },
  bookmark: { icon: faBookmark, label: 'Bookmark', color: '#fbbf24' },
  running: { icon: faPlay, label: 'Running', color: '#22c55e' },
  suggestion: { icon: faWandMagicSparkles, label: 'AI', color: '#a855f7' },
  manual: { icon: faPlus, label: 'Add', color: '#10b981' }
};

export default function WorkspaceEditor({
  formData,
  onUpdate,
  onRemoveUrl,
  onRemoveApp,
  onSave,
  onDelete,
  isNewWorkspace,
  // Browser data for search
  tabs = [],
  history = [],
  bookmarks = [],
  // AI suggestions
  relatedUrls = [],
  relatedUrlsLoading = false,
  aiError = null,
  onAddItem
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [runningApps, setRunningApps] = useState([]);
  const [installedApps, setInstalledApps] = useState([]);
  const searchTimeoutRef = useRef(null);
  const inputRef = useRef(null);

  const apps = formData.apps || [];
  const urls = formData.urls || [];

  // Subscribe to running apps
  useEffect(() => {
    const unsubscribe = runningAppsService.subscribe(({ runningApps: running, installedApps: installed }) => {
      const enriched = enrichRunningAppsWithIcons(running || [], installed || []);
      setRunningApps(enriched);
      setInstalledApps(installed || []);
    });
    return unsubscribe;
  }, []);

  // Build existing item sets for filtering
  const existingUrlSet = useMemo(() => new Set(urls.map(u => u.url?.toLowerCase())), [urls]);
  const existingAppSet = useMemo(() => new Set(apps.map(a => `${a.path?.toLowerCase()}|${a.appType?.toLowerCase() || 'default'}`)), [apps]);

  // Merge URLs and Apps into unified list
  const currentItems = useMemo(() => {
    const items = [];

    // Add URLs
    urls.forEach((urlItem, idx) => {
      items.push({
        id: `url:${urlItem.url}`,
        type: 'url',
        title: urlItem.title || urlItem.url.replace(new RegExp('^https?:\\\\/\\\\/(www\\\\.)?', 'i'), ''),
        subtitle: safeGetHostname(urlItem.url),
        url: urlItem.url,
        favicon: urlItem.favicon,
        isApp: false
      });
    });

    // Add Apps
    apps.forEach((app, idx) => {
      const CUSTOM_EDITORS = ['vscode', 'code', 'cursor', 'windsurf', 'idea', 'webstorm', 'pycharm', 'goland', 'phpstorm', 'rider', 'clion', 'rubymine', 'fleet', 'zed'];
      const isEditor = CUSTOM_EDITORS.includes(app.appType?.toLowerCase());
      
      items.push({
        id: `app:${app.path}:${app.appType || 'default'}`,
        type: 'app',
        title: app.name,
        subtitle: isEditor ? `${app.appType} Project` : (app.appType === 'folder' ? 'Local Folder' : app.appType === 'file' ? 'Local File' : 'Desktop App'),
        icon: app.icon,
        path: app.path,
        isApp: true,
        appType: app.appType
      });
    });

    return items;
  }, [urls, apps]);

  // Check if query looks like a URL
  const isUrl = (str) => {
    if (!str) return false;
    // Match URLs with protocol or domain-like patterns
    return /^https?:\/\//i.test(str) || /^[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(str);
  };

  // Search handler
  const handleSearch = useCallback((query) => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const q = query.toLowerCase();
    const results = [];

    // If it looks like a URL and not already in workspace, offer to add it directly
    if (isUrl(query.trim())) {
      const urlToAdd = query.trim().startsWith('http') ? query.trim() : `https://${query.trim()}`;
      if (!existingUrlSet.has(urlToAdd.toLowerCase())) {
        results.push({
          id: `manual:${urlToAdd}`,
          type: 'url',
          title: urlToAdd.replace(new RegExp('^https?:\\\\/\\\\/(www\\\\.)?', 'i'), ''),
          subtitle: 'Add custom URL',
          url: urlToAdd,
          favicon: null,
          isApp: false,
          isManual: true
        });
      }
    }

    // Search tabs
    tabs
      .filter(tab =>
        (tab.title?.toLowerCase().includes(q) || tab.url?.toLowerCase().includes(q)) &&
        !existingUrlSet.has(tab.url?.toLowerCase())
      )
      .slice(0, 5)
      .forEach(tab => {
        results.push({
          id: `tab:${tab.url}`,
          type: 'tab',
          title: tab.title || tab.url,
          subtitle: safeGetHostname(tab.url),
          url: tab.url,
          favicon: tab.favicon || tab.favIconUrl,
          isApp: false
        });
      });

    // Search history
    history
      .filter(h =>
        (h.title?.toLowerCase().includes(q) || h.url?.toLowerCase().includes(q)) &&
        !existingUrlSet.has(h.url?.toLowerCase()) &&
        !results.some(r => r.url === h.url)
      )
      .slice(0, 3)
      .forEach(h => {
        results.push({
          id: `history:${h.url}`,
          type: 'history',
          title: h.title || h.url,
          subtitle: safeGetHostname(h.url),
          url: h.url,
          favicon: h.favicon,
          isApp: false
        });
      });

    // Search bookmarks
    bookmarks
      .filter(b =>
        (b.title?.toLowerCase().includes(q) || b.url?.toLowerCase().includes(q)) &&
        !existingUrlSet.has(b.url?.toLowerCase()) &&
        !results.some(r => r.url === b.url)
      )
      .slice(0, 3)
      .forEach(b => {
        results.push({
          id: `bookmark:${b.url}`,
          type: 'bookmark',
          title: b.title || b.url,
          subtitle: safeGetHostname(b.url),
          url: b.url,
          favicon: b.favicon,
          isApp: false
        });
      });

    // Search running apps
    runningApps
      .filter(app =>
        app.name?.toLowerCase().includes(q) &&
        !existingAppSet.has(app.path?.toLowerCase())
      )
      .slice(0, 3)
      .forEach(app => {
        results.push({
          id: `running:${app.path}`,
          type: 'running',
          title: app.name,
          subtitle: 'Running App',
          icon: app.icon,
          path: app.path,
          isApp: true
        });
      });

    // Search installed apps
    installedApps
      .filter(app =>
        app.name?.toLowerCase().includes(q) &&
        !existingAppSet.has(app.path?.toLowerCase()) &&
        !results.some(r => r.path === app.path)
      )
      .slice(0, 3)
      .forEach(app => {
        results.push({
          id: `installed:${app.path}`,
          type: 'app',
          title: app.name,
          subtitle: 'Installed App',
          icon: app.icon,
          path: app.path,
          isApp: true
        });
      });

    setSearchResults(results);
    setIsSearching(false);
  }, [tabs, history, bookmarks, runningApps, installedApps, existingUrlSet, existingAppSet]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(searchQuery);
    }, 100);
    return () => clearTimeout(searchTimeoutRef.current);
  }, [searchQuery, handleSearch]);

  // State for the modern local item flow
  const [localItemFlow, setLocalItemFlow] = useState({
    isOpen: false,
    step: 'type', // 'type' | 'editor'
    selectedPath: null,
    isFolder: false,
    folderName: null
  });

  // Handle adding an item
  const handleAddItem = (item) => {
    if (item.isApp) {
      onAddItem?.({
        urls: [],
        apps: [{ name: item.title, path: item.path, icon: item.icon }]
      });
    } else {
      onAddItem?.({
        urls: [{ url: item.url, title: item.title, favicon: item.favicon, addedAt: Date.now() }],
        apps: []
      });
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleAddLocalItemClick = () => {
    const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ || navigator.userAgent.includes('Tauri');
    if (isTauri) {
      setLocalItemFlow({ isOpen: true, step: 'type', selectedPath: null, isFolder: false, folderName: null });
    } else {
      alert("Local file selection is only available in the desktop app.");
    }
  };

  const handleSelectLocalType = async (isFolder) => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        ...(isFolder ? { directory: true } : {}),
        multiple: false,
        title: isFolder ? 'Select Folder or Project' : 'Select File'
      });
      
      if (selected) {
        const folderName = selected.split(/\\|\//).pop() || selected;
        setLocalItemFlow(prev => ({ ...prev, step: 'editor', selectedPath: selected, isFolder, folderName }));
      } else {
        // Cancelled dialog
        setLocalItemFlow(prev => ({ ...prev, isOpen: false }));
      }
    } catch (e) {
      console.error("Failed to add local item", e);
      setLocalItemFlow(prev => ({ ...prev, isOpen: false }));
    }
  };

  const handleSelectEditor = (editorKey) => {
    const { selectedPath, isFolder, folderName } = localItemFlow;
    const appType = editorKey || (isFolder ? 'folder' : 'file');
    onAddItem?.({
      urls: [],
      apps: [{ name: folderName, path: selectedPath, icon: null, appType }]
    });
    setLocalItemFlow({ isOpen: false, step: 'type', selectedPath: null, isFolder: false, folderName: null });
  };

  // Handle removing an item
  const handleRemoveItem = (item) => {
    if (item.isApp) {
      onRemoveApp?.(item);
    } else {
      onRemoveUrl?.(item.url);
    }
  };

  // AI suggestions filtered
  const filteredSuggestions = useMemo(() => {
    if (searchQuery.trim()) return []; // Hide when searching
    return relatedUrls
      .filter(s => !existingUrlSet.has(s.url?.toLowerCase()))
      .slice(0, 4)
      .map(s => ({
        ...s,
        id: `suggestion:${s.url}`,
        type: 'suggestion',
        subtitle: s.reason || safeGetHostname(s.url),
        isApp: false
      }));
  }, [relatedUrls, existingUrlSet, searchQuery]);

  const totalItems = currentItems.length;
  const hasSearchResults = searchResults.length > 0;
  const hasSuggestions = filteredSuggestions.length > 0 && !searchQuery.trim();

  return (
    <div className="awm-editor">
      {/* Name + Icon row */}
      <div className="awm-name-row">
        <div className="awm-icon-selector-compact">
          {ICONS.map(({ key, icon }) => (
            <button
              key={key}
              className={`awm-icon-btn-sm ${formData.icon === key ? 'selected' : ''}`}
              onClick={() => onUpdate('icon', key)}
            >
              <FontAwesomeIcon icon={icon} />
            </button>
          ))}
        </div>
        <input
          type="text"
          className="awm-name-input"
          value={formData.name}
          onChange={(e) => onUpdate('name', e.target.value)}
          placeholder="Workspace name..."
          autoFocus
        />
      </div>

      {/* Unified Items Section */}
      <div className="awm-items-section">
        <label>
          Workspace Items
          <span className="awm-url-count">{totalItems} items</span>
        </label>

        <div className="awm-items-container">
          {localItemFlow.isOpen ? (
            <div style={{ display: 'flex', flexDirection: 'column', padding: '16px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#E2E8F0' }}>
                  {localItemFlow.step === 'type' ? 'Add Local Item' : 'Open With...'}
                </h4>
                <button 
                  onClick={() => setLocalItemFlow(prev => ({ ...prev, isOpen: false }))}
                  style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: '4px' }}
                >
                  <FontAwesomeIcon icon={faTimes} />
                </button>
              </div>
              
              {localItemFlow.step === 'type' && (
                <div>
                  <p style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '16px', marginTop: 0 }}>
                    Select what kind of item you want to add from your computer.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <button 
                      onClick={() => handleSelectLocalType(true)}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '24px 16px', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', cursor: 'pointer', color: '#E2E8F0', transition: 'all 0.2s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(51, 65, 85, 0.5)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(30, 41, 59, 0.5)'; }}
                    >
                      <FontAwesomeIcon icon={faFolderPlus} style={{ color: '#facc15', fontSize: '24px' }} />
                      <span style={{ fontSize: '13px', fontWeight: 500 }}>Folder / Project</span>
                    </button>
                    <button 
                      onClick={() => handleSelectLocalType(false)}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '24px 16px', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', cursor: 'pointer', color: '#E2E8F0', transition: 'all 0.2s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(51, 65, 85, 0.5)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(30, 41, 59, 0.5)'; }}
                    >
                      <FontAwesomeIcon icon={faFileLines} style={{ color: '#94a3b8', fontSize: '24px' }} />
                      <span style={{ fontSize: '13px', fontWeight: 500 }}>Local File</span>
                    </button>
                  </div>
                </div>
              )}

              {localItemFlow.step === 'editor' && (
                <div>
                  <p style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '16px', marginTop: 0 }}>
                    How would you like to open loosely <strong style={{color: '#E2E8F0'}}>{localItemFlow.folderName}</strong>?
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px' }}>
                    {[
                      { key: 'vscode', name: 'VS Code', icon: faCode, color: '#38bdf8' },
                      { key: 'cursor', name: 'Cursor', icon: faCode, color: '#a855f7' },
                      { key: 'windsurf', name: 'Windsurf', icon: faCode, color: '#f43f5e' },
                      { key: 'idea', name: 'IntelliJ', icon: faCode, color: '#ec4899' },
                      { key: 'webstorm', name: 'WebStorm', icon: faCode, color: '#06b6d4' },
                      { key: '', name: localItemFlow.isFolder ? 'Explorer' : 'Default', icon: localItemFlow.isFolder ? faFolderOpen : faFileLines, color: localItemFlow.isFolder ? '#facc15' : '#94a3b8' }
                    ].map(editor => (
                      <button 
                        key={editor.name} 
                        onClick={() => handleSelectEditor(editor.key)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px 8px', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', cursor: 'pointer', color: '#E2E8F0', transition: 'all 0.2s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(51, 65, 85, 0.5)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(30, 41, 59, 0.5)'; }}
                      >
                        <FontAwesomeIcon icon={editor.icon} style={{ color: editor.color, fontSize: '18px' }} />
                        <span style={{ fontSize: '11px', textAlign: 'center', lineHeight: '1.2' }}>{editor.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <div className="awm-items-search" style={{ flex: 1, margin: 0 }}>
              <FontAwesomeIcon icon={faSearch} className="awm-items-search-icon" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search to add tabs, apps, bookmarks..."
              />
              {isSearching && <div className="awm-spinner-xs" />}
            </div>
            <button
                className="awm-btn"
                style={{ padding: '0 12px', background: 'rgba(96, 165, 250, 0.1)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.3)', borderRadius: '8px', cursor: 'pointer' }}
                onClick={handleAddLocalItemClick}
                title="Add Local Folder, Project, or File"
            >
                <FontAwesomeIcon icon={faFolderPlus} />
            </button>
          </div>
          )}

          {/* Items List */}
          <div className="awm-items-list">
            {/* AI Suggestions - Show FIRST for visibility */}
            {hasSuggestions && (
              <>
                <div className="awm-items-divider awm-items-divider-ai">
                  <FontAwesomeIcon icon={faWandMagicSparkles} />
                  <span>AI Suggestions</span>
                </div>
                {filteredSuggestions.map((item) => (
                  <div key={item.id} className="awm-items-row awm-items-suggestion">
                    <div className="awm-items-icon">
                      {item.favicon ? (
                        <img src={item.favicon} alt="" onError={(e) => e.target.style.display = 'none'} />
                      ) : (
                        <FontAwesomeIcon icon={faGlobe} />
                      )}
                    </div>
                    <div className="awm-items-info">
                      <span className="awm-items-title">{item.title}</span>
                      <span className="awm-items-subtitle awm-items-reason">{item.subtitle}</span>
                    </div>
                    <button className="awm-items-add awm-items-add-ai" onClick={() => handleAddItem(item)}>
                      <FontAwesomeIcon icon={faPlus} />
                    </button>
                  </div>
                ))}
              </>
            )}

            {/* Loading state for AI suggestions */}
            {relatedUrlsLoading && !hasSuggestions && (
              <div className="awm-items-row awm-items-loading">
                <div className="awm-spinner-xs" />
                <span className="awm-items-loading-text">Finding suggestions...</span>
              </div>
            )}

            {/* AI error state */}
            {aiError && !relatedUrlsLoading && !hasSuggestions && (
              <div className="awm-items-row awm-items-ai-error">
                <FontAwesomeIcon icon={faWandMagicSparkles} />
                <span className="awm-items-loading-text">{aiError}</span>
              </div>
            )}

            {/* Search Results - Show when searching */}
            {hasSearchResults && (
              <>
                <div className="awm-items-divider">
                  <span>Search Results</span>
                </div>
                {searchResults.map((item) => {
                  const typeConfig = item.isManual ? TYPE_CONFIG.manual : (TYPE_CONFIG[item.type] || TYPE_CONFIG.url);
                  return (
                    <div key={item.id} className={`awm-items-row awm-items-result ${item.isManual ? 'awm-items-manual' : ''}`}>
                      <div className="awm-items-icon" style={item.isManual ? { background: 'rgba(16, 185, 129, 0.15)' } : item.isApp ? { background: 'rgba(34, 197, 94, 0.1)' } : {}}>
                        {item.isApp ? (
                          item.icon ? <img src={item.icon} alt="" /> : <FontAwesomeIcon icon={faDesktop} style={{ color: '#22c55e' }} />
                        ) : item.favicon ? (
                          <img src={item.favicon} alt="" onError={(e) => e.target.style.display = 'none'} />
                        ) : (
                          <FontAwesomeIcon icon={faGlobe} style={item.isManual ? { color: '#10b981' } : {}} />
                        )}
                      </div>
                      <div className="awm-items-info">
                        <span className="awm-items-title">{item.title}</span>
                        <span className="awm-items-subtitle" style={item.isManual ? { color: '#10b981' } : {}}>{item.subtitle}</span>
                      </div>
                      <span className="awm-items-type" style={{ color: typeConfig.color }}>
                        <FontAwesomeIcon icon={typeConfig.icon} />
                      </span>
                      <button className="awm-items-add" onClick={() => handleAddItem(item)} style={item.isManual ? { background: '#10b981' } : {}}>
                        <FontAwesomeIcon icon={faPlus} />
                      </button>
                    </div>
                  );
                })}
              </>
            )}

            {/* Current Items divider - only show if there are items */}
            {currentItems.length > 0 && (
              <div className="awm-items-divider awm-items-divider-current">
                <span>Current Items ({currentItems.length})</span>
              </div>
            )}

            {/* Existing Items */}
            {currentItems.map((item) => {
              const typeConfig = TYPE_CONFIG[item.type] || TYPE_CONFIG.url;
              const CUSTOM_EDITORS = ['vscode', 'code', 'cursor', 'windsurf', 'idea', 'webstorm', 'pycharm', 'goland', 'phpstorm', 'rider', 'clion', 'rubymine', 'fleet', 'zed'];
              const isEditor = CUSTOM_EDITORS.includes(item.appType?.toLowerCase());
              
              return (
                <div key={item.id} className="awm-items-row">
                  <div className="awm-items-icon" style={item.isApp ? { background: isEditor ? 'rgba(56, 189, 248, 0.1)' : item.appType === 'folder' ? 'rgba(250, 204, 21, 0.1)' : item.appType === 'file' ? 'rgba(148, 163, 184, 0.1)' : 'rgba(34, 197, 94, 0.1)' } : {}}>
                    {item.isApp ? (
                      item.icon ? <img src={item.icon} alt="" /> : <FontAwesomeIcon icon={isEditor ? faCode : item.appType === 'folder' ? faFolderOpen : item.appType === 'file' ? faFileLines : faDesktop} style={{ color: isEditor ? '#38bdf8' : item.appType === 'folder' ? '#facc15' : item.appType === 'file' ? '#94a3b8' : '#22c55e' }} />
                    ) : item.favicon ? (
                      <img src={item.favicon} alt="" onError={(e) => e.target.style.display = 'none'} />
                    ) : (
                      <FontAwesomeIcon icon={faGlobe} />
                    )}
                  </div>
                  <div className="awm-items-info">
                    <span className="awm-items-title">{item.title}</span>
                    <span className="awm-items-subtitle">{item.subtitle}</span>
                  </div>
                  <span className="awm-items-type" style={{ color: typeConfig.color }}>
                    <FontAwesomeIcon icon={typeConfig.icon} />
                  </span>
                  <button className="awm-items-remove" onClick={() => handleRemoveItem(item)}>
                    <FontAwesomeIcon icon={faTimes} />
                  </button>
                </div>
              );
            })}

            {/* Empty state */}
            {currentItems.length === 0 && !hasSearchResults && !hasSuggestions && !relatedUrlsLoading && (
              <div className="awm-items-empty">
                Type above to search and add items
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="awm-form-group awm-description-group">
        <label>Description (optional)</label>
        <input
          type="text"
          value={formData.description}
          onChange={(e) => onUpdate('description', e.target.value)}
          placeholder="What is this workspace for?"
        />
      </div>

      {/* Actions */}
      <div className="awm-editor-actions">
        {!isNewWorkspace && (
          <button className="awm-btn awm-btn-danger" onClick={onDelete}>
            <FontAwesomeIcon icon={faTrash} />
            Delete
          </button>
        )}
        <button
          className="awm-btn awm-btn-primary"
          onClick={onSave}
          disabled={!formData.name.trim()}
        >
          <FontAwesomeIcon icon={faCheck} />
          {isNewWorkspace ? 'Create Workspace' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
