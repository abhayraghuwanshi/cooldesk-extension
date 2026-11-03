import { faChevronDown, faChevronRight, faTerminal } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { workspaceActivityService } from '../../services/workspaceActivityService';
import { IS_TAURI } from '../../utils/nativeDrag.js';
import { quotePath, registerTerminalHost } from './runInTerminal';
import { TerminalTab } from './TerminalTab';
import '../../styles/browse.css';
import '../clipboard/clipboard.css';
import './terminal.css';

// A shell in the side dock, below the clipboard: the docked sidebar has no
// room for Browse's terminal tabs, so it gets one shell of its own. It starts
// the first time the card is opened and keeps running while it's collapsed.
// While it's mounted it is the terminal host (runInTerminal.js): spotlight's
// "> cmd" and project commands are typed into this shell, as you would,
// instead of opening the system's terminal.

const COLLAPSED_KEY = 'cooldesk.shell.collapsed';

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) !== 'false'; } catch { return true; }
}

export function ShellSection() {
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const [started, setStarted] = useState(() => !collapsed);
  const [input, setInput] = useState(null);
  const sectionRef = useRef(null);

  const setCollapsed = (next) => {
    setCollapsedState(next);
    if (!next) setStarted(true);
    try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
  };
  const setCollapsedRef = useRef(setCollapsed);
  setCollapsedRef.current = setCollapsed;

  useEffect(() => {
    if (!IS_TAURI) return undefined;
    return registerTerminalHost(({ command, cwd }) => {
      setCollapsedRef.current(false);
      setInput(prev => ({ text: cwd ? `cd ${quotePath(cwd)} && ${command}` : command, n: (prev?.n || 0) + 1 }));
      requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    });
  }, []);

  if (!IS_TAURI) return null;

  return (
    <section ref={sectionRef} className="home-stack-shell cb-section">
      <div className="cb-header">
        <div
          className="cb-header-toggle"
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed); } }}
        >
          <h3 className="cb-title">
            <FontAwesomeIcon icon={faTerminal} style={{ opacity: 0.6 }} />
            Shell
            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} className="cb-chevron" />
          </h3>
        </div>
      </div>
      {started && (
        <div className="cb-card bp-root sh-card" hidden={collapsed}>
          <TerminalTab
            variant="panel"
            tabId="dock-shell"
            input={input}
            compact
            active={!collapsed}
            onHide={() => setCollapsed(true)}
            onOpenUrl={(url) => workspaceActivityService.activate({ url })}
          />
        </div>
      )}
    </section>
  );
}
