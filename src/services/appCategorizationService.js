/**
 * App Categorization Service
 *
 * Uses local AI to classify installed apps into existing workspaces on first run.
 * Results are stored in localStorage and shown as dismissible banners in WorkspaceList.
 */

const STORAGE_KEY_SUGGESTIONS = 'cooldesk_app_suggestions';
const STORAGE_KEY_SEEDED_HASH = 'cooldesk_app_seeded_hash';

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
    } catch {
        return false;
    }
}

export function markSeeded(hash) {
    try {
        localStorage.setItem(STORAGE_KEY_SEEDED_HASH, hash);
    } catch { }
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
    } catch { }
}

export function clearWorkspaceSuggestions(workspaceName) {
    const current = getPendingSuggestions();
    delete current[workspaceName];
    storePendingSuggestions(current);
}

export function clearAllSuggestions() {
    try {
        localStorage.removeItem(STORAGE_KEY_SUGGESTIONS);
    } catch { }
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
