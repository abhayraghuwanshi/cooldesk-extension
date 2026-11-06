/* global chrome */
import { useCallback, useEffect, useState } from 'react';
import { sendMessage, storageGet, storageSet } from '../../services/extensionApi';
import { checkHostAvailable, loadSyncConfig, toggleHostSync } from '../../services/syncConfig';
import { getUpdateState, installUpdate } from '../../services/updateService';

// The extension's few real settings, for the Customize panel's Settings tab.
// Same storage keys, background messages and services the Settings window
// uses (SettingsModal.jsx), so existing values carry over and the desktop
// app's window keeps working against the same data.
export function useQuickSettings() {
    const [autoGroup, setAutoGroup] = useState(false);
    const [sessionTracking, setSessionTracking] = useState(true);
    const [hostSync, setHostSync] = useState(true);
    const [hostAvailable, setHostAvailable] = useState(null); // null = checking
    const [autoUpdate, setAutoUpdate] = useState(true);
    const [version, setVersion] = useState('');
    const [update, setUpdate] = useState(() => getUpdateState().info || null);

    const probeHost = useCallback(async (enabled, force = false) => {
        if (!enabled) { setHostAvailable(false); return; }
        setHostAvailable(null);
        try { setHostAvailable(await checkHostAvailable(force)); } catch { setHostAvailable(false); }
    }, []);

    useEffect(() => {
        let alive = true;
        storageGet(['autoGroupEnabled', 'sessionTracking', 'autoUpdateEnabled']).then((r) => {
            if (!alive) return;
            setAutoGroup(r?.autoGroupEnabled || false);
            setSessionTracking(r?.sessionTracking?.enabled !== false);
            setAutoUpdate(r?.autoUpdateEnabled !== false);
        }).catch(() => {});
        loadSyncConfig().then((config) => {
            if (!alive) return;
            const enabled = config?.enableHostSync !== false;
            setHostSync(enabled);
            probeHost(enabled);
        }).catch(() => {});
        try { setVersion(chrome.runtime.getManifest().version); } catch { /* not an extension page */ }
        return () => { alive = false; };
    }, [probeHost]);

    return {
        autoGroup,
        setAutoGroup: async (enabled) => {
            setAutoGroup(enabled);
            await storageSet({ autoGroupEnabled: enabled });
            sendMessage({ type: 'TOGGLE_AUTO_GROUP', enabled }).catch(() => {});
        },
        sessionTracking,
        setSessionTracking: async (enabled) => {
            setSessionTracking(enabled);
            await sendMessage({ action: 'toggleSessionTracking', enabled }).catch(() => {});
        },
        hostSync,
        hostAvailable,
        setHostSync: async (enabled) => {
            setHostSync(enabled);
            await toggleHostSync(enabled).catch(() => {});
            probeHost(enabled, true);
        },
        retryHost: () => probeHost(hostSync, true),
        autoUpdate,
        setAutoUpdate: async (enabled) => {
            setAutoUpdate(enabled);
            await storageSet({ autoUpdateEnabled: enabled });
        },
        version,
        update,
        installUpdate: async () => {
            const ok = await installUpdate();
            if (!ok) setUpdate(null);
        },
    };
}
