// Anonymous usage analytics — client side.
//
// We never collect search queries, URLs, file names or any user content. What
// lives here is a handful of integer counters, an opt-out flag and a one-time
// rating; the anonymous install id, OS, version, channel and install source are
// added by the Rust backend. Everything rides on the update-check ping (see
// `check_winget_update`), which updateService schedules.
//
// localStorage keys (shared by every CoolDesk window — same origin):
//   cooldesk-analytics-enabled        'true' | 'false'   (default: enabled)
//   cooldesk-spotlight-opens          int, consumed by each successful ping
//   cooldesk-analytics-counters       { feature: int }, consumed likewise
//   cooldesk-analytics-active         { minutes, lastMinute }  minutes with input
//   cooldesk-analytics-days           { count, last }  distinct UTC days with input
//   cooldesk-analytics-failures       int, pings that didn't reach our endpoint
//   cooldesk-analytics-feedback       { state, rating, sent }  the 7-day prompt
//
// Counters are only subtracted after the endpoint confirms it stored them
// (`ping_ok`), so an offline day or a blocked endpoint delays them instead of
// losing them.

const ENABLED_KEY = 'cooldesk-analytics-enabled';
const OPENS_KEY = 'cooldesk-spotlight-opens';
const COUNTERS_KEY = 'cooldesk-analytics-counters';
const ACTIVE_KEY = 'cooldesk-analytics-active';
const DAYS_KEY = 'cooldesk-analytics-days';
const FAILURES_KEY = 'cooldesk-analytics-failures';
const FEEDBACK_KEY = 'cooldesk-analytics-feedback';

// The only feature names that are ever counted or sent. The worker enforces
// the same list, so a typo here is dropped rather than stored.
export const FEATURES = Object.freeze([
  'result_opened',     // picked any spotlight result
  'open_tab',          // …that switched to a browser tab
  'open_url',          // …that opened a link / history / bookmark
  'open_app',          // …that launched an app
  'open_file',         // …that opened a file or folder
  'workspace_opened',  // jumped into a workspace
  'workspace_created', // created one (dialog or /new-workspace)
  'agent_query',       // sent a request to /agent
  'clipboard_copy',    // re-copied an item from clipboard history
  'vault_unlock',      // unlocked the password vault
  'dock_enabled',      // turned the side dock / bar on
  'onboarding_done',   // finished or skipped the getting-started flow
]);
const FEATURE_SET = new Set(FEATURES);

export const FEEDBACK_RATINGS = Object.freeze(['great', 'okay', 'not_for_me']);
// Active days before the one-time "how's it going?" prompt.
export const FEEDBACK_AFTER_DAYS = 7;

const isTauri = () =>
  typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

// ---------------------------------------------------------------- storage

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function readInt(key) {
  try {
    return parseInt(localStorage.getItem(key) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

function writeInt(key, n) {
  try { localStorage.setItem(key, String(Math.max(0, n | 0))); } catch { /* ignore */ }
}

export function utcDay(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- opt-out

export function isAnalyticsEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAnalyticsEnabled(enabled) {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  } catch { /* ignore */ }
  if (!enabled) {
    // Nothing queued may leave the device after opting out.
    try {
      [OPENS_KEY, COUNTERS_KEY, ACTIVE_KEY, FAILURES_KEY].forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }
  // Rust sends the first-run ping before any window exists, so it needs the
  // flag on disk rather than in localStorage.
  if (isTauri()) {
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_analytics_enabled', { enabled }))
      .catch(() => {});
  }
}

// ---------------------------------------------------------------- recording

// Marks "the user did something in CoolDesk" for this minute and this UTC day.
// Called from input listeners and from every counter, so a minute is counted
// once however many windows saw input in it.
export function noteActivity() {
  if (!isAnalyticsEnabled()) return;
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const active = readJson(ACTIVE_KEY, { minutes: 0, lastMinute: 0 });
  if (active.lastMinute !== minute) {
    writeJson(ACTIVE_KEY, { minutes: (active.minutes | 0) + 1, lastMinute: minute });
  }
  const day = utcDay(now);
  const days = readJson(DAYS_KEY, { count: 0, last: '' });
  if (days.last !== day) {
    writeJson(DAYS_KEY, { count: (days.count | 0) + 1, last: day });
  }
}

/** True when there was input today (UTC) — a reason to ping on a new day. */
export function wasActiveToday() {
  const active = readJson(ACTIVE_KEY, { lastMinute: 0 });
  return !!active.lastMinute && utcDay(active.lastMinute * 60000) === utcDay();
}

/** Count one use of a whitelisted feature. Cheap, local, no network. */
export function recordFeature(name) {
  if (!FEATURE_SET.has(name) || !isAnalyticsEnabled()) return;
  const counters = readJson(COUNTERS_KEY, {});
  counters[name] = (counters[name] | 0) + 1;
  writeJson(COUNTERS_KEY, counters);
  noteActivity();
}

// Called every time the spotlight is opened. Sent as its own field
// (`spotlight_opens`) so older dashboards and queries keep working.
export function recordSpotlightOpen() {
  if (!isAnalyticsEnabled()) return;
  writeInt(OPENS_KEY, readInt(OPENS_KEY) + 1);
  noteActivity();
}

// Input listeners for a window. Only whether input happened is kept — never
// which key or where. Throttled in memory so typing doesn't hit localStorage
// on every keystroke.
let trackingStarted = false;
export function initActivityTracking() {
  if (trackingStarted || typeof window === 'undefined' || !isTauri()) return;
  trackingStarted = true;
  let lastNoted = 0;
  const onInput = () => {
    const now = Date.now();
    if (now - lastNoted < 20000) return;
    lastNoted = now;
    noteActivity();
  };
  const opts = { capture: true, passive: true };
  window.addEventListener('pointerdown', onInput, opts);
  window.addEventListener('keydown', onInput, opts);
  window.addEventListener('wheel', onInput, opts);
}

// ---------------------------------------------------------------- feedback

/** Whether to show the one-time "how's it going?" prompt now. */
export function shouldAskForFeedback() {
  if (!isTauri() || !isAnalyticsEnabled()) return false;
  const fb = readJson(FEEDBACK_KEY, {});
  if (fb.state) return false;
  return (readJson(DAYS_KEY, { count: 0 }).count | 0) >= FEEDBACK_AFTER_DAYS;
}

/** Record the answer; it goes out with the next ping. */
export function submitFeedback(rating) {
  if (!FEEDBACK_RATINGS.includes(rating)) return;
  writeJson(FEEDBACK_KEY, { state: 'answered', rating, sent: false });
}

export function dismissFeedback() {
  writeJson(FEEDBACK_KEY, { state: 'dismissed' });
}

// ---------------------------------------------------------------- the ping

function coarseLocale() {
  try {
    return (navigator.language || '').slice(0, 2).toLowerCase();
  } catch {
    return '';
  }
}

// Subtract what was reported rather than zeroing, so anything recorded while
// the request was in flight (in any window) survives.
function consume(reported) {
  writeInt(OPENS_KEY, readInt(OPENS_KEY) - reported.opens);

  const counters = readJson(COUNTERS_KEY, {});
  for (const [k, n] of Object.entries(reported.features)) {
    const left = (counters[k] | 0) - n;
    if (left > 0) counters[k] = left; else delete counters[k];
  }
  writeJson(COUNTERS_KEY, counters);

  const active = readJson(ACTIVE_KEY, { minutes: 0, lastMinute: 0 });
  writeJson(ACTIVE_KEY, { ...active, minutes: Math.max(0, (active.minutes | 0) - reported.activeMinutes) });

  writeInt(FAILURES_KEY, readInt(FAILURES_KEY) - reported.failures);

  if (reported.feedback) {
    const fb = readJson(FEEDBACK_KEY, {});
    if (fb.rating === reported.feedback) writeJson(FEEDBACK_KEY, { ...fb, sent: true });
  }
}

// Runs the update check and, unless the user opted out, attaches the anonymous
// heartbeat. Returns the same UpdateInfo the bare command returns.
export async function checkUpdateWithPing() {
  const { invoke } = await import('@tauri-apps/api/core');
  const enabled = isAnalyticsEnabled();

  const fb = readJson(FEEDBACK_KEY, {});
  const reported = enabled
    ? {
      opens: readInt(OPENS_KEY),
      features: Object.fromEntries(
        Object.entries(readJson(COUNTERS_KEY, {}))
          .filter(([k, n]) => FEATURE_SET.has(k) && (n | 0) > 0)
          .map(([k, n]) => [k, n | 0]),
      ),
      activeMinutes: readJson(ACTIVE_KEY, { minutes: 0 }).minutes | 0,
      failures: readInt(FAILURES_KEY),
      feedback: fb.state === 'answered' && !fb.sent ? fb.rating : '',
    }
    : { opens: 0, features: {}, activeMinutes: 0, failures: 0, feedback: '' };

  const info = await invoke('check_winget_update', {
    analyticsEnabled: enabled,
    spotlightOpens: reported.opens,
    locale: enabled ? coarseLocale() : '',
    features: reported.features,
    activeMinutes: reported.activeMinutes,
    pingFailures: reported.failures,
    feedback: reported.feedback,
  });

  if (enabled) {
    if (info?.ping_ok) consume(reported);
    else writeInt(FAILURES_KEY, readInt(FAILURES_KEY) + 1);
  }
  return info;
}
