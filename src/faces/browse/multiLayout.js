// Multi view layout: a split tree, like an editor's panes.
//
//   leaf  = { t: 'leaf', id }                     one tab's tile
//   split = { t: 'split', dir, sizes, kids }      dir 'row' = side by side,
//                                                 'col' = stacked; sizes are fr
//
// The tree only decides *where* tiles go. BrowseView keeps every pane a flat
// child of one container and places it absolutely from `layoutRects` — moving
// a pane to another parent element would remount it (the page reloads, the
// terminal loses its shell).

const leaf = (id) => ({ t: 'leaf', id });
const split = (dir, kids, sizes = kids.map(() => 1)) => ({ t: 'split', dir, sizes, kids });

export function leafIds(node, out = []) {
  if (!node) return out;
  if (node.t === 'leaf') out.push(node.id);
  else node.kids.forEach(k => leafIds(k, out));
  return out;
}

// The automatic grid: 1 → full, 2 → side by side, 3–4 → 2×2, 5–6 → 3×2,
// filled column by column (3 tabs: two stacked left, one tall right).
export function defaultLayout(ids) {
  if (!ids.length) return null;
  if (ids.length === 1) return leaf(ids[0]);
  const cols = ids.length <= 4 ? 2 : 3;
  const rows = Math.ceil(ids.length / cols);
  const columns = [];
  for (let i = 0; i < ids.length; i += rows) {
    const chunk = ids.slice(i, i + rows).map(leaf);
    columns.push(chunk.length === 1 ? chunk[0] : split('col', chunk));
  }
  return columns.length === 1 ? columns[0] : split('row', columns);
}

// Drop single-child splits and fold a split into a same-direction parent
// (keeping each tile's share of the space).
function normalize(node) {
  if (!node || node.t === 'leaf') return node;
  const kids = [];
  const sizes = [];
  node.kids.forEach((k, i) => {
    const n = normalize(k);
    if (!n) return;
    if (n.t === 'split' && n.dir === node.dir) {
      const sum = n.sizes.reduce((a, b) => a + b, 0) || 1;
      n.kids.forEach((kk, j) => { kids.push(kk); sizes.push((node.sizes[i] * n.sizes[j]) / sum); });
    } else {
      kids.push(n);
      sizes.push(node.sizes[i]);
    }
  });
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  return { ...node, kids, sizes };
}

/** The tree without tiles whose id isn't in `keep`. */
export function prune(node, keep) {
  const strip = (n) => {
    if (!n) return null;
    if (n.t === 'leaf') return keep.has(n.id) ? n : null;
    const kids = [];
    const sizes = [];
    n.kids.forEach((k, i) => { const s = strip(k); if (s) { kids.push(s); sizes.push(n.sizes[i]); } });
    return kids.length ? { ...n, kids, sizes } : null;
  };
  return normalize(strip(node));
}

/** Rects (fractions of the container) for every tile, plus the dividers. */
export function layoutRects(root) {
  const tiles = new Map();
  const dividers = [];
  const walk = (node, x, y, w, h, path) => {
    if (!node) return;
    if (node.t === 'leaf') { tiles.set(node.id, { x, y, w, h }); return; }
    const row = node.dir === 'row';
    const sum = node.sizes.reduce((a, b) => a + b, 0) || 1;
    const extent = row ? w : h;
    let at = row ? x : y;
    node.kids.forEach((k, i) => {
      const len = (node.sizes[i] / sum) * extent;
      if (row) walk(k, at, y, len, h, [...path, i]);
      else walk(k, x, at, w, len, [...path, i]);
      at += len;
      if (i < node.kids.length - 1) {
        dividers.push(row
          ? { path, index: i, dir: 'row', x: at, y, len: h, extent }
          : { path, index: i, dir: 'col', x, y: at, len: w, extent });
      }
    });
  };
  walk(root, 0, 0, 1, 1, []);
  return { tiles, dividers };
}

function atPath(node, path) {
  return path.reduce((n, i) => n?.kids?.[i], node);
}

function replaceAt(node, path, fn) {
  if (!path.length) return fn(node);
  const [i, ...rest] = path;
  const kids = [...node.kids];
  kids[i] = replaceAt(kids[i], rest, fn);
  return { ...node, kids };
}

export function setSplitSizes(root, path, sizes) {
  return replaceAt(root, path, n => ({ ...n, sizes }));
}

export function evenSplit(root, path) {
  return replaceAt(root, path, n => ({ ...n, sizes: n.sizes.map(() => 1) }));
}

export function splitSizes(root, path) {
  return atPath(root, path)?.sizes || [];
}

export function swapTiles(root, a, b) {
  const walk = (n) => {
    if (n.t === 'leaf') return n.id === a ? leaf(b) : n.id === b ? leaf(a) : n;
    return { ...n, kids: n.kids.map(walk) };
  };
  return walk(root);
}

/**
 * Move tile `src` to the `side` ('left' | 'right' | 'top' | 'bottom') of tile
 * `target`, taking half its space, or of the whole layout when `target` is
 * null. Side 'center' swaps the two tiles.
 */
export function dockTile(root, src, target, side) {
  if (!root || src === target) return root;
  if (side === 'center') return target ? swapTiles(root, src, target) : root;
  const dir = side === 'left' || side === 'right' ? 'row' : 'col';
  const before = side === 'left' || side === 'top';
  const rest = prune(root, new Set(leafIds(root).filter(id => id !== src)));
  if (!rest) return root;
  const pair = (other) => (before ? [leaf(src), other] : [other, leaf(src)]);

  if (!target) {
    // The whole layout's edge: a full-height column / full-width row.
    if (rest.t === 'split' && rest.dir === dir) {
      const sum = rest.sizes.reduce((a, b) => a + b, 0);
      const share = sum / rest.kids.length;
      return {
        ...rest,
        kids: before ? [leaf(src), ...rest.kids] : [...rest.kids, leaf(src)],
        sizes: before ? [share, ...rest.sizes] : [...rest.sizes, share],
      };
    }
    return split(dir, pair(rest), before ? [1, 2] : [2, 1]);
  }

  const walk = (n) => {
    if (n.t === 'leaf') return n.id === target ? split(dir, pair(n)) : n;
    // Beside a tile in a split that already runs this way: become its
    // sibling and take half its share, instead of nesting.
    const i = n.dir === dir ? n.kids.findIndex(k => k.t === 'leaf' && k.id === target) : -1;
    if (i !== -1) {
      const half = n.sizes[i] / 2;
      const kids = [...n.kids];
      const sizes = [...n.sizes];
      kids.splice(before ? i : i + 1, 0, leaf(src));
      sizes.splice(i, 1, half, half);
      return { ...n, kids, sizes };
    }
    return { ...n, kids: n.kids.map(walk) };
  };
  return normalize(walk(rest));
}

/**
 * The saved layout fitted to the tiles on screen now: closed tabs drop out,
 * new ones split the biggest tile along its long side. `aspect` is the
 * container's width / height.
 */
export function reconcile(saved, ids, aspect = 1.6) {
  if (!ids.length) return null;
  let root = saved ? prune(saved, new Set(ids)) : null;
  const have = new Set(leafIds(root));
  for (const id of ids) {
    if (have.has(id)) continue;
    if (!root) { root = leaf(id); continue; }
    const { tiles } = layoutRects(root);
    let best = null;
    let bestArea = -1;
    tiles.forEach((r, tid) => { if (r.w * r.h > bestArea) { bestArea = r.w * r.h; best = tid; } });
    const r = tiles.get(best);
    root = dockTile(root, id, best, r.w * aspect >= r.h ? 'right' : 'bottom');
  }
  return root;
}

/**
 * Where a drop at (fx, fy) — fractions of the container, with `edge` the
 * whole-layout edge the pointer is near, if any — would put tile `src`.
 */
export function hitDock(root, src, fx, fy, edge) {
  if (edge) return { target: null, side: edge };
  const { tiles } = layoutRects(root);
  for (const [id, r] of tiles) {
    if (fx < r.x || fx > r.x + r.w || fy < r.y || fy > r.y + r.h) continue;
    if (id === src) return null;
    const u = (fx - r.x) / r.w;
    const v = (fy - r.y) / r.h;
    const d = { left: u, right: 1 - u, top: v, bottom: 1 - v };
    const side = Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a));
    return { target: id, side: d[side] > 0.25 ? 'center' : side };
  }
  return null;
}
