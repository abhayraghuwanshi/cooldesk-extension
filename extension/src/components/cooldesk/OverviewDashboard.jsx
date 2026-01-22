import { faStickyNote } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { getUrlAnalytics } from '../../db/index.js';
import '../../styles/cooldesk.css';
import { sortWorkspacesByActivity } from '../../utils/ranking.js';
import { ActivityFeed } from './ActivityFeed';
import { NotesWidget } from './NotesWidget';
import { WorkspaceCard } from './WorkspaceCard';

export function OverviewDashboard({
    savedWorkspaces = [],
    onWorkspaceClick,
    activeWorkspaceId,
    expandedWorkspaceId,
    onAddNote,
    pinnedWorkspaces = [] // still passed if needed for visual pin state
}) {
    const [recentWorkspaces, setRecentWorkspaces] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const loadRecentWorkspaces = async () => {
            if (!savedWorkspaces || savedWorkspaces.length === 0) {
                if (isMounted) {
                    setRecentWorkspaces([]);
                    setIsLoading(false);
                }
                return;
            }

            try {
                // Helper to fetch aggregated analytics for a single workspace
                const getAnalytics = async (ws) => {
                    let totalVisits = 0;
                    let totalTime = 0;
                    let lastActive = 0; // Pure usage data, no fallbacks here

                    if (ws.urls && ws.urls.length > 0) {
                        try {
                            const statsPromises = ws.urls.map(u => getUrlAnalytics(u.url));
                            const statsResults = await Promise.all(statsPromises);

                            statsResults.forEach(res => {
                                if (res?.success && res.data) {
                                    totalVisits += (res.data.totalVisits || 0);
                                    totalTime += (res.data.totalTime || 0);
                                    if (res.data.lastVisit) {
                                        lastActive = Math.max(lastActive, res.data.lastVisit);
                                    }
                                }
                            });
                        } catch (e) {
                            console.warn('Failed to fetch analytics for workspace:', ws.name);
                        }
                    }
                    return { totalVisits, totalTime, lastActive };
                };

                // Use the Activity Score algorithm to sort
                const sorted = await sortWorkspacesByActivity(savedWorkspaces, getAnalytics);

                if (isMounted) {
                    setRecentWorkspaces(sorted.slice(0, 4));
                    setIsLoading(false);
                }
            } catch (error) {
                console.error('Error sorting workspaces:', error);
                if (isMounted) {
                    // Fallback to default order
                    setRecentWorkspaces(savedWorkspaces.slice(0, 4));
                    setIsLoading(false);
                }
            }
        };

        loadRecentWorkspaces();

        return () => { isMounted = false; };
    }, [savedWorkspaces]);

    // Use recent workspaces if loaded, otherwise fallback or empty
    const displayedWorkspaces = recentWorkspaces;

    return (
        <div className="overview-dashboard-grid">
            {/* Left Column: Workspaces + Notes */}
            <div className="overview-left-column">
                {/* Workspaces Section */}
                <div>
                    <h3 style={{
                        fontSize: 'var(--font-2xl, 20px)',
                        fontWeight: 600,
                        color: 'var(--text-primary, #F1F5F9)',
                        marginBottom: '16px',
                        marginTop: 0
                    }}>
                        Recent Workspaces
                    </h3>
                    <div className="cooldesk-list-view" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        overflow: 'visible'
                    }}>
                        {isLoading ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#64748B' }}>
                                Loading recent activity...
                            </div>
                        ) : displayedWorkspaces.length > 0 ? (
                            displayedWorkspaces.map(workspace => (
                                <WorkspaceCard
                                    key={workspace.id}
                                    workspace={workspace}
                                    onClick={onWorkspaceClick}
                                    isExpanded={expandedWorkspaceId === workspace.id}
                                    isActive={activeWorkspaceId === workspace.id}
                                    compact={true}
                                    isPinned={pinnedWorkspaces.includes(workspace.name)}
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
                <div className="overview-notes-section">
                    <h3 style={{
                        fontSize: 'var(--font-2xl, 20px)',
                        fontWeight: 600,
                        color: 'var(--text-primary, #F1F5F9)',
                        marginBottom: '16px',
                        marginTop: 0
                    }}>
                        Quick Notes
                    </h3>
                    <div className="cooldesk-workspace-card overview-notes-card">
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
            <div className="overview-activity-column">
                <ActivityFeed />
            </div>
        </div>
    );
}
