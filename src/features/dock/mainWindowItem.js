// CoolDesk's own full-app windows as entries in the running-apps lists (the
// dock bar's Active view and the sidebar's Active card). filterUserApps drops
// CoolDesk from the scanned apps, since its sidebar/dock/spotlight windows are
// not "an app you're using" — but that left the full app, once closed to the
// tray, with no way back from those lists. These entries stand in for it in
// the desktop app: one per full-app window ("main" plus any New Window), each
// labelled with the space it's on. Clicking one brings that window forward;
// × hides main to the tray and closes an extra window.
import { useEffect, useState } from 'react';
import logo from '../../../logo-2.png';
import { openFullApp } from './surfaceControls';

export const isDesktopApp = typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

async function invoke(cmd, args) {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call(cmd, args);
}

/** The main window's entry before the window list has loaded. */
export const MAIN_WINDOW_ITEM = Object.freeze({
  id: 'cooldesk-main-window',
  name: 'CoolDesk',
  title: 'CoolDesk',
  icon: logo,
  isCoolDeskMain: true,
  windowLabel: 'main',
});

export const isMainWindowItem = (item) => !!item?.isCoolDeskMain;

/** List entries for `app_windows_list`'s windows. */
export function windowItems(windows) {
  if (!Array.isArray(windows) || !windows.length) return [MAIN_WINDOW_ITEM];
  const several = windows.length > 1;
  return windows.map((w) => {
    const name = several && w.space ? `CoolDesk · ${w.space}` : 'CoolDesk';
    return Object.freeze({
      ...MAIN_WINDOW_ITEM,
      // "main" keeps its old id so its activity ranking carries over.
      id: w.label === 'main' ? MAIN_WINDOW_ITEM.id : `cooldesk-window-${w.label}`,
      name,
      title: w.space ? `${name} — ${w.space}` : name,
      windowLabel: w.label,
    });
  });
}

/** The full-app windows, kept current as windows open, close or switch space. */
export function useAppWindows() {
  const [windows, setWindows] = useState(null);
  useEffect(() => {
    if (!isDesktopApp) return undefined;
    let cancelled = false;
    let off = null;
    const load = () => invoke('app_windows_list')
      .then((list) => { if (!cancelled) setWindows(list); })
      .catch(() => { });
    load();
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('app-windows-changed', load))
      .then((fn) => { if (cancelled) fn(); else off = fn; })
      .catch(() => { });
    return () => { cancelled = true; off?.(); };
  }, []);
  return windows;
}

export function openMainWindow(item) {
  const label = item?.windowLabel;
  const p = label && label !== 'main' ? invoke('app_window_focus', { label }) : openFullApp();
  return p.catch((e) => console.error('[Dock] open full app failed:', e));
}

export async function hideMainWindow(item) {
  if (!isDesktopApp) return;
  const label = item?.windowLabel;
  if (label && label !== 'main') await invoke('app_window_close', { label });
  else await invoke('main_window_hide');
}
