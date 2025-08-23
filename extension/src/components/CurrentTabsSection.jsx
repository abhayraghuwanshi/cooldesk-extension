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
          {sortedTabs.map(tab => (
            <div
              key={tab.id}
              className="activity-card"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #273043', borderRadius: 10, background: '#0f1724' }}
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
          ))}
          {!tabs.length && !tabsError && (
            <div className="empty">No tabs found</div>
          )}
        </div>
      )}
    </>
  );
}
