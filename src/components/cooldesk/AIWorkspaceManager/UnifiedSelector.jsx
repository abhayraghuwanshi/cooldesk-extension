import {
  faBookmark,
  faCheck,
  faClock,
  faDesktop,
  faGlobe,
  faLink,
  faPlay,
  faPlus,
  faRobot,
  faSearch,
  faHandPointer
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { runningAppsService } from '../../../services/runningAppsService';
import { safeGetHostname, enrichRunningAppsWithIcons } from '../../../utils/helpers';

// Type badges and icons
const TYPE_CONFIG = {
  tab: { icon: faLink, label: 'Tab', color: '#60a5fa' },
  history: { icon: faClock, label: 'History', color: '#a78bfa' },
  bookmark: { icon: faBookmark, label: 'Bookmark', color: '#fbbf24' },
  app: { icon: faDesktop, label: 'App', color: '#22c55e' },
  running: { icon: faPlay, label: 'Running', color: '#22c55e' }
};

export default function UnifiedSelector({
  tabs = [],
  history = [],
  bookmarks = [],
  existingUrls = [],
  existingApps = [],
  onAddItems,
  isLoading: externalLoading,
  // AI suggestions props
  aiSuggestions = [],
  aiSuggestionsLoading = false,
  onAddAiSuggestion
}) {
  const [mode, setMode] = useState('manual'); // 'ai' | 'manual'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [runningApps, setRunningApps] = useState([]);
  const [installedApps, setInstalledApps] = useState([]);
  const [isAppsLoading, setIsAppsLoading] = useState(true);
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Subscribe to running apps service
  useEffect(() => {
    const unsubscribe = runningAppsService.subscribe(({ runningApps: running, installedApps: installed }) => {
      const enriched = enrichRunningAppsWithIcons(running || [], installed || []);
      setRunningApps(enriched);
      setInstalledApps(installed || []);
      setIsAppsLoading(false);
    });
    return unsubscribe;
  }, []);

  // Create sets for existing items to filter out
  const existingUrlSet = useMemo(() => new Set(existingUrls.map(u => u.url?.toLowerCase())), [existingUrls]);
  const existingAppSet = useMemo(() => new Set(existingApps.map(a => a.path?.toLowerCase())), [existingApps]);

  // Build unified item list when not searching
  const defaultItems = useMemo(() => {
    const items = [];

    // Add running apps first (most relevant)
    runningApps
      .filter(app => app.name && !existingAppSet.has(app.path?.toLowerCase()))
      .slice(0, 4)
      .forEach(app => {
        items.push({
          id: `app:${app.path}`,
          type: 'running',
          title: app.name,
          subtitle: app.title !== app.name ? app.title : 'Running',
          icon: app.icon,
          path: app.path,
          isApp: true
        });
      });

    // Add open tabs
    tabs
      .filter(tab => tab.url && !existingUrlSet.has(tab.url.toLowerCase()))
      .slice(0, 6)
      .forEach(tab => {
        items.push({
          id: `tab:${tab.url}`,
          type: 'tab',
          title: tab.title || tab.url,
          subtitle: safeGetHostname(tab.url),
          url: tab.url,
          favicon: tab.favicon || tab.favIconUrl,
          isApp: false
        });
      });

    // Add recent history (different from tabs)
    const tabUrls = new Set(tabs.map(t => t.url?.toLowerCase()));
    history
      .filter(h => h.url && !existingUrlSet.has(h.url.toLowerCase()) && !tabUrls.has(h.url.toLowerCase()))
      .slice(0, 4)
      .forEach(h => {
        items.push({
          id: `history:${h.url}`,
          type: 'history',
          title: h.title || h.url,
          subtitle: safeGetHostname(h.url),
          url: h.url,
          favicon: h.favicon,
          isApp: false
        });
      });

    return items;
  }, [tabs, history, runningApps, existingUrlSet, existingAppSet]);

  // Search handler with debounce
  const handleSearch = useCallback(async (query) => {
    if (!query.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const q = query.toLowerCase();

    try {
      const results = [];

      // Search tabs
      tabs
        .filter(tab =>
          (tab.title?.toLowerCase().includes(q) || tab.url?.toLowerCase().includes(q)) &&
          !existingUrlSet.has(tab.url?.toLowerCase())
        )
        .slice(0, 8)
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
          !existingUrlSet.has(h.url?.toLowerCase())
        )
        .slice(0, 6)
        .forEach(h => {
          if (!results.some(r => r.url === h.url)) {
            results.push({
              id: `history:${h.url}`,
              type: 'history',
              title: h.title || h.url,
              subtitle: safeGetHostname(h.url),
              url: h.url,
              favicon: h.favicon,
              isApp: false
            });
          }
        });

      // Search bookmarks
      bookmarks
        .filter(b =>
          (b.title?.toLowerCase().includes(q) || b.url?.toLowerCase().includes(q)) &&
          !existingUrlSet.has(b.url?.toLowerCase())
        )
        .slice(0, 6)
        .forEach(b => {
          if (!results.some(r => r.url === b.url)) {
            results.push({
              id: `bookmark:${b.url}`,
              type: 'bookmark',
              title: b.title || b.url,
              subtitle: safeGetHostname(b.url),
              url: b.url,
              favicon: b.favicon,
              isApp: false
            });
          }
        });

      // Search running apps
      runningApps
        .filter(app =>
          app.name?.toLowerCase().includes(q) &&
          !existingAppSet.has(app.path?.toLowerCase())
        )
        .slice(0, 4)
        .forEach(app => {
          results.push({
            id: `app:${app.path}`,
            type: 'running',
            title: app.name,
            subtitle: app.title !== app.name ? app.title : 'Running',
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
        .slice(0, 4)
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
    } catch (e) {
      console.error('[UnifiedSelector] Search error:', e);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [tabs, history, bookmarks, runningApps, installedApps, existingUrlSet, existingAppSet]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(searchQuery);
    }, 150);
    return () => clearTimeout(searchTimeoutRef.current);
  }, [searchQuery, handleSearch]);

  // Items to display
  const displayItems = searchResults !== null ? searchResults : defaultItems;

  const handleToggleItem = (item) => {
    const next = new Set(selectedItems);
    if (next.has(item.id)) {
      next.delete(item.id);
    } else {
      next.add(item.id);
    }
    setSelectedItems(next);
  };

  const handleSelectAll = () => {
    const allIds = new Set(displayItems.map(item => item.id));
    setSelectedItems(allIds);
  };

  const handleClearSelection = () => {
    setSelectedItems(new Set());
  };

  const handleAddSelected = () => {
    const urlsToAdd = [];
    const appsToAdd = [];

    displayItems.forEach(item => {
      if (!selectedItems.has(item.id)) return;

      if (item.isApp) {
        appsToAdd.push({
          name: item.title,
          path: item.path,
          icon: item.icon
        });
      } else {
        urlsToAdd.push({
          url: item.url,
          title: item.title,
          favicon: item.favicon,
          addedAt: Date.now()
        });
      }
    });

    onAddItems({ urls: urlsToAdd, apps: appsToAdd });
    setSelectedItems(new Set());
    setSearchQuery('');
  };

  const isLoading = externalLoading || isAppsLoading;

  // Render AI suggestion item
  const renderAiSuggestionItem = (item, index) => {
    return (
      <div
        key={item.url || item.path || index}
        className="awm-selector-item awm-ai-item"
      >
        <div
          className="awm-item-favicon"
          style={item.isApp ? {
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.3)'
          } : {}}
        >
          {item.isApp ? (
            item.icon ? (
              <img src={item.icon} alt="" />
            ) : (
              <FontAwesomeIcon icon={faDesktop} style={{ color: '#22c55e' }} />
            )
          ) : item.favicon ? (
            <img src={item.favicon} alt="" onError={(e) => e.target.style.display = 'none'} />
          ) : (
            <FontAwesomeIcon icon={faGlobe} />
          )}
        </div>
        <div className="awm-item-info">
          <span className="awm-item-title">{item.title}</span>
          <span className="awm-item-subtitle">{item.subtitle || safeGetHostname(item.url)}</span>
          {item.reason && (
            <span className="awm-item-reason">{item.reason}</span>
          )}
        </div>
        <button
          className="awm-item-add-btn"
          onClick={() => onAddAiSuggestion?.(item)}
          title="Add to workspace"
        >
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>
    );
  };

  return (
    <div className="awm-selector-compact">
      {/* Mode Toggle */}
      <div className="awm-selector-toggle">
        <button
          className={`awm-toggle-btn ${mode === 'ai' ? 'active' : ''}`}
          onClick={() => setMode('ai')}
        >
          <FontAwesomeIcon icon={faRobot} />
          <span>AI Suggestions</span>
        </button>
        <button
          className={`awm-toggle-btn ${mode === 'manual' ? 'active' : ''}`}
          onClick={() => setMode('manual')}
        >
          <FontAwesomeIcon icon={faHandPointer} />
          <span>Manual</span>
        </button>
      </div>

      {mode === 'ai' ? (
        /* AI Suggestions Mode */
        <div className="awm-ai-panel">
          {aiSuggestionsLoading ? (
            <div className="awm-selector-loading">
              <div className="awm-spinner-sm" />
              <span>Finding related items...</span>
            </div>
          ) : aiSuggestions.length === 0 ? (
            <div className="awm-selector-empty-compact">
              <FontAwesomeIcon icon={faRobot} />
              <span>No AI suggestions available</span>
            </div>
          ) : (
            <div className="awm-ai-list">
              {aiSuggestions.slice(0, 6).map(renderAiSuggestionItem)}
            </div>
          )}
        </div>
      ) : (
        /* Manual Mode */
        <div className="awm-manual-panel">
          {/* Compact Search */}
          <div className="awm-search-compact">
            <FontAwesomeIcon icon={faSearch} className="awm-search-icon-sm" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tabs, apps, history..."
            />
            {isSearching && <div className="awm-spinner-xs" />}
          </div>

          {/* Quick Actions */}
          {selectedItems.size > 0 && (
            <div className="awm-quick-actions">
              <span className="awm-selected-badge">{selectedItems.size} selected</span>
              <button className="awm-link-btn" onClick={handleClearSelection}>Clear</button>
              <button className="awm-add-btn-compact" onClick={handleAddSelected}>
                <FontAwesomeIcon icon={faPlus} />
                Add
              </button>
            </div>
          )}

          {/* Results List */}
          <div className="awm-results-compact">
            {isLoading ? (
              <div className="awm-selector-loading">
                <div className="awm-spinner-sm" />
              </div>
            ) : displayItems.length === 0 ? (
              <div className="awm-selector-empty-compact">
                {searchQuery ? 'No results' : 'Type to search'}
              </div>
            ) : (
              displayItems.slice(0, 10).map((item) => {
                const isSelected = selectedItems.has(item.id);
                const typeConfig = TYPE_CONFIG[item.type] || TYPE_CONFIG.tab;

                return (
                  <button
                    key={item.id}
                    className={`awm-selector-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleToggleItem(item)}
                  >
                    <div className={`awm-mini-check ${isSelected ? 'checked' : ''}`}>
                      {isSelected && <FontAwesomeIcon icon={faCheck} />}
                    </div>
                    <div
                      className="awm-item-favicon"
                      style={item.isApp ? {
                        background: 'rgba(34, 197, 94, 0.1)',
                        border: '1px solid rgba(34, 197, 94, 0.3)'
                      } : {}}
                    >
                      {item.isApp ? (
                        item.icon ? (
                          <img src={item.icon} alt="" />
                        ) : (
                          <FontAwesomeIcon icon={faDesktop} style={{ color: '#22c55e' }} />
                        )
                      ) : item.favicon ? (
                        <img src={item.favicon} alt="" onError={(e) => e.target.style.display = 'none'} />
                      ) : (
                        <FontAwesomeIcon icon={faGlobe} />
                      )}
                    </div>
                    <div className="awm-item-info">
                      <span className="awm-item-title">{item.title}</span>
                      <span className="awm-item-subtitle">{item.subtitle}</span>
                    </div>
                    <span
                      className="awm-type-tag"
                      style={{
                        background: `${typeConfig.color}15`,
                        color: typeConfig.color
                      }}
                    >
                      <FontAwesomeIcon icon={typeConfig.icon} />
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
