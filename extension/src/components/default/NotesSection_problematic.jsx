import { faEye, faMicrophone, faPause, faPlay, faStop, faTimes, faTrash, faSquareCheck, faSquare } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deleteNote as dbDeleteNote, listNotes as dbListNotes, upsertNote as dbUpsertNote } from '../../db/index.js';

export function NotesSection() {
  const [notes, setNotes] = React.useState([]);
  const [text, setText] = React.useState('');
  // Removed status system - now pure checklist
  const [editingId, setEditingId] = React.useState(null);
  const [editText, setEditText] = React.useState('');

  // Unified recording state
  const [isRecording, setIsRecording] = React.useState(false);
  const [recordingMode, setRecordingMode] = React.useState('transcribe'); // 'transcribe' or 'audio'
  const [mediaRecorder, setMediaRecorder] = React.useState(null);
  const [recordingTime, setRecordingTime] = React.useState(0);
  const [playingId, setPlayingId] = React.useState(null);
  const recordingTimerRef = React.useRef(null);
  const audioRefs = React.useRef({});
  const [previewNote, setPreviewNote] = React.useState(null);
  
  // Speech-to-text state (only for transcribe mode)
  const [transcribedText, setTranscribedText] = React.useState('');
  const recognitionRef = React.useRef(null);
  
  // Auto-save for text input
  const autoSaveTimeoutRef = React.useRef(null);

  // Checkbox parsing is now inlined to avoid dependency issues

  const renderCheckboxLine = React.useCallback((lineObj, lineIndex, onToggle) => {
    if (lineObj.type === 'checkbox') {
      return (
        <div key={lineIndex} style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          marginBottom: 4,
          paddingLeft: lineObj.indent.length * 16
        }}>
          <button
            onClick={() => onToggle(lineIndex)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              marginTop: 2,
              color: lineObj.checked ? '#34C759' : 'rgba(255, 255, 255, 0.6)',
              fontSize: 'var(--font-size-lg)',
              transition: 'color 0.2s ease'
            }}
            title={lineObj.checked ? 'Mark as incomplete' : 'Mark as complete'}
          >
            <FontAwesomeIcon icon={lineObj.checked ? faSquareCheck : faSquare} />
          </button>
          <span style={{
            color: lineObj.checked ? 'rgba(255, 255, 255, 0.5)' : '#ffffff',
            textDecoration: lineObj.checked ? 'line-through' : 'none',
            flex: 1,
            lineHeight: 1.4,
            fontSize: 'var(--font-size-lg)'
          }}>
            {lineObj.content}
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
        {lineObj.content}
      </div>
    );
  }, []);

  const toggleCheckbox = React.useCallback(async (noteId, lineIndex) => {
    const note = notes.find(n => n.id === noteId);
    if (!note || !note.text) return;

    // Inline parseCheckboxes to avoid dependency issues
    const lines = note.text.split('\n');
    const parsedLines = lines.map(line => {
      const checkboxPattern = /^(\s*)([-*]?\s*)?(\[([\sxX])\]|[☐☑])\s*(.*)/;
      const match = line.match(checkboxPattern);

      if (match) {
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

    if (lineIndex >= 0 && lineIndex < parsedLines.length && parsedLines[lineIndex].type === 'checkbox') {
      parsedLines[lineIndex].checked = !parsedLines[lineIndex].checked;

      // Reconstruct the text with updated checkbox states and sort completed items to bottom
      const checkboxLines = parsedLines.filter(line => line.type === 'checkbox');
      const textLines = parsedLines.filter(line => line.type === 'text');

      // Sort checkbox lines - incomplete first, then completed
      const sortedCheckboxLines = [
        ...checkboxLines.filter(line => !line.checked),
        ...checkboxLines.filter(line => line.checked)
      ];

      // Combine text lines and sorted checkbox lines
      const allSortedLines = [...textLines, ...sortedCheckboxLines];

      const updatedText = allSortedLines.map(line => {
        if (line.type === 'checkbox') {
          const checkSymbol = line.checked ? '[x]' : '[ ]';
          return `${line.indent}${line.bullet}${checkSymbol} ${line.content}`;
        }
        return line.content;
      }).join('\n');

      const updatedNote = { ...note, text: updatedText };

      try {
        await dbUpsertNote(updatedNote);
        await loadNotes();
      } catch (error) {
        console.error('[NotesSection] Error toggling checkbox:', error);
      }
    }
  }, [notes, loadNotes]);

  // Enhanced text input to support checkbox creation
  const handleCheckboxShortcut = React.useCallback((e, currentText, cursorPosition) => {
    if (e.key === ' ') {
      const textBeforeCursor = currentText.substring(0, cursorPosition);
      const textAfterCursor = currentText.substring(cursorPosition);
      const lines = textBeforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];

      // Check for checkbox creation patterns
      const patterns = [
        { pattern: /^(\s*)([-*])$/, replacement: '$1$2 [ ] ' },
        { pattern: /^(\s*)\[$/, replacement: '$1[ ] ' },
        { pattern: /^(\s*)\[\]$/, replacement: '$1[ ] ' }
      ];

      for (const { pattern, replacement } of patterns) {
        if (pattern.test(currentLine)) {
          e.preventDefault();
          const newCurrentLine = currentLine.replace(pattern, replacement);
          const newLines = [...lines.slice(0, -1), newCurrentLine];
          const newText = newLines.join('\n') + textAfterCursor;

          return { newText, newCursorPosition: newLines.join('\n').length };
        }
      }
    }

    // Auto-create new checkbox item on Enter
    if (e.key === 'Enter') {
      const textBeforeCursor = currentText.substring(0, cursorPosition);
      const lines = textBeforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];

      const checkboxPattern = /^(\s*)([-*]?\s*)\[([\sxX])\]\s*(.*)/;
      const match = currentLine.match(checkboxPattern);

      if (match) {
        const indent = match[1] || '';
        const bullet = match[2] || '';
        const content = match[4] || '';

        // If current line is empty checkbox, remove it
        if (!content.trim()) {
          e.preventDefault();
          const newLines = lines.slice(0, -1);
          const newText = newLines.join('\n') + currentText.substring(cursorPosition);
          return { newText, newCursorPosition: newLines.join('\n').length };
        }

        // Create new checkbox item
        e.preventDefault();
        const newCheckboxLine = `\n${indent}${bullet}[ ] `;
        const textAfterCursor = currentText.substring(cursorPosition);
        const newText = textBeforeCursor + newCheckboxLine + textAfterCursor;
        return { newText, newCursorPosition: textBeforeCursor.length + newCheckboxLine.length };
      }
    }

    return null;
  }, []);

  const handleTextInputKeyDown = React.useCallback((e) => {
    const textarea = e.target;
    const cursorPosition = textarea.selectionStart;
    const result = handleCheckboxShortcut(e, text, cursorPosition);

    if (result) {
      setText(result.newText);
      // Set cursor position after state update
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = result.newCursorPosition;
      }, 0);
    }
  }, [text, handleCheckboxShortcut]);

  // Notes display limit state
  const [notesDisplayLimit, setNotesDisplayLimit] = React.useState(6);
  const [showAllNotes, setShowAllNotes] = React.useState(false);

  // Filter state
  const [notesFilter, setNotesFilter] = React.useState('all');

  const loadNotes = React.useCallback(async () => {
    try {
      console.log('[NotesSection] Loading notes...');
      const list = await dbListNotes();
      console.log('[NotesSection] Notes result:', list);
      const notesData = list?.data || list || [];
      console.log('[NotesSection] Extracted notes data:', notesData);
      setNotes(Array.isArray(notesData) ? notesData : []);
    } catch (error) { 
      console.error('[NotesSection] Error loading notes:', error);
      setNotes([]); 
    }
  }, []);

  const addNote = React.useCallback(async (noteText = text, autoSave = false) => {
    const t = (noteText || '').trim();
    if (!t) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const note = { id, text: t, type: 'text', createdAt: Date.now() };
    console.log('[NotesSection] Creating note:', note);
    try { 
      const result = await dbUpsertNote(note);
      console.log('[NotesSection] Note creation result:', result);
    } catch (error) {
      console.error('[NotesSection] Error creating note:', error);
    }
    if (!autoSave) {
      setText('');
    }
    // Reload to reflect authoritative DB ordering and cap
    await loadNotes();
  }, [text, loadNotes]);

  // Auto-save text after user stops typing
  const handleTextChange = React.useCallback((newText) => {
    setText(newText);
    
    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    // Only auto-save if there's meaningful content
    if (newText.trim().length > 3) {
      autoSaveTimeoutRef.current = setTimeout(() => {
        addNote(newText, true);
        setText(''); // Clear input after auto-save
      }, 2000); // Auto-save after 2 seconds of no typing
    }
  }, [addNote]);

  // Unified recording function
  const startRecording = React.useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      let finalTranscript = '';
      let interimTranscript = '';
      let recognition = null;

      // Set up speech recognition if in transcribe mode
      if (recordingMode === 'transcribe') {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
          alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
          return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          interimTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            
            if (event.results[i].isFinal) {
              finalTranscript += transcript + ' ';
            } else {
              interimTranscript += transcript;
            }
          }
          
          // Update the displayed text with both final and interim results
          const fullText = (finalTranscript + interimTranscript).trim();
          setTranscribedText(fullText);
          setText(fullText);
        };

        recognition.onerror = (event) => {
          console.error('[NotesSection] Speech recognition error:', event.error);
          if (event.error === 'not-allowed') {
            alert('Microphone access denied. Please allow microphone access and try again.');
          } else {
            alert(`Speech recognition error: ${event.error}`);
          }
          stopRecording();
        };

        recognition.onend = () => {
          console.log('[NotesSection] Speech recognition ended');
          if (recorder && recorder.state === 'recording') {
            recorder.stop();
          }
        };
      }

      // When audio recording stops, process the note
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(',')[1];
          const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          
          let note;
          if (recordingMode === 'transcribe') {
            // Create hybrid voice+text note
            note = {
              id,
              type: 'voice-text',
              audioData: base64Audio,
              text: finalTranscript.trim() || 'Voice note (transcription failed)',
              duration: recordingTime,
              createdAt: Date.now(),
              hasTranscription: !!finalTranscript.trim()
            };
          } else {
            // Create audio-only note
            note = {
              id,
              type: 'voice',
              audioData: base64Audio,
              duration: recordingTime,
              createdAt: Date.now()
            };
          }
          
          console.log(`[NotesSection] Creating ${recordingMode} note:`, note);
          try { 
            const result = await dbUpsertNote(note);
            console.log('[NotesSection] Note creation result:', result);
          } catch (error) {
            console.error('[NotesSection] Error creating note:', error);
          }
          await loadNotes();
        };
        
        reader.readAsDataURL(blob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      // Start recording
      setMediaRecorder(recorder);
      setIsRecording(true);
      setRecordingTime(0);
      setText('');
      setTranscribedText('');
      
      recorder.start();
      
      if (recognition) {
        recognitionRef.current = recognition;
        recognition.start();
      }

      // Start timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('[NotesSection] Error starting recording:', error);
      alert('Could not access microphone. Please check permissions and try again.');
    }
  }, [recordingMode, recordingTime, loadNotes]);

  const stopRecording = React.useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      setMediaRecorder(null);
    }

    setIsRecording(false);
    
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    // Clear text after recording stops
    setText('');
    setTranscribedText('');
  }, [mediaRecorder]);

  const playVoiceNote = React.useCallback((note) => {
    if (playingId === note.id) {
      // Stop current playback
      if (audioRefs.current[note.id]) {
        audioRefs.current[note.id].pause();
        audioRefs.current[note.id].currentTime = 0;
      }
      setPlayingId(null);
      return;
    }

    // Stop any other playing audio
    Object.values(audioRefs.current).forEach(audio => {
      audio.pause();
      audio.currentTime = 0;
    });

    const audio = new Audio(`data:audio/webm;base64,${note.audioData}`);
    audioRefs.current[note.id] = audio;

    audio.onended = () => setPlayingId(null);
    audio.onerror = () => {
      console.error('Error playing audio');
      setPlayingId(null);
    };

    setPlayingId(note.id);
    audio.play().catch(err => {
      console.error('Error playing audio:', err);
      setPlayingId(null);
    });
  }, [playingId]);

  const formatDuration = React.useCallback((seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const removeNote = React.useCallback(async (id) => {
    console.log('[NotesSection] Deleting note:', id);
    try { 
      const result = await dbDeleteNote(id);
      console.log('[NotesSection] Note deletion result:', result);
    } catch (error) {
      console.error('[NotesSection] Error deleting note:', error);
    }
    await loadNotes();
  }, [loadNotes]);

  const startEdit = React.useCallback((n) => {
    setEditingId(n.id);
    setEditText(n.text || '');
  }, []);

  const saveEdit = React.useCallback(async () => {
    const t = (editText || '').trim();
    if (!editingId) return setEditingId(null);
    const existing = notes.find(n => n.id === editingId) || { id: editingId, createdAt: Date.now() };
    const updated = { ...existing, text: t };
    console.log('[NotesSection] Saving edited note:', updated);
    try { 
      const result = await dbUpsertNote(updated);
      console.log('[NotesSection] Note edit result:', result);
    } catch (error) {
      console.error('[NotesSection] Error saving edited note:', error);
    }
    await loadNotes();
    setEditingId(null);
    setEditText('');
  }, [editText, editingId, notes, loadNotes]);

  const cancelEdit = React.useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  const openPreview = React.useCallback((n) => {
    setPreviewNote(n);
  }, []);

  const closePreview = React.useCallback(() => setPreviewNote(null), []);

  // Removed status functions - now pure checklist based

  const toggleNotesDisplay = React.useCallback(() => {
    setShowAllNotes(!showAllNotes);
  }, [showAllNotes]);

  // Filter notes based on selected filter
  const filteredNotes = React.useMemo(() => {
    if (notesFilter === 'all') return notes;

    return notes.filter(note => {
      // Inline checkbox parsing for filtering
      const text = note.text || '';
      const lines = text.split('\n');
      const checkboxPattern = /^(\s*)([-*]?\s*)?(\[([\sxX])\]|[☐☑])\s*(.*)/;

      let hasCheckboxes = false;
      let hasIncomplete = false;
      let hasCompleted = false;

      for (const line of lines) {
        const match = line.match(checkboxPattern);
        if (match) {
          hasCheckboxes = true;
          const checkState = match[4] || '';
          const checkbox = match[3] || '';
          const isChecked = checkState === 'x' || checkState === 'X' || checkbox === '☑';

          if (isChecked) {
            hasCompleted = true;
          } else {
            hasIncomplete = true;
          }
        }
      }

      switch (notesFilter) {
        case 'incomplete':
          return hasCheckboxes && hasIncomplete;
        case 'completed':
          return hasCheckboxes && hasCompleted;
        case 'text':
          return note.type === 'text';
        case 'voice':
          return note.type === 'voice' || note.type === 'voice-text';
        default:
          return true;
      }
    });
  }, [notes, notesFilter]);


  React.useEffect(() => { loadNotes(); }, [loadNotes]);

  // Cleanup auto-save timeout on unmount
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
      {/* Apple Notes Style Header */}
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
              fontSize: 'var(--font-size-xs)',
              fontWeight: 500,
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.6)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 6px center',
              backgroundSize: '12px',
              minWidth: 85,
              transition: 'all 0.2s ease'
            }}
            title="Filter notes"
          >
            <option value="all">📋 All ({notes.length})</option>
            <option value="incomplete">☐ Incomplete</option>
            <option value="completed">✅ Completed</option>
            <option value="text">📝 Text ({notes.filter(n => n.type === 'text').length})</option>
            <option value="voice">🎤 Voice ({notes.filter(n => n.type === 'voice' || n.type === 'voice-text').length})</option>
          </select>
          <button
            onClick={toggleNotesDisplay}
            style={{
              padding: '6px 12px',
              borderRadius: 16,
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 500
            }}
            title={showAllNotes ? 'Show recent only' : 'Show all notes'}
            onMouseEnter={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.15)';
              e.target.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.1)';
              e.target.style.color = 'rgba(255, 255, 255, 0.8)';
            }}
          >
            {showAllNotes ? 'Recent' : `All (${filteredNotes.length})`}
          </button>
        </div>
      </div>

      {/* Apple Notes Style Input */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(10px)'
      }}>
        <textarea
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={(e) => {
            // Handle checkbox shortcuts first
            handleTextInputKeyDown(e);

            // Then handle note creation
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (text.trim()) addNote();
            }
          }}
          placeholder={isRecording ? "🎤 Recording... speak now" : "Start typing... (auto-saves after 2s)\nTry: '- [ ] Task' or '[ ] Item' for checklists"}
          style={{
            width: '100%',
            minHeight: 40,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: '#ffffff',
            fontSize: 'var(--font-size-lg)',
            lineHeight: 1.4,
            fontFamily: 'inherit',
            resize: 'none',
            outline: 'none',
            '::placeholder': { color: 'rgba(255, 255, 255, 0.5)' }
          }}
          rows={1}
          onInput={(e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.max(40, e.target.scrollHeight) + 'px';
          }}
        />
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'rgba(255, 255, 255, 0.5)',
          marginTop: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'rgba(255, 255, 255, 0.6)' }}>
              Use Cmd+Enter to save • Type '[ ]' for checkboxes
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Recording Mode Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                value={recordingMode}
                onChange={(e) => setRecordingMode(e.target.value)}
                disabled={isRecording}
                style={{
                  padding: '6px 24px 6px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: recordingMode === 'transcribe' ? '#34C759' : '#FF9500',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 500,
                  cursor: isRecording ? 'not-allowed' : 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.6)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 6px center',
                  backgroundSize: '12px',
                  minWidth: 85,
                  transition: 'all 0.2s ease',
                  opacity: isRecording ? 0.5 : 1
                }}
                title="Select recording mode"
              >
                <option value="transcribe">Transcribe</option>
                <option value="audio">Audio Only</option>
              </select>
              <span style={{ 
                fontSize: 'calc(var(--font-size-xs) * 0.85)', 
                color: 'rgba(255, 255, 255, 0.5)',
                fontWeight: 500
              }}>
                {recordingMode === 'transcribe' ? '📝+🎙️' : '🎙️'}
              </span>
            </div>
            
            {/* Unified Recording Button */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              style={{
                padding: isRecording ? '6px 12px' : '6px 8px',
                borderRadius: 6,
                border: 'none',
                background: isRecording ? '#FF3B30' : (recordingMode === 'transcribe' ? '#34C759' : '#FF9500'),
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 500,
                minWidth: isRecording ? 'auto' : '32px'
              }}
              title={isRecording ? 'Stop recording' : `Start ${recordingMode === 'transcribe' ? 'speech-to-text' : 'audio'} recording`}
            >
              <FontAwesomeIcon icon={isRecording ? faStop : faMicrophone} style={{ fontSize: 'calc(var(--font-size-xs) * 0.85)' }} />
              {isRecording && <span>{formatDuration(recordingTime)}</span>}
            </button>

            {/* Quick Checkbox Button */}
            <button
              onClick={() => {
                const newText = text + (text && !text.endsWith('\n') ? '\n' : '') + '[ ] ';
                setText(newText);
                // Focus textarea and set cursor at end
                setTimeout(() => {
                  const textarea = document.querySelector('textarea');
                  if (textarea) {
                    textarea.focus();
                    textarea.selectionStart = textarea.selectionEnd = newText.length;
                  }
                }, 0);
              }}
              style={{
                padding: '6px 8px',
                borderRadius: 6,
                border: 'none',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 500
              }}
              title="Add checkbox item"
              onMouseEnter={(e) => {
                e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                e.target.style.color = '#ffffff';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                e.target.style.color = 'rgba(255, 255, 255, 0.8)';
              }}
            >
              <FontAwesomeIcon icon={faSquare} style={{ fontSize: 'calc(var(--font-size-xs) * 0.85)' }} />
              ✓
            </button>

            <span style={{ opacity: 0.7, fontSize: 'var(--font-size-xs)' }}>
              {text.length} chars {text.trim().length > 3 && !isRecording && '• auto-saving...'}
            </span>
          </div>
        </div>
      </div>

      {/* Apple Notes Style Note List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredNotes.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 400,
            padding: '40px 20px',
            fontStyle: 'italic'
          }}>
            {notesFilter === 'all' ? 'No notes yet' : `No ${notesFilter} notes found`}
          </div>
        )}
        {(showAllNotes ? filteredNotes : filteredNotes.slice(0, notesDisplayLimit)).map(n => (
          <div
            key={n.id}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.2s ease',
              cursor: (n.type === 'text' || (n.type === 'voice-text' && n.text)) && editingId !== n.id ? 'pointer' : 'default'
            }}
            onClick={() => (n.type === 'text' || (n.type === 'voice-text' && n.text)) && editingId !== n.id && startEdit(n)}
            onMouseEnter={(e) => {
              if ((n.type === 'text' || (n.type === 'voice-text' && n.text)) && editingId !== n.id) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if ((n.type === 'text' || (n.type === 'voice-text' && n.text)) && editingId !== n.id) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
          >
            {editingId === n.id && (n.type === 'text' || n.type === 'voice-text') ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  autoFocus
                  style={{
                    width: '100%',
                    minHeight: 60,
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
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.max(60, e.target.scrollHeight) + 'px';
                  }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={cancelEdit}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: '#ffffff',
                      fontSize: 'var(--font-size-base)',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: '#007AFF',
                      color: 'white',
                      fontSize: 'var(--font-size-base)',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {n.type === 'voice' || n.type === 'voice-text' ? (
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
                          background: n.type === 'voice-text' ? '#007AFF' : '#34C759',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <FontAwesomeIcon icon={faMicrophone} style={{ fontSize: 'var(--font-size-base)', color: 'white' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 500, color: '#ffffff' }}>
                            {n.type === 'voice-text' ? 'Voice + Text Note' : 'Voice Note'}
                          </div>
                          <div style={{ fontSize: 'var(--font-size-base)', color: 'rgba(255, 255, 255, 0.6)' }}>
                            {formatDuration(n.duration || 0)}
                            {n.type === 'voice-text' && n.hasTranscription && (
                              <span style={{ marginLeft: 8, color: '#34C759' }}>✓ Transcribed</span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Show transcribed text for voice-text notes */}
                      {n.type === 'voice-text' && n.text && (
                        <div style={{
                          fontSize: 'var(--font-size-base)',
                          color: '#e5e7eb',
                          lineHeight: 1.4,
                          marginBottom: 8,
                          padding: '8px 12px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: 8,
                          border: '1px solid rgba(255, 255, 255, 0.1)'
                        }}>
                          {(() => {
                            const text = n.text || '';
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

                            if (hasCheckboxes) {
                              return parsedLines.map((line, lineIndex) =>
                                renderCheckboxLine(line, lineIndex, (idx) => toggleCheckbox(n.id, idx))
                              );
                            }
                            return n.text;
                          })()}
                        </div>
                      )}
                      
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'rgba(255, 255, 255, 0.5)' }}>
                        {n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-US', {
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
                        fontSize: 'var(--font-size-lg)',
                        color: '#ffffff',
                        lineHeight: 1.4,
                        marginBottom: 8,
                        fontWeight: 400
                      }}>
                        {(() => {
                          const text = n.text || '';
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

                          if (hasCheckboxes) {
                            return parsedLines.map((line, lineIndex) =>
                              renderCheckboxLine(line, lineIndex, (idx) => toggleCheckbox(n.id, idx))
                            );
                          }
                          return n.text;
                        })()}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'rgba(255, 255, 255, 0.5)' }}>
                        {n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-US', {
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
                  {(n.type === 'voice' || n.type === 'voice-text') && n.audioData && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        playVoiceNote(n);
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        border: 'none',
                        background: playingId === n.id ? '#FF9500' : 'rgba(255, 255, 255, 0.1)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      title={playingId === n.id ? "Stop playback" : "Play voice note"}
                    >
                      <FontAwesomeIcon
                        icon={playingId === n.id ? faPause : faPlay}
                        style={{ fontSize: 'var(--font-size-sm)' }}
                      />
                    </button>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeNote(n.id);
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
            )}
          </div>
        ))}
        
        {/* Notes limit indicator */}
        {!showAllNotes && filteredNotes.length > notesDisplayLimit && (
          <div style={{
            textAlign: 'center',
            marginTop: 12,
            padding: '8px 16px',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <span style={{
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 400
            }}>
              Showing {notesDisplayLimit} of {filteredNotes.length} notes
            </span>
            <button
              onClick={toggleNotesDisplay}
              style={{
                marginLeft: 8,
                padding: '4px 8px',
                borderRadius: 4,
                border: 'none',
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#007AFF',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 500,
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
              Show All
            </button>
          </div>
        )}
      </div>

      {previewNote && (
        <div
          onClick={closePreview}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2147483647
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(640px, 90vw)', maxHeight: '80vh', background: '#0f1724',
              border: '1px solid #273043', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
              display: 'flex', flexDirection: 'column'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #273043' }}>
              <div style={{ fontSize: 'var(--font-size-base)', color: '#e5e7eb' }}>
                <FontAwesomeIcon icon={faEye} style={{ marginRight: 8, color: '#10b981' }} />
                {previewNote.type === 'text' ? 'Text Note' : 'Note'}
              </div>
              <button onClick={closePreview} className="icon-btn" style={{ width: 70, height: 28 }}>Close</button>
            </div>
            <div style={{ padding: 12, overflowY: 'auto', maxHeight: 'calc(80vh - 48px)', color: '#e5e7eb', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
              {previewNote.type === 'text' ? (previewNote.text || '') : (
                <div style={{ color: '#9ca3af' }}>Preview available for text notes.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
