// Card colour state for the overview's glass surfaces (the ◍ chip lives in
// ColumnColorChip.jsx): saved accent / Colorless choice and Darkness, plus the
// wallpaper sampling that keeps Colorless text legible. Shared by the column layouts
// (OverviewDashboard) and the Custom layout's cards (CardBoard).
import { useCallback, useEffect, useState } from 'react';
import { TRANSPARENT_ACCENT } from '../../shared/components/AccentColorPicker.jsx';
import { colorlessTextVars, sampleWallpaper } from '../../utils/readableColor.js';

// Matches the --colorless-opacity fallback in cooldesk.css's .is-colorless
// rules, so a column with no saved slider value looks identical to one that
// has never touched Colorless at all.
export const DEFAULT_COLORLESS_OPACITY = 0.55;

const isHex6 = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '');
const isStoredAccent = (c) => c === TRANSPARENT_ACCENT || isHex6(c);

function loadAccent(key) {
    try {
        const v = localStorage.getItem(key);
        return isStoredAccent(v) ? v : null;
    } catch {
        return null;
    }
}

function saveAccent(key, color) {
    try {
        if (color) localStorage.setItem(key, color);
        else localStorage.removeItem(key);
    } catch { /* storage unavailable — accent just won't persist */ }
}

export function useColumnAccent(storageKey) {
    const [color, setColor] = useState(() => loadAccent(storageKey));
    const update = useCallback((next) => {
        setColor(next);
        saveAccent(storageKey, next);
    }, [storageKey]);
    return [color, update];
}

function loadOpacity(key) {
    try {
        const v = parseFloat(localStorage.getItem(key));
        return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_COLORLESS_OPACITY;
    } catch {
        return DEFAULT_COLORLESS_OPACITY;
    }
}

// How dark the Colorless card color sits under its blur — readability vs.
// how much wallpaper shows through is a taste + per-wallpaper call (a calm
// gradient can run much lighter than a busy photo), so it's a user-set knob
// rather than one fixed value baked into the CSS.
export function useColumnOpacity(storageKey) {
    const [opacity, setOpacity] = useState(() => loadOpacity(storageKey));
    const update = useCallback((next) => {
        setOpacity(next);
        try { localStorage.setItem(storageKey, String(next)); } catch { /* storage unavailable — won't persist */ }
    }, [storageKey]);
    return [opacity, update];
}

// The current wallpaper as Colorless columns see it: its bright-area colour
// (sampled once per URL) and the layer opacity, read from the body vars that
// ExtensionApp/App set, and followed live (next-wallpaper button, settings).
// null when wallpaper is off.
function readWallpaper() {
    const b = document.body;
    if (!b.classList.contains('wallpaper-enabled')) return null;
    const m = /url\("?(.*?)"?\)/.exec(b.style.getPropertyValue('--wallpaper-url') || '');
    const opacity = parseFloat(b.style.getPropertyValue('--wallpaper-opacity'));
    return m ? { url: m[1], opacity: Number.isFinite(opacity) ? opacity : 0.3 } : null;
}

export function useWallpaperBacking() {
    const [wall, setWall] = useState(readWallpaper);
    const [color, setColor] = useState(null);
    useEffect(() => {
        const sync = () => setWall(prev => {
            const next = readWallpaper();
            return prev?.url === next?.url && prev?.opacity === next?.opacity ? prev : next;
        });
        const obs = new MutationObserver(sync);
        obs.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
        sync();
        return () => obs.disconnect();
    }, []);
    useEffect(() => {
        let alive = true;
        setColor(null);
        if (wall?.url) sampleWallpaper(wall.url).then(c => { if (alive) setColor(c); });
        return () => { alive = false; };
    }, [wall?.url]);
    // The column glass picks up the wallpaper's hue (--glass-fill in
    // cooldesk.css). Set on body because --glass-fill is defined on
    // .popup-wrap and resolves the var there.
    useEffect(() => {
        const b = document.body.style;
        if (color?.tint) b.setProperty('--wall-tint', color.tint);
        else b.removeProperty('--wall-tint');
    }, [color?.tint]);
    if (!wall) return null;
    // Unreadable (cross-origin custom URL): assume a fairly bright photo so the
    // text still gets help that scales with the darkness slider.
    return { color: color?.bright || '#b8bcc4', opacity: wall.opacity };
}

export function colorlessStyle(opacity, wall) {
    return {
        '--colorless-opacity': opacity,
        // No wallpaper: the slab sits on the theme background, nothing to beat.
        ...(wall ? colorlessTextVars(wall.color, wall.opacity, opacity) : {}),
    };
}
