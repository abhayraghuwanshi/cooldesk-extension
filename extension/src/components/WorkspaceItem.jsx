import React, { useEffect, useMemo, useState } from 'react';
import { formatTime, getDomainFromUrl, getFaviconUrl, getUrlParts } from '../utils';

export const WorkspaceItem = React.forwardRef(function WorkspaceItem({ base, values, onAddRelated, timeSpentMs, onAddLink, onDelete }, ref) {
  const [showDetails, setShowDetails] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [fallbackTimeMs, setFallbackTimeMs] = useState(0);
  const favicon = getFaviconUrl(base);
  const cleanedBase = getUrlParts(base).key;
  const timeString = formatTime(timeSpentMs || fallbackTimeMs);

  // Dynamic gradient generation based on domain (matching CurrentTabsSection)
  const getDomainColor = React.useCallback((url) => {
    let hostname = '';
    try {
      hostname = new URL(url || '').hostname.toLowerCase();
    } catch {
      return { 
        bg: 'linear-gradient(135deg, rgba(15, 23, 36, 0.8) 0%, rgba(27, 35, 49, 0.8) 100%)', 
        border: '#273043', 
        accent: '#4a5568' 
      };
    }

    // Accent colors for variety
    const accentColors = [
      '#3b82f6', // Blue
      '#6b7280', // Gray  
      '#4b5563', // Slate
      '#22c55e', // Green
      '#ea580c', // Orange
      '#a855f7', // Purple
      '#f43f5e', // Rose
      '#0891b2', // Cyan
    ];

    // Simple hash function for consistent color selection
    let hash = 0;
    for (let i = 0; i < hostname.length; i++) {
      hash = ((hash << 5) - hash) + hostname.charCodeAt(i);
      hash = hash & hash;
    }

    // Select an accent color based on hash
    const colorIndex = Math.abs(hash) % accentColors.length;
    const accent = accentColors[colorIndex];

    // Create gradient variations with transparency for workspace items
    const variation = Math.abs(hash >> 8) % 4;
    let bg, border;

    switch (variation) {
      case 0:
        bg = `linear-gradient(135deg, rgba(15, 23, 36, 0.8) 0%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.1) 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.3)`;
        break;
      case 1:
        bg = `linear-gradient(145deg, rgba(15, 23, 36, 0.8) 0%, rgba(27, 35, 49, 0.8) 50%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.05) 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.25)`;
        break;
      case 2:
        bg = `linear-gradient(125deg, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.03) 0%, rgba(15, 23, 36, 0.8) 40%, rgba(27, 35, 49, 0.8) 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.2)`;
        break;
      default:
        bg = `linear-gradient(155deg, rgba(15, 23, 36, 0.8) 0%, rgba(27, 35, 49, 0.8) 70%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.08) 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.3)`;
        break;
    }

    return {
      bg,
      border,
      accent,
      hostname
    };
  }, []);

  const colors = getDomainColor(base);

  useEffect(() => {
    // Defer fetching per-item timeSpent until interaction to reduce initial load
    if (timeSpentMs) return; // parent provided
    if (!(showDetails || hovered)) return; // only fetch when needed
    let mounted = true;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;
          if (!hasRuntime) return;
          const resp = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage({ action: 'getTimeSpent' }, (res) => {
                const lastErr = chrome.runtime?.lastError;
                if (lastErr) return resolve({ ok: false, error: lastErr.message });
                resolve(res);
              });
            } catch (e) { resolve({ ok: false, error: String(e) }); }
          });
          if (mounted && resp?.ok) {
            const ms = resp.timeSpent?.[cleanedBase] || 0;
            setFallbackTimeMs(ms);
          }
        } catch (e) {
          // non-fatal
        }
      })();
    }, 300); // small delay to avoid blocking immediate interactions
    return () => { mounted = false; clearTimeout(timer); };
  }, [cleanedBase, timeSpentMs, showDetails, hovered]);

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
    <li
      className="workspace-item"
      tabIndex={0}
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleItemClick();
        }
      }}
      style={{
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        marginBottom: '12px',
        backdropFilter: 'blur(10px)',
        boxShadow: hovered 
          ? '0 4px 16px rgba(0, 122, 255, 0.15)' 
          : 'none',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)'
      }}
    >
      <div className="item-header" onClick={handleItemClick} style={{ 
        padding: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        {favicon && (
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <img 
              src={favicon} 
              alt="" 
              width={18}
              height={18}
              style={{ borderRadius: 4 }}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ 
            fontSize: 16, 
            color: '#ffffff', 
            lineHeight: 1.4,
            marginBottom: 4,
            fontWeight: 400,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {(() => { 
              try { 
                return new URL(base).hostname; 
              } catch { 
                return base.length > 40 ? base.slice(0, 37) + '…' : base; 
              } 
            })()}
          </div>
          {colors.hostname && (
            <div style={{ 
              fontSize: 13, 
              color: 'rgba(255, 255, 255, 0.6)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {colors.hostname}
            </div>
          )}
        </div>
        <div className="item-actions">
          {timeString && <span className="time-spent-badge">{timeString}</span>}
          {/* {values.length > 0 && (
            <button
              className="details-btn"
              onClick={toggleDetails}
              title={`${showDetails ? 'Hide' : 'Show'} ${values.length} paths`}
            >
              {values.length} paths
            </button>
          )} */}
          {onDelete && (
            <button
              className="delete-btn"
              title="Delete from workspace"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(base, values);
              }}
              style={{
                display: hovered ? 'inline-flex' : 'none',
                marginLeft: 8,
                background: 'rgba(255, 59, 48, 0.1)',
                border: '1px solid rgba(255, 59, 48, 0.3)',
                borderRadius: '6px',
                padding: '4px 8px',
                color: '#FF3B30',
                cursor: 'pointer',
                fontSize: '12px',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                zIndex: 10
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#FF3B30';
                e.target.style.color = 'white';
                e.target.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(255, 59, 48, 0.1)';
                e.target.style.color = '#FF3B30';
                e.target.style.transform = 'scale(1)';
              }}
            >
              🗑️
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
            {(() => {
              // Build a unique list of meaningful paths (skip bare "/") ordered by recency if available
              try { console.debug('[WorkspaceItem] details open', { base, count: values.length, sample: values.slice(0, 3).map(v => v.url) }); } catch { }
              const dedup = new Map();
              for (const it of values) {
                const parts = getUrlParts(it.url);
                const path = parts.remainder || '/';
                // Skip pure root paths to emphasize meaningful entries
                if (path === '/') continue;
                const key = `${path}`;
                const ts = (typeof it.lastVisitTime === 'number' ? it.lastVisitTime : 0) || (typeof it.dateAdded === 'number' ? it.dateAdded : 0);
                const prev = dedup.get(key);
                if (!prev || ts > prev.ts) dedup.set(key, { url: it.url, path, ts });
              }
              const arr = Array.from(dedup.values()).sort((a, b) => b.ts - a.ts || a.path.localeCompare(b.path));
              // If everything reduced to none (all were "/"), fall back to showing a single Home link
              const toRender = arr.length ? arr : [{ url: base, path: '/', ts: 0 }];
              return toRender.map(({ url, path }) => (
                <button
                  key={`${url}|${path}`}
                  className="path-chip"
                  onClick={(e) => { e.stopPropagation(); window.open(url, '_blank'); }}
                  title={url}
                >
                  {path}
                </button>
              ));
            })()}
          </div>
        </div>
      )}
    </li>
  );
});
