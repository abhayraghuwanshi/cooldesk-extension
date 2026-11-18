import { TEAM_FEATURE_ENABLED } from '../../config/features.js';
import { LANGUAGES, getLanguagePreference, setLanguage } from '../../shared/i18n';
import { availableEngines, getEngineKey, getWebSuggestEnabled, setEngineKey, setWebSuggestEnabled } from '../../shared/searchEngines';
import { openSettingsSection } from '../settings/settingsNav';

// Spotlight shortcuts to settings that are otherwise a few clicks deep in the
// Settings page (desktop app only — useSlashCommands gates them):
//
//   /language [name]        set the UI language right here
//   /search-engine [name]   the engine Spotlight searches & suggests with
//   /web-suggestions on|off suggestions while typing
//   /settings [section]     open Settings (at a section)
//   /theme, /hotkey, /backup, /sync, /updates, /windows, /ai-models,
//   /folder-index           open Settings at the matching section
//
// Only a fully typed value runs on a bare Enter ("/language español",
// "/search-engine ddg"); a partial one ("/language esp") puts an
// "open the settings" row on top, so a reflex Enter never changes a setting —
// picking the language/engine row itself does.

const LANGUAGE_ENGLISH = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
    ru: 'Russian', tr: 'Turkish', id: 'Indonesian', hi: 'Hindi', ar: 'Arabic', zh: 'Chinese',
    ja: 'Japanese', ko: 'Korean',
};
const AUTO_WORDS = ['auto', 'default', 'system', 'browser'];

// Settings pages reachable by a word of their own. `section` is a tab id in
// SettingsModal's TABS.
const PAGES = [
    { word: 'settings', section: 'general', title: 'Settings', description: 'Open Settings — or /settings appearance, /settings data…' },
    { word: 'theme', section: 'appearance', title: 'Theme & appearance', description: 'Settings › Appearance: themes, fonts, wallpaper' },
    { word: 'hotkey', section: 'general', title: 'Spotlight shortcut', description: 'Settings › General: change the key that opens Spotlight' },
    { word: 'windows', section: 'windows', title: 'Windows', description: 'Settings › Windows: dock bar and sidebar' },
    { word: 'ai-models', section: 'local-ai', title: 'AI models', description: 'Settings › Local AI: models and API keys' },
    { word: 'folder-index', section: 'folders', title: 'Folder index', description: 'Settings › Folders: which folders search covers' },
    { word: 'backup', section: 'data', title: 'Backup & restore', description: 'Settings › Data: backups, restore' },
    { word: 'sync', section: 'data', title: 'Sync', description: 'Settings › Data: sync with the browser extension' },
    { word: 'updates', section: 'data', title: 'Updates', description: 'Settings › Data: check for updates' },
];

// "/settings <section>" — the sections by name.
const SECTIONS = [
    { key: 'general', label: 'General' },
    { key: 'windows', label: 'Windows' },
    { key: 'appearance', label: 'Appearance' },
    { key: 'local-ai', label: 'Local AI' },
    { key: 'folders', label: 'Folders' },
    ...(TEAM_FEATURE_ENABLED ? [{ key: 'team', label: 'Team' }] : []),
    { key: 'data', label: 'Data' },
];

const norm = (s) => String(s || '').trim().toLowerCase();

function findLanguage(arg) {
    const a = norm(arg);
    if (!a) return null;
    if (AUTO_WORDS.includes(a)) return 'auto';
    const hit = LANGUAGES.find(l => l.code === a || norm(l.name) === a || norm(LANGUAGE_ENGLISH[l.code]) === a);
    return hit ? hit.code : null;
}

function languageLabel(code) {
    if (code === 'auto') return 'Browser default';
    const l = LANGUAGES.find(x => x.code === code);
    if (!l) return code;
    return LANGUAGE_ENGLISH[code] && LANGUAGE_ENGLISH[code] !== l.name ? `${l.name} (${LANGUAGE_ENGLISH[code]})` : l.name;
}

function findEngine(arg) {
    const a = norm(arg);
    if (!a) return null;
    return availableEngines().find(e => e.key === a || norm(e.label) === a)?.key || null;
}

function findSection(arg) {
    const a = norm(arg);
    if (!a) return null;
    return SECTIONS.find(s => s.key === a || norm(s.label) === a)?.key || null;
}

/**
 * A fully typed settings command → what to do, or null.
 *   { kind: 'language', value } | { kind: 'engine', value }
 *   { kind: 'suggest', on } | { kind: 'open', section }
 */
export function parseSettingsCommand(rawQuery) {
    const m = String(rawQuery || '').trim().match(/^\/([a-z-]+)(?:\s+(.*))?$/i);
    if (!m) return null;
    const word = m[1].toLowerCase();
    const arg = (m[2] || '').trim();

    if (word === 'language' || word === 'lang') {
        const value = findLanguage(arg);
        return value ? { kind: 'language', value } : null;
    }
    if (word === 'search-engine' || word === 'engine') {
        const value = findEngine(arg);
        return value ? { kind: 'engine', value } : null;
    }
    if (word === 'web-suggestions') {
        const a = norm(arg);
        return a === 'on' || a === 'off' ? { kind: 'suggest', on: a === 'on' } : null;
    }
    if (word === 'settings') {
        if (!arg) return { kind: 'open', section: 'general' };
        const section = findSection(arg);
        return section ? { kind: 'open', section } : null;
    }
    const page = !arg && PAGES.find(p => p.word === word);
    return page ? { kind: 'open', section: page.section } : null;
}

/** Run a parsed command; `feedback(message, type)` reports the outcome. */
export async function runSettingsCommand(cmd, feedback) {
    try {
        if (cmd.kind === 'language') {
            setLanguage(cmd.value);
            feedback?.(`Language: ${languageLabel(cmd.value)}`, 'success');
        } else if (cmd.kind === 'engine') {
            setEngineKey(cmd.value);
            feedback?.(`Searching with ${availableEngines().find(e => e.key === cmd.value)?.label || cmd.value}`, 'success');
        } else if (cmd.kind === 'suggest') {
            setWebSuggestEnabled(cmd.on);
            feedback?.(`Web suggestions ${cmd.on ? 'on' : 'off'}`, 'success');
        } else if (cmd.kind === 'open') {
            await openSettingsSection(cmd.section);
        }
    } catch (e) {
        console.error('[SettingsCommands] failed:', e);
        feedback?.('Couldn’t open Settings', 'error');
    }
}

// ── Suggestions ─────────────────────────────────────────────────────────────

const row = (command, title, description, extra = {}) => ({ command, title, description, category: 'Settings', ...extra });

const matchesFilter = (filter, ...texts) => !filter || texts.some(t => norm(t).includes(filter));

/**
 * Rows for a typed "/…" query: { command, title, description, category,
 * insert? } (insert-only rows put text in the box; the rest run on pick).
 * `null` when nothing here matches.
 */
export function settingsSuggestions(rawQuery) {
    const q = String(rawQuery || '').trim();
    if (!q.startsWith('/')) return null;
    const m = q.match(/^\/([a-z-]*)(\s+(.*))?$/i);
    if (!m) return null;
    const word = m[1].toLowerCase();
    const hasArg = m[2] != null;
    const filter = norm(m[3]);

    // Inside a command's argument: list its values.
    if (hasArg || ['language', 'lang', 'search-engine', 'engine', 'web-suggestions'].includes(word)) {
        if (word === 'language' || word === 'lang') {
            const pref = getLanguagePreference();
            const langs = [{ code: 'auto' }, ...LANGUAGES]
                .filter(l => matchesFilter(filter, l.code, l.name, LANGUAGE_ENGLISH[l.code], l.code === 'auto' ? AUTO_WORDS.join(' ') : ''))
                .map(l => row(
                    `/language ${l.code}`,
                    languageLabel(l.code),
                    l.code === pref ? 'Current language' : `Switch CoolDesk to ${languageLabel(l.code)}`,
                ));
            return [row('/settings general', 'Language settings', 'Open Settings › General'), ...langs];
        }
        if (word === 'search-engine' || word === 'engine') {
            const cur = getEngineKey();
            const engines = availableEngines()
                .filter(e => matchesFilter(filter, e.key, e.label))
                .map(e => row(
                    `/search-engine ${e.key}`,
                    e.label,
                    e.key === cur ? 'Current search engine' : `Search and suggest with ${e.label}`,
                ));
            return [row('/settings general', 'Web search settings', 'Open Settings › General'), ...engines];
        }
        if (word === 'web-suggestions') {
            const on = getWebSuggestEnabled();
            return [row(`/web-suggestions ${on ? 'off' : 'on'}`, `Turn ${on ? 'off' : 'on'} web suggestions`,
                `Suggestions from your search engine as you type are ${on ? 'on' : 'off'}`)];
        }
        if (word === 'settings') {
            const rows = SECTIONS
                .filter(s => matchesFilter(filter, s.key, s.label))
                .map(s => row(`/settings ${s.key}`, `Settings › ${s.label}`, `Open the ${s.label} section`));
            return rows.length ? rows : null;
        }
        return null;
    }

    // Typing the command word: offer the commands that start with / contain it.
    if (word.length < 2) return null;
    const rows = [
        row('/language', 'Language', 'Change the language CoolDesk speaks — /language español', { insert: '/language ' }),
        row('/search-engine', 'Search engine', 'Google, DuckDuckGo, Brave… for web search and suggestions', { insert: '/search-engine ' }),
        // Insert-only: a partly typed "/we" + Enter mustn't flip it.
        row('/web-suggestions', 'Web suggestions', `Suggestions as you type are ${getWebSuggestEnabled() ? 'on' : 'off'} — /web-suggestions on · off`, { insert: '/web-suggestions ' }),
        ...PAGES.map(p => (p.word === 'settings'
            ? row('/settings', p.title, p.description, { insert: '/settings ' })
            : row(`/${p.word}`, p.title, p.description))),
    ].filter(r => r.command.slice(1).toLowerCase().startsWith(word)
        || (word.length >= 3 && norm(`${r.title} ${r.description}`).includes(word)));
    rows.sort((a, b) => {
        const rank = (r) => (r.command.slice(1).startsWith(word) ? 0 : 1);
        return rank(a) - rank(b);
    });
    return rows.length ? rows : null;
}
