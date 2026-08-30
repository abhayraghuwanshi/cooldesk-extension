import { faFileLines, faFolder, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// /new-workspace — a guided form (name → folders → confirm) instead of a bang
// command with syntax to remember. Folder picking reuses the exact click/
// Enter-to-attach interaction /agent's context chips use (see the flatRows
// block in GlobalSpotlight.jsx, shared with every other mode).
export function NewWorkspacePanel({ newWorkspace }) {
    return (
        <div className="spotlight-ai-mode spotlight-agent-mode">
            <div className="spotlight-ai-header">
                <FontAwesomeIcon icon={faFolder} style={{ color: '#4ADE80' }} />
                <span>
                    {newWorkspace.step === 'name' && 'Step 1 of 3 — Name'}
                    {newWorkspace.step === 'folders' && `Step 2 of 3 — Folders for "${newWorkspace.name}"`}
                    {newWorkspace.step === 'confirm' && `Step 3 of 3 — Confirm "${newWorkspace.name}"`}
                </span>
            </div>

            {(newWorkspace.step === 'folders' || newWorkspace.step === 'confirm') && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 4px 8px' }}>
                    {newWorkspace.folders.length === 0 && (
                        <span className="spotlight-ai-hint" style={{ padding: 0 }}>No folders yet — optional.</span>
                    )}
                    {newWorkspace.folders.map(f => (
                        <span key={f.path} className="spotlight-agent-chip" title={f.path}>
                            <FontAwesomeIcon icon={f.appType === 'folder' ? faFolder : faFileLines} />
                            {f.name}
                            {newWorkspace.step === 'folders' && (
                                <button
                                    type="button"
                                    className="spotlight-add-badge-exit"
                                    onMouseDown={(e) => { e.preventDefault(); newWorkspace.removeFolder(f.path); }}
                                    title="Remove"
                                    aria-label={`Remove ${f.name}`}
                                >
                                    <FontAwesomeIcon icon={faTimes} />
                                </button>
                            )}
                        </span>
                    ))}
                </div>
            )}

            <div className="spotlight-ai-messages">
                {newWorkspace.step === 'name' && (
                    <div className="spotlight-ai-hint">
                        Type a name for the workspace, then press Enter.
                    </div>
                )}

                {newWorkspace.step === 'folders' && (
                    <div className="spotlight-ai-hint">
                        Search below and click (or arrow to it and press Enter) to add a folder.
                        Press Enter on an empty box when you're done — folders are optional.
                    </div>
                )}

                {newWorkspace.step === 'confirm' && (
                    <div className="spotlight-agent-proposal">
                        <div className="spotlight-agent-proposal-head">
                            {newWorkspace.folders.length === 0
                                ? 'A bare workspace, no linked folder.'
                                : `${newWorkspace.folders.length} folder${newWorkspace.folders.length === 1 ? '' : 's'} attached.`}
                        </div>
                        {newWorkspace.plan?.hub && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={newWorkspace.scaffoldChecked}
                                    onChange={(e) => newWorkspace.setScaffoldChecked(e.target.checked)}
                                />
                                Also set up <code>.cooldesk/</code>
                                {newWorkspace.plan.members.length > 0 && ` and link ${newWorkspace.plan.members.length + 1} projects together`}
                            </label>
                        )}
                        <div className="spotlight-agent-confirm">
                            <button
                                type="button"
                                className="spotlight-agent-apply"
                                disabled={newWorkspace.creating}
                                onMouseDown={(e) => { e.preventDefault(); newWorkspace.confirmCreate(); }}
                            >
                                {newWorkspace.creating ? 'Creating…' : 'Create'}
                            </button>
                            <button
                                type="button"
                                className="spotlight-agent-discard"
                                onMouseDown={(e) => { e.preventDefault(); newWorkspace.backToFolders(); }}
                            >
                                ← Back
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
