import { faArrowUpRightFromSquare, faCamera, faCropSimple, faCheck, faExpand, faMagnifyingGlass, faMemory, faMoon, faShieldHalved, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import '../../styles/browse.css';
import { SitePermissions } from './SitePermissions';

// Page tab of Browse's side panel: the visible tab's page controls (moved off
// the toolbar to keep it clean), the site's permissions (camera, mic, sound)
// and the memory/CPU of every in-app page.

const MB = 1024 * 1024;

function formatBytes(bytes) {
  if (bytes == null) return '–';
  return bytes >= 1024 * MB ? `${(bytes / (1024 * MB)).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`;
}

// Each tool has its own colour (used flat, on its icon and when it's on), so
// they're told apart at a glance rather than by reading a row of labels.
const TOOL_COLORS = {
  adblock: '#34d399',
  dark: '#818cf8',
  fit: '#fbbf24',
  find: '#60a5fa',
  clip: '#2dd4bf',
  shot: '#f472b6',
  open: '#94a3b8',
};

/** A switch tile: lights up in its colour while on. */
function Toggle({ tool, icon, label, state, on, disabled, onToggle }) {
  return (
    <button
      className={`pg-tile ${on ? 'on' : ''}`}
      style={{ '--tool': TOOL_COLORS[tool] }}
      onClick={onToggle}
      disabled={disabled}
      role="switch"
      aria-checked={!!on}
      title={`${label}: ${on ? 'on' : 'off'}`}
    >
      <span className="pg-tile-icon"><FontAwesomeIcon icon={icon} /></span>
      <span className="pg-tile-label">{label}</span>
      <span className="pg-tile-state">{state ?? (on ? 'On' : 'Off')}</span>
    </button>
  );
}

/** A one-shot tile: flashes a check when done. */
function Action({ tool, icon, label, state, disabled, onRun }) {
  const [done, setDone] = useState(false);
  const run = async () => {
    try {
      await onRun();
      setDone(true);
      setTimeout(() => setDone(false), 1300);
    } catch (err) {
      console.warn(`[Page] ${label} failed:`, err);
    }
  };
  return (
    <button
      className={`pg-tile action ${done ? 'done' : ''}`}
      style={{ '--tool': done ? TOOL_COLORS.adblock : TOOL_COLORS[tool] }}
      onClick={run}
      disabled={disabled}
      title={label}
    >
      <span className="pg-tile-icon"><FontAwesomeIcon icon={done ? faCheck : icon} /></span>
      <span className="pg-tile-label">{label}</span>
      <span className="pg-tile-state">{done ? 'Done' : state}</span>
    </button>
  );
}

/**
 * @param tools      the visible tab's controls (BrowserPane onTools), or null
 * @param pages      open pages with memory/cpu (BrowseView's openPages)
 * @param totals     { memory, cpu, app }
 * @param live       the visible page's stats ({ audible, camera, microphone }), or null
 * @param onClosePage(page)
 */
export function PageView({ tools, pages = [], totals, live = null, onClosePage }) {
  const hasPage = !!tools?.url;
  const host = tools?.host || '';
  const maxMemory = Math.max(1, ...pages.map(p => p.memory || 0));

  return (
    <div className="pg-root">
      <section className="pg-section">
        <h4>This page{host ? <span> · {host}</span> : null}</h4>
        <div className="pg-grid">
          {tools?.adblockSupported && (
            <Toggle
              tool="adblock"
              icon={faShieldHalved}
              label="Block ads"
              on={tools.blocking}
              disabled={!hasPage}
              onToggle={tools.toggleAdblock}
            />
          )}
          <Toggle
            tool="dark"
            icon={faMoon}
            label="Dark mode"
            on={tools?.darkOn}
            disabled={!hasPage || !host}
            onToggle={tools?.toggleDark}
          />
          <Toggle
            tool="fit"
            icon={faExpand}
            label="Fit to pane"
            state={tools ? (tools.autoFit ? `Zoom ${Math.round((tools.zoom || 1) * 100)}%` : '100%') : null}
            on={tools?.autoFit}
            disabled={!tools}
            onToggle={tools?.toggleAutoFit}
          />
          <Action tool="find" icon={faMagnifyingGlass} label="Find" state="⌘F" disabled={!hasPage} onRun={() => tools.find()} />
          <Action tool="clip" icon={faCropSimple} label="Clip" state="Table, chart… → Notes" disabled={!hasPage} onRun={() => tools.clip()} />
          <Action tool="shot" icon={faCamera} label="Screenshot" state="To Shelf" disabled={!hasPage} onRun={() => tools.screenshot()} />
          <Action tool="open" icon={faArrowUpRightFromSquare} label="Open outside" state="Your browser" disabled={!hasPage} onRun={() => tools.openExternal()} />
        </div>
      </section>

      <SitePermissions host={hasPage ? host : ''} paneId={tools?.paneId} live={live} />

      <section className="pg-section">
        <h4>
          <FontAwesomeIcon icon={faMemory} /> Memory
          {totals && <span> · {formatBytes(totals.memory)} · {Math.round(totals.cpu || 0)}% CPU</span>}
        </h4>
        {pages.length === 0 && <div className="browse-hint">No pages open.</div>}
        {pages.map(p => (
          <div key={p.id} className="browse-stat-row">
            <div className="browse-stat-main">
              <span className="browse-stat-name" title={p.url}>{p.label}</span>
              <span className="browse-stat-where">{p.where}{p.shared ? ' · shared process' : ''}</span>
              <span className="browse-stat-bar"><span style={{ width: `${((p.memory || 0) / maxMemory) * 100}%` }} /></span>
            </div>
            <div className="browse-stat-nums">
              <strong>{formatBytes(p.memory)}</strong>
              <span>{p.cpu == null ? '–' : `${p.cpu.toFixed(0)}% CPU`}</span>
            </div>
            {(p.tabId || p.tileId) && (
              <button className="bp-btn browse-stat-close" onClick={() => onClosePage(p)} title="Close this page">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}
          </div>
        ))}
        {totals?.app != null && (
          <div className="pg-foot">CoolDesk itself <strong>{formatBytes(totals.app)}</strong></div>
        )}
      </section>
    </div>
  );
}
