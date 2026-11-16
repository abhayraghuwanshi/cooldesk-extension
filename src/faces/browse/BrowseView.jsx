import { faBookmark, faCompass, faPlay, faPen, faTrashCan, faDiagramProject, faFolder, faFolderOpen, faGear, faGripVertical, faGlobe, faHouse, faNoteSticky, faPowerOff, faRotateRight, faThumbtack, faPlus, faTerminal, faExpand, faCompress, faSearch, faServer, faTableCellsLarge, faTableColumns, faWindowMaximize, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserPane } from '../../features/browser/BrowserPane';
import { normalizeAddress } from '../../features/browser/useNativePane';
import { engineFor, fetchWebSuggestions, getEngineKey, getWebSuggestEnabled, searchUrl } from '../../shared/searchEngines';
import { usePaneGuard } from '../../features/browser/usePaneGuard';
import { UsageMeter } from '../../features/browser/UsageMeter';
import { FilesView } from './FilesView';
import { FileIcon, FileTab } from './FileTab';
import { NoteTab } from './NoteTab';
import { SpecialTab } from './SpecialTab';
import { ToolbarMenu } from './ToolbarMenu';
import { TerminalTab } from '../../features/terminal/TerminalTab';
import { registerTerminalHost, useSpotlightRuns } from '../../features/terminal/runInTerminal';
import { WorkspaceContextPanel } from '../workspace/WorkspaceList';
import { clipSummary, saveClipToWorkspace } from '../../features/browser/clipToNote';
import { addUrlToWorkspace, saveWorkspace } from '../../db/index.js';
import { useShelf } from '../../features/shelf/useShelf';
import { SPECIAL_TITLES, tabPaneId, useBrowseTabs } from './useBrowseTabs';
import { isPrimaryWindow, readWindowValue, windowKey } from '../../features/dock/surface';
import { defaultLayout, dockTile, evenSplit, hitDock, layoutRects, reconcile, setSplitSizes, splitSizes } from './multiLayout';
import { getFaviconUrl } from '../../utils/helpers.js';
import { useIsSidebarWidth } from '../../shared/hooks/useIsSidebarWidth.js';
import { fetchLocalServers, stopLocalServer } from '../../shared/devServers';
import { guessStartCommand, runningServerFor } from '../../shared/savedServers';
import { runInTerminal } from '../../features/terminal/runInTerminal';
import { stackLogo, useFolderIdentity } from '../../shared/hooks/useFolderIdentity.js';
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
const DRAWER_KEY = 'cooldesk.browse.drawer';
const DRAWER_H_KEY = 'cooldesk.browse.drawerHeight';
const DRAWER_H_DEFAULT = 260;
const DRAWER_H_MIN = 120;
const FILES_WIDTH_DEFAULT = 380;
const FILES_WIDTH_MIN = 300;
const FILES_WIDTH_MAX = 1200;
// The main view keeps at least this much when the panel is dragged wider
// (CSS caps it the same way when the window shrinks: .browse-files).
const MAIN_MIN = 380;

function parentDir(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}
const LIST_WS_KEY = 'cooldesk.browse.workspace';
const MULTI_LAYOUT_KEY = 'cooldesk.browse.multiLayout';
const WS_CONTEXT_KEY = 'cooldesk.browse.workspaceContext';
// Home: how many rows a section shows before "+N more".
const HOME_CAP = { tabs: 8, pinned: 6, folders: 8, servers: 5 };
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

/**
 * New tab: the dev servers running on this machine (localhost ports), one
 * click to open. Asks for a fresh port list when it appears, so a server you
 * just started shows up without waiting for the background poll.
 */
/** A local server's tile: its project's stack logo, else a folder. */
function ServerIcon({ stack }) {
  const [failed, setFailed] = useState(false);
  const logo = failed ? null : stackLogo(stack);
  return (
    <span className="browse-tile server-tile">
      {logo
        ? <img className={logo.invert ? 'is-inverted' : ''} src={logo.src} alt="" onError={() => setFailed(true)} />
        : <FontAwesomeIcon icon={faFolderOpen} />}
    </span>
  );
}

/** ":5173" with a live dot, as on the dock's folder tiles. */
function ServerPort({ port }) {
  return <span className="server-port"><i />:{port}</span>;
}

function LocalServerPicks({ servers, onOpen, onRefresh }) {
  useEffect(() => { onRefresh(); }, [onRefresh]);
  if (!servers.length) return null;
  return (
    <div className="browse-hero-servers">
      <div className="browse-hero-label">Running on this Mac</div>
      <div className="browse-hero-picks">
        {servers.map(item => (
          <button key={item.url} className="browse-chip browse-server-chip" onClick={() => onOpen(item.url)} title={`${item.title} — ${item.url}${item.dir ? `\n${item.dir}` : ''}`}>
            <ServerIcon stack={item.stack} />
            <span className="browse-chip-main">{item.title}</span>
            <ServerPort port={item.port} />
          </button>
        ))}
      </div>
    </div>
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

const IS_MAC_UI = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
// Most tabs multi view shows side by side.
const MULTI_MAX = 6;
const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);
// A blank tab: a new tab's start screen (not a page, file or terminal).
const isBlank = (t) => !t.url && !t.file && !t.term && !t.note && !t.special;
// A tile's name while it's being moved.
const tileLabel = (t) => t.title
  || (t.special && SPECIAL_TITLES[t.special])
  || (t.file && t.file.path.split(/[/\\]/).filter(Boolean).pop())
  || (t.term && 'Shell')
  || (t.note && 'Note')
  || (t.url && hostOf(t.url))
  || 'New tab';

/**
 * Left: only what you're looking at (a page, file, folder or terminal).
 * Right: the side panel — Home (this view's tabs, the workspace's links,
 * folders, widgets) and Page (page controls, notes, the Shelf). Only what
 * opens in here: running apps and your browsers' tabs are the sidebar's,
 * the dock's and the spotlight's.
 *
 * @param onSelectWorkspace (id) → make a workspace current (picked in the panel)
 * @param homeExtras  in the panel's Home tab, between Folders and Apps
 *                    (CoolDeskContainer passes the widgets and dev servers)
 */
export function BrowseView({ savedWorkspaces = [], activeWorkspaceId, onSelectWorkspace, isActive, homeExtras = null, appControls = null, renderSettings = null }) {
  const isSidebarWidth = useIsSidebarWidth();
  // Tabs (useBrowseTabs): each is its own live page; the single page Browse
  // used to show becomes the first tab.
  const browseTabs = useBrowseTabs(localStorage.getItem(LAST_URL_KEY));
  // Pane events (pop-ups, shortcuts, clips) reach every CoolDesk window; with
  // several full-app windows open, each acts only on its own tabs' panes.
  const ownPanes = useRef(new Set());
  ownPanes.current = new Set(browseTabs.tabs.map(t => `browser-pane-${tabPaneId(t.id)}`));
  // For the 'cooldesk-browse' listener, which is registered once.
  const openSpecialTabRef = useRef(browseTabs.openSpecialTab);
  openSpecialTabRef.current = browseTabs.openSpecialTab;
  const activeTab = browseTabs.active;
  // What the active tab is actually showing (follows in-page navigation) —
  // the Notes tab lists this page's highlights.
  const pageUrl = activeTab.url;
  // Bumped to focus the active tab's address bar (⌘T / ⌘L) / open find (⌘F).
  const [focusAddress, setFocusAddress] = useState(0);
  const [findKey, setFindKey] = useState(0);
  const [filter, setFilter] = useState('');
  // Terminal tabs that asked for you while off screen (a bell / notification
  // escape — an agent waiting on a prompt): a dot on the tab's row.
  const [termAttention, setTermAttention] = useState(() => new Set());
  const noteAttention = useCallback((id, on) => setTermAttention(prev => {
    if (prev.has(id) === on) return prev;
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);
  // Home's search, like the address bar: search suggestions from the engine
  // picked in Settings (only while Settings → Search suggestions is on), for
  // text that reads as a search rather than an address.
  const [webSuggest, setWebSuggest] = useState({ term: '', list: [] });
  useEffect(() => {
    const term = filter.trim();
    const isSearch = term.length >= 2 && normalizeAddress(term) === searchUrl(getEngineKey(), term);
    if (!isSearch || !getWebSuggestEnabled()) {
      setWebSuggest({ term: '', list: [] });
      return undefined;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetchWebSuggestions(getEngineKey(), term, { signal: ctrl.signal, max: 4 })
        .then(list => { if (!ctrl.signal.aborted) setWebSuggest({ term, list }); });
    }, 150);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [filter]);
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
    // Not from a terminal or a text field: there Esc is the program's
    // (Claude Code's interrupt, vim, the address bar's revert) — capturing it
    // here meant it never arrived. ⌘⇧F / the toolbar button leave instead.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const t = e.target;
      if (t instanceof Element && t.closest('.term-host, input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
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



  // Single view (one tab at a time) or multi view ('canvas': the open tabs
  // side by side — see `multiTabs`).
  const [mode, setModeState] = useState(() => {
    const stored = localStorage.getItem(MODE_KEY);
    return MODES.includes(stored) ? stored : 'browse';
  });
  const setMode = useCallback((next) => {
    setModeState(next);
    persist(MODE_KEY, next);
  }, []);
  const canvasMode = mode === 'canvas' && !isSidebarWidth;
  const browseMode = !canvasMode;


  // A terminal in the folder you're looking at (a folder tab, or a file
  // tab's folder), else in your home folder. From Home it takes that tab.
  const openTerminal = useCallback((cwd) => {
    // Multi view stays: the new terminal joins the tiles.
    const here = browseTabs.active;
    const dir = cwd || (here.file ? (here.file.isDir ? here.file.path : parentDir(here.file.path)) : here.term?.cwd) || null;
    browseTabs.openTerminalTab(dir, isBlank(here));
  }, [browseTabs]);

  // Project commands (.cooldesk commands, the file manager's run buttons)
  // open here as terminal tabs while Browse is up (runInTerminal.js).
  // Spotlight's "> cmd" passes `here` (start in the active tab's folder) and
  // `fresh` (run again even if that command already has a tab).
  useEffect(() => registerTerminalHost(({ command, cwd, label, here = false, fresh = false }) => {
    if (mode !== 'browse') setMode('browse');
    const at = browseTabs.active;
    const dir = cwd || (here ? (at.file ? (at.file.isDir ? at.file.path : parentDir(at.file.path)) : at.term?.cwd) : null) || null;
    browseTabs.openTerminalTab(dir, false, { run: command, title: label || command, fresh });
  }), [browseTabs, mode, setMode]);
  // Primary window only: Rust shows "main" for a spotlight run, and an extra
  // New Window would race it for the same command.
  useSpotlightRuns(isPrimaryWindow());

  // Browser shortcuts. Keys typed while the page itself has focus never reach
  // this document; the page tools (tools.js, isolated world) forward these
  // same combos as `browser-pane-shortcut` events. Not ⌘W: the macOS menu's
  // Close Window owns it and would close CoolDesk first.
  const drawerToggleRef = useRef(null); // set once the drawer is defined below
  const shortcutRef = useRef(null);
  shortcutRef.current = (key) => {
    const pane = tabPaneId(browseTabs.activeId);
    const nav = (action) => import('@tauri-apps/api/core').then(({ invoke }) => invoke('browser_pane_nav', { id: pane, action })).catch(() => { });
    switch (key) {
      case 'mod+t': newTab(); return true;
      case 'toggle-terminal': drawerToggleRef.current?.(); return true;
      case 'mod+l': setFocusAddress(k => k + 1); return true;
      // A file tab steps through the tab's own Back / Forward; a page
      // through its own history.
      case 'mod+[': if (!browseTabs.active.file || !browseTabs.step(-1)) nav('back'); return true;
      case 'mod+]': if (!browseTabs.active.file || !browseTabs.step(1)) nav('forward'); return true;
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
      else if (e.ctrlKey && !e.metaKey && e.key === '`') key = 'toggle-terminal';
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
        if (payload?.label?.includes('browser-pane-bt-') && ownPanes.current.has(payload.label)) shortcutRef.current(payload.key);
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
        if (!ownPanes.current.has(payload?.label)) return;
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

  // 🏠: Home lives in the side panel, so it never covers what's on the left.
  const goHome = useCallback(() => {
    setFilesTab('tabs');
    setFilesOpen(true);
  }, [setFilesTab, setFilesOpen]);
  const goHomeRef = useRef(goHome);
  goHomeRef.current = goHome;
  const homeShown = filesShown && filesTab === 'tabs';


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
    // Never wider than leaves the main view MAIN_MIN to work with.
    const room = (e.currentTarget.parentElement?.clientWidth || window.innerWidth) - MAIN_MIN;
    const max = Math.max(FILES_WIDTH_MIN, Math.min(FILES_WIDTH_MAX, room));
    // Panel is on the right: dragging left widens it.
    const onMove = (ev) => setFilesWidth(Math.min(max, Math.max(FILES_WIDTH_MIN, start - (ev.clientX - startX))));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persist(FILES_WIDTH_KEY, String(filesWidthRef.current));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Last folder browsed, else Home (the first of get_user_places): where
  // Home's Files button opens and the shell drawer starts.
  const [filesPath, setFilesPath] = useState(() => localStorage.getItem(FILES_PATH_KEY) || '');
  useEffect(() => {
    if (filesPath) return;
    let cancelled = false;
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('get_user_places'))
      .then(places => { if (!cancelled && places?.[0]?.path) setFilesPath(places[0].path); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [filesPath]);
  // A folder opens as a tab in the main view, with the full file manager
  // (FileTab) — files live in the main window, not the side panel. `inPlace`:
  // in the current tab (moving between folders, or a blank tab).
  const showFolder = useCallback((dir, inPlace = false) => {
    if (!dir) return;
    setFilesPath(dir);
    persist(FILES_PATH_KEY, dir);
    browseTabs.openFileTab(dir, true, inPlace || isBlank(browseTabs.active));
  }, [browseTabs]);
  // Terminal drawer: under whatever is on the left, full width, like an
  // editor's bottom panel. Ctrl+` shows / hides it; hiding keeps the shell
  // running. It starts (once) in the folder you're looking at.
  const [drawerOpen, setDrawerOpenState] = useState(() => localStorage.getItem(DRAWER_KEY) === 'true');
  const [drawerCwd, setDrawerCwd] = useState(null); // null until first shown
  const [drawerH, setDrawerH] = useState(() => {
    const h = Number(localStorage.getItem(DRAWER_H_KEY));
    return h >= DRAWER_H_MIN ? h : DRAWER_H_DEFAULT;
  });
  const drawerHRef = useRef(drawerH);
  drawerHRef.current = drawerH;
  const contextDir = () => {
    const here = browseTabs.active;
    if (here.file) return here.file.isDir ? here.file.path : parentDir(here.file.path);
    return here.term?.cwd || filesPath || '';
  };
  const setDrawerOpen = (open) => {
    if (open && drawerCwd === null) setDrawerCwd(contextDir());
    setDrawerOpenState(open);
    persist(DRAWER_KEY, String(open));
  };
  drawerToggleRef.current = () => setDrawerOpen(!drawerOpen);
  // Open at launch (remembered): start it in the home folder.
  useEffect(() => {
    if (drawerOpen && drawerCwd === null) setDrawerCwd('');
  }, [drawerOpen, drawerCwd]);
  const startDrawerResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const start = drawerHRef.current;
    const max = Math.max(DRAWER_H_MIN, window.innerHeight * 0.75);
    // Drawer is at the bottom: dragging up makes it taller.
    const onMove = (ev) => setDrawerH(Math.round(Math.min(max, Math.max(DRAWER_H_MIN, start - (ev.clientY - startY)))));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persist(DRAWER_H_KEY, String(drawerHRef.current));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // From a file tab: its folder, as a tab.
  const showInFiles = useCallback((path) => {
    showFolder(parentDir(path));
  }, [showFolder]);

  // A file or folder (address bar, Files tab, Shelf, workspace): open it as
  // a tab in the main view — the one place things are previewed.
  // Folders too: a folder tab is the file manager.
  const openPath = useCallback((path, isDir) => {
    if (isDir) {
      showFolder(path);
      return;
    }
    // In the current tab, like following a link: Back returns to it.
    browseTabs.openFileTab(path, false, true);
  }, [browseTabs, showFolder]);

  // Navigation from elsewhere in CoolDesk (slash commands, workspace jumps,
  // onboarding) — what used to switch faces: Home, or the panel's Tabs tab.
  useEffect(() => {
    const onNavigate = (e) => {
      const to = e.detail?.to;
      if (to === 'home') goHomeRef.current?.();
      else if (to === 'folder' && e.detail.path) {
        showFolder(e.detail.path);
      }
      else if (to === 'tabs') {
        setFilesTab('tabs');
        setFilesOpen(true);
      }
      else if (to === 'activity' || to === 'settings') {
        // Cool Activity (Ctrl+Shift+G) and Settings open as tabs (in multi
        // view, as another tile).
        openSpecialTabRef.current?.(to);
      }
    };
    window.addEventListener('cooldesk-browse', onNavigate);
    return () => window.removeEventListener('cooldesk-browse', onNavigate);
  }, [showFolder, setFilesTab, setFilesOpen]);

  // A link from the list: switches to its tab if it's already open, loads in
  // the current tab if that one is blank, otherwise opens a new tab (so the
  // page you're on isn't replaced). ⌘-click replaces the current tab instead.
  // In multi view a new tab is a new tile.
  const pickLink = useCallback((url, replaceCurrent = false) => {
    if (replaceCurrent || isBlank(activeTab)) openUrl(url);
    else {
      const open = browseTabs.findByUrl(url);
      if (open) browseTabs.activate(open.id);
      else openUrl(url, { newTab: true });
    }
  }, [openUrl, activeTab, browseTabs]);

  // Multi view: the open tabs side by side — web pages, terminals, files,
  // notes, Activity/Settings — up to MULTI_MAX, in tab order (the current
  // tab always among them). They're the tabs' own panes laid out in a grid,
  // not copies: nothing reloads, and a terminal keeps its shell.
  const multiTabs = useMemo(() => {
    if (!canvasMode) return null;
    const open = browseTabs.tabs.filter(t => !isBlank(t) && (t.file || t.term || t.note || t.special || browseTabs.live.has(t.id)));
    let list = open.slice(0, MULTI_MAX);
    // The current tab even when blank: a new tab (⌘T) is a tile you type in.
    const current = browseTabs.tabs.find(t => t.id === browseTabs.activeId);
    if (current && !list.includes(current)) list = [...list.slice(0, MULTI_MAX - 1), current];
    return list;
  }, [canvasMode, browseTabs.tabs, browseTabs.live, browseTabs.activeId]);
  const tiledIds = useMemo(() => new Set((multiTabs || []).map(t => t.id)), [multiTabs]);
  const tiledKey = (multiTabs || []).map(t => t.id).join(',');

  // Where the tiles go: a split tree (multiLayout.js). Until you rearrange
  // anything it's the automatic grid; once you drag a tile or a divider it
  // is your layout, kept as is (new tabs split the biggest tile) until
  // "Auto-arrange".
  const [savedLayout, setSavedLayout] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(MULTI_LAYOUT_KEY) || 'null');
      return s && typeof s === 'object' ? s : { custom: false, root: null };
    } catch { return { custom: false, root: null }; }
  });
  const multiLayout = useMemo(() => {
    const ids = tiledKey ? tiledKey.split(',') : [];
    if (!savedLayout.custom) return defaultLayout(ids);
    return reconcile(savedLayout.root, ids, window.innerWidth / Math.max(1, window.innerHeight));
  }, [savedLayout, tiledKey]);
  const multiRects = useMemo(() => layoutRects(multiLayout), [multiLayout]);
  const multiLayoutRef = useRef(multiLayout);
  multiLayoutRef.current = multiLayout;
  const multiGridRef = useRef(null);
  // The pages are native layers: nudge them to their new spots right away
  // rather than at their usual poll.
  const nudgePanes = () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  const commitLayout = useCallback((root, { save = true } = {}) => {
    const next = { custom: true, root };
    setSavedLayout(next);
    if (save) persist(MULTI_LAYOUT_KEY, JSON.stringify(next));
  }, []);
  const autoArrange = () => {
    const next = { custom: false, root: null };
    setSavedLayout(next);
    persist(MULTI_LAYOUT_KEY, JSON.stringify(next));
    nudgePanes();
  };

  // Drag a divider: the two tiles either side of it trade size; the rest
  // stay put. Double-click evens that split out.
  const startMultiResize = (div) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const grid = multiGridRef.current;
    if (!grid) return;
    const horizontal = div.dir === 'row';
    const total = (horizontal ? grid.clientWidth : grid.clientHeight) * div.extent;
    const start = horizontal ? e.clientX : e.clientY;
    const base = multiLayoutRef.current;
    const fr = [...splitSizes(base, div.path)];
    const sum = fr.reduce((a, b) => a + b, 0);
    const min = (sum / fr.length) * 0.25;
    const i = div.index;
    let latest = base;
    let frame = 0;
    document.documentElement.classList.add(horizontal ? 'multi-resizing-x' : 'multi-resizing-y');
    const onMove = (ev) => {
      const d = (((horizontal ? ev.clientX : ev.clientY) - start) / Math.max(1, total)) * sum;
      const pair = fr[i] + fr[i + 1];
      const a = Math.min(pair - min, Math.max(min, fr[i] + d));
      latest = setSplitSizes(base, div.path, fr.map((v, j) => (j === i ? a : j === i + 1 ? pair - a : v)));
      commitLayout(latest, { save: false });
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; window.dispatchEvent(new Event('resize')); });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.documentElement.classList.remove('multi-resizing-x', 'multi-resizing-y');
      commitLayout(latest);
      nudgePanes();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const evenMultiSplit = (div) => () => {
    commitLayout(evenSplit(multiLayoutRef.current, div.path));
    nudgePanes();
  };

  // Drag a tile by its grip: drop it on another tile's edge to put it on
  // that side, on its middle to swap the two, or along the edge of the whole
  // view to give it a full-height column / full-width row. Esc cancels.
  // While dragging, a layer covers the tiles (so the native pages step aside
  // and the drag isn't swallowed by them) and shows where it will land.
  const [tileDrag, setTileDrag] = useState(null); // { id, x, y, drop }
  const startTileDrag = (id) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    let drop = null;
    const hit = (cx, cy) => {
      const grid = multiGridRef.current;
      if (!grid) return null;
      const r = grid.getBoundingClientRect();
      const px = cx - r.left;
      const py = cy - r.top;
      if (px < 0 || py < 0 || px > r.width || py > r.height) return null;
      const EDGE = 22;
      const edges = { left: px, right: r.width - px, top: py, bottom: r.height - py };
      const near = Object.keys(edges).reduce((a, b) => (edges[b] < edges[a] ? b : a));
      return hitDock(multiLayoutRef.current, id, px / r.width, py / r.height, edges[near] < EDGE ? near : null);
    };
    const onMove = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        started = true;
        document.documentElement.classList.add('multi-dragging');
      }
      drop = hit(ev.clientX, ev.clientY);
      setTileDrag({ id, x: ev.clientX, y: ev.clientY, drop });
    };
    const end = (apply) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      document.documentElement.classList.remove('multi-dragging');
      setTileDrag(null);
      if (apply && started && drop) {
        commitLayout(dockTile(multiLayoutRef.current, id, drop.target, drop.side));
      }
      nudgePanes();
    };
    const onUp = () => end(true);
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(false); } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  };
  // Where the dragged tile would land, as a rect of the container.
  const dropPreview = useMemo(() => {
    if (!tileDrag?.drop) return null;
    const { target, side } = tileDrag.drop;
    if (side === 'center') return multiRects.tiles.get(target) || null;
    return layoutRects(dockTile(multiLayout, tileDrag.id, target, side)).tiles.get(tileDrag.id) || null;
  }, [tileDrag, multiLayout, multiRects]);
  // A rect as absolute position, inset by half the gap between tiles.
  const rectStyle = (r) => ({
    position: 'absolute',
    left: `calc(${r.x * 100}% + 5px)`,
    top: `calc(${r.y * 100}% + 5px)`,
    width: `calc(${r.w * 100}% - 10px)`,
    height: `calc(${r.h * 100}% - 10px)`,
  });

  // Live memory/CPU of every in-app page (browser_pane/stats.rs), shown in
  // the side panel's Page tab; the same poll lets the pane guard put
  // background tabs to sleep before they slow the Mac down. Each page is its
  // own WebKit process.
  const [pageTools, setPageTools] = useState(null);
  const pageTabShown = isActive && filesShown && filesTab === 'page';
  const activeIsPage = !activeTab.file && !activeTab.term && !activeTab.note && !activeTab.special;
  const { stats, heavyPaneId, dismissHeavy } = usePaneGuard({
    browseTabs,
    paneIdOf: tabPaneId,
    shownPaneId: isActive && activeIsPage ? tabPaneId(browseTabs.activeId) : null,
    tiledTabIds: isActive && canvasMode ? tiledIds : null,
    enabled: browseTabs.tabs.some(t => browseTabs.live.has(t.id) && (t.url || t.req.url)),
    meterShown: pageTabShown,
    onScreen: isActive,
    // The toolbar's usage meter shows CoolDesk's own cost even with no page open.
    alwaysPoll: isActive && !!appControls,
  });

  const openPages = useMemo(() => {
    if (!stats) return [];
    const tabFor = (id) => browseTabs.tabs.find(t => tabPaneId(t.id) === id);
    const urlFor = (id) => tabFor(id)?.url;
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
          tabId: p.id.startsWith('bt-') ? tabFor(p.id)?.id : null,
          label: tabFor(p.id)?.title || (url ? describeLink(url).title : p.id),
          where: 'Tab',
        };
      })
      .sort((a, b) => (b.memory || 0) - (a.memory || 0));
  }, [stats, browseTabs.tabs]);
  const pagesMemory = openPages.reduce((n, p) => n + (p.shared ? 0 : p.memory || 0), 0);
  // Percent of one core, summed across page processes (so it can pass 100%).
  const pagesCpu = openPages.reduce((n, p) => n + (p.shared ? 0 : p.cpu || 0), 0);

  // Local dev servers, only polled while this face is on screen. A new
  // tab's start screen also asks for a fresh list (at most every few
  // seconds — the scan shells out to lsof and ps). Same source as the
  // dock's folder tiles and the Local tab (sidecar /local/servers), so they
  // all agree on what's running.
  const portsAt = useRef(0);
  const loadPorts = useCallback(async ({ force = false } = {}) => {
    if (!force && Date.now() - portsAt.current < 4000) return;
    portsAt.current = Date.now();
    try {
      setPorts(await fetchLocalServers());
    } catch {
      setPorts([]);
    }
  }, []);
  const refreshPorts = useCallback(() => { loadPorts(); }, [loadPorts]);
  useEffect(() => {
    if (!isActive) return;
    loadPorts({ force: true });
    const timer = setInterval(() => loadPorts({ force: true }), PORTS_POLL_MS);
    return () => clearInterval(timer);
  }, [isActive, loadPorts]);

  // Stopping a server: the first click arms it (for a few seconds), the
  // second kills whatever listens on that port.
  const [stopArmed, setStopArmed] = useState(null);
  const stopServer = async (port) => {
    if (stopArmed !== port) {
      setStopArmed(port);
      setTimeout(() => setStopArmed(p => (p === port ? null : p)), 3000);
      return;
    }
    setStopArmed(null);
    try {
      await stopLocalServer(port);
      setPorts(list => list.filter(p => p.port !== port));
    } catch (err) {
      console.warn('[Browse] stopping the server on port', port, 'failed:', err);
    }
    loadPorts({ force: true });
  };

  // Groups: local servers, then the active workspace, then the rest.
  // Which workspace's links the list shows: one at a time (follows the
  // workspace opened elsewhere in CoolDesk, else the last pick), or 'all'.
  // Typing in the filter always searches every workspace.
  const [listWs, setListWsState] = useState(() => readWindowValue(LIST_WS_KEY) || activeWorkspaceId || '');
  // Notes, to-dos & commands: folded behind the Notes button in Home's
  // header until asked for (the panel is tall).
  const [wsContextOpen, setWsContextOpenState] = useState(() => localStorage.getItem(WS_CONTEXT_KEY) === 'true');
  // Home sections the user expanded past their cap (this session).
  const [homeMore, setHomeMore] = useState({});
  const setWsContextOpen = (open) => {
    setWsContextOpenState(open);
    persist(WS_CONTEXT_KEY, String(open));
  };
  const setListWs = (id) => {
    setListWsState(id);
    persist(windowKey(LIST_WS_KEY), id);
    // The panel's pick is the app's current workspace too — otherwise the
    // next launch (which restores that one) would switch the panel back.
    onSelectWorkspace?.(id);
  };
  useEffect(() => { if (activeWorkspaceId) setListWsState(activeWorkspaceId); }, [activeWorkspaceId]);
  const isFileItem = (a) => (a?.appType === 'file' || a?.appType === 'folder') && a.path;
  const wsWithLinks = useMemo(() => savedWorkspaces
    .map(ws => ({
      ws,
      count: (ws.urls || []).filter(u => isWebUrl(u?.url)).length + (ws.apps || []).filter(isFileItem).length + (ws.shells || []).length + (ws.servers || []).length,
    })), [savedWorkspaces]);
  // One workspace at a time (the rest stay out of the way, one pick away).
  // Every workspace is listed — the current one shows even before it has
  // links (with a hint), rather than Home silently falling back to another.
  const shownWs = wsWithLinks.find(x => x.ws.id === listWs)
    || wsWithLinks.find(x => x.count > 0) || wsWithLinks[0] || null;

  // Clips from a page (Page → Clip): saved as a note in the workspace shown
  // here, with a toast that leads to it.
  const clipWsRef = useRef(null);
  clipWsRef.current = shownWs?.ws || savedWorkspaces.find(w => w.id === activeWorkspaceId) || null;
  const [clipToast, setClipToast] = useState(null); // { text, error? }
  useEffect(() => {
    if (!clipToast) return undefined;
    const t = setTimeout(() => setClipToast(null), 5000);
    return () => clearTimeout(t);
  }, [clipToast]);
  useEffect(() => {
    let off = null;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('browser-pane-clip', async ({ payload }) => {
        const ws = clipWsRef.current;
        if (!payload || !ownPanes.current.has(payload.label)) return;
        if (!ws) {
          setClipToast({ error: true, text: 'Pick a workspace in Home first — clips are saved to its notes.' });
          return;
        }
        try {
          await saveClipToWorkspace(payload, ws);
          setClipToast({ text: `${clipSummary(payload)} saved to ${ws.name} › Notes` });
        } catch (err) {
          setClipToast({ error: true, text: `Couldn’t save the clip — ${err?.message || err}` });
        }
      }))
      .then(fn => { if (cancelled) fn(); else off = fn; });
    return () => { cancelled = true; off?.(); };
  }, []);

  // Save web tabs as links in the workspace shown in Home (the same one clips
  // go to), so they come back with the workspace. Already-saved URLs are
  // skipped. addUrlToWorkspace doesn't broadcast, so announce the change
  // ourselves — App reloads savedWorkspaces and the Pinned list updates.
  const savedUrls = new Set((clipWsRef.current?.urls || []).map(u => u?.url).filter(Boolean));
  const saveTabsToWorkspace = useCallback(async (tabsToSave) => {
    const ws = clipWsRef.current;
    if (!ws) {
      setClipToast({ error: true, text: 'Pick a workspace in Home first: links are saved to it.' });
      return;
    }
    const have = new Set((ws.urls || []).map(u => u?.url).filter(Boolean));
    const fresh = [];
    for (const t of tabsToSave) {
      if (isWebUrl(t.url) && !have.has(t.url)) { have.add(t.url); fresh.push(t); }
    }
    if (fresh.length === 0) {
      setClipToast({ info: true, text: tabsToSave.length === 1 ? `Already saved in ${ws.name}` : `All these tabs are already saved in ${ws.name}` });
      return;
    }
    let saved = 0;
    let lastError = null;
    for (const t of fresh) {
      const res = await addUrlToWorkspace(t.url, ws.id, { title: t.title || hostOf(t.url) });
      if (res?.success === false) lastError = res.error; else saved += 1;
    }
    try {
      const bc = new BroadcastChannel('ws_db_changes');
      bc.postMessage({ type: 'workspacesChanged' });
      bc.close();
    } catch { /* no BroadcastChannel: the list catches up on the next reload */ }
    if (saved === 0) {
      setClipToast({ error: true, text: `Couldn’t save to ${ws.name}: ${lastError?.message || lastError || 'unknown error'}` });
    } else {
      const what = saved === 1 ? (fresh[0].title || hostOf(fresh[0].url)) : `${saved} tabs`;
      setClipToast({ link: true, text: `${what} saved to ${ws.name}${lastError ? ` (${fresh.length - saved} failed)` : ''}` });
    }
  }, []);

  // Remove a saved link from the workspace shown in Home — the same
  // remove_url action the workspace editor uses (saveWorkspace broadcasts,
  // so App reloads savedWorkspaces and the row disappears). An open tab for
  // it stays open; it just moves back to the plain Tabs list.
  const removeLinkFromWorkspace = useCallback(async (url, title) => {
    const ws = clipWsRef.current;
    if (!ws || !url) return;
    try {
      const { applyActions } = await import('../../services/workspaceActions');
      const { errors } = await applyActions([{ type: 'remove_url', workspace: ws.name, url }], [ws]);
      if (errors.length) throw new Error(errors[0]);
      setClipToast({ info: true, text: `${title || hostOf(url)} removed from ${ws.name}` });
    } catch (err) {
      setClipToast({ error: true, text: `Couldn’t remove it: ${err?.message || err}` });
    }
  }, []);

  // Files, folders and shells in the workspace (Browse → Save on a file or
  // terminal tab). Files and folders are the workspace's `apps` entries of
  // appType file/folder (the same items drag-and-drop adds); shells are
  // their own `shells` list — in `apps` they'd be launched as programs.
  // A shell's folder: the live one from the shell's title when it's a full
  // path (zsh/bash set it), else the folder the tab started in.
  const termDir = (tab) => (/^(\/|[A-Za-z]:[\\/])/.test(tab.title || '') ? tab.title : tab.term?.cwd) || null;
  const pathKey = (p) => (p || '').replace(/(.)[\\/]+$/, '$1').toLowerCase();
  const serverForTab = (tab) => {
    const m = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)/i.exec(tab.url || tab.req?.url || '');
    return m ? ports.find(p => p.port === Number(m[1]) && p.dir) || null : null;
  };
  const isServerSaved = (server) => (clipWsRef.current?.servers || [])
    .some(sv => pathKey(sv.cwd) === pathKey(server.dir) && (!sv.port || sv.port === server.port));
  const isTabSaved = (tab) => {
    const ws = clipWsRef.current;
    if (!ws) return false;
    if (!tab.file && !tab.term && serverForTab(tab)) return isServerSaved(serverForTab(tab));
    if (tab.file) return (ws.apps || []).some(a => isFileItem(a) && pathKey(a.path) === pathKey(tab.file.path));
    if (tab.term) return (ws.shells || []).some(sh => pathKey(sh.cwd) === pathKey(termDir(tab)));
    return savedUrls.has(tab.url || tab.req?.url);
  };
  const saveItemToWorkspace = useCallback(async (item) => {
    const ws = clipWsRef.current;
    if (!ws) {
      setClipToast({ error: true, text: 'Pick a workspace in Home first: items are saved to it.' });
      return;
    }
    const name = (item.path || '').split(/[/\\]/).filter(Boolean).pop() || item.path;
    try {
      if (item.kind === 'shell') {
        if ((ws.shells || []).some(sh => pathKey(sh.cwd) === pathKey(item.path))) return;
        const shell = { id: `sh_${Date.now().toString(36)}`, name, cwd: item.path, addedAt: Date.now() };
        const res = await saveWorkspace({ ...ws, shells: [...(ws.shells || []), shell], updatedAt: Date.now() });
        if (res?.success === false) throw new Error(res.error?.message || 'save failed');
      } else {
        const { applyActions } = await import('../../services/workspaceActions');
        if ((ws.apps || []).some(a => isFileItem(a) && pathKey(a.path) === pathKey(item.path))) return;
        const { errors } = await applyActions([{
          type: 'add_app', workspace: ws.name, path: item.path.replace(/(.)[\\/]+$/, '$1'), name, appType: item.isDir ? 'folder' : 'file',
        }], [ws]);
        if (errors.length) throw new Error(errors[0]);
      }
      setClipToast({ link: true, text: `${item.kind === 'shell' ? `Shell in ${name}` : name} saved to ${ws.name}` });
    } catch (err) {
      setClipToast({ error: true, text: `Couldn’t save to ${ws.name}: ${err?.message || err}` });
    }
  }, []);
  const removeItemFromWorkspace = useCallback(async (item) => {
    const ws = clipWsRef.current;
    if (!ws || !item.path) return;
    const name = (item.path || '').split(/[/\\]/).filter(Boolean).pop() || item.path;
    try {
      if (item.kind === 'server') {
        const res = await saveWorkspace({ ...ws, servers: (ws.servers || []).filter(sv => sv.id !== item.id), updatedAt: Date.now() });
        if (res?.success === false) throw new Error(res.error?.message || 'save failed');
      } else if (item.kind === 'shell') {
        const shells = (ws.shells || []).filter(sh => pathKey(sh.cwd) !== pathKey(item.path));
        const res = await saveWorkspace({ ...ws, shells, updatedAt: Date.now() });
        if (res?.success === false) throw new Error(res.error?.message || 'save failed');
      } else {
        // Every copy of this path (a trailing slash or different case would
        // otherwise leave one behind and the row would come back).
        const apps = (ws.apps || []).filter(a => !(isFileItem(a) && pathKey(a.path) === pathKey(item.path)));
        const res = await saveWorkspace({ ...ws, apps, updatedAt: Date.now() });
        if (res?.success === false) throw new Error(res.error?.message || 'save failed');
      }
      setClipToast({ info: true, text: `${item.kind === 'server' ? (item.name || name) : item.kind === 'shell' ? `Shell in ${name}` : name} removed from ${ws.name}` });
    } catch (err) {
      setClipToast({ error: true, text: `Couldn’t remove it: ${err?.message || err}` });
    }
  }, []);

  // ── Saved servers (src/shared/savedServers.js) ─────────────────────
  // Save a running dev server as its folder + start command (guessed from
  // package.json, editable on the row). One per folder + port.
  const saveServerToWorkspace = useCallback(async (server) => {
    const ws = clipWsRef.current;
    if (!ws) {
      setClipToast({ error: true, text: 'Pick a workspace in Home first: servers are saved to it.' });
      return;
    }
    if (!server?.dir) {
      setClipToast({ error: true, text: 'Can’t tell which folder this server runs in, so it can’t be saved.' });
      return;
    }
    const already = (ws.servers || []).some(sv => pathKey(sv.cwd) === pathKey(server.dir) && (!sv.port || sv.port === server.port));
    if (already) { setClipToast({ info: true, text: `Already saved in ${ws.name}` }); return; }
    const command = await guessStartCommand(server.dir);
    const name = server.label || server.dir.split(/[/\\]/).filter(Boolean).pop();
    const entry = { id: `sv_${Date.now().toString(36)}`, name, cwd: server.dir, command, port: server.port || null, addedAt: Date.now() };
    const res = await saveWorkspace({ ...ws, servers: [...(ws.servers || []), entry], updatedAt: Date.now() });
    if (res?.success === false) {
      setClipToast({ error: true, text: `Couldn’t save to ${ws.name}: ${res.error?.message || 'save failed'}` });
      return;
    }
    setClipToast({ link: true, text: command ? `${name} saved to ${ws.name} (starts with “${command}”)` : `${name} saved to ${ws.name}. Add its start command on the row.` });
  }, []);
  const updateSavedServer = useCallback(async (id, patch) => {
    const ws = clipWsRef.current;
    if (!ws) return;
    const servers = (ws.servers || []).map(sv => (sv.id === id ? { ...sv, ...patch } : sv));
    await saveWorkspace({ ...ws, servers, updatedAt: Date.now() });
  }, []);
  // ▶ on a saved server: run its command in a terminal tab, then open the
  // page once a server shows up in its folder (checked every 2s, up to 90s).
  const [startingServers, setStartingServers] = useState(() => new Set());
  const startSavedServer = useCallback(async (sv) => {
    if (!sv?.command) return;
    setStartingServers(prev => new Set(prev).add(sv.id));
    await runInTerminal({ command: sv.command, cwd: sv.cwd, label: sv.name });
    const done = () => setStartingServers(prev => { const next = new Set(prev); next.delete(sv.id); return next; });
    const startedAt = Date.now();
    const check = async () => {
      let list = [];
      try { list = await fetchLocalServers(); } catch { /* sidecar busy: try again */ }
      const found = runningServerFor(sv, list);
      if (found) {
        setPorts(list);
        done();
        if (found.port !== sv.port) updateSavedServer(sv.id, { port: found.port });
        browseTabs.openInNew(`http://localhost:${found.port}`, { position: 'after' });
        return;
      }
      if (Date.now() - startedAt > 90000) {
        done();
        setClipToast({ error: true, text: `${sv.name} didn’t start a server yet. Check its terminal tab.` });
        return;
      }
      setTimeout(check, 2000);
    };
    setTimeout(check, 1500);
  }, [browseTabs, updateSavedServer]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matches = (item) => !q || item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q);

    const serverItems = ports
      .map(p => ({ url: `http://localhost:${p.port}`, title: p.label, sub: `:${p.port}`, server: true, port: p.port, dir: p.dir }))
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

  // The servers get their own row on the new tab screen.
  const quickPicks = useMemo(() => groups.filter(g => !g.isFiles && g.id !== 'servers').flatMap(g => g.items).slice(0, 8), [groups]);



  // The toolbar keeps navigation only (and Home): everything else lives in
  // the side panel on the right, opened by the button at the toolbar's end.
  const toolbarStart = (
    <button className={`bp-btn ${homeShown ? 'on' : ''}`} onClick={goHome} title="Home: workspace, tabs, apps and folders (in the side panel)">
      <FontAwesomeIcon icon={faHouse} />
    </button>
  );
  const toolbarEnd = (
    <>
    {/* Layout: Single | Multi as a labelled switch, and focus mode as its
        own button (the page alone, Esc to leave). */}
    <div className="bp-capsule bp-modes bp-layout" role="tablist" aria-label="Layout">
      <button
        className={`bp-btn bp-layout-btn ${!canvasMode ? 'on' : ''}`}
        role="tab"
        aria-selected={!canvasMode}
        onClick={() => { setFocusMode(false); setMode('browse'); }}
        title="Single view — one tab at a time"
      >
        <FontAwesomeIcon icon={faWindowMaximize} />
        <span>Single</span>
      </button>
      <button
        className={`bp-btn bp-layout-btn ${canvasMode ? 'on' : ''}`}
        role="tab"
        aria-selected={canvasMode}
        onClick={() => { setFocusMode(false); setMode('canvas'); }}
        title="Multi view — your open tabs side by side"
      >
        <FontAwesomeIcon icon={faTableCellsLarge} />
        <span>Multi</span>
      </button>
    </div>
    <button
      className={`bp-btn ${focusOn ? 'on' : ''}`}
      onClick={() => setFocusMode(v => !v)}
      title={focusOn ? `Exit focus mode (${IS_MAC_UI ? '⌘⇧F' : 'Ctrl+Shift+F'}, or Esc outside a terminal)` :`Focus mode — just the page, full screen (${IS_MAC_UI ? '⌘⇧F' : 'Ctrl+Shift+F'})`}
      aria-pressed={focusOn}
    >
      <FontAwesomeIcon icon={focusOn ? faCompress : faExpand} />
    </button>
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
    {/* App-wide controls (sidebar, Cool Activity, Settings, a pending
        update) — the desktop app has no header bar above Browse, so they
        end every tab's toolbar, set apart from the page controls. */}
    {appControls && (
      <>
        <span className="bp-toolbar-sep" aria-hidden="true" />
        <UsageMeter
          stats={stats}
          pagesMemory={pagesMemory}
          pagesCpu={pagesCpu}
          pageCount={openPages.filter(p => p.pid != null && !p.shared).length}
          onOpen={() => { setFilesTab('page'); setFilesOpen(true); }}
        />
        {appControls}
      </>
    )}
    </>
  );

  // Multi view: which panes are on screen, and the slimmer toolbar each tile
  // gets (the shared controls sit once, in the bar above the grid).
  const onScreen = (tab) => (canvasMode ? tiledIds.has(tab.id) : tab.id === browseTabs.activeId);
  const paneProps = (tab, isCurrent) => ({
    className: `browse-tabpane ${onScreen(tab) ? '' : 'is-hidden'}${canvasMode ? ' is-tile' : ''}${canvasMode && isCurrent ? ' is-current' : ''}`,
    style: canvasMode && multiRects.tiles.has(tab.id) ? rectStyle(multiRects.tiles.get(tab.id)) : undefined,
    // A click anywhere in a tile makes it the current tab (the keyboard
    // goes there). A web page itself is a native layer and doesn't report
    // clicks to us — its address bar does.
    onMouseDownCapture: canvasMode && !isCurrent ? () => browseTabs.activate(tab.id) : undefined,
  });
  // Multi view: a grip at the start of each tile's bar to drag it around.
  const paneStart = (tab) => (canvasMode ? (multiTabs.length > 1 ? (
    <button
      className="bp-btn multi-grip"
      onPointerDown={startTileDrag(tab.id)}
      title="Drag to move — onto a tile's edge to put it beside it, its middle to swap, the view's edge for a full column or row"
    >
      <FontAwesomeIcon icon={faGripVertical} />
    </button>
  ) : null) : toolbarStart);
  // Save this page to the workspace shown in Home — a labelled button in the
  // tab's own toolbar, so it's there without opening the side panel.
  const saveButton = (tab) => {
    if (tab.note || tab.special) return null;
    const pageUrl = tab.url || tab.req?.url;
    let save;
    if (tab.file) save = () => saveItemToWorkspace({ kind: 'file', path: tab.file.path, isDir: tab.file.isDir });
    else if (tab.term) {
      const dir = termDir(tab);
      if (!dir) return null;
      save = () => saveItemToWorkspace({ kind: 'shell', path: dir });
    } else if (serverForTab(tab)) save = () => saveServerToWorkspace(serverForTab(tab));
    else if (isWebUrl(pageUrl)) save = () => saveTabsToWorkspace([{ url: pageUrl, title: tab.title }]);
    else return null;
    const what = tab.file ? (tab.file.isDir ? 'this folder' : 'this file') : tab.term ? 'this shell' : serverForTab(tab) ? 'this server' : 'this page';
    const ws = clipWsRef.current;
    if (isTabSaved(tab)) {
      return (
        <span className="bp-btn bp-save is-saved" title={`Saved in ${ws?.name || 'this workspace'}`}>
          <FontAwesomeIcon icon={faBookmark} />
          {!canvasMode && <span>Saved</span>}
        </span>
      );
    }
    return (
      <button
        className="bp-btn bp-save"
        onClick={save}
        title={ws ? `Save ${what} to ${ws.name}` : `Save ${what} to a workspace`}
      >
        <FontAwesomeIcon icon={faBookmark} />
        {!canvasMode && <span>Save</span>}
      </button>
    );
  };
  const paneEnd = (tab) => (canvasMode ? (
    <>
      {saveButton(tab)}
      <button className="bp-btn" onClick={() => { browseTabs.activate(tab.id); setMode('browse'); }} title="Just this tab (single view)">
        <FontAwesomeIcon icon={faExpand} />
      </button>
      <button className="bp-btn" onClick={() => browseTabs.close(tab.id)} title="Close tab">
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </>
  ) : (
    <>
      {saveButton(tab)}
      {toolbarEnd}
    </>
  ));

  // ── Tabs tab rows ──────────────────────────────────────────────────
  // Pinned = the workspace's links, files and folders (Arc-style): each shows
  // whether it's open in a tab. Open tabs = tabs that aren't pinned items.
  const pinnedLinks = shownWs
    ? (shownWs.ws.urls || []).filter(u => isWebUrl(u?.url)).map(u => ({ url: u.url, ...describeLink(u.url, u.title), favicon: u.favicon }))
    : [];
  // One row per file/folder: the same path saved twice (a trailing slash,
  // different case) shows once. Different folders that share a name show
  // their parent folder so they can be told apart.
  const pinnedFiles = (() => {
    if (!shownWs) return [];
    const seen = new Set();
    const items = [];
    for (const a of shownWs.ws.apps || []) {
      if (!isFileItem(a) || seen.has(pathKey(a.path))) continue;
      seen.add(pathKey(a.path));
      const parts = a.path.split(/[/\\]/).filter(Boolean);
      items.push({ path: a.path, isDir: a.appType === 'folder', title: a.name || parts[parts.length - 1] || a.path, parent: parts[parts.length - 2] || '', sub: a.path });
    }
    const counts = {};
    items.forEach(i => { counts[i.title.toLowerCase()] = (counts[i.title.toLowerCase()] || 0) + 1; });
    return items.map(i => ({ ...i, clash: counts[i.title.toLowerCase()] > 1 }));
  })();
  const pinnedShells = shownWs
    ? (shownWs.ws.shells || []).filter(sh => sh?.cwd).map(sh => ({ shell: true, path: sh.cwd, title: sh.name || sh.cwd.split(/[/\\]/).filter(Boolean).pop() }))
    : [];
  const pinnedServers = shownWs
    ? (shownWs.ws.servers || []).filter(sv => sv?.cwd).map(sv => ({ server: true, sv, path: sv.cwd, title: sv.name }))
    : [];
  // Each server as the dock shows it: its project's stack logo (folder
  // identity of the folder it runs in), the project's name, its port.
  const serverDirs = useMemo(() => ports.map(p => p.dir).filter(Boolean), [ports]);
  const folderIdentity = useFolderIdentity(serverDirs);
  const serverLinks = (groups.find(g => g.id === 'servers')?.items || [])
    .map(item => ({ ...item, stack: item.dir ? folderIdentity(item.dir).stack : null }));
  const tabForUrl = (url) => browseTabs.tabs.find(t => !t.file && !t.term && !t.note && !t.special && (t.url === url || t.req.url === url));
  const tabForPath = (path) => browseTabs.tabs.find(t => t.file && pathKey(t.file.path) === pathKey(path));

  const closeButton = (tab) => (
    <button
      className="bp-btn browse-tab-close"
      onClick={(e) => { e.stopPropagation(); browseTabs.close(tab.id); }}
      title="Close tab"
    >
      <FontAwesomeIcon icon={faXmark} />
    </button>
  );

  const removeButton = (item) => (
    <button
      className="bp-btn browse-link-remove"
      onClick={(e) => { e.stopPropagation(); removeItemFromWorkspace(item); }}
      title={`Remove from ${clipWsRef.current?.name || 'this workspace'}`}
    >
      <FontAwesomeIcon icon={faTrashCan} />
    </button>
  );

  function renderPinnedLink(item) {
    const tab = tabForUrl(item.url);
    const current = tab?.id === browseTabs.activeId;
    return (
      <div
        key={item.url}
        role="button"
        tabIndex={0}
        className={`browse-tab-row ${current ? 'active' : ''} ${tab ? 'is-open' : ''}`}
        onClick={(e) => pickLink(item.url, e.metaKey || e.ctrlKey)}
        onKeyDown={(e) => { if (e.key === 'Enter') pickLink(item.url); }}
        title={`${item.url}\n${tab ? 'Open: click to switch to it' : 'Click to open in a tab'} · ⌘-click: replace this tab`}
      >
        <ItemIcon item={item} />
        <span className="browse-tab-title">{tab?.title || item.title}</span>
        {!tab && <span className="browse-row-sub">{item.sub?.split('/')[0]}</span>}
        <button
          className="bp-btn browse-link-remove"
          onClick={(e) => { e.stopPropagation(); removeLinkFromWorkspace(item.url, item.title); }}
          title={`Remove from ${clipWsRef.current?.name || 'this workspace'}`}
        >
          <FontAwesomeIcon icon={faTrashCan} />
        </button>
        {tab && closeButton(tab)}
      </div>
    );
  }

  // A local server: its address, the program serving it, and a stop button
  // (on hover; asks once more before killing the process).
  function renderServerRow(item) {
    const tab = tabForUrl(item.url);
    const armed = stopArmed === item.port;
    return (
      <div
        key={item.url}
        role="button"
        tabIndex={0}
        className={`browse-tab-row server-row ${tab?.id === browseTabs.activeId ? 'active' : ''} ${tab ? 'is-open' : ''} ${armed ? 'is-armed' : ''}`}
        onClick={(e) => pickLink(item.url, e.metaKey || e.ctrlKey)}
        onKeyDown={(e) => { if (e.key === 'Enter') pickLink(item.url); }}
        title={`${item.title} — ${item.url}${item.dir ? `\n${item.dir}` : ''}\n${tab ? 'Open: click to switch to it' : 'Click to open in a tab'}`}
      >
        <ServerIcon stack={item.stack} />
        <span className="browse-tab-title">{item.title}</span>
        <ServerPort port={item.port} />
        {item.dir && !isServerSaved(item) && (
          <button
            className="bp-btn browse-tab-save"
            onClick={(e) => { e.stopPropagation(); saveServerToWorkspace(item); }}
            title={clipWsRef.current ? `Save this server to ${clipWsRef.current.name}` : 'Save this server to a workspace'}
          >
            <FontAwesomeIcon icon={faBookmark} />
          </button>
        )}
        <button
          className={`bp-btn server-stop ${armed ? 'armed' : ''}`}
          onClick={(e) => { e.stopPropagation(); stopServer(item.port); }}
          title={armed ? `Click again to stop the process on port ${item.port}` : `Stop the server on port ${item.port}`}
        >
          {armed ? <span>Stop?</span> : <FontAwesomeIcon icon={faPowerOff} />}
        </button>
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
        {item.clash && item.parent && <span className="browse-row-sub is-shown">in {item.parent}</span>}
        {removeButton({ kind: 'file', path: item.path })}
        {tab && closeButton(tab)}
      </div>
    );
  }

  // A saved server: running → dot + port, click opens it; stopped → ▶ runs
  // its command in a terminal tab and opens the page once it's up. The
  // command is shown under the name and edited in place (✎).
  const [editingServer, setEditingServer] = useState(null); // { id, draft }
  function renderPinnedServer(item) {
    const { sv } = item;
    const live = runningServerFor(sv, ports);
    const tab = live ? tabForUrl(`http://localhost:${live.port}`) : null;
    const starting = startingServers.has(sv.id);
    const editing = editingServer?.id === sv.id;
    const open = () => {
      if (live) pickLink(`http://localhost:${live.port}`);
      else if (sv.command && !starting) startSavedServer(sv);
      else if (!sv.command) setEditingServer({ id: sv.id, draft: '' });
    };
    const commitCommand = () => {
      const command = (editingServer?.draft || '').trim();
      setEditingServer(null);
      if (command !== (sv.command || '')) updateSavedServer(sv.id, { command });
    };
    return (
      <div
        key={`server:${sv.id}`}
        role="button"
        tabIndex={0}
        className={`browse-tab-row saved-server-row ${tab?.id === browseTabs.activeId ? 'active' : ''} ${tab ? 'is-open' : ''}`}
        onClick={editing ? undefined : open}
        onKeyDown={(e) => { if (!editing && e.key === 'Enter') open(); }}
        title={`${sv.name} — ${sv.cwd}\n${live ? `Running on :${live.port}. Click to open` : starting ? 'Starting…' : sv.command ? `Stopped. Click to start: ${sv.command}` : 'No start command yet. Click to add one'}`}
      >
        <span className={`browse-tile server-dot-tile ${live ? 'is-live' : ''} ${starting ? 'is-starting' : ''}`}>
          <FontAwesomeIcon icon={faServer} />
        </span>
        <span className="saved-server-main">
          <span className="browse-tab-title">{sv.name}</span>
          {editing ? (
            <input
              className="saved-server-cmd-input"
              autoFocus
              value={editingServer.draft}
              placeholder="Start command, e.g. npm run dev"
              spellCheck={false}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditingServer({ id: sv.id, draft: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitCommand();
                else if (e.key === 'Escape') setEditingServer(null);
              }}
              onBlur={commitCommand}
            />
          ) : (
            <span className="saved-server-cmd">{sv.command ? `$ ${sv.command}` : 'no start command'}</span>
          )}
        </span>
        {live ? <ServerPort port={live.port} /> : starting ? <span className="browse-row-sub is-shown">starting…</span> : null}
        {!editing && (
          <button
            className="bp-btn browse-link-remove"
            onClick={(e) => { e.stopPropagation(); setEditingServer({ id: sv.id, draft: sv.command || '' }); }}
            title="Edit the start command"
          >
            <FontAwesomeIcon icon={faPen} />
          </button>
        )}
        {!live && !starting && sv.command && !editing && (
          <button
            className="bp-btn saved-server-start"
            onClick={(e) => { e.stopPropagation(); startSavedServer(sv); }}
            title={`Start: ${sv.command}`}
          >
            <FontAwesomeIcon icon={faPlay} />
          </button>
        )}
        {!editing && removeButton({ kind: 'server', id: sv.id, path: sv.cwd, name: sv.name })}
      </div>
    );
  }

  // A saved shell: opens a terminal in its folder (or switches to one that's
  // already there). Nothing runs on its own — it's just a shell in that folder.
  function renderPinnedShell(item) {
    const tab = browseTabs.tabs.find(t => t.term && pathKey(termDir(t)) === pathKey(item.path));
    const open = () => (tab ? browseTabs.activate(tab.id) : openTerminal(item.path));
    return (
      <div
        key={`shell:${item.path}`}
        role="button"
        tabIndex={0}
        className={`browse-tab-row ${tab?.id === browseTabs.activeId ? 'active' : ''} ${tab ? 'is-open' : ''}`}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
        title={`Shell in ${item.path}\n${tab ? 'Open: click to switch to it' : 'Click to open a terminal here'}`}
      >
        <span className="browse-tile term-tile"><FontAwesomeIcon icon={faTerminal} /></span>
        <span className="browse-tab-title">{item.title}</span>
        {!tab && <span className="browse-row-sub">shell</span>}
        {removeButton({ kind: 'shell', path: item.path })}
        {tab && closeButton(tab)}
      </div>
    );
  }

  function renderTabRow(tab) {
    const host = tab.url ? hostOf(tab.url) : '';
    const asleep = !tab.file && !tab.term && !tab.note && !tab.special && !browseTabs.live.has(tab.id);
    return (
      <div
        key={tab.id}
        role="tab"
        aria-selected={tab.id === browseTabs.activeId}
        className={`browse-tab-row is-open ${tab.id === browseTabs.activeId ? 'active' : ''} ${asleep ? 'asleep' : ''}`}
        onClick={() => browseTabs.activate(tab.id)}
        onAuxClick={(e) => { if (e.button === 1) browseTabs.close(tab.id); }}
        title={tab.file ? tab.file.path : tab.term ? `Shell — ${tab.term.cwd || '~'}${termAttention.has(tab.id) ? '\nWaiting for you' : ''}` : tab.note ? `Note${tab.note.workspaceName ? ` in ${tab.note.workspaceName}` : ''}` : tab.special ? SPECIAL_TITLES[tab.special] : asleep ? `${tab.url || 'New tab'}\nAsleep (reloads when opened)` : (tab.url || 'New tab')}
      >
        {tab.file
          ? <span className="browse-tile"><FileIcon path={tab.file.path} isDir={tab.file.isDir} /></span>
          : tab.term
            ? <span className={`browse-tile term-tile ${termAttention.has(tab.id) ? 'needs-you' : ''}`}><FontAwesomeIcon icon={faTerminal} /></span>
          : tab.note
            ? <span className="browse-tile note-tile"><FontAwesomeIcon icon={faNoteSticky} /></span>
          : tab.special
            ? <span className="browse-tile"><FontAwesomeIcon icon={tab.special === 'settings' ? faGear : faDiagramProject} /></span>
          : tab.url
            ? <ItemIcon item={{ url: tab.url, title: tab.title, sub: host }} />
            : <span className="browse-tile"><FontAwesomeIcon icon={faPlus} /></span>}
        <span className="browse-tab-title">{tab.title || host || 'New tab'}</span>
        {isWebUrl(tab.url) && !tab.file && !tab.term && !tab.note && !tab.special && (
          savedUrls.has(tab.url) ? (
            <span className="bp-btn browse-tab-save is-saved" title={`Saved in ${clipWsRef.current?.name || 'this workspace'}`}>
              <FontAwesomeIcon icon={faBookmark} />
            </span>
          ) : (
            <button
              className="bp-btn browse-tab-save"
              onClick={(e) => { e.stopPropagation(); saveTabsToWorkspace([tab]); }}
              title={clipWsRef.current ? `Save to ${clipWsRef.current.name}` : 'Save to a workspace'}
            >
              <FontAwesomeIcon icon={faBookmark} />
            </button>
          )
        )}
        {closeButton(tab)}
      </div>
    );
  }

  // Outside CoolDesk: tabs in your browsers + running apps (the Tabs face,
  // folded in). Only listened to while the Tabs list is on screen.
  const navVisible = isActive && (isSidebarWidth || (filesShown && filesTab === 'tabs'));
  // Folders you use most (the OS's recent/frequent list), as chips at the
  // top of Home — they take little room. Fetched once Home is first shown.
  const [frequentFolders, setFrequentFolders] = useState([]);
  const foldersAsked = useRef(false);
  useEffect(() => {
    if (!navVisible || foldersAsked.current) return;
    foldersAsked.current = true;
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('get_frequent_folders'))
      .then(list => { if (Array.isArray(list)) setFrequentFolders(list.slice(0, 10)); })
      .catch(() => { });
  }, [navVisible]);

  function renderFolderChip(folder) {
    const name = folder.name || folder.path.split(/[/\\]/).filter(Boolean).pop() || folder.path;
    return (
      <button key={folder.path} className="nav-chip" onClick={() => openPath(folder.path, true)} title={`${folder.path}\nOpen in Files`}>
        <FontAwesomeIcon icon={faFolder} className="nav-chip-folder" />
        <span>{name}</span>
      </button>
    );
  }

  // Home (the side panel's first tab, or the whole view at sidebar width):
  // one search over everything, the workspaces as pills, then one "lens" at
  // a time — open tabs, the workspace's pinned links, folders, or apps — so
  // it's a short list instead of nine sections in one long scroll.
  const q = filter.trim().toLowerCase();
  const tabText = (t) => `${t.title || ''} ${t.url || ''} ${t.file?.path || ''} ${t.term?.cwd || ''} ${t.special || ''}`.toLowerCase();
  // Typing searches what Browse holds: its open tabs, folders, then links in
  // every workspace. (Running apps and your browsers' tabs live in the
  // sidebar, the dock and the spotlight — they open outside, not in here.)
  const searchBody = () => {
    const tabs = browseTabs.tabs.filter(t => !isBlank(t) && tabText(t).includes(q));
    const folders = frequentFolders.filter(f => `${f.name || ''} ${f.path}`.toLowerCase().includes(q));
    // The web: the search (or address) itself, then the engine's suggestions.
    const term = filter.trim();
    const engineKey = getEngineKey();
    const typedUrl = normalizeAddress(term);
    const typedIsSearch = typedUrl === searchUrl(engineKey, term);
    const engineName = engineFor(engineKey).label === 'Default' ? 'the web' : engineFor(engineKey).label;
    const suggestions = webSuggest.term === term ? webSuggest.list : [];
    const openWeb = (url) => { setFilter(''); pickLink(url); };
    const webRow = (key, url, label, typed = false) => (
      <div
        key={key}
        role="button"
        tabIndex={0}
        className={`browse-tab-row nav-web-row ${typed ? 'is-typed' : ''}`}
        onClick={() => openWeb(url)}
        onKeyDown={(e) => { if (e.key === 'Enter') openWeb(url); }}
        title={url}
      >
        <span className="browse-tile nav-web-icon"><FontAwesomeIcon icon={typed && !typedIsSearch ? faGlobe : faSearch} /></span>
        <span className="browse-tab-title">{label}</span>
      </div>
    );
    return (
      <>
        {typedUrl && (
          <section className="browse-group nav-web">
            {webRow('typed', typedUrl, typedIsSearch ? `Search ${engineName} for “${term}”` : `Go to ${term}`, true)}
            {suggestions.map(text => webRow(`s:${text}`, searchUrl(engineKey, text), (
              text.toLowerCase().startsWith(term.toLowerCase())
                ? <><span className="as-typed">{text.slice(0, term.length)}</span><b>{text.slice(term.length)}</b></>
                : text
            )))}
          </section>
        )}
        {tabs.length > 0 && (
          <section className="browse-group">
            <div className="nav-section-head"><span>Open tabs</span><span className="browse-count">{tabs.length}</span></div>
            {tabs.map(renderTabRow)}
          </section>
        )}
        {folders.length > 0 && (
          <section className="browse-group">
            <div className="nav-section-head"><span>Folders</span><span className="browse-count">{folders.length}</span></div>
            <div className="nav-chips">{folders.map(renderFolderChip)}</div>
          </section>
        )}
        {groups.map(group => (
          <section key={group.id} className="browse-group">
            <div className="nav-section-head"><span>{group.name}</span><span className="browse-count">{group.items.length}</span></div>
            {group.items.map(item => (item.path ? renderPinnedFile(item) : item.server ? renderServerRow(item) : renderPinnedLink(item)))}
          </section>
        ))}
      </>
    );
  };

  // A section's rows, capped, with "+N more" / "Show fewer".
  const capped = (key, list, render) => {
    const open = homeMore[key];
    const cap = HOME_CAP[key];
    const shown = open || list.length <= cap + 1 ? list : list.slice(0, cap);
    return (
      <>
        {shown.map(render)}
        {list.length > cap + 1 && (
          <button className="nav-more" onClick={() => setHomeMore(m => ({ ...m, [key]: !open }))}>
            {open ? 'Show fewer' : `+${list.length - cap} more`}
          </button>
        )}
      </>
    );
  };
  const openTabs = browseTabs.tabs.filter(t => !isBlank(t) || t.id === browseTabs.activeId);

  const navContent = (
    <>
      <div className="browse-search nav-jump">
        <FontAwesomeIcon icon={faSearch} />
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape' && filter) { e.stopPropagation(); setFilter(''); } }}
          placeholder="Jump to a tab, link or folder"
          spellCheck={false}
        />
        {filter && <button className="browse-search-clear" onClick={() => setFilter('')} title="Clear">×</button>}
      </div>

      <div className="browse-groups">
        {filter ? searchBody() : (
          <>
            {/* Tabs in CoolDesk. */}
            <section className="nav-section">
              <div className="nav-section-head">
                <span>Tabs</span>
                <span className="browse-count">{openTabs.length}</span>
                <span className="nt-grow" />
                <button className="bp-btn browse-tabs-new" onClick={newTab} title="New tab (⌘T)">
                  <FontAwesomeIcon icon={faPlus} />
                </button>
                <button className="bp-btn browse-tabs-new" onClick={() => openTerminal()} title="New shell tab">
                  <FontAwesomeIcon icon={faTerminal} />
                </button>
                <button className="bp-btn browse-tabs-new" onClick={browseTabs.openScratchNote} title="New note (a scratch notepad — save it to a workspace when you want to keep it)">
                  <FontAwesomeIcon icon={faNoteSticky} />
                </button>
                {openTabs.some(t => isWebUrl(t.url) && !t.file && !t.term && !t.note && !t.special) && (
                  <button
                    className="bp-btn browse-tabs-new"
                    onClick={() => saveTabsToWorkspace(openTabs.filter(t => !t.file && !t.term && !t.note && !t.special))}
                    title={clipWsRef.current ? `Save all web tabs to ${clipWsRef.current.name}` : 'Save all web tabs to a workspace'}
                  >
                    <FontAwesomeIcon icon={faBookmark} />
                  </button>
                )}
              </div>
              {capped('tabs', openTabs, renderTabRow)}
            </section>

            {/* The workspace's pinned links and files — the workspace is
                picked right in the header, its notes one button over. */}
            {shownWs && (
              <section className="nav-section">
                <div className="nav-section-head nav-ws-head">
                  <ToolbarMenu
                    icon={faThumbtack}
                    label={shownWs.ws.name}
                    title="Switch workspace"
                    align="left"
                    className="nav-ws-menu"
                    items={wsWithLinks.map(({ ws, count }) => ({
                      key: ws.id,
                      label: ws.name,
                      hint: count ? String(count) : null,
                      checked: shownWs.ws.id === ws.id,
                      onSelect: () => setListWs(ws.id),
                    }))}
                  />
                  <span className="nt-grow" />
                  {shownWs && (
                    <button
                      className={`bp-btn browse-tabs-new ${wsContextOpen ? 'on' : ''}`}
                      onClick={() => setWsContextOpen(!wsContextOpen)}
                      title={wsContextOpen ? 'Hide notes, to-dos & commands' : `Notes, to-dos & commands for ${shownWs.ws.name}`}
                      aria-expanded={wsContextOpen}
                    >
                      <FontAwesomeIcon icon={faNoteSticky} />
                    </button>
                  )}
                </div>
                {shownWs && wsContextOpen && (
                  <div className="workspace-detail-view nav-ws-context browse-head-context">
                    {/* Full width: a note opens as a tab in the main view,
                        like a file. The docked sidebar has no main view, so
                        there it still opens in place. */}
                    <WorkspaceContextPanel
                      key={shownWs.ws.id}
                      workspace={shownWs.ws}
                      onOpenNote={isSidebarWidth ? null : browseTabs.openNoteTab}
                    />
                  </div>
                )}
                {shownWs && pinnedLinks.length + pinnedFiles.length + pinnedShells.length + pinnedServers.length === 0 && (
                  <div className="browse-hint">Links, files, folders, shells and servers you save to {shownWs.ws.name} show up here. Use Save in a tab’s toolbar.</div>
                )}
                {capped('pinned', [...pinnedServers, ...pinnedLinks, ...pinnedFiles, ...pinnedShells], item => (item.server ? renderPinnedServer(item) : item.shell ? renderPinnedShell(item) : item.path ? renderPinnedFile(item) : renderPinnedLink(item)))}
              </section>
            )}

            {/* Dev servers running on this machine (localhost ports). */}
            {serverLinks.length > 0 && (
              <section className="nav-section">
                <div className="nav-section-head">
                  <span>Local servers</span>
                  <span className="browse-count">{serverLinks.length}</span>
                  <span className="nt-grow" />
                  <button className="bp-btn browse-tabs-new" onClick={() => loadPorts({ force: true })} title="Check for running servers now">
                    <FontAwesomeIcon icon={faRotateRight} />
                  </button>
                </div>
                {capped('servers', serverLinks, renderServerRow)}
              </section>
            )}

            {/* Folders and apps: short names, so one row of chips each. */}
            {/* Always there: the Files button (your folders, in a tab). */}
            <section className="nav-section">
              <div className="nav-section-head">
                <span>Folders</span>
                <span className="nt-grow" />
                <button className="bp-btn browse-tabs-new" onClick={() => showFolder(filesPath)} title="Files: browse your folders in a tab">
                  <FontAwesomeIcon icon={faFolderOpen} />
                </button>
              </div>
              {frequentFolders.length > 0 && (
                <div className="nav-chips">{capped('folders', frequentFolders, renderFolderChip)}</div>
              )}
            </section>


            {/* Widgets and running dev servers. */}
            {homeExtras && <div className="nav-home-extras">{homeExtras}</div>}
          </>
        )}
      </div>
    </>
  );

  return (
    <div className={`browse-view ${isSidebarWidth ? 'browse-narrow' : ''}`}>
      {/* Docked sidebar width: no room for a page, so the links fill it. */}
      {/* Same wrapper as the side panel's Home (FilesView .fp-body.nav-body),
          so the narrow sidebar gets the same spacing, field and one-page
          scroll instead of an unstyled, clipped column. */}
      {isSidebarWidth && (
        <aside className="browse-list">
          <div className="fp-body nav-body browse-narrow-body">{navContent}</div>
        </aside>
      )}

      {!isSidebarWidth && (
        <main className="browse-pane">
          {/* Multi view: one bar for the whole grid; each tile keeps only
              its address bar plus expand / close. */}
          {canvasMode && (
            <div className="bp-toolbar multi-bar">
              {toolbarStart}
              <span className="multi-title">
                <FontAwesomeIcon icon={faTableCellsLarge} />
                {multiTabs.length === 1 ? '1 tab' : `${multiTabs.length} tabs side by side`}
              </span>
              <span className="multi-grow" />
              {savedLayout.custom && multiTabs.length > 1 && (
                <button className="bp-btn" onClick={autoArrange} title="Auto-arrange — back to the automatic grid">
                  <FontAwesomeIcon icon={faTableColumns} />
                </button>
              )}
              <button className="bp-btn" onClick={() => openTerminal()} title="New terminal tile">
                <FontAwesomeIcon icon={faTerminal} />
              </button>
              <button className="bp-btn" onClick={browseTabs.openScratchNote} title="New note tile">
                <FontAwesomeIcon icon={faNoteSticky} />
              </button>
              <button className="bp-btn" onClick={() => browseTabs.openInNew(null)} title="New tab tile (⌘T)">
                <FontAwesomeIcon icon={faPlus} />
              </button>
              {toolbarEnd}
            </div>
          )}
          <div
            ref={multiGridRef}
            className={`browse-mode ${canvasMode ? 'is-multi' : ''}`}
          >
            {/* Dividers between tiles: drag to resize, double-click to even
                out that split. */}
            {canvasMode && multiRects.dividers.map(div => (
              <div
                key={`${div.path.join('.')}:${div.index}`}
                className={`multi-divider ${div.dir === 'row' ? 'is-col' : 'is-row'}`}
                style={div.dir === 'row'
                  ? { left: `calc(${div.x * 100}% - 5px)`, top: `${div.y * 100}%`, height: `${div.len * 100}%` }
                  : { top: `calc(${div.y * 100}% - 5px)`, left: `${div.x * 100}%`, width: `${div.len * 100}%` }}
                onPointerDown={startMultiResize(div)}
                onDoubleClick={evenMultiSplit(div)}
                title="Drag to resize · double-click to even out"
              />
            ))}
            {/* Moving a tile: a stand-in card per tile (the pages hide while
                this covers them) and where the dragged one would land. */}
            {canvasMode && tileDrag && (
              <div className="multi-dock-layer">
                {multiTabs.map(t => {
                  const r = multiRects.tiles.get(t.id);
                  if (!r) return null;
                  return (
                    <div key={t.id} className={`multi-dock-ghost ${t.id === tileDrag.id ? 'is-source' : ''}`} style={rectStyle(r)}>
                      <span>{tileLabel(t)}</span>
                    </div>
                  );
                })}
                {dropPreview && (
                  <div className={`multi-dock-preview ${tileDrag.drop.side === 'center' ? 'is-swap' : ''}`} style={rectStyle(dropPreview)}>
                    <span>{tileDrag.drop.side === 'center' ? 'Swap' : tileDrag.drop.target ? `Put ${tileDrag.drop.side}` : `Full ${tileDrag.drop.side === 'left' || tileDrag.drop.side === 'right' ? 'column' : 'row'}`}</span>
                  </div>
                )}
              </div>
            )}
            {canvasMode && tileDrag && (
              <div className="multi-dock-chip" style={{ left: tileDrag.x + 14, top: tileDrag.y + 14 }}>
                {tileLabel(multiTabs.find(t => t.id === tileDrag.id) || {})}
              </div>
            )}
            {/* One live page per awake tab; inactive ones stay loaded but
                hidden. Multi view un-hides the tiled ones in the grid. */}
            {browseTabs.tabs.filter(tab => tab.file || tab.term || tab.note || tab.special || browseTabs.live.has(tab.id)).map(tab => {
              const isCurrent = tab.id === browseTabs.activeId;
              if (tab.special) {
                return (
                  <div key={tab.id} {...paneProps(tab, isCurrent)}>
                    <SpecialTab
                      kind={tab.special}
                      renderSettings={renderSettings}
                      onClose={() => browseTabs.close(tab.id)}
                      onOpenUrl={(url) => browseTabs.openInNew(url, { position: 'after' })}
                      onOpenPath={openPath}
                      onOpenShell={openTerminal}
                      toolbarStart={paneStart(tab)}
                      toolbarEnd={paneEnd(tab)}
                    />
                  </div>
                );
              }
              if (tab.note) {
                return (
                  <div key={tab.id} {...paneProps(tab, isCurrent)}>
                    <NoteTab
                      note={tab.note}
                      workspaces={savedWorkspaces}
                      activeWorkspaceId={activeWorkspaceId}
                      onSaveToWorkspace={(ws) => browseTabs.noteToWorkspace(tab.id, ws)}
                      onTitle={(title) => browseTabs.noteTitle(tab.id, title)}
                      onClose={() => browseTabs.close(tab.id)}
                      onOpenUrl={(url) => browseTabs.openInNew(url, { position: 'after' })}
                      onOpenPath={openPath}
                      onOpenShell={openTerminal}
                      toolbarStart={paneStart(tab)}
                      toolbarEnd={paneEnd(tab)}
                    />
                  </div>
                );
              }
              if (tab.term) {
                return (
                  <div key={tab.id} {...paneProps(tab, isCurrent)}>
                    <TerminalTab
                      tabId={tab.id}
                      cwd={tab.term.cwd}
                      run={tab.term.run || null}
                      active={isActive && isCurrent && onScreen(tab)}
                      onTitle={(title) => browseTabs.noteTitle(tab.id, title)}
                      onOpenUrl={(url) => browseTabs.openInNew(url, { position: 'after' })}
                      onOpenPath={openPath}
                      onOpenShell={openTerminal}
                      onShowInFiles={(dir) => showFolder(dir)}
                      onAttention={(on) => noteAttention(tab.id, on)}
                      toolbarStart={paneStart(tab)}
                      toolbarEnd={paneEnd(tab)}
                    />
                  </div>
                );
              }
              if (tab.file) {
                return (
                  <div key={tab.id} {...paneProps(tab, isCurrent)}>
                    <FileTab
                      file={tab.file}
                      active={isActive && isCurrent && onScreen(tab)}
                      visible={isActive && onScreen(tab)}
                      onOpenFile={(path) => browseTabs.openFileTab(path, false, true)}
                      onOpenUrl={(url) => browseTabs.openInNew(url, { position: 'after' })}
                      onShowFolder={(dir) => showFolder(dir, true)}
                      onBack={tab.back?.length ? () => browseTabs.step(-1) : null}
                      onForward={tab.fwd?.length ? () => browseTabs.step(1) : null}
                      onShowInFiles={showInFiles}
                      onOpenTerminal={openTerminal}
                      toolbarStart={paneStart(tab)}
                      toolbarEnd={paneEnd(tab)}
                    />
                  </div>
                );
              }
              return (
                <div key={tab.id} {...paneProps(tab, isCurrent)}>
                  <BrowserPane
                    paneId={tabPaneId(tab.id)}
                    url={tab.req.url}
                    requestKey={tab.req.key}
                    active={isActive && onScreen(tab)}
                    onNavigate={(url, opts) => handleNavigate(tab.id, url, opts)}
                    onTitle={(title) => browseTabs.noteTitle(tab.id, title)}
                    onTools={setPageTools}
                    heavy={heavyPaneId === tabPaneId(tab.id)}
                    onDismissHeavy={dismissHeavy}
                    onOpenPath={openPath}
                    onOpenShell={openTerminal}
                    focusAddressKey={isCurrent ? focusAddress : 0}
                    findKey={isCurrent ? findKey : 0}
                    toolbarStart={paneStart(tab)}
                    toolbarEnd={paneEnd(tab)}
                    emptyState={(
                      <div className="browse-hero">
                        <div className="browse-hero-orb"><FontAwesomeIcon icon={faCompass} /></div>
                        <h2>Browse without leaving CoolDesk</h2>
                        <p>Pick a link, or type a URL or search above. ⌘T opens a new tab.</p>
                        {/* Or make this tab a shell, a note or the file
                            manager instead of a page. */}
                        <div className="browse-hero-actions">
                          <button className="browse-chip browse-hero-action" onClick={() => openTerminal()} title="A shell in this tab">
                            <span className="browse-tile term-tile"><FontAwesomeIcon icon={faTerminal} /></span>
                            <span>Shell</span>
                          </button>
                          <button className="browse-chip browse-hero-action" onClick={browseTabs.openScratchNote} title="A scratch note in this tab — save it to a workspace when you want to keep it">
                            <span className="browse-tile note-tile"><FontAwesomeIcon icon={faNoteSticky} /></span>
                            <span>Note</span>
                          </button>
                          <button className="browse-chip browse-hero-action" onClick={() => showFolder(filesPath, true)} disabled={!filesPath} title="The file manager in this tab">
                            <span className="browse-tile"><FontAwesomeIcon icon={faFolderOpen} /></span>
                            <span>Files</span>
                          </button>
                        </div>
                        <LocalServerPicks servers={serverLinks} onOpen={openUrl} onRefresh={refreshPorts} />
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
          {drawerCwd !== null && (
            <>
              {drawerOpen && <div className="drawer-divider" onPointerDown={startDrawerResize} title="Drag to resize" />}
              <section className={`browse-drawer ${drawerOpen ? '' : 'is-hidden'}`} style={{ height: drawerH }}>
                <TerminalTab
                  variant="panel"
                  tabId="drawer"
                  cwd={drawerCwd || null}
                  active={isActive && drawerOpen}
                  filesPath={contextDir() || null}
                  onPopOut={(cwd) => openTerminal(cwd)}
                  onHide={() => setDrawerOpen(false)}
                  onOpenUrl={(url) => browseTabs.openInNew(url, { position: 'after' })}
                />
              </section>
            </>
          )}
        </main>
      )}

      {clipToast && (
        <div className={`clip-toast ${clipToast.error ? 'is-error' : ''}`} role="status">
          <span>{clipToast.text}</span>
          {!clipToast.error && !clipToast.info && (
            <button
              className="fm-status-link"
              onClick={() => { if (!clipToast.link) setWsContextOpen(true); goHome(); setClipToast(null); }}
            >
              Show
            </button>
          )}
        </div>
      )}
      {filesVisited && !isSidebarWidth && (
        <>
          {filesShown && <div className="browse-divider files-divider" onPointerDown={startFilesResize} />}
          <aside className={`browse-files ${filesShown ? '' : 'is-hidden'}`} style={{ width: filesWidth }}>
            <FilesView
              active={filesShown && isActive}
              onClose={() => setFilesOpen(false)}
              tab={filesTab}
              onTab={setFilesTab}
              shelf={shelf}
              nav={navContent}
              notesUrl={pageUrl}
              notesPaneId={tabPaneId(browseTabs.activeId)}
              onOpen={openPath}
              page={{
                tools: browseMode && !activeTab.file && !activeTab.term && !activeTab.note && !activeTab.special ? pageTools : null,
                pages: openPages,
                totals: { memory: pagesMemory, cpu: pagesCpu, app: stats?.app_memory, appCpu: stats?.app_cpu },
                live: stats?.panes.find(p => p.id === pageTools?.paneId) || null,
                onClosePage: (p) => { if (p.tabId) browseTabs.close(p.tabId); },
              }}
            />
          </aside>
        </>
      )}
    </div>
  );
}
