import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// Every tab-list section (Active Apps, Pinned, Local Dev, ...) used to repeat
// this same ~13-line inline style block with its own icon markup. Centralized
// here so the nine sections in TabManagement.jsx read as one line each.
export function SectionHeader({ icon, children }) {
  return (
    <h3 style={{
      fontSize: 'var(--font-2xl, 20px)',
      fontWeight: 600,
      color: 'var(--text-secondary, #94A3B8)',
      marginBottom: '8px',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }}>
      {icon && <FontAwesomeIcon icon={icon} style={{ opacity: 0.6 }} />}
      {children}
    </h3>
  );
}
