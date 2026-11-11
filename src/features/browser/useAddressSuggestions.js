import { useEffect, useRef, useState } from 'react';
import { browseUrls, quickSearch, refreshElectronCache } from '../../services/searchService';
import { getFaviconUrl } from '../../utils/helpers.js';
import { hostOf, invoke, normalizeAddress } from './useNativePane';
import { engineFor, fetchWebSuggestions, getEngineKey, getWebSuggestEnabled, searchUrl } from '../../shared/searchEngines';
import { recentFiles, recentShells } from './recentHistory';

// Suggestions for the Browse address bar and the Canvas "add" bar — the same
// sources as the spotlight's scoped searches: "/u" (open tabs, history,
// bookmarks, links saved in workspaces — ranked by searchService, learned
// click boosts included) and "/f" (search_files over the home folder; recent
// folders while empty). The prefixes work here too: "/u gmail", "/f invoice".
//
// While empty it also lists what Browse opened lately besides pages — files
// and folders shown as tabs, and shells (recentHistory.js).
//
// The first item always does exactly what was typed (go to it, or search
// it), so Enter never opens a fuzzy match the user didn't pick.

const URL_TYPES = new Set(['tab', 'history', 'bookmark', 'workspace-url']);
const DEBOUNCE_MS = 120;
const MAX_LINKS = 7;
const MAX_FILES = 5;
const MAX_SHELLS = 3;

const LINK_LABEL = { tab: 'Open tab', history: 'History', bookmark: 'Bookmark', 'workspace-url': 'Saved link' };

// Search suggestions shown under the typed query.
const MAX_SUGGESTIONS = 4;

function parseScope(query) {
  const m = /^\/([uf])(?:\s+|$)(.*)$/i.exec(query);
  return m ? { scope: m[1].toLowerCase(), term: m[2].trim() } : { scope: null, term: query.trim() };
}

function baseName(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

// A path as a second line: the home folder as ~, and long ones cut to the
// first and last two folders (`~/…/pricing/new`) — the full path is the
// row's tooltip.
export function shortPath(p) {
  if (!p) return '~';
  const home = p.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[\\/])/, '~');
  const sep = home.includes('\\') && !home.includes('/') ? '\\' : '/';
  const parts = home.split(/[\\/]/);
  return parts.length > 5 ? [parts[0], '…', ...parts.slice(-2)].join(sep) : home;
}

function parentDir(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}

function toLink(r) {
  return {
    kind: 'link',
    id: `link:${r.url}`,
    url: r.url,
    title: r.title || hostOf(r.url),
    sub: hostOf(r.url),
    badge: LINK_LABEL[r.type] || null,
    icon: getFaviconUrl(r.url, 32, r.favicon),
  };
}

function toFile(f) {
  const path = f.path;
  const isDir = f.is_dir ?? f.isDir ?? false;
  return { kind: isDir ? 'folder' : 'file', id: `file:${path}`, path, isDir, title: f.name || baseName(path), sub: shortPath(parentDir(path)) };
}

// Empty bar: recent tabs/history/bookmarks. The cache behind browseUrls is
// filled asynchronously (the spotlight pre-warms it on mount); if it's still
// empty, refresh once and retry, as the spotlight's bare "/u" does.
async function recentLinks() {
  let links = browseUrls(MAX_LINKS);
  if (links.length === 0) {
    await refreshElectronCache(true).catch(() => { });
    links = browseUrls(MAX_LINKS);
  }
  return links;
}

async function searchFiles(term) {
  try {
    const hits = await invoke('search_files', { query: term });
    return Array.isArray(hits) ? hits.slice(0, MAX_FILES).map(toFile) : [];
  } catch {
    return [];
  }
}

async function recentFolders() {
  try {
    const folders = await invoke('get_frequent_folders');
    return Array.isArray(folders) ? folders.slice(0, MAX_FILES).map(f => toFile({ ...f, is_dir: true })) : [];
  } catch {
    return [];
  }
}

// Files and folders opened as Browse tabs, newest first.
const recentFileItems = () => recentFiles(MAX_FILES).map(f => ({ ...toFile(f), recent: true }));

// "/f" with nothing typed: what you opened here first, then the OS's
// frequently used folders.
async function recentPlaces() {
  const mine = recentFileItems();
  const seen = new Set(mine.map(f => f.path));
  const os = (await recentFolders()).filter(f => !seen.has(f.path));
  return [...mine, ...os].slice(0, MAX_FILES + 3);
}

function shellItems() {
  return recentShells(MAX_SHELLS).map(s => ({
    kind: 'shell',
    id: `shell:${s.cwd || '~'}`,
    cwd: s.cwd || null,
    title: s.cwd ? baseName(s.cwd) : 'Home',
    sub: shortPath(s.cwd),
  }));
}

/**
 * @param query       text in the bar
 * @param enabled     only search while the bar is being edited
 * @param withFiles   include files/folders (Browse) or links only (Canvas)
 * @param withShells  list recent shells while empty (the host can open them)
 * @returns {{ items: object[], scope: 'u'|'f'|null }}
 */
export function useAddressSuggestions(query, { enabled, withFiles = true, withShells = false }) {
  const [state, setState] = useState({ items: [], scope: null });
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    const { scope, term } = parseScope(query || '');
    const wantLinks = scope !== 'f';
    const wantFiles = withFiles && scope !== 'u';

    const timer = setTimeout(async () => {
      const engineKey = getEngineKey();
      const engine = engineFor(engineKey);
      const typed = [];
      let isSearch = false;
      if (term && scope !== 'f') {
        const url = normalizeAddress(term);
        isSearch = url === searchUrl(engineKey, term);
        if (url) {
          typed.push({
            kind: isSearch ? 'search' : 'go',
            id: 'typed',
            url,
            title: isSearch ? `Search ${engine.label === 'Default' ? 'the web' : engine.label} for “${term}”` : `Go to ${term}`,
            sub: hostOf(url),
          });
        }
      }

      // Search suggestions from the engine, like a browser's address bar —
      // only for something that reads as a search, and only while turned on
      // (Settings → General → Search suggestions: what you type goes to the
      // engine). Fetched alongside the local lists and added when they land,
      // so tabs, history and files never wait on the network.
      const suggestP = isSearch && term.length >= 2 && getWebSuggestEnabled()
        ? fetchWebSuggestions(engineKey, term, { max: MAX_SUGGESTIONS }).catch(() => [])
        : null;

      const [links, files] = await Promise.all([
        !wantLinks ? [] : term
          ? quickSearch(term, 20).then(rs => rs.filter(r => URL_TYPES.has(r.type) && r.url)).catch(() => [])
          : recentLinks(),
        !wantFiles ? [] : term.length >= 2 ? searchFiles(term)
          : !term ? (scope === 'f' ? recentPlaces() : recentFileItems())
            : [],
      ]);
      const shells = withShells && !term && !scope ? shellItems() : [];
      if (id !== seq.current) return;

      const seen = new Set(typed.map(t => t.url));
      const linkItems = [];
      for (const r of links) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        linkItems.push(toLink(r));
        if (linkItems.length >= MAX_LINKS) break;
      }
      setState({ items: [...typed, ...linkItems, ...files, ...shells], scope });

      suggestP?.then(list => {
        if (id !== seq.current || !list.length) return;
        const suggestions = list.map(text => ({
          kind: 'search',
          id: `suggest:${text}`,
          url: searchUrl(engineKey, text),
          title: text,
          sub: null,
          suggestion: true,
          term,
        }));
        setState(st => ({ ...st, items: [...typed, ...suggestions, ...st.items.slice(typed.length)] }));
      });
    }, term ? DEBOUNCE_MS : 0);

    return () => clearTimeout(timer);
  }, [query, enabled, withFiles, withShells]);

  return enabled ? state : { items: [], scope: null };
}
