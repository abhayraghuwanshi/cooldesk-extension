/**
 * Sync Configuration Service
 * Controls localhost HTTP sync functionality for the extension
 */

// Default sync configuration
const DEFAULT_SYNC_CONFIG = {
  enableHostSync: true,           // Master switch for localhost sync (enabled by default)
  hostUrl: 'http://127.0.0.1:4545', // Host server URL
  websocketUrl: 'ws://127.0.0.1:4545', // WebSocket URL
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
export async function checkHostAvailable() {
  // Return cached result if we checked recently (within 30 seconds)
  if (hostAvailable !== null) {
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
function detectBrowser() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();

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