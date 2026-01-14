import {
  faArrowUpRightFromSquare,
  faBackward,
  faForward,
  faGear,
  faMagnifyingGlass,
  faPause,
  faPlay
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import calendarIcon from '../../../calendericon.svg';
import { getUIState, saveUIState } from '../../db/index.js';

export function VerticalHeader({
  search,
  setSearch,
  setShowSettings,
  openInSidePanel: openInSidePanelProp,
}) {
  const [now, setNow] = useState(new Date());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [layoutChoice, setLayoutChoice] = useState('default');

  // Live clock for local date/time
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Window resize handler for responsive behavior
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-collapse at smaller screen sizes
  const shouldAutoCollapse = windowWidth < 1200;
  const effectiveCollapsed = shouldAutoCollapse || collapsed;

  // Music controller functions
  const sendMediaCommand = async (action) => {
    try {
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

  const openInSidePanel = openInSidePanelProp ?? (async (overrideQuery) => {
    try {
      const q = (overrideQuery != null ? String(overrideQuery) : search || '').trim();
      try { await chrome.storage.local.set({ pendingQuery: q }); } catch { }
      if (chrome?.sidePanel?.setOptions) {
        await chrome.sidePanel.setOptions({ path: 'index.html', enabled: true });
      }
      if (chrome?.windows?.getCurrent && chrome?.sidePanel?.open) {
        const win = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: win.id });
      }
    } catch (err) {
      console.error('Open side panel failed:', err);
      try {
        const q = (overrideQuery != null ? String(overrideQuery) : search || '').trim();
        try { await chrome.storage.local.set({ pendingQuery: q }); } catch { }
        if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' });
      } catch { }
    }
  });

  const openSplitScreen = async () => {
    try {
      if (!chrome?.windows?.getCurrent || !chrome?.windows?.update || !chrome?.windows?.create) {
        if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' });
        return;
      }
      const cur = await chrome.windows.getCurrent();
      const availW = window.screen?.availWidth || 1200;
      const availH = window.screen?.availHeight || 800;
      const halfW = Math.max(600, Math.floor(availW / 2));
      const leftBounds = { left: 0, top: 0, width: halfW, height: availH, state: 'normal' };
      const rightBounds = { left: halfW, top: 0, width: availW - halfW, height: availH, state: 'normal' };

      await chrome.windows.update(cur.id, leftBounds);
      await chrome.windows.create({ url: 'index.html', focused: true, ...rightBounds });
    } catch (err) {
      console.error('Split screen failed:', err);
      try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch { }
    }
  };

  const openTripleScreen = async () => {
    try {
      if (!chrome?.windows?.getCurrent || !chrome?.windows?.update || !chrome?.windows?.create) {
        try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch { }
        try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch { }
        return;
      }
      const cur = await chrome.windows.getCurrent();
      const availW = window.screen?.availWidth || 1440;
      const availH = window.screen?.availHeight || 900;
      const halfW = Math.max(600, Math.floor(availW / 2));
      const left = { left: 0, top: 0, width: halfW, height: availH, state: 'normal' };
      const rightW = availW - halfW;
      const topRight = { left: halfW, top: 0, width: rightW, height: Math.floor(availH / 2), state: 'normal' };
      const bottomRight = {
        left: halfW,
        top: Math.floor(availH / 2),
        width: rightW,
        height: availH - Math.floor(availH / 2),
        state: 'normal'
      };

      await chrome.windows.update(cur.id, left);
      await chrome.windows.create({ url: 'index.html', focused: false, ...topRight });
      await chrome.windows.create({ url: 'index.html', focused: true, ...bottomRight });
    } catch (err) {
      console.error('Triple screen failed:', err);
      try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch { }
      try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch { }
    }
  };

  const openGmail = () => {
    try {
      const url = 'https://mail.google.com/mail/u/0/#inbox';
      if (chrome?.tabs?.create) chrome.tabs.create({ url });
      else window.open(url, '_blank');
    } catch { }
  };

  const openCalendar = () => {
    try {
      const url = 'https://calendar.google.com/';
      if (chrome?.tabs?.create) chrome.tabs.create({ url });
      else window.open(url, '_blank');
    } catch { }
  };

  const handleLayoutSelect = (value) => {
    if (value === 'split') {
      openSplitScreen();
    } else if (value === 'triple') {
      openTripleScreen();
    }
    setTimeout(() => setLayoutChoice('default'), 0);
  };

  const handleLayoutChange = (event) => {
    const { value } = event.target;
    setLayoutChoice(value);
    if (value !== 'default') {
      handleLayoutSelect(value);
    }
  };

  const handleQuickSearch = () => {
    window.dispatchEvent(new Event('verticalSearch:focus'));
  };

  const renderGmailIcon = (collapsedState) => {
    const iconSize = collapsedState ? 20 : 18;
    const candidates = [
      'https://mail.google.com/favicon.ico',
      'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
      'https://mail.google.com/mail/u/0/favicon.ico'
    ];

    return (
      <img
        src={candidates[0]}
        alt="Gmail"
        data-icon-index="0"
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: 4,
          objectFit: 'contain',
          display: 'block'
        }}
        onError={(event) => {
          const target = event.currentTarget;
          const currentIndex = Number(target.dataset.iconIndex || '0');
          const nextIndex = currentIndex + 1;
          if (nextIndex < candidates.length) {
            target.dataset.iconIndex = String(nextIndex);
            target.src = candidates[nextIndex];
          }
        }}
      />
    );
  };

  const renderCalendarIcon = (collapsedState) => {
    const iconSize = collapsedState ? 20 : 18;
    return (
      <img
        src={calendarIcon}
        alt="Google Calendar"
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: 4,
          objectFit: 'contain',
          display: 'block'
        }}
      />
    );
  };

  const quickTools = [
    {
      icon: faMagnifyingGlass,
      label: 'Search',
      onClick: handleQuickSearch,
      tooltip: 'Focus the search box'
    },
    {
      label: 'Gmail',
      onClick: openGmail,
      tooltip: 'Open Gmail inbox',
      renderIcon: renderGmailIcon
    },
    {
      label: 'Calendar',
      onClick: openCalendar,
      tooltip: 'Open Google Calendar',
      renderIcon: renderCalendarIcon
    },
  ];

  const sidebarWidth = effectiveCollapsed
    ? (windowWidth < 600 ? '50px' : '60px')
    : '280px';

  return (
    <div className="vertical-sidebar ai-sidebar" style={{
      position: 'fixed',
      left: 0,
      top: 0,
      bottom: 0,
      width: sidebarWidth,
      background: 'var(--glass-bg, linear-gradient(180deg, rgba(15, 21, 34, 0.95) 0%, rgba(27, 35, 49, 0.95) 100%))',
      backdropFilter: 'blur(20px)',
      borderRight: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
      boxShadow: '2px 0 20px rgba(0, 0, 0, 0.3)',
      zIndex: 2000,
      transition: 'width 0.3s ease',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
      overflow: 'visible'
    }}>
      {/* Collapse Toggle */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: effectiveCollapsed ? 'center' : 'space-between'
      }}>
        {!effectiveCollapsed && (
          <div className="logo-text" style={{
            fontSize: '16px',
            fontWeight: '600',
            color: 'var(--text-primary, #ffffff)',
            letterSpacing: '-0.5px'
          }}>
            Cool-Desk
          </div>
        )}
      </div>

      {/* Search Section */}


      {/* Controls Section */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: effectiveCollapsed ? '4px' : '8px',
        padding: effectiveCollapsed ? '8px 4px' : '16px 12px',
        overflowY: 'auto'
      }}>

        {/* Music Controls */}
        {!effectiveCollapsed && (
          <div style={{
            display: 'flex',
            gap: '4px',
            justifyContent: 'center',
            padding: '8px 0',
            borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
            borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
            margin: '8px 0'
          }}>
            <SidebarButton
              icon={faBackward}
              collapsed={true}
              onClick={handlePrevious}
              tooltip="Previous Track"
            />
            <SidebarButton
              icon={isPlaying ? faPause : faPlay}
              collapsed={true}
              onClick={handlePlayPause}
              tooltip={isPlaying ? "Pause" : "Play"}
            />
            <SidebarButton
              icon={faForward}
              collapsed={true}
              onClick={handleNext}
              tooltip="Next Track"
            />
          </div>
        )}


        <SidebarButton
          icon={faGear}
          label="Settings"
          collapsed={effectiveCollapsed}
          onClick={() => setShowSettings(true)}
        />

        {/* Quick Tools */}
        <div style={{
          marginTop: effectiveCollapsed ? '4px' : '8px',
          borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
          paddingTop: effectiveCollapsed ? '6px' : '10px'
        }}>
          {!effectiveCollapsed && (
            <div style={{
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              color: 'rgba(255, 255, 255, 0.55)',
              marginBottom: '6px'
            }}>
              Quick Tools
            </div>
          )}
          <div style={{
            display: 'flex',
            gap: '6px',
            flexDirection: effectiveCollapsed ? 'column' : 'row',
            flexWrap: effectiveCollapsed ? 'nowrap' : 'wrap'
          }}>
            {quickTools.map(tool => (
              <SidebarButton
                key={tool.label}
                icon={tool.icon}
                renderIcon={tool.renderIcon}
                label={tool.label}
                collapsed={effectiveCollapsed}
                onClick={tool.onClick}
                tooltip={tool.tooltip}
              />
            ))}
          </div>

          {!effectiveCollapsed && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="screen-layout-select" style={{ fontSize: '11px', letterSpacing: '0.4px', textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.55)' }}>
                Screen Layout
              </label>
              <select
                id="screen-layout-select"
                value={layoutChoice}
                onChange={handleLayoutChange}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.2))',
                  background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
                  color: 'var(--text-primary, #ffffff)',
                  fontSize: '13px',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="default">Default View</option>
                <option value="split">Split Screen</option>
                <option value="triple">Triple Screen</option>
              </select>
            </div>
          )}


        </div>



        <SidebarButton
          icon={faArrowUpRightFromSquare}
          label="Open in Sidebar"
          collapsed={effectiveCollapsed}
          onClick={openInSidePanel}
        />
      </div>

      {/* Time Display */}
      <div style={{
        padding: effectiveCollapsed ? '12px 8px' : '16px',
        borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
        textAlign: 'center'
      }}>
        <div style={{
          fontSize: effectiveCollapsed ? '10px' : '12px',
          opacity: 0.8,
          color: 'var(--text-primary, #ffffff)',
          transform: effectiveCollapsed ? 'rotate(-90deg)' : 'none',
          whiteSpace: 'nowrap'
        }} title={now.toLocaleString()}>
          {effectiveCollapsed ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : timeStr}
        </div>
      </div>
    </div>
  );
}

// Reusable Sidebar Button Component
function SidebarButton({
  icon,
  renderIcon,
  label,
  active = false,
  spinning = false,
  collapsed = false,
  onClick,
  tooltip
}) {
  return (
    <button
      className={`sidebar-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      title={tooltip || label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: collapsed ? '0' : '12px',
        padding: collapsed ? '8px' : '12px 16px',
        background: active
          ? 'linear-gradient(135deg, var(--primary, rgba(96, 165, 250, 0.2)) 0%, var(--accent, rgba(139, 92, 246, 0.2)) 100%)'
          : 'var(--glass-bg, linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%))',
        border: `1px solid ${active ? 'var(--primary, rgba(96, 165, 250, 0.4))' : 'var(--border-color, rgba(255, 255, 255, 0.2))'}`,
        borderRadius: '8px',
        color: 'var(--text-primary, #ffffff)',
        cursor: 'pointer',
        backdropFilter: 'blur(10px)',
        transition: 'all 0.2s ease',
        fontSize: collapsed ? '14px' : '13px',
        fontWeight: '500',
        width: '100%',
        justifyContent: collapsed ? 'center' : 'flex-start',
        minHeight: '40px'
      }}
    >
      {renderIcon
        ? renderIcon(collapsed)
        : (
          <FontAwesomeIcon
            icon={icon}
            spin={spinning}
            style={{
              fontSize: collapsed ? '16px' : '14px',
              opacity: spinning ? 0.8 : 1
            }}
          />
        )}
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

// Vertical Search Box Component
function VerticalSearchBox({ search, setSearch, openInSidePanel }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const ui = await getUIState();
        const rs = Array.isArray(ui?.recentSearches) ? ui.recentSearches : [];
        setRecent(rs.slice(0, 5)); // Limit to 5 for vertical layout
      } catch { }
    })();
  }, []);

  useEffect(() => {
    const handleFocusRequest = () => {
      if (inputRef.current) {
        inputRef.current.focus();
        setOpen(true);
      }
    };

    window.addEventListener('verticalSearch:focus', handleFocusRequest);
    return () => window.removeEventListener('verticalSearch:focus', handleFocusRequest);
  }, []);

  const runSearch = async (q) => {
    const query = (q || '').trim();
    if (!query) return;

    try {
      const ui = await getUIState();
      const rs = Array.isArray(ui?.recentSearches) ? ui.recentSearches : [];
      const next = [query, ...rs.filter((x) => x !== query)].slice(0, 10);
      await saveUIState({ ...ui, recentSearches: next });
      setRecent(next.slice(0, 5));
    } catch { }

    try {
      await openInSidePanel(query);
    } catch (err) {
      console.error('Open in side panel failed:', err);
      try {
        if (chrome?.tabs?.create) {
          chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
        }
      } catch { }
    }
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            runSearch(search);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        type="text"
        placeholder="Search..."
        className="vertical-search-input"
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: '8px',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.2))',
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
          color: 'var(--text-primary, #ffffff)',
          fontSize: '14px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
        }}
      />

      {open && (recent.length > 0 || search) && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '4px',
          background: 'var(--glass-bg, rgba(15, 21, 34, 0.95))',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.2))',
          borderRadius: '8px',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          zIndex: 1000,
          maxHeight: '200px',
          overflowY: 'auto'
        }}>
          {search && (
            <div
              onClick={() => runSearch(search)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '12px',
                borderBottom: recent.length ? '1px solid var(--border-color, rgba(255, 255, 255, 0.1))' : 'none'
              }}
            >
              Search for "{search}"
            </div>
          )}
          {recent.map((item, idx) => (
            <div
              key={item}
              onClick={() => runSearch(item)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '12px',
                borderBottom: idx < recent.length - 1 ? '1px solid var(--border-color, rgba(255, 255, 255, 0.1))' : 'none'
              }}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}