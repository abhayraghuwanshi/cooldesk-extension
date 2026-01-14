import { faBookmark, faChartLine, faList, faSearch, faThLarge } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import '../../styles/cooldesk.css';
import { WorkspaceCard } from './WorkspaceCard';

export function WorkspaceList({
    savedWorkspaces = [],
    onWorkspaceClick,
    activeWorkspaceId,
    expandedWorkspaceId,
    pinnedWorkspaces = [], // New prop
    onTogglePin            // New prop
}) {
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
    const [bookmarks, setBookmarks] = useState([]);
    const [bookmarkSearch, setBookmarkSearch] = useState('');
    const [showBookmarks, setShowBookmarks] = useState(true);
    const [workspaceLimit, setWorkspaceLimit] = useState(6); // Show 6 workspaces initially
    const [popoverState, setPopoverState] = useState({ id: null, rect: null });
    const [hoveredBookmark, setHoveredBookmark] = useState(null);
    const [bookmarkLimit, setBookmarkLimit] = useState(20);

    // Separate pinned and unpinned workspaces
    const pinned = savedWorkspaces.filter(ws => pinnedWorkspaces.includes(ws.name));
    const unpinned = savedWorkspaces.filter(ws => !pinnedWorkspaces.includes(ws.name));

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

                <div className="view-toggle">
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
                                        gap: '8px'
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
                                        gap: '8px'
                                    }}
                                >
                                    {unpinned.slice(0, workspaceLimit).map((workspace) => (
                                        <WorkspaceCard
                                            key={workspace.id}
                                            workspace={workspace}
                                            onClick={onWorkspaceClick}
                                            isExpanded={expandedWorkspaceId === workspace.id}
                                            isActive={activeWorkspaceId === workspace.id}
                                            compact={viewMode === 'list'}
                                            isPinned={false}
                                            onPin={() => onTogglePin && onTogglePin(workspace.name)}
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
                                            gap: '8px'
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
                                            gap: '8px',
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
                                                        gap: '8px',
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
        </div>
    );
}
