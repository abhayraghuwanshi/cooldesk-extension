import { useEffect, useState } from 'react';
import { SIDECAR_HTTP } from '../config/sidecar.js';

// Folder tiles on the workspace cards: what a folder is (stack logo), its git
// branch / dirty state, and whether a dev server is running from it right now.
// Desktop-only; everything degrades to "nothing known" in the extension.

const isTauri = () => typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

// ── Stack → logo ─────────────────────────────────────────────────────────────
// devicon artwork (same CDN the design mock used); a tile whose logo fails to
// load (offline) falls back to the folder glyph. Logos that are black in their
// "original" variant are inverted so they show on the dark plate.
const DEVICON = (name) => `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${name}/${name}-original.svg`;
const DARK_LOGOS = new Set(['rust', 'markdown', 'nextjs', 'bun']);

export function stackLogo(stack) {
  if (!stack) return null;
  return { src: DEVICON(stack), invert: DARK_LOGOS.has(stack) };
}

// Single files: stack from the extension (no backend call needed).
const EXT_STACK = {
  md: 'markdown', mdx: 'markdown', ts: 'typescript', tsx: 'react', js: 'javascript', jsx: 'react',
  rs: 'rust', py: 'python', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby',
  php: 'php', html: 'html5', css: 'css3', dart: 'dart', c: 'c', cpp: 'cplusplus', vue: 'vuejs',
  svelte: 'svelte', dockerfile: 'docker',
};
export function fileStack(path) {
  const base = String(path || '').split(/[\\/]/).pop().toLowerCase();
  if (base === 'dockerfile') return 'docker';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return EXT_STACK[ext] || null;
}

// ── Folder identity (stack / branch / dirty) ─────────────────────────────────
// One backend call per folder, cached for the session and refreshed after
// IDENTITY_TTL so a branch switch or a commit shows up without a reload.
const IDENTITY_TTL = 60_000;
const identityCache = new Map(); // path → { value, at, pending }
const identityListeners = new Set();

function loadIdentity(path) {
  const hit = identityCache.get(path);
  if (hit && (hit.pending || Date.now() - hit.at < IDENTITY_TTL)) return;
  identityCache.set(path, { value: hit?.value ?? null, at: hit?.at ?? 0, pending: true });
  import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('folder_identity', { path }))
    .catch(() => null)
    .then((value) => {
      identityCache.set(path, { value, at: Date.now(), pending: false });
      identityListeners.forEach((fn) => fn());
    });
}

// ── Live dev servers ─────────────────────────────────────────────────────────
// One poller for every card, running only while something is subscribed —
// same sidecar endpoint the Local Servers panel reads.
const SERVERS_POLL_MS = 6000;
let servers = [];
let serversTimer = null;
const serverListeners = new Set();

async function pollServers() {
  try {
    const res = await fetch(`${SIDECAR_HTTP}/local/servers`, { signal: AbortSignal.timeout(2500) });
    const body = res.ok ? await res.json() : null;
    servers = Array.isArray(body?.servers) ? body.servers : [];
  } catch {
    servers = [];
  }
  serverListeners.forEach((fn) => fn());
}

function subscribeServers(fn) {
  serverListeners.add(fn);
  if (!serversTimer) {
    pollServers();
    serversTimer = setInterval(pollServers, SERVERS_POLL_MS);
  }
  return () => {
    serverListeners.delete(fn);
    if (serverListeners.size === 0 && serversTimer) {
      clearInterval(serversTimer);
      serversTimer = null;
    }
  };
}

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Dev servers whose working directory is this folder or inside it. */
function serversIn(folder) {
  const f = norm(folder);
  if (!f) return [];
  return servers
    .filter((s) => {
      const cwd = norm(s.cwd || s.projectRoot);
      return cwd === f || cwd.startsWith(`${f}/`);
    })
    .sort((a, b) => a.port - b.port);
}

/**
 * Identity + live servers for a set of folder paths. Returns a lookup:
 * `get(path) → { stack, branch, dirty, ports: number[] }` (fields null/empty
 * while unknown). Re-renders the caller when either source updates.
 */
export function useFolderIdentity(paths) {
  const [, setTick] = useState(0);
  const key = paths.filter(Boolean).join('|');

  useEffect(() => {
    if (!isTauri() || !key) return undefined;
    const bump = () => setTick((t) => t + 1);
    identityListeners.add(bump);
    key.split('|').forEach(loadIdentity);
    const refresh = setInterval(() => key.split('|').forEach(loadIdentity), IDENTITY_TTL);
    const unsubServers = subscribeServers(bump);
    return () => {
      identityListeners.delete(bump);
      clearInterval(refresh);
      unsubServers();
    };
  }, [key]);

  return (path) => {
    const id = identityCache.get(path)?.value;
    return {
      stack: id?.stack ?? null,
      branch: id?.branch ?? null,
      dirty: !!id?.dirty,
      ports: serversIn(path).map((s) => s.port),
    };
  };
}
