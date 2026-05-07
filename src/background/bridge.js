// Host communication bridge (WebSocket, polling, redirects)
import { getRedirectDecision } from '../services/extensionApi.js';
import { isHostSyncEnabled, getHostUrl, getWebSocketUrl, getDeviceId } from '../services/syncConfig.js';

let myDeviceId = null;
getDeviceId().then(id => { myDeviceId = id; }).catch(() => {});

// Deduplication: track recently-handled jumps so the HTTP poll doesn't re-fire
// a jump that was already handled by the WS handler moments before.
const recentJumps = new Map(); // key → timestamp
function markJumpHandled(key) {
  recentJumps.set(key, Date.now());
  // Clean up entries older than 10s to prevent unbounded growth
  for (const [k, t] of recentJumps) { if (Date.now() - t > 10000) recentJumps.delete(k); }
}
function wasJumpRecentlyHandled(key) {
  const t = recentJumps.get(key);
  return t && (Date.now() - t < 5000); // 5s window
}

// Helper function to check if URL is HTTP/HTTPS
function isHttpUrl(u) {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; }
}

// Normalize URL for comparison (remove trailing slashes, normalize protocol)
function normalizeUrlForMatch(urlStr) {
  try {
    const u = new URL(urlStr);
    // Normalize: lowercase host, remove trailing slash from pathname
    let normalized = `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
    // Include search params if present
    if (u.search) normalized += u.search;
    return normalized;
  } catch { return urlStr; }
}

// Open or focus URL in Chrome - improved matching to find existing tabs
async function openOrFocusUrlInChrome(url, tabId = null) {
  try {
    if (!url && !tabId) return;

    const all = await chrome.tabs.query({});

    // Priority 1: If tabId is provided, try to activate that tab directly
    if (tabId) {
      const tabById = all.find(t => t.id === tabId);
      if (tabById) {
        try { await chrome.tabs.update(tabById.id, { active: true }); } catch { }
        if (typeof tabById.windowId === 'number') {
          try { await chrome.windows.update(tabById.windowId, { focused: true }); } catch { }
        }
        return;
      }
    }

    if (!url) return;

    const targetNormalized = normalizeUrlForMatch(url);
    const targetUrl = new URL(url);

    // Priority 2: Exact URL match (normalized)
    let match = all.find(t => {
      try { return t.url && normalizeUrlForMatch(t.url) === targetNormalized; } catch { return false; }
    });

    // Priority 3: Match by origin + pathname (ignore query params)
    if (!match) {
      match = all.find(t => {
        try {
          const tabUrl = new URL(t.url);
          return tabUrl.origin === targetUrl.origin &&
            tabUrl.pathname.replace(/\/+$/, '') === targetUrl.pathname.replace(/\/+$/, '');
        } catch { return false; }
      });
    }

    if (match) {
      // Activate the existing tab and focus its window so the user sees it
      try { await chrome.tabs.update(match.id, { active: true }); } catch { }
      if (typeof match.windowId === 'number') {
        try { await chrome.windows.update(match.windowId, { focused: true }); } catch { }
      }
      return;
    }

    // No match found - create a new active tab and focus the window
    const created = await chrome.tabs.create({ url, active: true });
    if (created && typeof created.windowId === 'number') {
      try { await chrome.windows.update(created.windowId, { focused: true }); } catch { }
    }
  } catch (e) {
    console.warn('[Bridge] openOrFocusUrlInChrome failed:', e);
  }
}

// Redirect functionality
const redirectInFlight = new Set(); // guard per-tab to avoid loops

async function maybeRedirect(tabId, rawUrl) {
  if (!tabId || !rawUrl || redirectInFlight.has(tabId)) return;
  if (!isHttpUrl(rawUrl)) return;
  // Do not try to redirect our own extension pages
  if (rawUrl.startsWith(chrome.runtime.getURL(''))) return;
  try {
    redirectInFlight.add(tabId);
    const decision = await getRedirectDecision(rawUrl);
    const target = decision?.ok && typeof decision?.target === 'string' && decision.target ? decision.target : null;
    if (target && target !== rawUrl) {
      // Navigate without activating to keep it passive
      try { await chrome.tabs.update(tabId, { url: target, active: false }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  finally {
    // Slight delay to prevent immediate re-trigger in onUpdated
    setTimeout(() => redirectInFlight.delete(tabId), 300);
  }
}

// WebSocket and polling bridge state
let hostWs = null;
let hostWsConnected = false;
let hostWsReconnectTimer = null;
let hostWsReconnectDelay = 1500; // starts at 1.5s, doubles up to max
const HOST_WS_RECONNECT_MAX = 60000; // 60s

// HTTP polling fallback (reduced frequency for better performance)
let hostPollTimer = null;
const HOST_POLL_INTERVAL_MS = 2000; // Increased from 500ms to reduce CPU usage
// Cooldown to avoid hammering when backend is down
let hostCooldownUntil = 0; // epoch ms

async function pollOnceForAction() {
  if (!isHostSyncEnabled()) return;
  // Respect cooldown window
  if (Date.now() < hostCooldownUntil) return;
  try {
    const res = await fetch(`${getHostUrl()}/actions/next`);
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const action = data?.action;
    if (action && action.type === 'open' && (action.url || action.tabId)) {
      // Show the app tray first, then navigate/open the target tab
      try { await openOrFocusApp(); } catch { }
      await openOrFocusUrlInChrome(action.url, action.tabId);
    }
  } catch (e) {
    // If backend is unreachable, enter cooldown and stop polling temporarily
    hostCooldownUntil = Date.now() + 30000; // 30s cooldown
    try { ensureHostPolling(false); } catch { }
  }
}

function ensureHostPolling(active) {
  if (!isHostSyncEnabled()) { active = false; }
  if (active) {
    if (Date.now() < hostCooldownUntil) return; // don't start during cooldown
    if (!hostPollTimer) hostPollTimer = setInterval(() => { pollOnceForAction().catch(() => { }) }, HOST_POLL_INTERVAL_MS);
  } else {
    if (hostPollTimer) { clearInterval(hostPollTimer); hostPollTimer = null; }
  }
}

async function drainQueuedActionsOnConnect(maxLoops = 10) {
  // Drain any queued actions that were enqueued while WS was disconnected
  for (let i = 0; i < maxLoops; i++) {
    const before = performance.now();
    await pollOnceForAction();
    // Small break to avoid hammering server
    const elapsed = performance.now() - before;
    if (elapsed < 10) await new Promise(r => setTimeout(r, 10));
    // Heuristic: if no more actions, server returns null; pollOnceForAction will no-op. We break when two quick iterations did nothing.
  }
}

function startHostActionWS() {
  if (!isHostSyncEnabled()) return;
  try {
    if (hostWs && (hostWs.readyState === WebSocket.OPEN || hostWs.readyState === WebSocket.CONNECTING)) return;
    // Skip attempting WS during cooldown
    if (Date.now() < hostCooldownUntil) return;
    hostWs = new WebSocket(getWebSocketUrl());
    hostWs.onopen = () => {
      hostWsConnected = true;
      if (hostWsReconnectTimer) { clearTimeout(hostWsReconnectTimer); hostWsReconnectTimer = null; }
      // Reset backoff on successful connect
      hostWsReconnectDelay = 1500;
      hostCooldownUntil = 0;
      // Stop HTTP polling when WS is healthy
      ensureHostPolling(false);
      // Identify this client to the sidecar
      try { hostWs.send(JSON.stringify({ type: 'identify', client: 'bridge', deviceId: myDeviceId })); } catch { }
      // Drain any actions queued while offline
      drainQueuedActionsOnConnect().catch(() => { });
    };
    hostWs.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg && msg.type === 'action') {
          const a = msg.payload || {};
          const t = a.type || null;
          if (t === 'open') {
            const url = (a.payload && a.payload.url) || a.url || null;
            const tabId = (a.payload && a.payload.tabId) || a.tabId || null;
            if (url || tabId) {
              // Show the app tray first, then navigate/open the target tab
              try { await openOrFocusApp(); } catch { }
              await openOrFocusUrlInChrome(url, tabId);
            }
          }
        }

        if (msg && msg.type === 'request-tabs') {
          // Sidecar is asking for a fresh snapshot of all open tabs in this browser.
          // Respond via push-tabs so stale entries in the sidecar are overwritten.
          try {
            const allTabs = await chrome.tabs.query({});
            const isEdge = navigator.userAgent.includes('Edg/');
            const browser = isEdge ? 'edge' : 'chrome';
            const tabs = allTabs.map(t => ({
              id: t.id,
              url: t.url || '',
              title: t.title || '',
              favIconUrl: t.favIconUrl || null,
              windowId: t.windowId,
              _deviceId: myDeviceId,
              browser,
            }));
            if (hostWs && hostWs.readyState === WebSocket.OPEN) {
              hostWs.send(JSON.stringify({
                type: 'push-tabs',
                payload: { deviceId: myDeviceId, tabs },
              }));
            }
          } catch { /* service worker may lack tabs permission briefly */ }
        }

        if (msg && msg.type === 'jump-to-tab') {
          const { tabId, url, deviceId, browser } = msg.payload || {};
          if (deviceId && myDeviceId && deviceId !== myDeviceId) return;
          if (browser) {
            const isEdge = navigator.userAgent.includes('Edg/');
            const myBrowser = isEdge ? 'edge' : 'chrome';
            if (browser !== myBrowser) return;
          }
          if (!tabId && !url) return;
          const jumpKey = `${tabId}:${url || ''}`;
          if (wasJumpRecentlyHandled(jumpKey)) return;
          try {
            let tab = null;

            // 1. Fast path: direct tabId lookup with cross-browser URL guard
            if (tabId) {
              try {
                const candidate = await chrome.tabs.get(tabId);
                if (url && candidate?.url) {
                  if (candidate.url.split('?')[0] === url.split('?')[0]) tab = candidate;
                } else {
                  tab = candidate;
                }
              } catch { /* tabId stale or belongs to another browser */ }
            }

            // 2. URL fallback — stale tabId or wrong browser
            if (!tab && url) {
              const hostname = (() => { try { return new URL(url).hostname; } catch { return null; } })();
              if (hostname) {
                const matches = await chrome.tabs.query({ url: `*://${hostname}/*` });
                if (matches.length > 0) {
                  tab = matches.find(t => t.url?.split('?')[0] === url.split('?')[0]) || matches[0];
                }
              }
            }

            if (!tab) return;

            markJumpHandled(jumpKey);
            await chrome.tabs.update(tab.id, { active: true });
            if (tab.windowId) {
              // chrome.windows.update focuses the window on the same desktop.
              // For cross-desktop windows this is a no-op; the native focus path
              // (request-native-focus → SwitchToThisWindow) handles that case.
              try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { }
              try {
                const win = await chrome.windows.get(tab.windowId);
                const isEdge = navigator.userAgent.includes('Edg/');
                if (hostWs && hostWs.readyState === WebSocket.OPEN) {
                  hostWs.send(JSON.stringify({
                    type: 'request-native-focus',
                    payload: {
                      browser: isEdge ? 'msedge' : 'chrome',
                      bounds: { left: win.left, top: win.top, width: win.width, height: win.height },
                      tabId: tab.id,
                    }
                  }));
                }
              } catch { }
            }
          } catch { }
        }

        // After Rust completes the OS-level focus (SwitchToThisWindow + SetForegroundWindow),
        // it sends native-focus-done. We re-activate the tab here because Chrome may have
        // restored its previously-focused tab when the window was dragged across desktops.
        if (msg && msg.type === 'native-focus-done') {
          const { tabId: confirmedTabId, browser } = msg.payload || {};
          if (browser) {
            const isEdge = navigator.userAgent.includes('Edg/');
            const myBrowser = isEdge ? 'edge' : 'chrome';
            if (browser !== myBrowser) return;
          }
          if (confirmedTabId) {
            try {
              await chrome.tabs.update(confirmedTabId, { active: true });
            } catch { /* tab closed between jump and ack — safe to ignore */ }
          }
        }
      } catch { /* ignore malformed frames */ }
    };
    const scheduleReconnect = () => {
      hostWsConnected = false;
      if (hostWsReconnectTimer) return; // already scheduled
      // Backoff and also set a cooldown to pause polling during retry window
      const delay = Math.min(hostWsReconnectDelay, HOST_WS_RECONNECT_MAX);
      hostCooldownUntil = Date.now() + delay;
      hostWsReconnectTimer = setTimeout(() => {
        hostWsReconnectTimer = null;
        startHostActionWS();
      }, delay);
      // Exponential backoff for next attempt
      hostWsReconnectDelay = Math.min(hostWsReconnectDelay * 2, HOST_WS_RECONNECT_MAX);
      // While disconnected, keep a lightweight HTTP poller running to avoid missed opens
      ensureHostPolling(true);
    };
    hostWs.onclose = scheduleReconnect;
    hostWs.onerror = scheduleReconnect;
  } catch {
    // If construction fails, retry later
    if (!hostWsReconnectTimer) {
      const delay = Math.min(hostWsReconnectDelay, HOST_WS_RECONNECT_MAX);
      hostCooldownUntil = Date.now() + delay;
      hostWsReconnectTimer = setTimeout(() => {
        hostWsReconnectTimer = null;
        startHostActionWS();
      }, delay);
      hostWsReconnectDelay = Math.min(hostWsReconnectDelay * 2, HOST_WS_RECONNECT_MAX);
    }
  }
}

// HTTP fallback: poll /cmd/jump-next every 1s to catch jumps missed during WS suspension
async function pollOnceForJumpNext() {
  if (!isHostSyncEnabled()) return;
  try {
    const res = await fetch(`${getHostUrl()}/cmd/jump-next`);
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const action = data?.action;
    if (!action) return;
    const { tabId, windowId, url, deviceId, browser } = action;
    // Only handle if targeting this device (or broadcast to all)
    if (deviceId && myDeviceId && deviceId !== myDeviceId) return;
    // Only handle if targeting this browser (or broadcast to all)
    if (browser) {
      const isEdge = navigator.userAgent.includes('Edg/');
      const myBrowser = isEdge ? 'edge' : 'chrome';
      if (browser !== myBrowser) return;
    }
    if (!tabId && !url) return;
    // Skip if the WS handler already handled this jump (deduplication)
    const jumpKey = `${tabId}:${url || ''}`;
    if (wasJumpRecentlyHandled(jumpKey)) return;

    let tab = null;
    if (tabId) {
      try {
        const candidate = await chrome.tabs.get(tabId);
        if (url && candidate?.url) {
          if (candidate.url.split('?')[0] === url.split('?')[0]) tab = candidate;
        } else {
          tab = candidate;
        }
      } catch { /* stale tabId */ }
    }
    if (!tab && url) {
      const hostname = (() => { try { return new URL(url).hostname; } catch { return null; } })();
      if (hostname) {
        const matches = await chrome.tabs.query({ url: `*://${hostname}/*` });
        tab = matches.find(t => t.url?.split('?')[0] === url.split('?')[0]) || matches[0] || null;
      }
    }
    if (!tab) return;

    markJumpHandled(jumpKey);
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) {
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { }
      // Pass tab.id so native-focus-done can re-activate the correct tab
      try { await requestNativeFocus(tab.windowId, tab.id); } catch { }
    }
  } catch { /* sidecar unreachable */ }
}

let jumpPollTimer = null;
function ensureJumpPolling(active) {
  if (active) {
    if (!jumpPollTimer) jumpPollTimer = setInterval(() => { pollOnceForJumpNext().catch(() => {}); }, 1000);
  } else {
    if (jumpPollTimer) { clearInterval(jumpPollTimer); jumpPollTimer = null; }
  }
}

// Initialize bridge functionality
export function initializeBridge() {
  // Redirect when a new tab is created with a URL (or pendingUrl)
  chrome.tabs.onCreated.addListener((tab) => {
    const url = tab?.pendingUrl || tab?.url;
    if (url) maybeRedirect(tab.id, url);
  });

  // Redirect on updates when a navigational URL appears
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo?.url || tab?.pendingUrl || tab?.url;
    if (url) maybeRedirect(tabId, url);
  });

  // Start WebSocket bridge with HTTP polling fallback if enabled
  if (isHostSyncEnabled()) startHostActionWS();

  // Always poll for pending jump-to-tab actions via HTTP — reliable even when
  // the service worker was suspended and missed the WS push.
  if (isHostSyncEnabled()) ensureJumpPolling(true);
}

// Placeholder for openOrFocusApp function (would need to be defined based on your app structure)
async function openOrFocusApp() {
  // This would typically show/focus the main application window
  console.log('[Bridge] Opening/focusing app...');
}

// Send request-native-focus to sidecar so Tauri can focus the window at OS level.
// This handles virtual desktop switching which chrome.windows.update cannot do.
// Pass tabId so the sidecar can send native-focus-done back for tab re-activation.
export async function requestNativeFocus(windowId, tabId = null) {
  try {
    const win = await chrome.windows.get(windowId);
    const isEdge = typeof navigator !== 'undefined' && navigator.userAgent?.includes('Edg/');
    const browser = isEdge ? 'msedge' : 'chrome';
    if (hostWs && hostWs.readyState === WebSocket.OPEN) {
      hostWs.send(JSON.stringify({
        type: 'request-native-focus',
        payload: {
          browser,
          bounds: { left: win.left, top: win.top, width: win.width, height: win.height },
          tabId,
        }
      }));
    }
  } catch { /* sidecar not running or window bounds unavailable */ }
}

export { openOrFocusUrlInChrome, maybeRedirect };
