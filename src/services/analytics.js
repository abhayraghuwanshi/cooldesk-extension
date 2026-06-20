// Anonymous usage analytics — client side.
//
// We never collect search queries, URLs, or any user content. Only a local
// spotlight-open counter and an opt-out flag live here; the anonymous install
// id, OS, version and install source are added by the Rust backend. Everything
// is sent through the existing update-check ping (see `check_winget_update`).
//
// Two localStorage keys back this:
//   cooldesk-analytics-enabled  '"true"' | '"false"'  (default: enabled)
//   cooldesk-spotlight-opens    integer counter, reset to 0 after each ping

const ENABLED_KEY = 'cooldesk-analytics-enabled';
const OPENS_KEY = 'cooldesk-spotlight-opens';

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
}

// Called every time the spotlight is opened. Cheap, local, no network.
export function recordSpotlightOpen() {
  try {
    const n = parseInt(localStorage.getItem(OPENS_KEY) || '0', 10) || 0;
    localStorage.setItem(OPENS_KEY, String(n + 1));
  } catch { /* ignore */ }
}

function readSpotlightOpens() {
  try {
    return parseInt(localStorage.getItem(OPENS_KEY) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

// Subtract the count we just reported, rather than zeroing, so opens that
// happened during the in-flight request aren't lost.
function consumeSpotlightOpens(reported) {
  try {
    const n = readSpotlightOpens();
    localStorage.setItem(OPENS_KEY, String(Math.max(0, n - reported)));
  } catch { /* ignore */ }
}

function coarseLocale() {
  try {
    return (navigator.language || '').slice(0, 2).toLowerCase();
  } catch {
    return '';
  }
}

// Runs the update check and, unless the user opted out, attaches the anonymous
// heartbeat (spotlight count + locale). On success the reported opens are
// consumed. Returns the same UpdateInfo the bare command returns.
export async function checkUpdateWithPing() {
  const { invoke } = await import('@tauri-apps/api/core');
  const enabled = isAnalyticsEnabled();
  const opens = enabled ? readSpotlightOpens() : 0;

  const info = await invoke('check_winget_update', {
    analyticsEnabled: enabled,
    spotlightOpens: opens,
    locale: enabled ? coarseLocale() : '',
  });

  if (enabled && opens > 0) consumeSpotlightOpens(opens);
  return info;
}
