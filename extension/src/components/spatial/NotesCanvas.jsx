import {
  faBold,
  faCheckSquare,
  faClock,
  faCompress,
  faExpand,
  faFolder,
  faFolderOpen,
  faItalic,
  faListUl,
  faMicrophone,
  faPlus,
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
  const [noteTitle, setNoteTitle] = useState('');
  const [noteFolder, setNoteFolder] = useState('');
  const [activeFolder, setActiveFolder] = useState('All Notes');
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

  // Derived folders list
  const folders = ['All Notes', ...new Set(notes.map(n => n.folder).filter(Boolean).filter(f => f.trim() !== ''))].sort();

  // Filtered notes
  const filteredNotes = notes
    .filter(note => activeFolder === 'All Notes' || note.folder === activeFolder)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

  // Auto-save note
  const saveNote = useCallback(async (content, noteId = null) => {
    // Avoid saving empty new notes
    if (!content.trim() && !noteId) return;

    try {
      setAutoSaveStatus('saving');

      // Use refs to get latest state inside callback/timeout
      const currentTitle = titleRef.current || extractTitle(content);
      const currentFolder = folderRef.current;

      const note = {
        id: noteId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: content,
        title: currentTitle,
        folder: currentFolder,
        type: 'richtext',
        createdAt: noteId ? (notes.find(n => n.id === noteId)?.createdAt || Date.now()) : Date.now(),
        updatedAt: Date.now()
      };

      await dbUpsertNote(note);

      // Update local state without full reload if possible, but loadNotes ensures sync
      await loadNotes(false);

      // If it was a new note, update activeNote to having the ID
      if (!noteId && activeNote?.id !== note.id) {
        setActiveNote(note);
      }

      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('[NotesCanvas] Error saving note:', error);
      setAutoSaveStatus('error');
    }
  }, [notes, loadNotes, activeNote]);

  const titleRef = useRef('');
  const folderRef = useRef('');

  useEffect(() => { titleRef.current = noteTitle; }, [noteTitle]);
  useEffect(() => { folderRef.current = noteFolder; }, [noteFolder]);

  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setNoteTitle(newTitle);
    triggerAutoSave();
  };

  const handleFolderChange = (e) => {
    const newFolder = e.target.value;
    setNoteFolder(newFolder);
    triggerAutoSave();
  };

  const triggerAutoSave = () => {
    setAutoSaveStatus('unsaved');
    clearTimeout(autoSaveTimeout.current);
    autoSaveTimeout.current = setTimeout(() => {
      saveNote(noteContent, activeNote?.id);
    }, 1000);
  }

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
    triggerAutoSave();
  };


  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);
  const streamRef = useRef(null);

  // Sync content when active note changes
  useEffect(() => {
    if (editorRef.current) {
      if (activeNote) {
        if (document.activeElement === editorRef.current) {
          return;
        }

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

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript && editorRef.current) {
          editorRef.current.focus();
          document.execCommand('insertText', false, finalTranscript + ' ');
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
    setNoteTitle(note.title || '');
    setNoteFolder(note.folder || '');
    setAutoSaveStatus('idle');
    setIsEditing(true);
  };

  // Create new note
  const createNewNote = () => {
    setActiveNote(null);
    setNoteContent('');
    setNoteTitle('');
    // If we are in a specific folder, default to that folder
    setNoteFolder(activeFolder === 'All Notes' ? '' : activeFolder);
    setAutoSaveStatus('idle');
    setIsEditing(true);
    setTimeout(() => {
      editorRef.current?.focus();
      if (editorRef.current) editorRef.current.innerHTML = '';
    }, 100);
  };

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

            {/* Folder List */}
            <div className="notes-folder-list">
              <button
                className={`folder-item ${activeFolder === 'All Notes' ? 'active' : ''}`}
                onClick={() => setActiveFolder('All Notes')}
              >
                <FontAwesomeIcon icon={activeFolder === 'All Notes' ? faFolderOpen : faFolder} className="folder-icon" />
                <span className="folder-name">All Notes</span>
                <span className="folder-count">{notes.length}</span>
              </button>
              {folders.filter(f => f !== 'All Notes').map(folder => (
                <button
                  key={folder}
                  className={`folder-item ${activeFolder === folder ? 'active' : ''}`}
                  onClick={() => setActiveFolder(folder)}
                >
                  <FontAwesomeIcon icon={activeFolder === folder ? faFolderOpen : faFolder} className="folder-icon" />
                  <span className="folder-name">{folder}</span>
                  <span className="folder-count">{notes.filter(n => n.folder === folder).length}</span>
                </button>
              ))}
            </div>

            <div className="notes-list-v2">
              {filteredNotes.length === 0 ? (
                <div className="notes-empty-state">
                  <p className="empty-text-v2">No notes here</p>
                  <p className="empty-hint-v2">Click + to create one</p>
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
                      {note.folder && <span className="note-card-folder">{note.folder}</span>}
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
              {/* Title Input */}
              <div className="note-title-container">
                <div className="note-meta-inputs">
                  <div className="folder-input-wrapper">
                    <FontAwesomeIcon icon={faFolder} className="folder-input-icon" />
                    <input
                      type="text"
                      placeholder="Folder..."
                      value={noteFolder}
                      onChange={handleFolderChange}
                      className="note-folder-input"
                      list="existing-folders"
                    />
                    <datalist id="existing-folders">
                      {folders.filter(f => f !== 'All Notes').map(f => <option key={f} value={f} />)}
                    </datalist>
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="Note Title"
                  value={noteTitle}
                  onChange={handleTitleChange}
                  className="note-title-input"
                />
              </div>

              {/* Formatting Toolbar */}
              <div className="editor-toolbar">
                <button
                  className="toolbar-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execCommand('formatBlock', 'H1')}
                  title="Heading 1"
                  style={{ fontWeight: 'bold', fontSize: '14px' }}
                >
                  H1
                </button>
                <button
                  className="toolbar-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execCommand('formatBlock', 'H2')}
                  title="Heading 2"
                  style={{ fontWeight: 'bold', fontSize: '12px' }}
                >
                  H2
                </button>
                <div className="toolbar-separator"></div>
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
