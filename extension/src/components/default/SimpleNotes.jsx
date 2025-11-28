import { faCheck, faCheckCircle, faCircle, faEdit, faLightbulb, faMicrophone, faPause, faPlay, faSquareCheck, faStop, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deleteNote as dbDeleteNote, listNotes as dbListNotes, upsertNote as dbUpsertNote } from '../../db/index.js';
import '../../styles/default/SimpleNotes.css';

// Parse checkbox from text
const parseCheckboxText = (text) => {
    const checkboxPattern = /^(\s*)([-*]?\s*)?(\[([\sxX])\]|[☐☑])\s*(.*)/s;
    const match = text.match(checkboxPattern);

    let isChecked = false;
    let content = text;

    if (match) {
        const checkState = match[4] || '';
        isChecked = checkState === 'x' || checkState === 'X' || match[3] === '☑';
        content = match[5] || text;
    }

    return { isChecked, content, hasCheckbox: !!match };
};

// Smart date formatting
const formatTimeAgo = (timestamp) => {
    if (!timestamp) return '';

    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;

    const noteDate = new Date(timestamp);
    return noteDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });
};

// Note item component
const NoteItem = ({ note, onToggle, onDelete, onEdit, onPlay, isPlaying, onPin }) => {
    const [isHovered, setIsHovered] = React.useState(false);
    const [isEditing, setIsEditing] = React.useState(false);
    const [editText, setEditText] = React.useState('');
    const { isChecked, content, hasCheckbox } = parseCheckboxText(note.text || '');
    const isTodo = note.type === 'todo' || hasCheckbox;

    const handleEdit = () => {
        setEditText(note.text);
        setIsEditing(true);
    };

    const handleSaveEdit = () => {
        if (editText.trim()) {
            onEdit(note.id, editText.trim());
        }
        setIsEditing(false);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditText('');
    };

    const handleToggle = () => {
        if (!isTodo) return;
        const newCheckedState = !isChecked;
        const checkSymbol = newCheckedState ? '[x]' : '[ ]';
        const updatedText = `${checkSymbol} ${content}`;
        onToggle(note.id, updatedText);
    };

    return (
        <div
            className="simple-note-item"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >

            {/* Content */}
            <div className="simple-note-content">
                {isEditing ? (
                    <div className="simple-note-edit">
                        <textarea
                            className="simple-note-edit-textarea"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    handleSaveEdit();
                                } else if (e.key === 'Escape') {
                                    handleCancelEdit();
                                }
                            }}
                            autoFocus
                        />
                        <div className="simple-note-edit-actions">
                            <button onClick={handleSaveEdit} className="simple-note-btn simple-notes-save" title="Save (Cmd+Enter)">
                                <FontAwesomeIcon icon={faCheck} />
                            </button>
                            <button onClick={handleCancelEdit} className="simple-note-btn" title="Cancel (Esc)">
                                ×
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="simple-note-text">
                            {isTodo ? (
                                <div className="simple-note-todo">
                                    <button
                                        onClick={handleToggle}
                                        className={`simple-note-checkbox ${isChecked ? 'is-checked' : ''}`}
                                        title={isChecked ? 'Mark incomplete' : 'Mark complete'}
                                    >
                                        <FontAwesomeIcon icon={isChecked ? faCheckCircle : faCircle} />
                                    </button>
                                    <span className={`simple-note-todo-text ${isChecked ? 'is-checked' : ''}`}>
                                        {content}
                                    </span>
                                </div>
                            ) : (
                                <span className="simple-note-thought">{note.text}</span>
                            )}
                        </div>

                        {/* Actions */}
                        <div className={`simple-note-actions ${isHovered ? 'is-visible' : ''}`}>
                            <span className="simple-note-time">{formatTimeAgo(note.createdAt)}</span>

                            {(note.type === 'voice' || note.type === 'voice-text') && note.audioData && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onPlay(note);
                                    }}
                                    className={`simple-note-btn ${isPlaying ? 'is-playing' : ''}`}
                                    title={isPlaying ? 'Stop playback' : 'Play voice note'}
                                >
                                    <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} />
                                </button>
                            )}

                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleEdit();
                                }}
                                className="simple-note-btn"
                                title="Edit"
                            >
                                <FontAwesomeIcon icon={faEdit} />
                            </button>

                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(note.id);
                                }}
                                className="simple-note-btn simple-note-delete"
                                title="Delete"
                            >
                                <FontAwesomeIcon icon={faTrash} />
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export function SimpleNotes() {
    const [notes, setNotes] = React.useState([]);
    const [text, setText] = React.useState('');
    const [noteType, setNoteType] = React.useState('text'); // 'text' for thoughts, todos identified by checkbox
    const [filter, setFilter] = React.useState('all'); // 'all', 'todos', 'thoughts', 'completed'
    const [isRecording, setIsRecording] = React.useState(false);
    const [mediaRecorder, setMediaRecorder] = React.useState(null);
    const [recordingTime, setRecordingTime] = React.useState(0);
    const [speechRecognition, setSpeechRecognition] = React.useState(null);
    const [playingId, setPlayingId] = React.useState(null);
    const [isCollapsed, setIsCollapsed] = React.useState(() => {
        try {
            const saved = localStorage.getItem('simpleNotes_collapsed');
            return saved === 'true';
        } catch {
            return false;
        }
    });

    const recordingTimerRef = React.useRef(null);
    const audioRefs = React.useRef({});
    const textareaRef = React.useRef(null);

    // Load notes
    const loadNotes = async () => {
        try {
            console.log('[SimpleNotes] Loading notes...');
            const list = await dbListNotes();
            console.log('[SimpleNotes] Raw response:', list);
            const notesData = list?.data || list || [];
            console.log('[SimpleNotes] Processed notes:', notesData);
            setNotes(Array.isArray(notesData) ? notesData : []);
        } catch (error) {
            console.error('[SimpleNotes] Error loading notes:', error);
            setNotes([]);
        }
    };

    // Add note
    const addNote = async () => {
        const t = text.trim();
        if (!t) return;

        let noteText = t;
        let type = noteType;

        // Add checkbox prefix for todos
        if (noteType === 'todo') {
            const checkboxPattern = /^(\s*)([-*]?\s*)?(\[([\sxX])\]|[☐☑])\s*/;
            if (!checkboxPattern.test(t)) {
                noteText = `[ ] ${t}`;
            }
        }
        // Always use 'text' type for database validation
        type = 'text';

        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const note = {
            id,
            text: noteText,
            type,
            createdAt: Date.now()
        };

        try {
            console.log('[SimpleNotes] Saving note:', note);
            const result = await dbUpsertNote(note);
            console.log('[SimpleNotes] Save result:', result);
            setText('');
            await loadNotes();
        } catch (error) {
            console.error('[SimpleNotes] Error creating note:', error);
        }
    };

    // Edit note
    const handleEdit = async (noteId, updatedText) => {
        const note = notes.find(n => n.id === noteId);
        if (!note) return;

        const updatedNote = { ...note, text: updatedText };
        try {
            await dbUpsertNote(updatedNote);
            await loadNotes();
        } catch (error) {
            console.error('[SimpleNotes] Error editing note:', error);
        }
    };

    // Toggle todo checkbox
    const handleToggle = async (noteId, updatedText) => {
        const note = notes.find(n => n.id === noteId);
        if (!note) return;

        const updatedNote = { ...note, text: updatedText };
        try {
            await dbUpsertNote(updatedNote);
            await loadNotes();
        } catch (error) {
            console.error('[SimpleNotes] Error updating note:', error);
        }
    };

    // Delete note
    const removeNote = async (id) => {
        try {
            await dbDeleteNote(id);
            await loadNotes();
        } catch (error) {
            console.error('[SimpleNotes] Error deleting note:', error);
        }
    };

    // Play voice note
    const playVoiceNote = (note) => {
        if (playingId === note.id) {
            if (audioRefs.current[note.id]) {
                audioRefs.current[note.id].pause();
                audioRefs.current[note.id].currentTime = 0;
            }
            setPlayingId(null);
            return;
        }

        Object.values(audioRefs.current).forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });

        const audio = new Audio(`data:audio/webm;base64,${note.audioData}`);
        audioRefs.current[note.id] = audio;

        audio.onended = () => setPlayingId(null);
        audio.onerror = () => setPlayingId(null);

        setPlayingId(note.id);
        audio.play().catch(() => setPlayingId(null));
    };

    // Voice recording
    const startRecording = async () => {
        if (isRecording) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            let recognition = null;
            let capturedTranscript = '';
            const existingText = text.trim();

            // Speech recognition
            if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                recognition = new SpeechRecognition();
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onresult = (event) => {
                    let completeTranscript = '';
                    for (let i = 0; i < event.results.length; i++) {
                        completeTranscript += event.results[i][0].transcript + ' ';
                    }

                    const currentTranscript = completeTranscript.trim();
                    capturedTranscript = currentTranscript;

                    const combinedText = existingText
                        ? `${existingText}\n${currentTranscript}`
                        : currentTranscript;
                    setText(combinedText);
                };

                recognition.onerror = (event) => {
                    console.warn('[SimpleNotes] Speech recognition error:', event.error);
                };

                try {
                    recognition.start();
                    setSpeechRecognition(recognition);
                } catch (error) {
                    console.warn('[SimpleNotes] Failed to start speech recognition:', error);
                }
            }

            const recorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus'
                    : 'audio/webm'
            });

            recorder.ondataavailable = () => { };

            recorder.onstop = async () => {
                if (speechRecognition) {
                    try {
                        speechRecognition.stop();
                    } catch (error) {
                        console.warn('[SimpleNotes] Error stopping speech recognition:', error);
                    }
                    setSpeechRecognition(null);
                }

                stream.getTracks().forEach(track => track.stop());
                setIsRecording(false);
                setRecordingTime(0);
                if (recordingTimerRef.current) {
                    clearInterval(recordingTimerRef.current);
                }
            };

            setMediaRecorder(recorder);
            setIsRecording(true);
            setRecordingTime(0);

            recordingTimerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);

            recorder.start();
        } catch (error) {
            console.error('[SimpleNotes] Recording error:', error);
            setIsRecording(false);
            setRecordingTime(0);
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
            }

            const errorMessage = error.name === 'NotAllowedError'
                ? 'Microphone access denied'
                : error.name === 'NotFoundError'
                    ? 'No microphone found'
                    : 'Could not access microphone';

            alert(errorMessage);
        }
    };

    const stopRecording = () => {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
        }

        if (speechRecognition) {
            try {
                speechRecognition.stop();
            } catch (error) {
                console.warn('[SimpleNotes] Error stopping speech recognition:', error);
            }
        }
    };

    const formatRecordingTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Group notes by date
    const groupedNotes = React.useMemo(() => {
        const filtered = notes.filter(note => {
            const { isChecked, hasCheckbox } = parseCheckboxText(note.text || '');
            const isTodo = note.type === 'todo' || hasCheckbox;

            switch (filter) {
                case 'todos':
                    return isTodo && !isChecked;
                case 'thoughts':
                    return !isTodo;
                case 'completed':
                    return isTodo && isChecked;
                default:
                    return true;
            }
        }).sort((a, b) => b.createdAt - a.createdAt);

        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

        const groups = {
            pinned: filtered.filter(n => n.pinned),
            today: [],
            yesterday: [],
            lastMonth: []
        };

        filtered.forEach(note => {
            if (note.pinned) return; // Already in pinned

            const age = now - note.createdAt;
            if (age < oneDayMs) {
                groups.today.push(note);
            } else if (age < oneDayMs * 2) {
                groups.yesterday.push(note);
            } else if (age < thirtyDaysMs) {
                groups.lastMonth.push(note);
            }
        });

        return groups;
    }, [notes, filter]);

    // Count stats
    const stats = React.useMemo(() => {
        let todos = 0;
        let thoughts = 0;
        let completed = 0;

        notes.forEach(note => {
            const { isChecked, hasCheckbox } = parseCheckboxText(note.text || '');
            const isTodo = note.type === 'todo' || hasCheckbox;

            if (isTodo) {
                if (isChecked) completed++;
                else todos++;
            } else {
                thoughts++;
            }
        });

        return { todos, thoughts, completed };
    }, [notes]);

    // Auto-resize textarea
    React.useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.max(40, textareaRef.current.scrollHeight) + 'px';
        }
    }, [text]);

    // Persist collapsed state to localStorage
    React.useEffect(() => {
        try {
            localStorage.setItem('simpleNotes_collapsed', String(isCollapsed));
        } catch (e) {
            console.warn('[SimpleNotes] Failed to save collapsed state', e);
        }
    }, [isCollapsed]);

    // Load notes on mount
    React.useEffect(() => {
        loadNotes();
    }, []);

    // Cleanup
    React.useEffect(() => {
        return () => {
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
            }
            if (isRecording && mediaRecorder) {
                mediaRecorder.stop();
            }
            if (speechRecognition) {
                try {
                    speechRecognition.stop();
                } catch (error) {
                    console.warn('[SimpleNotes] Error stopping speech recognition during cleanup:', error);
                }
            }
        };
    }, [isRecording, mediaRecorder, speechRecognition]);

    // If collapsed, show only title
    if (isCollapsed) {
        return (
            <div
                onClick={() => setIsCollapsed(false)}
                style={{
                    marginBottom: 'var(--section-spacing)',
                    padding: '12px 20px',
                    border: '1px solid rgba(70, 70, 75, 0.7)',
                    borderRadius: '16px',
                    background: 'rgba(28, 28, 33, 0.45)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(28, 28, 33, 0.65)';
                    e.currentTarget.style.borderColor = 'rgba(100, 100, 105, 0.7)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(28, 28, 33, 0.45)';
                    e.currentTarget.style.borderColor = 'rgba(70, 70, 75, 0.7)';
                }}
            >
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
                    Notes
                </h3>
                <span style={{
                    fontSize: '0.85rem',
                    opacity: 0.5,
                    color: 'var(--text-secondary, #aaa)'
                }}>
                    Click to expand
                </span>
            </div>
        );
    }

    return (
        <div className="simple-notes-root">
            {/* Header with Toolbar */}
            <div className="simple-notes-header">
                <div
                    onClick={() => setIsCollapsed(true)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 16,

                        cursor: 'pointer',
                        transition: 'opacity 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '0.7';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '1';
                    }}
                >
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
                        Notes
                    </h3>
                    <span style={{
                        fontSize: '0.75rem',
                        opacity: 0.4,
                        color: 'var(--text-secondary, #aaa)'
                    }}>
                        Click to hide
                    </span>
                </div>

                {/* Apple-style Toolbar */}
                <div className="simple-notes-toolbar">
                    <button
                        onClick={() => setFilter('all')}
                        className={`simple-notes-filter ${filter === 'all' ? 'is-active' : ''}`}
                        title="All notes"
                    >
                        All {notes.length > 0 && `· ${notes.length}`}
                    </button>
                    <button
                        onClick={() => setFilter('todos')}
                        className={`simple-notes-filter ${filter === 'todos' ? 'is-active' : ''}`}
                        title="Active todos"
                    >
                        <FontAwesomeIcon icon={faSquareCheck} /> {stats.todos > 0 && stats.todos}
                    </button>
                    <button
                        onClick={() => setFilter('thoughts')}
                        className={`simple-notes-filter ${filter === 'thoughts' ? 'is-active' : ''}`}
                        title="Thoughts & Notes"
                    >
                        <FontAwesomeIcon icon={faLightbulb} /> {stats.thoughts > 0 && stats.thoughts}
                    </button>
                    <button
                        onClick={() => setFilter('completed')}
                        className={`simple-notes-filter ${filter === 'completed' ? 'is-active' : ''}`}
                        title="Completed todos"
                    >
                        <FontAwesomeIcon icon={faCheckCircle} /> {stats.completed > 0 && stats.completed}
                    </button>
                </div>
            </div>

            {/* Input Area */}
            <div className="simple-notes-input">
                <div className="simple-notes-input-row">
                    <textarea
                        ref={textareaRef}
                        className="simple-notes-textarea"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                if (text.trim()) addNote();
                            }
                        }}
                        placeholder={noteType === 'todo' ? 'Add a todo...' : 'Write a thought...'}
                        rows={1}
                    />

                    <div className="simple-notes-input-actions">
                        {/* Type toggle */}
                        <button
                            onClick={() => setNoteType(noteType === 'todo' ? 'text' : 'todo')}
                            className={`simple-notes-type-toggle ${noteType === 'todo' ? 'is-todo' : ''}`}
                            title={noteType === 'todo' ? 'Switch to thought' : 'Switch to todo'}
                        >
                            <FontAwesomeIcon icon={noteType === 'todo' ? faSquareCheck : faLightbulb} />
                        </button>

                        {/* Voice button */}
                        <button
                            onClick={isRecording ? stopRecording : startRecording}
                            className={`simple-notes-btn ${isRecording ? 'is-recording' : ''}`}
                            title={isRecording ? `Recording ${formatRecordingTime(recordingTime)}` : 'Voice input'}
                        >
                            <FontAwesomeIcon icon={isRecording ? faStop : faMicrophone} />
                        </button>

                        {/* Save button */}
                        {!isRecording && (
                            <button
                                onClick={() => { if (text.trim()) addNote(); }}
                                disabled={!text.trim()}
                                className="simple-notes-btn simple-notes-save"
                                title="Save (Cmd+Enter)"
                            >
                                <FontAwesomeIcon icon={faCheck} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Notes List - Grouped by Date */}
            <div className="simple-notes-list">
                {notes.length === 0 ? (
                    <div className="simple-notes-empty">
                        {filter === 'all' && 'No notes yet'}
                        {filter === 'todos' && 'No active todos'}
                        {filter === 'thoughts' && 'No thoughts yet'}
                        {filter === 'completed' && 'No completed todos'}
                    </div>
                ) : (
                    <>
                        {/* Pinned */}
                        {groupedNotes.pinned.length > 0 && (
                            <div className="simple-notes-group">
                                <h3 className="simple-notes-group-title">Pinned</h3>
                                {groupedNotes.pinned.map(note => (
                                    <NoteItem
                                        key={note.id}
                                        note={note}
                                        onToggle={handleToggle}
                                        onEdit={handleEdit}
                                        onDelete={removeNote}
                                        onPlay={playVoiceNote}
                                        isPlaying={playingId === note.id}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Today */}
                        {groupedNotes.today.length > 0 && (
                            <div className="simple-notes-group">
                                <h3 className="simple-notes-group-title">Today</h3>
                                {groupedNotes.today.map(note => (
                                    <NoteItem
                                        key={note.id}
                                        note={note}
                                        onToggle={handleToggle}
                                        onEdit={handleEdit}
                                        onDelete={removeNote}
                                        onPlay={playVoiceNote}
                                        isPlaying={playingId === note.id}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Yesterday */}
                        {groupedNotes.yesterday.length > 0 && (
                            <div className="simple-notes-group">
                                <h3 className="simple-notes-group-title">Yesterday</h3>
                                {groupedNotes.yesterday.map(note => (
                                    <NoteItem
                                        key={note.id}
                                        note={note}
                                        onToggle={handleToggle}
                                        onEdit={handleEdit}
                                        onDelete={removeNote}
                                        onPlay={playVoiceNote}
                                        isPlaying={playingId === note.id}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Last Month */}
                        {groupedNotes.lastMonth.length > 0 && (
                            <div className="simple-notes-group">
                                <h3 className="simple-notes-group-title">Last Month</h3>
                                {groupedNotes.lastMonth.map(note => (
                                    <NoteItem
                                        key={note.id}
                                        note={note}
                                        onToggle={handleToggle}
                                        onEdit={handleEdit}
                                        onDelete={removeNote}
                                        onPlay={playVoiceNote}
                                        isPlaying={playingId === note.id}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}