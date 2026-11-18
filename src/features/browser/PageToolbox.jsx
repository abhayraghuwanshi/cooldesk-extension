import { faArrowUpRightFromSquare, faCamera, faCheck, faCropSimple, faExpand, faMagnifyingGlass, faMicrophone, faMoon, faShieldHalved, faVideo, faVolumeHigh, faVolumeXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { invoke } from './useNativePane';

// CoolDesk's built-in page tools — what you'd otherwise install browser
// extensions for (ad blocking, dark mode, clipping, screenshots, find), kept
// in the app instead.
//
// They live in the header, not in a popover: the header's Tools toggle swaps
// its contents for this strip (BrowseView: the multi view bar, or the page's
// own toolbar in single view). A web page is a native layer drawn over the
// app's HTML, so anything opened *over* the page hides it — the header is
// above the page, so the tools never cover it. Styled like the rest of the
// header: three flat capsules (page settings · actions · this site's camera,
// mic and sound), quiet at rest, a tool's colour only while it's on.

/**
 * Each tool: `toggle` ones have isOn; `action` ones flash a check when done.
 * Adding a tool = one entry here (plus whatever it runs).
 */
const TOOLS = [
  {
    id: 'adblock', kind: 'toggle', icon: faShieldHalved, label: 'Block ads', color: '#34d399',
    available: (t) => t.adblockSupported, isOn: (t) => t.blocking, run: (t) => t.toggleAdblock(),
  },
  {
    id: 'dark', kind: 'toggle', icon: faMoon, label: 'Dark mode', color: '#818cf8',
    enabled: (t) => !!t.host, isOn: (t) => t.darkOn, run: (t) => t.toggleDark(),
  },
  {
    id: 'fit', kind: 'toggle', icon: faExpand, label: 'Fit', color: '#fbbf24',
    isOn: (t) => t.autoFit, hint: (t) => (t.autoFit ? `Fit to pane: zoom ${Math.round((t.zoom || 1) * 100)}%` : 'Fit to pane: off (100%)'), run: (t) => t.toggleAutoFit(),
  },
  { id: 'find', kind: 'action', icon: faMagnifyingGlass, label: 'Find', color: '#60a5fa', hint: () => 'Find in page (⌘F)', run: (t) => t.find() },
  { id: 'clip', kind: 'action', icon: faCropSimple, label: 'Clip', color: '#2dd4bf', hint: () => 'Clip a table, chart or block to your workspace notes', run: (t) => t.clip() },
  { id: 'shot', kind: 'action', icon: faCamera, label: 'Screenshot', color: '#f472b6', hint: () => 'Screenshot the page to the Shelf', run: (t) => t.screenshot() },
  { id: 'open', kind: 'action', icon: faArrowUpRightFromSquare, label: 'Open outside', color: '#94a3b8', hint: () => 'Open this page in your browser', run: (t) => t.openExternal() },
];

const PERM_DEFAULTS = { camera: 'ask', microphone: 'ask', muted: false };
const NEXT_CHOICE = { ask: 'allow', allow: 'block', block: 'ask' };
const CHOICE_LABEL = { ask: 'Ask', allow: 'Allow', block: 'Block' };

/** This site's saved camera / mic / sound settings (permissions.rs). */
function useSitePermissions(host) {
  const [perms, setPerms] = useState(PERM_DEFAULTS);
  useEffect(() => {
    setPerms(PERM_DEFAULTS);
    if (!host) return undefined;
    let cancelled = false;
    invoke('site_permissions_get', { host })
      .then(p => { if (!cancelled && p) setPerms({ ...PERM_DEFAULTS, ...p }); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [host]);
  const update = (patch) => {
    const next = { ...perms, ...patch };
    setPerms(next);
    invoke('site_permissions_set', { host, settings: next })
      .catch(err => console.warn('[PageTools] permissions save failed:', err));
  };
  return [perms, update];
}

function useFlash() {
  const [done, setDone] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (id) => {
    setDone(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), 1300);
  };
  return [done, flash];
}

/**
 * Every page tool in a row, for the header's tools mode.
 *
 * @param tools  the page's controls (BrowserPane): url, host, paneId, zoom,
 *               autoFit, adblockSupported, blocking, darkOn + the actions;
 *               null when the selected tab isn't a web page
 * @param live   that page's stats ({ audible, camera, microphone }) or null
 */
export function ToolStrip({ tools, live = null }) {
  const [done, flash] = useFlash();
  const hasPage = !!tools?.url;
  const host = hasPage ? tools.host : '';
  const [perms, updatePerms] = useSitePermissions(host);

  if (!tools) {
    return <div className="ts-root ts-empty">Select a web page tile to use its tools.</div>;
  }

  const shown = TOOLS.filter(t => !t.available || t.available(tools));
  const disabledOf = (t) => (t.id !== 'fit' && !hasPage) || (t.enabled && !t.enabled(tools));
  const run = async (tool) => {
    try {
      await tool.run(tools);
      if (tool.kind === 'action') flash(tool.id);
    } catch (err) {
      console.warn(`[PageTools] ${tool.label} failed:`, err);
    }
  };
  const stop = (camera, microphone) => invoke('browser_pane_stop_capture', { id: tools.paneId, camera, microphone })
    .catch(err => console.warn('[PageTools] stop failed:', err));

  const permChips = [
    { key: 'camera', icon: faVideo, label: 'Camera', inUse: live?.camera },
    { key: 'microphone', icon: faMicrophone, label: 'Mic', inUse: live?.microphone },
  ];

  const button = (t) => {
    const on = t.kind === 'toggle' && !!t.isOn(tools);
    const isDone = done === t.id;
    return (
      <button
        key={t.id}
        className={`bp-btn ts-btn ${on ? 'on' : ''} ${isDone ? 'done' : ''}`}
        style={{ '--tool': t.color }}
        onClick={() => run(t)}
        disabled={disabledOf(t)}
        title={t.hint ? t.hint(tools) : `${t.label}: ${on ? 'on' : 'off'}`}
        aria-pressed={t.kind === 'toggle' ? on : undefined}
      >
        <FontAwesomeIcon icon={isDone ? faCheck : t.icon} />
        <span>{t.label}</span>
      </button>
    );
  };
  const toggles = shown.filter(t => t.kind === 'toggle');
  const actionTools = shown.filter(t => t.kind === 'action');

  return (
    <div className="ts-root" role="toolbar" aria-label="Page tools">
      {host && <span className="ts-host" title={tools.url}>{host}</span>}
      <div className="bp-capsule ts-group" aria-label="Page settings">{toggles.map(button)}</div>
      <div className="bp-capsule ts-group" aria-label="Actions">{actionTools.map(button)}</div>
      {host && (
        <div className="bp-capsule ts-group ts-site" aria-label={`Permissions for ${host}`}>
          {permChips.map(p => (
            p.inUse ? (
              <button
                key={p.key}
                className="bp-btn ts-btn ts-perm is-live"
                onClick={() => stop(p.key === 'camera', p.key === 'microphone')}
                title={`${host} is using your ${p.label.toLowerCase()}: click to stop`}
              >
                <FontAwesomeIcon icon={p.icon} />
                <span>Stop</span>
              </button>
            ) : (
              <button
                key={p.key}
                className={`bp-btn ts-btn ts-perm is-${perms[p.key]}`}
                onClick={() => updatePerms({ [p.key]: NEXT_CHOICE[perms[p.key]] })}
                title={`${p.label} for ${host}: ${CHOICE_LABEL[perms[p.key]]}. Click to change (Ask → Allow → Block)`}
              >
                <FontAwesomeIcon icon={p.icon} />
                <span>{CHOICE_LABEL[perms[p.key]]}</span>
              </button>
            )
          ))}
          <button
            className={`bp-btn ts-btn ts-perm ${perms.muted ? 'is-block' : ''} ${live?.audible && !perms.muted ? 'is-playing' : ''}`}
            onClick={() => updatePerms({ muted: !perms.muted })}
            title={perms.muted ? `Sound muted on ${host}: click to unmute` : `Mute ${host}`}
            aria-pressed={perms.muted}
          >
            <FontAwesomeIcon icon={perms.muted ? faVolumeXmark : faVolumeHigh} />
            <span>{perms.muted ? 'Muted' : 'Sound'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
