import { useEffect, useMemo, useState } from 'react';
import { runningAppsService } from '../../services/runningAppsService';
import { workspaceActivityService } from '../../services/workspaceActivityService';
import { enrichRunningAppsWithIcons } from '../../utils/helpers.js';
import { filterUserApps } from '../../utils/userApps.js';

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

  const liveTabs = useMemo(() => {
    const seen = new Set();
    return (activity?.openTabs || []).filter((t) => {
      if (isBlankTab(t.url) || seen.has(t.url)) return false;
      seen.add(t.url);
      return true;
    });
  }, [activity]);

  return { activity, liveApps, liveTabs };
}
