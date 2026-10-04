import { useEffect, useMemo, useState } from 'react';
import { fetchCooldesk } from '../../services/cooldeskService.js';
import { isEditorApp } from '../../services/workspaceActivityService.js';
import { useCooldeskVersion } from './useCooldeskProjects.js';

/**
 * A workspace's project `.cooldesk/` items — links, linked projects, folders and
 * files — resolved into the same shapes as the workspace's own urls/apps, so any
 * surface (workspace card, dock bar) can render them next to those.
 *
 * Shared rather than per-component so the card and the dock can't drift apart
 * on what counts as a .cooldesk item or how its path resolves.
 */

// Resolve a .cooldesk resource path (relative to the project root) to an absolute path.
// Joins with the base path's own separator — always using '\' produced
// "/Users/me/proj\crates\common" on macOS/Linux, a path that doesn't exist.
export const joinProjectPath = (base, rel) => {
  if (!base || !rel || rel === '.') return base || rel;
  // Already absolute ("C:\x", "\\server\share", "/Users/x") — use as-is;
  // joining it onto the project root produced "C:\proj\C:\x".
  if (/^([a-z]:[\\/]|[\\/])/i.test(String(rel))) return String(rel);
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  const b = base.replace(/[\\/]+$/, '');
  const r = String(rel).replace(/^\.[\\/]/, '').replace(/[/\\]+/g, sep).replace(/^[\\/]+/, '');
  return `${b}${sep}${r}`;
};

// A resource "url" with no scheme (e.g. "spec.md", ".cooldesk/notes/x.md") is a
// project-relative file, not a web link — the scaffold AI sometimes files local
// docs as type "link". Handing those to the url opener made them dead clicks.
// Two+ chars before the colon: a single letter is a Windows drive ("C:\x"),
// not a scheme — otherwise local Windows paths were treated as web links.
export const hasUrlScheme = (u) => /^[a-z][a-z0-9+.-]+:/i.test(String(u || '').trim());

// Personal resources may store a local file as a `file:` url; everything below
// works on paths, so turn it into one ("file:///C:/x" → "C:/x").
function fileUrlToPath(u) {
  try {
    const p = decodeURIComponent(new URL(u).pathname);
    return /^\/[a-z]:\//i.test(p) ? p.slice(1) : p;
  } catch {
    return null;
  }
}

const normaliseLocal = (r) => (/^file:/i.test(r?.url || '') && !r.path
  ? { ...r, url: undefined, path: fileUrlToPath(r.url), type: r.type === 'folder' ? 'folder' : 'file' }
  : r);

/**
 * The folder a workspace calls its project root. A project folder may be a plain
 * 'folder' app or an editor app (the folder added as "open in <editor>"); both
 * name a root that can hold .cooldesk/. Prefer a plain folder.
 */
export function projectFolderOf(workspace) {
  const apps = workspace?.apps || [];
  const plain = apps.find(a => a.appType?.toLowerCase() === 'folder' && a.path);
  if (plain) return plain.path;
  const editorFolder = apps.find(a => isEditorApp(a) && a.path);
  return editorFolder?.path || null;
}

const EMPTY = Object.freeze({ cdLinks: [], cdFolders: [], cdFiles: [], cdProjects: [] });

/**
 * @param {object|null} workspace
 * @returns {{ projectFolderPath: string|null, cooldesk: object|null,
 *   cdLinks: Array, cdFolders: Array, cdFiles: Array, cdProjects: Array }}
 *   Items are deduped against the workspace's own urls/apps and carry `_cd: true`.
 */
export function useCooldeskItems(workspace) {
  const projectFolderPath = useMemo(() => projectFolderOf(workspace), [workspace]);

  const [cooldesk, setCooldesk] = useState(null);
  // Re-read when the plugin announces a write to this project's .cooldesk/.
  const cdVersion = useCooldeskVersion(projectFolderPath);
  useEffect(() => {
    if (!projectFolderPath) { setCooldesk(null); return; }
    let cancelled = false;
    fetchCooldesk(projectFolderPath)
      .then(d => { if (!cancelled) setCooldesk(d?.exists ? d : null); })
      .catch(() => { if (!cancelled) setCooldesk(null); });
    return () => { cancelled = true; };
  }, [projectFolderPath, cdVersion]);

  const items = useMemo(() => {
    if (!cooldesk) return EMPTY;
    const urls = workspace?.urls || [];
    const apps = workspace?.apps || [];
    const hubId = cooldesk.project?.id;
    // Personal (gitignored `.cooldesk/local/`) resources render next to the
    // shared ones, tagged `_local` so a surface can tell them apart.
    const localResources = (cooldesk.localResources || []).map(normaliseLocal);
    // Each linked member is walked alongside the hub, skipping the hub's own entry.
    const sources = [
      { resources: cooldesk.resources, base: projectFolderPath, project: cooldesk.project?.name },
      { resources: localResources, base: projectFolderPath, project: cooldesk.project?.name, local: true },
      ...(cooldesk.members || [])
        .filter(m => (m.project?.id || m.name) !== hubId)
        .map(m => ({ resources: m.resources, base: m.path, project: m.project?.name || m.name })),
    ];

    const normUrl = (u) => (u || '').replace(/\/+$/, '').toLowerCase();
    const existingUrls = new Set(urls.map(u => normUrl(u.url)));
    const cdLinks = [
      ...(cooldesk.resources || []).map(r => ({ r, local: false })),
      ...localResources.map(r => ({ r, local: true })),
    ]
      // Shared: any scheme, as before. Personal: web links only — its file:
      // urls were turned into paths above and render as files.
      .filter(({ r, local }) => r.url && (local ? /^https?:/i.test(r.url) : hasUrlScheme(r.url)))
      .filter(({ r }) => {
        const k = normUrl(r.url);
        if (existingUrls.has(k)) return false;
        existingUrls.add(k); // shared wins over a personal copy of the same link
        return true;
      })
      .map(({ r, local }) => ({ url: r.url, title: r.name || r.url, type: 'single', _cd: true, ...(local ? { _local: true } : {}) }));

    // Folder and file resources are relative to their own project's root, so
    // each source is joined against its own base path.
    const collect = (appType, pickRel) => {
      const seen = new Set(
        apps.filter(a => a.appType?.toLowerCase() === appType).map(a => a.path?.toLowerCase()).filter(Boolean)
      );
      const out = [];
      for (const src of sources) {
        if (!src.base) continue;
        for (const r of (src.resources || [])) {
          const rel = pickRel(r);
          if (!rel) continue;
          const path = joinProjectPath(src.base, rel);
          const key = path?.toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push({ name: r.name || rel, path, appType, _cd: true, project: src.project, ...(src.local ? { _local: true } : {}) });
        }
      }
      return out;
    };
    const cdFolders = collect('folder', r => (r.type === 'folder' ? r.path : null));
    // `type: "file"` resources, plus scheme-less "links" (see hasUrlScheme).
    const cdFiles = collect('file', r => {
      if (r.type === 'folder') return null;
      if (r.type === 'file') return r.path || r.url;
      return r.url && !hasUrlScheme(r.url) ? r.url : null;
    });

    const cdProjects = (cooldesk.members || [])
      .filter(m => (m.project?.id || m.name) !== hubId)
      .map(m => ({ name: m.project?.name || m.name, path: m.path, repo: m.repo, exists: m.exists, _cd: true }));

    return { cdLinks, cdFolders, cdFiles, cdProjects };
  }, [cooldesk, workspace, projectFolderPath]);

  return { projectFolderPath, cooldesk, ...items };
}
