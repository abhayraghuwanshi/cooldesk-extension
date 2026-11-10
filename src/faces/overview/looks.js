import { useSyncExternalStore } from 'react';
import { getVibe } from './overviewLayouts';
import { BOARD_SKINS } from './boardSkins';

// Looks: a skin (boardSkins.js) worn by any layout, chosen per layout in
// Customize → Layout. Layout (where things sit) × Look (what it's made of)
// is what gives the new tab its hundreds of combinations.
//
// Per-layout choice: 'auto' (the layout's own skin — Workflow boards have
// one, everything else wears none), 'none', or a look key. Stored as one
// map; a window event keeps the board and the picker in step.
//
// Not every layout takes a look: the two-column layouts are their own UI,
// the Designs are a look already, and a few Fun stages (Terminal,
// Newspaper, Scrapbook, Night) are dressed as an object (`ownLook`).

const KEY = 'cooldesk-overview-looks';
const EVENT = 'cooldesk-look-changed';

function readMap() {
    try {
        const v = JSON.parse(localStorage.getItem(KEY));
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
        return {};
    }
}

let map = readMap();

export function supportsLook(layout) {
    if (layout === 'custom') return true;
    const v = getVibe(layout);
    return !!v && v.group !== 'design' && !v.ownLook;
}

export function getLookChoice(layout) {
    const c = map[layout];
    return c === 'none' || BOARD_SKINS[c] ? c : 'auto';
}

/** The skin a layout actually wears, or null. */
export function resolveLook(layout) {
    if (!supportsLook(layout)) return null;
    const c = getLookChoice(layout);
    if (c === 'none') return null;
    if (c !== 'auto') return c;
    return getVibe(layout)?.skin || null;
}

export function setLook(layout, choice) {
    const next = { ...map };
    if (choice === 'auto' || (choice !== 'none' && !BOARD_SKINS[choice])) delete next[layout];
    else next[layout] = choice;
    map = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* won't persist */ }
    window.dispatchEvent(new Event(EVENT));
}

if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key !== KEY) return;
        map = readMap();
        window.dispatchEvent(new Event(EVENT));
    });
}

const subscribe = (cb) => {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
};
const getMap = () => map;

/** The resolved look for a layout; re-renders when any look changes. */
export function useLook(layout) {
    useSyncExternalStore(subscribe, getMap, getMap);
    return resolveLook(layout);
}

/** The stored choice ('auto' | 'none' | key); re-renders on change. */
export function useLookChoice(layout) {
    useSyncExternalStore(subscribe, getMap, getMap);
    return getLookChoice(layout);
}
