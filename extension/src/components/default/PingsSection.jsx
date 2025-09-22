import React from 'react';
import { deletePing as dbDeletePing, listPings as dbListPings, upsertPing as dbUpsertPing, subscribePinsChanges } from '../../db/index.js';
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
      console.log('[PingsSection] All existing pings before save:', pings.map(p => ({ id: p.id, url: p.url })));
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
    <div className="coolDesk-section">
      <h2 className="coolDesk-section-title">Pins</h2>
      <div className="coolDesk-pings-container" style={{ display: 'flex', flexDirection: 'row', overflowX: 'auto', whiteSpace: 'nowrap' }}>
        {pings.map((ping, index) => (
          <div
            key={index}
            className="coolDesk-ping-item"
            style={{
              marginRight: '10px',
              position: 'relative',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              transition: 'background-color 0.2s'
            }}
            onClick={() => openOrFocusUrl(ping.url)}
            onMouseEnter={() => setHoveredPingId(ping.url)}
            onMouseLeave={() => setHoveredPingId(null)}
            title={ping.title || ping.url}
          >
            <img
              src={ping.favicon || getFaviconUrl(ping.url)}
              alt={ping.title || 'Pin'}
              style={{
                width: '24px',
                height: '24px',
                objectFit: 'contain',
                borderRadius: '4px'
              }}
              onError={(e) => {
                // Try fallback favicon from origin
                try {
                  const u = new URL(ping.url);
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
            {hoveredPingId === ping.url && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removePing(ping.url);
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
    </div>
  );
}
