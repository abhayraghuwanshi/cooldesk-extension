/**
 * Sync Configuration Service
 * Controls localhost HTTP sync functionality for the extension
 */

// Default sync configuration
const DEFAULT_SYNC_CONFIG = {
  enableHostSync: false,          // Master switch for localhost sync
  hostUrl: 'http://127.0.0.1:4000', // Host server URL
  websocketUrl: 'ws://127.0.0.1:4000', // WebSocket URL
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