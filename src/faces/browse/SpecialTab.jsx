import { faDiagramProject, faGear } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Suspense, lazy } from 'react';
import { TabAddressBar } from './TabAddressBar';
import { SPECIAL_TITLES } from './useBrowseTabs';

// The graph pulls in d3 / force-graph — load it only when the tab is opened.
const ActivityContent = lazy(() =>
  import('../../features/knowledge-graph/KnowledgeGraph').then(m => ({ default: m.ActivityContent })));

const ICONS = { activity: faDiagramProject, settings: faGear };
const HINTS = {
  activity: "Cool Activity — what you've been working on, and how it connects",
  settings: 'CoolDesk settings',
};

/**
 * One of CoolDesk's own pages as a Browse tab — they used to be modals over
 * the app: Cool Activity (the activity overview and knowledge graph) or
 * Settings. Same toolbar every tab has.
 *
 * @param kind            'activity' | 'settings'
 * @param renderSettings  (onClose) => the settings page (App owns its state)
 * @param onClose         closes this tab (Settings' own Close / Getting Started)
 */
export function SpecialTab({ kind, renderSettings, onClose, onOpenUrl, onOpenPath, onOpenShell, toolbarStart = null, toolbarEnd = null }) {
  return (
    <div className={`bp-root ft-root special-tab special-tab--${kind}`}>
      <div className="bp-toolbar">
        {toolbarStart}
        <TabAddressBar
          icon={<FontAwesomeIcon icon={ICONS[kind]} className="ft-address-icon" />}
          label={SPECIAL_TITLES[kind]}
          title={HINTS[kind]}
          onOpenUrl={onOpenUrl}
          onOpenPath={onOpenPath}
          onOpenShell={onOpenShell}
        />
        {toolbarEnd}
      </div>
      <div className="special-tab-body">
        {kind === 'activity' && (
          <Suspense fallback={null}>
            <ActivityContent />
          </Suspense>
        )}
        {kind === 'settings' && renderSettings?.(onClose)}
      </div>
    </div>
  );
}
