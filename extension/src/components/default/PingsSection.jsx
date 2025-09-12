import { faArrowUpRightFromSquare, faThumbtack, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deletePing as dbDeletePing, listPings as dbListPings, subscribePinsChanges, upsertPing as dbUpsertPing } from '../../db/index.js';
import { enqueueOpenInChrome } from '../../services/extensionApi';
import { getFaviconUrl } from '../../utils';

export function PingsSection({ tabs }) {
  const [pings, setPings] = React.useState([]);

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
        chrome.tabs.create({ url });
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
          fontSize: 22,
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <FontAwesomeIcon icon={faThumbtack} style={{ color: '#FF9500', fontSize: 18 }} />
          Pins
          <span style={{
            fontSize: 12,
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pings.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 16,
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
          pings.slice(0, 6).map(p => (
            <div
              key={p.url}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: 12,
                padding: 16,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(10px)',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: 12
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = `0 4px 16px rgba(255, 149, 0, 0.15)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {/* Favicon */}
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(255, 149, 0, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                border: '1px solid rgba(255, 149, 0, 0.2)'
              }}>
                {p.favicon ? (
                  <img
                    src={p.favicon}
                    alt=""
                    width={18}
                    height={18}
                    style={{ borderRadius: 4 }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <FontAwesomeIcon
                    icon={faThumbtack}
                    style={{ fontSize: 14, color: '#FF9500' }}
                  />
                )}
              </div>

              {/* Ping Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 16,
                  color: '#ffffff',
                  lineHeight: 1.4,
                  fontWeight: 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {p.title || (() => {
                    try {
                      return new URL(p.url).hostname;
                    } catch {
                      return p.url;
                    }
                  })()}
                </div>
                <div style={{
                  fontSize: 13,
                  color: 'rgba(255, 255, 255, 0.6)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: 2
                }}>
                  {(() => {
                    try {
                      return new URL(p.url).hostname;
                    } catch {
                      return p.url;
                    }
                  })()}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {/* Open Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openOrFocusUrl(p.url);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    border: 'none',
                    background: 'rgba(0, 122, 255, 0.1)',
                    color: '#007AFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  title="Open pinned page"
                  onMouseEnter={(e) => {
                    e.target.style.background = '#007AFF';
                    e.target.style.color = 'white';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'rgba(0, 122, 255, 0.1)';
                    e.target.style.color = '#007AFF';
                  }}
                >
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ fontSize: 12 }} />
                </button>

                {/* Remove Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePing(p.url);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    border: 'none',
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#FF3B30',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    opacity: 0.7
                  }}
                  title="Remove pin"
                  onMouseEnter={(e) => {
                    e.target.style.background = '#FF3B30';
                    e.target.style.color = 'white';
                    e.target.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                    e.target.style.color = '#FF3B30';
                    e.target.style.opacity = '0.7';
                  }}
                >
                  <FontAwesomeIcon icon={faTrash} style={{ fontSize: 12 }} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
