import { faArrowUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import './UpdateButton.css';
import { useUpdateAvailable } from './useUpdateAvailable';
import { installUpdate } from '../../services/updateService';

/**
 * "Update available" pill for the app header, sitting next to the settings
 * gear so the update never hides inside Settings. Renders nothing when the
 * app is current — so it can be dropped into any toolbar unconditionally.
 *
 * Clicking installs: winget upgrade on Windows, the native Tauri updater on
 * macOS/Linux, or an extension reload in the Chrome build. All replace the
 * running app, so there is no "done" state.
 *
 * `compact` drops the label and shows just the badged arrow (sidebar widths).
 */
export function UpdateButton({ compact = false, className = '' }) {
  const { info, installing } = useUpdateAvailable();

  if (!info) return null;

  // The extension has already downloaded the update; it only needs a restart.
  const isExtension = info.target === 'extension';
  const label = isExtension ? 'Restart to update' : info.latest ? `Update ${info.latest}` : 'Update';
  const next = info.latest || 'the new version';
  const title = isExtension
    ? `CoolDesk ${next} is ready — restart to switch (a fresh new tab opens)`
    : info.current
      ? `CoolDesk ${info.current} → ${next} — click to install`
      : `Update to ${next} — click to install`;

  return (
    <button
      type="button"
      className={`upd-pill ${compact ? 'upd-pill--compact' : ''} ${className}`}
      onClick={installUpdate}
      disabled={installing}
      title={title}
      aria-label={title}
    >
      <span className="upd-pill__icon">
        <FontAwesomeIcon icon={faArrowUp} />
      </span>
      {!compact && (
        <span className="upd-pill__label">{installing ? 'Updating…' : label}</span>
      )}
    </button>
  );
}

export default UpdateButton;
