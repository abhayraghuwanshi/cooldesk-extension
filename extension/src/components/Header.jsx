import {
  faArrowUpRightFromSquare,
  faBackward,
  faCalendarDays,
  faChevronLeft,
  faChevronRight,
  faCircleQuestion,
  faEnvelope,
  faForward,
  faMicrophone,
  faPalette,
  faPause,
  faPlay,
  faPlus
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getUIState, saveUIState } from '../db';
import VoiceNavigation from './VoiceNavigation';

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [showVoiceNavigation, setShowVoiceNavigation] = useState(false);

  // Load Auto Sync from UI state (default ON if missing)
  useEffect(() => {
    (async () => {
      try {
        const ui = await getUIState();
        if (typeof ui?.autoSync === 'boolean') {
          setAutoSync(ui.autoSync);
        } else {
          setAutoSync(true);
          try { await saveUIState({ ...ui, autoSync: true }); } catch { /* noop */ }
        }
      } catch {
        setAutoSync(true);
      }
    })();
  }, []);

  // Live clock for local date/time
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Music controller functions using native Chrome media session
  const sendMediaCommand = async (action) => {
    try {
      // Use Chrome's native media session commands
      if (chrome?.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({
          type: 'MEDIA_COMMAND',
          action: action
        });
      }
    } catch (e) {
      console.warn('Media control failed:', e);
    }
  };

  const handlePlayPause = () => {
    const action = isPlaying ? 'pause' : 'play';
    sendMediaCommand(action);
    setIsPlaying(!isPlaying);
  };

  const handlePrevious = () => sendMediaCommand('previoustrack');
  const handleNext = () => sendMediaCommand('nexttrack');

  // Listen for media session updates from background script
  useEffect(() => {
    const messageListener = (message) => {
      if (message.type === 'MEDIA_STATE_UPDATE') {
        setIsPlaying(message.isPlaying);
        setCurrentTrack(message.track);
      }
    };

    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(messageListener);
      return () => chrome.runtime.onMessage.removeListener(messageListener);
    }
  }, []);

  const timeStr = now.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
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
        try { await chrome.storage.local.set({ pendingQuery: q }); } catch { }
        if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' });
      } catch { }
    }
  };

  const barStyle = isFooter
    ? { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2000 }
    : { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000 };

  return (
    <header className="header ai-header" style={{
      ...barStyle,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    }}>
      <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', flex: 1 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <SearchBox search={search} setSearch={setSearch} openInSidePanel={openInSidePanel} />
        </div>
        {/* Navigation Arrows */}
        {((activeTab && setActiveTab) || (activeSection !== undefined && setActiveSection)) && (() => {
          // Define sections for ActivityPanel navigation - add 'All' as first option
          const sections = ['All', 'Current Tabs', 'Pings', 'Notes', 'Cool Feed'];
          const isActivityNavigation = activeSection !== undefined && setActiveSection;

          const currentLabel = isActivityNavigation
            ? sections[activeSection] || 'Section'
            : (activeTab === 'workspace' ? 'Workspace' : 'Saved');

          const handlePrevious = () => {
            if (isActivityNavigation) {
              setActiveSection((prev) => (prev - 1 + sections.length) % sections.length);
            } else {
              setActiveTab(activeTab === 'workspace' ? 'saved' : 'workspace');
            }
          };

          const handleNext = () => {
            if (isActivityNavigation) {
              setActiveSection((prev) => (prev + 1) % sections.length);
            } else {
              setActiveTab(activeTab === 'workspace' ? 'saved' : 'workspace');
            }
          };

          return (
<div style={{
              display: 'flex',
              alignItems: 'center',
              marginRight: '8px'
            }}>
              {isActivityNavigation ? (
                <select
                  value={activeSection}
                  onChange={(e) => setActiveSection(parseInt(e.target.value))}
                  style={{
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#ffffff',
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.25)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    minWidth: '130px',
                    textAlign: 'center',
                    backdropFilter: 'blur(12px)',
                    cursor: 'pointer',
                    outline: 'none',
                    textTransform: 'capitalize',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.10) 100%)';
                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.35)';
                    e.target.style.transform = 'translateY(-1px)';
                    e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)';
                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
                  }}
                >
                  {sections.map((section, index) => (
                    <option 
                      key={index} 
                      value={index}
                      style={{
                        background: '#1a202c',
                        color: '#e2e8f0',
                        padding: '8px 12px',
                        fontSize: '12px'
                      }}
                    >
                      {section}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{
                  fontSize: '12px',
                  fontWeight: '500',
                  color: '#ffffff',
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  minWidth: '90px',
                  textAlign: 'center',
                  textTransform: 'capitalize',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                }}>
                  {currentLabel}
                </div>
              )}
            </div>
          );
        })()}
        {/* <button className="icon-btn" onClick={openSyncControls} title="Organize using AI">
          <FontAwesomeIcon icon={progress.running ? faSpinner : faRobot} spin={!!progress.running} />
        </button> */}
        {/* <button
          className={`icon-btn ${autoSync ? 'active' : ''}`}
          title={autoSync ? 'Auto Categorize is ON - Click to turn OFF' : 'Auto Categorize is OFF - Click to turn ON'}
          aria-pressed={autoSync}
          onClick={async () => {
            try {
              const next = !autoSync;
              setAutoSync(next);
              const ui = await getUIState();
              await saveUIState({ ...ui, autoSync: next });

              // Trigger auto-categorize when turning ON
              if (next) {
                await triggerAutoCategorize();
              }
            } catch (e) {
              console.warn('Failed to toggle auto-categorize:', e);
            }
          }}
        >
          <FontAwesomeIcon icon={progress.running ? faSpinner : (autoSync ? faRobot : faToggleOff)} spin={!!progress.running} />
        </button> */}
        {/* Music Controls */}
        <div className="music-controls" style={{ display: 'flex', gap: '4px', alignItems: 'center', marginRight: '8px' }}>
          <button className="icon-btn music-btn" onClick={handlePrevious} title="Previous Track">
            <FontAwesomeIcon icon={faBackward} />
          </button>
          <button className="icon-btn music-btn" onClick={handlePlayPause} title={isPlaying ? "Pause" : "Play"}>
            <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} />
          </button>
          <button className="icon-btn music-btn" onClick={handleNext} title="Next Track">
            <FontAwesomeIcon icon={faForward} />
          </button>
        </div>

        <button
          className={`icon-btn ${showVoiceNavigation ? 'active' : ''}`}
          onClick={() => setShowVoiceNavigation(!showVoiceNavigation)}
          title={showVoiceNavigation ? "Hide Voice Navigation" : "Show Voice Navigation"}
          aria-pressed={showVoiceNavigation}
        >
          <FontAwesomeIcon icon={faMicrophone} />
        </button>

        <button className="icon-btn" onClick={() => setShowCreateWorkspace(true)} title="Create Workspace">
          <FontAwesomeIcon icon={faPlus} />
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Customization">
          <FontAwesomeIcon icon={faPalette} />
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
        >
          <FontAwesomeIcon icon={faEnvelope} />
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
        >
          <FontAwesomeIcon icon={faCalendarDays} />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            const msg = [
              'Navigation Shortcuts',
              '',
              'Arrows (← ↑ → ↓): Move between cards in the grid',
              'Enter/Click: Open selected card',
              '',
              'Alt+← / Alt+→: Switch between Workspace and Saved tabs',
              'Ctrl+1 / Ctrl+2: Jump to Workspace/Saved tabs',
              'Ctrl+← / Ctrl+→: Switch tabs',
            ].join('\n');
            alert(msg);
          }}
          title="Help (shortcuts)"
        >
          <FontAwesomeIcon icon={faCircleQuestion} />
        </button>
        <button className="icon-btn" onClick={openInSidePanel} title="Open in Sidebar">
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.8, whiteSpace: 'nowrap' }} title={now.toLocaleString()}>
          {timeStr}
        </div>
      </div>
      {showVoiceNavigation && (
        <div style={{
          position: 'fixed',
          top: isFooter ? 'auto' : '60px',
          bottom: isFooter ? '60px' : 'auto',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1999,
          maxWidth: '600px',
          width: '90%'
        }}>
          <VoiceNavigation />
        </div>
      )}
    </header>
  );
}

function SearchBox({ search, setSearch, openInSidePanel, focusSignal }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [contentMatches, setContentMatches] = useState([]);
  const [portalPos, setPortalPos] = useState({ left: 0, top: 0, width: 0 });
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const dataRef = useRef({ list: [] });

  // Focus the input when focusSignal changes
  useEffect(() => {
    if (!focusSignal) return;
    if (!inputRef.current) return;
    try { inputRef.current.focus(); inputRef.current.select?.(); } catch { }
    setOpen(true);
  }, [focusSignal]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const r = wrapRef.current ? wrapRef.current.getBoundingClientRect() : null;
      if (r) setPortalPos({ left: r.left, top: r.bottom, width: r.width });
    };
    update();
    const opts = { passive: true };
    window.addEventListener('resize', update, opts);
    window.addEventListener('scroll', update, opts);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
    };
  }, [open]);

  const engines = [
    { id: 'google', name: 'Google', color: '#4285F4', icon: 'G', buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`, supportsQuery: true },
    { id: 'perplexity', name: 'Perplexity', color: '#6B5BFF', icon: '🌀', buildUrl: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`, supportsQuery: true },
    { id: 'chatgpt', name: 'ChatGPT', color: '#10A37F', icon: '🤖', buildUrl: (q) => `https://chat.openai.com/?q=${encodeURIComponent(q)}`, supportsQuery: false },
    { id: 'grok', name: 'Grok', color: '#000000', icon: '𝕏', buildUrl: (q) => `https://grok.com/?q=${encodeURIComponent(q)}`, supportsQuery: true },
  ];

  useEffect(() => {
    (async () => {
      try {
        const ui = await getUIState();
        const rs = Array.isArray(ui?.recentSearches) ? ui.recentSearches : [];
        setRecent(rs.slice(0, 10));
      } catch { }
    })();
  }, []);

  // Load dashboardData once for content-based suggestions
  useEffect(() => {
    (async () => {
      try {
        const { dashboardData } = await chrome.storage.local.get(['dashboardData']);
        const bookmarks = dashboardData?.bookmarks || [];
        const history = dashboardData?.history || [];
        const all = [];
        for (const b of bookmarks) {
          if (!b) continue;
          all.push({ type: 'bookmark', title: b.title || b.name || b.url || '', url: b.url || '' });
        }
        for (const h of history) {
          if (!h) continue;
          all.push({ type: 'history', title: h.title || h.url || '', url: h.url || '' });
        }
        dataRef.current.list = all;
      } catch { }
    })();
  }, []);

  useEffect(() => {
    const onClick = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const runSearch = async (q) => {
    const query = (q || '').trim();
    if (!query) return;
    // Save recent
    try {
      const ui = await getUIState();
      const rs = Array.isArray(ui?.recentSearches) ? ui.recentSearches : [];
      const next = [query, ...rs.filter((x) => x !== query)].slice(0, 10);
      await saveUIState({ ...ui, recentSearches: next });
      setRecent(next);
    } catch { }
    // Open in extension side panel
    try {
      await openInSidePanel(query);
    } catch (err) {
      console.error('Open in side panel failed:', err);
      // Fallback to Google
      try {
        if (chrome?.tabs?.create) {
          chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
        }
      } catch { }
    }
    setOpen(false);
  };

  // Open a specific engine with the current query.
  // If the engine doesn't support query params, copy to clipboard first.
  const openWithEngine = async (engineId, q) => {
    const engine = engines.find(e => e.id === engineId);
    if (!engine) return;
    const query = (q || '').trim();
    if (!query) return;
    if (!engine.supportsQuery) {
      try { await navigator.clipboard.writeText(query); } catch { }
    }
    const url = engine.supportsQuery ? engine.buildUrl(query) : engine.buildUrl();
    try {
      if (chrome?.tabs?.create) chrome.tabs.create({ url });
    } catch { }
    setOpen(false);
  };

  const onKeyDown = (e) => {
    const lower = (search || '').toLowerCase();
    const list = lower ? recent.filter(r => r.toLowerCase().includes(lower)) : recent;
    if (e.key === 'ArrowDown') {
      if (list.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % list.length);
    } else if (e.key === 'ArrowUp') {
      if (list.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i <= 0 ? list.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const choice = (activeIndex >= 0 && activeIndex < list.length) ? list[activeIndex] : search;
      runSearch(choice);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && (search || recent.length > 0);
  const filtered = (search ? recent.filter(r => r.toLowerCase().includes((search || '').toLowerCase())) : recent);

  // Compute content matches when typing
  useEffect(() => {
    const q = (search || '').trim().toLowerCase();
    if (!q) { setContentMatches([]); return; }
    const out = [];
    for (const item of dataRef.current.list) {
      const inTitle = (item.title || '').toLowerCase().includes(q);
      const inUrl = (item.url || '').toLowerCase().includes(q);
      if (inTitle || inUrl) {
        out.push(item);
        if (out.length >= 8) break;
      }
    }
    setContentMatches(out);
  }, [search]);

  return (
    <div ref={wrapRef} style={{
      width: '100%',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    }}>
      <input
        ref={inputRef}
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); setActiveIndex(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        type="text"
        placeholder="Search Everything..."
        className="ai-input"
        style={{
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
        }}
      />
      {showList && (() => {
        const dropdown = (
          <div
            className="search-suggestions top"
            style={{
              position: 'fixed',
              left: `${portalPos.left}px`,
              top: `${portalPos.top - 50}px`,
              width: `${portalPos.width}px`,
              zIndex: 2147483647,
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
            }}
          >
            {recent.length === 0 && !search && (
              <div style={{ padding: 8, opacity: 0.7, fontSize: 12 }}>No recent searches</div>
            )}
            {!!search && (
              <div
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runSearch(search)}
                style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: filtered.length ? '1px solid #273043' : 'none' }}
              >
                Search Google for "{search}"
              </div>
            )}
            {!!search && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, padding: 8, borderBottom: filtered.length || contentMatches.length ? '1px solid #273043' : 'none' }}>
                {engines.map((e) => (
                  <div
                    key={e.id}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => openWithEngine(e.id, search)}
                    title={`Search in ${e.name}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', background: '#0f1522', borderRadius: 6, border: '1px solid #273043' }}
                  >
                    <div style={{ width: 20, height: 20, borderRadius: 4, background: e.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                      <span>{e.icon}</span>
                    </div>
                    <div style={{ fontSize: 12 }}>Search in {e.name}</div>
                  </div>
                ))}
              </div>
            )}
            {filtered.map((item, idx) => (
              <div
                key={item}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runSearch(item)}
                className="suggestion-item"
                style={{
                  padding: '8px 10px', cursor: 'pointer',
                  background: idx === activeIndex ? '#1b2331' : 'transparent'
                }}
              >
                {item}
              </div>
            ))}
            {contentMatches.length > 0 && (
              <div style={{ borderTop: '1px solid #273043' }}>
                {contentMatches.map((m, i) => (
                  <div
                    key={`${m.url}-${i}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      try {
                        if (chrome?.tabs?.create) chrome.tabs.create({ url: m.url });
                      } catch { }
                      setOpen(false);
                    }}
                    style={{ padding: '8px 10px', cursor: 'pointer' }}
                    title={m.url}
                  >
                    <span style={{ opacity: 0.7, marginRight: 6 }}>{m.type === 'bookmark' ? '🔖' : '🕘'}</span>
                    <span>{m.title || m.url}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
        return createPortal(dropdown, document.body);
      })()}
    </div>
  );
}
