import {
  faArrowUpRightFromSquare,
  faBackward,
  faCalendarDays,
  faChevronDown,
  faChevronUp,
  faCircleQuestion,
  faEnvelope,
  faForward,
  faPalette,
  faPause,
  faPlay,
  faPlus,
  faRobot,
  faSpinner,
  faToggleOff
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useRef, useState } from 'react';
import { getUIState, saveUIState } from '../../db';
import { triggerAutoCategorize } from '../../utils/messaging';

export function VerticalHeader({
  search,
  setSearch,
  populate,
  setShowSettings,
  openSyncControls,
  progress,
  setShowCreateWorkspace,
  openInTab,
  activeTab,
  setActiveTab,
  activeSection,
  setActiveSection,
}) {
  const [autoSync, setAutoSync] = useState(true);
  const [now, setNow] = useState(new Date());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

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

  const openInSidePanel = async (overrideQuery) => {
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
  };

  // Navigation logic
  const sections = ['All', 'Current Tabs', 'Pings', 'Notes', 'Cool Feed'];
  const isActivityNavigation = activeSection !== undefined && setActiveSection;

  const currentLabel = isActivityNavigation
    ? sections[activeSection] || 'Section'
    : (activeTab === 'workspace' ? 'Workspace' : 'Saved');

  const handlePreviousNav = () => {
    if (isActivityNavigation) {
      setActiveSection((prev) => (prev - 1 + sections.length) % sections.length);
    } else {
      setActiveTab(activeTab === 'workspace' ? 'saved' : 'workspace');
    }
  };

  const handleNextNav = () => {
    if (isActivityNavigation) {
      setActiveSection((prev) => (prev + 1) % sections.length);
    } else {
      setActiveTab(activeTab === 'workspace' ? 'saved' : 'workspace');
    }
  };

  const sidebarWidth = effectiveCollapsed ? '60px' : '280px';

  return (
    <div className="vertical-sidebar" style={{
      position: 'fixed',
      left: 0,
      top: 0,
      bottom: 0,
      width: sidebarWidth,
      background: 'linear-gradient(180deg, rgba(15, 21, 34, 0.95) 0%, rgba(27, 35, 49, 0.95) 100%)',
      backdropFilter: 'blur(20px)',
      borderRight: '1px solid rgba(255, 255, 255, 0.1)',
      boxShadow: '2px 0 20px rgba(0, 0, 0, 0.3)',
      zIndex: 2000,
      transition: 'width 0.3s ease',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
      overflow: 'hidden'
    }}>
      {/* Collapse Toggle */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: effectiveCollapsed ? 'center' : 'space-between'
      }}>
        {!effectiveCollapsed && (
          <div className="logo-text" style={{
            fontSize: '16px',
            fontWeight: '600',
            color: '#ffffff',
            letterSpacing: '-0.5px'
          }}>
            Cool-Desk
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          disabled={shouldAutoCollapse}
          style={{
            background: 'none',
            border: 'none',
            color: shouldAutoCollapse ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.7)',
            cursor: shouldAutoCollapse ? 'not-allowed' : 'pointer',
            padding: '6px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.2s ease'
          }}
        >
          <FontAwesomeIcon icon={effectiveCollapsed ? faChevronDown : faChevronUp} style={{ transform: 'rotate(90deg)' }} />
        </button>
      </div>

      {/* Search Section */}
      {!effectiveCollapsed && (
        <div style={{ padding: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <VerticalSearchBox
            search={search}
            setSearch={setSearch}
            openInSidePanel={openInSidePanel}
          />
        </div>
      )}

      {/* Navigation Section */}
      {((activeTab && setActiveTab) || (activeSection !== undefined && setActiveSection)) && (
        <div style={{
          padding: effectiveCollapsed ? '8px' : '16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: effectiveCollapsed ? 'column' : 'row',
          alignItems: 'center',
          gap: effectiveCollapsed ? '8px' : '12px'
        }}>
          <button
            className="sidebar-btn"
            onClick={handlePreviousNav}
            title={isActivityNavigation
              ? `Previous: ${sections[(activeSection - 1 + sections.length) % sections.length]}`
              : `Switch to ${activeTab === 'workspace' ? 'Saved Tabs' : 'Workspace'}`
            }
          >
            <FontAwesomeIcon icon={faChevronUp} />
          </button>

          {!effectiveCollapsed && (
            <div style={{
              fontSize: '12px',
              fontWeight: '500',
              color: 'rgba(255, 255, 255, 0.8)',
              textAlign: 'center',
              flex: 1,
              textTransform: 'capitalize'
            }}>
              {currentLabel}
            </div>
          )}

          <button
            className="sidebar-btn"
            onClick={handleNextNav}
            title={isActivityNavigation
              ? `Next: ${sections[(activeSection + 1) % sections.length]}`
              : `Switch to ${activeTab === 'workspace' ? 'Saved Tabs' : 'Workspace'}`
            }
          >
            <FontAwesomeIcon icon={faChevronDown} />
          </button>
        </div>
      )}

      {/* Controls Section */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: effectiveCollapsed ? '4px' : '8px',
        padding: effectiveCollapsed ? '8px 4px' : '16px 12px',
        overflowY: 'auto'
      }}>

        {/* Auto Categorize */}
        <SidebarButton
          icon={progress.running ? faSpinner : (autoSync ? faRobot : faToggleOff)}
          label="Auto Categorize"
          active={autoSync}
          spinning={progress.running}
          collapsed={effectiveCollapsed}
          onClick={async () => {
            try {
              const next = !autoSync;
              setAutoSync(next);
              const ui = await getUIState();
              await saveUIState({ ...ui, autoSync: next });
              if (next) {
                await triggerAutoCategorize();
              }
            } catch (e) {
              console.warn('Failed to toggle auto-categorize:', e);
            }
          }}
          tooltip={autoSync ? 'Auto Categorize is ON - Click to turn OFF' : 'Auto Categorize is OFF - Click to turn ON'}
        />

        {/* Music Controls */}
        {!effectiveCollapsed && (
          <div style={{
            display: 'flex',
            gap: '4px',
            justifyContent: 'center',
            padding: '8px 0',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
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

        {/* Action Buttons */}
        <SidebarButton
          icon={faPlus}
          label="Create Workspace"
          collapsed={effectiveCollapsed}
          onClick={() => setShowCreateWorkspace(true)}
        />

        <SidebarButton
          icon={faPalette}
          label="Customization"
          collapsed={effectiveCollapsed}
          onClick={() => setShowSettings(true)}
        />

        <SidebarButton
          icon={faEnvelope}
          label="Gmail"
          collapsed={effectiveCollapsed}
          onClick={() => {
            try {
              const url = 'https://mail.google.com/mail/u/0/#inbox';
              if (chrome?.tabs?.create) chrome.tabs.create({ url });
              else window.open(url, '_blank');
            } catch { }
          }}
        />

        <SidebarButton
          icon={faCalendarDays}
          label="Calendar"
          collapsed={effectiveCollapsed}
          onClick={() => {
            try {
              const url = 'https://calendar.google.com/';
              if (chrome?.tabs?.create) chrome.tabs.create({ url });
              else window.open(url, '_blank');
            } catch { }
          }}
        />

        <SidebarButton
          icon={faCircleQuestion}
          label="Help"
          collapsed={effectiveCollapsed}
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
        />

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
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        textAlign: 'center'
      }}>
        <div style={{
          fontSize: effectiveCollapsed ? '10px' : '12px',
          opacity: 0.8,
          color: '#ffffff',
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
          ? 'linear-gradient(135deg, rgba(96, 165, 250, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)'
          : 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
        border: `1px solid ${active ? 'rgba(96, 165, 250, 0.4)' : 'rgba(255, 255, 255, 0.2)'}`,
        borderRadius: '8px',
        color: '#ffffff',
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
      <FontAwesomeIcon
        icon={icon}
        spin={spinning}
        style={{
          fontSize: collapsed ? '16px' : '14px',
          opacity: spinning ? 0.8 : 1
        }}
      />
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
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          background: 'rgba(255, 255, 255, 0.1)',
          color: '#ffffff',
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
          background: 'rgba(15, 21, 34, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
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
                borderBottom: recent.length ? '1px solid rgba(255, 255, 255, 0.1)' : 'none'
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
                borderBottom: idx < recent.length - 1 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none'
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