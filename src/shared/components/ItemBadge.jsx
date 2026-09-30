// Folders and files all share one glyph (folder / page), so a row of them in the
// dock or a collapsed workspace card was a row of identical icons. A small
// initials badge in a per-item color makes each one recognizable at a glance,
// while the glyph itself keeps its type color (yellow folder, grey file).

const BADGE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];

/** Last path segment without extension: "crates/control-plane" → "control-plane". */
function baseName(nameOrPath) {
  const last = String(nameOrPath || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  return last.replace(/\.[a-z0-9]{1,6}$/i, '') || last;
}

/**
 * 1–2 letter initials: first letters of the words ("control-plane" → "CP",
 * "reddit-posts" → "RP"), or the first two letters of a single word
 * ("common" → "Co"), so siblings like common/control-plane still differ.
 */
function itemInitials(nameOrPath) {
  const base = baseName(nameOrPath);
  const words = base.split(/[^a-z0-9]+/i).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || '?';
  return w.length > 1 ? w[0].toUpperCase() + w[1].toLowerCase() : w.toUpperCase();
}

/** Stable color per item, from its path (or name) — same item, same color everywhere. */
function itemColor(key) {
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return BADGE_COLORS[h % BADGE_COLORS.length];
}

/** Initials badge pinned to the bottom-right of a `position: relative` icon. */
export function ItemBadge({ name, path, size = 'sm' }) {
  const fontSize = size === 'md' ? 10 : 9;
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        right: 1,
        bottom: 1,
        minWidth: 14,
        height: 13,
        padding: '0 3px',
        boxSizing: 'border-box',
        borderRadius: 4,
        background: itemColor(path || name),
        color: '#fff',
        fontSize,
        fontWeight: 700,
        lineHeight: '13px',
        textAlign: 'center',
        letterSpacing: 0,
        pointerEvents: 'none',
        boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
      }}
    >
      {/* The path's last segment beats a display name like "web (customer-facing app)". */}
      {itemInitials(path || name)}
    </span>
  );
}
