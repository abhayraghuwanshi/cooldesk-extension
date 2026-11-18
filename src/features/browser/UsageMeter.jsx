import { faMemory, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { isSystemMemoryLow, pageBudgetOf } from './usePaneGuard';

// The top toolbar's memory / CPU pill: what CoolDesk costs the Mac right now,
// so it's obvious before things get slow. Fed by the pane guard's poll of
// browser_pane_stats (no extra polling). Numbers:
//   - memory: CoolDesk itself (app + its own windows' WebKit processes + the
//     shared GPU / Networking processes) plus every in-app page,
//   - CPU: the same processes, percent of one core summed (can pass 100%).
// Colour: calm → amber when getting heavy → red when the pane guard is about
// to start sleeping tabs (pages over budget, or the system short on memory).
// Clicking opens a list of every page with its memory / CPU (close any).

const MB = 1024 * 1024;
const GB = 1024 * MB;

// CoolDesk's own processes (pages excluded). A fresh app is a few hundred MB;
// past these something is leaking or a view is holding far too much.
const APP_WARN = 1 * GB;
const APP_HIGH = 2 * GB;
// Sustained CPU, percent of one core, everything summed. Each sample is
// averaged over the poll interval, so a spike alone won't trip it.
const CPU_WARN = 60;
const CPU_HIGH = 150;
// Share of the pages' budget (see usePaneGuard) before turning amber.
const PAGES_WARN_SHARE = 0.75;

function formatBytes(bytes) {
  if (bytes == null) return '–';
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`;
}

/** 'ok' | 'warn' | 'high', and why (for the tooltip). */
function usageLevel(stats, pagesMemory, cpu) {
  if (!stats) return { level: 'ok', why: null };
  const app = stats.app_memory || 0;
  const budget = pageBudgetOf(stats.total_memory);
  if (isSystemMemoryLow(stats)) return { level: 'high', why: 'The Mac is low on memory' };
  if (pagesMemory > budget) return { level: 'high', why: 'Pages are over their memory budget, so background tabs will be put to sleep' };
  if (app > APP_HIGH) return { level: 'high', why: 'CoolDesk itself is using a lot of memory' };
  if (cpu >= CPU_HIGH) return { level: 'high', why: 'Using more than a core and a half' };
  if (pagesMemory > budget * PAGES_WARN_SHARE) return { level: 'warn', why: 'Pages are close to their memory budget' };
  if (app > APP_WARN) return { level: 'warn', why: 'CoolDesk itself is getting heavy' };
  if (cpu >= CPU_WARN) return { level: 'warn', why: 'Busy CPU' };
  return { level: 'ok', why: null };
}

/**
 * @param stats        browser_pane_stats result (null until the first poll)
 * @param pagesMemory  bytes used by in-app pages (each process counted once)
 * @param pagesCpu     percent of one core used by pages
 * @param pageCount    pages with a live process
 * @param pages        open pages with memory / cpu (BrowseView's openPages)
 * @param onClosePage  (page) => close it
 * @param onOpenChange (open) => the list is showing (the guard polls faster)
 */
export function UsageMeter({ stats, pagesMemory = 0, pagesCpu = 0, pageCount = 0, pages = [], onClosePage, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => { onOpenChangeRef.current?.(open); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!stats || stats.app_memory == null) return null;
  const app = stats.app_memory || 0;
  const cpu = (stats.app_cpu || 0) + pagesCpu;
  const total = app + pagesMemory;
  const { level, why } = usageLevel(stats, pagesMemory, cpu);
  const maxMemory = Math.max(1, ...pages.map(p => p.memory || 0));

  const lines = [
    `CoolDesk: ${formatBytes(total)} · ${Math.round(cpu)}% CPU`,
    `  App and its windows: ${formatBytes(app)} · ${Math.round(stats.app_cpu || 0)}% CPU`,
    `  Pages (${pageCount}): ${formatBytes(pagesMemory)} · ${Math.round(pagesCpu)}% CPU`,
    `  Page budget: ${formatBytes(pageBudgetOf(stats.total_memory))}`,
    `Mac: ${formatBytes(stats.available_memory)} free of ${formatBytes(stats.total_memory)}`,
  ];
  if (why) lines.push('', why);
  lines.push('', 'Click for every page');

  return (
    <div className="bp-usage-root" ref={rootRef}>
      <button
        type="button"
        className={`bp-usage bp-usage--${level} ${open ? 'on' : ''}`}
        onClick={() => setOpen(v => !v)}
        title={open ? undefined : lines.join('\n')}
        aria-expanded={open}
        aria-label={`CoolDesk is using ${formatBytes(total)} of memory and ${Math.round(cpu)}% CPU`}
      >
        <span className="bp-usage-dot" aria-hidden="true" />
        <span className="bp-usage-mem">{formatBytes(total)}</span>
        <span className="bp-usage-cpu">{Math.round(cpu)}%</span>
      </button>
      {open && (
        <div className="pt-pop bp-usage-pop" role="dialog" aria-label="Memory">
          <div className="pt-pop-head">
            <strong><FontAwesomeIcon icon={faMemory} /> Memory</strong>
            <span>{formatBytes(total)} · {Math.round(cpu)}% CPU</span>
          </div>
          {why && <div className={`bp-usage-why bp-usage-why--${level}`}>{why}</div>}
          <div className="bp-usage-list">
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
                {p.tabId && onClosePage && (
                  <button className="bp-btn browse-stat-close" onClick={() => onClosePage(p)} title="Close this page">
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="pt-pop-foot">
            CoolDesk itself <strong>{formatBytes(app)}</strong> · {Math.round(stats.app_cpu || 0)}% CPU
            {' · '}Mac {formatBytes(stats.available_memory)} free
          </div>
        </div>
      )}
    </div>
  );
}
