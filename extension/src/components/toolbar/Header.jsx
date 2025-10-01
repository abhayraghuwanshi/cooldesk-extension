import {
  faArrowUpRightFromSquare,
  faColumns,
  faPalette,
  faTableColumns,
  faTableCellsLarge
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useState } from 'react';
import { getUIState, saveUIState } from '../../db/index.js';
import { getFaviconUrl } from '../../utils';
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
        if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' });
      } catch { }
    }
  };

  // Triple-screen: tile current window to the left third and open two new windows to fill middle and right thirds
  const openTripleScreen = async () => {
    try {
      if (!chrome?.windows?.getCurrent || !chrome?.windows?.update || !chrome?.windows?.create) {
        // Fallback: open two more tabs with index.html
        try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch {}
        try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch {}
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
      try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch {}
      try { if (chrome?.tabs?.create) chrome.tabs.create({ url: 'index.html' }); } catch {}
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
        {/* Navigation Arrows */}
        {/* {((activeTab && setActiveTab) || (activeSection !== undefined && setActiveSection)) && (() => {
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
        })()} */}
        <MusicControls />


        <button
          className="icon-btn"
          onClick={() => setShowSettings(true)}
          title="Customization"
          style={iconBtnStyle}
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
          {(() => {
            const url = 'https://calendar.google.com/';
            const u = (() => { try { return new URL(url); } catch { return null; } })();
            const candidates = [
              // Known Calendar favicon assets
              'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_16_2x.png',
              'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_32_2x.png',
              u ? `${u.origin}/favicon.ico` : null,
              getFaviconUrl(url, 32)
            ].filter(Boolean);
            return (
              <img
                src={candidates[0]}
                alt="Google Calendar"
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
        <div style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.8, whiteSpace: 'nowrap', flexShrink: 0, minWidth: 'fit-content' }} title={now.toLocaleString()}>
          {timeStr}
        </div>
      </div>
    </header>
  );
}
