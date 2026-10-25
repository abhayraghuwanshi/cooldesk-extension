// What Browse opened recently besides web pages: files / folders shown as
// tabs and the folders shells were started in. The address bar lists them
// while it's empty, next to recent links (useAddressSuggestions). Kept per
// browser profile in localStorage; newest first, deduped.

const KEY = 'cooldesk.browse.recent';
const MAX = 20;

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null');
    return {
      files: Array.isArray(data?.files) ? data.files.filter(f => typeof f?.path === 'string') : [],
      shells: Array.isArray(data?.shells) ? data.shells.filter(s => s && 'cwd' in s) : [],
    };
  } catch {
    return { files: [], shells: [] };
  }
}

function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* history is best-effort */ }
}

/** A file or folder opened as a Browse tab. */
export function recordRecentFile(path, isDir = false) {
  if (!path) return;
  const data = read();
  data.files = [{ path, isDir: !!isDir, at: Date.now() }, ...data.files.filter(f => f.path !== path)].slice(0, MAX);
  write(data);
}

/** A shell opened in `cwd` (null: the home folder). */
export function recordRecentShell(cwd) {
  const data = read();
  const key = cwd || null;
  data.shells = [{ cwd: key, at: Date.now() }, ...data.shells.filter(s => (s.cwd || null) !== key)].slice(0, MAX);
  write(data);
}

export const recentFiles = (n = 5) => read().files.slice(0, n);
export const recentShells = (n = 3) => read().shells.slice(0, n);
