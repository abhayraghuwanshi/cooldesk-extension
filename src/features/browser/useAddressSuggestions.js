import { useEffect, useRef, useState } from 'react';
import { browseUrls, quickSearch, refreshElectronCache } from '../../services/searchService';
import { getFaviconUrl } from '../../utils/helpers.js';
import { hostOf, invoke, normalizeAddress } from './useNativePane';

// Suggestions for the Browse address bar and the Canvas "add" bar — the same
// sources as the spotlight's scoped searches: "/u" (open tabs, history,
// bookmarks, links saved in workspaces — ranked by searchService, learned
// click boosts included) and "/f" (search_files over the home folder; recent
// folders while empty). The prefixes work here too: "/u gmail", "/f invoice".
//
// The first item always does exactly what was typed (go to it, or search
// it), so Enter never opens a fuzzy match the user didn't pick.

const URL_TYPES = new Set(['tab', 'history', 'bookmark', 'workspace-url']);
const DEBOUNCE_MS = 120;
const MAX_LINKS = 7;
const MAX_FILES = 5;

const LINK_LABEL = { tab: 'Open tab', history: 'History', bookmark: 'Bookmark', 'workspace-url': 'Saved link' };

function parseScope(query) {
  const m = /^\/([uf])(?:\s+|$)(.*)$/i.exec(query);
  return m ? { scope: m[1].toLowerCase(), term: m[2].trim() } : { scope: null, term: query.trim() };
}

function baseName(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function toLink(r) {
  return {
    kind: 'link',
    id: `link:${r.url}`,
    url: r.url,
    title: r.title || hostOf(r.url),
    sub: `${LINK_LABEL[r.type] || 'Link'} · ${hostOf(r.url)}`,
    icon: getFaviconUrl(r.url, 32, r.favicon),
  };
}

function toFile(f) {
  const path = f.path;
  const isDir = f.is_dir ?? f.isDir ?? false;
  return { kind: isDir ? 'folder' : 'file', id: `file:${path}`, path, isDir, title: f.name || baseName(path), sub: path };
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

/**
 * @param query      text in the bar
 * @param enabled    only search while the bar is being edited
 * @param withFiles  include files/folders (Browse) or links only (Canvas)
 * @returns {{ items: object[], scope: 'u'|'f'|null }}
 */
export function useAddressSuggestions(query, { enabled, withFiles = true }) {
  const [state, setState] = useState({ items: [], scope: null });
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    const { scope, term } = parseScope(query || '');
    const wantLinks = scope !== 'f';
    const wantFiles = withFiles && scope !== 'u';

    const timer = setTimeout(async () => {
      const typed = [];
      if (term && scope !== 'f') {
        const url = normalizeAddress(term);
        const isSearch = url && /google\.com\/search\?/.test(url) && !/^https?:\/\//i.test(term);
        if (url) {
          typed.push({
            kind: isSearch ? 'search' : 'go',
            id: 'typed',
            url,
            title: isSearch ? `Search Google for “${term}”` : `Go to ${term}`,
            sub: isSearch ? 'google.com' : hostOf(url),
          });
        }
      }

      const [links, files] = await Promise.all([
        !wantLinks ? [] : term
          ? quickSearch(term, 20).then(rs => rs.filter(r => URL_TYPES.has(r.type) && r.url)).catch(() => [])
          : recentLinks(),
        !wantFiles ? [] : term.length >= 2 ? searchFiles(term) : (!term && scope === 'f' ? recentFolders() : []),
      ]);
      if (id !== seq.current) return;

      const seen = new Set(typed.map(t => t.url));
      const linkItems = [];
      for (const r of links) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        linkItems.push(toLink(r));
        if (linkItems.length >= MAX_LINKS) break;
      }
      setState({ items: [...typed, ...linkItems, ...files], scope });
    }, term ? DEBOUNCE_MS : 0);

    return () => clearTimeout(timer);
  }, [query, enabled, withFiles]);

  return enabled ? state : { items: [], scope: null };
}
