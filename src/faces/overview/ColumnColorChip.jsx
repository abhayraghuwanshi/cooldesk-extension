import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AccentColorPicker, TRANSPARENT_ACCENT } from '../../shared/components/AccentColorPicker.jsx';

// Hover-revealed "card color" chip + portaled swatch popover — same grammar
// as the per-widget accent chip (WidgetBoard's ◍), but for a whole column
// card instead of a repeating tile. Portaled to <body> because both columns
// use backdrop-filter, which makes them a containing block for
// position:fixed descendants (see WidgetBoard.jsx's picker-overlay comment).
export function ColumnColorChip({ color, onChange, opacity, onOpacityChange }) {
    const [menu, setMenu] = useState(null);

    useEffect(() => {
        if (!menu) return;
        const dismiss = (e) => {
            if (e.target?.closest?.('.workspace-context-menu')) return;
            setMenu(null);
        };
        const raf = requestAnimationFrame(() => {
            window.addEventListener('click', dismiss);
            window.addEventListener('contextmenu', dismiss);
        });
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('click', dismiss);
            window.removeEventListener('contextmenu', dismiss);
        };
    }, [menu]);

    return (
        <div className="overview-column-controls">
            <button
                type="button"
                className={`overview-column-color-chip ${color ? 'active' : ''}`}
                title="Card color"
                style={color && color !== TRANSPARENT_ACCENT ? { color } : undefined}
                onClick={e => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    // Anchor from the viewport's right edge, not the button's
                    // right edge — the chip sits at the column's top-right
                    // corner (right: 10px), so opening the menu rightward
                    // (left: r.right) pushed it straight off-screen on the
                    // activity column. Right-anchoring makes it open leftward
                    // into the visible column instead, same as it would if
                    // built with a native <details>/menu.
                    setMenu({ top: r.bottom + 4, right: window.innerWidth - r.right });
                }}
            >
                ◍
            </button>
            {menu && createPortal(
                <div
                    className="workspace-context-menu"
                    style={{ top: menu.top, right: menu.right }}
                    onClick={e => e.stopPropagation()}
                    onContextMenu={e => e.preventDefault()}
                >
                    <div className="context-menu-label">Card color</div>
                    <AccentColorPicker
                        className="context-menu-swatches"
                        value={color}
                        allowTransparent
                        onSelect={(next, source) => {
                            onChange(next);
                            if (source !== 'custom') setMenu(null);
                        }}
                    />
                    {color === TRANSPARENT_ACCENT && (
                        <div className="context-menu-opacity">
                            <span className="context-menu-opacity-label">Darkness</span>
                            <input
                                type="range"
                                min={0.15}
                                max={0.85}
                                step={0.05}
                                value={opacity}
                                onClick={e => e.stopPropagation()}
                                onChange={e => onOpacityChange(parseFloat(e.target.value))}
                                title={`${Math.round(opacity * 100)}% — lower shows more wallpaper, higher stays legible over busier ones`}
                            />
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}
