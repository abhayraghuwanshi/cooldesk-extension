/**
 * Accent colour for an icon tile, taken from the favicon itself, so a suite
 * tile reads as "the red one" / "the blue one" before its label is read.
 *
 * Only works on a same-origin image (in the extension, Chrome's `_favicon`
 * cache); cross-origin favicon services send no CORS headers, so their pixels
 * can't be read — callers fall back to a neutral tile.
 */

// Dominant, readable accent colour of a loaded favicon, as "r, g, b".
// Pixels are weighted by saturation so a white/grey background or black
// outline doesn't wash out the brand colour; then the result is nudged into
// a lightness range that reads on a dark panel. Returns null when the image
// can't be read (cross-origin) or is essentially monochrome.
export function tintFromImage(img) {
  try {
    const n = 16;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    // Bucket saturated pixels by hue and take the heaviest bucket. Averaging
    // every pixel turns multi-colour logos (Gmail, Meet, Drive) into mud.
    const BUCKETS = 12;
    const acc = Array.from({ length: BUCKETS }, () => ({ r: 0, g: 0, b: 0, w: 0 }));
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      if (max < 40) continue;                        // near-black outline
      const sat = (max - min) / max;
      if (sat < 0.25) continue;                      // white/grey background
      let h;
      if (max === R) h = ((G - B) / (max - min) + 6) % 6;
      else if (max === G) h = (B - R) / (max - min) + 2;
      else h = (R - G) / (max - min) + 4;
      const k = Math.floor((h / 6) * BUCKETS) % BUCKETS;
      const wgt = sat * (max / 255);
      acc[k].r += R * wgt; acc[k].g += G * wgt; acc[k].b += B * wgt; acc[k].w += wgt;
    }
    const top = acc.reduce((a, x) => (x.w > a.w ? x : a), { w: 0 });
    if (top.w < 1) return null;                      // essentially monochrome
    return normaliseTint(top.r / top.w, top.g / top.w, top.b / top.w);
  } catch {
    return null; // tainted canvas
  }
}

function normaliseTint(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const dd = max - min;
    s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
    h = max === r ? (g - b) / dd + (g < b ? 6 : 0) : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    h /= 6;
  }
  if (s < 0.12) return null;              // monochrome icon → keep the neutral tile
  s = Math.min(0.85, Math.max(0.45, s));
  l = Math.min(0.68, Math.max(0.55, l));
  return hslToRgb(h, s, l);
}

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `${f(0)}, ${f(8)}, ${f(4)}`;
}

// No readable icon at all: a stable hue from the hostname, so the monogram
// tile is at least consistent between visits.
export function fallbackTint(host) {
  let hash = 0;
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) | 0;
  return hslToRgb(((hash >>> 0) % 360) / 360, 0.6, 0.62);
}

/**
 * A dark, colourless icon (GitHub's black octocat, many "logo-only" sites)
 * all but disappears on a dark tile. True when the opaque pixels are mostly
 * dark and essentially greyscale — the caller inverts it to light.
 */
export function isDarkMonochrome(img) {
  try {
    const n = 16;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    let opaque = 0, dark = 0, colourful = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      opaque++;
      const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
      if (max < 90) dark++;
      if (max > 0 && (max - min) / max > 0.25 && max > 60) colourful++;
    }
    // An opaque light background (a white square around a dark glyph) is
    // already readable — only a dark glyph on transparency needs help.
    return opaque > 20 && colourful / opaque < 0.05 && dark / opaque > 0.6;
  } catch {
    return false;
  }
}

const cache = new Map(); // src -> { tint, darkMono }

/**
 * Load `src` and analyse it (cached per src): `tint` is "r, g, b" or null,
 * `darkMono` says the icon needs inverting to show on a dark tile.
 */
export function loadIconInfo(src) {
  const none = { tint: null, darkMono: false };
  if (!src) return Promise.resolve(none);
  if (cache.has(src)) return Promise.resolve(cache.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const info = { tint: tintFromImage(img), darkMono: isDarkMonochrome(img) };
      cache.set(src, info);
      resolve(info);
    };
    img.onerror = () => { cache.set(src, none); resolve(none); };
    img.src = src;
  });
}
