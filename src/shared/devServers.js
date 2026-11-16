// Local dev servers, from the sidecar's /local/servers — the one source the
// dock's folder tiles, Browse (side panel + new tab) and the sidebar's Dev
// Servers section all read, so they agree on what's running. The sidecar
// already drops system daemons, CoolDesk itself and tools' internal ports
// (sidecar/local_servers.rs).
import { SIDECAR_HTTP } from './config/sidecar.js';

/**
 * Sidecar servers → one entry per port, named for what it is: the port's
 * label in the project's services.json, else the project folder, else the
 * process. `dir` is the folder it runs in (for its stack logo).
 */
export function localServerList(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).flatMap(s => {
    if (!s?.port || seen.has(s.port)) return [];
    seen.add(s.port);
    const dir = s.cwd || s.projectRoot || '';
    const folder = (s.projectRoot || s.cwd || '').split(/[/\\]/).filter(Boolean).pop();
    return [{ port: s.port, pid: s.pid, dir, label: s.declaredLabel || folder || s.process || `Port ${s.port}` }];
  });
}

/** The running dev servers (see `localServerList`); throws when the sidecar can't be reached. */
export async function fetchLocalServers() {
  const res = await fetch(`${SIDECAR_HTTP}/local/servers`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`/local/servers ${res.status}`);
  const body = await res.json();
  return localServerList(body?.servers);
}

/** Kill whatever listens on `port` (Tauri command — never an HTTP route). */
export async function stopLocalServer(port) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('kill_process_on_port', { port });
}
