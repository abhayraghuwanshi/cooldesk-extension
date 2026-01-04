import { faList, faSearch, faThLarge } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useMemo, useState } from 'react';
import '../../styles/cooldesk.css';
import { WorkspaceCard } from './WorkspaceCard';

export function WorkspaceList({
    savedWorkspaces = [],
    onWorkspaceClick,
    activeWorkspaceId,
    expandedWorkspaceId
}) {
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'

    const filteredWorkspaces = useMemo(() => {
        if (!searchQuery.trim()) return savedWorkspaces;

        const query = searchQuery.toLowerCase();
        return savedWorkspaces.filter(workspace =>
            workspace.name.toLowerCase().includes(query) ||
            (workspace.description && workspace.description.toLowerCase().includes(query))
        );
    }, [savedWorkspaces, searchQuery]);

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

                {/* Search Bar */}
                <div className="cooldesk-search-box" style={{
                    padding: '10px 16px',
                    borderRadius: '12px',
                    background: 'var(--glass-bg, rgba(30, 41, 59, 0.4))',
                    border: '1px solid rgba(148, 163, 184, 0.1)',
                    flexShrink: 0
                }}>
                    <FontAwesomeIcon icon={faSearch} style={{ color: '#64748B' }} />
                    <input
                        type="text"
                        className="cooldesk-search-input"
                        placeholder="Search workspaces..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                {/* Local Workspace List */}
                {filteredWorkspaces.length > 0 ? (
                    <div
                        className={viewMode === 'list' ? 'cooldesk-list-view' : ''}
                        style={viewMode === 'grid' ? {
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                            gap: '16px',
                            paddingBottom: '24px' // Bottom padding for scroll
                        } : {
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            paddingBottom: '24px'
                        }}
                    >
                        {filteredWorkspaces.map((workspace) => (
                            <WorkspaceCard
                                key={workspace.id}
                                workspace={workspace}
                                onClick={onWorkspaceClick}
                                isExpanded={expandedWorkspaceId === workspace.id}
                                isActive={activeWorkspaceId === workspace.id}
                                compact={viewMode === 'list'}
                            />
                        ))}
                    </div>
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
                        <div style={{ fontSize: '40px', opacity: 0.3 }}>🔍</div>
                        <div>
                            <div style={{
                                fontSize: 'var(--font-lg, 14px)',
                                fontWeight: 500,
                                marginBottom: '4px'
                            }}>
                                No Workspaces Found
                            </div>
                            <div style={{ fontSize: 'var(--font-sm, 12px)' }}>
                                {searchQuery ? `No results for "${searchQuery}"` : 'Create your first workspace to get started!'}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
