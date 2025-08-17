// Unified service to abstract Chrome extension APIs vs non-extension (app) context
// Usage:
//   import { hasRuntime, sendMessage, onMessage, tabs } from '../services/extensionApi'
//   const resp = await sendMessage({ action: 'getTimeSpent' })

// --- Minimal WebSocket client to talk to the Electron host ---
let _ws = null;
let _wsConnected = false;
let _wsListeners = [];

function ensureWS() {
  if (_ws && (_ws.readyState === WebSocket.CONNECTING || _ws.readyState === WebSocket.OPEN)) return;
  try {
    _ws = new WebSocket('ws://127.0.0.1:4000');
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
  };
}

function wsSend(type, payload) {
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
  try {
    const res = await fetch('http://127.0.0.1:4000/actions/open', {
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
  try {
    const payload = Array.isArray(tabs) ? tabs : (tabs?.tabs || []);
    const res = await fetch('http://127.0.0.1:4000/tabs', {
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
  try {
    const res = await fetch('http://127.0.0.1:4000/tabs');
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => []);
    return { ok: true, tabs: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), tabs: [] };
  }
}

// --- Host Workspaces helpers ---
export async function getHostWorkspaces() {
  try {
    const res = await fetch('http://127.0.0.1:4000/workspaces');
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => []);
    return { ok: true, workspaces: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function setHostWorkspaces(list) {
  try {
    const res = await fetch('http://127.0.0.1:4000/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Array.isArray(list) ? list : []),
    });
    return res.status === 204 ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// --- Host sync helpers (Electron app API) ---
export async function setHostSettings(settings) {
  try {
    const res = await fetch('http://127.0.0.1:4000/settings', {
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
  try {
    const res = await fetch('http://127.0.0.1:4000/settings');
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, settings: data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function setHostDashboard(dashboard) {
  try {
    const res = await fetch('http://127.0.0.1:4000/dashboard', {
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
  try {
    const res = await fetch('http://127.0.0.1:4000/dashboard');
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
  try {
    const q = encodeURIComponent(url);
    const res = await fetch(`http://127.0.0.1:4000/redirect?url=${q}`);
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
    const res = await fetch('http://127.0.0.1:4000/tabs/open', {
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
    const res = await fetch('http://127.0.0.1:4000/focus', {
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
  return new Promise((resolve) => {
    // If runtime is missing, resolve to a standard error shape but never throw here
    if (!hasRuntime()) return resolve({ ok: false, error: 'Chrome runtime not available' });

    const timer = setTimeout(() => resolve({ ok: false, error: 'Timed out waiting for background response' }), timeoutMs);
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        clearTimeout(timer);
        const lastErr = chrome.runtime?.lastError;
        if (lastErr) return resolve({ ok: false, error: lastErr.message || 'Service worker unavailable' });
        // Normalize to an object to avoid undefined surprises
        resolve(res ?? { ok: false, error: 'No response' });
      });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, error: String(e?.message || e) });
    }
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
    const res = await fetch('http://127.0.0.1:4000/processes', { method: 'GET' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
