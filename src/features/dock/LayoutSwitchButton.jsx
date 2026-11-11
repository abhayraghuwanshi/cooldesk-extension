import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTableColumns, faWindowMaximize } from '@fortawesome/free-solid-svg-icons';
import { useT } from '../../shared/i18n';
import { openFullApp, toggleSurface } from './surfaceControls';
import { useDockState } from './useDockState';

/**
 * Main window: turns the separate sidebar window on (and slides it in) or
 * off. Reads live dock state itself unless the caller passes `dockState`.
 */
export function SidebarToggleButton({ className, style, dockState: dockStateProp, title, ...rest }) {
  const t = useT();
  const ownDockState = useDockState();
  const dockState = dockStateProp !== undefined ? dockStateProp : ownDockState;
  const on = !!dockState?.sidebar?.enabled;
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-pressed={on}
      onClick={() => toggleSurface('sidebar', dockState).catch((e) => console.error('[Sidebar] toggle failed:', e))}
      title={title ?? (on ? t('dk.sidebarOff') : t('dk.sidebarOn'))}
      {...rest}
    >
      <FontAwesomeIcon icon={faTableColumns} />
    </button>
  );
}

/** Sidebar / dock windows: bring up the full app. */
export function OpenFullAppButton({ className, style, from, title, ...rest }) {
  const t = useT();
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => openFullApp(from).catch((e) => console.error('[Dock] open full app failed:', e))}
      title={title ?? t('dk.openFullApp')}
      {...rest}
    >
      <FontAwesomeIcon icon={faWindowMaximize} />
    </button>
  );
}
