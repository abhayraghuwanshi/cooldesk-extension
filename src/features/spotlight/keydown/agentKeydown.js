// Keyboard grammar for /agent. Enter is heavily overloaded: confirm a
// pending proposal, attach a highlighted result as context, run "/name", or
// send the request to the CLI — in that priority order.
export function handleAgentKeydown(e, {
    aiCli, applyProposal, selectedIndex, setSelectedIndex, flatRows,
    attachToAgentContext, query, runRenameWorkspace, setQuery, runAgent,
    exitAgentMode, expandPath, collapsePath,
}) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const pending = aiCli.turns.find(t => t.proposal?.valid.length);
        // With a proposal on screen Enter is the confirm — the run is
        // over and the only thing left to do is accept it.
        if (pending) { applyProposal(pending); return; }
        // A highlighted result attaches as context instead of opening
        // — same idea as normal search's Enter, just repurposed:
        // composing a request isn't the moment to launch something.
        if (selectedIndex >= 0 && flatRows[selectedIndex]) {
            attachToAgentContext(flatRows[selectedIndex].item);
            return;
        }
        const trimmed = query.trim();
        // "/name <title>" is a local shortcut, not a request for the
        // CLI — renames instantly and never touches aiCli.run.
        const nameMatch = /^\/name\s+(.+)$/i.exec(trimmed);
        if (nameMatch) {
            runRenameWorkspace(nameMatch[1]);
            setQuery('');
            return;
        }
        if (trimmed && !aiCli.running) {
            runAgent(trimmed);
            setQuery('');
        }
        return;
    }
    // Backspace on an empty box removes the chip, the way a tag input
    // works — otherwise the only way out is Esc, which also closes.
    if (e.key === 'Backspace' && !query) {
        e.preventDefault();
        exitAgentMode();
        return;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        if (aiCli.running) { aiCli.cancel(); return; }  // stop the agent before closing
        exitAgentMode();
        return;
    }
    // Agent mode still renders the ordinary results list below the
    // transcript (see the flatRows block further down — it's the one
    // mode that keeps searching while a request is open), so ↑/↓
    // needs to move the highlight through it same as hovering does
    // (ResultItem's onHover already wires to setSelectedIndex).
    // Deliberately local to flatRows rather than the shared
    // selectVisualIndex/currentIndex machinery below: that machinery
    // also drives the context/pins/workspace sections, none of which
    // render in this mode.
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
    // →/← mirrors the normal search's folder-tree expand/collapse
    // (same tree used below the transcript) — same selectedIndex
    // indexing as ↑/↓ above.
    {
        const treeRow = selectedIndex >= 0 ? flatRows[selectedIndex] : null;
        if (e.key === 'ArrowRight' && treeRow?.isFolder) {
            e.preventDefault();
            if (!treeRow.isExpanded) {
                expandPath(treeRow.item); // collapsed → expand
            } else if (flatRows[selectedIndex + 1]?.depth === treeRow.depth + 1) {
                setSelectedIndex(selectedIndex + 1); // expanded → step into first child
            }
            return;
        }
        if (e.key === 'ArrowLeft' && treeRow) {
            e.preventDefault();
            if (treeRow.isFolder && treeRow.isExpanded) {
                collapsePath(treeRow.item.path); // expanded → collapse
            } else if (treeRow.depth > 0) {
                // step out to the parent row (nearest previous row at depth-1)
                for (let i = selectedIndex - 1; i >= 0; i--) {
                    if (flatRows[i].depth === treeRow.depth - 1) { setSelectedIndex(i); break; }
                }
            }
            return;
        }
    }
    // no other result navigation in agent mode
}
