import React, { useState } from 'react';
import './UpdateBanner.css';
import { useUpdateAvailable } from '../hooks/useUpdateAvailable';
import { installUpdate, openReleaseNotes } from '../services/updateService';

/**
 * Detection-only update notice, shown once at the top of the app.
 * State comes from the shared update service (see services/updateService.js),
 * which is also what feeds the header's UpdateButton — dismissing this banner
 * only hides the banner, the header pill stays until the update is installed.
 * No-op when there's nothing to install (including the non-Tauri, non-extension
 * dev build, where the check never finds anything).
 */
export function UpdateBanner() {
  const { info, installing } = useUpdateAvailable();
  const [dismissed, setDismissed] = useState(false);

  if (!info || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">
        CoolDesk <strong>{info.latest}</strong> is available — you have {info.current}.
      </span>
      <div className="update-banner__actions">
        <button
          className="update-banner__btn update-banner__btn--primary"
          onClick={installUpdate}
          disabled={installing}
        >
          {installing ? 'Updating…' : 'Update'}
        </button>
        {/* Kept as an anchor: in Tauri the shell handles it (openReleaseNotes),
            in the extension the plain href still works. */}
        <a
          className="update-banner__link"
          href={info.notesUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => { e.preventDefault(); openReleaseNotes(); }}
        >
          What's new
        </a>
        <button className="update-banner__btn" onClick={() => setDismissed(true)} aria-label="Dismiss">
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default UpdateBanner;
