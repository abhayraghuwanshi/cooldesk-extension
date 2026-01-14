import { faStickyNote } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import '../../styles/cooldesk.css';
import { ActivityFeed } from './ActivityFeed';
import { NotesWidget } from './NotesWidget';
import { WorkspaceCard } from './WorkspaceCard';

export function OverviewDashboard({
    savedWorkspaces = [],
    onWorkspaceClick,
    activeWorkspaceId,
    expandedWorkspaceId,
    onAddNote,
    pinnedWorkspaces = [] // New prop
}) {
    // Prioritize pinned workspaces, then recent ones
    // Max 2 workspaces shown
    const pinned = savedWorkspaces.filter(ws => pinnedWorkspaces.includes(ws.name));
    const unpinned = savedWorkspaces.filter(ws => !pinnedWorkspaces.includes(ws.name));

    // Sort logic? Usually just recent order from savedWorkspaces is fine.
    // If user pins something, show it first.
    const displayedWorkspaces = [...pinned, ...unpinned].slice(0, 2);

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 1fr', // Left column wider for workspaces
            gap: '24px',
            height: '100%',
            overflow: 'hidden', // Parent handles scroll if needed, but here we want inner scroll or fit? 
            // The user wants a dashboard, likely fitting screen or scrolling together. 
            // Let's make it scrollable if content overflows.
            overflowY: 'auto',
            paddingRight: '4px'
        }}>
            {/* Left Column: 2 Workspaces + Notes */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '20px'
            }}>
                {/* Workspaces Section */}
                <div>
                    <h3 style={{
                        fontSize: 'var(--font-xl, 16px)',
                        fontWeight: 600,
                        color: 'var(--text-primary, #F1F5F9)',
                        marginBottom: '12px',
                        marginTop: 0
                    }}>
                        Recent Workspaces
                    </h3>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                        gap: '16px'
                    }}>
                        {displayedWorkspaces.length > 0 ? (
                            displayedWorkspaces.map(workspace => (
                                <WorkspaceCard
                                    key={workspace.id}
                                    workspace={workspace}
                                    onClick={onWorkspaceClick}
                                    isExpanded={expandedWorkspaceId === workspace.id}
                                    isActive={activeWorkspaceId === workspace.id}
                                    compact={false}
                                />
                            ))
                        ) : (
                            <div style={{
                                padding: '20px',
                                background: 'rgba(30, 41, 59, 0.4)',
                                borderRadius: '12px',
                                color: '#64748B',
                                textAlign: 'center',
                                fontSize: '13px'
                            }}>
                                No workspaces found.
                            </div>
                        )}
                    </div>
                </div>

                {/* Notes Widget Section */}
                <div style={{ flex: 1, minHeight: '300px' }}>
                    <h3 style={{
                        fontSize: 'var(--font-xl, 16px)',
                        fontWeight: 600,
                        color: 'var(--text-primary, #F1F5F9)',
                        marginBottom: '12px',
                        marginTop: 0
                    }}>
                        Quick Notes
                    </h3>
                    <div className="cooldesk-workspace-card" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100%',
                        minHeight: '300px'
                    }}>
                        <div className="workspace-card-header">
                            <div className="workspace-icon purple">
                                <FontAwesomeIcon icon={faStickyNote} />
                            </div>
                            <div className="workspace-info">
                                <div className="workspace-name">Notes</div>
                                <div className="workspace-count">Jot down a thought...</div>
                            </div>
                        </div>
                        <div style={{
                            flex: 1,
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0
                        }}>
                            <NotesWidget maxNotes={5} compact={false} onAddNote={onAddNote} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Column: Unified Activity Feed */}
            <div style={{
                height: '100%',
                overflow: 'hidden',
                borderRadius: '16px',
                border: '1px solid rgba(148, 163, 184, 0.1)',
                background: 'rgba(15, 23, 42, 0.3)'
            }}>
                <ActivityFeed />
            </div>
        </div>
    );
}
