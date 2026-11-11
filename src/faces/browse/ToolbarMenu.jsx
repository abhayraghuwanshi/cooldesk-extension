import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';

/**
 * A toolbar button that opens a small menu — how the tab toolbars stay
 * short: occasional actions live here instead of as a row of icons.
 *
 * The menu is ordinary HTML, so while it's open over a web page that page
 * hides under it (useNativePane's covered check), like any overlay.
 *
 * @param icon / title   the button
 * @param dot            show a small badge dot on the button (e.g. update)
 * @param items          [{ key, icon?, label, hint?, checked?, accent?, onSelect }]
 *                       — `null` entries draw a divider
 * @param align          'right' (default) or 'left' edge of the button
 */
export function ToolbarMenu({ icon, title, dot = false, items, align = 'right', className = '', label = null }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(null); // key of an item that just ran (✓ flash)
  const rootRef = useRef(null);
  const shown = items.filter(i => i !== false && i !== undefined);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const run = async (item) => {
    try {
      await item.onSelect?.();
      if (item.keepOpen) {
        setDone(item.key);
        setTimeout(() => setDone(null), 1100);
      } else {
        setOpen(false);
      }
    } catch (err) {
      console.warn(`[Menu] ${item.label} failed:`, err);
    }
  };

  return (
    <div className={`tbm ${className}`} ref={rootRef}>
      <button
        type="button"
        className={`bp-btn tbm-btn ${open ? 'on' : ''} ${dot ? 'tbm-dot' : ''}`}
        onClick={() => setOpen(v => !v)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FontAwesomeIcon icon={icon} />
        {label && <span className="tbm-label">{label}</span>}
      </button>
      {open && (
        // macOS-style menu: a ✓ gutter on the left when any item can be
        // checked, blue highlight under the pointer.
        <div className={`tbm-menu tbm-menu--${align} ${shown.some(i => i && i.checked !== undefined) ? 'has-checks' : ''}`} role="menu">
          {shown.map((item, i) => (item === null ? (
            <div key={`sep-${i}`} className="tbm-sep" role="separator" />
          ) : (
            <button
              key={item.key}
              type="button"
              className={`tbm-item ${item.accent ? 'is-accent' : ''} ${item.checked ? 'is-checked' : ''}`}
              role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={item.checked !== undefined ? !!item.checked : undefined}
              onClick={() => run(item)}
            >
              <span className="tbm-gutter">{item.checked && <FontAwesomeIcon icon={faCheck} />}</span>
              {(item.icon || done === item.key) && (
                <span className="tbm-icon">
                  <FontAwesomeIcon icon={done === item.key ? faCheck : item.icon} />
                </span>
              )}
              <span className="tbm-text">{done === item.key ? (item.doneLabel || 'Done') : item.label}</span>
              {item.hint && <kbd className="tbm-hint">{item.hint}</kbd>}
            </button>
          )))}
        </div>
      )}
    </div>
  );
}
