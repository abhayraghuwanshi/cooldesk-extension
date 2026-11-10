import { faPlus, faTerminal, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TerminalTab } from '../../terminal/TerminalTab';
import { shellLabel } from './shellLabel';
import '../../../styles/browse.css';
import '../../terminal/terminal.css';

// /shell — real shells inside the spotlight (desktop app only), a mode of its
// own like /agent. Several can run at once, one tab each; every shell stays
// mounted (only the active one is shown) and the panel stays mounted when you
// leave the mode or the spotlight hides — the spotlight window is hidden,
// never destroyed — so a dev server or a long build keeps running and is
// there when you come back (/shell, or its chip in the idle "Shells" row).
//
// Keys typed in a terminal belong to the shell — Esc included, so vim and
// friends work (TerminalTab stops them reaching the spotlight's handlers).
// Shift+Esc jumps back to the search box; from there Esc leaves the mode.

const openExternal = (url) => {
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, '_blank', 'noopener');
};

export function ShellPanel({ shells, activeId, visible, onActivate, onCloseShell, confirmCloseId, onNewShell, onShellTitle, onShellExit, inputRef }) {
    // Capture phase: runs before the terminal's own key handling, which would
    // otherwise swallow the key as input for the shell.
    const onKeyDownCapture = (e) => {
        if (e.key === 'Escape' && e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            inputRef?.current?.focus();
        }
    };

    return (
        <div className="bp-root spotlight-shell" hidden={!visible} onKeyDownCapture={onKeyDownCapture}>
            <div className="spotlight-shell-tabs" role="tablist" aria-label="Shells">
                {shells.map(sh => {
                    const label = shellLabel(sh);
                    const running = sh.exited == null;
                    return (
                        <div
                            key={sh.id}
                            role="tab"
                            tabIndex={0}
                            aria-selected={sh.id === activeId}
                            className={`spotlight-shell-tab${sh.id === activeId ? ' is-active' : ''}`}
                            onClick={() => onActivate(sh.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(sh.id); } }}
                            title={`${label}${running ? '' : ` — exited${sh.exited ? ` (${sh.exited})` : ''}`}`}
                        >
                            <span className={`spotlight-shell-dot${running ? ' is-running' : ''}`} />
                            <FontAwesomeIcon icon={faTerminal} className="spotlight-shell-tab-icon" />
                            <span className="spotlight-shell-tab-label">{label}</span>
                            {/* Running: first click arms it ("End"), second ends it. */}
                            <button
                                type="button"
                                className={`spotlight-shell-tab-close${confirmCloseId === sh.id ? ' is-confirm' : ''}`}
                                onClick={(e) => { e.stopPropagation(); onCloseShell(sh.id); }}
                                title={confirmCloseId === sh.id ? 'Click again to end this shell' : (running ? 'End this shell' : 'Close')}
                                aria-label={confirmCloseId === sh.id ? `End ${label}` : `Close ${label}`}
                            >
                                {confirmCloseId === sh.id ? 'End' : <FontAwesomeIcon icon={faXmark} />}
                            </button>
                        </div>
                    );
                })}
                <button type="button" className="spotlight-shell-new" onClick={onNewShell} title="New shell" aria-label="New shell">
                    <FontAwesomeIcon icon={faPlus} />
                </button>
            </div>
            {shells.map(sh => (
                <div key={sh.id} className="spotlight-shell-pane" hidden={sh.id !== activeId}>
                    <TerminalTab
                        variant="panel"
                        tabId={sh.id}
                        run={sh.command || null}
                        input={sh.input}
                        active={visible && sh.id === activeId}
                        onTitle={(t) => onShellTitle(sh.id, t)}
                        onExit={(code) => onShellExit(sh.id, code)}
                        onOpenUrl={openExternal}
                    />
                </div>
            ))}
            <div className="spotlight-shell-hint">
                <span><kbd>⇧</kbd><kbd>Esc</kbd> back to search</span>
                <span>Shells keep running when Spotlight closes</span>
            </div>
        </div>
    );
}
