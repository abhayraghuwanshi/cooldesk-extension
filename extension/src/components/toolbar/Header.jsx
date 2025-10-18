import {
  faArrowUpRightFromSquare,
  faCalendarDays,
  faGear,
  faQuestionCircle,
  faTableCellsLarge,
  faTableColumns
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { getUIState, saveUIState } from '../../db/index.js';
import { getFaviconUrl } from '../../utils';
import { AddLinkFlow } from '../popups/AddLinkFlow.jsx';
import { CoolHelpSection } from '../popups/CoolHelpSection.jsx';
import MusicControls from './MusicControls';
import { SearchBox } from './SearchBox.jsx';


export function Header({
  search,
  setSearch,
  populate,
  setShowSettings,
  openSyncControls,
  progress,
  setShowCreateWorkspace,
  openInTab,
  isFooter = false,
  activeTab,
  setActiveTab,
  activeSection,
  setActiveSection,
}) {
  const [autoSync, setAutoSync] = useState(true);
  const [now, setNow] = useState(new Date());
  const [quickUrls, setQuickUrls] = useState([]);
  const [quickUrlsLoaded, setQuickUrlsLoaded] = useState(false);
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [allItems, setAllItems] = useState([]);
  const [calendarFallback, setCalendarFallback] = useState(false);
  const [failedFavs, setFailedFavs] = useState(() => new Set());
  const [showHelp, setShowHelp] = useState(false);
  // Load Auto Sync from UI state
  useEffect(() => {
    (async () => {
      try {
        const ui = await getUIState();
        try { console.debug('[Header] Loaded UI state', ui); } catch { }
        if (typeof ui?.autoSync === 'boolean') {
          setAutoSync(ui.autoSync);
        } else {
          try { await saveUIState({ ...ui, autoSync: true }); } catch { /* noop */ }
        }
        if (Array.isArray(ui?.headerUrls)) {
          setQuickUrls(ui.headerUrls.slice(0, 5));
          try { console.debug('[Header] Set quickUrls from DB', ui.headerUrls.slice(0, 5)); } catch { }
        }
        setQuickUrlsLoaded(true);
      } catch {
        // Ignore
      }
    })();
  }, []);

  // Persist quick urls whenever they change (merge into UI state)
  useEffect(() => {
    if (!quickUrlsLoaded) return;
    (async () => {
      try {
        const ui = await getUIState();
        const payload = { ...ui, headerUrls: quickUrls.slice(0, 5) };
        try { console.debug('[Header] Persisting headerUrls', payload.headerUrls); } catch { }
        await saveUIState(payload);
      } catch { /* noop */ }
    })();
  }, [quickUrls, quickUrlsLoaded]);

  // When add modal opens, load suggestions from tabs, history, and bookmarks
  useEffect(() => {
    if (!showAddUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const items = [];
        // Open tabs
        if (typeof chrome !== 'undefined' && chrome?.tabs?.query) {
          try {
            const tabs = await new Promise((resolve) => {
              try { chrome.tabs.query({}, resolve); } catch { resolve([]); }
            });
            for (const t of (tabs || [])) {
              if (!t?.url) continue;
              items.push({
                id: t.id ?? `tab_${t.url}`,
                url: t.url,
                title: t.title || (() => { try { return new URL(t.url).hostname; } catch { return t.url; } })(),
                lastVisitTime: Date.now(),
                visitCount: 1,
              });
            }
          } catch { }
        }

        // History
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
                      visitCount: r.visitCount || 0,
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
                        visitCount: 0,
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
        console.warn('[Header] Failed to load allItems for AddLinkFlow', e);
        if (!cancelled) setAllItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showAddUrl]);

  // Live clock for local date/time
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Lock-screen style strings
  const clockStr = (() => {
    // HH:MM without AM/PM, 12-hour like the screenshot
    const h12 = (() => {
      const h = now.getHours() % 12 || 12;
      return h.toString().padStart(2, '0');
    })();
    const mm = now.getMinutes().toString().padStart(2, '0');
    return `${h12}:${mm}`;
  })();
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
  });

  const openInSidePanel = async (overrideQuery) => {
    try {
      const q = (overrideQuery != null ? String(overrideQuery) : search || '').trim();
      // Store pending query for the side panel to consume
      try { await chrome.storage.local.set({ pendingQuery: q }); } catch { }
      // Set stable path without query to avoid setOptions throwing
      if (chrome?.sidePanel?.setOptions) {
        await chrome.sidePanel.setOptions(
          { path: 'index.html', enabled: true });
      }
      if (chrome?.windows?.getCurrent && chrome?.sidePanel?.open) {
        const win = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: win.id });
      }
    } catch (err) {
      console.error('Open side panel failed:', err);
      // Fallback: open in a new tab
      try {
        const q = (overrideQuery != null ? String(overrideQuery) : search || '').trim();
        if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' });
      } catch { }
    }
  };

  // Helpers for quick URLs
  const openUrl = (url) => {
    try {
      if (chrome?.tabs?.create) chrome.tabs.create({ url }); else window.open(url, '_blank');
    } catch { }
  };
  const addQuickUrl = () => {
    if (quickUrls.length >= 5) return;
    setShowAddUrl(true);
  };

  // Triple-screen: tile current window to the left third and open two new windows to fill middle and right thirds
  const openTripleScreen = async () => {
    try {
      if (!chrome?.windows?.getCurrent || !chrome?.windows?.update || !chrome?.windows?.create) {
        // Fallback: open two more tabs with index.html
        try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch { }
        try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch { }
        return;
      }
      const cur = await chrome.windows.getCurrent();
      const availW = window.screen?.availWidth || 1440;
      const availH = window.screen?.availHeight || 900;
      // Two-column layout: left = 50% width, full height; right = 50% width split into two 50% height windows
      const halfW = Math.max(600, Math.floor(availW / 2));
      const left = { left: 0, top: 0, width: halfW, height: availH, state: 'normal' };
      const rightW = availW - halfW; // account for odd pixels
      const topRight = { left: halfW, top: 0, width: rightW, height: Math.floor(availH / 2), state: 'normal' };
      const bottomRight = { left: halfW, top: Math.floor(availH / 2), width: rightW, height: availH - Math.floor(availH / 2), state: 'normal' };

      await chrome.windows.update(cur.id, left);
      await chrome.windows.create({ url: 'index.html', focused: false, ...topRight });
      await chrome.windows.create({ url: 'index.html', focused: true, ...bottomRight });
    } catch (err) {
      console.error('Triple screen failed:', err);
      try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch { }
      try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch { }
    }
  };

  // Split-screen: tile current window left and open CoolDesk (index.html) on the right
  const openSplitScreen = async () => {
    try {
      if (!chrome?.windows?.getCurrent || !chrome?.windows?.update || !chrome?.windows?.create) {
        // Fallback: open a new tab with index.html
        if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' });
        return;
      }
      const cur = await chrome.windows.getCurrent();
      // Use available screen size
      const availW = window.screen?.availWidth || 1200;
      const availH = window.screen?.availHeight || 800;
      const halfW = Math.max(600, Math.floor(availW / 2));
      const leftBounds = { left: 0, top: 0, width: halfW, height: availH, state: 'normal' };
      const rightBounds = { left: halfW, top: 0, width: availW - halfW, height: availH, state: 'normal' };

      // Move current window to the left half
      await chrome.windows.update(cur.id, leftBounds);
      // Open CoolDesk on the right half
      await chrome.windows.create({ url: 'index.html', focused: true, ...rightBounds });
    } catch (err) {
      console.error('Split screen failed:', err);
      try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch { }
    }
  };


  const barStyle = isFooter
    ? { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2000 }
    : { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000 };

  // Unify icon sizes with SearchBox height rhythm
  // Button box ~36px to match typical input heights; icon ~20px
  const iconBtnStyle = {
    height: 36,
    width: 36,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
    border: '1px solid var(--border-primary, rgba(255, 255, 255, 0.1))',
    color: 'var(--text, #e5e7eb)',
    flexShrink: 0,
    transition: 'all 0.15s ease'
  };
  const iconImgStyle = { width: 20, height: 20, borderRadius: 4, objectFit: 'contain', display: 'block' };

  // Separator component for visual grouping
  const Separator = () => (
    <div style={{
      width: 1,
      height: 24,
      background: 'var(--border-primary, rgba(255, 255, 255, 0.15))',
      margin: '0 4px',
      flexShrink: 0
    }} />
  );

  return (
    <header className="header ai-header" style={{
      ...barStyle,
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    }}>
      <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', flex: 1, flexWrap: 'nowrap' }}>
        {/* Logo */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          marginRight: '16px',
          flexShrink: 0
        }}>

          <img
            src={chrome.runtime.getURL('logo.png')}
            alt="Logo"
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              objectFit: 'contain',
              filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2))'
            }}
          />
        </div>

        <div style={{ position: 'relative', flex: 1, marginRight: '16px', maxWidth: '600px' }}>
          <SearchBox search={search} setSearch={setSearch} openInSidePanel={openInSidePanel} />
        </div>

        <MusicControls />

        <Separator />

        <button
          className="icon-btn"
          onClick={() => setShowHelp(true)}
          title="Help"
          style={iconBtnStyle}
        >
          <FontAwesomeIcon icon={faQuestionCircle} />
        </button>

        <button
          className="icon-btn"
          onClick={() => setShowSettings(true)}
          title="Settings"
          style={iconBtnStyle}
        >
          <FontAwesomeIcon icon={faGear} />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            try {
              const url = 'https://mail.google.com/mail/u/0/#inbox';
              if (chrome?.tabs?.create) chrome.tabs.create({ url }); else window.open(url, '_blank');
            } catch { }
          }}
          title="Open Gmail"
          style={iconBtnStyle}
        >
          {(() => {
            const url = 'https://mail.google.com/';
            const u = (() => { try { return new URL(url); } catch { return null; } })();
            const candidates = [
              // Known Gmail favicon paths
              'https://mail.google.com/favicon.ico',
              'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
              u ? `${u.origin}/favicon.ico` : null,
              getFaviconUrl(url, 32)
            ].filter(Boolean);
            return (
              <img
                src={candidates[0]}
                alt="Gmail"
                style={iconImgStyle}
                onError={(e) => {
                  const cur = e.currentTarget;
                  const next = candidates.find(c => c && c !== cur.src);
                  if (next) cur.src = next;
                }}
              />
            );
          })()}
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            try {
              const url = 'https://calendar.google.com/';
              if (chrome?.tabs?.create) chrome.tabs.create({ url }); else window.open(url, '_blank');
            } catch { }
          }}
          title="Open Google Calendar"
          style={iconBtnStyle}
        >
          {calendarFallback ? (
            <FontAwesomeIcon icon={faCalendarDays} style={{ width: 20, height: 20 }} />
          ) : (() => {
            const url = 'https://calendar.google.com/';
            const u = (() => { try { return new URL(url); } catch { return null; } })();
            const candidates = [
              'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_32_2x.png',
              'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_16_2x.png',
              u ? `${u.origin}/favicon.ico` : null,
              getFaviconUrl(url, 32)
            ].filter(Boolean);
            return (
              <img
                src={candidates[0]}
                alt="Google Calendar"
                style={iconImgStyle}
                onError={() => setCalendarFallback(true)}
              />
            );
          })()}
        </button>

        <Separator />

        <button
          className="icon-btn"
          onClick={openInSidePanel}
          title="Open in Sidebar"
          style={iconBtnStyle}
        >
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ width: 20, height: 20 }} />
        </button>
        {/* Split Screen (tile windows) */}
        <button
          className="icon-btn"
          onClick={openSplitScreen}
          title="Split Screen"
          style={iconBtnStyle}
        >
          <FontAwesomeIcon icon={faTableColumns} style={{ width: 20, height: 20 }} />
        </button>
        {/* Triple Screen (tile windows 3-way) */}
        <button
          className="icon-btn"
          onClick={openTripleScreen}
          title="Triple Screen"
          style={iconBtnStyle}
        >
          <FontAwesomeIcon icon={faTableCellsLarge} style={{ width: 20, height: 20 }} />
        </button>

        <Separator />

        {/* Quick URL shortcuts (max 5) */}
        {/* <div style={{ color: 'var(--text, #e5e7eb)', opacity: 0.7, fontSize: 11, margin: '0 6px' }}>
          debug quickUrls: {Array.isArray(quickUrls) ? quickUrls.length : 'n/a'}
        </div>
        {quickUrls.map((url, idx) => {
          const u = (() => { try { return new URL(url); } catch { return null; } })();
          const candidates = [
            u ? `${u.origin}/favicon.ico` : null,
            getFaviconUrl(url, 32)
          ].filter(Boolean);
          try { console.debug('[Header] render quickUrl', { url, idx, candidates, failed: failedFavs.has(url) }); } catch {}
          const hostInitial = (u?.hostname?.[0] || '•').toUpperCase();
          const showFallback = failedFavs.has(url) || candidates.length === 0;
          return (
            <button
              key={url + idx}
              className="icon-btn"
              onClick={() => openUrl(url)}
              title={url}
              style={{ ...iconBtnStyle, border: '1px solid rgba(255,0,0,0.4)' }}
            >
              {showFallback ? (
                <div style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255,255,255,0.08)',
                  color: 'var(--text, #e5e7eb)',
                  fontSize: 12,
                  fontWeight: 700
                }}>
                  {hostInitial}
                </div>
              ) : (
                <img
                  src={candidates[0]}
                  alt={u?.hostname || 'site'}
                  style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'contain', display: 'block' }}
                  onError={(e) => {
                    const cur = e.currentTarget;
                    const next = candidates.find((c) => c && c !== cur.src);
                    if (next) {
                      cur.src = next;
                    } else {
                      setFailedFavs((prev) => {
                        const s = new Set(prev);
                        s.add(url);
                        return s;
                      });
                    }
                  }}
                />
              )}
            </button>
          );
        })} */}
        {/* Add URL button (disabled at 5)
        // <button
        //   className="icon-btn"
        //   onClick={addQuickUrl}
        //   title={quickUrls.length >= 5 ? 'Max 5 shortcuts reached' : 'Add a URL shortcut'}
        //   disabled={quickUrls.length >= 5}
        //   style={{
        //     ...iconBtnStyle,
        //     opacity: quickUrls.length >= 5 ? 0.5 : 1,
        //     cursor: quickUrls.length >= 5 ? 'not-allowed' : 'pointer'
        //   }}
        // >
        //   <FontAwesomeIcon icon={faPlus} />
        // </button> */}
        {showAddUrl && ReactDOM.createPortal(
          (
            <div
              onClick={() => setShowAddUrl(false)}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 560, maxWidth: '92vw', height: 520, maxHeight: '85vh',
                  background: 'var(--background-primary, #0b0b10)', border: '1px solid var(--border-primary, rgba(255,255,255,0.1))',
                  borderRadius: 12, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.4)'
                }}
              >
                <AddLinkFlow
                  allItems={allItems}
                  savedItems={quickUrls.map((url, i) => ({
                    id: `quick_${i}`,
                    url,
                    title: (() => { try { return new URL(url).hostname; } catch { return url; } })(),
                    workspaceGroup: 'Header'
                  }))}
                  currentWorkspace={'Header Shortcuts'}
                  onAdd={(item) => {
                    const url = item?.url || '';
                    if (!url) return;
                    let u = url;
                    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
                    try { u = new URL(u).toString(); } catch { /* ignore invalid */ }
                    const next = (() => {
                      const base = quickUrls || [];
                      if (base.length >= 5) return base;
                      const list = base.includes(u) ? base : [...base, u];
                      return list.slice(0, 5);
                    })();
                    try { console.debug('[Header] onAdd -> next quickUrls', next); } catch { }
                    setQuickUrls(next);
                    try { console.debug('[Header] onAdd -> saving headerUrls', next); saveUIState({ headerUrls: next }); } catch { }
                    setShowAddUrl(false);
                  }}
                  onAddSaved={(url) => {
                    // normalize and add
                    let u = url;
                    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
                    try { u = new URL(u).toString(); } catch { /* ignore invalid */ }
                    const next = (() => {
                      const base = quickUrls || [];
                      if (base.length >= 5) return base;
                      const list = base.includes(u) ? base : [...base, u];
                      return list.slice(0, 5);
                    })();
                    setQuickUrls(next);
                    try { saveUIState({ headerUrls: next }); } catch { }
                    setShowAddUrl(false);
                  }}
                  onCancel={() => setShowAddUrl(false)}
                />
              </div>
            </div>
          ),
          document.body
        )}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            lineHeight: 1.1,
            flexShrink: 0,
            minWidth: 'fit-content',
            color: 'var(--text, #e5e7eb)'
          }}
          title={now.toLocaleString()}
        >
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>{clockStr}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{dateStr}</div>
        </div>
      </div>

      <CoolHelpSection isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </header>
  );
}
