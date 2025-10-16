import { faCalendarAlt, faCheck, faChevronLeft, faChevronRight, faExternalLinkAlt, faGlobe, faLink } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { subscribeDailyNotesChanges } from '../../db/index.js';
import { getFaviconUrl } from '../../utils.js';
import VerticalTimeline from '../timeline/VerticalTimeline.jsx';
import '../../styles/default/DailyNotesSection.css';
export function DailyNotesSection() {
  // Daily notes state
  const [dailyNotes, setDailyNotes] = React.useState(null);
  const [selectedDate, setSelectedDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [editingDailyNotes, setEditingDailyNotes] = React.useState(false);
  const [dailyNotesText, setDailyNotesText] = React.useState('');
  // Timeline state for timeline-based navigation
  const [timelineOffset, setTimelineOffset] = React.useState(0); // window start (days back)
  const timelineRange = 14; // days to show in timeline
  const [notesCache, setNotesCache] = React.useState({}); // { [date]: { selectionCount, preview } }
  const textAreaRef = React.useRef(null);
  const todayISO = React.useMemo(() => new Date().toISOString().split('T')[0], []);
  const isSelectedDateToday = selectedDate === todayISO;
  // Helpers for timeline labels and date ranges
  const formatDateLabel = React.useCallback((dateStr) => {
    try {
      const today = new Date();
      const d = new Date(dateStr + 'T00:00:00');
      const diffDays = Math.floor((today.setHours(0, 0, 0, 0) - d.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }, []);

  // Timeline always visible
  const showTimeline = true;

  const getDateNDaysAgo = React.useCallback((n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }, []);

  const timelineDates = React.useMemo(() => {
    const dates = [];
    for (let i = 0; i < timelineRange; i++) {
      dates.push(getDateNDaysAgo(timelineOffset + i));
    }
    return dates;
  }, [timelineOffset, timelineRange, getDateNDaysAgo]);

  // Prefetch lightweight metadata to power timeline badges and older pins previews
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const date of timelineDates) {
        if (cancelled) return;
        if (notesCache[date]) continue;

        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'getDailyNotes', date }, (response) => {
            if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
            else resolve(response);
          });
        });

        if (cancelled) return;
        setNotesCache((prev) => ({
          ...prev,
          [date]: {
            selectionCount: res?.dailyNotes?.metadata?.selectionCount ?? 0,
            preview: (res?.dailyNotes?.content || '').split('\n').find(Boolean) || ''
          }
        }));
      }
    })();
    return () => { cancelled = true; };
  }, [timelineDates, notesCache]);

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
          // Don't populate textarea - keep it empty for new notes
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

    if (!selectedDate || !dailyNotesText.trim()) {
      console.error('[DailyNotesSection] No selected date or empty text');
      return;
    }

    try {
      // Add timestamp marker to the new note
      const timestamp = Date.now();
      const timestampedNote = `[${timestamp}] ${dailyNotesText.trim()}`;
      
      // Append new note to existing content
      const existingContent = dailyNotes?.content || '';
      const newContent = existingContent 
        ? `${existingContent}\n\n${timestampedNote}`
        : timestampedNote;

      console.log('[DailyNotesSection] Sending updateDailyNotes message...');
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'updateDailyNotes',
          date: selectedDate,
          content: newContent
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
        console.log('[DailyNotesSection] Save successful, clearing input and reloading notes...');
        setDailyNotesText(''); // Clear the input
        await loadDailyNotes(selectedDate);
        setEditingDailyNotes(false);
        console.log('[DailyNotesSection] Save process completed');
      } else {
        console.error('[DailyNotesSection] Failed to save daily notes:', response?.error);
      }
    } catch (e) {
      console.error('[DailyNotesSection] Exception during save:', e);
    }
  }, [selectedDate, dailyNotesText, dailyNotes, loadDailyNotes]);

  const handleDateChange = React.useCallback((date) => {
    setSelectedDate(date);
    setEditingDailyNotes(false);
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

  // Function to open URL in current tab
  const openUrl = React.useCallback((url) => {
    if (chrome?.tabs?.update) {
      chrome.tabs.update({ url, active: true });
    } else if (chrome?.tabs?.create) {
      chrome.tabs.create({ url, active: true });
    } else {
      window.open(url, '_blank');
    }
  }, []);

  // Function to render content with icons and clickable links
  const renderContentWithLinks = React.useCallback((content) => {
    if (!content) return null;

    const lines = content.split('\n');

    const autoGroups = [];
    let currentGroup = null;
    const manualNotes = [];

    lines.forEach((line) => {
      if (!line.trim()) {
        return;
      }

      const autoCaptureRegex = /^\[(\d{1,2}:\d{2})\]\s+From\s+\[([^\]]+)\]\(([^)]+)\):\s*$/;
      const autoCaptureMatch = line.match(autoCaptureRegex);
      const isQuotedText = line.startsWith('"') && line.endsWith('"') && line.length > 2;

      if (autoCaptureMatch) {
        if (currentGroup) {
          autoGroups.push(currentGroup);
        }

        const [, time, domain, url] = autoCaptureMatch;
        currentGroup = {
          time,
          timeValue: convertTimeToMinutes(time),
          domain,
          url,
          selections: []
        };
      } else if (isQuotedText && currentGroup) {
        currentGroup.selections.push(line);
      } else {
        manualNotes.push(line);
      }
    });

    if (currentGroup) {
      autoGroups.push(currentGroup);
    }

    autoGroups.sort((a, b) => a.timeValue - b.timeValue);

    const rendered = [];

    if (manualNotes.length > 0) {
      manualNotes.forEach((line, index) => {
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const parts = [];
        let lastIndex = 0;
        let match;

        while ((match = linkRegex.exec(line)) !== null) {
          if (match.index > lastIndex) {
            parts.push(line.substring(lastIndex, match.index));
          }

          const linkText = match[1];
          const url = match[2];
          parts.push(
            <button
              key={`${index}-${match.index}`}
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

        rendered.push(
          <div
            key={`manual-${index}`}
            style={{
              margin: '6px 0',
              lineHeight: 1.5,
              color: '#ffffff'
            }}
          >
            {parts.length > 0 ? parts : line}
          </div>
        );
      });

      if (autoGroups.length > 0) {
        rendered.push(
          <div
            key="manual-auto-separator"
            style={{
              margin: '16px 0',
              height: 1,
              background: 'rgba(255, 255, 255, 0.1)'
            }}
          />
        );
      }
    }

    autoGroups.forEach((group, groupIndex) => {
      const faviconUrl = getFaviconUrl(group.url, 16);

      rendered.push(
        <div
          key={`auto-${groupIndex}`}
          style={{
            margin: '12px 0 8px 0',
            padding: '8px 12px',
            background: 'rgba(52, 199, 89, 0.03)',
            border: '1px solid rgba(52, 199, 89, 0.1)',
            borderRadius: 8
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 8,
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 500
            }}
          >
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
            <span
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'rgba(255, 255, 255, 0.5)',
                background: 'rgba(52, 199, 89, 0.1)',
                padding: '2px 6px',
                borderRadius: 4,
                marginLeft: 'auto'
              }}
            >
              {group.selections.length} selection{group.selections.length !== 1 ? 's' : ''}
            </span>
          </div>

          {group.selections.map((selection, selIndex) => (
            <div
              key={selIndex}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                margin: '4px 0',
                paddingLeft: 8
              }}
            >
              <FontAwesomeIcon
                icon={faLink}
                style={{
                  color: '#FF9500',
                  fontSize: 'calc(var(--font-size-xs) * 0.85)',
                  marginTop: 3,
                  flexShrink: 0
                }}
              />
              <span
                style={{
                  fontStyle: 'italic',
                  color: 'rgba(255, 255, 255, 0.9)',
                  lineHeight: 1.4,
                  fontSize: 'var(--font-size-base)'
                }}
              >
                {selection}
              </span>
            </div>
          ))}
        </div>
      );
    });

    if (rendered.length === 0) {
      return content;
    }

    return rendered;
  }, [convertTimeToMinutes, openUrl]);

  const startEditing = React.useCallback(() => {
    setDailyNotesText(dailyNotes?.content ?? '');
    setEditingDailyNotes(true);
  }, [dailyNotes]);

  const cancelEditing = React.useCallback(() => {
    setDailyNotesText(dailyNotes?.content ?? '');
    setEditingDailyNotes(false);
  }, [dailyNotes]);

  React.useEffect(() => {
    if (editingDailyNotes && textAreaRef.current) {
      try {
        const el = textAreaRef.current;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      } catch { }
    }
  }, [editingDailyNotes]);

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

  const autoSelectionCount = dailyNotes?.metadata?.selectionCount ?? 0;
  const hasManualContent = Boolean(dailyNotes?.content && dailyNotes.content.trim());
  const hasAnyContent = hasManualContent || autoSelectionCount > 0;
  const editButtonLabel = hasManualContent ? 'Edit notes' : 'Write notes';
  const textareaPlaceholder = isSelectedDateToday ? 'Write something about today…' : `Write notes for ${selectedDate}`;
  
  // Parse notes into individual entries (split by double newline or timestamp pattern)
  const noteEntries = React.useMemo(() => {
    if (!dailyNotes?.content) return [];
    const content = dailyNotes.content.trim();
    if (!content) return [];
    
    // Split by double newlines to separate entries
    const entries = content.split(/\n\n+/).filter(e => e.trim());
    const baseTimestamp = dailyNotes.updatedAt || dailyNotes.createdAt || Date.now();
    
    const mapped = entries.map((entry, idx) => {
      // Try to extract timestamp from [timestamp] prefix
      const timestampMatch = entry.match(/^\[(\d+)\]\s*/);
      let timestamp;
      let text = entry.trim();
      
      if (timestampMatch) {
        // Has embedded timestamp - use it
        timestamp = parseInt(timestampMatch[1], 10);
        text = entry.substring(timestampMatch[0].length).trim();
      } else {
        // No timestamp - estimate based on position (older entries further back)
        // Assume entries are in chronological order, space them 5 minutes apart
        timestamp = baseTimestamp - (idx * 5 * 60 * 1000);
      }
      
      return {
        id: idx,
        text: text,
        timestamp: timestamp
      };
    });
    
    // Sort by timestamp, newest first
    return mapped.sort((a, b) => b.timestamp - a.timestamp);
  }, [dailyNotes]);
  
  // Format time ago
  const formatTimeAgo = React.useCallback((timestamp) => {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 7)}w ago`;
  }, []);

  return (
    <div
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          padding: '0 4px'
        }}
      >
        <h2
          style={{
            fontSize: 'var(--font-size-2xl)',
            fontWeight: 600,
            margin: 0,
            color: '#ffffff',
            letterSpacing: '-0.5px'
          }}
        >
          Thoughts
        </h2>
      </div>

      {/* Layout */}
      <div>
        <div style={{ width: '100%' }}>
          {/* Input area - always visible */}
          <div
            style={{
              marginBottom: 16,
              background: 'rgba(255, 255, 255, 0.07)',
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(255, 255, 255, 0.16)',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <textarea
                ref={textAreaRef}
                value={dailyNotesText}
                onChange={(e) => setDailyNotesText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (dailyNotesText.trim()) saveDailyNotes();
                  }
                }}
                placeholder={textareaPlaceholder}
                style={{
                  flex: 1,
                  minHeight: 60,
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  color: '#ffffff',
                  fontSize: 'var(--font-size-base)',
                  lineHeight: 1.5,
                  resize: 'none',
                  fontFamily: 'inherit',
                  outline: 'none'
                }}
                rows={1}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.max(60, e.target.scrollHeight) + 'px';
                }}
              />
              <button
                onClick={saveDailyNotes}
                disabled={!dailyNotesText.trim()}
                style={{
                  height: 32,
                  minWidth: 32,
                  padding: '0 12px',
                  borderRadius: 16,
                  border: 'none',
                  background: dailyNotesText.trim() ? 'rgba(52,199,89,0.15)' : 'rgba(255,255,255,0.05)',
                  color: dailyNotesText.trim() ? '#34C759' : 'rgba(255,255,255,0.4)',
                  cursor: dailyNotesText.trim() ? 'pointer' : 'not-allowed',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 600,
                  transition: 'all 0.2s ease',
                  flexShrink: 0
                }}
                title="Add note (Cmd+Enter)"
              >
                <FontAwesomeIcon icon={faCheck} />
              </button>
            </div>
          </div>

          {/* Notes display */}
          {hasAnyContent && (
            <div
              className="daily-notes-scrollable-container"
              style={{
                minHeight: 100,
                maxHeight: '420px',
                overflowY: 'auto',
                position: 'relative',
                paddingLeft: 20
              }}
            >
              {/* Vertical timeline line */}
              <div
                style={{
                  position: 'absolute',
                  left: 6,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: 'rgba(255, 255, 255, 0.15)'
                }}
              />
              
              {/* Chat-like note entries */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {noteEntries.map((entry, idx) => (
                  <div
                    key={entry.id}
                    style={{
                      position: 'relative',
                      paddingLeft: 16
                    }}
                  >
                    {/* Timeline dot with timestamp */}
                    <div
                      style={{
                        position: 'absolute',
                        left: -14,
                        top: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: '#34C759',
                          border: '2px solid rgba(52, 199, 89, 0.3)'
                        }}
                      />
                      <span
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          color: 'rgba(255, 255, 255, 0.5)',
                          fontWeight: 500,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {formatTimeAgo(entry.timestamp)}
                      </span>
                    </div>
                    
                    {/* Message bubble */}
                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.06)',
                        borderRadius: 12,
                        padding: 12,
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.09)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                      }}
                    >
                      <div
                        style={{
                          color: '#ffffff',
                          fontSize: 'var(--font-size-base)',
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word'
                        }}
                      >
                        {renderContentWithLinks(entry.text)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}