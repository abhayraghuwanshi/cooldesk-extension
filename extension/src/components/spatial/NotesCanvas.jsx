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
  faSync,
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
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '16px',
        color: 'var(--text-secondary)'
      }}>
        <FontAwesomeIcon icon={faSync} spin style={{ fontSize: '32px' }} />
        <p style={{ margin: 0, fontSize: '14px' }}>Loading your notes...</p>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      position: isFullScreen ? 'fixed' : 'relative',
      top: isFullScreen ? 0 : 'auto',
      left: isFullScreen ? 0 : 'auto',
      right: isFullScreen ? 0 : 'auto',
      bottom: isFullScreen ? 0 : 'auto',
      zIndex: isFullScreen ? 9999 : 'auto',
      background: isFullScreen ? 'var(--surface-0)' : 'transparent'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(16px)',
        borderRadius: '16px',
        border: '1px solid var(--border-primary)',
        marginBottom: '20px',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '8px',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--interactive-hover)';
              e.currentTarget.style.color = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
          >
            <FontAwesomeIcon icon={faStickyNote} />
          </button>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>Notes</h1>
          <span style={{
            padding: '4px 10px',
            borderRadius: '12px',
            background: 'var(--accent-blue-soft)',
            border: '1px solid var(--accent-blue-border)',
            color: 'var(--accent-blue)',
            fontSize: '12px',
            fontWeight: 500
          }}>
            {notes.length}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {autoSaveStatus !== 'idle' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: autoSaveStatus === 'saving' ? 'var(--accent-blue)' :
                autoSaveStatus === 'saved' ? 'var(--accent-primary)' :
                  'var(--accent-error)'
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'currentColor',
                animation: autoSaveStatus === 'saving' ? 'pulse 1.5s infinite' : 'none'
              }} />
              <span>
                {autoSaveStatus === 'saving' ? 'Saving...' :
                  autoSaveStatus === 'saved' ? 'Saved' : 'Unsaved'}
              </span>
            </div>
          )}

          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '8px',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--interactive-hover)';
              e.currentTarget.style.color = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            title={isFullScreen ? 'Exit focus mode' : 'Focus mode'}
          >
            <FontAwesomeIcon icon={isFullScreen ? faCompress : faExpand} />
          </button>

          <button
            onClick={createNewNote}
            style={{
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              border: 'none',
              borderRadius: '10px',
              padding: '8px 16px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(96, 165, 250, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
            title="New note"
          >
            <FontAwesomeIcon icon={faPlus} />
            <span>New</span>
          </button>
        </div>
      </div>

      <div style={{
        display: 'flex',
        gap: '20px',
        flex: 1,
        overflow: 'hidden',
        minHeight: 0
      }}>
        {/* Sidebar */}
        {showSidebar && !isFullScreen && (
          <div style={{
            width: '280px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            flexShrink: 0
          }}>
            {/* Folder List */}
            <div style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(16px)',
              borderRadius: '16px',
              border: '1px solid var(--border-primary)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <div style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '8px 12px 4px',
                marginBottom: '4px'
              }}>
                Folders
              </div>

              <button
                onClick={() => setActiveFolder('All Notes')}
                style={{
                  background: activeFolder === 'All Notes' ? 'var(--accent-blue-soft)' : 'transparent',
                  border: activeFolder === 'All Notes' ? '1px solid var(--accent-blue-border)' : '1px solid transparent',
                  borderRadius: '10px',
                  padding: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  textAlign: 'left',
                  color: activeFolder === 'All Notes' ? 'var(--accent-blue)' : 'var(--text)'
                }}
                onMouseEnter={(e) => {
                  if (activeFolder !== 'All Notes') {
                    e.currentTarget.style.background = 'var(--interactive-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeFolder !== 'All Notes') {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <FontAwesomeIcon icon={activeFolder === 'All Notes' ? faFolderOpen : faFolder} style={{ fontSize: '16px' }} />
                <span style={{ flex: 1, fontSize: '14px', fontWeight: 500 }}>All Notes</span>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '8px',
                  background: activeFolder === 'All Notes' ? 'var(--accent-blue)' : 'var(--surface-3)',
                  color: activeFolder === 'All Notes' ? 'white' : 'var(--text-secondary)',
                  fontSize: '11px',
                  fontWeight: 600
                }}>
                  {notes.length}
                </span>
              </button>

              {folders.filter(f => f !== 'All Notes').map(folder => (
                <button
                  key={folder}
                  onClick={() => setActiveFolder(folder)}
                  style={{
                    background: activeFolder === folder ? 'var(--accent-blue-soft)' : 'transparent',
                    border: activeFolder === folder ? '1px solid var(--accent-blue-border)' : '1px solid transparent',
                    borderRadius: '10px',
                    padding: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    textAlign: 'left',
                    color: activeFolder === folder ? 'var(--accent-blue)' : 'var(--text)'
                  }}
                  onMouseEnter={(e) => {
                    if (activeFolder !== folder) {
                      e.currentTarget.style.background = 'var(--interactive-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeFolder !== folder) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <FontAwesomeIcon icon={activeFolder === folder ? faFolderOpen : faFolder} style={{ fontSize: '16px' }} />
                  <span style={{ flex: 1, fontSize: '14px', fontWeight: 500 }}>{folder}</span>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '8px',
                    background: activeFolder === folder ? 'var(--accent-blue)' : 'var(--surface-3)',
                    color: activeFolder === folder ? 'white' : 'var(--text-secondary)',
                    fontSize: '11px',
                    fontWeight: 600
                  }}>
                    {notes.filter(n => n.folder === folder).length}
                  </span>
                </button>
              ))}
            </div>

            {/* Notes List */}
            <div style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(16px)',
              borderRadius: '16px',
              border: '1px solid var(--border-primary)',
              padding: '12px',
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minHeight: 0
            }}>
              {filteredNotes.length === 0 ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  textAlign: 'center',
                  gap: '8px'
                }}>
                  <div style={{ fontSize: '32px', opacity: 0.3 }}>📝</div>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>No notes here</p>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>Click + to create one</p>
                </div>
              ) : (
                filteredNotes.map((note) => (
                  <div
                    key={note.id}
                    onClick={() => selectNote(note)}
                    style={{
                      padding: '12px',
                      borderRadius: '10px',
                      background: activeNote?.id === note.id ? 'var(--accent-blue-soft)' : 'var(--surface-2)',
                      border: activeNote?.id === note.id ? '1px solid var(--accent-blue-border)' : '1px solid var(--border-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                    onMouseEnter={(e) => {
                      if (activeNote?.id !== note.id) {
                        e.currentTarget.style.background = 'var(--interactive-hover)';
                        e.currentTarget.style.transform = 'translateX(2px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (activeNote?.id !== note.id) {
                        e.currentTarget.style.background = 'var(--surface-2)';
                        e.currentTarget.style.transform = 'translateX(0)';
                      }
                    }}
                  >
                    <div
                      style={{
                        fontSize: '13px',
                        color: 'var(--text)',
                        lineHeight: '1.4',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical'
                      }}
                      dangerouslySetInnerHTML={{
                        __html: note.text ?
                          (note.text.length > 200 ? note.text.substring(0, 200) + '...' : note.text)
                          : '<i style="color: var(--text-muted);">Empty note</i>'
                      }}
                    />
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      color: 'var(--text-secondary)'
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <FontAwesomeIcon icon={faClock} />
                        {new Date(note.updatedAt || note.createdAt).toLocaleDateString()}
                      </span>
                      {note.folder && (
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: 'var(--surface-3)',
                          fontSize: '10px'
                        }}>
                          {note.folder}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Delete this note?')) handleDeleteNote(note.id);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '4px',
                          borderRadius: '4px',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--accent-error)';
                          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'var(--text-muted)';
                          e.currentTarget.style.background = 'transparent';
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
        <div style={{
          flex: 1,
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(16px)',
          borderRadius: '16px',
          border: '1px solid var(--border-primary)',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflow: 'hidden',
          minHeight: 0
        }}>
          {isEditing ? (
            <>
              {/* Title Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: '0 0 200px' }}>
                    <FontAwesomeIcon
                      icon={faFolder}
                      style={{
                        position: 'absolute',
                        left: '14px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                        fontSize: '14px',
                        pointerEvents: 'none'
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Folder..."
                      value={noteFolder}
                      onChange={handleFolderChange}
                      list="existing-folders"
                      style={{
                        width: '100%',
                        padding: '10px 14px 10px 40px',
                        borderRadius: '10px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border-primary)',
                        color: 'var(--text)',
                        fontSize: '13px',
                        outline: 'none',
                        transition: 'all 0.2s ease'
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = 'var(--accent-blue)';
                        e.target.style.background = 'var(--surface-3)';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = 'var(--border-primary)';
                        e.target.style.background = 'var(--surface-2)';
                      }}
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
                  style={{
                    padding: '12px 16px',
                    borderRadius: '10px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text)',
                    fontSize: '20px',
                    fontWeight: 600,
                    outline: 'none',
                    transition: 'all 0.2s ease'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'var(--accent-blue)';
                    e.target.style.background = 'var(--surface-3)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'var(--border-primary)';
                    e.target.style.background = 'var(--surface-2)';
                  }}
                />
              </div>

              {/* Formatting Toolbar */}
              <div style={{
                display: 'flex',
                gap: '6px',
                flexWrap: 'wrap',
                padding: '12px',
                background: 'var(--surface-2)',
                borderRadius: '10px',
                border: '1px solid var(--border-secondary)',
                flexShrink: 0
              }}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execCommand('formatBlock', 'H1')}
                  title="Heading 1"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--interactive-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  H1
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execCommand('formatBlock', 'H2')}
                  title="Heading 2"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    fontWeight: 'bold',
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--interactive-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  H2
                </button>
                <div style={{ width: '1px', height: '24px', background: 'var(--border-secondary)', margin: '0 4px' }} />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execCommand('bold')}
                  title="Bold (Ctrl+B)"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--interactive-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <FontAwesomeIcon icon={faBold} />
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execCommand('italic')}
                  title="Italic (Ctrl+I)"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--interactive-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <FontAwesomeIcon icon={faItalic} />
                </button>
                <div style={{ width: '1px', height: '24px', background: 'var(--border-secondary)', margin: '0 4px' }} />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => execCommand('insertUnorderedList')}
                  title="Bullet List"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--interactive-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <FontAwesomeIcon icon={faListUl} />
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={insertCheckbox}
                  title="Insert Checkbox"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--interactive-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <FontAwesomeIcon icon={faCheckSquare} />
                </button>
                <div style={{ width: '1px', height: '24px', background: 'var(--border-secondary)', margin: '0 4px' }} />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggleRecording}
                  title={isRecording ? 'Stop Recording' : 'Start Recording'}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: isRecording ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                    border: 'none',
                    color: isRecording ? 'var(--accent-error)' : 'var(--text)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isRecording) e.currentTarget.style.background = 'var(--interactive-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isRecording) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <FontAwesomeIcon icon={faMicrophone} beat={isRecording} />
                </button>
              </div>

              {/* Rich Text Editor */}
              <div
                ref={editorRef}
                contentEditable
                onInput={handleContentChange}
                suppressContentEditableWarning={true}
                onKeyDown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
                  }
                }}
                style={{
                  flex: 1,
                  padding: '16px',
                  borderRadius: '10px',
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border-secondary)',
                  color: 'var(--text)',
                  fontSize: '15px',
                  lineHeight: '1.6',
                  outline: 'none',
                  overflowY: 'auto',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                  minHeight: 0
                }}
              />

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                padding: '8px 0',
                flexShrink: 0
              }}>
                <span>{getWordCount(noteContent)} words</span>
                <span>
                  {activeNote ? 'Last edited: ' + new Date(activeNote.updatedAt).toLocaleTimeString() : 'New Note'}
                </span>
              </div>
            </>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              gap: '20px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '64px', opacity: 0.3 }}>📝</div>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text)' }}>Select a Note</h3>
              <button
                onClick={createNewNote}
                style={{
                  padding: '12px 24px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                  border: 'none',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(96, 165, 250, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                Create New Note
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
