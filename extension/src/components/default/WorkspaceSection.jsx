import { useEffect, useState } from 'react';
import { WorkspaceFilters } from '../WorkspaceFilters';

export function WorkspaceSection({
    displaySettings = {},
    workspace,
    setWorkspace,
    filterItems,
    createWorkspace,
    togglePinWorkspace,
    handleOpenAddLinkModal,
    pinnedWorkspaces,
    handleShareWorkspaceUrl,
    savedWorkspaces,
    mergedWorkspaceItems,
    renderWorkspaceGrid
}) {
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try {
            const saved = localStorage.getItem('workspaceSection_collapsed');
            return saved === 'true';
        } catch {
            return false;
        }
    });

    // Persist collapsed state to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('workspaceSection_collapsed', String(isCollapsed));
        } catch (e) {
            console.warn('[WorkspaceSection] Failed to save collapsed state', e);
        }
    }, [isCollapsed]);

    // If display settings hide workspace filters, return null
    if (displaySettings.workspaceFilters === false) {
        return null;
    }

    // If collapsed, show only title
    if (isCollapsed) {
        return (
            <div
                onClick={() => setIsCollapsed(false)}
                style={{
                    marginBottom: 'var(--section-spacing)',
                    padding: '12px 20px',
                    border: '1px solid rgba(70, 70, 75, 0.7)',
                    borderRadius: '16px',
                    background: 'rgba(28, 28, 33, 0.45)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(28, 28, 33, 0.65)';
                    e.currentTarget.style.borderColor = 'rgba(100, 100, 105, 0.7)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(28, 28, 33, 0.45)';
                    e.currentTarget.style.borderColor = 'rgba(70, 70, 75, 0.7)';
                }}
            >
                <h3 style={{
                    fontSize: 'var(--font-size-2xl)',
                    fontWeight: 600,
                    margin: 0,
                    color: '#ffffff',
                    letterSpacing: '-0.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                }}>
                    Workspace
                </h3>
                <span style={{
                    fontSize: '0.85rem',
                    opacity: 0.5,
                    color: 'var(--text-secondary, #aaa)'
                }}>
                    Click to expand
                </span>
            </div>
        );
    }

    return (
        <div style={{ marginBottom: 'var(--section-spacing)' }}>
            {/* Header with toggle */}
            <div
                onClick={() => setIsCollapsed(true)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                    padding: '8px 16px',
                    cursor: 'pointer',
                    transition: 'opacity 0.2s ease',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.7';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1';
                }}
            >
                <h3 style={{
                    fontSize: 'var(--font-size-2xl)',
                    fontWeight: 600,
                    margin: 0,
                    color: '#ffffff',
                    letterSpacing: '-0.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                }}>
                    Workspace
                </h3>
                <span style={{
                    fontSize: '0.75rem',
                    opacity: 0.4,
                    color: 'var(--text-secondary, #aaa)'
                }}>
                    Click to hide
                </span>
            </div>

            {/* Filters */}
            <div style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '24px 0 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} data-onboarding="workspace-filters">
                    <WorkspaceFilters
                        items={filterItems}
                        active={workspace}
                        onChange={setWorkspace}
                        onWorkspaceCreated={createWorkspace}
                        onPinWorkspace={togglePinWorkspace}
                        onAddLink={handleOpenAddLinkModal}
                        pinnedWorkspaces={pinnedWorkspaces}
                        onShareWorkspaceUrl={handleShareWorkspaceUrl}
                    />
                </div>
            </div>

            {/* Workspace Grid Content */}
            {workspace && (
                <div className="workspace-grid-section section">
                    <div key={`ws-${workspace}`} className="ws-animate-in">
                        {renderWorkspaceGrid(
                            savedWorkspaces.find(ws => ws.name === workspace) || { name: workspace, urls: [] },
                            mergedWorkspaceItems,
                            workspace
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default WorkspaceSection;
