import { faArrowUpRightFromSquare, faClone, faRotateRight, faThumbtack, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { enqueueOpenInChrome, getHostTabs } from '../services/extensionApi';
import { getFaviconUrl } from '../utils';

export function CurrentTabsSection({ onAddPing, onRequestPreview }) {
  const [tabs, setTabs] = React.useState([]);
  const [tabsError, setTabsError] = React.useState(null);
  const [hoveredTabId, setHoveredTabId] = React.useState(null);

  const refreshTabs = React.useCallback(() => {
    setTabsError(null);
    try {
      const hasTabsQuery = typeof chrome !== 'undefined' && chrome?.tabs?.query;
      if (hasTabsQuery) {
        chrome.tabs.query({}, (list) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            setTabsError(lastErr.message || 'Unable to query tabs');
            setTabs([]);
            return;
          }
          setTabs(Array.isArray(list) ? list : []);
        });
      } else {
        // Fallback: fetch tabs mirrored by the extension to the host (Electron mode)
        (async () => {
          const res = await getHostTabs();
          if (res.ok) {
            setTabs(res.tabs || []);
            setTabsError(null);
          } else {
            setTabs([]);
            // Keep UI clean in Electron: don't surface noisy errors
            setTabsError('');
          }
        })();
      }
    } catch (e) {
      // Keep UI quiet in non-Chrome environments
      setTabsError('');
      setTabs([]);
    }
  }, []);

  React.useEffect(() => {
    refreshTabs();
    const id = setInterval(refreshTabs, 15000);
    return () => clearInterval(id);
  }, [refreshTabs]);

  // Dynamic gradient generation based on domain
  const getDomainColor = React.useCallback((url) => {
    let hostname = '';
    try {
      hostname = new URL(url || '').hostname.toLowerCase();
    } catch {
      return { 
        bg: 'linear-gradient(135deg, #0f1724 0%, #1b2331 100%)', 
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
    
    // Create gradient variations with the same base but different accent hints
    const variation = Math.abs(hash >> 8) % 4;
    let bg, border;
    
    switch (variation) {
      case 0:
        bg = `linear-gradient(135deg, #0f1724 0%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.1) 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.3)`;
        break;
      case 1:
        bg = `linear-gradient(145deg, #0f1724 0%, #1b2331 50%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.05) 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.25)`;
        break;
      case 2:
        bg = `linear-gradient(125deg, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.03) 0%, #0f1724 40%, #1b2331 100%)`;
        border = `rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.2)`;
        break;
      default:
        bg = `linear-gradient(155deg, #0f1724 0%, #1b2331 70%, rgba(${parseInt(accent.slice(1, 3), 16)}, ${parseInt(accent.slice(3, 5), 16)}, ${parseInt(accent.slice(5, 7), 16)}, 0.08) 100%)`;
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

  // Sort tabs by hostname (DNS) so similar URLs are grouped
  const sortedTabs = React.useMemo(() => {
    const getHost = (t) => {
      try { return new URL(t?.url || '').hostname || ''; } catch { return ''; }
    };
    const arr = Array.isArray(tabs) ? [...tabs] : [];
    arr.sort((a, b) => {
      const ha = getHost(a);
      const hb = getHost(b);
      if (ha !== hb) return ha.localeCompare(hb);
      // Secondary sort: by full URL for stable grouping
      const ua = a?.url || '';
      const ub = b?.url || '';
      return ua.localeCompare(ub);
    });
    return arr;
  }, [tabs]);

  const focusTab = React.useCallback((tab) => {
    if (!tab || !tab.id) return;
    try {
      const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
      if (!hasTabsUpdate) return;
      chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null && chrome?.windows?.update) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch (e) {
      console.warn('Failed to focus tab', e);
    }
  }, []);

  const removeTab = React.useCallback((tab) => {
    try {
      if (!tab) return;
      const hasRemove = typeof chrome !== 'undefined' && chrome?.tabs?.remove;
      if (hasRemove && tab.id != null) {
        chrome.tabs.remove(tab.id);
      }
    } catch (e) {
      console.warn('Failed to remove tab', e);
    }
  }, []);

  const duplicateTab = React.useCallback((tab) => {
    try {
      if (!tab) return;
      const hasDuplicate = typeof chrome !== 'undefined' && chrome?.tabs?.duplicate;
      if (hasDuplicate && tab.id != null) {
        chrome.tabs.duplicate(tab.id, (newTab) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            // Fallback to create with URL if duplicate fails
            if (tab.url && chrome?.tabs?.create) chrome.tabs.create({ url: tab.url });
          }
        });
        return;
      }
      // Fallbacks: create or enqueue open via host bridge
      if (tab?.url && typeof chrome !== 'undefined' && chrome?.tabs?.create) {
        chrome.tabs.create({ url: tab.url });
      } else if (tab?.url) {
        enqueueOpenInChrome(tab.url).catch(() => { });
      }
    } catch (e) {
      console.warn('Failed to duplicate tab', e);
      if (tab?.url) enqueueOpenInChrome(tab.url).catch(() => { });
    }
  }, []);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>
          <FontAwesomeIcon icon={faClone} style={{ marginRight: 6 }} />
          Hot Tabs <span style={{ fontWeight: 'normal', opacity: 0.7, fontSize: 12 }}>({tabs.length})</span>
        </h3>
        <button
          onClick={refreshTabs}
          style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 12 }}
          className="icon-btn"
          aria-label="Reload"
          title="Reload"
        >
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
      </div>
      {tabsError ? (
        <div className="error" style={{ marginBottom: 12 }}>{String(tabsError)}</div>
      ) : (
        <div className="activity-grid" style={{ marginBottom: 16 }}>
          {sortedTabs.map(tab => {
            const colors = getDomainColor(tab.url);
            return (
              <div
                key={tab.id}
                className="activity-card"
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 8, 
                  padding: '8px 10px', 
                  border: `1px solid ${colors.border}`, 
                  borderRadius: 10, 
                  background: colors.bg,
                  transition: 'all 0.2s ease',
                  boxShadow: hoveredTabId === tab.id ? `0 2px 8px ${colors.accent}20` : 'none'
                }}
                onMouseEnter={() => setHoveredTabId(tab.id)}
                onMouseLeave={() => setHoveredTabId((id) => (id === tab.id ? null : id))}
              >
              {(() => {
                // Derive favicon in a safe way; avoid file:// or chrome:// origins that yield "null/favicon.ico"
                const safeHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
                const primaryRaw = (tab.favIconUrl && safeHttp(tab.favIconUrl)) ? tab.favIconUrl : getFaviconUrl(tab.url, 64);
                let originIco = '';
                try {
                  const u = new URL(tab.url || '');
                  if (u.protocol === 'http:' || u.protocol === 'https:') {
                    originIco = `${u.origin}/favicon.ico`;
                  }
                } catch { }
                const src = primaryRaw || originIco || '';
                return src ? (
                  <img
                    src={src}
                    className="favicon"
                    alt=""
                    width={16}
                    height={16}
                    style={{ borderRadius: 3 }}
                    onError={(e) => {
                      if (originIco && e.currentTarget.src !== originIco) { e.currentTarget.src = originIco; return; }
                      if (e.currentTarget.src.indexOf('/default-favicon.svg') === -1) { e.currentTarget.src = '/default-favicon.svg'; return; }
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : <div style={{ width: 16, height: 16 }} />;
              })()}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="activity-card__title" style={{ fontSize: 13, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {tab.title || (() => { try { return new URL(tab?.url || '').hostname; } catch { return tab?.url || ''; } })()}
                </div>
                {colors.hostname && (
                  <div style={{ 
                    fontSize: 10, 
                    color: colors.accent, 
                    opacity: 0.8, 
                    marginTop: 2,
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis' 
                  }}>
                    {colors.hostname}
                  </div>
                )}
              </div>
              {/* Hover-only Pin button */}
              <button
                onClick={() => onAddPing(tab)}
                className="pin-btn icon-btn"
                aria-label="Pin"
                title="Pin"
                style={{ width: 28, height: 28, opacity: hoveredTabId === tab.id ? 1 : 0, transition: 'opacity 120ms ease-in-out' }}
              >
                <FontAwesomeIcon icon={faThumbtack} />
              </button>
              <button
                onClick={() => {
                  const hasTabsUpdate = typeof chrome !== 'undefined' && chrome?.tabs?.update;
                  if (hasTabsUpdate) return focusTab(tab);
                  if (tab?.url) {
                    enqueueOpenInChrome(tab.url).catch(() => { });
                  }
                }}
                className="go-btn icon-btn"
                aria-label="Open tab"
                title="Open tab"
              >
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
              </button>
              <button
                onClick={() => duplicateTab(tab)}
                className="dup-btn icon-btn"
                aria-label="Duplicate tab"
                title="Duplicate tab"
                style={{ width: 28, height: 28 }}
              >
                <FontAwesomeIcon icon={faClone} />
              </button>
              <button
                onClick={() => removeTab(tab)}
                className="remove-btn icon-btn"
                aria-label="Remove tab"
                title="Remove tab"
                style={{ width: 28, height: 28 }}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
              </div>
            );
          })}
          {!tabs.length && !tabsError && (
            <div className="empty">No tabs found</div>
          )}
        </div>
      )}
    </>
  );
}
