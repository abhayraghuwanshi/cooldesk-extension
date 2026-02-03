import {
  faMicrophone,
  faPaperPlane,
  faStop
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import annyang from 'annyang';
import { useEffect, useState } from 'react';
import { upsertNote as dbUpsertNote } from '../../db/index.js';

export function NotesWidget({ maxNotes = 5, compact = false, onAddNote }) {
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

      // Dispatch event to notify other components (like NotesList) to refresh
      window.dispatchEvent(new CustomEvent('notes-updated', { detail: { note } }));

      // Also invoke callback if provided (for parent container refresh)
      if (onAddNote) onAddNote(note);

      setNewNoteText('');
    } catch (error) {
      console.error('[NotesWidget] Error adding note:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="notes-widget" style={{
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      width: '100%',
      minHeight: 0,
      overflow: 'visible'
    }}>
      {/* Unified Input Card */}
      <div style={{
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        borderRadius: '20px',
        overflow: 'hidden',
        transition: 'none', // Remove transition to prevent layout thrashing on typing
        background: isListening
          ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(220, 38, 38, 0.1) 100%)'
          : 'rgba(15, 23, 42, 0.95)', // High opacity dark background, no blur
        border: '1px solid rgba(148, 163, 184, 0.1)',
        boxShadow: isListening
          ? '0 8px 24px -4px rgba(239, 68, 68, 0.3)'
          : '0 8px 32px -8px rgba(0, 0, 0, 0.4), 0 4px 16px -4px rgba(0, 0, 0, 0.2)',
      }}>

        {/* Action Bar (Top of card) */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px 12px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
          // background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 100%)',
          flexShrink: 0,
          position: 'relative',
          zIndex: 1,
        }}>
          {/* Left: Character Count or Status */}
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.5px',
            color: isListening ? '#EF4444' : '#64748B',
            opacity: newNoteText.length > 0 || isListening ? 1 : 0,
            transition: 'all 0.3s ease',
            textTransform: 'uppercase',
          }}>
            {isListening ? '● Recording' : `${newNoteText.length} chars`}
          </div>


          {/* Right: Actions */}
          <div style={{ display: 'flex', gap: '10px' }}>
            {/* Voice Button */}
            <button
              onClick={toggleVoice}
              title={isListening ? "Stop listening" : "Start voice input"}
              style={{
                background: isListening
                  ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(220, 38, 38, 0.2) 100%)'
                  : 'rgba(148, 163, 184, 0.08)',
                color: isListening ? '#EF4444' : '#94A3B8',
                border: `1px solid ${isListening ? 'rgba(239, 68, 68, 0.3)' : 'rgba(148, 163, 184, 0.15)'}`,
                borderRadius: '10px',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: isListening
                  ? '0 4px 12px rgba(239, 68, 68, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                  : '0 2px 8px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                transform: isListening ? 'scale(1.05)' : 'scale(1)',
              }}
              onMouseEnter={(e) => {
                if (!isListening) {
                  e.currentTarget.style.color = '#F1F5F9';
                  e.currentTarget.style.background = 'rgba(148, 163, 184, 0.15)';
                  e.currentTarget.style.transform = 'scale(1.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isListening) {
                  e.currentTarget.style.color = '#94A3B8';
                  e.currentTarget.style.background = 'rgba(148, 163, 184, 0.08)';
                  e.currentTarget.style.transform = 'scale(1)';
                }
              }}
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
                  ? 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 50%, #6D28D9 100%)'
                  : 'rgba(148, 163, 184, 0.08)',
                color: newNoteText.trim() ? 'white' : '#64748B',
                border: newNoteText.trim()
                  ? '1px solid rgba(167, 139, 250, 0.4)'
                  : '1px solid rgba(148, 163, 184, 0.15)',
                borderRadius: '12px',
                padding: '0 18px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: newNoteText.trim() ? 'pointer' : 'not-allowed',
                fontSize: '13px',
                fontWeight: 600,
                letterSpacing: '0.3px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: newNoteText.trim()
                  ? '0 4px 16px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
                  : '0 2px 8px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
                transform: 'scale(1)',
              }}
              onMouseEnter={(e) => {
                if (newNoteText.trim()) {
                  e.currentTarget.style.transform = 'scale(1.05) translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
                }
              }}
              onMouseLeave={(e) => {
                if (newNoteText.trim()) {
                  e.currentTarget.style.transform = 'scale(1) translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
                }
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
            height: '180px',
            width: '100%',
            background: 'transparent',
            border: 'none',
            padding: '18px 20px',
            color: '#E5E7EB',
            fontSize: '14px',
            lineHeight: '1.6',
            fontFamily: 'inherit',
            resize: 'none',
            outline: 'none',
            boxShadow: 'none',
            position: 'relative',
            zIndex: 1,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleAddNote();
            }
          }}
        />
      </div>
    </div>
  );
}
