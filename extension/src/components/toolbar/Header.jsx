import {
  faArrowUpRightFromSquare,
  faCalendarDays,
  faCircleQuestion,
  faEnvelope,
  faMicrophone,
  faPalette,
  faPlus
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useState } from 'react';
import { getUIState, saveUIState } from '../../db/index.js';
import MusicControls from './MusicControls';
import { SearchBox } from './SearchBox.jsx';
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
  const [showVoiceNavigation, setShowVoiceNavigation] = useState(false);
  // Load Auto Sync from UI state
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
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    }}>
      <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', flex: 1, flexWrap: 'nowrap' }}>
        <div style={{ position: 'relative', flex: 1, marginRight: '10vw' }}>
          <SearchBox search={search} setSearch={setSearch} openInSidePanel={openInSidePanel} />
        </div>
        {/* Navigation Arrows */}
        {((activeTab && setActiveTab) || (activeSection !== undefined && setActiveSection)) && (() => {
          // Define sections for ActivityPanel navigation - add 'All' as first option
          const sections = ['All', 'Current Tabs', 'Pins', 'Notes', 'Daily Notes', 'Cool Feed'];
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
                    color: 'var(--text-primary, #ffffff)',
                    background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
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
                    e.target.style.background = 'var(--primary-color, rgba(0, 122, 255, 0.1))';
                    e.target.style.borderColor = 'var(--primary-color, rgba(0, 122, 255, 0.3))';
                    e.target.style.transform = 'translateY(-1px)';
                    e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'var(--glass-bg, rgba(255, 255, 255, 0.05))';
                    e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.1))';
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
                  }}
                >
                  {sections.map((section, index) => (
                    <option
                      key={index}
                      value={index}
                      style={{
                        background: 'var(--background-primary, rgba(10, 10, 15, 0.95))',
                        color: 'var(--text-primary, #ffffff)',
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
                  color: 'var(--text-primary, #ffffff)',
                  background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
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
        <MusicControls />

        <button
          className={`icon-btn ${showVoiceNavigation ? 'active' : ''}`}
          onClick={() => setShowVoiceNavigation(!showVoiceNavigation)}
          title={showVoiceNavigation ? "Hide Voice Navigation" : "Show Voice Navigation"}
          aria-pressed={showVoiceNavigation}
          style={{
            background: showVoiceNavigation
              ? 'linear-gradient(135deg, var(--accent-primary, #34C759), var(--accent-secondary, #30D158))'
              : 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
            borderColor: showVoiceNavigation ? 'var(--accent-primary, #34C759)' : 'var(--border-primary, rgba(255, 255, 255, 0.1))',
            color: showVoiceNavigation ? 'white' : 'var(--text, #e5e7eb)'
          }}
        >
          <FontAwesomeIcon icon={faMicrophone} />
        </button>

        <button
          className="icon-btn"
          onClick={() => setShowCreateWorkspace(true)}
          title="Create Workspace"
          style={{
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
            borderColor: 'var(--border-primary, rgba(255, 255, 255, 0.1))',
            color: 'var(--text, #e5e7eb)'
          }}
        >
          <FontAwesomeIcon icon={faPlus} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setShowSettings(true)}
          title="Customization"
          style={{
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
            borderColor: 'var(--border-primary, rgba(255, 255, 255, 0.1))',
            color: 'var(--text, #e5e7eb)'
          }}
        >
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
          style={{
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
            borderColor: 'var(--border-primary, rgba(255, 255, 255, 0.1))',
            color: 'var(--text, #e5e7eb)'
          }}
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
          style={{
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
            borderColor: 'var(--border-primary, rgba(255, 255, 255, 0.1))',
            color: 'var(--text, #e5e7eb)'
          }}
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
          style={{
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
            borderColor: 'var(--border-primary, rgba(255, 255, 255, 0.1))',
            color: 'var(--text, #e5e7eb)'
          }}
        >
          <FontAwesomeIcon icon={faCircleQuestion} />
        </button>
        <button
          className="icon-btn"
          onClick={openInSidePanel}
          title="Open in Sidebar"
          style={{
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
            borderColor: 'var(--border-primary, rgba(255, 255, 255, 0.1))',
            color: 'var(--text, #e5e7eb)'
          }}
        >
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.8, whiteSpace: 'nowrap', flexShrink: 0, minWidth: 'fit-content' }} title={now.toLocaleString()}>
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
