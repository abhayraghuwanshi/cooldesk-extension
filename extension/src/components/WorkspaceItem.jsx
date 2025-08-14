import React, { useState, useMemo } from 'react';
import { getFaviconUrl, formatTime, getUrlParts } from '../utils';

export function WorkspaceItem({ base, values, onAddRelated, timeSpentMs, onAddLink }) {
  const [showDetails, setShowDetails] = useState(false);
  const favicon = getFaviconUrl(base);
  const timeString = formatTime(timeSpentMs);

  // Get unique tags from all items in the workspace
  const tags = useMemo(() => {
    const allTags = values.flatMap(item => item.tags || []);
    return [...new Set(allTags)];
  }, [values]);

  const handleItemClick = () => {
    window.open(base, '_blank');
  };

  const toggleDetails = (e) => {
    e.stopPropagation();
    setShowDetails(!showDetails);
  };

  const handleGetRelated = (e) => {
    e.stopPropagation();
    onAddRelated(base, getDomainFromUrl(base));
  };

  const handleAddLinkClick = (e) => {
    e.stopPropagation();
    onAddLink();
  };

  return (
    <li className="workspace-item">
      <div className="item-header" onClick={handleItemClick}>
        <div className="item-info">
          {favicon && <img className="favicon" src={favicon} alt="" />}
          <div className="domain-info">

            <span className="url-key" title={base}>{base.length > 40 ? base.slice(0, 37) + '…' : base}</span>
          </div>
        </div>
        <div className="item-actions">
          {timeString && <span className="time-spent-badge">{timeString}</span>}
          {onAddLink && (
            <button className="details-btn" onClick={handleAddLinkClick} title="Add Link">
              <i className="fas fa-plus"></i>
            </button>
          )}
          {values.length > 0 && (
            <button
              className="details-btn"
              onClick={toggleDetails}
              title={`${showDetails ? 'Hide' : 'Show'} ${values.length} paths`}
            >
              {values.length} paths
            </button>
          )}
        </div>
      </div>

      {/* {tags.length > 0 && (
        <div className="tags-list">
          {tags.map(tag => (
            <span key={tag} className="tag-chip">{tag}</span>
          ))}
        </div>
      )} */}

      {/* History Paths */}
      {showDetails && values.length > 0 && (
        <div className="item-details">
          <div className="details-title">History Paths:</div>
          <div className="paths-list">
            {values.map((item) => {
              const path = getUrlParts(item.url).remainder || '/';
              return (
                <button
                  key={item.url}
                  className="path-chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(item.url, '_blank');
                  }}
                  title={item.url}
                >
                  {path}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </li>
  );
}
