// Shared "an update is available" state for the whole app.
//
// One check per session (re-run every RECHECK_MS while the app stays open),
// broadcast to every subscriber, so the top banner and the header pill never
// fire two version pings. Works in both builds:
//   - Tauri desktop: `check_winget_update` (also the anonymous heartbeat),
//     installed by handing off to `winget upgrade`.
//   - Chrome extension: `chrome.runtime.requestUpdateCheck()`, applied by
//     reloading the extension.
// Everything degrades to "no update" silently — offline, rate-limited or an
// unpackaged dev build must never surface an error to the user.

import { checkUpdateWithPing } from './analytics';

const RECHECK_MS = 6 * 60 * 60 * 1000; // 6h

// Both go through cool-desk.com rather than straight to GitHub / the Web Store,
// so the destination can move without reshipping installed clients. See
// server.mjs in the website repo (cooldesk-onboard-smoothly) for the redirects.
const RELEASES_URL = 'https://cool-desk.com/api/releases';
const EXTENSION_URL = 'https://cool-desk.com/api/extension';

const isTauri = () =>
  typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

const canCheckExtension = () =>
  typeof chrome !== 'undefined' && !!chrome.runtime?.requestUpdateCheck;

// info: null when up to date / unknown, otherwise
// { current, latest, notesUrl, target: 'desktop' | 'extension' }
let state = { info: null, checking: false, installing: false };
let lastCheckedAt = 0;
let inFlight = null;

const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => {
    try { fn(state); } catch { /* a bad subscriber must not break the rest */ }
  });
}

export function getUpdateState() {
  return state;
}

export function subscribeUpdate(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

async function checkDesktop() {
  const result = await checkUpdateWithPing();
  if (!result?.has_update) return null;
  return {
    current: result.current,
    latest: result.latest,
    notesUrl: result.notes_url || RELEASES_URL,
    target: 'desktop',
  };
}

async function checkExtension() {
  // Chrome throttles this hard; 'throttled' and 'no_update' both mean
  // "nothing to show right now".
  const { status, version } = await chrome.runtime.requestUpdateCheck();
  if (status !== 'update_available') return null;
  return {
    current: chrome.runtime.getManifest?.().version || '',
    latest: version || '',
    // The extension updates through the Web Store, so "what's new" points at
    // the listing rather than at GitHub releases.
    notesUrl: EXTENSION_URL,
    target: 'extension',
  };
}

/**
 * Check for an update. Concurrent calls share one request, and repeat calls
 * within RECHECK_MS are no-ops unless `force` is set (Settings → "Check now").
 * Resolves to the info object, or null when there's nothing to install.
 */
export function checkForUpdate({ force = false } = {}) {
  if (inFlight) return inFlight;
  if (!force && lastCheckedAt && Date.now() - lastCheckedAt < RECHECK_MS) {
    return Promise.resolve(state.info);
  }

  const run = async () => {
    setState({ checking: true });
    try {
      let info = null;
      if (isTauri()) info = await checkDesktop();
      else if (canCheckExtension()) info = await checkExtension();
      lastCheckedAt = Date.now();
      setState({ info });
      return info;
    } catch {
      // Offline / rate-limited / no release yet — keep whatever we knew.
      return state.info;
    } finally {
      setState({ checking: false });
      inFlight = null;
    }
  };

  inFlight = run();
  return inFlight;
}

/**
 * Apply the pending update. Desktop hands off to winget (which replaces the
 * app and relaunches it); the extension reloads itself. Both tear down this
 * page, so the resolved value only matters when the handoff failed.
 */
export async function installUpdate() {
  const info = state.info;
  if (!info || state.installing) return false;
  setState({ installing: true });
  try {
    if (info.target === 'extension') {
      chrome.runtime.reload();
      return true;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('run_winget_upgrade');
      return true;
    } catch {
      // winget missing / not on PATH — send the user to the release page.
      try { await invoke('open_url', { url: info.notesUrl }); }
      catch { window.open(info.notesUrl, '_blank'); }
      return false;
    }
  } finally {
    setState({ installing: false });
  }
}

/** Opens the release notes for the pending update. */
export async function openReleaseNotes() {
  const url = state.info?.notesUrl || RELEASES_URL;
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_url', { url });
      return;
    } catch { /* fall through to window.open */ }
  }
  window.open(url, '_blank', 'noreferrer');
}
