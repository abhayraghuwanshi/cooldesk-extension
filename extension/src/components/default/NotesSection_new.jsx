import { faEye, faMicrophone, faPause, faPlay, faStop, faTimes, faTrash, faSquareCheck, faSquare } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deleteNote as dbDeleteNote, listNotes as dbListNotes, upsertNote as dbUpsertNote } from '../../db/index.js';

// Simple utility functions at module level to avoid hoisting issues
const parseCheckboxText = (text) => {
  const lines = text.split('\n');
  let hasCheckboxes = false;

  const parsedLines = lines.map(line => {
    const checkboxPattern = /^(\s*)([-*]?\s*)?(\[([\sxX])\]|[☐☑])\s*(.*)/;
    const match = line.match(checkboxPattern);

    if (match) {
      hasCheckboxes = true;
      const indent = match[1] || '';
      const bullet = match[2] || '';
      const checkbox = match[3] || '';
      const checkState = match[4] || '';
      const content = match[5] || '';
      const isChecked = checkState === 'x' || checkState === 'X' || checkbox === '☑';

      return {
        type: 'checkbox',
        indent: indent,
        bullet: bullet,
        checked: isChecked,
        content: content,
        originalLine: line
      };
    }

    return {
      type: 'text',
      content: line,
      originalLine: line
    };
  });

  return { lines: parsedLines, hasCheckboxes };
};

const CheckboxLine = ({ line, lineIndex, onToggle }) => {
  if (line.type === 'checkbox') {
    return (
      <div key={lineIndex} style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        marginBottom: 4,
        paddingLeft: line.indent.length * 16
      }}>
        <button
          onClick={() => onToggle(lineIndex)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginTop: 2,
            color: line.checked ? '#34C759' : 'rgba(255, 255, 255, 0.6)',
            fontSize: 16,
            transition: 'color 0.2s ease'
          }}
          title={line.checked ? 'Mark as incomplete' : 'Mark as complete'}
        >
          <FontAwesomeIcon icon={line.checked ? faSquareCheck : faSquare} />
        </button>
        <span style={{
          color: line.checked ? 'rgba(255, 255, 255, 0.5)' : '#ffffff',
          textDecoration: line.checked ? 'line-through' : 'none',
          flex: 1,
          lineHeight: 1.4,
          fontSize: 16
        }}>
          {line.content}
        </span>
      </div>
    );
  }

  return (
    <div key={lineIndex} style={{
      marginBottom: 4,
      color: '#ffffff',
      lineHeight: 1.4,
      fontSize: 16
    }}>
      {line.content}
    </div>
  );
};

const NoteDisplay = ({ note, onToggleCheckbox, onDelete, onEdit, onPlay, isPlaying }) => {
  const handleToggleCheckbox = async (lineIndex) => {
    const { lines } = parseCheckboxText(note.text || '');
    if (lineIndex >= 0 && lineIndex < lines.length && lines[lineIndex].type === 'checkbox') {
      lines[lineIndex].checked = !lines[lineIndex].checked;

      // Sort: incomplete first, completed last
      const checkboxLines = lines.filter(line => line.type === 'checkbox');
      const textLines = lines.filter(line => line.type === 'text');
      const sortedCheckboxLines = [
        ...checkboxLines.filter(line => !line.checked),
        ...checkboxLines.filter(line => line.checked)
      ];
      const allSortedLines = [...textLines, ...sortedCheckboxLines];

      const updatedText = allSortedLines.map(line => {
        if (line.type === 'checkbox') {
          const checkSymbol = line.checked ? '[x]' : '[ ]';
          return `${line.indent}${line.bullet}${checkSymbol} ${line.content}`;
        }
        return line.content;
      }).join('\n');

      onToggleCheckbox(note.id, updatedText);
    }
  };

  const renderNoteContent = () => {
    const { lines, hasCheckboxes } = parseCheckboxText(note.text || '');

    if (hasCheckboxes) {
      return lines.map((line, lineIndex) => (
        <CheckboxLine
          key={lineIndex}
          line={line}
          lineIndex={lineIndex}
          onToggle={handleToggleCheckbox}
        />
      ));
    }

    return note.text;
  };

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.05)',
      borderRadius: 12,
      padding: 16,
      border: '1px solid rgba(255, 255, 255, 0.1)',
      backdropFilter: 'blur(10px)',
      transition: 'all 0.2s ease'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {note.type === 'voice' || note.type === 'voice-text' ? (
            <>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8
              }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  background: note.type === 'voice-text' ? '#007AFF' : '#34C759',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <FontAwesomeIcon icon={faMicrophone} style={{ fontSize: 14, color: 'white' }} />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: '#ffffff' }}>
                    {note.type === 'voice-text' ? 'Voice + Text Note' : 'Voice Note'}
                  </div>
                  <div style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.6)' }}>
                    {Math.floor((note.duration || 0) / 60)}:{String((note.duration || 0) % 60).padStart(2, '0')}
                    {note.type === 'voice-text' && note.hasTranscription && (
                      <span style={{ marginLeft: 8, color: '#34C759' }}>✓ Transcribed</span>
                    )}
                  </div>
                </div>
              </div>

              {note.type === 'voice-text' && note.text && (
                <div style={{
                  fontSize: 14,
                  color: '#e5e7eb',
                  lineHeight: 1.4,
                  marginBottom: 8,
                  padding: '8px 12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                  {renderNoteContent()}
                </div>
              )}

              <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.5)' }}>
                {note.createdAt ? new Date(note.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                }) : ''}
              </div>
            </>
          ) : (
            <>
              <div style={{
                fontSize: 16,
                color: '#ffffff',
                lineHeight: 1.4,
                marginBottom: 8,
                fontWeight: 400
              }}>
                {renderNoteContent()}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.5)' }}>
                {note.createdAt ? new Date(note.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                }) : ''}
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {(note.type === 'voice' || note.type === 'voice-text') && note.audioData && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(note);
              }}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                border: 'none',
                background: isPlaying ? '#FF9500' : 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              title={isPlaying ? "Stop playback" : "Play voice note"}
            >
              <FontAwesomeIcon
                icon={isPlaying ? faPause : faPlay}
                style={{ fontSize: 12 }}
              />
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(note.id);
            }}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#FF3B30',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              opacity: 0.7
            }}
            title="Delete note"
            onMouseEnter={(e) => {
              e.target.style.background = '#FF3B30';
              e.target.style.color = 'white';
              e.target.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.1)';
              e.target.style.color = '#FF3B30';
              e.target.style.opacity = '0.7';
            }}
          >
            <FontAwesomeIcon icon={faTrash} style={{ fontSize: 12 }} />
          </button>
        </div>
      </div>
    </div>
  );
};

export function NotesSection() {
  const [notes, setNotes] = React.useState([]);
  const [text, setText] = React.useState('');
  const [editingId, setEditingId] = React.useState(null);
  const [editText, setEditText] = React.useState('');
  const [isRecording, setIsRecording] = React.useState(false);
  const [recordingMode, setRecordingMode] = React.useState('transcribe');
  const [mediaRecorder, setMediaRecorder] = React.useState(null);
  const [recordingTime, setRecordingTime] = React.useState(0);
  const [playingId, setPlayingId] = React.useState(null);
  const [previewNote, setPreviewNote] = React.useState(null);
  const [notesDisplayLimit, setNotesDisplayLimit] = React.useState(6);
  const [showAllNotes, setShowAllNotes] = React.useState(false);
  const [notesFilter, setNotesFilter] = React.useState('all');

  const recordingTimerRef = React.useRef(null);
  const audioRefs = React.useRef({});
  const autoSaveTimeoutRef = React.useRef(null);

  const loadNotes = async () => {
    try {
      const list = await dbListNotes();
      const notesData = list?.data || list || [];
      setNotes(Array.isArray(notesData) ? notesData : []);
    } catch (error) {
      console.error('[NotesSection] Error loading notes:', error);
      setNotes([]);
    }
  };

  const addNote = async (noteText = text, autoSave = false) => {
    const t = (noteText || '').trim();
    if (!t) return;

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const note = { id, text: t, type: 'text', createdAt: Date.now() };

    try {
      await dbUpsertNote(note);
    } catch (error) {
      console.error('[NotesSection] Error creating note:', error);
    }

    if (!autoSave) {
      setText('');
    }

    await loadNotes();
  };

  const handleTextChange = (newText) => {
    setText(newText);

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    if (newText.trim().length > 3) {
      autoSaveTimeoutRef.current = setTimeout(() => {
        addNote(newText, true);
        setText('');
      }, 2000);
    }
  };

  const handleToggleCheckbox = async (noteId, updatedText) => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    const updatedNote = { ...note, text: updatedText };
    try {
      await dbUpsertNote(updatedNote);
      await loadNotes();
    } catch (error) {
      console.error('[NotesSection] Error updating note:', error);
    }
  };

  const removeNote = async (id) => {
    try {
      await dbDeleteNote(id);
      await loadNotes();
    } catch (error) {
      console.error('[NotesSection] Error deleting note:', error);
    }
  };

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

  // Filter notes
  const filteredNotes = React.useMemo(() => {
    if (notesFilter === 'all') return notes;

    return notes.filter(note => {
      const text = note.text || '';
      const { hasCheckboxes } = parseCheckboxText(text);

      switch (notesFilter) {
        case 'incomplete': {
          if (!hasCheckboxes) return false;
          const { lines } = parseCheckboxText(text);
          return lines.some(line => line.type === 'checkbox' && !line.checked);
        }
        case 'completed': {
          if (!hasCheckboxes) return false;
          const { lines } = parseCheckboxText(text);
          return lines.some(line => line.type === 'checkbox' && line.checked);
        }
        case 'text':
          return note.type === 'text';
        case 'voice':
          return note.type === 'voice' || note.type === 'voice-text';
        default:
          return true;
      }
    });
  }, [notes, notesFilter]);

  React.useEffect(() => {
    loadNotes();
  }, []);

  // Cleanup
  React.useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div style={{
      marginBottom: 16,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        padding: '0 4px'
      }}>
        <h2 style={{
          fontSize: 22,
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px'
        }}>
          Notes
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={notesFilter}
            onChange={(e) => setNotesFilter(e.target.value)}
            style={{
              padding: '6px 24px 6px 10px',
              borderRadius: 16,
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              appearance: 'none'
            }}
          >
            <option value="all">📋 All ({notes.length})</option>
            <option value="incomplete">☐ Incomplete</option>
            <option value="completed">✅ Completed</option>
            <option value="text">📝 Text ({notes.filter(n => n.type === 'text').length})</option>
            <option value="voice">🎤 Voice ({notes.filter(n => n.type === 'voice' || n.type === 'voice-text').length})</option>
          </select>
        </div>
      </div>

      {/* Input Area */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        border: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <textarea
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (text.trim()) addNote();
            }
          }}
          placeholder="Start typing... (auto-saves after 2s)\nTry: '- [ ] Task' or '[ ] Item' for checklists"
          style={{
            width: '100%',
            minHeight: 40,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: '#ffffff',
            fontSize: 16,
            lineHeight: 1.4,
            fontFamily: 'inherit',
            resize: 'none',
            outline: 'none'
          }}
          rows={1}
          onInput={(e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.max(40, e.target.scrollHeight) + 'px';
          }}
        />

        <div style={{
          fontSize: 12,
          color: 'rgba(255, 255, 255, 0.5)',
          marginTop: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>Use Cmd+Enter to save • Type '[ ]' for checkboxes</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => {
                const newText = text + (text && !text.endsWith('\n') ? '\n' : '') + '[ ] ';
                setText(newText);
              }}
              style={{
                padding: '6px 8px',
                borderRadius: 6,
                border: 'none',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.8)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500
              }}
              title="Add checkbox item"
            >
              <FontAwesomeIcon icon={faSquare} style={{ fontSize: 10 }} /> ✓
            </button>
            <span style={{ opacity: 0.7, fontSize: 11 }}>
              {text.length} chars {text.trim().length > 3 && !isRecording && '• auto-saving...'}
            </span>
          </div>
        </div>
      </div>

      {/* Notes List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredNotes.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 16,
            fontWeight: 400,
            padding: '40px 20px',
            fontStyle: 'italic'
          }}>
            {notesFilter === 'all' ? 'No notes yet' : `No ${notesFilter} notes found`}
          </div>
        )}

        {(showAllNotes ? filteredNotes : filteredNotes.slice(0, notesDisplayLimit)).map(note => (
          <NoteDisplay
            key={note.id}
            note={note}
            onToggleCheckbox={handleToggleCheckbox}
            onDelete={removeNote}
            onPlay={playVoiceNote}
            isPlaying={playingId === note.id}
          />
        ))}
      </div>
    </div>
  );
}