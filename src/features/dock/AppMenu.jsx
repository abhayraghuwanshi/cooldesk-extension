import { faBars, faCircleArrowUp, faDiagramProject, faGear, faGripLines, faTableColumns } from '@fortawesome/free-solid-svg-icons';
import { ToolbarMenu } from '../../faces/browse/ToolbarMenu';
import { useUpdateAvailable } from '../updates/useUpdateAvailable';
import { installUpdate } from '../../services/updateService';
import { toggleSurface } from './surfaceControls';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const SHIFT_KEY = (k) => (IS_MAC ? `⌘⇧${k}` : `Ctrl+Shift+${k}`);

/**
 * The full app's one menu for app-wide things, at the end of Browse's
 * toolbar: the sidebar and dock windows, Cool Activity, Settings — and a
 * pending update (the button gets a dot, so it isn't missed). Replaces the
 * row of separate buttons that used to sit there.
 */
export function AppMenu({ dockState, onOpenActivity, onOpenSettings }) {
  const { info: update, installing } = useUpdateAvailable();
  const sidebarOn = !!dockState?.sidebar?.enabled;
  const barOn = !!dockState?.bar?.enabled;
  const toggle = (surface) => toggleSurface(surface, dockState).catch(e => console.error(`[AppMenu] ${surface} toggle failed:`, e));
  return (
    <span data-onboarding="dock-btn" style={{ display: 'contents' }}>
      <ToolbarMenu
        icon={faBars}
        title={update ? `CoolDesk — update ${update.latest || ''} available` : 'CoolDesk'}
        dot={!!update}
        items={[
          // A pending update leads the menu, set apart by a divider.
          ...(update ? [{
            key: 'update',
            icon: faCircleArrowUp,
            label: installing ? 'Installing update…' : `Update to ${update.latest || 'the new version'}`,
            accent: true,
            onSelect: () => { if (!installing) installUpdate(); },
          }, null] : []),
          { key: 'sidebar', icon: faTableColumns, label: 'Sidebar', checked: sidebarOn, hint: SHIFT_KEY('D'), onSelect: () => toggle('sidebar') },
          { key: 'dock', icon: faGripLines, label: 'Dock', checked: barOn, onSelect: () => toggle('bar') },
          null,
          { key: 'activity', icon: faDiagramProject, label: 'Cool Activity', hint: SHIFT_KEY('G'), onSelect: onOpenActivity },
          { key: 'settings', icon: faGear, label: 'Settings', onSelect: onOpenSettings },
        ]}
      />
    </span>
  );
}
