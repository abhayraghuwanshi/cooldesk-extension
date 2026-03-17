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
  suggestion: { icon: faWandMagicSparkles, label: 'AI', color: '#a855f7' }
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
  const existingAppSet = useMemo(() => new Set(apps.map(a => a.path?.toLowerCase())), [apps]);

  // Merge URLs and Apps into unified list
  const currentItems = useMemo(() => {
    const items = [];

    // Add URLs
    urls.forEach((urlItem, idx) => {
      items.push({
        id: `url:${urlItem.url}`,
        type: 'url',
        title: urlItem.title || safeGetHostname(urlItem.url),
        subtitle: safeGetHostname(urlItem.url),
        url: urlItem.url,
        favicon: urlItem.favicon,
        isApp: false
      });
    });

    // Add Apps
    apps.forEach((app, idx) => {
      items.push({
        id: `app:${app.path}`,
        type: 'app',
        title: app.name,
        subtitle: 'Desktop App',
        icon: app.icon,
        path: app.path,
        isApp: true
      });
    });

    return items;
  }, [urls, apps]);

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

  // Handle removing an item
  const handleRemoveItem = (item) => {
    if (item.isApp) {
      onRemoveApp?.(item.path);
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
          {/* Search Input */}
          <div className="awm-items-search">
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

            {/* Search Results - Show when searching */}
            {hasSearchResults && (
              <>
                <div className="awm-items-divider">
                  <span>Search Results</span>
                </div>
                {searchResults.map((item) => {
                  const typeConfig = TYPE_CONFIG[item.type] || TYPE_CONFIG.url;
                  return (
                    <div key={item.id} className="awm-items-row awm-items-result">
                      <div className="awm-items-icon" style={item.isApp ? { background: 'rgba(34, 197, 94, 0.1)' } : {}}>
                        {item.isApp ? (
                          item.icon ? <img src={item.icon} alt="" /> : <FontAwesomeIcon icon={faDesktop} style={{ color: '#22c55e' }} />
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
                      <button className="awm-items-add" onClick={() => handleAddItem(item)}>
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
              return (
                <div key={item.id} className="awm-items-row">
                  <div className="awm-items-icon" style={item.isApp ? { background: 'rgba(34, 197, 94, 0.1)' } : {}}>
                    {item.isApp ? (
                      item.icon ? <img src={item.icon} alt="" /> : <FontAwesomeIcon icon={faDesktop} style={{ color: '#22c55e' }} />
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
