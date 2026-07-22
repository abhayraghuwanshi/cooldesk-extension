// Edge salience for the knowledge graph.
//
// The backend emits one edge per co-occurring pair, weighted by raw
// co-occurrence count. That measure rewards whatever is *always* open:
// github.com, Explorer and Windows Terminal end up linked to ~half the graph,
// so every layout collapses into one knot and no edge tells you anything.
//
// Two passes fix that:
//   1. Normalize by base rate — divide by sqrt(deg(a) * deg(b)), the cosine /
//      Adamic form. An edge only scores high if the pair co-occurs more than
//      their individual popularity already explains.
//   2. Sparsify — keep each node's top-K strongest edges. Hubs keep their K most
//      distinctive links instead of 70 indiscriminate ones; leaf nodes keep
//      everything they have, so nothing is orphaned.
//
// Structural edges (workspace membership) are never scored or dropped: they are
// facts the user entered, not findings, and they carry no information to rank.

/** Edges that state membership rather than measure association. */
export const STRUCTURAL_EDGE_TYPES = new Set([
  'url_in_workspace',
  'app_in_workspace',
  'folder_in_workspace',
  'file_in_workspace',
  'shared_resource',
]);

const idOf = x => (typeof x === 'object' && x !== null ? x.id : x);

/**
 * Score and sparsify a link list.
 *
 * Adds `salience` (0..1, comparable across edge types) to every returned link
 * and drops associative edges that no endpoint considers important.
 *
 * @param {Array} links   raw links, each { source, target, type, weight }
 * @param {object} [opts]
 * @param {number} [opts.topK=4]      edges kept per node
 * @param {number} [opts.minSalience] absolute floor applied after normalization
 * @param {number} [opts.smoothing]   damping added to each degree (see below)
 * @returns {Array} kept links, each with a `salience` field
 */
export function sparsifyLinks(
  links,
  { topK = 4, minSalience = 0.02, smoothing = 8 } = {}
) {
  if (!Array.isArray(links) || links.length === 0) return [];

  const structural = [];
  const assoc = [];
  for (const l of links) {
    (STRUCTURAL_EDGE_TYPES.has(l.type) ? structural : assoc).push(l);
  }
  if (assoc.length === 0) {
    return structural.map(l => ({ ...l, salience: 1 }));
  }

  // Degree over associative edges only — membership edges say nothing about
  // how "busy" a node genuinely is.
  const degree = new Map();
  for (const l of assoc) {
    const s = idOf(l.source), t = idOf(l.target);
    degree.set(s, (degree.get(s) || 0) + 1);
    degree.set(t, (degree.get(t) || 0) + 1);
  }

  // `smoothing` damps the low-degree spike: without it a pair that co-occurred
  // twice and appears nowhere else scores a perfect 1.0 purely because its
  // denominator is tiny. Adding a constant to both degrees means a pair has to
  // clear a real evidence bar before it can outrank a well-attested link.
  const scored = assoc.map(l => {
    const s = idOf(l.source), t = idOf(l.target);
    const norm = Math.sqrt(
      ((degree.get(s) || 1) + smoothing) * ((degree.get(t) || 1) + smoothing)
    );
    return { link: l, s, t, raw: (l.weight || 0) / norm };
  });

  // Rescale to 0..1 so `salience` means the same thing regardless of how large
  // this particular graph is.
  const maxRaw = scored.reduce((m, e) => Math.max(m, e.raw), 0) || 1;
  for (const e of scored) e.salience = e.raw / maxRaw;

  // Per-node top-K: an edge survives if EITHER endpoint ranks it highly. Using
  // "either" rather than "both" keeps the graph connected — mutual-kNN shatters
  // it into islands at this density.
  const byNode = new Map();
  for (const e of scored) {
    if (!byNode.has(e.s)) byNode.set(e.s, []);
    if (!byNode.has(e.t)) byNode.set(e.t, []);
    byNode.get(e.s).push(e);
    byNode.get(e.t).push(e);
  }
  const keep = new Set();
  for (const edges of byNode.values()) {
    edges.sort((a, b) => b.salience - a.salience);
    for (let i = 0; i < Math.min(topK, edges.length); i++) {
      if (edges[i].salience >= minSalience) keep.add(edges[i]);
    }
  }

  return [
    ...structural.map(l => ({ ...l, salience: 1 })),
    ...[...keep].map(e => ({ ...e.link, salience: e.salience })),
  ];
}

/**
 * Link count per node id, over the links actually being displayed.
 * This is the honest "N links" the tooltip has always claimed to show — the
 * backend `weight` field means something different for each node type and is
 * flat 0 for nodes that only ever appeared in a co-occurrence pair.
 */
export function computeDegrees(links) {
  const deg = new Map();
  for (const l of links || []) {
    const s = idOf(l.source), t = idOf(l.target);
    deg.set(s, (deg.get(s) || 0) + 1);
    deg.set(t, (deg.get(t) || 0) + 1);
  }
  return deg;
}
