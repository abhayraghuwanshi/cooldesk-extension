import { faBriefcase, faDesktop, faGamepad, faGraduationCap } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { deleteWorkspace, getUrlAnalytics } from '../../db/index.js';
import { isElectronApp } from '../../services/environmentDetector.js';
import { recordFeedbackEvent } from '../../services/feedbackService.js';
import { runningAppsService } from '../../services/runningAppsService.js';
import '../../styles/cooldesk.css';
import { defaultFontFamily } from '../../utils/fontUtils';
import { enrichRunningAppsWithIcons } from '../../utils/helpers.js';
import { ShareToTeamModal } from '../popups/ShareToTeamModal';
import { WorkspaceCard } from './WorkspaceCard';

// Debounce utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const modeConfigs = {
    work: {
        label: 'Deep Work',
        icon: faBriefcase,
        theme: '#3b82f6', // Professional Blue
        activeCategories: ['productivity', 'ai', 'utilities', 'finance', 'work', 'business', 'office', 'code', 'dev', 'management', 'project'],
        behavior: {
            allowNotifications: false,
            autoHideDock: true,
            greeting: "Focus Time"
        }
    },
    entertainment: {
        label: 'Chill Mode',
        icon: faGamepad, // or faCoffee
        theme: '#f43f5e', // Rose/Red
        activeCategories: ['entertainment', 'social', 'food', 'shopping', 'media', 'game', 'gaming', 'music', 'video'],
        behavior: {
            allowNotifications: true,
            autoHideDock: false,
            greeting: "Time to Unwind"
        }
    },
    study: {
        label: 'Learning',
        icon: faGraduationCap, // or faBook
        theme: '#8b5cf6', // Deep Purple
        activeCategories: ['education', 'information', 'ai', 'design', 'research', 'learn', 'study', 'book', 'reading', 'news', 'science'],
        behavior: {
            allowNotifications: false,
            autoHideDock: false,
            greeting: "Knowledge Mode"
        }
    },
    apps: {
        label: 'Apps',
        icon: faDesktop,
        theme: '#ec4899', // Pink
        activeCategories: [],
        behavior: {
            allowNotifications: true,
            autoHideDock: false,
            greeting: "Your Desktop Apps"
        }
    }
};

export function WorkspaceList({
    savedWorkspaces = [],
    onWorkspaceClick,
    activeWorkspaceId,
    expandedWorkspaceId,
    pinnedWorkspaces = [], // New prop
    onTogglePin,            // New prop
    onAddUrl               // New prop
}) {
    // Load view mode from localStorage, default to 'list'
    const [viewMode, setViewMode] = useState(() => {
        try {
            return localStorage.getItem('cooldesk_view_mode') || 'list';
        } catch {
            return 'list';
        }
    });

    const isDesktopApp = isElectronApp();
    const [runningApps, setRunningApps] = useState([]);
    const [installedApps, setInstalledApps] = useState([]);

    useEffect(() => {
        if (!isDesktopApp || !window.electronAPI?.getRunningApps) return;

        const unsubscribe = runningAppsService.subscribe(({ runningApps: running, installedApps: installed }) => {
            if (Array.isArray(installed)) {
                // Deduplicate by name and path to ensure clean list
                const seen = new Set();
                const uniqueApps = installed.filter(app => {
                    const key = `${app.name || ''}-${app.path || ''}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                setInstalledApps(uniqueApps);
            }

            if (Array.isArray(running)) {
                const enriched = enrichRunningAppsWithIcons(running, installed);
                setRunningApps(enriched);
            }
        });

        return unsubscribe;
    }, [isDesktopApp]);
    const [bookmarks, setBookmarks] = useState([]);
    const [bookmarkSearch, setBookmarkSearch] = useState('');
    const [showBookmarks, setShowBookmarks] = useState(true);
    const [workspaceLimit, setWorkspaceLimit] = useState(100); // Show all workspaces
    const [popoverState, setPopoverState] = useState({ id: null, rect: null });
    const [hoveredBookmark, setHoveredBookmark] = useState(null);
    const [bookmarkLimit, setBookmarkLimit] = useState(20);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false); // New state
    const [activeMode, setActiveMode] = useState('all');
    const [isPending, startTransition] = useTransition();

    const handleModeChange = useCallback((mode) => {
        startTransition(() => {
            setActiveMode(mode);
        });
    }, []);

    const pinned = useMemo(() => savedWorkspaces.filter(ws => pinnedWorkspaces.includes(ws.name)), [savedWorkspaces, pinnedWorkspaces]);
    const unpinned = useMemo(() => savedWorkspaces.filter(ws => !pinnedWorkspaces.includes(ws.name)), [savedWorkspaces, pinnedWorkspaces]);

    // State for workspace activity scores
    // Load cached scores synchronously to prevent layout shift on refresh
    const [workspaceScores, setWorkspaceScores] = useState(() => {
        try {
            const cachedScores = localStorage.getItem('cooldesk_workspace_scores');
            if (cachedScores) {
                return new Map(JSON.parse(cachedScores));
            }
        } catch { /* ignore */ }
        return new Map();
    });
    const [isSortingByActivity, setIsSortingByActivity] = useState(() => {
        try {
            // Default to true (sort by activity) if not set
            const saved = localStorage.getItem('cooldesk_sort_by_activity');
            return saved !== null ? saved === 'true' : true;
        } catch {
            return true;
        }
    });
    const [isCalculatingScores, setIsCalculatingScores] = useState(false);


    // Calculate activity score for a workspace
    const calculateWorkspaceScore = useCallback(async (workspace) => {
        if (!workspace.urls || workspace.urls.length === 0) {
            console.log(`[WorkspaceList] Workspace "${workspace.name}" has no URLs`);
            return 0;
        }

        console.log(`[WorkspaceList] Calculating score for "${workspace.name}" with ${workspace.urls.length} URLs`);

        try {
            // Fetch analytics for all URLs in parallel
            const analyticsPromises = workspace.urls.map(async (urlObj) => {
                try {
                    const response = await getUrlAnalytics(urlObj.url);
                    const stats = response?.success ? response.data : null;
                    return stats || { totalVisits: 0, totalTime: 0, lastVisit: 0 };
                } catch (error) {
                    console.error(`[WorkspaceList] Error getting stats for "${urlObj.url}":`, error);
                    return { totalVisits: 0, totalTime: 0, lastVisit: 0 };
                }
            });

            const allStats = await Promise.all(analyticsPromises);

            // Aggregate metrics
            const totalVisits = allStats.reduce((sum, s) => sum + (s.totalVisits || 0), 0);
            const totalTime = allStats.reduce((sum, s) => sum + (s.totalTime || 0), 0);
            const mostRecentVisit = Math.max(...allStats.map(s => s.lastVisit || 0), 0);

            // Calculate composite score
            // Formula: (visits * 10) + (time_in_hours * 50) + (recency_bonus)
            const timeInHours = totalTime / (1000 * 60 * 60);
            const recencyBonus = mostRecentVisit > 0
                ? Math.max(0, 100 - (Date.now() - mostRecentVisit) / (1000 * 60 * 60 * 24)) // Decay over days
                : 0;

            const score = (totalVisits * 10) + (timeInHours * 50) + recencyBonus;

            return score;
        } catch (error) {
            console.error(`[WorkspaceList] Error calculating workspace score for "${workspace.name}":`, error);
            return 0;
        }
    }, []);


    // Compute hash for workspaces to detect meaningful changes
    const workspacesHash = useMemo(() => {
        return unpinned.map(w => w.id + (w.urls?.length || 0)).join(',');
    }, [unpinned]);

    // Debounced activity score loader with Cache
    const loadActivityScores = useMemo(
        () => debounce(async () => {
            if (!isSortingByActivity || unpinned.length === 0) return;

            const cacheKey = 'cooldesk_workspace_scores';
            const cacheHashKey = 'cooldesk_workspace_scores_hash';

            // Check cache
            const lastHash = localStorage.getItem(cacheHashKey);
            if (lastHash === workspacesHash) {
                try {
                    const cachedScores = JSON.parse(localStorage.getItem(cacheKey));
                    if (cachedScores) {
                        setWorkspaceScores(new Map(cachedScores));
                        return;
                    }
                } catch { /* ignore */ }
            }

            setIsCalculatingScores(true);
            const scoresMap = new Map();
            const scoresArray = []; // For serialization

            // Calculate scores for all unpinned workspaces
            await Promise.all(
                unpinned.map(async (workspace) => {
                    const score = await calculateWorkspaceScore(workspace);
                    scoresMap.set(workspace.id, score);
                    scoresArray.push([workspace.id, score]);
                })
            );

            setWorkspaceScores(scoresMap);
            setIsCalculatingScores(false);

            // Update Cache
            try {
                localStorage.setItem(cacheKey, JSON.stringify(scoresArray));
                localStorage.setItem(cacheHashKey, workspacesHash);
            } catch { /* ignore */ }

        }, 500),
        [unpinned, isSortingByActivity, calculateWorkspaceScore, workspacesHash]
    );

    // Load activity scores only when sorting is enabled
    useEffect(() => {
        if (isSortingByActivity) {
            // Use requestIdleCallback if available for smoother UI
            if (window.requestIdleCallback) {
                window.requestIdleCallback(() => loadActivityScores(), { timeout: 2000 });
            } else {
                loadActivityScores();
            }
        }
    }, [isSortingByActivity, workspacesHash, loadActivityScores]);


    // Sort unpinned workspaces by activity score (memoized)
    // Scores are loaded from cache on mount, so sorting happens immediately without layout shift
    const sortedUnpinned = useMemo(() => {
        if (!isSortingByActivity) return unpinned;

        return [...unpinned].sort((a, b) => {
            const scoreA = workspaceScores.get(a.id) || 0;
            const scoreB = workspaceScores.get(b.id) || 0;
            return scoreB - scoreA; // Descending order
        });
    }, [unpinned, isSortingByActivity, workspaceScores]);

    // Filter unpinned workspaces based on active mode
    const filteredUnpinned = useMemo(() => {
        if (activeMode === 'all') return sortedUnpinned;

        const config = modeConfigs[activeMode];
        if (!config) return sortedUnpinned;

        // Optimization: Create a regex for faster matching if categories are stable
        // For now, we'll keep the logic but ensure it's efficient
        const activeCategories = config.activeCategories;

        return sortedUnpinned.filter(workspace => {
            const name = workspace.name.toLowerCase();
            // Optimized check: Use basic includes for performance, it's usually sufficient for this use case
            // If stricter matching is needed, we can revert or use regex
            for (let i = 0; i < activeCategories.length; i++) {
                if (name.includes(activeCategories[i])) return true;
            }
            return false;
        });
    }, [sortedUnpinned, activeMode]);

    useEffect(() => {
        try {
            localStorage.setItem('cooldesk_view_mode', viewMode);
        } catch (e) {
            console.error('Failed to save view mode:', e);
        }
    }, [viewMode]);

    // Save sort preference
    useEffect(() => {
        try {
            localStorage.setItem('cooldesk_sort_by_activity', isSortingByActivity);
        } catch (e) {
            console.error('Failed to save sort preference:', e);
        }
    }, [isSortingByActivity]);

    // Fetch bookmarks on mount
    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome.bookmarks) {
            chrome.bookmarks.getTree((bookmarkTreeNodes) => {
                const flatBookmarks = [];
                const traverse = (nodes) => {
                    nodes.forEach(node => {
                        if (node.url) {
                            flatBookmarks.push({
                                id: node.id,
                                title: node.title || node.url,
                                url: node.url
                            });
                        }
                        if (node.children) {
                            traverse(node.children);
                        }
                    });
                };
                traverse(bookmarkTreeNodes);
                setBookmarks(flatBookmarks);
            });
        }
    }, []);

    // Filter bookmarks based on search
    const filteredBookmarks = bookmarks.filter(bookmark =>
        !bookmarkSearch ||
        bookmark.title.toLowerCase().includes(bookmarkSearch.toLowerCase()) ||
        bookmark.url.toLowerCase().includes(bookmarkSearch.toLowerCase())
    );

    const handleBookmarkClick = (url) => {
        if (typeof chrome !== 'undefined' && chrome.tabs) {
            chrome.tabs.create({ url });
        }
    };

    const handleDeleteWorkspace = async (workspace) => {
        // Confirm deletion
        const confirmed = window.confirm(`Are you sure you want to delete the workspace "${workspace.name}"? This action cannot be undone.`);

        if (!confirmed) return;

        try {
            await deleteWorkspace(workspace.id);
            console.log(`[WorkspaceList] Deleted workspace: ${workspace.name}`);

            // Reload the page to refresh the workspace list
            window.location.reload();
        } catch (error) {
            console.error('[WorkspaceList] Failed to delete workspace:', error);
            alert('Failed to delete workspace. Please try again.');
        }
    };

    const renderAppCard = (app, isRunning) => {
        return (
            <div
                key={app.id || app.name}
                className="workspace-card"
                style={{
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: viewMode === 'list' ? 'row' : 'column',
                    alignItems: viewMode === 'list' ? 'center' : 'flex-start',
                    padding: '16px',
                    gap: '12px',
                    background: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid rgba(148, 163, 184, 0.1)',
                    borderRadius: '16px',
                    transition: 'all 0.2s',
                    position: 'relative',
                    overflow: 'hidden'
                }}
                onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)';
                    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.2)';
                }}
                onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(30, 41, 59, 0.4)';
                    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.1)';
                }}
                onClick={async () => {
                    // Record feedback for RAG learning
                    recordFeedbackEvent({
                        suggestionType: 'related_resource',
                        action: 'accepted',
                        suggestionContent: app.name || app.path,
                        contextWorkspace: activeMode !== 'all' ? modeConfigs[activeMode]?.label : undefined
                    }).catch(() => { });

                    if (isRunning && window.electronAPI?.focusApp && app.pid) {
                        await window.electronAPI.focusApp(app.pid, app.name);
                    } else if (!isRunning && window.electronAPI?.launchApp && app.path) {
                        await window.electronAPI.launchApp(app.path);
                    }
                }}
            >
                <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    background: isRunning ? 'rgba(34, 197, 94, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                    border: `1px solid ${isRunning ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 116, 139, 0.2)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                }}>
                    {app.icon ? (
                        <img src={app.icon} alt="" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
                    ) : (
                        <span style={{ fontSize: '24px' }}>{isRunning ? '🖥️' : '📦'}</span>
                    )}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <div style={{
                        fontSize: '15px',
                        fontWeight: 600,
                        color: '#F1F5F9',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginBottom: '4px'
                    }}>
                        {app.name}
                    </div>
                    <div style={{
                        fontSize: '12px',
                        color: '#94A3B8',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        {isRunning ? (
                            <>
                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22C55E' }}></div>
                                <span style={{ color: '#22C55E' }}>Running</span>
                                {app.title && app.title !== app.name && (
                                    <>
                                        <span>•</span>
                                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.title}</span>
                                    </>
                                )}
                            </>
                        ) : (
                            <span>Installed</span>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            gap: '16px',
            overflow: 'hidden' // Parent manages layout, child scrolls
        }}>
            {/* Scrollable Content Area */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
                paddingRight: '4px',
                minHeight: 0 // Crucial for nested flex scrolling
            }}>
                {savedWorkspaces.length > 0 ? (
                    <>
                        {/* Pinned Workspaces Section */}
                        {pinned.length > 0 && (
                            <div>
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
                                    Pinned ({pinned.length})
                                </h3>
                                <div
                                    className={viewMode === 'list' ? 'cooldesk-list-view' : ''}
                                    style={viewMode === 'grid' ? {
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                        gap: '16px'
                                    } : {
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '4px'
                                    }}
                                >
                                    {pinned.map((workspace) => (
                                        <WorkspaceCard
                                            key={workspace.id}
                                            workspace={workspace}
                                            onClick={onWorkspaceClick}
                                            isExpanded={expandedWorkspaceId === workspace.id}
                                            isActive={activeWorkspaceId === workspace.id}
                                            compact={viewMode === 'list'}
                                            isPinned={true}
                                            onPin={() => onTogglePin && onTogglePin(workspace.name)}
                                            onDelete={handleDeleteWorkspace}
                                            onAddUrl={onAddUrl}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* All Workspaces Section */}
                        {unpinned.length > 0 && (
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
                                        margin: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        {activeMode === 'all' ? 'All Urls' : modeConfigs[activeMode].label}
                                        ({activeMode === 'apps' ? installedApps.length : filteredUnpinned.length})
                                        {isSortingByActivity && isCalculatingScores && activeMode !== 'apps' && (
                                            <span style={{
                                                fontSize: '11px',
                                                color: '#60a5fa',
                                                fontWeight: 400,
                                                textTransform: 'none',
                                                letterSpacing: 'normal',
                                                opacity: 0.8
                                            }}>
                                                sorting...
                                            </span>
                                        )}
                                    </h3>
                                </div>

                                {/* Mode Filters */}
                                {/* Mode Selector - Premium Redesign */}
                                <div style={{
                                    marginBottom: '20px',
                                    padding: '0 4px'
                                }}>
                                    <div className="mode-selector-container">
                                        <button
                                            className={`mode-item ${activeMode === 'all' ? 'active' : ''}`}
                                            onClick={() => handleModeChange('all')}
                                            title="All Workspaces"
                                        >
                                            <span className="mode-icon">
                                                <span style={{ fontSize: '14px', fontWeight: 700 }}>ALL</span>
                                            </span>
                                            {activeMode === 'all' && <span className="mode-label">All</span>}
                                        </button>

                                        {Object.entries(modeConfigs).map(([key, config]) => {
                                            if (key === 'apps' && !isDesktopApp) return null;
                                            const isActive = activeMode === key;
                                            return (
                                                <button
                                                    key={key}
                                                    className={`mode-item ${isActive ? 'active' : ''}`}
                                                    onClick={() => handleModeChange(key)}
                                                    title={config.label}
                                                    style={{
                                                        '--mode-color': config.theme
                                                    }}
                                                >
                                                    <span className="mode-icon">
                                                        <FontAwesomeIcon icon={config.icon} />
                                                    </span>
                                                    {isActive && <span className="mode-label">{config.label}</span>}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Active Mode Greeting */}
                                    <div style={{
                                        height: activeMode !== 'all' ? '30px' : '0',
                                        overflow: 'hidden',
                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        opacity: activeMode !== 'all' ? 1 : 0,
                                        transform: activeMode !== 'all' ? 'translateY(0)' : 'translateY(-10px)',
                                        marginTop: activeMode !== 'all' ? '8px' : '0'
                                    }}>
                                        {activeMode !== 'all' && (
                                            <div style={{
                                                fontSize: '13px',
                                                color: modeConfigs[activeMode].theme,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                fontWeight: 500,
                                                paddingLeft: '4px'
                                            }}>
                                                <span style={{
                                                    width: '6px',
                                                    height: '6px',
                                                    borderRadius: '50%',
                                                    background: modeConfigs[activeMode].theme,
                                                    display: 'inline-block'
                                                }}></span>
                                                {modeConfigs[activeMode].behavior.greeting}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {activeMode === 'apps' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
                                        <div>
                                            <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#94A3B8', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Installed Apps</h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '12px' }}>
                                                {installedApps.slice(0, 50).map(app => (
                                                    <div
                                                        key={app.id || app.name}
                                                        onClick={async () => {
                                                            // Track app launch for feedback
                                                            recordFeedbackEvent({
                                                                suggestionType: 'related_resource',
                                                                action: 'accepted',
                                                                suggestionContent: app.name || app.path
                                                            }).catch(() => { });
                                                            if (window.electronAPI?.launchApp && app.path) await window.electronAPI.launchApp(app.path);
                                                        }}
                                                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '16px 12px', borderRadius: '16px', transition: 'all 0.2s', background: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(148, 163, 184, 0.1)' }}
                                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)'; e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.3)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(30, 41, 59, 0.4)'; e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.1)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                                    >
                                                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(100, 116, 139, 0.1)', border: '1px solid rgba(100, 116, 139, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            {app.icon ? <img src={app.icon} style={{ width: '32px', height: '32px', objectFit: 'contain' }} alt="" onError={e => e.target.style.display = 'none'} /> : <span style={{ fontSize: '24px' }}>📦</span>}
                                                        </div>
                                                        <div style={{ fontSize: '12px', fontWeight: 500, color: '#F1F5F9', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {app.name}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div
                                        className={viewMode === 'list' ? 'cooldesk-list-view' : ''}
                                        style={viewMode === 'grid' ? {
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                            gap: '16px'
                                        } : {
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '4px'
                                        }}
                                    >
                                        {filteredUnpinned.slice(0, workspaceLimit).map((workspace, index) => (
                                            <WorkspaceCard
                                                key={workspace.id}
                                                workspace={workspace}
                                                onClick={onWorkspaceClick}
                                                isExpanded={expandedWorkspaceId === workspace.id}
                                                isActive={activeWorkspaceId === workspace.id}
                                                compact={viewMode === 'list'}
                                                isPinned={false}
                                                onPin={() => onTogglePin && onTogglePin(workspace.name)}
                                                onDelete={handleDeleteWorkspace}
                                                onAddUrl={onAddUrl}
                                                deferAnalytics={index > 3}
                                            />
                                        ))}
                                    </div>
                                )}

                            </div>
                        )}

                    </>
                ) : (
                    <div style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '16px',
                        color: 'var(--text-secondary, #64748B)',
                        textAlign: 'center',
                        minHeight: '200px'
                    }}>
                        <div style={{ fontSize: '40px', opacity: 0.3 }}>📁</div>
                        <div>
                            <div style={{
                                fontSize: 'var(--font-lg, 14px)',
                                fontWeight: 500,
                                marginBottom: '4px'
                            }}>
                                No Workspaces Yet
                            </div>
                            <div style={{ fontSize: 'var(--font-sm, 12px)' }}>
                                Create your first workspace to get started!
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {/* Share Modal */}
            <ShareToTeamModal
                isOpen={isShareModalOpen}
                onClose={() => setIsShareModalOpen(false)}
                contextWorkspace={savedWorkspaces.find(w => w.id === activeWorkspaceId)}
            />
        </div>
    );
}
