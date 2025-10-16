import React from 'react';
import '../../styles/default/PinnedWorkspace.css';
import { getFaviconUrl } from '../../utils';

export function PinnedWorkspace({ items = [], active, onSelect, onUnpin, workspaces = [], onReorder }) {
    const [hovered, setHovered] = React.useState(null);
    const [dragOverName, setDragOverName] = React.useState(null);
    const [isHidden, setIsHidden] = React.useState(false);

    const list = Array.isArray(items) ? items.slice(0, 24) : [];

    // Determine which workspaces to show visually (max 2)
    // Priority: active workspace first, then first 2 from the list
    const getVisibleWorkspaces = React.useCallback(() => {
        if (list.length === 0) return [];

        const visible = [];

        // Always show active workspace first if it exists
        if (active && list.includes(active)) {
            visible.push(active);
        }

        // Fill remaining slots with first items from list (up to 2 total)
        for (const name of list) {
            if (visible.length >= 2) break;
            if (!visible.includes(name)) {
                visible.push(name);
            }
        }

        return visible;
    }, [list, active]);

    const visibleWorkspaces = getVisibleWorkspaces();

    const openInSameTab = React.useCallback((url) => {
        if (!url) return;
        try {
            // Prefer Chrome API if available
            if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
                chrome.tabs.update({ url });
                return;
            }
        } catch { }
        try { window.location.href = url; } catch { }
    }, []);

    if (isHidden) {
        return (
            <div
                className="coolDesk-section"
                onDoubleClick={() => setIsHidden(false)}
                style={{
                    marginTop: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px dashed var(--border-primary, rgba(255,255,255,0.15))',
                    color: 'var(--text-secondary, rgba(255,255,255,0.7))',
                    background: 'var(--surface-1, rgba(255,255,255,0.03))',
                    cursor: 'pointer',
                    userSelect: 'none'
                }}
                title="Double-click to show pinned workspaces again"
            >
                Hidden: Pinned Workspace (double-click to show)
            </div>
        );
    }

    return (
        <div className="coolDesk-section pinnedws-container">
            <h2
                className="coolDesk-section-title"
                title={list.length > 2 ? "Scroll through the pills to see all pinned workspaces" : "Pin workspaces by right-clicking them"}
                style={{ cursor: 'help' }}
                onDoubleClick={() => setIsHidden(true)}
                data-double-click-hint="Double-click to hide pinned workspaces"
            >
                Pinned Workspace
                {list.length > 2 && (
                    <span style={{
                        marginLeft: 8,
                        fontSize: 'var(--font-size-xs)',
                        color: 'rgba(255,255,255,0.6)',
                        fontWeight: 400
                    }}>
                        (showing {visibleWorkspaces.length} of {list.length})
                    </span>
                )}
            </h2>
            {/* Pills row */}
            <div
                className="coolDesk-pings-container pinnedws-pills"
                title={list.length > 2 ? "← Scroll to see all pinned workspaces →" : ""}
                onDragOver={(e) => {
                    // Allow dropping between chips
                    e.preventDefault();
                }}
            >
                {list.length === 0 ? (
                    <div style={{ color: 'rgba(255,255,255,0.6)', fontStyle: 'italic', padding: '6px 0' }}>
                        Right-click a workspace to pin it here
                    </div>
                ) : (
                    list.map((name) => (
                        <div
                            key={name}
                            className={`coolDesk-ping-item pinnedws-pill ${name === active ? 'pinnedws-pill--active' : ''} ${dragOverName === name ? 'pinnedws-pill--dragover' : ''}`}
                            onClick={() => onSelect && onSelect(name)}
                            onMouseEnter={() => setHovered(name)}
                            onMouseLeave={() => setHovered(null)}
                            title={name}
                            draggable
                            onDragStart={(e) => {
                                try {
                                    e.dataTransfer.setData('text/plain', name);
                                    e.dataTransfer.effectAllowed = 'move';
                                } catch { }
                            }}
                            onDragEnter={(e) => {
                                e.preventDefault();
                                setDragOverName(name);
                            }}
                            onDragLeave={() => {
                                setDragOverName((curr) => (curr === name ? null : curr));
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                const fromName = e.dataTransfer.getData('text/plain');
                                setDragOverName(null);
                                if (!fromName || fromName === name) return;
                                const fromIdx = list.indexOf(fromName);
                                const toIdx = list.indexOf(name);
                                if (fromIdx === -1 || toIdx === -1) return;
                                const newOrder = [...list];
                                newOrder.splice(fromIdx, 1);
                                newOrder.splice(toIdx, 0, fromName);
                                if (typeof onReorder === 'function') {
                                    onReorder(newOrder);
                                }
                            }}
                        >
                            <span className="pinnedws-pill-title">
                                {name}
                            </span>
                            {hovered === name && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onUnpin && onUnpin(name);
                                    }}
                                    style={{
                                        position: 'absolute',
                                        top: '-4px',
                                        right: '-4px',
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        background: '#FF3B30',
                                        color: 'white',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        fontSize: 'calc(var(--font-size-xs) * 0.65)',
                                        fontWeight: 'bold'
                                    }}
                                    title="Unpin"
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Items lists per pinned workspace (max 2 visible) */}
            <div className="pinnedws-itemsGrid">
                {visibleWorkspaces.map((name) => {
                    const ws = Array.isArray(workspaces) ? workspaces.find(w => (w?.name || '').trim().toLowerCase() === String(name).trim().toLowerCase()) : null;
                    const urls = Array.isArray(ws?.urls) ? ws.urls.slice(0, 12) : [];
                    return (
                        <div key={`list-${name}`} className="pinnedws-listCard">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{name}</div>
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>• {urls.length} item{urls.length === 1 ? '' : 's'}</div>
                            </div>
                            {urls.length === 0 ? (
                                <div style={{ color: 'rgba(255,255,255,0.7)', fontStyle: 'italic', fontSize: 12 }}>No items yet</div>
                            ) : (
                                <div className="pinnedws-urlChips">
                                    {urls.map((u, idx) => (
                                        <div key={`${name}-${idx}`} className="pinnedws-urlChip"
                                            title={u.title || u.url}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openInSameTab(u.url);
                                            }}
                                        >
                                            <img
                                                src={(u.favicon && /^https?:\/\//i.test(u.favicon)) ? u.favicon : (getFaviconUrl(u.url, 16) || '/logo.png')}
                                                alt=""
                                                width={16}
                                                height={16}
                                                style={{ borderRadius: 4, objectFit: 'cover', boxShadow: '0 1px 2px rgba(0,0,0,0.25)' }}
                                                onError={(e) => { e.currentTarget.src = '/logo.png'; }}
                                            />
                                            <span className="pinnedws-urlTitle">
                                                {u.title || (() => { try { return new URL(u.url).hostname; } catch { return u.url; } })()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
