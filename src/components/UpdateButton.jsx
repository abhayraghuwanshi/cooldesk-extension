import { faArrowUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import './UpdateButton.css';
import { useUpdateAvailable } from '../hooks/useUpdateAvailable';
import { installUpdate } from '../services/updateService';

/**
 * "Update available" pill for the app header, sitting next to the settings
 * gear so the update never hides inside Settings. Renders nothing when the
 * app is current — so it can be dropped into any toolbar unconditionally.
 *
 * Clicking installs: winget upgrade on the desktop, extension reload in the
 * Chrome build. Both replace the running app, so there is no "done" state.
 *
 * `compact` drops the label and shows just the badged arrow (sidebar widths).
 */
export function UpdateButton({ compact = false, className = '' }) {
  const { info, installing } = useUpdateAvailable();

  if (!info) return null;

  const label = info.latest ? `Update ${info.latest}` : 'Update';
  const title = info.current
    ? `CoolDesk ${info.current} → ${info.latest} — click to install`
    : `Update to ${info.latest} — click to install`;

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
