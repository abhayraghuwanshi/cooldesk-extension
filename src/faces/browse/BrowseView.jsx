import { faArrowUpRightFromSquare, faCompass, faDesktop, faHouse, faPlus, faCompress, faExpand, faChevronDown, faSearch, faServer, faTableCellsLarge, faWindowMaximize, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserPane } from '../../features/browser/BrowserPane';
import { FilesView } from './FilesView';
import { FileIcon, FileTab } from './FileTab';
import { useShelf } from '../../features/shelf/useShelf';
import { useExternalTabs } from '../../features/browser/useExternalTabs';
import { CanvasView } from './CanvasView';
import { addTile, compact, loadTiles, saveTiles } from './canvasLayout';
import { tabPaneId, useBrowseTabs } from './useBrowseTabs';
import { getFaviconUrl } from '../../utils/helpers.js';
import { useIsSidebarWidth } from '../../shared/hooks/useIsSidebarWidth.js';
import '../../styles/browse.css';

// Browse face: the workspaces' links (plus local dev servers) on the left, the
// in-app browser pane on the right — pick an item, it opens beside the list.

const LAST_URL_KEY = 'cooldesk.browse.lastUrl';
const MODE_KEY = 'cooldesk.browse.mode';
const FILES_PATH_KEY = 'cooldesk.browse.filesPath';
const MODES = ['browse', 'canvas'];
const FILES_OPEN_KEY = 'cooldesk.browse.filesOpen';
const FILES_TAB_KEY = 'cooldesk.browse.filesTab';
const FILES_WIDTH_KEY = 'cooldesk.browse.filesWidth';
const FILES_WIDTH_DEFAULT = 380;
const FILES_WIDTH_MIN = 300;
const FILES_WIDTH_MAX = 1200;

function parentDir(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}
const STATS_POLL_MS = 3000;
const LIST_WS_KEY = 'cooldesk.browse.workspace';
// list_listening_ports runs netstat and samples every process's CPU (with a
// deliberate sleep), so it's refreshed rarely rather than every few seconds.
const PORTS_POLL_MS = 30000;


function persist(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: keep in-memory state */ }
}

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

// Saved links often have the URL itself as their title; show a site name
// ("primevideo.com" → "Primevideo") instead, and the path as the subtitle.
function describeLink(url, title) {
  const host = hostOf(url);
  const raw = (title || '').trim();
  const titleIsUrl = !raw || /^https?:\/\//i.test(raw) || raw.replace(/^www\./, '') === host;
  if (!titleIsUrl) return { title: raw, sub: host };
  let path = '';
  try {
    const u = new URL(url);
    path = u.pathname === '/' ? '' : `${u.pathname}${u.search}`;
  } catch { /* keep host only */ }
  const name = host.split('.').slice(-2, -1)[0] || host;
  return { title: name.charAt(0).toUpperCase() + name.slice(1), sub: path ? `${host}${path}` : host };
}

// Favicon in a rounded tile; falls back to a tinted monogram when the icon
// is missing or fails to load (common for intranet / localhost pages).
function ItemIcon({ item }) {
  const [failed, setFailed] = useState(false);
  if (item.server) {
    return (
      <span className="browse-tile server">
        <FontAwesomeIcon icon={faServer} />
        <span className="browse-live" />
      </span>
    );
  }
  const src = failed ? null : getFaviconUrl(item.url, 32, item.favicon);
  const letter = (item.title || item.sub || '?').trim().charAt(0).toUpperCase();
  // Stable per-host hue so monograms aren't all the same grey.
  const hue = [...(item.sub || letter)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="browse-tile" style={src ? undefined : { '--mono-hue': hue }}>
      {src
        ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <span className="browse-mono">{letter}</span>}
    </span>
  );
}

/** Window outline with its right column filled: "side panel on the right". */
function SidePanelIcon() {
  return (
    <svg width="15" height="13" viewBox="0 0 15 13" aria-hidden="true" className="side-panel-icon">
      <rect x="0.75" y="0.75" width="13.5" height="11.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="1.5" width="4.5" height="10" rx="1.6" fill="currentColor" />
    </svg>
  );
}

const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

/**
 * @param home  the dashboard, shown in any blank tab (new tab, launch) —
 *              CoolDeskContainer passes the workspace cards
 */
export function BrowseView({ savedWorkspaces = [], activeWorkspaceId, isActive, home = null }) {
  const isSidebarWidth = useIsSidebarWidth();
  // Tabs (useBrowseTabs): each is its own live page; the single page Browse
  // used to show becomes the first tab.
  const browseTabs = useBrowseTabs(localStorage.getItem(LAST_URL_KEY));
  const activeTab = browseTabs.active;
  // What the active tab is actually showing (follows in-page navigation) —
  // the Notes tab lists this page's highlights.
  const pageUrl = activeTab.url;
  // Bumped to focus the active tab's address bar (⌘T / ⌘L) / open find (⌘F).
  const [focusAddress, setFocusAddress] = useState(0);
  const [findKey, setFindKey] = useState(0);
  const [filter, setFilter] = useState('');
  const [ports, setPorts] = useState([]);

  // Focus mode: the pane takes the whole window — header, link list, face
  // nav and page padding hide (browse.css keys off the root class). Session
  // only; Esc or the toolbar button leaves it.
  const [focusMode, setFocusMode] = useState(false);
  const focusOn = focusMode && isActive && !isSidebarWidth;


  useEffect(() => {
    if (!focusOn) return;
    const root = document.documentElement;
    root.classList.add('browse-focus');
    // Capture on window so this runs before WorkspaceShell's Escape handler
    // (which would otherwise leave the Browse face entirely).
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setFocusMode(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      root.classList.remove('browse-focus');
      window.removeEventListener('keydown', onKey, true);
    };
  }, [focusOn]);

  // Ctrl/Cmd+Shift+F toggles focus mode while Browse is up.
  useEffect(() => {
    if (!isActive || isSidebarWidth) return;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFocusMode(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive, isSidebarWidth]);

  // The native webview is pinned to page coordinates, so the page must sit
  // at the top while this face is up (spatial.css locks its scroll too).
  useEffect(() => {
    if (isActive) document.querySelector('.popup-wrap')?.scrollTo(0, 0);
  }, [isActive]);

  const openUrl = useCallback((url, { newTab = false } = {}) => {
    if (!isWebUrl(url)) return;
    // Docked sidebar: no room for the pane, so hand the link to the user's browser.
    if (isSidebarWidth) {
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('open_url', { url }))
        .catch(err => console.warn('[Browse] open_url failed:', err));
      return;
    }
    if (newTab) browseTabs.openInNew(url);
    else browseTabs.openInActive(url);
    persist(LAST_URL_KEY, url);
  }, [isSidebarWidth, browseTabs]);

  // A tab's pane reports in-page navigation, or an address typed in its bar.
  const handleNavigate = useCallback((tabId, url, { requested } = {}) => {
    if (requested) return openUrl(url);
    browseTabs.noteUrl(tabId, url);
    persist(LAST_URL_KEY, url);
  }, [openUrl, browseTabs]);

  const newTab = useCallback(() => {
    browseTabs.openInNew(null);
    setFocusAddress(k => k + 1);
  }, [browseTabs]);



  // Browse (one pane) or Canvas (tiles). The canvas stays mounted once
  // visited so its pages survive switching back and forth.
  const [mode, setModeState] = useState(() => {
    const stored = localStorage.getItem(MODE_KEY);
    return MODES.includes(stored) ? stored : 'browse';
  });
  const [canvasVisited, setCanvasVisited] = useState(mode === 'canvas');
  const setMode = useCallback((next) => {
    setModeState(next);
    persist(MODE_KEY, next);
    if (next === 'canvas') setCanvasVisited(true);
  }, []);
  const canvasMode = mode === 'canvas' && !isSidebarWidth;
  const browseMode = !canvasMode;

  // 🏠: back to the dashboard — an existing blank tab if there is one, else
  // a new one (without stealing focus into its address bar).
  const goHome = useCallback(() => {
    if (mode !== 'browse') setMode('browse');
    const blank = browseTabs.tabs.find(t => !t.url && !t.file);
    if (blank) browseTabs.activate(blank.id);
    else browseTabs.openInNew(null);
  }, [browseTabs, mode, setMode]);
  const goHomeRef = useRef(goHome);
  goHomeRef.current = goHome;

  // Browser shortcuts. Keys typed while the page itself has focus never reach
  // this document; the page tools (tools.js, isolated world) forward these
  // same combos as `browser-pane-shortcut` events. Not ⌘W: the macOS menu's
  // Close Window owns it and would close CoolDesk first.
  const shortcutRef = useRef(null);
  shortcutRef.current = (key) => {
    const pane = tabPaneId(browseTabs.activeId);
    const nav = (action) => import('@tauri-apps/api/core').then(({ invoke }) => invoke('browser_pane_nav', { id: pane, action })).catch(() => { });
    switch (key) {
      case 'mod+t': newTab(); return true;
      case 'mod+l': setFocusAddress(k => k + 1); return true;
      case 'mod+[': nav('back'); return true;
      case 'mod+]': nav('forward'); return true;
      case 'mod+r': nav('reload'); return true;
      case 'mod+f': setFindKey(k => k + 1); return true;
      case 'next-tab': browseTabs.cycle(1); return true;
      case 'prev-tab': browseTabs.cycle(-1); return true;
      default: {
        // tab-1 … tab-8 by position, tab-9 the last tab (as browsers do).
        const m = /^tab-([1-9])$/.exec(key);
        if (!m) return false;
        const list = browseTabs.tabs;
        const target = m[1] === '9' ? list[list.length - 1] : list[Number(m[1]) - 1];
        if (target) browseTabs.activate(target.id);
        return true;
      }
    }
  };
  useEffect(() => {
    if (!isActive || isSidebarWidth || mode !== 'browse') return undefined;
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      let key = null;
      if (e.ctrlKey && k === 'tab') key = e.shiftKey ? 'prev-tab' : 'next-tab';
      else if (mod && e.shiftKey && (k === ']' || k === '}')) key = 'next-tab';
      else if (mod && e.shiftKey && (k === '[' || k === '{')) key = 'prev-tab';
      else if (mod && !e.shiftKey && !e.altKey && ['t', 'l', '[', ']', 'r', 'f'].includes(k)) key = `mod+${k}`;
      else if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(k)) key = `tab-${k}`;
      if (key && shortcutRef.current(key)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    let off = null;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('browser-pane-shortcut', ({ payload }) => {
        if (payload?.label?.includes('browser-pane-bt-')) shortcutRef.current(payload.key);
      }))
      .then(fn => { if (cancelled) fn(); else off = fn; });
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelled = true;
      off?.();
    };
  }, [isActive, isSidebarWidth, mode]);


  // Pop-ups and target=_blank links from a tab open as a new tab beside it.
  useEffect(() => {
    let off = null;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('browser-pane-popup', ({ payload }) => {
        if (payload?.url && /^https?:/i.test(payload.url)) browseTabs.openInNew(payload.url, { position: 'after' });
      }))
      .then(fn => { if (cancelled) fn(); else off = fn; });
    return () => { cancelled = true; off?.(); };
  }, [browseTabs]);

  // Files: a side panel next to the page in either mode (was a separate
  // mode) — read a file, copy from it, or drag it onto the page beside it.
  // A stored 'files' mode from before migrates to Browse with the panel open.
  const [filesOpen, setFilesOpenState] = useState(() =>
    localStorage.getItem(FILES_OPEN_KEY) !== 'false');
  const [filesVisited, setFilesVisited] = useState(filesOpen);
  const setFilesOpen = useCallback((open) => {
    setFilesOpenState(open);
    persist(FILES_OPEN_KEY, String(open));
    if (open) setFilesVisited(true);
  }, []);
  const filesShown = filesOpen && !isSidebarWidth;
  // Files | Shelf inside the panel. The Shelf (downloads, clips, dropped
  // files) is shared here so the toolbar button can badge it.
  const shelf = useShelf();
  const [filesTab, setFilesTabState] = useState(() => {
    const stored = localStorage.getItem(FILES_TAB_KEY);
    return ['files', 'shelf', 'notes', 'page'].includes(stored) ? stored : 'tabs';
  });
  const setFilesTab = useCallback((tab) => {
    setFilesTabState(tab);
    persist(FILES_TAB_KEY, tab);
  }, []);
  const downloading = shelf.downloads.some(d => d.state === 'started');

  // Navigation from elsewhere in CoolDesk (slash commands, workspace jumps,
  // onboarding) — what used to switch faces: Home, or the panel's Tabs tab.
  useEffect(() => {
    const onNavigate = (e) => {
      const to = e.detail?.to;
      if (to === 'home') goHomeRef.current?.();
      else if (to === 'folder' && e.detail.path) browseTabs.openFileTab(e.detail.path, true, true);
      else if (to === 'tabs') {
        setFilesTab('tabs');
        setFilesOpen(true);
      }
    };
    window.addEventListener('cooldesk-browse', onNavigate);
    return () => window.removeEventListener('cooldesk-browse', onNavigate);
  }, [setFilesTab, setFilesOpen, browseTabs]);
  const [filesWidth, setFilesWidth] = useState(() => {
    const w = Number(localStorage.getItem(FILES_WIDTH_KEY));
    return w >= FILES_WIDTH_MIN && w <= FILES_WIDTH_MAX ? w : FILES_WIDTH_DEFAULT;
  });
  const filesWidthRef = useRef(filesWidth);
  useEffect(() => { filesWidthRef.current = filesWidth; }, [filesWidth]);
  const startFilesResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = filesWidthRef.current;
    // Panel is on the right: dragging left widens it.
    const onMove = (ev) => setFilesWidth(Math.min(FILES_WIDTH_MAX, Math.max(FILES_WIDTH_MIN, start - (ev.clientX - startX))));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persist(FILES_WIDTH_KEY, String(filesWidthRef.current));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Files: last folder, else Home (the first of get_user_places).
  const [filesPath, setFilesPath] = useState(() => localStorage.getItem(FILES_PATH_KEY) || '');
  useEffect(() => {
    if (!filesVisited || filesPath) return;
    let cancelled = false;
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('get_user_places'))
      .then(places => { if (!cancelled && places?.[0]?.path) setFilesPath(places[0].path); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [filesVisited, filesPath]);
  const showFolder = useCallback((dir) => {
    setFilesPath(dir);
    persist(FILES_PATH_KEY, dir);
  }, []);
  // From a file tab: reveal it in the side panel's Files tab.
  const showInFiles = useCallback((path) => {
    showFolder(parentDir(path));
    setFilesTab('files');
    setFilesOpen(true);
  }, [showFolder, setFilesTab, setFilesOpen]);

  // A file or folder (address bar, Files tab, Shelf, workspace): open it as
  // a tab in the main view — the one place things are previewed.
  const openPath = useCallback((path, isDir) => {
    if (mode !== 'browse') setMode('browse');
    browseTabs.openFileTab(path, !!isDir);
  }, [mode, setMode, browseTabs]);

  const [tiles, setTiles] = useState(loadTiles);
  const changeTiles = useCallback((next, { transient } = {}) => {
    setTiles(next);
    if (!transient) saveTiles(next);
  }, []);
  const addToCanvas = useCallback((url) => {
    if (!isWebUrl(url)) return;
    setTiles(prev => {
      if (prev.some(t => t.url === url)) return prev;
      const next = addTile(prev, url);
      saveTiles(next);
      return next;
    });
  }, []);
  const openInBrowse = useCallback((url) => {
    setMode('browse');
    openUrl(url);
  }, [setMode, openUrl]);

  // A link from the list: switches to its tab if it's already open, loads in
  // the current tab if that one is blank, otherwise opens a new tab (so the
  // page you're on isn't replaced). ⌘-click replaces the current tab instead.
  // In Canvas it joins the canvas.
  const pickLink = useCallback((url, replaceCurrent = false) => {
    if (canvasMode) addToCanvas(url);
    else if (replaceCurrent || (!activeTab.url && !activeTab.file)) openUrl(url);
    else {
      const open = browseTabs.findByUrl(url);
      if (open) browseTabs.activate(open.id);
      else openUrl(url, { newTab: true });
    }
  }, [canvasMode, addToCanvas, openUrl, activeTab.url, activeTab.file, browseTabs]);
  const onCanvas = useMemo(() => new Set(tiles.map(t => t.url)), [tiles]);

  // Live memory/CPU of every in-app page (browser_pane/stats.rs), shown in
  // the side panel's Page tab. Each page is its own WebKit process.
  const [stats, setStats] = useState(null);
  // Only measured while the Page tab is on screen.
  const [pageTools, setPageTools] = useState(null);
  const pageTabShown = isActive && filesShown && filesTab === 'page';
  useEffect(() => {
    if (!pageTabShown) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const next = await invoke('browser_pane_stats');
        if (!cancelled) setStats(next);
      } catch {
        if (!cancelled) setStats(null);
      }
    };
    load();
    const timer = setInterval(load, STATS_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pageTabShown]);

  const openPages = useMemo(() => {
    if (!stats) return [];
    const tabFor = (id) => browseTabs.tabs.find(t => tabPaneId(t.id) === id);
    const urlFor = (id) => (id.startsWith('bt-') ? tabFor(id)?.url : tiles.find(t => `tile-${t.id}` === id)?.url);
    // Several panes can share one WebKit process; count each process once.
    const seen = new Set();
    return stats.panes
      .map(p => {
        const url = urlFor(p.id);
        const shared = p.pid != null && seen.has(p.pid);
        if (p.pid != null) seen.add(p.pid);
        return {
          ...p,
          url,
          shared,
          tileId: p.id.startsWith('tile-') ? p.id.slice(5) : null,
          tabId: p.id.startsWith('bt-') ? tabFor(p.id)?.id : null,
          label: tabFor(p.id)?.title || (url ? describeLink(url).title : p.id),
          where: p.id.startsWith('bt-') ? 'Tab' : 'Canvas',
        };
      })
      .sort((a, b) => (b.memory || 0) - (a.memory || 0));
  }, [stats, tiles, browseTabs.tabs]);
  const pagesMemory = openPages.reduce((n, p) => n + (p.shared ? 0 : p.memory || 0), 0);
  // Percent of one core, summed across page processes (so it can pass 100%).
  const pagesCpu = openPages.reduce((n, p) => n + (p.shared ? 0 : p.cpu || 0), 0);

  // Local dev servers, only polled while this face is on screen.
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke('list_listening_ports');
        if (!cancelled) setPorts(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setPorts([]);
      }
    };
    load();
    const timer = setInterval(load, PORTS_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isActive]);

  // Groups: local servers, then the active workspace, then the rest.
  // Which workspace's links the list shows: one at a time (follows the
  // workspace opened elsewhere in CoolDesk, else the last pick), or 'all'.
  // Typing in the filter always searches every workspace.
  const [listWs, setListWsState] = useState(() => localStorage.getItem(LIST_WS_KEY) || activeWorkspaceId || '');
  const [wsPickerOpen, setWsPickerOpen] = useState(false);
  const setListWs = (id) => {
    setListWsState(id);
    persist(LIST_WS_KEY, id);
    setWsPickerOpen(false);
  };
  useEffect(() => { if (activeWorkspaceId) setListWsState(activeWorkspaceId); }, [activeWorkspaceId]);
  const isFileItem = (a) => (a?.appType === 'file' || a?.appType === 'folder') && a.path;
  const wsWithLinks = useMemo(() => savedWorkspaces
    .map(ws => ({
      ws,
      count: (ws.urls || []).filter(u => isWebUrl(u?.url)).length + (ws.apps || []).filter(isFileItem).length,
    }))
    .filter(x => x.count > 0), [savedWorkspaces]);
  // One workspace at a time (the rest stay out of the way, one pick away).
  const shownWs = wsWithLinks.find(x => x.ws.id === listWs) || wsWithLinks[0] || null;

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matches = (item) => !q || item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q);

    const serverItems = ports
      .map(p => ({ url: `http://localhost:${p.port}`, title: `localhost:${p.port}`, sub: p.process, server: true }))
      .filter(matches);

    // One workspace (flat list) unless 'all' is picked or a filter is typed.
    const single = !q && shownWs ? shownWs.ws : null;
    const workspaces = single
      ? [single]
      : [...savedWorkspaces].sort((a, b) => (b.id === activeWorkspaceId) - (a.id === activeWorkspaceId));
    const workspaceGroups = workspaces.map(ws => ({
      id: `ws:${ws.id}`,
      name: ws.name,
      items: (ws.urls || [])
        .filter(u => isWebUrl(u?.url))
        .map(u => ({ url: u.url, ...describeLink(u.url, u.title), favicon: u.favicon }))
        .filter(matches),
    })).filter(g => g.items.length > 0);

    // The workspace's own files and folders (single-workspace view), opened
    // as tabs in the main area.
    const fileItems = single
      ? (single.apps || [])
        .filter(a => (a?.appType === 'file' || a?.appType === 'folder') && a.path)
        .map(a => ({ path: a.path, isDir: a.appType === 'folder', title: a.name || a.path.split(/[/\\]/).pop(), sub: a.path }))
        .filter(i => !q || i.title.toLowerCase().includes(q) || i.path.toLowerCase().includes(q))
      : [];

    return [
      ...(serverItems.length ? [{ id: 'servers', name: 'Local servers', items: serverItems }] : []),
      ...workspaceGroups.map(g => ({ ...g, flat: !!single })),
      ...(fileItems.length ? [{ id: `files:${single.id}`, name: 'Files & folders', items: fileItems, isFiles: true }] : []),
    ];
  }, [savedWorkspaces, activeWorkspaceId, ports, filter, shownWs]);

  const quickPicks = useMemo(() => groups.filter(g => !g.isFiles).flatMap(g => g.items).slice(0, 8), [groups]);



  // The toolbar keeps navigation only (and Home): everything else lives in
  // the side panel on the right, opened by the button at the toolbar's end.
  const toolbarStart = home ? (
    <button className={`bp-btn ${!activeTab.url && !activeTab.file ? 'on' : ''}`} onClick={goHome} title="Home: your workspaces">
      <FontAwesomeIcon icon={faHouse} />
    </button>
  ) : null;
  const toolbarEnd = (
    <>
    <button
      className={`bp-btn ${filesShown ? 'on' : ''} ${downloading || shelf.unseen ? 'files-badge' : ''} ${downloading ? 'downloading' : ''}`}
      data-count={shelf.unseen || ''}
      onClick={() => {
        // New downloads waiting: open straight onto the Shelf.
        if (downloading || shelf.unseen) {
          setFilesTab('shelf');
          setFilesOpen(true);
          return;
        }
        setFilesOpen(!filesOpen);
      }}
      title={downloading ? 'Downloading to the Shelf…'
        : shelf.unseen ? `${shelf.unseen} new on the Shelf`
          : filesShown ? 'Hide the side panel' : 'Side panel: tabs, links, files, shelf, notes, page tools'}
      aria-pressed={filesShown}
    >
      <SidePanelIcon />
    </button>
    <button
      className={`bp-btn bp-focus-btn ${focusOn ? 'on' : ''}`}
      onClick={() => setFocusMode(v => !v)}
      title={focusOn ? 'Exit focus mode (Esc)' : 'Focus mode (Ctrl+Shift+F)'}
    >
      <FontAwesomeIcon icon={focusOn ? faCompress : faExpand} />
    </button>
    </>
  );

  // ── Tabs tab rows ──────────────────────────────────────────────────
  // Pinned = the workspace's links, files and folders (Arc-style): each shows
  // whether it's open in a tab. Open tabs = tabs that aren't pinned items.
  const pinnedLinks = shownWs
    ? (shownWs.ws.urls || []).filter(u => isWebUrl(u?.url)).map(u => ({ url: u.url, ...describeLink(u.url, u.title), favicon: u.favicon }))
    : [];
  const pinnedFiles = shownWs
    ? (shownWs.ws.apps || []).filter(isFileItem).map(a => ({ path: a.path, isDir: a.appType === 'folder', title: a.name || a.path.split(/[/\\]/).pop(), sub: a.path }))
    : [];
  const serverLinks = groups.find(g => g.id === 'servers')?.items || [];
  const tabForUrl = (url) => browseTabs.tabs.find(t => !t.file && (t.url === url || t.req.url === url));
  const tabForPath = (path) => browseTabs.tabs.find(t => t.file?.path === path);
  const claimed = new Set([
    ...pinnedLinks.map(l => tabForUrl(l.url)?.id),
    ...serverLinks.map(l => tabForUrl(l.url)?.id),
    ...pinnedFiles.map(f => tabForPath(f.path)?.id),
  ].filter(Boolean));
  const looseTabs = browseTabs.tabs.filter(t => !claimed.has(t.id));

  const closeButton = (tab) => (
    <button
      className="bp-btn browse-tab-close"
      onClick={(e) => { e.stopPropagation(); browseTabs.close(tab.id); }}
      title="Close tab"
    >
      <FontAwesomeIcon icon={faXmark} />
    </button>
  );

  function renderPinnedLink(item) {
    const tab = canvasMode ? null : tabForUrl(item.url);
    const current = canvasMode ? onCanvas.has(item.url) : tab?.id === browseTabs.activeId;
    return (
      <div
        key={item.url}
        role="button"
        tabIndex={0}
        className={`browse-tab-row ${current ? 'active' : ''} ${tab ? 'is-open' : ''}`}
        onClick={(e) => pickLink(item.url, e.metaKey || e.ctrlKey)}
        onKeyDown={(e) => { if (e.key === 'Enter') pickLink(item.url); }}
        title={canvasMode ? item.url : `${item.url}\n${tab ? 'Open: click to switch to it' : 'Click to open in a tab'} · ⌘-click: replace this tab`}
      >
        <ItemIcon item={item} />
        <span className="browse-tab-title">{tab?.title || item.title}</span>
        {tab ? closeButton(tab) : <span className="browse-row-sub">{item.sub?.split('/')[0]}</span>}
      </div>
    );
  }

  function renderPinnedFile(item) {
    const tab = tabForPath(item.path);
    return (
      <div
        key={item.path}
        role="button"
        tabIndex={0}
        className={`browse-tab-row ${tab?.id === browseTabs.activeId ? 'active' : ''} ${tab ? 'is-open' : ''}`}
        onClick={() => openPath(item.path, item.isDir)}
        onKeyDown={(e) => { if (e.key === 'Enter') openPath(item.path, item.isDir); }}
        title={`${item.path}\n${tab ? 'Open: click to switch to it' : 'Click to open in a tab'}`}
      >
        <span className="browse-tile"><FileIcon path={item.path} isDir={item.isDir} /></span>
        <span className="browse-tab-title">{item.title}</span>
        {tab && closeButton(tab)}
      </div>
    );
  }

  function renderTabRow(tab) {
    const host = tab.url ? hostOf(tab.url) : '';
    const asleep = !tab.file && !browseTabs.live.has(tab.id);
    return (
      <div
        key={tab.id}
        role="tab"
        aria-selected={tab.id === browseTabs.activeId}
        className={`browse-tab-row is-open ${tab.id === browseTabs.activeId ? 'active' : ''} ${asleep ? 'asleep' : ''}`}
        onClick={() => browseTabs.activate(tab.id)}
        onAuxClick={(e) => { if (e.button === 1) browseTabs.close(tab.id); }}
        title={tab.file ? tab.file.path : asleep ? `${tab.url || 'New tab'}\nAsleep (reloads when opened)` : (tab.url || 'New tab')}
      >
        {tab.file
          ? <span className="browse-tile"><FileIcon path={tab.file.path} isDir={tab.file.isDir} /></span>
          : tab.url
            ? <ItemIcon item={{ url: tab.url, title: tab.title, sub: host }} />
            : <span className="browse-tile"><FontAwesomeIcon icon={faPlus} /></span>}
        <span className="browse-tab-title">{tab.title || host || 'New tab'}</span>
        {closeButton(tab)}
      </div>
    );
  }

  // Outside CoolDesk: tabs in your browsers + running apps (the Tabs face,
  // folded in). Only listened to while the Tabs list is on screen.
  const navVisible = isActive && (isSidebarWidth || (filesShown && filesTab === 'tabs'));
  const external = useExternalTabs(navVisible);
  const [showAllExternal, setShowAllExternal] = useState(false);
  const EXTERNAL_PREVIEW = 6;
  const shownExternal = showAllExternal ? external.tabs : external.tabs.slice(0, EXTERNAL_PREVIEW);

  function renderExternalTab(tab) {
    const here = tabForUrl(tab.url);
    return (
      <div
        key={`${tab.browser}-${tab.id}-${tab.url}`}
        role="button"
        tabIndex={0}
        className={`browse-tab-row ${here ? 'is-open' : ''} ${here?.id === browseTabs.activeId ? 'active' : ''}`}
        onClick={(e) => (e.metaKey || e.ctrlKey ? external.jumpToTab(tab) : pickLink(tab.url))}
        onKeyDown={(e) => { if (e.key === 'Enter') pickLink(tab.url); }}
        title={`${tab.url}\nClick: open here · ⌘-click or ↗: switch to it in ${tab.browser === 'other' ? 'your browser' : tab.browser}`}
      >
        <ItemIcon item={{ url: tab.url, title: tab.title, sub: hostOf(tab.url), favicon: tab.favIconUrl || tab.favicon }} />
        <span className="browse-tab-title">{tab.title || hostOf(tab.url)}</span>
        <button
          className="bp-btn browse-tab-close"
          onClick={(e) => { e.stopPropagation(); external.jumpToTab(tab); }}
          title={`Switch to it in ${tab.browser === 'other' ? 'your browser' : tab.browser}`}
        >
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
        </button>
      </div>
    );
  }

  function renderApp(app) {
    return (
      <div
        key={`${app.pid}-${app.hwnd || ''}-${app.tabIndex ?? ''}`}
        role="button"
        tabIndex={0}
        className="browse-tab-row is-open"
        onClick={() => external.focusApp(app)}
        onKeyDown={(e) => { if (e.key === 'Enter') external.focusApp(app); }}
        title={`${app.title || app.name}\nClick to bring it to the front`}
      >
        <span className="browse-tile">
          {app.icon ? <img src={app.icon} alt="" /> : <FontAwesomeIcon icon={faDesktop} />}
        </span>
        <span className="browse-tab-title">{app.name || app.title}</span>
      </div>
    );
  }

  // Tabs tab of the side panel (or the whole view at docked-sidebar width):
  // view switch, workspace selector, filter, open tabs, links.
  const navContent = (
    <>
      {!isSidebarWidth && (
        <div className="bp-capsule bp-modes nav-modes" role="tablist" aria-label="View">
          <button
            className={`bp-btn ${browseMode ? 'on' : ''}`}
            onClick={() => setMode('browse')}
            title="Single view: one page at a time, with tabs"
            role="tab"
            aria-selected={browseMode}
          >
            <FontAwesomeIcon icon={faWindowMaximize} /> Single
          </button>
          <button
            className={`bp-btn ${canvasMode ? 'on' : ''}`}
            onClick={() => setMode('canvas')}
            title="Multi view: pages side by side"
            role="tab"
            aria-selected={canvasMode}
          >
            <FontAwesomeIcon icon={faTableCellsLarge} /> Multi
          </button>
        </div>
      )}
        <header className="browse-head">
          <button
            className={`browse-ws ${wsPickerOpen ? 'open' : ''}`}
            onClick={() => setWsPickerOpen(v => !v)}
            title="Switch workspace"
            aria-expanded={wsPickerOpen}
          >
            <span className="browse-head-icon"><FontAwesomeIcon icon={faCompass} /></span>
            <span className="browse-ws-name">{shownWs ? shownWs.ws.name : 'No workspace'}</span>
            <FontAwesomeIcon icon={faChevronDown} className="browse-ws-caret" />
          </button>
        </header>
        {wsPickerOpen && (
          <div className="browse-ws-list" role="listbox">
            {wsWithLinks.map(({ ws, count }) => (
              <button
                key={ws.id}
                className={`browse-ws-option ${shownWs?.ws.id === ws.id ? 'active' : ''}`}
                onClick={() => setListWs(ws.id)}
                role="option"
                aria-selected={shownWs?.ws.id === ws.id}
              >
                <span className="browse-ws-dot" />
                <span>{ws.name}</span>
                <span className="browse-count">{count}</span>
              </button>
            ))}
          </div>
        )}
        <div className="browse-search">
          <FontAwesomeIcon icon={faSearch} />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search links in all workspaces"
            spellCheck={false}
          />
          {filter && <button className="browse-search-clear" onClick={() => setFilter('')} title="Clear">×</button>}
        </div>
        <div className="browse-groups">
          {filter ? (
            <>
              {groups.length === 0 && <div className="browse-hint">No links match.</div>}
              {groups.map(group => (
                <section key={group.id} className="browse-group">
                  <div className="nav-section-head"><span>{group.name}</span><span className="browse-count">{group.items.length}</span></div>
                  {group.items.map(item => (item.path
                    ? renderPinnedFile(item)
                    : renderPinnedLink(item)))}
                </section>
              ))}
            </>
          ) : (
            <>
              <section className="nav-section">
                <div className="nav-section-head">
                  <span>Pinned</span>
                  <span className="browse-count">{pinnedLinks.length + pinnedFiles.length}</span>
                </div>
                {pinnedLinks.length + pinnedFiles.length === 0 && (
                  <div className="browse-hint">Links, files and folders you add to this workspace show up here.</div>
                )}
                {pinnedLinks.map(renderPinnedLink)}
                {pinnedFiles.map(renderPinnedFile)}
              </section>
              {serverLinks.length > 0 && (
                <section className="nav-section is-servers">
                  <div className="nav-section-head"><span>Local servers</span><span className="browse-count">{serverLinks.length}</span></div>
                  {serverLinks.map(renderPinnedLink)}
                </section>
              )}
              {browseMode && (
                <section className="nav-section">
                  <div className="nav-section-head">
                    <span>Open tabs</span>
                    <span className="browse-count">{looseTabs.length}</span>
                    <span className="nt-grow" />
                    <button className="bp-btn browse-tabs-new" onClick={newTab} title="New tab (⌘T)">
                      <FontAwesomeIcon icon={faPlus} />
                    </button>
                  </div>
                  {looseTabs.map(renderTabRow)}
                </section>
              )}
              {external.tabs.length > 0 && (
                <section className="nav-section">
                  <div className="nav-section-head">
                    <span>In your browsers</span>
                    <span className="browse-count">{external.tabs.length}</span>
                  </div>
                  {shownExternal.map(renderExternalTab)}
                  {external.tabs.length > EXTERNAL_PREVIEW && (
                    <button className="nav-more" onClick={() => setShowAllExternal(v => !v)}>
                      {showAllExternal ? 'Show fewer' : `Show all ${external.tabs.length}`}
                    </button>
                  )}
                </section>
              )}
              {external.apps.length > 0 && (
                <section className="nav-section">
                  <div className="nav-section-head">
                    <span>Apps</span>
                    <span className="browse-count">{external.apps.length}</span>
                  </div>
                  {external.apps.map(renderApp)}
                </section>
              )}
            </>
          )}
        </div>
    </>
  );

  return (
    <div className={`browse-view ${isSidebarWidth ? 'browse-narrow' : ''}`}>
      {/* Docked sidebar width: no room for a page, so the links fill it. */}
      {isSidebarWidth && <aside className="browse-list">{navContent}</aside>}

      {!isSidebarWidth && (
        <main className="browse-pane">
          <div className={`browse-mode ${browseMode ? '' : 'is-hidden'}`}>
            {/* One live page per awake tab; inactive ones stay loaded but hidden. */}
            {browseTabs.tabs.filter(tab => tab.file || browseTabs.live.has(tab.id)).map(tab => {
              const isCurrent = tab.id === browseTabs.activeId;
              if (tab.file) {
                return (
                  <div key={tab.id} className={`browse-tabpane ${isCurrent ? '' : 'is-hidden'}`}>
                    <FileTab
                      file={tab.file}
                      active={isActive && browseMode && isCurrent}
                      onOpenFile={(path) => browseTabs.openFileTab(path, false)}
                      onShowInFiles={showInFiles}
                      toolbarStart={toolbarStart}
                      toolbarEnd={toolbarEnd}
                    />
                  </div>
                );
              }
              return (
                <div key={tab.id} className={`browse-tabpane ${isCurrent ? '' : 'is-hidden'}`}>
                  <BrowserPane
                    paneId={tabPaneId(tab.id)}
                    url={tab.req.url}
                    requestKey={tab.req.key}
                    active={isActive && browseMode && isCurrent}
                    onNavigate={(url, opts) => handleNavigate(tab.id, url, opts)}
                    onTitle={(title) => browseTabs.noteTitle(tab.id, title)}
                    onTools={setPageTools}
                    onOpenPath={openPath}
                    focusAddressKey={isCurrent ? focusAddress : 0}
                    findKey={isCurrent ? findKey : 0}
                    toolbarStart={toolbarStart}
                    toolbarEnd={toolbarEnd}
                    emptyState={home ? (
                      <div className="home-pane">{home}</div>
                    ) : (
                      <div className="browse-hero">
                        <div className="browse-hero-orb"><FontAwesomeIcon icon={faCompass} /></div>
                        <h2>Browse without leaving CoolDesk</h2>
                        <p>Pick a link, or type a URL or search above. ⌘T opens a new tab.</p>
                        {quickPicks.length > 0 && (
                          <div className="browse-hero-picks">
                            {quickPicks.map(item => (
                              <button key={item.url} className="browse-chip" onClick={() => openUrl(item.url)} title={item.url}>
                                <ItemIcon item={item} />
                                <span>{item.title}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  />
                </div>
              );
            })}
          </div>
          {canvasVisited && (
            <div className={`browse-mode ${canvasMode ? '' : 'is-hidden'}`}>
              <CanvasView
                tiles={tiles}
                onChange={changeTiles}
                active={isActive && canvasMode}
                onAddUrl={addToCanvas}
                onOpenInBrowse={openInBrowse}
                quickPicks={quickPicks}
                toolbarStart={toolbarStart}
                toolbarEnd={toolbarEnd}
              />
            </div>
          )}
        </main>
      )}

      {filesVisited && !isSidebarWidth && (
        <>
          {filesShown && <div className="browse-divider files-divider" onPointerDown={startFilesResize} />}
          <aside className={`browse-files ${filesShown ? '' : 'is-hidden'}`} style={{ width: filesWidth }}>
            <FilesView
              path={filesPath}
              onPathChange={showFolder}
              active={filesShown && isActive}
              onClose={() => setFilesOpen(false)}
              tab={filesTab}
              onTab={setFilesTab}
              onHome={home ? goHome : null}
              homeShown={!activeTab.url && !activeTab.file}
              shelf={shelf}
              nav={navContent}
              notesUrl={pageUrl}
              notesPaneId={tabPaneId(browseTabs.activeId)}
              onOpen={openPath}
              page={{
                tools: browseMode && !activeTab.file ? pageTools : null,
                pages: openPages,
                totals: { memory: pagesMemory, cpu: pagesCpu, app: stats?.app_memory },
                onClosePage: (p) => (p.tabId ? browseTabs.close(p.tabId) : changeTiles(compact(tiles.filter(t => t.id !== p.tileId)))),
              }}
            />
          </aside>
        </>
      )}
    </div>
  );
}
