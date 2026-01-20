/* global chrome */

class NativeBridge {
    constructor() {
        this.port = null;
        this.listeners = [];
        this.isConnected = false;
        this.reconnectAttempts = 0;
    }

    connect() {
        try {
            console.log("Connecting to Native Host...");
            this.port = chrome.runtime.connectNative('com.cooldesk.sync');

            this.port.onMessage.addListener((msg) => {
                console.log("Received from host:", msg);
                this.listeners.forEach(callback => callback(msg));
            });

            this.port.onDisconnect.addListener(() => {
                console.log("Disconnected from Native Host", chrome.runtime.lastError);
                this.isConnected = false;
                this.port = null;
                // Optional: Auto-reconnect logic?
            });

            this.isConnected = true;
            // Send a ping to verify
            this.postMessage({ command: 'ping' });
            return true;
        } catch (e) {
            console.error("Failed to connect to native host:", e);
            return false;
        }
    }

    disconnect() {
        if (this.port) {
            this.port.disconnect();
            this.port = null;
            this.isConnected = false;
        }
    }

    postMessage(msg) {
        if (!this.port) {
            this.connect();
        }
        if (this.port) {
            try {
                this.port.postMessage(msg);
            } catch (e) {
                console.error("Error posting message:", e);
                this.isConnected = false;
            }
        }
    }

    onMessage(callback) {
        this.listeners.push(callback);
        // Return unsubscribe function
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }
}

// Singleton instance
const nativeBridge = new NativeBridge();
export default nativeBridge;
