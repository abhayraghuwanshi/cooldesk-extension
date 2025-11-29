import { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import '../styles/WorkspacePillList.css';
import { getFaviconUrl, getUrlParts } from '../utils';
import { handleAddToBookmarksAction, handlePinAction, isUrlPinned } from '../utils/linkActionHandlers.js';
import { ContextMenu } from './common/ContextMenu.jsx';
import { upsertNote, listNotes, deleteNote } from '../db/index.js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faTimes } from '@fortawesome/free-solid-svg-icons';

export function WorkspacePillList({ items = [], onDelete, onAddToWorkspace, embedded = false }) {
    const [hoveredKey, setHoveredKey] = useState(null);
    const [contextMenu, setContextMenu] = useState({ show: false, position: { x: 0, y: 0 }, chip: null });
    const [pinnedState, setPinnedState] = useState(() => new Map());
    const [showAll, setShowAll] = useState(false);
    const [maxItemsPerRow, setMaxItemsPerRow] = useState(5);
    const [showNoteModal, setShowNoteModal] = useState(false);
    const [noteModalData, setNoteModalData] = useState({ url: '', title: '' });

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

    const handleAddNote = (url, title) => {
        setNoteModalData({ url, title });
        setShowNoteModal(true);
        closeContextMenu();
    };

    const handleSaveNote = async (noteText, reloadCallback) => {
        if (!noteText.trim()) return;

        try {
            const note = {
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                text: noteText.trim(),
                type: 'text',
                url: noteModalData.url,
                urlTitle: noteModalData.title,
                createdAt: Date.now()
            };

            await upsertNote(note);

            // Call reload callback to refresh notes list in modal
            if (reloadCallback) {
                await reloadCallback();
            }
        } catch (error) {
            console.error('[WorkspacePillList] Error saving URL note:', error);
        }
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
        <div style={{ width: '100%' }}>
            <div
                className="workspace-pill-scroll"
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '10px',
                    overflow: 'hidden',
                    paddingBottom: '4px',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    maxHeight: showAll ? 'none' : '120px'
                }}
            >
                {chips.slice(0, showAll ? chips.length : maxItemsPerRow * 2).map((chip) => (
                    <div
                        key={chip.key}
                        className="pinnedws-urlChip"
                        style={{
                            position: 'relative',
                            minWidth: '200px',
                            maxWidth: '280px',
                            flex: showAll ? '0 0 auto' : '0 0 auto',
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
                            style={{ borderRadius: 4, objectFit: 'cover' }}
                            onError={(e) => { e.currentTarget.src = '/logo.png'; }}
                        />
                        <span className="pinnedws-urlTitle" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            {chip.title}
                        </span>

                    </div>
                ))}
            </div>
            {chips.length > maxItemsPerRow * 2 && (
                <div style={{ width: '100%', marginTop: '8px' }}>
                    <button
                        onClick={() => setShowAll(!showAll)}
                        style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: '1px solid rgba(255,255,255,0.2)',
                            background: 'rgba(255,255,255,0.05)',
                            color: 'rgba(255,255,255,0.8)',
                            cursor: 'pointer',
                            fontSize: '12px',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.background = 'rgba(255,255,255,0.1)';
                            e.target.style.color = 'rgba(255,255,255,1)';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.background = 'rgba(255,255,255,0.05)';
                            e.target.style.color = 'rgba(255,255,255,0.8)';
                        }}
                    >
                        {showAll ? 'Show Less' : `Show More (${chips.length - maxItemsPerRow * 2} more)`}
                    </button>
                </div>
            )}
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
                        onAddNote={handleAddNote}
                        isPinned={pinnedState.get(contextMenu.chip.url) || false}
                        position={contextMenu.position}
                    />
                )}
                {showNoteModal && <NoteModal
                    url={noteModalData.url}
                    title={noteModalData.title}
                    onSave={handleSaveNote}
                    onClose={() => {
                        setShowNoteModal(false);
                        setNoteModalData({ url: '', title: '' });
                    }}
                />}
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
                    onAddNote={handleAddNote}
                    isPinned={pinnedState.get(contextMenu.chip.url) || false}
                    position={contextMenu.position}
                />
            )}
            {showNoteModal && <NoteModal
                url={noteModalData.url}
                title={noteModalData.title}
                onSave={handleSaveNote}
                onClose={() => {
                    setShowNoteModal(false);
                    setNoteModalData({ url: '', title: '' });
                }}
            />}
        </div>
    );
}

// Note Modal Component with existing notes display
function NoteModal({ url, title, onSave, onClose }) {
    const [noteText, setNoteText] = useState('');
    const [existingNotes, setExistingNotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const textareaRef = useRef(null);

    // Load existing notes for this URL
    useEffect(() => {
        const loadUrlNotes = async () => {
            try {
                setLoading(true);
                const result = await listNotes();
                const notesData = result?.data || result || [];
                const urlNotes = notesData.filter(note => note.url === url);
                setExistingNotes(urlNotes.sort((a, b) => b.createdAt - a.createdAt));
            } catch (error) {
                console.error('[NoteModal] Error loading notes:', error);
                setExistingNotes([]);
            } finally {
                setLoading(false);
            }
        };

        loadUrlNotes();
    }, [url]);

    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    const handleSubmit = async () => {
        if (noteText.trim()) {
            await onSave(noteText, async () => {
                // Reload notes after saving
                const result = await listNotes();
                const notesData = result?.data || result || [];
                const urlNotes = notesData.filter(note => note.url === url);
                setExistingNotes(urlNotes.sort((a, b) => b.createdAt - a.createdAt));
            });
            setNoteText('');
        }
    };

    const handleDeleteNote = async (noteId) => {
        try {
            await deleteNote(noteId);
            setExistingNotes(prev => prev.filter(n => n.id !== noteId));
        } catch (error) {
            console.error('[NoteModal] Error deleting note:', error);
        }
    };

    const formatTimeAgo = (timestamp) => {
        if (!timestamp) return '';
        const now = Date.now();
        const diffMs = now - timestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;

        const noteDate = new Date(timestamp);
        return noteDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return createPortal(
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 999999,
                padding: '20px'
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: 'var(--glass-bg, rgba(28, 28, 33, 0.95))',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '16px',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                    width: '100%',
                    maxWidth: '600px',
                    maxHeight: '80vh',
                    display: 'flex',
                    flexDirection: 'column',
                    animation: 'modalSlide 0.2s ease-out',
                    overflow: 'hidden'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    padding: '24px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px'
                    }}>
                        <div style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: 'rgba(255, 213, 10, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                        }}>
                            <img
                                src={getFaviconUrl(url)}
                                alt=""
                                width={18}
                                height={18}
                                style={{ borderRadius: 4 }}
                                onError={(e) => { e.target.style.display = 'none'; }}
                            />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{
                                fontSize: '16px',
                                fontWeight: '600',
                                color: '#ffffff',
                                margin: 0,
                                marginBottom: '4px'
                            }}>
                                URL Notes
                            </h3>
                            <div style={{
                                fontSize: '13px',
                                color: 'rgba(255, 255, 255, 0.6)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}>
                                {title || url}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '24px'
                }}>
                    {/* New Note Input */}
                    <div style={{ marginBottom: existingNotes.length > 0 ? '24px' : '0' }}>
                        <label style={{
                            display: 'block',
                            fontSize: '12px',
                            fontWeight: '600',
                            color: 'rgba(255, 255, 255, 0.7)',
                            marginBottom: '8px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                        }}>
                            New Note
                        </label>
                        <textarea
                            ref={textareaRef}
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            placeholder="Write your note here..."
                            autoFocus
                            style={{
                                width: '100%',
                                minHeight: '100px',
                                padding: '12px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '8px',
                                color: '#ffffff',
                                fontSize: '14px',
                                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                                resize: 'vertical',
                                outline: 'none'
                            }}
                            onKeyDown={(e) => {
                                // Stop all key events from propagating to prevent parent handlers
                                e.stopPropagation();

                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    handleSubmit();
                                }
                            }}
                            onKeyUp={(e) => {
                                // Also stop keyup propagation
                                e.stopPropagation();
                            }}
                            onKeyPress={(e) => {
                                // Stop keypress propagation
                                e.stopPropagation();
                            }}
                        />
                    </div>

                    {/* Existing Notes */}
                    {existingNotes.length > 0 && (
                        <div>
                            <label style={{
                                display: 'block',
                                fontSize: '12px',
                                fontWeight: '600',
                                color: 'rgba(255, 255, 255, 0.7)',
                                marginBottom: '12px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                            }}>
                                Previous Notes ({existingNotes.length})
                            </label>
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px'
                            }}>
                                {existingNotes.map(note => (
                                    <div
                                        key={note.id}
                                        style={{
                                            background: 'rgba(255, 255, 255, 0.03)',
                                            border: '1px solid rgba(255, 255, 255, 0.1)',
                                            borderRadius: '8px',
                                            padding: '12px',
                                            position: 'relative'
                                        }}
                                    >
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'flex-start',
                                            gap: '12px'
                                        }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    fontSize: '14px',
                                                    color: '#ffffff',
                                                    lineHeight: '1.5',
                                                    whiteSpace: 'pre-wrap',
                                                    wordBreak: 'break-word'
                                                }}>
                                                    {note.text}
                                                </div>
                                                <div style={{
                                                    fontSize: '11px',
                                                    color: 'rgba(255, 255, 255, 0.5)',
                                                    marginTop: '8px'
                                                }}>
                                                    {formatTimeAgo(note.createdAt)}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteNote(note.id)}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: 'rgba(255, 59, 48, 0.8)',
                                                    cursor: 'pointer',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    fontSize: '12px',
                                                    flexShrink: 0,
                                                    transition: 'all 0.2s ease'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.target.style.background = 'rgba(255, 59, 48, 0.2)';
                                                    e.target.style.color = '#FF3B30';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.target.style.background = 'transparent';
                                                    e.target.style.color = 'rgba(255, 59, 48, 0.8)';
                                                }}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {loading && (
                        <div style={{
                            textAlign: 'center',
                            padding: '20px',
                            color: 'rgba(255, 255, 255, 0.5)',
                            fontSize: '13px'
                        }}>
                            Loading notes...
                        </div>
                    )}

                    {!loading && existingNotes.length === 0 && !noteText && (
                        <div style={{
                            textAlign: 'center',
                            padding: '20px',
                            color: 'rgba(255, 255, 255, 0.4)',
                            fontSize: '13px',
                            fontStyle: 'italic'
                        }}>
                            No notes yet for this URL
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    gap: '8px',
                    justifyContent: 'flex-end'
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '10px 20px',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '8px',
                            color: '#ffffff',
                            fontSize: '14px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                        }}
                    >
                        Close
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!noteText.trim()}
                        style={{
                            padding: '10px 20px',
                            background: noteText.trim() ? '#FFD60A' : 'rgba(255, 214, 10, 0.3)',
                            border: 'none',
                            borderRadius: '8px',
                            color: noteText.trim() ? '#000000' : 'rgba(0, 0, 0, 0.4)',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: noteText.trim() ? 'pointer' : 'not-allowed',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                        onMouseEnter={(e) => {
                            if (noteText.trim()) {
                                e.target.style.background = '#FFDE3C';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (noteText.trim()) {
                                e.target.style.background = '#FFD60A';
                            }
                        }}
                    >
                        <FontAwesomeIcon icon={faCheck} />
                        Save Note
                    </button>
                </div>

                <style>{`
                    @keyframes modalSlide {
                        from {
                            opacity: 0;
                            transform: scale(0.95) translateY(-10px);
                        }
                        to {
                            opacity: 1;
                            transform: scale(1) translateY(0);
                        }
                    }
                `}</style>
            </div>
        </div>,
        document.body
    );
}

export default WorkspacePillList;
