import {
  faArrowLeft, faArrowRight, faArrowUp, faBars, faCheck, faChevronRight, faClockRotateLeft, faCopy,
  faExternalLinkAlt, faFile, faFileAudio, faFileCode, faFileExcel, faFileImage, faFilePdf,
  faEye, faEyeSlash, faFileVideo, faFileZipper, faFolder, faHardDrive, faHouse, faList, faSearch,
  faTableCellsLarge, faThumbtack, faTimes, faPlay, faDiagramProject, faCheckDouble, faLink,
  faLinkSlash, faPlus, faSpinner, faPowerOff, faSync
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchCooldesk, linkCooldeskProject } from '../../services/cooldeskService.js';
import { getPreviewItem } from '../../utils/filePreviewKind.js';
import '../../styles/fileManager.css';

// Lazy for the same reason GlobalSpotlight defers it — Prism + its ~20
// language grammars are real weight, not worth taxing every folder open for.
const PreviewPane = lazy(() => import('../spotlight/PreviewPane'));

/** List a directory — Electron shim if present, otherwise the Tauri command. */
async function listDirRaw(path) {
  if (window.electronAPI?.listDir) return window.electronAPI.listDir(path);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('list_dir', { path });
}

/** Hand a path to the OS (opens a file with its default app, a folder in Explorer). */
async function openWithSystem(path) {
  if (window.electronAPI?.openFolder) return window.electronAPI.openFolder(path);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('open_folder', { path });
}

// Directory cache shared across mounts: navigating back to a folder you've
// already seen is instant, and hovering a folder warms it before you click.
const dirCache = new Map();   // path -> entries[]
const inFlight = new Map();   // path -> Promise<entries[]>

function listDir(path) {
  if (inFlight.has(path)) return inFlight.get(path);
  const p = listDirRaw(path)
    .then(items => {
      const entries = Array.isArray(items) ? items : [];
      dirCache.set(path, entries);
      inFlight.delete(path);
      return entries;
    })
    .catch(err => {
      inFlight.delete(path);
      throw err;
    });
  inFlight.set(path, p);
  return p;
}

// Resolved `.cooldesk/` workspaces, keyed by folder — misses are cached too, so
// walking a deep tree doesn't re-probe the same ancestors on every navigation.
const projectCache = new Map();

/**
 * Find the `.cooldesk/` project that owns a folder by walking up from it.
 * Returns the workspace (with its root path) or null. Bounded to 8 levels, so a
 * folder outside any project costs a handful of cheap localhost calls, once.
 */
async function findProject(startPath) {
  let p = startPath;
  const walked = [];
  for (let i = 0; i < 8 && p; i++) {
    if (projectCache.has(p)) {
      const hit = projectCache.get(p);
      // Propagate the answer back down the path we walked, so siblings resolve
      // in a single lookup next time.
      walked.forEach(w => projectCache.set(w, hit));
      return hit;
    }
    walked.push(p);
    const cd = await fetchCooldesk(p);
    if (cd?.exists) {
      walked.forEach(w => projectCache.set(w, cd));
      return cd;
    }
    p = parentOf(p);
  }
  walked.forEach(w => projectCache.set(w, null));
  return null;
}

/**
 * Remember every `.cooldesk/` project we resolve — plus the group members it
 * names — so the sidebar can offer them from anywhere, not only from inside the
 * project. Without this, a project's links are reachable only once you have
 * already navigated into it, which is backwards: the sidebar is how you get there.
 */
function rememberProjects(cd) {
  if (!cd?.path) return loadJSON(PROJECTS_KEY, []);
  const known = loadJSON(PROJECTS_KEY, []);
  const byPath = new Map(known.map(p => [p.path.toLowerCase(), p]));
  const add = (entry) => {
    if (!entry?.path) return;
    const key = entry.path.toLowerCase();
    byPath.set(key, { ...(byPath.get(key) || {}), ...entry });
  };
  add({
    path: cd.path,
    name: cd.project?.name || baseName(cd.path),
    group: cd.group?.name || null,
    exists: true,
  });
  if (cd.hub?.path) {
    add({
      path: cd.hub.path,
      name: cd.hub.name ? `${cd.hub.name} (hub)` : baseName(cd.hub.path),
      group: cd.hub.name || null,
      exists: cd.hub.exists !== false,
    });
  }
  (cd.members || []).forEach(m => add({
    path: m.path,
    name: m.project?.name || m.name || baseName(m.path),
    group: cd.group?.name || null,
    exists: m.exists !== false,
  }));
  const next = [...byPath.values()];
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(next)); } catch { /* quota */ }
  return next;
}

const SEP = /[\\/]/;
const PIN_KEY = 'cooldesk.fm.pinned';
const VIEW_KEY = 'cooldesk.fm.view';
const HIDDEN_KEY = 'cooldesk.fm.showHidden';
const PROJECTS_KEY = 'cooldesk.fm.projects';
const PREVIEW_WIDTH_KEY = 'cooldesk.fm.previewWidth';
const PREVIEW_WIDTH_DEFAULT = 320;
const PREVIEW_WIDTH_MIN = 240;
const PREVIEW_WIDTH_MAX = 640;
// The command run to scaffold a `.cooldesk/` workspace in the folder you're
// browsing. It drives the plugin's own `/cd-init` rather than writing the
// folder here, so the manifest is authored by the thing that owns the format.
// Override in localStorage if your CLI lives elsewhere.
const INIT_CMD_KEY = 'cooldesk.fm.initCommand';
const DEFAULT_INIT_CMD = 'claude "/cd-init"';

// Markers that say "this folder is a project root" — we only offer to set up a
// workspace where one plausibly belongs, instead of nagging in every folder.
const PROJECT_MARKERS = new Set([
  '.git', 'package.json', 'cargo.toml', 'go.mod', 'pyproject.toml',
  'pom.xml', 'build.gradle', 'gemfile', 'composer.json', 'requirements.txt',
]);

function baseName(p) {
  const parts = String(p).split(SEP).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/** Parent directory, or null when already at a root ("C:\", "/"). */
function parentOf(p) {
  if (!p) return null;
  const isWin = p.includes('\\');
  const parts = p.split(SEP).filter(Boolean);
  if (parts.length <= 1) return null;
  parts.pop();
  return isWin ? parts.join('\\') + (parts.length === 1 ? '\\' : '') : '/' + parts.join('/');
}

/** Breadcrumb segments: [{ label, path }] from root to the current folder. */
function crumbsOf(p) {
  if (!p) return [];
  const isWin = p.includes('\\');
  const parts = p.split(SEP).filter(Boolean);
  return parts.map((label, i) => ({
    label,
    path: isWin
      ? parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '')
      : '/' + parts.slice(0, i + 1).join('/')
  }));
}

function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

const EXT_ICONS = [
  [/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i, faFileImage, '#38BDF8'],
  [/\.(mp4|mkv|mov|avi|webm|m4v)$/i, faFileVideo, '#F472B6'],
  [/\.(mp3|wav|flac|m4a|ogg)$/i, faFileAudio, '#A78BFA'],
  [/\.pdf$/i, faFilePdf, '#F87171'],
  [/\.(zip|rar|7z|tar|gz|xz)$/i, faFileZipper, '#FBBF24'],
  [/\.(xlsx?|csv|tsv)$/i, faFileExcel, '#4ADE80'],
  [/\.(js|jsx|ts|tsx|rs|py|go|java|c|cpp|h|css|html|json|toml|yml|yaml|sh|ps1|md)$/i, faFileCode, '#60A5FA'],
];

function iconFor(entry) {
  if (entry.is_dir) return [faFolder, '#FACC15'];
  const name = baseName(entry.path);
  for (const [re, icon, color] of EXT_ICONS) if (re.test(name)) return [icon, color];
  return [faFile, '#94A3B8'];
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

/**
 * FileManager — the in-app folder browser. Opens as a modal over the current
 * view so browsing never bounces the user out to Explorer; the OS file manager
 * stays one click away for anything this can't do (rename, copy, properties).
 *
 * Navigation is single-click everywhere (folders enter, files open) — this is a
 * launcher, not an editor, so there is nothing to "select before acting on".
 * Hovering a folder prefetches it, so the click almost always lands on cached
 * contents. Keyboard drives the same moves: arrows + Enter, Backspace for the
 * parent, Ctrl+L to type a path, any printable key to filter.
 */
export function FileManager({ isOpen, initialPath, places = [], onClose }) {
  const [path, setPath] = useState(initialPath || '');
  // Navigation history — index points at the current entry, so back/forward
  // are just moves along this array (same model as a browser).
  const [history, setHistory] = useState(() => (initialPath ? [initialPath] : []));
  const [histIndex, setHistIndex] = useState(0);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [cursor, setCursor] = useState(0);       // keyboard/hover highlight index
  const [copied, setCopied] = useState(false);
  const [sysPlaces, setSysPlaces] = useState([]);
  const [pinned, setPinned] = useState(() => loadJSON(PIN_KEY, []));
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'list');
  // Dot-folders (.cooldesk, .git, .claude …) are shown by default — on a dev
  // machine they are usually the reason you opened the folder at all.
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem(HIDDEN_KEY) !== 'false');
  const [editingPath, setEditingPath] = useState(null); // string while the address bar is in edit mode
  const [crumbMenu, setCrumbMenu] = useState(null);     // { path, items, x } sibling picker
  const [showRecent, setShowRecent] = useState(false);
  // The Places/linked-projects sidebar (`.fm-sidebar`) is CSS-hidden below
  // 720px — no room for a fixed side panel at sidebar-dock widths. This
  // toggles it open as a temporary overlay instead, via the `fm-places-toggle`
  // button that CSS only shows at that same breakpoint (see fileManager.css).
  const [placesOpen, setPlacesOpen] = useState(false);
  // Screen coords for whichever popup is open. The bars that host the triggers
  // scroll horizontally (`overflow-x: auto`), which clips any absolutely
  // positioned child — so menus are rendered fixed, anchored to the trigger.
  const [menuPos, setMenuPos] = useState(null);
  const [childCounts, setChildCounts] = useState({});   // path -> item count, filled by prefetch
  const [project, setProject] = useState(null);         // owning .cooldesk/ workspace, if any
  const [ranCommand, setRanCommand] = useState(null);   // id of the command just launched
  const [knownProjects, setKnownProjects] = useState(() => loadJSON(PROJECTS_KEY, []));
  const [showLinkMenu, setShowLinkMenu] = useState(false);
  const [linking, setLinking] = useState(null);        // path being linked/unlinked
  const [linkError, setLinkError] = useState(null);
  const [candidateHubs, setCandidateHubs] = useState({}); // path -> group name if it's a hub
  const [initRan, setInitRan] = useState(false);        // /cd-init launched, awaiting recheck
  const [listeningPorts, setListeningPorts] = useState([]); // live TCP listeners
  const [confirmKillPort, setConfirmKillPort] = useState(null);
  const [killingPort, setKillingPort] = useState(null);
  const filterRef = useRef(null);
  const listRef = useRef(null);
  const pathInputRef = useRef(null);
  const hoverTimer = useRef(null);

  // Re-anchor whenever the modal is opened on a different folder.
  useEffect(() => {
    if (!isOpen || !initialPath) return;
    setPath(initialPath);
    setHistory([initialPath]);
    setHistIndex(0);
    setFilter('');
    setCursor(0);
  }, [isOpen, initialPath]);

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);
  useEffect(() => { localStorage.setItem(HIDDEN_KEY, String(showHidden)); }, [showHidden]);

  // Sidebar "Places" (Home/Desktop/Downloads/… + drives) — desktop only.
  useEffect(() => {
    if (!isOpen || sysPlaces.length) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke('get_user_places');
        if (Array.isArray(list)) setSysPlaces(list);
      } catch { /* not running under Tauri — sidebar falls back to popular folders */ }
    })();
  }, [isOpen, sysPlaces.length]);

  // Load the current folder. Cached folders paint immediately and are then
  // revalidated in the background, so navigation never flashes a spinner twice.
  useEffect(() => {
    if (!isOpen || !path) return;
    let cancelled = false;
    const cached = dirCache.get(path);
    if (cached) {
      setEntries(cached);
      setError(null);
      setLoading(false);
    } else {
      setEntries([]);
      setLoading(true);
    }
    listDir(path)
      .then(items => {
        if (cancelled) return;
        setEntries(items);
        setError(null);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setEntries([]);
        setError(String(err?.message || err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, path]);

  // Resolve the `.cooldesk/` project that owns the folder being viewed, so its
  // commands travel with you as you browse into subfolders.
  useEffect(() => {
    if (!isOpen || !path) return;
    let cancelled = false;
    findProject(path)
      .then(cd => {
        if (cancelled) return;
        setProject(cd);
        if (cd) setKnownProjects(rememberProjects(cd));
      })
      .catch(() => { if (!cancelled) setProject(null); });
    return () => { cancelled = true; };
  }, [isOpen, path]);

  // Seed the registry from the folders already in the sidebar. Each probe is a
  // single shallow lookup (no ancestor walk) and `projectCache` remembers the
  // misses, so this costs one pass per session — and means a project shows up
  // in the sidebar before you have ever browsed into it.
  useEffect(() => {
    if (!isOpen) return;
    const candidates = [...places, ...sysPlaces, ...loadJSON(PIN_KEY, [])]
      .map(f => f.path)
      .filter(p => p && !projectCache.has(p));
    if (!candidates.length) return;
    let cancelled = false;
    (async () => {
      for (const candidate of candidates) {
        if (cancelled) return;
        try {
          const cd = await fetchCooldesk(candidate);
          projectCache.set(candidate, cd?.exists ? cd : null);
          if (cd?.exists && !cancelled) setKnownProjects(rememberProjects(cd));
        } catch { /* sidecar down — try again next open */ }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, places, sysPlaces]);

  // Linked projects: the current project's `group.json` members (star model —
  // the hub lists them, the sidecar resolves their relative paths and reports
  // whether they exist here) merged with every project seen before. The merge
  // is what makes links usable from Downloads or any other non-project folder.
  const linked = useMemo(() => {
    const byPath = new Map();
    knownProjects.forEach(p => p.path && byPath.set(p.path.toLowerCase(), p));
    (project?.members || []).forEach(m => {
      if (!m.path) return;
      byPath.set(m.path.toLowerCase(), {
        path: m.path,
        name: m.project?.name || m.name || baseName(m.path),
        exists: m.exists !== false,
        // Actual group members can be unlinked; registry-only entries can't.
        member: true,
      });
    });
    return [...byPath.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [knownProjects, project]);

  // Projects we know about that aren't in this group yet — the Link menu.
  const linkCandidates = useMemo(() => {
    if (!project?.path) return [];
    const taken = new Set([
      project.path.toLowerCase(),
      ...(project.members || []).map(m => (m.path || '').toLowerCase()),
    ]);
    return knownProjects
      .filter(p => p.path && !taken.has(p.path.toLowerCase()) && p.exists !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [knownProjects, project]);

  // When the link menu opens, find out which candidates are already hubs — that
  // decides whether we add them to this group or join theirs.
  useEffect(() => {
    if (!showLinkMenu) return;
    let cancelled = false;
    (async () => {
      for (const c of linkCandidates) {
        if (cancelled) return;
        if (candidateHubs[c.path] !== undefined) continue;
        const cd = await fetchCooldesk(c.path);
        if (cancelled) return;
        setCandidateHubs(prev => ({ ...prev, [c.path]: cd?.group?.name || null }));
      }
    })();
    return () => { cancelled = true; };
  }, [showLinkMenu, linkCandidates, candidateHubs]);

  // Poll the OS for listening ports so declared services show real state. Only
  // runs while a project that actually declares services is on screen, so an
  // ordinary folder costs nothing.
  const hasServices = (project?.services?.length || 0) > 0;
  useEffect(() => {
    if (!isOpen || !hasServices) return;
    let cancelled = false;
    const read = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke('list_listening_ports');
        if (!cancelled) setListeningPorts(Array.isArray(list) ? list : []);
      } catch { /* not Tauri, or netstat unavailable — services render as unknown */ }
    };
    read();
    const timer = setInterval(read, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isOpen, hasServices]);

  const navigate = useCallback((next) => {
    if (!next) return;
    setHistory(prev => [...prev.slice(0, histIndex + 1), next]);
    setHistIndex(i => i + 1);
    setPath(next);
    setFilter('');
    setCursor(0);
    setCrumbMenu(null);
    setShowRecent(false);
    setPlacesOpen(false);
    setEditingPath(null);
    setInitRan(false);
  }, [histIndex]);

  const goBack = useCallback(() => {
    if (histIndex <= 0) return;
    setHistIndex(i => i - 1);
    setPath(history[histIndex - 1]);
    setCursor(0);
  }, [histIndex, history]);

  const goForward = useCallback(() => {
    if (histIndex >= history.length - 1) return;
    setHistIndex(i => i + 1);
    setPath(history[histIndex + 1]);
    setCursor(0);
  }, [histIndex, history]);

  const goUp = useCallback(() => {
    const up = parentOf(path);
    if (up) navigate(up);
  }, [path, navigate]);

  const hiddenCount = useMemo(() => entries.filter(e => e.hidden).length, [entries]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const pool = showHidden ? entries : entries.filter(e => !e.hidden);
    const rows = q
      ? pool.filter(e => baseName(e.path).toLowerCase().includes(q))
      : pool.slice();
    const { key, dir } = sort;
    rows.sort((a, b) => {
      // Folders always lead, regardless of the active sort.
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let cmp;
      if (key === 'size') cmp = (a.size || 0) - (b.size || 0);
      else if (key === 'date') cmp = String(a.date).localeCompare(String(b.date));
      else cmp = baseName(a.path).toLowerCase().localeCompare(baseName(b.path).toLowerCase());
      return cmp * dir;
    });
    return rows;
  }, [entries, filter, sort, showHidden]);

  // Keep the cursor inside the (filterable) list at all times.
  const safeCursor = Math.min(cursor, Math.max(0, visible.length - 1));
  const current = visible[safeCursor];

  // Quick-Look-style preview for whatever's currently keyboard/hover-
  // highlighted (`cursor` already tracks that for both — see the row's
  // onMouseEnter below). Deliberately driven off the highlight, not click:
  // unlike GlobalSpotlight, a click here already opens the entry (folders
  // navigate, files launch externally), so there's no separate "select"
  // state to hang a preview off without changing that click behavior.
  const previewItem = useMemo(() => {
    if (!current || current.is_dir) return null;
    return getPreviewItem(current.path);
  }, [current]);

  // Drag-resizable preview column width. Dragging the handle on its left
  // edge shrinks/grows `.fm-main` in exchange — the handle itself sits
  // outside React's render loop for the drag (window-level mousemove/mouseup,
  // not state-driven) so it stays smooth at 60fps; only the final width on
  // mouseup gets persisted, not every intermediate tick.
  const [previewWidth, setPreviewWidth] = useState(() => {
    const stored = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    return stored >= PREVIEW_WIDTH_MIN && stored <= PREVIEW_WIDTH_MAX ? stored : PREVIEW_WIDTH_DEFAULT;
  });
  const previewWidthRef = useRef(previewWidth);
  useEffect(() => { previewWidthRef.current = previewWidth; }, [previewWidth]);

  const startPreviewResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = previewWidthRef.current;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';

    const onMove = (moveEvent) => {
      // Preview sits right of the handle — dragging left (mouse X decreasing)
      // widens it.
      const delta = startX - moveEvent.clientX;
      setPreviewWidth(Math.min(PREVIEW_WIDTH_MAX, Math.max(PREVIEW_WIDTH_MIN, startWidth + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
      localStorage.setItem(PREVIEW_WIDTH_KEY, String(previewWidthRef.current));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const openEntry = useCallback((entry) => {
    if (!entry) return;
    if (entry.is_dir) navigate(entry.path);
    else openWithSystem(entry.path).catch(err => console.error('[FileManager] open failed:', err));
  }, [navigate]);

  // Warm a folder's contents (and its item count) shortly after hover, so the
  // click that follows renders instantly.
  const prefetch = useCallback((entry) => {
    if (!entry?.is_dir) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      if (dirCache.has(entry.path)) {
        setChildCounts(c => (c[entry.path] === undefined ? { ...c, [entry.path]: dirCache.get(entry.path).length } : c));
        return;
      }
      listDir(entry.path)
        .then(items => setChildCounts(c => ({ ...c, [entry.path]: items.length })))
        .catch(() => { });
    }, 120);
  }, []);

  const copyPath = useCallback(() => {
    navigator.clipboard?.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => { });
  }, [path]);

  // Run a project command in its own console, rooted at the project folder
  // (not the folder you happen to be browsing).
  const runCommand = useCallback(async (cmd) => {
    if (!cmd?.run || !project?.path) return;
    setRanCommand(cmd.id || cmd.run);
    setTimeout(() => setRanCommand(null), 1600);
    try {
      if (window.electronAPI?.runCommand) {
        await window.electronAPI.runCommand(cmd.run, project.path);
      } else {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('run_project_command', { command: cmd.run, cwd: project.path });
      }
    } catch (err) {
      console.error('[FileManager] command failed:', cmd.run, err);
    }
  }, [project]);

  // Link another project into this one's group (or drop it). The sidecar owns
  // the write; we just refresh from the workspace it returns and drop the
  // resolver caches, since group membership just changed underneath them.
  const toggleLink = useCallback(async (memberPath, unlink = false, joinTheirGroup = false) => {
    if (!project?.path || !memberPath) return;
    setLinking(memberPath);
    setLinkError(null);
    // Direction matters in a star: linking *into* an existing group means that
    // project stays the hub and this one becomes the member. Getting this
    // backwards would fork a second competing group.
    const [hub, member] = joinTheirGroup
      ? [memberPath, project.path]
      : [project.path, memberPath];
    const res = await linkCooldeskProject(hub, member, { unlink });
    setLinking(null);
    if (!res.ok) {
      setLinkError(res.error);
      return;
    }
    projectCache.clear();
    setShowLinkMenu(false);
    if (res.cooldesk) setKnownProjects(rememberProjects(res.cooldesk));
    // When we joined someone else's group the response describes *their*
    // project, not the one being browsed — re-resolve so the bar keeps showing
    // where we actually are (now with a back-pointer to the hub).
    if (joinTheirGroup) {
      const mine = await findProject(project.path);
      setProject(mine);
      if (mine) setKnownProjects(rememberProjects(mine));
    } else if (res.cooldesk) {
      setProject(res.cooldesk);
    }
  }, [project]);

  // Kill whatever holds a declared service's port. Two-step like the dev-servers
  // panel: the first click arms, the second within 3s actually kills.
  const killService = useCallback(async (port) => {
    if (!port) return;
    if (confirmKillPort !== port) {
      setConfirmKillPort(port);
      setTimeout(() => setConfirmKillPort(p => (p === port ? null : p)), 3000);
      return;
    }
    setConfirmKillPort(null);
    setKillingPort(port);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('kill_process_on_port', { port });
      setListeningPorts(prev => prev.filter(p => p.port !== port));
      // Re-read shortly after: the port takes a moment to actually free up.
      setTimeout(async () => {
        try {
          const { invoke: inv } = await import('@tauri-apps/api/core');
          const list = await inv('list_listening_ports');
          setListeningPorts(Array.isArray(list) ? list : []);
        } catch { /* ignore */ }
      }, 600);
    } catch (error) {
      console.error('[FileManager] kill_process_on_port failed:', port, error);
    } finally {
      setKillingPort(null);
    }
  }, [confirmKillPort]);

  // Scaffold a workspace in the folder being browsed by running the plugin's
  // `/cd-init` in a console rooted there. The plugin asks its questions and
  // writes `.cooldesk/`; we just re-check afterwards.
  const runInit = useCallback(async () => {
    const command = localStorage.getItem(INIT_CMD_KEY) || DEFAULT_INIT_CMD;
    try {
      if (window.electronAPI?.runCommand) {
        await window.electronAPI.runCommand(command, path);
      } else {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('run_project_command', { command, cwd: path });
      }
      setInitRan(true);
    } catch (error) {
      console.error('[FileManager] cd-init failed to launch:', error);
    }
  }, [path]);

  // Re-resolve after an external tool wrote `.cooldesk/` behind our back.
  const recheckProject = useCallback(async () => {
    projectCache.clear();
    const cd = await findProject(path);
    setProject(cd);
    if (cd) {
      setKnownProjects(rememberProjects(cd));
      setInitRan(false);
    }
  }, [path]);

  const openService = useCallback(async (svc) => {
    const url = svc?.url || (svc?.port ? `http://localhost:${svc.port}` : null);
    if (!url) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_url', { url });
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }, []);

  const togglePin = useCallback((folder) => {
    setPinned(prev => {
      const exists = prev.some(f => f.path.toLowerCase() === folder.path.toLowerCase());
      const next = exists
        ? prev.filter(f => f.path.toLowerCase() !== folder.path.toLowerCase())
        : [...prev, { name: folder.name || baseName(folder.path), path: folder.path }];
      localStorage.setItem(PIN_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isPinned = useMemo(
    () => pinned.some(f => f.path.toLowerCase() === (path || '').toLowerCase()),
    [pinned, path]
  );

  // Anchor a popup under its trigger, clamped to stay on screen.
  const anchorTo = useCallback((el) => {
    const r = el.getBoundingClientRect();
    const width = 260;
    setMenuPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: r.bottom + 6,
    });
  }, []);

  // Sibling picker: the chevron after a breadcrumb lists that folder's
  // subfolders, so you can hop sideways without walking up and back down.
  const openCrumbMenu = useCallback((crumbPath, e) => {
    e.stopPropagation();
    if (crumbMenu?.path === crumbPath) { setCrumbMenu(null); return; }
    anchorTo(e.currentTarget);
    setShowRecent(false);
    setShowLinkMenu(false);
    setCrumbMenu({ path: crumbPath, items: null });
    listDir(crumbPath)
      .then(items => setCrumbMenu(m => (m?.path === crumbPath ? { ...m, items: items.filter(i => i.is_dir).slice(0, 40) } : m)))
      .catch(() => setCrumbMenu(m => (m?.path === crumbPath ? { ...m, items: [] } : m)));
  }, [crumbMenu, anchorTo]);

  // Most recent distinct locations, newest first (drives the history dropdown).
  const recentPaths = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const p = history[i];
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      if (out.length >= 10) break;
    }
    return out;
  }, [history]);

  // Grid view wraps, so ←/→ move by one and ↑/↓ by a full row.
  const gridCols = 5;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      const inFilter = document.activeElement === filterRef.current;
      const inPath = document.activeElement === pathInputRef.current;
      // While the modal is open it owns the keyboard: every key it acts on is
      // stopped here so app-level global shortcuts don't fire underneath it.
      // Without this, Alt+←/→ also flips the workspace/saved tabs (App.jsx) and
      // "/" is stolen by the spotlight's focus-search handler.
      const take = (preventDefault = true) => {
        if (preventDefault) e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      if (e.key === 'Escape') {
        take();
        if (crumbMenu || showRecent || showLinkMenu) {
          setCrumbMenu(null); setShowRecent(false); setShowLinkMenu(false); return;
        }
        if (editingPath !== null) { setEditingPath(null); return; }
        if (filter) { setFilter(''); return; }
        onClose?.();
        return;
      }
      if (inPath) return; // the address bar owns its own keys while focused
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        take();
        setEditingPath(path);
        setTimeout(() => pathInputRef.current?.select(), 0);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        take();
        filterRef.current?.focus();
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') { take(); goBack(); return; }
      if (e.altKey && e.key === 'ArrowRight') { take(); goForward(); return; }
      if ((e.altKey && e.key === 'ArrowUp') || (e.key === 'Backspace' && !inFilter)) {
        take(); goUp(); return;
      }
      const step = (delta) => {
        take();
        if (!visible.length) return;
        setCursor(c => Math.max(0, Math.min(visible.length - 1, Math.min(c, visible.length - 1) + delta)));
      };
      if (e.key === 'ArrowDown') return step(view === 'grid' ? gridCols : 1);
      if (e.key === 'ArrowUp') return step(view === 'grid' ? -gridCols : -1);
      if (view === 'grid' && e.key === 'ArrowRight' && !inFilter) return step(1);
      if (view === 'grid' && e.key === 'ArrowLeft' && !inFilter) return step(-1);
      if (e.key === 'Home') return step(-visible.length);
      if (e.key === 'End') return step(visible.length);
      if (e.key === 'Enter') {
        if (!visible.length) return;
        take();
        openEntry(visible[Math.min(cursor, visible.length - 1)]);
        return;
      }
      if (!inFilter && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Let the character itself through into the input we're focusing, but
        // don't let anyone else claim it as a shortcut.
        take(false);
        filterRef.current?.focus();
      }
    };
    // Capture phase: we must see the key before the app-level listeners that
    // were registered earlier on window.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, filter, visible, cursor, view, editingPath, crumbMenu, showRecent, showLinkMenu,
      path, onClose, goBack, goForward, goUp, openEntry]);

  // Keep the highlighted row scrolled into view as the cursor moves.
  useEffect(() => {
    listRef.current?.querySelectorAll('.fm-item')[safeCursor]?.scrollIntoView({ block: 'nearest' });
  }, [safeCursor]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  if (!isOpen) return null;

  const crumbs = crumbsOf(path);
  // Offer setup only where a project plausibly lives — a repo/manifest marker in
  // the folder we already listed, so this costs no extra I/O.
  const looksLikeProjectRoot = !project && entries.some(e =>
    PROJECT_MARKERS.has(baseName(e.path).toLowerCase()));
  const sidebar = [
    { title: project?.group?.name || 'Projects', items: linked, kind: 'linked' },
    { title: 'Pinned', items: pinned },
    { title: 'Places', items: sysPlaces },
    { title: 'Popular', items: places },
  ].filter(s => s.items?.length);

  const SortHeader = ({ label, k, className }) => (
    <button
      className={`fm-col-head ${className || ''} ${sort.key === k ? 'active' : ''}`}
      onClick={() => setSort(s => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: 1 }))}
    >
      {label}
      {sort.key === k && <span className="fm-sort-arrow">{sort.dir === 1 ? '▲' : '▼'}</span>}
    </button>
  );

  return createPortal(
    <div className="fm-backdrop" onClick={onClose}>
      <div className="fm-window" onClick={(e) => { e.stopPropagation(); setCrumbMenu(null); setShowRecent(false); setPlacesOpen(false); }}>
        {/* Toolbar: history + address bar + filter */}
        <div className="fm-toolbar">
          <div className="fm-nav">
            {/* Only visible below the 720px breakpoint (see fileManager.css) —
                `.fm-sidebar` (Places/linked projects) is CSS-hidden there for
                lack of room, so this is the only way left to reach it. */}
            <button
              className={`fm-icon-btn fm-places-toggle ${placesOpen ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setPlacesOpen(v => !v); setCrumbMenu(null); setShowRecent(false); }}
              title="Places"
            >
              <FontAwesomeIcon icon={faBars} />
            </button>
            <button className="fm-icon-btn" onClick={goBack} disabled={histIndex <= 0} title="Back (Alt+←)">
              <FontAwesomeIcon icon={faArrowLeft} />
            </button>
            <button className="fm-icon-btn" onClick={goForward} disabled={histIndex >= history.length - 1} title="Forward (Alt+→)">
              <FontAwesomeIcon icon={faArrowRight} />
            </button>
            <button className="fm-icon-btn" onClick={goUp} disabled={!parentOf(path)} title="Up one folder (Backspace)">
              <FontAwesomeIcon icon={faArrowUp} />
            </button>
            <div className="fm-menu-anchor">
              <button
                className={`fm-icon-btn ${showRecent ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  anchorTo(e.currentTarget);
                  setShowRecent(v => !v);
                  setCrumbMenu(null);
                  setShowLinkMenu(false);
                }}
                title="Recent locations"
              >
                <FontAwesomeIcon icon={faClockRotateLeft} />
              </button>
              {showRecent && (
                <div className="fm-menu" style={menuPos} onClick={(e) => e.stopPropagation()}>
                  {recentPaths.map(p => (
                    <button key={p} className={`fm-menu-item ${p === path ? 'current' : ''}`} onClick={() => navigate(p)} title={p}>
                      <FontAwesomeIcon icon={faFolder} className="fm-menu-icon" />
                      <span className="fm-menu-label">{baseName(p)}</span>
                      <span className="fm-menu-sub">{p}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Address bar — breadcrumbs by default, a text field on click/Ctrl+L */}
          {editingPath !== null ? (
            <input
              ref={pathInputRef}
              className="fm-path-input"
              value={editingPath}
              autoFocus
              spellCheck={false}
              onChange={(e) => setEditingPath(e.target.value)}
              onBlur={() => setEditingPath(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); navigate(editingPath.trim()); }
                if (e.key === 'Escape') { e.preventDefault(); setEditingPath(null); }
              }}
            />
          ) : (
            <div
              className="fm-crumbs"
              onDoubleClick={() => { setEditingPath(path); setTimeout(() => pathInputRef.current?.select(), 0); }}
              title="Double-click (or Ctrl+L) to type a path"
            >
              {crumbs.map((c, i) => (
                <span key={c.path} className="fm-crumb-wrap">
                  <button
                    className={`fm-crumb ${i === crumbs.length - 1 ? 'current' : ''}`}
                    onClick={() => c.path !== path && navigate(c.path)}
                    title={c.path}
                  >
                    {c.label}
                  </button>
                  <span className="fm-menu-anchor">
                    <button
                      className={`fm-crumb-chev ${crumbMenu?.path === c.path ? 'active' : ''}`}
                      onClick={(e) => openCrumbMenu(c.path, e)}
                      title={`Jump to a folder in ${c.label}`}
                    >
                      <FontAwesomeIcon icon={faChevronRight} />
                    </button>
                    {crumbMenu?.path === c.path && (
                      <div className="fm-menu" style={menuPos} onClick={(e) => e.stopPropagation()}>
                        {crumbMenu.items === null && <div className="fm-menu-empty">Loading…</div>}
                        {crumbMenu.items?.length === 0 && <div className="fm-menu-empty">No subfolders</div>}
                        {crumbMenu.items?.map(item => (
                          <button
                            key={item.path}
                            className={`fm-menu-item ${path.toLowerCase() === item.path.toLowerCase() ? 'current' : ''}`}
                            onClick={() => navigate(item.path)}
                            onMouseEnter={() => prefetch(item)}
                          >
                            <FontAwesomeIcon icon={faFolder} className="fm-menu-icon" style={{ color: '#FACC15' }} />
                            <span className="fm-menu-label">{baseName(item.path)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </span>
                </span>
              ))}
            </div>
          )}

          <div className="fm-search">
            <FontAwesomeIcon icon={faSearch} className="fm-search-icon" />
            <input
              ref={filterRef}
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setCursor(0); }}
              onKeyDown={(e) => {
                // Enter from the filter box opens the top hit — type a few
                // letters, hit Enter, you're there.
                if (e.key === 'Enter' && visible.length) { e.preventDefault(); openEntry(visible[Math.min(cursor, visible.length - 1)]); }
              }}
              placeholder="Filter…"
              spellCheck={false}
            />
            {filter && (
              <button className="fm-search-clear" onClick={() => setFilter('')} title="Clear filter">
                <FontAwesomeIcon icon={faTimes} />
              </button>
            )}
          </div>

          <div className="fm-toolbar-actions">
            <button
              className={`fm-icon-btn ${isPinned ? 'pinned' : ''}`}
              onClick={() => togglePin({ name: baseName(path), path })}
              title={isPinned ? 'Unpin this folder' : 'Pin this folder to the sidebar'}
            >
              <FontAwesomeIcon icon={faThumbtack} />
            </button>
            <button
              className={`fm-icon-btn ${showHidden ? 'active' : ''}`}
              onClick={() => setShowHidden(v => !v)}
              title={showHidden
                ? `Hiding nothing — ${hiddenCount} hidden item${hiddenCount === 1 ? '' : 's'} shown`
                : `Show hidden items (${hiddenCount} here)`}
            >
              <FontAwesomeIcon icon={showHidden ? faEye : faEyeSlash} />
            </button>
            <button
              className="fm-icon-btn"
              onClick={() => setView(v => (v === 'list' ? 'grid' : 'list'))}
              title={view === 'list' ? 'Switch to grid view' : 'Switch to list view'}
            >
              <FontAwesomeIcon icon={view === 'list' ? faTableCellsLarge : faList} />
            </button>
            <button className="fm-icon-btn" onClick={copyPath} title="Copy path">
              <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
            </button>
            <button className="fm-icon-btn" onClick={() => openWithSystem(path)} title="Open in system file manager">
              <FontAwesomeIcon icon={faExternalLinkAlt} />
            </button>
            <button className="fm-icon-btn fm-close" onClick={onClose} title="Close (Esc)">
              <FontAwesomeIcon icon={faTimes} />
            </button>
          </div>
        </div>

        {/* Project bar — the owning .cooldesk/ workspace: its commands, resource
            folders and open todo count, available from anywhere inside it. */}
        {/* No workspace here yet, but this looks like a project root — offer to
            run the plugin's /cd-init in this folder. */}
        {looksLikeProjectRoot && (
          <div className="fm-project-bar fm-project-bar--setup">
            <span className="fm-setup-text">
              No CoolDesk workspace in <strong>{baseName(path)}</strong>
            </span>
            <button
              className="fm-setup-btn"
              onClick={runInit}
              title={`Runs ${localStorage.getItem(INIT_CMD_KEY) || DEFAULT_INIT_CMD} in ${path}`}
            >
              <FontAwesomeIcon icon={faPlay} />
              <span>Set up with /cd-init</span>
            </button>
            {initRan && (
              <>
                <span className="fm-setup-hint">
                  Finish the setup in the console, then
                </span>
                <button className="fm-setup-btn ghost" onClick={recheckProject}>
                  <FontAwesomeIcon icon={faSync} />
                  <span>Re-check</span>
                </button>
              </>
            )}
          </div>
        )}

        {project && (
          <div className="fm-project-bar">
            <button
              className="fm-project-name"
              onClick={() => project.path !== path && navigate(project.path)}
              title={project.path === path ? project.path : `Go to project root — ${project.path}`}
            >
              <FontAwesomeIcon icon={faDiagramProject} />
              <span>{project.project?.name || baseName(project.path)}</span>
            </button>

            {/* Member side of the star: one way home to the hub. */}
            {project.hub?.path && (
              <button
                className={`fm-hub-chip ${project.hub.exists === false ? 'missing' : ''}`}
                onClick={() => project.hub.exists !== false && navigate(project.hub.path)}
                title={project.hub.exists === false
                  ? `${project.hub.path}
(hub not on this machine)`
                  : `Back to the hub of "${project.hub.name}" — ${project.hub.path}`}
              >
                <FontAwesomeIcon icon={faLink} />
                <span>{project.hub.name || 'Hub'}</span>
              </button>
            )}

            {project.commands.length > 0 && (
              <div className="fm-project-group">
                {project.commands.map(cmd => {
                  const key = cmd.id || cmd.run;
                  const justRan = ranCommand === key;
                  return (
                    <button
                      key={key}
                      className={`fm-cmd-chip ${justRan ? 'ran' : ''}`}
                      onClick={() => runCommand(cmd)}
                      title={`${cmd.run}  ·  runs in ${project.path}`}
                    >
                      <FontAwesomeIcon icon={justRan ? faCheck : faPlay} />
                      <span>{cmd.label || cmd.id}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Resource folders declared in cooldesk.json jump straight there. */}
            {project.resources.filter(r => r.type === 'folder' && r.path).length > 0 && (
              <div className="fm-project-group fm-project-resources">
                {project.resources.filter(r => r.type === 'folder' && r.path).map(r => {
                  // Manifest paths are POSIX-relative; rewrite to the host separator.
                  const sep = project.path.includes('\\') ? '\\' : '/';
                  const target = `${project.path}${sep}${r.path.replace(/[\\/]/g, sep)}`;
                  return (
                    <button
                      key={r.name || r.path}
                      className={`fm-res-chip ${target.toLowerCase() === path.toLowerCase() ? 'current' : ''}`}
                      onClick={() => navigate(target)}
                      onMouseEnter={() => prefetch({ is_dir: true, path: target })}
                      title={target}
                    >
                      <FontAwesomeIcon icon={faFolder} />
                      <span>{r.name || r.path}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Declared services, crossed with the OS's actual listeners: green
                means it's really up, and you can open or kill it from here. */}
            {project.services.length > 0 && (
              <div className="fm-project-group fm-project-services">
                {project.services.map(svc => {
                  const live = svc.port
                    ? listeningPorts.find(p => p.port === Number(svc.port))
                    : null;
                  const armed = confirmKillPort === Number(svc.port);
                  const busy = killingPort === Number(svc.port);
                  const label = svc.label || svc.id || `:${svc.port}`;
                  return (
                    <span
                      key={svc.id || svc.port}
                      className={`fm-svc-chip ${live ? 'live' : 'down'}`}
                      title={live
                        ? `${label} — listening on ${svc.port} (${live.process}, pid ${live.pid})`
                        : `${label} — not running${svc.port ? ` (port ${svc.port} free)` : ''}`}
                    >
                      <button
                        className="fm-svc-open"
                        onClick={() => live && openService(svc)}
                        disabled={!live}
                      >
                        <span className="fm-svc-dot" />
                        <span className="fm-svc-label">{label}</span>
                        {svc.port && <span className="fm-svc-port">:{svc.port}</span>}
                      </button>
                      {live && (
                        <button
                          className={`fm-svc-kill ${armed ? 'armed' : ''}`}
                          onClick={() => killService(Number(svc.port))}
                          title={armed ? 'Click again to kill' : `Kill ${live.process} (pid ${live.pid})`}
                        >
                          <FontAwesomeIcon icon={busy ? faSpinner : faPowerOff} spin={busy} />
                          {armed && <span>Kill?</span>}
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Link another project into this one's group. Candidates are the
                projects we already know about that aren't members yet. */}
            <div className="fm-project-group fm-menu-anchor">
              <button
                className={`fm-link-chip ${showLinkMenu ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  anchorTo(e.currentTarget);
                  setLinkError(null);
                  setShowLinkMenu(v => !v);
                  setCrumbMenu(null);
                  setShowRecent(false);
                }}
                title="Link another project into this group"
              >
                <FontAwesomeIcon icon={faPlus} />
                <span>Link</span>
              </button>
              {showLinkMenu && (
                <div className="fm-menu" style={menuPos} onClick={(e) => e.stopPropagation()}>
                  {linkError && <div className="fm-menu-empty fm-menu-error">{linkError}</div>}
                  {linkCandidates.length === 0 && !linkError && (
                    <div className="fm-menu-empty">
                      Everything known is already linked. Browse into another project to link it.
                    </div>
                  )}
                  {linkCandidates.map(c => {
                    // If they already own a group, join it rather than starting
                    // a rival one with this project as hub.
                    const theirGroup = candidateHubs[c.path];
                    const join = !!theirGroup;
                    return (
                      <button
                        key={c.path}
                        className="fm-menu-item"
                        onClick={() => toggleLink(c.path, false, join)}
                        disabled={linking === c.path}
                        title={join
                          ? `Join "${theirGroup}" — ${c.name} stays the hub
${c.path}`
                          : `Add ${c.name} to this project's group
${c.path}`}
                      >
                        <FontAwesomeIcon
                          icon={linking === c.path ? faSpinner : faLink}
                          spin={linking === c.path}
                          className="fm-menu-icon"
                        />
                        <span className="fm-menu-label">{c.name}</span>
                        <span className="fm-menu-sub">
                          {join ? `join ${theirGroup}` : 'add to this group'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {project.todos.filter(t => t.status !== 'done').length > 0 && (
              <span
                className="fm-todo-count"
                title={project.todos.filter(t => t.status !== 'done').map(t => `• ${t.title || t.text}`).join('\n')}
              >
                <FontAwesomeIcon icon={faCheckDouble} />
                {project.todos.filter(t => t.status !== 'done').length} open
              </span>
            )}
          </div>
        )}

        <div className="fm-body">
          {sidebar.length > 0 && (
            <div className={`fm-sidebar ${placesOpen ? 'fm-sidebar--open' : ''}`} onClick={(e) => e.stopPropagation()}>
              {sidebar.map(section => (
                <div key={section.title} className={`fm-side-section ${section.kind === 'linked' ? 'fm-side-linked' : ''}`}>
                  <div className="fm-side-title">
                    {section.kind === 'linked' && <FontAwesomeIcon icon={faLink} className="fm-side-title-icon" />}
                    {section.title}
                  </div>
                  {section.items.map(item => {
                    const isDrive = /^[A-Za-z]:\\?$/.test(item.path);
                    const active = item.path.toLowerCase() === path.toLowerCase();
                    // A linked project that isn't cloned on this machine stays
                    // listed but inert — the link is real, the folder isn't.
                    const missing = section.kind === 'linked' && item.exists === false;
                    return (
                      <button
                        key={`${section.title}-${item.path}`}
                        className={`fm-side-item ${active ? 'active' : ''} ${missing ? 'missing' : ''}`}
                        onClick={() => !missing && navigate(item.path)}
                        onMouseEnter={() => !missing && prefetch({ is_dir: true, path: item.path })}
                        title={missing ? `${item.path}\n(not on this machine)` : item.path}
                      >
                        <FontAwesomeIcon
                          icon={section.kind === 'linked'
                            ? faDiagramProject
                            : (isDrive ? faHardDrive : (item.name === 'Home' ? faHouse : faFolder))}
                          className="fm-side-icon"
                        />
                        <span className="fm-side-label">{item.name || baseName(item.path)}</span>
                        {/* Only real group members can be unlinked, and never
                            the hub's own entry — that would orphan the group. */}
                        {section.kind === 'linked' && item.member
                          && item.path.toLowerCase() !== (project?.path || '').toLowerCase() && (
                          <span
                            className="fm-side-unpin"
                            onClick={(e) => { e.stopPropagation(); toggleLink(item.path, true); }}
                            title={`Unlink ${item.name} from this group`}
                          >
                            <FontAwesomeIcon
                              icon={linking === item.path ? faSpinner : faLinkSlash}
                              spin={linking === item.path}
                            />
                          </span>
                        )}
                        {section.title === 'Pinned' && (
                          <span
                            className="fm-side-unpin"
                            onClick={(e) => { e.stopPropagation(); togglePin(item); }}
                            title="Unpin"
                          >
                            <FontAwesomeIcon icon={faTimes} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          <div className="fm-main">
            {view === 'list' && (
              <div className="fm-col-heads">
                <SortHeader label="Name" k="name" className="fm-col-name" />
                <SortHeader label="Modified" k="date" className="fm-col-date" />
                <SortHeader label="Size" k="size" className="fm-col-size" />
              </div>
            )}

            <div className={`fm-list ${view === 'grid' ? 'fm-grid' : ''}`} ref={listRef}>
              {loading && <div className="fm-empty">Loading…</div>}
              {!loading && error && <div className="fm-empty fm-error">Can’t open this folder — {error}</div>}
              {!loading && !error && visible.length === 0 && (
                <div className="fm-empty">{filter ? 'Nothing matches that filter' : 'This folder is empty'}</div>
              )}
              {!loading && !error && visible.map((entry, i) => {
                const [icon, color] = iconFor(entry);
                const name = baseName(entry.path);
                const count = childCounts[entry.path];
                const active = i === safeCursor;
                const common = {
                  className: `fm-item ${view === 'grid' ? 'fm-tile' : 'fm-row'} ${active ? 'active' : ''} ${entry.hidden ? 'hidden-entry' : ''}`,
                  onClick: () => { setCursor(i); openEntry(entry); },
                  onMouseEnter: () => { setCursor(i); prefetch(entry); },
                  title: entry.path,
                };
                if (view === 'grid') {
                  return (
                    <div key={entry.path} {...common}>
                      <FontAwesomeIcon icon={icon} style={{ color }} className="fm-tile-icon" />
                      <div className="fm-tile-name">{name}</div>
                      <div className="fm-tile-sub">
                        {entry.is_dir ? (count !== undefined ? `${count} items` : 'Folder') : formatSize(entry.size)}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={entry.path} {...common}>
                    <div className="fm-col-name">
                      <FontAwesomeIcon icon={icon} style={{ color }} className="fm-row-icon" />
                      <span className="fm-row-name">{name}</span>
                      {entry.is_dir && count !== undefined && <span className="fm-row-count">{count}</span>}
                    </div>
                    <div className="fm-col-date">{entry.date}</div>
                    <div className="fm-col-size">{entry.is_dir ? '' : formatSize(entry.size)}</div>
                    <button
                      className="fm-row-action"
                      onClick={(e) => { e.stopPropagation(); openWithSystem(entry.path); }}
                      title="Open in system file manager"
                    >
                      <FontAwesomeIcon icon={faExternalLinkAlt} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="fm-status">
              <span>{visible.length} item{visible.length === 1 ? '' : 's'}{filter ? ` of ${entries.length}` : ''}</span>
              {!showHidden && hiddenCount > 0 && (
                <button className="fm-status-link" onClick={() => setShowHidden(true)}>
                  +{hiddenCount} hidden
                </button>
              )}
              {current && <span className="fm-status-sel">{baseName(current.path)}</span>}
              <span className="fm-status-hint">
                <kbd>↑↓</kbd> move <kbd>↵</kbd> open <kbd>⌫</kbd> up <kbd>Ctrl+L</kbd> path
              </span>
            </div>
          </div>

          {/* Quick Look-style preview, wide widths only (see fileManager.css
              — there's no room for a third column once the sidebar has
              already been dropped for space). */}
          {previewItem && (
            <>
              <div className="fm-preview-resize" onMouseDown={startPreviewResize} title="Drag to resize" />
              <div className="fm-preview" style={{ width: previewWidth }}>
                <Suspense fallback={<div className="preview-pane" />}>
                  <PreviewPane item={previewItem} />
                </Suspense>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
