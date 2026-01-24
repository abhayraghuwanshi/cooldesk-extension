import { faDownload, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { upsertNote } from '../../db/index.js';

export function ReadNoteModal({ isOpen, onClose, note }) {
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    if (!isOpen || !note) return null;

    const handleSave = async () => {
        setSaving(true);
        try {
            // Create a new local copy
            const localNote = {
                id: `imported_${Date.now()}`,
                title: note.payload?.title || 'Shared Note',
                text: note.payload?.text || '',
                folder: 'Imported',
                type: note.payload?.type || 'richtext',
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            await upsertNote(localNote);
            setSaved(true);
            setTimeout(() => {
                setSaved(false);
                onClose();
            }, 1000);
        } catch (error) {
            console.error('Failed to save note:', error);
            alert('Failed to save to notebook.');
        } finally {
            setSaving(false);
        }
    };

    // Inline CSS for the content area
    const contentStyles = `
        .read-note-content h1 { font-size: 2em; margin-bottom: 0.5em; font-weight: 700; color: #fff; }
        .read-note-content h2 { font-size: 1.5em; margin-top: 1em; margin-bottom: 0.5em; font-weight: 600; color: #f8fafc; }
        .read-note-content h3 { font-size: 1.25em; margin-top: 0.8em; margin-bottom: 0.4em; font-weight: 600; color: #f1f5f9; }
        .read-note-content ul, .read-note-content ol { padding-left: 1.5em; margin: 1em 0; }
        .read-note-content li { margin: 0.25em 0; }
        .read-note-content p { margin: 0.75em 0; }
        .read-note-content blockquote { border-left: 4px solid #475569; padding-left: 1em; color: #94a3b8; font-style: italic; margin: 1em 0; }
        .read-note-content code { background: rgba(0,0,0,0.3); padding: 0.2em 0.4em; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
        .read-note-content pre { background: #1e293b; padding: 1em; border-radius: 8px; overflow-x: auto; margin: 1em 0; }
        .read-note-content pre code { background: transparent; padding: 0; }
        .read-note-content a { color: #60a5fa; text-decoration: underline; }
        .read-note-content strong { font-weight: 600; }
        .read-note-content em { font-style: italic; }
        .read-note-content hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 1.5em 0; }
    `;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', sans-serif"
        }} onClick={onClose}>
            <style>{contentStyles}</style>
            <div style={{
                width: 700, maxHeight: '85vh', background: '#0f172a', borderRadius: 24,
                border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                display: 'flex', flexDirection: 'column'
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{
                    padding: '24px 32px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    background: 'linear-gradient(to right, rgba(255,255,255,0.02), transparent)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'start'
                }}>
                    <div>
                        <div style={{
                            fontSize: 12, color: '#f472b6', fontWeight: 700,
                            letterSpacing: '0.05em', marginBottom: 8, textTransform: 'uppercase'
                        }}>
                            Shared by {note.addedBy || 'Unknown'}
                        </div>
                        <h1 style={{ margin: 0, color: '#fff', fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
                            {note.payload?.title || 'Untitled Note'}
                        </h1>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.05)', border: 'none',
                        width: 32, height: 32, borderRadius: 16,
                        color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s'
                    }}>
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>

                {/* Content - Read Only Editor View */}
                <div style={{
                    flex: 1, overflowY: 'auto', padding: '32px',
                    color: '#e2e8f0', lineHeight: 1.6, fontSize: 16
                }}>
                    <div
                        className="read-note-content"
                        dangerouslySetInnerHTML={{ __html: note.payload?.text || '<p>No content</p>' }}
                    />
                </div>

                {/* Footer */}
                <div style={{
                    padding: '24px 32px', borderTop: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex', justifyContent: 'flex-end', gap: 12,
                    background: '#1e293b'
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '12px 20px', borderRadius: 12,
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                            color: '#94a3b8', fontSize: 14, fontWeight: 500, cursor: 'pointer'
                        }}
                    >
                        Close
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || saved}
                        style={{
                            padding: '12px 24px', borderRadius: 12,
                            background: saved ? '#10b981' : 'linear-gradient(135deg, #f472b6 0%, #db2777 100%)',
                            border: 'none', color: '#fff', fontSize: 14, fontWeight: 600,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                            opacity: (saving) ? 0.7 : 1, transition: 'all 0.2s',
                            boxShadow: '0 4px 12px -2px rgba(219, 39, 119, 0.4)'
                        }}
                    >
                        {saved ? (
                            <span>Saved to Notebook!</span>
                        ) : (
                            <>
                                <FontAwesomeIcon icon={faDownload} />
                                <span>Save to My Notes</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
