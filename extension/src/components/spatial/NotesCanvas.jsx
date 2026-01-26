import {
  faChevronRight,
  faFolder,
  faHighlighter,
  faLink,
  faListUl,
  faMicrophone,
  faPlus,
  faStickyNote,
  faSync,
  faTrash
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteNote as dbDeleteNote,
  listNotes as dbListNotes,
  upsertNote as dbUpsertNote,
  deleteUrlNote,
  getSettings,
  listAllUrlNotes,
  saveSettings,
  saveUrlNote
} from '../../db/index.js';
import { p2pStorage } from '../../services/p2p/storageService';
import { teamManager } from '../../services/p2p/teamManager';
import { getFaviconUrl } from '../../utils/helpers';
import { ShareNoteModal } from '../popups/ShareNoteModal';
import TiptapEditor from './editor/TiptapEditor';

// Default notes to help users understand CoolDesk features
const DEFAULT_NOTES = [
  {
    id: 'guide_welcome',
    title: 'Welcome to CoolDesk',
    folder: 'Getting Started',
    type: 'richtext',
    text: `<p>CoolDesk is your personal productivity companion that helps you organize your browsing, take notes, and stay focused.</p>
<h2>Quick Tips</h2>
<ul>
<li><strong>Create Notes</strong> - Click the + button to create new notes</li>
<li><strong>Organize with Folders</strong> - Use folders to categorize your notes</li>
<li><strong>Rich Text Editing</strong> - Format your notes with bold, italic, headings, and lists</li>
<li><strong>Voice Input</strong> - Use the microphone button to dictate notes</li>
<li><strong>Auto-Save</strong> - Your notes are automatically saved as you type</li>
</ul>
<p>Check out the other notes in the <strong>Getting Started</strong> folder for more tips!</p>`
  },
  {
    id: 'guide_workspaces',
    title: 'Workspaces & Tab Management',
    folder: 'Getting Started',
    type: 'richtext',
    text: `<p>CoolDesk helps you organize your browser tabs into workspaces for better productivity.</p>
<h2>Workspace Features</h2>
<ul>
<li><strong>Create Workspaces</strong> - Group related tabs together (Work, Research, Personal)</li>
<li><strong>Auto Tab Cleanup</strong> - Automatically close inactive tabs to reduce clutter</li>
<li><strong>Recently Closed</strong> - Easily restore tabs you accidentally closed</li>
<li><strong>Tab Limits</strong> - Set limits to prevent tab overload</li>
</ul>
<h2>Protected Tabs</h2>
<p>The following tabs are never auto-closed:</p>
<ul>
<li>Pinned tabs</li>
<li>Active/current tab</li>
<li>Tabs playing audio/video</li>
<li>Important domains (Gmail, GitHub, etc.)</li>
</ul>`
  },
  {
    id: 'guide_highlights',
    title: 'Highlights & URL Notes',
    folder: 'Getting Started',
    type: 'richtext',
    text: `<p>Capture information from any webpage directly into CoolDesk!</p>
<h2>Text Highlights</h2>
<ul>
<li><strong>Select any text</strong> on a webpage</li>
<li><strong>Click the CoolDesk button</strong> that appears</li>
<li>Your highlight is saved with the source URL</li>
<li>Find all highlights in the <strong>Highlights</strong> folder</li>
</ul>
<h2>URL Notes</h2>
<ul>
<li>Add notes specific to any webpage</li>
<li>Notes are linked to the URL for easy reference</li>
<li>Find all URL notes in the <strong>URL Notes</strong> folder</li>
</ul>
<p><em>Tip: Highlights and URL notes automatically include the source webpage link!</em></p>`
  },
  {
    id: 'guide_keyboard',
    title: 'Keyboard Shortcuts & Tips',
    folder: 'Getting Started',
    type: 'richtext',
    text: `<p>Speed up your workflow with these shortcuts:</p>
<h2>Note Editor</h2>
<ul>
<li><strong>Ctrl+B</strong> - Bold text</li>
<li><strong>Ctrl+I</strong> - Italic text</li>
<li><strong>Tab</strong> - Insert indent</li>
</ul>
<h2>Pro Tips</h2>
<ul>
<li>Use checkboxes for task lists</li>
<li>Pin important notes to keep them at the top</li>
<li>Use search to quickly find notes</li>
</ul>
<h2>Themes</h2>
<p>Customize CoolDesk with different themes! Go to settings to switch between light, dark, and accent color themes.</p>`
  }
];

// Function to create default notes for first-time users
const createDefaultNotes = async () => {
  const now = Date.now();
  for (let i = 0; i < DEFAULT_NOTES.length; i++) {
    const note = DEFAULT_NOTES[i];
    await dbUpsertNote({
      ...note,
      createdAt: now - (i * 1000), // Stagger creation times so they appear in order
      updatedAt: now - (i * 1000)
    });
  }
  console.log('[NotesCanvas] Created default guide notes');
};

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
  const [expandedFolders, setExpandedFolders] = useState(new Set(['All Notes', 'Highlights', 'URL Notes']));
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [noteUrl, setNoteUrl] = useState('');
  const [activeTeam, setActiveTeam] = useState(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [deleteConfirmNote, setDeleteConfirmNote] = useState(null);
  const editorRef = useRef(null);
  const autoSaveTimeout = useRef(null);
  // noteContentRef moved here for access in handlers
  const noteContentRef = useRef('');
  const titleRef = useRef('');
  const folderRef = useRef('');
  const urlRef = useRef('');

  // Sync refs with state
  useEffect(() => { titleRef.current = noteTitle; }, [noteTitle]);
  useEffect(() => { folderRef.current = noteFolder; }, [noteFolder]);
  useEffect(() => { urlRef.current = noteUrl; }, [noteUrl]);
  useEffect(() => { noteContentRef.current = noteContent; }, [noteContent]);

  // Share note with team
  const handleShareNote = async () => {
    if (!activeNote || !activeTeam) {
      alert('Please open a note and ensure you are in a team to share.');
      return;
    }

    // Use current content from ref if available (editor updates ref directly)
    const content = noteContentRef.current || noteContent;

    const noteToShare = {
      ...activeNote,
      text: content,
      title: noteTitle || 'Untitled Note',
      folder: noteFolder || 'Shared'
    };

    try {
      await p2pStorage.addItemToTeam(activeTeam.id, {
        type: 'NOTE_SHARE',
        payload: noteToShare,
        timestamp: Date.now()
      });
      // Visual feedback could be better than alert, but alert works for now
      alert(`Note shared with ${activeTeam.name}!`);
    } catch (e) {
      console.error('[NotesCanvas] Share failed:', e);
      alert('Failed to share note. Please check connection.');
    }
  };

  // Subscribe to Team Manager
  useEffect(() => {
    // Initial fetch
    const team = teamManager.getActiveTeam();
    if (team) setActiveTeam(team);

    // Subscribe to changes
    const unsubscribe = teamManager.subscribe(({ activeTeamId }) => {
      const currentTeam = teamManager.getTeam(activeTeamId);
      setActiveTeam(currentTeam || null);
    });

    return unsubscribe;
  }, []);

  // Consolidated data loading
  const fetchAllData = useCallback(async () => {
    try {
      setLoading(true);
      console.log('[NotesCanvas] Starting consolidated data fetch...');

      const startTime = Date.now();

      // Fetch both sources in parallel
      const [regularNotesResult, urlNotesResult, settings] = await Promise.all([
        dbListNotes(),
        listAllUrlNotes(),
        getSettings()
      ]);

      const rawRegularNotes = regularNotesResult?.data || regularNotesResult || [];
      const rawUrlNotes = urlNotesResult?.data || urlNotesResult || [];

      const allRegularNotes = Array.isArray(rawRegularNotes) ? rawRegularNotes : [];
      const allUrlNotes = Array.isArray(rawUrlNotes) ? rawUrlNotes : [];

      // 1. Handle Default Notes (if needed)
      if (allRegularNotes.length === 0 && !settings?.defaultNotesCreated) {
        console.log('[NotesCanvas] Creating default notes...');
        await createDefaultNotes();
        await saveSettings({ ...settings, defaultNotesCreated: true });

        // Quick re-fetch regular notes
        const reFetchResult = await dbListNotes();
        const reFetchedNotes = reFetchResult?.data || reFetchResult || [];
        allRegularNotes.push(...(Array.isArray(reFetchedNotes) ? reFetchedNotes : []));
      }

      // 2. Process Regular Notes (Desktop/Workspace notes)
      const workspaceNotes = allRegularNotes.filter(note => {
        if (note.type === 'highlight' || note.isHighlight) return false;
        if (note.url && typeof note.url === 'string' && note.url.length > 0) return false;
        return true;
      });

      // 3. Process URL Notes (from both stores)
      const urlNotesFromStore = allUrlNotes.filter(n => !(n.type === 'highlight'));
      const urlNotesFromRegular = allRegularNotes.filter(n =>
        n.url && typeof n.url === 'string' && n.url.length > 0 &&
        !(n.type === 'highlight' || n.isHighlight)
      );

      // Deduplicate URL notes
      const combinedUrlNotes = [...urlNotesFromStore, ...urlNotesFromRegular];
      const uniqueUrlNotes = Array.from(new Map(combinedUrlNotes.map(n => [n.id, n])).values());

      // 4. Process Highlights (from both stores)
      const highlightsFromStore = allUrlNotes.filter(n => n.type === 'highlight' || n.isHighlight);
      const highlightsFromRegular = allRegularNotes.filter(n => n.type === 'highlight' || n.isHighlight);

      const combinedHighlights = [...highlightsFromStore, ...highlightsFromRegular];
      const uniqueHighlights = Array.from(new Map(combinedHighlights.map(n => [n.id, n])).values());

      console.log(`[NotesCanvas] Data loaded in ${Date.now() - startTime}ms`);

      // Batch updates
      setNotes(workspaceNotes);
      setUrlNotes(uniqueUrlNotes);
      setHighlights(uniqueHighlights);

    } catch (error) {
      console.error('[NotesCanvas] Error loading data:', error);
      // Fallback to empty states
      setNotes([]);
      setUrlNotes([]);
      setHighlights([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Data loading aliases defined above
  const loadNotes = fetchAllData;
  const loadUrlNotes = fetchAllData;
  const loadHighlights = fetchAllData;

  // Initial Load
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Listen for shared notes from the team
  useEffect(() => {
    if (!activeTeam) return;

    let unsubscribe = () => { };
    let isMounted = true;

    const initAndSubscribe = async () => {
      try {
        // Ensure storage is initialized before subscribing
        // This prevents "Storage not initialized" error if TeamView hasn't been mounted yet
        await p2pStorage.initializeTeamStorage(activeTeam.id);

        if (!isMounted) return;

        unsubscribe = p2pStorage.subscribeToSharedItems(activeTeam.id, async (newItems) => {
          console.log('[NotesCanvas] Received shared items:', newItems);

          let newNotesCount = 0;

          for (const item of newItems) {
            if (item.type === 'NOTE_SHARE' && item.payload) {
              try {
                const note = item.payload;
                // Import shared note as a new copy
                const importedNote = {
                  ...note,
                  id: `${Date.now()}_shared_${Math.random().toString(36).slice(2, 6)}`,
                  title: `(Shared) ${note.title || 'Untitled'}`,
                  folder: 'Shared with Me', // Put in a specific folder
                  createdAt: Date.now(),
                  updatedAt: Date.now()
                };

                await dbUpsertNote(importedNote);
                newNotesCount++;
              } catch (e) {
                console.error('[NotesCanvas] Error saving shared note:', e);
              }
            }
          }

          if (newNotesCount > 0) {
            // Refresh notes to show the new one
            loadNotes(false);
          }
        });
      } catch (err) {
        console.error('[NotesCanvas] Failed to initialize storage subscription:', err);
      }
    };

    initAndSubscribe();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [activeTeam, loadNotes]);

  // Consolidated data loading logic moved up to avoid TDZ issues

  // Derived folders list with URL Notes and Highlights special folders
  const folders = useMemo(() => [
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
  }), [notes]);

  // Filtered notes - show specific lists based on active folder
  const filteredNotes = useMemo(() => {
    if (activeFolder === 'URL Notes') {
      return urlNotes.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (activeFolder === 'Highlights') {
      return highlights.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else {
      return notes
        .filter(note => activeFolder === 'All Notes' || note.folder === activeFolder)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    }
  }, [activeFolder, urlNotes, highlights, notes]);

  // Toggle folder expansion
  const toggleFolder = (folder) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  // Create note in specific folder
  const createNewNoteInFolder = (folder) => {
    setActiveNote(null);
    setNoteContent('');
    setNoteTitle('');
    setNoteUrl('');
    setNoteFolder(folder === 'Uncategorized' ? '' : folder);
    setAutoSaveStatus('idle');
    setIsEditing(true);

    // Ensure folder is expanded
    if (!expandedFolders.has(folder)) {
      toggleFolder(folder);
    }

    setTimeout(() => {
      editorRef.current?.focus();
      if (editorRef.current) editorRef.current.innerHTML = '';
    }, 100);
  };

  // Render sidebar note item
  const renderSidebarNoteItem = (note) => (
    <div
      key={note.id}
      onClick={() => selectNote(note)}
      className={`notes-list-item ${activeNote?.id === note.id ? 'active' : ''}`}
      style={{
        padding: '6px 12px 6px 36px', // Indented
        borderRadius: '6px',
        marginBottom: '1px',
        background: activeNote?.id === note.id ? 'var(--accent-blue-soft)' : 'transparent',
        borderLeft: activeNote?.id === note.id ? '2px solid var(--accent-blue)' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        position: 'relative',
        fontSize: 'var(--font-sm)',
        color: activeNote?.id === note.id ? 'var(--text)' : '#e2e8f0'
      }}
      onMouseEnter={(e) => {
        if (activeNote?.id !== note.id) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
          e.currentTarget.style.color = 'var(--text)';
        }
        const hoverEl = e.currentTarget.querySelector('.note-hover-actions');
        if (hoverEl) hoverEl.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        if (activeNote?.id !== note.id) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }
        const hoverEl = e.currentTarget.querySelector('.note-hover-actions');
        if (hoverEl) hoverEl.style.opacity = '0';
      }}
    >
      <div style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}>
        {note.url ? (
          <img
            src={getFaviconUrl(note.url, 16)}
            alt=""
            style={{ width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0 }}
            onError={(e) => e.target.style.display = 'none'}
          />
        ) : (
          <FontAwesomeIcon icon={faStickyNote} style={{ fontSize: '10px', opacity: 0.5 }} />
        )}
        <span>{note.title || 'Untitled Note'}</span>
      </div>

      <div className="note-hover-actions" style={{
        opacity: 0,
        display: 'flex',
        gap: '4px',
        transition: 'opacity 0.2s'
      }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDeleteConfirmNote(note);
          }}
          className="icon-btn-danger"
          style={{
            background: 'none',
            border: 'none',
            padding: '2px',
            color: '#ef4444',
            cursor: 'pointer',
            fontSize: '10px'
          }}
        >
          <FontAwesomeIcon icon={faTrash} />
        </button>
      </div>
    </div>
  );

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

        // Update state optimistically instead of full reload
        setUrlNotes(prev => {
          const existing = prev.findIndex(n => n.id === urlNote.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = urlNote;
            return updated;
          }
          return [urlNote, ...prev];
        });

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

        // Update state optimistically instead of full reload
        setNotes(prev => {
          const existing = prev.findIndex(n => n.id === note.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = note;
            return updated;
          }
          return [note, ...prev];
        });

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
  }, [notes, urlNotes, activeNote, activeFolder]);

  // Refs and Sync Effects moved to top

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

  const triggerAutoSave = useCallback((content) => {
    setAutoSaveStatus('unsaved');
    clearTimeout(autoSaveTimeout.current);
    const contentToSave = content !== undefined ? content : noteContentRef.current;

    autoSaveTimeout.current = setTimeout(() => {
      saveNote(contentToSave, activeNote?.id);
    }, 1000);
  }, [saveNote, activeNote?.id]);

  const extractTitle = (html) => {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const text = temp.textContent || temp.innerText || '';
    return text.trim().split('\n')[0].substring(0, 50) || 'Untitled Note';
  };

  // Handle content change
  // Handle content change
  // We avoid updating state (setNoteContent) on every keystroke to prevent re-rendering the whole canvas
  // TiptapEditor manages its own state, and we just need this for auto-save and reference
  const handleContentChange = useCallback((newHtml) => {
    noteContentRef.current = newHtml;
    triggerAutoSave(newHtml);
  }, [triggerAutoSave]);


  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);
  const streamRef = useRef(null);

  // Sync content when active note changes
  // Sync content when active note changes - Tiptap handles this internal to the component via content prop
  // We just need to ensure noteContent is updated when activeNote changes (done in selectNote)
  useEffect(() => {
    if (activeNote) {
      // Optional: focus editor when switching notes if desired, but might be annoying
      // editorRef.current?.focus();
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
          editorRef.current.insertContent(finalTranscript + ' ');
          // No need to manually call handleContentChange as insertContent triggers onUpdate in Tiptap
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

    // Auto-close sidebar on small screens
    if (window.innerWidth < 800) {
      setShowSidebar(false);
    }
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
        <FontAwesomeIcon icon={faSync} spin style={{ fontSize: 'var(--font-5xl)' }} />
        <p style={{ margin: 0, fontSize: 'var(--font-lg)' }}>Loading your notes...</p>
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
          <div className="notes-sidebar">
            <div className="sidebar-header" style={{
              padding: '16px 16px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span className="sidebar-title" style={{ padding: 0 }}>Notes</span>
              <button
                onClick={createNewNote}
                className="icon-btn"
                style={{
                  padding: '6px',
                  fontSize: '12px',
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text)',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="New Note"
              >
                <FontAwesomeIcon icon={faPlus} />
              </button>
            </div>

            <div className="notes-list custom-scrollbar" style={{ padding: '0 12px 12px' }}>
              {/* Special Folder: Highlights */}
              <div className="folder-group">
                <div
                  className={`folder-header ${expandedFolders.has('Highlights') ? 'expanded' : ''}`}
                  onClick={() => toggleFolder('Highlights')}
                  style={{
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    borderRadius: '8px',
                    color: activeFolder === 'Highlights' ? 'var(--accent-blue)' : '#e2e8f0',
                    fontWeight: 600,
                    fontSize: 'var(--font-sm)',
                    userSelect: 'none'
                  }}
                >
                  <FontAwesomeIcon
                    icon={faChevronRight}
                    style={{
                      fontSize: '10px',
                      transition: 'transform 0.2s',
                      transform: expandedFolders.has('Highlights') ? 'rotate(90deg)' : 'rotate(0deg)',
                      opacity: 0.7
                    }}
                  />
                  <FontAwesomeIcon icon={faHighlighter} style={{ fontSize: '14px', opacity: 0.8 }} />
                  <span style={{ flex: 1 }}>Highlights</span>
                  <span className="note-count">{highlights.length}</span>
                </div>
                {expandedFolders.has('Highlights') && (
                  <div className="folder-notes" style={{ paddingLeft: '28px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {highlights.length === 0 ? (
                      <div style={{ padding: '8px', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No highlights</div>
                    ) : (
                      highlights.map(note => renderSidebarNoteItem(note))
                    )}
                  </div>
                )}
              </div>

              {/* Special Folder: URL Notes */}
              <div className="folder-group">
                <div
                  className={`folder-header ${expandedFolders.has('URL Notes') ? 'expanded' : ''}`}
                  onClick={() => toggleFolder('URL Notes')}
                  style={{
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    borderRadius: '8px',
                    color: activeFolder === 'URL Notes' ? 'var(--accent-blue)' : '#e2e8f0',
                    fontWeight: 600,
                    fontSize: 'var(--font-sm)',
                    userSelect: 'none'
                  }}
                >
                  <FontAwesomeIcon
                    icon={faChevronRight}
                    style={{
                      fontSize: '10px',
                      transition: 'transform 0.2s',
                      transform: expandedFolders.has('URL Notes') ? 'rotate(90deg)' : 'rotate(0deg)',
                      opacity: 0.7
                    }}
                  />
                  <FontAwesomeIcon icon={faLink} style={{ fontSize: '14px', opacity: 0.8 }} />
                  <span style={{ flex: 1 }}>URL Notes</span>
                  <span className="note-count">{urlNotes.length}</span>
                </div>
                {expandedFolders.has('URL Notes') && (
                  <div className="folder-notes" style={{ paddingLeft: '28px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {urlNotes.length === 0 ? (
                      <div style={{ padding: '8px', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No URL notes</div>
                    ) : (
                      urlNotes.map(note => renderSidebarNoteItem(note))
                    )}
                  </div>
                )}
              </div>

              {/* Regular Folders */}
              {(() => {
                // Get unique folders from regular notes, excluding empty/null
                const workspaceFolders = [...new Set(notes.map(n => n.folder || 'Uncategorized'))].sort();
                // Ensure Uncategorized is last
                const sortedFolders = workspaceFolders.filter(f => f !== 'Uncategorized');
                if (workspaceFolders.includes('Uncategorized')) sortedFolders.push('Uncategorized');

                return sortedFolders.map(folderName => {
                  const folderNotes = notes.filter(n => (n.folder || 'Uncategorized') === folderName);
                  if (folderNotes.length === 0) return null;

                  return (
                    <div className="folder-group" key={folderName}>
                      <div
                        className={`folder-header ${expandedFolders.has(folderName) ? 'expanded' : ''}`}
                        onClick={() => toggleFolder(folderName)}
                        style={{
                          padding: '8px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          cursor: 'pointer',
                          borderRadius: '8px',
                          color: '#e2e8f0',
                          fontWeight: 600,
                          fontSize: 'var(--font-sm)',
                          userSelect: 'none'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <FontAwesomeIcon
                          icon={faChevronRight}
                          style={{
                            fontSize: '10px',
                            transition: 'transform 0.2s',
                            transform: expandedFolders.has(folderName) ? 'rotate(90deg)' : 'rotate(0deg)',
                            opacity: 0.7
                          }}
                        />
                        <FontAwesomeIcon icon={folderName === 'Uncategorized' ? faStickyNote : faFolder} style={{ fontSize: '14px', opacity: 0.8 }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folderName}</span>
                        <span className="note-count">{folderNotes.length}</span>

                        {/* Quick Add to Folder */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            createNewNoteInFolder(folderName);
                          }}
                          className="folder-add-btn"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'inherit',
                            padding: '4px',
                            cursor: 'pointer',
                            opacity: 0,
                            transition: 'opacity 0.2s'
                          }}
                          title={`New note in ${folderName}`}
                        >
                          <FontAwesomeIcon icon={faPlus} style={{ fontSize: '10px' }} />
                        </button>
                      </div>

                      {expandedFolders.has(folderName) && (
                        <div className="folder-notes" style={{ paddingLeft: '28px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {folderNotes.map(note => renderSidebarNoteItem(note))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
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
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                {/* Sidebar Toggle */}
                <button
                  onClick={() => setShowSidebar(!showSidebar)}
                  title={showSidebar ? "Hide Sidebar" : "Show Sidebar"}
                  style={{
                    padding: '8px',
                    borderRadius: '8px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    height: '36px',
                    width: '36px',
                    flexShrink: 0
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--surface-3)';
                    e.currentTarget.style.color = 'var(--text)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--surface-2)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  <FontAwesomeIcon icon={faListUl} />
                </button>

                {/* Folder Input */}
                <div style={{ position: 'relative', width: '160px', flexShrink: 0 }}>
                  <FontAwesomeIcon
                    icon={faFolder}
                    style={{
                      position: 'absolute',
                      left: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      fontSize: '12px',
                      pointerEvents: 'none'
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Folder"
                    value={noteFolder}
                    onChange={handleFolderChange}
                    list="existing-folders"
                    style={{
                      width: '100%',
                      padding: '8px 10px 8px 30px',
                      borderRadius: '8px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-primary)',
                      color: 'var(--text)',
                      fontSize: '13px',
                      height: '36px',
                      boxSizing: 'border-box',
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

                {/* Share Modal moved to end of header or outside to avoid layout issues, keeping modal here is fine as it's absolute/fixed usually, but button needs to move */}

                <ShareNoteModal
                  isOpen={isShareModalOpen}
                  onClose={() => setIsShareModalOpen(false)}
                  note={{
                    ...activeNote,
                    text: noteContentRef.current || noteContent, // Ensure latest content
                    title: noteTitle || 'Untitled Note',
                    folder: noteFolder || 'Shared'
                  }}
                  activeTeamId={activeTeam?.id}
                />

                {/* Title Input */}
                <input
                  type="text"
                  placeholder="Note Title"
                  value={noteTitle}
                  onChange={handleTitleChange}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text)',
                    fontSize: '16px',
                    fontWeight: 600,
                    height: '36px',
                    boxSizing: 'border-box',
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

                {/* Share Button (P2P) - Moved to Right */}
                {activeTeam && (
                  <button
                    onClick={() => setIsShareModalOpen(true)}
                    title={`Share currently open note`}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-blue))',
                      border: 'none',
                      color: 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.2s ease',
                      height: '36px',
                      flexShrink: 0,
                      fontWeight: 600,
                      fontSize: '12px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                      minWidth: '80px',
                      justifyContent: 'center',
                      marginLeft: '8px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '0.9';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <FontAwesomeIcon icon={faSync} style={{ fontSize: '12px' }} />
                    <span style={{ fontSize: '12px' }}>Share</span>
                  </button>
                )}
              </div>

              <div style={{
                position: 'relative',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                // Premium Glassmorphism Background
                background: 'linear-gradient(to bottom right, rgba(20, 20, 25, 0.95), rgba(30, 30, 35, 0.85))',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.05)',
                overflow: 'hidden'
              }}>
                {/* Voice Mic Button (Floating or Integrated) */}
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggleRecording}
                  title={isRecording ? 'Stop Recording' : 'Start Recording'}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    zIndex: 10,
                    padding: '8px',
                    borderRadius: '50%',
                    background: isRecording ? 'rgba(239, 68, 68, 0.1)' : 'var(--surface-3)',
                    border: isRecording ? '1px solid var(--accent-error)' : '1px solid var(--border-primary)',
                    color: isRecording ? 'var(--accent-error)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                  }}
                >
                  <FontAwesomeIcon icon={faMicrophone} beat={isRecording} />
                </button>

                <TiptapEditor
                  ref={editorRef}
                  content={noteContent}
                  onChange={handleContentChange}
                  isEditable={true}
                />
              </div>

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
      </div >

      {/* Delete Confirmation Modal */}
      {deleteConfirmNote && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}
          onClick={() => setDeleteConfirmNote(null)}
        >
          <div style={{
            background: 'var(--surface-1)',
            borderRadius: '12px',
            border: '1px solid var(--border-primary)',
            padding: '24px',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
          }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{
              margin: '0 0 12px 0',
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text-primary)'
            }}>
              Delete Note?
            </h3>
            <p style={{
              margin: '0 0 24px 0',
              fontSize: '14px',
              color: 'var(--text-secondary)',
              lineHeight: '1.5'
            }}>
              Are you sure you want to delete "{deleteConfirmNote.title || 'Untitled Note'}"? This action cannot be undone.
            </p>
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => setDeleteConfirmNote(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--surface-3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--surface-2)';
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleDeleteNote(deleteConfirmNote.id);
                  setDeleteConfirmNote(null);
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'var(--accent-error)',
                  border: 'none',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#dc2626';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--accent-error)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}


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
    </div >
  );
}

// Responsive styles
const style = document.createElement('style');
style.textContent = `
    .notes-sidebar {
        width: 280px;
        transition: transform 0.3s ease;
        padding-left: 8px;
    }
    .folder-text {
        display: inline;
        opacity: 1;
        transition: opacity 0.2s;
    }
    
    @media (max-width: 800px) {
        .notes-sidebar {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 280px;
            z-index: 100;
            background: var(--surface-1);
            border-right: 1px solid var(--border-primary);
            box-shadow: 4px 0 24px rgba(0,0,0,0.3);
            /* Ensure it sits above everything */
        }
        
        /* When we want to hide it, we rely on React unmounting it (showSidebar), 
           so we don't need a hidden class. mounting/unmounting is handled by JS. */
           
        .folder-text {
            display: inline !important;
            opacity: 1 !important;
        }
        .notes-sidebar-btn {
            justify-content: flex-start !important;
            padding: 12px !important;
        }
        .sidebar-header {
            justify-content: space-between !important;
            padding: 0 0 4px !important;
        }
    }
`;
document.head.appendChild(style);
