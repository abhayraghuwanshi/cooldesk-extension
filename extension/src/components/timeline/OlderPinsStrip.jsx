import React from 'react';

/**
 * OlderPinsStrip
 * A horizontally scrollable strip of older days with counts and 1-line preview.
 *
 * Props:
 * - dates: string[] ISO dates to render
 * - selectedDate: string currently selected
 * - onSelect: (date: string) => void
 * - onLoadOlder: () => void
 * - notesCache?: Record<string, { selectionCount?: number, preview?: string }>
 */
export default function OlderPinsStrip({ dates, selectedDate, onSelect, onLoadOlder, notesCache = {} }) {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        color: 'rgba(255,255,255,0.7)'
      }}>
        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Older pins</span>
        <button
          onClick={onLoadOlder}
          style={{
            background: 'none',
            border: 'none',
            color: '#34C759',
            cursor: 'pointer',
            fontSize: 'var(--font-size-sm)'
          }}
        >
          Load older
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {dates.filter((d) => d !== selectedDate).map((d) => {
          const info = notesCache[d] || {};
          return (
            <div
              key={`older-${d}`}
              onClick={() => onSelect(d)}
              style={{
                minWidth: 160,
                maxWidth: 220,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.05)',
                color: '#ffffff',
                cursor: 'pointer'
              }}
              title={d}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6
              }}>
                <span style={{ fontSize: 'var(--font-size-sm)', opacity: 0.85 }}>{formatDateLabel(d)}</span>
                <span style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'rgba(255,255,255,0.7)',
                  background: 'rgba(52,199,89,0.12)',
                  border: '1px solid rgba(52,199,89,0.25)',
                  padding: '1px 6px',
                  borderRadius: 999
                }}>{`${info.selectionCount ?? 0} pins`}</span>
              </div>
              <div style={{
                fontSize: 'var(--font-size-sm)',
                color: 'rgba(255,255,255,0.85)',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden'
              }}>
                {info.preview || 'No notes'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
