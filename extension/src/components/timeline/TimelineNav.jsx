import React from 'react';

/**
 * TimelineNav
 * A horizontal timeline for selecting days relative to today.
 *
 * Props:
 * - selectedDate: ISO string (YYYY-MM-DD)
 * - onChange: (date: string) => void
 * - offset: number (window start offset in days from today)
 * - onOffsetChange: (newOffset: number) => void
 * - range?: number (number of days to show, default 14)
 * - notesCache?: Record<string, { selectionCount?: number }>
 */
export default function TimelineNav({
  selectedDate,
  onChange,
  offset,
  onOffsetChange,
  range = 14,
  notesCache = {}
}) {
  const getDateNDaysAgo = React.useCallback((n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }, []);

  const formatDateLabel = React.useCallback((dateStr) => {
    try {
      const today = new Date();
      const d = new Date(dateStr + 'T00:00:00');
      const diffDays = Math.floor((today.setHours(0,0,0,0) - d.setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }, []);

  const dates = React.useMemo(() => {
    const arr = [];
    for (let i = 0; i < range; i++) {
      arr.push(getDateNDaysAgo(offset + i));
    }
    return arr;
  }, [offset, range, getDateNDaysAgo]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={() => onOffsetChange(Math.max(0, offset - range))}
        title="Newer"
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255, 255, 255, 0.08)',
          color: '#ffffff',
          cursor: 'pointer'
        }}
      >
        {'<'}
      </button>
      <div style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        maxWidth: 420,
        paddingBottom: 4
      }}>
        {dates.map((d) => {
          const isActive = d === selectedDate;
          const info = notesCache[d];
          return (
            <button
              key={d}
              onClick={() => onChange(d)}
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid ' + (isActive ? 'rgba(52, 199, 89, 0.7)' : 'rgba(255,255,255,0.15)'),
                background: isActive ? 'rgba(52,199,89,0.15)' : 'rgba(255, 255, 255, 0.06)',
                color: '#ffffff',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontWeight: isActive ? 700 : 500
              }}
              title={d + (info ? ` • ${info.selectionCount ?? 0} pins` : '')}
            >
              {formatDateLabel(d)}{info ? ` • ${info.selectionCount ?? 0}` : ''}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => onOffsetChange(offset + range)}
        title="Older"
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255, 255, 255, 0.08)',
          color: '#ffffff',
          cursor: 'pointer'
        }}
      >
        {'>'}
      </button>
    </div>
  );
}
