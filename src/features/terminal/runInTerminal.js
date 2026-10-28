// Run a project command (a .cooldesk command, the file manager's project
// bar) where you can see it: a CoolDesk terminal tab, titled after the
// command and started in its folder. Browse registers the host while it's on
// screen; without it (docked sidebar, extension) it falls back to the old
// behaviour — the system's own terminal.

import { useEffect } from 'react';

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

/**
 * A shell command typed into the spotlight ("> git status", "/run …"). It's
 * typed into an interactive shell, so cd, &&, pipes and aliases all work and
 * the shell stays open afterwards. It starts in the active Browse tab's folder
 * (home if there's none) and always runs fresh, even if the same command is
 * already open in a tab.
 *
 * The spotlight is usually its own window, which has no terminal host: it
 * hands the command to the main window instead (spotlight_run_in_terminal in
 * lib.rs → useSpotlightRuns below).
 */
export async function runFromSpotlight(command) {
  if (!command?.trim()) return null;
  const host = window.__cooldeskRunInTerminal;
  if (typeof host === 'function') {
    host({ command, label: command, here: true, fresh: true });
    return 'terminal';
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('spotlight_run_in_terminal', { command });
  return 'terminal';
}

/**
 * Main window: take commands the spotlight window handed over — on mount (the
 * window was only just created for it) and on every nudge event. Mount it
 * after registerTerminalHost so the take finds the host; without one (docked
 * sidebar) runInTerminal falls back to the system's terminal.
 */
export function useSpotlightRuns(enabled) {
  useEffect(() => {
    if (!enabled || !(window.__TAURI__ || window.__TAURI_INTERNALS__)) return undefined;
    let cancelled = false;
    let unlisten = null;
    const take = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const command = await invoke('take_terminal_run');
        if (!command || cancelled) return;
        const host = window.__cooldeskRunInTerminal;
        if (typeof host === 'function') host({ command, label: command, here: true, fresh: true });
        else await runInTerminal({ command });
      } catch (e) {
        console.warn('[Terminal] take_terminal_run failed:', e);
      }
    };
    take();
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('spotlight-run-in-terminal', take))
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; })
      .catch(() => { });
    return () => { cancelled = true; unlisten?.(); };
  }, [enabled]);
}
