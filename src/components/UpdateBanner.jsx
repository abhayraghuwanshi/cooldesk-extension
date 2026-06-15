import React, { useEffect, useState } from 'react';
import './UpdateBanner.css';

const isTauri = () =>
  typeof window !== 'undefined' && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

/**
 * Detection-only update notice for the winget channel.
 * Asks the Rust backend to compare the running version against the latest
 * GitHub release; if newer, shows a banner whose action runs `winget upgrade`.
 * No-op outside the Tauri desktop app (e.g. Chrome extension build).
 */
export function UpdateBanner() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke('check_winget_update');
        if (!cancelled && result?.has_update) setInfo(result);
      } catch {
        // Offline / rate-limited / no release yet — stay silent.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!info) return null;

  const onUpdate = async () => {
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('run_winget_upgrade');
    } catch {
      // winget missing / not on PATH — fall back to the release page.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_url', { url: info.notes_url });
      } catch {
        window.open(info.notes_url, '_blank');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">
        CoolDesk <strong>{info.latest}</strong> is available — you have {info.current}.
      </span>
      <div className="update-banner__actions">
        <button className="update-banner__btn update-banner__btn--primary" onClick={onUpdate} disabled={busy}>
          {busy ? 'Updating…' : 'Update'}
        </button>
        <a className="update-banner__link" href={info.notes_url} target="_blank" rel="noreferrer">
          What's new
        </a>
        <button className="update-banner__btn" onClick={() => setInfo(null)} aria-label="Dismiss">
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default UpdateBanner;
