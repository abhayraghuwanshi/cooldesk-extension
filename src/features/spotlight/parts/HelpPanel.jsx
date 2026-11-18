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
            { cmd: '/dock', insert: '/dock ', desc: 'Turn the dock bar on or off — /dock on · /dock off', desktop: true },
            { cmd: '/sidebar', insert: '/sidebar ', desc: 'Turn the sidebar on or off — /sidebar on · /sidebar off', desktop: true },
            { cmd: '> cmd', insert: '> ', desc: 'Run a command in a new shell (⌘↵: in a CoolDesk terminal tab)', desktop: true },
            { cmd: '/agent', insert: '/agent ', desc: 'Ask the AI agent to search, add links or set up a workspace', desktop: true },
            { cmd: '/new-workspace', insert: '/new-workspace', desc: 'Guided setup: name, folders, links' },
            { cmd: '/workspace-name', desc: 'Type a workspace’s name after / to edit it' },
            { cmd: '/help', desc: 'This page' },
        ],
    },
    {
        // Shortcuts into Settings (settingsCommands.js) — desktop app only.
        title: 'Settings',
        desktop: true,
        rows: [
            { cmd: '/settings', insert: '/settings ', desc: 'Open Settings — or a section: /settings appearance, /settings data…' },
            { cmd: '/language', insert: '/language ', desc: 'Change the language — /language español, /language auto' },
            { cmd: '/search-engine', insert: '/search-engine ', desc: 'Engine for web search and suggestions — /search-engine ddg' },
            { cmd: '/web-suggestions', insert: '/web-suggestions ', desc: 'Suggestions as you type — /web-suggestions on · off' },
            { cmd: '/theme', insert: '/theme', desc: 'Themes, fonts and wallpaper' },
            { cmd: '/hotkey', insert: '/hotkey', desc: 'Change the key that opens Spotlight' },
            { cmd: '/windows', insert: '/windows', desc: 'Dock bar and sidebar settings' },
            { cmd: '/ai-models', insert: '/ai-models', desc: 'Local AI models and API keys' },
            { cmd: '/folder-index', insert: '/folder-index', desc: 'Folders that file search covers' },
            { cmd: '/backup', insert: '/backup', desc: 'Backups and restore — also /sync, /updates' },
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
            {SECTIONS.filter(sec => isDesktopApp || !sec.desktop).map(sec => (
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
