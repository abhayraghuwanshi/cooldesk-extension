import {
  faMicrophone,
  faPaperPlane,
  faStickyNote,
  faStop
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import annyang from 'annyang';
import { useEffect, useState } from 'react';
import { upsertNote as dbUpsertNote } from '../../db/index.js';

export function NotesWidget({ maxNotes = 5, compact = false }) {
  const [newNoteText, setNewNoteText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize voice recognition
  useEffect(() => {
    return () => {
      if (annyang) {
        annyang.abort();
      }
    };
  }, []);

  const toggleVoice = () => {
    if (!annyang) {
      alert('Speech recognition is not supported in your browser.');
      return;
    }

    if (isListening) {
      annyang.abort();
      setIsListening(false);
    } else {
      annyang.start({ autoRestart: false, continuous: true });
      setIsListening(true);

      annyang.addCallback('result', (phrases) => {
        if (phrases.length > 0) {
          const transcript = phrases[0];
          setNewNoteText(prev => prev + (prev ? ' ' : '') + transcript);
        }
      });

      annyang.addCallback('end', () => {
        setIsListening(false);
      });
    }
  };

  const handleAddNote = async () => {
    if (!newNoteText.trim()) return;

    try {
      setIsSaving(true);
      const note = {
        id: `note_${Date.now()}`,
        text: newNoteText.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await dbUpsertNote(note);
      setNewNoteText('');
    } catch (error) {
      console.error('[NotesWidget] Error adding note:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="cooldesk-panel notes-widget" style={{
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box'
    }}>
      <div className="panel-header" style={{ flexShrink: 0 }}>
        <div className="panel-title">
          <FontAwesomeIcon icon={faStickyNote} style={{ marginRight: '8px' }} />
          Quick Note
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        minHeight: 0,
        overflow: 'visible'
      }}>
        {/* Unified Input Card */}
        <div style={{
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          border: `1px solid ${isListening ? '#ef4444' : 'rgba(148, 163, 184, 0.2)'}`,
          borderRadius: '12px',
          overflow: 'hidden',
          transition: 'all 0.2s ease',
        }}>

          {/* Action Bar (Top of card) */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
            background: 'rgba(30, 41, 59, 0.3)',
            flexShrink: 0
          }}>
            {/* Left: Character Count or Status */}
            <div style={{
              fontSize: '12px',
              color: '#64748B',
              opacity: newNoteText.length > 0 ? 1 : 0
            }}>
              {newNoteText.length} chars
            </div>

            {/* Right: Actions */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {/* Voice Button */}
              <button
                onClick={toggleVoice}
                title={isListening ? "Stop listening" : "Start voice input"}
                style={{
                  background: isListening ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                  color: isListening ? '#EF4444' : '#94A3B8',
                  border: 'none',
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => !isListening && (e.currentTarget.style.color = '#F1F5F9')}
                onMouseLeave={(e) => !isListening && (e.currentTarget.style.color = '#94A3B8')}
              >
                <FontAwesomeIcon icon={isListening ? faStop : faMicrophone} />
              </button>

              {/* Send Button */}
              <button
                onClick={handleAddNote}
                disabled={!newNoteText.trim() || isSaving}
                title="Save Note (Ctrl+Enter)"
                style={{
                  background: newNoteText.trim()
                    ? 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)'
                    : 'rgba(148, 163, 184, 0.1)',
                  color: newNoteText.trim() ? 'white' : '#64748B',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: newNoteText.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                  fontWeight: 500,
                  transition: 'all 0.2s ease',
                }}
              >
                {isSaving ? (
                  <span>...</span>
                ) : (
                  <>
                    <span>Save</span>
                    <FontAwesomeIcon icon={faPaperPlane} size="sm" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Text Area Area */}
          <textarea
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            placeholder={isListening ? "Listening..." : "Type or use voice to add a note..."}
            style={{
              flex: 1,
              minHeight: 0,
              width: '100%',
              background: 'transparent',
              border: 'none',
              padding: '16px',
              color: '#E5E7EB',
              fontSize: 'var(--font-md, 14px)',
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
              boxShadow: 'none',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleAddNote();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
