import { faPlus, faPen, faTrash, faMicrophone, faStop, faPlay, faPause } from '@fortawesome/free-solid-svg-icons';
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

  React.useEffect(() => { loadNotes(); }, [loadNotes]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ marginBottom: '10px' }}>
          <FontAwesomeIcon icon={faPen} style={{ marginRight: 6 }} />
          Hot Thoughts
        </h3>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
          placeholder="Write a quick note..."
          style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: '1px solid #273043', background: '#0f1724', color: '#e5e7eb', fontSize: 13 }}
        />
        <button
          onClick={addNote}
          className="icon-btn"
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 13 }}
        >
          <FontAwesomeIcon icon={faPlus} />
        </button>
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className="icon-btn"
          style={{ 
            padding: '6px 10px', 
            borderRadius: 8, 
            border: '1px solid #273043', 
            background: isRecording ? '#dc2626' : '#1b2331', 
            color: '#e5e7eb', 
            fontSize: 13,
            minWidth: isRecording ? '60px' : 'auto'
          }}
          title={isRecording ? 'Stop recording' : 'Start voice recording'}
        >
          <FontAwesomeIcon icon={isRecording ? faStop : faMicrophone} />
          {isRecording && <span style={{ marginLeft: 6, fontSize: 11 }}>{formatDuration(recordingTime)}</span>}
        </button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {notes.length === 0 && (
          <div className="empty">No notes yet</div>
        )}
        {notes.map(n => (
          <div key={n.id} className="activity-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #273043', borderRadius: 10, background: '#0f1724' }}>
            {editingId === n.id && n.type === 'text' ? (
              <>
                <input
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                  autoFocus
                  style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #273043', background: '#0f1724', color: '#e5e7eb', fontSize: 13 }}
                />
                <button onClick={saveEdit} className="icon-btn" style={{ width: 60, height: 28 }}>Save</button>
                <button onClick={cancelEdit} className="icon-btn" style={{ width: 70, height: 28 }}>Cancel</button>
              </>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {n.type === 'voice' ? (
                    <>
                      <div className="activity-card__title" style={{ fontSize: 13, color: '#e5e7eb', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FontAwesomeIcon icon={faMicrophone} style={{ color: '#10b981' }} />
                        Voice Note ({formatDuration(n.duration || 0)})
                      </div>
                      <div className="activity-card__meta" style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                        {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="activity-card__title" style={{ fontSize: 13, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {n.text}
                      </div>
                      <div className="activity-card__meta" style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                      </div>
                    </>
                  )}
                </div>
                
                {n.type === 'voice' && (
                  <button 
                    onClick={() => playVoiceNote(n)} 
                    className="icon-btn" 
                    title={playingId === n.id ? "Stop playback" : "Play voice note"} 
                    style={{ width: 28, height: 28, color: playingId === n.id ? '#10b981' : '#e5e7eb' }}
                  >
                    <FontAwesomeIcon icon={playingId === n.id ? faPause : faPlay} />
                  </button>
                )}
                
                {n.type === 'text' && (
                  <button onClick={() => startEdit(n)} className="icon-btn" title="Edit" style={{ width: 28, height: 28 }}>
                    <FontAwesomeIcon icon={faPen} />
                  </button>
                )}
                
                <button onClick={() => removeNote(n.id)} className="icon-btn" title="Delete" style={{ width: 28, height: 28 }}>
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
