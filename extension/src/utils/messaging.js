// Messaging utility that works in both Chrome extension and Electron environments

/**
 * Check if messaging is available
 * @returns {boolean} - True if messaging system is available
 */
function isMessagingAvailable() {
    // Chrome extension environment
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        return true;
    }

    // Electron environment - check for window.electronAPI or window.ipcRenderer
    if (typeof window !== 'undefined' && window.electronAPI) {
        return true;
    }

    // Electron with direct ipcRenderer access
    if (typeof window !== 'undefined' && window.require) {
        try {
            const { ipcRenderer } = window.require('electron');
            return !!ipcRenderer;
        } catch {
            return false;
        }
    }

    return false;
}

/**
 * Send a message to the background script or main process
 * @param {Object} message - The message to send
 * @returns {Promise} - Promise that resolves with the response
 */
export async function sendBackgroundMessage(message) {
    // Skip if no messaging system is available
    if (!isMessagingAvailable()) {
        console.log('Skipping message - no messaging system available:', message.action);
        return { ok: false, error: 'No messaging system available', skipped: true };
    }

    try {
        // Chrome extension environment
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });
        }

        // Electron environment - check for window.electronAPI or window.ipcRenderer
        if (typeof window !== 'undefined' && window.electronAPI) {
            return await window.electronAPI.sendMessage(message);
        }

        // Electron with direct ipcRenderer access
        if (typeof window !== 'undefined' && window.require) {
            const { ipcRenderer } = window.require('electron');
            return await ipcRenderer.invoke('background-message', message);
        }

    } catch (error) {
        console.error('Failed to send background message:', error);
        throw error;
    }
}

/**
 * Trigger auto-categorization
 * @returns {Promise} - Promise that resolves when categorization starts
 */
export async function triggerAutoCategorize() {
    return await sendBackgroundMessage({ action: 'aiAutoCategorize' });
}

/**
 * Populate dashboard data
 * @returns {Promise} - Promise that resolves when population starts
 */
export async function populateData() {
    return await sendBackgroundMessage({ action: 'populateData' });
}
