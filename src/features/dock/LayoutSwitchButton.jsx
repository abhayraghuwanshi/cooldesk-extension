import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useLayoutSwitch } from './useLayoutSwitch';
import { useDockState } from './useDockState';

/**
 * Cycles the window through full window → side dock → bottom bar → full.
 * Reads live dock state itself via `useDockState()` unless a caller that
 * already has it (e.g. CoolDeskContainer, which needs it for other layout
 * decisions too) passes `dockState` explicitly to avoid a second listener.
 */
export function LayoutSwitchButton({ className, style, dockState: dockStateProp, title, ...rest }) {
  const ownDockState = useDockState();
  const dockState = dockStateProp !== undefined ? dockStateProp : ownDockState;
  const { currentLayoutInfo, nextLayout, cycleLayout } = useLayoutSwitch(dockState);

  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={cycleLayout}
      title={title ?? `${currentLayoutInfo.label} → ${nextLayout.label}`}
      {...rest}
    >
      <FontAwesomeIcon icon={nextLayout.icon} />
    </button>
  );
}

export default LayoutSwitchButton;
