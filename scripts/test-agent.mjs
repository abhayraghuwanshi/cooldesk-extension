#!/usr/bin/env node
// Live quality harness for the CoolDesk cloud agent (/llm/v3/*).
//
// Measures how well the agent actually performs agentic tasks against the
// running sidecar: does it use tools, does it answer with real data, and do
// suggested workspaces contain only URLs/apps that truly exist in the user's
// tabs / history / running apps (anti-hallucination grounding check).
//
// Usage:
//   node scripts/test-agent.mjs                 # full battery
//   node scripts/test-agent.mjs --only suggest  # just the suggest loop
//   node scripts/test-agent.mjs --base http://localhost:4545

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const BASE = flag('base', 'http://localhost:4545');
const ONLY = flag('only', null); // chat | suggest
const TIMEOUT_MS = Number(flag('timeout', 180000));

const results = [];
let groundTruth = null;

function record(section, name, pass, detail, ms) {
  results.push({ section, name, pass, detail, ms });
  const icon = pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO';
  const time = ms != null ? ` (${(ms / 1000).toFixed(1)}s)` : '';
  console.log(`  [${icon}] ${name}${time}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function timed(fn) {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

// ── URL normalization for grounding checks ──────────────────────────────────
function normUrl(u) {
  try {
    const url = new URL(u);
    let path = url.pathname.replace(/\/+$/, '');
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${path}`;
  } catch {
    return String(u).toLowerCase().replace(/\/+$/, '');
  }
}

function domainOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

// ── Ground truth from the sidecar's own data endpoints ───────────────────────
async function fetchGroundTruth() {
  const [tabs, workspaces, activity, apps] = await Promise.all([
    api('/tabs'),
    api('/workspaces'),
    api('/activity'),
    api('/activity/visible'),
  ]);

  const tabUrls = new Set(tabs.filter(t => t.url?.startsWith('http')).map(t => normUrl(t.url)));
  const historyUrls = new Set(
    activity.filter(a => a.url?.startsWith('http')).map(a => normUrl(a.url))
  );
  const knownUrls = new Set([...tabUrls, ...historyUrls]);

  // Domains ranked by rough engagement (dwell time + visits) for chat checks.
  const domainScore = new Map();
  for (const a of activity) {
    if (!a.url?.startsWith('http')) continue;
    const d = domainOf(a.url);
    if (!d) continue;
    domainScore.set(d, (domainScore.get(d) || 0) + (a.time || 0) / 1000 + (a.visitCount || 0) * 20);
  }
  const topDomains = [...domainScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d]) => d);

  const appNames = new Set(
    apps.map(a => (a.name || '').toLowerCase().replace(/\.exe$/, '')).filter(Boolean)
  );

  return {
    tabs, workspaces, activity, apps,
    tabUrls, historyUrls, knownUrls, topDomains, appNames,
    workspaceNames: workspaces.map(w => w.name).filter(Boolean),
  };
}

// ── Chat battery ─────────────────────────────────────────────────────────────
// Symptom of a missing agentic loop: the "answer" is a raw tool dump.
const TOOL_DUMP_MARKERS = [
  'Workspace: ', 'Most-engaged recent pages', 'Open tabs (', 'Running apps (',
  'History matches (', 'Pinned items (', 'Existing workspaces:', 'Open local projects/folders',
];
const looksLikeToolDump = (text) => TOOL_DUMP_MARKERS.some(m => text.startsWith(m));

async function runChatTests(gt) {
  console.log('\n== /llm/v3/chat (agentic Q&A) ==');

  // 1. Baseline: no tools needed — proves provider/key/model work at all.
  {
    const { value: r, ms } = await timed(() =>
      api('/llm/v3/chat', { method: 'POST', body: JSON.stringify({ message: 'Reply with exactly one word: PONG' }) })
    );
    const pass = r.ok === true && /pong/i.test(r.response || '');
    record('chat', 'baseline round-trip (no tools)', pass,
      pass ? '' : `ok=${r.ok} error=${r.error || 'none'} response="${(r.response || '').slice(0, 120)}"`, ms);
    if (!r.ok) return; // provider broken — the rest of the battery is noise
  }

  // 2. Workspace recall — needs the search_workspaces tool.
  if (gt.workspaceNames.length > 0) {
    const { value: r, ms } = await timed(() =>
      api('/llm/v3/chat', { method: 'POST', body: JSON.stringify({ message: 'What workspaces do I have? List their names.' }) })
    );
    const text = r.response || '';
    const mentioned = gt.workspaceNames.filter(n => text.toLowerCase().includes(n.toLowerCase()));
    const dump = looksLikeToolDump(text);
    record('chat', 'lists real workspaces via tool', r.ok && mentioned.length > 0,
      `${mentioned.length}/${gt.workspaceNames.length} names found${dump ? ' — WARNING: raw tool dump, no synthesis' : ''}`, ms);
  } else {
    record('chat', 'lists real workspaces via tool', null, 'skipped: no workspaces exist');
  }

  // 3. Activity awareness — needs get_recent_activity / suggest_workspaces.
  if (gt.topDomains.length > 0) {
    const { value: r, ms } = await timed(() =>
      api('/llm/v3/chat', { method: 'POST', body: JSON.stringify({ message: 'What have I been working on in my browser recently? Mention the actual sites.' }) })
    );
    const text = (r.response || '').toLowerCase();
    const hit = gt.topDomains.filter(d => text.includes(d) || text.includes(d.split('.')[0]));
    const dump = looksLikeToolDump(r.response || '');
    record('chat', 'grounds answer in real activity', r.ok && hit.length > 0,
      `mentions ${hit.length}/${gt.topDomains.length} top domains (${hit.slice(0, 3).join(', ') || 'none'})${dump ? ' — WARNING: raw tool dump' : ''}`, ms);
  } else {
    record('chat', 'grounds answer in real activity', null, 'skipped: no activity data');
  }

  // 4. Refusal-to-hallucinate: ask about something that does not exist.
  {
    const probe = 'Do I have a workspace called ZyxxNonexistent42? Answer yes or no.';
    const { value: r, ms } = await timed(() =>
      api('/llm/v3/chat', { method: 'POST', body: JSON.stringify({ message: probe }) })
    );
    const text = (r.response || '').toLowerCase();
    const saidNo = /\bno\b|don't|do not|couldn't find|no workspace|not find/.test(text);
    record('chat', 'does not invent a fake workspace', r.ok && saidNo,
      saidNo ? '' : `response="${(r.response || '').slice(0, 140)}"`, ms);
  }
}

// ── Suggest battery ──────────────────────────────────────────────────────────
function parseGroups(text) {
  // The prompt demands bare JSON but models love fences — parse leniently.
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  if (start > 0) t = t.slice(start);
  const end = t.lastIndexOf('}');
  if (end >= 0) t = t.slice(0, end + 1);
  try {
    const obj = JSON.parse(t);
    return Array.isArray(obj.groups) ? obj.groups : null;
  } catch {
    return null;
  }
}

// Grounded = exact normalized match, or a prefix relation with a known URL
// (models often trim or extend one trailing segment of a URL they saw in a
// tool result — e.g. appending "/edit"). Domain-only overlap does NOT count:
// the shorter side must itself carry a path.
function isGrounded(url, gt) {
  const n = normUrl(url);
  if (gt.knownUrls.has(n)) return true;
  for (const k of gt.knownUrls) {
    const shorter = n.length <= k.length ? n : k;
    if (!shorter.includes('/')) continue;
    if (n.startsWith(k) || k.startsWith(n)) return true;
  }
  return false;
}

function scoreGroups(label, groups, gt) {
  const problems = [];
  if (groups.length < 1 || groups.length > 4) problems.push(`expected 2-4 groups, got ${groups.length}`);

  let urlTotal = 0, urlGrounded = 0, appTotal = 0, appGrounded = 0;
  const hallucinated = [];

  for (const g of groups) {
    if (!g.name || typeof g.name !== 'string') problems.push('group missing name');
    for (const u of g.urls || []) {
      urlTotal++;
      if (!u.url || !/^https?:\/\//.test(u.url)) {
        problems.push(`malformed url in "${g.name}": ${JSON.stringify(u.url)}`);
        continue;
      }
      if (isGrounded(u.url, gt)) urlGrounded++;
      else hallucinated.push(u.url);
    }
    for (const app of g.apps || []) {
      appTotal++;
      const a = String(app).toLowerCase();
      if ([...gt.appNames].some(n => n.includes(a) || a.includes(n))) appGrounded++;
    }
  }

  const urlPct = urlTotal ? Math.round((urlGrounded / urlTotal) * 100) : 100;
  const appPct = appTotal ? Math.round((appGrounded / appTotal) * 100) : 100;

  record('suggest', `${label}: schema valid`, problems.length === 0,
    problems.slice(0, 3).join('; '));
  record('suggest', `${label}: urls grounded in tabs/history`, urlPct >= 80,
    `${urlGrounded}/${urlTotal} (${urlPct}%)${hallucinated.length ? ` — invented: ${hallucinated.slice(0, 3).join(', ')}` : ''}`);
  if (appTotal > 0) {
    record('suggest', `${label}: apps are actually running`, appPct >= 80, `${appGrounded}/${appTotal} (${appPct}%)`);
  }

  console.log(`    groups: ${groups.map(g => `"${g.name}" (${(g.urls || []).length} urls, ${(g.apps || []).length} apps, ${(g.folders || []).length} folders)`).join(', ')}`);
}

async function runSuggestTests(gt) {
  console.log('\n== /llm/v3/suggest (multi-turn agentic loop) ==');

  const cases = [
    ['general suggestions', ''],
    ['targeted request', 'Create a workspace for my software development work.'],
  ];

  for (const [label, message] of cases) {
    const { value: r, ms } = await timed(() =>
      api('/llm/v3/suggest', { method: 'POST', body: JSON.stringify({ message }) })
    );
    if (!r.ok) {
      record('suggest', `${label}: request ok`, false, r.error || 'unknown error', ms);
      continue;
    }
    record('suggest', `${label}: request ok`, true, '', ms);

    const groups = parseGroups(r.response);
    if (!groups) {
      record('suggest', `${label}: returns parseable JSON`, false,
        `response starts: "${(r.response || '').slice(0, 120)}"`);
      continue;
    }
    const bare = (r.response || '').trim().startsWith('{');
    record('suggest', `${label}: returns parseable JSON`, true, bare ? 'bare JSON' : 'needed lenient parsing (fences/prose)');
    scoreGroups(label, groups, gt);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`CoolDesk agent test harness → ${BASE}`);

  // Preflight
  try {
    const health = await api('/health');
    if (!health) throw new Error('no health payload');
  } catch (e) {
    console.error(`Sidecar not reachable at ${BASE} — start the app first (npm run dev:tauri). ${e.message}`);
    process.exit(2);
  }
  const status = await api('/llm/v3/status');
  console.log(`provider=${status.provider} model=${status.model} configured=${status.configured}`);
  if (!status.configured) {
    console.error('No API key configured (Settings → AI). Aborting.');
    process.exit(2);
  }

  groundTruth = await fetchGroundTruth();
  console.log(`ground truth: ${groundTruth.tabs.length} tabs, ${groundTruth.workspaceNames.length} workspaces, ` +
    `${groundTruth.activity.length} activity rows, ${groundTruth.apps.length} visible apps`);

  if (ONLY !== 'suggest') await runChatTests(groundTruth);
  if (ONLY !== 'chat') await runSuggestTests(groundTruth);

  // Summary
  const scored = results.filter(r => r.pass !== null);
  const passed = scored.filter(r => r.pass).length;
  console.log('\n== Summary ==');
  console.log(`${passed}/${scored.length} checks passed` +
    (results.length - scored.length ? ` (${results.length - scored.length} skipped)` : ''));
  for (const r of scored.filter(r => !r.pass)) {
    console.log(`  FAILED: [${r.section}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  process.exit(passed === scored.length ? 0 : 1);
}

main().catch(e => {
  console.error('harness crashed:', e);
  process.exit(2);
});
