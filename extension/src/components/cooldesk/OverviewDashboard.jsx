import { faStickyNote } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { getUrlAnalytics } from '../../db/index.js';
import '../../styles/cooldesk.css';
import { sortWorkspacesByActivity } from '../../utils/ranking.js';
import { NotesWidget } from './NotesWidget';
import { WorkspaceCard } from './WorkspaceCard';

// Lazy load ActivityFeed as it's not critical for LCP (Largest Contentful Paint)
const ActivityFeed = lazy(() => import('./ActivityFeed').then(m => ({ default: m.ActivityFeed })));

// Memoized Helper for analytics to avoid recreating it
const getAnalytics = async (ws) => {
    let totalVisits = 0;
    let totalTime = 0;
    let lastActive = 0;

    if (ws.urls && ws.urls.length > 0) {
        try {
            // Optimization: If workspace has metadata, use it first to avoid DB hits
            // This assumes the DB updates workspace metadata on activity
            if (ws.lastActive && ws.totalVisits) {
                return {
                    totalVisits: ws.totalVisits,
                    totalTime: ws.totalTime || 0,
                    lastActive: ws.lastActive
                };
            }

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

export function OverviewDashboard({
    savedWorkspaces = [],
    onWorkspaceClick,
    activeWorkspaceId,
    expandedWorkspaceId,
    onAddNote,
    pinnedWorkspaces = [],
    onAddUrl
}) {
    const [recentWorkspaces, setRecentWorkspaces] = useState(() => {
        // Hydrate from local storage cache for instant render
        try {
            const cached = localStorage.getItem('cooldesk_recent_workspaces');
            return cached ? JSON.parse(cached) : [];
        } catch {
            return [];
        }
    });
    const [isLoading, setIsLoading] = useState(recentWorkspaces.length === 0);

    // Compute a stable hash of the input workspaces to detect changes
    const workspacesHash = useMemo(() => {
        return savedWorkspaces.map(w => w.id + (w.urls?.length || 0)).join(',');
    }, [savedWorkspaces]);

    useEffect(() => {
        let isMounted = true;
        const cacheKey = 'cooldesk_recent_workspaces';
        const cacheHashKey = 'cooldesk_recent_workspaces_hash';

        const loadRecentWorkspaces = async () => {
            if (!savedWorkspaces || savedWorkspaces.length === 0) {
                if (isMounted) {
                    setRecentWorkspaces([]);
                    setIsLoading(false);
                }
                return;
            }

            // Check if our cache is still valid
            const lastHash = localStorage.getItem(cacheHashKey);
            if (lastHash === workspacesHash && recentWorkspaces.length > 0) {
                // Cache is valid, no need to re-sort (DB expensive)
                setIsLoading(false);
                return;
            }

            try {
                // Use the Activity Score algorithm to sort
                const sorted = await sortWorkspacesByActivity(savedWorkspaces, getAnalytics);

                const top4 = sorted.slice(0, 4);
                if (isMounted) {
                    setRecentWorkspaces(top4);
                    setIsLoading(false);
                    // Update cache
                    localStorage.setItem(cacheKey, JSON.stringify(top4));
                    localStorage.setItem(cacheHashKey, workspacesHash);
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

        // Defer this heavy task to avoid blocking transition animations if this component mounts during a slide
        // Uses requestIdleCallback if available, or a small timeout
        if (window.requestIdleCallback) {
            window.requestIdleCallback(() => loadRecentWorkspaces(), { timeout: 2000 });
        } else {
            setTimeout(loadRecentWorkspaces, 100);
        }

        return () => { isMounted = false; };
    }, [workspacesHash]); // Depend on hash, not array reference, to avoid loops if array is recreated but identical

    // Use recent workspaces if loaded, otherwise fallback or empty
    const displayedWorkspaces = recentWorkspaces.length > 0 ? recentWorkspaces : (isLoading ? [] : savedWorkspaces.slice(0, 4));

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
                        gap: '2px',
                        overflow: 'visible',
                        minHeight: '200px' // Optimization: Reserve space to prevent layout shift
                    }}>
                        {isLoading && displayedWorkspaces.length === 0 ? (
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
                                    onAddUrl={onAddUrl}
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

            {/* Right Column: Unified Activity Feed (includes Calendar tab) */}
            <div className="overview-activity-column">
                <Suspense fallback={<div style={{ padding: 20, color: '#64748B' }}>Loading feed...</div>}>
                    <ActivityFeed />
                </Suspense>
            </div>
        </div>
    );
}
