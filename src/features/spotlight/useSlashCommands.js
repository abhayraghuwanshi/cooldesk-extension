import { useCallback, useMemo, useRef } from 'react';
import { TEAM_FEATURE_ENABLED } from '../../config/features.js';
import { CommandExecutor } from '../../services/commandExecutor.js';
import { CommandParser, COMMANDS } from '../../services/commandParser.js';
import { disableSurface, enableSurface } from '../dock/surfaceControls.js';
import { useDockState } from '../dock/useDockState.js';
import { parseSettingsCommand, runSettingsCommand, settingsSuggestions } from './settingsCommands.js';

// Slash (/nav) + bang (!action) command palette extracted from the old
// CoolSearch so any search surface can opt in. The host surface owns rendering:
// getSuggestions() maps a typed query to selectable command rows, execute()
// runs one. /ai, /model and the /u /a /f search scopes are deliberately NOT
// handled here — the spotlight owns those modes.
//
//   const slash = useSlashCommands({ enabled, isDesktopApp, onNavigate, showFeedback });

// Queries this hook must leave alone (handled by the spotlight itself)
const RESERVED_RE = /^\/(u|a|f)(\s|$)|^\/(ai|model)\b/i;

// "/dock", "/dock on", "/sidebar off"… → turn the dock bar / sidebar window
// on or off (desktop only). Bare "/dock" toggles. The backend calls the dock
// surface 'bar'.
const SURFACE_RE = /^\/(dock|sidebar)(?:\s+(on|off))?$/i;
const SURFACES = { dock: { surface: 'bar', label: 'Dock' }, sidebar: { surface: 'sidebar', label: 'Sidebar' } };

export function useSlashCommands({ enabled = false, isDesktopApp = false, onNavigate, showFeedback }) {
    const showFeedbackRef = useRef(showFeedback);
    showFeedbackRef.current = showFeedback;
    const onNavigateRef = useRef(onNavigate);
    onNavigateRef.current = onNavigate;

    // Live on/off state of the dock & sidebar (null outside the desktop app)
    const dockState = useDockState();
    const dockStateRef = useRef(dockState);
    dockStateRef.current = dockState;

    const executorRef = useRef(null);
    const getExecutor = useCallback(() => {
        if (!executorRef.current) {
            executorRef.current = new CommandExecutor((feedback) => {
                showFeedbackRef.current?.(feedback.message, feedback.type);
            });
        }
        return executorRef.current;
    }, []);

    // Face navigation — only meaningful when the host can switch faces.
    // Keyed on *whether* a navigate handler exists (not its identity — hosts
    // recreate the callback every render; the ref above tracks the latest).
    // No '/chat' or '/c' here: WorkspaceShell's actual face list is
    // ['workspace', 'tabs', 'browse', 'team'] (see DESKTOP_FACES) — there's no chat
    // face to land on, so navigating there used to leave the shell on a
    // currentFace nothing renders for.
    const hasNavigate = !!onNavigate;
    const navMaps = useMemo(() => {
        if (!isDesktopApp || !hasNavigate) return { full: {}, alias: {} };
        return {
            full: {
                '/overview': 'overview',
                '/workspace': 'workspace',
                '/workspaces': 'workspace',
                '/tabs': 'tabs',
                '/browse': 'browse',
                ...(TEAM_FEATURE_ENABLED ? { '/team': 'team' } : {}),
            },
            alias: {
                '/o': 'overview',
                '/w': 'workspace',
                '/t': 'tabs',
                '/b': 'browse',
                ...(TEAM_FEATURE_ENABLED ? { '/tm': 'team' } : {}),
            },
        };
    }, [isDesktopApp, hasNavigate]);

    // A typed query Enter should run directly (beats any highlighted
    // suggestion). Only *known* command words qualify — partial input like
    // "!ju" still goes to the highlighted "!jump <tab>" template instead.
    const isDirectCommand = useCallback((rawQuery) => {
        const q = (rawQuery || '').trim();
        // Dock/sidebar commands work even where the rest of the palette is
        // off (the overlay spotlight window doesn't enable it).
        if (isDesktopApp && SURFACE_RE.test(q)) return true;
        // Settings shortcuts (/language, /settings, /theme…) likewise.
        if (isDesktopApp && parseSettingsCommand(q)) return true;
        if (!enabled) return false;
        if (!q || RESERVED_RE.test(q)) return false;
        if (navMaps.full[q] || navMaps.alias[q]) return true;
        if (q.startsWith('!') || q.startsWith('/')) {
            const parsed = CommandParser.parse(q.startsWith('/') ? `!${q.slice(1)}` : q);
            return !!parsed
                && Object.values(COMMANDS).includes(parsed.command)
                && CommandParser.validate(parsed);
        }
        return false;
    }, [enabled, navMaps, isDesktopApp]);

    const execute = useCallback(async (rawQuery) => {
        const q = (rawQuery || '').trim();
        const surfaceMatch = isDesktopApp && q.match(SURFACE_RE);
        if (surfaceMatch) {
            const { surface, label } = SURFACES[surfaceMatch[1].toLowerCase()];
            const wanted = surfaceMatch[2]?.toLowerCase();
            const turnOn = wanted ? wanted === 'on' : !dockStateRef.current?.[surface]?.enabled;
            try {
                await (turnOn ? enableSurface(surface) : disableSurface(surface));
                showFeedbackRef.current?.(`${label} ${turnOn ? 'on' : 'off'}`, 'success');
            } catch (error) {
                console.error(`[SlashCommands] ${label} toggle failed:`, error);
                showFeedbackRef.current?.(`Couldn't turn ${label.toLowerCase()} ${turnOn ? 'on' : 'off'}`, 'error');
            }
            return true;
        }

        const settingsCmd = isDesktopApp && parseSettingsCommand(q);
        if (settingsCmd) {
            await runSettingsCommand(settingsCmd, (msg, type) => showFeedbackRef.current?.(msg, type));
            return true;
        }

        if (!enabled) return false;
        if (!q || RESERVED_RE.test(q)) return false;

        const navTarget = navMaps.full[q] || navMaps.alias[q];
        if (navTarget) {
            onNavigateRef.current?.(navTarget);
            return true;
        }

        if (q.startsWith('!') || q.startsWith('/')) {
            try {
                const parsed = CommandParser.parse(q.startsWith('/') ? `!${q.slice(1)}` : q);
                if (!parsed) return false;
                const result = await getExecutor().execute(parsed);
                if (result?.workspace) {
                    window.dispatchEvent(new CustomEvent('workspaceChanged', {
                        detail: { workspace: result.workspace }
                    }));
                }
                return true;
            } catch (error) {
                console.error('[SlashCommands] Command execution error:', error);
                showFeedbackRef.current?.(error.message || 'Command failed', 'error');
                return true; // handled (with an error) — don't fall through to web search
            }
        }
        return false;
    }, [enabled, navMaps, isDesktopApp, getExecutor]);

    // Map a typed "/..." or "!..." query to command palette rows shaped like
    // spotlight result items ({ type: 'command', command | insert }).
    // Returns null when the query isn't command-like (host runs normal search).
    const getSuggestions = useCallback((rawQuery) => {
        const q = (rawQuery || '').trim();

        // Executable rows (no insert): selecting one flips that surface; the
        // title says what selecting it will do.
        const surfaceEntries = isDesktopApp ? Object.entries(SURFACES).map(([word, { surface, label }]) => {
            const on = !!dockState?.[surface]?.enabled;
            return {
                command: `/${word} ${on ? 'off' : 'on'}`,
                title: `${on ? 'Turn off' : 'Turn on'} ${label}`,
                description: `${label} is ${on ? 'on' : 'off'} — /${word} on · /${word} off`,
                category: 'Layout',
            };
        }) : [];

        // Settings shortcuts (desktop): /language …, /search-engine …, /theme…
        const settingsRows = isDesktopApp ? settingsSuggestions(q) : null;
        // In a command's argument ("/language esp") they're the whole list.
        // (The query arrives trimmed, so "/language " is just "/language".)
        const inSettingsArg = !!settingsRows
            && (/^\/[a-z-]+\s/i.test(q) || /^\/(language|lang|search-engine|engine|web-suggestions)$/i.test(q));

        if (!enabled) {
            // Palette off: still offer the dock/sidebar rows once the typed
            // text is the start of one ("/do", "/sidebar o"…).
            const typed = q.toLowerCase();
            if (typed.length < 2 || !typed.startsWith('/')) return null;
            const rows = inSettingsArg ? [] : surfaceEntries.filter(e => {
                const word = e.command.split(' ')[0];
                return word.startsWith(typed) || typed.startsWith(word + ' ') || typed === word;
            });
            const all = [...rows, ...(settingsRows || [])];
            return all.length ? all.map(e => ({
                id: `cmd:${e.command}`, type: 'command', title: e.title, description: e.description,
                category: e.category, command: e.insert ? null : e.command, insert: e.insert || null,
                commandId: e.command.split(' ')[0],
            })) : null;
        }
        if (!q || RESERVED_RE.test(q)) return null;

        const toItem = ({ command, title, description, category, insert }) => ({
            id: `cmd:${command}`,
            type: 'command',
            title,
            description,
            category,
            command: insert ? null : command,
            insert: insert || null,
            // Always the real command word, even for insert-only rows (whose
            // `command` above is deliberately null so selecting them can't
            // execute) — the icon/color lookup needs it regardless of
            // whether the row is executable or insert-only.
            commandId: command,
        });

        if (inSettingsArg) return settingsRows.map(toItem);

        if (q.startsWith('/')) {
            const filter = q.slice(1).toLowerCase();
            // Just the leader commands worth recommending: create a
            // workspace, the agent (search/edit — /ai and /model are still
            // typeable directly but no longer surfaced here, superseded by
            // /agent), and the three scoped searches. Face navigation
            // (/overview, /workspace, /chat, …) isn't recommended either —
            // unused, kept working only for anyone who already types it.
            const entries = [
                { command: '/new-workspace', title: 'New Workspace', description: 'Guided setup: name, pick folders, optionally scaffold .cooldesk/', category: 'Workspace', insert: '/new-workspace ' },
                { command: '/agent', title: 'Agent', description: 'Chat with Claude Code — search/add links, scaffold a shared .cooldesk/ workspace, /name to rename', category: 'AI', insert: '/agent ' },
                { command: '/help', title: 'Help', description: 'What Spotlight can do, and what’s running right now', category: 'Help', insert: '/help' },
                { command: '/todo', title: 'Todos', description: 'Todos in Active (or pick a workspace) — type to add', category: 'Workspace', insert: '/todo ' },
                { command: '/notes', title: 'Notes', description: 'Notes in Active (or pick a workspace) — type to jot one', category: 'Workspace', insert: '/notes ' },
                ...surfaceEntries,
                ...(isDesktopApp ? [{ command: '/shell', title: 'Shell', description: 'A terminal right here — keeps running when Spotlight closes', category: 'Terminal', insert: '/shell' }] : []),
                ...(isDesktopApp ? [
                    { command: '/settings', title: 'Settings', description: 'Open Settings — /theme, /hotkey, /backup… jump to a section', category: 'Settings', insert: '/settings ' },
                    { command: '/language', title: 'Language', description: 'Change the language CoolDesk speaks', category: 'Settings', insert: '/language ' },
                ] : []),
                { command: '/u', title: 'Search URLs', description: 'Scope search to tabs, history, bookmarks', category: 'Scope', insert: '/u ' },
                { command: '/a', title: 'Search Apps', description: 'Scope search to applications', category: 'Scope', insert: '/a ' },
                { command: '/f', title: 'Search Files', description: 'Scope search to files and folders', category: 'Scope', insert: '/f ' },
            ];
            const matches = entries.filter(e =>
                !filter || `${e.command} ${e.title} ${e.description}`.toLowerCase().includes(filter)
            );
            // The rest of the settings shortcuts, once a word is typed
            for (const r of settingsRows || []) {
                if (!matches.some(e => e.command === r.command)) matches.push(r);
            }
            // Exact/prefix command matches first
            matches.sort((a, b) => {
                const rank = (e) => e.command === `/${filter}` ? 0 : e.command.startsWith(`/${filter}`) ? 1 : 2;
                return rank(a) - rank(b);
            });
            return matches.map(toItem);
        }

        if (q.startsWith('!')) {
            const filter = q.slice(1).toLowerCase();
            return CommandParser.getAllCommands()
                .filter(c => !filter || `${c.command} ${c.description}`.toLowerCase().includes(filter))
                .map(c => {
                    const hasArgs = c.command.includes('<');
                    return toItem({
                        command: c.command,
                        title: c.command,
                        description: c.description,
                        category: c.category,
                        // Templates insert their prefix; arg-less commands run directly
                        insert: hasArgs ? c.command.slice(0, c.command.indexOf('<')).trimEnd() + ' ' : null,
                    });
                });
        }

        return null;
    }, [enabled, navMaps, isDesktopApp, dockState]);

    // Stable identity so hosts can use the hook result as an effect dependency
    return useMemo(
        () => ({ enabled, isDirectCommand, execute, getSuggestions }),
        [enabled, isDirectCommand, execute, getSuggestions]
    );
}
