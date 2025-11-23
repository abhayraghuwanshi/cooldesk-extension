import { useMemo } from 'react';
import { createSharedWorkspaceClient, createUseSharedWorkspaceHook } from '../services/sharedWorkspaceService.js';
import { getFaviconUrl } from '../utils';
import WorkspacePillList from './WorkspacePillList.jsx';

const useSharedWorkspace = createUseSharedWorkspaceHook(createSharedWorkspaceClient);

export function SharedWorkspace({ teamId, userId, wsUrl, title = 'Shared Workspace' }) {
    const { items } = useSharedWorkspace({ teamId, userId, wsUrl });

    const pillItems = useMemo(() => {
        if (!Array.isArray(items)) return [];
        return items.map((item) => ({
            url: item.url,
            title: item.title || item.url,
            favicon: getFaviconUrl(item.url, 16),
            lastVisitTime: item.added_at || item.addedAt || 0,
        }));
    }, [items]);

    return (
        <div className="coolDesk-section" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600, margin: 0, color: '#ffffff' }}>{title}</h3>
            </div>
            <WorkspacePillList items={pillItems} />
        </div>
    );
}

export default SharedWorkspace;
