import { useCallback, useState } from 'react';

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
 */
export function useNewWorkspaceMode({
    aiCli, showFeedback, buildScaffoldPlan, setWsScaffoldPlan, runCreateWorkspace,
    setCommandMode, setQuery, setExpandedWorkspaceId, setWorkspaces,
}) {
    const [step, setStep] = useState('name'); // 'name' | 'folders' | 'confirm'
    const [name, setName] = useState('');
    const [folders, setFolders] = useState([]); // [{name, path, appType, icon}]
    const [urls, setUrls] = useState([]); // [{kind:'url', url, title, favicon}] — tabs/history/bookmarks picked the same way
    const [scaffoldChecked, setScaffoldChecked] = useState(true);
    const [plan, setPlan] = useState(null); // {hub, members, plain}, computed at the confirm step
    const [creating, setCreating] = useState(false);

    const reset = useCallback(() => {
        setStep('name');
        setName('');
        setFolders([]);
        setUrls([]);
        setScaffoldChecked(true);
        setPlan(null);
        setCreating(false);
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
                runCreateWorkspace(undefined, fullPlan);
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
    ]);

    return {
        step, name, folders, urls, scaffoldChecked, setScaffoldChecked, plan, creating,
        enter, exit, confirmName, addFolder, removeFolder, addUrl, removeUrl, addItem,
        goToConfirm, backToFolders, backToName, confirmCreate,
    };
}
