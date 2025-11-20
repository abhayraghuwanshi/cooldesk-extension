import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { createPortal } from 'react-dom';
import { deletePing as dbDeletePing, listPings as dbListPings, upsertPing as dbUpsertPing, subscribePinsChanges } from '../../db/index.js';
import { enqueueOpenInChrome } from '../../services/extensionApi';
import { getFaviconUrl } from '../../utils';
import { AddLinkFlow } from '../popups/AddLinkFlow.jsx';

export function PingsSection({ tabs }) {
  const [pings, setPings] = React.useState([]);
  const [hoveredPingId, setHoveredPingId] = React.useState(null);
  const [showAddMenu, setShowAddMenu] = React.useState(false);
  const addTileRef = React.useRef(null);
  const [menuPos, setMenuPos] = React.useState({ x: 0, y: 0, width: 360 }); // retained but unused in modal mode
  const modalRef = React.useRef(null);
  const pingsRef = React.useRef([]);
  const [allItems, setAllItems] = React.useState([]);

  const updateMenuPosition = React.useCallback(() => { }, []);

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

  // Keep a live ref of pings to avoid stale closure in addPing
  React.useEffect(() => { pingsRef.current = pings; }, [pings]);

  const addPing = React.useCallback(async (tab) => {
    try {
      if (!tab?.url) return;

      // Check if we already have 12 pins
      if ((pingsRef.current?.length || 0) >= 12) {
        console.warn('[PingsSection] Maximum of 12 pins reached');
        return;
      }
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

  // Close the add menu when clicking outside
  React.useEffect(() => {
    if (!showAddMenu) return;
    const onDown = (e) => {
      // If click is inside modal content or on the add tile, do nothing
      if (modalRef.current && modalRef.current.contains(e.target)) return;
      if (addTileRef.current && addTileRef.current.contains(e.target)) return;
      setShowAddMenu(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setShowAddMenu(false);
    };
    const onScroll = () => updateMenuPosition();
    const onResize = () => updateMenuPosition();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    updateMenuPosition();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [showAddMenu, updateMenuPosition]);

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

  const maxPins = 12;
  const displayPings = pings.slice(0, maxPins);
  const pinnedUrls = new Set(displayPings.map(p => p.url));
  const availableTabs = Array.isArray(tabs) ? tabs.filter(t => t?.url && !pinnedUrls.has(t.url)) : [];
  const savedItems = React.useMemo(() => {
    return displayPings.map(p => ({
      id: p.id,
      url: p.url,
      title: p.title || (() => { try { return new URL(p.url).hostname; } catch { return p.url; } })(),
      workspaceGroup: 'Pins'
    }));
  }, [displayPings]);

  // Load history, bookmarks, and open tabs as allItems when modal opens
  React.useEffect(() => {
    if (!showAddMenu) return;
    let cancelled = false;
    (async () => {
      try {
        const items = [];
        // Include open tabs
        const tabItems = (Array.isArray(tabs) ? tabs : [])
          .filter(t => t?.url)
          .map(t => ({
            id: t.id ?? `tab_${t.url}`,
            url: t.url,
            title: t.title || (() => { try { return new URL(t.url).hostname; } catch { return t.url; } })(),
            lastVisitTime: Date.now(),
            visitCount: 1
          }));
        items.push(...tabItems);

        // History (requires chrome.history permission)
        if (typeof chrome !== 'undefined' && chrome?.history?.search) {
          await new Promise((resolve) => {
            try {
              chrome.history.search({ text: '', maxResults: 500, startTime: 0 }, (results) => {
                try {
                  const hist = (results || [])
                    .filter(r => r?.url)
                    .map(r => ({
                      id: `hist_${r.id || r.url}`,
                      url: r.url,
                      title: r.title || (() => { try { return new URL(r.url).hostname; } catch { return r.url; } })(),
                      lastVisitTime: r.lastVisitTime || 0,
                      visitCount: r.visitCount || 0
                    }));
                  items.push(...hist);
                } catch { }
                resolve();
              });
            } catch { resolve(); }
          });
        }

        // Bookmarks
        if (typeof chrome !== 'undefined' && chrome?.bookmarks?.getTree) {
          await new Promise((resolve) => {
            try {
              chrome.bookmarks.getTree((nodes) => {
                try {
                  const stack = [...(nodes || [])];
                  while (stack.length) {
                    const n = stack.pop();
                    if (!n) continue;
                    if (n.children && n.children.length) stack.push(...n.children);
                    if (n.url) {
                      items.push({
                        id: `bm_${n.id}`,
                        url: n.url,
                        title: n.title || (() => { try { return new URL(n.url).hostname; } catch { return n.url; } })(),
                        dateAdded: n.dateAdded || 0,
                        lastVisitTime: n.dateAdded || 0,
                        visitCount: 0
                      });
                    }
                  }
                } catch { }
                resolve();
              });
            } catch { resolve(); }
          });
        }

        if (!cancelled) setAllItems(items);
      } catch (e) {
        console.warn('[PingsSection] Failed to load allItems for AddLinkFlow', e);
        if (!cancelled) setAllItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showAddMenu, tabs]);

  return (
    <div className="coolDesk-section" data-onboarding="current-pins-section">
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        padding: '0 4px'
      }}>
        <h3 style={{
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          {/* <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ color: '#34C759', fontSize: 'var(--font-size-xl)' }} /> */}
          Pins
        </h3>

      </div>
      <div className="coolDesk-pings-container" style={{
        display: 'flex',
        flexDirection: 'row',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        width: '100%',
        maxWidth: '100%'
      }}>
        {displayPings.map((ping, index) => (
          <div
            key={index}
            className="coolDesk-ping-item"
            style={{
              marginRight: '10px',
              position: 'relative',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              background: 'rgba(255, 255, 255, 0.02)',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px'
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
                width: '20px',
                height: '20px',
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
        {/* Add-pin tile at the end */}
        <div
          ref={addTileRef}
          className="coolDesk-ping-item add-pin-tile"
          style={{
            marginRight: '10px',
            position: 'relative',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '8px',
            transition: 'all 0.2s ease',
            border: '1px dashed var(--border-color, rgba(255,255,255,0.15))',
            background: 'rgba(255, 255, 255, 0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px'
          }}
          title="Add pin from open tabs"
          onClick={(e) => {
            e.stopPropagation();
            // Compute portal menu position relative to viewport
            updateMenuPosition();
            setShowAddMenu((v) => !v);
          }}
          onMouseEnter={() => setHoveredPingId('add')}
          onMouseLeave={() => setHoveredPingId(null)}
        >
          <FontAwesomeIcon icon={faPlus} style={{ fontSize: 14, color: 'var(--text-secondary, rgba(255,255,255,0.7))' }} />
        </div>
      </div>
      {showAddMenu && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
          onMouseDown={(e) => {
            // close when clicking on the overlay (not inside the panel)
            if (e.target === e.currentTarget) setShowAddMenu(false);
          }}
        >
          <div ref={modalRef} onMouseDown={(e) => e.stopPropagation()} style={{
            width: 'min(780px, 96vw)',
            height: 'min(70vh, 720px)',
            background: 'var(--surface-0, #101015)',
            border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.1))',
              background: 'var(--surface-1, rgba(255,255,255,0.02))'
            }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary, #fff)' }}>Add Pin</div>
              <button
                onClick={() => setShowAddMenu(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-secondary, rgba(255,255,255,0.7))',
                  cursor: 'pointer',
                  fontSize: 18
                }}
                title="Close"
              >
                ×
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <AddLinkFlow
                allItems={allItems}
                savedItems={savedItems}
                currentWorkspace="Pins"
                onAdd={async (item) => {
                  const t = { url: item.url, title: item.title, favIconUrl: getFaviconUrl(item.url) };
                  await addPing(t);
                  setShowAddMenu(false);
                }}
                onAddSaved={async (url) => {
                  const t = { url, title: (() => { try { return new URL(url).hostname; } catch { return url; } })(), favIconUrl: getFaviconUrl(url) };
                  await addPing(t);
                  setShowAddMenu(false);
                }}
                onCancel={() => setShowAddMenu(false)}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}