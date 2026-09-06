import { useCallback, useMemo, useRef } from 'react';
import { TEAM_FEATURE_ENABLED } from '../../config/features.js';
import { CommandExecutor } from '../../services/commandExecutor.js';
import { CommandParser, COMMANDS } from '../../services/commandParser.js';

// Slash (/nav) + bang (!action) command palette extracted from the old
// CoolSearch so any search surface can opt in. The host surface owns rendering:
// getSuggestions() maps a typed query to selectable command rows, execute()
// runs one. /ai, /model and the /u /a /f search scopes are deliberately NOT
// handled here — the spotlight owns those modes.
//
//   const slash = useSlashCommands({ enabled, isDesktopApp, onNavigate, showFeedback });

// Queries this hook must leave alone (handled by the spotlight itself)
const RESERVED_RE = /^\/(u|a|f)(\s|$)|^\/(ai|model)\b/i;

export function useSlashCommands({ enabled = false, isDesktopApp = false, onNavigate, showFeedback }) {
    const showFeedbackRef = useRef(showFeedback);
    showFeedbackRef.current = showFeedback;
    const onNavigateRef = useRef(onNavigate);
    onNavigateRef.current = onNavigate;

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
    // ['workspace', 'tabs', 'team'] (see DESKTOP_FACES) — there's no chat
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
                ...(TEAM_FEATURE_ENABLED ? { '/team': 'team' } : {}),
            },
            alias: {
                '/o': 'overview',
                '/w': 'workspace',
                '/t': 'tabs',
                ...(TEAM_FEATURE_ENABLED ? { '/tm': 'team' } : {}),
            },
        };
    }, [isDesktopApp, hasNavigate]);

    // A typed query Enter should run directly (beats any highlighted
    // suggestion). Only *known* command words qualify — partial input like
    // "!ju" still goes to the highlighted "!jump <tab>" template instead.
    const isDirectCommand = useCallback((rawQuery) => {
        if (!enabled) return false;
        const q = (rawQuery || '').trim();
        if (!q || RESERVED_RE.test(q)) return false;
        if (navMaps.full[q] || navMaps.alias[q]) return true;
        if (q.startsWith('!') || q.startsWith('/')) {
            const parsed = CommandParser.parse(q.startsWith('/') ? `!${q.slice(1)}` : q);
            return !!parsed
                && Object.values(COMMANDS).includes(parsed.command)
                && CommandParser.validate(parsed);
        }
        return false;
    }, [enabled, navMaps]);

    const execute = useCallback(async (rawQuery) => {
        if (!enabled) return false;
        const q = (rawQuery || '').trim();
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
    }, [enabled, navMaps, getExecutor]);

    // Map a typed "/..." or "!..." query to command palette rows shaped like
    // spotlight result items ({ type: 'command', command | insert }).
    // Returns null when the query isn't command-like (host runs normal search).
    const getSuggestions = useCallback((rawQuery) => {
        if (!enabled) return null;
        const q = (rawQuery || '').trim();
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
                { command: '/u', title: 'Search URLs', description: 'Scope search to tabs, history, bookmarks', category: 'Scope', insert: '/u ' },
                { command: '/a', title: 'Search Apps', description: 'Scope search to applications', category: 'Scope', insert: '/a ' },
                { command: '/f', title: 'Search Files', description: 'Scope search to files and folders', category: 'Scope', insert: '/f ' },
            ];
            const matches = entries.filter(e =>
                !filter || `${e.command} ${e.title} ${e.description}`.toLowerCase().includes(filter)
            );
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
    }, [enabled, navMaps]);

    // Stable identity so hosts can use the hook result as an effect dependency
    return useMemo(
        () => ({ enabled, isDirectCommand, execute, getSuggestions }),
        [enabled, isDirectCommand, execute, getSuggestions]
    );
}
