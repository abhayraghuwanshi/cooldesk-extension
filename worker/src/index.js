// CoolDesk analytics + update-check proxy (Cloudflare Worker).
//
//   POST /api/version   the desktop app's heartbeat. Records an anonymous ping
//                       into D1, then returns the latest GitHub release JSON
//                       (cached) so `check_winget_update` keeps working from a
//                       single URL. GET returns the release without recording.
//   POST /api/bye       the optional "why are you leaving?" answer from
//                       cool-desk.com/uninstall, opened by the Windows
//                       uninstaller and by Chrome when the extension is removed.
//
// We never store IPs or any user content. A ping carries only:
//   install_id, os, app_version, install_source, channel, locale, event,
//   spotlight_opens, active_minutes, ping_failures, features{name:int}, feedback
// Feature names and feedback values are whitelisted here as well as in the app.
// The date is assigned server-side (UTC) — client dates are not trusted.
//
// Older app versions send only the first six fields; every new one is optional.

const GITHUB_LATEST =
  'https://api.github.com/repos/abhayraghuwanshi/cooldesk-extension/releases/latest';
const CACHE_TTL = 300; // seconds — cap GitHub API calls

// Keep in sync with FEATURES in src/services/analytics.js.
const FEATURES = new Set([
  'result_opened', 'open_tab', 'open_url', 'open_app', 'open_file',
  'workspace_opened', 'workspace_created', 'agent_query', 'clipboard_copy',
  'vault_unlock', 'dock_enabled', 'onboarding_done',
]);
const FEEDBACK = new Set(['great', 'okay', 'not_for_me']);
const BYE_REASONS = new Set([
  'not_useful', 'too_complicated', 'missing_feature', 'performance', 'bugs',
  'switched', 'just_trying', 'other',
]);
const EVENTS = new Set(['heartbeat', 'first_run']);
const MAX_COUNT = 100000;

const BYE_ORIGINS = new Set(['https://cool-desk.com', 'https://www.cool-desk.com']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (path === '/api/bye') return handleBye(request, env);
    if (path !== '/api/version') return new Response('Not found', { status: 404 });

    // Record the ping if a JSON body is present. Best-effort: a bad body or a
    // missing D1 binding must never break the update check.
    if (request.method === 'POST') {
      try {
        const body = await request.json();
        if (env.DB) ctx.waitUntil(recordPing(env, body).catch(() => {}));
      } catch {
        // malformed body — ignore
      }
    }

    const release = await getLatestRelease();
    return new Response(JSON.stringify(release), {
      headers: {
        'content-type': 'application/json',
        'cache-control': `public, max-age=${CACHE_TTL}`,
      },
    });
  },
};

async function getLatestRelease() {
  // Cloudflare caches this subrequest at the edge for CACHE_TTL seconds.
  const resp = await fetch(GITHUB_LATEST, {
    headers: {
      'User-Agent': 'CoolDesk',
      Accept: 'application/vnd.github+json',
    },
    cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
  });
  return resp.json();
}

async function recordPing(env, body) {
  const installId = clamp(body.install_id, 64);
  if (!installId) return; // no id → nothing to count

  const date = new Date().toISOString().slice(0, 10); // server-side UTC date
  const os = clamp(body.os, 16);
  const appVersion = clamp(body.app_version, 32);
  const installSource = clamp(body.install_source, 32);
  const channel = clamp(body.channel, 16);
  const locale = clamp(body.locale, 16);
  const event = EVENTS.has(body.event) ? body.event : 'heartbeat';
  // A ping from the webview proves the UI loaded. Old clients send no event
  // and always ping from the webview, so they count as seen.
  const uiSeen = event === 'first_run' ? 0 : 1;
  const firstRun = event === 'first_run' ? 1 : 0;
  const opens = clampInt(body.spotlight_opens, 0, MAX_COUNT);
  const activeMinutes = clampInt(body.active_minutes, 0, 24 * 60 * 7);
  const failures = clampInt(body.ping_failures, 0, MAX_COUNT);

  const stmts = [
    env.DB.prepare(
      `INSERT INTO pings (install_id, date, os, app_version, install_source, channel, locale,
                          spotlight_opens, active_minutes, ping_failures, pings, ui_seen, first_run)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(install_id, date) DO UPDATE SET
         os = excluded.os,
         app_version = excluded.app_version,
         install_source = excluded.install_source,
         channel = COALESCE(excluded.channel, pings.channel),
         locale = COALESCE(excluded.locale, pings.locale),
         spotlight_opens = pings.spotlight_opens + excluded.spotlight_opens,
         active_minutes = pings.active_minutes + excluded.active_minutes,
         ping_failures = pings.ping_failures + excluded.ping_failures,
         pings = pings.pings + 1,
         ui_seen = MAX(pings.ui_seen, excluded.ui_seen),
         first_run = MAX(pings.first_run, excluded.first_run)`
    ).bind(installId, date, os, appVersion, installSource, channel, locale,
      opens, activeMinutes, failures, uiSeen, firstRun),
  ];

  const features = body.features && typeof body.features === 'object' ? body.features : {};
  for (const [name, raw] of Object.entries(features)) {
    if (!FEATURES.has(name)) continue;
    const n = clampInt(raw, 0, MAX_COUNT);
    if (n <= 0) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO feature_counts (install_id, date, feature, count) VALUES (?, ?, ?, ?)
       ON CONFLICT(install_id, date, feature) DO UPDATE SET count = feature_counts.count + excluded.count`
    ).bind(installId, date, name, n));
  }

  if (FEEDBACK.has(body.feedback)) {
    stmts.push(env.DB.prepare(
      `INSERT INTO feedback (install_id, date, rating, app_version) VALUES (?, ?, ?, ?)
       ON CONFLICT(install_id) DO UPDATE SET rating = excluded.rating, date = excluded.date,
         app_version = excluded.app_version`
    ).bind(installId, date, body.feedback, appVersion));
  }

  await env.DB.batch(stmts);
}

// ------------------------------------------------------------------- /api/bye

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  return BYE_ORIGINS.has(origin)
    ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    }
    : {};
}

async function handleBye(request, env) {
  const cors = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  let body;
  try { body = await request.json(); } catch { body = null; }
  const reason = body && BYE_REASONS.has(body.reason) ? body.reason : null;
  if (!reason) return new Response('Bad request', { status: 400, headers: cors });

  if (env.DB) {
    const date = new Date().toISOString().slice(0, 10);
    // Only versions shaped like 1.2.3 and known OS names — the page's query
    // string is user-editable.
    const version = /^\d+\.\d+\.\d+$/.test(String(body.v || '')) ? String(body.v) : null;
    // `os` is where the uninstall happened: a desktop OS, or the extension.
    const os = ['windows', 'macos', 'linux', 'extension'].includes(body.os) ? body.os : null;
    try {
      await env.DB.prepare('INSERT INTO goodbyes (date, app_version, os, reason) VALUES (?, ?, ?, ?)')
        .bind(date, version, os, reason).run();
    } catch { /* table missing / D1 down — the user still sees "thanks" */ }
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', ...cors },
  });
}

// --------------------------------------------------------------------- utils

function clamp(v, max) {
  if (v == null) return null;
  const s = String(v).slice(0, max).trim();
  return s.length ? s : null;
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(min, Math.min(max, n));
}
