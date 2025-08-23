import { faArrowUpRightFromSquare, faThumbtack, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deletePing as dbDeletePing, listPings as dbListPings, upsertPing as dbUpsertPing } from '../db';
import { enqueueOpenInChrome } from '../services/extensionApi';
import { getFaviconUrl } from '../utils';

export function PingsSection({ tabs }) {
  const [pings, setPings] = React.useState([]);

  const loadPings = React.useCallback(async () => {
    try {
      const all = await dbListPings();
      // newest first
      all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setPings(all);
    } catch { /* ignore */ }
  }, []);

  const addPing = React.useCallback(async (tab) => {
    try {
      if (!tab?.url) return;
      const ping = {
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
      await dbUpsertPing(ping);
      await loadPings();
    } catch { /* ignore */ }
  }, [loadPings]);

  const removePing = React.useCallback(async (url) => {
    try { if (!url) return; await dbDeletePing(url); await loadPings(); } catch { }
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

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0 8px' }}>
        <h3 style={{ margin: 0 }}>
          <FontAwesomeIcon icon={faThumbtack} style={{ marginRight: 6 }} />
          Chill Pins <span style={{ fontWeight: 'normal', opacity: 0.7, fontSize: 12 }}>({Math.min(pings.length, 6)})</span>
        </h3>
      </div>
      <div className="activity-grid" style={{ marginBottom: 16 }}>
        {pings.slice(0, 6).map(p => (
          <div key={p.url} className="activity-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #273043', borderRadius: 10, background: '#0f1724' }}>
            {p.favicon ? (
              <img src={p.favicon} className="favicon" alt="" width={16} height={16} style={{ borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
              <div style={{ width: 16, height: 16 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="activity-card__title" style={{ fontSize: 13, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.title || (() => { try { return new URL(p.url).hostname; } catch { return p.url; } })()}
              </div>
            </div>
            <button
              onClick={() => openOrFocusUrl(p.url)}
              className="go-btn icon-btn"
              aria-label="Open ping"
              title="Open ping"
            >
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            </button>
            <button
              onClick={() => removePing(p.url)}
              className="remove-btn icon-btn"
              aria-label="Remove ping"
              title="Remove ping"
              style={{ width: 28, height: 28 }}
            >
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </div>
        ))}
        {!pings.length && (
          <div className="empty">No pings yet. Hover a tab above and click the pin icon to add one.</div>
        )}
      </div>
    </>
  );
}
