import { useEffect, useRef, useState } from 'react';
import { ensureFontLoaded, fontFamilies } from '../../../utils/fontUtils';

/**
 * Compact font-family picker rendered as a dropdown.
 * Options are grouped by category and each is previewed in its own typeface.
 * Fonts load on demand: the whole list is loaded when the menu opens so
 * previews render, and the chosen font is applied by the parent.
 */
const FontFamilyDropdown = ({ fontFamily, onFontFamilyChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const selected = fontFamilies.find(f => f.id === fontFamily) || fontFamilies[0];

  // Load every font's stylesheet once the menu opens, so previews are accurate
  useEffect(() => {
    if (open) fontFamilies.forEach(ensureFontLoaded);
  }, [open]);

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

  // Group fonts by category, preserving declaration order
  const groups = fontFamilies.reduce((acc, f) => {
    (acc[f.category] = acc[f.category] || []).push(f);
    return acc;
  }, {});

  const handleSelect = (id) => {
    onFontFamilyChange && onFontFamilyChange(id);
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
          <span style={{
            fontSize: 'var(--font-base)',
            fontWeight: 600,
            fontFamily: selected.family,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 360
          }}>
            {selected.name}
          </span>
          <span style={{ fontSize: 'var(--font-xs)', color: 'rgba(255,255,255,0.45)' }}>
            {selected.category}
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
            maxHeight: 320,
            overflowY: 'auto',
            background: 'rgba(24, 24, 34, 0.98)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 12,
            boxShadow: '0 16px 48px -12px rgba(0,0,0,0.6)',
            padding: 6
          }}
        >
          {Object.entries(groups).map(([category, fonts]) => (
            <div key={category}>
              <div style={{
                padding: '8px 10px 4px',
                fontSize: 'var(--font-xs)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'rgba(255,255,255,0.35)'
              }}>
                {category}
              </div>
              {fonts.map((font) => {
                const isSelected = font.id === fontFamily;
                return (
                  <div
                    key={font.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(font.id)}
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
                        fontSize: 'var(--font-sm)',
                        fontWeight: 600,
                        fontFamily: font.family,
                        color: isSelected ? '#34C759' : '#e5e7eb',
                        lineHeight: 1.3
                      }}>
                        {font.name}
                      </div>
                      <div style={{
                        fontSize: 'var(--font-xs)',
                        fontFamily: font.family,
                        color: 'rgba(255,255,255,0.4)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        The quick brown fox jumps over
                      </div>
                    </div>
                    {isSelected && (
                      <span style={{ color: '#34C759', fontSize: 'var(--font-sm)', flexShrink: 0 }}>✓</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Live preview of the current selection */}
      <div style={{
        marginTop: 10,
        padding: '12px 14px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.02)'
      }}>
        <div style={{
          fontSize: 'var(--font-lg)',
          fontFamily: selected.family,
          color: '#e5e7eb',
          lineHeight: 1.4
        }}>
          The quick brown fox jumps over the lazy dog
        </div>
        <div style={{
          fontSize: 'var(--font-xs)',
          fontFamily: selected.family,
          color: 'rgba(255,255,255,0.45)',
          marginTop: 4
        }}>
          1234567890 &nbsp; — &nbsp; {selected.description}
        </div>
      </div>
    </div>
  );
};

export default FontFamilyDropdown;
