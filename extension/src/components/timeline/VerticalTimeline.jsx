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
  const formatTimeAgo = React.useCallback((dateStr) => {
    try {
      const now = Date.now();
      const d = new Date(dateStr + 'T00:00:00').getTime();
      const diffMs = now - d;
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return `${Math.floor(diffDays / 7)}w ago`;
    } catch {
      return dateStr;
    }
  }, []);

  // Show days that have notes OR today (always show today)
  const daysWithNotes = React.useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return dates.filter((d) => {
      // Always show today
      if (d === today) return true;
      
      // Show other days only if they have notes
      const info = notesCache[d];
      return !!(info && ((info.preview && info.preview.trim()) || (info.selectionCount && info.selectionCount > 0)));
    });
  }, [dates, notesCache]);

  return (
    <div style={{ position: 'relative', maxHeight: 360, overflowY: 'auto', paddingLeft: 8 }}>
      {daysWithNotes.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'var(--font-size-xs)' }}>
          No notes yet
        </div>
      )}

      {/* Vertical line */}
      <div
        aria-hidden
        style={{ position: 'absolute', left: 3, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.12)' }}
      />

      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {daysWithNotes.map((d, idx) => {
          const info = notesCache[d] || {};
          const isActive = d === selectedDate;
          const isLast = idx === daysWithNotes.length - 1;
          return (
            <div key={d} role="listitem" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {/* Marker + connector */}
              <div style={{ width: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: isActive ? '#34C759' : 'rgba(255,255,255,0.4)',
                    border: isActive ? '1px solid rgba(52,199,89,0.6)' : 'none'
                  }}
                />
                {!isLast && (
                  <div style={{ flexGrow: 1, width: 1, background: 'rgba(255,255,255,0.12)', marginTop: 2, marginBottom: 2 }} />
                )}
              </div>

              {/* Content */}
              <button
                onClick={() => onSelect(d)}
                style={{
                  textAlign: 'left',
                  padding: '4px 0',
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: isActive ? '#ffffff' : 'rgba(255,255,255,0.6)',
                  cursor: 'pointer',
                  flex: 1,
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 500,
                  transition: 'color 0.2s ease'
                }}
                title={d}
              >
                {formatTimeAgo(d)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
