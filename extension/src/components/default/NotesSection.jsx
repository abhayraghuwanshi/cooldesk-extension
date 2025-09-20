import { faCheck, faListCheck, faMicrophone, faPause, faPlay, faSquare, faSquareCheck, faStop, faTrash } from '@fortawesome/free-solid-svg-icons';
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
            fontSize: 'var(--font-size-lg)',
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
          fontSize: 'var(--font-size-lg)'
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
      fontSize: 'var(--font-size-lg)'
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
            fontSize: 'var(--font-size-lg)',
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
            fontSize: 'calc(var(--font-size-xs) * 0.85)',
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
                style={{ fontSize: 'var(--font-size-sm)' }}
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
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <FontAwesomeIcon icon={faListCheck} style={{ color: '#34C759', fontSize: 'var(--font-size-xl)' }} />
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
              fontSize: 'var(--font-size-xs)',
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
              style={{ fontSize: 'calc(var(--font-size-xs) * 0.85)' }}
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
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8
        }}>
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
            style={{
              flex: 1,
              minHeight: 40,
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: '#ffffff',
              fontSize: 'var(--font-size-lg)',
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

          {/* Inline Action Buttons */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0
          }}>
            {/* Recording Button */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                border: '1px solid',
                borderColor: isRecording ? '#FF3B30' : 'var(--border-color, rgba(255, 255, 255, 0.2))',
                background: isRecording
                  ? 'linear-gradient(135deg, #FF3B30, #FF6B60)'
                  : 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
                color: isRecording ? 'white' : 'var(--text-primary, #ffffff)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '16px',
                transition: 'all 0.2s ease',
                backdropFilter: 'blur(10px)',
                boxShadow: isRecording ? '0 0 20px rgba(255, 59, 48, 0.4)' : '0 2px 8px rgba(0, 0, 0, 0.1)'
              }}
              title={isRecording ? `Stop recording ${formatRecordingTime(recordingTime)}` : "Start voice recording"}
              onMouseEnter={(e) => {
                if (!isRecording) {
                  e.target.style.background = 'var(--glass-bg, rgba(255, 255, 255, 0.15))';
                  e.target.style.borderColor = 'var(--primary, #60a5fa)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isRecording) {
                  e.target.style.background = 'var(--glass-bg, rgba(255, 255, 255, 0.1))';
                  e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.2))';
                }
              }}
            >
              <FontAwesomeIcon
                icon={isRecording ? faStop : faMicrophone}
                style={{ color: 'currentColor' }}
              />
            </button>

            {/* Save Button */}
            {!isRecording && (
              <button
                onClick={() => {
                  if (text.trim()) addNote();
                }}
                disabled={!text.trim()}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  border: '1px solid',
                  borderColor: text.trim() ? '#34C759' : 'var(--border-color, rgba(255, 255, 255, 0.1))',
                  background: text.trim()
                    ? 'linear-gradient(135deg, #34C759, #4CD964)'
                    : 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
                  color: text.trim() ? 'white' : 'var(--text-dim, rgba(255, 255, 255, 0.4))',
                  cursor: text.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '16px',
                  fontWeight: 500,
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(10px)',
                  boxShadow: text.trim() ? '0 2px 8px rgba(52, 199, 89, 0.2)' : '0 1px 4px rgba(0, 0, 0, 0.1)'
                }}
                title="Save note as checklist"
                onMouseEnter={(e) => {
                  if (text.trim()) {
                    e.target.style.background = 'linear-gradient(135deg, #4CD964, #5DE75A)';
                    e.target.style.transform = 'translateY(-1px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (text.trim()) {
                    e.target.style.background = 'linear-gradient(135deg, #34C759, #4CD964)';
                    e.target.style.transform = 'translateY(0)';
                  }
                }}
              >
                <FontAwesomeIcon
                  icon={faCheck}
                  style={{ color: 'currentColor' }}
                />
              </button>
            )}
          </div>
        </div>

        {/* Status Row */}
        {(isRecording || text.length > 0) && (
          <div style={{
            marginTop: 8,
            fontSize: 'var(--font-size-xs)',
            color: 'rgba(255, 255, 255, 0.5)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>
              {isRecording ? (
                <span style={{ color: '#FF3B30', fontWeight: 600 }}>
                  🔴 Recording {formatRecordingTime(recordingTime)}
                  {transcribedText && ' • Transcribing...'}
                </span>
              ) : (
                'Cmd+Enter to save'
              )}
            </span>
            <span style={{ opacity: 0.7 }}>
              {text.length} chars
            </span>
          </div>
        )}
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
            fontSize: 'var(--font-size-lg)',
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