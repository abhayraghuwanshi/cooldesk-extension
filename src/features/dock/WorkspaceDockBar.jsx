import { faChevronDown, faChevronUp, faCode, faDesktop, faFileLines, faFolderOpen, faTableColumns, faUpRightAndDownLeftFromCenter } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logo from '../../../logo-2.png';
import { isEditorApp, workspaceActivityService } from '../../services/workspaceActivityService';
import '../../styles/dockbar.css';

// Favicon resolution as an ordered fallback chain rather than a single source:
// stored workspace URLs are often missing their protocol (so `new URL()` throws)
// or point at domains the DuckDuckGo .ico endpoint doesn't have, which is why
// the dock was showing letter circles. Google's service is normalized-host
// based and returns a real icon (or a globe) instead of erroring, so it leads;
// DuckDuckGo is the backup; the letter avatar is the last resort.
const faviconSources = (rawUrl) => {
  if (!rawUrl) return [];
  let host = '';
  try {
    const withProto = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    host = new URL(withProto).hostname;
  } catch { return []; }
  if (!host) return [];
  return [
    `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
  ];
};

// Advance the <img> to its next candidate source on error; when the chain is
// exhausted, hide it and reveal the letter-avatar sibling.
const handleFaviconError = (e) => {
  const rest = (e.target.dataset.fallback || '').split('|').filter(Boolean);
  if (rest.length) {
    e.target.dataset.fallback = rest.slice(1).join('|');
    e.target.src = rest[0];
  } else {
    e.target.style.display = 'none';
    if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
  }
};

const AVATAR_COLORS = ['#3b82f6', '#f97316', '#a16207', '#22c55e', '#8b5cf6'];
const letterAvatar = (url) => {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = String(url || ''); }
  const letter = (host[0] || '?').toUpperCase();
  const hash = host.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return { letter, color: AVATAR_COLORS[hash % AVATAR_COLORS.length] };
};

const invokeDock = async (cmd, args) => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke(cmd, args);
  } catch (e) {
    console.error(`[DockBar] ${cmd} failed:`, e);
  }
};

/**
 * Taskbar-style horizontal dock: the active workspace's links and apps as a
 * single row of launchers. Rendered as the whole UI of the main window while
 * the dock is on a top/bottom edge (the window is only ~96px tall then, so
 * everything must fit one row — no popovers).
 */
export function WorkspaceDockBar({ workspaces = [], activeWorkspace, onSelectWorkspace, side = 'bottom' }) {
  const workspace = activeWorkspace || workspaces[0] || null;
  const urls = useMemo(
    () => (workspace?.urls || []).filter((u) => u.status !== 'draft'),
    [workspace]
  );
  const apps = workspace?.apps || [];

  // Live running-apps + open-tabs state. `activity` is only a re-render tick;
  // the matching itself goes through the shared service.
  const [activity, setActivity] = useState(null);
  useEffect(() => workspaceActivityService.subscribe(setActivity), []);

  // One resolution pass for the whole row, so no two items claim the same tab
  // or window — and so each item's dot and its click read the same answer.
  // `activity` is not read here but must stay in the deps: resolveAll reads the
  // service's mutable snapshot, so a poll landing is the only signal that this
  // needs recomputing. eslint can't see that and calls it unnecessary.
  const resolved = useMemo(
    () => workspaceActivityService.resolveAll([...urls, ...apps]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urls, apps, activity]
  );

  // The bar is one row tall, so workspace switching is a cycle button rather
  // than a dropdown (a popover would clip against the window edge).
  const cycleWorkspace = useCallback(() => {
    if (workspaces.length < 2 || !workspace) return;
    const idx = workspaces.findIndex((w) => w.id === workspace.id);
    onSelectWorkspace?.(workspaces[(idx + 1) % workspaces.length]);
  }, [workspaces, workspace, onSelectWorkspace]);

  // Taskbar behavior — focus what's open, launch what isn't — lives in the
  // service so the dock, the workspace cards and the panels can't drift apart.
  // The target from `resolved` is handed over rather than looked up again, so
  // the click acts on exactly what the dot was painted from.
  const open = useCallback(
    (item) => workspaceActivityService.activate(item, { target: resolved.get(item) ?? null }),
    [resolved]
  );

  const appFallbackIcon = (app) =>
    isEditorApp(app) ? faCode
      : app.appType === 'folder' ? faFolderOpen
        : app.appType === 'file' ? faFileLines
          : faDesktop;

  // macOS-dock-style magnification: icons scale up by how close the cursor
  // sits to their center, with neighbors easing off. The transform-origin is
  // the docked edge (bottom for a bottom dock, top for a top dock — set in
  // CSS), so a plain scale already makes the icon grow *away* from the edge,
  // i.e. rise out of the pill — no separate translate needed. MAX_SCALE is
  // deliberately modest so the grown icon fits inside the short window band
  // rather than being clipped at the window edge.
  // Done via direct DOM writes on mousemove rather than React state so it
  // stays smooth at 60fps — a re-render per pixel of cursor movement would not.
  const itemsRef = useRef(null);
  const rafRef = useRef(null);

  const handleDockMouseMove = useCallback((e) => {
    const clientX = e.clientX;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const container = itemsRef.current;
      if (!container) return;
      // 44px icon growing from center: at 1.3× it gains ~13px, ~6.5px each
      // side, which fits inside the row's 7px vertical padding without clipping.
      const MAX_SCALE = 1.3;
      const INFLUENCE = 90; // px either side of an icon's center that still magnifies it
      container.querySelectorAll('.dockbar-item').forEach((el) => {
        const rect = el.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const dist = Math.abs(clientX - center);
        const t = Math.max(0, 1 - dist / INFLUENCE);
        const eased = t * t * (3 - 2 * t); // smoothstep falloff
        const scale = 1 + eased * (MAX_SCALE - 1);
        el.style.transform = `scale(${scale})`;
        el.style.zIndex = eased > 0.05 ? String(5 + Math.round(eased * 10)) : '';
      });
    });
  }, []);

  const handleDockMouseLeave = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const container = itemsRef.current;
    if (!container) return;
    container.querySelectorAll('.dockbar-item').forEach((el) => {
      el.style.transform = '';
      el.style.zIndex = '';
    });
  }, []);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // Entrance is driven by state rather than a classList mutation, so it can't
  // get resurrected by an unrelated re-render — e.g. `is-active` flipping as
  // workspaceActivityService reports an app launching/closing would otherwise
  // make React rewrite the whole className string, including 'is-entering'.
  // Fades out ~550ms after mount and again each time the workspace changes.
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    setEntering(true);
    const t = setTimeout(() => setEntering(false), 550);
    return () => clearTimeout(t);
  }, [workspace?.id]);

  // Launch bounce on click — same reasoning: state-driven so a same-tick
  // is-active change (clicking an app to focus it is exactly that) can't cut
  // the animation short by rewriting className out from under a manual class.
  const [bouncingKey, setBouncingKey] = useState(null);
  const bounceTimerRef = useRef(null);
  const bounce = useCallback((key) => {
    if (bounceTimerRef.current) clearTimeout(bounceTimerRef.current);
    setBouncingKey(key);
    bounceTimerRef.current = setTimeout(() => setBouncingKey(null), 520);
  }, []);
  useEffect(() => () => { if (bounceTimerRef.current) clearTimeout(bounceTimerRef.current); }, []);

  // Bar mode has no way back to a vertical layout except backing out to full
  // window first — this jumps straight from bottom/top bar to a side dock.
  // The bar doesn't track which vertical edge was last used (dock state's
  // `side` field is overwritten by "top"/"bottom" while docked as a bar), so
  // this defaults to the right edge, same as the header's layout cycle does
  // in the same situation.
  const dockToSide = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('dock_enable', { mode: 'drawer', side: 'right' });
      await invoke('dock_expand');
    } catch (e) {
      console.error('[DockBar] dock_enable/dock_expand failed:', e);
    }
  }, []);

  return (
    <div className={`dockbar dockbar--${side}`} role="toolbar" aria-label="Workspace dock">
      <div className="dockbar-shelf">
        <button
          className="dockbar-ws-chip"
          onClick={cycleWorkspace}
          title={workspaces.length > 1 ? `${workspace?.name || 'CoolDesk'} — click to switch workspace` : workspace?.name || 'CoolDesk'}
        >
          <img src={logo} alt="" className="dockbar-ws-logo" />
          <span className="dockbar-ws-name">{workspace?.name || 'CoolDesk'}</span>
        </button>

        {(urls.length > 0 || apps.length > 0) && <span className="dockbar-sep" />}

        <div
          className="dockbar-items"
          ref={itemsRef}
          onMouseMove={handleDockMouseMove}
          onMouseLeave={handleDockMouseLeave}
        >
          {urls.map((item, idx) => {
            const sources = faviconSources(item.url);
            const avatar = letterAvatar(item.url);
            const isOpen = !!resolved.get(item);
            return (
              <button
                key={`url-${idx}`}
                className={`dockbar-item${entering ? ' is-entering' : ''}${bouncingKey === `url-${idx}` ? ' is-bouncing' : ''}${isOpen ? ' is-active' : ''}`}
                style={{ animationDelay: `${idx * 16}ms` }}
                onClick={() => { bounce(`url-${idx}`); open(item); }}
                title={`${item.title || item.url}${isOpen ? ' — open in browser' : ''}`}
              >
                {sources.length > 0 ? (
                  <img
                    src={sources[0]}
                    alt=""
                    data-fallback={sources.slice(1).join('|')}
                    onError={handleFaviconError}
                  />
                ) : null}
                <span className="dockbar-letter" style={{ display: sources.length > 0 ? 'none' : 'flex', background: avatar.color }}>
                  {avatar.letter}
                </span>
              </button>
            );
          })}
          {apps.map((app, idx) => {
            const isRunning = !!resolved.get(app);
            return (
            <button
              key={`app-${idx}`}
              className={`dockbar-item dockbar-item--app${entering ? ' is-entering' : ''}${bouncingKey === `app-${idx}` ? ' is-bouncing' : ''}${isRunning ? ' is-active' : ''}`}
              style={{ animationDelay: `${(urls.length + idx) * 16}ms` }}
              onClick={() => { bounce(`app-${idx}`); open(app); }}
              title={`${app.name || app.path}${isRunning ? ' — running (click to focus)' : ''}`}
            >
              {app.icon ? (
                <img src={app.icon} alt="" />
              ) : (
                <FontAwesomeIcon icon={appFallbackIcon(app)} className="dockbar-app-glyph" />
              )}
            </button>
            );
          })}
          {urls.length === 0 && apps.length === 0 && (
            <span className="dockbar-empty">This workspace has no links or apps yet</span>
          )}
        </div>

        <span className="dockbar-sep" />

        <div className="dockbar-controls">
          <button
            className="dockbar-ctrl"
            onClick={dockToSide}
            title="Dock to side"
          >
            <FontAwesomeIcon icon={faTableColumns} />
          </button>
          <button
            className="dockbar-ctrl"
            onClick={() => invokeDock('dock_disable')}
            title="Back to full app"
          >
            <FontAwesomeIcon icon={faUpRightAndDownLeftFromCenter} />
          </button>
          <button
            className="dockbar-ctrl"
            onClick={() => invokeDock('dock_collapse')}
            title="Hide to edge handle"
          >
            <FontAwesomeIcon icon={side === 'top' ? faChevronUp : faChevronDown} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceDockBar;
