import { faArrowUpRightFromSquare, faCircleNotch, faMemory, faMicrochip, faPowerOff, faServer, faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState } from 'react';

// Common local dev server ports — used to filter out OS/system listeners by default.
const DEV_PORTS = new Set([
  1234, 3000, 3001, 3002, 3003, 3004, 3005, 4000, 4200, 4321, 5000, 5001,
  5173, 5174, 5175, 6006, 8000, 8001, 8080, 8081, 8888, 9000, 9229, 19000,
]);

// Process names that strongly imply a dev server (matched case-insensitively,
// `.exe` stripped). A listener owned by one of these is shown regardless of port.
const DEV_PROCESS_HINTS = [
  'node', 'deno', 'bun', 'python', 'php', 'ruby', 'java', 'dotnet', 'cargo',
  'rustc', 'go', 'vite', 'next', 'webpack', 'esbuild', 'ng', 'rails', 'flask',
  'gunicorn', 'uvicorn', 'code', 'nginx',
];

function normalizeProcName(name) {
  return (name || '').toLowerCase().replace(/\.exe$/, '');
}

// Bytes → compact human string (e.g. "312 MB", "1.4 GB").
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// Color the CPU figure so a hot process stands out at a glance.
function cpuColor(cpu) {
  if (cpu >= 50) return '#F87171';
  if (cpu >= 15) return '#FBBF24';
  return 'var(--text-secondary, #94A3B8)';
}

function looksLikeDevServer(entry) {
  if (DEV_PORTS.has(entry.port)) return true;
  const proc = normalizeProcName(entry.process);
  return DEV_PROCESS_HINTS.some(hint => proc.includes(hint));
}

/**
 * DevServersPanel — live list of processes listening on a TCP port.
 * Unlike the tab-driven "Local Dev" section, this is port-driven (the OS socket
 * table), so it surfaces orphaned servers that no longer have a tab open.
 * Tauri desktop only — backed by the Rust `list_listening_ports` command.
 *
 * @param {Array} tabs - localhost tabs, used to link a port back to its open tab
 * @param {Function} onTabClick - jump to an existing tab (tab) => void
 */
export function DevServersPanel({ tabs = [], onTabClick }) {
  const [ports, setPorts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Port currently armed for confirm, and the one being killed.
  const [confirmPort, setConfirmPort] = useState(null);
  const [killingPort, setKillingPort] = useState(null);

  // Map port -> open localhost tab (for the "has tab / open" affordance).
  const tabByPort = useMemo(() => {
    const map = new Map();
    for (const t of tabs) {
      try {
        const u = new URL(t.url);
        const port = u.port || (u.protocol === 'https:' ? '443' : '80');
        if (port && !map.has(port)) map.set(String(port), t);
      } catch { /* ignore unparseable urls */ }
    }
    return map;
  }, [tabs]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const list = await invoke('list_listening_ports');
      setPorts(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error('[DevServersPanel] list_listening_ports failed:', error);
      setPorts([]);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleKill = useCallback(async (entry) => {
    if (confirmPort !== entry.port) {
      setConfirmPort(entry.port);
      setTimeout(() => setConfirmPort(p => (p === entry.port ? null : p)), 3000);
      return;
    }
    setConfirmPort(null);
    setKillingPort(entry.port);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('kill_process_on_port', { port: entry.port });
      console.log('[DevServersPanel] killed:', result);
      // Drop it optimistically, then re-sync with the OS.
      setPorts(prev => prev.filter(p => p.port !== entry.port));
      refresh();
    } catch (error) {
      console.error('[DevServersPanel] kill failed for port', entry.port, ':', error);
    } finally {
      setKillingPort(null);
    }
  }, [confirmPort, refresh]);

  const handleOpen = useCallback(async (entry) => {
    const tab = tabByPort.get(String(entry.port));
    if (tab && onTabClick) {
      onTabClick(tab);
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_url', { url: `http://localhost:${entry.port}` });
    } catch (error) {
      console.error('[DevServersPanel] open_url failed:', error);
    }
  }, [tabByPort, onTabClick]);

  const visible = useMemo(() => {
    if (showAll) return ports;
    // Default view: dev-looking ports, plus any port that has an open tab.
    return ports.filter(e => looksLikeDevServer(e) || tabByPort.has(String(e.port)));
  }, [ports, showAll, tabByPort]);

  // Hide the whole panel until we know there's something to show (keeps the UI
  // quiet on machines with no dev servers running).
  if (loaded && ports.length === 0) return null;
  if (!loading && loaded && visible.length === 0 && !showAll) return null;

  return (
    <div>
      <h3 style={{
        fontSize: 'var(--font-2xl, 20px)',
        fontWeight: 600,
        color: 'var(--text-secondary, #94A3B8)',
        marginBottom: '8px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <FontAwesomeIcon icon={faServer} style={{ opacity: 0.6 }} />
        Dev Servers ({visible.length})
        <button
          onClick={refresh}
          disabled={loading}
          title="Refresh port list"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary, #94A3B8)',
            cursor: loading ? 'default' : 'pointer',
            padding: '2px',
            display: 'inline-flex'
          }}
        >
          <FontAwesomeIcon icon={faSync} spin={loading} style={{ fontSize: '12px' }} />
        </button>
        <button
          onClick={() => setShowAll(s => !s)}
          title={showAll ? 'Show only dev servers' : 'Show all listening ports'}
          style={{
            marginLeft: 'auto',
            background: showAll ? 'rgba(59,130,246,0.15)' : 'rgba(100,116,139,0.12)',
            border: `1px solid ${showAll ? 'rgba(59,130,246,0.35)' : 'rgba(100,116,139,0.25)'}`,
            borderRadius: '6px',
            padding: '3px 10px',
            color: showAll ? '#60A5FA' : '#94A3B8',
            cursor: 'pointer',
            fontSize: 'var(--font-xs, 11px)',
            fontWeight: 600,
            textTransform: 'none',
            letterSpacing: 0
          }}
        >
          {showAll ? 'Dev only' : 'Show all'}
        </button>
      </h3>

      <div className="tabs-grid">
        {visible.map(entry => {
          const tab = tabByPort.get(String(entry.port));
          const armed = confirmPort === entry.port;
          const killing = killingPort === entry.port;
          // Monochrome to match the other cards: a slightly brighter dot when a
          // tab is open, dimmer when orphaned — no color tint.
          const dotColor = tab ? '#94A3B8' : '#475569';
          return (
            <div
              key={`${entry.port}-${entry.pid}`}
              className="cooldesk-tab-card"
              style={{
                gap: '8px',
                justifyContent: 'flex-start',
                cursor: 'default',
                // Red tint only while the kill confirm is armed.
                ...(armed ? {
                  background: 'rgba(239, 68, 68, 0.1)',
                  borderColor: 'rgba(239, 68, 68, 0.4)'
                } : {})
              }}
            >
              {/* Row 1: process name (lead) + port chip */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 'var(--font-sm, 13px)',
                  fontWeight: 600,
                  color: 'var(--text-primary, #E2E8F0)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }} title={entry.process}>
                  {entry.process}
                </span>
                <span style={{
                  flexShrink: 0,
                  fontFamily: 'var(--font-family-mono, monospace)',
                  fontSize: 'var(--font-xs, 11px)',
                  fontWeight: 700,
                  color: 'var(--text-primary, #E2E8F0)',
                  background: 'rgba(148, 163, 184, 0.12)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: '6px',
                  padding: '1px 7px'
                }}>
                  :{entry.port}
                </span>
              </div>

              {/* Row 2: status · pid (left)  ·  CPU / RAM (right) */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                fontSize: 'var(--font-xs, 11px)',
                color: 'var(--text-secondary, #94A3B8)'
              }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }} title={tab ? tab.title : 'No browser tab is open for this port'}>
                  <span style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: dotColor, flexShrink: 0
                  }} />
                  {tab ? (tab.title || 'open tab') : 'orphan'}
                  <span style={{ color: 'var(--text-secondary, #64748B)', flexShrink: 0 }}>
                    · pid {entry.pid}
                  </span>
                </span>

                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }} title="CPU usage">
                    <FontAwesomeIcon icon={faMicrochip} style={{ fontSize: '10px', opacity: 0.7 }} />
                    <span style={{ color: cpuColor(entry.cpu), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {(entry.cpu ?? 0).toFixed(entry.cpu >= 10 ? 0 : 1)}%
                    </span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }} title="Memory (resident)">
                    <FontAwesomeIcon icon={faMemory} style={{ fontSize: '10px', opacity: 0.7 }} />
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {formatBytes(entry.memory)}
                    </span>
                  </span>
                </span>
              </div>

              {/* Actions — revealed on card hover (stay visible while a kill is armed) */}
              <div
                className="dev-server-actions"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: armed ? 1 : undefined }}
              >
                <button
                  onClick={() => handleOpen(entry)}
                  title={tab ? 'Jump to tab' : `Open http://localhost:${entry.port}`}
                  style={{
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(148, 163, 184, 0.18)',
                    borderRadius: '7px',
                    color: 'var(--text-secondary, #CBD5E1)',
                    cursor: 'pointer',
                    padding: '5px 8px',
                    fontSize: 'var(--font-xs, 11px)',
                    fontWeight: 500
                  }}
                >
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ fontSize: '10px' }} />
                  Open
                </button>
                <button
                  onClick={() => handleKill(entry)}
                  disabled={killing}
                  title={armed ? `Click again to kill port ${entry.port}` : `Kill the process on port ${entry.port}`}
                  style={{
                    flex: armed ? 1.4 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    background: armed ? 'rgba(239, 68, 68, 0.18)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${armed ? 'rgba(239, 68, 68, 0.45)' : 'rgba(148, 163, 184, 0.18)'}`,
                    borderRadius: '7px',
                    color: armed ? '#F87171' : '#FB923C',
                    cursor: killing ? 'default' : 'pointer',
                    padding: '5px 8px',
                    fontSize: 'var(--font-xs, 11px)',
                    fontWeight: 600,
                    transition: 'all 0.15s ease'
                  }}
                >
                  <FontAwesomeIcon icon={killing ? faCircleNotch : faPowerOff} spin={killing} style={{ fontSize: '10px' }} />
                  {armed ? `Kill :${entry.port}?` : 'Kill'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
