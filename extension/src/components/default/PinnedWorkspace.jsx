import React from 'react';
import { getFaviconUrl } from '../../utils';

export function PinnedWorkspace({ items = [], active, onSelect, onUnpin, workspaces = [], onReorder }) {
    const [hovered, setHovered] = React.useState(null);
    const [dragOverName, setDragOverName] = React.useState(null);

    const list = Array.isArray(items) ? items.slice(0, 24) : [];

    const openInSameTab = React.useCallback((url) => {
        if (!url) return;
        try {
            // Prefer Chrome API if available
            if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
                chrome.tabs.update({ url });
                return;
            }
        } catch {}
        try { window.location.href = url; } catch {}
    }, []);

    return (
        <div className="coolDesk-section">
            <h2 className="coolDesk-section-title">Fancy pins</h2>
            {/* Pills row */}
            <div
                className="coolDesk-pings-container"
                style={{ display: 'flex', flexDirection: 'row', overflowX: 'auto', whiteSpace: 'nowrap', width: '100%', maxWidth: '100%', marginBottom: 8 }}
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
                            className="coolDesk-ping-item"
                            style={{
                                marginRight: '10px',
                                position: 'relative',
                                cursor: 'pointer',
                                padding: '6px 10px',
                                borderRadius: '12px',
                                transition: 'background-color 0.2s, border-color 0.2s, box-shadow 0.2s',
                                background: name === active ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)',
                                border: name === active ? '1px solid rgba(255,255,255,0.28)' : '1px solid rgba(255,255,255,0.14)',
                                color: '#fff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 8,
                                backdropFilter: 'blur(10px)',
                                WebkitBackdropFilter: 'blur(10px)',
                                boxShadow: (
                                    name === active
                                        ? '0 6px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)'
                                        : (dragOverName === name
                                            ? '0 0 0 2px rgba(255,255,255,0.35), 0 4px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)'
                                            : '0 4px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)')
                                )
                            }}
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
                            <span style={{ fontSize: 13, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

            {/* Items lists per pinned workspace */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                {list.map((name) => {
                    const ws = Array.isArray(workspaces) ? workspaces.find(w => (w?.name || '').trim().toLowerCase() === String(name).trim().toLowerCase()) : null;
                    const urls = Array.isArray(ws?.urls) ? ws.urls.slice(0, 12) : [];
                    return (
                        <div key={`list-${name}`} style={{
                            background: 'rgba(28, 28, 33, 0.50)',
                            border: '1px solid rgba(255,255,255,0.14)',
                            borderRadius: 14,
                            padding: 10,
                            backdropFilter: 'blur(14px)',
                            WebkitBackdropFilter: 'blur(14px)',
                            boxShadow: '0 12px 30px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{name}</div>
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>• {urls.length} item{urls.length === 1 ? '' : 's'}</div>
                            </div>
                            {urls.length === 0 ? (
                                <div style={{ color: 'rgba(255,255,255,0.7)', fontStyle: 'italic', fontSize: 12 }}>No items yet</div>
                            ) : (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {urls.map((u, idx) => (
                                        <div key={`${name}-${idx}`} style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            padding: '6px 8px', borderRadius: 10,
                                            background: 'rgba(255,255,255,0.10)',
                                            border: '1px solid rgba(255,255,255,0.16)',
                                            backdropFilter: 'blur(8px)',
                                            WebkitBackdropFilter: 'blur(8px)',
                                            boxShadow: '0 6px 18px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)',
                                            cursor: 'pointer'
                                        }}
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
                                            <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: '#fff' }}>
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
