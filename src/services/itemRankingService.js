/**
 * One activity score for every kind of item — link, app, folder, file — so
 * any surface can order a mixed list by what's actually used, instead of
 * grouping by type (links, then apps, then folders…).
 *
 * Score, in rough "minutes of attention" units so the signals add up:
 *   usage   — real time from the sidecar, last USAGE_DAYS days, each day
 *             worth half as much every HALF_LIFE_DAYS:
 *               links   → browsing dwell on the domain   (/activity/site-usage)
 *               apps    → focused active time            (/activity/app-usage)
 *               folders/files → editor time on that project/file (sampler
 *                         "contexts": the project name parsed from the title)
 *             log-scaled, so 5h vs 3h barely differs but 20min vs 0 does.
 *   launches — opens from CoolDesk itself (recordLaunch, hooked into
 *             workspaceActivityService.activate so every surface feeds it),
 *             same half-life. Kept in localStorage — shared by the app's
 *             windows (same origin) — and synced across them via `storage`.
 *   live    — a flat boost when the caller says the item is open right now.
 *
 * Ties keep the caller's order (stable sort), so with no data yet every list
 * looks exactly as it did before.
 *
 * Workspaces rank on the same signals (workspaceScore): their best few items
 * plus how often the workspace itself was switched to (recordWorkspaceOpen).
 */
import { getHostUrl } from './syncConfig.js';

const HALF_LIFE_DAYS = 3;
const USAGE_DAYS = 14;
const REFRESH_MS = 5 * 60 * 1000;
const LAUNCH_KEY = 'cooldesk-item-launches';
const MAX_LAUNCH_ENTRIES = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

const LAUNCH_WEIGHT = 1.5;
const LIVE_BOOST = 2;
// A workspace is as active as its busiest items — the top few, weighted down
// the line — not the sum of all of them, which would just reward big ones.
const WS_TOP_WEIGHTS = [1, 0.6, 0.4];

const workspaceRef = (ws) => ({ _rankKey: `ws:${ws.id}` });

const decay = (ageMs) => Math.pow(0.5, ageMs / (HALF_LIFE_DAYS * DAY_MS));

const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
// "Visual Studio Code.app" / "Code.exe" / "Slack" → comparable app keys.
const appKey = (n) => String(n || '').toLowerCase().replace(/\.(app|exe)$/, '').trim();

function hostOf(rawUrl) {
  try {
    const withProto = /^[a-z][a-z0-9+.-]+:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(withProto).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Stable identity for an item across surfaces and sessions. */
export function itemKey(item) {
  if (!item) return '';
  if (item._rankKey) return item._rankKey;
  if (item.url && !item.path) {
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]+:/i.test(item.url) ? item.url : `https://${item.url}`);
      return `url:${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
      return `url:${String(item.url).toLowerCase()}`;
    }
  }
  if (item.path) return `path:${String(item.path).toLowerCase().replace(/[\\/]+$/, '')}`;
  return item.name ? `name:${appKey(item.name)}` : '';
}

function loadLaunches() {
  try {
    const v = JSON.parse(localStorage.getItem(LAUNCH_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

class ItemRankingService {
  constructor() {
    this.usage = { apps: new Map(), contexts: new Map(), domains: new Map() };
    this.launches = loadLaunches(); // key -> { s: decayed score at t, t: last launch ms }
    this.subscribers = new Set();
    this.timer = null;
    this.version = 0;
    this.onStorage = (e) => {
      if (e.key !== LAUNCH_KEY) return;
      this.launches = loadLaunches();
      this.notify();
    };
  }

  /** Re-render tick: called with a version number whenever scores change. */
  subscribe(cb) {
    this.subscribers.add(cb);
    if (this.subscribers.size === 1) this.start();
    return () => {
      this.subscribers.delete(cb);
      if (this.subscribers.size === 0) this.stop();
    };
  }

  start() {
    this.refreshUsage();
    this.timer = setInterval(() => this.refreshUsage(), REFRESH_MS);
    if (typeof window !== 'undefined') window.addEventListener('storage', this.onStorage);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (typeof window !== 'undefined') window.removeEventListener('storage', this.onStorage);
  }

  notify() {
    this.version++;
    for (const cb of this.subscribers) {
      try { cb(this.version); } catch (e) { console.error('[ItemRanking] Subscriber error:', e); }
    }
  }

  async refreshUsage() {
    const host = getHostUrl();
    const get = (path) => fetch(`${host}${path}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [apps, sites] = await Promise.all([
      get(`/activity/app-usage?days=${USAGE_DAYS}`),
      get(`/activity/site-usage?days=${USAGE_DAYS}`),
    ]);
    if (!apps && !sites) return; // sidecar not reachable — keep what we had

    const now = Date.now();
    const weightOf = (date) => decay(now - new Date(`${date}T12:00:00`).getTime());
    const add = (map, k, secs) => { if (k && secs > 0) map.set(k, (map.get(k) || 0) + secs); };

    const next = { apps: new Map(), contexts: new Map(), domains: new Map() };
    for (const day of apps?.days || []) {
      const w = weightOf(day.date);
      for (const [name, u] of Object.entries(day.apps || {})) {
        add(next.apps, appKey(name), (u.activeS || 0) * w);
        for (const [ctx, secs] of Object.entries(u.contexts || {})) {
          add(next.contexts, ctx.toLowerCase(), secs * w);
        }
      }
    }
    for (const day of sites?.days || []) {
      const w = weightOf(day.date);
      for (const [domain, secs] of Object.entries(day.domains || {})) {
        add(next.domains, domain.replace(/^www\./, '').toLowerCase(), secs * w);
      }
    }
    this.usage = next;
    this.notify();
  }

  /** Call when the user opens an item from any CoolDesk surface. */
  recordLaunch(item) {
    const key = itemKey(item);
    if (!key) return;
    const now = Date.now();
    const prev = this.launches[key];
    const s = (prev ? prev.s * decay(now - prev.t) : 0) + 1;
    this.launches[key] = { s, t: now };

    // Bound storage: drop the weakest entries once it grows past the cap.
    const keys = Object.keys(this.launches);
    if (keys.length > MAX_LAUNCH_ENTRIES) {
      keys
        .map((k) => [k, this.launches[k].s * decay(now - this.launches[k].t)])
        .sort((a, b) => a[1] - b[1])
        .slice(0, keys.length - MAX_LAUNCH_ENTRIES)
        .forEach(([k]) => { delete this.launches[k]; });
    }
    try { localStorage.setItem(LAUNCH_KEY, JSON.stringify(this.launches)); } catch { /* not persisted */ }
    this.notify();
  }

  /** Decayed seconds of real usage behind an item (0 when unknown). */
  usageSecs(item) {
    if (!item) return 0;
    if (item.url && !item.path) return this.usage.domains.get(hostOf(item.url)) || 0;
    const type = String(item.appType || '').toLowerCase();
    if (type === 'folder' || type === 'file' || item._cd) {
      // Editor time is attributed to the project/file name in the window title.
      return this.usage.contexts.get(baseName(item.path).toLowerCase()) || 0;
    }
    return this.usage.apps.get(appKey(item.name))
      || this.usage.apps.get(appKey(baseName(item.path)))
      || 0;
  }

  score(item, { live = false } = {}) {
    const launch = this.launches[itemKey(item)];
    const launchScore = launch ? launch.s * decay(Date.now() - launch.t) : 0;
    return Math.log1p(this.usageSecs(item) / 60) + LAUNCH_WEIGHT * launchScore + (live ? LIVE_BOOST : 0);
  }

  /** Call when the user switches to / opens a workspace. */
  recordWorkspaceOpen(ws) {
    if (ws?.id != null) this.recordLaunch(workspaceRef(ws));
  }

  /**
   * Activity of a whole workspace, from its own links/apps. `isLive(item)`
   * (optional) marks items open right now.
   */
  workspaceScore(ws, { isLive } = {}) {
    if (!ws) return 0;
    const items = [...(ws.urls || []).filter((u) => u.status !== 'draft'), ...(ws.apps || [])];
    const top = items
      .map((it) => this.score(it, { live: !!isLive?.(it) }))
      .sort((a, b) => b - a)
      .slice(0, WS_TOP_WEIGHTS.length)
      .reduce((sum, sc, i) => sum + sc * WS_TOP_WEIGHTS[i], 0);
    return top + this.score(workspaceRef(ws));
  }

  /** Workspaces, most active first (stable for ties). */
  rankWorkspaces(workspaces, { isLive } = {}) {
    return workspaces
      .map((ws, i) => ({ ws, i, s: this.workspaceScore(ws, { isLive }) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.ws);
  }

  /**
   * A new array, most-used first. `isLive(item)` (optional) marks items open
   * right now. Stable: equal scores keep their input order.
   */
  rank(items, { isLive } = {}) {
    return items
      .map((item, i) => ({ item, i, s: this.score(item, { live: !!isLive?.(item) }) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.item);
  }
}

export const itemRankingService = new ItemRankingService();
