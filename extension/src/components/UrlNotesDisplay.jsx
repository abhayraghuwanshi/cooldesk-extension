import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faStickyNote, faMicrophone, faCamera, faFileText, faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';

export function UrlNotesDisplay({ url, compact = false }) {
  const [notes, setNotes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState(false);

  const loadNotes = React.useCallback(async () => {
    if (!url) return;
    
    try {
      setLoading(true);
      const { getUrlNotes } = await import('../db');
      const urlNotes = await getUrlNotes(url);
      setNotes(urlNotes || []);
    } catch (error) {
      console.error('Failed to load URL notes:', error);
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [url]);

  React.useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  if (loading) {
    return compact ? null : (
      <div style={{ color: '#9ca3af', fontSize: 12, padding: 8 }}>
        Loading notes...
      </div>
    );
  }

  if (!notes.length) {
    return compact ? null : (
      <div style={{ color: '#9ca3af', fontSize: 12, padding: 8 }}>
        No notes for this URL
      </div>
    );
  }

  const notesCounts = {
    text: notes.filter(n => n.type === 'text').length,
    voice: notes.filter(n => n.type === 'voice').length,
    screenshot: notes.filter(n => n.type === 'screenshot').length
  };

  if (compact) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 6, 
        fontSize: 11, 
        color: '#10b981',
        padding: '2px 6px',
        background: 'rgba(16, 185, 129, 0.1)',
        borderRadius: 4,
        border: '1px solid rgba(16, 185, 129, 0.2)'
      }}>
        <FontAwesomeIcon icon={faStickyNote} />
        <span>{notes.length}</span>
        {notesCounts.voice > 0 && (
          <span title={`${notesCounts.voice} voice notes`}>
            <FontAwesomeIcon icon={faMicrophone} style={{ marginLeft: 4 }} />
          </span>
        )}
        {notesCounts.screenshot > 0 && (
          <span title={`${notesCounts.screenshot} screenshots`}>
            <FontAwesomeIcon icon={faCamera} style={{ marginLeft: 4 }} />
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ 
      border: '1px solid #374151', 
      borderRadius: 8, 
      background: '#1f2937',
      margin: '8px 0'
    }}>
      <div 
        style={{ 
          padding: 12, 
          borderBottom: expanded ? '1px solid #374151' : 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FontAwesomeIcon icon={faStickyNote} style={{ color: '#10b981' }} />
          <span style={{ color: '#e5e7eb', fontSize: 14, fontWeight: 600 }}>
            {notes.length} Note{notes.length !== 1 ? 's' : ''}
          </span>
          <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#9ca3af' }}>
            {notesCounts.text > 0 && (
              <span>
                <FontAwesomeIcon icon={faFileText} style={{ marginRight: 4 }} />
                {notesCounts.text}
              </span>
            )}
            {notesCounts.voice > 0 && (
              <span>
                <FontAwesomeIcon icon={faMicrophone} style={{ marginRight: 4 }} />
                {notesCounts.voice}
              </span>
            )}
            {notesCounts.screenshot > 0 && (
              <span>
                <FontAwesomeIcon icon={faCamera} style={{ marginRight: 4 }} />
                {notesCounts.screenshot}
              </span>
            )}
          </div>
        </div>
        <FontAwesomeIcon 
          icon={expanded ? faEyeSlash : faEye} 
          style={{ color: '#9ca3af', fontSize: 12 }} 
        />
      </div>

      {expanded && (
        <div style={{ padding: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notes.slice(0, 5).map(note => (
              <div 
                key={note.id} 
                style={{ 
                  padding: 8, 
                  background: '#374151', 
                  borderRadius: 6,
                  fontSize: 12
                }}
              >
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 6, 
                  marginBottom: 4,
                  color: '#d1d5db'
                }}>
                  <FontAwesomeIcon 
                    icon={
                      note.type === 'voice' ? faMicrophone :
                      note.type === 'screenshot' ? faCamera : faFileText
                    }
                    style={{ 
                      color: note.type === 'voice' ? '#f59e0b' : 
                             note.type === 'screenshot' ? '#10b981' : '#3b82f6' 
                    }}
                  />
                  <span style={{ fontWeight: 600 }}>
                    {note.type === 'voice' ? 'Voice Note' :
                     note.type === 'screenshot' ? 'Screenshot' : 'Text Note'}
                  </span>
                  <span style={{ color: '#9ca3af', fontSize: 10 }}>
                    {new Date(note.createdAt).toLocaleDateString()}
                  </span>
                </div>
                
                {note.text && (
                  <div style={{ color: '#e5e7eb', marginBottom: 4 }}>
                    {note.text.length > 100 ? `${note.text.substring(0, 100)}...` : note.text}
                  </div>
                )}
                
                {note.description && (
                  <div style={{ color: '#d1d5db', fontSize: 11 }}>
                    {note.description.length > 80 ? `${note.description.substring(0, 80)}...` : note.description}
                  </div>
                )}
                
                {note.selectedText && (
                  <div style={{ 
                    color: '#9ca3af', 
                    fontSize: 10, 
                    fontStyle: 'italic',
                    marginTop: 4,
                    padding: 4,
                    background: '#4b5563',
                    borderRadius: 4
                  }}>
                    Selected: "{note.selectedText.length > 60 ? `${note.selectedText.substring(0, 60)}...` : note.selectedText}"
                  </div>
                )}
              </div>
            ))}
            
            {notes.length > 5 && (
              <div style={{ 
                textAlign: 'center', 
                color: '#9ca3af', 
                fontSize: 11,
                padding: 4
              }}>
                ... and {notes.length - 5} more notes
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
