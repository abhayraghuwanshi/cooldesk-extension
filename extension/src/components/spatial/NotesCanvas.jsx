import {
  faBold,
  faCheckSquare,
  faClock,
  faCompress,
  faExpand,
  faItalic,
  faListUl,
  faMicrophone,
  faPlus,
  faSearch,
  faStickyNote,
  faTrash
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteNote as dbDeleteNote, listNotes as dbListNotes, upsertNote as dbUpsertNote } from '../../db/index.js';

export function NotesCanvas({ workspaceId }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeNote, setActiveNote] = useState(null);
  const [noteContent, setNoteContent] = useState('');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const editorRef = useRef(null);
  const autoSaveTimeout = useRef(null);

  // Load notes
  const loadNotes = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      const result = await dbListNotes();
      const allNotes = result?.data || result || [];
      setNotes(Array.isArray(allNotes) ? allNotes : []);
    } catch (error) {
      console.error('[NotesCanvas] Error loading notes:', error);
      if (showLoading) setNotes([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // Auto-save note
  const saveNote = useCallback(async (content, noteId = null) => {
    // Avoid saving empty new notes
    if (!content.trim() && !noteId) return;

    try {
      setAutoSaveStatus('saving');

      const note = {
        id: noteId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: content, // We store HTML in 'text' field for now, or should we use a new field? 'text' is fine if we render it safely.
        title: extractTitle(content),
        type: 'richtext',
        createdAt: noteId ? (notes.find(n => n.id === noteId)?.createdAt || Date.now()) : Date.now(),
        updatedAt: Date.now()
      };

      await dbUpsertNote(note);

      // Update local state without full reload if possible, but loadNotes ensures sync
      await loadNotes(false);

      // If it was a new note, update activeNote to having the ID
      if (!noteId && activeNote?.id !== note.id) {
        // This is tricky because loadNotes replaces the array reference.
        // We'll rely on loadNotes updating the list, and if we are editing, we stay on it?
        // Actually, if we just created a new ID, we should set it.
        setActiveNote(note);
      }

      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('[NotesCanvas] Error saving note:', error);
      setAutoSaveStatus('error');
    }
  }, [notes, loadNotes, activeNote]);

  const extractTitle = (html) => {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const text = temp.textContent || temp.innerText || '';
    return text.trim().split('\n')[0].substring(0, 50) || 'Untitled Note';
  };

  // Handle content change
  const handleContentChange = (e) => {
    const html = e.currentTarget.innerHTML;
    setNoteContent(html);
    setAutoSaveStatus('unsaved');

    clearTimeout(autoSaveTimeout.current);
    autoSaveTimeout.current = setTimeout(() => {
      saveNote(html, activeNote?.id);
    }, 1000);
  };


  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);
  const streamRef = useRef(null);

  // Sync content when active note changes
  useEffect(() => {
    if (editorRef.current) {
      if (activeNote) {
        // If we are currently editing (focused) and this is just an ID change (e.g. New -> Saved)
        // or a background update, we should trust the local editor state to avoid cursor jumps.
        // We only forcefully update if we are NOT focused (e.g. clicked a different note in sidebar).
        if (document.activeElement === editorRef.current) {
          return;
        }

        // Use trimmed comparison to avoid refreshing just for whitespace
        const currentHTML = editorRef.current.innerHTML || '';
        const newText = activeNote.text || '';

        if (currentHTML !== newText && currentHTML.trim() !== newText.trim()) {
          editorRef.current.innerHTML = newText;
        }
      } else {
        editorRef.current.innerHTML = '';
      }
    }
  }, [activeNote?.id]);

  // Handle recording cleanup
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors on cleanup
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Voice recording
  const toggleRecording = async () => {
    if (isRecording) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    try {
      // proper permission request like SimpleNotes
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert('Speech recognition is not supported in this browser.');
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onend = () => {
        setIsRecording(false);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      recognition.onresult = (event) => {
        let finalTranscript = '';

        // Get the latest results
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript && editorRef.current) {
          // Ensure editor has focus before inserting
          editorRef.current.focus();

          // Let's use execCommand to insert text at cursor position
          document.execCommand('insertText', false, finalTranscript + ' ');

          // Trigger save
          handleContentChange({ currentTarget: editorRef.current });
        }
      };

      recognition.onerror = (event) => {
        console.warn('[NotesCanvas] Speech recognition error:', event.error);
        setIsRecording(false);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      recognition.start();
      recognitionRef.current = recognition;

    } catch (error) {
      console.error('[NotesCanvas] Failed to enable microphone:', error);
      setIsRecording(false);
      alert('Could not access microphone. Please allow microphone access.');
    }
  };

  // Editor Commands
  const execCommand = (command, value = null) => {
    // Prevent focus loss is handled by onMouseDown preventDefault on buttons
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const insertCheckbox = () => {
    const checkboxHtml = '<input type="checkbox" style="margin-right: 8px; transform: scale(1.2);" />&nbsp;';
    document.execCommand('insertHTML', false, checkboxHtml);
    editorRef.current?.focus();
  };

  // Delete note
  const handleDeleteNote = async (noteId) => {
    try {
      await dbDeleteNote(noteId);
      if (activeNote?.id === noteId) {
        setActiveNote(null);
        setNoteContent('');
        setIsEditing(false);
      }
      loadNotes();
    } catch (error) {
      console.error('[NotesCanvas] Error deleting note:', error);
    }
  };

  // Select note
  const selectNote = (note) => {
    setActiveNote(note);
    setNoteContent(note.text || '');
    setAutoSaveStatus('idle');
    setIsEditing(true);
  };

  // Create new note
  const createNewNote = () => {
    setActiveNote(null);
    setNoteContent('');
    setAutoSaveStatus('idle');
    setIsEditing(true);
    setTimeout(() => {
      editorRef.current?.focus();
      if (editorRef.current) editorRef.current.innerHTML = '';
    }, 100);
  };

  const filteredNotes = notes.filter(note => {
    const textContent = note.title || note.text || '';
    return textContent.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const getWordCount = (html) => {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const text = temp.textContent || temp.innerText || '';
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  };

  if (loading) {
    return (
      <div className="notes-canvas-v2 loading">
        <div className="notes-loading">
          <div className="loading-spinner-v2"></div>
          <p>Loading your notes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`notes-canvas-v2 ${isFullScreen ? 'fullscreen' : ''}`}>
      {/* Header */}
      <div className="notes-header-v2">
        <div className="notes-header-left">
          <button
            className="notes-menu-btn"
            onClick={() => setShowSidebar(!showSidebar)}
            title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
          >
            <FontAwesomeIcon icon={faStickyNote} />
          </button>
          <h1 className="notes-title-v2">Notes</h1>
          <span className="notes-count-badge">{notes.length}</span>
        </div>

        <div className="notes-header-right">
          {autoSaveStatus !== 'idle' && (
            <div className={`notes-save-indicator ${autoSaveStatus}`}>
              <span className={`save-dot ${autoSaveStatus}`}></span>
              <span>
                {autoSaveStatus === 'saving' ? 'Saving...' :
                  autoSaveStatus === 'saved' ? 'Saved' : 'Unsaved'}
              </span>
            </div>
          )}

          <button
            className="notes-icon-btn"
            onClick={() => setIsFullScreen(!isFullScreen)}
            title={isFullScreen ? 'Exit focus mode' : 'Focus mode'}
          >
            <FontAwesomeIcon icon={isFullScreen ? faCompress : faExpand} />
          </button>

          <button
            className="notes-icon-btn primary"
            onClick={createNewNote}
            title="New note"
          >
            <FontAwesomeIcon icon={faPlus} />
          </button>
        </div>
      </div>

      <div className="notes-content-v2">
        {/* Sidebar */}
        {showSidebar && !isFullScreen && (
          <div className="notes-sidebar-v2">
            <div className="notes-search-box">
              <FontAwesomeIcon icon={faSearch} className="search-icon" />
              <input
                type="text"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="notes-search-input"
              />
            </div>

            <div className="notes-list-v2">
              {filteredNotes.length === 0 ? (
                <div className="notes-empty-state">
                  <p className="empty-text-v2">No notes found</p>
                </div>
              ) : (
                filteredNotes.map((note) => (
                  <div
                    key={note.id}
                    className={`note-card-v2 ${activeNote?.id === note.id ? 'active' : ''}`}
                    onClick={() => selectNote(note)}
                  >
                    <div className="note-card-content">
                      <div className="note-card-preview"
                        dangerouslySetInnerHTML={{
                          __html: note.text ?
                            (note.text.length > 200 ? note.text.substring(0, 200) + '...' : note.text)
                            : '<i>Empty note</i>'
                        }}
                      />
                    </div>
                    <div className="note-card-footer">
                      <span className="note-card-time">
                        <FontAwesomeIcon icon={faClock} />
                        {new Date(note.updatedAt || note.createdAt).toLocaleDateString()}
                      </span>
                      <button
                        className="note-card-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Delete this note?')) handleDeleteNote(note.id);
                        }}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Editor Area */}
        <div className="notes-editor-v2">
          {isEditing ? (
            <>
              {/* Formatting Toolbar */}
              <div className="editor-toolbar">
                <button
                  className="toolbar-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execCommand('bold')}
                  title="Bold (Ctrl+B)"
                >
                  <FontAwesomeIcon icon={faBold} />
                </button>
                <button
                  className="toolbar-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execCommand('italic')}
                  title="Italic (Ctrl+I)"
                >
                  <FontAwesomeIcon icon={faItalic} />
                </button>
                <div className="toolbar-separator"></div>
                <button
                  className="toolbar-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execCommand('insertUnorderedList')}
                  title="Bullet List"
                >
                  <FontAwesomeIcon icon={faListUl} />
                </button>
                <button
                  className="toolbar-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={insertCheckbox}
                  title="Insert Checkbox"
                >
                  <FontAwesomeIcon icon={faCheckSquare} />
                </button>
                <div className="toolbar-separator"></div>
                <button
                  className={`toolbar-btn ${isRecording ? 'active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggleRecording}
                  title={isRecording ? 'Stop Recording' : 'Start Recording'}
                  style={{ color: isRecording ? '#ef4444' : undefined }}
                >
                  <FontAwesomeIcon icon={isRecording ? faMicrophone : faMicrophone} beat={isRecording} />
                </button>
              </div>

              {/* Rich Text Editor */}
              <div
                ref={editorRef}
                className="notes-rich-editor"
                contentEditable
                onInput={handleContentChange}
                suppressContentEditableWarning={true}
                placeholder="Start typing..."
                onKeyDown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
                  }
                }}
              />

              <div className="notes-editor-footer">
                <span className="word-count">
                  {getWordCount(noteContent)} words
                </span>
                <span className="word-count">
                  {activeNote ? 'Last edited: ' + new Date(activeNote.updatedAt).toLocaleTimeString() : 'New Note'}
                </span>
              </div>
            </>
          ) : (
            <div className="notes-editor-empty">
              <div className="editor-empty-icon">📝</div>
              <h3 className="editor-empty-title">Select a Note</h3>
              <button className="editor-empty-btn" onClick={createNewNote}>
                Create New Note
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
