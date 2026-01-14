import { useEffect, useMemo, useState } from 'react';
import { createSharedWorkspaceClient, createUseSharedWorkspaceHook } from '../services/sharedWorkspaceService.js';
import { getFaviconUrl } from '../utils';
import WorkspacePillList from './WorkspacePillList.jsx';

const useSharedWorkspace = createUseSharedWorkspaceHook(createSharedWorkspaceClient);

export function SharedWorkspace({ teamId, userId, wsUrl, title = 'Shared Workspace' }) {
    const { items } = useSharedWorkspace({ teamId, userId, wsUrl });
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try {
            const saved = localStorage.getItem('sharedWorkspace_collapsed');
            return saved === 'true';
        } catch {
            return false;
        }
    });

    const pillItems = useMemo(() => {
        if (!Array.isArray(items)) return [];
        return items.map((item) => ({
            url: item.url,
            title: item.title || item.url,
            favicon: getFaviconUrl(item.url, 16),
            lastVisitTime: item.added_at || item.addedAt || 0,
        }));
    }, [items]);

    // Persist collapsed state to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('sharedWorkspace_collapsed', String(isCollapsed));
        } catch (e) {
            console.warn('[SharedWorkspace] Failed to save collapsed state', e);
        }
    }, [isCollapsed]);

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
                    {title}
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
        <div className="coolDesk-section" style={{ marginTop: 12 }}>
            <div
                onClick={() => setIsCollapsed(true)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
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
                    {/* <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ color: '#34C759', fontSize: 'var(--font-size-xl)' }} /> */}
                    {title}
                </h3>
                <span style={{
                    fontSize: '0.75rem',
                    opacity: 0.4,
                    color: 'var(--text-secondary, #aaa)'
                }}>
                    Click to hide
                </span>
            </div>
            <WorkspacePillList items={pillItems} />
        </div>
    );
}

export default SharedWorkspace;
