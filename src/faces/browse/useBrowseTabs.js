import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { recordRecentFile, recordRecentShell } from '../../features/browser/recentHistory';

// Tabs for Browse mode. A tab is a web page (its own native page, BrowserPane
// with paneId `bt-<id>`), a file / folder from disk (`file: { path, isDir }`,
// previewed in the main area), a terminal (`term: { cwd }`, a shell that
// runs as long as the tab is open — never put to sleep) or a workspace note
// (`note: { id, workspaceId, workspaceName }`, its TipTap editor — NoteTab). Web tabs stay loaded while you switch away —
// up to MAX_LIVE of them; older ones "sleep" (their page is closed) and
// reload when you come back, since every live page is a WebKit process of
// 100–300 MB. The pane guard (usePaneGuard) also puts tabs to sleep early —
// idle, burning CPU in the background, or over the memory budget — via
// `sleep`.

const TABS_KEY = 'cooldesk.browse.tabs';
const MAX_LIVE = 6;
const MAX_TABS = 40;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

// "/a/b/../c" → "/a/c" (project links can be relative), so the tab's title,
// breadcrumb and duplicate check all see the real folder.
function normalizePath(p) {
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
  const out = [];
  for (const part of p.split(/[/\\]/)) {
    if (part === '..') { if (out.length > 1) out.pop(); }
    else if (part !== '.') out.push(part);
  }
  return out.join(sep) || p;
}

// Per-tab Back / Forward entries: what the tab showed — a page or a file —
// before the current thing. Saved with the tabs, so a restart (an app
// update, a dev rebuild) doesn't strand you on a file with no way back.
const HISTORY = 30;
const entryOf = (t) => ({ url: t.url || null, file: t.file || null, title: t.title || '' });
// Show `entry` in tab `t`; a page reloads (its pane closed while the file
// was up).
const restore = (t, entry) => ({
  url: entry.url,
  file: entry.file,
  title: entry.title,
  req: entry.url ? { url: entry.url, key: t.req.key + 1 } : t.req,
});
// Navigate tab `t` to `entry`, remembering where it was.
const goTo = (t, entry) => ({
  ...t,
  ...restore(t, entry),
  back: [...(t.back || []), entryOf(t)].slice(-HISTORY),
  fwd: [],
});

// Saved entries, checked the way the tabs themselves are.
function cleanEntries(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(e => e && (isWebUrl(e.url) || typeof e.file?.path === 'string' || (!e.url && !e.file)))
    .map(e => ({
      url: isWebUrl(e.url) ? e.url : null,
      file: typeof e.file?.path === 'string' ? { path: e.file.path, isDir: !!e.file.isDir } : null,
      title: typeof e.title === 'string' ? e.title : '',
    }))
    .slice(-HISTORY);
}

function load(fallbackUrl) {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) || 'null');
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
      const tabs = saved.tabs
        .filter(t => t && typeof t.id === 'string')
        .map(t => ({
          id: t.id,
          url: isWebUrl(t.url) ? t.url : null,
          title: t.title || '',
          req: { url: isWebUrl(t.url) ? t.url : null, key: 0 },
          file: t.file && typeof t.file.path === 'string' ? { path: t.file.path, isDir: !!t.file.isDir } : null,
          term: t.term ? { cwd: typeof t.term.cwd === 'string' ? t.term.cwd : null } : null,
          note: t.note && typeof t.note.id === 'string' && t.note.workspaceId
            ? { id: t.note.id, workspaceId: t.note.workspaceId, workspaceName: t.note.workspaceName || '' }
            : null,
          back: cleanEntries(t.back),
          fwd: cleanEntries(t.fwd),
        }));
      if (tabs.length) return { tabs, activeId: tabs.some(t => t.id === saved.activeId) ? saved.activeId : tabs[0].id };
    }
  } catch { /* fall through */ }
  const id = newId();
  const url = isWebUrl(fallbackUrl) ? fallbackUrl : null;
  return { tabs: [{ id, url, title: '', req: { url, key: 0 } }], activeId: id };
}

export const tabPaneId = (id) => `bt-${id}`;

/** @param initialUrl the single page Browse showed before tabs existed */
export function useBrowseTabs(initialUrl) {
  const [state, setState] = useState(() => load(initialUrl));
  const { tabs, activeId } = state;
  // Most-recently-used order; the first MAX_LIVE stay loaded.
  const mru = useRef([activeId]);
  // Put to sleep by the pane guard (until next activated), and when each tab
  // was last left — the active tab is in use, so it has no entry.
  const asleep = useRef(new Set());
  const [sleepTick, setSleepTick] = useState(0);
  const leftAt = useRef(new Map());
  useEffect(() => () => { leftAt.current.set(activeId, Date.now()); }, [activeId]);

  // Persist (urls + titles only; requests are per-session).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(TABS_KEY, JSON.stringify({
          activeId,
          // A terminal's start command isn't saved: after a restart the tab
          // is a plain shell, so a dev server doesn't start on its own.
          tabs: tabs.map(({ id, url, title, file, term, note, back, fwd }) => ({ id, url, title, file, term: term ? { cwd: term.cwd } : term, note, back, fwd })),
        }));
      } catch { /* keep in memory */ }
    }, 300);
    return () => clearTimeout(t);
  }, [tabs, activeId]);

  const touch = (id) => {
    mru.current = [id, ...mru.current.filter(x => x !== id)];
    asleep.current.delete(id);
  };

  const activate = useCallback((id) => {
    touch(id);
    setState(s => (s.tabs.some(t => t.id === id) ? { ...s, activeId: id } : s));
  }, []);

  /** Load `url` in the active tab. */
  const openInActive = useCallback((url) => {
    if (!isWebUrl(url)) return;
    setState(s => ({
      ...s,
      tabs: s.tabs.map(t => {
        if (t.id !== s.activeId) return t;
        // Leaving a file for a page: the file goes on Back (page-to-page
        // history is the page's own).
        const next = { ...t, url, file: null, term: null, note: null, req: { url, key: t.req.key + 1 } };
        return t.file ? { ...next, back: [...(t.back || []), entryOf(t)].slice(-HISTORY), fwd: [] } : next;
      }),
    }));
  }, []);

  /**
   * New tab (blank when `url` is null). `position`: 'end' (links picked from
   * the list, ⌘T) or 'after' the active tab (pop-ups from a page, as browsers
   * do).
   */
  const openInNew = useCallback((url = null, { activate: focus = true, position = 'end' } = {}) => {
    const id = newId();
    const page = isWebUrl(url) ? url : null;
    setState(s => {
      if (s.tabs.length >= MAX_TABS) return s;
      const at = position === 'after' ? s.tabs.findIndex(t => t.id === s.activeId) + 1 : s.tabs.length;
      const tab = { id, url: page, title: '', req: { url: page, key: 0 } };
      const next = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)];
      return { tabs: next, activeId: focus ? id : s.activeId };
    });
    if (focus) touch(id);
    return id;
  }, []);

  const close = useCallback((id) => {
    mru.current = mru.current.filter(x => x !== id);
    setState(s => {
      const i = s.tabs.findIndex(t => t.id === id);
      if (i === -1) return s;
      const rest = s.tabs.filter(t => t.id !== id);
      if (!rest.length) {
        const fresh = { id: newId(), url: null, title: '', req: { url: null, key: 0 } };
        mru.current = [fresh.id];
        return { tabs: [fresh], activeId: fresh.id };
      }
      if (s.activeId !== id) return { ...s, tabs: rest };
      // Closing the active tab: go to the last-used one still open, else a neighbour.
      const nextId = mru.current.find(x => rest.some(t => t.id === x)) || (rest[i] || rest[i - 1]).id;
      touch(nextId);
      return { tabs: rest, activeId: nextId };
    });
  }, []);

  const cycle = useCallback((step) => {
    setState(s => {
      const i = s.tabs.findIndex(t => t.id === s.activeId);
      const next = s.tabs[(i + step + s.tabs.length) % s.tabs.length];
      touch(next.id);
      return { ...s, activeId: next.id };
    });
  }, []);

  /** In-page navigation / title updates reported by a tab's pane. */
  const noteUrl = useCallback((id, url) => {
    setState(s => ({ ...s, tabs: s.tabs.map(t => (t.id === id && t.url !== url ? { ...t, url } : t)) }));
  }, []);
  const noteTitle = useCallback((id, title) => {
    setState(s => ({ ...s, tabs: s.tabs.map(t => (t.id === id && t.title !== title ? { ...t, title } : t)) }));
  }, []);

  const move = useCallback((id, toIndex) => {
    setState(s => {
      const from = s.tabs.findIndex(t => t.id === id);
      if (from === -1) return s;
      const next = [...s.tabs];
      const [tab] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, tab);
      return { ...s, tabs: next };
    });
  }, []);

  if (!mru.current.includes(activeId)) touch(activeId);
  // Only web tabs count toward MAX_LIVE (file tabs have no web process).
  const live = useMemo(
    () => new Set([activeId, ...mru.current.filter(id => !asleep.current.has(id) && tabs.some(t => t.id === id && !t.file && !t.term && !t.note))].slice(0, MAX_LIVE)),
    // mru / asleep are refs; recompute when the active tab, the tab set or
    // the sleepers change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, tabs, sleepTick],
  );

  // A tab that fell asleep reloads its request when it wakes — point that at
  // the page it was last on, not the one it was first opened at.
  const prevLive = useRef(live);
  useEffect(() => {
    const gone = [...prevLive.current].filter(id => !live.has(id));
    prevLive.current = live;
    if (!gone.length) return;
    setState(s => ({
      ...s,
      tabs: s.tabs.map(t => (gone.includes(t.id) && t.url && t.url !== t.req.url
        ? { ...t, req: { url: t.url, key: t.req.key + 1 } }
        : t)),
    }));
  }, [live]);

  /** Close the pages of these background tabs; they reload when opened. */
  const sleep = useCallback((ids) => {
    const fresh = ids.filter(id => id !== activeId && !asleep.current.has(id));
    if (!fresh.length) return;
    fresh.forEach(id => asleep.current.add(id));
    setSleepTick(n => n + 1);
  }, [activeId]);

  /** ms since tab `id` was last the active tab (0 for the active one). */
  const idleFor = useCallback((id) => {
    if (id === activeId) return 0;
    const at = leftAt.current.get(id);
    return at ? Date.now() - at : 0;
  }, [activeId]);

  /** Tab already showing `url` (its current page or what was asked for). */
  const findByUrl = useCallback((url) => tabs.find(t => t.url === url || t.req.url === url) || null, [tabs]);

  /** A file or folder (switches to its tab if it's already open).
   *  inPlace: show it in the current tab, as following a link would — the
   *  page or file it replaces goes on the tab's Back list. A terminal or note
   *  tab is never replaced (its shell would end; a note has no Back entry),
   *  so then it gets a new tab. */
  const openFileTab = useCallback((rawPath, isDir = false, inPlace = false) => {
    if (!rawPath) return;
    const path = normalizePath(rawPath);
    recordRecentFile(path, isDir);
    const existing = tabs.find(t => t.file?.path === path);
    if (existing) {
      touch(existing.id);
      setState(s => ({ ...s, activeId: existing.id }));
      return;
    }
    const title = path.split(/[/\\]/).filter(Boolean).pop() || path;
    const here = tabs.find(t => t.id === activeId);
    if (inPlace && here && !here.term && !here.note) {
      touch(here.id);
      setState(s => ({ ...s, tabs: s.tabs.map(t => (t.id === here.id ? goTo(t, { url: null, file: { path, isDir }, title }) : t)) }));
      return;
    }
    const id = newId();
    touch(id);
    setState(s => (s.tabs.length >= MAX_TABS ? s : {
      tabs: [...s.tabs, { id, url: null, title, req: { url: null, key: 0 }, file: { path, isDir } }],
      activeId: id,
    }));
  }, [tabs, activeId]);

  /** A terminal in `cwd` (home when empty), as a new tab — or in place of
   *  the blank Home tab it was opened from. `run`: a command it starts with
   *  (a project's dev server, build…); running the same one again switches
   *  to its tab instead of starting a second copy. */
  const openTerminalTab = useCallback((rawCwd = null, inPlace = false, { run = null, title: name = null, fresh = false } = {}) => {
    const cwd = rawCwd ? normalizePath(rawCwd) : null;
    // Plain shells only: a project command (run) is that project's, not a
    // place you went.
    if (!run) recordRecentShell(cwd);
    if (run && !fresh) {
      const same = tabs.find(t => t.term?.run === run && t.term?.cwd === cwd);
      if (same) {
        touch(same.id);
        setState(s => ({ ...s, activeId: same.id }));
        return;
      }
    }
    const title = name || (cwd ? cwd.split(/[/\\]/).filter(Boolean).pop() || cwd : 'Shell');
    const here = tabs.find(t => t.id === activeId);
    if (inPlace && here && !here.url && !here.file && !here.term && !here.note) {
      touch(here.id);
      setState(s => ({ ...s, tabs: s.tabs.map(t => (t.id === here.id ? { ...t, title, term: { cwd, run } } : t)) }));
      return;
    }
    const id = newId();
    touch(id);
    setState(s => (s.tabs.length >= MAX_TABS ? s : {
      tabs: [...s.tabs, { id, url: null, title, req: { url: null, key: 0 }, term: { cwd, run } }],
      activeId: id,
    }));
  }, [tabs, activeId]);

  /** A workspace note in the main view, like a file: switches to its tab if
   *  it's open, else takes the blank tab it was opened from or a new one.
   *  `note`: { id, workspaceId, workspaceName, title } — a new note just has
   *  a fresh id (NoteTab saves it once it has content). */
  const openNoteTab = useCallback((note) => {
    if (!note?.id || !note.workspaceId) return;
    const existing = tabs.find(t => t.note?.id === note.id);
    if (existing) {
      touch(existing.id);
      setState(s => ({ ...s, activeId: existing.id }));
      return;
    }
    const meta = { id: note.id, workspaceId: note.workspaceId, workspaceName: note.workspaceName || '' };
    const title = note.title || 'New note';
    const here = tabs.find(t => t.id === activeId);
    if (here && !here.url && !here.file && !here.term && !here.note) {
      touch(here.id);
      setState(s => ({ ...s, tabs: s.tabs.map(t => (t.id === here.id ? { ...t, title, note: meta } : t)) }));
      return;
    }
    const id = newId();
    touch(id);
    setState(s => (s.tabs.length >= MAX_TABS ? s : {
      tabs: [...s.tabs, { id, url: null, title, req: { url: null, key: 0 }, note: meta }],
      activeId: id,
    }));
  }, [tabs, activeId]);

  /** Back / Forward across what the tab showed (files, and the page before
   *  a file). Returns false when there's nothing to go to. */
  const step = useCallback((dir) => {
    const here = tabs.find(t => t.id === activeId);
    const from = dir < 0 ? 'back' : 'fwd';
    const to = dir < 0 ? 'fwd' : 'back';
    if (!here?.[from]?.length) return false;
    setState(s => ({
      ...s,
      tabs: s.tabs.map(t => {
        if (t.id !== s.activeId || !t[from]?.length) return t;
        const entry = t[from][t[from].length - 1];
        return {
          ...t,
          ...restore(t, entry),
          [from]: t[from].slice(0, -1),
          [to]: [...(t[to] || []), entryOf(t)].slice(-HISTORY),
        };
      }),
    }));
    return true;
  }, [tabs, activeId]);

  const active = tabs.find(t => t.id === activeId) || tabs[0];
  return { tabs, active, activeId: active.id, live, sleep, idleFor, activate, openInActive, openInNew, openFileTab, openTerminalTab, openNoteTab, step, close, cycle, noteUrl, noteTitle, move, findByUrl };
}
