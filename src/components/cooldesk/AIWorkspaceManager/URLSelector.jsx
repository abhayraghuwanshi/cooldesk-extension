import {
  faBookmark,
  faCheck,
  faClock,
  faGlobe,
  faLink,
  faPlus,
  faSearch
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState, useMemo } from 'react';
import { safeGetHostname } from '../../../utils/helpers';

const SOURCES = [
  { key: 'tabs', icon: faLink, label: 'Open Tabs' },
  { key: 'history', icon: faClock, label: 'History' },
  { key: 'bookmarks', icon: faBookmark, label: 'Bookmarks' }
];

export default function URLSelector({
  source,
  onSourceChange,
  items = [],
  selectedUrls,
  onSelectionChange,
  onAddSelected,
  isLoading
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items.slice(0, 50);
    const query = searchQuery.toLowerCase();
    return items
      .filter(item =>
        item.title?.toLowerCase().includes(query) ||
        item.url?.toLowerCase().includes(query)
      )
      .slice(0, 50);
  }, [items, searchQuery]);

  const handleToggleUrl = (url) => {
    const next = new Set(selectedUrls);
    if (next.has(url)) {
      next.delete(url);
    } else {
      next.add(url);
    }
    onSelectionChange(next);
  };

  const handleSelectAll = () => {
    const allUrls = new Set(filteredItems.map(item => item.url));
    onSelectionChange(allUrls);
  };

  const handleClearSelection = () => {
    onSelectionChange(new Set());
  };

  return (
    <div className="awm-url-selector">
      <div className="awm-url-selector-header">
        <h4>Add URLs</h4>

        {/* Source Tabs */}
        <div className="awm-source-tabs">
          {SOURCES.map(({ key, icon, label }) => (
            <button
              key={key}
              className={`awm-source-tab ${source === key ? 'active' : ''}`}
              onClick={() => onSourceChange(key)}
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
          placeholder={`Search ${source}...`}
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
          {selectedUrls.size} selected
        </span>
      </div>

      {/* URL List */}
      <div className="awm-url-selector-list">
        {isLoading ? (
          <div className="awm-url-selector-loading">
            <div className="awm-spinner" />
            <span>Loading {source}...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="awm-url-selector-empty">
            {searchQuery ? `No ${source} match your search` : `No ${source} available`}
          </div>
        ) : (
          filteredItems.map((item, idx) => {
            const isSelected = selectedUrls.has(item.url);
            return (
              <button
                key={item.url || idx}
                className={`awm-url-selector-item ${isSelected ? 'selected' : ''}`}
                onClick={() => handleToggleUrl(item.url)}
              >
                <div className={`awm-checkbox ${isSelected ? 'checked' : ''}`}>
                  {isSelected && <FontAwesomeIcon icon={faCheck} />}
                </div>
                <div className="awm-url-favicon">
                  {item.favicon || item.favIconUrl ? (
                    <img src={item.favicon || item.favIconUrl} alt="" />
                  ) : (
                    <FontAwesomeIcon icon={faGlobe} />
                  )}
                </div>
                <div className="awm-url-info">
                  <span className="awm-url-title">{item.title || item.url}</span>
                  <span className="awm-url-domain">{safeGetHostname(item.url)}</span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Add Button */}
      <button
        className="awm-btn awm-btn-primary awm-url-selector-add"
        onClick={onAddSelected}
        disabled={selectedUrls.size === 0}
      >
        <FontAwesomeIcon icon={faPlus} />
        Add {selectedUrls.size > 0 ? `${selectedUrls.size} URLs` : 'Selected'}
      </button>
    </div>
  );
}
