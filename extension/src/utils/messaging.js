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
            // Check if runtime is still connected before sending
            if (!chrome.runtime?.id) {
                console.log('Extension context invalidated, skipping message:', message.action);
                return { ok: false, error: 'Extension context invalidated', skipped: true };
            }

            return new Promise((resolve, reject) => {
                try {
                    chrome.runtime.sendMessage(message, (response) => {
                        // Check chrome.runtime.lastError immediately to prevent unchecked error
                        const lastError = chrome.runtime.lastError;
                        if (lastError) {
                            const error = lastError.message;
                            console.warn(`Background connection failed for ${message.action || 'unknown'}:`, error);
                            
                            // Handle specific connection errors gracefully
                            if (error.includes('Could not establish connection') || 
                                error.includes('Receiving end does not exist') ||
                                error.includes('Extension context invalidated')) {
                                resolve({ ok: false, error: 'Background script unavailable', skipped: true });
                                return;
                            }
                            
                            resolve({ ok: false, error: error, skipped: true });
                        } else {
                            resolve(response || { ok: true });
                        }
                    });
                } catch (sendError) {
                    console.warn(`Failed to send message for ${message.action || 'unknown'}:`, sendError);
                    resolve({ ok: false, error: 'Message send failed', skipped: true });
                }
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
