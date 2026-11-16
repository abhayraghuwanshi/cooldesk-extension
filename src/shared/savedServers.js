// Saved servers: a workspace's dev servers, kept as what it takes to start
// one — its folder and start command — rather than a localhost URL, since the
// port can change and the server isn't always running. Stored on the
// workspace as `servers: [{ id, name, cwd, command, port, addedAt }]`.
//
// Nothing here starts anything: BrowseView runs the command only when the
// user clicks ▶ on the row.

const key = (p) => (p || '').replace(/(.)[\\/]+$/, '$1').toLowerCase();

/** Is `dir` the saved folder or inside it? */
function inFolder(dir, folder) {
  const d = key(dir);
  const f = key(folder);
  return !!d && !!f && (d === f || d.startsWith(`${f}/`) || d.startsWith(`${f}\\`));
}

/**
 * The running server (from fetchLocalServers) for a saved one: found by its
 * folder, so a new port still matches; when one folder runs several servers,
 * the one on the saved port wins. Falls back to the saved port alone only
 * for servers whose folder the OS won't report (Windows).
 */
export function runningServerFor(saved, ports) {
  if (!saved || !Array.isArray(ports)) return null;
  const inside = ports.filter(p => inFolder(p.dir, saved.cwd));
  if (inside.length) return inside.find(p => p.port === saved.port) || inside[0];
  return ports.find(p => !p.dir && saved.port && p.port === saved.port) || null;
}

/**
 * A best guess at the folder's start command, from package.json scripts
 * (dev, then start, then serve) and the package manager its lockfile names.
 * Returns '' when there's nothing to go on — the user types one in.
 */
export async function guessStartCommand(dir) {
  if (!dir) return '';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
    const entries = await invoke('list_dir', { path: dir });
    const names = new Set((entries || []).map(e => e?.name).filter(Boolean));
    if (!names.has('package.json')) {
      if (names.has('manage.py')) return 'python manage.py runserver';
      if (names.has('Cargo.toml')) return 'cargo run';
      return '';
    }
    const { content } = await invoke('preview_text_file', { path: `${dir.replace(/[\\/]+$/, '')}${sep}package.json` });
    const scripts = JSON.parse(content || '{}')?.scripts || {};
    const script = ['dev', 'start', 'serve'].find(s => typeof scripts[s] === 'string');
    if (!script) return '';
    const pm = names.has('pnpm-lock.yaml') ? 'pnpm'
      : names.has('yarn.lock') ? 'yarn'
        : (names.has('bun.lockb') || names.has('bun.lock')) ? 'bun'
          : 'npm';
    if (pm === 'npm') return script === 'start' ? 'npm start' : `npm run ${script}`;
    return `${pm} ${script}`;
  } catch {
    return '';
  }
}
