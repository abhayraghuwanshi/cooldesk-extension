import {
  faCheck,
  faDesktop,
  faLightbulb,
  faPlay,
  faPlus,
  faRobot,
  faSearch
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState, useMemo, useEffect } from 'react';
import { runningAppsService } from '../../../services/runningAppsService';
import { suggestAppsForWorkspace } from '../../../services/feedbackService';
import { getPendingSuggestions } from '../../../services/appCategorizationService';

const SOURCES = [
  { key: 'suggested', icon: faLightbulb, label: 'Suggested' },
  { key: 'running', icon: faPlay, label: 'Running' },
  { key: 'installed', icon: faDesktop, label: 'Installed' }
];

export default function AppSelector({
  selectedApps,
  onSelectionChange,
  onAddSelected,
  existingApps = [],
  workspaceName = ''
}) {
  const [source, setSource] = useState('suggested');
  const [searchQuery, setSearchQuery] = useState('');
  const [runningApps, setRunningApps] = useState([]);
  const [installedApps, setInstalledApps] = useState([]);
  const [suggestedApps, setSuggestedApps] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuggestedLoading, setIsSuggestedLoading] = useState(false);

  // Subscribe to running apps service
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = runningAppsService.subscribe(({ runningApps, installedApps }) => {
      // Deduplicate running apps by name to avoid showing multiple windows
      const dedupedRunning = runningAppsService.deduplicateByPid(runningApps);
      setRunningApps(dedupedRunning);
      setInstalledApps(installedApps);
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  // Fetch suggested apps based on workspace name
  // Falls back to AI-categorized suggestions (from appCategorizationService) when feedback has no data yet
  useEffect(() => {
    if (!workspaceName) {
      setSuggestedApps([]);
      return;
    }

    setIsSuggestedLoading(true);
    suggestAppsForWorkspace(workspaceName, 20)
      .then(suggestions => {
        if (suggestions.length > 0) {
          // Feedback service has data — use it
          const suggestedWithIcons = suggestions.map(s => {
            const installed = installedApps.find(
              a => a.path?.toLowerCase() === s.app_path?.toLowerCase()
            );
            return {
              name: s.app_name || installed?.name || 'Unknown App',
              path: s.app_path,
              icon: installed?.icon || null,
              score: s.score
            };
          });
          setSuggestedApps(suggestedWithIcons);
        } else {
          // No feedback data yet — fall back to AI categorization cache
          const pending = getPendingSuggestions();
          const aiApps = pending[workspaceName] || [];
          // Enrich with icons from installed apps
          const enriched = aiApps.map(a => {
            const installed = installedApps.find(
              i => i.path?.toLowerCase() === a.path?.toLowerCase()
            );
            return {
              name: a.name,
              path: a.path,
              icon: installed?.icon || a.icon || null,
              _aiCategorized: true
            };
          });
          setSuggestedApps(enriched);
        }
      })
      .catch(() => setSuggestedApps([]))
      .finally(() => setIsSuggestedLoading(false));
  }, [workspaceName, installedApps]);

  // Get items based on current source
  const items = useMemo(() => {
    if (source === 'suggested') return suggestedApps;
    if (source === 'running') return runningApps;
    return installedApps;
  }, [source, suggestedApps, runningApps, installedApps]);

  // Filter out apps already in the workspace
  const existingPaths = new Set(existingApps.map(a => a.path?.toLowerCase()));

  const filteredItems = useMemo(() => {
    let filtered = items.filter(app => !existingPaths.has(app.path?.toLowerCase()));

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(app =>
        app.name?.toLowerCase().includes(query) ||
        app.path?.toLowerCase().includes(query)
      );
    }

    return filtered.slice(0, 30);
  }, [items, searchQuery, existingPaths]);

  const handleToggleApp = (appPath) => {
    const next = new Set(selectedApps);
    if (next.has(appPath)) {
      next.delete(appPath);
    } else {
      next.add(appPath);
    }
    onSelectionChange(next);
  };

  const handleSelectAll = () => {
    const allPaths = new Set(filteredItems.map(app => app.path));
    onSelectionChange(allPaths);
  };

  const handleClearSelection = () => {
    onSelectionChange(new Set());
  };

  const handleAddClick = () => {
    // Convert selected paths to app objects - search all sources
    const allApps = [...suggestedApps, ...runningApps, ...installedApps];
    const seenPaths = new Set();
    const appsToAdd = [];

    for (const app of allApps) {
      if (selectedApps.has(app.path) && !seenPaths.has(app.path)) {
        seenPaths.add(app.path);
        appsToAdd.push({
          name: app.name,
          path: app.path,
          icon: app.icon || null
        });
      }
    }

    onAddSelected(appsToAdd);
  };

  const currentLoading = source === 'suggested' ? isSuggestedLoading : isLoading;
  const emptyMessage = source === 'suggested'
    ? (workspaceName ? 'No suggested apps for this workspace yet' : 'Save workspace first to get suggestions')
    : `No ${source} apps available`;

  return (
    <div className="awm-app-selector">
      <div className="awm-url-selector-header">
        <h4>Add Apps</h4>

        {/* Source Tabs */}
        <div className="awm-source-tabs">
          {SOURCES.map(({ key, icon, label }) => (
            <button
              key={key}
              className={`awm-source-tab ${source === key ? 'active' : ''}`}
              onClick={() => setSource(key)}
            >
              <FontAwesomeIcon icon={icon} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="awm-url-selector-search">
        <FontAwesomeIcon icon={faSearch} className="awm-search-icon" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`Search ${source} apps...`}
        />
      </div>

      {/* Selection Actions */}
      <div className="awm-url-selector-actions">
        <button className="awm-btn-text" onClick={handleSelectAll}>
          Select All
        </button>
        <button className="awm-btn-text" onClick={handleClearSelection}>
          Clear
        </button>
        <span className="awm-selection-count">
          {selectedApps.size} selected
        </span>
      </div>

      {/* App List */}
      <div className="awm-url-selector-list">
        {currentLoading ? (
          <div className="awm-url-selector-loading">
            <div className="awm-spinner" />
            <span>Loading apps...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="awm-url-selector-empty">
            {searchQuery ? `No apps match your search` : emptyMessage}
          </div>
        ) : (
          filteredItems.map((app, idx) => {
            const isSelected = selectedApps.has(app.path);
            return (
              <button
                key={app.path || idx}
                className={`awm-url-selector-item ${isSelected ? 'selected' : ''}`}
                onClick={() => handleToggleApp(app.path)}
              >
                <div className={`awm-checkbox ${isSelected ? 'checked' : ''}`}>
                  {isSelected && <FontAwesomeIcon icon={faCheck} />}
                </div>
                <div className="awm-url-favicon">
                  {app.icon ? (
                    <img src={app.icon} alt="" />
                  ) : (
                    <FontAwesomeIcon icon={faDesktop} />
                  )}
                </div>
                <div className="awm-url-info">
                  <span className="awm-url-title">{app.name}</span>
                  {source === 'running' && app.title && app.title !== app.name && (
                    <span className="awm-url-domain">{app.title}</span>
                  )}
                  {source === 'suggested' && app._aiCategorized && (
                    <span className="awm-url-domain" style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#8b5cf6' }}>
                      <FontAwesomeIcon icon={faRobot} style={{ fontSize: '10px' }} /> AI suggested
                    </span>
                  )}
                  {source === 'suggested' && app.score && !app._aiCategorized && (
                    <span className="awm-url-domain">
                      Score: {app.score.toFixed(2)}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Add Button */}
      <button
        className="awm-btn awm-btn-primary awm-url-selector-add"
        onClick={handleAddClick}
        disabled={selectedApps.size === 0}
      >
        <FontAwesomeIcon icon={faPlus} />
        Add {selectedApps.size > 0 ? `${selectedApps.size} Apps` : 'Selected'}
      </button>
    </div>
  );
}
