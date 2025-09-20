import { faArrowUpRightFromSquare, faThumbtack, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deletePing as dbDeletePing, listPings as dbListPings, subscribePinsChanges, upsertPing as dbUpsertPing } from '../../db/index.js';
import { enqueueOpenInChrome } from '../../services/extensionApi';
import { getFaviconUrl } from '../../utils';

export function PingsSection({ tabs }) {
  const [pings, setPings] = React.useState([]);
  const [hoveredPingId, setHoveredPingId] = React.useState(null);

  const loadPings = React.useCallback(async () => {
    try {
      console.log('[PingsSection] Loading pings...');
      const result = await dbListPings();
      console.log('[PingsSection] Pings result:', result);
      const pingsData = result?.data || result || [];
      console.log('[PingsSection] Extracted pings data:', pingsData);
      // newest first
      const all = Array.isArray(pingsData) ? pingsData : [];
      all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setPings(all);
    } catch (error) { 
      console.error('[PingsSection] Error loading pings:', error);
      setPings([]);
    }
  }, []);

  const addPing = React.useCallback(async (tab) => {
    try {
      if (!tab?.url) return;
      const ping = {
        id: `ping_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        url: tab.url,
        title: tab.title || (() => { try { return new URL(tab.url).hostname; } catch { return tab.url; } })(),
        favicon: (() => {
          const safeHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
          const primary = (tab.favIconUrl && safeHttp(tab.favIconUrl)) ? tab.favIconUrl : getFaviconUrl(tab.url, 64);
          try {
            const u = new URL(tab.url);
            const originIco = (u.protocol === 'http:' || u.protocol === 'https:') ? `${u.origin}/favicon.ico` : '';
            return primary || originIco || '';
          } catch { return primary || ''; }
        })(),
        createdAt: Date.now(),
      };
      console.log('[PingsSection] Creating ping:', ping);
      const result = await dbUpsertPing(ping);
      console.log('[PingsSection] Ping creation result:', result);
      await loadPings();
    } catch (error) { 
      console.error('[PingsSection] Error creating ping:', error);
    }
  }, [loadPings]);

  const removePing = React.useCallback(async (url) => {
    try { 
      if (!url) return; 
      console.log('[PingsSection] Deleting ping:', url);
      const result = await dbDeletePing(url);
      console.log('[PingsSection] Ping deletion result:', result);
      await loadPings(); 
    } catch (error) {
      console.error('[PingsSection] Error deleting ping:', error);
    }
  }, [loadPings]);

  const openOrFocusUrl = React.useCallback((url) => {
    if (!url) return;
    try {
      let match = null;
      try {
        const target = new URL(url).href;
        match = tabs.find(t => {
          try { return t.url && new URL(t.url).href === target; } catch { return false; }
        }) || null;
      } catch { }
      const hasTabsApi = typeof chrome !== 'undefined' && chrome?.tabs?.create;
      if (match && (typeof chrome !== 'undefined' && chrome?.tabs?.update)) {
        chrome.tabs.update(match.id, { active: true });
        if (match.windowId != null && chrome?.windows?.update) {
          chrome.windows.update(match.windowId, { focused: true });
        }
        return;
      }
      if (hasTabsApi) {
        if (chrome?.tabs?.update) {
          chrome.tabs.update({ url });
        } else if (chrome?.tabs?.create) {
          chrome.tabs.create({ url });
        }
      } else {
        // Electron: use extension bridge only to avoid duplicate opens
        enqueueOpenInChrome(url).catch(() => { });
      }
    } catch (e) {
      console.warn('Failed to open/focus url', url, e);
    }
  }, [tabs]);

  React.useEffect(() => {
    loadPings();
  }, [loadPings]);

  // Subscribe to pin changes for real-time updates
  React.useEffect(() => {
    console.log('[PingsSection] Setting up pins change subscription...');
    const unsubscribe = subscribePinsChanges(() => {
      console.log('[PingsSection] Pins changed, reloading...');
      loadPings();
    });
    
    return () => {
      console.log('[PingsSection] Cleaning up pins change subscription...');
      unsubscribe();
    };
  }, [loadPings]);

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    }}>
      {/* Apple-style Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        padding: '0 4px'
      }}>
        <h2 style={{
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <FontAwesomeIcon icon={faThumbtack} style={{ color: '#FF9500', fontSize: 'var(--font-size-xl)' }} />
          Pins
          <span style={{
            fontSize: 'var(--font-size-sm)',
            color: '#ffffff',
            background: 'rgba(255, 149, 0, 0.2)',
            padding: '4px 8px',
            borderRadius: 12,
            fontWeight: 500,
            border: '1px solid rgba(255, 149, 0, 0.3)'
          }}>
            {Math.min(pings.length, 6)}
          </span>
        </h2>
      </div>

      <div>
        {pings.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 400,
            padding: '40px 20px',
            fontStyle: 'italic',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            No pins yet. Pin your favorite tabs for quick access.
          </div>
        ) : (
          <div style={{
            display: 'flex',
            gap: '8px',
            paddingBottom: '16px',
            flexWrap: 'wrap'
          }}>
            {pings.slice(0, 12).map(p => (
              <div
                key={p.url}
                onClick={(e) => {
                  e.stopPropagation();
                  openOrFocusUrl(p.url);
                }}
                onMouseEnter={() => setHoveredPingId(p.url)}
                onMouseLeave={() => setHoveredPingId(null)}
                title={`${p.title || (() => {
                  try {
                    return new URL(p.url).hostname;
                  } catch {
                    return p.url;
                  }
                })()}\n${p.url}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px',
                  cursor: 'pointer',
                  background: hoveredPingId === p.url ? 'rgba(255, 149, 0, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  borderRadius: '8px',
                  border: `1px solid ${hoveredPingId === p.url ? 'rgba(255, 149, 0, 0.3)' : 'rgba(255, 255, 255, 0.05)'}`,
                  transition: 'all 0.2s ease',
                  width: '48px',
                  height: '48px',
                  position: 'relative'
                }}
              >
                <img
                  src={p.favicon || getFaviconUrl(p.url)}
                  alt={p.title || 'Pin'}
                  style={{
                    width: '24px',
                    height: '24px',
                    objectFit: 'contain',
                    borderRadius: '4px'
                  }}
                  onError={(e) => {
                    // Try fallback favicon from origin
                    try {
                      const u = new URL(p.url);
                      const originFavicon = `${u.origin}/favicon.ico`;
                      if (e.target.src !== originFavicon) {
                        e.target.src = originFavicon;
                        return;
                      }
                    } catch { }
                    // If all favicon attempts fail, show pin icon
                    const fallback = document.createElement('div');
                    fallback.style.cssText = `
                      width: 24px;
                      height: 24px;
                      border-radius: 4px;
                      background: rgba(255, 149, 0, 0.2);
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      font-size: 12px;
                      color: #FF9500;
                    `;
                    fallback.innerHTML = '📌';
                    e.target.parentNode.replaceChild(fallback, e.target);
                  }}
                />

                {/* Remove button on hover */}
                {hoveredPingId === p.url && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removePing(p.url);
                    }}
                    style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: '#FF3B30',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: 'calc(var(--font-size-xs) * 0.65)',
                      fontWeight: 'bold'
                    }}
                    title="Remove pin"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
