import { faCalendarDay, faExternalLinkAlt, faSave, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';

export function DailyNotesSection() {
  // Daily notes state
  const [dailyNotes, setDailyNotes] = React.useState(null);
  const [selectedDate, setSelectedDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [editingDailyNotes, setEditingDailyNotes] = React.useState(false);
  const [dailyNotesText, setDailyNotesText] = React.useState('');

  // Daily notes functions
  const loadDailyNotes = React.useCallback(async (date) => {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'getDailyNotes', date }, resolve);
      });

      if (response?.ok) {
        setDailyNotes(response.dailyNotes);
        setDailyNotesText(response.dailyNotes.content || '');
      } else {
        setDailyNotes({
          date,
          content: '',
          selections: [],
          metadata: { created: 0, lastUpdated: 0, selectionCount: 0 }
        });
        setDailyNotesText('');
      }
    } catch (e) {
      console.error('Failed to load daily notes:', e);
    }
  }, []);

  const saveDailyNotes = React.useCallback(async () => {
    if (!selectedDate) return;

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'updateDailyNotes',
          date: selectedDate,
          content: dailyNotesText
        }, resolve);
      });

      if (response?.ok) {
        await loadDailyNotes(selectedDate);
        setEditingDailyNotes(false);
      }
    } catch (e) {
      console.error('Failed to save daily notes:', e);
    }
  }, [selectedDate, dailyNotesText, loadDailyNotes]);

  const handleDateChange = React.useCallback((date) => {
    setSelectedDate(date);
    loadDailyNotes(date);
  }, [loadDailyNotes]);

  // Function to open URL in new tab
  const openUrl = React.useCallback((url) => {
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url, active: true });
    } else {
      window.open(url, '_blank');
    }
  }, []);

  // Function to render markdown links as clickable elements
  const renderContentWithLinks = React.useCallback((content) => {
    if (!content) return content;

    // Simple markdown link parser: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      // Add text before the link
      if (match.index > lastIndex) {
        parts.push(content.substring(lastIndex, match.index));
      }

      // Add clickable link
      const linkText = match[1];
      const url = match[2];
      parts.push(
        <button
          key={match.index}
          onClick={(e) => {
            e.stopPropagation();
            openUrl(url);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#10b981',
            textDecoration: 'underline',
            cursor: 'pointer',
            fontSize: 'inherit',
            padding: 0,
            font: 'inherit'
          }}
          title={`Open ${url}`}
        >
          {linkText}
          <FontAwesomeIcon
            icon={faExternalLinkAlt}
            style={{ marginLeft: 4, fontSize: '0.8em', opacity: 0.7 }}
          />
        </button>
      );

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex));
    }

    return parts.length > 0 ? parts : content;
  }, [openUrl]);

  // Auto-load today's notes on mount
  React.useEffect(() => {
    loadDailyNotes(selectedDate);
  }, [loadDailyNotes, selectedDate]);

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    }}>
      {/* Apple Notes Style Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        padding: '0 4px'
      }}>
        <h2 style={{
          fontSize: 22,
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <FontAwesomeIcon icon={faCalendarDay} style={{ color: '#FF9500', fontSize: 18 }} />
          Daily Notes
          {dailyNotes?.metadata?.selectionCount > 0 && (
            <span style={{
              fontSize: 12,
              color: '#ffffff',
              background: 'rgba(255, 149, 0, 0.2)',
              padding: '4px 8px',
              borderRadius: 12,
              marginLeft: 4,
              fontWeight: 500,
              border: '1px solid rgba(255, 149, 0, 0.3)'
            }}>
              {dailyNotes.metadata.selectionCount}
            </span>
          )}
        </h2>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Date selector - Apple Style */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          padding: 12,
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer'
            }}
          />
          {dailyNotes && dailyNotes.metadata.lastUpdated > 0 && (
            <span style={{
              fontSize: 12,
              color: 'rgba(255, 255, 255, 0.5)',
              fontWeight: 400
            }}>
              Updated {new Date(dailyNotes.metadata.lastUpdated).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          )}
        </div>

        {/* Daily notes content - Apple Style */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          overflow: 'hidden'
        }}>
          {editingDailyNotes ? (
            <div style={{ padding: 16 }}>
              <textarea
                value={dailyNotesText}
                onChange={(e) => setDailyNotesText(e.target.value)}
                placeholder="Your daily notes... Selected text from web pages is automatically added here."
                autoFocus
                style={{
                  width: '100%',
                  minHeight: 120,
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  color: '#ffffff',
                  fontSize: 16,
                  lineHeight: 1.4,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  outline: 'none'
                }}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.max(120, e.target.scrollHeight) + 'px';
                }}
              />
              <div style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                marginTop: 16,
                paddingTop: 16,
                borderTop: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                <button
                  onClick={() => {
                    setEditingDailyNotes(false);
                    setDailyNotesText(dailyNotes?.content || '');
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <FontAwesomeIcon icon={faTimes} style={{ fontSize: 12 }} />
                  Cancel
                </button>
                <button
                  onClick={saveDailyNotes}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#007AFF',
                    color: 'white',
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 2px 8px rgba(0, 122, 255, 0.3)'
                  }}
                >
                  <FontAwesomeIcon icon={faSave} style={{ fontSize: 12 }} />
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => setEditingDailyNotes(true)}
              style={{
                minHeight: 100,
                padding: 16,
                color: '#ffffff',
                fontSize: 16,
                lineHeight: 1.4,
                cursor: 'pointer',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {dailyNotes?.content ?
                renderContentWithLinks(dailyNotes.content) : (
                  <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontStyle: 'italic', fontSize: 15 }}>
                    Tap to add your daily notes... Selected text from web pages will appear here automatically.
                  </span>
                )}
            </div>
          )}
        </div>

        {/* Auto-captured selections - Apple Style */}
        {dailyNotes?.selections && dailyNotes.selections.length > 0 && (
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12
            }}>
              <h3 style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.7)',
                margin: 0,
                letterSpacing: '-0.2px'
              }}>
                Auto-captured
              </h3>
              <span style={{
                fontSize: 12,
                color: '#ffffff',
                background: 'rgba(52, 199, 89, 0.2)',
                padding: '2px 8px',
                borderRadius: 8,
                fontWeight: 500,
                border: '1px solid rgba(52, 199, 89, 0.3)'
              }}>
                {dailyNotes.selections.length}
              </span>
            </div>
            <div style={{
              maxHeight: 200,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}>
              {dailyNotes.selections.slice(-5).reverse().map(selection => (
                <div key={selection.id} style={{
                  background: 'rgba(52, 199, 89, 0.05)',
                  border: '1px solid rgba(52, 199, 89, 0.15)',
                  borderRadius: 10,
                  padding: 12,
                  transition: 'all 0.2s ease',
                  cursor: 'pointer'
                }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(52, 199, 89, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(52, 199, 89, 0.25)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(52, 199, 89, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(52, 199, 89, 0.15)';
                  }}
                >
                  <div style={{
                    color: '#ffffff',
                    marginBottom: 6,
                    fontSize: 14,
                    lineHeight: 1.3,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    "{selection.text}"
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 11,
                    color: 'rgba(255, 255, 255, 0.6)'
                  }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openUrl(selection.source?.url);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#34C759',
                        cursor: 'pointer',
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontWeight: 500,
                        transition: 'all 0.2s ease'
                      }}
                      title={`Open ${selection.source?.url}`}
                      onMouseEnter={(e) => {
                        e.target.style.background = 'rgba(52, 199, 89, 0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = 'none';
                      }}
                    >
                      {selection.source?.domain || 'Unknown'}
                      <FontAwesomeIcon
                        icon={faExternalLinkAlt}
                        style={{ fontSize: 9, opacity: 0.8 }}
                      />
                    </button>
                    <span style={{ fontWeight: 400 }}>{selection.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}