import { useEffect, useRef, useState } from 'react';
import { fontSizes } from '../../../utils/fontUtils';

/**
 * Compact font-size picker rendered as a dropdown.
 * Each option previews text at its actual pixel size.
 */
const FontSizeDropdown = ({ fontSize, onFontSizeChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const selected = fontSizes.find(f => f.id === fontSize) || fontSizes[1];

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSelect = (id) => {
    onFontSizeChange && onFontSizeChange(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', maxWidth: 420 }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '10px 14px',
          background: 'rgba(255, 255, 255, 0.05)',
          border: open ? '1px solid rgba(52, 199, 89, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 10,
          cursor: 'pointer',
          color: '#e5e7eb',
          transition: 'border-color 0.2s ease'
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
          <span style={{ fontSize: 'var(--font-base)', fontWeight: 600 }}>
            {selected.name}
          </span>
          <span style={{ fontSize: 'var(--font-xs)', color: 'rgba(255,255,255,0.45)' }}>
            {selected.size}
          </span>
        </span>
        <span style={{
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease',
          color: 'rgba(255,255,255,0.5)',
          fontSize: 'var(--font-sm)'
        }}>
          ▾
        </span>
      </button>

      {/* Menu */}
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'rgba(24, 24, 34, 0.98)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 12,
            boxShadow: '0 16px 48px -12px rgba(0,0,0,0.6)',
            padding: 6
          }}
        >
          {fontSizes.map((opt) => {
            const isSelected = opt.id === fontSize;
            return (
              <div
                key={opt.id}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '9px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: isSelected ? 'rgba(52, 199, 89, 0.15)' : 'transparent',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: opt.size,
                    fontWeight: 600,
                    color: isSelected ? '#34C759' : '#e5e7eb',
                    lineHeight: 1.3
                  }}>
                    {opt.name} <span style={{ fontSize: 'var(--font-xs)', color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>({opt.size})</span>
                  </div>
                  <div style={{
                    fontSize: 'var(--font-xs)',
                    color: 'rgba(255,255,255,0.4)',
                    lineHeight: 1.3
                  }}>
                    {opt.description}
                  </div>
                </div>
                {isSelected && (
                  <span style={{ color: '#34C759', fontSize: 'var(--font-sm)', flexShrink: 0 }}>✓</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FontSizeDropdown;
