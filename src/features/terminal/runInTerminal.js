// Run a project command (a .cooldesk command, the file manager's project
// bar) where you can see it: a CoolDesk terminal tab, titled after the
// command and started in its folder. Browse registers the host while it's on
// screen; without it (docked sidebar, extension) it falls back to the old
// behaviour — the system's own terminal.

/** Folder a command runs in: its project root plus its own relative cwd. */
export function commandCwd(projectPath, cwd) {
  if (!projectPath) return undefined;
  if (!cwd || cwd === '.') return projectPath;
  // The project path's own separator — a hardcoded '\\' broke cwd on macOS.
  const sep = projectPath.includes('\\') && !projectPath.includes('/') ? '\\' : '/';
  const base = projectPath.replace(/[\\/]+$/, '');
  const rel = String(cwd).replace(/^\.[\\/]/, '').replace(/[/\\]+/g, sep).replace(/^[\\/]+/, '');
  return `${base}${sep}${rel}`;
}

/** Set by BrowseView while it can open terminal tabs. */
export function registerTerminalHost(fn) {
  window.__cooldeskRunInTerminal = fn;
  return () => {
    if (window.__cooldeskRunInTerminal === fn) delete window.__cooldeskRunInTerminal;
  };
}

/**
 * @returns 'terminal' when it opened in CoolDesk, else 'external'
 */
export async function runInTerminal({ command, cwd, label }) {
  if (!command?.trim()) return null;
  const host = window.__cooldeskRunInTerminal;
  if (typeof host === 'function') {
    host({ command, cwd, label });
    return 'terminal';
  }
  if (window.electronAPI?.runCommand) {
    await window.electronAPI.runCommand(command, cwd);
    return 'external';
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('run_project_command', { command, cwd });
  return 'external';
}
