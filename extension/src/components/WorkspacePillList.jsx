import { useEffect, useMemo, useState } from 'react';
import '../styles/WorkspacePillList.css';
import { getFaviconUrl, getUrlParts } from '../utils';
import { handleAddToBookmarksAction, handlePinAction, isUrlPinned } from '../utils/linkActionHandlers.js';
import { ContextMenu } from './common/ContextMenu.jsx';

export function WorkspacePillList({ items = [], onDelete, onAddToWorkspace, embedded = false }) {
    const [hoveredKey, setHoveredKey] = useState(null);
    const [contextMenu, setContextMenu] = useState({ show: false, position: { x: 0, y: 0 }, chip: null });
    const [pinnedState, setPinnedState] = useState(() => new Map());

    const chips = useMemo(() => {
        const groups = new Map();

        items
            .filter((item) => item && typeof item.url === 'string' && item.url.length > 0)
            .forEach((item) => {
                const parts = getUrlParts(item.url);
                const key = (parts && parts.key) ? parts.key : item.url;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(item);
            });

        return Array.from(groups.entries()).map(([key, values]) => {
            const sorted = values
                .slice()
                .sort((a, b) => {
                    const aTime = (typeof a?.lastVisitTime === 'number' ? a.lastVisitTime : 0) || (typeof a?.dateAdded === 'number' ? a.dateAdded : 0);
                    const bTime = (typeof b?.lastVisitTime === 'number' ? b.lastVisitTime : 0) || (typeof b?.dateAdded === 'number' ? b.dateAdded : 0);
                    return bTime - aTime;
                });

            const primary = sorted[0];
            let title = primary?.title || primary?.name || '';
            if (!title) {
                try { title = new URL(primary.url).hostname; } catch { title = primary.url; }
            }

            return {
                key,
                title,
                url: primary?.url,
                favicon: primary?.favicon || getFaviconUrl(primary?.url, 16),
                values: sorted,
                isPinned: Boolean(pinnedState.get(primary?.url))
            };
        });
    }, [items, pinnedState]);

    useEffect(() => {
        let cancelled = false;
        const uniqueUrls = Array.from(new Set(
            items
                .filter(item => item && typeof item.url === 'string' && item.url.length > 0)
                .map(item => item.url)
        ));

        (async () => {
            const updates = new Map();
            for (const url of uniqueUrls) {
                try {
                    updates.set(url, await isUrlPinned(url));
                } catch {
                    updates.set(url, false);
                }
            }
            if (cancelled) return;
            setPinnedState((prev) => {
                const next = new Map(prev);
                updates.forEach((value, url) => next.set(url, value));
                return next;
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [items]);

    const openInSameTab = (url) => {
        if (!url) return;
        try {
            if (typeof chrome !== 'undefined' && chrome?.tabs?.update) {
                chrome.tabs.update({ url });
                return;
            }
        } catch { /* ignore */ }
        try { window.location.href = url; } catch { /* ignore */ }
    };

    const closeContextMenu = () => setContextMenu((prev) => ({ ...prev, show: false }));

    const openContextMenu = (event, chip) => {
        if (!chip) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const x = typeof event.clientX === 'number' ? event.clientX : rect.left + rect.width / 2;
        const y = typeof event.clientY === 'number' ? event.clientY : rect.bottom;
        setContextMenu({ show: true, position: { x, y }, chip });
    };

    const handleDeleteChip = async () => {
        if (typeof onDelete === 'function' && contextMenu.chip) {
            await onDelete(contextMenu.chip.key, contextMenu.chip.values);
        }
    };

    const handlePinChip = async (url, title) => {
        if (!url) return;
        await handlePinAction(
            url,
            title,
            ({ action }) => {
                setPinnedState((prev) => {
                    const next = new Map(prev);
                    if (action === 'pinned') next.set(url, true);
                    if (action === 'unpinned') next.set(url, false);
                    return next;
                });
            },
            (error) => console.error('[WorkspacePillList] Pin action failed', error)
        );
    };

    const handleAddToBookmarksChip = async (url, title) => {
        if (!url) return;
        await handleAddToBookmarksAction(
            url,
            title,
            null,
            (error) => console.error('[WorkspacePillList] Add to bookmarks failed', error)
        );
    };

    if (!chips.length) {
        if (embedded) {
            return null;
        }

        return (
            <div
                className="coolDesk-section"
                style={{
                    padding: '16px',
                    borderRadius: '12px',
                    border: '1px dashed rgba(255,255,255,0.15)',
                    color: 'rgba(255,255,255,0.65)',
                    fontStyle: 'italic'
                }}
            >
                No items saved yet
            </div>
        );
    }

    const pills = (
        <div
            className="workspace-pill-scroll"
            style={{
                display: 'flex',
                gap: '10px',
                overflowX: 'auto',
                paddingBottom: '4px',
                scrollbarWidth: 'thin'
            }}
        >
            {chips.map((chip) => (
                <div
                    key={chip.key}
                    className="pinnedws-urlChip"
                    style={{
                        position: 'relative',
                        minWidth: '200px',
                        maxWidth: '280px',
                        flex: '0 0 auto',
                        cursor: 'pointer'
                    }}
                    onClick={(e) => {
                        if (e.detail && e.detail > 1) return;
                        openInSameTab(chip.url);
                    }}
                    onMouseEnter={() => setHoveredKey(chip.key)}
                    onMouseLeave={() => setHoveredKey((curr) => (curr === chip.key ? null : curr))}
                    onDoubleClick={(e) => openContextMenu(e, chip)}
                    onContextMenu={(e) => openContextMenu(e, chip)}
                    title={chip.title}
                >
                    <img
                        src={chip.favicon || '/logo.png'}
                        alt=""
                        width={18}
                        height={18}
                        style={{ borderRadius: 4, objectFit: 'cover', boxShadow: '0 1px 2px rgba(0,0,0,0.25)' }}
                        onError={(e) => { e.currentTarget.src = '/logo.png'; }}
                    />
                    <span className="pinnedws-urlTitle" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {chip.title}
                    </span>

                </div>
            ))}
        </div>
    );

    if (embedded) {
        return (
            <>
                {pills}
                {contextMenu.show && contextMenu.chip && (
                    <ContextMenu
                        show={contextMenu.show}
                        onClose={closeContextMenu}
                        url={contextMenu.chip.url}
                        title={contextMenu.chip.title}
                        onPin={handlePinChip}
                        onDelete={handleDeleteChip}
                        onOpen={() => openInSameTab(contextMenu.chip.url)}
                        onAddToBookmarks={() => handleAddToBookmarksChip(contextMenu.chip.url, contextMenu.chip.title)}
                        onAddToWorkspace={onAddToWorkspace ? (workspace) => onAddToWorkspace(contextMenu.chip.url, workspace.name) : undefined}
                        isPinned={pinnedState.get(contextMenu.chip.url) || false}
                        position={contextMenu.position}
                    />
                )}
            </>
        );
    }

    return (
        <div className="coolDesk-section" style={{ padding: '16px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(28,28,33,0.45)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
            {pills}
            {contextMenu.show && contextMenu.chip && (
                <ContextMenu
                    show={contextMenu.show}
                    onClose={closeContextMenu}
                    url={contextMenu.chip.url}
                    title={contextMenu.chip.title}
                    onPin={handlePinChip}
                    onDelete={handleDeleteChip}
                    onOpen={() => openInSameTab(contextMenu.chip.url)}
                    onAddToBookmarks={() => handleAddToBookmarksChip(contextMenu.chip.url, contextMenu.chip.title)}
                    onAddToWorkspace={onAddToWorkspace ? (workspace) => onAddToWorkspace(contextMenu.chip.url, workspace.name) : undefined}
                    isPinned={pinnedState.get(contextMenu.chip.url) || false}
                    position={contextMenu.position}
                />
            )}
        </div>
    );
}

export default WorkspacePillList;
