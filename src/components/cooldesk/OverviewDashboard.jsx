import { lazy, memo, Suspense, useEffect, useMemo, useState } from 'react';
import { getUrlAnalytics } from '../../db/index.js';
import { isElectronApp } from '../../services/environmentDetector';
import '../../styles/cooldesk.css';
import { defaultFontFamily } from '../../utils/fontUtils';
import { sortWorkspacesByActivity } from '../../utils/ranking.js';
import { ResumeWorkWidget } from '../widgets/ResumeWorkWidget';
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

const OverviewDashboard = memo(function OverviewDashboard({
    savedWorkspaces = [],
    onWorkspaceClick,
    activeWorkspaceId,
    expandedWorkspaceId,
    onAddNote,
    pinnedWorkspaces = [],
    onAddUrl
}) {
    // Detect if running in Tauri/Electron app
    const isDesktopApp = isElectronApp();

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
    const [showAllWorkspaces, setShowAllWorkspaces] = useState(false);

    // In extension mode, allow showing more workspaces
    const DEFAULT_WORKSPACE_COUNT = isDesktopApp ? 2 : 3;
    const MAX_WORKSPACE_COUNT = isDesktopApp ? 2 : 10;

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

                // In extension mode, cache more workspaces for "show more" feature
                const topWorkspaces = sorted.slice(0, MAX_WORKSPACE_COUNT);
                if (isMounted) {
                    setRecentWorkspaces(topWorkspaces);
                    setIsLoading(false);
                    try {
                        localStorage.setItem(cacheKey, JSON.stringify(topWorkspaces));
                        localStorage.setItem(cacheHashKey, workspacesHash);
                    } catch (e) {
                        // Quota exceeded — clear stale cache and continue without caching
                        localStorage.removeItem(cacheKey);
                        localStorage.removeItem(cacheHashKey);
                    }
                }
            } catch (error) {
                console.error('Error sorting workspaces:', error);
                if (isMounted) {
                    // Fallback to default order
                    setRecentWorkspaces(savedWorkspaces.slice(0, MAX_WORKSPACE_COUNT));
                    setIsLoading(false);
                }
            }
        };

        // Defer this heavy task to avoid blocking transition animations if this component mounts during a slide
        let idleCallbackId = null;
        let timeoutId = null;
        if (window.requestIdleCallback) {
            idleCallbackId = window.requestIdleCallback(() => loadRecentWorkspaces(), { timeout: 2000 });
        } else {
            timeoutId = setTimeout(loadRecentWorkspaces, 100);
        }

        return () => {
            isMounted = false;
            if (idleCallbackId) window.cancelIdleCallback(idleCallbackId);
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [workspacesHash]); // Depend on hash, not array reference, to avoid loops if array is recreated but identical

    // Use recent workspaces if loaded, otherwise fallback or empty
    const allWorkspaces = recentWorkspaces.length > 0 ? recentWorkspaces : (isLoading ? [] : savedWorkspaces.slice(0, MAX_WORKSPACE_COUNT));

    const nonEmptyWorkspaces = useMemo(() =>
        savedWorkspaces.filter(w => w.urls && w.urls.length > 0),
        [savedWorkspaces]
    );

    // Show limited or all workspaces based on toggle state
    // In extension mode when expanded, use savedWorkspaces directly (up to MAX) to show all available
    const displayedWorkspaces = useMemo(() => {
        const base = allWorkspaces.filter(w => w.urls && w.urls.length > 0);
        if (!isDesktopApp && showAllWorkspaces) {
            return nonEmptyWorkspaces.slice(0, MAX_WORKSPACE_COUNT);
        }
        return showAllWorkspaces ? base : base.slice(0, DEFAULT_WORKSPACE_COUNT);
    }, [isDesktopApp, showAllWorkspaces, nonEmptyWorkspaces, allWorkspaces, MAX_WORKSPACE_COUNT, DEFAULT_WORKSPACE_COUNT]);
    // For extension mode, check against total savedWorkspaces count to show "more" button
    const hasMoreWorkspaces = !isDesktopApp
        ? nonEmptyWorkspaces.length > DEFAULT_WORKSPACE_COUNT
        : allWorkspaces.filter(w => w.urls && w.urls.length > 0).length > DEFAULT_WORKSPACE_COUNT;
    // Calculate how many more workspaces are available (for the button text)
    const moreWorkspacesCount = showAllWorkspaces
        ? 0
        : Math.min(nonEmptyWorkspaces.length, MAX_WORKSPACE_COUNT) - DEFAULT_WORKSPACE_COUNT;

    return (
        <div className="overview-dashboard-grid" style={{
            borderRadius: 16,
            border: '1px solid transparent',
            marginTop: '24px'
        }}>
            {/* Left Column: Workspaces + Notes */}
            <div className="overview-left-column">
                {/* Workspaces Section */}
                <div>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '12px'
                    }}>
                        <h3 style={{
                            fontSize: 'var(--font-2xl, 20px)',
                            fontWeight: 600,
                            color: 'var(--text-secondary, #94A3B8)',
                            fontFamily: defaultFontFamily,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            margin: 0
                        }}>
                            Workspaces
                            {!isDesktopApp && nonEmptyWorkspaces.length > 0 && (
                                <span style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    color: '#64748B',
                                    background: 'rgba(100, 116, 139, 0.2)',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    textTransform: 'none',
                                    letterSpacing: 'normal'
                                }}>
                                    {nonEmptyWorkspaces.length}
                                </span>
                            )}
                        </h3>
                        {/* Show more/less toggle - Extension mode only */}
                        {!isDesktopApp && hasMoreWorkspaces && (
                            <button
                                onClick={() => setShowAllWorkspaces(!showAllWorkspaces)}
                                style={{
                                    background: 'rgba(59, 130, 246, 0.1)',
                                    border: '1px solid rgba(59, 130, 246, 0.2)',
                                    borderRadius: '6px',
                                    padding: '4px 10px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    color: '#60A5FA',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {showAllWorkspaces ? 'Show less' : `+${moreWorkspacesCount} more`}
                            </button>
                        )}
                    </div>

                    <div className="cooldesk-list-view"
                        data-onboarding="workspace-list"
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                            overflow: 'visible',
                            minHeight: '240px'
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
                                    onAddUrl={isDesktopApp ? onAddUrl : undefined}
                                    deferAnalytics={true}
                                    data-onboarding="workspace-card"
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

                {/* Resume Work Widget - after workspaces to avoid shifting the h3 on load */}
                <ResumeWorkWidget />

                {/* Notes Widget Section - Desktop App Only 
                {isDesktopApp && (
                    <div className="    ">
                        <h3 style={{
                            fontSize: 'var(--font-2xl, 20px)',
                            fontWeight: 600,
                            color: 'var(--text-secondary, #94A3B8)',
                            fontFamily: defaultFontFamily,
                            marginBottom: '12px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}>
                            Quick Notes
                        </h3>
                        <div className="cooldesk-workspace-card overview-notes-card" data-onboarding="notes-widget">
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
                )}
                */}

            </div>

            {/* Right Column: Unified Activity Feed (includes Calendar tab) */}
            <div className="overview-activity-column">
                <Suspense fallback={<div style={{ minHeight: 400 }} />}>
                    <ActivityFeed />
                </Suspense>
            </div>
        </div>
    );
});

export { OverviewDashboard };

