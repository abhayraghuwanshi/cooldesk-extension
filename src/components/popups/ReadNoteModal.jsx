import { faDownload, faTimes, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { createPortal } from 'react-dom';
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
        .read-note-content h2 { font-size: 1.5em; margin-top: 1.2em; margin-bottom: 0.6em; font-weight: 700; color: #fff; }
        .read-note-content h3 { font-size: 1.25em; margin-top: 1em; margin-bottom: 0.5em; font-weight: 600; color: #f1f5f9; }
        .read-note-content ul, .read-note-content ol { padding-left: 1.5em; margin: 1em 0; color: #cbd5e1; }
        .read-note-content li { margin: 0.5em 0; }
        .read-note-content li strong { color: #fff; }
        .read-note-content p { margin: 1em 0; color: #cbd5e1; word-break: break-word; }
        .read-note-content blockquote { border-left: 4px solid #475569; padding-left: 1em; color: #94a3b8; font-style: italic; margin: 1em 0; }
        .read-note-content code { background: rgba(0,0,0,0.3); padding: 0.2em 0.4em; border-radius: 4px; font-family: monospace; font-size: 0.9em; word-break: break-all; }
        .read-note-content pre { background: #1e293b; padding: 1em; border-radius: 8px; overflow-x: auto; margin: 1em 0; max-width: 100%; border: 1px solid rgba(255,255,255,0.05); }
        .read-note-content pre code { background: transparent; padding: 0; white-space: pre-wrap; word-break: break-all; }
        .read-note-content a { color: #60a5fa; text-decoration: underline; word-break: break-all; }
        .read-note-content hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 2em 0; }
        .read-note-content img { max-width: 100%; height: auto; border-radius: 12px; margin: 1.5em 0; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
        @keyframes modalSlideUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `;

    return createPortal(
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', sans-serif", padding: '20px'
        }} onClick={onClose}>
            <style>{contentStyles}</style>
            <div style={{
                width: '100%', maxWidth: 800,
                height: 'auto', maxHeight: '85vh',
                background: '#0a0f1e', borderRadius: 24,
                border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
                boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.8)',
                display: 'flex', flexDirection: 'column', animation: 'modalSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{
                    padding: '32px 40px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    background: 'rgba(255,255,255,0.01)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div style={{ flex: 1 }}>
                        <div style={{
                            fontSize: 11, color: '#f472b6', fontWeight: 800,
                            letterSpacing: '0.1em', marginBottom: 10, textTransform: 'uppercase'
                        }}>
                            Shared by {note.addedBy || 'Unknown'}
                        </div>
                        <h1 style={{ margin: 0, color: '#fff', fontSize: 28, fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
                            {note.payload?.title || 'Untitled Note'}
                        </h1>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                        width: 36, height: 36, borderRadius: '50%',
                        color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s', marginLeft: 20
                    }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#94a3b8'; }}>
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>

                <div style={{
                    overflowY: 'auto', padding: '16px 40px 40px 40px',
                    color: '#e2e8f0', lineHeight: 1.7, fontSize: 17
                }}>
                    <div
                        className="read-note-content"
                        dangerouslySetInnerHTML={{ __html: note.payload?.text || '<p>No content</p>' }}
                    />
                </div>

                <div style={{
                    padding: '24px 40px', borderTop: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(15, 23, 42, 0.95)',
                    marginTop: 'auto'
                }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: '50%',
                        background: 'rgba(244, 114, 182, 0.1)',
                        border: '1px solid rgba(244, 114, 182, 0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#f472b6', boxShadow: '0 0 15px rgba(244, 114, 182, 0.1)'
                    }}>
                        <FontAwesomeIcon icon={faUsers} />
                    </div>

                    <div style={{ display: 'flex', gap: 12 }}>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '12px 24px', borderRadius: 14,
                                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
                                color: '#94a3b8', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = '#94a3b8'; }}
                        >
                            Close
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || saved}
                            style={{
                                padding: '12px 28px', borderRadius: 14,
                                background: saved ? '#10b981' : 'linear-gradient(135deg, #f472b6 0%, #db2777 100%)',
                                border: 'none', color: '#fff', fontSize: 14, fontWeight: 700,
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                                opacity: (saving) ? 0.7 : 1, transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                boxShadow: saved ? '0 4px 15px rgba(16, 185, 129, 0.3)' : '0 10px 20px -5px rgba(219, 39, 119, 0.4)',
                                transform: 'translateY(0)'
                            }}
                            onMouseEnter={e => { if (!saved) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
                        >
                            {saved ? (
                                <span>Note Saved!</span>
                            ) : (
                                <>
                                    <FontAwesomeIcon icon={faDownload} />
                                    <span>Save to Notebook</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
