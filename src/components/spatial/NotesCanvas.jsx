import {
  faBug,
  faCalendarCheck,
  faChevronRight,
  faClipboardList,
  faComments,
  faFile,
  faFolder,
  faLink,
  faListUl,
  faMicrophone,
  faPlus,
  faRocket,
  faRunning,
  faStickyNote,
  faSync,
  faTrash
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { NOTE_TEMPLATES, getTemplatesByCategory } from '../../services/noteTemplates';
import { p2pStorage } from '../../services/p2p/storageService';
import { teamManager } from '../../services/p2p/teamManager';
import { syncOrchestrator } from '../../services/syncOrchestrator';
import { marked } from 'marked';
import { getFaviconUrl } from '../../utils/helpers';
import { ShareNoteModal } from '../popups/ShareNoteModal';
import TiptapEditor from './editor/TiptapEditor';

// Icon mapping for templates
const TEMPLATE_ICONS = {
  faClipboardList,
  faRocket,
  faRunning,
  faComments,
  faCalendarCheck,
  faBug,
  faFile
};

// Memoized sidebar note item component for better performance
const SidebarNoteItem = memo(({ note, isActive, onSelect, onDelete }) => (
  <div
    onClick={() => onSelect(note)}
    className={`notes-list-item ${isActive ? 'active' : ''}`}
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
        <FontAwesomeIcon icon={faStickyNote} style={{ fontSize: 'var(--font-xs)', opacity: 0.5 }} />
      )}
      <span>{note.title || 'Untitled Note'}</span>
    </div>

    <div className="note-hover-actions">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(note);
        }}
        className="icon-btn-danger"
      >
        <FontAwesomeIcon icon={faTrash} />
      </button>
    </div>
  </div>
));



// Cache key for instant load
const CACHE_KEY = 'cool_notes_cache_v1';

// Helper to inject screenshot image if missing
const getNoteContentWithImage = (note) => {
  let content = note.text || note.content || note.description || '';
  if (note.type === 'screenshot' && (note.screenshot || note.imageData)) {
    const imgSrc = note.screenshot || `data:image/png;base64,${note.imageData}`;
    // Check if content already has the image to avoid duplication
    if (!content.includes(imgSrc)) {
      content = `<img src="${imgSrc}" alt="Screenshot" style="max-width: 100%; border-radius: 8px; margin-bottom: 16px;" /><p>${content}</p>`;
    }
  }
  return content;
};

const NotesCanvas = memo(function NotesCanvas({ workspaceId }) {
  // Try to load from cache synchronously to prevent checking "loading" state
  const cachedData = useMemo(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.warn('Failed to load notes from cache', e);
    }
    return null;
  }, []);

  const [notes, setNotes] = useState(cachedData?.notes || []);
  const [urlNotes, setUrlNotes] = useState(cachedData?.urlNotes || []);
  const [highlights, setHighlights] = useState(cachedData?.highlights || []);
  // If we have cached data, we are NOT loading from a UI perspective (optimistic)
  // We still fetch in background, but user sees content immediately.
  const [loading, setLoading] = useState(!cachedData);

  // Derive initial active note state synchronously from cache
  const initialUIState = useMemo(() => {
    if (!cachedData) return { activeNote: null, isEditing: false };

    try {
      const lastActiveId = localStorage.getItem('cool_notes_active_id');
      const lastActiveFolder = localStorage.getItem('cool_notes_active_folder');

      const allNotes = [...(cachedData.notes || []), ...(cachedData.urlNotes || []), ...(cachedData.highlights || [])];
      const found = lastActiveId ? allNotes.find(n => n.id === lastActiveId) : null;

      if (found) {
        return {
          activeNote: found,
          noteContent: getNoteContentWithImage(found),
          noteTitle: found.title || '',
          noteFolder: found.folder || '',
          noteUrl: found.url || '',
          isEditing: true,
          activeFolder: found.folder || lastActiveFolder || 'All Notes',
          expandedFolders: found.folder ? new Set(['All Notes', found.folder]) : new Set(['All Notes', lastActiveFolder].filter(Boolean))
        };
      } else if (lastActiveFolder) {
        return {
          activeNote: null,
          isEditing: false,
          activeFolder: lastActiveFolder,
          expandedFolders: new Set(['All Notes', lastActiveFolder])
        };
      }
    } catch (e) {
      console.warn('Failed to restore UI state from cache', e);
    }
    return { activeNote: null, isEditing: false };
  }, [cachedData]);

  const [activeNote, setActiveNote] = useState(initialUIState.activeNote);
  const [noteContent, setNoteContent] = useState(initialUIState.noteContent || '');
  const [noteTitle, setNoteTitle] = useState(initialUIState.noteTitle || '');
  const [noteFolder, setNoteFolder] = useState(initialUIState.noteFolder || '');
  const [activeFolder, setActiveFolder] = useState(initialUIState.activeFolder || 'All Notes');
  const [expandedFolders, setExpandedFolders] = useState(initialUIState.expandedFolders || new Set(['All Notes']));
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [isEditing, setIsEditing] = useState(initialUIState.isEditing || false);
  const [noteUrl, setNoteUrl] = useState(initialUIState.noteUrl || '');
  const [activeTeam, setActiveTeam] = useState(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [deleteConfirmNote, setDeleteConfirmNote] = useState(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [pendingTemplateFolder, setPendingTemplateFolder] = useState(null);
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
  const fetchAllData = useCallback(async (showLoadingSpinner = true) => {
    try {
      if (showLoadingSpinner) setLoading(true);
      console.log('[NotesCanvas] Starting consolidated data fetch...', showLoadingSpinner ? '(blocking)' : '(background)');

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

      // 0. Clean up duplicate templates (from previous bug with Date.now() IDs)
      const templateNotes = allRegularNotes.filter(n => n.folder === 'Templates');
      const seenTemplateTitles = new Map();
      const duplicateIds = [];

      for (const note of templateNotes) {
        if (seenTemplateTitles.has(note.title)) {
          // Keep the newer one, delete the older
          const existing = seenTemplateTitles.get(note.title);
          const existingTime = existing.updatedAt || existing.createdAt || 0;
          const currentTime = note.updatedAt || note.createdAt || 0;

          if (currentTime > existingTime) {
            duplicateIds.push(existing.id);
            seenTemplateTitles.set(note.title, note);
          } else {
            duplicateIds.push(note.id);
          }
        } else {
          seenTemplateTitles.set(note.title, note);
        }
      }

      // Delete duplicates
      if (duplicateIds.length > 0) {
        console.log('[NotesCanvas] Cleaning up', duplicateIds.length, 'duplicate template(s)');
        for (const id of duplicateIds) {
          await dbDeleteNote(id).catch(() => { });
        }
        // Remove from allRegularNotes array
        for (let i = allRegularNotes.length - 1; i >= 0; i--) {
          if (duplicateIds.includes(allRegularNotes[i].id)) {
            allRegularNotes.splice(i, 1);
          }
        }
      }

      // 1. Handle Default Templates initialization
      if (allRegularNotes.filter(n => n.folder === 'Templates').length === 0 && !settings?.defaultNotesCreated) {
        console.log('[NotesCanvas] Creating default templates...');

        let newNotesCount = 0;
        for (const [key, template] of Object.entries(NOTE_TEMPLATES)) {
          // Skip blank note
          if (key === 'blank') continue;

          try {
            // Use deterministic ID to prevent duplicates on re-runs
            const templateId = `template_default_${key}`;

            // Skip if this template already exists
            if (allRegularNotes.some(n => n.id === templateId)) {
              continue;
            }

            const defaultTemplateNote = {
              id: templateId,
              title: template.name,
              text: template.getContent(),
              folder: 'Templates',
              type: 'richtext',
              createdAt: Date.now(),
              updatedAt: Date.now()
            };
            await dbUpsertNote(defaultTemplateNote);
            allRegularNotes.push(defaultTemplateNote);
            newNotesCount++;
          } catch (e) {
            console.error('[NotesCanvas] failed to save default template', key, e);
          }
        }

        // Mark as created so we don't do this again
        await saveSettings({ ...settings, defaultNotesCreated: true });

        // Trigger a sync if we created notes
        if (newNotesCount > 0) {
          syncOrchestrator.syncNotes().catch(() => { });
        }
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

      // Update Cache for next load (Instant Load)
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          notes: workspaceNotes,
          urlNotes: uniqueUrlNotes,
          highlights: uniqueHighlights
        }));
      } catch (e) {
        console.warn('[NotesCanvas] Failed to update cache', e);
      }

      // Restore UI State
      try {
        const lastActiveId = localStorage.getItem('cool_notes_active_id');
        const lastActiveFolder = localStorage.getItem('cool_notes_active_folder');

        if (lastActiveId) {
          const allNotes = [...workspaceNotes, ...uniqueUrlNotes, ...uniqueHighlights];
          const found = allNotes.find(n => n.id === lastActiveId);
          if (found) {
            // Only update active note if it changed or wasn't set (avoid interrupting user if they started typing)
            // But here we are just syncing with DB.
            // If we already have an active note (optimistic), we might want to keep it unless the DB version is newer?
            // For now, simpler is better: update if found.
            // Check if we need to update active note (if changed or stale cache)
            if (!activeNote || activeNote.id !== found.id || (found.updatedAt && activeNote.updatedAt && found.updatedAt > activeNote.updatedAt)) {
              console.log('[NotesCanvas] Updating active note from DB (newer version found)');
              setActiveNote(found);
              // Use helper to ensure images are rendered for screenshot notes
              setNoteContent(getNoteContentWithImage(found));
              setNoteTitle(found.title || '');
              setNoteFolder(found.folder || '');
              setNoteUrl(found.url || '');
              setIsEditing(true);
            }
          }
        } else if (lastActiveFolder) {
          // Only force folder if valid
          if (!activeFolder) {
            setActiveFolder(lastActiveFolder);
            setExpandedFolders(prev => new Set([...prev, lastActiveFolder]));
          }
        }
      } catch (e) {
        console.warn('[NotesCanvas] Failed to restore UI state:', e);
      }

    } catch (error) {
      console.error('[NotesCanvas] Error loading data:', error);
      // Fallback to empty states
      setNotes([]);
      setUrlNotes([]);
      setHighlights([]);
    } finally {
      setLoading(false);
    }
  }, [activeFolder, activeNote]);

  // Data loading aliases defined above
  const loadNotes = fetchAllData;
  const loadUrlNotes = fetchAllData;
  const loadHighlights = fetchAllData;

  // Initial Load
  useEffect(() => {
    // If we have cached data, perform a silent background update
    fetchAllData(!cachedData);
  }, [fetchAllData, cachedData]);

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

          // Get the current notes to check against for duplicates
          const currentNotes = notes;

          for (const item of newItems) {
            if (item.type === 'NOTE_SHARE' && item.payload) {
              try {
                const note = item.payload;

                // Create a deterministic deterministic ID for the shared note
                const sharedNoteId = `shared_${note.id || Math.random().toString(36).slice(2, 6)}`;

                // Check if we already have this shared note imported
                const alreadyImported = currentNotes.some(n =>
                  n.id === sharedNoteId ||
                  (n.folder === 'Shared with Me' && n.title === `(Shared) ${note.title || 'Untitled'}`)
                );

                if (!alreadyImported) {
                  // Import shared note as a new copy
                  const importedNote = {
                    ...note,
                    id: sharedNoteId,
                    title: `(Shared) ${note.title || 'Untitled'}`,
                    folder: 'Shared with Me', // Put in a specific folder
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                  };

                  await dbUpsertNote(importedNote);
                  newNotesCount++;
                }
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

    // Defer P2P initialization to avoid blocking main thread during initial render
    const timer = setTimeout(() => {
      initAndSubscribe();
    }, 2000);

    return () => {
      clearTimeout(timer);
      isMounted = false;
      unsubscribe();
    };
  }, [activeTeam, loadNotes]);

  // Listen for global note updates (e.g. from Dashboard widget or sync)
  useEffect(() => {
    const handleNotesUpdated = (event) => {
      console.log('[NotesCanvas] 🔄 Received external update event:', event.detail);
      // Reload notes silently (background update)
      loadNotes(false);
    };

    window.addEventListener('notes-updated', handleNotesUpdated);
    return () => {
      window.removeEventListener('notes-updated', handleNotesUpdated);
    };
  }, [loadNotes]);

  // Subscribe to sync orchestrator for bidirectional sync
  useEffect(() => {
    const handleNotesSynced = (data) => {
      console.log('[NotesCanvas] 🔄 Notes synced from remote:', data?.length || 'object');
      loadNotes(false);
    };

    const handleUrlNotesSynced = (data) => {
      console.log('[NotesCanvas] 🔄 URL Notes synced from remote:', data?.length || 'object');
      loadNotes(false);
    };

    // Subscribe to sync events
    const unsubNotes = syncOrchestrator.on('notes-synced', handleNotesSynced);
    const unsubUrlNotes = syncOrchestrator.on('url-notes-synced', handleUrlNotesSynced);

    return () => {
      unsubNotes?.();
      unsubUrlNotes?.();
    };
  }, [loadNotes]);

  // Consolidated data loading logic moved up to avoid TDZ issues

  // Derived folders list with Special folders first
  const folders = useMemo(() => [
    'All Notes',
    'Templates',
    ...new Set(notes.map(n => n.folder).filter(Boolean).filter(f => f.trim() !== '' && f !== 'Templates')),
  ].sort((a, b) => {
    // Keep "All Notes" first
    if (a === 'All Notes') return -1;
    if (b === 'All Notes') return 1;

    // Keep Special folders at top
    const specialFolders = ['Templates'];
    const aSpecial = specialFolders.includes(a);
    const bSpecial = specialFolders.includes(b);

    if (aSpecial && !bSpecial) return -1;
    if (!aSpecial && bSpecial) return 1;

    if (aSpecial && bSpecial) {
      // Sort special folders among themselves
      return specialFolders.indexOf(a) - specialFolders.indexOf(b);
    }

    return a.localeCompare(b);
  }), [notes]);

  // Memoize workspace folders calculation to avoid re-calculation on every render
  const sortedWorkspaceFolders = useMemo(() => {
    // Get unique folders from regular notes, excluding empty/null
    const workspaceFolders = [...new Set(notes.map(n => n.folder || 'Uncategorized'))].sort();
    // Ensure Uncategorized is last
    const sortedFolders = workspaceFolders.filter(f => f !== 'Uncategorized' && f !== 'Templates');
    if (workspaceFolders.includes('Uncategorized')) sortedFolders.push('Uncategorized');
    return sortedFolders;
  }, [notes]);

  // Group highlights by URL
  const groupedHighlights = useMemo(() => {
    const groups = {};
    highlights.forEach(h => {
      // Use URL as key
      const url = h.url || 'Unknown URL';
      if (!groups[url]) {
        groups[url] = {
          id: `group-${url}`, // Virtual ID
          url,
          title: h.title && h.title !== 'Untitled Note' ? h.title : new URL(url).hostname, // Better title fallback
          count: 0,
          notes: [],
          updatedAt: h.updatedAt || h.createdAt || 0
        };
      } else if (groups[url].title === new URL(url).hostname && h.title && h.title !== 'Untitled Note') {
        // Upgrade title if we find a better one in a later highlight
        groups[url].title = h.title;
      }

      groups[url].count++;
      groups[url].notes.push(h);

      // Update timestamp to latest highlight
      const hTime = new Date(h.updatedAt || h.createdAt || 0).getTime();
      const gTime = new Date(groups[url].updatedAt).getTime();
      if (hTime > gTime) {
        groups[url].updatedAt = h.updatedAt || h.createdAt;
      }
    });

    return Object.values(groups).sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [highlights]);

  // Handle selection of a highlight group
  const handleGroupSelect = useCallback((group) => {
    // 1. Create a "Virtual" Note that concatenates all highlights
    // 2. We use HTML to format them nicely
    const combinedHtml = `
      <h2>Highlights from ${group.title}</h2>
      <p>Source: <a href="${group.url}" target="_blank">${group.url}</a></p>
      <ul>
        ${group.notes.map(n => `<li>${n.text || 'Empty Highlight'}</li>`).join('')}
      </ul>
    `;

    const virtualNote = {
      id: group.id,
      title: `${group.title} (${group.count})`,
      text: combinedHtml,
      url: group.url,
      folder: 'Highlights',
      isReadOnly: true, // Optional: prevent saving this as a new note for now
      updatedAt: group.updatedAt
    };

    setActiveNote(virtualNote);
    setNoteContent(combinedHtml);
    setNoteTitle(virtualNote.title);
    setNoteFolder('Highlights');
    setNoteUrl(group.url);
    setAutoSaveStatus('idle'); // Don't auto-save this virtual note
    setIsEditing(true);

    if (window.innerWidth < 800) {
      setShowSidebar(false);
    }
  }, []);

  // Daily Stories Logic
  const getAvailableStoryDates = useCallback(() => {
    const dates = [];
    const today = new Date();
    // Last 7 days
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }, []);



  // Filtered notes - show specific lists based on active folder
  const filteredNotes = useMemo(() => {
    if (activeFolder === 'URL Notes') {
      return urlNotes.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (activeFolder === 'Highlights') {
      // For Highlights folder, we use groupedHighlights for the list, 
      // but filteredNotes might still be used elsewhere. 
      // Actually, we replaced the usage in the render method, so this might be fine.
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
  const createNewNoteInFolder = useCallback((folder) => {
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
  }, [expandedFolders]);



  // Auto-save note (workspace or URL note) - optimized to avoid array.find
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
      const now = Date.now();

      if (isUrlNote) {
        // Use activeNote's createdAt if editing existing note
        const createdAt = noteId && activeNote?.id === noteId ? activeNote.createdAt : now;

        console.log('[NotesCanvas] Saving URL note, content length:', content.length);

        const urlNote = {
          id: noteId || `url_${now}_${Math.random().toString(36).slice(2, 8)}`,
          url: currentUrl || activeNote?.url || '',
          text: content,
          title: currentTitle,
          folder: 'URL Notes',
          type: 'url',
          createdAt,
          updatedAt: now
        };

        // Save to DB and trigger sync
        saveUrlNote(urlNote).then(() => {
          // Trigger sync to push URL notes to remote
          syncOrchestrator.syncUrlNotes().catch(() => { });
        }).catch(err => console.error('[NotesCanvas] Error saving URL note:', err));

        // Update state optimistically
        setUrlNotes(prev => {
          const existing = prev.findIndex(n => n.id === urlNote.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = urlNote;
            return updated;
          }
          return [urlNote, ...prev];
        });

        // Always update activeNote to reflect new updatedAt timestamp
        setActiveNote(urlNote);
      } else {
        // Use activeNote's createdAt if editing existing note
        const createdAt = noteId && activeNote?.id === noteId ? activeNote.createdAt : now;

        console.log('[NotesCanvas] Saving regular note, content length:', content.length);

        const note = {
          id: noteId || `${now}_${Math.random().toString(36).slice(2, 8)}`,
          text: content,
          title: currentTitle,
          folder: currentFolder,
          type: 'richtext',
          createdAt,
          updatedAt: now
        };

        // Save to DB and trigger sync
        dbUpsertNote(note).then(() => {
          // Trigger sync to push notes to remote
          syncOrchestrator.syncNotes().catch(() => { });
        }).catch(err => console.error('[NotesCanvas] Error saving note:', err));

        // Update state optimistically
        setNotes(prev => {
          const existing = prev.findIndex(n => n.id === note.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = note;
            return updated;
          }
          return [note, ...prev];
        });

        // Always update activeNote to reflect new updatedAt timestamp
        setActiveNote(note);
      }

      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('[NotesCanvas] Error saving note:', error);
      setAutoSaveStatus('error');
    }
  }, [activeNote, activeFolder]);

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
    const extracted = text.trim().split('\n')[0].substring(0, 50);

    if (extracted && extracted.length > 0) return extracted;

    // Fallbacks if no content text
    if (activeNote?.title && activeNote.title !== 'Untitled Note') return activeNote.title;
    if (activeNote?.url) {
      try {
        return new URL(activeNote.url).hostname;
      } catch (e) {
        // ignore
      }
    }

    return 'Untitled Note';
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

      // Enable On-Device Recognition (Chrome 139+)
      // This forces the browser to use local processing if available (requires language pack)
      if ('processLocally' in recognition) {
        recognition.processLocally = true;
      }


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
        // Fallback for missing language pack (On-Device mode failure)
        if (event.error === 'language-not-supported' && recognition.processLocally) {
          console.log('[NotesCanvas] Local language pack missing, falling back to network recognition...');
          recognition.stop();

          // Re-initialize without processLocally
          const fallbackRecognition = new SpeechRecognition();
          fallbackRecognition.continuous = true;
          fallbackRecognition.interimResults = true;
          fallbackRecognition.lang = 'en-US';
          // Explicitly do NOT set processLocally

          // Copy over handlers
          fallbackRecognition.onstart = recognition.onstart;
          fallbackRecognition.onend = recognition.onend;
          fallbackRecognition.onresult = recognition.onresult;
          fallbackRecognition.onerror = (e) => {
            // Only warn if it's not an abort (which happens on stop/restart)
            if (e.error !== 'aborted') {
              console.warn('[NotesCanvas] Fallback recognition error:', e.error);
            }
            setIsRecording(false);
            if (streamRef.current) {
              streamRef.current.getTracks().forEach(track => track.stop());
              streamRef.current = null;
            }
          };

          recognitionRef.current = fallbackRecognition;
          fallbackRecognition.start();
          return;
        }

        // Only warn for actual errors, ignore 'aborted' which can happen during toggle
        if (event.error !== 'aborted') {
          console.warn('[NotesCanvas] Speech recognition error:', event.error);
        }

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
  const handleDeleteNote = useCallback(async (noteId) => {
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
  }, [activeFolder, activeNote, loadNotes, loadUrlNotes]);

  // Helper to auto-format plain text / markdown into Rich Text HTML for Tiptap
  const formatAutoSummary = useCallback((text) => {
    if (!text) return text;
    // Already HTML (Tiptap content) — leave it alone
    if (text.includes('<p>') || text.includes('<h1>') || text.includes('<h2>') || text.includes('<ul>') || text.includes('<img')) return text;

    // Normalize bullet chars (•) to markdown dashes so marked handles them
    const normalized = text.replace(/^•\s*/gm, '- ');
    // Detect if it has any markdown structure worth converting
    const looksLikeMarkdown = /^#{1,6}\s|^\*\*|^[-*]\s|\*\*.*\*\*|^>\s|^```|^\d+\.\s/m.test(normalized);
    if (!looksLikeMarkdown) return text;

    return marked.parse(normalized, { breaks: true });
  }, []);

  // Select note (workspace or URL note)
  const selectNote = useCallback((note) => {
    setActiveNote(note);

    // Auto-format if it's a raw AI summary, but first check for images
    const rawContent = getNoteContentWithImage(note);
    const formattedContent = formatAutoSummary(rawContent);
    setNoteContent(formattedContent);

    setNoteTitle(note.title || '');
    setNoteFolder(note.folder || '');
    setNoteUrl(note.url || '');
    setAutoSaveStatus('idle');
    setIsEditing(true);

    // Auto-close sidebar on small screens
    if (window.innerWidth < 800) {
      setShowSidebar(false);
    }
  }, [formatAutoSummary]);

  const handleDaySelect = useCallback(async (dateStr) => {
    // Check if a note already exists for this day
    const existingDateNote = notes.find(n =>
      n.folder === 'Daily Stories' && n.title.includes(dateStr)
    );

    if (existingDateNote) {
      selectNote(existingDateNote);
      if (window.innerWidth < 800) setShowSidebar(false);
      return;
    }

    // Generate new story with loading state
    setLoading(true);
    try {
      const html = await generateDailyStory(dateStr);
      if (!html) return;

      const newNote = {
        id: `story_${dateStr}_${Date.now()}`,
        title: `Story - ${dateStr}`,
        text: html,
        folder: 'Daily Stories',
        type: 'richtext',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Save immediately
      await dbUpsertNote(newNote);

      // Refresh local state
      setNotes(prev => [newNote, ...prev]);
      setActiveNote(newNote);
      setNoteContent(html);
      setNoteTitle(newNote.title);
      setNoteFolder('Daily Stories');
      setNoteUrl('');
      setIsEditing(true);
      if (window.innerWidth < 800) setShowSidebar(false);
    } catch (error) {
      console.error('[NotesCanvas] Failed to generate story:', error);
    } finally {
      setLoading(false);
    }
  }, [notes, selectNote]);

  // Create new note - show template picker
  const createNewNote = useCallback(() => {
    // Cannot create new notes in URL Notes folder - they come from web pages
    if (activeFolder === 'URL Notes') {
      alert('URL notes are created automatically when you add notes to web pages. Switch to a different folder to create a workspace note.');
      return;
    }

    // Show template picker
    setPendingTemplateFolder(activeFolder === 'All Notes' ? '' : activeFolder);
    setShowTemplatePicker(true);
  }, [activeFolder]);

  // Apply selected template
  const applyTemplate = useCallback((templateId) => {
    const template = NOTE_TEMPLATES[templateId];
    if (!template) return;

    setActiveNote(null);
    setNoteContent(template.getContent());
    setNoteTitle(template.getTitle());
    setNoteUrl('');
    setNoteFolder(pendingTemplateFolder || '');
    setAutoSaveStatus('idle');
    setIsEditing(true);
    setShowTemplatePicker(false);
    setPendingTemplateFolder(null);

    setTimeout(() => {
      editorRef.current?.focus();
    }, 100);
  }, [pendingTemplateFolder]);

  const getWordCount = useCallback((html) => {
    if (!html) return 0;
    // Strip HTML tags using regex - faster than creating DOM elements
    const text = html.replace(/<[^>]*>/g, ' ');
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }, []);

  // Render sidebar note item using memoized component
  // UseCallback dependencies must be defined before this!
  const renderSidebarNoteItem = useCallback((note) => (
    <SidebarNoteItem
      key={note.id}
      note={note}
      isActive={activeNote?.id === note.id}
      onSelect={selectNote}
      onDelete={setDeleteConfirmNote}
    />
  ), [activeNote?.id, selectNote]);

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
              justifyContent: 'space-between',
              fontSize: 'var(--font-2xl)',
            }}>

              <span className="sidebar-title" style={{ padding: 0 }}>Notes</span>
              <button
                onClick={createNewNote}
                className="icon-btn"
                style={{
                  padding: '6px',
                  fontSize: 'var(--font-sm)',
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
              {/* Special Folder: Templates */}
              <div className="folder-group">
                <div
                  className={`folder-header ${expandedFolders.has('Templates') ? 'expanded' : ''}`}
                  onClick={() => toggleFolder('Templates')}
                  style={{
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    borderRadius: '8px',
                    color: activeFolder === 'Templates' ? 'var(--accent-blue)' : '#e2e8f0',
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
                      fontSize: 'var(--font-xs)',
                      transition: 'transform 0.2s',
                      transform: expandedFolders.has('Templates') ? 'rotate(90deg)' : 'rotate(0deg)',
                      opacity: 0.7
                    }}
                  />
                  <FontAwesomeIcon icon={faClipboardList} style={{ fontSize: 'var(--font-base)', opacity: 0.8 }} />
                  <span style={{ flex: 1 }}>Templates</span>

                  {/* Add Template Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      createNewNoteInFolder('Templates');
                    }}
                    className="folder-add-btn"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      padding: '4px',
                      cursor: 'pointer',
                      opacity: 0,
                      transition: 'opacity 0.2s',
                      marginRight: '4px'
                    }}
                    title="Create New Template"
                  >
                    <FontAwesomeIcon icon={faPlus} style={{ fontSize: 'var(--font-xs)' }} />
                  </button>
                  <span className="note-count">{notes.filter(n => n.folder === 'Templates').length}</span>
                </div>
                {expandedFolders.has('Templates') && (
                  <div className="folder-notes" style={{ paddingLeft: '28px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {notes.filter(n => n.folder === 'Templates').map(note => renderSidebarNoteItem(note))}
                  </div>
                )}
              </div>

              {sortedWorkspaceFolders.map(folderName => {
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
                          fontSize: 'var(--font-xs)',
                          transition: 'transform 0.2s',
                          transform: expandedFolders.has(folderName) ? 'rotate(90deg)' : 'rotate(0deg)',
                          opacity: 0.7
                        }}
                      />
                      <FontAwesomeIcon icon={folderName === 'Uncategorized' ? faStickyNote : faFolder} style={{ fontSize: 'var(--font-base)', opacity: 0.8 }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folderName}</span>

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
                          transition: 'opacity 0.2s',
                          marginRight: '4px'
                        }}
                        title={`New note in ${folderName}`}
                      >
                        <FontAwesomeIcon icon={faPlus} style={{ fontSize: 'var(--font-xs)' }} />
                      </button>

                      <span className="note-count">{folderNotes.length}</span>
                    </div>

                    {expandedFolders.has(folderName) && (
                      <div className="folder-notes" style={{ paddingLeft: '28px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {folderNotes.map(note => renderSidebarNoteItem(note))}
                      </div>
                    )}
                  </div>
                );
              })}
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
              {/* Header Section: Unified Controls & Context */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
                {/* Row 1: Main Controls (Sidebar | Folder | Title | Share) */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {/* Sidebar Toggle */}
                  <button
                    onClick={() => setShowSidebar(!showSidebar)}
                    title={showSidebar ? "Hide Sidebar" : "Show Sidebar"}
                    style={{
                      padding: '8px',
                      borderRadius: '10px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-primary)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      height: '40px',
                      width: '40px',
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
                  <div style={{ position: 'relative', width: '180px', flexShrink: 0 }}>
                    <FontAwesomeIcon
                      icon={faFolder}
                      style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                        fontSize: 'var(--font-sm)',
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
                        padding: '0 12px 0 34px',
                        borderRadius: '10px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border-primary)',
                        color: 'var(--text)',
                        fontSize: 'var(--font-sm)',
                        height: '40px',
                        fontWeight: 500,
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

                  {/* Title Input */}
                  <input
                    type="text"
                    placeholder="Note Title"
                    value={noteTitle}
                    onChange={handleTitleChange}
                    style={{
                      flex: 1,
                      padding: '0 16px',
                      borderRadius: '10px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-primary)',
                      color: 'var(--text)',
                      fontSize: 'var(--font-lg)',
                      fontWeight: 600,
                      height: '40px',
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

                  {/* Share Button (P2P) */}
                  {activeTeam && (
                    <button
                      onClick={() => setIsShareModalOpen(true)}
                      title={`Share currently open note`}
                      style={{
                        padding: '0 16px',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-blue))',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'all 0.2s ease',
                        height: '40px',
                        flexShrink: 0,
                        fontWeight: 600,
                        fontSize: 'var(--font-sm)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                        justifyContent: 'center',
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
                      <FontAwesomeIcon icon={faSync} style={{ fontSize: 'var(--font-sm)' }} />
                      <span>Share</span>
                    </button>
                  )}

                  {/* Share Modal */}
                  <div onClick={e => e.stopPropagation()}>
                    <ShareNoteModal
                      isOpen={isShareModalOpen}
                      onClose={() => setIsShareModalOpen(false)}
                      note={{
                        ...activeNote,
                        text: noteContentRef.current || noteContent,
                        title: noteTitle || 'Untitled Note',
                        folder: noteFolder || 'Shared'
                      }}
                      activeTeamId={activeTeam?.id}
                    />
                  </div>
                </div>

                {/* Row 2: URL Context (if present) - Subtle Chip */}
                {activeNote?.url && (
                  <div style={{ paddingLeft: '4px' }}>
                    <a
                      href={activeNote.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '4px 10px',
                        borderRadius: '20px',
                        background: 'rgba(59, 130, 246, 0.08)',
                        border: '1px solid rgba(59, 130, 246, 0.15)',
                        color: 'var(--accent-blue)',
                        fontSize: 'var(--font-xs)',
                        fontWeight: 500,
                        textDecoration: 'none',
                        transition: 'all 0.2s ease',
                        maxWidth: '100%',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                        e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
                        e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.15)';
                      }}
                    >
                      <FontAwesomeIcon icon={faLink} style={{ fontSize: '10px' }} />
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {activeNote.url.replace(/^https?:\/\/(www\.)?/, '')}
                      </span>
                    </a>
                  </div>
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
                fontSize: 'var(--font-sm)',
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
              <div style={{ fontSize: 'var(--font-5xl)', opacity: 0.3 }}><FontAwesomeIcon icon={faStickyNote} /></div>
              <h3 style={{ margin: 0, fontSize: 'var(--font-2xl)', fontWeight: 600, color: 'var(--text)' }}>Select a Note</h3>
              <button
                onClick={createNewNote}
                className="notes-new-btn"
                style={{
                  padding: '12px 24px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                  border: 'none',
                  color: 'white',
                  fontSize: 'var(--font-base)',
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
              fontSize: 'var(--font-2xl)',
              fontWeight: 600,
              color: 'var(--text-primary)'
            }}>
              Delete Note?
            </h3>
            <p style={{
              margin: '0 0 24px 0',
              fontSize: 'var(--font-base)',
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
                  fontSize: 'var(--font-base)',
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
                  fontSize: 'var(--font-base)',
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

      {/* Template Picker Modal - Redesigned */}
      {showTemplatePicker && (
        <div
          className="template-picker-overlay"
          onClick={() => setShowTemplatePicker(false)}
        >
          <div
            className="template-picker-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="template-picker-header">
              <div>
                <h2>Create New Note</h2>
                <p>Choose a template to get started</p>
              </div>
              <button
                className="template-picker-close"
                onClick={() => setShowTemplatePicker(false)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Template Grid */}
            <div className="template-picker-content">
              {/* Custom Templates */}
              {notes.filter(n => n.folder === 'Templates').length > 0 && (
                <div className="template-category">
                  <div className="template-category-header">
                    <span className="template-category-name">My Custom Templates</span>
                    <span className="template-category-count">{notes.filter(n => n.folder === 'Templates').length}</span>
                  </div>
                  <div className="template-grid">
                    {notes.filter(n => n.folder === 'Templates').map(template => (
                      <button
                        key={template.id}
                        className="template-card"
                        onClick={() => {
                          // Apply custom template content
                          setActiveNote(null);
                          setNoteContent(template.text || '');
                          setNoteTitle(template.title || 'Untitled');
                          setNoteUrl('');
                          setNoteFolder(pendingTemplateFolder || '');
                          setAutoSaveStatus('idle');
                          setIsEditing(true);
                          setShowTemplatePicker(false);
                          setPendingTemplateFolder(null);

                          setTimeout(() => {
                            editorRef.current?.focus();
                          }, 100);
                        }}
                      >
                        <div className="template-card-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                          <FontAwesomeIcon icon={faStickyNote} />
                        </div>
                        <div className="template-card-content">
                          <span className="template-card-name">
                            {template.title || 'Untitled Template'}
                          </span>
                          <span className="template-card-desc">
                            Custom workspace template
                          </span>
                        </div>
                        <div className="template-card-arrow">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {Object.entries(getTemplatesByCategory()).map(([catId, category]) => (
                <div key={catId} className="template-category">
                  <div className="template-category-header">
                    <span className="template-category-name">{category.name}</span>
                    <span className="template-category-count">{category.templates.length}</span>
                  </div>
                  <div className="template-grid">
                    {category.templates.map(template => (
                      <button
                        key={template.id}
                        className="template-card"
                        onClick={() => applyTemplate(template.id)}
                      >
                        <div className="template-card-icon">
                          <FontAwesomeIcon icon={TEMPLATE_ICONS[template.icon] || faFile} />
                        </div>
                        <div className="template-card-content">
                          <span className="template-card-name">
                            {template.name}
                          </span>
                          <span className="template-card-desc">
                            {template.description}
                          </span>
                        </div>
                        <div className="template-card-arrow">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer hint */}
            <div className="template-picker-footer">
              <span>Press <kbd>Esc</kbd> to close</span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .note-count {
          background: rgba(255, 255, 255, 0.08);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 600;
          color: var(--text-secondary);
          min-width: 16px;
          text-align: center;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

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

        /* Template Picker Styles */
        .template-picker-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          z-index: 10000; animation: fadeIn 0.2s ease-out;
        }

        .template-picker-modal {
          background: #1e1e24; /* Fallback */
          background: var(--surface-1, #1e1e24);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          width: 90%; max-width: 900px; height: 80vh; max-height: 800px;
          display: flex; flex-direction: column;
          box-shadow: 0 24px 64px rgba(0,0,0,0.6);
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          overflow: hidden;
        }

        .template-picker-header {
          padding: 24px 32px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          display: flex; justify-content: space-between; align-items: flex-start;
          background: rgba(255, 255, 255, 0.02);
        }

        .template-picker-header h2 {
          margin: 0 0 4px 0; font-size: 24px; font-weight: 600;
          background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }

        .template-picker-header p {
          margin: 0; color: #94a3b8; font-size: 14px;
        }

        .template-picker-close {
          background: transparent; border: none; color: #94a3b8;
          cursor: pointer; padding: 8px; border-radius: 8px;
          transition: all 0.2s; display: flex;
        }

        .template-picker-close:hover {
          background: rgba(255, 255, 255, 0.1); color: #fff;
        }

        .template-picker-content {
          flex: 1; overflow-y: auto; padding: 32px;
        }

        .template-category { margin-bottom: 40px; }
        
        .template-category:last-child { margin-bottom: 0; }

        .template-category-header {
          display: flex; align-items: center; gap: 12px; margin-bottom: 20px;
        }

        .template-category-name {
          font-size: 12px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.08em; color: #64748b;
        }

        .template-category-count {
          background: rgba(255, 255, 255, 0.05); padding: 2px 8px;
          border-radius: 12px; font-size: 10px; color: #94a3b8;
        }

        .template-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }

        .template-card {
           background: rgba(255, 255, 255, 0.03);
           border: 1px solid rgba(255, 255, 255, 0.05);
           border-radius: 12px; padding: 20px;
           text-align: left; cursor: pointer;
           transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
           display: flex; align-items: flex-start; gap: 16px;
           position: relative; overflow: hidden;
        }

        .template-card:hover {
          transform: translateY(-2px);
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(99, 102, 241, 0.4);
          box-shadow: 0 12px 24px rgba(0,0,0,0.2);
        }
        
        .template-card:active {
           transform: translateY(0);
        }

        .template-card-icon {
          font-size: 24px;
          background: rgba(255,255,255,0.05);
          width: 48px; height: 48px;
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: all 0.2s;
        }
        
        .template-card:hover .template-card-icon {
           background: rgba(99, 102, 241, 0.2);
           color: #fff;
        }

        .template-card-content { flex: 1; min-width: 0; }

        .template-card-name {
          display: block; font-size: 15px; font-weight: 600;
          color: #e2e8f0; margin-bottom: 6px;
        }

        .template-card-desc {
          display: block; font-size: 13px; color: #94a3b8;
          line-height: 1.5;
        }

        .template-card-arrow {
          opacity: 0; transform: translateX(-10px);
          transition: all 0.2s; color: #818cf8;
          align-self: center;
        }

        .template-card:hover .template-card-arrow {
          opacity: 1; transform: translateX(0);
        }

        .template-picker-footer {
          padding: 16px 32px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          background: rgba(0, 0, 0, 0.2);
          color: #64748b; font-size: 13px; text-align: right;
        }

        .template-picker-footer kbd {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px; padding: 2px 6px;
          font-family: monospace; color: #cbd5e1;
          margin: 0 4px;
        }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { 
           from { opacity: 0; transform: translateY(20px) scale(0.98); } 
           to { opacity: 1; transform: translateY(0) scale(1); } 
        }
      `}</style>
    </div >
  );
});

// Responsive styles
const style = document.createElement('style');
style.textContent = `
    .notes-sidebar {
        width: 280px;
        transition: transform 0.3s ease;
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


export { NotesCanvas };

