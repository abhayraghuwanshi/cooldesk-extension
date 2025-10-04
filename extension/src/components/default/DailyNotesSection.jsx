import { faExternalLinkAlt, faGlobe, faLink } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { subscribeDailyNotesChanges } from '../../db/index.js';
import { getFaviconUrl } from '../../utils.js';
import VerticalTimeline from '../timeline/VerticalTimeline.jsx';

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
      {/* Header */}
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
          Thoughts
        </h2>

      </div>

      {/* Layout: Vertical timeline left, notes right */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 16 }}>
        <div style={{ minWidth: 180, maxWidth: 220 }}>
          <VerticalTimeline
            dates={timelineDates}
            notesCache={notesCache}
            selectedDate={selectedDate}
            onSelect={(d) => handleDateChange(d)}
          />
        </div>

        <div style={{ flex: 1 }}>
          {(dailyNotes?.content && dailyNotes.content.trim()) || (dailyNotes?.metadata?.selectionCount > 0) ? (
            <div
              className="daily-notes-scrollable-container"
              style={{
                minHeight: 100,
                maxHeight: '420px',
                padding: 16,
                color: '#ffffff',
                fontSize: 'var(--font-size-lg)',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowY: 'auto',
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: 12,
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}
            >
              {dailyNotes?.content ? renderContentWithLinks(dailyNotes.content) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}