import React from 'react';

/**
 * VerticalTimeline
 * Renders a vertical list of days that actually have notes.
 *
 * Props:
 * - dates: string[] candidate ISO dates (YYYY-MM-DD)
 * - notesCache: Record<string, { selectionCount?: number, preview?: string }>
 * - selectedDate: string
 * - onSelect: (date: string) => void
 */
export default function VerticalTimeline({ dates = [], notesCache = {}, selectedDate, onSelect }) {
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

  // Only show days that have notes (content preview or selectionCount > 0)
  const daysWithNotes = React.useMemo(() => {
    return dates.filter((d) => {
      const info = notesCache[d];
      return !!(info && ((info.preview && info.preview.trim()) || (info.selectionCount && info.selectionCount > 0)));
    });
  }, [dates, notesCache]);

  return (
    <div style={{ position: 'relative', maxHeight: 360, overflowY: 'auto', paddingLeft: 10 }}>
      {daysWithNotes.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'var(--font-size-sm)' }}>
          No notes yet in this range.
        </div>
      )}

      {/* Vertical line */}
      <div
        aria-hidden
        style={{ position: 'absolute', left: 5, top: 0, bottom: 0, width: 2, background: 'rgba(255,255,255,0.12)' }}
      />

      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {daysWithNotes.map((d, idx) => {
          const info = notesCache[d] || {};
          const isActive = d === selectedDate;
          const isLast = idx === daysWithNotes.length - 1;
          return (
            <div key={d} role="listitem" style={{ display: 'flex', gap: 8 }}>
              {/* Marker + connector */}
              <div style={{ width: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: isActive ? '#34C759' : 'rgba(255,255,255,0.35)',
                    border: '2px solid ' + (isActive ? 'rgba(52,199,89,0.6)' : 'rgba(255,255,255,0.25)'),
                    boxShadow: isActive ? '0 0 0 1px rgba(52,199,89,0.18)' : 'none'
                  }}
                />
                {!isLast && (
                  <div style={{ flexGrow: 1, width: 2, background: 'rgba(255,255,255,0.12)', marginTop: 4, marginBottom: 4 }} />
                )}
              </div>

              {/* Content */}
              <button
                onClick={() => onSelect(d)}
                style={{
                  textAlign: 'left',
                  padding: '2px 0',
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: '#ffffff',
                  cursor: 'pointer',
                  flex: 1
                }}
                title={d}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                  <span style={{ fontWeight: 600, opacity: 0.95 }}>{formatDateLabel(d)}</span>
                  <span style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'rgba(255,255,255,0.8)',
                    background: 'rgba(52,199,89,0.12)',
                    border: '1px solid rgba(52,199,89,0.25)',
                    padding: '0 6px',
                    borderRadius: 999
                  }}>{`${info.selectionCount ?? 0}`}</span>
                </div>
                {info.preview && (
                  <div style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'rgba(255,255,255,0.75)',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    maxWidth: '100%'
                  }}>
                    {info.preview}
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
