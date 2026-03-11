import { faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { deleteNote, listNotes } from '../../../db/index.js';
import '../../../styles/theme.css';
import { NotesWidget } from '../../cooldesk/NotesWidget'; // Reuse input logic if possible or rebuild

/**
 * SidebarNotes - Quick list of notes for fast access
 */
export function SidebarNotes() {
    const [notes, setNotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);

    const loadNotes = async () => {
        setLoading(true);
        try {
            const res = await listNotes();

            // Handle both array and object response formats
            let notesData = [];
            if (Array.isArray(res)) {
                notesData = res;
            } else if (res && Array.isArray(res.data)) {
                notesData = res.data;
            } else if (res?.success && Array.isArray(res.data)) {
                notesData = res.data;
            }

            if (notesData.length > 0) {
                // Sort by updated at desc
                setNotes(notesData.sort((a, b) => b.updatedAt - a.updatedAt));
            } else {
                setNotes([]);
            }
        } catch (e) {
            console.error('[SidebarNotes] Error loading notes:', e);
            setNotes([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadNotes();
    }, [showAdd]); // Reload when add mode closes

    const handleDelete = async (e, id) => {
        e.stopPropagation();
        if (confirm('Delete this note?')) {
            await deleteNote(id);
            loadNotes();
        }
    };

    if (showAdd) {
        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', paddingTop: '16px' }}>
                <div style={{ padding: '0 16px', marginBottom: '8px' }}>
                    <button
                        onClick={() => setShowAdd(false)}
                        className="btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 'var(--font-sm)' }}
                    >
                        ← Back to list
                    </button>
                </div>
                <div style={{ flex: 1, padding: '0 16px' }}>
                    {/* Reuse the existing widget logic but style it simply */}
                    <NotesWidget maxNotes={0} compact={false} />
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px' }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '16px'
            }}>
                <h2 style={{
                    fontSize: 'var(--font-xl)', fontWeight: 700, margin: 0,
                    color: 'var(--text)'
                }}>
                    Notes
                </h2>
                <button
                    onClick={() => setShowAdd(true)}
                    className="btn-primary"
                    style={{
                        borderRadius: '50%', width: '36px', height: '36px',
                        padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                >
                    <FontAwesomeIcon icon={faPen} size="sm" />
                </button>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '20px' }}>
                        Loading...
                    </div>
                ) : notes.length === 0 ? (
                    <div style={{
                        textAlign: 'center', color: 'var(--text-secondary)',
                        marginTop: '40px', padding: '20px',
                        border: '1px dashed var(--border-primary)', borderRadius: '12px'
                    }}>
                        No notes yet.<br />Tap the pen to write.
                    </div>
                ) : (
                    notes.map(note => (
                        <div key={note.id} className="glass-card" style={{
                            padding: '16px', position: 'relative', cursor: 'pointer'
                        }}>
                            <div style={{
                                fontSize: 'var(--font-base)', color: 'var(--text)',
                                maxHeight: '80px', overflow: 'hidden',
                                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                                marginBottom: '8px'
                            }}>
                                {note.text || 'Untitled Note'}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                                    {new Date(note.updatedAt || Date.now()).toLocaleDateString()}
                                </span>
                                <button
                                    onClick={(e) => handleDelete(e, note.id)}
                                    style={{
                                        background: 'transparent', border: 'none',
                                        color: 'var(--text-muted)', cursor: 'pointer', padding: '4px'
                                    }}
                                >
                                    <FontAwesomeIcon icon={faTrash} size="xs" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
