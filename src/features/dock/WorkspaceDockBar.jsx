import { faCode, faDesktop, faFileLines, faFolderOpen, faPen, faTableColumns } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logo from '../../../logo-2.png';
import { isEditorApp, workspaceActivityService } from '../../services/workspaceActivityService';
import { openSpotlightEdit } from '../../services/spotlightEdit';
import { useCooldeskItems } from '../../shared/hooks/useCooldeskItems.js';
import { fileStack, stackLogo, useFolderIdentity } from '../../shared/hooks/useFolderIdentity.js';
import { LayoutSwitchButton } from './LayoutSwitchButton';
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

const isPlace = (app) => app.appType === 'folder' || app.appType === 'file';

const hostOf = (rawUrl) => {
  try {
    const withProto = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(withProto).hostname.replace(/^www\./, '');
  } catch { return String(rawUrl || ''); }
};

// Name + parent folder for a folder/file chip: "…/compute-mesh/web" →
// { name: 'web', parent: 'compute-mesh' }. Files keep their extension — in a
// labeled chip "notes.md" reads better than "notes".
const placeLabel = (app) => {
  const parts = String(app.path || '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  const name = app.name || parts[parts.length - 1] || app.path || '';
  const parent = parts.length > 1 ? parts[parts.length - 2] : '';
  return { name, parent };
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
  // The workspace's own links/apps, then its project's committed .cooldesk
  // items (same resolution as the workspace cards — see useCooldeskItems).
  // Linked projects become folder launchers; ones not on disk are skipped,
  // since the bar has no room for a "not found locally" state.
  const { cdLinks, cdFolders, cdFiles, cdProjects } = useCooldeskItems(workspace);
  const urls = useMemo(
    () => [...(workspace?.urls || []).filter((u) => u.status !== 'draft'), ...cdLinks],
    [workspace, cdLinks]
  );
  const apps = useMemo(() => [
    ...(workspace?.apps || []),
    ...cdProjects
      .filter((p) => p.exists && p.path)
      .map((p) => ({ name: p.name, path: p.path, appType: 'folder', _cd: true })),
    ...cdFolders,
    ...cdFiles,
  ], [workspace, cdProjects, cdFolders, cdFiles]);

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

  // Folder chips: stack logo, git branch / dirty, and a dev server running
  // from the folder — same source as the workspace cards' folder tiles.
  const folderPaths = useMemo(
    () => apps.filter((a) => a.appType === 'folder').map((a) => a.path).filter(Boolean),
    [apps]
  );
  const folderInfo = useFolderIdentity(folderPaths);

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
    isEditorApp(app) ? faCode : faDesktop;

  // Every item is a labeled chip (see the render), so there is no
  // macOS-style magnify pass any more — a wide chip scaling up reads badly;
  // chips lift slightly on hover instead (CSS).
  const itemsRef = useRef(null);

  // Hover label: the bar window hugs the pill, so a tooltip above an icon
  // would be clipped at the window edge — and the native `title` tooltip only
  // shows after the OS hover delay. Instead the workspace chip shows the
  // hovered item's name, instantly, inside the bar.
  const [hoverLabel, setHoverLabel] = useState(null);

  const handleDockMouseLeave = useCallback(() => setHoverLabel(null), []);

  // The launcher row scrolls sideways when it outgrows the screen, but a
  // mouse wheel / vertical two-finger swipe only produces deltaY, and the
  // scrollbar is hidden — so overflowed items were unreachable. Map vertical
  // wheel to horizontal scroll (a real sideways swipe still scrolls natively).
  // Non-passive so preventDefault can stop the page from eating it.
  useEffect(() => {
    const row = itemsRef.current;
    if (!row) return;
    const onWheel = (e) => {
      if (e.ctrlKey || row.scrollWidth <= row.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      row.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    };
    row.addEventListener('wheel', onWheel, { passive: false });
    return () => row.removeEventListener('wheel', onWheel);
  }, []);

  // macOS: the bar window is see-through and sized to hug the pill (like the
  // real Dock) instead of spanning the screen — a transparent full-width
  // strip would still swallow clicks meant for apps behind it. Report the
  // pill's width (+ the `.dockbar` side padding, which also leaves room for
  // edge icons to magnify) whenever it changes; the backend refits the
  // window in place. A no-op on other platforms.
  const shelfRef = useRef(null);
  const reportBarWidthRef = useRef(null);
  useEffect(() => {
    const shelf = shelfRef.current;
    if (!shelf || typeof ResizeObserver === 'undefined') return;
    let last = 0;
    const report = () => {
      // offsetWidth, not getBoundingClientRect: the entrance animation
      // scales the pill, and the layout width is what the window must fit.
      // The pill is capped at the window's width (max-width + min-width: 0),
      // so add back what the launcher row is hiding — otherwise the window
      // could never grow past its current width to fit new items. The
      // backend clamps the result to the screen; past that the row scrolls.
      const row = itemsRef.current;
      const hidden = row ? Math.max(0, row.scrollWidth - row.clientWidth) : 0;
      const width = shelf.offsetWidth + hidden + 36;
      if (width === last) return;
      last = width;
      invokeDock('dock_set_bar_content_width', { width });
    };
    reportBarWidthRef.current = report;
    const ro = new ResizeObserver(report);
    ro.observe(shelf);
    if (itemsRef.current) ro.observe(itemsRef.current);
    return () => { ro.disconnect(); reportBarWidthRef.current = null; };
  }, []);
  // Items added/removed while the pill is already at its cap don't resize
  // the pill (so the observer stays quiet) — re-measure after each change.
  useEffect(() => {
    const id = requestAnimationFrame(() => reportBarWidthRef.current?.());
    return () => cancelAnimationFrame(id);
  }, [urls, apps]);

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
      {/* Finder drops onto the bar add to the workspace it's showing (WorkspaceFileDrop). */}
      <div className="dockbar-shelf" ref={shelfRef} data-workspace-id={workspace?.id}>
        <button
          className="dockbar-ws-chip"
          onClick={cycleWorkspace}
          title={workspaces.length > 1 ? `${workspace?.name || 'CoolDesk'} — click to switch workspace` : workspace?.name || 'CoolDesk'}
        >
          <img src={logo} alt="" className="dockbar-ws-logo" />
          <span className={`dockbar-ws-name${hoverLabel ? ' is-hover-label' : ''}`}>{hoverLabel || workspace?.name || 'CoolDesk'}</span>
        </button>

        {(urls.length > 0 || apps.length > 0) && <span className="dockbar-sep" />}

        <div
          className="dockbar-items"
          ref={itemsRef}
          onMouseLeave={handleDockMouseLeave}
        >
          {/* Every launcher is the same labeled chip — art tile, name, and a
              second line (link: its domain; app: running / editor / app;
              folder: live dev-server port, else git branch; file: its parent
              folder). Icons alone were only identifiable by hovering and
              reading the workspace chip at the far left. */}
          {urls.map((item, idx) => {
            const sources = faviconSources(item.url);
            const avatar = letterAvatar(item.url);
            const isOpen = !!resolved.get(item);
            const host = hostOf(item.url);
            const title = item.title && item.title !== item.url ? item.title : host;
            const key = `url-${idx}`;
            return (
              <button
                key={key}
                className={`dockbar-place${entering ? ' is-entering' : ''}${bouncingKey === key ? ' is-bouncing' : ''}${isOpen ? ' is-active' : ''}`}
                style={{ animationDelay: `${idx * 16}ms` }}
                onClick={() => { bounce(key); open(item); }}
                onMouseEnter={() => setHoverLabel(item.title || item.url)}
                title={item.url}
                aria-label={`${title}${isOpen ? ' — open in browser' : ''}`}
              >
                <span className="dockbar-place-tile">
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
                </span>
                <span className="dockbar-place-text">
                  <span className="dockbar-place-name">{title}</span>
                  {title !== host && <span className="dockbar-place-parent">{host}</span>}
                </span>
              </button>
            );
          })}

          {apps.some((a) => !isPlace(a)) && urls.length > 0 && <span className="dockbar-sep dockbar-sep--inner" />}
          {apps.map((app, idx) => {
            if (isPlace(app)) return null;
            const isRunning = !!resolved.get(app);
            const key = `app-${idx}`;
            const label = app.name || app.path;
            return (
              <button
                key={key}
                className={`dockbar-place${entering ? ' is-entering' : ''}${bouncingKey === key ? ' is-bouncing' : ''}${isRunning ? ' is-active' : ''}`}
                style={{ animationDelay: `${(urls.length + idx) * 16}ms` }}
                onClick={() => { bounce(key); open(app); }}
                onMouseEnter={() => setHoverLabel(label)}
                title={app.path || label}
                aria-label={`${label}${isRunning ? ' — running (click to focus)' : ''}`}
              >
                <span className="dockbar-place-tile">
                  {app.icon ? (
                    <img src={app.icon} alt="" />
                  ) : (
                    <FontAwesomeIcon icon={appFallbackIcon(app)} />
                  )}
                </span>
                <span className="dockbar-place-text">
                  <span className="dockbar-place-name">{label}</span>
                  <span className={`dockbar-place-parent${isRunning ? ' is-running' : ''}`}>
                    {isRunning ? 'Running' : isEditorApp(app) ? 'Editor' : 'App'}
                  </span>
                </span>
              </button>
            );
          })}

          {apps.some(isPlace) && (urls.length > 0 || apps.some((a) => !isPlace(a))) && (
            <span className="dockbar-sep dockbar-sep--inner" />
          )}
          {apps.map((app, idx) => {
            if (!isPlace(app)) return null;
            const isFile = app.appType === 'file';
            const isOpen = !!resolved.get(app);
            const { name, parent } = placeLabel(app);
            const info = isFile
              ? { stack: fileStack(app.path || app.name), branch: null, dirty: false, ports: [] }
              : folderInfo(app.path);
            const logoArt = stackLogo(info.stack);
            const port = info.ports[0];
            const key = `app-${idx}`;
            return (
              <button
                key={key}
                className={`dockbar-place${entering ? ' is-entering' : ''}${bouncingKey === key ? ' is-bouncing' : ''}${isOpen ? ' is-active' : ''}${port ? ' is-live' : ''}`}
                style={{ animationDelay: `${(urls.length + idx) * 16}ms` }}
                onClick={() => { bounce(key); open(app); }}
                onMouseEnter={() => setHoverLabel(app.path || name)}
                title={app.path || name}
                aria-label={`${name}${parent ? ` in ${parent}` : ''}${port ? ` — dev server on :${port}` : ''}`}
              >
                <span className="dockbar-place-tile">
                  {!isFile && <span className="dockbar-place-tab" aria-hidden="true" />}
                  {logoArt && (
                    <img
                      className={logoArt.invert ? 'is-inverted' : ''}
                      src={logoArt.src}
                      alt=""
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextSibling.style.display = 'inline-block';
                      }}
                    />
                  )}
                  <FontAwesomeIcon
                    icon={isFile ? faFileLines : faFolderOpen}
                    style={{ display: logoArt ? 'none' : 'inline-block' }}
                  />
                </span>
                <span className="dockbar-place-text">
                  <span className="dockbar-place-name">{name}</span>
                  {port ? (
                    // A span, not a nested <button> (invalid inside the chip);
                    // stopPropagation keeps the chip's own open-folder click off.
                    <span
                      className="dockbar-place-parent is-live"
                      role="link"
                      onClick={(e) => {
                        e.stopPropagation();
                        workspaceActivityService.activate({ url: `http://localhost:${port}`, title: `${name} :${port}` });
                      }}
                      title={`Open localhost:${port}`}
                    >
                      <i />:{port}{info.ports.length > 1 ? ` +${info.ports.length - 1}` : ''}
                    </span>
                  ) : info.branch ? (
                    <span className="dockbar-place-parent is-branch" title={info.dirty ? 'Uncommitted changes' : undefined}>
                      {info.dirty && <i />}{info.branch}
                    </span>
                  ) : (
                    parent && <span className="dockbar-place-parent">{parent}</span>
                  )}
                </span>
              </button>
            );
          })}
          {urls.length === 0 && apps.length === 0 && (
            <span className="dockbar-empty">This workspace has no links or apps yet</span>
          )}
        </div>

        <span className="dockbar-sep" />

        <div className="dockbar-controls">
          {/* The bar is one row tall with no room for an editor, so editing —
              renaming, adding links/apps/folders, todos, notes — happens in the
              spotlight window's /edit-workspace mode for this workspace. */}
          {workspace && (
            <button
              className="dockbar-ctrl"
              onClick={() => openSpotlightEdit(workspace)}
              title={`Edit ${workspace.name || 'workspace'} — add links, apps, notes`}
              aria-label="Edit workspace"
            >
              <FontAwesomeIcon icon={faPen} />
            </button>
          )}
          <button
            className="dockbar-ctrl"
            onClick={dockToSide}
            title="Dock to side"
          >
            <FontAwesomeIcon icon={faTableColumns} />
          </button>
          {/* From the bar, the layout cycle's next step is the full window —
              this is the "back to full app" control. No manual hide button:
              the bar already auto-collapses to its edge handle when the
              cursor leaves it. */}
          <LayoutSwitchButton className="dockbar-ctrl" />
        </div>
      </div>
    </div>
  );
}

export default WorkspaceDockBar;
