// Which CoolDesk window this page is running in. The main app, the sidebar
// and the dock bar are separate windows that all load `pages/index.html`
// (see src-tauri/src/surfaces.rs); each picks its layout from its own window
// label, which Tauri hands the page synchronously at load.
//
//   'main'    — the full app (also the browser extension / anything non-Tauri)
//   'sidebar' — the edge panel
//   'bar'     — the taskbar-style dock bar

function windowLabel() {
  try {
    const meta = window.__TAURI_INTERNALS__?.metadata;
    return meta?.currentWindow?.label || meta?.currentWebview?.label || null;
  } catch {
    return null;
  }
}

const LABEL = typeof window === 'undefined' ? null : windowLabel();

/** This window's Tauri label (null outside the desktop app). */
export const getWindowLabel = () => LABEL;

/**
 * The original full-app window ("main"), as opposed to an extra full-app
 * window opened with New Window (`main-2`, `main-3`, …). One-per-app jobs —
 * backups, onboarding, update / feedback prompts, auto-created workspaces,
 * spotlight runs — stay in the primary window only.
 */
export const isPrimaryWindow = () => !LABEL || LABEL === 'main';

/** An extra full-app window from New Window. */
export const isExtraAppWindow = () => /^main-\d+$/.test(LABEL || '');

/**
 * localStorage key for per-window state (open tabs, the current space): the
 * key itself in the main window, suffixed with the label in an extra New
 * Window. Without this, both windows remembered one "current space", so a
 * switch in one showed up in the other.
 */
export const windowKey = (key) => (isExtraAppWindow() ? `${key}.${LABEL}` : key);

/**
 * Read a per-window value; a window without its own yet (just opened)
 * starts from the main window's.
 */
export function readWindowValue(key) {
  try {
    // A just-opened window ignores what an earlier window with the same
    // label left behind.
    if (OPENED_AS_NEW_WINDOW) return localStorage.getItem(key);
    return localStorage.getItem(windowKey(key)) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * True once, for a window just opened with New Window (`?newWindow=1`): it
 * starts with fresh tabs rather than what an earlier window with the same
 * label left behind. The flag is stripped from the URL so a reload restores
 * the window's own tabs.
 */
export const OPENED_AS_NEW_WINDOW = (() => {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('newWindow') !== '1') return false;
    params.delete('newWindow');
    const q = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
    return true;
  } catch {
    return false;
  }
})();

/** Open another full CoolDesk window on the screen under the cursor. */
export async function openNewAppWindow() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('open_new_window');
}

const SURFACE = (() => {
  if (typeof window === 'undefined') return 'main';
  const label = LABEL;
  return label === 'sidebar' || label === 'bar' ? label : 'main';
})();

export function getWindowSurface() {
  return SURFACE;
}

export const isMainSurface = () => SURFACE === 'main';
