// CoolDesk analytics + update-check proxy (Cloudflare Worker).
//
// One endpoint, two jobs:
//   1. Proxies the latest GitHub release JSON (cached) so the desktop app's
//      `check_winget_update` keeps working from a single URL.
//   2. On POST, records an anonymous daily ping into D1 (best-effort, never
//      blocks the response).
//
// We never store IPs or any user content. The ping body carries only:
//   install_id, os, app_version, install_source, locale, spotlight_opens
// The date is assigned server-side (UTC) — client dates are not trusted.

const GITHUB_LATEST =
  'https://api.github.com/repos/abhayraghuwanshi/cooldesk-extension/releases/latest';
const CACHE_TTL = 300; // seconds — cap GitHub API calls

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/version') {
      return new Response('Not found', { status: 404 });
    }

    // Record the ping if a JSON body is present. Best-effort: a bad body or a
    // missing D1 binding must never break the update check.
    if (request.method === 'POST') {
      try {
        const body = await request.json();
        if (env.DB) ctx.waitUntil(recordPing(env, body));
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
  const locale = clamp(body.locale, 16);
  const opens = clampInt(body.spotlight_opens, 0, 100000);

  await env.DB.prepare(
    `INSERT INTO pings (install_id, date, os, app_version, install_source, locale, spotlight_opens)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(install_id, date) DO UPDATE SET
       os = excluded.os,
       app_version = excluded.app_version,
       install_source = excluded.install_source,
       locale = excluded.locale,
       spotlight_opens = spotlight_opens + excluded.spotlight_opens`
  )
    .bind(installId, date, os, appVersion, installSource, locale, opens)
    .run();
}

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
