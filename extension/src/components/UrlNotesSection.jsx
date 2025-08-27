import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faMicrophone, faStop, faPlay, faPause, faCamera, faFileText, 
  faTrash, faPlus, faSave, faEdit, faTimes, faExpand, faCompress 
} from '@fortawesome/free-solid-svg-icons';

export function UrlNotesSection({ url, onClose }) {
  const [notes, setNotes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [isRecording, setIsRecording] = React.useState(false);
  const [recordingTime, setRecordingTime] = React.useState(0);
  const [mediaRecorder, setMediaRecorder] = React.useState(null);
  const [playingId, setPlayingId] = React.useState(null);
  const [selectedText, setSelectedText] = React.useState('');
  const [noteText, setNoteText] = React.useState('');
  const [editingId, setEditingId] = React.useState(null);
  const [expanded, setExpanded] = React.useState(false);
  
  const recordingTimerRef = React.useRef(null);
  const audioRefs = React.useRef({});

  // Load URL-specific notes
  const loadUrlNotes = React.useCallback(async () => {
    try {
      setLoading(true);
      const { getUrlNotes } = await import('../db');
      const urlNotes = await getUrlNotes(url);
      setNotes(Array.isArray(urlNotes) ? urlNotes : []);
    } catch (error) {
      console.error('Failed to load URL notes:', error);
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [url]);

  // Save note to database
  const saveNote = React.useCallback(async (noteData) => {
    try {
      const { saveUrlNote } = await import('../db');
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const note = {
        id,
        url,
        createdAt: Date.now(),
        ...noteData
      };
      await saveUrlNote(note);
      await loadUrlNotes();
    } catch (error) {
      console.error('Failed to save note:', error);
    }
  }, [url, loadUrlNotes]);

  // Capture selected text from current tab
  const captureSelectedText = React.useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const selection = window.getSelection();
          const selectedText = selection.toString().trim();
          const pageTitle = document.title;
          const pageUrl = window.location.href;
          
          // Get context around selection
          let context = '';
          if (selectedText && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;
            const parentElement = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
            context = parentElement ? parentElement.textContent.trim() : '';
          }
          
          return { selectedText, pageTitle, pageUrl, context };
        }
      });

      if (results?.[0]?.result?.selectedText) {
        const { selectedText, context } = results[0].result;
        setSelectedText(selectedText);
        setNoteText(`Selected: "${selectedText}"\n\nContext: ${context.substring(0, 200)}...`);
      } else {
        alert('No text selected. Please select some text on the webpage first.');
      }
    } catch (error) {
      console.error('Failed to capture selected text:', error);
      alert('Failed to capture selected text. Make sure you have text selected on the current page.');
    }
  }, []);

  // Capture screenshot
  const captureScreenshot = React.useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 90 });
      const base64Data = dataUrl.split(',')[1];
      
      await saveNote({
        type: 'screenshot',
        title: `Screenshot of ${new URL(url).hostname}`,
        imageData: base64Data,
        description: noteText.trim() || 'Screenshot captured'
      });
      
      setNoteText('');
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      alert('Failed to capture screenshot. Make sure the extension has screenshot permissions.');
    }
  }, [url, noteText, saveNote]);

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
          await saveNote({
            type: 'voice',
            title: `Voice note for ${new URL(url).hostname}`,
            audioData: base64Audio,
            duration: recordingTime,
            description: noteText.trim() || 'Voice recording',
            selectedText: selectedText.trim() || undefined
          });
          setNoteText('');
          setSelectedText('');
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      setMediaRecorder(recorder);
      setIsRecording(true);
      setRecordingTime(0);
      recorder.start();

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  }, [url, noteText, selectedText, recordingTime, saveNote]);

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

  // Save text note
  const saveTextNote = React.useCallback(async () => {
    if (!noteText.trim()) return;
    
    await saveNote({
      type: 'text',
      title: `Note for ${new URL(url).hostname}`,
      text: noteText.trim(),
      selectedText: selectedText.trim() || undefined
    });
    
    setNoteText('');
    setSelectedText('');
  }, [url, noteText, selectedText, saveNote]);

  // Play voice note
  const playVoiceNote = React.useCallback((note) => {
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
  }, [playingId]);

  // Delete note
  const deleteNote = React.useCallback(async (noteId) => {
    try {
      const { deleteUrlNote } = await import('../db');
      await deleteUrlNote(noteId);
      await loadUrlNotes();
    } catch (error) {
      console.error('Failed to delete note:', error);
    }
  }, [loadUrlNotes]);

  // Format duration
  const formatDuration = React.useCallback((seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  React.useEffect(() => {
    loadUrlNotes();
  }, [loadUrlNotes]);

  const hostname = React.useMemo(() => {
    try { return new URL(url).hostname; } catch { return url; }
  }, [url]);

  return (
    <div style={{ 
      position: 'fixed', 
      top: expanded ? 0 : 'auto',
      bottom: expanded ? 0 : 20,
      right: 20, 
      width: expanded ? '100vw' : 400,
      height: expanded ? '100vh' : 500,
      background: '#1a1a1a', 
      border: '1px solid #333', 
      borderRadius: expanded ? 0 : 12, 
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{ 
        padding: 16, 
        borderBottom: '1px solid #333', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        background: '#2a2a2a'
      }}>
        <h3 style={{ margin: 0, color: '#e5e7eb', fontSize: 16 }}>
          Notes for {hostname}
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ 
              padding: '6px 8px', 
              background: '#374151', 
              border: 'none', 
              borderRadius: 6, 
              color: '#e5e7eb',
              cursor: 'pointer'
            }}
          >
            <FontAwesomeIcon icon={expanded ? faCompress : faExpand} />
          </button>
          <button
            onClick={onClose}
            style={{ 
              padding: '6px 8px', 
              background: '#dc2626', 
              border: 'none', 
              borderRadius: 6, 
              color: 'white',
              cursor: 'pointer'
            }}
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
        {/* Capture Controls */}
        <div style={{ marginBottom: 16, padding: 12, background: '#2a2a2a', borderRadius: 8 }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#e5e7eb', fontSize: 14 }}>Capture Content</h4>
          
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button
              onClick={captureSelectedText}
              style={{ 
                padding: '6px 12px', 
                background: '#3b82f6', 
                border: 'none', 
                borderRadius: 6, 
                color: 'white',
                cursor: 'pointer',
                fontSize: 12
              }}
            >
              <FontAwesomeIcon icon={faFileText} style={{ marginRight: 6 }} />
              Capture Text
            </button>
            
            <button
              onClick={captureScreenshot}
              style={{ 
                padding: '6px 12px', 
                background: '#10b981', 
                border: 'none', 
                borderRadius: 6, 
                color: 'white',
                cursor: 'pointer',
                fontSize: 12
              }}
            >
              <FontAwesomeIcon icon={faCamera} style={{ marginRight: 6 }} />
              Screenshot
            </button>
            
            <button
              onClick={isRecording ? stopRecording : startRecording}
              style={{ 
                padding: '6px 12px', 
                background: isRecording ? '#dc2626' : '#f59e0b', 
                border: 'none', 
                borderRadius: 6, 
                color: 'white',
                cursor: 'pointer',
                fontSize: 12,
                minWidth: isRecording ? 80 : 'auto'
              }}
            >
              <FontAwesomeIcon icon={isRecording ? faStop : faMicrophone} style={{ marginRight: 6 }} />
              {isRecording ? formatDuration(recordingTime) : 'Record'}
            </button>
          </div>

          {selectedText && (
            <div style={{ 
              padding: 8, 
              background: '#374151', 
              borderRadius: 6, 
              marginBottom: 12,
              fontSize: 12,
              color: '#d1d5db'
            }}>
              <strong>Selected:</strong> {selectedText.substring(0, 100)}...
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note or description..."
              style={{ 
                flex: 1, 
                padding: 8, 
                background: '#374151', 
                border: '1px solid #4b5563', 
                borderRadius: 6, 
                color: '#e5e7eb',
                fontSize: 12,
                resize: 'vertical',
                minHeight: 60
              }}
            />
            <button
              onClick={saveTextNote}
              disabled={!noteText.trim()}
              style={{ 
                padding: '8px 12px', 
                background: noteText.trim() ? '#059669' : '#6b7280', 
                border: 'none', 
                borderRadius: 6, 
                color: 'white',
                cursor: noteText.trim() ? 'pointer' : 'not-allowed',
                fontSize: 12
              }}
            >
              <FontAwesomeIcon icon={faSave} />
            </button>
          </div>
        </div>

        {/* Notes List */}
        <div>
          <h4 style={{ margin: '0 0 12px 0', color: '#e5e7eb', fontSize: 14 }}>
            Saved Notes ({notes.length})
          </h4>
          
          {loading ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>Loading...</div>
          ) : notes.length === 0 ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', padding: 20 }}>
              No notes yet. Capture some content to get started!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {notes.map(note => (
                <div key={note.id} style={{ 
                  padding: 12, 
                  background: '#2a2a2a', 
                  border: '1px solid #374151', 
                  borderRadius: 8 
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#e5e7eb', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                        {note.title}
                      </div>
                      <div style={{ color: '#9ca3af', fontSize: 11 }}>
                        {new Date(note.createdAt).toLocaleString()}
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: 6 }}>
                      {note.type === 'voice' && (
                        <button
                          onClick={() => playVoiceNote(note)}
                          style={{ 
                            padding: '4px 8px', 
                            background: playingId === note.id ? '#10b981' : '#374151', 
                            border: 'none', 
                            borderRadius: 4, 
                            color: '#e5e7eb',
                            cursor: 'pointer',
                            fontSize: 11
                          }}
                        >
                          <FontAwesomeIcon icon={playingId === note.id ? faPause : faPlay} />
                        </button>
                      )}
                      
                      <button
                        onClick={() => deleteNote(note.id)}
                        style={{ 
                          padding: '4px 8px', 
                          background: '#dc2626', 
                          border: 'none', 
                          borderRadius: 4, 
                          color: 'white',
                          cursor: 'pointer',
                          fontSize: 11
                        }}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  </div>

                  {note.selectedText && (
                    <div style={{ 
                      padding: 8, 
                      background: '#374151', 
                      borderRadius: 4, 
                      marginBottom: 8,
                      fontSize: 11,
                      color: '#d1d5db'
                    }}>
                      <strong>Selected text:</strong> {note.selectedText}
                    </div>
                  )}

                  {note.text && (
                    <div style={{ color: '#d1d5db', fontSize: 12, marginBottom: 8 }}>
                      {note.text}
                    </div>
                  )}

                  {note.description && (
                    <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 8 }}>
                      {note.description}
                    </div>
                  )}

                  {note.type === 'voice' && (
                    <div style={{ color: '#10b981', fontSize: 11 }}>
                      <FontAwesomeIcon icon={faMicrophone} style={{ marginRight: 4 }} />
                      Voice note ({formatDuration(note.duration || 0)})
                    </div>
                  )}

                  {note.type === 'screenshot' && note.imageData && (
                    <img 
                      src={`data:image/png;base64,${note.imageData}`}
                      alt="Screenshot"
                      style={{ 
                        maxWidth: '100%', 
                        height: 'auto', 
                        borderRadius: 4, 
                        marginTop: 8,
                        border: '1px solid #374151'
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
