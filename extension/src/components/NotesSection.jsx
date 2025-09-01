import { faPlus, faPen, faTrash, faMicrophone, faStop, faPlay, faPause, faEye, faCalendarDay, faChevronDown, faChevronRight, faSave, faTimes, faExternalLinkAlt } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deleteNote as dbDeleteNote, listNotes as dbListNotes, upsertNote as dbUpsertNote } from '../db';

export function NotesSection() {
  const [notes, setNotes] = React.useState([]);
  const [text, setText] = React.useState('');
  const [editingId, setEditingId] = React.useState(null);
  const [editText, setEditText] = React.useState('');
  
  // Voice recording state
  const [isRecording, setIsRecording] = React.useState(false);
  const [mediaRecorder, setMediaRecorder] = React.useState(null);
  const [recordingTime, setRecordingTime] = React.useState(0);
  const [playingId, setPlayingId] = React.useState(null);
  const recordingTimerRef = React.useRef(null);
  const audioRefs = React.useRef({});
  const [previewNote, setPreviewNote] = React.useState(null);

  // Daily notes state
  const [dailyNotes, setDailyNotes] = React.useState(null);
  const [showDailyNotes, setShowDailyNotes] = React.useState(false);
  const [selectedDate, setSelectedDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [editingDailyNotes, setEditingDailyNotes] = React.useState(false);
  const [dailyNotesText, setDailyNotesText] = React.useState('');

  const loadNotes = React.useCallback(async () => {
    try {
      const list = await dbListNotes();
      setNotes(Array.isArray(list) ? list : []);
    } catch { setNotes([]); }
  }, []);

  const addNote = React.useCallback(async () => {
    const t = (text || '').trim();
    if (!t) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const note = { id, text: t, type: 'text', createdAt: Date.now() };
    try { await dbUpsertNote(note); } catch { }
    setText('');
    // Reload to reflect authoritative DB ordering and cap
    await loadNotes();
  }, [text, loadNotes]);

  // Voice recording functions
  const startRecording = React.useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(',')[1];
          const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const note = { 
            id, 
            type: 'voice', 
            audioData: base64Audio,
            duration: recordingTime,
            createdAt: Date.now() 
          };
          try { await dbUpsertNote(note); } catch { }
          await loadNotes();
        };
        reader.readAsDataURL(blob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      setMediaRecorder(recorder);
      setIsRecording(true);
      setRecordingTime(0);
      recorder.start();

      // Start timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  }, [recordingTime, loadNotes]);

  const stopRecording = React.useCallback(() => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      setMediaRecorder(null);
      
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }, [mediaRecorder, isRecording]);

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
    try { await dbDeleteNote(id); } catch { }
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
    try { await dbUpsertNote(updated); } catch { }
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

  // Daily notes functions
  const loadDailyNotes = React.useCallback(async (date) => {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'getDailyNotes', date }, resolve);
      });
      
      if (response?.ok) {
        setDailyNotes(response.dailyNotes);
        setDailyNotesText(response.dailyNotes.content || '');
      } else {
        setDailyNotes({
          date,
          content: '',
          selections: [],
          metadata: { created: 0, lastUpdated: 0, selectionCount: 0 }
        });
        setDailyNotesText('');
      }
    } catch (e) {
      console.error('Failed to load daily notes:', e);
    }
  }, []);

  const saveDailyNotes = React.useCallback(async () => {
    if (!selectedDate) return;
    
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ 
          type: 'updateDailyNotes', 
          date: selectedDate,
          content: dailyNotesText
        }, resolve);
      });
      
      if (response?.ok) {
        await loadDailyNotes(selectedDate);
        setEditingDailyNotes(false);
      }
    } catch (e) {
      console.error('Failed to save daily notes:', e);
    }
  }, [selectedDate, dailyNotesText, loadDailyNotes]);

  const toggleDailyNotes = React.useCallback(() => {
    if (!showDailyNotes) {
      loadDailyNotes(selectedDate);
    }
    setShowDailyNotes(!showDailyNotes);
  }, [showDailyNotes, selectedDate, loadDailyNotes]);

  const handleDateChange = React.useCallback((date) => {
    setSelectedDate(date);
    loadDailyNotes(date);
  }, [loadDailyNotes]);

  // Function to open URL in new tab
  const openUrl = React.useCallback((url) => {
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url, active: true });
    } else {
      window.open(url, '_blank');
    }
  }, []);

  // Function to render markdown links as clickable elements
  const renderContentWithLinks = React.useCallback((content) => {
    if (!content) return content;
    
    // Simple markdown link parser: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      // Add text before the link
      if (match.index > lastIndex) {
        parts.push(content.substring(lastIndex, match.index));
      }
      
      // Add clickable link
      const linkText = match[1];
      const url = match[2];
      parts.push(
        <button
          key={match.index}
          onClick={(e) => {
            e.stopPropagation();
            openUrl(url);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#10b981',
            textDecoration: 'underline',
            cursor: 'pointer',
            fontSize: 'inherit',
            padding: 0,
            font: 'inherit'
          }}
          title={`Open ${url}`}
        >
          {linkText}
          <FontAwesomeIcon 
            icon={faExternalLinkAlt} 
            style={{ marginLeft: 4, fontSize: '0.8em', opacity: 0.7 }}
          />
        </button>
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex));
    }
    
    return parts.length > 0 ? parts : content;
  }, [openUrl]);

  React.useEffect(() => { loadNotes(); }, [loadNotes]);

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
          Notes
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={addNote}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              border: 'none',
              background: '#007AFF',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0, 122, 255, 0.3)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = 'scale(1.05)';
              e.target.style.boxShadow = '0 4px 12px rgba(0, 122, 255, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'scale(1)';
              e.target.style.boxShadow = '0 2px 8px rgba(0, 122, 255, 0.3)';
            }}
            title="Add note"
          >
            <FontAwesomeIcon icon={faPlus} style={{ fontSize: 14 }} />
          </button>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            style={{
              width: isRecording ? 80 : 32,
              height: 32,
              borderRadius: 16,
              border: 'none',
              background: isRecording ? '#FF3B30' : '#34C759',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              boxShadow: isRecording 
                ? '0 2px 8px rgba(255, 59, 48, 0.3)' 
                : '0 2px 8px rgba(52, 199, 89, 0.3)',
              transition: 'all 0.3s ease',
              fontSize: 12,
              fontWeight: 500
            }}
            title={isRecording ? 'Stop recording' : 'Start voice recording'}
          >
            <FontAwesomeIcon icon={isRecording ? faStop : faMicrophone} style={{ fontSize: 14 }} />
            {isRecording && <span>{formatDuration(recordingTime)}</span>}
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(); }}
          placeholder="Start typing..."
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
          <span>Ctrl + Enter to save</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={addNote}
              disabled={!text.trim()}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                background: text.trim() ? '#007AFF' : 'rgba(255, 255, 255, 0.1)',
                color: text.trim() ? 'white' : 'rgba(255, 255, 255, 0.5)',
                fontSize: 12,
                fontWeight: 500,
                cursor: text.trim() ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
              title="Save note"
            >
              <FontAwesomeIcon icon={faSave} style={{ fontSize: 10 }} />
              Save
            </button>
            <span style={{ opacity: 0.7 }}>{text.length} characters</span>
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
        {notes.map(n => (
          <div 
            key={n.id} 
            style={{ 
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.2s ease',
              cursor: n.type === 'text' && editingId !== n.id ? 'pointer' : 'default'
            }}
            onClick={() => n.type === 'text' && editingId !== n.id && startEdit(n)}
            onMouseEnter={(e) => {
              if (n.type === 'text' && editingId !== n.id) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (n.type === 'text' && editingId !== n.id) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
          >
            {editingId === n.id && n.type === 'text' ? (
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  {n.type === 'voice' ? (
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
                          background: '#34C759',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <FontAwesomeIcon icon={faMicrophone} style={{ fontSize: 14, color: 'white' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 500, color: '#ffffff' }}>
                            Voice Note
                          </div>
                          <div style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.6)' }}>
                            {formatDuration(n.duration || 0)}
                          </div>
                        </div>
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
                  {n.type === 'voice' && (
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
      </div>

      {/* Daily Notes Section - Apple Style */}
      <div style={{ 
        marginTop: 24,
        borderTop: '1px solid rgba(255, 255, 255, 0.1)', 
        paddingTop: 24
      }}>
        <div 
          onClick={toggleDailyNotes}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            cursor: 'pointer',
            marginBottom: showDailyNotes ? 20 : 0,
            padding: '8px 4px',
            borderRadius: 8,
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <h2 style={{ 
            marginBottom: 0, 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            fontSize: 20,
            fontWeight: 600,
            color: '#ffffff',
            letterSpacing: '-0.3px'
          }}>
            <FontAwesomeIcon icon={faCalendarDay} style={{ color: '#FF9500', fontSize: 18 }} />
            Daily Notes
            {dailyNotes?.metadata?.selectionCount > 0 && (
              <span style={{ 
                fontSize: 12, 
                color: '#ffffff', 
                background: 'rgba(255, 149, 0, 0.2)', 
                padding: '4px 8px', 
                borderRadius: 12,
                marginLeft: 4,
                fontWeight: 500,
                border: '1px solid rgba(255, 149, 0, 0.3)'
              }}>
                {dailyNotes.metadata.selectionCount}
              </span>
            )}
          </h2>
          <div style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            background: 'rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease'
          }}>
            <FontAwesomeIcon 
              icon={showDailyNotes ? faChevronDown : faChevronRight} 
              style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 10 }}
            />
          </div>
        </div>

        {showDailyNotes && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Date selector - Apple Style */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 12,
              padding: 12,
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer'
                }}
              />
              {dailyNotes && dailyNotes.metadata.lastUpdated > 0 && (
                <span style={{ 
                  fontSize: 12, 
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontWeight: 400
                }}>
                  Updated {new Date(dailyNotes.metadata.lastUpdated).toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              )}
            </div>

            {/* Daily notes content - Apple Style */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 12,
              border: '1px solid rgba(255, 255, 255, 0.1)',
              overflow: 'hidden'
            }}>
              {editingDailyNotes ? (
                <div style={{ padding: 16 }}>
                  <textarea
                    value={dailyNotesText}
                    onChange={(e) => setDailyNotesText(e.target.value)}
                    placeholder="Your daily notes... Selected text from web pages is automatically added here."
                    autoFocus
                    style={{
                      width: '100%',
                      minHeight: 120,
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      color: '#ffffff',
                      fontSize: 16,
                      lineHeight: 1.4,
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      outline: 'none'
                    }}
                    onInput={(e) => {
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.max(120, e.target.scrollHeight) + 'px';
                    }}
                  />
                  <div style={{ 
                    display: 'flex', 
                    gap: 8, 
                    justifyContent: 'flex-end',
                    marginTop: 16,
                    paddingTop: 16,
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)'
                  }}>
                    <button
                      onClick={() => {
                        setEditingDailyNotes(false);
                        setDailyNotesText(dailyNotes?.content || '');
                      }}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: '#ffffff',
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <FontAwesomeIcon icon={faTimes} style={{ fontSize: 12 }} />
                      Cancel
                    </button>
                    <button
                      onClick={saveDailyNotes}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#007AFF',
                        color: 'white',
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: '0 2px 8px rgba(0, 122, 255, 0.3)'
                      }}
                    >
                      <FontAwesomeIcon icon={faSave} style={{ fontSize: 12 }} />
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => setEditingDailyNotes(true)}
                  style={{
                    minHeight: 100,
                    padding: 16,
                    color: '#ffffff',
                    fontSize: 16,
                    lineHeight: 1.4,
                    cursor: 'pointer',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {dailyNotes?.content ? 
                    renderContentWithLinks(dailyNotes.content) : (
                    <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontStyle: 'italic', fontSize: 15 }}>
                      Tap to add your daily notes... Selected text from web pages will appear here automatically.
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Auto-captured selections - Apple Style */}
            {dailyNotes?.selections && dailyNotes.selections.length > 0 && (
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12
                }}>
                  <h3 style={{ 
                    fontSize: 16,
                    fontWeight: 600,
                    color: 'rgba(255, 255, 255, 0.7)',
                    margin: 0,
                    letterSpacing: '-0.2px'
                  }}>
                    Auto-captured
                  </h3>
                  <span style={{
                    fontSize: 12,
                    color: '#ffffff',
                    background: 'rgba(52, 199, 89, 0.2)',
                    padding: '2px 8px',
                    borderRadius: 8,
                    fontWeight: 500,
                    border: '1px solid rgba(52, 199, 89, 0.3)'
                  }}>
                    {dailyNotes.selections.length}
                  </span>
                </div>
                <div style={{ 
                  maxHeight: 200, 
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}>
                  {dailyNotes.selections.slice(-5).reverse().map(selection => (
                    <div key={selection.id} style={{
                      background: 'rgba(52, 199, 89, 0.05)',
                      border: '1px solid rgba(52, 199, 89, 0.15)',
                      borderRadius: 10,
                      padding: 12,
                      transition: 'all 0.2s ease',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(52, 199, 89, 0.08)';
                      e.currentTarget.style.borderColor = 'rgba(52, 199, 89, 0.25)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(52, 199, 89, 0.05)';
                      e.currentTarget.style.borderColor = 'rgba(52, 199, 89, 0.15)';
                    }}
                    >
                      <div style={{ 
                        color: '#ffffff',
                        marginBottom: 6,
                        fontSize: 14,
                        lineHeight: 1.3,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        "{selection.text}"
                      </div>
                      <div style={{ 
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 11,
                        color: 'rgba(255, 255, 255, 0.6)'
                      }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openUrl(selection.source?.url);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#34C759',
                            cursor: 'pointer',
                            fontSize: 11,
                            padding: '2px 6px',
                            borderRadius: 4,
                            textDecoration: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontWeight: 500,
                            transition: 'all 0.2s ease'
                          }}
                          title={`Open ${selection.source?.url}`}
                          onMouseEnter={(e) => {
                            e.target.style.background = 'rgba(52, 199, 89, 0.15)';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.background = 'none';
                          }}
                        >
                          {selection.source?.domain || 'Unknown'}
                          <FontAwesomeIcon 
                            icon={faExternalLinkAlt} 
                            style={{ fontSize: 9, opacity: 0.8 }}
                          />
                        </button>
                        <span style={{ fontWeight: 400 }}>{selection.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
