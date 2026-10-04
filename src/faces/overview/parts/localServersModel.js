/**
 * Group local dev servers by *project*, not by port.
 *
 * The same app routinely lives on several ports — Vite walks 5173 → 5174 → …
 * when a port is taken, and AI agents (Claude Code etc.) start their own
 * copies in the background — and history keeps every port it ever ran on.
 * Keyed by `host:port`, that was one row per port, live and dead alike.
 *
 * With sidecar data (`/local/servers`: which process listens on each port,
 * its project folder, its launcher, the project's declared services) a port
 * belongs to the project whose folder runs it. A dead port from history is
 * attributed by page title (when a live port of that project used the same,
 * non-generic title) or by being declared in exactly one project's
 * `.cooldesk/services.json`. Without sidecar data, liveness comes from a
 * reachability probe and grouping falls back to page title.
 *
 * Pure — no React, no I/O — so it can be tested in isolation.
 */

// Scaffold defaults: two unrelated projects share these, so they never group.
const GENERIC_TITLES = new Set([
  '', 'react app', 'vite app', 'vite + react', 'vite + react + ts', 'vite + vue', 'vite + vue + ts',
  'vite + svelte', 'vite + svelte + ts', 'vite + preact', 'vite + lit', 'next.js', 'create next app',
  'svelte app', 'sveltekit app', 'vue app', 'angular app', 'astro', 'nuxt', 'remix', 'document',
  'localhost', 'index', 'home', 'untitled', 'loading...', 'loading…',
]);

// A restart storm lands within this; a return visit weeks later doesn't.
const SESSION_GAP_MS = 6 * 60 * 60 * 1000;

const LOOPBACK = (h) => h === 'localhost' || h.endsWith('.localhost') || h.startsWith('127.') ||
  h === '0.0.0.0' || h === '[::1]' || h === '::1';

// Another machine on the local network: mDNS names and RFC 1918 ranges.
const LAN = (h) => {
  if (h.endsWith('.local') || h.startsWith('10.') || h.startsWith('192.168.')) return true;
  const m = h.match(/^172\.(\d{1,3})\./);
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
};

/**
 * `{ host, port, loopback, label }` for a *local* http(s) url — this machine
 * or the local network — and null for everything else. Public sites must
 * never get here: a reddit.com tab would otherwise become a "dev server" on
 * :443.
 */
export function parseLocal(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    const loopback = LOOPBACK(host);
    if (!loopback && !LAN(host)) return null;
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    return { host, port, loopback, label: `${host}:${port}` };
  } catch {
    return null;
  }
}

export function titleKey(title, label) {
  const t = String(title || '').trim().toLowerCase();
  if (!t || GENERIC_TITLES.has(t) || isUrlish(t, label)) return null;
  return t;
}

// Chrome uses the URL as the title for pages without one ("localhost:8080/health").
function isUrlish(t, label) {
  const l = String(label || '').toLowerCase();
  return (l && t.startsWith(l)) || /^(https?:\/\/|localhost[:/]|127\.|\d+\.\d+\.\d+\.\d+)/.test(t);
}

const DEV_CMD = /\b(dev|start|serve|preview|watch|run)\b/i;
const NOT_DEV_CMD = /\b(build|test|lint|install|fmt|format|check|clippy|deploy|migrate|clean|release|publish|bundle)\b/i;

/** Commands that plausibly start a server, best match for `serviceLabel` first. */
export function startCommands(commands, serviceLabel) {
  const words = new Set(String(serviceLabel || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));
  return (commands || [])
    .filter(c => c?.run && DEV_CMD.test(`${c.id} ${c.label} ${c.run}`) && !NOT_DEV_CMD.test(`${c.id} ${c.label}`))
    .map(c => {
      const text = `${c.id} ${c.label} ${c.run}`.toLowerCase();
      let score = 0;
      for (const w of words) if (text.includes(w)) score++;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.c);
}

/**
 * @param {object} input
 * @param {Array} input.tabs      chrome tabs (url, title, id, lastAccessed, favIconUrl)
 * @param {Array} input.history   history items (url, title, lastVisitTime)
 * @param {{servers: Array, projects: Array}|null} input.data  sidecar /local/servers
 * @param {Map<number, boolean>} [input.probe]  port → reachable, when there's no sidecar data
 * @returns {Array<Group>} running projects first, then most recently used
 */
export function buildLocalGroups({ tabs = [], history = [], data = null, probe = new Map() }) {
  const groups = new Map();
  const projects = new Map((data?.projects || []).map(p => [p.root, p]));

  const ensure = (key, init) => {
    if (!groups.has(key)) {
      groups.set(key, {
        key, name: init.name, root: init.root || null,
        services: init.services || [], commands: init.commands || [],
        live: [], dead: [], titles: new Map(), lastActive: 0, // title key → latest ts
      });
    }
    return groups.get(key);
  };
  const projectGroup = (root) => {
    const p = projects.get(root) || { root, name: root.split(/[\\/]/).pop() };
    return ensure(`root:${root}`, p);
  };

  // ── live ports ───────────────────────────────────────────────────────────
  const liveByPort = new Map(); // port → { group, entry }
  if (data) {
    for (const s of data.servers || []) {
      if (liveByPort.has(s.port)) continue;
      const g = s.projectRoot ? projectGroup(s.projectRoot) : ensure(`port:${s.port}`, { name: s.process || `:${s.port}` });
      const entry = {
        port: s.port, url: null, tab: null, label: s.declaredLabel || null,
        yours: !!s.declaredLabel, launcher: s.launcher || null, pid: s.pid, ts: 0,
        startedAt: s.startedAt || 0,
      };
      g.live.push(entry);
      liveByPort.set(s.port, { group: g, entry });
    }
  }

  const deadCandidates = []; // { port, url, title, ts, tab, label }

  for (const t of tabs) {
    const loc = t?.url && parseLocal(t.url);
    if (!loc) continue;
    const ts = t.lastAccessed || Date.now();
    // An open tab on a live port shows whatever runs there *now*, so it
    // always belongs to the current process.
    if (loc.loopback && liveByPort.has(loc.port)) {
      const { group, entry } = liveByPort.get(loc.port);
      if (!entry.tab || ts > entry.ts) Object.assign(entry, { tab: t, url: t.url, ts });
      group.lastActive = Math.max(group.lastActive, ts);
      const k = titleKey(t.title, loc.label);
      if (k) addTitle(group, k, ts);
      continue;
    }
    const reachable = loc.loopback && !data ? probe.get(loc.port) : undefined;
    // Without sidecar data (or for another machine on the LAN, which lsof
    // can't see) an open tab counts as live unless a probe said otherwise.
    const live = loc.loopback ? (data ? false : reachable !== false) : true;
    if (live) {
      const k = titleKey(t.title, loc.label);
      const g = ensure(k ? `title:${k}` : `port:${loc.label}`, { name: t.title || loc.label });
      if (k) addTitle(g, k, ts);
      g.live.push({ port: loc.port, url: t.url, tab: t, label: null, yours: false, launcher: null, ts, host: loc.host });
      g.lastActive = Math.max(g.lastActive, ts);
    } else {
      deadCandidates.push({ port: loc.port, url: t.url, title: t.title, ts, tab: t, label: loc.label });
    }
  }

  for (const h of history) {
    const loc = h?.url && parseLocal(h.url);
    if (!loc) continue;
    const ts = h.lastVisitTime || 0;
    // History from before the current process started was a *previous*
    // occupant of the port (yesterday's ComputeMesh on what is CoolDesk's
    // :5173 today) — treat it as a dead entry of its own, not this app's.
    const current = loc.loopback && liveByPort.get(loc.port);
    if (current && (!current.entry.startedAt || ts >= current.entry.startedAt - 60_000)) {
      const { group, entry } = liveByPort.get(loc.port);
      if (!entry.tab && ts > entry.ts) Object.assign(entry, { url: h.url, ts });
      group.lastActive = Math.max(group.lastActive, ts);
      const k = titleKey(h.title, loc.label);
      if (k) addTitle(group, k, ts);
      continue;
    }
    const reachable = loc.loopback && !data ? probe.get(loc.port) : undefined;
    if (reachable === true) {
      const k = titleKey(h.title, loc.label);
      const g = ensure(k ? `title:${k}` : `port:${loc.label}`, { name: h.title || loc.label });
      const existing = g.live.find(e => e.port === loc.port);
      if (!existing) g.live.push({ port: loc.port, url: h.url, tab: null, label: null, yours: false, launcher: null, ts, host: loc.host });
      g.lastActive = Math.max(g.lastActive, ts);
      continue;
    }
    deadCandidates.push({ port: loc.port, url: h.url, title: h.title, ts, tab: null, label: loc.label });
  }

  // ── attribute dead ports (newest visit per port wins) ───────────────────
  const byLabel = new Map();
  for (const d of deadCandidates.sort((a, b) => b.ts - a.ts)) {
    const prev = byLabel.get(d.label);
    if (!prev) byLabel.set(d.label, { ...d, tabs: d.tab ? [d.tab] : [] });
    else if (d.tab) prev.tabs.push(d.tab);
  }

  // A title belongs to the group that showed it most recently — two projects
  // can both have used a title over time, and list order must not decide.
  const titleOwner = new Map(); // title key → { g, ts }
  for (const g of groups.values()) {
    for (const [k, ts] of g.titles) {
      const cur = titleOwner.get(k);
      if (!cur || ts > cur.ts) titleOwner.set(k, { g, ts });
    }
  }
  const declaredBy = (port) => [...projects.values()].filter(p => (p.services || []).some(s => Number(s.port) === port));

  const orphans = [];
  for (const d of byLabel.values()) {
    const k = titleKey(d.title, d.label);
    let g = k ? titleOwner.get(k)?.g : null;
    if (!g) {
      const owners = declaredBy(d.port);
      if (owners.length === 1) g = projectGroup(owners[0].root);
    }
    if (g) {
      if (!g.live.some(e => e.port === d.port) && !g.dead.some(e => e.port === d.port)) {
        const svc = (g.services || []).find(s => Number(s.port) === d.port);
        g.dead.push({ port: d.port, url: d.url, title: d.title, ts: d.ts, tabs: d.tabs, label: svc?.label || null, yours: !!svc });
      }
      g.lastActive = Math.max(g.lastActive, d.ts);
    } else {
      orphans.push({ ...d, key: k });
    }
  }

  // Orphans: same non-generic title within one session → one app, keep the
  // newest port. Otherwise a row per port.
  const byTitle = new Map();
  for (const o of orphans) {
    if (!o.key) { pushOrphan(ensure, o, `port:${o.label}`); continue; }
    if (!byTitle.has(o.key)) byTitle.set(o.key, []);
    byTitle.get(o.key).push(o);
  }
  for (const [k, items] of byTitle) {
    items.sort((a, b) => b.ts - a.ts);
    let cluster = 0;
    for (let i = 0; i < items.length; i++) {
      if (i > 0 && items[i - 1].ts - items[i].ts > SESSION_GAP_MS) cluster++;
      pushOrphan(ensure, items[i], `title:${k}#${cluster}`);
    }
  }

  // ── finish ───────────────────────────────────────────────────────────────
  const out = [];
  for (const g of groups.values()) {
    if (!g.live.length && !g.dead.length) continue; // a known project nobody has run
    g.live.sort((a, b) => (b.yours - a.yours) || (!!a.launcher - !!b.launcher) || (b.ts - a.ts) || (a.port - b.port));
    for (const e of g.live) if (!e.url) e.url = `http://localhost:${e.port}/`;
    g.dead.sort((a, b) => (b.yours - a.yours) || (b.ts - a.ts));
    g.running = g.live.length > 0;
    g.primary = g.live[0] || g.dead[0] || null;
    // Declared port that isn't up while another port of the project is.
    const yoursDown = g.dead.find(d => d.yours);
    const declared = (g.services || []).map(s => Number(s.port)).filter(Boolean);
    const taken = declared
      .map(p => ({ p, owner: liveByPort.get(p)?.group }))
      .find(x => x.owner && x.owner !== g);
    g.note = g.running && !g.live[0].yours && taken
      ? `Your :${taken.p} is in use by ${taken.owner.name} — running on :${g.live[0].port}`
      : g.running && !g.live[0].yours && yoursDown
        ? `Running on :${g.live[0].port} instead of :${yoursDown.port}`
        : null;
    g.titles = undefined;
    out.push(g);
  }
  return out.sort((a, b) => (b.running - a.running) || (b.lastActive - a.lastActive));
}

function addTitle(g, k, ts) {
  if ((g.titles.get(k) || 0) < ts) g.titles.set(k, ts);
}

function pushOrphan(ensure, o, key) {
  // A generic title ("Vite + React") still beats a bare port as a *name* —
  // it just must not be used to *group*.
  const t = String(o.title || '').trim();
  const g = ensure(key, { name: t && !isUrlish(t.toLowerCase(), o.label) ? t : o.label });
  if (!g.dead.some(e => e.port === o.port)) {
    g.dead.push({ port: o.port, url: o.url, title: o.title, ts: o.ts, tabs: o.tabs || [], label: null, yours: false });
  }
  g.lastActive = Math.max(g.lastActive, o.ts);
}
