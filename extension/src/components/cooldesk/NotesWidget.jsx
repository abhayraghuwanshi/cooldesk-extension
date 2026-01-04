import {
  faMicrophone,
  faPlus,
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
      // Optional: Give feedback that note was saved
    } catch (error) {
      console.error('[NotesWidget] Error adding note:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="cooldesk-panel notes-widget">
      <div className="panel-header">
        <div className="panel-title">
          <FontAwesomeIcon icon={faStickyNote} style={{ marginRight: '8px' }} />
          Quick Note
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '10px 0',
        gap: '12px'
      }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <textarea
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            placeholder={isListening ? "Listening..." : "Type or use voice to add a note..."}
            style={{
              width: '100%',
              height: '100%',
              minHeight: '120px',
              background: 'rgba(30, 41, 59, 0.4)',
              border: `1px solid ${isListening ? '#ef4444' : 'rgba(148, 163, 184, 0.2)'}`,
              borderRadius: '12px',
              padding: '16px',
              color: '#E5E7EB',
              fontSize: 'var(--font-md, 14px)',
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
              transition: 'all 0.2s ease',
              boxShadow: 'none'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleAddNote();
              }
            }}
          />

          {/* Voice Button */}
          <button
            onClick={toggleVoice}
            className={`voice-btn ${isListening ? 'listening' : ''}`}
            title={isListening ? "Stop listening" : "Start voice input"}
            style={{
              position: 'absolute',
              bottom: '12px',
              right: '12px',
              background: isListening ? '#ef4444' : 'rgba(139, 92, 246, 0.2)',
              color: isListening ? 'white' : '#A78BFA',
              border: 'none',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              animation: isListening ? 'pulse 1.5s infinite' : 'none'
            }}
          >
            <FontAwesomeIcon icon={isListening ? faStop : faMicrophone} />
          </button>
        </div>

        <button
          onClick={handleAddNote}
          disabled={!newNoteText.trim() || isSaving}
          style={{
            width: '100%',
            background: newNoteText.trim()
              ? 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)'
              : 'rgba(139, 92, 246, 0.2)',
            border: 'none',
            borderRadius: '10px',
            padding: '10px',
            color: 'white',
            fontSize: 'var(--font-sm, 13px)',
            fontWeight: 600,
            cursor: newNoteText.trim() ? 'pointer' : 'not-allowed',
            opacity: newNoteText.trim() ? 1 : 0.6,
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          {isSaving ? (
            <span>Saving...</span>
          ) : (
            <>
              <FontAwesomeIcon icon={faPlus} />
              <span>Save Note</span>
            </>
          )}
        </button>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
      `}</style>
    </div>
  );
}
