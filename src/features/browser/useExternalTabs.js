import { useCallback, useEffect, useState } from 'react';
import { getHostTabs } from '../../services/extensionApi.js';
import { runningAppsService } from '../../services/runningAppsService.js';
import { syncOrchestrator } from '../../services/syncOrchestrator.js';
import { enrichRunningAppsWithIcons } from '../../utils/helpers.js';
import { filterUserApps } from '../../utils/userApps.js';

// What's open outside CoolDesk, for the side panel's Tabs tab: tabs in your
// browsers (synced by the extension) and running desktop apps. Same sources
// and actions as the Tabs face (faces/tabs/TabManagement.jsx), without its
// grid UI — that face is being folded into Browse.

const SKIP_URL = /^(about:blank|chrome:\/\/newtab\/?|edge:\/\/newtab\/?)$/i;

function clean(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter(tab => {
    if (!tab?.url || SKIP_URL.test(tab.url) || (tab.url.startsWith('chrome-extension://') && tab.url.includes('index.html'))) return false;
    const key = `${tab.browser || 'other'}-${tab.id}-${tab.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(tab => ({ ...tab, browser: tab.browser || 'other' }));
}

/** @param enabled only listen/poll while the list is on screen */
export function useExternalTabs(enabled) {
  const [tabs, setTabs] = useState([]);
  const [apps, setApps] = useState([]);

  // Browser tabs: initial fetch + live updates from sync.
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const offs = [];
    (async () => {
      try {
        const list = window.electronAPI?.getTabs
          ? await window.electronAPI.getTabs()
          : (await getHostTabs()).tabs;
        if (!cancelled) setTabs(clean(list));
      } catch { /* sync not available */ }
    })();
    if (window.electronAPI?.subscribe) {
      offs.push(window.electronAPI.subscribe('tabs-updated', (list) => setTabs(clean(list))));
    }
    offs.push(syncOrchestrator.on('tabs-synced', (list) => { if (Array.isArray(list)) setTabs(clean(list)); }));
    return () => {
      cancelled = true;
      offs.forEach(off => off?.());
    };
  }, [enabled]);

  // Running apps (centralized service: no extra polling here).
  useEffect(() => {
    if (!enabled || !window.electronAPI?.getRunningApps) return undefined;
    return runningAppsService.subscribe(({ runningApps, installedApps }) => {
      if (!Array.isArray(runningApps)) return;
      const list = filterUserApps(enrichRunningAppsWithIcons(runningApps, installedApps));
      setApps([...list].sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())));
    });
  }, [enabled]);

  /** Bring a browser tab to the front in its own browser. */
  const jumpToTab = useCallback(async (tab) => {
    try {
      if (window.electronAPI?.sendMessage) {
        await window.electronAPI.sendMessage({ type: 'JUMP_TO_TAB', tabId: tab.id, windowId: tab.windowId, url: tab.url, _deviceId: tab._deviceId });
      }
    } catch (err) {
      console.warn('[ExternalTabs] jump failed:', err);
    }
  }, []);

  /** Bring an app to the front (falls back to launching it, which also raises it). */
  const focusApp = useCallback(async (app) => {
    try {
      if (app.tabIndex != null && app.hwnd && window.electronAPI?.focusAppTab) {
        await window.electronAPI.focusAppTab(app.hwnd, app.tabIndex, app.title);
      } else if (window.electronAPI?.focusApp && app.pid) {
        await window.electronAPI.focusApp(app.pid, app.name, app.hwnd, app.path);
      } else if (app.path && window.electronAPI?.launchApp) {
        await window.electronAPI.launchApp(app.path);
      }
    } catch (err) {
      console.warn('[ExternalTabs] focus failed, launching instead:', err);
      if (app.path && window.electronAPI?.launchApp) await window.electronAPI.launchApp(app.path).catch(() => { });
    }
  }, []);

  return { tabs, apps, jumpToTab, focusApp };
}
