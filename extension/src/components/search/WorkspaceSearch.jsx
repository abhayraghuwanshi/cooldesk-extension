import React, { useEffect, useState } from 'react';
import { listWorkspaces } from '../../db/index.js';

export function WorkspaceSearch({ query, onWorkspaceClick, isVisible = true }) {
    const [workspaces, setWorkspaces] = useState([]);
    const [loading, setLoading] = useState(false);
    const [matches, setMatches] = useState([]);

    // Load workspaces on mount
    useEffect(() => {
        if (!isVisible) return;

        const loadWorkspaces = async () => {
            setLoading(true);
            try {
                const result = await listWorkspaces();
                const workspaceData = Array.isArray(result) ? result : [];
                setWorkspaces(workspaceData);
            } catch (error) {
                console.error('[WorkspaceSearch] Failed to load workspaces:', error);
                setWorkspaces([]);
            } finally {
                setLoading(false);
            }
        };

        loadWorkspaces();
    }, [isVisible]);

    // Filter workspaces based on query
    useEffect(() => {
        if (!query || !query.trim()) {
            setMatches([]);
            return;
        }

        const q = query.toLowerCase().trim();
        const filtered = workspaces.filter(workspace => {
            if (!workspace) return false;

            // Search in workspace name
            const nameMatch = (workspace.name || '').toLowerCase().includes(q);

            // Search in workspace description
            const descMatch = (workspace.description || '').toLowerCase().includes(q);

            // Search in workspace URLs
            const urlMatch = (workspace.urls || []).some(url =>
                (url || '').toLowerCase().includes(q)
            );

            // Search in workspace items (if they have titles)
            const itemMatch = (workspace.items || []).some(item =>
                (item.title || '').toLowerCase().includes(q) ||
                (item.url || '').toLowerCase().includes(q)
            );

            return nameMatch || descMatch || urlMatch || itemMatch;
        });

        setMatches(filtered.slice(0, 8)); // Limit to 8 results
    }, [query, workspaces]);

    if (!isVisible || loading) {
        return null;
    }

    if (matches.length === 0) {
        return null;
    }

    return (
        <div style={{
            padding: '0 20px',
            borderTop: '1px solid var(--border-primary)'
        }}>
            <div style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                padding: '16px 0 12px 0',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '1px'
            }}>
                Workspaces ({matches.length})
            </div>

            {matches.map((workspace, i) => (
                <div
                    key={`workspace-${workspace.id || workspace.name}-${i}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onWorkspaceClick?.(workspace)}
                    style={{
                        padding: '12px',
                        cursor: 'pointer',
                        color: 'var(--text-secondary)',
                        borderRadius: '8px',
                        marginBottom: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        transition: 'all 0.2s ease',
                        background: 'transparent',
                        border: '1px solid var(--border-secondary)',
                        borderLeft: '3px solid var(--accent-primary)'
                    }}
                    title={`Open workspace: ${workspace.name}`}
                    onMouseEnter={(e) => {
                        e.target.style.background = 'var(--interactive-hover)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.background = 'transparent';
                    }}
                >
                    <div style={{
                        width: '24px',
                        height: '24px',
                        background: 'var(--accent-primary)',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        color: 'white',
                        fontWeight: '600',
                        flexShrink: 0
                    }}>
                        {workspace.gridType === 'ProjectGrid' ? '📂' : '🔗'}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: '14px',
                            fontWeight: '500',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            {workspace.name}
                            <span style={{
                                fontSize: '10px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                background: 'rgba(52, 199, 89, 0.2)',
                                color: 'var(--accent-primary)'
                            }}>
                                {workspace.gridType === 'ProjectGrid' ? 'PROJECT' : 'WORKSPACE'}
                            </span>
                        </div>

                        <div style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                            marginTop: '2px'
                        }}>
                            {workspace.description ||
                             `${(workspace.urls || []).length + (workspace.items || []).length} items`}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export default WorkspaceSearch;