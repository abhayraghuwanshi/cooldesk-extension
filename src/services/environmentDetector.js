/**
 * Environment Detector
 * Detects whether the app is running as a Chrome extension, Electron app, or browser app
 */

/**
 * Check if running in Electron app
 * @returns {boolean}
 */
export function isElectronApp() {
    if (typeof window === 'undefined') return false;

    // Check for electronAPI exposed by preload script or Tauri Shim
    if (window.electronAPI !== undefined) return true;

    // Check for Tauri (treat as Electron for app logic compatibility)
    if (window.__TAURI__ !== undefined || window.__TAURI_INTERNALS__ !== undefined) return true;

    // Check user agent for Electron
    if (navigator.userAgent.includes('Electron')) return true;

    // Check for Electron-specific globals
    if (typeof process !== 'undefined' && process.versions?.electron) return true;

    return false;
}

/**
 * Check if running as Chrome extension
 * @returns {boolean}
 */
export function isExtension() {
    if (typeof chrome === 'undefined') return false;

    // Check for extension runtime ID (only present in actual extensions)
    if (chrome.runtime?.id && !chrome.runtime.id.includes('electron')) return true;

    // Check for extension-specific APIs
    if (chrome.extension?.getBackgroundPage) return true;

    return false;
}

/**
 * Check if running as a regular browser app (not extension, not Electron)
 * @returns {boolean}
 */
export function isBrowserApp() {
    return !isElectronApp() && !isExtension();
}

/**
 * Get the current environment type
 * @returns {'electron' | 'extension' | 'browser'}
 */
export function getEnvironment() {
    if (isElectronApp()) return 'electron';
    if (isExtension()) return 'extension';
    return 'browser';
}

/**
 * Check if host sync is available
 * Host sync is available in extension mode when Electron app is running
 * @returns {boolean}
 */
export function isHostSyncAvailable() {
    // In Electron, always available via IPC
    if (isElectronApp()) return true;

    // In extension, check if host is reachable
    // This is determined by syncConfig, not here
    return isExtension();
}

/**
 * Get sync capabilities based on environment
 * @returns {object}
 */
export function getSyncCapabilities() {
    const env = getEnvironment();

    return {
        environment: env,
        // IPC sync (Electron only)
        ipcSync: env === 'electron',
        // HTTP sync (extension to Electron)
        httpSync: env === 'extension',
        // WebSocket sync (extension to Electron)
        wsSync: env === 'extension',
        // P2P sync (available in both)
        p2pSync: env !== 'browser',
        // Local storage
        localStorage: true,
        // IndexedDB
        indexedDB: true,
        // Chrome storage API
        chromeStorage: env === 'extension' || env === 'electron'
    };
}

// Log environment on load
if (typeof window !== 'undefined') {
    const env = getEnvironment();
    console.log(`[Environment] Running as: ${env}`);
}
