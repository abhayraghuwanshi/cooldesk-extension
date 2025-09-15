import { faMicrophone, faPause, faPlay, faSquare, faSquareCheck, faStop, faTrash, faCheck, faListCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deleteNote as dbDeleteNote, listNotes as dbListNotes, upsertNote as dbUpsertNote } from '../../db/index.js';

// Simple utility functions at module level to avoid hoisting issues
// Every note becomes a checklist - all content is actionable
const parseCheckboxText = (text) => {
  const lines = text.split('\n').filter(line => line.trim()); // Remove empty lines

  const parsedLines = lines.map(line => {
    const checkboxPattern = /^(\s*)([-*]?\s*)?(\[([\sxX])\]|[☐☑])\s*(.*)/;
    const match = line.match(checkboxPattern);

    if (match) {
      // Already has checkbox format
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

    // Convert regular text to checkbox format
    return {
      type: 'checkbox',
      indent: '',
      bullet: '',
      checked: false, // All new items start unchecked
      content: line.trim(),
      originalLine: line
    };
  });

  return { lines: parsedLines, hasCheckboxes: true }; // Always has checkboxes now
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

// Smart date formatting function
const formatSmartDate = (timestamp) => {
  if (!timestamp) return '';

  const now = Date.now();
  const noteDate = new Date(timestamp);
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Less than 1 minute
  if (diffMins < 1) return 'now';

  // Less than 1 hour
  if (diffMins < 60) return `${diffMins}m`;

  // Less than 24 hours
  if (diffHours < 24) return `${diffHours}h`;

  // Less than 7 days
  if (diffDays < 7) return `${diffDays}d`;

  // Less than 30 days
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;

  // Older - show month/day
  return noteDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
};

const NoteDisplay = ({ note, onToggleCheckbox, onDelete, onEdit, onPlay, isPlaying }) => {
  const [isHovered, setIsHovered] = React.useState(false);
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
    const { lines } = parseCheckboxText(note.text || '');

    // All content is now checkbox-based
    return lines.map((line, lineIndex) => (
      <CheckboxLine
        key={lineIndex}
        line={line}
        lineIndex={lineIndex}
        onToggle={handleToggleCheckbox}
      />
    ));
  };

  return (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 10,
        padding: 12,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(10px)',
        transition: 'all 0.2s ease'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* All notes show content the same way - just checkboxes */}
          <div style={{
            fontSize: 16,
            color: '#ffffff',
            lineHeight: 1.4,
            fontWeight: 400
          }}>
            {renderNoteContent()}
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          opacity: isHovered ? 1 : 0,
          transform: isHovered ? 'translateX(0)' : 'translateX(8px)',
          transition: 'all 0.2s ease'
        }}>
          {/* Date display inline with buttons */}
          <span style={{
            fontSize: 10,
            color: 'rgba(255, 255, 255, 0.4)',
            fontWeight: 500,
            whiteSpace: 'nowrap'
          }}>
            {formatSmartDate(note.createdAt)}
          </span>
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
  const [notesFilter, setNotesFilter] = React.useState('incomplete');

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

  const addNote = async (noteText = text, autoSave = false, noteType = 'text', audioData = null) => {
    const t = (noteText || '').trim();
    if (!t) return;

    // Convert all new text to checkbox format automatically
    const lines = t.split('\n').filter(line => line.trim());
    const checkboxText = lines.map(line => {
      // If already has checkbox format, keep it
      const checkboxPattern = /^(\s*)([-*]?\s*)?(\[([\sxX])\]|[☐☑])\s*(.*)/;
      if (checkboxPattern.test(line)) {
        return line;
      }
      // Convert to checkbox format
      return `[ ] ${line.trim()}`;
    }).join('\n');

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const note = {
      id,
      text: checkboxText,
      type: noteType,
      createdAt: Date.now(),
      ...(audioData && { audioData })
    };

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

  const startRecording = async () => {
    if (isRecording) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      let recognition = null;
      let transcribedText = '';

      // Set up speech recognition for transcription
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          let interim = '';
          let final = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              final += transcript + ' ';
            } else {
              interim += transcript;
            }
          }

          transcribedText = final + interim;
          // Update text field in real-time during recording
          setText(transcribedText.trim());
        };

        recognition.onerror = (event) => {
          console.warn('[NotesSection] Speech recognition error:', event.error);
        };

        recognition.start();
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();

        // Stop speech recognition
        if (recognition) {
          recognition.stop();
        }

        reader.onloadend = async () => {
          const base64data = reader.result.split(',')[1];

          // Use transcribed text if available, otherwise fallback
          const finalText = transcribedText.trim() || text.trim() || 'Voice note';

          // Create voice note with both audio and transcribed text
          await addNote(finalText, false, 'voice', base64data);
          setText('');
        };

        reader.readAsDataURL(blob);
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

      // Start timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      recorder.start();
    } catch (error) {
      console.error('[NotesSection] Recording error:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
    }
  };

  const formatRecordingTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate filter counts
  const filterCounts = React.useMemo(() => {
    const counts = {
      incomplete: 0,
      completed: 0
    };

    notes.forEach(note => {
      // Count by completion status
      const text = note.text || '';
      const { lines } = parseCheckboxText(text);

      const hasIncomplete = lines.some(line => line.type === 'checkbox' && !line.checked);
      const hasCompleted = lines.some(line => line.type === 'checkbox' && line.checked);

      if (hasIncomplete && !hasCompleted) {
        counts.incomplete++;
      } else if (hasCompleted && !hasIncomplete) {
        counts.completed++;
      } else if (hasIncomplete && hasCompleted) {
        // Mixed notes count for both
        counts.incomplete++;
        counts.completed++;
      }
    });

    return counts;
  }, [notes]);

  // Filter notes - all notes now have checkboxes
  const filteredNotes = React.useMemo(() => {
    return notes.filter(note => {
      const text = note.text || '';
      const { lines } = parseCheckboxText(text);

      switch (notesFilter) {
        case 'incomplete': {
          return lines.some(line => line.type === 'checkbox' && !line.checked);
        }
        case 'completed': {
          return lines.some(line => line.type === 'checkbox' && line.checked);
        }
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
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      // Stop recording if component unmounts
      if (isRecording && mediaRecorder) {
        mediaRecorder.stop();
      }
    };
  }, [isRecording, mediaRecorder]);

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
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <FontAwesomeIcon icon={faListCheck} style={{ color: '#34C759', fontSize: 18 }} />
          Todos
        </h2>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={() => setNotesFilter(notesFilter === 'incomplete' ? 'completed' : 'incomplete')}
            style={{
              padding: '6px 12px',
              borderRadius: 16,
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s ease'
            }}
            title={`Switch to ${notesFilter === 'incomplete' ? 'completed' : 'incomplete'} todos`}
          >
            <FontAwesomeIcon
              icon={notesFilter === 'incomplete' ? faSquare : faCheck}
              style={{ fontSize: 10 }}
            />
            {notesFilter === 'incomplete' ? 'Todo' : 'Done'} ({filterCounts[notesFilter]})
          </button>
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
          placeholder="Add a todo item..."
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
          <span>Use Cmd+Enter to save • All notes become checkboxes automatically</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Voice Recording Button */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              style={{
                padding: '6px 8px',
                borderRadius: 6,
                border: 'none',
                background: isRecording ? '#FF3B30' : 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.2s ease'
              }}
              title={isRecording ? 'Stop recording and transcribe' : 'Start voice recording with auto-transcription'}
            >
              <FontAwesomeIcon
                icon={isRecording ? faStop : faMicrophone}
                style={{ fontSize: 10 }}
              />
              {isRecording ? `Stop ${formatRecordingTime(recordingTime)}` : 'Voice'}
            </button>

            {/* Save Button */}
            <button
              onClick={() => {
                if (text.trim()) addNote();
              }}
              disabled={!text.trim()}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                background: text.trim() ? '#34C759' : 'rgba(255, 255, 255, 0.05)',
                color: text.trim() ? 'white' : 'rgba(255, 255, 255, 0.3)',
                cursor: text.trim() ? 'pointer' : 'not-allowed',
                fontSize: 11,
                fontWeight: 500,
                transition: 'all 0.2s ease'
              }}
              title="Save note as checklist"
            >
              Save
            </button>

            <span style={{ opacity: 0.7, fontSize: 11 }}>
              {text.length} chars
            </span>
          </div>
        </div>
      </div>

      {/* Notes List */}
      <div
        className="notes-scrollable-container"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxHeight: '350px',
          overflowY: 'auto',
          paddingRight: '4px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255, 255, 255, 0.3) transparent'
        }}
      >
        {filteredNotes.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 16,
            fontWeight: 400,
            padding: '40px 20px',
            fontStyle: 'italic'
          }}>
            {`No ${notesFilter} todos found`}
          </div>
        )}

        {filteredNotes.map(note => (
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