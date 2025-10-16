import { faCheck, faMicrophone, faPause, faPlay, faSquare, faSquareCheck, faStop, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deleteNote as dbDeleteNote, listNotes as dbListNotes, upsertNote as dbUpsertNote } from '../../db/index.js';
import '../../styles/default/NotesSections.css';
// Simple utility functions at module level to avoid hoisting issues
// Every note becomes a checklist - all content is actionable
const parseCheckboxText = (text) => {
  // Check if the entire note has a checkbox prefix
  const checkboxPattern = /^(\s*)([-*]?\s*)?(\[([\sxX])\]|[☐☑])\s*(.*)/s;
  const match = text.match(checkboxPattern);

  let isChecked = false;
  let content = text;

  if (match) {
    // Already has checkbox format
    const checkState = match[4] || '';
    isChecked = checkState === 'x' || checkState === 'X' || match[3] === '☑';
    content = match[5] || text;
  }

  return { isChecked, content, hasCheckbox: true };
};

const NoteCheckbox = ({ isChecked, content, onToggle }) => {
  return (
    <div className="checkbox-line">
      <button
        onClick={onToggle}
        className={`checkbox-toggle ${isChecked ? 'is-checked' : ''}`}
        title={isChecked ? 'Mark as incomplete' : 'Mark as complete'}
      >
        <FontAwesomeIcon icon={isChecked ? faSquareCheck : faSquare} />
      </button>
      <span className={`checkbox-text ${isChecked ? 'is-checked' : ''}`}>
        {content.split('\n').map((line, i) => (
          <React.Fragment key={i}>
            {line}
            {i < content.split('\n').length - 1 && <br />}
          </React.Fragment>
        ))}
      </span>
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
  const handleToggleCheckbox = async () => {
    const { isChecked, content } = parseCheckboxText(note.text || '');
    const newCheckedState = !isChecked;
    const checkSymbol = newCheckedState ? '[x]' : '[ ]';
    const updatedText = `${checkSymbol} ${content}`;
    onToggleCheckbox(note.id, updatedText);
  };

  const renderNoteContent = () => {
    const { isChecked, content } = parseCheckboxText(note.text || '');

    return (
      <NoteCheckbox
        isChecked={isChecked}
        content={content}
        onToggle={handleToggleCheckbox}
      />
    );
  };

  return (
    <div
      className="note-card"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="note-row">
        <div className="note-content">
          {/* All notes show content the same way - just checkboxes */}
          <div className="note-contentText">
            {renderNoteContent()}
          </div>
        </div>

        <div className={`note-sideActions ${isHovered ? 'is-visible' : ''}`}>
          {/* Date display inline with buttons */}
          <span className="note-date">
            {formatSmartDate(note.createdAt)}
          </span>
          {(note.type === 'voice' || note.type === 'voice-text') && note.audioData && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(note);
              }}
              className={`note-voiceBtn ${isPlaying ? 'is-playing' : ''}`}
              title={isPlaying ? "Stop playback" : "Play voice note"}
            >
              <FontAwesomeIcon
                icon={isPlaying ? faPause : faPlay}
                style={{ fontSize: 'var(--font-size-sm)' }}
              />
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(note.id);
            }}
            className="note-deleteBtn"
            title="Delete note"
          >
            <FontAwesomeIcon icon={faTrash} style={{ fontSize: 'var(--font-size-sm)' }} />
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
  const [transcribedText, setTranscribedText] = React.useState('');
  const [speechRecognition, setSpeechRecognition] = React.useState(null);
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

    // Add single checkbox prefix to the entire note
    const checkboxPattern = /^(\s*)([-*]?\s*)?(\[([\sxX])\]|[☐☑])\s*/;
    let checkboxText = t;
    
    // Only add checkbox if it doesn't already have one at the start
    if (!checkboxPattern.test(t)) {
      checkboxText = `[ ] ${t}`;
    }

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

  // Auto-resize textarea when text changes (including transcription)
  React.useEffect(() => {
    const textarea = document.querySelector('.notes-textarea');
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.max(40, textarea.scrollHeight) + 'px';
    }
  }, [text]);

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
      let capturedTranscript = ''; // Local variable to capture transcript
      const existingText = text.trim(); // Capture existing text before recording

      // Clear previous transcription
      setTranscribedText('');

      // Set up speech recognition for transcription
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          // Build complete transcript from all results
          let completeTranscript = '';
          for (let i = 0; i < event.results.length; i++) {
            completeTranscript += event.results[i][0].transcript + ' ';
          }

          const currentTranscript = completeTranscript.trim();
          capturedTranscript = currentTranscript; // Store in local variable
          setTranscribedText(currentTranscript);

          // Append transcribed text to existing text
          const combinedText = existingText
            ? `${existingText}\n${currentTranscript}`
            : currentTranscript;
          setText(combinedText);
        };

        recognition.onerror = (event) => {
          console.warn('[NotesSection] Speech recognition error:', event.error);
          // Don't fail the recording if speech recognition fails
        };

        recognition.onstart = () => {
          console.log('[NotesSection] Speech recognition started');
        };

        recognition.onend = () => {
          console.log('[NotesSection] Speech recognition ended');
          // Ensure final transcript is captured and appended
          if (capturedTranscript.trim()) {
            const combinedText = existingText
              ? `${existingText}\n${capturedTranscript.trim()}`
              : capturedTranscript.trim();
            setText(combinedText);
          }
        };

        try {
          recognition.start();
          setSpeechRecognition(recognition);
        } catch (error) {
          console.warn('[NotesSection] Failed to start speech recognition:', error);
        }
      } else {
        console.warn('[NotesSection] Speech recognition not supported in this browser');
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

        // Stop speech recognition and wait a bit for final processing
        if (speechRecognition) {
          try {
            speechRecognition.stop();
          } catch (error) {
            console.warn('[NotesSection] Error stopping speech recognition:', error);
          }
          setSpeechRecognition(null);
        }

        reader.onloadend = async () => {
          const base64data = reader.result.split(',')[1];

          // Wait a bit for speech recognition to finish processing
          await new Promise(resolve => setTimeout(resolve, 500));

          // Use captured transcript, current text field, or fallback
          const finalText = capturedTranscript.trim() || text.trim() || transcribedText.trim() || 'Voice note';

          // Don't auto-save - just keep the transcribed text in the input field
          // User can manually save with the Save button
          // The audio data is discarded if not saved manually
        };

        reader.readAsDataURL(blob);
        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
        setRecordingTime(0);
        setTranscribedText(''); // Clear transcribed text state but keep text in input
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
      setIsRecording(false);
      setRecordingTime(0);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }

      const errorMessage = error.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone permissions and try again.'
        : error.name === 'NotFoundError'
          ? 'No microphone found. Please check your audio devices.'
          : 'Could not access microphone. Please check permissions and try again.';

      alert(errorMessage);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
    }

    // Also stop speech recognition if it's running
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch (error) {
        console.warn('[NotesSection] Error stopping speech recognition in stopRecording:', error);
      }
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
      const { isChecked } = parseCheckboxText(text);

      if (isChecked) {
        counts.completed++;
      } else {
        counts.incomplete++;
      }
    });

    return counts;
  }, [notes]);

  // Filter notes - all notes now have checkboxes
  const filteredNotes = React.useMemo(() => {
    return notes.filter(note => {
      const text = note.text || '';
      const { isChecked } = parseCheckboxText(text);

      switch (notesFilter) {
        case 'incomplete':
          return !isChecked;
        case 'completed':
          return isChecked;
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
      // Stop speech recognition if component unmounts
      if (speechRecognition) {
        try {
          speechRecognition.stop();
        } catch (error) {
          console.warn('[NotesSection] Error stopping speech recognition during cleanup:', error);
        }
      }
    };
  }, [isRecording, mediaRecorder, speechRecognition]);

  return (
    <div className="notes-root">
      {/* Header */}
      <div className="notes-header">
        <h2 className="notes-title">Todos</h2>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={() => setNotesFilter(notesFilter === 'incomplete' ? 'completed' : 'incomplete')}
            className="notes-filterBtn"
            title={`Switch to ${notesFilter === 'incomplete' ? 'completed' : 'incomplete'} todos`}
          >
            <FontAwesomeIcon
              icon={notesFilter === 'incomplete' ? faSquare : faCheck}
              style={{ fontSize: 'calc(var(--font-size-xs) * 0.85)' }}
            />
            {notesFilter === 'incomplete' ? 'Todo' : 'Done'} ({filterCounts[notesFilter]})
          </button>
        </div>
      </div>
      <div className="notes-input">
        <div className="notes-inputRow">
          <textarea
            className="notes-textarea"
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (text.trim()) addNote();
              }
            }}
            placeholder="Add a todo item..."
            rows={1}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = Math.max(40, e.target.scrollHeight) + 'px';
            }}
          />
          <div className="notes-inlineActions">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`note-voiceBtn ${isRecording ? 'is-playing' : ''}`}
              title={isRecording ? `Stop recording ${formatRecordingTime(recordingTime)}` : 'Start voice recording'}
            >
              <FontAwesomeIcon icon={isRecording ? faStop : faMicrophone} style={{ color: 'currentColor' }} />
            </button>

            {!isRecording && (
              <button
                onClick={() => { if (text.trim()) addNote(); }}
                disabled={!text.trim()}
                className="note-voiceBtn"
                title="Save note as checklist"
              >
                <FontAwesomeIcon icon={faCheck} style={{ color: 'currentColor' }} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notes List */}
      <div className="notes-scrollable-container">
        {filteredNotes.length === 0 && (
          <div className="notes-emptyState">{`No ${notesFilter} todos found`}</div>
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