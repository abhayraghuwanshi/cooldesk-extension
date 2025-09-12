import { faCheck, faCircle, faClock, faEye, faMicrophone, faPause, faPlay, faSave, faStop, faTimes, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deleteNote as dbDeleteNote, listNotes as dbListNotes, upsertNote as dbUpsertNote } from '../../db/index.js';

export function NotesSection() {
  const [notes, setNotes] = React.useState([]);
  const [text, setText] = React.useState('');
  const [newNoteStatus, setNewNoteStatus] = React.useState('todo');
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

  // Notes display limit state
  const [notesDisplayLimit, setNotesDisplayLimit] = React.useState(6);
  const [showAllNotes, setShowAllNotes] = React.useState(false);

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
    const note = { id, text: t, type: 'text', status: newNoteStatus, createdAt: Date.now() };
    console.log('[NotesSection] Creating note:', note);
    try { 
      const result = await dbUpsertNote(note);
      console.log('[NotesSection] Note creation result:', result);
    } catch (error) {
      console.error('[NotesSection] Error creating note:', error);
    }
    if (!autoSave) {
      setText('');
      setNewNoteStatus('todo');
    }
    // Reload to reflect authoritative DB ordering and cap
    await loadNotes();
  }, [text, newNoteStatus, loadNotes]);

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
              status: newNoteStatus,
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
              status: newNoteStatus,
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
  }, [recordingMode, recordingTime, newNoteStatus, loadNotes]);

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

  // Todo status functions
  const getStatusIcon = React.useCallback((status) => {
    switch (status) {
      case 'done': return faCheck;
      case 'in-progress': return faClock;
      case 'todo':
      default: return faCircle;
    }
  }, []);

  const getStatusColor = React.useCallback((status) => {
    switch (status) {
      case 'done': return '#34C759';
      case 'in-progress': return '#FF9500';
      case 'todo':
      default: return 'rgba(255, 255, 255, 0.5)';
    }
  }, []);

  const getStatusLabel = React.useCallback((status) => {
    switch (status) {
      case 'done': return 'Done';
      case 'in-progress': return 'In Progress';
      case 'todo':
      default: return 'To Do';
    }
  }, []);

  const changeNoteStatus = React.useCallback(async (noteId, newStatus) => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    const updatedNote = { ...note, status: newStatus };
    console.log('[NotesSection] Changing note status:', updatedNote);
    try { 
      const result = await dbUpsertNote(updatedNote);
      console.log('[NotesSection] Note status change result:', result);
    } catch (error) {
      console.error('[NotesSection] Error changing note status:', error);
    }
    await loadNotes();
  }, [notes, loadNotes]);

  const toggleNotesDisplay = React.useCallback(() => {
    setShowAllNotes(!showAllNotes);
  }, [showAllNotes]);


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
          fontSize: 22,
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px'
        }}>
          Quick Todos
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
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
              fontSize: 11,
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
            {showAllNotes ? 'Recent' : `All (${notes.length})`}
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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (text.trim()) addNote();
            }
          }}
          placeholder={isRecording ? "🎤 Recording... speak now" : "Start typing... (auto-saves after 2s)"}
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
          fontSize: 12,
          color: 'rgba(255, 255, 255, 0.5)',
          marginTop: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                value={newNoteStatus}
                onChange={(e) => setNewNoteStatus(e.target.value)}
                style={{
                  padding: '6px 24px 6px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: getStatusColor(newNoteStatus),
                  fontSize: 12,
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
                title="Set initial status"
              >
                <option value="todo">To Do</option>
                <option value="in-progress">In Progress</option>
                <option value="done">Done</option>
              </select>
              <div style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                background: newNoteStatus === 'done' ? getStatusColor(newNoteStatus) : 'transparent',
                border: newNoteStatus !== 'done' ? `1.5px solid ${getStatusColor(newNoteStatus)}` : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <FontAwesomeIcon
                  icon={getStatusIcon(newNoteStatus)}
                  style={{
                    fontSize: newNoteStatus === 'done' ? 8 : 6,
                    color: newNoteStatus === 'done' ? 'white' : getStatusColor(newNoteStatus),
                    opacity: newNoteStatus === 'done' ? 1 : 0.8
                  }}
                />
              </div>
            </div>
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
                  fontSize: 11,
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
                fontSize: 10, 
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
                fontSize: 12,
                fontWeight: 500,
                minWidth: isRecording ? 'auto' : '32px'
              }}
              title={isRecording ? 'Stop recording' : `Start ${recordingMode === 'transcribe' ? 'speech-to-text' : 'audio'} recording`}
            >
              <FontAwesomeIcon icon={isRecording ? faStop : faMicrophone} style={{ fontSize: 10 }} />
              {isRecording && <span>{formatDuration(recordingTime)}</span>}
            </button>
            
            <span style={{ opacity: 0.7, fontSize: 11 }}>
              {text.length} chars {text.trim().length > 3 && !isRecording && '• auto-saving...'}
            </span>
          </div>
        </div>
      </div>

      {/* Apple Notes Style Note List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 16,
            fontWeight: 400,
            padding: '40px 20px',
            fontStyle: 'italic'
          }}>
            No notes yet
          </div>
        )}
        {(showAllNotes ? notes : notes.slice(0, notesDisplayLimit)).map(n => (
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
                    fontSize: 16,
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
                      fontSize: 14,
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
                      fontSize: 14,
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {/* Status Dropdown */}
                  <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                    <select
                      value={n.status || 'todo'}
                      onChange={(e) => {
                        e.stopPropagation();
                        changeNoteStatus(n.id, e.target.value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        padding: '6px 24px 6px 10px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: getStatusColor(n.status || 'todo'),
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        MozAppearance: 'none',
                        backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.6)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 6px center',
                        backgroundSize: '12px',
                        minWidth: 90,
                        transition: 'all 0.2s ease'
                      }}
                      title="Change status"
                    >
                      <option value="todo">To Do</option>
                      <option value="in-progress">In Progress</option>
                      <option value="done">Done</option>
                    </select>
                  </div>

                  {/* Status Icon */}
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    background: n.status === 'done' ? getStatusColor(n.status) : 'transparent',
                    border: n.status !== 'done' ? `2px solid ${getStatusColor(n.status)}` : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <FontAwesomeIcon
                      icon={getStatusIcon(n.status || 'todo')}
                      style={{
                        fontSize: n.status === 'done' ? 10 : 8,
                        color: n.status === 'done' ? 'white' : getStatusColor(n.status || 'todo'),
                        opacity: n.status === 'done' ? 1 : 0.8
                      }}
                    />
                  </div>
                </div>
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
                          <FontAwesomeIcon icon={faMicrophone} style={{ fontSize: 14, color: 'white' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 500, color: '#ffffff' }}>
                            {n.type === 'voice-text' ? 'Voice + Text Note' : 'Voice Note'}
                          </div>
                          <div style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.6)' }}>
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
                          fontSize: 14,
                          color: '#e5e7eb',
                          lineHeight: 1.4,
                          marginBottom: 8,
                          padding: '8px 12px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: 8,
                          border: '1px solid rgba(255, 255, 255, 0.1)'
                        }}>
                          {n.text}
                        </div>
                      )}
                      
                      <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.5)' }}>
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
                        fontSize: 16,
                        color: '#ffffff',
                        lineHeight: 1.4,
                        marginBottom: 8,
                        fontWeight: 400
                      }}>
                        {n.text}
                      </div>
                      <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.5)' }}>
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
                        style={{ fontSize: 12 }}
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
                    <FontAwesomeIcon icon={faTrash} style={{ fontSize: 12 }} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        
        {/* Notes limit indicator */}
        {!showAllNotes && notes.length > notesDisplayLimit && (
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
              fontSize: 12,
              fontWeight: 400
            }}>
              Showing {notesDisplayLimit} of {notes.length} notes
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
                fontSize: 11,
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
              <div style={{ fontSize: 14, color: '#e5e7eb' }}>
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
