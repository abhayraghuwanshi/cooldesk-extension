// Host communication bridge (WebSocket, polling, redirects)
import { getRedirectDecision } from '../services/extensionApi.js';
import { isHostSyncEnabled, getHostUrl, getWebSocketUrl } from '../services/syncConfig.js';

// Helper function to check if URL is HTTP/HTTPS
function isHttpUrl(u) {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; }
}

// Open or focus URL in Chrome
async function openOrFocusUrlInChrome(url) {
  try {
    if (!url) return;
    const target = new URL(url).href;
    const all = await chrome.tabs.query({});
    const match = all.find(t => {
      try { return t.url && new URL(t.url).href === target; } catch { return false; }
    }) || null;
    if (match) {
      // Activate the existing tab and focus its window so the user sees it
      try { await chrome.tabs.update(match.id, { active: true }); } catch { }
      if (typeof match.windowId === 'number') {
        try { await chrome.windows.update(match.windowId, { focused: true }); } catch { }
      }
      return;
    }
    // Create a new active tab and focus the window
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

// HTTP polling fallback
let hostPollTimer = null;
const HOST_POLL_INTERVAL_MS = 500;
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
    if (action && action.type === 'open' && action.url) {
      // Show the app tray first, then navigate/open the target tab
      try { await openOrFocusApp(); } catch { }
      await openOrFocusUrlInChrome(action.url);
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
            if (url) {
              // Show the app tray first, then navigate/open the target tab
              try { await openOrFocusApp(); } catch { }
              await openOrFocusUrlInChrome(url);
            }
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
}

// Placeholder for openOrFocusApp function (would need to be defined based on your app structure)
async function openOrFocusApp() {
  // This would typically show/focus the main application window
  console.log('[Bridge] Opening/focusing app...');
}

export { openOrFocusUrlInChrome, maybeRedirect };
