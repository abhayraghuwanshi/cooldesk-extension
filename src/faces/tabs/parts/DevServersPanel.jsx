import { faFolderOpen, faPowerOff, faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../../../shared/i18n';
import { fetchLocalServers, stopLocalServer } from '../../../shared/devServers';
import { stackLogo, useFolderIdentity } from '../../../shared/hooks/useFolderIdentity.js';
import { SectionHeader } from './SectionHeader';

// The list refreshes on its own this often while it's on screen.
const POLL_MS = 15000;

/** A server's project: its stack logo, else a folder. */
function ServerLogo({ stack }) {
  const [failed, setFailed] = useState(false);
  const logo = failed ? null : stackLogo(stack);
  return (
    <span className="dev-server-logo">
      {logo
        ? <img className={logo.invert ? 'is-inverted' : ''} src={logo.src} alt="" onError={() => setFailed(true)} />
        : <FontAwesomeIcon icon={faFolderOpen} />}
    </span>
  );
}

/**
 * DevServersPanel — the dev servers running on this machine, drawn like
 * Browse's Local servers and the dock's folder tiles: the project's stack
 * logo, its name, the port in green. Click opens it (or its open tab); the
 * stop button (on hover) asks once more before killing the process.
 * Same source as those (sidecar /local/servers, shared/devServers.js).
 * Tauri desktop only.
 *
 * @param {Array} tabs - localhost tabs, used to link a port back to its open tab
 * @param {Function} onTabClick - jump to an existing tab (tab) => void
 */
export function DevServersPanel({ tabs = [], onTabClick }) {
  const t = useT();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [armed, setArmed] = useState(null);
  const [stopping, setStopping] = useState(null);

  // Map port -> open localhost tab.
  const tabByPort = useMemo(() => {
    const map = new Map();
    for (const tab of tabs) {
      try {
        const u = new URL(tab.url);
        if (u.port && !map.has(u.port)) map.set(u.port, tab);
      } catch { /* ignore unparseable urls */ }
    }
    return map;
  }, [tabs]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setServers(await fetchLocalServers());
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const folderIdentity = useFolderIdentity(servers.map(s => s.dir).filter(Boolean));

  const open = useCallback(async (server) => {
    const tab = tabByPort.get(String(server.port));
    if (tab && onTabClick) return onTabClick(tab);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_url', { url: `http://localhost:${server.port}` });
    } catch (err) {
      console.warn('[DevServersPanel] open failed:', err);
    }
  }, [tabByPort, onTabClick]);

  const stop = useCallback(async (port) => {
    if (armed !== port) {
      setArmed(port);
      setTimeout(() => setArmed(p => (p === port ? null : p)), 3000);
      return;
    }
    setArmed(null);
    setStopping(port);
    try {
      await stopLocalServer(port);
      setServers(list => list.filter(s => s.port !== port));
    } catch (err) {
      console.warn('[DevServersPanel] stop failed for port', port, err);
    } finally {
      setStopping(null);
      refresh();
    }
  }, [armed, refresh]);

  // Nothing running: no section at all.
  if (!servers.length) return null;

  return (
    <div className="dev-servers">
      <SectionHeader>
        {t('tm.devServers', { n: servers.length })}
        <button className="dev-servers-refresh" onClick={refresh} disabled={loading} title={t('tm.refreshPorts')}>
          <FontAwesomeIcon icon={faRotateRight} spin={loading} />
        </button>
      </SectionHeader>
      <div className="dev-server-list">
        {servers.map(server => {
          const tab = tabByPort.get(String(server.port));
          const isArmed = armed === server.port;
          return (
            <div
              key={server.port}
              role="button"
              tabIndex={0}
              className={`dev-server-row${isArmed ? ' is-armed' : ''}`}
              onClick={() => open(server)}
              onKeyDown={(e) => { if (e.key === 'Enter') open(server); }}
              title={`${server.label} — http://localhost:${server.port}${server.dir ? `\n${server.dir}` : ''}${tab ? '\nOpen in a tab: click to switch to it' : ''}`}
            >
              <ServerLogo stack={server.dir ? folderIdentity(server.dir).stack : null} />
              <span className="dev-server-name">{server.label}</span>
              <span className="dev-server-port"><i />:{server.port}</span>
              <button
                className={`dev-server-stop${isArmed ? ' armed' : ''}`}
                onClick={(e) => { e.stopPropagation(); stop(server.port); }}
                disabled={stopping === server.port}
                title={isArmed ? t('tm.killArmed', { port: server.port }) : t('tm.killTitle', { port: server.port })}
              >
                {isArmed ? t('tm.killQ', { port: server.port }) : <FontAwesomeIcon icon={faPowerOff} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
