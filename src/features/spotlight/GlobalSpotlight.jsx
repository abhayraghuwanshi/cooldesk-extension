import { faChrome, faCss3Alt, faDiscord, faEdge, faFirefox, faGithub, faGolang, faHtml5, faJava, faJs, faMarkdown, faNodeJs, faPhp, faPython, faReact, faRust, faSlack, faSpotify, faSwift, faVuejs } from '@fortawesome/free-brands-svg-icons';
import { faBold, faBriefcase, faCalculator, faChartLine, faCloud, faCode, faCog, faComments, faDatabase, faDesktop, faEnvelope, faFile, faFileCode, faFileCsv, faFileExcel, faFileLines, faFilePdf, faFilePowerpoint, faFileWord, faFileZipper, faFlask, faFolder, faFolderOpen, faFont, faGamepad, faGlobe, faGraduationCap, faHashtag, faHeartPulse, faHistory, faHome, faImage, faItalic, faLightbulb, faLink, faListOl, faListUl, faMicrochip, faMicrophone, faMusic, faNewspaper, faPalette, faPlane, faPlus, faQuoteRight, faRobot, faSearch, faShoppingBag, faStar, faStickyNote, faStrikethrough, faTasks, faTerminal, faThumbtack, faTimes, faTools, faUtensils, faVial, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    SiC, SiClojure, SiCplusplus, SiCss, SiDart, SiDocker, SiElixir, SiGnubash, SiGo,
    SiGraphql, SiHaskell, SiHtml5, SiJavascript, SiJson, SiJupyter, SiKotlin, SiLua,
    SiMarkdown, SiMysql, SiOpenjdk, SiPerl, SiPhp, SiPrisma, SiPython, SiR, SiReact,
    SiRuby, SiRust, SiSass, SiScala, SiSharp, SiSqlite, SiSvelte, SiSwift, SiTailwindcss,
    SiToml, SiTypescript, SiVuedotjs, SiYaml,
} from 'react-icons/si';
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { storageGet, storageSet } from '../../services/extensionApi';
import { syncWebSocket } from '../../services/syncWebSocket';
import { isHostSyncEnabled } from '../../services/syncConfig';
import { recordSearchSelection } from '../../services/feedbackService';
import { recordSpotlightOpen } from '../../services/analytics';
import * as LocalAI from '../../services/localAIService';
import { runningAppsService } from '../../services/runningAppsService';
import { browseApps, browseUrls, isNaturalLanguageQuery, naturalLanguageSearch, quickSearch, refreshElectronCache } from '../../services/searchService';
import { searchWindowsSettings } from '../../data/windowsSettings';
import { searchWindowsTools } from '../../data/windowsTools';
import { enrichRunningAppsWithIcons, getFaviconUrl, getGroupDomainFromUrl, isRealPointerMove } from '../../utils/helpers';
import { getPreviewItem } from '../../utils/filePreviewKind';
import { useIsSidebarWidth } from '../../shared/hooks/useIsSidebarWidth';
import { useSlashCommands } from './useSlashCommands';
import { useVoiceCommands } from './useVoiceCommands';
import { useAiCli } from './useAiCli';
import { AgentMarkdown } from './AgentMarkdown';
import { CopyButton } from './CopyButton';
// Lazy: Prism + its ~20 language grammars are real weight (see PreviewPane.jsx's
// import list). Loading them eagerly would tax every spotlight open, even the
// vast majority that never touch a file preview — split into their own chunk
// and fetch it only the first time a previewable file is actually selected.
const PreviewPane = lazy(() => import('./PreviewPane'));
// Same rich-text editor WorkspaceContextPanel.jsx uses for notes — reused
// here rather than a second, plain-text editor, so a note edited from either
// place round-trips through the exact same HTML shape.
const TiptapEditor = lazy(() => import('../../faces/workspace/parts/editor/TiptapEditor'));
import { describeAction } from '../../services/workspaceActions';
import { useWorkspaceScaffold } from './useWorkspaceScaffold';
import { useNewWorkspaceMode } from './useNewWorkspaceMode';
import { useEditWorkspaceMode } from './useEditWorkspaceMode';
import { VOICE_SEARCH_ENABLED } from '../../config/features';
import './GlobalSpotlight.css';


// ==========================================
// PERFORMANCE OPTIMIZATIONS
// - LRU Cache for instant repeated queries
// - Request ID tracking to prevent stale results
// - Reduced debounce (50ms vs 150ms)
// ==========================================

class LRUCache {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    get(key) {
        if (!this.cache.has(key)) return null;
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }
    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(key, value);
    }
    clear() { this.cache.clear(); }
}

// Global cache persists across re-renders
const searchCache = new LRUCache(100);

// Last real mouse position, shared across every ResultItem instance — see the
// mouseenter guard in ResultItem for why this needs to live outside React
// state (it must survive remounts of individual rows as the list reflows).
const lastPointerPos = { x: -1, y: -1 };

// Windows Settings (ms-settings: pages) are only launchable on the Windows
// desktop build — the `open_url` backend uses ShellExecute, and the URI scheme
// is Windows-only. Gate the catalog on both so we never surface unopenable rows.
const IS_WINDOWS_DESKTOP =
    typeof navigator !== 'undefined' &&
    /Windows/i.test(navigator.userAgent || '') &&
    typeof window !== 'undefined' &&
    !!(window.electronAPI || window.__TAURI__ || window.__TAURI_INTERNALS__);

// Track app usage for recommendations
async function trackAppUsage(appName) {
    if (!appName) return;
    try {
        const data = await storageGet(['frequent_apps']);
        const frequent = data.frequent_apps || {};
        const key = appName.toLowerCase();
        frequent[key] = (frequent[key] || 0) + 1;

        // Keep only top 20 apps
        const sorted = Object.entries(frequent)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);
        await storageSet({ frequent_apps: Object.fromEntries(sorted) });
    } catch (e) {
        // Ignore tracking errors
    }
}

// Map app names to FontAwesome icons
const APP_ICONS = {
    // Browsers
    'chrome': faChrome,
    'msedge': faEdge,
    'firefox': faFirefox,
    'edge': faEdge,
    // Dev tools
    'code': faCode,
    'vscode': faCode,
    'visual studio code': faCode,
    'windowsterminal': faTerminal,
    'cmd': faTerminal,
    'cmd.exe': faTerminal,
    'command prompt': faTerminal,
    'powershell': faTerminal,
    'pwsh': faTerminal,
    'terminal': faTerminal,
    'wt': faTerminal,
    'bash': faTerminal,
    'mintty': faTerminal,
    'conemu': faTerminal,
    'alacritty': faTerminal,
    'hyper': faTerminal,
    'github desktop': faGithub,
    // Communication
    'discord': faDiscord,
    'slack': faSlack,
    'teams': faComments,
    'outlook': faEnvelope,
    'mail': faEnvelope,
    // Media
    'spotify': faSpotify,
    'vlc': faVideo,
    'photos': faImage,
    'groove': faMusic,
    // Games
    'steam': faGamepad,
    // System
    'explorer': faFolder,
    'notepad': faFile,
    'calculator': faCalculator,
    'settings': faCog,
};

// Editor app types stored in workspaces that launch via their CLI command
// (e.g. `code <path>`) instead of a plain executable path.
const WS_EDITORS = ['vscode', 'code', 'cursor', 'windsurf', 'idea', 'webstorm', 'pycharm', 'goland', 'phpstorm', 'rider', 'clion', 'fleet', 'zed'];

// Scoped search prefixes — "/a term" searches apps only, "/u" urls, "/f" files.
// The prefix is stripped before searching and results are filtered to the
// scope's types. The regex requires whitespace (or end) after the letter so
// "/ai" and "/model" command detection is never shadowed.
const SEARCH_SCOPES = {
    // 'workspace-url' is a link saved inside a workspace — shown in results as
    // "Link" (see getBadgeLabel below). Without it, "/u" missed exactly the
    // saved links a user is most likely searching for, only covering open
    // tabs, browsing history, and bookmarks/pins. 'url' is the synthetic
    // direct-navigation guess built from the typed text itself (see
    // looksLikeUrl below) — without it, typing a bare domain under "/u"
    // wouldn't surface that guess even though it's exactly a URL result.
    u: { label: 'URLs', types: ['tab', 'history', 'bookmark', 'workspace-url', 'url'] },
    a: { label: 'Apps', types: ['app'] },
    f: { label: 'Files', types: ['file', 'folder'] },
};

// Recognizes typed text that already looks like a domain/URL — "gmail.com",
// "sub.example.co.uk/path" — so it can be offered as a direct destination.
// Without this, a query like "gmail.com" that doesn't happen to match any
// open tab/history/bookmark/app falls all the way through to a Google-search
// fallback instead of just... going to gmail.com.
function looksLikeUrl(text) {
    const t = (text || '').trim();
    if (!t || /\s/.test(t)) return false;
    if (/^https?:\/\//i.test(t)) return true;
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?(\/\S*)?$/i.test(t);
}

// Normalize a query that looksLikeUrl() accepted into a fetchable URL —
// adds https:// when the user didn't type a scheme.
function toNavigableUrl(text) {
    const t = text.trim();
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

// Default browsable list for a bare "/f" (no query yet). search_files itself
// refuses an empty query outright — scanning the whole home folder with
// nothing to filter by would be slow and mostly noise — so this uses
// get_frequent_folders instead: folders from the OS's own "recently used"
// tracking (Recent Items on macOS, Quick Access on Windows), the same source
// TabManagement's "Popular Folders" section already relies on.
async function browseFrequentFolders(maxResults = 20) {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const folders = await invoke('get_frequent_folders');
        if (!Array.isArray(folders)) return [];
        return folders.slice(0, maxResults).map(f => ({
            id: `folder:${f.path}`,
            type: 'folder',
            title: f.name,
            description: f.path,
            path: f.path,
            icon: 'folder',
            isDir: true,
        }));
    } catch {
        return [];
    }
}
// Fixed id, not a generated one: this is a singleton workspace, so re-running
// this on every /agent call must find the same record instead of piling up
// duplicates.
const AGENT_WORKSPACE_ID = 'ws_cooldesk_agent';

/**
 * Resolve (and lazily create) the dedicated folder + workspace record that
 * every `/agent` run uses as its working directory. The folder itself is
 * owned and pre-trusted by the Rust side (see `get_agent_workspace_dir` /
 * `agent_workspace_dir` in `src-tauri/src/lib.rs`); this just mirrors it into
 * the workspace list so it's visible like any other project.
 */
async function getOrCreateAgentWorkspaceCwd() {
    try {
        const [{ invoke }, { getWorkspace, saveWorkspace }] = await Promise.all([
            import('@tauri-apps/api/core'),
            import('../../db/index.js'),
        ]);
        const dir = await invoke('get_agent_workspace_dir');

        const existing = await getWorkspace(AGENT_WORKSPACE_ID).catch(() => null);
        const existingData = existing?.success ? existing.data : existing;
        if (!existingData) {
            await saveWorkspace({
                id: AGENT_WORKSPACE_ID,
                name: 'Cooldesk',
                description: 'Working directory for chats started from the Cooldesk spotlight agent.',
                createdAt: Date.now(),
                gridType: 'ItemGrid',
                status: 'active',
                urls: [],
                apps: [{ name: 'Cooldesk', path: dir, appType: 'folder' }],
            });
        }
        return dir;
    } catch (e) {
        console.warn('[Spotlight] agent: failed to resolve agent workspace dir', e);
        return null;
    }
}

function parseScopedQuery(q) {
    const m = /^\/([uaf])(?:\s+(.*))?$/i.exec(q || '');
    if (!m) return { scope: null, term: q || '' };
    return { scope: SEARCH_SCOPES[m[1].toLowerCase()], term: (m[2] || '').trim() };
}

// Does a workspace name match what was typed after "/"? Prefix-of-whole-name
// covers "/ent" -> "entertainment"; word-prefix covers "/website" ->
// "cooldesk website" (typing a later word in a multi-word name), which a
// bare startsWith on the full name would otherwise miss entirely.
function workspaceNameMatchesTyped(name, typedLower) {
    if (!typedLower) return false;
    const n = (name || '').trim().toLowerCase();
    if (n.startsWith(typedLower)) return true;
    return n.split(/\s+/).some(word => word.startsWith(typedLower));
}

// Get icon for app by name
function getAppIcon(appName) {
    if (!appName) return faDesktop;
    const name = appName.toLowerCase();
    for (const [key, icon] of Object.entries(APP_ICONS)) {
        if (name.includes(key)) return icon;
    }
    return faDesktop;
}

function getRunningAppContext(app) {
    const title = (app?.title || '').trim();
    const appName = (app?.name || '').trim();
    if (!title) return null;

    const normalizedApp = appName.toLowerCase().replace(/\.exe$/i, '');
    const isEditor = ['code', 'vscode', 'visual studio code', 'cursor', 'windsurf', 'zed'].some(key =>
        normalizedApp.includes(key)
    );

    if (isEditor) {
        const parts = title.split(/\s[-–—]\s/).map(part => part.trim()).filter(Boolean);
        const editorSuffixes = new Set([
            'visual studio code',
            'code',
            'cursor',
            'windsurf',
            'zed'
        ]);

        while (parts.length > 0 && editorSuffixes.has(parts[parts.length - 1].toLowerCase())) {
            parts.pop();
        }

        if (parts.length >= 2) return parts[parts.length - 1];
        if (parts.length === 1 && parts[0].toLowerCase() !== title.toLowerCase()) return parts[0];
    }

    return title !== appName ? title : null;
}

function isWindowsTerminalApp(app) {
    const name = (app?.name || '').toLowerCase();
    const path = (app?.path || '').toLowerCase();
    return name.includes('windowsterminal') ||
        name.includes('windows terminal') ||
        path.includes('windowsterminal') ||
        path.includes('microsoft.windowsterminal');
}

// Hook to detect click outside
function useOnClickOutside(ref, handler) {
    useEffect(() => {
        const listener = (event) => {
            // Do nothing if clicking ref's element or descendent elements
            if (!ref.current || ref.current.contains(event.target)) {
                return;
            }
            handler(event);
        };
        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [ref, handler]);
}

// Map a search result onto the shape a workspace stores. Workspaces hold two
// kinds of thing — urls[] and apps[] — so every result has to land as one or
// the other, and anything that is neither (a Windows setting, a control-panel
// applet, another workspace) simply isn't addable. Returning null says so;
// the caller reports it rather than silently dropping the click.
function resultToWorkspaceItem(item) {
    if (!item) return null;
    // A workspace can't be filed into a workspace. It's called out rather than
    // left to the default branch because workspace rows can carry a `url`,
    // which would otherwise quietly add the workspace as a link.
    if (item.type === 'workspace') return null;
    switch (item.type) {
        case 'tab':
        case 'bookmark':
        case 'history':
        case 'url':
            return item.url
                ? { kind: 'url', url: item.url, title: item.title || item.name || item.url, favicon: item.favicon || null }
                : null;
        case 'folder':
            return item.path ? { kind: 'app', name: item.name || item.title, path: item.path, appType: 'folder', icon: null } : null;
        case 'file':
            return item.path ? { kind: 'app', name: item.name || item.title, path: item.path, appType: 'file', icon: null } : null;
        case 'app':
            return item.path
                ? { kind: 'app', name: item.name || item.title, path: item.path, icon: item.icon || null }
                : null;
        default:
            // A bare url with no recognised type still files as a link.
            return item.url
                ? { kind: 'url', url: item.url, title: item.title || item.name || item.url, favicon: item.favicon || null }
                : null;
    }
}

// The one search component for every surface.
//   variant="overlay"  — the dedicated Alt+K spotlight window (default; closes
//                        via SPOTLIGHT_HIDE like before)
//   variant="embedded" — lives inline (CoolDesk header); results render in an
//                        anchored dropdown and closing just collapses it
// Optional capabilities are activated per surface:
//   enableVoice / enableSlashCommands — mic + /nav & !bang command palette
//   onNavigate / onWorkspaceNavigate  — host face/workspace switching
//   sections — hide idle sections ({ context, pins, workspaces, footer })
//   addTarget / onAddItem / onExitAddMode — "add mode": while a workspace is
//     the target, picking a result collects it into that workspace instead of
//     launching it. This is why workspace cards have no search box of their
//     own: the same index that finds a tab to jump to finds the tab to file.
export function GlobalSpotlight({
    variant = 'overlay',
    onNavigate = null,
    onWorkspaceNavigate = null,
    isDesktopApp = false,
    enableVoice = false,
    enableSlashCommands = false,
    placeholder = null,
    sections: sectionsProp = null,
    addTarget = null,
    onAddItem = null,
    onExitAddMode = null,
} = {}) {
    const isEmbedded = variant === 'embedded';
    const sections = { context: true, pins: true, workspaces: true, footer: true, ...(sectionsProp || {}) };
    const [query, setQuery] = useState('');
    // Embedded: the idle/results panel drops down only while the search is engaged
    const [panelOpen, setPanelOpen] = useState(false);
    // Command/voice feedback toast ({ message, type })
    const [feedback, setFeedback] = useState(null);
    const feedbackTimeoutRef = useRef(null);
    const [results, setResults] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [selectedPinIndex, setSelectedPinIndex] = useState(-1);
    const [pinnedItems, setPinnedItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [deepSearch, setDeepSearch] = useState(false);
    const [showAllResults, setShowAllResults] = useState(false);
    // Folder tree: expand folders inline (Explorer/Reddit-style hierarchy).
    const [expandedPaths, setExpandedPaths] = useState(() => new Set());
    const [treeChildren, setTreeChildren] = useState({}); // path -> child items[]
    const inputRef = useRef(null);
    const containerRef = useRef(null);
    // /edit-workspace's note editor — reused across notes (one at a time is
    // ever open) so the toolbar below can reach the live Tiptap instance via
    // TiptapEditor's own getEditor() handle, without TiptapEditor.jsx itself
    // needing to render a persistent toolbar (it only has floating/bubble
    // menus — see workspaceNoteToolbarButtons below).
    const noteEditorRef = useRef(null);

    const [contextItems, setContextItems] = useState([]);
    const [showAllTabs, setShowAllTabs] = useState(false);
    const [showAllApps, setShowAllApps] = useState(false);
    const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
    // Fixed-position coords for the workspace menu. The menu must escape the
    // container's overflow:hidden (it clips at the panel edge — worst while
    // tabs are still loading and the panel is short), so it renders
    // position:fixed and is placed relative to the trigger here.
    const [wsMenuStyle, setWsMenuStyle] = useState(null);
    const wsDropdownRef = useRef(null);
    // Workspace entries scroll internally when the section is squeezed by the
    // 70vh panel cap — keep the keyboard-selected chip visible. Hover-driven
    // selection is skipped (same reasoning as ResultItem's hover-scroll guard).
    const wsEntriesRef = useRef(null);
    const wsHoverSelectedRef = useRef(false);
    const [workspaces, setWorkspaces] = useState([]);
    const [expandedWorkspaceId, setExpandedWorkspaceId] = useState(() => {
        try { return localStorage.getItem('spotlight_ws_id') || null; } catch { return null; }
    });

    // WebSocket connection state
    const [wsConnected, setWsConnected] = useState(() => syncWebSocket.isConnected());

    // AI/Model command states
    const [commandMode, setCommandMode] = useState(null); // null, 'ai', 'model'
    const [aiMessages, setAiMessages] = useState([]);
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [isModelLoading, setIsModelLoading] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [currentModel, setCurrentModel] = useState(null);

    // Track search request ID to handle race conditions
    const searchIdRef = useRef(0);

    // Track when results were displayed (for response time feedback)
    const resultsDisplayedAtRef = useRef(null);

    // Tabs the user just closed. Filtered out of context reloads until the close
    // propagates to the source tab list, so the optimistic removal doesn't flicker
    // back when a reload (timer or tabs-synced event) fires before propagation.
    const pendingClosedTabsRef = useRef(new Set());
    // Same tombstone idea for apps: a graceful quit (AppleScript "quit" /
    // WM_CLOSE) can take longer than one reload cycle to actually exit, so
    // without this a reload sees the pid still running and puts the pill
    // right back — the "closes, then comes back" flicker. Keyed by pid;
    // pruned automatically once that pid is no longer in the OS's running
    // list (see loadContextItems), same as pendingClosedTabsRef.
    const pendingClosedAppsRef = useRef(new Set());

    // Sidebar/docked-drawer width: the embedded search has no room — hide entirely
    const isSidebarSize = useIsSidebarWidth();

    // Feedback toast shared by slash commands and voice
    const showFeedback = useCallback((message, type = 'success') => {
        setFeedback({ message, type });
        if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
        if (type !== 'help') {
            feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 3000);
        }
    }, []);
    useEffect(() => () => {
        if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    }, []);

    // Terminal AI CLI behind /agent (see useAiCli / aiAdapters).
    const aiCli = useAiCli();
    const agentLogRef = useRef(null);
    const [agentHistoryOpen, setAgentHistoryOpen] = useState(false);
    const [agentAdapterOpen, setAgentAdapterOpen] = useState(false);

    // Follow the transcript as output streams in. Without this the newest line
    // lands below the fold and a long run looks like it stopped.
    useEffect(() => {
        const el = agentLogRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [aiCli.turns]);

    // .cooldesk scaffold/link logic (used by the /agent panel's "Create
    // workspace" button and /new-workspace's confirm step) — pulled into its
    // own hook so this already-large file doesn't also carry that machinery.
    const {
        wsScaffoldPlan, setWsScaffoldPlan,
        buildScaffoldPlan, resolveWorkspaceProjects, runCreateWorkspace,
    } = useWorkspaceScaffold({ expandedWorkspaceId, aiCli, showFeedback });

    // /new-workspace's guided create wizard — see useNewWorkspaceMode.js.
    const newWorkspace = useNewWorkspaceMode({
        aiCli, showFeedback, buildScaffoldPlan, setWsScaffoldPlan, runCreateWorkspace,
        setCommandMode, setQuery, setExpandedWorkspaceId, setWorkspaces,
    });

    // Typing an existing workspace's own name (e.g. "/cool-verse") opens it
    // here — see useEditWorkspaceMode.js.
    const editWorkspace = useEditWorkspaceMode({ showFeedback, setCommandMode, setQuery, setWorkspaces });

    // Closing the note editor or an inline todo edit unmounts whatever DOM
    // node had focus (the Tiptap contenteditable, or the todo's <input>) —
    // the browser doesn't hand focus back to anything, so ↑↓ navigation
    // (bound to the main input's own onKeyDown) would otherwise go dead
    // until the user clicks the search box again. Refocus it the moment
    // we're back to plain list-browsing.
    useEffect(() => {
        if (commandMode === 'edit-workspace' && !editWorkspace.activeNoteId && !editWorkspace.editingTodoId) {
            inputRef.current?.focus();
        }
    }, [commandMode, editWorkspace.activeNoteId, editWorkspace.editingTodoId]);

    // Files/folders (and other results) picked from the list while composing
    // an /agent request — the spotlight's answer to a CLI's "@file" attach.
    // Chips stay attached across follow-ups until removed or the chat resets.
    const [agentContext, setAgentContext] = useState([]);

    // Stage a result as context instead of opening it. Folders/apps/urls/etc.
    // attach as a bare path/name reference (the chat run has no Read tool, so
    // it can't fetch them itself); a real file's text is read once here and
    // capped hard — this is context for a question, not the whole file.
    const attachToAgentContext = useCallback(async (item) => {
        if (!item) return;
        const kind = item.type === 'folder' ? 'folder' : item.type === 'file' ? 'file' : 'ref';
        const path = item.path || item.url || null;
        const name = item.title || item.name || path || 'item';
        if (!path) { showFeedback(`Can't attach "${name}" — no path`, 'error'); return; }

        const id = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        setAgentContext(prev => prev.some(c => c.path === path)
            ? prev
            : [...prev, { id, kind, name, path, content: null, status: kind === 'file' ? 'loading' : 'ready' }]);
        setQuery('');
        inputRef.current?.focus();

        if (kind !== 'file') return;
        const ATTACH_CAP = 20_000; // context for a question, not the whole file
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const result = await invoke('preview_text_file', { path });
            const content = result.content.length > ATTACH_CAP
                ? `${result.content.slice(0, ATTACH_CAP)}\n…(truncated)`
                : result.content;
            setAgentContext(prev => prev.map(c => c.path === path ? { ...c, content, status: 'ready' } : c));
        } catch (e) {
            console.warn('[Spotlight] attach: could not read file', path, e);
            setAgentContext(prev => prev.map(c => c.path === path ? { ...c, status: 'unreadable' } : c));
        }
    }, [showFeedback]);

    // Send the current /agent request. Workspaces are re-read here rather than
    // taken from the `workspaces` state above: that list is only populated when
    // the workspaces *section* is enabled, and the agent needs the real set
    // regardless of which sections this surface renders.
    const runAgent = useCallback(async (request) => {
        let list = [];
        try {
            const { listWorkspaces } = await import('../../db/index.js');
            const res = await listWorkspaces();
            list = res?.success ? res.data : (Array.isArray(res) ? res : []);
        } catch (e) {
            console.warn('[Spotlight] agent: failed to load workspaces', e);
        }
        // Every /agent run gets its own fixed, dedicated folder rather than
        // guessing at "the active project" from whichever workspace was most
        // recently touched — that heuristic drifted whenever an unrelated
        // workspace got edited, silently pointing the agent at the wrong repo
        // (and an untrusted one, which surfaced as a trust-dialog warning on
        // every run). This directory is app-owned and pre-trusted in Claude
        // Code's config, so it never hits that prompt.
        const cwd = await getOrCreateAgentWorkspaceCwd();
        aiCli.run(request, list, cwd, { attachments: agentContext });
    }, [aiCli, agentContext]);

    // Apply one turn's proposal. The transcript stays up afterwards — the whole
    // point of history is that "now also do X" is a follow-up, not a new session.
    const applyProposal = useCallback(async (turn) => {
        if (!turn?.proposal?.valid?.length) return;
        try {
            const { applyActions } = await import('../../services/workspaceActions');
            const { listWorkspaces } = await import('../../db/index.js');
            const res = await listWorkspaces();
            const list = res?.success ? res.data : (Array.isArray(res) ? res : []);
            const { applied, errors } = await applyActions(turn.proposal.valid, list);
            showFeedback(
                errors.length ? `Applied ${applied}, ${errors.length} failed` : `Applied ${applied} change${applied === 1 ? '' : 's'}`,
                errors.length ? 'error' : 'success'
            );
            if (errors.length) console.warn('[Spotlight] agent apply errors:', errors);
            aiCli.clearProposal(turn.id);
        } catch (e) {
            console.error('[Spotlight] agent apply failed:', e);
            showFeedback('Could not apply changes — see console', 'error');
        }
    }, [aiCli, showFeedback]);

    // "/name <title>" — a fast local shortcut inside /agent mode: renames the
    // active workspace immediately via the same rename_workspace action
    // /agent's own proposals use, with no Claude Code round-trip. Mirrors
    // /model bypassing the LLM for its own selection UI.
    const runRenameWorkspace = useCallback(async (newName) => {
        const name = (newName || '').trim();
        if (!name) return;
        try {
            const [{ listWorkspaces }, { applyActions }] = await Promise.all([
                import('../../db/index.js'),
                import('../../services/workspaceActions'),
            ]);
            const res = await listWorkspaces();
            const list = res?.success ? res.data : (Array.isArray(res) ? res : []);
            const ws = list.find(w => w.id === expandedWorkspaceId) || list[0] || null;
            if (!ws) { showFeedback('No workspace selected to rename', 'error'); return; }
            if (ws.name === name) { showFeedback(`Already named "${name}"`, 'success'); return; }
            const { applied, errors } = await applyActions([{ type: 'rename_workspace', from: ws.name, to: name }], list);
            showFeedback(applied ? `Renamed to "${name}"` : (errors[0] || 'Rename failed'), applied ? 'success' : 'error');
        } catch (e) {
            console.error('[Spotlight] /name failed:', e);
            showFeedback('Rename failed — see console', 'error');
        }
    }, [expandedWorkspaceId, showFeedback]);

    const exitAgentMode = useCallback(() => {
        aiCli.reset();
        setCommandMode(null);
        setQuery('');
        setWsScaffoldPlan(undefined);
        setAgentContext([]);
    }, [aiCli]);

    // Entering add mode hands the user straight to the input with the panel
    // down — the card's "+" is the click that starts this, so a second click
    // just to focus the box would be one too many.
    useEffect(() => {
        if (!addTarget) return;
        setQuery('');
        setResults([]);
        setSelectedIndex(-1);
        setPanelOpen(true);
        inputRef.current?.focus();
    }, [addTarget]);

    // Opt-in capabilities (activated per surface via props)
    const slash = useSlashCommands({ enabled: enableSlashCommands, isDesktopApp, onNavigate, showFeedback });
    const voice = useVoiceCommands({
        // Feature-flagged off globally — the `enableVoice` prop only matters
        // once voice search is switched back on.
        enabled: VOICE_SEARCH_ENABLED && enableVoice,
        onNavigate,
        onSearch: (term) => { setQuery(term); setPanelOpen(true); },
        showFeedback,
    });

    // Close workspace dropdown when clicking outside
    useEffect(() => {
        if (!wsDropdownOpen) return;
        const handler = (e) => {
            if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target)) {
                setWsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [wsDropdownOpen]);

    // Place the workspace menu next to its trigger (left-anchored — the
    // trigger doubles as the section title on the left). Opens downward by
    // default (there is always window space below the panel), flips upward
    // only when the bottom of the viewport is closer than the menu is tall.
    // Re-measures when the panel resizes while open (tabs/apps still loading in).
    useLayoutEffect(() => {
        if (!wsDropdownOpen) { setWsMenuStyle(null); return; }
        const MENU_MAX = 220;
        const MENU_MAX_WIDTH = 260; // keep in sync with .ws-dropdown-menu max-width
        const measure = () => {
            const trigger = wsDropdownRef.current?.querySelector('.ws-dropdown-trigger');
            if (!trigger) return;
            const r = trigger.getBoundingClientRect();
            const spaceBelow = window.innerHeight - r.bottom - 12;
            const spaceAbove = r.top - 12;
            const openDown = spaceBelow >= Math.min(MENU_MAX, spaceAbove);
            setWsMenuStyle({
                left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_MAX_WIDTH - 8)),
                maxHeight: Math.max(80, Math.min(MENU_MAX, openDown ? spaceBelow : spaceAbove)),
                ...(openDown
                    ? { top: r.bottom + 4 }
                    : { bottom: window.innerHeight - r.top + 4 }),
            });
        };
        measure();
        const ro = new ResizeObserver(measure);
        if (containerRef.current) ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, [wsDropdownOpen]);

    // Focus input on mount and load items
    useEffect(() => {
        // Guarantee focus on window focus (when Alt+K brings window to front).
        // Each focus ≈ one spotlight open — count it (count only, never the
        // query). Read + reset by the daily update-check ping.
        const handleFocus = () => {
            if (isEmbedded) return; // embedded: never steal focus / count opens
            recordSpotlightOpen();
            if (!inputRef.current) return;

            // A single fixed-delay focus() is a race on macOS: the window's
            // shown via a private AppKit Space-joining call (see
            // show_over_fullscreen_spaces in dock.rs), not the normal
            // window.show()/set_focus() Tauri path, so there's no guarantee
            // the OS has actually handed the webview keyboard focus by the
            // time any one fixed delay fires — hence "opened but the cursor
            // isn't in the box". Retry across a few delays instead of betting
            // on one; each attempt is skipped once the input is already
            // focused, so this can't fight the user for focus if they've
            // already started typing by the time a later attempt runs.
            [0, 16, 60, 150, 300].forEach((delay) => {
                setTimeout(() => {
                    const el = inputRef.current;
                    if (!el || document.activeElement === el) return;
                    el.focus();
                    el.select();
                }, delay);
            });
        };
        window.addEventListener('focus', handleFocus);

        // Initial focus and load (handleFocus records the open)
        handleFocus();
        console.log('[Spotlight] Initial mount - loading context items');
        loadContextItems();
        loadPinnedItems();
        loadWorkspaces();
        // Pre-warm the search cache so history/workspace results are ready for first search
        refreshElectronCache().catch(() => { });

        // Subscribe to tabs-updated events (Electron mode)
        let unsubscribeTabs = null;
        if (window.electronAPI?.subscribe) {
            unsubscribeTabs = window.electronAPI.subscribe('tabs-updated', (updatedTabs) => {
                console.log('[Spotlight] tabs-updated event received:', updatedTabs?.length);
                loadContextItems();
            });
        }

        // Subscribe to tab changes in Chrome extension mode
        let chromeTabsCleanup = null;
        if (typeof chrome !== 'undefined' && chrome?.tabs && !window.electronAPI) {
            const refreshOnTabChange = () => loadContextItems();
            const chromeTabEvents = [
                chrome.tabs.onCreated,
                chrome.tabs.onUpdated,
                chrome.tabs.onRemoved,
                chrome.tabs.onActivated,
            ];
            chromeTabEvents.forEach(e => e?.addListener(refreshOnTabChange));
            chromeTabsCleanup = () => chromeTabEvents.forEach(e => e?.removeListener(refreshOnTabChange));
        }

        // Subscribe to tab changes in Tauri mode (via syncOrchestrator WS push)
        let unsubTauriTabs = null;
        if (!window.electronAPI && !chrome?.tabs) {
            import('../../services/syncOrchestrator.js').then(({ syncOrchestrator }) => {
                unsubTauriTabs = syncOrchestrator.on('tabs-synced', () => loadContextItems());
            }).catch(() => {});
        }

        // Subscribe to running apps updates (like TabManagement does)
        let unsubscribeApps = null;
        if (window.electronAPI?.getRunningApps) {
            unsubscribeApps = runningAppsService.subscribe(({ runningApps, installedApps }) => {
                console.log('[Spotlight] runningApps updated:', runningApps?.length);
                loadContextItems();
            });
        }

        // Listen for spotlight-shown event from Electron (when Alt+K is pressed)
        let unsubscribeSpotlight = null;
        if (!isEmbedded && window.electronAPI?.subscribe) {
            unsubscribeSpotlight = window.electronAPI.subscribe('spotlight-shown', () => {
                console.log('[Spotlight] spotlight-shown event received');
                // Reset state and focus input
                setQuery('');
                setResults([]);
                setSelectedIndex(-1);
                setSelectedPinIndex(-1);
                setShowAllTabs(false);
                setShowAllApps(false);
                setExpandedWorkspaceId(() => { try { return localStorage.getItem('spotlight_ws_id') || null; } catch { return null; } });
                setWsDropdownOpen(false);
                loadWorkspaces();

                // Refresh search cache (non-blocking)
                refreshElectronCache();
                loadContextItems();

                handleFocus();
            });
        }

        // Subscribe to workspace DB changes so new/edited workspaces appear immediately
        let unsubscribeWorkspaces = null;
        import('../../db/unified-api.js').then(({ subscribeWorkspaceChanges }) => {
            unsubscribeWorkspaces = subscribeWorkspaceChanges(() => {
                loadWorkspaces();
            });
        }).catch(e => console.warn('[Spotlight] Could not subscribe to workspace changes', e));

        return () => {
            window.removeEventListener('focus', handleFocus);
            if (unsubscribeTabs) unsubscribeTabs();
            if (chromeTabsCleanup) chromeTabsCleanup();
            if (unsubTauriTabs) unsubTauriTabs?.();
            if (unsubscribeApps) unsubscribeApps();
            if (unsubscribeSpotlight) unsubscribeSpotlight();
            if (unsubscribeWorkspaces) unsubscribeWorkspaces();
        };
    }, []);

    // WebSocket connection status subscription
    useEffect(() => {
        if (!isHostSyncEnabled()) return;
        const checkConnection = () => setWsConnected(syncWebSocket.isConnected());
        checkConnection();
        const poll = setInterval(checkConnection, 2000);
        const unsubConnect = syncWebSocket.on('connected', () => setWsConnected(true));
        const unsubDisconnect = syncWebSocket.on('disconnected', () => setWsConnected(false));
        return () => { clearInterval(poll); unsubConnect?.(); unsubDisconnect?.(); };
    }, []);

    // Load Recommendations - Shows frequently used apps and active tabs when Spotlight opens
    const loadContextItems = useCallback(async () => {
        console.log('[Spotlight] loadContextItems called');
        try {
            // Fetch all data in parallel (use cached running apps service)
            console.log('[Spotlight] Fetching data...');

            // Helper to get tabs from either Electron/Tauri or Chrome extension
            const fetchTabs = async () => {
                console.log('[Spotlight] fetchTabs called');
                console.log('[Spotlight] window.electronAPI exists:', !!window.electronAPI);
                console.log('[Spotlight] window.electronAPI.getTabs exists:', !!window.electronAPI?.getTabs);
                console.log('[Spotlight] chrome exists:', typeof chrome !== 'undefined');
                console.log('[Spotlight] chrome.tabs exists:', typeof chrome !== 'undefined' && !!chrome?.tabs);
                console.log('[Spotlight] chrome.tabs.query exists:', typeof chrome !== 'undefined' && !!chrome?.tabs?.query);

                try {
                    // Try Electron/Tauri API first (desktop app)
                    if (window.electronAPI?.getTabs) {
                        console.log('[Spotlight] Using electronAPI.getTabs');
                        const tabs = await window.electronAPI.getTabs();
                        console.log('[Spotlight] electronAPI.getTabs returned:', tabs?.length, 'tabs', tabs);
                        return Array.isArray(tabs) ? tabs : []; // Guard: IPC may return null if handler was missing
                    }
                    // Fallback to Chrome extension API
                    if (typeof chrome !== 'undefined' && chrome?.tabs?.query) {
                        console.log('[Spotlight] Using chrome.tabs.query fallback');
                        const rawTabs = await chrome.tabs.query({});
                        console.log('[Spotlight] chrome.tabs.query returned:', rawTabs?.length, 'tabs', rawTabs);
                        return rawTabs.map(tab => ({
                            ...tab,
                            tabId: tab.id,
                            favicon: tab.favIconUrl
                        }));
                    }
                    // Tauri mode: fetch from sidecar HTTP endpoint
                    try {
                        const { getHostTabs } = await import('../../services/extensionApi.js');
                        const res = await getHostTabs();
                        if (res.ok && Array.isArray(res.tabs)) return res.tabs;
                    } catch { }
                    console.log('[Spotlight] No tab API available, returning empty array');
                    return [];
                } catch (e) {
                    console.error('[Spotlight] getTabs error:', e);
                    return [];
                }
            };

            const [{ runningApps, installedApps }, tabs, frequentApps] = await Promise.all([
                runningAppsService.getApps(),
                fetchTabs(),
                storageGet(['frequent_apps']).then(d => d.frequent_apps || {}).catch(() => ({}))
            ]);

            // Guard: ensure tabs is always an array — avoids TypeError that would silently kill all recommendations
            const safeTabs = Array.isArray(tabs) ? tabs : [];

            console.log('[Spotlight] Data fetched:', {
                runningApps: runningApps?.length || 0,
                installedApps: installedApps?.length || 0,
                tabs: safeTabs.length,
                frequentApps: Object.keys(frequentApps).length
            });

            const recommendations = [];
            const usedIds = new Set();
            const usedRunningWindowKeys = new Set();

            // 1. Apps — active (running) apps only. Installed-but-not-running
            // apps are reachable by typing a search; listing them here just
            // pads the row with entries that look openable but aren't open.
            const normalizeAppName = (value) => (value || '').toLowerCase().replace(/\.exe$/i, '');
            const runningNames = new Set(runningApps.map(a => normalizeAppName(a.name)));
            const enrichedRunningApps = enrichRunningAppsWithIcons(runningApps, installedApps);
            const runningAppsByName = new Map(
                enrichedRunningApps.map(app => [normalizeAppName(app.name), app])
            );
            const enrichedAll = enrichedRunningApps;

            // Drop apps the user just closed (optimistic) until the quit
            // actually lands in the OS's running-apps list; prune tombstones
            // once their pid is truly gone. Mirrors pendingClosedTabsRef above.
            const pendingClosedApps = pendingClosedAppsRef.current;
            if (pendingClosedApps.size) {
                const presentPids = new Set(runningApps.map(a => a.pid).filter(Boolean));
                for (const pid of [...pendingClosedApps]) if (!presentPids.has(pid)) pendingClosedApps.delete(pid);
            }

            // Exact process names that are pure system noise (no user value)
            const systemExactNames = new Set([
                // Windows system processes
                'svchost', 'csrss', 'smss', 'wininit', 'winlogon', 'services', 'lsass',
                'registry', 'system', 'idle', 'dwm', 'conhost', 'ctfmon', 'spoolsv',
                'taskhostw', 'sihost', 'runtimebroker', 'applicationframehost',
                'searchindexer', 'searchhost', 'securityhealthsystray',
                // macOS system UI processes
                'windowserver', 'dock', 'controlcenter', 'notificationcenter',
                'spotlight', 'loginwindow', 'textinputswitcher', 'accessibilityuiserver',
                'cursoruiviewservice', 'nsattributedstringagent', 'webthumbnailextension',
                'linkednotesuitservice', 'securityprivacyextension',
                // macOS system background services
                'systemuiserver', 'universalaccessd', 'coreaudiod', 'distnoted',
                'cfprefsd', 'usbd', 'secd', 'trustd', 'nsurlsessiond', 'bird',
                'sharingd', 'bluetoothd', 'locationd', 'airplayd', 'coreduetd',
                'backupd', 'mds', 'mdworker', 'mdsync', 'mdflagwriter',
                'applespell', 'apsd', 'ckdiscretionaryd', 'cloudd', 'assistantd',
                // macOS system UI agents & panels
                'autofill', 'passwordmanager', 'passwords',
                'airplayuiagent', 'wifiagent', 'bluetoothuiserver',
                'diskmanagementfileserver', 'systempreferences', 'systemsettings',
                'softwareupdated', 'installd', 'storedownloadd', 'storeassetd',
                'screensaver', 'legacyscreensaver', 'pboard', 'pasteboard',
                'translationd', 'siri', 'siriauthd',
                'useractivityd', 'contextmenuhelper', 'imklaunchagent',
                'fontd', 'fontregistryuitool', 'universalcontrol',
                'sharedfilelistd', 'taptoradar',
            ]);
            const isMacSystemProcess = (name) =>
                name.startsWith('com.apple.') ||
                name.startsWith('com.microsoft.') ||
                name.includes('.xpc.') ||
                name.includes('extensionprocess') ||
                (name.endsWith('helper') && !name.includes(' ')) ||
                (name.endsWith('agent') && !name.includes(' ')) ||
                (name.endsWith('daemon') && !name.includes(' ')) ||
                (name.endsWith('service') && !name.includes(' '));
            const browserKeywords = [
                'chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera', 'vivaldi',
                'iexplore', 'chromium', 'safari', 'waterfox', 'librewolf', 'thorium',
                'arc', 'floorp', 'zen'
            ];
            const isBrowserApp = (name) => browserKeywords.some(k => name.includes(k));
            const coolDeskNames = new Set([
                'cooldesk', 'cool desk', 'cool-desk', 'tauri', 'webview', 'wry'
            ]);

            const activeApps = enrichedAll
                .filter(a => {
                    const name = normalizeAppName(a.name);
                    const nameNoSpaces = name.replace(/\s+/g, '');
                    const title = (a.title || '').toLowerCase();
                    const isRunningEntry = a.isRunning === true || !!a.pid;
                    const runningWindowKey = `${name}::${title}`;

                    if (a.pid && pendingClosedApps.has(a.pid)) return false;

                    if (isRunningEntry) {
                        if (usedRunningWindowKeys.has(runningWindowKey)) return false;
                        usedRunningWindowKeys.add(runningWindowKey);
                    }

                    if ((usedIds.has(name) || (runningNames.has(name) && !isRunningEntry)) && !isRunningEntry) return false;
                    if (systemExactNames.has(name) || systemExactNames.has(nameNoSpaces)) return false;
                    if (isMacSystemProcess(name) || isMacSystemProcess(nameNoSpaces)) return false;
                    if (isBrowserApp(name)) return false;
                    if (coolDeskNames.has(name)) return false;
                    if (name.includes('cooldesk') || name.includes('cool-desk') || name.includes('tauri')) return false;

                    // Apply visibility/noise filter only for currently running apps
                    // (installed/offline apps naturally have isVisible: false — don't exclude them)
                    const isAppRunning = a.isRunning === true || runningNames.has(name);
                    if (isAppRunning) {
                        const isMacStyle = a.source === 'applications' || a.source === 'system_applications' || a.source === 'user_applications';
                        if (a.isVisible === false && !isMacStyle && (a.cloaked || 0) !== 2) return false;
                        if (title.endsWith(' log') || title === 'temp window' || title.endsWith('trayiconwindow')) return false;
                    }

                    if (!isRunningEntry) usedIds.add(name);
                    return true;
                })
                .sort((a, b) => {
                    const nameA = normalizeAppName(a.name);
                    const nameB = normalizeAppName(b.name);
                    const runA = a.isRunning === true || runningNames.has(nameA);
                    const runB = b.isRunning === true || runningNames.has(nameB);
                    // Running apps first, then by usage frequency
                    if (runA && !runB) return -1;
                    if (!runA && runB) return 1;
                    return (frequentApps[nameB] || 0) - (frequentApps[nameA] || 0);
                })
                .slice(0, 8)
                .map(a => {
                    const name = normalizeAppName(a.name);
                    const isRunning = a.isRunning === true || runningNames.has(name);
                    const appContext = getRunningAppContext(a);
                    // If the installed app is running, grab its pid/hwnd from the runningApps list
                    // so focus works instead of falling back to launching a new instance
                    if (isRunning && !a.pid) {
                        const runningEntry = runningAppsByName.get(name);
                        if (runningEntry?.pid) {
                            return { ...a, ...runningEntry, type: 'app', description: 'Running', isRunning: true };
                        }
                    }
                    return {
                        ...a,
                        type: 'app',
                        description: isRunning && appContext ? appContext : (isRunning ? 'Running' : 'Installed'),
                        isRunning
                    };
                });

            console.log('[Spotlight] Apps after filter:', activeApps.length, activeApps.map(a => `${a.name}(running:${a.isRunning},title:${a.title || ''})`));
            recommendations.push(...activeApps);

            // 3. Active Tabs (unique by domain)
            console.log('[Spotlight] Processing tabs, raw count:', safeTabs.length);
            console.log('[Spotlight] Raw tabs data:', JSON.stringify(safeTabs.slice(0, 3), null, 2));

            // Drop tabs the user just closed (optimistic) until the close lands in
            // the source list; prune tombstones once their tab is actually gone.
            const tabKey = (t) => `${t._deviceId || ''}:${t.tabId || t.id}`;
            const pendingClosed = pendingClosedTabsRef.current;
            if (pendingClosed.size) {
                const presentKeys = new Set(safeTabs.map(tabKey));
                for (const k of [...pendingClosed]) if (!presentKeys.has(k)) pendingClosed.delete(k);
            }

            const afterUrlFilter = safeTabs
                .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'))
                .filter(t => !pendingClosed.has(tabKey(t)));
            console.log('[Spotlight] After URL filter:', afterUrlFilter.length);

            // One row per domain, labelled with how many tabs it stands for.
            // Keyed on the group domain, not eTLD+1: analytics.google.com and
            // chromewebstore.google.com are both google.com to PSL, so every
            // Google product used to collapse into a single row and the tab
            // count silently dropped.
            const relevantTabs = afterUrlFilter
                .filter((t, index, self) =>
                    index === self.findIndex(s => getGroupDomainFromUrl(s.url) === getGroupDomainFromUrl(t.url))
                )
                .map(t => ({
                    ...t,
                    type: 'tab',
                    description: (() => {
                        const domain = getGroupDomainFromUrl(t.url);
                        const count = afterUrlFilter.filter(tab => getGroupDomainFromUrl(tab.url) === domain).length;
                        return count > 1 ? `${count} tabs from ${domain}` : `Tab from ${domain}`;
                    })(),
                    favicon: t.favIconUrl || t.favicon  // Map favIconUrl to favicon
                }));

            console.log('[Spotlight] Relevant tabs after dedup:', relevantTabs.length, relevantTabs.map(t => ({ title: t.title, url: t.url, type: t.type })));
            recommendations.push(...relevantTabs);

            // Cap at 20 items
            const finalRecs = recommendations.slice(0, 20);
            console.log('[Spotlight] Final recommendations:', finalRecs.length, finalRecs.map(r => r.name || r.title));
            setContextItems(finalRecs);

        } catch (e) {
            console.warn('Failed to load recommendations', e);
        }
    }, []);

    // Load Pinned Items
    const loadPinnedItems = async () => {
        if (!sections.pins) return; // section hidden — keep nav math consistent
        try {
            const data = await storageGet(['spotlight_pins']);
            setPinnedItems(data.spotlight_pins || []);
        } catch (e) {
            console.warn('Failed to load pins', e);
        }
    };

    // Load Workspaces from own DB
    const loadWorkspaces = useCallback(async () => {
        if (!sections.workspaces) return; // section hidden — keep nav math consistent
        try {
            const { listWorkspaces } = await import('../../db/index.js');
            const res = await listWorkspaces();
            const list = res?.success ? res.data : (Array.isArray(res) ? res : []);
            setWorkspaces(list);
            // Auto-select: validate saved ID still exists, else pick first
            setExpandedWorkspaceId(prev => {
                if (prev && list.find(w => w.id === prev)) return prev;
                return list[0]?.id || null;
            });
        } catch (e) {
            console.warn('[Spotlight] Failed to load workspaces', e);
        }
    }, []);

    // Persist selected workspace
    useEffect(() => {
        try {
            if (expandedWorkspaceId) localStorage.setItem('spotlight_ws_id', expandedWorkspaceId);
            else localStorage.removeItem('spotlight_ws_id');
        } catch { }
    }, [expandedWorkspaceId]);

    // Keep the keyboard-selected workspace chip visible while the entries grid
    // scrolls. Hover-driven selection is skipped — the chip is already under
    // the cursor, and scrolling to it would hijack an in-progress wheel scroll.
    useEffect(() => {
        if (!wsHoverSelectedRef.current) {
            const el = wsEntriesRef.current?.querySelector('.pin-selected');
            if (el) el.scrollIntoView({ block: 'nearest' });
        }
        wsHoverSelectedRef.current = false;
    }, [selectedPinIndex]);

    // Save Pinned Items
    const savePinnedItems = async (items) => {
        setPinnedItems(items);
        try {
            await storageSet({ spotlight_pins: items });
        } catch (e) {
            console.warn('Failed to save pins', e);
        }
    };

    // Toggle Pin - supports both URLs and apps
    const togglePin = (item, e) => {
        if (e) e.stopPropagation();

        // Use different identifier for apps vs URLs
        const itemId = item.type === 'app' ? `app:${item.name}` : item.url;
        const exists = pinnedItems.find(p => {
            const pinId = p.type === 'app' ? `app:${p.name}` : p.url;
            return pinId === itemId;
        });

        if (exists) {
            const newPins = pinnedItems.filter(p => {
                const pinId = p.type === 'app' ? `app:${p.name}` : p.url;
                return pinId !== itemId;
            });
            savePinnedItems(newPins);
        } else {
            if (pinnedItems.length >= 8) return; // Max 8
            const newPin = {
                title: item.title || item.name,
                url: item.url || null,
                favicon: item.favicon,
                icon: item.icon, // Save icon separately for apps
                type: item.type,
                // App-specific fields
                name: item.name,
                path: item.path,
                pid: item.pid,
                isRunning: item.isRunning
            };
            savePinnedItems([...pinnedItems, newPin]);
        }
    };

    const removePin = (index, e) => {
        if (e) e.stopPropagation();
        const newPins = [...pinnedItems];
        newPins.splice(index, 1);
        savePinnedItems(newPins);
    };

    // ==========================================
    // COMMAND MODE DETECTION (/ai, /model)
    // ==========================================
    useEffect(() => {
        const trimmedQuery = query.trim().toLowerCase();

        // Detect /ai command
        if (trimmedQuery === '/ai' || trimmedQuery.startsWith('/ai ')) {
            if (commandMode !== 'ai') {
                setCommandMode('ai');
                setResults([]);
            }
            return;
        }

        // Detect /agent — the terminal AI CLI (Claude Code, opencode …).
        // Separate from /ai, which is the LM Studio chat: this one produces
        // workspace edits and needs a confirm step, that one just talks.
        //
        // The prefix is *consumed*, not left in the box: it becomes a chip next
        // to the input, the same way add mode shows its target. Leaving the
        // literal "/agent " there meant every follow-up had to be typed after
        // it, and re-typing it was the only way back into the mode.
        if (trimmedQuery === '/agent' || trimmedQuery.startsWith('/agent ')) {
            if (commandMode !== 'agent') {
                setCommandMode('agent');
                setResults([]);
                // Resolve which of the selected workspace's folders can be
                // scaffolded/linked, for the panel's "Create workspace" button.
                setWsScaffoldPlan(undefined);
                resolveWorkspaceProjects().then(setWsScaffoldPlan);
            }
            setQuery(query.replace(/^\s*\/agent\s*/i, ''));
            return;
        }

        // Once the chip is up the mode owns the input: the text is the request,
        // and only the chip's × or Esc leaves.
        if (commandMode === 'agent') return;

        // Detect /new-workspace — a guided form (name → folders → confirm)
        // instead of a bang command with syntax to remember. See
        // useNewWorkspaceMode.js.
        if (trimmedQuery === '/new-workspace' || trimmedQuery.startsWith('/new-workspace ') ||
            trimmedQuery === '/new' || trimmedQuery.startsWith('/new ')) {
            if (commandMode !== 'new-workspace') {
                newWorkspace.enter();
                setResults([]);
            }
            setQuery(query.replace(/^\s*\/(new-workspace|new)\s*/i, ''));
            return;
        }
        if (commandMode === 'new-workspace') return;

        // Detect /model command
        if (trimmedQuery === '/model' || trimmedQuery.startsWith('/model ')) {
            if (commandMode !== 'model') {
                setCommandMode('model');
                setResults([]);
                // Fetch available models
                fetchAvailableModels();
            }
            return;
        }

        // Detect an existing workspace's own name typed directly as a command
        // (e.g. "/ent" for "entertainment") — opens it in /edit-workspace
        // (see useEditWorkspaceMode.js). Checked last, after every fixed
        // built-in above, so a workspace literally named "agent" or "model"
        // can't shadow those. Prefix match, firing as soon as exactly one
        // workspace name starts with what's typed — typing the whole name
        // was too slow. An exact full-name match always wins outright, so
        // "cool" still opens a workspace named exactly "cool" even if
        // "cool-verse" also starts with it.
        if (trimmedQuery.startsWith('/') && trimmedQuery.length > 1) {
            const typedName = trimmedQuery.slice(1).toLowerCase();
            const exact = workspaces.find(w => (w.name || '').trim().toLowerCase() === typedName);
            const candidates = exact ? [exact] : workspaces.filter(w => workspaceNameMatchesTyped(w.name, typedName));
            if (candidates.length === 1) {
                const match = candidates[0];
                if (commandMode !== 'edit-workspace' || editWorkspace.workspaceId !== match.id) {
                    editWorkspace.enter(match);
                    setSelectedIndex(-1);
                }
                return;
            }
        }
        if (commandMode === 'edit-workspace') return;

        // Clear command mode if not a command
        if (commandMode) {
            setCommandMode(null);
            setAiMessages([]);
        }
    }, [query]);

    // Fetch available models for /model command
    const fetchAvailableModels = async () => {
        try {
            const isAvailable = await LocalAI.isAvailable();
            if (!isAvailable) {
                setAvailableModels([{
                    name: 'error',
                    title: 'Desktop App Not Running',
                    description: 'Please start the CoolDesk desktop app to use AI',
                    disabled: true
                }]);
                return;
            }

            const status = await LocalAI.getStatus();
            setCurrentModel(status.currentModel || null);

            const modelsResult = await LocalAI.getModels();
            const modelFilenames = Object.keys(modelsResult || {}).filter(
                name => modelsResult[name]?.downloaded
            );

            if (modelFilenames.length === 0) {
                setAvailableModels([{
                    name: 'error',
                    title: 'No Models Downloaded',
                    description: 'Go to Settings → Local AI to download models',
                    disabled: true
                }]);
                return;
            }

            const models = modelFilenames.map(name => {
                const modelInfo = modelsResult[name];
                const isLoaded = status.currentModel === name;
                return {
                    name,
                    title: modelInfo?.displayName || name,
                    description: isLoaded ? '✓ Currently loaded' : `Click to load • ${modelInfo?.size || ''}`,
                    isLoaded,
                    disabled: false
                };
            }).sort((a, b) => {
                if (a.isLoaded && !b.isLoaded) return -1;
                if (!a.isLoaded && b.isLoaded) return 1;
                return 0;
            });

            setAvailableModels(models);
        } catch (error) {
            console.error('[Spotlight] Failed to fetch models:', error);
            setAvailableModels([{
                name: 'error',
                title: 'Error Loading Models',
                description: error.message || 'Failed to connect to AI service',
                disabled: true
            }]);
        }
    };

    // Load a model
    const loadModel = async (modelName) => {
        if (isModelLoading) return;

        try {
            setIsModelLoading(true);
            await LocalAI.loadModel(modelName);
            setCurrentModel(modelName);
            // Refresh the list
            await fetchAvailableModels();
            // Show success briefly then close
            setTimeout(() => {
                handleClose();
            }, 500);
        } catch (error) {
            console.error('[Spotlight] Failed to load model:', error);
        } finally {
            setIsModelLoading(false);
        }
    };

    // Send AI message
    const sendAiMessage = async (prompt) => {
        if (!prompt.trim() || isAiLoading) return;

        const userMessage = { role: 'user', content: prompt };
        setAiMessages(prev => [...prev, userMessage]);
        setIsAiLoading(true);

        try {
            const isAvailable = await LocalAI.isAvailable();
            if (!isAvailable) {
                setAiMessages(prev => [...prev, {
                    role: 'error',
                    content: 'Local AI not available. Ensure the CoolDesk desktop app is running.'
                }]);
                setIsAiLoading(false);
                return;
            }

            // Check if model is loaded
            const status = await LocalAI.getStatus();
            if (!status.modelLoaded) {
                setAiMessages(prev => [...prev, {
                    role: 'system',
                    content: 'No model loaded. Use /model to select one first.'
                }]);
                setIsAiLoading(false);
                return;
            }

            const response = await LocalAI.chat(prompt);
            setAiMessages(prev => [...prev, {
                role: 'assistant',
                content: response || 'No response received'
            }]);
        } catch (error) {
            console.error('[Spotlight] AI chat error:', error);
            setAiMessages(prev => [...prev, {
                role: 'error',
                content: error.message || 'Failed to get response'
            }]);
        } finally {
            setIsAiLoading(false);
        }
    };

    // ==========================================
    // OPTIMIZED SEARCH with caching & race handling
    // ==========================================
    useEffect(() => {
        const trimmedQuery = query.trim();

        // A new query collapses any expanded folder tree from the previous search.
        setExpandedPaths(new Set());
        setTreeChildren({});

        // Agent mode still searches: the box is a search bar first, and the
        // agent is one more thing it can answer with. /new-workspace's
        // folders step and /edit-workspace are item *pickers*, so they
        // search too. /ai and /model, and /new-workspace's name/confirm
        // steps, take the input over completely, so they still skip.
        const isItemPickerStep = (commandMode === 'new-workspace' && newWorkspace.step === 'folders')
            || commandMode === 'edit-workspace';
        if (commandMode && commandMode !== 'agent' && !isItemPickerStep) {
            return;
        }

        if (!trimmedQuery) {
            setResults([]);
            // Item-picker modes (edit-workspace, /new-workspace's folders
            // step) use selectedIndex for browsing their *existing* items
            // list while the box is empty — resetting it here on every empty
            // query (which fires on entering the mode, and after every
            // /name, /todo, /notes command clears the box) wiped out that
            // selection and made arrow-key navigation there feel broken.
            if (!isItemPickerStep) setSelectedIndex(-1);
            // Bumping the id orphans any search still in flight, so its late
            // response can't repopulate an empty box; clearing loading here is
            // then required, because that orphaned run's `finally` no longer
            // matches the id and will never turn the spinner off itself.
            searchIdRef.current++;
            setLoading(false);
            return;
        }

        // Reset pin selection when searching
        setSelectedPinIndex(-1);

        // Slash/bang command palette (when the surface enables it): "/..." and
        // "!..." queries list matching commands instead of running a search.
        const commandItems = slash.getSuggestions(trimmedQuery);
        // Existing workspaces whose name starts with what's typed — computed
        // independently of the command palette above (which is disabled on
        // the dedicated overlay surface, spotlight-main.jsx: enableSlashCommands
        // isn't passed there, so commandItems is always null on that window —
        // this must not live inside that branch or it never runs there).
        // Surfaced here rather than silently auto-entering /edit-workspace
        // whenever the prefix is ambiguous between two of them (e.g. "cool"
        // matching both "cooldesk" and "cooldesk website"): picking one is a
        // click/Enter away instead of needing to type enough to disambiguate.
        const typedName = trimmedQuery.startsWith('/') ? trimmedQuery.slice(1).toLowerCase() : '';
        const wsMatches = typedName
            ? workspaces
                .filter(w => workspaceNameMatchesTyped(w.name, typedName))
                .map(w => ({
                    id: `ws-edit:${w.id}`,
                    type: 'workspace-edit',
                    title: w.name,
                    description: 'Edit this workspace',
                    workspace: w,
                }))
            : [];
        if (commandItems || wsMatches.length > 0) {
            const combined = [...wsMatches, ...(commandItems || [])];
            setResults(combined);
            setSelectedIndex(combined.length > 0 ? 0 : -1);
            setLoading(false);
            return;
        }

        // Scoped search (/u /a /f): strip the prefix, search with the bare term
        const { scope, term: scopedTerm } = parseScopedQuery(trimmedQuery);
        if (scope && !scopedTerm) {
            // Prefix typed but no term yet — wait for input instead of searching
            // '', except "/a", "/u" and "/f": with nothing to filter by,
            // browsing the app catalog / active tabs+history+bookmarks /
            // frequently-used folders straight away is exactly what typing the
            // bare prefix is asking for — an empty list there just looks broken.
            searchIdRef.current++;
            const currentSearchId = searchIdRef.current;
            const canBrowse = isDesktopApp && (scope === SEARCH_SCOPES.a || scope === SEARCH_SCOPES.u || scope === SEARCH_SCOPES.f);
            const runBrowse = scope === SEARCH_SCOPES.a ? browseApps
                : scope === SEARCH_SCOPES.u ? browseUrls
                    : scope === SEARCH_SCOPES.f ? browseFrequentFolders
                        : null;
            // /f has no cache to retry against — search_files itself refuses an
            // empty query outright (see search_files in lib.rs), and frequent
            // folders come straight from the OS, not a warm-up cache — so an
            // empty result there is a real "none yet", not a timing gap.
            const canRetry = scope === SEARCH_SCOPES.a || scope === SEARCH_SCOPES.u;

            if (!canBrowse || !runBrowse) {
                setResults([]);
                setSelectedIndex(-1);
                setLoading(false);
                return;
            }

            setLoading(true);
            (async () => {
                let browseResults = await runBrowse(30);
                if (searchIdRef.current !== currentSearchId) return; // superseded by a newer query

                if (browseResults.length === 0 && canRetry) {
                    // browseApps/browseUrls read caches populated asynchronously
                    // on mount (refreshElectronCache's pre-warm) — if spotlight
                    // was opened and "/a"/"/u" typed before that landed, the
                    // cache is still empty. Force a refresh and retry once
                    // instead of silently showing nothing.
                    await refreshElectronCache(true).catch(() => { });
                    if (searchIdRef.current !== currentSearchId) return;
                    browseResults = await runBrowse(30);
                    if (searchIdRef.current !== currentSearchId) return;
                }

                setResults(browseResults);
                setSelectedIndex(browseResults.length > 0 ? 0 : -1);
                setLoading(false);
            })();
            return;
        }
        const searchTerm = scope ? scopedTerm : trimmedQuery;

        // Check cache first for instant results
        const cacheKey = trimmedQuery.toLowerCase();
        const cached = searchCache.get(cacheKey);
        if (cached) {
            setResults(cached);
            // Pre-select the top result so the highlight always shows what Enter will do
            setSelectedIndex(cached.length > 0 ? 0 : -1);
            // Still fetch fresh results in background for longer queries
            if (trimmedQuery.length < 1) return;
        }

        // Reset pagination on new query
        setShowAllResults(false);
        // Increment search ID to track this request
        const currentSearchId = ++searchIdRef.current;

        // Short debounce - 50ms for fast typing, 0ms if we have cache.
        // Agent mode waits longer: the text being typed is a sentence for the
        // agent, not a search term, so there is no point chasing every keystroke.
        const debounceMs = commandMode === 'agent' ? 400 : (cached ? 100 : 50);

        const timeoutId = setTimeout(async () => {
            // Check if this search is still relevant
            if (searchIdRef.current !== currentSearchId) return;

            // Only show loading if no cached results
            if (!cached) setLoading(true);

            try {
                // Determine search type and run search
                // In Electron: quickSearch uses in-memory cache (includes apps, tabs, workspaces)
                // In Chrome: quickSearch uses local index or IPC fallback
                //
                // Agent mode always takes the cheap path. An agent request is a
                // sentence, so isNaturalLanguageQuery says yes to nearly all of
                // them and routes to the slow AI-backed search — which is what
                // made the spinner sit there for the whole time you were typing.
                // Here search is a secondary convenience; the agent is the point.
                const isAgent = commandMode === 'agent';
                // /new-workspace's folder step wants folders/files/apps only;
                // /edit-workspace (an existing workspace) accepts anything a
                // workspace item can be, urls included. Neither is a
                // natural-language request — always wants file search, never
                // the slow AI-backed search, regardless of query length.
                const isFolderOnlyPicker = commandMode === 'new-workspace' && newWorkspace.step === 'folders';
                const isItemPicker = isFolderOnlyPicker || commandMode === 'edit-workspace';
                const isNaturalLanguage = !isAgent && !isItemPicker && isNaturalLanguageQuery(searchTerm);

                // quickSearch ranks and caps across ALL types (apps, workspaces,
                // tabs, history, bookmarks) before the scope filter below ever
                // runs — apps/workspaces routinely outscore history/bookmark
                // hits, so a top-15-overall cut can leave a scoped search like
                // "/u <query>" with nothing, even when matches exist further
                // down. Pull a wider pool when scoped so the filter has enough
                // candidates to work with; unscoped searches keep the tight cap.
                const fetchLimit = scope ? 60 : 15;
                const searchPromise = isNaturalLanguage
                    ? naturalLanguageSearch(searchTerm, fetchLimit)
                    : quickSearch(searchTerm, fetchLimit);

                // File search only matters for unscoped or /f searches. In
                // agent mode it's still worth it for a short, name-like query
                // (picking a project folder to point the agent at is exactly
                // what the results list under the transcript is for) — but
                // skipped for an actual multi-word sentence, where an OS-wide
                // scan is both the slowest thing here and can't match natural
                // language anyway.
                const isShortQuery = searchTerm.trim().split(/\s+/).length <= 3;
                const wantFiles = (isItemPicker || !isAgent || isShortQuery) && (!scope || scope === SEARCH_SCOPES.f);
                const filesPromise = wantFiles && window.electronAPI?.searchFiles
                    ? window.electronAPI.searchFiles(searchTerm)
                    : Promise.resolve([]);

                let [searchResults, osFiles] = await Promise.all([searchPromise, filesPromise]);

                const qLower = searchTerm.toLowerCase();
                const mappedFiles = (osFiles || []).map(file => {
                    const item = fileToResultItem(file);
                    if (!item) return null;
                    const nameLower = item.title.toLowerCase();
                    // Score by match quality so files/folders rank with apps/tabs
                    // instead of always being dumped at the bottom of the list.
                    let score = 70;
                    if (nameLower === qLower) score = 96;
                    else if (nameLower.startsWith(qLower)) score = 86;
                    else if (nameLower.includes(qLower)) score = 76;
                    if (item.isDir) score += 4; // nudge folders up — usually what the user wants to navigate
                    return { ...item, score };
                }).filter(Boolean);

                // Windows Settings pages (Display, Bluetooth, Wi-Fi, …) and
                // Control Panel / system tools (Device Manager, regedit, …),
                // ranked by the same fuzzyScore so they interleave with
                // apps/tabs/files instead of being bolted on at the end.
                const settingsResults = IS_WINDOWS_DESKTOP && !scope
                    ? searchWindowsSettings(searchTerm, 5)
                    : [];
                const toolsResults = IS_WINDOWS_DESKTOP && !scope
                    ? searchWindowsTools(searchTerm, 5)
                    : [];

                // Typed text that already looks like a domain ("gmail.com") gets
                // offered as a direct destination — ranked in with everything
                // else rather than bolted on separately, so an actual open tab
                // for the same site (scored higher) still wins the top slot.
                const urlGuessResults = (!isAgent && !isFolderOnlyPicker && looksLikeUrl(searchTerm) && (!scope || scope === SEARCH_SCOPES.u))
                    ? [{
                        id: `url-guess-${searchTerm}`,
                        title: toNavigableUrl(searchTerm),
                        url: toNavigableUrl(searchTerm),
                        description: 'Open URL',
                        type: 'url',
                        score: 92,
                    }]
                    : [];

                searchResults = [...(searchResults || []), ...mappedFiles, ...settingsResults, ...toolsResults, ...urlGuessResults]
                    .sort((a, b) => (b.score || 0) - (a.score || 0));

                // Independent sources can surface the *same* folder/file/app or
                // url (the local index and a live filesystem scan both matching
                // "src", say) — dedupe by a stable identity so a row isn't shown
                // twice and React doesn't get two children with the same key.
                // Sorted by score above, so the first copy kept is the
                // highest-scoring one.
                {
                    const seenKeys = new Set();
                    searchResults = searchResults.filter(r => {
                        const key = (r.type === 'folder' || r.type === 'file' || r.type === 'app') && r.path
                            ? `path:${r.path.toLowerCase()}`
                            : r.url
                                ? `url:${r.url.toLowerCase()}`
                                : `id:${r.id}`;
                        if (seenKeys.has(key)) return false;
                        seenKeys.add(key);
                        return true;
                    });
                }

                // Scoped search keeps only the scope's result types
                if (scope) {
                    searchResults = searchResults.filter(r => scope.types.includes(r.type));
                }

                // /new-workspace's folder step: only things that can become a
                // workspace app are worth showing — a tab or bookmark can't.
                // /edit-workspace allows urls/tabs/bookmarks too (an existing
                // workspace can hold either kind of item), so it's unfiltered here.
                if (isFolderOnlyPicker) {
                    searchResults = searchResults.filter(r => ['folder', 'file', 'app'].includes(r.type));
                }

                // "/a <query>" with nothing matching: browse the full app
                // catalog instead of leaving an empty list — running apps
                // first, then everything else installed (see browseApps).
                if (scope === SEARCH_SCOPES.a && isDesktopApp && searchResults.length === 0) {
                    searchResults = browseApps(30);
                }

                // "/u" mixes tabs (currently open — "active") with history,
                // bookmarks and saved workspace links, which each score
                // independently and don't naturally sort tabs to the top.
                // Force active tabs first regardless of score, then keep
                // everything else in score order.
                if (scope === SEARCH_SCOPES.u) {
                    searchResults = [...searchResults].sort((a, b) => {
                        const aTab = a.type === 'tab' ? 1 : 0;
                        const bTab = b.type === 'tab' ? 1 : 0;
                        if (aTab !== bTab) return bTab - aTab;
                        return (b.score || 0) - (a.score || 0);
                    });
                }

                // Nothing found, or nothing worth trusting: offer the agent as a
                // way forward instead of leaving the user staring at weak
                // fuzzy matches (or nothing). Scoped searches (/u /a /f) are a
                // narrow, deliberate ask — this fallback only applies to a
                // plain, broad search. Pinned to the top rather than sorted by
                // score, so it's never buried under a page of mediocre matches.
                const bestScore = searchResults.reduce((max, r) => Math.max(max, r.score || 0), 0);
                if (!isAgent && !isItemPicker && isDesktopApp && !addTarget && !scope && searchTerm.trim() &&
                    (searchResults.length === 0 || bestScore < 50)) {
                    searchResults.unshift({
                        id: `agent-suggest-${searchTerm}`,
                        title: `Ask the agent: "${searchTerm}"`,
                        description: 'No strong matches — let the AI agent take it',
                        type: 'agent-suggest',
                        query: searchTerm,
                    });
                }

                // Check if still relevant (user may have typed more)
                if (searchIdRef.current !== currentSearchId) return;

                // Filter out commands
                searchResults = (searchResults || []).filter(r => r.type !== 'command');

                // Deep search enhancement
                if (deepSearch) {
                    await new Promise(r => setTimeout(r, 800));
                    if (searchIdRef.current !== currentSearchId) return;

                    searchResults.unshift({
                        id: 'deep-search-result',
                        title: `Deep Analysis: ${trimmedQuery}`,
                        description: 'Generated comprehensive insight from 12 sources...',
                        type: 'ai',
                        icon: '✨'
                    });
                }

                // Cache results
                searchCache.set(cacheKey, searchResults);

                console.log('[Spotlight] Rendering results:', searchResults);

                // Update UI — pre-select the top result (Spotlight-style) so
                // Enter always acts on the visibly highlighted row
                setResults(searchResults);
                setSelectedIndex(searchResults.length > 0 ? 0 : -1);
                resultsDisplayedAtRef.current = Date.now(); // Track for feedback response time

            } catch (err) {
                console.error('[Spotlight] Search failed:', err);
            } finally {
                if (searchIdRef.current === currentSearchId) {
                    setLoading(false);
                }
            }
        }, debounceMs);

        return () => clearTimeout(timeoutId);
    }, [query, deepSearch, commandMode, slash, addTarget, isDesktopApp, newWorkspace.step]);

    // --- Folder tree helpers ---
    // Base rows = search results capped to the visible window; folders among
    // them can be expanded inline to reveal children (recursively).
    const baseRows = useMemo(
        () => results.slice(0, showAllResults ? results.length : 10),
        [results, showAllResults]
    );

    // Flatten the tree (base rows + expanded children) into a single navigable
    // list, tagging each row with its depth for indentation.
    const flatRows = useMemo(() => {
        const out = [];
        const walk = (items, depth) => {
            for (const it of items) {
                const isFolder = it.type === 'folder';
                const isExpanded = isFolder && expandedPaths.has(it.path);
                out.push({ item: it, depth, isFolder, isExpanded });
                if (isExpanded) {
                    const kids = treeChildren[it.path];
                    if (kids && kids.length) walk(kids, depth + 1);
                }
            }
        };
        walk(baseRows, 0);
        return out;
    }, [baseRows, expandedPaths, treeChildren]);

    // Quick-Look-style preview for the currently-highlighted result. Only
    // 'file' rows with a previewable extension qualify — folders, apps, tabs
    // etc. have nothing PreviewPane knows how to render, so they just don't
    // get a pane rather than an empty/broken one.
    const previewItem = useMemo(() => {
        if (!isDesktopApp) return null;
        const selected = flatRows[selectedIndex]?.item;
        if (!selected || selected.type !== 'file' || !selected.path) return null;
        return getPreviewItem(selected.path);
    }, [flatRows, selectedIndex, isDesktopApp]);

    const collapsePath = (path) => {
        setExpandedPaths(prev => {
            const next = new Set(prev);
            next.delete(path);
            return next;
        });
    };

    const expandPath = async (folder) => {
        if (!folder || folder.type !== 'folder' || !folder.path) return;
        const path = folder.path;
        // Load children once, then cache.
        if (!treeChildren[path] && window.electronAPI?.listDir) {
            try {
                const children = await window.electronAPI.listDir(path);
                // list_dir now returns hidden entries (flagged) for the file
                // manager; the spotlight tree stays noise-free without them.
                const items = (children || [])
                    .filter(c => !c.hidden)
                    .map(fileToResultItem)
                    .filter(Boolean);
                setTreeChildren(prev => ({ ...prev, [path]: items }));
            } catch (err) {
                console.error('[Spotlight] listDir failed:', err);
                setTreeChildren(prev => ({ ...prev, [path]: [] }));
            }
        }
        setExpandedPaths(prev => new Set(prev).add(path));
    };

    const toggleExpand = (folder) => {
        if (!folder || folder.type !== 'folder' || !folder.path) return;
        if (expandedPaths.has(folder.path)) collapsePath(folder.path);
        else expandPath(folder);
    };

    // --- Idle-mode navigation model ---
    // Context chips render sliced (4 apps / 8 tabs until expanded) — keyboard
    // nav must walk the same visible list, or the highlight and what Enter
    // opens drift apart. Rows with hidden items get an expand/collapse chip
    // appended so "show all" is reachable by keyboard too; Enter on it toggles
    // the row (handled in handleKeyDown, never sent to handleSelect).
    const contextGroups = useMemo(() => {
        const source = sections.context ? contextItems : [];
        const apps = source.filter(i => i.type === 'app');
        const tabs = source.filter(i => i.type === 'tab');
        const visibleApps = apps.slice(0, showAllApps ? apps.length : 4);
        const visibleTabs = tabs.slice(0, showAllTabs ? tabs.length : 8);
        const visibleList = [...visibleApps];
        if (apps.length > 4) {
            visibleList.push({ type: 'expand-apps', expanded: showAllApps, hiddenCount: apps.length - visibleApps.length });
        }
        const appsBlockLen = visibleList.length; // apps + their expand chip
        visibleList.push(...visibleTabs);
        if (tabs.length > 8) {
            visibleList.push({ type: 'expand-tabs', expanded: showAllTabs, hiddenCount: tabs.length - visibleTabs.length });
        }
        const tabsBlockLen = visibleList.length - appsBlockLen; // tabs + their expand chip
        return { apps, tabs, visibleApps, visibleTabs, visibleList, appsBlockLen, tabsBlockLen };
    }, [contextItems, showAllApps, showAllTabs]);

    // Active workspace entries (urls then apps) with their live tab/app
    // lookups, shared by the render and the keyboard handler so Enter opens
    // exactly what is highlighted.
    const wsNavItems = useMemo(() => {
        if (!expandedWorkspaceId) return [];
        const ws = workspaces.find(w => w.id === expandedWorkspaceId);
        if (!ws) return [];
        const getHostname = (url) => { try { return new URL(url).hostname; } catch { return null; } };
        const openTabsByHostname = new Map(
            contextItems.filter(c => c.type === 'tab' && c.url).map(c => [getHostname(c.url), c])
        );
        const runningAppsByName = new Map(
            contextItems.filter(c => c.type === 'app' && c.isRunning)
                .map(c => [(c.name || '').toLowerCase().replace(/\.exe$/i, ''), c])
        );
        const urls = (ws.urls || []).map(u => ({
            kind: 'url',
            data: u,
            openTab: u.url ? openTabsByHostname.get(getHostname(u.url)) || null : null,
        }));
        const apps = (ws.apps || []).map(app => ({
            kind: 'app',
            data: app,
            runningApp: (app.appType !== 'folder' && app.appType !== 'file')
                ? runningAppsByName.get((app.name || '').toLowerCase().replace(/\.exe$/i, '')) || null
                : null,
        }));
        return [...urls, ...apps];
    }, [workspaces, expandedWorkspaceId, contextItems]);

    // /edit-workspace's existing items (urls, apps, todos, then notes) — its
    // own list rather than wsNavItems above, since editWorkspace.workspace
    // isn't necessarily the idle-selected workspace (expandedWorkspaceId).
    // Everything (browsing, adding, editing) goes through this one list and
    // the single search box — no separate add-fields to tab between.
    const editWorkspaceItems = useMemo(() => {
        const ws = editWorkspace.workspace;
        if (!ws) return [];
        const urls = (ws.urls || []).map(u => ({ kind: 'url', name: u.title || u.url, url: u.url }));
        const apps = (ws.apps || []).map(a => ({ kind: 'app', name: a.name, path: a.path, appType: a.appType }));
        const todos = editWorkspace.todos.map(t => ({ kind: 'todo', name: t.text, id: t.id, done: t.done }));
        const notes = editWorkspace.notes.map(n => ({
            kind: 'note', id: n.id,
            name: n.title || editWorkspace.stripHtml(n.text).slice(0, 40) || 'Untitled',
        }));
        return [...urls, ...apps, ...todos, ...notes];
    }, [editWorkspace.workspace, editWorkspace.todos, editWorkspace.notes, editWorkspace.stripHtml]);

    const openExistingWorkspaceItem = useCallback((item) => {
        if (!item) return;
        if (item.kind === 'url') {
            if (window.electronAPI?.openExternal) window.electronAPI.openExternal(item.url);
            else window.open(item.url, '_blank');
            return;
        }
        const type = (item.appType || '').toLowerCase();
        if (WS_EDITORS.includes(type) && window.electronAPI?.launchAppWithArgs) {
            window.electronAPI.launchAppWithArgs(type === 'vscode' ? 'code' : type, [item.path]);
        } else if (item.appType === 'folder' && window.electronAPI?.openFolder) {
            window.electronAPI.openFolder(item.path);
        } else if (window.electronAPI?.launchApp) {
            window.electronAPI.launchApp(item.path);
        }
    }, []);

    // Handle Keyboard Navigation
    const handleKeyDown = (e) => {
        if (commandMode === 'edit-workspace') {
            if (e.key === 'Escape') {
                e.preventDefault();
                // Close the innermost thing first: the note editor, then the
                // whole mode — same hierarchy Esc already follows elsewhere
                // (workspace picker → add mode → spotlight).
                if (editWorkspace.activeNoteId) editWorkspace.closeNote();
                else editWorkspace.exit();
                return;
            }
            // Backspace on an empty box closes it too — same grammar as
            // /agent and /new-workspace, not just Esc.
            if (e.key === 'Backspace' && !query) {
                e.preventDefault();
                editWorkspace.exit();
                return;
            }

            // Empty box: nothing to search for, so ↑↓/Enter navigate and open
            // the workspace's *existing* items instead (the chips above the
            // list) — the same "browse what's already here" the idle
            // workspace section supports, just inside this mode too.
            if (!query.trim()) {
                if (e.key === 'ArrowDown' && editWorkspaceItems.length > 0) {
                    e.preventDefault();
                    setSelectedIndex(prev => (prev + 1) % editWorkspaceItems.length);
                    return;
                }
                if (e.key === 'ArrowUp' && editWorkspaceItems.length > 0) {
                    e.preventDefault();
                    setSelectedIndex(prev => (prev <= 0 ? editWorkspaceItems.length - 1 : prev - 1));
                    return;
                }
                // Space *or* Shift+Enter toggles a todo's done state —
                // mouse-independent, doesn't require clicking the row — and
                // does nothing on any other row. Two keys rather than one so
                // whichever one you reach for works.
                if ((e.key === ' ' || (e.key === 'Enter' && e.shiftKey)) &&
                    selectedIndex >= 0 && editWorkspaceItems[selectedIndex]?.kind === 'todo') {
                    e.preventDefault();
                    editWorkspace.toggleTodo(editWorkspaceItems[selectedIndex].id);
                    return;
                }
                // Enter: open a url/app, edit a todo's text inline, or open a
                // note in the Tiptap editor below (see the render block).
                if (e.key === 'Enter' && !e.shiftKey && selectedIndex >= 0 && editWorkspaceItems[selectedIndex]) {
                    e.preventDefault();
                    const it = editWorkspaceItems[selectedIndex];
                    if (it.kind === 'todo') editWorkspace.startEditTodo(it.id);
                    else if (it.kind === 'note') editWorkspace.openNote(it.id);
                    else openExistingWorkspaceItem(it);
                    return;
                }
                return;
            }

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const trimmed = query.trim();
                // Three in-box commands cover everything besides "search to
                // attach a link/folder" — no separate add-fields to tab
                // between. "/name" matches /agent's own rename shortcut.
                const nameMatch = /^\/name\s+(.+)$/i.exec(trimmed);
                if (nameMatch) {
                    editWorkspace.rename(nameMatch[1]);
                    setQuery('');
                    return;
                }
                const todoMatch = /^\/todo\s+(.+)$/i.exec(trimmed);
                if (todoMatch) {
                    editWorkspace.addTodo(todoMatch[1]);
                    setQuery('');
                    return;
                }
                const noteMatch = /^\/notes?\s+(.+)$/i.exec(trimmed);
                if (noteMatch) {
                    editWorkspace.addNote(noteMatch[1]);
                    setQuery('');
                    return;
                }
                // A highlighted result attaches as an item — same interaction
                // as /new-workspace's folder step and /agent's context chips.
                if (selectedIndex >= 0 && flatRows[selectedIndex]) {
                    const mapped = resultToWorkspaceItem(flatRows[selectedIndex].item);
                    if (mapped) {
                        editWorkspace.addItem(mapped);
                    } else {
                        showFeedback("That can't be added to a workspace", 'error');
                    }
                    setQuery('');
                }
                return;
            }
            if (e.key === 'ArrowDown' && flatRows.length > 0) {
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % flatRows.length);
                return;
            }
            if (e.key === 'ArrowUp' && flatRows.length > 0) {
                e.preventDefault();
                setSelectedIndex(prev => (prev <= 0 ? flatRows.length - 1 : prev - 1));
                return;
            }
            return;
        }

        if (commandMode === 'new-workspace') {
            if (e.key === 'Escape') {
                e.preventDefault();
                newWorkspace.exit();
                return;
            }
            if (newWorkspace.step === 'name') {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    newWorkspace.confirmName(query);
                    return;
                }
                // Nothing to step back to before the first step — Backspace
                // on an empty box leaves the wizard, same grammar as /agent.
                if (e.key === 'Backspace' && !query) {
                    e.preventDefault();
                    newWorkspace.exit();
                    return;
                }
                return; // no result navigation while typing a name
            }
            if (newWorkspace.step === 'folders') {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    // A highlighted result attaches — same interaction as
                    // /agent's context chips (see attachToAgentContext).
                    if (selectedIndex >= 0 && flatRows[selectedIndex]) {
                        const mapped = resultToWorkspaceItem(flatRows[selectedIndex].item);
                        if (mapped?.kind === 'app') {
                            newWorkspace.addFolder(mapped);
                        } else {
                            showFeedback('Pick a folder, file, or app', 'error');
                        }
                        return;
                    }
                    // Nothing highlighted — folders are optional, move on.
                    newWorkspace.goToConfirm();
                    return;
                }
                if (e.key === 'Backspace' && !query) {
                    e.preventDefault();
                    newWorkspace.backToName();
                    return;
                }
                if (e.key === 'ArrowDown' && flatRows.length > 0) {
                    e.preventDefault();
                    setSelectedIndex(prev => (prev + 1) % flatRows.length);
                    return;
                }
                if (e.key === 'ArrowUp' && flatRows.length > 0) {
                    e.preventDefault();
                    setSelectedIndex(prev => (prev <= 0 ? flatRows.length - 1 : prev - 1));
                    return;
                }
                return;
            }
            // step === 'confirm'
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!newWorkspace.creating) newWorkspace.confirmCreate();
                return;
            }
            if (e.key === 'Backspace' && !query) {
                e.preventDefault();
                newWorkspace.backToFolders();
                return;
            }
            return;
        }

        if (commandMode === 'agent') {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const pending = aiCli.turns.find(t => t.proposal?.valid.length);
                // With a proposal on screen Enter is the confirm — the run is
                // over and the only thing left to do is accept it.
                if (pending) { applyProposal(pending); return; }
                // A highlighted result attaches as context instead of opening
                // — same idea as normal search's Enter, just repurposed:
                // composing a request isn't the moment to launch something.
                if (selectedIndex >= 0 && flatRows[selectedIndex]) {
                    attachToAgentContext(flatRows[selectedIndex].item);
                    return;
                }
                const trimmed = query.trim();
                // "/name <title>" is a local shortcut, not a request for the
                // CLI — renames instantly and never touches aiCli.run.
                const nameMatch = /^\/name\s+(.+)$/i.exec(trimmed);
                if (nameMatch) {
                    runRenameWorkspace(nameMatch[1]);
                    setQuery('');
                    return;
                }
                if (trimmed && !aiCli.running) {
                    runAgent(trimmed);
                    setQuery('');
                }
                return;
            }
            // Backspace on an empty box removes the chip, the way a tag input
            // works — otherwise the only way out is Esc, which also closes.
            if (e.key === 'Backspace' && !query) {
                e.preventDefault();
                exitAgentMode();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                if (aiCli.running) { aiCli.cancel(); return; }  // stop the agent before closing
                exitAgentMode();
                return;
            }
            // Agent mode still renders the ordinary results list below the
            // transcript (see the flatRows block further down — it's the one
            // mode that keeps searching while a request is open), so ↑/↓
            // needs to move the highlight through it same as hovering does
            // (ResultItem's onHover already wires to setSelectedIndex).
            // Deliberately local to flatRows rather than the shared
            // selectVisualIndex/currentIndex machinery below: that machinery
            // also drives the context/pins/workspace sections, none of which
            // render in this mode.
            if (e.key === 'ArrowDown' && flatRows.length > 0) {
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % flatRows.length);
                return;
            }
            if (e.key === 'ArrowUp' && flatRows.length > 0) {
                e.preventDefault();
                setSelectedIndex(prev => (prev <= 0 ? flatRows.length - 1 : prev - 1));
                return;
            }
            // →/← mirrors the normal search's folder-tree expand/collapse
            // (same tree used below the transcript) — same selectedIndex
            // indexing as ↑/↓ above.
            {
                const treeRow = selectedIndex >= 0 ? flatRows[selectedIndex] : null;
                if (e.key === 'ArrowRight' && treeRow?.isFolder) {
                    e.preventDefault();
                    if (!treeRow.isExpanded) {
                        expandPath(treeRow.item); // collapsed → expand
                    } else if (flatRows[selectedIndex + 1]?.depth === treeRow.depth + 1) {
                        setSelectedIndex(selectedIndex + 1); // expanded → step into first child
                    }
                    return;
                }
                if (e.key === 'ArrowLeft' && treeRow) {
                    e.preventDefault();
                    if (treeRow.isFolder && treeRow.isExpanded) {
                        collapsePath(treeRow.item.path); // expanded → collapse
                    } else if (treeRow.depth > 0) {
                        // step out to the parent row (nearest previous row at depth-1)
                        for (let i = selectedIndex - 1; i >= 0; i--) {
                            if (flatRows[i].depth === treeRow.depth - 1) { setSelectedIndex(i); break; }
                        }
                    }
                    return;
                }
            }
            return; // no other result navigation in agent mode
        }

        // Handle command modes first
        if (commandMode === 'ai') {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const prompt = query.replace(/^\/ai\s*/i, '').trim();
                if (prompt) {
                    sendAiMessage(prompt);
                    setQuery('/ai '); // Reset to just the command
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setCommandMode(null);
                setAiMessages([]);
                setQuery('');
                return;
            }
            return; // Don't process other keys in AI mode
        }

        if (commandMode === 'model') {
            const filterQuery = query.replace(/^\/model\s*/i, '').trim().toLowerCase();
            const filteredModels = availableModels.filter(m =>
                !m.disabled && m.title.toLowerCase().includes(filterQuery)
            );

            if (e.key === 'ArrowDown' && filteredModels.length > 0) {
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % filteredModels.length);
                return;
            }
            if (e.key === 'ArrowUp' && filteredModels.length > 0) {
                e.preventDefault();
                setSelectedIndex(prev => prev <= 0 ? filteredModels.length - 1 : prev - 1);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const modelToLoad = selectedIndex >= 0 ? filteredModels[selectedIndex] : filteredModels[0];
                if (modelToLoad && !modelToLoad.disabled && !modelToLoad.isLoaded) {
                    loadModel(modelToLoad.name);
                } else if (modelToLoad?.isLoaded) {
                    handleClose(); // Already loaded, just close
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setCommandMode(null);
                setQuery('');
                return;
            }
            return;
        }

        const isSearching = !!query.trim();

        // Build complete navigable list depending on state.
        // Visual order (idle): Apps → Tabs → Pinned → Workspace items.
        // While searching: only Results (the expandable folder tree).
        const totalContext = isSearching ? 0 : contextGroups.visibleList.length;
        const totalPins = isSearching ? 0 : pinnedItems.length;
        // Empty workspace (or "None") still gets one slot — the selector itself —
        // so the section stays reachable and ←/→ can switch workspaces from it.
        const wsSelectorOnly = !isSearching && wsNavItems.length === 0 && workspaces.length > 0;
        const totalWs = isSearching ? 0 : (wsSelectorOnly ? 1 : wsNavItems.length);
        // "+N more results" is a real navigable row (mirrors the expand-apps/
        // expand-tabs chips above) — without it, arrow-key nav dead-ends at
        // row 10 and the rest of the results are only reachable by clicking.
        const hasMoreResultsRow = !showAllResults && results.length > 10;
        const totalResults = flatRows.length + (hasMoreResultsRow ? 1 : 0); // results section is the (expandable) folder tree [+ show-more row]
        const totalItems = totalContext + totalPins + totalWs + totalResults;

        // selectedPinIndex encodes idle-mode selection:
        //   [0, pins)                 → pinned item
        //   [pins, pins+context)      → context chip (visible apps then tabs)
        //   [pins+context, …+ws)      → workspace entry
        // selectedIndex indexes flatRows while searching.
        let currentIndex = -1;
        if (!isSearching && selectedPinIndex >= 0) {
            if (selectedPinIndex < pinnedItems.length) {
                currentIndex = totalContext + selectedPinIndex;
            } else if (selectedPinIndex < pinnedItems.length + totalContext) {
                currentIndex = selectedPinIndex - pinnedItems.length;
            } else {
                currentIndex = totalContext + totalPins + (selectedPinIndex - pinnedItems.length - totalContext);
            }
        } else if (isSearching && selectedIndex >= 0) {
            currentIndex = selectedIndex;
        }

        // Map a visual index back onto the two selection states (wraps around).
        const selectVisualIndex = (idx) => {
            if (totalItems === 0) return;
            const i = ((idx % totalItems) + totalItems) % totalItems;
            if (!isSearching) {
                if (i < totalContext) {
                    setSelectedPinIndex(pinnedItems.length + i);
                } else if (i < totalContext + totalPins) {
                    setSelectedPinIndex(i - totalContext);
                } else {
                    setSelectedPinIndex(pinnedItems.length + totalContext + (i - totalContext - totalPins));
                }
                setSelectedIndex(-1);
                return;
            }
            setSelectedPinIndex(-1);
            setSelectedIndex(i);
        };

        // Tab / Shift+Tab → jump between sections (Apps → Tabs → Pinned → Workspace).
        // Swallowed while searching too, so focus never escapes the input.
        if (e.key === 'Tab') {
            e.preventDefault();
            if (!isSearching) {
                const sections = [
                    { start: 0, len: contextGroups.appsBlockLen },
                    { start: contextGroups.appsBlockLen, len: contextGroups.tabsBlockLen },
                    { start: totalContext, len: totalPins },
                    { start: totalContext + totalPins, len: totalWs },
                ].filter(s => s.len > 0);
                if (sections.length > 0) {
                    const cur = sections.findIndex(s => currentIndex >= s.start && currentIndex < s.start + s.len);
                    const next = cur === -1
                        ? (e.shiftKey ? sections.length - 1 : 0)
                        : (cur + (e.shiftKey ? -1 : 1) + sections.length) % sections.length;
                    selectVisualIndex(sections[next].start);
                }
            }
            return;
        }

        // Right/Left arrow while searching → expand/collapse the selected
        // folder (tree nav). In idle mode ←/→ drive the workspace selector below.
        const treeIdx = currentIndex;
        const treeRow = isSearching && currentIndex >= 0 ? flatRows[currentIndex] : null;

        if (e.key === 'ArrowRight' && treeRow && treeRow.isFolder) {
            e.preventDefault();
            if (!treeRow.isExpanded) {
                expandPath(treeRow.item); // collapsed → expand
            } else if (flatRows[treeIdx + 1]?.depth === treeRow.depth + 1) {
                setSelectedIndex(treeIdx + 1); // expanded → step into first child
            }
            return;
        }
        if (e.key === 'ArrowLeft' && treeRow) {
            e.preventDefault();
            if (treeRow.isFolder && treeRow.isExpanded) {
                collapsePath(treeRow.item.path); // expanded → collapse
            } else if (treeRow.depth > 0) {
                // step out to the parent row (nearest previous row at depth-1)
                for (let i = treeIdx - 1; i >= 0; i--) {
                    if (flatRows[i].depth === treeRow.depth - 1) { setSelectedIndex(i); break; }
                }
            }
            return;
        }

        // ←/→ in idle mode → switch the active workspace (the selector), when
        // in the workspace section or before any selection. Safe to hijack:
        // the input is empty, so there is no text caret to move.
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isSearching && workspaces.length > 1) {
            const inWsSection = currentIndex >= totalContext + totalPins && currentIndex < totalItems;
            if (inWsSection || currentIndex === -1) {
                e.preventDefault();
                const cur = workspaces.findIndex(w => w.id === expandedWorkspaceId);
                const next = cur === -1
                    ? (e.key === 'ArrowRight' ? 0 : workspaces.length - 1) // from "None"
                    : (cur + (e.key === 'ArrowRight' ? 1 : -1) + workspaces.length) % workspaces.length;
                setExpandedWorkspaceId(workspaces[next].id);
                // Land on the new workspace's first entry so ↑↓/Enter continue from there
                if (inWsSection) setSelectedPinIndex(pinnedItems.length + totalContext);
                return;
            }
        }

        // Navigation handlers — follow visual order: Apps → Tabs → Pins → Workspace → Results
        if (e.key === 'ArrowDown' && totalItems > 0) {
            e.preventDefault();
            selectVisualIndex(currentIndex + 1); // -1 → first item; wraps at the end
        } else if (e.key === 'ArrowUp' && totalItems > 0) {
            e.preventDefault();
            selectVisualIndex(currentIndex === -1 ? totalItems - 1 : currentIndex - 1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // A fully typed command runs as typed — it beats the highlighted
            // suggestion (e.g. "!go yt" with the "!go <shortcut>" row selected).
            const typed = query.trim();
            if (slash.isDirectCommand(typed)) {
                handleClose();
                slash.execute(typed);
                return;
            }
            // Exactly one action per Enter, in priority order:
            // selected item → typed URL → top result → Google search fallback
            if (currentIndex >= 0 && currentIndex < totalItems) {
                if (currentIndex < totalContext) {
                    const item = contextGroups.visibleList[currentIndex];
                    // Expand/collapse chips toggle their row instead of opening anything.
                    // Expanding keeps the index — the chip's slot becomes the first newly
                    // revealed item. Collapsing re-selects the chip at its new position.
                    if (item?.type === 'expand-apps') {
                        setShowAllApps(v => !v);
                        if (item.expanded) setSelectedPinIndex(pinnedItems.length + 4);
                    } else if (item?.type === 'expand-tabs') {
                        setShowAllTabs(v => !v);
                        if (item.expanded) setSelectedPinIndex(pinnedItems.length + contextGroups.appsBlockLen + 8);
                    } else {
                        handleSelect(item);
                    }
                } else if (currentIndex < totalContext + totalPins) {
                    handleSelect(pinnedItems[currentIndex - totalContext]);
                } else if (currentIndex < totalContext + totalPins + totalWs) {
                    if (wsSelectorOnly) {
                        // Slot is the selector itself — Enter toggles the picker menu
                        setWsDropdownOpen(v => !v);
                    } else {
                        handleWorkspaceItemSelect(wsNavItems[currentIndex - totalContext - totalPins]);
                    }
                } else {
                    const resultIndex = currentIndex - totalContext - totalPins - totalWs;
                    // The show-more row sits one slot past the last real row —
                    // Enter on it reveals the rest, same as clicking it.
                    if (hasMoreResultsRow && resultIndex === flatRows.length) {
                        setShowAllResults(true);
                    } else {
                        handleSelect(flatRows[resultIndex]?.item);
                    }
                }
            } else if (query.startsWith('http')) {
                handleSelect({ url: query, type: 'url' });
            } else if (flatRows.length > 0) {
                handleSelect(flatRows[0].item);
            } else if (query.trim() && !addTarget) {
                // No results — search the web instead (without any /u /a /f prefix;
                // a bare prefix with no term does nothing). Suppressed in add
                // mode: Enter there means "file the thing I picked", and
                // launching a browser tab is the opposite of that.
                const { scope: qScope, term: qTerm } = parseScopedQuery(query.trim());
                const webQuery = qScope ? qTerm : query.trim();
                if (webQuery) {
                    if (window.electronAPI?.openExternal) {
                        window.electronAPI.openExternal(`https://www.google.com/search?q=${encodeURIComponent(webQuery)}`);
                    } else {
                        window.open(`https://www.google.com/search?q=${encodeURIComponent(webQuery)}`, '_blank');
                    }
                    handleClose();
                }
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (wsDropdownOpen) {
                setWsDropdownOpen(false); // close the workspace picker before the spotlight
            } else {
                handleClose();
            }
        } else if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (isSearching && selectedIndex >= 0) {
                // selectedIndex can point at the "+N more results" row (see
                // hasMoreResultsRow), which has no `flatRows` entry — nothing
                // to pin there.
                const item = flatRows[selectedIndex]?.item;
                if (item) togglePin(item);
            }
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isSearching && currentIndex >= totalContext && currentIndex < totalContext + totalPins) {
            e.preventDefault();
            const pinIndex = currentIndex - totalContext;
            removePin(pinIndex);
            // Adjust selection after removal
            const maxPinIndex = totalPins - 2; // -1 for removed, -1 for 0-index
            if (maxPinIndex >= 0) setSelectedPinIndex(Math.min(pinIndex, maxPinIndex));
            else setSelectedPinIndex(-1);
        }
    };

    // Handle Keyboard Navigation for Buttons (redirect arrows to main list)
    const handleButtonKeyDown = (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            inputRef.current?.focus();
            handleKeyDown(e);
        }
    };

    const handleSelect = async (item) => {
        if (!item) return;

        // Add mode: a result is something to file into the target workspace,
        // not something to launch. Commands are exempt — they aren't items.
        // The panel deliberately stays open and the query clears, because
        // filling a workspace means adding several things in a row.
        if (addTarget && onAddItem && item.type !== 'command') {
            const mapped = resultToWorkspaceItem(item);
            if (!mapped) {
                showFeedback(`"${item.title || item.name || 'That'}" can't be added to a workspace`, 'error');
                return;
            }
            try {
                await onAddItem(addTarget, mapped);
                showFeedback(`Added to ${addTarget.name}`, 'success');
            } catch (e) {
                console.error('[Spotlight] Failed to add item to workspace:', e);
                showFeedback('Could not add that — see console', 'error');
                return;
            }
            setQuery('');
            setResults([]);
            setSelectedIndex(-1);
            inputRef.current?.focus();
            return;
        }

        // Command palette rows: templates insert their prefix into the input,
        // complete commands execute via the slash hook.
        if (item.type === 'command') {
            if (item.insert != null) {
                setQuery(item.insert);
                inputRef.current?.focus();
                return;
            }
            handleClose();
            slash.execute(item.command);
            return;
        }

        // Workspace rows navigate the host's workspace view when it has one
        if (item.type === 'workspace' && onWorkspaceNavigate) {
            handleClose();
            onWorkspaceNavigate(item.title || item.name);
            return;
        }

        // Picking one of several ambiguous-prefix workspace matches (see the
        // debounce effect above) opens it in /edit-workspace directly.
        if (item.type === 'workspace-edit') {
            editWorkspace.enter(item.workspace);
            setSelectedIndex(-1);
            return;
        }

        // The "no strong matches, ask the agent" fallback row: switch straight
        // into agent mode and send the original query as the request — no
        // panel close (agent mode's transcript view takes over instead, same
        // as typing "/agent <query>" and hitting Enter).
        if (item.type === 'agent-suggest') {
            setCommandMode('agent');
            setQuery('');
            runAgent(item.query);
            return;
        }

        // In /agent mode, clicking a result attaches it as context instead of
        // opening it — same reasoning as the Enter handler above.
        if (commandMode === 'agent') {
            attachToAgentContext(item);
            return;
        }

        // /new-workspace's folder step: clicking attaches too.
        if (commandMode === 'new-workspace' && newWorkspace.step === 'folders') {
            const mapped = resultToWorkspaceItem(item);
            if (mapped?.kind === 'app') {
                newWorkspace.addFolder(mapped);
            } else {
                showFeedback('Pick a folder, file, or app', 'error');
            }
            return;
        }

        // /edit-workspace: clicking a result adds it as an item too.
        if (commandMode === 'edit-workspace') {
            const mapped = resultToWorkspaceItem(item);
            if (mapped) {
                editWorkspace.addItem(mapped);
            } else {
                showFeedback("That can't be added to a workspace", 'error');
            }
            return;
        }

        // Close immediately for snappy feel
        handleClose();

        // Record feedback for RAG (fire-and-forget, non-blocking). The query is
        // included so the backend learns keyword→URL associations for ranking —
        // strip any /u /a /f scope prefix so it learns the bare keyword.
        recordSearchSelection(item, resultsDisplayedAtRef.current, parseScopedQuery(query?.trim() || '').term).catch(() => { });

        // For tabs, switch to the existing tab instead of opening new
        if (item.type === 'tab') {
            try {
                const tabId = item.tabId || item.id;
                if (tabId) {
                    // One payload for both transports. In the desktop window
                    // `chrome` is the polyfill (chromePolyfill.js) that forwards to
                    // the Tauri shim, so the chrome branch — not the electronAPI one
                    // — is what runs there. Building the message twice meant the
                    // desktop path silently dropped _deviceId, and a jump with no
                    // deviceId stops being routed to one browser instance: the tab id
                    // is no longer authoritative, so every Chromium browser has to
                    // re-prove it by exact url and the jump lands nowhere.
                    const jumpMsg = {
                        type: 'JUMP_TO_TAB',
                        tabId,
                        windowId: item.windowId || item.window_id,
                        url: item.url,
                        _deviceId: item._deviceId,
                        browser: item.browser,
                    };
                    // Fire-and-forget — spotlight is already closing
                    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                        chrome.runtime.sendMessage(jumpMsg);
                    } else if (window.electronAPI?.sendMessage) {
                        window.electronAPI.sendMessage(jumpMsg);
                    }
                    return;
                }

                // No tabId — open URL in browser as fallback
                if (item.url) {
                    if (window.electronAPI?.openExternal) {
                        window.electronAPI.openExternal(item.url);
                    } else {
                        window.open(item.url, '_blank');
                    }
                    return;
                }
            } catch (e) {
                console.warn('[Spotlight] Failed to switch to tab:', e);
            }
        }

        // Windows Settings page — launch via the ms-settings: URI (ShellExecute).
        if (item.type === 'setting') {
            try {
                if (window.electronAPI?.openExternal) {
                    await window.electronAPI.openExternal(item.uri);
                } else {
                    console.warn('[Spotlight] openExternal not available for settings');
                }
            } catch (e) {
                console.error('[Spotlight] Failed to open Windows setting:', e);
            }
            return;
        }

        // Control Panel applet / system tool. Items with args (e.g. `control
        // /name …`) need the spawn-with-args path; single tokens (.msc/.cpl/exe)
        // open via ShellExecute, exactly like typing them into Run.
        if (item.type === 'tool') {
            try {
                if (item.args?.length && window.electronAPI?.launchAppWithArgs) {
                    await window.electronAPI.launchAppWithArgs(item.exec, item.args);
                } else if (window.electronAPI?.launchApp) {
                    await window.electronAPI.launchApp(item.exec);
                } else {
                    console.warn('[Spotlight] launchApp not available for tools');
                }
            } catch (e) {
                console.error('[Spotlight] Failed to launch Windows tool:', e);
            }
            return;
        }

        // Handle files natively using OS default viewer
        if (item.type === 'folder') {
            try {
                if (window.electronAPI?.openFolder) {
                    await window.electronAPI.openFolder(item.path);
                } else if (window.electronAPI?.launchApp) {
                    await window.electronAPI.launchApp(item.path);
                } else {
                    console.warn('[Spotlight] openFolder not available for folders');
                }
            } catch (e) {
                console.error('[Spotlight] Failed to open folder:', e);
            }
            return;
        }

        if (item.type === 'file') {
            try {
                if (window.electronAPI?.launchApp) {
                    await window.electronAPI.launchApp(item.path);
                } else {
                    console.warn('[Spotlight] launchApp not available for files');
                }
            } catch (e) {
                console.error('[Spotlight] Failed to open file:', e);
            }
            return;
        }

        // For apps, focus running app or launch installed app
        if (item.type === 'app') {
            console.log('[Spotlight] App selected:', item.name, 'isRunning:', item.isRunning, 'pid:', item.pid, 'path:', item.path, 'electronAPI:', !!window.electronAPI);

            try {
                // Track app usage for recommendations
                trackAppUsage(item.name);

                // Check if electronAPI is available
                if (!window.electronAPI) {
                    console.warn('[Spotlight] electronAPI not available - cannot launch/focus apps');
                    return;
                }

                // Tab entry (Windows Terminal / File Explorer): focus the
                // specific tab via UIA, not just the host window.
                if (item.tabIndex != null && item.hwnd && window.electronAPI.focusAppTab) {
                    console.log('[Spotlight] Focusing tab:', item.title, 'hwnd:', item.hwnd, 'index:', item.tabIndex);
                    await window.electronAPI.focusAppTab(item.hwnd, item.tabIndex, item.title);
                    return;
                }

                // Check if app is running (use PID from search result if available)
                if (item.isRunning && item.pid) {
                    // App is running - focus specific window by HWND if available, else by PID
                    console.log('[Spotlight] Focusing running app:', item.name, 'PID:', item.pid, 'HWND:', item.hwnd);
                    if (window.electronAPI.focusApp) {
                        await window.electronAPI.focusApp(item.pid, item.name, item.hwnd, item.path);
                    } else {
                        console.warn('[Spotlight] focusApp not available');
                    }
                    return;
                }

                // For pinned apps without PID, we need to find the current running instance
                // because the stored PID might be stale (use cached service)
                if (!item.pid) {
                    const { runningApps } = await runningAppsService.getApps();
                    if (runningApps?.length > 0) {
                        const runningInstance = runningApps.find(app =>
                            app.name?.toLowerCase() === item.name?.toLowerCase()
                        );

                        if (runningInstance && runningInstance.pid) {
                            // App is running - focus it
                            console.log('[Spotlight] Found running instance via lookup:', runningInstance.name, 'PID:', runningInstance.pid);
                            if (window.electronAPI.focusApp) {
                                await window.electronAPI.focusApp(runningInstance.pid, runningInstance.name, runningInstance.hwnd, runningInstance.path);
                            }
                            return;
                        }
                    }
                }

                // App is not running - launch it
                let launchPath = item.path;

                // Windows Terminal is often a Store/MSIX app. Its scanned path may not
                // be directly launchable, but the `wt` command alias is.
                if (isWindowsTerminalApp(item) && window.electronAPI?.launchAppWithArgs) {
                    console.log('[Spotlight] Launching Windows Terminal via wt command');
                    await window.electronAPI.launchAppWithArgs('wt', []);
                    return;
                }

                // If no path, try to find it from installed apps
                if (!launchPath) {
                    console.log('[Spotlight] No path in item, searching installed apps for:', item.name);
                    const { installedApps } = await runningAppsService.getApps();
                    if (installedApps?.length > 0) {
                        const foundApp = installedApps.find(app =>
                            app.name?.toLowerCase() === item.name?.toLowerCase()
                        );
                        if (foundApp?.path) {
                            launchPath = foundApp.path;
                            console.log('[Spotlight] Found path from installed apps:', launchPath);
                        }
                    }
                }

                if (launchPath) {
                    if (window.electronAPI.launchApp) {
                        console.log('[Spotlight] Launching app:', item.name, 'path:', launchPath);
                        await window.electronAPI.launchApp(launchPath);
                    } else {
                        console.warn('[Spotlight] launchApp not available');
                    }
                } else {
                    console.warn('[Spotlight] No path available for app:', item.name);
                }
            } catch (e) {
                console.warn('[Spotlight] App action failed:', e);
                // Fallback: if focus failed, try launching (which usually focuses it anyway)
                if (item.path && window.electronAPI?.launchApp) {
                    try {
                        console.log('[Spotlight] Falling back to launchApp:', item.path);
                        await window.electronAPI.launchApp(item.path);
                    } catch (launchErr) {
                        console.warn('[Spotlight] Launch fallback failed:', launchErr);
                    }
                }
            }
            return;
        }

        // Default: open URL
        if (item.url) {
            if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(item.url);
            } else {
                window.open(item.url, '_blank');
            }
        } else if (item.type === 'command') {
            // Handle commands if any
            console.log('Command executed:', item);
        }
    };

    // Open a workspace entry (url or app chip) — shared by click and Enter so
    // keyboard selection behaves exactly like clicking the chip.
    const handleWorkspaceItemSelect = (entry) => {
        if (!entry) return;

        // Add mode has to be checked here too, not just in handleSelect: this
        // handler launches and opens on its own for anything that isn't
        // already running, so without this a click in add mode opened the item
        // instead of filing it — and the branches that *do* delegate to
        // handleSelect added it, making the two halves disagree.
        if (addTarget && onAddItem) {
            handleSelect(entry.kind === 'url'
                ? { type: 'url', url: entry.data.url, title: entry.data.title, favicon: entry.data.favicon }
                : { type: entry.data.appType || 'app', name: entry.data.name, path: entry.data.path, icon: entry.data.icon });
            return;
        }

        if (entry.kind === 'url') {
            if (entry.openTab) { handleSelect(entry.openTab); return; }
            if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(entry.data.url);
            } else {
                window.open(entry.data.url, '_blank');
            }
            handleClose();
            return;
        }
        const app = entry.data;
        if (entry.runningApp) { handleSelect(entry.runningApp); return; }
        const type = (app.appType || '').toLowerCase();
        if (WS_EDITORS.includes(type) && window.electronAPI?.launchAppWithArgs) {
            window.electronAPI.launchAppWithArgs(type === 'vscode' ? 'code' : type, [app.path]);
        } else if (app.appType === 'folder' && window.electronAPI?.openFolder) {
            window.electronAPI.openFolder(app.path);
        } else if (window.electronAPI?.launchApp) {
            window.electronAPI.launchApp(app.path);
        }
        handleClose();
    };

    // Close a running app or browser tab directly from its context pill.
    // Keeps the spotlight open (unlike handleSelect) so the user can close several.
    const handleContextClose = useCallback(async (item, e) => {
        if (e) e.stopPropagation();
        if (!item) return;

        // Optimistically drop the pill for instant feedback; re-sync shortly after
        setContextItems(prev => prev.filter(it => it !== item));

        try {
            if (item.type === 'tab') {
                const tabId = item.tabId || item.id;
                // Tombstone so reloads don't flicker the pill back before the close lands
                pendingClosedTabsRef.current.add(`${item._deviceId || ''}:${tabId}`);
                const closeMsg = {
                    type: 'CLOSE_TAB',
                    tabId,
                    url: item.url,
                    _deviceId: item._deviceId,
                    browser: item.browser,
                };
                // Mirror handleSelect/JUMP_TO_TAB: in the desktop window `chrome` is a
                // polyfill that forwards to the Tauri shim; in the real extension it
                // reaches background.js. Both handle CLOSE_TAB.
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    chrome.runtime.sendMessage(closeMsg);
                } else if (window.electronAPI?.sendMessage) {
                    window.electronAPI.sendMessage(closeMsg);
                }
            } else if (item.type === 'app') {
                // Only running apps can be closed; need a pid (or hwnd) to target them
                if (item.isRunning && (item.pid || item.hwnd) && window.electronAPI?.closeApp) {
                    // Tombstone by pid: a graceful quit (AppleScript "quit" /
                    // WM_CLOSE) returns as soon as the request is *sent*, not
                    // once the app has actually exited, so a reload before it
                    // finishes would otherwise see the pid still running and
                    // put the pill right back. This keeps it hidden until the
                    // pid genuinely disappears — see loadContextItems.
                    if (item.pid) pendingClosedAppsRef.current.add(item.pid);
                    await window.electronAPI.closeApp(item.pid || 0, item.hwnd);
                    trackAppUsage(item.name);
                }
            }
        } catch (err) {
            console.warn('[Spotlight] Failed to close item:', err);
        }

        // Reconcile with real state once the OS/tab list has updated.
        setTimeout(() => loadContextItems(), 500);
    }, [loadContextItems]);

    const handleClose = useCallback(() => {
        setQuery('');
        setResults([]);
        setExpandedPaths(new Set());
        setTreeChildren({});
        if (isEmbedded) {
            // Inline surface: collapse the dropdown, never hide any window
            setPanelOpen(false);
            inputRef.current?.blur();
            return;
        }
        if (window.electronAPI && window.electronAPI.sendMessage) {
            window.electronAPI.sendMessage({ type: 'SPOTLIGHT_HIDE' });
        }
    }, [isEmbedded]);

    // Handle Escape key to close (workspace picker first, then add mode, then
    // the spotlight). Add mode outranks closing: Escape should put the search
    // back to being a search, not dismiss it and leave the mode armed.
    // Window-level, not the input's own onKeyDown, so this also catches Esc
    // while focus is inside the Tiptap note editor (a separate element) —
    // without the priority check here it would close the whole spotlight
    // instead of just the note.
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (commandMode === 'edit-workspace' && editWorkspace.activeNoteId) editWorkspace.closeNote();
                else if (wsDropdownOpen) setWsDropdownOpen(false);
                else if (addTarget && onExitAddMode) onExitAddMode();
                else if (!isEmbedded || panelOpen) handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleClose, wsDropdownOpen, isEmbedded, panelOpen, addTarget, onExitAddMode, commandMode, editWorkspace]);

    // Embedded: '/' anywhere on the page focuses the search (like the old header search)
    useEffect(() => {
        if (!isEmbedded) return;
        const handleGlobalKeys = (e) => {
            if (e.key === '/' &&
                document.activeElement.tagName !== 'INPUT' &&
                document.activeElement.tagName !== 'TEXTAREA' &&
                !document.activeElement.isContentEditable) {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleGlobalKeys);
        return () => window.removeEventListener('keydown', handleGlobalKeys);
    }, [isEmbedded]);

    // Close on click outside (embedded: only while the dropdown is open).
    // A command mode holds the panel open: /agent runs for tens of seconds and
    // carries a transcript, so a stray click anywhere else used to throw away a
    // conversation mid-answer. The chip's × and Esc are the ways out.
    const handleClickOutside = useCallback(() => {
        if (isEmbedded && !panelOpen) return;
        if (commandMode) return;
        handleClose();
    }, [isEmbedded, panelOpen, handleClose, commandMode]);
    useOnClickOutside(containerRef, handleClickOutside);

    // Format URL helper
    const formatUrl = (url) => {
        if (!url) return '';
        try {
            const u = new URL(url);
            return u.hostname.replace('www.', '') + (u.pathname !== '/' ? u.pathname : '');
        } catch { return url; }
    };

    // Badge Helper
    const getBadgeLabel = (item) => {
        if (item.type === 'tab') return 'Tab';
        if (item.type === 'workspace') return 'Space';
        if (item.type === 'history') return 'History';
        if (item.type === 'bookmark') return 'Bookmark';
        if (item.type === 'file') return 'File';
        if (item.type === 'folder') return 'Folder';
        if (item.type === 'app') return item.isRunning ? 'Running' : 'App';
        if (item.type === 'setting') return 'Setting';
        if (item.type === 'tool') return 'Tool';
        if (item.type === 'command') return item.category || 'Command';
        if (item.type === 'agent-suggest') return 'Agent';
        if (item.type === 'workspace-edit') return 'Workspace';
        if (item.type === 'todo') return item.done ? 'Done' : 'Todo';
        if (item.type === 'note') return 'Note';
        return item.category || 'Link';
    };

    // When the active workspace has no entries, the workspace nav slot is the
    // selector itself — highlight the trigger so keyboard position stays visible.
    const wsSelectorSelected = !query.trim() && !commandMode
        && wsNavItems.length === 0 && workspaces.length > 0
        && selectedPinIndex === pinnedItems.length + contextGroups.visibleList.length;

    // Sidebar / docked-drawer width: no room for the embedded search UI
    if (isEmbedded && isSidebarSize) {
        return null;
    }

    // Embedded: everything below the input renders in an anchored dropdown,
    // and only while the search is engaged.
    const bodyVisible = !isEmbedded || panelOpen;

    return (
        <div className={isEmbedded ? 'spotlight-embedded' : 'spotlight-overlay'}>
            <div className="spotlight-container" ref={containerRef}>
                {/* Search Header */}
                <div className={`spotlight-search-box${voice.isListening ? ' listening' : ''}${addTarget ? ' add-mode' : ''}`}>
                    <span className="spotlight-prompt">{'>'}</span>
                    {/* Add-mode chip — the search looks identical in both modes,
                        so the target workspace has to be visible or a click
                        files something instead of opening it with no warning. */}
                    {addTarget && (
                        <span className="spotlight-add-badge">
                            <FontAwesomeIcon icon={faPlus} />
                            <span>{addTarget.name}</span>
                            <button
                                type="button"
                                className="spotlight-add-badge-exit"
                                onMouseDown={(e) => { e.preventDefault(); onExitAddMode?.(); }}
                                title="Stop adding (Esc)"
                                aria-label="Stop adding to workspace"
                            >
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        </span>
                    )}
                    {/* Command-mode chip — same grammar as the add badge, so
                        "the box is in a mode" always looks the same. */}
                    {commandMode === 'agent' && (
                        <span className="spotlight-add-badge spotlight-mode-badge">
                            <FontAwesomeIcon icon={faTerminal} />
                            <span>Agent</span>
                            <button
                                type="button"
                                className="spotlight-add-badge-exit"
                                onMouseDown={(e) => { e.preventDefault(); exitAgentMode(); }}
                                title="Leave agent mode (Esc)"
                                aria-label="Leave agent mode"
                            >
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        </span>
                    )}
                    {commandMode === 'new-workspace' && (
                        <span className="spotlight-add-badge spotlight-mode-badge">
                            <FontAwesomeIcon icon={faFolder} />
                            <span>New workspace</span>
                            <button
                                type="button"
                                className="spotlight-add-badge-exit"
                                onMouseDown={(e) => { e.preventDefault(); newWorkspace.exit(); }}
                                title="Cancel (Esc)"
                                aria-label="Cancel new workspace"
                            >
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        </span>
                    )}
                    {commandMode === 'edit-workspace' && (
                        <span className="spotlight-add-badge spotlight-mode-badge">
                            <FontAwesomeIcon icon={faFolder} />
                            <span>{editWorkspace.workspace?.name || 'Edit workspace'}</span>
                            <button
                                type="button"
                                className="spotlight-add-badge-exit"
                                onMouseDown={(e) => { e.preventDefault(); editWorkspace.exit(); }}
                                title="Close (Esc)"
                                aria-label="Close edit workspace"
                            >
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        </span>
                    )}
                    {(() => {
                        const { scope } = parseScopedQuery(query.trim());
                        return scope ? <span className="spotlight-scope-badge">{scope.label}</span> : null;
                    })()}
                    <input
                        ref={inputRef}
                        className="spotlight-input"
                        placeholder={commandMode === 'agent'
                            ? (aiCli.turns.length ? 'Ask a follow-up…' : 'Describe how to reorganise your workspaces…')
                            : commandMode === 'new-workspace'
                                ? (newWorkspace.step === 'name'
                                    ? 'Name this workspace…'
                                    : newWorkspace.step === 'folders'
                                        ? 'Search for a folder to add (Enter to skip)…'
                                        : 'Press Enter to create…')
                                : commandMode === 'edit-workspace'
                                    ? 'Search to add a link/folder, or /name, /todo, /notes…'
                                    : addTarget
                                        ? `Search to add to ${addTarget.name}…`
                                        : (placeholder || (isEmbedded ? 'Search or type / for commands...' : 'Almighty Search...'))}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => { if (isEmbedded) setPanelOpen(true); }}
                        autoFocus={!isEmbedded}
                        spellCheck={false}
                    />
                    {loading && <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>}
                    {/* WS connection indicator — only meaningful in extension (desktop uses IPC, not WS) */}
                    {isHostSyncEnabled() && !window.electronAPI && !(window.__TAURI__ || window.__TAURI_INTERNALS__) && (
                        <div
                            title={wsConnected ? 'App sync connected — tabs are live' : 'App sync disconnected — tabs may be outdated'}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                background: wsConnected ? 'rgba(34, 197, 94, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                                border: `1px solid ${wsConnected ? 'rgba(34, 197, 94, 0.25)' : 'rgba(100, 116, 139, 0.2)'}`,
                                fontSize: '10px',
                                color: wsConnected ? '#4ADE80' : '#64748B',
                                userSelect: 'none',
                                flexShrink: 0
                            }}
                        >
                            <div style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                background: wsConnected ? '#22C55E' : '#64748B',
                                boxShadow: wsConnected ? '0 0 5px #22C55E' : 'none'
                            }} />
                            <span>{wsConnected ? 'Synced' : 'Offline'}</span>
                        </div>
                    )}
                    {/*
                    <button
                        className={`spotlight-deep-btn ${deepSearch ? 'active' : ''}`}
                        onClick={() => setDeepSearch(!deepSearch)}
                        onKeyDown={handleButtonKeyDown}
                        title="Toggle Deep Search"
                    >
                        ✨ Deep
                    </button> */}
                    {VOICE_SEARCH_ENABLED && enableVoice && voice.voiceSupported && (
                        <button
                            className={`spotlight-voice-btn${voice.isListening ? ' listening' : ''}`}
                            onClick={() => voice.toggleVoice()}
                            onKeyDown={handleButtonKeyDown}
                            title={voice.isListening ? 'Stop voice input' : 'Voice commands'}
                        >
                            {voice.isListening ? (
                                <span className="voice-waveform">
                                    {voice.waveformData.map((v, i) => (
                                        <span key={i} style={{ height: `${4 + v * 10}px` }} />
                                    ))}
                                </span>
                            ) : (
                                <FontAwesomeIcon icon={faMicrophone} />
                            )}
                        </button>
                    )}
                    {!isEmbedded && (
                        <button
                            className="spotlight-close-btn"
                            onClick={handleClose}
                            onKeyDown={handleButtonKeyDown}
                            title="Close (Esc)"
                        >
                            ×
                        </button>
                    )}
                </div>

                {/* Command / voice feedback toast — floats under the pill when
                    the dropdown is closed, renders as a row inside it when open */}
                {feedback && !bodyVisible && (
                    <div className={`spotlight-feedback spotlight-feedback--floating ${feedback.type || 'info'}`}>
                        <span className="spotlight-feedback-msg">{feedback.message}</span>
                        <button className="spotlight-feedback-close" onClick={() => setFeedback(null)}>×</button>
                    </div>
                )}

                {bodyVisible && (
                <div className="spotlight-body">
                {feedback && (
                    <div className={`spotlight-feedback ${feedback.type || 'info'}`}>
                        <span className="spotlight-feedback-msg">{feedback.message}</span>
                        <button className="spotlight-feedback-close" onClick={() => setFeedback(null)}>×</button>
                    </div>
                )}
                {/* Agent mode — a terminal AI CLI proposes workspace changes.
                    Three states in one panel: the picker (idle), the live
                    stdout stream (running), and the proposal (done). */}
                {commandMode === 'agent' && (
                    <div className="spotlight-ai-mode spotlight-agent-mode">
                        {/* No "Agent" title here — the chip in the search box
                            already says which mode you're in, and repeating it
                            two rows apart just took space the controls needed. */}
                        <div className="spotlight-ai-header">
                            <div className="spotlight-agent-menu-wrap">
                                <button
                                    type="button"
                                    className={`spotlight-agent-chip is-active${agentAdapterOpen ? ' is-open' : ''}`}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        setAgentAdapterOpen(v => !v);
                                        setAgentHistoryOpen(false);
                                    }}
                                    title={`Running with ${aiCli.adapter.label}`}
                                    aria-expanded={agentAdapterOpen}
                                >
                                    <FontAwesomeIcon icon={faTerminal} />
                                    <span>{aiCli.adapter.label}</span>
                                    <span className="spotlight-agent-caret">▾</span>
                                </button>
                                {agentAdapterOpen && (
                                    <div className="spotlight-agent-menu">
                                        {aiCli.adapters.map(a => {
                                            const found = aiCli.available?.[a.bin];
                                            return (
                                                <button
                                                    key={a.id}
                                                    type="button"
                                                    className={`spotlight-agent-menu-item${a.id === aiCli.adapterId ? ' is-selected' : ''}${found === false ? ' is-missing' : ''}`}
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        aiCli.selectAdapter(a.id);
                                                        setAgentAdapterOpen(false);
                                                    }}
                                                    title={found === false ? `${a.bin} not found on PATH` : `Run with ${a.label}`}
                                                >
                                                    <span>{a.label}</span>
                                                    {/* Still selectable when missing — the label is
                                                        the explanation, not a lockout. */}
                                                    {found === false && <span className="spotlight-agent-menu-note">not installed</span>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="spotlight-agent-header-spacer" />

                            {/* Scaffolds (and, when the workspace holds several
                                project folders, links) .cooldesk/ — replaces the
                                separate cooldesk-plugin's /cd-init + /cd-link.
                                Hidden entirely until a project folder is resolved,
                                so an ordinary chat request isn't cluttered by a
                                button that does nothing for it. */}
                            {wsScaffoldPlan?.hub && (
                                <button
                                    type="button"
                                    className="spotlight-agent-chip"
                                    disabled={aiCli.running}
                                    onMouseDown={(e) => { e.preventDefault(); runCreateWorkspace(query.trim()); setQuery(''); }}
                                    title={`Scaffold .cooldesk/ for "${wsScaffoldPlan.hub.name}"${wsScaffoldPlan.members.length ? ` and link ${wsScaffoldPlan.members.length} sibling project(s)` : ''}`}
                                >
                                    <FontAwesomeIcon icon={faFolder} />
                                    {wsScaffoldPlan.members.length
                                        ? `Create + link ${wsScaffoldPlan.members.length + 1} projects`
                                        : 'Create workspace'}
                                </button>
                            )}

                            {/* Clears the transcript without leaving the mode.
                                Worth its own control: every prompt carries the
                                last six turns, so asking something unrelated
                                otherwise drags irrelevant context along — and
                                the only alternative was Esc and retyping
                                /agent. Hidden until there's something to clear. */}
                            {aiCli.turns.length > 0 && (
                                <button
                                    type="button"
                                    className="spotlight-agent-chip"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        aiCli.reset();
                                        setQuery('');
                                        setAgentHistoryOpen(false);
                                        setAgentContext([]);
                                        inputRef.current?.focus();
                                    }}
                                    title="New chat — the next question won't carry this conversation's context or attachments"
                                >
                                    New chat
                                </button>
                            )}

                            {/* Past requests. The transcript is per-session by
                                design; this is the part that persists, so a
                                prompt worth reusing isn't lost on close. */}
                            <div className="spotlight-agent-history-wrap">
                                <button
                                    type="button"
                                    className={`spotlight-agent-chip${agentHistoryOpen ? ' is-active' : ''}`}
                                    onMouseDown={(e) => { e.preventDefault(); setAgentHistoryOpen(v => !v); setAgentAdapterOpen(false); }}
                                    title="Previous requests"
                                    aria-expanded={agentHistoryOpen}
                                >
                                    <FontAwesomeIcon icon={faHistory} />
                                </button>
                                {agentHistoryOpen && (
                                    <div className="spotlight-agent-history">
                                        {aiCli.history.length === 0 ? (
                                            <div className="spotlight-agent-history-empty">Nothing asked yet.</div>
                                        ) : (
                                            <>
                                                {aiCli.history.map((h) => (
                                                    <div key={`${h.at}-${h.text}`} className="spotlight-agent-history-row">
                                                        {/* Opens the saved exchange — question and
                                                            answer — rather than re-running it. An
                                                            agent run costs time and tokens, and the
                                                            answer you already paid for is right here. */}
                                                        <button
                                                            type="button"
                                                            className="spotlight-agent-history-item"
                                                            title={h.reply ? `${h.text}\n\n${h.reply}` : h.text}
                                                            onMouseDown={(e) => {
                                                                e.preventDefault();
                                                                aiCli.restoreFromHistory(h);
                                                                setAgentHistoryOpen(false);
                                                            }}
                                                        >
                                                            <span className="spotlight-agent-history-q">{h.text}</span>
                                                            {h.reply && (
                                                                <span className="spotlight-agent-history-a">{h.reply}</span>
                                                            )}
                                                        </button>
                                                        {/* Separate control, because reusing a prompt
                                                            and rereading an answer are different jobs. */}
                                                        <button
                                                            type="button"
                                                            className="spotlight-agent-history-reuse"
                                                            title="Edit and ask again"
                                                            aria-label="Edit and ask again"
                                                            onMouseDown={(e) => {
                                                                e.preventDefault();
                                                                setQuery(h.text);
                                                                setAgentHistoryOpen(false);
                                                                inputRef.current?.focus();
                                                            }}
                                                        >
                                                            <FontAwesomeIcon icon={faPlus} />
                                                        </button>
                                                    </div>
                                                ))}
                                                <button
                                                    type="button"
                                                    className="spotlight-agent-history-clear"
                                                    onMouseDown={(e) => { e.preventDefault(); aiCli.clearHistory(); }}
                                                >
                                                    Clear history
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {aiCli.running && (
                                <button
                                    type="button"
                                    className="spotlight-agent-cancel"
                                    onMouseDown={(e) => { e.preventDefault(); aiCli.cancel(); }}
                                >
                                    Stop
                                </button>
                            )}
                        </div>

                        {/* Attached context — picked from the results list below
                            (click, or arrow to highlight + Enter) instead of
                            opening. Sent alongside every request until removed. */}
                        {agentContext.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 4px 8px' }}>
                                {agentContext.map(c => (
                                    <span key={c.id} className="spotlight-agent-chip" title={c.path}>
                                        <FontAwesomeIcon icon={c.kind === 'folder' ? faFolder : faFileLines} />
                                        {c.name}
                                        {c.status === 'loading' && ' …'}
                                        {c.status === 'unreadable' && ' (unreadable)'}
                                        <button
                                            type="button"
                                            className="spotlight-add-badge-exit"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                setAgentContext(prev => prev.filter(x => x.id !== c.id));
                                            }}
                                            title="Remove from context"
                                            aria-label={`Remove ${c.name} from context`}
                                        >
                                            <FontAwesomeIcon icon={faTimes} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className="spotlight-ai-messages spotlight-agent-log" ref={agentLogRef}>
                            {aiCli.turns.length === 0 && (
                                <div className="spotlight-ai-hint">
                                    Describe how to reorganise your workspaces, then press Enter.
                                    {' '}Pick a file or folder below (click, or arrow to it and press Enter) to attach it as context.
                                    {' '}Type <code>/name &lt;title&gt;</code> to rename this workspace instantly.
                                    {wsScaffoldPlan?.hub && (
                                        <> Or use the {wsScaffoldPlan.members.length ? 'Create + link' : 'Create workspace'} button above to scaffold a shared <code>.cooldesk/</code>.</>
                                    )}
                                    {aiCli.available?.[aiCli.adapter.bin] === false && (
                                        <div className="spotlight-agent-warn">
                                            <code>{aiCli.adapter.bin}</code> isn’t on your PATH — install it or pick another above.
                                        </div>
                                    )}
                                </div>
                            )}

                            {aiCli.turns.map(turn => (
                                <div key={turn.id} className="spotlight-agent-turn">
                                    <div className="spotlight-agent-request">
                                        <span className="spotlight-agent-request-mark">›</span>
                                        {turn.request}
                                    </div>

                                    {/* The answer. Ordinary conversation is the common
                                        case, so this is the headline; raw stdout is
                                        folded away below since it's mostly protocol. */}
                                    {turn.reply && (
                                        <div className="spotlight-agent-reply">
                                            <div className="spotlight-agent-reply-head">
                                                <span className="spotlight-agent-reply-who">CoolDesk</span>
                                                <CopyButton
                                                    getText={() => turn.reply}
                                                    title="Copy answer (or select part of it and press Ctrl+C)"
                                                />
                                            </div>
                                            <div className="spotlight-agent-reply-text">
                                                <AgentMarkdown text={turn.reply} />
                                            </div>
                                        </div>
                                    )}

                                    {/* Raw output. While the run is in flight this is the
                                        only sign of life, so it stays open; once there's
                                        an answer it collapses out of the way. */}
                                    {turn.lines.length > 0 && (turn.running || (!turn.reply && !turn.proposal) ? (
                                        <pre className="spotlight-agent-stream">
                                            {turn.lines.map((l, i) => (
                                                <div key={i} className={l.stream === 'stderr' ? 'is-stderr' : undefined}>{l.text}</div>
                                            ))}
                                        </pre>
                                    ) : (
                                        <details className="spotlight-agent-raw">
                                            <summary>
                                                Output
                                                <CopyButton
                                                    getText={() => turn.lines.map(l => l.text).join('\n')}
                                                    title="Copy raw output"
                                                />
                                            </summary>
                                            <pre className="spotlight-agent-stream">
                                                {turn.lines.map((l, i) => (
                                                    <div key={i} className={l.stream === 'stderr' ? 'is-stderr' : undefined}>{l.text}</div>
                                                ))}
                                            </pre>
                                        </details>
                                    ))}

                                    {turn.running && !turn.lines.length && (
                                        <div className="spotlight-agent-waiting">Waiting for {aiCli.adapter.label}…</div>
                                    )}

                                    {turn.error && (
                                        <div className="spotlight-ai-message error">
                                            <div className="message-avatar">⚠️</div>
                                            <div className="message-content">{turn.error}</div>
                                        </div>
                                    )}

                                    {/* An action block that survived validation empty —
                                        only worth a line, and only when there was no
                                        prose answer to show instead. */}
                                    {turn.proposal && turn.proposal.valid.length === 0 && !turn.reply && (
                                        <div className="spotlight-agent-empty">No changes proposed.</div>
                                    )}

                                    {turn.proposal && turn.proposal.valid.length > 0 && (
                                        <div className="spotlight-agent-proposal">
                                            <div className="spotlight-agent-proposal-head">
                                                Proposed changes ({turn.proposal.valid.length})
                                            </div>
                                            <ul className="spotlight-agent-actions">
                                                {turn.proposal.valid.map((a, i) => (
                                                    <li key={i} className={a.type.startsWith('remove') ? 'is-remove' : 'is-add'}>
                                                        {describeAction(a)}
                                                    </li>
                                                ))}
                                            </ul>
                                            {/* Rejected actions are surfaced, not swallowed: applying
                                                half a plan without saying so is worse than failing. */}
                                            {turn.proposal.rejected.length > 0 && (
                                                <details className="spotlight-agent-rejected">
                                                    <summary>{turn.proposal.rejected.length} action(s) discarded as invalid</summary>
                                                    <ul>
                                                        {turn.proposal.rejected.map((r, i) => (
                                                            <li key={i}>{r.reason}</li>
                                                        ))}
                                                    </ul>
                                                </details>
                                            )}
                                            <div className="spotlight-agent-confirm">
                                                <button
                                                    type="button"
                                                    className="spotlight-agent-apply"
                                                    onMouseDown={(e) => { e.preventDefault(); applyProposal(turn); }}
                                                >
                                                    Apply
                                                </button>
                                                <button
                                                    type="button"
                                                    className="spotlight-agent-discard"
                                                    onMouseDown={(e) => { e.preventDefault(); aiCli.clearProposal(turn.id); }}
                                                >
                                                    Discard
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* /new-workspace — a guided form (name → folders → confirm)
                    instead of a bang command with syntax to remember. Folder
                    picking reuses the exact click/Enter-to-attach interaction
                    /agent's context chips already use (see the flatRows block
                    below, shared with every other mode). */}
                {commandMode === 'new-workspace' && (
                    <div className="spotlight-ai-mode spotlight-agent-mode">
                        <div className="spotlight-ai-header">
                            <FontAwesomeIcon icon={faFolder} style={{ color: '#4ADE80' }} />
                            <span>
                                {newWorkspace.step === 'name' && 'Step 1 of 3 — Name'}
                                {newWorkspace.step === 'folders' && `Step 2 of 3 — Folders for "${newWorkspace.name}"`}
                                {newWorkspace.step === 'confirm' && `Step 3 of 3 — Confirm "${newWorkspace.name}"`}
                            </span>
                        </div>

                        {(newWorkspace.step === 'folders' || newWorkspace.step === 'confirm') && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 4px 8px' }}>
                                {newWorkspace.folders.length === 0 && (
                                    <span className="spotlight-ai-hint" style={{ padding: 0 }}>No folders yet — optional.</span>
                                )}
                                {newWorkspace.folders.map(f => (
                                    <span key={f.path} className="spotlight-agent-chip" title={f.path}>
                                        <FontAwesomeIcon icon={f.appType === 'folder' ? faFolder : faFileLines} />
                                        {f.name}
                                        {newWorkspace.step === 'folders' && (
                                            <button
                                                type="button"
                                                className="spotlight-add-badge-exit"
                                                onMouseDown={(e) => { e.preventDefault(); newWorkspace.removeFolder(f.path); }}
                                                title="Remove"
                                                aria-label={`Remove ${f.name}`}
                                            >
                                                <FontAwesomeIcon icon={faTimes} />
                                            </button>
                                        )}
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className="spotlight-ai-messages">
                            {newWorkspace.step === 'name' && (
                                <div className="spotlight-ai-hint">
                                    Type a name for the workspace, then press Enter.
                                </div>
                            )}

                            {newWorkspace.step === 'folders' && (
                                <div className="spotlight-ai-hint">
                                    Search below and click (or arrow to it and press Enter) to add a folder.
                                    Press Enter on an empty box when you're done — folders are optional.
                                </div>
                            )}

                            {newWorkspace.step === 'confirm' && (
                                <div className="spotlight-agent-proposal">
                                    <div className="spotlight-agent-proposal-head">
                                        {newWorkspace.folders.length === 0
                                            ? 'A bare workspace, no linked folder.'
                                            : `${newWorkspace.folders.length} folder${newWorkspace.folders.length === 1 ? '' : 's'} attached.`}
                                    </div>
                                    {newWorkspace.plan?.hub && (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={newWorkspace.scaffoldChecked}
                                                onChange={(e) => newWorkspace.setScaffoldChecked(e.target.checked)}
                                            />
                                            Also set up <code>.cooldesk/</code>
                                            {newWorkspace.plan.members.length > 0 && ` and link ${newWorkspace.plan.members.length + 1} projects together`}
                                        </label>
                                    )}
                                    <div className="spotlight-agent-confirm">
                                        <button
                                            type="button"
                                            className="spotlight-agent-apply"
                                            disabled={newWorkspace.creating}
                                            onMouseDown={(e) => { e.preventDefault(); newWorkspace.confirmCreate(); }}
                                        >
                                            {newWorkspace.creating ? 'Creating…' : 'Create'}
                                        </button>
                                        <button
                                            type="button"
                                            className="spotlight-agent-discard"
                                            onMouseDown={(e) => { e.preventDefault(); newWorkspace.backToFolders(); }}
                                        >
                                            ← Back
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* /edit-workspace — typing an existing workspace's own name
                    opens it here: items as removable chips (search the main
                    box to add more, same interaction as /new-workspace's
                    folder step), notes and todos with their own small inputs
                    (the main box stays dedicated to "search to add an item"). */}
                {commandMode === 'edit-workspace' && editWorkspace.workspace && (() => {
                    const itemsCount = (editWorkspace.workspace.urls?.length || 0) + (editWorkspace.workspace.apps?.length || 0);
                    const todosCount = editWorkspace.todos.length;
                    const items = editWorkspaceItems.slice(0, itemsCount);
                    const activeNote = editWorkspace.activeNoteId
                        ? editWorkspace.notes.find(n => n.id === editWorkspace.activeNoteId)
                        : null;
                    // Formatting commands run straight against the live Tiptap
                    // instance via its own ref handle — TiptapEditor.jsx only
                    // renders floating/bubble menus (on selection), no fixed
                    // toolbar, so this is a small one of our own rather than
                    // changing that shared component.
                    const runNoteCommand = (fn) => {
                        const editor = noteEditorRef.current?.getEditor();
                        if (editor) fn(editor.chain().focus());
                    };
                    const toolbarButtons = [
                        { icon: faBold, title: 'Bold', run: (c) => c.toggleBold().run() },
                        { icon: faItalic, title: 'Italic', run: (c) => c.toggleItalic().run() },
                        { icon: faStrikethrough, title: 'Strikethrough', run: (c) => c.toggleStrike().run() },
                        { icon: faListUl, title: 'Bullet list', run: (c) => c.toggleBulletList().run() },
                        { icon: faListOl, title: 'Numbered list', run: (c) => c.toggleOrderedList().run() },
                        { icon: faQuoteRight, title: 'Quote', run: (c) => c.toggleBlockquote().run() },
                        { icon: faCode, title: 'Code', run: (c) => c.toggleCode().run() },
                    ];
                    return (
                    <div className="spotlight-ai-mode spotlight-agent-mode">
                        {/* No header — the input row's chip already names the
                            workspace; repeating it here was redundant. */}
                        {activeNote ? (
                            // Note editor — same Tiptap component WorkspaceContextPanel.jsx
                            // uses, so this reads/writes the identical HTML shape.
                            // "Command stays on top" (the search input above), the
                            // note surfaces below it, replacing the list until closed.
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input
                                        placeholder="Untitled note"
                                        value={activeNote.title || ''}
                                        onChange={(e) => editWorkspace.updateNoteTitle(activeNote.id, e.target.value)}
                                        style={{
                                            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                                            padding: '10px 4px 8px 12px', fontSize: 15, fontWeight: 600,
                                            color: 'rgba(255, 255, 255, 0.92)', letterSpacing: '-0.01em',
                                        }}
                                    />
                                    {/* Explicit close — Esc from inside the Tiptap
                                        editor doesn't reliably reach the window-level
                                        handler (ProseMirror stops it bubbling), so
                                        going back can't depend on a keystroke alone. */}
                                    <button
                                        type="button"
                                        className="spotlight-add-badge-exit"
                                        style={{ marginRight: 10 }}
                                        onMouseDown={(e) => { e.preventDefault(); editWorkspace.closeNote(); }}
                                        title="Back to list (Esc)"
                                        aria-label="Back to list"
                                    >
                                        <FontAwesomeIcon icon={faTimes} />
                                    </button>
                                </div>
                                <div style={{ display: 'flex', gap: 2, padding: '0 8px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                    {toolbarButtons.map(({ icon, title, run }) => (
                                        <button
                                            key={title}
                                            type="button"
                                            className="spotlight-agent-chip"
                                            style={{ padding: '4px 8px' }}
                                            title={title}
                                            onMouseDown={(e) => { e.preventDefault(); runNoteCommand(run); }}
                                        >
                                            <FontAwesomeIcon icon={icon} />
                                        </button>
                                    ))}
                                </div>
                                {/* .spotlight-note-editor scopes a tighter override of
                                    .ProseMirror's own padding (GlobalSpotlight.css) —
                                    that default (1rem 2rem) is sized for the full-page
                                    editor in WorkspaceContextPanel.jsx and, stacked on
                                    top of this box's own padding, left a wide empty
                                    margin around a short note here.
                                    The click-to-focus handler matters because this
                                    wrapper is taller than a short note's actual text —
                                    clicking the empty space below it hit plain dead
                                    space otherwise, and whatever had focus before (the
                                    search input) silently kept it, which looked like
                                    typing in the note went nowhere. */}
                                <div
                                    className="spotlight-note-editor"
                                    style={{ minHeight: 90, maxHeight: 320, overflowY: 'auto', cursor: 'text' }}
                                    onMouseDown={(e) => {
                                        if (e.target.closest('.ProseMirror')) return; // let it place the cursor normally
                                        e.preventDefault();
                                        noteEditorRef.current?.focus();
                                    }}
                                >
                                    <Suspense fallback={<div className="spotlight-ai-hint">Loading editor…</div>}>
                                        <TiptapEditor
                                            ref={noteEditorRef}
                                            content={activeNote.text}
                                            onChange={(html) => editWorkspace.updateNoteContent(activeNote.id, html)}
                                            showFloatingMenu={false}
                                            showBubbleMenu={false}
                                        />
                                    </Suspense>
                                </div>
                            </div>
                        ) : (
                        <div className="spotlight-ai-messages" style={{ display: 'flex', flexDirection: 'column' }}>
                            {/* Items, todos and notes all render as ResultItem rows —
                                the same component/styling the normal search results
                                list uses — so this reads as one consistent list
                                instead of a separate custom style per section.
                                Items are always the first `itemsCount` entries of
                                editWorkspaceItems, so index i here already is the
                                combined ↑↓ index. */}
                            {items.length === 0 && (
                                <div className="spotlight-ai-hint">No links or apps yet — search above to add one.</div>
                            )}
                            {items.map((it, i) => {
                                const resultItem = it.kind === 'url'
                                    ? { id: `url:${it.url}`, type: 'bookmark', title: it.name, url: it.url }
                                    : { id: `app:${it.path}`, type: it.appType === 'folder' ? 'folder' : (it.appType === 'file' ? 'file' : 'app'), title: it.name, path: it.path, icon: it.icon };
                                return (
                                    <ResultItem
                                        key={resultItem.id}
                                        item={resultItem}
                                        index={i}
                                        isSelected={!query.trim() && i === selectedIndex}
                                        onSelect={() => openExistingWorkspaceItem(it)}
                                        onHover={setSelectedIndex}
                                        onRemove={() => (it.kind === 'url' ? editWorkspace.removeUrl(it.url) : editWorkspace.removeApp(it.path))}
                                        formatUrl={formatUrl}
                                        getBadgeLabel={getBadgeLabel}
                                        getAppIcon={getAppIcon}
                                    />
                                );
                            })}

                            {/* Todos — the "Todo"/"Done" badge (see getBadgeLabel)
                                already identifies these rows; Enter edits the text
                                inline, Space toggles done. */}
                            {editWorkspace.todos.map((t, tIdx) => {
                                const combinedIdx = itemsCount + tIdx;
                                const isEditing = editWorkspace.editingTodoId === t.id;
                                // Same shell (icon box, padding, left accent) as
                                // ResultItem in both states, so editing a todo
                                // doesn't visually jump out of the list.
                                return isEditing ? (
                                    <div key={t.id} className="result-item result-todo" style={{ cursor: 'text' }}>
                                        <div className="result-icon"><FontAwesomeIcon icon={faTasks} /></div>
                                        <input
                                            autoFocus
                                            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'inherit', font: 'inherit' }}
                                            defaultValue={t.text}
                                            onBlur={(e) => editWorkspace.updateTodoText(t.id, e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') { e.preventDefault(); editWorkspace.updateTodoText(t.id, e.target.value); }
                                                if (e.key === 'Escape') { e.preventDefault(); editWorkspace.cancelEditTodo(); }
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <ResultItem
                                        key={t.id}
                                        item={{
                                            id: `todo:${t.id}`, type: 'todo', title: t.text, done: t.done,
                                            description: t.done ? 'Done — click to reopen' : 'Click to mark done',
                                        }}
                                        index={combinedIdx}
                                        isSelected={!query.trim() && combinedIdx === selectedIndex}
                                        onSelect={() => editWorkspace.toggleTodo(t.id)}
                                        onHover={setSelectedIndex}
                                        onRemove={() => editWorkspace.removeTodo(t.id)}
                                        formatUrl={formatUrl}
                                        getBadgeLabel={getBadgeLabel}
                                        getAppIcon={getAppIcon}
                                    />
                                );
                            })}

                            {/* Notes — the "Note" badge already identifies these
                                rows; Enter opens the Tiptap editor above. */}
                            {editWorkspace.notes.map((n, nIdx) => {
                                const combinedIdx = itemsCount + todosCount + nIdx;
                                return (
                                    <ResultItem
                                        key={n.id}
                                        item={{
                                            id: `note:${n.id}`, type: 'note',
                                            title: n.title || editWorkspace.stripHtml(n.text).slice(0, 60) || 'Untitled',
                                        }}
                                        index={combinedIdx}
                                        isSelected={!query.trim() && combinedIdx === selectedIndex}
                                        onSelect={() => editWorkspace.openNote(n.id)}
                                        onHover={setSelectedIndex}
                                        onRemove={() => editWorkspace.removeNote(n.id)}
                                        formatUrl={formatUrl}
                                        getBadgeLabel={getBadgeLabel}
                                        getAppIcon={getAppIcon}
                                    />
                                );
                            })}
                        </div>
                        )}
                    </div>
                    );
                })()}

                {/* AI Chat Mode */}
                {commandMode === 'ai' && (
                    <div className="spotlight-ai-mode">
                        <div className="spotlight-ai-header">
                            <FontAwesomeIcon icon={faRobot} style={{ color: '#A78BFA' }} />
                            <span>AI Chat</span>
                            {isAiLoading && (
                                <div style={{ width: 14, height: 14, border: '2px solid rgba(139, 92, 246, 0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />
                            )}
                        </div>
                        <div className="spotlight-ai-messages">
                            {aiMessages.length === 0 && (
                                <div className="spotlight-ai-hint">
                                    Type your message and press Enter to chat with AI
                                </div>
                            )}
                            {aiMessages.map((msg, idx) => (
                                <div key={idx} className={`spotlight-ai-message ${msg.role}`}>
                                    <div className="message-avatar">
                                        {msg.role === 'user' ? '👤' : msg.role === 'error' ? '⚠️' : '🤖'}
                                    </div>
                                    <div className="message-content">{msg.content}</div>
                                </div>
                            ))}
                            {isAiLoading && (
                                <div className="spotlight-ai-message assistant loading">
                                    <div className="message-avatar">🤖</div>
                                    <div className="message-content">
                                        <span className="typing-indicator">
                                            <span></span><span></span><span></span>
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Model Selection Mode */}
                {commandMode === 'model' && (
                    <div className="spotlight-model-mode">
                        <div className="spotlight-model-header">
                            <FontAwesomeIcon icon={faRobot} style={{ color: '#A78BFA' }} />
                            <span>Select AI Model</span>
                            {isModelLoading && (
                                <div style={{ width: 14, height: 14, border: '2px solid rgba(139, 92, 246, 0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />
                            )}
                        </div>
                        <div className="spotlight-model-list">
                            {availableModels.length === 0 && (
                                <div className="spotlight-model-loading">
                                    <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                    <span>Loading models...</span>
                                </div>
                            )}
                            {availableModels
                                .filter(m => {
                                    const filterQuery = query.replace(/^\/model\s*/i, '').trim().toLowerCase();
                                    return m.title.toLowerCase().includes(filterQuery);
                                })
                                .map((model, idx) => (
                                    <div
                                        key={model.name}
                                        className={`spotlight-model-item ${idx === selectedIndex ? 'selected' : ''} ${model.isLoaded ? 'loaded' : ''} ${model.disabled ? 'disabled' : ''} ${isModelLoading ? 'loading' : ''}`}
                                        onClick={() => !model.disabled && !model.isLoaded && !isModelLoading && loadModel(model.name)}
                                        onMouseEnter={() => setSelectedIndex(idx)}
                                    >
                                        <div className="model-icon">
                                            {isModelLoading && idx === selectedIndex ? (
                                                <div style={{ width: 18, height: 18, border: '2px solid rgba(139, 92, 246, 0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                            ) : (
                                                <FontAwesomeIcon icon={faRobot} />
                                            )}
                                        </div>
                                        <div className="model-info">
                                            <span className="model-title">{model.title}</span>
                                            <span className="model-desc">{model.description}</span>
                                        </div>
                                        {model.isLoaded && <span className="model-badge">Active</span>}
                                    </div>
                                ))}
                        </div>
                    </div>
                )}

                {/* Recommendations Section - Shows when query is empty */}
                {sections.context && !query.trim() && !commandMode && contextItems.length > 0 && (() => {
                    // Grouped/sliced in contextGroups so keyboard nav walks the same visible list
                    const { apps, tabs, visibleApps, visibleTabs } = contextGroups;
                    let flatIndex = pinnedItems.length; // Start after pinned items

                    console.log('[Spotlight] Rendering context - apps:', apps.length, 'tabs:', tabs.length);

                    return (
                        <div className="spotlight-context">
                            {/* Apps Row */}
                            {apps.length > 0 && (
                                <div className="context-section">
                                    <div className="context-section-header">
                                        <div className="context-section-label">Apps</div>
                                    </div>
                                    <div className="context-row context-row--grid">
                                        {visibleApps.map((item, i) => {
                                            const itemIndex = flatIndex++;
                                            return (
                                                <ContextItem
                                                    key={`app-${i}`}
                                                    item={item}
                                                    index={itemIndex}
                                                    isSelected={itemIndex === selectedPinIndex}
                                                    onSelect={handleSelect}
                                                    onHover={setSelectedPinIndex}
                                                    onClose={handleContextClose}
                                                    getAppIcon={getAppIcon}
                                                />
                                            );
                                        })}
                                        {apps.length > 4 && (() => {
                                            const itemIndex = flatIndex++;
                                            return (
                                                <div
                                                    key="expand-apps"
                                                    className={`context-item context-expand-chip${itemIndex === selectedPinIndex ? ' pin-selected' : ''}`}
                                                    onClick={() => setShowAllApps(v => !v)}
                                                    onMouseEnter={() => setSelectedPinIndex(itemIndex)}
                                                    title={showAllApps ? 'Show fewer apps' : 'Show all apps'}
                                                >
                                                    <span className="pin-label">{showAllApps ? '− less' : `+${apps.length - 4} more`}</span>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}
                            {/* Stale tabs warning in Spotlight */}
                            {/* Tabs Row */}
                            {tabs.length > 0 && (
                                <div className="context-section">
                                    <div className="context-section-header">
                                        <div className="context-section-label">Tabs</div>
                                    </div>
                                    <div className="context-row context-row--grid">
                                        {visibleTabs.map((item, i) => {
                                            const itemIndex = flatIndex++;
                                            return (
                                                <ContextItem
                                                    key={`tab-${i}`}
                                                    item={item}
                                                    index={itemIndex}
                                                    isSelected={itemIndex === selectedPinIndex}
                                                    onSelect={handleSelect}
                                                    onHover={setSelectedPinIndex}
                                                    onClose={handleContextClose}
                                                    getAppIcon={getAppIcon}
                                                />
                                            );
                                        })}
                                        {tabs.length > 8 && (() => {
                                            const itemIndex = flatIndex++;
                                            return (
                                                <div
                                                    key="expand-tabs"
                                                    className={`context-item context-expand-chip${itemIndex === selectedPinIndex ? ' pin-selected' : ''}`}
                                                    onClick={() => setShowAllTabs(v => !v)}
                                                    onMouseEnter={() => setSelectedPinIndex(itemIndex)}
                                                    title={showAllTabs ? 'Show fewer tabs' : 'Show all tabs'}
                                                >
                                                    <span className="pin-label">{showAllTabs ? '− less' : `+${tabs.length - 8} more`}</span>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Pinned Items Section */}
                {sections.pins && !query.trim() && !commandMode && pinnedItems.length > 0 && (
                    <div className="spotlight-pins">
                        <div className="spotlight-pins-header">
                            <span className="spotlight-pins-title">Pinned</span>
                            <span className="spotlight-pins-hint">⌫ to remove</span>
                        </div>
                        <div className="spotlight-pins-grid">
                            {pinnedItems.map((pin, i) => (
                                <PinItem
                                    key={`pin-${i}`}
                                    pin={pin}
                                    index={i}
                                    isSelected={i === selectedPinIndex}
                                    onSelect={handleSelect}
                                    onHover={setSelectedPinIndex}
                                    onRemove={removePin}
                                    getAppIcon={getAppIcon}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Workspaces Section */}
                {sections.workspaces && !query.trim() && !commandMode && (
                    <div className="spotlight-pins spotlight-pins--workspace">
                        {workspaces.length > 0 && (
                            <div className="spotlight-pins-header">
                                {/* The selector IS the section title — no separate label */}
                                <div className="ws-dropdown" ref={wsDropdownRef}>
                                    <button
                                        className={`ws-dropdown-trigger ${wsDropdownOpen ? 'open' : ''}${wsSelectorSelected ? ' kb-selected' : ''}`}
                                        onClick={() => setWsDropdownOpen(v => !v)}
                                    >
                                        {expandedWorkspaceId
                                            ? (() => {
                                                const ws = workspaces.find(w => w.id === expandedWorkspaceId);
                                                const count = ws ? (ws.urls || []).length + (ws.apps || []).length : 0;
                                                return <><FontAwesomeIcon icon={getWorkspaceIcon(ws?.name || '')} className="ws-dd-icon" /><span className="ws-dd-name">{ws?.name}</span>{count > 0 && <span className="ws-dd-count">{count}</span>}</>;
                                            })()
                                            : <span className="ws-dd-placeholder">Select…</span>
                                        }
                                        <svg className="ws-dd-chevron" width="8" height="5" viewBox="0 0 8 5" fill="none"><path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                                    </button>
                                    {wsDropdownOpen && wsMenuStyle && (
                                        <div className="ws-dropdown-menu" style={wsMenuStyle}>
                                            <button
                                                className={`ws-dropdown-item ${!expandedWorkspaceId ? 'active' : ''}`}
                                                onClick={() => { setExpandedWorkspaceId(null); setWsDropdownOpen(false); }}
                                            >
                                                <span className="ws-dd-placeholder">None</span>
                                            </button>
                                            {workspaces.map(ws => {
                                                const count = (ws.urls || []).length + (ws.apps || []).length;
                                                return (
                                                    <button
                                                        key={ws.id}
                                                        className={`ws-dropdown-item ${expandedWorkspaceId === ws.id ? 'active' : ''}`}
                                                        onClick={() => { setExpandedWorkspaceId(ws.id); setWsDropdownOpen(false); }}
                                                    >
                                                        <FontAwesomeIcon icon={getWorkspaceIcon(ws.name)} className="ws-dd-icon" />
                                                        <span className="ws-dd-name">{ws.name}</span>
                                                        {count > 0 && <span className="ws-dd-count">{count}</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Active workspace entries — rendered from wsNavItems so keyboard
                            selection (selectedPinIndex past pins+context) matches exactly */}
                        {expandedWorkspaceId && (() => {
                            const ws = workspaces.find(w => w.id === expandedWorkspaceId);
                            if (!ws) return null;
                            const wsSelBase = pinnedItems.length + contextGroups.visibleList.length;

                            return (
                                <div className="context-section" ref={wsEntriesRef}>
                                    {wsNavItems.length === 0 ? (
                                        <div style={{ opacity: 0.4, fontSize: 11, padding: '6px 0', fontStyle: 'italic' }}>Nothing in this workspace yet — ←/→ to switch</div>
                                    ) : (
                                        <div className="context-row context-row--grid">
                                            {wsNavItems.map((entry, idx) => {
                                                const isSel = selectedPinIndex === wsSelBase + idx;
                                                if (entry.kind === 'url') {
                                                    const u = entry.data;
                                                    const openTab = entry.openTab;
                                                    const resolvedFavicon = u.favicon || (u.url ? getFaviconUrl(u.url, 16, null, true) : null);
                                                    return (
                                                        <div
                                                            key={`url-${idx}`}
                                                            className={`context-item context-tab${openTab ? ' ws-item-live' : ''}${isSel ? ' pin-selected' : ''}`}
                                                            onClick={() => handleWorkspaceItemSelect(entry)}
                                                            onMouseEnter={() => { wsHoverSelectedRef.current = true; setSelectedPinIndex(wsSelBase + idx); }}
                                                            title={openTab ? `Open tab: ${openTab.title || u.url}` : (u.title || u.url)}
                                                        >
                                                            <div className="pin-icon">
                                                                {resolvedFavicon ? (
                                                                    <img src={resolvedFavicon} onError={e => { e.target.style.display = 'none'; }} alt="" />
                                                                ) : (
                                                                    <FontAwesomeIcon icon={faGlobe} style={{ color: '#a78bfa' }} />
                                                                )}
                                                            </div>
                                                            <span className="pin-label">{(u.title || u.url || 'Link').replace(/^https?:\/\//, '')}</span>
                                                            {openTab && <span className="ws-live-dot" title="Tab open" />}
                                                        </div>
                                                    );
                                                }
                                                const app = entry.data;
                                                const runningApp = entry.runningApp;
                                                const isEditor = WS_EDITORS.includes(app.appType?.toLowerCase());
                                                const appColor = isEditor ? '#38bdf8' : app.appType === 'folder' ? '#facc15' : app.appType === 'file' ? '#94a3b8' : '#8b5cf6';
                                                const appIcon = isEditor ? faCode : app.appType === 'folder' ? faFolderOpen : app.appType === 'file' ? faFileLines : faDesktop;
                                                return (
                                                    <div
                                                        key={`app-${idx}`}
                                                        className={`context-item context-app${runningApp ? ' ws-item-live' : ''}${isSel ? ' pin-selected' : ''}`}
                                                        onClick={() => handleWorkspaceItemSelect(entry)}
                                                        onMouseEnter={() => { wsHoverSelectedRef.current = true; setSelectedPinIndex(wsSelBase + idx); }}
                                                        title={runningApp ? `Running: ${app.name}` : (app.path || app.name)}
                                                    >
                                                        <div className="pin-icon">
                                                            {app.icon
                                                                ? <img src={app.icon} alt="" onError={e => { e.target.style.display = 'none'; }} />
                                                                : <FontAwesomeIcon icon={appIcon} style={{ color: appColor }} />
                                                            }
                                                        </div>
                                                        <span className="pin-label">{app.name}</span>
                                                        {runningApp && <span className="running-dot" />}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* Results — expandable folder tree (Explorer-style hierarchy).
                    Rendered in agent mode too, so asking the agent something
                    doesn't cost you the ordinary search: Enter goes to the
                    agent, clicking a row opens it as usual. Same for
                    /new-workspace's folder-picker step and /edit-workspace. */}
                {flatRows.length > 0 && (!commandMode || commandMode === 'agent' || commandMode === 'edit-workspace' ||
                    (commandMode === 'new-workspace' && newWorkspace.step === 'folders')) && (
                    <div className={`spotlight-results-row${previewItem ? ' has-preview' : ''}`}>
                        <div className="spotlight-results">
                            {flatRows.map((row, index) => (
                                <ResultItem
                                    key={row.item.id || index}
                                    item={row.item}
                                    index={index}
                                    depth={row.depth}
                                    isFolderRow={row.isFolder}
                                    isExpanded={row.isExpanded}
                                    onToggleExpand={toggleExpand}
                                    isSelected={index === selectedIndex}
                                    onSelect={handleSelect}
                                    onHover={setSelectedIndex}
                                    onTogglePin={togglePin}
                                    formatUrl={formatUrl}
                                    getBadgeLabel={getBadgeLabel}
                                    getAppIcon={getAppIcon}
                                />
                            ))}
                            {!showAllResults && results.length > 10 && (
                                <MoreResultsRow
                                    isSelected={selectedIndex === flatRows.length}
                                    count={results.length - 10}
                                    onSelect={() => setShowAllResults(true)}
                                    onHover={() => setSelectedIndex(flatRows.length)}
                                />
                            )}
                        </div>
                        {previewItem && (
                            <Suspense fallback={<div className="preview-pane" />}>
                                <PreviewPane item={previewItem} />
                            </Suspense>
                        )}
                    </div>
                )}

                {/* Footer — the hints below are all about navigating results,
                    so a command mode gets its own or none at all. Showing
                    "↑↓ Navigate" and "⌘P Pin" under a panel with no result
                    list is what made this bar look like it was floating loose. */}
                {sections.footer && commandMode === 'agent' && (
                    <div className="spotlight-footer">
                        <div className="shortcut-hint">
                            <span className="shortcut-key">↵</span> {aiCli.proposal ? 'Apply' : 'Run'}
                        </div>
                        <div className="shortcut-hint">
                            <span className="shortcut-key">Esc</span> {aiCli.running ? 'Stop' : 'Close'}
                        </div>
                    </div>
                )}
                {sections.footer && commandMode === 'new-workspace' && (
                    <div className="spotlight-footer">
                        <div className="shortcut-hint">
                            <span className="shortcut-key">↵</span> {
                                newWorkspace.step === 'name' ? 'Next'
                                    : newWorkspace.step === 'folders' ? 'Add / Skip'
                                        : 'Create'
                            }
                        </div>
                        {newWorkspace.step !== 'name' && (
                            <div className="shortcut-hint"><span className="shortcut-key">⌫</span> Back</div>
                        )}
                        <div className="shortcut-hint"><span className="shortcut-key">Esc</span> Cancel</div>
                    </div>
                )}
                {sections.footer && commandMode === 'edit-workspace' && (
                    <div className="spotlight-footer">
                        <div className="shortcut-hint"><span className="shortcut-key">↑↓</span> Browse</div>
                        <div className="shortcut-hint"><span className="shortcut-key">↵</span> Open / Add</div>
                        <div className="shortcut-hint"><span className="shortcut-key">/name /todo /notes</span> Add</div>
                        <div className="shortcut-hint"><span className="shortcut-key">Esc</span> Close</div>
                    </div>
                )}
                {sections.footer && !commandMode && (
                <div className="spotlight-footer">
                    <div className="shortcut-hint"><span className="shortcut-key">↵</span> Open</div>
                    <div className="shortcut-hint"><span className="shortcut-key">↑↓</span> Navigate</div>
                    <div className="shortcut-hint"><span className="shortcut-key">/u /a /f</span> Scope</div>
                    {query.trim() ? (
                        <div className="shortcut-hint"><span className="shortcut-key">→←</span> Expand</div>
                    ) : (
                        <>
                            <div className="shortcut-hint"><span className="shortcut-key">⇥</span> Section</div>
                            {workspaces.length > 1 && (
                                <div className="shortcut-hint"><span className="shortcut-key">→←</span> Workspace</div>
                            )}
                        </>
                    )}
                    <div className="shortcut-hint"><span className="shortcut-key">Esc</span> Close</div>
                    <div className="shortcut-hint" style={{ marginLeft: 'auto' }}><span className="shortcut-key">⌘P</span> Pin</div>
                </div>
                )}
                </div>
                )}
            </div>
            <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .app-icon-img { width: 100%; height: 100%; object-fit: contain; }
      `}</style>
        </div>
    );
}

// Map workspace names to category icons (mirrors WorkspaceCard logic)
const WORKSPACE_CATEGORY_ICONS = {
    finance: faChartLine,
    health: faHeartPulse,
    education: faGraduationCap,
    sports: faGamepad,
    social: faHashtag,
    travel: faPlane,
    entertainment: faVideo,
    shopping: faShoppingBag,
    food: faUtensils,
    utilities: faTools,
    github: faGithub,
    git: faGithub,
    dev: faCode,
    development: faCode,
    coding: faCode,
    code: faCode,
    terminal: faTerminal,
    ai: faRobot,
    gpt: faRobot,
    openai: faRobot,
    work: faBriefcase,
    business: faBriefcase,
    office: faBriefcase,
    personal: faHome,
    home: faHome,
    tasks: faTasks,
    management: faTasks,
    project: faTasks,
    design: faPalette,
    creative: faPalette,
    research: faSearch,
    google: faSearch,
    search: faSearch,
    cloud: faCloud,
    gaming: faGamepad,
    games: faGamepad,
    music: faMusic,
    video: faVideo,
    news: faNewspaper,
    reading: faFlask,
    ideas: faLightbulb,
    test: faVial,
    lab: faFlask,
};

// Get contextual icon for workspace based on its name
function getWorkspaceIcon(name) {
    if (!name) return faFolder;
    const normalized = name.toLowerCase().trim();
    for (const [key, icon] of Object.entries(WORKSPACE_CATEGORY_ICONS)) {
        if (normalized === key || normalized.includes(key + ' ') || normalized.includes(' ' + key) || normalized.startsWith(key)) {
            return icon;
        }
    }
    return faFolder;
}

// Real brand logos (Simple Icons) for code/tech extensions, with official-ish
// brand colors. Anything not here falls back to the FontAwesome map below.
const SI_FILE_ICONS = {
    // JS / TS ecosystem
    ts: { Icon: SiTypescript, color: '#3178c6' }, mts: { Icon: SiTypescript, color: '#3178c6' }, cts: { Icon: SiTypescript, color: '#3178c6' },
    tsx: { Icon: SiReact, color: '#61dafb' }, jsx: { Icon: SiReact, color: '#61dafb' },
    js: { Icon: SiJavascript, color: '#f7df1e' }, mjs: { Icon: SiJavascript, color: '#f7df1e' }, cjs: { Icon: SiJavascript, color: '#f7df1e' },
    vue: { Icon: SiVuedotjs, color: '#42b883' }, svelte: { Icon: SiSvelte, color: '#ff3e00' },
    // Web / styling
    html: { Icon: SiHtml5, color: '#e34f26' }, htm: { Icon: SiHtml5, color: '#e34f26' },
    css: { Icon: SiCss, color: '#2965f1' }, scss: { Icon: SiSass, color: '#cc6699' }, sass: { Icon: SiSass, color: '#cc6699' },
    tailwind: { Icon: SiTailwindcss, color: '#38bdf8' },
    // Languages
    py: { Icon: SiPython, color: '#3776ab' }, ipynb: { Icon: SiJupyter, color: '#f37726' },
    rs: { Icon: SiRust, color: '#dea584' }, go: { Icon: SiGo, color: '#00add8' },
    java: { Icon: SiOpenjdk, color: '#e76f00' }, class: { Icon: SiOpenjdk, color: '#e76f00' },
    kt: { Icon: SiKotlin, color: '#7f52ff' }, kts: { Icon: SiKotlin, color: '#7f52ff' },
    rb: { Icon: SiRuby, color: '#cc342d' }, php: { Icon: SiPhp, color: '#777bb4' }, swift: { Icon: SiSwift, color: '#f05138' },
    c: { Icon: SiC, color: '#a8b9cc' }, h: { Icon: SiC, color: '#a8b9cc' },
    cpp: { Icon: SiCplusplus, color: '#00599c' }, cc: { Icon: SiCplusplus, color: '#00599c' }, hpp: { Icon: SiCplusplus, color: '#00599c' },
    cs: { Icon: SiSharp, color: '#9b4f96' }, dart: { Icon: SiDart, color: '#0175c2' },
    lua: { Icon: SiLua, color: '#2c2d72' }, pl: { Icon: SiPerl, color: '#39457e' }, pm: { Icon: SiPerl, color: '#39457e' },
    scala: { Icon: SiScala, color: '#dc322f' }, ex: { Icon: SiElixir, color: '#4b275f' }, exs: { Icon: SiElixir, color: '#4b275f' },
    clj: { Icon: SiClojure, color: '#5881d8' }, hs: { Icon: SiHaskell, color: '#5e5086' }, r: { Icon: SiR, color: '#276dc3' },
    // Data / config / tooling
    json: { Icon: SiJson, color: '#cbcb41' },
    yaml: { Icon: SiYaml, color: '#cb171e' }, yml: { Icon: SiYaml, color: '#cb171e' },
    toml: { Icon: SiToml, color: '#9c4221' }, md: { Icon: SiMarkdown, color: '#cbd5e1' }, markdown: { Icon: SiMarkdown, color: '#cbd5e1' },
    graphql: { Icon: SiGraphql, color: '#e10098' }, gql: { Icon: SiGraphql, color: '#e10098' }, prisma: { Icon: SiPrisma, color: '#2d3748' },
    dockerfile: { Icon: SiDocker, color: '#2496ed' },
    sql: { Icon: SiMysql, color: '#4479a1' }, sqlite: { Icon: SiSqlite, color: '#003b57' }, sqlite3: { Icon: SiSqlite, color: '#003b57' }, db: { Icon: SiSqlite, color: '#003b57' },
    sh: { Icon: SiGnubash, color: '#4eaa25' }, bash: { Icon: SiGnubash, color: '#4eaa25' }, zsh: { Icon: SiGnubash, color: '#4eaa25' },
};

// Resolve a filename to { kind: 'si'|'fa', Icon, color } — react-icons brand
// logo where we have one, otherwise the FontAwesome category icon.
function getFileVisual(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const si = SI_FILE_ICONS[ext];
    if (si) return { kind: 'si', Icon: si.Icon, color: si.color };
    const meta = getFileIconMeta(filename);
    return { kind: 'fa', Icon: meta.icon, color: meta.color };
}

// Per-extension icon + brand color. Returns { icon, color } so file rows show a
// recognizable logo (React for .tsx/.jsx, Python, Rust, ...) tinted by language.
function getFileIconMeta(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    switch (ext) {
        // Web / frameworks
        case 'tsx': case 'jsx': return { icon: faReact, color: '#61dafb' };
        case 'ts':              return { icon: faFileCode, color: '#3178c6' };
        case 'js': case 'mjs': case 'cjs': return { icon: faJs, color: '#f7df1e' };
        case 'vue':             return { icon: faVuejs, color: '#42b883' };
        case 'svelte':          return { icon: faFileCode, color: '#ff3e00' };
        case 'html': case 'htm': return { icon: faHtml5, color: '#e34f26' };
        case 'css': case 'scss': case 'sass': case 'less': return { icon: faCss3Alt, color: '#2965f1' };
        case 'php':             return { icon: faPhp, color: '#8993be' };
        case 'node':            return { icon: faNodeJs, color: '#83cd29' };
        // Languages
        case 'py':              return { icon: faPython, color: '#4b8bbe' };
        case 'rs':              return { icon: faRust, color: '#f74c00' };
        case 'java': case 'class': return { icon: faJava, color: '#e76f00' };
        case 'go':              return { icon: faGolang, color: '#00add8' };
        case 'swift':           return { icon: faSwift, color: '#f05138' };
        case 'rb':              return { icon: faFileCode, color: '#cc342d' };
        case 'c': case 'h':     return { icon: faFileCode, color: '#5c6bc0' };
        case 'cpp': case 'cc': case 'hpp': return { icon: faFileCode, color: '#00599c' };
        case 'cs':              return { icon: faFileCode, color: '#9b4f96' };
        case 'kt': case 'kts':  return { icon: faFileCode, color: '#a97bff' };
        // Data / config / docs
        case 'json':            return { icon: faFileCode, color: '#cbcb41' };
        case 'xml': case 'yaml': case 'yml': case 'toml': return { icon: faFileCode, color: '#89cff0' };
        case 'md': case 'markdown': return { icon: faMarkdown, color: '#cbd5e1' };
        case 'sql': case 'db': case 'sqlite': case 'sqlite3': return { icon: faDatabase, color: '#38bdf8' };
        case 'txt': case 'log': case 'rtf': return { icon: faFileLines, color: '#94a3b8' };
        case 'pdf':             return { icon: faFilePdf, color: '#ef4444' };
        case 'doc': case 'docx': return { icon: faFileWord, color: '#2b579a' };
        case 'xls': case 'xlsx': return { icon: faFileExcel, color: '#217346' };
        case 'ppt': case 'pptx': return { icon: faFilePowerpoint, color: '#d24726' };
        case 'csv':             return { icon: faFileCsv, color: '#217346' };
        // Media
        case 'jpg': case 'jpeg': case 'png': case 'gif': case 'svg': case 'webp': case 'bmp': case 'ico': case 'tiff': case 'heic':
            return { icon: faImage, color: '#c084fc' };
        case 'mp4': case 'mkv': case 'avi': case 'mov': case 'wmv': case 'flv': case 'webm': case 'm4v':
            return { icon: faVideo, color: '#f87171' };
        case 'mp3': case 'wav': case 'flac': case 'ogg': case 'aac': case 'm4a': case 'wma':
            return { icon: faMusic, color: '#34d399' };
        // Archives / scripts / binaries / fonts
        case 'zip': case 'rar': case '7z': case 'tar': case 'gz': case 'bz2': case 'xz':
            return { icon: faFileZipper, color: '#eab308' };
        case 'sh': case 'bash': case 'zsh': case 'bat': case 'cmd': case 'ps1':
            return { icon: faTerminal, color: '#4ade80' };
        case 'ttf': case 'otf': case 'woff': case 'woff2':
            return { icon: faFont, color: '#a78bfa' };
        case 'exe': case 'msi': case 'dmg': case 'pkg': case 'deb': case 'rpm': case 'appimage':
            return { icon: faMicrochip, color: '#94a3b8' };
        default:
            return { icon: faFile, color: null };
    }
}

function getFileIcon(filename) {
    return getFileIconMeta(filename).icon;
}

// Map a backend file/folder entry ({ path, date, is_dir }) to a result item.
// Shared by file search and the folder drill-down so both render identically.
function fileToResultItem(file) {
    const filePath = typeof file === 'string' ? file : (file && file.path) || '';
    if (!filePath) return null;
    const isDir = typeof file === 'object' && !!file.is_dir;
    const fileDate = (file && file.date) ? ` • ${file.date}` : '';
    const segs = filePath.split(/[/\\]/).filter(Boolean);
    const fileName = segs[segs.length - 1] || filePath;
    // Parent location, with C:\Users\<name> abbreviated to ~ so the user can
    // tell which folder this is (e.g. ~ vs ~\Documents).
    const parentPath = segs.slice(0, -1).join('\\')
        .replace(/^([A-Za-z]:\\Users\\[^\\]+)/i, '~');
    return {
        id: `${isDir ? 'folder' : 'file'}:${filePath}`,
        type: isDir ? 'folder' : 'file',
        title: fileName,
        description: `${parentPath || 'Local'}${fileDate}`,
        path: filePath,
        icon: isDir ? 'folder' : 'file',
        isDir,
    };
}

function getIcon(type, name) {
    switch (type) {
        case 'tab': return faGlobe;
        case 'history': return faHistory;
        case 'bookmark': return faStar;
        case 'workspace': return getWorkspaceIcon(name);
        case 'note': return faStickyNote;
        case 'app': return faDesktop;
        case 'file': return getFileIcon(name);
        case 'folder': return faFolderOpen;
        case 'setting': return faCog;
        case 'tool': return faTools;
        case 'command': return faTerminal;
        case 'agent-suggest': return faRobot;
        case 'workspace-edit': return faFolder;
        case 'todo': return faTasks;
        default: return faLink;
    }
}

// Memoized Pin Item to prevent unnecessary re-renders
const PinItem = memo(function PinItem({ pin, index, isSelected, onSelect, onHover, onRemove, getAppIcon }) {
    const handleClick = useCallback(() => onSelect(pin), [pin, onSelect]);
    const handleMouseEnter = useCallback(() => onHover(index), [index, onHover]);
    const handleRemove = useCallback((e) => onRemove(index, e), [index, onRemove]);
    const handleIconError = useCallback((e) => {
        e.target.style.display = 'none';
        e.target.parentNode.innerHTML = '<span class="fa-icon-wrapper">💻</span>';
    }, []);
    const handleFaviconError = useCallback((e) => {
        e.target.style.display = 'none';
        e.target.parentNode.innerHTML = '🔗';
    }, []);

    return (
        <div
            className={`pin-item ${pin.type === 'app' ? 'pin-app' : ''} ${isSelected ? 'pin-selected' : ''}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
        >
            <div className="pin-icon">
                {pin.type === 'app' ? (
                    (pin.icon && pin.icon.length > 50) ? (
                        <img src={pin.icon} className="app-icon-img" alt="" onError={handleIconError} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(pin.name)} className="app-icon" />
                    )
                ) : (() => {
                    const resolvedFavicon = pin.favicon || (pin.url ? getFaviconUrl(pin.url, 32, null, true) : null);
                    return resolvedFavicon ? (
                        <img src={resolvedFavicon} onError={handleFaviconError} alt="" />
                    ) : (
                        <FontAwesomeIcon icon={faGlobe} />
                    );
                })()}
            </div>
            <span className="pin-label">{pin.title || pin.name || 'Link'}</span>
            <span className="pin-remove" onClick={handleRemove}>×</span>
        </div>
    );
});

// Memoized Context Item - compact version for grouped display
const ContextItem = memo(function ContextItem({ item, index, isSelected, onSelect, onHover, onClose, getAppIcon }) {
    const handleClick = useCallback(() => onSelect(item), [item, onSelect]);
    const handleMouseEnter = useCallback(() => onHover(index), [index, onHover]);
    const handleClose = useCallback((e) => onClose?.(item, e), [item, onClose]);
    const handleIconError = useCallback((e) => {
        e.target.style.display = 'none';
    }, []);

    const isApp = item.type === 'app';
    const isRunning = isApp && item.isRunning;
    const appContext = isApp ? getRunningAppContext(item) : null;
    // Tabs are always closable; apps only when running (an installed app isn't "open")
    const canClose = !isApp || isRunning;

    return (
        <div
            className={`context-item ${isApp ? 'context-app' : 'context-tab'} ${isSelected ? 'pin-selected' : ''}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            title={isApp ? [item.name || item.title, appContext].filter(Boolean).join(' • ') : (item.title || item.url)}
        >
            <div className="pin-icon">
                {isApp ? (
                    (item.icon && item.icon.length > 50) ? (
                        <img src={item.icon} className="app-icon-img" alt="" onError={handleIconError} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(item.name)} style={{ color: '#60a5fa' }} />
                    )
                ) : (() => {
                    const resolvedFavicon = item.favicon || (item.url ? getFaviconUrl(item.url, 16, null, true) : null);
                    return resolvedFavicon ? (
                        <img src={resolvedFavicon} onError={handleIconError} alt="" />
                    ) : (
                        <FontAwesomeIcon icon={faGlobe} style={{ color: '#a78bfa' }} />
                    );
                })()}
            </div>
            <span className="pin-label">
                {isApp ? (appContext || item.name || item.title) : (item.title || 'Tab')}
            </span>
            {isRunning && <span className="running-dot" />}
            {canClose && (
                <span
                    className="context-close"
                    onClick={handleClose}
                    title={isApp ? 'Close app' : 'Close tab'}
                    role="button"
                    aria-label={isApp ? 'Close app' : 'Close tab'}
                >
                    ×
                </span>
            )}
        </div>
    );
});

// Memoized Result Item to prevent unnecessary re-renders
const ResultItem = memo(function ResultItem({ item, index, isSelected, onSelect, onHover, onTogglePin, onRemove, formatUrl, getBadgeLabel, getAppIcon, depth = 0, isFolderRow = false, isExpanded = false, onToggleExpand }) {
    const handleClick = useCallback(() => onSelect(item), [item, onSelect]);
    // Mark hover-driven selection so the scroll effect can skip it: while wheel
    // scrolling, rows slide under the stationary cursor and fire mouseenter —
    // auto-scrolling to each one fights the user's scroll direction and makes
    // the end of a long result list hard to reach.
    const hoverSelectedRef = useRef(false);
    const handleMouseEnter = useCallback((e) => {
        // Chromium re-fires mouseenter on whatever row ends up under a
        // *stationary* cursor whenever the layout shifts beneath it — e.g. the
        // results column narrowing to 280px the moment arrow-key navigation
        // lands on a file with a Quick Look preview (see .has-preview in
        // GlobalSpotlight.css). Without this guard that synthetic enter calls
        // onHover() and silently overwrites the selection the keyboard just
        // set, so navigating with arrow keys while the mouse merely rests
        // over the list list feels random. A real hover always carries
        // coordinates that differ from the last recorded mouse position; a
        // reflow-triggered one repeats the same coordinates because the
        // pointer device never moved.
        if (!isRealPointerMove(lastPointerPos, e)) return;
        hoverSelectedRef.current = true;
        onHover(index);
    }, [index, onHover]);
    const handlePinClick = useCallback((e) => onTogglePin(item, e), [item, onTogglePin]);
    const handleRemoveClick = useCallback((e) => { e.stopPropagation(); onRemove(item, e); }, [item, onRemove]);
    const handleToggle = useCallback((e) => { e.stopPropagation(); onToggleExpand?.(item); }, [item, onToggleExpand]);

    // Track icon load errors to show fallback
    const [iconError, setIconError] = useState(false);
    const rowRef = useRef(null);
    // Per-extension logo + tint for file rows (e.g. React-blue for .tsx).
    const fileMeta = item.type === 'file' ? getFileVisual(item.title || item.name) : null;

    // Reset error when item changes
    useEffect(() => {
        setIconError(false);
    }, [item.id, item.icon, item.favicon]);

    // Keep the keyboard-selected row visible as the tree scrolls. Hover-driven
    // selection is skipped — the row is already under the cursor, and scrolling
    // to it would hijack an in-progress wheel scroll.
    useEffect(() => {
        if (isSelected && rowRef.current && !hoverSelectedRef.current) {
            rowRef.current.scrollIntoView({ block: 'nearest' });
        }
        hoverSelectedRef.current = false;
    }, [isSelected]);

    return (
        <div
            ref={rowRef}
            className={`result-item ${isSelected ? 'selected' : ''} result-${['tab', 'bookmark', 'history', 'workspace', 'note', 'app', 'folder', 'file', 'todo'].includes(item.type) ? item.type : 'link'}`}
            title={(item.type === 'folder' || item.type === 'file') ? item.path : undefined}
            onClick={handleClick}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={handleMouseEnter}
        >
            {/* Tree indentation guides (one vertical line per ancestor level) */}
            {depth > 0 && Array.from({ length: depth }).map((_, d) => (
                <span key={d} className="tree-indent" />
            ))}
            {/* Expand/collapse chevron for folders in the tree */}
            {isFolderRow ? (
                <button
                    className={`tree-chevron ${isExpanded ? 'expanded' : ''}`}
                    onClick={handleToggle}
                    title={isExpanded ? 'Collapse' : 'Expand'}
                >▸</button>
            ) : (depth > 0 && <span className="tree-chevron-spacer" />)}
            <div
                className="result-icon"
                style={fileMeta?.color ? { color: fileMeta.color, background: `${fileMeta.color}1f` } : undefined}
            >
                {item.type === 'app' ? (
                    (item.icon && item.icon.length > 50 && !iconError) ? (
                        <img src={item.icon} className="app-icon-img" alt="" onError={() => setIconError(true)} />
                    ) : (
                        <FontAwesomeIcon icon={getAppIcon(item.name)} className="app-icon" />
                    )
                ) : item.type === 'file' && fileMeta ? (
                    fileMeta.kind === 'si'
                        ? <fileMeta.Icon className="file-glyph" />
                        : <FontAwesomeIcon icon={fileMeta.Icon} />
                ) : (() => {
                    const resolvedFavicon = item.favicon || (item.url ? getFaviconUrl(item.url, 32, null, true) : null);
                    return resolvedFavicon && !iconError ? (
                        <img src={resolvedFavicon} onError={() => setIconError(true)} alt="" />
                    ) : (
                        <div className="fa-icon-wrapper">
                            <FontAwesomeIcon icon={getIcon(item.type, item.title || item.name)} />
                        </div>
                    );
                })()}
            </div>
            <div className="result-content">
                <span className="result-title">{item.title || item.name}</span>
                <span className="result-desc">
                    {item.type === 'app'
                        ? (item.isRunning ? 'Running' : (item.path?.split(/[/\\]/).pop()?.replace(/\.app$/i, '') || 'Application'))
                        : (item.description || formatUrl(item.url))}
                </span>
            </div>

            {isSelected ? (
                <div className="result-hint">
                    <span>{item.type === 'app' ? (item.isRunning ? 'Focus' : 'Launch') : 'Open'}</span>
                    <span className="shortcut-key">↵</span>
                </div>
            ) : (
                <span className={`result-badge ${item.type === 'app' && item.isRunning ? 'badge-running' : ''}`}>
                    {getBadgeLabel(item)}
                </span>
            )}

            {onRemove ? (
                <span className="pin-btn" title="Remove" onClick={handleRemoveClick}>
                    <FontAwesomeIcon icon={faTimes} />
                </span>
            ) : (
                <span
                    className="pin-btn"
                    title="Pin this"
                    onClick={handlePinClick}
                    style={(item.url || item.type === 'app') ? undefined : { visibility: 'hidden', pointerEvents: 'none' }}
                >
                    <FontAwesomeIcon icon={faThumbtack} />
                </span>
            )}
        </div>
    );
});

// The "+N more results" row — a real navigable row (see hasMoreResultsRow in
// handleKeyDown) so it's reachable the same way as any other result, not just
// by clicking. Shares ResultItem's pointer-move guard and keyboard-driven
// scrollIntoView so it behaves identically under mouse/keyboard nav.
const MoreResultsRow = memo(function MoreResultsRow({ isSelected, count, onSelect, onHover }) {
    const rowRef = useRef(null);
    const hoverSelectedRef = useRef(false);
    const handleMouseEnter = useCallback((e) => {
        if (!isRealPointerMove(lastPointerPos, e)) return;
        hoverSelectedRef.current = true;
        onHover();
    }, [onHover]);

    useEffect(() => {
        if (isSelected && rowRef.current && !hoverSelectedRef.current) {
            rowRef.current.scrollIntoView({ block: 'nearest' });
        }
        hoverSelectedRef.current = false;
    }, [isSelected]);

    return (
        <div
            ref={rowRef}
            className={`spotlight-more-results${isSelected ? ' selected' : ''}`}
            onClick={onSelect}
            onMouseEnter={handleMouseEnter}
        >
            +{count} more results (refine your search)
        </div>
    );
});
