import React from 'react';
import '../../styles/default/PinnedWorkspace.css';
import { getFaviconUrl } from '../../utils';

export function PinnedWorkspace({ items = [], active, onSelect, onUnpin, workspaces = [], onReorder }) {
    const [hovered, setHovered] = React.useState(null);
    const [dragOverName, setDragOverName] = React.useState(null);

    // Load hidden state from localStorage
    const [isHidden, setIsHidden] = React.useState(() => {
        try {
            const saved = localStorage.getItem('pinnedWorkspace_hidden');
            return saved === 'true';
        } catch {
            return false;
        }
    });

    // Persist hidden state to localStorage
    React.useEffect(() => {
        try {
            localStorage.setItem('pinnedWorkspace_hidden', String(isHidden));
        } catch { }
    }, [isHidden]);

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
            if (visible.length >= 1) break;
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
                    border: '1px dashed var(--border-primary)',
                    color: 'var(--text-secondary)',
                    background: 'var(--glass-bg)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease',
                    fontStyle: 'italic'
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--interactive-hover)';
                    e.currentTarget.style.borderColor = 'var(--border-accent)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--glass-bg)';
                    e.currentTarget.style.borderColor = 'var(--border-primary)';
                }}
                title="Double-click to show pinned workspaces again"
            >
                <span style={{ opacity: 0.8 }}>Hidden: Pinned Workspace</span>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6 }}>(double-click to show)</span>
            </div>
        );
    }

    return (
        <div className="coolDesk-section pinnedws-container">
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
                padding: '0 4px'
            }}>
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
                    Pinned Workspace
                </h3>
            </div>
            {/* Pills row */}
            <div
                className="coolDesk-pings-container pinnedws-pills"
                title={list.length > 1 ? "← Scroll to see all pinned workspaces →" : ""}
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
                    list.map((name, index) => (
                        <div
                            key={name}
                            className={`coolDesk-ping-item pinnedws-pill ${visibleWorkspaces.includes(name) ? 'pinnedws-pill--active' : ''} ${dragOverName === name ? 'pinnedws-pill--dragover' : ''}`}
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

                    // Deduplicate URLs by URL string (keep first occurrence)
                    const allUrls = Array.isArray(ws?.urls) ? ws.urls : [];
                    const seenUrls = new Set();
                    const uniqueUrls = allUrls.filter(u => {
                        if (!u?.url || seenUrls.has(u.url)) return false;
                        seenUrls.add(u.url);
                        return true;
                    });
                    const urls = uniqueUrls.slice(0, 12);

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
