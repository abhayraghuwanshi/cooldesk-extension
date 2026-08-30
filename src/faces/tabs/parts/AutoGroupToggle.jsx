import { faToggleOff, faToggleOn } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// Persisting the toggle (chrome.storage + background message) stays the
// caller's job via onToggle — this only owns the pill's own look/hover state.
export function AutoGroupToggle({ enabled, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        background: enabled
          ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.15))'
          : 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))',
        border: enabled
          ? '1px solid rgba(34, 197, 94, 0.4)'
          : '1px solid rgba(100, 116, 139, 0.3)',
        borderRadius: '8px',
        padding: '6px 12px',
        color: enabled ? '#4ADE80' : '#94A3B8',
        cursor: 'pointer',
        fontSize: 'var(--font-sm, 12px)',
        fontWeight: 600,
        transition: 'all 0.2s ease',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}
      onMouseEnter={(e) => {
        if (enabled) {
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(16, 185, 129, 0.25))';
          e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.6)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        } else {
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.3), rgba(71, 85, 105, 0.25))';
          e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.5)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }
      }}
      onMouseLeave={(e) => {
        if (enabled) {
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.15))';
          e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.4)';
          e.currentTarget.style.transform = 'translateY(0)';
        } else {
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 116, 139, 0.2), rgba(71, 85, 105, 0.15))';
          e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.3)';
          e.currentTarget.style.transform = 'translateY(0)';
        }
      }}
      title={enabled
        ? "Auto-grouping enabled - Click to disable and ungroup all tabs"
        : "Auto-grouping disabled - Click to enable automatic grouping by domain"}
    >
      <FontAwesomeIcon
        icon={enabled ? faToggleOn : faToggleOff}
        size="lg"
        style={{ pointerEvents: 'none' }}
      />
      <span style={{ pointerEvents: 'none' }}>Auto Group</span>
    </button>
  );
}
