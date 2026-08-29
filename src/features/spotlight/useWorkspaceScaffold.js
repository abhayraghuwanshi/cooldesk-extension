import { useCallback, useState } from 'react';
import { announceCooldesk, fetchCooldesk, linkCooldeskProject } from '../../services/cooldeskService';

/**
 * Scaffolding (and, for a multi-folder workspace, linking) `.cooldesk/`
 * projects — the logic behind the /agent panel's "Create workspace" button
 * and /new-workspace's confirm step. Pulled out of GlobalSpotlight.jsx so
 * that already-large file doesn't also have to hold this: both callers just
 * need `buildScaffoldPlan`/`runCreateWorkspace`, not how they work.
 *
 * @param {object} deps
 * @param {string|null} deps.expandedWorkspaceId currently selected workspace, for resolveWorkspaceProjects
 * @param {ReturnType<typeof import('./useAiCli').useAiCli>} deps.aiCli
 * @param {(message: string, type?: string) => void} deps.showFeedback
 */
export function useWorkspaceScaffold({ expandedWorkspaceId, aiCli, showFeedback }) {
    // Which project (app workspace + on-disk folder(s)) a scaffold run
    // targets: { workspace?, hub, members, plain } once resolved, null when
    // resolved with nothing found, undefined before the first resolve.
    const [wsScaffoldPlan, setWsScaffoldPlan] = useState(undefined);

    // Classify a raw folder list into a scaffold plan: hub (whichever already
    // owns a .cooldesk/, else the first), sibling project folders to link to
    // it as a group, and plain (non-project) folders that just become
    // resource entries. Shared by resolveWorkspaceProjects below (an existing
    // workspace's folder apps) and /new-workspace's confirm step (freshly
    // picked folders, no workspace saved yet) — this mirrors what the old
    // cooldesk-plugin split across two commands (`/cd-init` per project,
    // `/cd-link` to join several into a star-topology group) as one plan.
    const buildScaffoldPlan = useCallback(async (folders) => {
        if (!folders || folders.length === 0) return { hub: null, members: [], plain: [] };
        if (folders.length === 1) return { hub: folders[0], members: [], plain: [] };

        const { invoke } = await import('@tauri-apps/api/core');
        const isProject = await invoke('classify_project_folders', { paths: folders.map(f => f.path) });
        const projectFolders = folders.filter((_, i) => isProject[i]);
        const plain = folders.filter((_, i) => !isProject[i]);

        // Nothing looked like code — fall back to the single-folder case,
        // the rest just ride along as plain resources on that one.
        if (projectFolders.length === 0) {
            return { hub: folders[0], members: [], plain: folders.slice(1) };
        }

        // Prefer whichever project folder already owns a .cooldesk/ — don't
        // orphan an existing group by picking a different hub on a later run.
        let hub = null;
        for (const f of projectFolders) {
            const cd = await fetchCooldesk(f.path);
            if (cd?.exists) { hub = f; break; }
        }
        hub = hub || projectFolders[0];
        const members = projectFolders.filter(f => f.path !== hub.path);
        return { hub, members, plain };
    }, []);

    // Which of the selected workspace's folder apps to scaffold, and how.
    // Reloads workspaces itself rather than trusting a `workspaces` list state
    // passed in — that state (in GlobalSpotlight) is only populated when the
    // workspaces *section* is enabled on a given surface, and this needs the
    // real list regardless.
    const resolveWorkspaceProjects = useCallback(async () => {
        try {
            const { listWorkspaces } = await import('../../db/index.js');
            const res = await listWorkspaces();
            const list = res?.success ? res.data : (Array.isArray(res) ? res : []);
            const ws = list.find(w => w.id === expandedWorkspaceId) || list[0] || null;
            if (!ws) return null;

            const folders = (ws.apps || [])
                .filter(a => a.appType === 'folder' && a.path)
                .map(a => ({ name: a.name || a.path, path: a.path }));
            if (folders.length === 0) return null;

            const plan = await buildScaffoldPlan(folders);
            return { workspace: ws, ...plan };
        } catch (e) {
            console.warn('[Spotlight] create-workspace: failed to resolve project folders', e);
            return null;
        }
    }, [expandedWorkspaceId, buildScaffoldPlan]);

    // Scaffold (and, when a plan holds several project folders, link)
    // .cooldesk/ workspaces. Sequential by design: a member's link depends on
    // the hub already existing on disk (see `link_project` in the sidecar,
    // which refuses an unscaffolded hub), and each folder is its own
    // Write-enabled Claude Code process regardless (see workspaceScaffold.js).
    //
    // `planOverride` lets a caller pass a plan that hasn't made it into
    // `wsScaffoldPlan` state yet (state updates aren't visible to this same
    // callback invocation) — /new-workspace's confirm step needs this, since
    // it computes a plan and wants to run it in the same action.
    const runCreateWorkspace = useCallback(async (focusHint, planOverride) => {
        const plan = planOverride || wsScaffoldPlan;
        if (!plan?.hub || aiCli.running) return;
        const focus = (focusHint || '').trim();

        const scaffoldOne = async (folder, scaffoldContext) => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('trust_project_dir', { path: folder.path });
            } catch (e) {
                console.warn('[Spotlight] create-workspace: failed to pre-trust', folder.path, e);
            }
            return aiCli.run(
                focus || `Set up ${folder.name} as a CoolDesk workspace.`,
                [],
                folder.path,
                { mode: 'scaffold', scaffoldContext }
            );
        };

        const hubResult = await scaffoldOne(plan.hub, { plainFolders: plan.plain, linkedProjects: plan.members });
        if (hubResult.error) {
            showFeedback(`Couldn't scaffold "${plan.hub.name}": ${hubResult.error}`, 'error');
            return;
        }

        for (const member of plan.members) {
            const siblings = [plan.hub, ...plan.members.filter(m => m.path !== member.path)];
            const result = await scaffoldOne(member, { linkedProjects: siblings });
            if (result.error) {
                showFeedback(`Couldn't scaffold "${member.name}": ${result.error}`, 'error');
                continue; // still link + announce whatever did succeed
            }
            const linkResult = await linkCooldeskProject(plan.hub.path, member.path);
            if (!linkResult.ok) {
                console.warn('[Spotlight] create-workspace: link failed', member.path, linkResult.error);
            }
        }

        // Same sidecar call the cooldesk-plugin's hooks used to make after
        // every write — this is what lets CooldeskSection / WorkspaceContextPanel /
        // useCooldeskAutoWorkspace pick everything up live, with no other UI
        // wiring needed.
        await announceCooldesk(plan.hub.path);
        for (const member of plan.members) await announceCooldesk(member.path);

        showFeedback(
            plan.members.length
                ? `Linked ${plan.members.length + 1} projects into "${plan.hub.name}"`
                : `Created .cooldesk workspace for "${plan.hub.name}"`,
            'success'
        );
    }, [wsScaffoldPlan, aiCli, showFeedback]);

    return { wsScaffoldPlan, setWsScaffoldPlan, buildScaffoldPlan, resolveWorkspaceProjects, runCreateWorkspace };
}
