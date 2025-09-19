import { faCalendarDay, faExternalLinkAlt, faGlobe, faLink, faSave, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { subscribeDailyNotesChanges } from '../../db/index.js';
import { getFaviconUrl } from '../../utils.js';

export function DailyNotesSection() {
  // Daily notes state
  const [dailyNotes, setDailyNotes] = React.useState(null);
  const [selectedDate, setSelectedDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [editingDailyNotes, setEditingDailyNotes] = React.useState(false);
  const [dailyNotesText, setDailyNotesText] = React.useState('');

  // Daily notes functions
  const loadDailyNotes = React.useCallback(async (date) => {
    try {
      const timeoutMs = 5000; // 5 second timeout
      const maxRetries = 1; // Retry once if it fails
      let retries = 0;
      let lastError = null;

      while (retries <= maxRetries) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          console.warn('[DailyNotesSection] Timeout waiting for daily notes data from background script');
        }, timeoutMs);

        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'getDailyNotes', date }, (response) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        }).catch(error => {
          clearTimeout(timeoutId);
          return { ok: false, error: error.message };
        });

        if (response?.ok) {
          setDailyNotes(response.dailyNotes);
          setDailyNotesText(response.dailyNotes.content || '');
          return; // Success, exit the loop
        } else if (response?.error) {
          console.warn('[DailyNotesSection] Failed to load daily notes (attempt ' + (retries + 1) + ' of ' + (maxRetries + 1) + '):', response.error);
          lastError = response.error;
          retries++;
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 500 * retries));
        } else {
          console.warn('[DailyNotesSection] Unexpected response format:', response);
          lastError = 'Unexpected response format';
          break; // Don't retry on unexpected response
        }
      }

      console.error('[DailyNotesSection] Failed to load daily notes after ' + retries + ' retries:', lastError);
      setDailyNotes({
        date,
        content: '',
        selections: [],
        metadata: { created: 0, lastUpdated: 0, selectionCount: 0 }
      });
      setDailyNotesText('');
    } catch (e) {
      console.error('Failed to load daily notes:', e);
      setDailyNotes({
        date,
        content: '',
        selections: [],
        metadata: { created: 0, lastUpdated: 0, selectionCount: 0 }
      });
      setDailyNotesText('');
    }
  }, []);

  const saveDailyNotes = React.useCallback(async () => {
    console.log('[DailyNotesSection] Save button clicked');
    console.log('[DailyNotesSection] selectedDate:', selectedDate);
    console.log('[DailyNotesSection] dailyNotesText:', dailyNotesText);

    if (!selectedDate) {
      console.error('[DailyNotesSection] No selected date');
      return;
    }

    try {
      console.log('[DailyNotesSection] Sending updateDailyNotes message...');
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'updateDailyNotes',
          date: selectedDate,
          content: dailyNotesText
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[DailyNotesSection] Chrome runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log('[DailyNotesSection] Response received:', response);
            resolve(response);
          }
        });
      });

      if (response?.ok) {
        console.log('[DailyNotesSection] Save successful, reloading notes...');
        await loadDailyNotes(selectedDate);
        setEditingDailyNotes(false);
        console.log('[DailyNotesSection] Save process completed');
      } else {
        console.error('[DailyNotesSection] Failed to save daily notes:', response?.error);
      }
    } catch (e) {
      console.error('[DailyNotesSection] Exception during save:', e);
    }
  }, [selectedDate, dailyNotesText, loadDailyNotes]);

  const handleDateChange = React.useCallback((date) => {
    setSelectedDate(date);
    loadDailyNotes(date);
  }, [loadDailyNotes]);

  // Delete a specific auto-captured selection
  const deleteSelection = React.useCallback(async (selectionId) => {
    if (!selectedDate || !selectionId) return;

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'deleteSelection',
          date: selectedDate,
          selectionId
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      if (response?.ok) {
        await loadDailyNotes(selectedDate);
      } else {
        console.error('Failed to delete selection:', response?.error);
      }
    } catch (e) {
      console.error('Failed to delete selection:', e);
    }
  }, [selectedDate, loadDailyNotes]);

  // Helper function to convert time string to minutes for sorting
  const convertTimeToMinutes = React.useCallback((timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }, []);

  // Function to open URL in new tab
  const openUrl = React.useCallback((url) => {
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url, active: true });
    } else {
      window.open(url, '_blank');
    }
  }, []);

  // Function to render content with icons and clickable links
  const renderContentWithLinks = React.useCallback((content) => {
    if (!content) return content;

    // Split content into lines for processing
    const lines = content.split('\n');

    // Group content by URL/source and separate manual notes
    const autoGroups = [];
    let currentGroup = null;
    let manualNotes = [];

    lines.forEach((line, lineIndex) => {
      if (!line.trim()) {
        return; // Skip empty lines for grouping
      }

      // Check if line is auto-captured (contains "From [domain](url):")
      const autoCaptureRegex = /^\[(\d{1,2}:\d{2})\]\s+From\s+\[([^\]]+)\]\(([^)]+)\):\s*$/;
      const autoCaptureMatch = line.match(autoCaptureRegex);

      // Check if line contains quoted text (auto-captured selection)
      const isQuotedText = line.startsWith('"') && line.endsWith('"') && line.length > 2;

      if (autoCaptureMatch) {
        // Save current auto-capture group if exists
        if (currentGroup) {
          autoGroups.push(currentGroup);
        }

        // Start new auto-capture group
        const [, time, domain, url] = autoCaptureMatch;
        currentGroup = {
          type: 'auto',
          time,
          timeValue: convertTimeToMinutes(time), // For sorting
          domain,
          url,
          selections: []
        };
      } else if (isQuotedText && currentGroup) {
        // Add to current auto-capture group
        currentGroup.selections.push(line);
      } else {
        // Add to manual notes
        if (line.trim()) {
          manualNotes.push(line);
        }
      }
    });

    // Save any remaining auto-capture group
    if (currentGroup) {
      autoGroups.push(currentGroup);
    }

    // Sort auto groups by time (earliest first)
    autoGroups.sort((a, b) => a.timeValue - b.timeValue);

    // Render grouped content
    const processedLines = [];

    // 1. First render manual notes at the top
    if (manualNotes.length > 0) {
      manualNotes.forEach((line, lineIndex) => {
        // Process markdown links
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const parts = [];
        let lastIndex = 0;
        let match;
        let hasLinks = false;

        while ((match = linkRegex.exec(line)) !== null) {
          hasLinks = true;
          if (match.index > lastIndex) {
            parts.push(line.substring(lastIndex, match.index));
          }

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
                style={{ marginLeft: 4, fontSize: 'calc(var(--font-size-base) * 0.8)', opacity: 0.7 }}
              />
            </button>
          );

          lastIndex = match.index + match[0].length;
        }

        if (lastIndex < line.length) {
          parts.push(line.substring(lastIndex));
        }

        const lineContent = hasLinks ? parts : line;
        processedLines.push(
          <div key={`manual-${lineIndex}`} style={{
            margin: '6px 0',
            lineHeight: 1.5,
            color: '#ffffff'
          }}>
            {lineContent}
          </div>
        );
      });

      // Add separator between manual notes and auto-captured content
      if (autoGroups.length > 0) {
        processedLines.push(
          <div key="separator" style={{
            margin: '16px 0',
            height: 1,
            background: 'rgba(255, 255, 255, 0.1)'
          }} />
        );
      }
    }

    // 2. Then render auto-captured groups sorted by time
    autoGroups.forEach((group, groupIndex) => {
      const faviconUrl = getFaviconUrl(group.url, 16);

      // Group header with favicon
      processedLines.push(
        <div key={`auto-${groupIndex}`} style={{
          margin: '12px 0 8px 0',
          padding: '8px 12px',
          background: 'rgba(52, 199, 89, 0.03)',
          border: '1px solid rgba(52, 199, 89, 0.1)',
          borderRadius: 8
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
            color: 'rgba(255, 255, 255, 0.7)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 500
          }}>
            <FontAwesomeIcon
              icon={faGlobe}
              style={{
                color: '#34C759',
                fontSize: 'var(--font-size-xs)',
                flexShrink: 0
              }}
            />
            <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>[{group.time}]</span>
            <span>From</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openUrl(group.url);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#34C759',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 'inherit',
                padding: 0,
                font: 'inherit',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
              title={`Open ${group.url}`}
            >
              {faviconUrl && (
                <img
                  src={faviconUrl}
                  alt=""
                  width={14}
                  height={14}
                  style={{
                    borderRadius: 2,
                    flexShrink: 0,
                    opacity: 0.9
                  }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              {group.domain}
              <FontAwesomeIcon
                icon={faExternalLinkAlt}
                style={{ fontSize: 'calc(var(--font-size-xs) * 0.75)', opacity: 0.7 }}
              />
            </button>
            <span style={{
              fontSize: 'var(--font-size-xs)',
              color: 'rgba(255, 255, 255, 0.5)',
              background: 'rgba(52, 199, 89, 0.1)',
              padding: '2px 6px',
              borderRadius: 4,
              marginLeft: 'auto'
            }}>
              {group.selections.length} selection{group.selections.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Render selections */}
          {group.selections.map((selection, selIndex) => (
            <div key={selIndex} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              margin: '4px 0',
              paddingLeft: 8
            }}>
              <FontAwesomeIcon
                icon={faLink}
                style={{
                  color: '#FF9500',
                  fontSize: 'calc(var(--font-size-xs) * 0.85)',
                  marginTop: 3,
                  flexShrink: 0
                }}
              />
              <span style={{
                fontStyle: 'italic',
                color: 'rgba(255, 255, 255, 0.9)',
                lineHeight: 1.4,
                fontSize: 'var(--font-size-base)'
              }}>
                {selection}
              </span>
            </div>
          ))}
        </div>
      );
    });

    return processedLines.length > 0 ? processedLines : content;
  }, [openUrl]);

  // Auto-load today's notes on mount
  React.useEffect(() => {
    loadDailyNotes(selectedDate);
  }, [loadDailyNotes, selectedDate]);

  // Subscribe to daily notes changes for real-time updates
  React.useEffect(() => {
    console.log('[DailyNotesSection] Setting up daily notes change subscription...');
    const unsubscribe = subscribeDailyNotesChanges((changedDate) => {
      console.log('[DailyNotesSection] Daily notes changed for date:', changedDate);
      // Reload if the changed date matches our currently selected date
      if (changedDate === selectedDate) {
        console.log('[DailyNotesSection] Reloading daily notes for current date...');
        loadDailyNotes(selectedDate);
      }
    });

    return () => {
      console.log('[DailyNotesSection] Cleaning up daily notes change subscription...');
      unsubscribe();
    };
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
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <FontAwesomeIcon icon={faCalendarDay} style={{ color: '#FF9500', fontSize: 'var(--font-size-xl)' }} />
          Thoughts
          {dailyNotes?.metadata?.selectionCount > 0 && (
            <span style={{
              fontSize: 'var(--font-size-sm)',
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
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => handleDateChange(e.target.value)}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: 'none',
            background: 'rgba(255, 255, 255, 0.1)',
            color: '#ffffff',
            fontSize: 'var(--font-size-base)',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer'
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Daily notes content - Apple Style */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          overflow: 'hidden',
          maxHeight: '350px'
        }}>
          {editingDailyNotes ? (
            <div style={{
              padding: 16,
              maxHeight: '350px',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <textarea
                value={dailyNotesText}
                onChange={(e) => setDailyNotesText(e.target.value)}
                placeholder="Your daily notes... Selected text from web pages is automatically added here."
                autoFocus
                style={{
                  width: '100%',
                  height: '250px',
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  color: '#ffffff',
                  fontSize: 'var(--font-size-lg)',
                  lineHeight: 1.4,
                  resize: 'none',
                  fontFamily: 'inherit',
                  outline: 'none',
                  overflowY: 'auto',
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(255, 255, 255, 0.3) transparent'
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
                    fontSize: 'var(--font-size-base)',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <FontAwesomeIcon icon={faTimes} style={{ fontSize: 'var(--font-size-sm)' }} />
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
                    fontSize: 'var(--font-size-base)',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 2px 8px rgba(0, 122, 255, 0.3)'
                  }}
                >
                  <FontAwesomeIcon icon={faSave} style={{ fontSize: 'var(--font-size-sm)' }} />
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => setEditingDailyNotes(true)}
              className="daily-notes-scrollable-container"
              style={{
                minHeight: 100,
                maxHeight: '350px',
                padding: 16,
                color: '#ffffff',
                fontSize: 'var(--font-size-lg)',
                lineHeight: 1.4,
                cursor: 'pointer',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                transition: 'all 0.2s ease',
                overflowY: 'auto',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255, 255, 255, 0.3) transparent'
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
                  <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontStyle: 'italic', fontSize: 'calc(var(--font-size-base) * 1.07)' }}>
                    Tap to add your daily notes... Selected text from web pages will appear here automatically.
                  </span>
                )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}