/**
 * Readable text on user-tinted surfaces (accent cards, columns, widget tiles,
 * favicon-tinted icon tiles), measured with APCA via colorjs.io instead of
 * hand-picked opacities.
 *
 * The surfaces all follow one grammar: the accent mixed at ~10–24% over a
 * dark glass base (or a light one in the white theme). `accentTextVars`
 * works out that effective background and returns CSS vars for it:
 *
 *   --card-text-1/2/3        primary / secondary / muted text, as white (or
 *                            black) at the lowest alpha that still reads
 *   --card-accent-text       the accent itself, lightened/darkened in OKLCH
 *                            until it reads as text (keeps its hue)
 *
 * plus `-light` twins of each for the light theme. CSS maps them onto the
 * theme's --text-* tokens inside .has-accent scopes (see cooldesk.css).
 */
import Color from 'colorjs.io';

// APCA Lc targets (absolute value). ~90 primary text, ~60 secondary/labels,
// ~45 large or non-essential text.
const LC = { primary: 90, secondary: 60, muted: 45, accent: 60 };

const DARK_BASE = '#10141f';
const LIGHT_BASE = '#eceef3';

const cache = new Map();

function lc(bg, fg) {
  return Math.abs(bg.contrast(fg, 'APCA'));
}

// Lowest alpha of `ink` over `bg` reaching `target` Lc (1 if it never does).
function minAlpha(bg, ink, target) {
  if (lc(bg, ink) < target) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (lc(bg, bg.mix(ink, mid, { space: 'srgb' })) >= target) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi * 100) / 100;
}

// Accent nudged in OKLCH lightness (away from the background) until it
// reaches `target` Lc. Hue and chroma are kept, so it still reads as "the
// blue one", just a blue you can read.
function readableAccent(bg, accent, target) {
  const towardLight = bg.to('oklch').l < 0.6;
  const c = accent.to('oklch');
  const step = towardLight ? 0.02 : -0.02;
  for (let i = 0; i < 50 && lc(bg, c) < target; i++) {
    const l = c.l + step;
    if (l <= 0 || l >= 1) break;
    c.l = l;
  }
  return c.to('srgb').toGamut().toString({ format: 'hex' });
}

function textSet(bg, forceLight = false) {
  const white = new Color('#ffffff');
  const black = new Color('#000000');
  const ink = forceLight || lc(bg, white) >= lc(bg, black) ? white : black;
  const rgb = ink === white ? '255, 255, 255' : '0, 0, 0';
  const a = (t) => `rgba(${rgb}, ${minAlpha(bg, ink, t)})`;
  return [a(LC.primary), a(LC.secondary), a(LC.muted)];
}

/**
 * CSS custom properties for a surface tinted with `accent` (hex) at `mix`
 * (0–1) over the dark glass base. Returns {} for no accent / unparsable.
 */
export function accentTextVars(accent, mix = 0.18) {
  if (!accent) return {};
  const key = `${accent}|${mix}`;
  if (cache.has(key)) return cache.get(key);
  let vars = {};
  try {
    const acc = new Color(accent);
    const out = (base, suffix) => {
      const bg = new Color(base).mix(acc, mix, { space: 'srgb' });
      const [t1, t2, t3] = textSet(bg);
      vars[`--card-text-1${suffix}`] = t1;
      vars[`--card-text-2${suffix}`] = t2;
      vars[`--card-text-3${suffix}`] = t3;
      vars[`--card-accent-text${suffix}`] = readableAccent(bg, acc, LC.accent);
    };
    out(DARK_BASE, '');
    out(LIGHT_BASE, '-light');
  } catch {
    vars = {};
  }
  cache.set(key, vars);
  return vars;
}

/**
 * A favicon tint ("r, g, b", see iconTint.js) made readable as text on its
 * own icon tile (tint at ~16% over the dark panel). Returns "r, g, b".
 */
export function readableTint(tint) {
  if (!tint) return tint;
  const key = `tint|${tint}`;
  if (cache.has(key)) return cache.get(key);
  let out = tint;
  try {
    const acc = new Color(`rgb(${tint})`);
    const bg = new Color(DARK_BASE).mix(acc, 0.16, { space: 'srgb' });
    const c = new Color(readableAccent(bg, acc, LC.accent));
    out = c.coords.map(v => Math.round(v * 255)).join(', ');
  } catch { /* keep the raw tint */ }
  cache.set(key, out);
  return out;
}

/**
 * Colorless columns (see .is-colorless in cooldesk.css): a dark slab at the
 * user's darkness slider over the wallpaper, with no blur. Readability depends
 * on what's behind it, so measure the real stack —
 *   black page → wallpaper at --wallpaper-opacity → rgba(11,11,14, panel)
 * — against the wallpaper's bright areas (`wallColor`, from
 * sampleWallpaper), and return text vars plus --legibility-shadow (0–1): how
 * much text-shadow the text needs on top, since a halo is the only thing that
 * helps text with hardcoded colours too.
 */
export function colorlessTextVars(wallColor, wallOpacity, panelOpacity) {
  const key = `cl|${wallColor}|${wallOpacity}|${panelOpacity}`;
  if (cache.has(key)) return cache.get(key);
  let vars = {};
  try {
    const backdrop = new Color('#000000').mix(new Color(wallColor), wallOpacity, { space: 'srgb' });
    const bg = backdrop.mix(new Color('#0b0b0e'), panelOpacity, { space: 'srgb' });
    // Always light ink: much of the overview's text is hardcoded light, so
    // flipping just the tokens to black would leave the column half-and-half.
    // Where white can't reach the target it stays at full alpha and the
    // shadow below makes up the rest.
    const [t1, t2, t3] = textSet(bg, true);
    const white = lc(bg, new Color('#ffffff'));
    // Two reasons text needs a halo: the stack is too bright (Lc 100+ needs
    // none, by ~55 it's full), or a lot of unblurred wallpaper detail shows
    // through it (wallpaper opacity × how see-through the slab is) — busy
    // texture hurts even when the average is dark, which APCA can't see.
    const fromContrast = (100 - white) / 45;
    const fromTexture = wallOpacity * (1 - panelOpacity) * 1.6;
    const shadow = Math.min(1, Math.max(0, fromContrast, fromTexture));
    vars = {
      '--card-text-1': t1,
      '--card-text-2': t2,
      '--card-text-3': t3,
      '--legibility-shadow': shadow.toFixed(2),
    };
  } catch { /* leave the CSS defaults */ }
  cache.set(key, vars);
  return vars;
}

const wallCache = new Map(); // url -> Promise<{ bright, tint } | null>

/**
 * Two colours from the wallpaper, as hex:
 *  - bright: its bright areas — the 85th-percentile pixel by OKLCH lightness,
 *    i.e. what light text has to beat in most of the image, not its (much
 *    darker) average.
 *  - tint: its overall hue for the glass to pick up, like macOS's wallpaper
 *    tinting in windows — the OKLab average, pushed down to a dark, muted
 *    tone (L 0.3, chroma ≤ 0.05) so it reads as a hint, never a colour wash.
 * null when the image can't be read: canvas pixel access needs CORS, which
 * Unsplash sends but arbitrary custom URLs may not.
 */
export function sampleWallpaper(url) {
  if (!url) return Promise.resolve(null);
  if (wallCache.has(url)) return wallCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const n = 32;
        const c = document.createElement('canvas');
        c.width = c.height = n;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, n, n);
        const d = ctx.getImageData(0, 0, n, n).data;
        const px = [];
        let A = 0, B = 0;
        for (let i = 0; i < d.length; i += 4) {
          const col = new Color('srgb', [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]);
          const [l, a, b] = col.to('oklab').coords;
          A += a; B += b;
          px.push({ l, col });
        }
        px.sort((x, y) => x.l - y.l);
        const bright = px[Math.floor(px.length * 0.85)].col.toString({ format: 'hex' });
        const avg = new Color('oklab', [0.3, A / px.length, B / px.length]).to('oklch');
        avg.c = Math.min(avg.c || 0, 0.05);
        const tint = avg.to('srgb').toGamut().toString({ format: 'hex' });
        resolve({ bright, tint });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  wallCache.set(url, p);
  return p;
}
