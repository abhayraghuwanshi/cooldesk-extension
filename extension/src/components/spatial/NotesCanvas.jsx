import {
  faBold,
  faCheckSquare,
  faClock,
  faFolder,
  faFolderOpen,
  faHighlighter,
  faItalic,
  faLink,
  faListUl,
  faMicrophone,
  faPlus,
  faStickyNote,
  faSync,
  faThumbtack,
  faTrash
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteNote as dbDeleteNote,
  listNotes as dbListNotes,
  upsertNote as dbUpsertNote,
  deleteUrlNote,
  listAllUrlNotes,
  saveUrlNote
} from '../../db/index.js';
import { getFaviconUrl } from '../../utils';
import { defaultFontFamily } from '../../utils/fontUtils.js';

export function NotesCanvas({ workspaceId }) {
  const [notes, setNotes] = useState([]);
  const [urlNotes, setUrlNotes] = useState([]);
  const [highlights, setHighlights] = useState([]);
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
  const [noteUrl, setNoteUrl] = useState('');
  const editorRef = useRef(null);
  const autoSaveTimeout = useRef(null);

  // Load workspace notes
  const loadNotes = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      const result = await dbListNotes();
      const allNotes = result?.data || result || [];
      const notesArray = Array.isArray(allNotes) ? allNotes : [];

      // Exclude URL notes and highlights from regular notes - they appear in their own special folders
      const regularNotes = notesArray.filter(note => {
        // First check if it's a highlight (priority)
        if (note.type === 'highlight' || note.isHighlight) {
          return false; // Exclude - goes to Highlights folder
        }
        // Then check if it's a URL note (has URL and is not a highlight)
        if (note.url && typeof note.url === 'string' && note.url.length > 0) {
          return false; // Exclude - goes to URL Notes folder
        }
        // Otherwise it's a regular note
        return true;
      });

      setNotes(regularNotes);
    } catch (error) {
      console.error('[NotesCanvas] Error loading notes:', error);
      if (showLoading) setNotes([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Load all URL notes from the url_notes store
  const loadUrlNotes = useCallback(async () => {
    try {
      console.log('[NotesCanvas] Loading URL notes from url_notes store...');

      // URL notes are stored in a separate url_notes store in IndexedDB
      const result = await listAllUrlNotes();
      const urlNotesArray = (result?.data || result || []).filter(note =>
        !(note.type === 'highlight')
      );

      // Also check regular notes database for URL notes (that are not highlights)
      const regularNotesResult = await dbListNotes();
      const allRegularNotes = regularNotesResult?.data || regularNotesResult || [];
      const urlNotesFromRegular = (Array.isArray(allRegularNotes) ? allRegularNotes : []).filter(note =>
        note.url && typeof note.url === 'string' && note.url.length > 0 &&
        !(note.type === 'highlight' || note.isHighlight)
      );

      // Combine both sources and deduplicate by ID
      const combinedUrlNotes = [...urlNotesArray, ...urlNotesFromRegular];
      const uniqueUrlNotes = Array.from(new Map(combinedUrlNotes.map(note => [note.id, note])).values());

      console.log('[NotesCanvas] Found', uniqueUrlNotes.length, 'URL notes (', urlNotesArray.length, 'from url_notes store,', urlNotesFromRegular.length, 'from regular notes)');
      setUrlNotes(uniqueUrlNotes);
    } catch (error) {
      console.error('[NotesCanvas] Error loading URL notes:', error);
      setUrlNotes([]);
    }
  }, []);

  // Load highlights from daily notes
  const loadHighlights = useCallback(async () => {
    try {
      // Local storage data removed - only showing notes from IndexedDB
      const allHighlights = [];

      // Also check regular notes database for highlights
      const regularNotesResult = await dbListNotes();
      const allRegularNotes = regularNotesResult?.data || regularNotesResult || [];
      const highlightsFromRegular = (Array.isArray(allRegularNotes) ? allRegularNotes : []).filter(note =>
        note.type === 'highlight' || note.isHighlight
      );

      // Also check url_notes store for highlights (they might have been saved there)
      const urlNotesResult = await listAllUrlNotes();
      const allUrlNotes = urlNotesResult?.data || urlNotesResult || [];
      const highlightsFromUrlNotes = (Array.isArray(allUrlNotes) ? allUrlNotes : []).filter(note =>
        note.type === 'highlight' || note.isHighlight
      );

      // Combine all sources and deduplicate by ID
      const combinedHighlights = [...allHighlights, ...highlightsFromRegular, ...highlightsFromUrlNotes];
      const uniqueHighlights = Array.from(new Map(combinedHighlights.map(note => [note.id, note])).values());

      console.log('[NotesCanvas] Found', uniqueHighlights.length, 'highlights (', allHighlights.length, 'from daily notes,', highlightsFromRegular.length, 'from regular notes,', highlightsFromUrlNotes.length, 'from url_notes store)');
      setHighlights(uniqueHighlights);
    } catch (error) {
      console.error('[NotesCanvas] Error loading highlights:', error);
      setHighlights([]);
    }
  }, []);

  useEffect(() => {
    loadNotes();
    loadUrlNotes();
    loadHighlights();
  }, [loadNotes, loadUrlNotes, loadHighlights]);

  // Derived folders list with URL Notes and Highlights special folders
  const folders = [
    'All Notes',
    ...new Set(notes.map(n => n.folder).filter(Boolean).filter(f => f.trim() !== '')),
    'Highlights',
    'URL Notes'
  ].sort((a, b) => {
    // Keep "All Notes" first
    if (a === 'All Notes') return -1;
    if (b === 'All Notes') return 1;

    // Keep "Highlights" and "URL Notes" at the bottom
    const specialFolders = ['Highlights', 'URL Notes'];
    const aSpecial = specialFolders.includes(a);
    const bSpecial = specialFolders.includes(b);

    if (aSpecial && !bSpecial) return 1;
    if (!aSpecial && bSpecial) return -1;

    if (aSpecial && bSpecial) {
      // Sort special folders among themselves
      return specialFolders.indexOf(a) - specialFolders.indexOf(b);
    }

    return a.localeCompare(b);
  });

  // Filtered notes - show specific lists based on active folder
  let filteredNotes = [];

  if (activeFolder === 'URL Notes') {
    filteredNotes = urlNotes.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (activeFolder === 'Highlights') {
    filteredNotes = highlights.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else {
    filteredNotes = notes
      .filter(note => activeFolder === 'All Notes' || note.folder === activeFolder)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }

  // Group notes by time period (Apple Notes style)
  const groupNotesByDate = (notesToGroup) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const last7Days = new Date(today);
    last7Days.setDate(last7Days.getDate() - 7);
    const last30Days = new Date(today);
    last30Days.setDate(last30Days.getDate() - 30);
    const thisYear = new Date(now.getFullYear(), 0, 1);

    const groups = {
      'Pinned': [],
      'Today': [],
      'Yesterday': [],
      'Previous 7 Days': [],
      'Previous 30 Days': [],
      'This Year': [],
      'Older': []
    };

    notesToGroup.forEach(note => {
      const noteDate = new Date(note.updatedAt || note.createdAt);

      if (note.pinned) {
        groups['Pinned'].push(note);
      } else if (noteDate >= today) {
        groups['Today'].push(note);
      } else if (noteDate >= yesterday) {
        groups['Yesterday'].push(note);
      } else if (noteDate >= last7Days) {
        groups['Previous 7 Days'].push(note);
      } else if (noteDate >= last30Days) {
        groups['Previous 30 Days'].push(note);
      } else if (noteDate >= thisYear) {
        groups['This Year'].push(note);
      } else {
        groups['Older'].push(note);
      }
    });

    // Return only non-empty groups
    return Object.entries(groups).filter(([_, notes]) => notes.length > 0);
  };

  const groupedNotes = groupNotesByDate(filteredNotes);

  // Auto-save note (workspace or URL note)
  const saveNote = useCallback(async (content, noteId = null) => {
    // Avoid saving empty new notes
    if (!content.trim() && !noteId) return;

    try {
      setAutoSaveStatus('saving');

      // Check if this is a URL note
      const isUrlNote = activeFolder === 'URL Notes' || activeNote?.url;
      const currentTitle = titleRef.current || extractTitle(content);
      const currentFolder = folderRef.current;
      const currentUrl = urlRef.current;

      if (isUrlNote) {
        // Save as URL note
        const urlNote = {
          id: noteId || `url_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          url: currentUrl || activeNote?.url || '',
          text: content,
          title: currentTitle,
          folder: 'URL Notes',
          type: 'url',
          createdAt: noteId ? (urlNotes.find(n => n.id === noteId)?.createdAt || Date.now()) : Date.now(),
          updatedAt: Date.now()
        };

        await saveUrlNote(urlNote);
        await loadUrlNotes();

        if (!noteId && activeNote?.id !== urlNote.id) {
          setActiveNote(urlNote);
        }
      } else {
        // Save as regular workspace note
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
        await loadNotes(false);

        if (!noteId && activeNote?.id !== note.id) {
          setActiveNote(note);
        }
      }

      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('[NotesCanvas] Error saving note:', error);
      setAutoSaveStatus('error');
    }
  }, [notes, urlNotes, loadNotes, loadUrlNotes, activeNote, activeFolder]);

  const titleRef = useRef('');
  const folderRef = useRef('');
  const urlRef = useRef('');

  useEffect(() => { titleRef.current = noteTitle; }, [noteTitle]);
  useEffect(() => { folderRef.current = noteFolder; }, [noteFolder]);
  useEffect(() => { urlRef.current = noteUrl; }, [noteUrl]);

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

  // Delete note (workspace or URL note)
  const handleDeleteNote = async (noteId) => {
    try {
      const isUrlNote = activeFolder === 'URL Notes' || activeNote?.url;

      if (isUrlNote) {
        await deleteUrlNote(noteId);
        await loadUrlNotes();
      } else {
        await dbDeleteNote(noteId);
        await loadNotes();
      }

      if (activeNote?.id === noteId) {
        setActiveNote(null);
        setNoteContent('');
        setNoteUrl('');
        setIsEditing(false);
      }
    } catch (error) {
      console.error('[NotesCanvas] Error deleting note:', error);
    }
  };

  // Select note (workspace or URL note)
  const selectNote = (note) => {
    setActiveNote(note);
    setNoteContent(note.text || '');
    setNoteTitle(note.title || '');
    setNoteFolder(note.folder || '');
    setNoteUrl(note.url || '');
    setAutoSaveStatus('idle');
    setIsEditing(true);
  };

  // Create new note
  const createNewNote = () => {
    // Cannot create new notes in URL Notes folder - they come from web pages
    if (activeFolder === 'URL Notes') {
      alert('URL notes are created automatically when you add notes to web pages. Switch to a different folder to create a workspace note.');
      return;
    }

    setActiveNote(null);
    setNoteContent('');
    setNoteTitle('');
    setNoteUrl('');
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
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '40%',
              overflow: 'hidden'
            }}>
              <div className="custom-scrollbar" style={{
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                overflowY: 'auto'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 0 4px', // Adjusted padding since container has padding
                  marginBottom: '4px'
                }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Folders
                  </span>
                  <button
                    onClick={createNewNote}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      fontSize: '11px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--surface-3)';
                      e.currentTarget.style.color = 'var(--text)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }}
                    title="Create New Note"
                  >
                    <FontAwesomeIcon icon={faPlus} />
                  </button>
                </div>

                <button
                  onClick={() => setActiveFolder('All Notes')}
                  className={`notes-sidebar-btn ${activeFolder === 'All Notes' ? 'active' : ''}`}
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
                  <span className="notes-badge" style={{
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
                    className={`notes-sidebar-btn ${activeFolder === folder ? 'active' : ''}`}
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
                    <FontAwesomeIcon icon={folder === 'URL Notes' ? faLink : folder === 'Highlights' ? faHighlighter : (activeFolder === folder ? faFolderOpen : faFolder)} style={{ fontSize: '16px' }} />
                    <span style={{ flex: 1, fontSize: '14px', fontWeight: 500 }}>{folder}</span>
                    <span className="notes-badge" style={{
                      padding: '2px 8px',
                      borderRadius: '8px',
                      background: activeFolder === folder ? 'var(--accent-blue)' : 'var(--surface-3)',
                      color: activeFolder === folder ? 'white' : 'var(--text-secondary)',
                      fontSize: '11px',
                      fontWeight: 600
                    }}>
                      {folder === 'URL Notes' ? urlNotes.length : folder === 'Highlights' ? highlights.length : notes.filter(n => n.folder === folder).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Notes List */}
            <div style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(16px)',
              borderRadius: '16px',
              border: '1px solid var(--border-primary)',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden'
            }}>
              <div className="custom-scrollbar" style={{
                padding: '12px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                flex: 1
              }}>
                {groupedNotes.length === 0 ? (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '40px 20px',
                    textAlign: 'center',
                    gap: '8px'
                  }}>
                    <div style={{ fontSize: '32px', opacity: 0.3 }}><FontAwesomeIcon icon={faStickyNote} /></div>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>No notes here</p>
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>Click + to create one</p>
                  </div>
                ) : (
                  groupedNotes.map(([groupName, groupNotes]) => (
                    <div key={groupName} style={{ marginBottom: '8px' }}>
                      {/* Group Header */}
                      <div style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: groupName === 'Pinned' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        padding: '8px 4px 6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        {groupName === 'Pinned' && <FontAwesomeIcon icon={faThumbtack} style={{ fontSize: '12px', marginRight: '4px' }} />}
                        {groupName}
                        <span style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '8px',
                          background: 'var(--surface-3)',
                          color: 'var(--text-muted)',
                          fontWeight: 500
                        }}>
                          {groupNotes.length}
                        </span>
                      </div>
                      {/* Notes in this group */}
                      {groupNotes.map((note) => (
                        <div
                          key={note.id}
                          onClick={() => selectNote(note)}
                          className={`notes-list-item ${activeNote?.id === note.id ? 'active' : ''}`}
                          style={{
                            padding: '10px 12px',
                            borderRadius: '10px',
                            marginBottom: '4px',
                            background: activeNote?.id === note.id ? 'var(--accent-blue-soft)' : 'var(--surface-2)',
                            border: activeNote?.id === note.id ? '1px solid var(--accent-blue-border)' : '1px solid var(--border-secondary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            position: 'relative'
                          }}
                          onMouseEnter={(e) => {
                            if (activeNote?.id !== note.id) {
                              e.currentTarget.style.background = 'var(--interactive-hover)';
                            }
                            // Show hover elements
                            const hoverEl = e.currentTarget.querySelector('.note-hover-meta');
                            if (hoverEl) hoverEl.style.opacity = '1';
                          }}
                          onMouseLeave={(e) => {
                            if (activeNote?.id !== note.id) {
                              e.currentTarget.style.background = 'var(--surface-2)';
                            }
                            // Hide hover elements
                            const hoverEl = e.currentTarget.querySelector('.note-hover-meta');
                            if (hoverEl) hoverEl.style.opacity = '0';
                          }}
                        >
                          {/* Note Title with Favicon for URL notes */}
                          <div style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            color: 'var(--text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}>
                            {note.url && (
                              <img
                                src={getFaviconUrl(note.url, 16)}
                                alt=""
                                style={{
                                  width: '16px',
                                  height: '16px',
                                  borderRadius: '3px',
                                  flexShrink: 0
                                }}
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                }}
                              />
                            )}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {note.title || 'Untitled Note'}
                            </span>
                          </div>
                          {/* Note Preview */}
                          <div
                            style={{
                              fontSize: '12px',
                              color: 'var(--text-secondary)',
                              lineHeight: '1.3',
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical'
                            }}
                            dangerouslySetInnerHTML={{
                              __html: note.text ?
                                (note.text.replace(/<[^>]*>/g, '').substring(0, 100) + (note.text.length > 100 ? '...' : ''))
                                : '<i>Empty note</i>'
                            }}
                          />
                          {/* Folder tag (always visible) */}
                          {note.folder && (
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: 'var(--surface-3)',
                              fontSize: '9px',
                              color: 'var(--text-muted)',
                              alignSelf: 'flex-start',
                              marginTop: '2px'
                            }}>
                              {note.folder}
                            </span>
                          )}
                          {/* Hover Meta - Date and Delete (only visible on hover) */}
                          <div
                            className="note-hover-meta"
                            style={{
                              position: 'absolute',
                              bottom: '8px',
                              right: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              opacity: 0,
                              transition: 'opacity 0.2s ease'
                            }}
                          >
                            <span style={{
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}>
                              <FontAwesomeIcon icon={faClock} style={{ fontSize: '9px' }} />
                              {new Date(note.updatedAt || note.createdAt).toLocaleDateString()}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Delete this note?')) handleDeleteNote(note.id);
                              }}
                              style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: 'none',
                                color: '#f87171',
                                cursor: 'pointer',
                                padding: '4px 6px',
                                borderRadius: '4px',
                                transition: 'all 0.2s ease',
                                fontSize: '10px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                              }}
                            >
                              <FontAwesomeIcon icon={faTrash} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
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
              {/* URL Context Banner for URL Notes */}
              {activeNote?.url && (
                <div className="notes-url-banner" style={{
                  padding: '12px 16px',
                  background: 'linear-gradient(135deg, var(--accent-blue-soft), var(--surface-2))',
                  border: '1px solid var(--accent-blue-border)',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexShrink: 0,
                  marginBottom: '12px'
                }}>
                  <div style={{
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px',
                    color: 'var(--accent-blue)'
                  }}>
                    <FontAwesomeIcon icon={faLink} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '10px',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontWeight: 600,
                      marginBottom: '4px'
                    }}>
                      Note for URL
                    </div>
                    <a
                      href={activeNote.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '13px',
                        color: 'var(--accent-blue)',
                        textDecoration: 'none',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                    >
                      {activeNote.url}
                    </a>
                  </div>
                </div>
              )}

              {/* Title and Folder Inputs - Same Line */}
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
                {/* Folder Input */}
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

                {/* Title Input */}
                <input
                  type="text"
                  placeholder="Note Title"
                  value={noteTitle}
                  onChange={handleTitleChange}
                  style={{
                    flex: 1,
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
              <div className="notes-editor-toolbar" style={{
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
                className="notes-editor-content"
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
                  fontFamily: defaultFontFamily,
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
              <div style={{ fontSize: '64px', opacity: 0.3 }}><FontAwesomeIcon icon={faStickyNote} /></div>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text)' }}>Select a Note</h3>
              <button
                onClick={createNewNote}
                className="notes-new-btn"
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
        
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--border-secondary);
          border-radius: 4px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}
