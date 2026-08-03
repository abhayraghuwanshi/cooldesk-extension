import { SIDECAR_HTTP, SIDECAR_WS } from '../shared/config/sidecar.js';
/**
 * Sync Configuration Service
 * Controls localhost HTTP sync functionality for the extension
 */

// Default sync configuration
const DEFAULT_SYNC_CONFIG = {
  enableHostSync: true,           // Master switch for localhost sync (enabled by default)
  hostUrl: SIDECAR_HTTP, // Host server URL
  websocketUrl: SIDECAR_WS, // WebSocket URL
  syncWorkspaces: true,           // Sync workspaces to host
  syncTabs: true,                // Sync tabs to host
  syncActivity: true,            // Sync activity to host
  syncSettings: true,            // Sync settings to host
  syncDashboard: true,           // Sync dashboard to host
  enableRedirects: false,        // Enable URL redirects
  enableHostActions: false,      // Enable host action queue
  retryAttempts: 3,              // HTTP retry attempts
  retryDelay: 1000,              // Initial retry delay (ms)
  timeout: 5000,                 // Request timeout (ms)
};

let syncConfig = { ...DEFAULT_SYNC_CONFIG };
let hostAvailable = null; // Cached host availability check

/**
 * Load sync configuration from storage
 */
export async function loadSyncConfig() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['syncConfig']);
      if (stored.syncConfig && typeof stored.syncConfig === 'object') {
        syncConfig = { ...DEFAULT_SYNC_CONFIG, ...stored.syncConfig };
      }
    }
  } catch (error) {
    console.warn('Failed to load sync config:', error);
  }
  return syncConfig;
}

/**
 * Save sync configuration to storage
 */
export async function saveSyncConfig(newConfig) {
  try {
    syncConfig = { ...syncConfig, ...newConfig };
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ syncConfig });
    }
  } catch (error) {
    console.warn('Failed to save sync config:', error);
  }
  return syncConfig;
}

/**
 * Get current sync configuration
 */
export function getSyncConfig() {
  return { ...syncConfig };
}

/**
 * Check if the Electron host server is reachable
 * Caches the result to avoid repeated health checks
 */
export async function checkHostAvailable(force = false) {
  // Return cached result if we checked recently (within 30 seconds).
  // `force` skips it — a user pressing Retry after starting the app should not
  // be answered from a cached failure for another 10 seconds.
  if (!force && hostAvailable !== null) {
    return hostAvailable;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${syncConfig.hostUrl}/health`, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeout);
    hostAvailable = res.ok;

    // Clear cache after 15 seconds for faster reconnection
    setTimeout(() => { hostAvailable = null; }, 15000);

    return hostAvailable;
  } catch {
    hostAvailable = false;
    // Clear cache after 10 seconds on failure (retry sooner)
    setTimeout(() => { hostAvailable = null; }, 10000);
    return false;
  }
}

/**
 * Check if host sync is enabled
 */
export function isHostSyncEnabled() {
  return syncConfig.enableHostSync;
}

/**
 * Check if specific sync feature is enabled
 */
export function isSyncFeatureEnabled(feature) {
  return syncConfig.enableHostSync && syncConfig[feature];
}

/**
 * Get host URL
 */
export function getHostUrl() {
  return syncConfig.hostUrl;
}

/**
 * Get WebSocket URL  
 */
export function getWebSocketUrl() {
  return syncConfig.websocketUrl;
}

/**
 * Get retry configuration
 */
export function getRetryConfig() {
  return {
    attempts: syncConfig.retryAttempts,
    delay: syncConfig.retryDelay,
    timeout: syncConfig.timeout,
  };
}

/**
 * Reset sync configuration to defaults
 */
export async function resetSyncConfig() {
  return await saveSyncConfig(DEFAULT_SYNC_CONFIG);
}

/**
 * Enable/disable host sync
 */
export async function toggleHostSync(enabled = true) {
  return await saveSyncConfig({ enableHostSync: enabled });
}

// Initialize config on import
loadSyncConfig();

/**
 * Detect browser type from user agent
 */
export function detectBrowser() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();

  // Brave ships Chrome's user agent verbatim (fingerprinting defence), so the
  // ua sniff below can never see it — `navigator.brave` is the only tell. This
  // matters beyond labelling: the id decides which executable the desktop app
  // hunts for, and calling Brave "chrome" makes it focus Chrome instead.
  if (typeof navigator.brave !== 'undefined') return 'brave';

  // Order matters - Edge includes "chrome" in UA, so check Edge first
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('opr/') || ua.includes('opera')) return 'opera';
  if (ua.includes('brave')) return 'brave';
  if (ua.includes('vivaldi')) return 'vivaldi';
  if (ua.includes('firefox')) return 'firefox';
  if (ua.includes('safari') && !ua.includes('chrome')) return 'safari';
  if (ua.includes('chrome')) return 'chrome';
  return 'browser';
}

// The same browser reaches us under several names: the deviceId prefix ("edge"),
// the executable name the native side wants ("msedge.exe"), and older builds that
// labelled every Chromium browser "chrome". Fold them onto one id before comparing.
const BROWSER_ALIASES = {
  msedge: 'edge',
  'microsoft edge': 'edge',
  chromium: 'chrome',
  'google chrome': 'chrome',
  'brave-browser': 'brave',
  opr: 'opera',
};

/** Canonical id for a browser name from any source ("msedge.exe" → "edge"). */
export function normalizeBrowserId(id) {
  const s = String(id || '').trim().toLowerCase().replace(/\.exe$/, '');
  return BROWSER_ALIASES[s] || s;
}

// Chromium browsers that older builds all reported as plain "chrome". Edge is
// excluded: it was always labelled "edge", so a "chrome" label never meant Edge.
const LEGACY_CHROME_LABEL_COVERS = ['chrome', 'brave', 'vivaldi', 'opera', 'arc'];

/**
 * Could a jump labelled `a` be meant for a browser identifying as `b`?
 *
 * Deliberately permissive, because this label is a weak routing key: jumps
 * arrive with `deviceId=None`, and tabs pushed by an older build labelled every
 * Chromium browser "chrome". Dropping on a label mismatch silently kills the
 * jump; letting it through only risks acting on a colliding tab id, and the
 * caller already verifies the url in exactly this ambiguous case.
 */
export function browsersMatch(a, b) {
  const x = normalizeBrowserId(a);
  const y = normalizeBrowserId(b);
  const vague = v => !v || v === 'browser' || v === 'unknown' || v === 'other';
  if (vague(x) || vague(y)) return true;
  if (x === y) return true;
  // Legacy coarse label: "chrome" may stand for any non-Edge Chromium browser
  if (x === 'chrome' && LEGACY_CHROME_LABEL_COVERS.includes(y)) return true;
  if (y === 'chrome' && LEGACY_CHROME_LABEL_COVERS.includes(x)) return true;
  return false;
}

/**
 * Get or generate a unique device ID for this extension instance
 * Format: {browser}-{randomId} e.g., "chrome-abc123def456" or "edge-xyz789"
 */
let _deviceId = null;
export async function getDeviceId() {
  if (_deviceId) return _deviceId;

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['deviceId']);
      if (stored.deviceId) {
        // Migrate old "ext-*" format to new browser-prefixed format
        if (stored.deviceId.startsWith('ext-')) {
          const browser = detectBrowser();
          const oldRandom = stored.deviceId.substring(4); // Remove 'ext-' prefix
          _deviceId = `${browser}-${oldRandom}`;
          await chrome.storage.local.set({ deviceId: _deviceId });
          console.log('[SyncConfig] Migrated deviceId from', stored.deviceId, 'to', _deviceId);
        } else {
          _deviceId = stored.deviceId;
        }
      } else {
        // Generate new ID with browser prefix for better identification
        const browser = detectBrowser();
        _deviceId = `${browser}-${Math.random().toString(36).substring(2, 15)}`;
        await chrome.storage.local.set({ deviceId: _deviceId });
        console.log('[SyncConfig] Generated new deviceId:', _deviceId);
      }
    } else {
      // Fallback for non-extension env (e.g. electron renderer test)
      if (!_deviceId) {
        const browser = detectBrowser();
        _deviceId = `${browser}-dev-${Math.random().toString(36).substring(2, 15)}`;
      }
    }
  } catch (e) {
    console.warn('Failed to get device ID:', e);
    // Fallback ephemeral ID
    if (!_deviceId) {
      const browser = detectBrowser();
      _deviceId = `${browser}-temp-${Math.random().toString(36).substring(2, 15)}`;
    }
  }
  return _deviceId;
}