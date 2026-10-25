import { faMicrophone, faVideo, faVolumeHigh, faVolumeXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { invoke } from './useNativePane';

// Site permissions in the Page tab: per site, camera and microphone are Ask
// (WebKit's prompt), Allow or Block, and sound can be muted. Saved and
// enforced on the Rust side (browser_pane/permissions.rs), so they hold for
// every pane on that site and across restarts. `live` is the page's current
// use (from browser_pane_stats) — shown with a Stop for camera / mic.

const DEFAULTS = { camera: 'ask', microphone: 'ask', muted: false };
const CHOICES = [['ask', 'Ask'], ['allow', 'Allow'], ['block', 'Block']];

function Choice({ value, onChange, disabled }) {
  return (
    <div className="sp-choice" role="radiogroup">
      {CHOICES.map(([id, label]) => (
        <button
          key={id}
          role="radio"
          aria-checked={value === id}
          className={value === id ? `on ${id}` : ''}
          onClick={() => onChange(id)}
          disabled={disabled}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * @param host    site of the visible page ('' when none)
 * @param paneId  its pane (for Stop)
 * @param live    { audible, camera, microphone } for that pane, or null
 */
export function SitePermissions({ host, paneId, live }) {
  const [perms, setPerms] = useState(DEFAULTS);
  useEffect(() => {
    setPerms(DEFAULTS);
    if (!host) return undefined;
    let cancelled = false;
    invoke('site_permissions_get', { host })
      .then(p => { if (!cancelled && p) setPerms({ ...DEFAULTS, ...p }); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [host]);

  const update = (patch) => {
    const next = { ...perms, ...patch };
    setPerms(next);
    invoke('site_permissions_set', { host, settings: next })
      .catch(err => console.warn('[SitePermissions] save failed:', err));
  };
  const stop = (camera, microphone) => invoke('browser_pane_stop_capture', { id: paneId, camera, microphone })
    .catch(err => console.warn('[SitePermissions] stop failed:', err));

  const rows = [
    { key: 'camera', icon: faVideo, label: 'Camera', inUse: live?.camera },
    { key: 'microphone', icon: faMicrophone, label: 'Microphone', inUse: live?.microphone },
  ];

  return (
    <section className="pg-section">
      <h4 title={host ? `Permissions for ${host}` : undefined}>Permissions{host ? <span> · {host}</span> : null}</h4>
      {!host && <div className="browse-hint">Open a page to see its permissions.</div>}
      {host && rows.map(r => (
        <div key={r.key} className="sp-row">
          <span className={`pg-icon ${r.inUse ? 'sp-live' : ''}`}><FontAwesomeIcon icon={r.icon} /></span>
          <span className="pg-text">
            <span className="pg-label">{r.label}</span>
            <span className="pg-detail">
              {r.inUse ? 'In use now' : perms[r.key] === 'ask' ? 'Asks when the site wants it' : perms[r.key] === 'allow' ? 'Allowed without asking' : 'Blocked'}
            </span>
          </span>
          {r.inUse && (
            <button className="sp-stop" onClick={() => stop(r.key === 'camera', r.key === 'microphone')}>Stop</button>
          )}
          <Choice value={perms[r.key]} onChange={(v) => update({ [r.key]: v })} />
        </div>
      ))}
      {host && (
        <button
          className="sp-row sp-sound"
          role="switch"
          aria-checked={!perms.muted}
          onClick={() => update({ muted: !perms.muted })}
        >
          <span className={`pg-icon ${live?.audible && !perms.muted ? 'sp-live' : ''}`}>
            <FontAwesomeIcon icon={perms.muted ? faVolumeXmark : faVolumeHigh} />
          </span>
          <span className="pg-text">
            <span className="pg-label">Sound</span>
            <span className="pg-detail">
              {perms.muted ? 'Muted on this site' : live?.audible ? 'Playing now' : 'On'}
            </span>
          </span>
          <span className={`sp-switch ${perms.muted ? '' : 'on'}`} aria-hidden="true"><i /></span>
        </button>
      )}
    </section>
  );
}
