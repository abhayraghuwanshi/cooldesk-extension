// Ranking for the desktop spotlight's URL-like results (tabs, saved links,
// bookmarks, history). Pure functions, no I/O — searchService.js gathers the
// candidates and calls into this.
//
// Every result is scored the same way, whatever its source:
//
//   score = TYPE_BASE[type] + 50 × matchQuality + usage (0–15) + learned boost
//
// matchQuality (0–1) says how well the text matches the query. It used to be
// a yes/no "query is a substring of the title" per source, with hand-picked
// constants (tab 80/60, bookmark 65/45, …): "git" scored the same against
// "GitHub" as against "digital", and "ai" matched "email" at full strength.
//
// usage (frecency) comes from the browser's own history for that page, so a
// bookmark or tab you live in outranks one you never open — before, only
// history rows had any usage signal.

// Open tabs first among equals (switching is instant), then things saved on
// purpose, then plain history. Keeps the total within 0–100, the scale app
// results (Rust fuzzy_score + running bonus) are on.
export const TYPE_BASE = {
  tab: 35,
  'workspace-url': 33,
  workspace: 33,
  bookmark: 30,
  history: 25,
};

// When one page comes back from several sources, which row survives.
const TYPE_PRIORITY = { tab: 4, 'workspace-url': 3, workspace: 3, bookmark: 2, history: 1 };

export function queryWords(query) {
  return (query || '').toLowerCase().split(/\s+/).filter(Boolean);
}

function splitWords(text) {
  return (text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Optimal string alignment distance, bailing out once it exceeds `max`. */
function editDistance(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push(new Array(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = d;
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/**
 * One typo away from a title word, a prefix of one, or two adjacent words run
 * together: "githib" → "GitHub", "bigboss" → "Bigg Boss". Only for words of
 * 4+ characters — below that nearly everything is one edit from something.
 */
function typoMatch(w, titleWords) {
  if (w.length < 4) return false;
  const candidates = [...titleWords];
  for (let i = 0; i + 1 < titleWords.length; i++) candidates.push(titleWords[i] + titleWords[i + 1]);
  return candidates.some(t =>
    editDistance(w, t) <= 1 ||
    (t.length > w.length && editDistance(w, t.slice(0, w.length)) <= 1)
  );
}

function parseUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return {
      hostLabels: host.split('.').filter(Boolean),
      segments: u.pathname.toLowerCase().split('/').filter(Boolean).flatMap(s => [s, ...splitWords(s)]),
    };
  } catch {
    return { hostLabels: [], segments: [] };
  }
}

/**
 * Best match for one query word, 0–1. Tiers, strongest first:
 *   whole title word 1.0 · title-word prefix 0.85 · site name 0.8/0.7 ·
 *   url path segment 0.7/0.6 · typo 0.5 · inside a title word 0.4 ·
 *   anywhere in the url 0.25 · a word of the context (e.g. the workspace a
 *   saved link is in) 0.35
 * Substring tiers only for words of 3+ characters, so "ai" can't hit "email".
 */
function wordQuality(w, ctx) {
  const { titleWords, hostLabels, segments, title, url, contextWords } = ctx;
  if (titleWords.includes(w)) return 1;
  if (titleWords.some(t => t.startsWith(w))) return w.length === 1 ? 0.6 : 0.85;
  if (hostLabels.includes(w)) return 0.8;
  if (hostLabels.some(l => l.startsWith(w))) return 0.7;
  if (segments.includes(w)) return 0.7;
  if (segments.some(s => s.startsWith(w))) return 0.6;
  if (typoMatch(w, titleWords)) return 0.5;
  if (w.length >= 3 && title.includes(w)) return 0.4;
  if (contextWords.some(t => t.startsWith(w))) return 0.35;
  if (w.length >= 3 && url.includes(w)) return 0.25;
  return 0;
}

/**
 * How well `{ title, url, context? }` matches `query`, 0 (no match) to 1.
 * `context` is secondary text that should match weakly, like the name of
 * the workspace a saved link lives in.
 *
 * Multi-word queries match per word in any order ("big boss" → "Watch Bigg
 * Boss") and a row is only as good as its weakest word, lightly averaged so
 * one strong word still helps. Whole-query bonuses: the title is the query,
 * starts with it, or contains it as a phrase; or the query is the title's
 * initials ("vsc" → "Visual Studio Code").
 */
export function matchQuality({ title, url, context }, query) {
  const words = queryWords(query);
  if (words.length === 0) return 0;
  const q = words.join(' ');
  const titleLower = (title || '').toLowerCase().trim();
  const ctx = {
    title: titleLower,
    url: (url || '').toLowerCase(),
    titleWords: splitWords(title),
    contextWords: splitWords(context),
    ...parseUrl(url),
  };

  const perWord = words.map(w => wordQuality(w, ctx));
  let quality = 0;
  if (perWord.every(s => s > 0)) {
    const min = Math.min(...perWord);
    const mean = perWord.reduce((a, b) => a + b, 0) / perWord.length;
    quality = Math.round((0.7 * min + 0.3 * mean) * 1000) / 1000;
  }

  if (titleLower === q) return 1;
  if (titleLower.startsWith(q)) quality = Math.max(quality, 0.95);
  else if (words.length > 1 && titleLower.includes(q)) quality = Math.max(quality, 0.9);

  if (words.length === 1 && q.length >= 2 && ctx.titleWords.length > 1) {
    const initials = ctx.titleWords.map(t => t[0]).join('');
    if (initials.startsWith(q)) quality = Math.max(quality, 0.65);
  }
  return quality;
}

/**
 * Frecency, 0–15: visits weighted by how recently the page was last seen,
 * on a log curve so 100 visits still beats 30 without a hard cap flattening
 * them. Buckets match browser_history.rs so the sidecar's cut and this
 * ranking agree.
 */
export function frecency({ visitCount, lastVisitTime }, now = Date.now()) {
  if (!visitCount) return 0;
  const days = Math.max(0, (now - (lastVisitTime || 0)) / 86400000);
  const recency = days < 1 ? 1 : days < 7 ? 0.7 : days < 30 ? 0.45 : days < 90 ? 0.25 : 0.1;
  return Math.min(15, 15 * Math.log1p(visitCount * recency) / Math.log1p(100));
}

// Query params that only record how a page was reached. Mirrors
// is_noise_param in browser_history.rs.
const NOISE_PARAMS = new Set([
  'fbclid', 'gclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid', 'si', 'ref', 'ref_src', 'ref_url',
  'share_id', 'rdt', 'context', 'screen_view_count', 'ext-referrer', 'source_id', 'composer_entry',
  'correlation_id',
]);

/**
 * Identity of the page a URL points at, for collapsing the same page coming
 * from several sources (an open tab and its history row, a bookmark and its
 * history row). Mirrors page_key in browser_history.rs: no www., fragment,
 * trailing slash or tracking params; a reddit post keyed by its id.
 */
export function pageKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let segs = u.pathname.split('/').filter(Boolean);
    if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
      segs = segs.map(s => s.toLowerCase());
      if (segs[0] === 'r' && segs[2] === 'comments' && segs[3]) segs = segs.slice(0, 4);
    }
    const params = [...u.searchParams]
      .filter(([k]) => !k.toLowerCase().startsWith('utm_') && !NOISE_PARAMS.has(k.toLowerCase()))
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    return `${host}/${segs.join('/')}${params.length ? `?${params.join('&')}` : ''}`;
  } catch {
    return (url || '').toLowerCase();
  }
}

/**
 * Score URL-like candidates against `query`, drop non-matches, and collapse
 * duplicates of the same page.
 *
 * Each candidate: { type, title, url, visitCount?, lastVisitTime?, ... }.
 * Usage for rows without their own visit data (tabs, bookmarks, saved links)
 * is borrowed from any history candidate for the same page. Of several rows
 * for one page, the highest-priority type survives (an open tab over its
 * history row), carrying the best usage. `boosts` maps pageKey-compatible
 * keys (via `boostKey`) to learned click boosts.
 */
export function rankUrlResults(candidates, query, { now = Date.now(), boosts = {}, boostKey = null } = {}) {
  const byPage = new Map();
  for (const c of candidates) {
    if (!c) continue;
    const quality = matchQuality(c, query);
    if (quality <= 0) continue;
    const key = c.url ? pageKey(c.url) : `id:${c.type}:${c.id}`;
    const usage = frecency(c, now);
    const prev = byPage.get(key);
    if (!prev) {
      byPage.set(key, { item: c, quality, usage });
      continue;
    }
    const better = (TYPE_PRIORITY[c.type] || 0) > (TYPE_PRIORITY[prev.item.type] || 0);
    byPage.set(key, {
      item: better ? c : prev.item,
      quality: better ? quality : prev.quality,
      usage: Math.max(usage, prev.usage),
    });
  }

  const out = [];
  for (const { item, quality, usage } of byPage.values()) {
    const boost = (boostKey && item.url && boosts[boostKey(item.url)]) || 0;
    const score = Math.min(100, (TYPE_BASE[item.type] ?? 25) + 50 * quality + usage + boost);
    out.push({ ...item, score: Math.round(score * 10) / 10, matchQuality: quality, ...(boost ? { rlBoost: boost } : {}) });
  }
  return out.sort((a, b) => b.score - a.score);
}
