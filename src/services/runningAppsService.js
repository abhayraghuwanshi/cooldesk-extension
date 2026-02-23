/**
 * Centralized service for running apps data
 * Prevents multiple components from making redundant API calls
 * Uses the unified database for installed apps (rarely change) and in-memory cache for running apps
 */

import { getUnifiedDB, DB_CONFIG } from '../db/unified-db.js';

// Cache key for installed apps in the unified DB
const INSTALLED_APPS_KEY = 'installed_apps_cache';
const INSTALLED_APPS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours - installed apps rarely change

class RunningAppsService {
    constructor() {
        this.cache = {
            runningApps: [],
            installedApps: [],
            lastRunningFetch: 0,
            installedAppsLoaded: false
        };

        // Running apps cache - short TTL since they change frequently
        this.RUNNING_CACHE_TTL_MS = 3000; // 3 seconds
        this.POLL_INTERVAL_MS = 15000; // 15 seconds between polls

        this.subscribers = new Set();
        this.pollInterval = null;
        this.isFetching = false;
        this.fetchPromise = null;
    }

    /**
     * Get installed apps from unified database cache (uses DASHBOARD store for app-specific data)
     */
    async getInstalledAppsFromDB() {
        try {
            const db = await getUnifiedDB();
            const tx = db.transaction(DB_CONFIG.STORES.DASHBOARD, 'readonly');
            const store = tx.objectStore(DB_CONFIG.STORES.DASHBOARD);

            return new Promise((resolve) => {
                const request = store.get(INSTALLED_APPS_KEY);

                request.onsuccess = () => {
                    const data = request.result;
                    if (data && data.apps && (Date.now() - data.timestamp) < INSTALLED_APPS_TTL_MS) {
                        resolve(data.apps);
                    } else {
                        resolve(null); // Expired or not found
                    }
                };

                request.onerror = () => resolve(null);
            });
        } catch (e) {
            console.warn('[RunningAppsService] Failed to read from unified DB:', e);
            return null;
        }
    }

    /**
     * Save installed apps to unified database
     */
    async saveInstalledAppsToDB(apps) {
        if (!Array.isArray(apps)) return;

        try {
            const db = await getUnifiedDB();
            const tx = db.transaction(DB_CONFIG.STORES.DASHBOARD, 'readwrite');
            const store = tx.objectStore(DB_CONFIG.STORES.DASHBOARD);

            return new Promise((resolve) => {
                const request = store.put({
                    id: INSTALLED_APPS_KEY,
                    apps: apps,
                    timestamp: Date.now()
                });

                request.onsuccess = () => resolve(true);
                request.onerror = () => resolve(false);
            });
        } catch (e) {
            console.warn('[RunningAppsService] Failed to save to unified DB:', e);
            return false;
        }
    }

    /**
     * Subscribe to running apps updates
     * @param {Function} callback - Called with { runningApps, installedApps }
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
        this.subscribers.add(callback);

        // Start polling when first subscriber joins
        if (this.subscribers.size === 1) {
            this.startPolling();
        }

        // Immediately send cached data if available
        if (this.cache.runningApps.length > 0 || this.cache.installedApps.length > 0) {
            callback({
                runningApps: this.cache.runningApps,
                installedApps: this.cache.installedApps
            });
        }

        // Load installed apps from DB first (instant), then fetch running apps
        this.loadInstalledAppsAndNotify().then(() => {
            // Only fetch running apps (installed apps already loaded from DB)
            this.fetchRunningApps();
        });

        // Return unsubscribe function
        return () => {
            this.subscribers.delete(callback);

            // Stop polling when no subscribers
            if (this.subscribers.size === 0) {
                this.stopPolling();
            }
        };
    }

    /**
     * Load installed apps from unified DB and notify subscribers instantly
     */
    async loadInstalledAppsAndNotify() {
        // Skip if already loaded
        if (this.cache.installedAppsLoaded) return;

        const cachedApps = await this.getInstalledAppsFromDB();
        if (cachedApps && cachedApps.length > 0) {
            this.cache.installedApps = cachedApps;
            this.cache.installedAppsLoaded = true;
            console.log('[RunningAppsService] Loaded', cachedApps.length, 'installed apps from unified DB');
            this.notifySubscribers();
        }
    }

    /**
     * Fetch only running apps (used during polling)
     */
    async fetchRunningApps() {
        // Check if electronAPI is available
        if (!window.electronAPI?.getRunningApps) {
            return;
        }

        try {
            const runningApps = await window.electronAPI.getRunningApps();
            this.cache.runningApps = Array.isArray(runningApps) ? runningApps : [];
            this.cache.lastRunningFetch = Date.now();
            this.notifySubscribers();
        } catch (error) {
            console.error('[RunningAppsService] Failed to fetch running apps:', error);
        }
    }

    /**
     * Get apps with caching - returns cached data if fresh, else fetches
     * @returns {Promise<{runningApps: Array, installedApps: Array}>}
     */
    async getApps() {
        const now = Date.now();

        // Return cached data if still fresh
        if (now - this.cache.lastRunningFetch < this.RUNNING_CACHE_TTL_MS) {
            return {
                runningApps: this.cache.runningApps,
                installedApps: this.cache.installedApps
            };
        }

        // Fetch fresh data
        return this.fetchApps();
    }

    /**
     * Force fetch all apps (coalesces concurrent calls)
     * @returns {Promise<{runningApps: Array, installedApps: Array}>}
     */
    async fetchApps() {
        // If already fetching, return existing promise to coalesce calls
        if (this.isFetching && this.fetchPromise) {
            return this.fetchPromise;
        }

        // Check if electronAPI is available
        if (!window.electronAPI?.getRunningApps) {
            return { runningApps: [], installedApps: [] };
        }

        this.isFetching = true;

        this.fetchPromise = (async () => {
            try {
                // Fetch both types in parallel
                const [runningApps, installedApps] = await Promise.all([
                    window.electronAPI.getRunningApps(),
                    window.electronAPI.getInstalledApps?.() || []
                ]);

                // Update cache
                this.cache.runningApps = Array.isArray(runningApps) ? runningApps : [];
                const newInstalledApps = Array.isArray(installedApps) ? installedApps : [];

                // Only update and save installed apps if they changed
                if (JSON.stringify(newInstalledApps) !== JSON.stringify(this.cache.installedApps)) {
                    this.cache.installedApps = newInstalledApps;
                    // Save to unified DB for persistence
                    this.saveInstalledAppsToDB(newInstalledApps);
                }

                this.cache.lastRunningFetch = Date.now();
                this.cache.installedAppsLoaded = true;

                // Notify subscribers
                this.notifySubscribers();

                return {
                    runningApps: this.cache.runningApps,
                    installedApps: this.cache.installedApps
                };
            } catch (error) {
                console.error('[RunningAppsService] Failed to fetch apps:', error);
                return {
                    runningApps: this.cache.runningApps,
                    installedApps: this.cache.installedApps
                };
            } finally {
                this.isFetching = false;
                this.fetchPromise = null;
            }
        })();

        return this.fetchPromise;
    }

    /**
     * Notify all subscribers of updated data
     */
    notifySubscribers() {
        const data = {
            runningApps: this.cache.runningApps,
            installedApps: this.cache.installedApps
        };

        for (const callback of this.subscribers) {
            try {
                callback(data);
            } catch (e) {
                console.warn('[RunningAppsService] Subscriber error:', e);
            }
        }
    }

    /**
     * Start polling for app updates
     */
    startPolling() {
        if (this.pollInterval) return;

        console.log('[RunningAppsService] Starting polling (interval:', this.POLL_INTERVAL_MS, 'ms)');

        // Initial fetch
        this.fetchApps();

        // Set up polling - only fetch running apps during polls (installed apps are stable)
        this.pollInterval = setInterval(() => {
            this.fetchRunningApps();
        }, this.POLL_INTERVAL_MS);
    }

    /**
     * Stop polling
     */
    stopPolling() {
        if (this.pollInterval) {
            console.log('[RunningAppsService] Stopping polling');
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    /**
     * Clear cache (useful for testing or force refresh)
     */
    clearCache() {
        this.cache = {
            runningApps: [],
            installedApps: [],
            lastRunningFetch: 0,
            installedAppsLoaded: false
        };
    }
}

// Export singleton instance
export const runningAppsService = new RunningAppsService();
