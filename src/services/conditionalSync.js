/**
 * Conditional Sync Service
 * Wraps extensionApi calls with sync configuration checks
 */

import { 
  isHostSyncEnabled, 
  isSyncFeatureEnabled, 
  getHostUrl, 
  getWebSocketUrl, 
  getRetryConfig 
} from './syncConfig.js';

// Import all extensionApi functions
import * as extensionApi from './extensionApi.js';

/**
 * Conditional wrapper for host sync calls
 * Returns no-op results when sync is disabled
 */
function createConditionalWrapper(syncFeature, originalFn) {
  return async function(...args) {
    if (!isSyncFeatureEnabled(syncFeature)) {
      // Return success response without making HTTP call
      return { ok: true, disabled: true };
    }
    
    try {
      return await originalFn.apply(this, args);
    } catch (error) {
      console.warn(`Conditional sync error for ${syncFeature}:`, error);
      return { ok: false, error: String(error?.message || error), disabled: false };
    }
  };
}

/**
 * Conditional wrapper for basic host calls
 */
function createBasicConditionalWrapper(originalFn) {
  return async function(...args) {
    if (!isHostSyncEnabled()) {
      return { ok: true, disabled: true };
    }
    
    try {
      return await originalFn.apply(this, args);
    } catch (error) {
      console.warn('Conditional sync error:', error);
      return { ok: false, error: String(error?.message || error), disabled: false };
    }
  };
}

// Export wrapped functions for host sync operations
export const setHostWorkspaces = createConditionalWrapper('syncWorkspaces', extensionApi.setHostWorkspaces);
export const getHostWorkspaces = createConditionalWrapper('syncWorkspaces', extensionApi.getHostWorkspaces);

export const setHostTabs = createConditionalWrapper('syncTabs', extensionApi.setHostTabs);
export const getHostTabs = createConditionalWrapper('syncTabs', extensionApi.getHostTabs);

export const setHostActivity = createConditionalWrapper('syncActivity', extensionApi.setHostActivity);
export const getHostActivity = createConditionalWrapper('syncActivity', extensionApi.getHostActivity);

export const setHostSettings = createConditionalWrapper('syncSettings', extensionApi.setHostSettings);
export const getHostSettings = createConditionalWrapper('syncSettings', extensionApi.getHostSettings);

export const setHostDashboard = createConditionalWrapper('syncDashboard', extensionApi.setHostDashboard);
export const getHostDashboard = createConditionalWrapper('syncDashboard', extensionApi.getHostDashboard);

export const setHostUrls = createConditionalWrapper('syncWorkspaces', extensionApi.setHostUrls);
export const getHostUrls = createConditionalWrapper('syncWorkspaces', extensionApi.getHostUrls);

// URL actions (redirects, opening)
export const getRedirectDecision = createConditionalWrapper('enableRedirects', extensionApi.getRedirectDecision);
export const enqueueOpenInChrome = createConditionalWrapper('enableHostActions', extensionApi.enqueueOpenInChrome);
export const openExternalUrl = createConditionalWrapper('enableHostActions', extensionApi.openExternalUrl);

// System operations
export const focusWindow = createBasicConditionalWrapper(extensionApi.focusWindow);
export const getProcesses = createBasicConditionalWrapper(extensionApi.getProcesses);

// Pass through non-host functions unchanged
export const {
  hasChrome,
  hasRuntime, 
  hasStorage,
  onMessage,
  sendMessage,
  storageGet,
  storageGetWithTTL,
  storageSetWithTTL,
  storageSet,
  storageRemove,
  tabs,
  windows,
  openOptionsPage
} = extensionApi;

/**
 * Check if a function will actually sync to host
 */
export function willSyncToHost(feature) {
  return isSyncFeatureEnabled(feature);
}

/**
 * Get sync status information
 */
export function getSyncStatus() {
  return {
    hostSyncEnabled: isHostSyncEnabled(),
    workspaces: isSyncFeatureEnabled('syncWorkspaces'),
    tabs: isSyncFeatureEnabled('syncTabs'),
    activity: isSyncFeatureEnabled('syncActivity'),
    settings: isSyncFeatureEnabled('syncSettings'),
    dashboard: isSyncFeatureEnabled('syncDashboard'),
    redirects: isSyncFeatureEnabled('enableRedirects'),
    actions: isSyncFeatureEnabled('enableHostActions'),
    hostUrl: getHostUrl(),
    websocketUrl: getWebSocketUrl(),
  };
}