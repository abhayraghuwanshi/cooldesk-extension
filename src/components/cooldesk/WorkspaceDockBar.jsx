import { faChevronDown, faChevronUp, faCode, faDesktop, faFileLines, faFolderOpen, faUpRightAndDownLeftFromCenter } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState } from 'react';
import logo from '../../../logo-2.png';
import { workspaceActivityService } from '../../services/workspaceActivityService';
import { getFaviconUrl } from '../../utils/helpers.js';
import '../../styles/dockbar.css';

// Editor-style apps launch with their folder/file argument (`code .`) — same
// list as WorkspaceCard so the two surfaces behave identically.
const CUSTOM_EDITORS = ['vscode', 'code', 'cursor', 'windsurf', 'idea', 'webstorm', 'pycharm', 'goland', 'phpstorm', 'rider', 'clion', 'rubymine', 'fleet', 'zed'];
const isEditorApp = (app) => CUSTOM_EDITORS.includes(app?.appType?.toLowerCase());

const AVATAR_COLORS = ['#3b82f6', '#f97316', '#a16207', '#22c55e', '#8b5cf6'];
const letterAvatar = (url) => {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = String(url || ''); }
  const letter = (host[0] || '?').toUpperCase();
  const hash = host.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return { letter, color: AVATAR_COLORS[hash % AVATAR_COLORS.length] };
};

const invokeDock = async (cmd, args) => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke(cmd, args);
  } catch (e) {
    console.error(`[DockBar] ${cmd} failed:`, e);
  }
};

/**
 * Taskbar-style horizontal dock: the active workspace's links and apps as a
 * single row of launchers. Rendered as the whole UI of the main window while
 * the dock is on a top/bottom edge (the window is only ~96px tall then, so
 * everything must fit one row — no popovers).
 */
export function WorkspaceDockBar({ workspaces = [], activeWorkspace, onSelectWorkspace, side = 'bottom' }) {
  const workspace = activeWorkspace || workspaces[0] || null;
  const urls = useMemo(
    () => (workspace?.urls || []).filter((u) => u.status !== 'draft'),
    [workspace]
  );
  const apps = workspace?.apps || [];

  // Live running-apps + open-tabs state; `activity` only drives re-renders,
  // the matching itself goes through the shared service.
  const [, setActivity] = useState(null);
  useEffect(() => workspaceActivityService.subscribe(setActivity), []);

  // The bar is one row tall, so workspace switching is a cycle button rather
  // than a dropdown (a popover would clip against the window edge).
  const cycleWorkspace = useCallback(() => {
    if (workspaces.length < 2 || !workspace) return;
    const idx = workspaces.findIndex((w) => w.id === workspace.id);
    onSelectWorkspace?.(workspaces[(idx + 1) % workspaces.length]);
  }, [workspaces, workspace, onSelectWorkspace]);

  const openLink = useCallback((item) => {
    if (!item?.url) return;
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(item.url);
    } else {
      window.open(item.url, '_blank');
    }
  }, []);

  const openApp = useCallback((app) => {
    if (!app.path || !window.electronAPI) return;
    // Taskbar behavior: if it's already running, bring it forward.
    const running = workspaceActivityService.findRunningApp(app);
    if (running && !isEditorApp(app) && window.electronAPI.focusApp) {
      window.electronAPI.focusApp(running.pid, running.name, running.hwnd);
      return;
    }
    if (isEditorApp(app) && window.electronAPI.launchAppWithArgs) {
      const cmd = app.appType.toLowerCase() === 'vscode' ? 'code' : app.appType.toLowerCase();
      window.electronAPI.launchAppWithArgs(cmd, [app.path]);
    } else if (app.appType === 'folder' && window.electronAPI.openFolder) {
      window.electronAPI.openFolder(app.path);
    } else if (window.electronAPI.launchApp) {
      window.electronAPI.launchApp(app.path);
    }
  }, []);

  const appFallbackIcon = (app) =>
    isEditorApp(app) ? faCode
      : app.appType === 'folder' ? faFolderOpen
        : app.appType === 'file' ? faFileLines
          : faDesktop;

  return (
    <div className={`dockbar dockbar--${side}`} role="toolbar" aria-label="Workspace dock">
      <button
        className="dockbar-ws-chip"
        onClick={cycleWorkspace}
        title={workspaces.length > 1 ? `${workspace?.name || 'CoolDesk'} — click to switch workspace` : workspace?.name || 'CoolDesk'}
      >
        <img src={logo} alt="" className="dockbar-ws-logo" />
        <span className="dockbar-ws-name">{workspace?.name || 'CoolDesk'}</span>
      </button>

      <div className="dockbar-items">
        {urls.map((item, idx) => {
          const favicon = getFaviconUrl(item.url, 32);
          const avatar = letterAvatar(item.url);
          const isOpen = !!workspaceActivityService.findOpenTab(item.url);
          return (
            <button
              key={`url-${idx}`}
              className={`dockbar-item${isOpen ? ' is-active' : ''}`}
              onClick={() => openLink(item)}
              title={`${item.title || item.url}${isOpen ? ' — open in browser' : ''}`}
            >
              {favicon ? (
                <img
                  src={favicon}
                  alt=""
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
              ) : null}
              <span className="dockbar-letter" style={{ display: favicon ? 'none' : 'flex', background: avatar.color }}>
                {avatar.letter}
              </span>
            </button>
          );
        })}
        {apps.map((app, idx) => {
          const isRunning = !!workspaceActivityService.findRunningApp(app);
          return (
          <button
            key={`app-${idx}`}
            className={`dockbar-item dockbar-item--app${isRunning ? ' is-active' : ''}`}
            onClick={() => openApp(app)}
            title={`${app.name || app.path}${isRunning ? ' — running (click to focus)' : ''}`}
          >
            {app.icon ? (
              <img src={app.icon} alt="" />
            ) : (
              <FontAwesomeIcon icon={appFallbackIcon(app)} className="dockbar-app-glyph" />
            )}
          </button>
          );
        })}
        {urls.length === 0 && apps.length === 0 && (
          <span className="dockbar-empty">This workspace has no links or apps yet</span>
        )}
      </div>

      <div className="dockbar-controls">
        <button
          className="dockbar-ctrl"
          onClick={() => invokeDock('dock_collapse')}
          title="Hide to edge handle"
        >
          <FontAwesomeIcon icon={side === 'top' ? faChevronUp : faChevronDown} />
        </button>
        <button
          className="dockbar-ctrl"
          onClick={() => invokeDock('dock_disable')}
          title="Back to full app"
        >
          <FontAwesomeIcon icon={faUpRightAndDownLeftFromCenter} />
        </button>
      </div>
    </div>
  );
}

export default WorkspaceDockBar;
