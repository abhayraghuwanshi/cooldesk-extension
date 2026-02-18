/**
 * useSync Hook
 * React hook for managing sync state and operations
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { syncOrchestrator } from '../services/syncOrchestrator';
import { isElectronApp, isExtension, getEnvironment } from '../services/environmentDetector';
import { isHostSyncEnabled, toggleHostSync } from '../services/syncConfig';

/**
 * Hook for sync functionality
 * @returns {object} Sync state and methods
 */
export function useSync() {
    const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, error, disabled
    const [lastSyncTime, setLastSyncTime] = useState(null);
    const [syncEnabled, setSyncEnabled] = useState(isHostSyncEnabled());
    const [wsConnected, setWsConnected] = useState(false);
    const [error, setError] = useState(null);
    const initRef = useRef(false);

    // Initialize sync on mount
    useEffect(() => {
        if (initRef.current) return;
        initRef.current = true;

        const initSync = async () => {
            try {
                await syncOrchestrator.init();

                // Update connection status
                const status = syncOrchestrator.getStatus();
                setWsConnected(status.wsConnected);
                if (status.lastSyncTime?.full) {
                    setLastSyncTime(status.lastSyncTime.full);
                }
            } catch (err) {
                console.error('[useSync] Initialization error:', err);
                setError(err.message);
            }
        };

        initSync();

        // Cleanup on unmount
        return () => {
            // Don't destroy orchestrator on unmount - it's a singleton
        };
    }, []);

    // Subscribe to sync events
    useEffect(() => {
        const handleSyncStart = () => {
            setSyncStatus('syncing');
            setError(null);
        };

        const handleSyncComplete = (data) => {
            setSyncStatus('idle');
            setLastSyncTime(data?.timestamp || Date.now());
            setError(null);
        };

        const handleSyncError = (err) => {
            setSyncStatus('error');
            setError(typeof err === 'string' ? err : err?.message || 'Sync failed');
        };

        const handleWorkspacesSynced = () => {
            // Workspaces were synced - UI will update via IndexedDB subscription
        };

        const handleSettingsSynced = () => {
            // Settings were synced
        };

        // Subscribe to events
        const unsubStart = syncOrchestrator.on('sync-start', handleSyncStart);
        const unsubComplete = syncOrchestrator.on('sync-complete', handleSyncComplete);
        const unsubError = syncOrchestrator.on('sync-error', handleSyncError);
        const unsubWorkspaces = syncOrchestrator.on('workspaces-synced', handleWorkspacesSynced);
        const unsubSettings = syncOrchestrator.on('settings-synced', handleSettingsSynced);

        return () => {
            unsubStart?.();
            unsubComplete?.();
            unsubError?.();
            unsubWorkspaces?.();
            unsubSettings?.();
        };
    }, []);

    // Trigger full sync
    const triggerSync = useCallback(async () => {
        if (!syncEnabled) {
            console.log('[useSync] Sync is disabled');
            return { ok: false, error: 'Sync disabled' };
        }

        setSyncStatus('syncing');
        setError(null);

        try {
            const result = await syncOrchestrator.fullSync();
            if (result.ok) {
                setLastSyncTime(result.timestamp);
                setSyncStatus('idle');
            } else {
                setError(result.error);
                setSyncStatus('error');
            }
            return result;
        } catch (err) {
            setError(err.message);
            setSyncStatus('error');
            return { ok: false, error: err.message };
        }
    }, [syncEnabled]);

    // Toggle sync enabled/disabled
    const toggleSync = useCallback(async (enabled) => {
        setSyncEnabled(enabled);
        await toggleHostSync(enabled);

        if (enabled) {
            // Re-initialize sync
            await syncOrchestrator.init();
        }
    }, []);

    // Push workspaces to remote
    const syncWorkspaces = useCallback(async (workspaces) => {
        if (!syncEnabled) return { ok: false, error: 'Sync disabled' };

        try {
            return await syncOrchestrator.syncWorkspaces(workspaces);
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }, [syncEnabled]);

    // Push settings to remote
    const syncSettings = useCallback(async (settings) => {
        if (!syncEnabled) return { ok: false, error: 'Sync disabled' };

        try {
            return await syncOrchestrator.syncSettings(settings);
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }, [syncEnabled]);

    // Get current status
    const getStatus = useCallback(() => {
        return syncOrchestrator.getStatus();
    }, []);

    return {
        // State
        syncStatus,
        lastSyncTime,
        syncEnabled,
        wsConnected,
        error,

        // Environment info
        isElectron: isElectronApp(),
        isExtension: isExtension(),
        environment: getEnvironment(),

        // Methods
        triggerSync,
        toggleSync,
        syncWorkspaces,
        syncSettings,
        getStatus
    };
}

/**
 * Hook for Electron-specific functionality
 * @returns {object} Electron API methods
 */
export function useElectronAPI() {
    const [available, setAvailable] = useState(false);

    useEffect(() => {
        setAvailable(isElectronApp() && !!window.electronAPI);
    }, []);

    const openExternal = useCallback((url) => {
        if (window.electronAPI?.openExternal) {
            return window.electronAPI.openExternal(url);
        }
        // Fallback to window.open
        window.open(url, '_blank');
        return { ok: true };
    }, []);

    const getAppPath = useCallback(async () => {
        if (window.electronAPI?.getAppPath) {
            return window.electronAPI.getAppPath();
        }
        return null;
    }, []);

    const getVersion = useCallback(async () => {
        if (window.electronAPI?.getVersion) {
            return window.electronAPI.getVersion();
        }
        return null;
    }, []);

    return {
        available,
        openExternal,
        getAppPath,
        getVersion
    };
}

export default useSync;
