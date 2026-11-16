// CoolDesk's own full app as an entry in the running-apps lists (the dock
// bar's Active view and the sidebar's Active card). filterUserApps drops
// CoolDesk from the scanned apps, since its sidebar/dock/spotlight windows are
// not "an app you're using" — but that left the full app, once closed to the
// tray, with no way back from those lists. This entry stands in for it in the
// desktop app: clicking it brings the full app forward, × hides it to the tray.
import logo from '../../../logo-2.png';
import { openFullApp } from './surfaceControls';

export const isDesktopApp = typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

export const MAIN_WINDOW_ITEM = Object.freeze({
  id: 'cooldesk-main-window',
  name: 'CoolDesk',
  title: 'CoolDesk',
  icon: logo,
  isCoolDeskMain: true,
});

export const isMainWindowItem = (item) => !!item?.isCoolDeskMain;

export function openMainWindow() {
  return openFullApp().catch((e) => console.error('[Dock] open full app failed:', e));
}

export async function hideMainWindow() {
  if (!isDesktopApp) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('main_window_hide');
}
