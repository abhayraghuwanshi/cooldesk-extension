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

const SURFACE = (() => {
  if (typeof window === 'undefined') return 'main';
  const label = windowLabel();
  return label === 'sidebar' || label === 'bar' ? label : 'main';
})();

export function getWindowSurface() {
  return SURFACE;
}

export const isMainSurface = () => SURFACE === 'main';
