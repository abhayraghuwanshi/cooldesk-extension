import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faStickyNote,
  faPlus,
  faTrash,
  faPenToSquare,
  faCheck,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { listNotes as dbListNotes, upsertNote as dbUpsertNote, deleteNote as dbDeleteNote } from '../../db/index.js';

export function NotesWidget({ maxNotes = 5, compact = false }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newNoteText, setNewNoteText] = useState('');
  const [showAddNote, setShowAddNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editText, setEditText] = useState('');

  const loadNotes = useCallback(async () => {
    try {
      setLoading(true);
      const result = await dbListNotes();
      const allNotes = result?.data || result || [];
      setNotes(Array.isArray(allNotes) ? allNotes.slice(0, maxNotes) : []);
    } catch (error) {
      console.error('[NotesWidget] Error loading notes:', error);
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [maxNotes]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleAddNote = async () => {
    if (!newNoteText.trim()) return;

    try {
      const note = {
        id: `note_${Date.now()}`,
        text: newNoteText.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await dbUpsertNote(note);
      setNewNoteText('');
      setShowAddNote(false);
      loadNotes();
    } catch (error) {
      console.error('[NotesWidget] Error adding note:', error);
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await dbDeleteNote(noteId);
      loadNotes();
    } catch (error) {
      console.error('[NotesWidget] Error deleting note:', error);
    }
  };

  const handleEditNote = (note) => {
    setEditingNoteId(note.id);
    setEditText(note.text);
  };

  const handleSaveEdit = async () => {
    if (!editText.trim() || !editingNoteId) return;

    try {
      const existingNote = notes.find(n => n.id === editingNoteId);
      if (!existingNote) return;

      const updatedNote = {
        ...existingNote,
        text: editText.trim(),
        updatedAt: Date.now(),
      };

      await dbUpsertNote(updatedNote);
      setEditingNoteId(null);
      setEditText('');
      loadNotes();
    } catch (error) {
      console.error('[NotesWidget] Error updating note:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditingNoteId(null);
    setEditText('');
  };

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

  if (loading) {
    return compact ? (
      <div style={{
        textAlign: 'center',
        padding: '20px',
        color: '#64748B',
        fontSize: 'var(--font-base, 12px)'
      }}>
        Loading...
      </div>
    ) : (
      <div className="cooldesk-panel notes-widget">
        <div className="panel-header">
          <div className="panel-title">
            <FontAwesomeIcon icon={faStickyNote} style={{ marginRight: '8px' }} />
            Notes
          </div>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748B' }}>
          Loading notes...
        </div>
      </div>
    );
  }

  // Compact mode (inside workspace card)
  if (compact) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden'
      }}>
        {/* Always-visible Compact Input */}
        <div style={{
          marginBottom: '8px',
          flexShrink: 0
        }}>
          <div style={{ position: 'relative' }}>
            <textarea
              value={newNoteText}
              onChange={(e) => setNewNoteText(e.target.value)}
              placeholder="Jot down a thought..."
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.5)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                borderRadius: '8px',
                padding: '8px 50px 8px 10px',
                color: '#E5E7EB',
                fontSize: 'var(--font-md, 12px)',
                fontFamily: 'inherit',
                resize: 'none',
                minHeight: '42px',
                maxHeight: '80px',
                outline: 'none',
                transition: 'all 0.2s ease',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                e.target.style.background = 'rgba(15, 23, 42, 0.7)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(139, 92, 246, 0.2)';
                e.target.style.background = 'rgba(15, 23, 42, 0.5)';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleAddNote();
                }
              }}
            />
            <button
              onClick={handleAddNote}
              disabled={!newNoteText.trim()}
              style={{
                position: 'absolute',
                right: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: newNoteText.trim()
                  ? 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)'
                  : 'rgba(139, 92, 246, 0.2)',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 10px',
                color: 'white',
                fontSize: 'var(--font-sm, 10px)',
                fontWeight: 600,
                cursor: newNoteText.trim() ? 'pointer' : 'not-allowed',
                opacity: newNoteText.trim() ? 1 : 0.4,
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '3px'
              }}
              onMouseEnter={(e) => {
                if (newNoteText.trim()) {
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(139, 92, 246, 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                if (newNoteText.trim()) {
                  e.currentTarget.style.boxShadow = 'none';
                }
              }}
            >
              <FontAwesomeIcon icon={faPlus} style={{ fontSize: '9px' }} />
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* Compact Notes List */}
        {notes.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '20px 10px',
            color: '#64748B',
            fontSize: 'var(--font-md, 12px)',
          }}>
            <div style={{ fontSize: 'var(--font-4xl, 24px)', marginBottom: '6px' }}>📝</div>
            <div>No notes yet</div>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingRight: '2px',
            minHeight: 0
          }}>
            {notes.map((note) => (
              <div
                key={note.id}
                style={{
                  background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%)',
                  border: '1px solid rgba(139, 92, 246, 0.2)',
                  borderRadius: '6px',
                  padding: '8px',
                  fontSize: 'var(--font-md, 12px)',
                  transition: 'all 0.2s ease',
                }}
              >
                {editingNoteId === note.id ? (
                  <div>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid rgba(139, 92, 246, 0.25)',
                        borderRadius: '4px',
                        padding: '6px',
                        color: '#E5E7EB',
                        fontSize: 'var(--font-md, 12px)',
                        fontFamily: 'inherit',
                        resize: 'none',
                        minHeight: '40px',
                        marginBottom: '6px',
                        outline: 'none',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={handleSaveEdit}
                        style={{
                          background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          color: 'white',
                          fontSize: 'var(--font-sm, 10px)',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        <FontAwesomeIcon icon={faCheck} />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        style={{
                          background: 'rgba(148, 163, 184, 0.25)',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          color: '#CBD5E1',
                          fontSize: 'var(--font-sm, 10px)',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{
                      color: '#E5E7EB',
                      fontSize: 'var(--font-md, 12px)',
                      lineHeight: '1.4',
                      marginBottom: '6px',
                      wordWrap: 'break-word',
                    }}>
                      {note.text}
                    </div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <div style={{
                        fontSize: 'var(--font-xs, 9px)',
                        color: '#64748B',
                      }}>
                        {formatTime(note.updatedAt || note.createdAt)}
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => handleEditNote(note)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#A78BFA',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            fontSize: 'var(--font-xs, 9px)',
                          }}
                        >
                          <FontAwesomeIcon icon={faPenToSquare} />
                        </button>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#F87171',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            fontSize: 'var(--font-xs, 9px)',
                          }}
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Full mode (standalone panel)
  return (
    <div className="cooldesk-panel notes-widget">
      <div className="panel-header">
        <div className="panel-title">
          <FontAwesomeIcon icon={faStickyNote} style={{ marginRight: '8px' }} />
          Notes
        </div>
        <div className="panel-action" onClick={() => setShowAddNote(!showAddNote)}>
          <FontAwesomeIcon icon={showAddNote ? faXmark : faPlus} />
          <span>{showAddNote ? 'Cancel' : 'New'}</span>
        </div>
      </div>

      {/* Add Note Form */}
      {showAddNote && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(59, 130, 246, 0.12) 100%)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: '12px',
          padding: '14px',
          marginBottom: '16px',
          boxShadow: '0 2px 8px rgba(139, 92, 246, 0.1)',
        }}>
          <textarea
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            placeholder="Jot down a thought..."
            style={{
              width: '100%',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(139, 92, 246, 0.25)',
              borderRadius: '10px',
              padding: '12px 14px',
              color: '#E5E7EB',
              fontSize: '0.95em',
              fontFamily: 'inherit',
              resize: 'none',
              minHeight: '90px',
              marginBottom: '10px',
              outline: 'none',
              transition: 'all 0.2s ease',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'rgba(139, 92, 246, 0.5)';
              e.target.style.boxShadow = '0 0 0 2px rgba(139, 92, 246, 0.1)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'rgba(139, 92, 246, 0.25)';
              e.target.style.boxShadow = 'none';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleAddNote();
              }
            }}
          />
          <button
            onClick={handleAddNote}
            disabled={!newNoteText.trim()}
            style={{
              width: '100%',
              background: newNoteText.trim()
                ? 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)'
                : 'rgba(139, 92, 246, 0.3)',
              border: 'none',
              borderRadius: '10px',
              padding: '10px',
              color: 'white',
              fontSize: '0.95em',
              fontWeight: 600,
              cursor: newNoteText.trim() ? 'pointer' : 'not-allowed',
              opacity: newNoteText.trim() ? 1 : 0.6,
              transition: 'all 0.2s ease',
              boxShadow: newNoteText.trim() ? '0 2px 8px rgba(139, 92, 246, 0.3)' : 'none',
            }}
            onMouseEnter={(e) => {
              if (newNoteText.trim()) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              if (newNoteText.trim()) {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(139, 92, 246, 0.3)';
              }
            }}
          >
            Add Note
          </button>
        </div>
      )}

      {/* Notes List */}
      {notes.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '30px 16px',
          color: '#64748B',
          fontSize: 'var(--font-lg, 14px)',
        }}>
          <div style={{ fontSize: 'var(--font-5xl, 28px)', marginBottom: '10px' }}>📝</div>
          <div>No notes yet</div>
          <div style={{ fontSize: 'var(--font-md, 12px)', marginTop: '6px', opacity: 0.7 }}>
            Click "New" to create your first note
          </div>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxHeight: '400px',
          overflowY: 'auto',
          paddingRight: '4px'
        }}>
          {notes.map((note) => (
            <div
              key={note.id}
              className="note-item"
              style={{
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                borderRadius: '10px',
                padding: '12px',
                transition: 'all 0.2s ease',
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%)';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.2)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {editingNoteId === note.id ? (
                <div>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(139, 92, 246, 0.25)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: '#E5E7EB',
                      fontSize: 'var(--font-lg, 14px)',
                      fontFamily: 'inherit',
                      resize: 'none',
                      minHeight: '70px',
                      marginBottom: '10px',
                      outline: 'none',
                      transition: 'all 0.2s ease',
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = 'rgba(139, 92, 246, 0.5)';
                      e.target.style.boxShadow = '0 0 0 2px rgba(139, 92, 246, 0.1)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = 'rgba(139, 92, 246, 0.25)';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={handleSaveEdit}
                      style={{
                        background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '7px 14px',
                        color: 'white',
                        fontSize: 'var(--font-base, 12px)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 4px 10px rgba(16, 185, 129, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 2px 6px rgba(16, 185, 129, 0.3)';
                      }}
                    >
                      <FontAwesomeIcon icon={faCheck} style={{ marginRight: '5px' }} />
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      style={{
                        background: 'rgba(148, 163, 184, 0.25)',
                        border: '1px solid rgba(148, 163, 184, 0.3)',
                        borderRadius: '8px',
                        padding: '7px 14px',
                        color: '#CBD5E1',
                        fontSize: 'var(--font-base, 12px)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(148, 163, 184, 0.35)';
                        e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(148, 163, 184, 0.25)';
                        e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.3)';
                      }}
                    >
                      <FontAwesomeIcon icon={faXmark} style={{ marginRight: '5px' }} />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{
                    color: '#E5E7EB',
                    fontSize: 'var(--font-lg, 14px)',
                    lineHeight: '1.5',
                    marginBottom: '10px',
                    wordWrap: 'break-word',
                    fontWeight: 400,
                  }}>
                    {note.text}
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <div style={{
                      fontSize: 'var(--font-md, 12px)',
                      color: '#64748B',
                      fontWeight: 500,
                    }}>
                      {formatTime(note.updatedAt || note.createdAt)}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleEditNote(note)}
                        style={{
                          background: 'rgba(139, 92, 246, 0.15)',
                          border: '1px solid rgba(139, 92, 246, 0.25)',
                          borderRadius: '6px',
                          color: '#A78BFA',
                          cursor: 'pointer',
                          padding: '5px 8px',
                          fontSize: 'var(--font-md, 12px)',
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(139, 92, 246, 0.25)';
                          e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                          e.currentTarget.style.color = '#C4B5FD';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)';
                          e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.25)';
                          e.currentTarget.style.color = '#A78BFA';
                        }}
                        title="Edit"
                      >
                        <FontAwesomeIcon icon={faPenToSquare} />
                      </button>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          borderRadius: '6px',
                          color: '#F87171',
                          cursor: 'pointer',
                          padding: '5px 8px',
                          fontSize: 'var(--font-md, 12px)',
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)';
                          e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                          e.currentTarget.style.color = '#FCA5A5';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                          e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.25)';
                          e.currentTarget.style.color = '#F87171';
                        }}
                        title="Delete"
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
