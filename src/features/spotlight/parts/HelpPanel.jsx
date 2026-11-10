import { faCircleQuestion, faTerminal } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// /help — what the spotlight can do, and what's going on in it right now.
// Click a command row to put it in the box. Esc (or the chip's ×) leaves.

const SECTIONS = [
    {
        title: 'Search',
        rows: [
            { cmd: 'just type', desc: 'Apps, tabs, history, bookmarks, files, workspaces — and web suggestions' },
            { cmd: '/u', insert: '/u ', desc: 'Only URLs: open tabs, history, bookmarks, saved links' },
            { cmd: '/a', insert: '/a ', desc: 'Only apps' },
            { cmd: '/f', insert: '/f ', desc: 'Only files and folders' },
            { cmd: 'example.com', desc: 'Something that looks like a site opens it' },
        ],
    },
    {
        title: 'Do things',
        rows: [
            { cmd: '/todo', insert: '/todo ', desc: 'Todos — in Active by default, or pick a workspace' },
            { cmd: '/notes', insert: '/notes ', desc: 'Notes — list on the left, editor on the right' },
            { cmd: '/shell', insert: '/shell', desc: 'A terminal here; shells keep running when Spotlight closes', desktop: true },
            { cmd: '> cmd', insert: '> ', desc: 'Run a command in a new shell (⌘↵: in a CoolDesk terminal tab)', desktop: true },
            { cmd: '/agent', insert: '/agent ', desc: 'Ask the AI agent to search, add links or set up a workspace', desktop: true },
            { cmd: '/new-workspace', insert: '/new-workspace', desc: 'Guided setup: name, folders, links' },
            { cmd: '/workspace-name', desc: 'Type a workspace’s name after / to edit it' },
            { cmd: '/help', desc: 'This page' },
        ],
    },
    {
        title: 'Keys',
        rows: [
            { cmd: '↑ ↓', desc: 'Move through results' },
            { cmd: '↵', desc: 'Open the highlighted result' },
            { cmd: 'Tab', desc: 'Jump between sections (apps, tabs, shells, pinned…)' },
            { cmd: '→ ←', desc: 'Expand / collapse a folder' },
            { cmd: '⌘P', desc: 'Pin the highlighted result' },
            { cmd: 'Esc', desc: 'Leave a mode, then close Spotlight' },
            { cmd: '⇧Esc', desc: 'From inside a shell, back to the search box', desktop: true },
        ],
    },
];

export function HelpPanel({ isDesktopApp, shells, currentWorkspaceName, onPick }) {
    const running = shells.filter(sh => sh.exited == null);
    return (
        <div className="sp-help">
            <section className="sp-help-section">
                <h4 className="sp-help-title">Right now</h4>
                <div className="sp-help-status">
                    <div className="sp-help-stat">
                        <span className="sp-help-stat-label">Workspace</span>
                        <span>{currentWorkspaceName || 'None open'}</span>
                    </div>
                    {isDesktopApp && (
                        <div className="sp-help-stat">
                            <span className="sp-help-stat-label">Shells</span>
                            {shells.length === 0 ? (
                                <span>None — <button type="button" className="sp-help-link" onClick={() => onPick('/shell')}>start one</button></span>
                            ) : (
                                <span className="sp-help-shells">
                                    {running.length} running{shells.length > running.length ? `, ${shells.length - running.length} exited` : ''}
                                    {running.slice(0, 4).map(sh => (
                                        <span key={sh.id} className="sp-help-shell">
                                            <FontAwesomeIcon icon={faTerminal} />
                                            {sh.label}
                                        </span>
                                    ))}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </section>
            {SECTIONS.map(sec => (
                <section key={sec.title} className="sp-help-section">
                    <h4 className="sp-help-title">{sec.title}</h4>
                    {sec.rows.filter(r => isDesktopApp || !r.desktop).map(r => (
                        <div
                            key={r.cmd}
                            className={`sp-help-row${r.insert ? ' is-pickable' : ''}`}
                            onClick={r.insert ? () => onPick(r.insert) : undefined}
                            role={r.insert ? 'button' : undefined}
                            title={r.insert ? `Use ${r.cmd}` : undefined}
                        >
                            <code className="sp-help-cmd">{r.cmd}</code>
                            <span className="sp-help-desc">{r.desc}</span>
                        </div>
                    ))}
                </section>
            ))}
            <div className="sp-help-foot">
                <FontAwesomeIcon icon={faCircleQuestion} /> Type <code>/help</code> any time.
            </div>
        </div>
    );
}
