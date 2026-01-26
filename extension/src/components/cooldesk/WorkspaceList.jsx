import { faBookmark, faChartLine, faList, faSearch, faShare, faThLarge } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteWorkspace, getUrlAnalytics } from '../../db/index.js';
import '../../styles/cooldesk.css';
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
    const [bookmarks, setBookmarks] = useState([]);
    const [bookmarkSearch, setBookmarkSearch] = useState('');
    const [showBookmarks, setShowBookmarks] = useState(true);
    const [workspaceLimit, setWorkspaceLimit] = useState(6); // Show 6 workspaces initially
    const [popoverState, setPopoverState] = useState({ id: null, rect: null });
    const [hoveredBookmark, setHoveredBookmark] = useState(null);
    const [bookmarkLimit, setBookmarkLimit] = useState(20);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false); // New state

    const pinned = useMemo(() => savedWorkspaces.filter(ws => pinnedWorkspaces.includes(ws.name)), [savedWorkspaces, pinnedWorkspaces]);
    const unpinned = useMemo(() => savedWorkspaces.filter(ws => !pinnedWorkspaces.includes(ws.name)), [savedWorkspaces, pinnedWorkspaces]);

    // State for workspace activity scores
    const [workspaceScores, setWorkspaceScores] = useState(new Map());
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
    const sortedUnpinned = useMemo(() => {
        if (!isSortingByActivity) return unpinned;

        return [...unpinned].sort((a, b) => {
            const scoreA = workspaceScores.get(a.id) || 0;
            const scoreB = workspaceScores.get(b.id) || 0;
            return scoreB - scoreA; // Descending order
        });
    }, [unpinned, isSortingByActivity, workspaceScores]);

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

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            gap: '16px',
            overflow: 'hidden' // Parent manages layout, child scrolls
        }}>
            {/* Header - Fixed at Top */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
                paddingRight: '4px'
            }}>
                <h2 style={{
                    fontSize: 'var(--font-xl, 16px)',
                    fontWeight: 600,
                    color: 'var(--text-primary, #F1F5F9)',
                    margin: 0
                }}>
                    Workspaces
                    <span style={{
                        fontSize: 'var(--font-md, 12px)',
                        color: 'var(--text-secondary, #94A3B8)',
                        marginLeft: '8px',
                        fontWeight: 400
                    }}>
                        ({savedWorkspaces.length})
                    </span>
                </h2>
                {/* <div style={{
                    fontSize: 'var(--font-sm)',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    paddingLeft: '4px'
                }}>
                    Workspaces
                </div> */}

                <div className="view-toggle" style={{ display: 'flex', gap: 8 }}>
                    <button
                        className="view-toggle-btn"
                        onClick={() => setIsShareModalOpen(true)}
                        title="Share to Team"
                        style={{ color: '#60a5fa' }}
                    >
                        <FontAwesomeIcon icon={faShare} />
                    </button>
                    <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }}></div>
                    <button
                        className={`view-toggle-btn ${isSortingByActivity ? 'active' : ''}`}
                        onClick={() => setIsSortingByActivity(!isSortingByActivity)}
                        title={isSortingByActivity ? "Sort Alphabetically" : "Sort by Activity"}
                        style={{ color: isSortingByActivity ? '#34d399' : undefined }}
                    >
                        <FontAwesomeIcon icon={faChartLine} />
                    </button>
                    <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }}></div>
                    <button
                        className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                        onClick={() => setViewMode('grid')}
                        title="Grid View"
                    >
                        <FontAwesomeIcon icon={faThLarge} />
                    </button>
                    <button
                        className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                        onClick={() => setViewMode('list')}
                        title="List View"
                    >
                        <FontAwesomeIcon icon={faList} />
                    </button>
                </div>
            </div>

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
                                    fontSize: 'var(--font-sm, 12px)',
                                    fontWeight: 600,
                                    color: 'var(--text-secondary, #94A3B8)',
                                    marginBottom: '12px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}>
                                    📌 Pinned ({pinned.length})
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
                                <h3 style={{
                                    fontSize: 'var(--font-sm, 12px)',
                                    fontWeight: 600,
                                    color: 'var(--text-secondary, #94A3B8)',
                                    marginBottom: '12px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em'
                                }}>
                                    All Workspaces ({unpinned.length})
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
                                    {sortedUnpinned.slice(0, workspaceLimit).map((workspace) => (
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
                                        />
                                    ))}
                                </div>

                                {/* Show More Button */}
                                {unpinned.length > workspaceLimit && (
                                    <button
                                        onClick={() => setWorkspaceLimit(prev => prev + 6)}
                                        style={{
                                            width: '100%',
                                            marginTop: '16px',
                                            padding: '12px',
                                            borderRadius: '10px',
                                            background: 'rgba(59, 130, 246, 0.1)',
                                            border: '1px solid rgba(59, 130, 246, 0.3)',
                                            color: '#60a5fa',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '4px'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                                            e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                                            e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                                            e.currentTarget.style.transform = 'translateY(0)';
                                        }}
                                    >
                                        Show More ({unpinned.length - workspaceLimit} remaining)
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Browser Bookmarks Section */}
                        {bookmarks.length > 0 && (
                            <div style={{ paddingBottom: '24px' }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    marginBottom: '12px'
                                }}>
                                    <h3 style={{
                                        fontSize: 'var(--font-sm, 12px)',
                                        fontWeight: 600,
                                        color: 'var(--text-secondary, #94A3B8)',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                        margin: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}>
                                        <FontAwesomeIcon icon={faBookmark} style={{ color: 'var(--accent-blue, #60a5fa)' }} />
                                        Browser Bookmarks ({filteredBookmarks.length})
                                    </h3>
                                    <button
                                        onClick={() => setShowBookmarks(!showBookmarks)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: 'var(--text-secondary, #94A3B8)',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            padding: '4px 8px',
                                            borderRadius: '6px',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'var(--interactive-hover)';
                                            e.currentTarget.style.color = 'var(--text)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'none';
                                            e.currentTarget.style.color = 'var(--text-secondary)';
                                        }}
                                    >
                                        {showBookmarks ? 'Hide' : 'Show'}
                                    </button>
                                </div>

                                {showBookmarks && (
                                    <>
                                        {/* Search Box */}
                                        <div style={{
                                            position: 'relative',
                                            marginBottom: '16px'
                                        }}>
                                            <FontAwesomeIcon
                                                icon={faSearch}
                                                style={{
                                                    position: 'absolute',
                                                    left: '12px',
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    color: 'var(--text-muted)',
                                                    fontSize: '12px',
                                                    pointerEvents: 'none'
                                                }}
                                            />
                                            <input
                                                type="text"
                                                value={bookmarkSearch}
                                                onChange={(e) => setBookmarkSearch(e.target.value)}
                                                placeholder="Search bookmarks..."
                                                style={{
                                                    width: '100%',
                                                    padding: '10px 12px 10px 36px',
                                                    borderRadius: '10px',
                                                    background: 'var(--glass-bg)',
                                                    border: '1px solid var(--border-primary)',
                                                    color: 'var(--text)',
                                                    fontSize: '13px',
                                                    outline: 'none',
                                                    transition: 'all 0.2s ease',
                                                    fontFamily: 'inherit'
                                                }}
                                                onFocus={(e) => {
                                                    e.target.style.borderColor = 'var(--accent-blue)';
                                                    e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                                                }}
                                                onBlur={(e) => {
                                                    e.target.style.borderColor = 'var(--border-primary)';
                                                    e.target.style.background = 'var(--glass-bg)';
                                                }}
                                            />
                                        </div>

                                        {/* Bookmarks List */}
                                        <div style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '4px',
                                            maxHeight: '400px',
                                            overflowY: 'auto'
                                        }}>
                                            {filteredBookmarks.slice(0, bookmarkLimit).map((bookmark) => {
                                                let hostname = '';
                                                try {
                                                    hostname = new URL(bookmark.url).hostname;
                                                } catch (e) {
                                                    hostname = bookmark.url;
                                                }

                                                const isHovered = hoveredBookmark === bookmark.id;
                                                const isPopoverOpen = popoverState.id === bookmark.id;

                                                return (
                                                    <div
                                                        key={bookmark.id}
                                                        style={{ position: 'relative' }}
                                                        onMouseEnter={() => setHoveredBookmark(bookmark.id)}
                                                        onMouseLeave={() => {
                                                            setHoveredBookmark(null);
                                                            if (isPopoverOpen) {
                                                                // Optional: Keep open logic
                                                            }
                                                        }}
                                                    >
                                                        <div
                                                            onClick={() => handleBookmarkClick(bookmark.url)}
                                                            role="button"
                                                            tabIndex={0}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' || e.key === ' ') {
                                                                    handleBookmarkClick(bookmark.url);
                                                                }
                                                            }}
                                                            style={{
                                                                padding: '12px',
                                                                borderRadius: '10px',
                                                                background: 'var(--glass-bg)',
                                                                border: '1px solid var(--border-primary)',
                                                                color: 'var(--text)',
                                                                cursor: 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '12px',
                                                                textAlign: 'left',
                                                                transition: 'all 0.2s ease',
                                                                width: '100%',
                                                                position: 'relative'
                                                            }}
                                                            onMouseEnter={(e) => {
                                                                e.currentTarget.style.background = 'var(--hover-bg-accent, rgba(59, 130, 246, 0.1))';
                                                                e.currentTarget.style.borderColor = 'var(--accent-color, rgba(59, 130, 246, 0.4))';
                                                                e.currentTarget.style.transform = 'translateX(4px)';
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                e.currentTarget.style.background = 'var(--glass-bg)';
                                                                e.currentTarget.style.borderColor = 'var(--border-primary)';
                                                                e.currentTarget.style.transform = 'translateX(0)';
                                                            }}
                                                        >
                                                            <div style={{
                                                                width: '32px',
                                                                height: '32px',
                                                                borderRadius: '8px',
                                                                background: 'var(--accent-blue-soft)',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                flexShrink: 0
                                                            }}>
                                                                <FontAwesomeIcon
                                                                    icon={faBookmark}
                                                                    style={{
                                                                        color: 'var(--accent-blue)',
                                                                        fontSize: '14px'
                                                                    }}
                                                                />
                                                            </div>
                                                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                                                <div style={{
                                                                    fontSize: '13px',
                                                                    fontWeight: 500,
                                                                    color: 'var(--text)',
                                                                    whiteSpace: 'nowrap',
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis',
                                                                    marginBottom: '2px'
                                                                }}>
                                                                    {bookmark.title}
                                                                </div>
                                                                <div style={{
                                                                    fontSize: '11px',
                                                                    color: 'var(--text-muted)',
                                                                    whiteSpace: 'nowrap',
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis'
                                                                }}>
                                                                    {hostname}
                                                                </div>
                                                            </div>

                                                            {/* Analytics Button - Visible on Hover or when Popover is Open */}
                                                            <div
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                                    setPopoverState(prev => prev.id === bookmark.id ? { id: null, rect: null } : { id: bookmark.id, rect });
                                                                }}
                                                                style={{
                                                                    padding: '6px',
                                                                    borderRadius: '6px',
                                                                    color: isPopoverOpen ? '#60A5FA' : 'var(--text-muted)',
                                                                    background: isPopoverOpen ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                                                                    opacity: (isHovered || isPopoverOpen) ? 1 : 0,
                                                                    pointerEvents: (isHovered || isPopoverOpen) ? 'auto' : 'none',
                                                                    transition: 'all 0.2s',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center'
                                                                }}
                                                                title="View Analytics"
                                                            >
                                                                <FontAwesomeIcon icon={faChartLine} style={{ fontSize: '12px' }} />
                                                            </div>
                                                        </div>

                                                        {/* Popover */}
                                                        {isPopoverOpen && (
                                                            <UrlAnalyticsPopover
                                                                url={bookmark.url}
                                                                title={bookmark.title}
                                                                onClose={() => setPopoverState({ id: null, rect: null })}
                                                                triggerRect={popoverState.rect}
                                                            />
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            {filteredBookmarks.length === 0 && (
                                                <div style={{
                                                    padding: '24px',
                                                    textAlign: 'center',
                                                    color: 'var(--text-tertiary, #64748b)',
                                                    fontSize: '13px'
                                                }}>
                                                    No bookmarks found
                                                </div>
                                            )}
                                            {filteredBookmarks.length > bookmarkLimit && (
                                                <button
                                                    onClick={() => setBookmarkLimit(prev => prev + 20)}
                                                    style={{
                                                        width: '100%',
                                                        padding: '12px',
                                                        borderRadius: '10px',
                                                        background: 'rgba(59, 130, 246, 0.1)',
                                                        border: '1px solid rgba(59, 130, 246, 0.3)',
                                                        color: '#60a5fa',
                                                        fontSize: '13px',
                                                        fontWeight: 500,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s ease',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '4px',
                                                        marginBottom: '10px'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                                                        e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
                                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                                                        e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                                                        e.currentTarget.style.transform = 'translateY(0)';
                                                    }}
                                                >
                                                    Show More Bookmarks ({filteredBookmarks.length - bookmarkLimit} remaining)
                                                </button>
                                            )}
                                        </div>
                                    </>
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
