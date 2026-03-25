/**
 * App Categorization Service
 *
 * 1. Standard categorization: Maps apps to 16 standard categories (Developer Tools, Games, etc.)
 * 2. Workspace suggestions: Uses local AI to suggest apps for user's workspaces
 *
 * Results are cached in localStorage/IndexedDB for fast subsequent loads.
 */

const STORAGE_KEY_SUGGESTIONS = 'cooldesk_app_suggestions';
const STORAGE_KEY_SEEDED_HASH = 'cooldesk_app_seeded_hash';
const STORAGE_KEY_CATEGORY_CACHE = 'cooldesk_app_category_cache';

// ─── Standard Categories ─────────────────────────────────────────────────────

export const STANDARD_CATEGORIES = [
    'Developer Tools',
    'Browsers',
    'Communication',
    'Music',
    'Video',
    'Graphics & Design',
    'Games',
    'Productivity',
    'Finance',
    'Education',
    'News',
    'Health & Fitness',
    'Travel',
    'Shopping',
    'Utilities',
    'Other'
];

/**
 * Fast heuristic categorization based on app name, folder, and path
 * @param {string} appName - The app name
 * @param {string} folderCategory - The Start Menu folder name
 * @param {string} appPath - The executable path
 * @returns {string} Standard category
 */
export function categorizeByHeuristic(appName, folderCategory = '', appPath = '') {
    const name = (appName || '').toLowerCase();
    const folder = (folderCategory || '').toLowerCase();
    const path = (appPath || '').toLowerCase();

    // Developer Tools
    if (folder.includes('visual studio') || folder.includes('android') || folder.includes('java') ||
        folder.includes('python') || folder.includes('node') || folder.includes('git') ||
        folder.includes('developer') || folder.includes('sdk') ||
        name.includes('code') || name.includes('studio') || name.includes('ide') ||
        name.includes('terminal') || name.includes('powershell') || name.includes('git') ||
        name.includes('docker') || name.includes('postman') || name.includes('insomnia') ||
        name.includes('sublime') || name.includes('vim') || name.includes('neovim') ||
        name.includes('intellij') || name.includes('pycharm') || name.includes('webstorm') ||
        name.includes('rider') || name.includes('datagrip') || name.includes('goland') ||
        name.includes('cmake') || name.includes('mingw') || name.includes('msys') ||
        name.includes('wsl') || name.includes('ubuntu') || name.includes('debian') ||
        path.includes('\\jetbrains\\') || path.includes('\\microsoft sdks\\') ||
        path.includes('\\nodejs\\') || path.includes('\\python') || path.includes('\\git\\')) {
        return 'Developer Tools';
    }

    // Browsers
    if (name.includes('chrome') || name.includes('firefox') || name.includes('edge') ||
        name.includes('safari') || name.includes('opera') || name.includes('brave') ||
        name.includes('vivaldi') || name.includes('browser') || name.includes('tor') ||
        path.includes('\\google\\chrome\\') || path.includes('\\mozilla firefox\\') ||
        path.includes('\\browsercore\\')) {
        return 'Browsers';
    }

    // Communication
    if (name.includes('slack') || name.includes('teams') || name.includes('discord') ||
        name.includes('zoom') || name.includes('skype') || name.includes('telegram') ||
        name.includes('whatsapp') || name.includes('mail') || name.includes('outlook') ||
        name.includes('thunderbird') || name.includes('signal') || name.includes('webex') ||
        name.includes('meet') || name.includes('messenger') || name.includes('viber') ||
        folder.includes('communication') ||
        path.includes('\\slack\\') || path.includes('\\discord\\') || path.includes('\\zoom\\')) {
        return 'Communication';
    }

    // Graphics & Design
    if (folder.includes('blackmagic') || folder.includes('adobe') || folder.includes('design') ||
        name.includes('photoshop') || name.includes('illustrator') || name.includes('figma') ||
        name.includes('gimp') || name.includes('inkscape') || name.includes('blender') ||
        name.includes('davinci') || name.includes('premiere') || name.includes('after effects') ||
        name.includes('lightroom') || name.includes('sketch') || name.includes('canva') ||
        name.includes('affinity') || name.includes('krita') || name.includes('paint') ||
        name.includes('fusion') || name.includes('resolve') || name.includes('media encoder') ||
        path.includes('\\adobe\\') || path.includes('\\blackmagic design\\') ||
        path.includes('\\autodesk\\') || path.includes('\\corel\\')) {
        return 'Graphics & Design';
    }

    // Games
    if (folder.includes('game') || folder === 'ea' || folder.includes('steam') ||
        folder.includes('epic') || folder.includes('ubisoft') || folder.includes('xbox') ||
        folder.includes('blizzard') || folder.includes('riot') || folder.includes('rockstar') ||
        name.includes('game') || name.includes('steam') || name.includes('epic games') ||
        name.includes('battle.net') || name.includes('origin') || name.includes('gog') ||
        name.includes('valorant') || name.includes('minecraft') || name.includes('roblox') ||
        name.includes('launcher') ||
        path.includes('\\steam\\') || path.includes('\\epic games\\') ||
        path.includes('\\riot games\\') || path.includes('\\ea games\\') ||
        path.includes('\\ubisoft\\') || path.includes('\\rockstar games\\')) {
        return 'Games';
    }

    // Productivity / Office
    if (folder.includes('office') || folder.includes('libreoffice') || folder.includes('microsoft') ||
        name.includes('word') || name.includes('excel') || name.includes('powerpoint') ||
        name.includes('onenote') || name.includes('notion') || name.includes('obsidian') ||
        name.includes('evernote') || name.includes('todoist') || name.includes('trello') ||
        name.includes('asana') || name.includes('monday') || name.includes('clickup') ||
        name.includes('writer') || name.includes('calc') || name.includes('impress') ||
        name.includes('acrobat') || name.includes('pdf') || name.includes('reader') ||
        name.includes('onedrive') || name.includes('dropbox') || name.includes('google drive') ||
        path.includes('\\microsoft office\\') || path.includes('\\libreoffice\\')) {
        return 'Productivity';
    }

    // Music
    if (name.includes('spotify') || name.includes('music') || name.includes('itunes') ||
        name.includes('audacity') || name.includes('audio') || name.includes('soundcloud') ||
        name.includes('tidal') || name.includes('deezer') || name.includes('foobar') ||
        name.includes('winamp') || name.includes('fl studio') || name.includes('ableton') ||
        name.includes('cubase') || name.includes('reaper') || name.includes('logic') ||
        path.includes('\\spotify\\') || path.includes('\\itunes\\')) {
        return 'Music';
    }

    // Video
    if (name.includes('vlc') || name.includes('video') || name.includes('player') ||
        name.includes('netflix') || name.includes('plex') || name.includes('kodi') ||
        name.includes('mpv') || name.includes('obs') || name.includes('streamlabs') ||
        name.includes('handbrake') || name.includes('ffmpeg') || name.includes('mpc') ||
        name.includes('potplayer') || name.includes('kmplayer') ||
        path.includes('\\videolan\\') || path.includes('\\obs-studio\\')) {
        return 'Video';
    }

    // Utilities / System - check this AFTER more specific categories
    if (folder.includes('administrative') || folder.includes('accessories') || folder.includes('system') ||
        folder.includes('accessibility') || folder.includes('maintenance') || folder.includes('tools') ||
        name.includes('settings') || name.includes('control panel') || name.includes('task manager') ||
        name.includes('cleaner') || name.includes('backup') || name.includes('7-zip') ||
        name.includes('winrar') || name.includes('notepad') || name.includes('calculator') ||
        name.includes('snipping') || name.includes('clipboard') || name.includes('everything') ||
        name.includes('ccleaner') || name.includes('defrag') || name.includes('registry') ||
        name.includes('uninstall') || name.includes('driver') || name.includes('update') ||
        name.includes('manager') || name.includes('monitor') || name.includes('info') ||
        name.includes('diagnostic') || name.includes('repair') || name.includes('recovery') ||
        path.includes('\\nvidia corporation\\') || path.includes('\\amd\\') ||
        path.includes('\\intel\\') || path.includes('\\realtek\\') ||
        path.includes('\\windows\\system32\\') || path.includes('\\syswow64\\') ||
        path.includes('\\windowsapps\\') && !name.includes('store')) {
        return 'Utilities';
    }

    // Finance
    if (name.includes('bank') || name.includes('finance') || name.includes('money') ||
        name.includes('budget') || name.includes('quicken') || name.includes('mint') ||
        name.includes('ynab') || name.includes('quickbooks') || name.includes('tax') ||
        name.includes('accounting')) {
        return 'Finance';
    }

    // Education
    if (name.includes('learn') || name.includes('course') || name.includes('duolingo') ||
        name.includes('anki') || name.includes('khan') || name.includes('coursera') ||
        name.includes('udemy') || name.includes('tutorial') || name.includes('training')) {
        return 'Education';
    }

    return 'Other';
}

/**
 * Get cached standard categories from localStorage
 */
export function getCachedStandardCategories() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_CATEGORY_CACHE);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

/**
 * Save standard categories to localStorage cache
 */
export function saveCachedStandardCategories(cache) {
    try {
        localStorage.setItem(STORAGE_KEY_CATEGORY_CACHE, JSON.stringify(cache));
    } catch (e) {
        console.debug('[AppCategorization] saveCachedStandardCategories error:', e);
    }
}

/**
 * Categorize an app with caching
 * @param {Object} app - App with name, category (folder), and path properties
 * @returns {string} Standard category
 */
export function categorizeApp(app) {
    const cache = getCachedStandardCategories();
    const key = app.path || app.name;

    // Check cache first
    if (cache[key]) {
        return cache[key];
    }

    // Compute category using heuristic (now includes path)
    const category = categorizeByHeuristic(app.name, app.category, app.path);

    // Cache the result
    cache[key] = category;
    saveCachedStandardCategories(cache);

    return category;
}

// ─── Hash ────────────────────────────────────────────────────────────────────

function computeHash(installedApps, workspaces) {
    const appsStr = installedApps
        .map(a => a.name)
        .sort()
        .slice(0, 100)   // cap to avoid huge strings
        .join(',');
    const wsStr = workspaces.map(w => w.name).sort().join(',');
    return `${appsStr}|${wsStr}`;
}

// ─── Seeded flag ─────────────────────────────────────────────────────────────

export function hasBeenSeeded(hash) {
    try {
        return localStorage.getItem(STORAGE_KEY_SEEDED_HASH) === hash;
    } catch (e) {
        console.debug('[AppCategorization] hasBeenSeeded error:', e);
        return false;
    }
}

export function markSeeded(hash) {
    try {
        localStorage.setItem(STORAGE_KEY_SEEDED_HASH, hash);
    } catch (e) {
        console.debug('[AppCategorization] markSeeded error:', e);
    }
}

// ─── Pending suggestions store ───────────────────────────────────────────────

/**
 * Returns { [workspaceName]: [{ name, path, icon }] }
 */
export function getPendingSuggestions() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_SUGGESTIONS);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function storePendingSuggestions(suggestionsMap) {
    try {
        localStorage.setItem(STORAGE_KEY_SUGGESTIONS, JSON.stringify(suggestionsMap));
    } catch (e) {
        console.debug('[AppCategorization] storePendingSuggestions error:', e);
    }
}

export function clearWorkspaceSuggestions(workspaceName) {
    const current = getPendingSuggestions();
    delete current[workspaceName];
    storePendingSuggestions(current);
}

export function clearAllSuggestions() {
    try {
        localStorage.removeItem(STORAGE_KEY_SUGGESTIONS);
    } catch (e) {
        console.debug('[AppCategorization] clearAllSuggestions error:', e);
    }
}

// ─── AI Classification ───────────────────────────────────────────────────────

/**
 * Classify installed apps into workspaces using local AI.
 *
 * @param {Array<{name: string, path: string, icon: string|null}>} installedApps
 * @param {Array<{name: string}>} workspaces
 * @param {Function} aiChatFn  - LocalAIService.simpleChat
 * @returns {Promise<{[workspaceName]: Array<{name, path, icon}>}>}
 */
export async function classifyAppsToWorkspaces(installedApps, workspaces, aiChatFn) {
    if (!installedApps?.length || !workspaces?.length) return {};

    const workspaceNames = workspaces.map(w => w.name);
    const result = {};

    // Process in batches of 25 to stay within token budget
    const BATCH_SIZE = 25;

    for (let i = 0; i < installedApps.length; i += BATCH_SIZE) {
        const batch = installedApps.slice(i, i + BATCH_SIZE);

        const appList = batch.map((a, idx) => `${idx + 1}. ${a.name}`).join('\n');

        const prompt = `Categorize these desktop apps into one of the given workspaces.

Workspaces: ${workspaceNames.join(', ')}

Apps:
${appList}

Rules:
- Only classify apps with confidence >= 0.7
- Skip utilities, system apps, and apps that don't clearly fit a workspace (e.g. Notepad, Calculator, Windows Settings)
- Code editors, IDEs, terminals, git tools → development/code workspaces
- Spotify, VLC, Steam, games → entertainment workspaces
- Slack, Teams, Zoom, email clients → work/productivity workspaces
- Figma, Photoshop, design tools → design/creative workspaces

Return JSON only, no explanation:
{"classifications": [{"index": 1, "workspace": "WorkspaceName", "confidence": 0.9}]}`;

        try {
            const aiResult = await aiChatFn(prompt);
            if (!aiResult?.ok) continue;

            const jsonMatch = aiResult.response?.match(/\{[\s\S]*\}/);
            if (!jsonMatch) continue;

            const parsed = JSON.parse(jsonMatch[0]);
            (parsed.classifications || []).forEach(c => {
                if (c.confidence >= 0.7 && workspaceNames.includes(c.workspace)) {
                    const app = batch[c.index - 1];
                    if (!app) return;
                    if (!result[c.workspace]) result[c.workspace] = [];
                    // Deduplicate by path
                    const alreadyAdded = result[c.workspace].some(a => a.path === app.path);
                    if (!alreadyAdded) {
                        result[c.workspace].push({
                            name: app.name,
                            path: app.path,
                            icon: app.icon || null
                        });
                    }
                }
            });
        } catch (e) {
            console.warn('[AppCategorization] Batch classification failed:', e);
        }
    }

    return result;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Run seeding if the (apps × workspaces) hash has changed since last run.
 * Stores results in localStorage and returns the suggestions map.
 * Returns null if seeding was already done for this hash.
 *
 * @param {Array} installedApps
 * @param {Array} workspaces
 * @param {Function} aiChatFn  - LocalAIService.simpleChat
 * @returns {Promise<{[workspaceName]: Array}|null>}
 */
export async function runSeedingIfNeeded(installedApps, workspaces, aiChatFn) {
    if (!installedApps?.length || !workspaces?.length) return null;

    const hash = computeHash(installedApps, workspaces);
    if (hasBeenSeeded(hash)) return null;

    console.log('[AppCategorization] Starting first-run app classification for', installedApps.length, 'apps across', workspaces.length, 'workspaces');

    try {
        const suggestions = await classifyAppsToWorkspaces(installedApps, workspaces, aiChatFn);

        // Filter out workspaces that already contain all suggested apps
        // (workspace.apps is checked by the caller — here we just store raw results)
        const hasSuggestions = Object.keys(suggestions).some(k => suggestions[k].length > 0);

        if (hasSuggestions) {
            // Merge with any existing suggestions (don't overwrite dismissed ones)
            const existing = getPendingSuggestions();
            const merged = { ...existing };
            Object.entries(suggestions).forEach(([wsName, apps]) => {
                if (!merged[wsName]) {
                    merged[wsName] = apps;
                } else {
                    // Append apps not already in the list
                    const existingPaths = new Set(merged[wsName].map(a => a.path));
                    apps.forEach(app => {
                        if (!existingPaths.has(app.path)) {
                            merged[wsName].push(app);
                        }
                    });
                }
            });
            storePendingSuggestions(merged);
            console.log('[AppCategorization] Stored suggestions for workspaces:', Object.keys(suggestions).join(', '));
        }

        markSeeded(hash);
        return hasSuggestions ? suggestions : null;
    } catch (e) {
        console.error('[AppCategorization] Seeding failed:', e);
        markSeeded(hash); // Mark as done even on failure to avoid hammering AI
        return null;
    }
}
