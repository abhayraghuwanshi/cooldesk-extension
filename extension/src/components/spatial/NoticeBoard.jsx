import { faMapPin, faPlus, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { p2pStorage } from '../../services/p2p/storageService';

const PIN_STYLES = [
    { color: '#ef4444', gradient: 'radial-gradient(circle at 30% 30%, #fca5a5, #ef4444)' },
    { color: '#3b82f6', gradient: 'radial-gradient(circle at 30% 30%, #93c5fd, #3b82f6)' },
    { color: '#10b981', gradient: 'radial-gradient(circle at 30% 30%, #6ee7b7, #10b981)' },
    { color: '#f59e0b', gradient: 'radial-gradient(circle at 30% 30%, #fcd34d, #f59e0b)' },
    { color: '#8b5cf6', gradient: 'radial-gradient(circle at 30% 30%, #c4b5fd, #8b5cf6)' },
    { color: '#ec4899', gradient: 'radial-gradient(circle at 30% 30%, #f9a8d4, #ec4899)' },
];

const PAPER_STYLES = [
    { bg: '#fffbeb', shadow: 'rgba(217, 119, 6, 0.1)' }, // Yellow
    { bg: '#fef2f2', shadow: 'rgba(220, 38, 38, 0.1)' }, // Red
    { bg: '#eff6ff', shadow: 'rgba(37, 99, 235, 0.1)' }, // Blue
    { bg: '#f0fdf4', shadow: 'rgba(5, 150, 105, 0.1)' }, // Green
    { bg: '#faf5ff', shadow: 'rgba(124, 58, 237, 0.1)' }, // Purple
    { bg: '#ffffff', shadow: 'rgba(0, 0, 0, 0.05)' },     // White
];

export default function NoticeBoard({ teamId, canWrite }) {
    console.log('[NoticeBoard] Component rendered with teamId:', teamId);

    const [notices, setNotices] = useState([]);
    const [isAdding, setIsAdding] = useState(false);
    const [newNoteText, setNewNoteText] = useState('');
    const [newNoteImage, setNewNoteImage] = useState('');
    const noticesRef = useRef(null);

    useEffect(() => {
        console.log('[NoticeBoard] useEffect triggered. teamId:', teamId);
        if (!teamId) {
            console.warn('[NoticeBoard] No teamId provided, skipping initialization');
            return;
        }

        let observer = null;
        let pArray = null;

        const load = async () => {
            console.log('[NoticeBoard] Initializing for team:', teamId);
            await p2pStorage.initializeTeamStorage(teamId);
            pArray = p2pStorage.getSharedNotices(teamId);
            noticesRef.current = pArray;

            const currentNotices = pArray.toArray();
            console.log('[NoticeBoard] Loaded notices:', currentNotices);
            setNotices(currentNotices);

            observer = () => {
                const updated = pArray.toArray();
                console.log('[NoticeBoard] Observer fired! Updated notices:', updated);
                setNotices(updated);
            };
            pArray.observe(observer);
            console.log('[NoticeBoard] Observer attached for team:', teamId);
        };
        load();

        return () => {
            if (pArray && observer) pArray.unobserve(observer);
            noticesRef.current = null;
            console.log('[NoticeBoard] Cleanup for team:', teamId);
        };
    }, [teamId]);

    const handleAddNote = () => {
        if (!newNoteText.trim() && !newNoteImage.trim()) return;

        const styleIndex = Math.floor(Math.random() * PAPER_STYLES.length);
        const pinIndex = Math.floor(Math.random() * PIN_STYLES.length);

        const newNote = {
            id: Date.now().toString(),
            text: newNoteText,
            image: newNoteImage,
            styleIndex,
            pinIndex,
            rotation: Math.random() * 4 - 2, // Subtler rotation: -2 to 2 deg
            createdAt: Date.now(),
        };

        console.log('[NoticeBoard] Adding new notice:', newNote);
        if (noticesRef.current) {
            noticesRef.current.push([newNote]);
            console.log('[NoticeBoard] Notice added. New array length:', noticesRef.current.length);
        } else {
            console.error('[NoticeBoard] Cannot add notice - noticesRef.current is null!');
        }
        setNewNoteText('');
        setNewNoteImage('');
        setIsAdding(false);
    };

    const deleteNote = (index) => {
        if (noticesRef.current) {
            noticesRef.current.delete(index, 1);
        }
    };

    const handlePaste = (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.indexOf('image') !== -1) {
                e.preventDefault();
                const blob = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    setNewNoteImage(event.target.result);
                };
                reader.readAsDataURL(blob);
                return;
            }
        }
    };

    return (
        <div style={{
            width: '100%',
            marginBottom: 32,
            marginTop: 20,
            display: 'flex',
            flexDirection: 'column',
        }}>
            {/* Header Section */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 20px 16px 20px',
                flexWrap: 'wrap',
                gap: '12px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{
                        width: 40, height: 40, borderRadius: 12,
                        background: 'linear-gradient(135deg, #fca5a5 0%, #ef4444 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)'
                    }}>
                        <FontAwesomeIcon icon={faMapPin} style={{ color: '#fff', fontSize: 'var(--font-2xl)' }} />
                    </div>
                    <div>
                        <h2 style={{ fontSize: 'var(--font-2xl)', fontWeight: 700, margin: 0, color: '#fff' }}>
                            Notice Board
                        </h2>
                        <div style={{ fontSize: 'var(--font-sm)', opacity: 0.6, marginTop: 2 }}>
                            {notices.length} active note{notices.length !== 1 ? 's' : ''}
                        </div>
                    </div>
                </div>

                {canWrite && (
                    <button
                        onClick={() => setIsAdding(!isAdding)}
                        style={{
                            background: isAdding ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.1)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 10, padding: '8px 16px',
                            color: '#fff', fontWeight: 600, fontSize: 'var(--font-sm)',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                            transition: 'all 0.2s',
                            backdropFilter: 'blur(10px)'
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = isAdding ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.1)';
                            e.currentTarget.style.transform = 'none';
                        }}
                    >
                        <FontAwesomeIcon icon={isAdding ? faTimes : faPlus} />
                        {isAdding ? 'Close' : 'Add Note'}
                    </button>
                )}
            </div>

            {/* Add Note Form */}
            {isAdding && canWrite && (
                <div
                    onPaste={handlePaste}
                    style={{
                        margin: '0 16px 24px 16px',
                        padding: 24,
                        background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.8) 0%, rgba(30, 41, 59, 0.6) 100%)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 20,
                        animation: 'fadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        backdropFilter: 'blur(20px)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <textarea
                            value={newNoteText}
                            onChange={e => setNewNoteText(e.target.value)}
                            placeholder="Write something for the team..."
                            style={{
                                width: '100%', minHeight: 100,
                                background: 'rgba(0,0,0,0.2)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 12, padding: 16,
                                color: '#fff', fontSize: 'var(--font-lg)', fontFamily: 'inherit',
                                resize: 'none', outline: 'none',
                                lineHeight: 1.6
                            }}
                            autoFocus
                        />
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                                type="text"
                                value={newNoteImage}
                                onChange={e => setNewNoteImage(e.target.value)}
                                placeholder="Paste image or URL..."
                                style={{
                                    flex: 1, minWidth: '200px',
                                    background: 'rgba(0,0,0,0.2)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: 10, padding: '0 16px', height: 44,
                                    color: '#fff', fontSize: 'var(--font-md)', outline: 'none'
                                }}
                            />
                            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />
                            <button
                                onClick={handleAddNote}
                                disabled={!newNoteText.trim() && !newNoteImage.trim()}
                                style={{
                                    padding: '0 24px', height: 44,
                                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                                    border: 'none', borderRadius: 10,
                                    color: '#fff', fontWeight: 600, cursor: 'pointer',
                                    opacity: (!newNoteText.trim() && !newNoteImage.trim()) ? 0.5 : 1,
                                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
                                    transition: 'all 0.2s'
                                }}
                            >
                                Post
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Board Area */}
            <div style={{
                position: 'relative',
                minHeight: 280,
                margin: '0 16px',
                padding: '20px',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: 24,
                border: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 16,
                alignContent: 'flex-start',
                justifyContent: 'center', // Center cards if they wrap weirdly
                transition: 'all 0.3s'
            }}>
                {/* Board Texture Overlay */}
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    opacity: 0.3, pointerEvents: 'none', borderRadius: 24,
                    backgroundImage: 'radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)',
                    backgroundSize: '24px 24px'
                }} />

                {notices.length === 0 ? (
                    <div style={{
                        width: '100%', height: 200,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        color: 'rgba(255,255,255,0.2)', gap: 16
                    }}>
                        <div style={{
                            width: 64, height: 64, borderRadius: 32,
                            border: '2px dashed rgba(255,255,255,0.1)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <FontAwesomeIcon icon={faMapPin} size="lg" />
                        </div>
                        <div style={{ fontSize: 'var(--font-lg)', fontWeight: 500 }}>The board is empty</div>
                        {canWrite && (
                            <button
                                onClick={() => setIsAdding(true)}
                                style={{
                                    background: 'transparent', border: 'none',
                                    color: '#3b82f6', cursor: 'pointer', fontSize: 'var(--font-md)'
                                }}
                            >
                                Create the first note
                            </button>
                        )}
                    </div>
                ) : (
                    notices.map((note, index) => {
                        const style = PAPER_STYLES[note.styleIndex || 0] || PAPER_STYLES[0];
                        const pin = PIN_STYLES[note.pinIndex || 0] || PIN_STYLES[0];

                        return (
                            <div
                                key={note.id || index}
                                className="notice-card"
                                style={{
                                    width: '100%',
                                    maxWidth: 300,
                                    flex: '1 1 250px', // Allow grow/shrink, basis 250px
                                    marginBottom: 16,
                                    background: style.bg,
                                    borderRadius: 4, // More realistic sticky note corners
                                    padding: '24px',
                                    boxShadow: `0 10px 15px -3px ${style.shadow}, 0 4px 6px -2px rgba(0,0,0,0.05)`, // Colored gloss shadow
                                    position: 'relative',
                                    transform: `rotate(${note.rotation || 0}deg)`,
                                    transition: 'transform 0.2s ease, box-shadow 0.2s',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    cursor: 'pointer',
                                    // Subtle paper texture gradient
                                    backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 100%)'
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.zIndex = 10;
                                    e.currentTarget.style.transform = `rotate(${note.rotation || 0}deg) scale(1.02)`;
                                    e.currentTarget.style.boxShadow = `0 20px 25px -5px ${style.shadow}, 0 10px 10px -5px rgba(0,0,0,0.04)`;
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.zIndex = 1;
                                    e.currentTarget.style.transform = `rotate(${note.rotation || 0}deg)`;
                                    e.currentTarget.style.boxShadow = `0 10px 15px -3px ${style.shadow}, 0 4px 6px -2px rgba(0,0,0,0.05)`;
                                }}
                            >
                                {/* Hyper-realistic Pin */}
                                <div style={{
                                    position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                                    width: 14, height: 14, borderRadius: '50%',
                                    background: pin.gradient,
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.2), inset 0 2px 4px rgba(255,255,255,0.4)',
                                    zIndex: 2,
                                    border: '1px solid rgba(0,0,0,0.1)'
                                }}>
                                    {/* Metallic highlight */}
                                    <div style={{
                                        position: 'absolute', top: 3, left: 3, width: 4, height: 4,
                                        borderRadius: '50%', background: 'rgba(255,255,255,0.8)',
                                        filter: 'blur(0.5px)'
                                    }} />
                                </div>
                                {/* Pin shadow on paper */}
                                <div style={{
                                    position: 'absolute', top: -4, left: '52%',
                                    width: 8, height: 8, borderRadius: '50%',
                                    background: 'rgba(0,0,0,0.2)',
                                    filter: 'blur(2px)',
                                    zIndex: 1
                                }} />

                                {/* Content */}
                                <div style={{ flex: 1, color: '#334155', fontFamily: 'Coming Soon, cursive, sans-serif' }}>
                                    {note.image && (
                                        <div style={{
                                            width: 'calc(100% + 16px)',
                                            margin: '-8px -8px 16px -8px',
                                            height: 160,
                                            background: '#f1f5f9',
                                            borderRadius: 2,
                                            overflow: 'hidden',
                                            border: '4px solid #fff',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                                        }}>
                                            <img
                                                src={note.image}
                                                alt="Note attachment"
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                onError={e => e.target.style.display = 'none'}
                                            />
                                        </div>
                                    )}
                                    <div style={{
                                        whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 'var(--font-lg)', fontWeight: 500,
                                        // Fix for font fallback
                                        fontFamily: "'Coming Soon', 'Patrick Hand', 'Segoe Print', 'Chalkboard SE', sans-serif"
                                    }}>
                                        {note.text}
                                    </div>
                                </div>

                                {/* Footer */}
                                <div style={{
                                    marginTop: 20, paddingTop: 12,
                                    borderTop: '1px dashed rgba(0,0,0,0.08)',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    fontSize: 'var(--font-sm)'
                                }}>
                                    <span className="notice-date" style={{
                                        fontSize: 'var(--font-sm)',
                                        color: '#0f172a', // Darker slate for better contrast
                                        fontWeight: 700,  // Bolder text
                                        opacity: 0.9,
                                        letterSpacing: '0.02em',
                                        textTransform: 'uppercase'
                                    }}>
                                        {new Date(note.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                    </span>
                                    {canWrite && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteNote(index);
                                            }}
                                            className="delete-btn"
                                            style={{
                                                border: 'none', background: 'rgba(0,0,0,0.05)',
                                                color: '#ef4444', cursor: 'pointer',
                                                padding: 6, borderRadius: 6,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                transition: 'all 0.2s',
                                            }}
                                            title="Remove note"
                                            onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'}
                                        >
                                            <FontAwesomeIcon icon={faTimes} size="sm" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div >
    );
}

const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    /* Force high specificity for date color */
    .notice-card .notice-date {
        color: #0f172a !important;
        opacity: 1 !important;
        font-weight: 700 !important;
        text-shadow: none !important;
        -webkit-text-fill-color: #0f172a !important;
    }
`;
document.head.appendChild(style);
