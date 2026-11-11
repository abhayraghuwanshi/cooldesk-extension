import { faCompass, faDiagramProject, faFolder, faFolderOpen, faGear, faGlobe, faHouse, faNoteSticky, faThumbtack, faPlus, faTerminal, faExpand, faSearch, faServer, faTableCellsLarge, faWindowMaximize, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserPane } from '../../features/browser/BrowserPane';
import { normalizeAddress } from '../../features/browser/useNativePane';
import { engineFor, fetchWebSuggestions, getEngineKey, getWebSuggestEnabled, searchUrl } from '../../shared/searchEngines';
import { usePaneGuard } from '../../features/browser/usePaneGuard';
import { FilesView } from './FilesView';
import { FileIcon, FileTab } from './FileTab';
import { NoteTab } from './NoteTab';
import { SpecialTab } from './SpecialTab';
import { ToolbarMenu } from './ToolbarMenu';
import { TerminalTab } from '../../features/terminal/TerminalTab';
import { registerTerminalHost, useSpotlightRuns } from '../../features/terminal/runInTerminal';
import { WorkspaceContextPanel } from '../workspace/WorkspaceList';
import { clipSummary, saveClipToWorkspace } from '../../features/browser/clipToNote';
import { useShelf } from '../../features/shelf/useShelf';
import { SPECIAL_TITLES, tabPaneId, useBrowseTabs } from './useBrowseTabs';
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
const MULTI_SIZES_KEY = 'cooldesk.browse.multiSizes';
const WS_CONTEXT_KEY = 'cooldesk.browse.workspaceContext';
// Home: how many rows a section shows before "+N more".
const HOME_CAP = { tabs: 8, pinned: 6, folders: 8 };
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

const IS_MAC_UI = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
// Most tabs multi view shows side by side.
const MULTI_MAX = 6;
const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);
// A blank tab: a new tab's start screen (not a page, file or terminal).
const isBlank = (t) => !t.url && !t.file && !t.term && !t.note && !t.special;

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
  useSpotlightRuns(true);

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

  // 🏠: Home lives in the side panel, so it never covers what's on the left.
  const goHome = useCallback(() => {
    setFilesTab('tabs');
    setFilesOpen(true);
  }, [setFilesTab, setFilesOpen]);
  const goHomeRef = useRef(goHome);
  goHomeRef.current = goHome;
  const homeShown = filesShown && filesTab === 'tabs';

  // A new (blank) tab brings Home up beside its start screen.
  const blankActive = isBlank(activeTab);
  useEffect(() => {
    if (blankActive && isActive) goHomeRef.current();
  }, [browseTabs.activeId, blankActive, isActive]);

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
  // Grid for n tiles: 1 → full, 2 → side by side, 3–4 → 2×2, 5–6 → 3×2.
  const multiCols = !multiTabs ? 1 : multiTabs.length <= 1 ? 1 : multiTabs.length <= 4 ? 2 : 3;
  const multiRows = !multiTabs ? 1 : Math.max(1, Math.ceil(multiTabs.length / multiCols));
  // Tiles fill column by column; when they don't fill the grid, the last one
  // stretches down its column (3 tabs: two stacked left, one tall right).
  const lastTiledId = canvasMode ? [...browseTabs.tabs].reverse().find(t => tiledIds.has(t.id))?.id : null;
  const lastSpan = multiTabs && multiRows > 1 ? multiRows - ((multiTabs.length - 1) % multiRows) : 1;
  // Column / row sizes (fr), dragged by the dividers between tiles and
  // remembered per layout ("2x2", "3x2"…).
  const multiKey = `${multiCols}x${multiRows}`;
  const [multiSizes, setMultiSizes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MULTI_SIZES_KEY) || '{}') || {}; } catch { return {}; }
  });
  const sizesFor = (kind, n) => {
    const saved = multiSizes[multiKey]?.[kind];
    return Array.isArray(saved) && saved.length === n ? saved : Array(n).fill(1);
  };
  const colFr = sizesFor('cols', multiCols);
  const rowFr = sizesFor('rows', multiRows);
  const multiGridRef = useRef(null);
  const saveMultiSizes = (next) => {
    setMultiSizes(next);
    persist(MULTI_SIZES_KEY, JSON.stringify(next));
  };
  // Drag the divider after column/row `index`: the two tracks either side of
  // it trade size; the rest stay put. Double-click evens them all out.
  const startMultiResize = (kind, index) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const grid = multiGridRef.current;
    if (!grid) return;
    const horizontal = kind === 'cols';
    const total = horizontal ? grid.clientWidth : grid.clientHeight;
    const start = horizontal ? e.clientX : e.clientY;
    const fr = [...(horizontal ? colFr : rowFr)];
    const sum = fr.reduce((a, b) => a + b, 0);
    const min = (sum / fr.length) * 0.25;
    let latest = fr;
    let frame = 0;
    document.documentElement.classList.add(horizontal ? 'multi-resizing-x' : 'multi-resizing-y');
    const onMove = (ev) => {
      const d = (((horizontal ? ev.clientX : ev.clientY) - start) / Math.max(1, total)) * sum;
      const pair = fr[index] + fr[index + 1];
      const a = Math.min(pair - min, Math.max(min, fr[index] + d));
      latest = fr.map((v, i) => (i === index ? a : i === index + 1 ? pair - a : v));
      setMultiSizes(m => ({ ...m, [multiKey]: { ...m[multiKey], [kind]: latest } }));
      // The pages are native layers: nudge them to follow every frame
      // rather than at their usual poll.
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; window.dispatchEvent(new Event('resize')); });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.documentElement.classList.remove('multi-resizing-x', 'multi-resizing-y');
      setMultiSizes(m => {
        const next = { ...m, [multiKey]: { ...m[multiKey], [kind]: latest } };
        persist(MULTI_SIZES_KEY, JSON.stringify(next));
        return next;
      });
      window.dispatchEvent(new Event('resize'));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const resetMultiSizes = (kind) => () => {
    saveMultiSizes({ ...multiSizes, [multiKey]: { ...multiSizes[multiKey], [kind]: null } });
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };
  // Where the dividers sit (% of the grid), between consecutive tracks.
  const dividerAt = (fr) => {
    const sum = fr.reduce((a, b) => a + b, 0);
    let acc = 0;
    return fr.slice(0, -1).map(f => { acc += f; return (acc / sum) * 100; });
  };

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
    persist(LIST_WS_KEY, id);
    // The panel's pick is the app's current workspace too — otherwise the
    // next launch (which restores that one) would switch the panel back.
    onSelectWorkspace?.(id);
  };
  useEffect(() => { if (activeWorkspaceId) setListWsState(activeWorkspaceId); }, [activeWorkspaceId]);
  const isFileItem = (a) => (a?.appType === 'file' || a?.appType === 'folder') && a.path;
  const wsWithLinks = useMemo(() => savedWorkspaces
    .map(ws => ({
      ws,
      count: (ws.urls || []).filter(u => isWebUrl(u?.url)).length + (ws.apps || []).filter(isFileItem).length,
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
        if (!payload) return;
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
  const toolbarStart = (
    <button className={`bp-btn ${homeShown ? 'on' : ''}`} onClick={goHome} title="Home: workspace, tabs, apps and folders (in the side panel)">
      <FontAwesomeIcon icon={faHouse} />
    </button>
  );
  const toolbarEnd = (
    <>
    {/* One layout button: single view, multi view (tabs side by side) or
        focus mode (the page alone). Shows the current layout. */}
    <ToolbarMenu
      icon={focusOn ? faExpand : canvasMode ? faTableCellsLarge : faWindowMaximize}
      title="Layout"
      items={[
        { key: 'single', icon: faWindowMaximize, label: 'Single view', checked: !canvasMode && !focusOn, onSelect: () => { setFocusMode(false); setMode('browse'); } },
        { key: 'multi', icon: faTableCellsLarge, label: 'Multi view — tabs side by side', checked: canvasMode && !focusOn, onSelect: () => { setFocusMode(false); setMode('canvas'); } },
        null,
        { key: 'focus', icon: faExpand, label: focusOn ? 'Exit focus mode' : 'Focus mode', checked: focusOn, hint: IS_MAC_UI ? '⌘⇧F' : 'Ctrl+Shift+F', onSelect: () => setFocusMode(v => !v) },
      ]}
    />
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
    style: canvasMode && tab.id === lastTiledId && lastSpan > 1 ? { gridRow: `span ${lastSpan}` } : undefined,
    // A click anywhere in a tile makes it the current tab (the keyboard
    // goes there). A web page itself is a native layer and doesn't report
    // clicks to us — its address bar does.
    onMouseDownCapture: canvasMode && !isCurrent ? () => browseTabs.activate(tab.id) : undefined,
  });
  const paneStart = canvasMode ? null : toolbarStart;
  const paneEnd = (tab) => (canvasMode ? (
    <>
      <button className="bp-btn" onClick={() => { browseTabs.activate(tab.id); setMode('browse'); }} title="Just this tab (single view)">
        <FontAwesomeIcon icon={faExpand} />
      </button>
      <button className="bp-btn" onClick={() => browseTabs.close(tab.id)} title="Close tab">
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </>
  ) : toolbarEnd);

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
  const tabForUrl = (url) => browseTabs.tabs.find(t => !t.file && !t.term && !t.note && !t.special && (t.url === url || t.req.url === url));
  const tabForPath = (path) => browseTabs.tabs.find(t => t.file?.path === path);

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
    const asleep = !tab.file && !tab.term && !tab.note && !tab.special && !browseTabs.live.has(tab.id);
    return (
      <div
        key={tab.id}
        role="tab"
        aria-selected={tab.id === browseTabs.activeId}
        className={`browse-tab-row is-open ${tab.id === browseTabs.activeId ? 'active' : ''} ${asleep ? 'asleep' : ''}`}
        onClick={() => browseTabs.activate(tab.id)}
        onAuxClick={(e) => { if (e.button === 1) browseTabs.close(tab.id); }}
        title={tab.file ? tab.file.path : tab.term ? `Shell — ${tab.term.cwd || '~'}` : tab.note ? `Note${tab.note.workspaceName ? ` in ${tab.note.workspaceName}` : ''}` : tab.special ? SPECIAL_TITLES[tab.special] : asleep ? `${tab.url || 'New tab'}\nAsleep (reloads when opened)` : (tab.url || 'New tab')}
      >
        {tab.file
          ? <span className="browse-tile"><FileIcon path={tab.file.path} isDir={tab.file.isDir} /></span>
          : tab.term
            ? <span className="browse-tile term-tile"><FontAwesomeIcon icon={faTerminal} /></span>
          : tab.note
            ? <span className="browse-tile note-tile"><FontAwesomeIcon icon={faNoteSticky} /></span>
          : tab.special
            ? <span className="browse-tile"><FontAwesomeIcon icon={tab.special === 'settings' ? faGear : faDiagramProject} /></span>
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
            {group.items.map(item => (item.path ? renderPinnedFile(item) : renderPinnedLink(item)))}
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
              </div>
              {capped('tabs', openTabs, renderTabRow)}
            </section>

            {/* The workspace's pinned links and files — the workspace is
                picked right in the header, its notes one button over. */}
            {(shownWs || serverLinks.length > 0) && (
              <section className="nav-section">
                <div className="nav-section-head nav-ws-head">
                  {shownWs ? (
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
                  ) : <span>Local servers</span>}
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
                {shownWs && pinnedLinks.length + pinnedFiles.length === 0 && (
                  <div className="browse-hint">Links, files and folders you add to {shownWs.ws.name} show up here.</div>
                )}
                {capped('pinned', [...pinnedLinks, ...pinnedFiles, ...serverLinks], item => (item.path ? renderPinnedFile(item) : renderPinnedLink(item)))}
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
      {isSidebarWidth && <aside className="browse-list">{navContent}</aside>}

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
              <button className="bp-btn" onClick={() => openTerminal()} title="New terminal tile">
                <FontAwesomeIcon icon={faTerminal} />
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
            style={canvasMode ? {
              gridTemplateColumns: colFr.map(f => `minmax(0, ${f}fr)`).join(' '),
              gridTemplateRows: rowFr.map(f => `minmax(0, ${f}fr)`).join(' '),
              gridAutoFlow: 'column',
            } : undefined}
          >
            {/* Dividers between tiles: drag to resize, double-click to even
                out. A row divider stops short of a last column whose tile
                spans every row. */}
            {canvasMode && dividerAt(colFr).map((pct, i) => (
              <div
                key={`c${i}`}
                className="multi-divider is-col"
                style={{ left: `calc(${pct}% - 5px)` }}
                onPointerDown={startMultiResize('cols', i)}
                onDoubleClick={resetMultiSizes('cols')}
                title="Drag to resize · double-click to even out"
              />
            ))}
            {canvasMode && dividerAt(rowFr).map((pct, i) => (
              <div
                key={`r${i}`}
                className="multi-divider is-row"
                style={{
                  top: `calc(${pct}% - 5px)`,
                  right: lastSpan > 1 ? `${100 - dividerAt(colFr).slice(-1)[0]}%` : 0,
                }}
                onPointerDown={startMultiResize('rows', i)}
                onDoubleClick={resetMultiSizes('rows')}
                title="Drag to resize · double-click to even out"
              />
            ))}
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
                      toolbarStart={paneStart}
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
                      onTitle={(title) => browseTabs.noteTitle(tab.id, title)}
                      onClose={() => browseTabs.close(tab.id)}
                      onOpenUrl={(url) => browseTabs.openInNew(url, { position: 'after' })}
                      onOpenPath={openPath}
                      onOpenShell={openTerminal}
                      toolbarStart={paneStart}
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
                      toolbarStart={paneStart}
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
                      onOpenFile={(path) => browseTabs.openFileTab(path, false, true)}
                      onOpenUrl={(url) => browseTabs.openInNew(url, { position: 'after' })}
                      onShowFolder={(dir) => showFolder(dir, true)}
                      onBack={tab.back?.length ? () => browseTabs.step(-1) : null}
                      onForward={tab.fwd?.length ? () => browseTabs.step(1) : null}
                      onShowInFiles={showInFiles}
                      onOpenTerminal={openTerminal}
                      toolbarStart={paneStart}
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
                    toolbarStart={paneStart}
                    toolbarEnd={paneEnd(tab)}
                    emptyState={(
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
          {!clipToast.error && (
            <button
              className="fm-status-link"
              onClick={() => { setWsContextOpen(true); goHome(); setClipToast(null); }}
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
