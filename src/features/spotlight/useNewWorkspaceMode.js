import { useCallback, useEffect, useRef, useState } from 'react';
import { browseUrls } from '../../services/searchService';
import { suggestLinks } from './suggestLinks';

// The user's own tabs/history/bookmarks that share a word with the request,
// handed to the AI as candidates — the exact query already matched nothing
// in search, but "react docs" for a workspace named "Frontend" can still hit
// individual words. Unrelated recent urls are left out: they only mislead.
function relatedUserUrls(name, topic, limit = 25) {
    const words = `${name} ${topic}`.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
    if (words.length === 0) return [];
    let pool = [];
    try { pool = browseUrls(400) || []; } catch { return []; }
    const out = [];
    for (const item of pool) {
        if (!item?.url || !/^https?:/i.test(item.url)) continue;
        const hay = `${item.title || ''} ${item.url}`.toLowerCase();
        if (words.some(w => hay.includes(w))) out.push({ title: item.title || '', url: item.url });
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * State machine behind `/new-workspace` — a guided, Raycast-style form
 * instead of a bang command with positional/keyword syntax to remember:
 * name → (optional) folders/files/apps AND urls (tabs/history/bookmarks),
 * picked the same click-to-attach way /agent's context chips already work →
 * confirm, which creates the workspace and, when a picked folder looks like
 * a real project, hands off straight into the existing /agent scaffold flow
 * (`runCreateWorkspace`) so progress shows in the same transcript panel.
 *
 * GlobalSpotlight.jsx owns `commandMode`/`query`/`expandedWorkspaceId` (the
 * setters are passed in here); this hook only owns the wizard's own step
 * state, so there's exactly one source of truth for each.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('./useAiCli').useAiCli>} deps.aiCli
 * @param {(message: string, type?: string) => void} deps.showFeedback
 * @param {(folders: Array<{name:string,path:string}>) => Promise<{hub, members, plain}>} deps.buildScaffoldPlan
 * @param {(plan: object) => void} deps.setWsScaffoldPlan
 * @param {(focusHint?: string, planOverride?: object) => Promise<void>} deps.runCreateWorkspace
 * @param {(mode: string|null) => void} deps.setCommandMode
 * @param {(q: string) => void} deps.setQuery
 * @param {(id: string) => void} deps.setExpandedWorkspaceId
 * @param {(list: Array) => void} [deps.setWorkspaces] keeps the spotlight's
 *   own workspace list in sync so "type an existing workspace's name" (see
 *   useEditWorkspaceMode.js) sees this one immediately, not after a reload.
 * @param {(workspace: object, opts: {afterScaffold: boolean}) => void} [deps.openCreatedWorkspace]
 *   lands the user inside the new workspace (/edit-workspace) once it exists,
 *   where search + the "Ask the agent" row keep working for adding more.
 */
export function useNewWorkspaceMode({
    aiCli, showFeedback, buildScaffoldPlan, setWsScaffoldPlan, runCreateWorkspace,
    setCommandMode, setQuery, setExpandedWorkspaceId, setWorkspaces, openCreatedWorkspace,
}) {
    const [step, setStep] = useState('name'); // 'name' | 'folders' | 'confirm'
    const [name, setName] = useState('');
    const [folders, setFolders] = useState([]); // [{name, path, appType, icon}]
    const [urls, setUrls] = useState([]); // [{kind:'url', url, title, favicon}] — tabs/history/bookmarks picked the same way
    const [scaffoldChecked, setScaffoldChecked] = useState(true);
    const [plan, setPlan] = useState(null); // {hub, members, plain}, computed at the confirm step
    const [creating, setCreating] = useState(false);
    // Step 2's "Ask AI" — only offered when the typed text matches nothing.
    // Suggestions are shown, never auto-attached: each one needs its own click.
    const [aiSuggestions, setAiSuggestions] = useState([]); // [{title, url}]
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState(null);
    const aiRunRef = useRef(null); // { cancel } of the in-flight suggestion run
    // Closing the spotlight mid-run must not leave the CLI process running.
    useEffect(() => () => aiRunRef.current?.cancel(), []);

    const reset = useCallback(() => {
        setStep('name');
        setName('');
        setFolders([]);
        setUrls([]);
        setScaffoldChecked(true);
        setPlan(null);
        setCreating(false);
        aiRunRef.current?.cancel();
        aiRunRef.current = null;
        setAiSuggestions([]);
        setAiLoading(false);
        setAiError(null);
    }, []);

    /** Enter the mode fresh — called from the /new-workspace detection block. */
    const enter = useCallback(() => {
        reset();
        setCommandMode('new-workspace');
    }, [reset, setCommandMode]);

    /** Esc/Backspace-to-empty leaves the wizard entirely, same grammar as /agent. */
    const exit = useCallback(() => {
        reset();
        setCommandMode(null);
        setQuery('');
    }, [reset, setCommandMode, setQuery]);

    /** Step 1 → 2. Returns false (no-op) if the name is empty. */
    const confirmName = useCallback((typed) => {
        const trimmed = (typed || '').trim();
        if (!trimmed) return false;
        setName(trimmed);
        setStep('folders');
        setQuery('');
        return true;
    }, [setQuery]);

    /** A folder/file/app result picked in step 2 — attach, don't open. */
    const addFolder = useCallback((mapped) => {
        if (!mapped?.path) return;
        setFolders(prev => (prev.some(f => f.path === mapped.path) ? prev : [...prev, mapped]));
        setQuery('');
    }, [setQuery]);

    const removeFolder = useCallback((path) => {
        setFolders(prev => prev.filter(f => f.path !== path));
    }, []);

    /** A tab/history/bookmark result picked in step 2 — same attach interaction as addFolder. */
    const addUrl = useCallback((mapped) => {
        if (!mapped?.url) return;
        setUrls(prev => (prev.some(u => u.url === mapped.url) ? prev : [...prev, mapped]));
        setQuery('');
    }, [setQuery]);

    const removeUrl = useCallback((url) => {
        setUrls(prev => prev.filter(u => u.url !== url));
    }, []);

    /**
     * Ask the user's AI CLI (the /agent adapter) for links relevant to the
     * typed text + workspace name. Results are only *shown* — each one still
     * needs its own pick to attach (they render as result rows — see
     * aiLinkRows in GlobalSpotlight.jsx).
     */
    const askAiForLinks = useCallback(async (typed) => {
        const topic = (typed || '').trim();
        if (!topic) return;
        aiRunRef.current?.cancel(); // re-asking supersedes the previous run

        const adapter = aiCli?.adapter;
        if (adapter && aiCli?.available && aiCli.available[adapter.bin] === false) {
            setAiSuggestions([]);
            setAiError(`${adapter.label} isn't installed — pick another AI in /agent.`);
            return;
        }

        setAiLoading(true);
        setAiError(null);
        setAiSuggestions([]);
        const run = suggestLinks({
            adapter,
            workspaceName: name,
            topic,
            candidates: relatedUserUrls(name, topic),
        });
        aiRunRef.current = run;
        try {
            const links = await run.promise;
            if (aiRunRef.current !== run) return;
            setAiSuggestions(links);
        } catch (e) {
            if (e?.cancelled || aiRunRef.current !== run) return;
            console.warn('[Spotlight] new-workspace: AI link suggestions failed', e);
            setAiError(e?.message || 'AI request failed');
        } finally {
            if (aiRunRef.current === run) {
                aiRunRef.current = null;
                setAiLoading(false);
            }
        }
    }, [name, aiCli]);

    /** Stop an in-flight suggestion run without leaving the wizard. */
    const cancelAi = useCallback(() => {
        aiRunRef.current?.cancel();
        aiRunRef.current = null;
        setAiLoading(false);
    }, []);

    /** Step 2's picker dispatches here regardless of what kind of result it is. */
    const addItem = useCallback((mapped) => {
        if (mapped?.kind === 'url') addUrl(mapped);
        else if (mapped?.kind === 'app') addFolder(mapped);
    }, [addUrl, addFolder]);

    /** Step 2 → 3. Classifies the picked folders and defaults the checkbox. */
    const goToConfirm = useCallback(async () => {
        setQuery('');
        setStep('confirm');
        const folderApps = folders
            .filter(f => f.appType === 'folder')
            .map(f => ({ name: f.name, path: f.path }));
        const p = await buildScaffoldPlan(folderApps);
        setPlan(p);
        setScaffoldChecked(!!p.hub);
    }, [folders, buildScaffoldPlan, setQuery]);

    const backToFolders = useCallback(() => setStep('folders'), []);
    const backToName = useCallback(() => { setStep('name'); setQuery(name); }, [name, setQuery]);

    /** Step 3's Create button: save the workspace, then optionally scaffold. */
    const confirmCreate = useCallback(async () => {
        if (!name.trim() || creating) return;
        setCreating(true);
        try {
            const { saveWorkspace } = await import('../../db/index.js');
            const workspace = {
                id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: name.trim(),
                description: '',
                createdAt: Date.now(),
                gridType: 'ItemGrid',
                status: 'active',
                urls: urls.map(u => ({ url: u.url, title: u.title, addedAt: Date.now() })),
                apps: folders.map(f => ({ name: f.name, path: f.path, appType: f.appType, icon: f.icon || null })),
            };
            await saveWorkspace(workspace);
            showFeedback(`Created workspace "${workspace.name}"`, 'success');
            try {
                const { listWorkspaces } = await import('../../db/index.js');
                const res = await listWorkspaces();
                setWorkspaces?.(res?.success ? res.data : (Array.isArray(res) ? res : []));
            } catch { /* the new workspace still saved — a stale list here is cosmetic */ }

            if (scaffoldChecked && plan?.hub) {
                // Hand off to the exact same panel /agent's button already
                // uses — the transcript it renders is what shows progress
                // here. `planOverride` sidesteps setWsScaffoldPlan's state
                // update not being visible to this same callback invocation.
                const fullPlan = { workspace, hub: plan.hub, members: plan.members, plain: plan.plain };
                setExpandedWorkspaceId(workspace.id);
                setWsScaffoldPlan(fullPlan);
                aiCli.reset();
                setQuery('');
                setCommandMode('agent');
                reset();
                // Once the scaffold succeeds, leave /agent's transcript for the
                // workspace itself — staying in a bare /agent chat afterwards
                // is what made follow-ups like "search for links" go to an
                // agent with no browsing data. On failure, stay put so the
                // transcript's error is readable.
                Promise.resolve(runCreateWorkspace(undefined, fullPlan)).then((res) => {
                    if (res?.ok) openCreatedWorkspace?.(workspace, { afterScaffold: true });
                });
            } else if (openCreatedWorkspace) {
                reset();
                openCreatedWorkspace(workspace, { afterScaffold: false });
            } else {
                exit();
            }
        } catch (e) {
            console.error('[Spotlight] new-workspace: create failed', e);
            showFeedback('Could not create workspace — see console', 'error');
        } finally {
            setCreating(false);
        }
    }, [
        name, folders, urls, scaffoldChecked, plan, aiCli, runCreateWorkspace, showFeedback,
        setCommandMode, setExpandedWorkspaceId, setQuery, setWsScaffoldPlan, setWorkspaces, reset, exit,
        openCreatedWorkspace,
    ]);

    return {
        step, name, folders, urls, scaffoldChecked, setScaffoldChecked, plan, creating,
        aiSuggestions, aiLoading, aiError, askAiForLinks, cancelAi,
        enter, exit, confirmName, addFolder, removeFolder, addUrl, removeUrl, addItem,
        goToConfirm, backToFolders, backToName, confirmCreate,
    };
}
