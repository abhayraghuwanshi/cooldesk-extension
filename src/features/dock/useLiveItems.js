import { useEffect, useMemo, useState } from 'react';
import { runningAppsService } from '../../services/runningAppsService';
import { workspaceActivityService } from '../../services/workspaceActivityService';
import { enrichRunningAppsWithIcons } from '../../utils/helpers.js';
import { filterUserApps } from '../../utils/userApps.js';
import { hideMainWindow, isDesktopApp, isMainWindowItem, useAppWindows, windowItems } from './mainWindowItem.js';

// Browser chrome that isn't worth a slot.
export const isBlankTab = (url = '') => {
  const u = url.toLowerCase();
  return !u || u === 'about:blank' || /^(chrome|edge|brave|vivaldi|opera):\/\/newtab/.test(u)
    || u.startsWith('chrome-extension://') || u.startsWith('devtools://');
};

/**
 * Everything open right now, workspace or not — the dock bar's Active view
 * and the sidebar's Active card. Running apps come one per app (the service
 * reports one entry per window), filtered and icon-enriched the same way as
 * the Tabs page's Active Apps; open tabs are deduped by URL. Running apps are
 * only subscribed while `enabled`.
 */
export function useLiveItems(enabled = true) {
  const [activity, setActivity] = useState(null);
  useEffect(() => workspaceActivityService.subscribe(setActivity), []);

  const [liveApps, setLiveApps] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    return runningAppsService.subscribe(({ runningApps, installedApps }) => {
      if (!Array.isArray(runningApps)) return;
      const seen = new Set();
      const apps = filterUserApps(enrichRunningAppsWithIcons(runningApps, installedApps))
        .filter((a) => {
          const k = (a.path || a.name || '').toLowerCase();
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setLiveApps(apps);
    });
  }, [enabled]);

  // CoolDesk's own full app leads the running apps in the desktop app (see
  // mainWindowItem.js) — the scanned list never includes CoolDesk.
  // One entry per full-app window (New Window adds more).
  const appWindows = useAppWindows();
  const apps = useMemo(
    () => (isDesktopApp ? [...windowItems(appWindows), ...liveApps] : liveApps),
    [liveApps, appWindows]
  );

  const liveTabs = useMemo(() => {
    const seen = new Set();
    return (activity?.openTabs || []).filter((t) => {
      if (isBlankTab(t.url) || seen.has(t.url)) return false;
      seen.add(t.url);
      return true;
    });
  }, [activity]);

  return { activity, liveApps: apps, liveTabs };
}

/**
 * Close something listed in the Active view: a browser tab (same CLOSE_TAB
 * message spotlight's context pills send) or a running app (graceful quit by
 * pid / window handle). The lists refresh from their own subscriptions.
 */
export async function closeLiveItem(kind, item) {
  if (kind === 'app' && isMainWindowItem(item)) {
    // "Closing" the full app hides it to the tray, like its own close button.
    await hideMainWindow(item).catch((err) => console.warn('[Active] hide main window failed:', err));
    return;
  }
  try {
    if (kind === 'tab') {
      const msg = { type: 'CLOSE_TAB', tabId: item.tabId ?? item.id, url: item.url, _deviceId: item._deviceId, browser: item.browser };
      /* global chrome */
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) chrome.runtime.sendMessage(msg);
      else if (window.electronAPI?.sendMessage) window.electronAPI.sendMessage(msg);
    } else if (kind === 'app' && (item.pid || item.hwnd) && window.electronAPI?.closeApp) {
      await window.electronAPI.closeApp(item.pid || 0, item.hwnd);
    }
  } catch (err) {
    console.warn('[Active] close failed:', err);
  }
  if (kind === 'tab') {
    // Tabs are polled on a timer: drop it now; the next poll confirms.
    workspaceActivityService.openTabs = workspaceActivityService.openTabs.filter(t => t.url !== item.url);
    workspaceActivityService.notify();
  } else {
    // A graceful quit returns once it's sent, not once the app is gone.
    setTimeout(() => runningAppsService.fetchRunningApps?.(), 800);
  }
}
