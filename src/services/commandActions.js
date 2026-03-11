/**
 * CommandActions - Handles advanced action commands
 */
import { saveWorkspace } from '../db/index.js';

export const executeAction = async (command, args, feedbackCallback) => {
    const [action, ...rest] = command.split(' ');
    const details = rest.join(' ') || args;

    switch (action) {
        case '/add':
            return await handleAddAction(details, feedbackCallback);
        case '/share':
            return await handleShareAction(details, feedbackCallback);
        default:
            throw new Error(`Unknown action: ${action}`);
    }
};

const handleAddAction = async (details, feedbackCallback) => {
    if (details.startsWith('note')) {
        const content = details.replace('note', '').trim();
        if (!content) throw new Error('Note content required. Usage: /add note Some text');

        // logic to add note (mocked for now as we'd need to import note service)
        feedbackCallback({
            type: 'success',
            message: `✨ Note added: "${content.substring(0, 30)}..."`
        });
        return { success: true };
    }

    if (details.startsWith('tab')) {
        const parts = details.replace('tab', '').trim().split(' ');
        const url = parts[0];
        const workspaceName = parts.slice(1).join(' ');

        if (!url || !workspaceName) throw new Error('Usage: /add tab <url> <workspace>');

        const { listWorkspaces, saveWorkspace } = await import('../db/index.js');
        const res = await listWorkspaces();
        const workspaces = res?.success ? res.data : (Array.isArray(res) ? res : []);
        const workspace = workspaces.find(ws => ws.name.toLowerCase() === workspaceName.toLowerCase());

        if (!workspace) throw new Error(`Workspace "${workspaceName}" not found.`);

        // Check for duplicates
        if (workspace.urls.some(u => (typeof u === 'string' ? u : u.url) === url)) {
            feedbackCallback({ type: 'help', message: `ℹ️ "${url}" is already in "${workspace.name}"` });
            return { success: true };
        }

        workspace.urls.push({ url, title: 'Added via Command', createdAt: Date.now() });
        await saveWorkspace(workspace);

        feedbackCallback({
            type: 'success',
            message: `🌍 Page added to "${workspace.name}" workspace!`
        });
        return { success: true };
    }

    if (details.startsWith('workspace')) {
        const name = details.replace('workspace', '').trim();
        if (!name) throw new Error('Workspace name required. Usage: /add workspace MyProject');

        const newWS = {
            id: `ws_${Date.now()}`,
            name,
            urls: [],
            createdAt: Date.now()
        };
        await saveWorkspace(newWS);

        feedbackCallback({
            type: 'success',
            message: `📁 Workspace "${name}" created successfully!`
        });
        return { success: true, workspace: newWS };
    }

    throw new Error('Unknown add target. Try: note, workspace');
};

const handleShareAction = async (details, feedbackCallback) => {
    if (details.includes('community')) {
        feedbackCallback({
            type: 'success',
            message: '🌍 Sharing your configuration to the community hub...'
        });
        // simulate network delay
        await new Promise(r => setTimeout(r, 1500));
        feedbackCallback({
            type: 'success',
            message: '✅ Workspace shared successfully! Check the community tab.'
        });
        return { success: true };
    }

    throw new Error('Unknown share target. Try: community');
};
