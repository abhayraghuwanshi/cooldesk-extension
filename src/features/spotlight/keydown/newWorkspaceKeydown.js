import { resultToWorkspaceItem } from '../resultToWorkspaceItem';

// Keyboard grammar for /new-workspace's three steps (name → folders →
// confirm). Each step's Backspace-on-empty steps back, matching /agent's
// own "Backspace on an empty box leaves the mode" grammar.
export function handleNewWorkspaceKeydown(e, {
    query, selectedIndex, setSelectedIndex, flatRows, newWorkspace, showFeedback,
}) {
    if (e.key === 'Escape') {
        e.preventDefault();
        newWorkspace.exit();
        return;
    }
    if (newWorkspace.step === 'name') {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            newWorkspace.confirmName(query);
            return;
        }
        // Nothing to step back to before the first step — Backspace
        // on an empty box leaves the wizard, same grammar as /agent.
        if (e.key === 'Backspace' && !query) {
            e.preventDefault();
            newWorkspace.exit();
            return;
        }
        return; // no result navigation while typing a name
    }
    if (newWorkspace.step === 'folders') {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // A highlighted result attaches — same interaction as
            // /agent's context chips (see attachToAgentContext).
            if (selectedIndex >= 0 && flatRows[selectedIndex]) {
                const mapped = resultToWorkspaceItem(flatRows[selectedIndex].item);
                if (mapped?.kind === 'app') {
                    newWorkspace.addFolder(mapped);
                } else {
                    showFeedback('Pick a folder, file, or app', 'error');
                }
                return;
            }
            // Nothing highlighted — folders are optional, move on.
            newWorkspace.goToConfirm();
            return;
        }
        if (e.key === 'Backspace' && !query) {
            e.preventDefault();
            newWorkspace.backToName();
            return;
        }
        if (e.key === 'ArrowDown' && flatRows.length > 0) {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % flatRows.length);
            return;
        }
        if (e.key === 'ArrowUp' && flatRows.length > 0) {
            e.preventDefault();
            setSelectedIndex(prev => (prev <= 0 ? flatRows.length - 1 : prev - 1));
            return;
        }
        return;
    }
    // step === 'confirm'
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!newWorkspace.creating) newWorkspace.confirmCreate();
        return;
    }
    if (e.key === 'Backspace' && !query) {
        e.preventDefault();
        newWorkspace.backToFolders();
    }
}
