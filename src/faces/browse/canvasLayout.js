// Grid layout for the Browse canvas: tiles live on a 12-column grid of fixed
// row height; positions/sizes are in grid units. Pure functions only.

export const COLS = 12;
export const ROW_H = 56;
export const GAP = 12;
export const MIN_W = 3;
export const MIN_H = 4;
const NEW_W = 6;
const NEW_H = 7;

const CANVAS_KEY = 'cooldesk.browse.canvas';

export function loadTiles() {
  try {
    const raw = JSON.parse(localStorage.getItem(CANVAS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(t => t?.id && t?.url) : [];
  } catch {
    return [];
  }
}

export function saveTiles(tiles) {
  try { localStorage.setItem(CANVAS_KEY, JSON.stringify(tiles)); } catch { /* keep in memory */ }
}

const collides = (a, b) => a.id !== b.id
  && a.x < b.x + b.w && a.x + a.w > b.x
  && a.y < b.y + b.h && a.y + a.h > b.y;

const clampTile = (t) => {
  const w = Math.min(COLS, Math.max(MIN_W, t.w));
  return { ...t, w, h: Math.max(MIN_H, t.h), x: Math.min(COLS - w, Math.max(0, t.x)), y: Math.max(0, t.y) };
};

/**
 * Settle a layout: `pinnedId` (the tile being dragged/resized) keeps its spot;
 * every other tile, in reading order, floats up to the highest row where it
 * doesn't overlap anything already placed — so tiles under a moved one get
 * pushed down, and gaps left behind close up.
 */
export function compact(tiles, pinnedId = null) {
  const pinned = tiles.find(t => t.id === pinnedId);
  const placed = pinned ? [clampTile(pinned)] : [];
  const rest = tiles
    .filter(t => t.id !== pinnedId)
    .map(clampTile)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const t of rest) {
    let y = 0;
    while (placed.some(p => collides({ ...t, y }, p))) y += 1;
    placed.push({ ...t, y });
  }
  // Keep the caller's order so React keys/DOM stay stable.
  return tiles.map(t => placed.find(p => p.id === t.id));
}

/** New tile for `url` in the first free spot, scanning rows top-down. */
export function addTile(tiles, url) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  for (let y = 0; ; y += 1) {
    for (let x = 0; x <= COLS - NEW_W; x += 1) {
      const candidate = { id, url, x, y, w: NEW_W, h: NEW_H };
      if (!tiles.some(t => collides(candidate, t))) return [...tiles, candidate];
    }
  }
}

export function rowsUsed(tiles) {
  return tiles.reduce((max, t) => Math.max(max, t.y + t.h), 0);
}
