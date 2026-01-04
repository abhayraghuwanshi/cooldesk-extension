import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faStickyNote,
  faPlus,
  faTrash,
  faExpand,
  faCompress,
  faMicrophone,
  faSearch,
  faEllipsisV,
  faClock,
  faFileExport,
  faTags,
} from '@fortawesome/free-solid-svg-icons';
import { listNotes as dbListNotes, upsertNote as dbUpsertNote, deleteNote as dbDeleteNote } from '../../db/index.js';

/**
 * NotesCanvas - Modern, clean notes interface
 *
 * Features:
 * - Minimalist design with focus on content
 * - Instant search and filter
 * - Auto-save with visual feedback
 * - Full-screen distraction-free mode
 * - Smart timestamps and metadata
 */
export function NotesCanvas({ workspaceId }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeNote, setActiveNote] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef(null);
  const autoSaveTimeout = useRef(null);

  // Load notes
  const loadNotes = useCallback(async () => {
    try {
      setLoading(true);
      const result = await dbListNotes();
      const allNotes = result?.data || result || [];
      setNotes(Array.isArray(allNotes) ? allNotes : []);
    } catch (error) {
      console.error('[NotesCanvas] Error loading notes:', error);
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // Auto-save note
  const saveNote = useCallback(async (text, noteId = null) => {
    if (!text.trim()) return;

    try {
      setAutoSaveStatus('saving');

      const note = {
        id: noteId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: text.trim(),
        type: 'text',
        createdAt: noteId ? (notes.find(n => n.id === noteId)?.createdAt || Date.now()) : Date.now(),
      };

      console.log('[NotesCanvas] Saving note:', note);
      const result = await dbUpsertNote(note);
      console.log('[NotesCanvas] Save result:', result);

      await loadNotes();

      setAutoSaveStatus('saved');

      // Auto-hide saved status after 2 seconds
      setTimeout(() => {
        setAutoSaveStatus('idle');
      }, 2000);
    } catch (error) {
      console.error('[NotesCanvas] Error saving note:', error);
      setAutoSaveStatus('error');
    }
  }, [notes, loadNotes]);

  // Handle text change with auto-save
  const handleTextChange = (text) => {
    setNoteText(text);
    setAutoSaveStatus('unsaved');

    clearTimeout(autoSaveTimeout.current);
    autoSaveTimeout.current = setTimeout(() => {
      if (text.trim()) {
        saveNote(text, activeNote?.id);
      }
    }, 800);
  };

  // Delete note
  const handleDeleteNote = async (noteId) => {
    try {
      await dbDeleteNote(noteId);
      if (activeNote?.id === noteId) {
        setActiveNote(null);
        setNoteText('');
      }
      loadNotes();
    } catch (error) {
      console.error('[NotesCanvas] Error deleting note:', error);
    }
  };

  // Select note
  const selectNote = (note) => {
    setActiveNote(note);
    setNoteText(note.text);
    setAutoSaveStatus('idle');
    setIsEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  // Create new note
  const createNewNote = () => {
    setActiveNote(null);
    setNoteText('');
    setAutoSaveStatus('idle');
    setIsEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  // Toggle full screen
  const toggleFullScreen = () => {
    setIsFullScreen(!isFullScreen);
    if (!isFullScreen) {
      setShowSidebar(false);
    } else {
      setShowSidebar(true);
    }
  };

  // Filter notes by search
  const filteredNotes = notes.filter(note =>
    note.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Format timestamp
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get word count
  const getWordCount = (text) => {
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
      {/* Minimal Header */}
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
          {/* Auto-save indicator */}
          {autoSaveStatus !== 'idle' && (
            <div className={`notes-save-indicator ${autoSaveStatus}`}>
              {autoSaveStatus === 'saving' && (
                <>
                  <span className="save-dot saving"></span>
                  <span>Saving...</span>
                </>
              )}
              {autoSaveStatus === 'saved' && (
                <>
                  <span className="save-dot saved"></span>
                  <span>Saved</span>
                </>
              )}
              {autoSaveStatus === 'unsaved' && (
                <>
                  <span className="save-dot unsaved"></span>
                  <span>Unsaved</span>
                </>
              )}
            </div>
          )}

          <button
            className="notes-icon-btn"
            onClick={toggleFullScreen}
            title={isFullScreen ? 'Exit focus mode' : 'Focus mode'}
          >
            <FontAwesomeIcon icon={isFullScreen ? faCompress : faExpand} />
          </button>

          <button
            className="notes-icon-btn primary"
            onClick={createNewNote}
            title="New note (Ctrl+N)"
          >
            <FontAwesomeIcon icon={faPlus} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="notes-content-v2">
        {/* Sidebar */}
        {showSidebar && !isFullScreen && (
          <div className="notes-sidebar-v2">
            {/* Search */}
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

            {/* Notes List */}
            <div className="notes-list-v2">
              {filteredNotes.length === 0 ? (
                <div className="notes-empty-state">
                  {searchQuery ? (
                    <>
                      <div className="empty-icon-v2">🔍</div>
                      <p className="empty-text-v2">No notes found</p>
                      <p className="empty-hint-v2">Try a different search term</p>
                    </>
                  ) : (
                    <>
                      <div className="empty-icon-v2">✨</div>
                      <p className="empty-text-v2">No notes yet</p>
                      <p className="empty-hint-v2">Start writing to create your first note</p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {filteredNotes.map((note) => (
                    <div
                      key={note.id}
                      className={`note-card-v2 ${activeNote?.id === note.id ? 'active' : ''}`}
                      onClick={() => selectNote(note)}
                    >
                      <div className="note-card-content">
                        <p className="note-card-preview">
                          {note.text.substring(0, 120)}
                          {note.text.length > 120 ? '...' : ''}
                        </p>
                      </div>
                      <div className="note-card-footer">
                        <span className="note-card-time">
                          <FontAwesomeIcon icon={faClock} />
                          {formatTime(note.updatedAt || note.createdAt)}
                        </span>
                        <button
                          className="note-card-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('Delete this note?')) {
                              handleDeleteNote(note.id);
                            }
                          }}
                          title="Delete"
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* Editor */}
        <div className="notes-editor-v2">
          {isEditing ? (
            <>
              <textarea
                ref={textareaRef}
                className="notes-textarea-v2"
                value={noteText}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder="Start writing..."
                spellCheck
                autoFocus
              />

              {/* Editor Footer - Word Count */}
              {noteText && (
                <div className="notes-editor-footer">
                  <span className="word-count">
                    {getWordCount(noteText)} {getWordCount(noteText) === 1 ? 'word' : 'words'}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="notes-editor-empty">
              <div className="editor-empty-icon">📝</div>
              <h3 className="editor-empty-title">Start Writing</h3>
              <p className="editor-empty-text">
                Select a note from the sidebar or create a new one
              </p>
              <button
                className="editor-empty-btn"
                onClick={createNewNote}
              >
                <FontAwesomeIcon icon={faPlus} />
                Create New Note
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
