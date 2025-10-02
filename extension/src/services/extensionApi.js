// Unified service to abstract Chrome extension APIs vs non-extension (app) context
// Usage:
//   import { hasRuntime, sendMessage, onMessage, tabs } from '../services/extensionApi'
//   const resp = await sendMessage({ action: 'getTimeSpent' })

import { isHostSyncEnabled, getHostUrl, getWebSocketUrl } from './syncConfig';

// --- Minimal WebSocket client to talk to the Electron host (gated by sync config) ---
let _ws = null;
let _wsConnected = false;
let _wsListeners = [];
let _wsPersistent = [];

function ensureWS() {
  if (!isHostSyncEnabled()) return; // disabled: never attempt WS
  if (_ws && (_ws.readyState === WebSocket.CONNECTING || _ws.readyState === WebSocket.OPEN)) return;
  try {
    _ws = new WebSocket(getWebSocketUrl());
  } catch {
    return;
  }
  _wsConnected = false;
  _ws.onopen = () => {
    _wsConnected = true;
    try { _ws.send(JSON.stringify({ type: 'request.state' })); } catch { }
  };
  _ws.onclose = () => {
    _wsConnected = false;
    setTimeout(() => ensureWS(), 1500);
  };
  _ws.onerror = () => { /* ignore */ };
  _ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    const type = msg?.type;
    if (!type) return;
    // dispatch to one-shot listeners first
    const remaining = [];
    for (const l of _wsListeners) {
      if (l.type === type) {
        try { l.resolve(msg.payload); } catch { }
      } else {
        remaining.push(l);
      }
    }
    _wsListeners = remaining;
    // notify persistent subscribers
    if (Array.isArray(_wsPersistent) && _wsPersistent.length) {
      for (const sub of _wsPersistent) {
        try {
          if (sub.type === '*' || sub.type === type) sub.handler(type, msg.payload);
        } catch { /* ignore */ }
      }
    }
  };
}

function wsSend(type, payload) {
  if (!isHostSyncEnabled()) return false; // disabled
  try {
    ensureWS();
    if (_wsConnected && _ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type, payload }));
      return true;
    }
  } catch { }
  return false;
}

function waitFor(type, timeoutMs = 2000) {
  if (!isHostSyncEnabled()) return Promise.reject(new Error('Host sync disabled'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // remove listener on timeout
      _wsListeners = _wsListeners.filter((l) => l !== listener);
      reject(new Error('Timed out'));
    }, timeoutMs);
    const listener = { type, resolve: (payload) => { clearTimeout(timer); resolve(payload); } };
    _wsListeners.push(listener);
  });
}

export function hasChrome() {
  return typeof chrome !== 'undefined' && !!chrome;
}

// Ask the host to enqueue an action for the Chrome extension to open/focus a URL
export async function enqueueOpenInChrome(url) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'Invalid url' };
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    const res = await fetch(`${getHostUrl()}/actions/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (res.status === 204) return { ok: true };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return data?.ok ? data : { ok: false, error: data?.error || 'Failed to enqueue action' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// --- Host Tabs helpers ---
export async function setHostTabs(tabs) {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    const payload = Array.isArray(tabs) ? tabs : (tabs?.tabs || []);
    const res = await fetch(`${getHostUrl()}/tabs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.status === 204 ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function getHostTabs() {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled', tabs: [] };
  try {
    const res = await fetch(`${getHostUrl()}/tabs`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => []);
    return { ok: true, tabs: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), tabs: [] };
  }
}

// --- Host Workspaces helpers ---
export async function getHostWorkspaces() {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    const res = await fetch(`${getHostUrl()}/workspaces`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => []);
    return { ok: true, workspaces: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function setHostWorkspaces(list) {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    const res = await fetch(`${getHostUrl()}/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Array.isArray(list) ? list : []),
    });
    return res.status === 204 ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// --- Host URLs helpers ---
export async function setHostUrls(list) {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    // Accept either an array of URL docs or { urls: [...] }
    const payload = Array.isArray(list) ? list : (Array.isArray(list?.urls) ? list.urls : []);
    const res = await fetch(`${getHostUrl()}/urls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.status === 204 ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function getHostUrls() {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled', urls: [] };
  try {
    const res = await fetch(`${getHostUrl()}/urls`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => []);
    return { ok: true, urls: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), urls: [] };
  }
}

// --- Host Activity helpers ---
export async function setHostActivity(rows) {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    const payload = Array.isArray(rows) ? rows : (Array.isArray(rows?.rows) ? rows.rows : (rows && rows.url ? [rows] : []));
    if (!Array.isArray(payload)) return { ok: false, error: 'Invalid payload' };
    const res = await fetch(`${getHostUrl()}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.status === 204 ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function getHostActivity(sinceMs) {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled', rows: [] };
  try {
    const q = Number.isFinite(Number(sinceMs)) ? `?since=${Number(sinceMs)}` : '';
    const res = await fetch(`${getHostUrl()}/activity${q}`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, rows: [] };
    const data = await res.json().catch(() => []);
    return { ok: true, rows: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), rows: [] };
  }
}

// --- Host sync helpers (Electron app API) ---
export async function setHostSettings(settings) {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    const res = await fetch(`${getHostUrl()}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings || {}),
    });
    return res.status === 204 ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function getHostSettings() {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    const res = await fetch(`${getHostUrl()}/settings`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, settings: data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function setHostDashboard(dashboard) {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    const res = await fetch(`${getHostUrl()}/dashboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dashboard || {}),
    });
    return res.status === 204 ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function getHostDashboard() {
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    const res = await fetch(`${getHostUrl()}/dashboard`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, dashboard: data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Ask the Electron host if a URL should be redirected before opening.
// Expected host response shape: { ok: boolean, target?: string }
export async function getRedirectDecision(url) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'Invalid url' };
  if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
  try {
    const q = encodeURIComponent(url);
    const res = await fetch(`${getHostUrl()}/redirect?url=${q}`);
    if (res.status === 204) return { ok: true, target: null };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    const target = typeof data?.target === 'string' && data.target ? data.target : null;
    return { ok: true, target };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Open a URL in the system default browser (Electron app mode)
export async function openExternalUrl(url) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'Invalid url' };
  try {
    // Prefer WS command handled by host
    if (wsSend('open', { url })) {
      // No result required; host will open asynchronously
      return { ok: true };
    }
  } catch { }
  try {
    if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
    const res = await fetch(`${getHostUrl()}/tabs/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return data?.ok ? data : { ok: false, error: data?.error || 'Failed to open URL' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Focus a window by PID (Electron app mode)
export async function focusWindow(pid) {
  const id = Number(pid);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Invalid pid' };
  try {
    if (typeof window !== 'undefined' && window.api?.focusWindow) {
      const res = await window.api.focusWindow(id);
      return res?.ok ? res : { ok: false, error: res?.error || 'Unknown error' };
    }
  } catch { /* fall through to HTTP */ }

  // Try WebSocket first
  try {
    if (wsSend('focus.pid', { pid: id })) {
      const resp = await waitFor('focus.result', 2000).catch(() => null);
      if (resp && resp.ok) return { ok: true };
      if (resp && resp.error) return { ok: false, error: resp.error };
    }
  } catch { /* fall through to HTTP */ }

  try {
    if (!isHostSyncEnabled()) return { ok: false, error: 'Host sync disabled' };
    const res = await fetch(`${getHostUrl()}/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: id }),
    });
    if (res.status === 204) return { ok: true };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return data?.ok ? data : { ok: false, error: data?.error || 'Failed' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export function hasRuntime() {
  return hasChrome() && !!(chrome.runtime && chrome.runtime.sendMessage);
}

export function hasStorage() {
  return hasChrome() && !!chrome.storage?.local;
}

export const onMessage = {
  add(listener) {
    if (hasChrome() && chrome.runtime?.onMessage?.addListener) {
      try { chrome.runtime.onMessage.addListener(listener); } catch { }
    }
  },
  remove(listener) {
    if (hasChrome() && chrome.runtime?.onMessage?.removeListener) {
      try { chrome.runtime.onMessage.removeListener(listener); } catch { }
    }
  },
};

// Safe sendMessage with timeout + lastError handling
export function sendMessage(msg, { timeoutMs = 5000 } = {}) {
  function once() {
    return new Promise((resolve) => {
      if (!hasRuntime()) return resolve({ ok: false, error: 'Chrome runtime not available' });
      const timer = setTimeout(() => resolve({ ok: false, error: 'Timed out waiting for background response' }), timeoutMs);
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          clearTimeout(timer);
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) return resolve({ ok: false, error: lastErr.message || 'Service worker unavailable' });
          resolve(res ?? { ok: false, error: 'No response' });
        });
      } catch (e) {
        clearTimeout(timer);
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  }

  return once().then(async (res) => {
    // Retry once if receiving end is missing (service worker cold start / reload)
    const msgText = String(res?.error || '').toLowerCase();
    if (msgText.includes('receiving end does not exist') || msgText.includes('could not establish connection')) {
      await new Promise((r) => setTimeout(r, 400));
      return once();
    }
    return res;
  });
}

// Storage helpers (safe)
export async function storageGet(keys) {
  if (!hasStorage()) return {};
  try {
    return await chrome.storage.local.get(keys);
  } catch {
    return {};
  }
}

// Cache TTL helpers
export async function storageGetWithTTL(key, ttlMs = 30 * 60 * 1000) { // 30 min default
  if (!hasStorage()) return { data: null, expired: true };
  try {
    const result = await chrome.storage.local.get([key, `${key}_timestamp`]);
    const data = result[key];
    const timestamp = result[`${key}_timestamp`];
    const now = Date.now();
    const expired = !timestamp || (now - timestamp) > ttlMs;
    return { data: expired ? null : data, expired };
  } catch {
    return { data: null, expired: true };
  }
}

export async function storageSetWithTTL(key, data) {
  if (!hasStorage()) return false;
  try {
    const timestamp = Date.now();
    await chrome.storage.local.set({ 
      [key]: data, 
      [`${key}_timestamp`]: timestamp 
    });
    return true;
  } catch {
    return false;
  }
}

export async function storageSet(obj) {
  if (!hasStorage()) return false;
  try {
    await chrome.storage.local.set(obj);
    return true;
  } catch {
    return false;
  }
}

export async function storageRemove(keys) {
  if (!hasStorage()) return false;
  try {
    await chrome.storage.local.remove(keys);
    return true;
  } catch {
    return false;
  }
}

// Tabs/windows helpers (safe, no-ops if unavailable)
export const tabs = {
  async query(queryInfo = {}) {
    if (!(hasChrome() && chrome.tabs?.query)) return { ok: false, error: 'chrome.tabs not available', tabs: [] };
    return new Promise((resolve) => {
      try {
        chrome.tabs.query(queryInfo, (list) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) return resolve({ ok: false, error: lastErr.message || 'Unable to query tabs', tabs: [] });
          resolve({ ok: true, tabs: Array.isArray(list) ? list : [] });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e), tabs: [] });
      }
    });
  },
  async update(tabId, updateProps) {
    if (!(hasChrome() && chrome.tabs?.update)) return { ok: false, error: 'chrome.tabs.update not available' };
    return new Promise((resolve) => {
      try {
        chrome.tabs.update(tabId, updateProps, () => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) return resolve({ ok: false, error: lastErr.message || 'Failed to update tab' });
          resolve({ ok: true });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  },
  async create(createProps) {
    if (!(hasChrome() && chrome.tabs?.create)) return { ok: false, error: 'chrome.tabs.create not available' };
    return new Promise((resolve) => {
      try {
        chrome.tabs.create(createProps, () => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) return resolve({ ok: false, error: lastErr.message || 'Failed to create tab' });
          resolve({ ok: true });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  },
};

export const windows = {
  async update(windowId, updateProps) {
    if (!(hasChrome() && chrome.windows?.update)) return { ok: false, error: 'chrome.windows.update not available' };
    return new Promise((resolve) => {
      try {
        chrome.windows.update(windowId, updateProps, () => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) return resolve({ ok: false, error: lastErr.message || 'Failed to update window' });
          resolve({ ok: true });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  },
};

export async function openOptionsPage() {
  if (!(hasChrome() && chrome.runtime?.openOptionsPage)) return { ok: false, error: 'openOptionsPage not available' };
  try {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Fetch running processes/apps from host (Electron app mode)
export async function getProcesses() {
  try {
    // Prefer preload-exposed bridge if available
    if (typeof window !== 'undefined' && window.api?.getProcesses) {
      const data = await window.api.getProcesses();
      return Array.isArray(data) ? data : [];
    }
  } catch { /* fall through to HTTP */ }

  // Try WebSocket request/response
  try {
    if (wsSend('request.processes')) {
      const list = await waitFor('processes', 2000).catch(() => null);
      if (Array.isArray(list)) return list;
    }
  } catch { /* fall through to HTTP */ }

  try {
    if (!isHostSyncEnabled()) return [];
    const res = await fetch(`${getHostUrl()}/processes`, { method: 'GET' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
