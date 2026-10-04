import { useEffect, useMemo, useState } from 'react';
import { fallbackTint, loadIconInfo } from '../../../utils/iconTint.js';
import { readableTint } from '../../../utils/readableColor.js';

// Icon candidates for a link, most exact first. Used by suite tiles and
// favorites — anything recognised by its icon rather than its text.
//   1. an icon we already have for it (open tab's favIconUrl, a pin's saved one)
//   2. Chrome's favicon cache for that exact page (`favicon` permission) —
//      the only source that tells Docs from Sheets, which share a hostname
//   3. Google's favicon service keyed by the full origin (distinct per
//      subdomain; DuckDuckGo returns the same "G" for every *.google.com).
//      Preferred over the raw file below: it hands back a normalised PNG
//      (GitHub's comes on a white square instead of a black glyph that
//      vanishes on a dark tile). For a site it doesn't know it still *loads*
//      — a 16px grey globe with a 404 status — so it's asked for 64px and
//      anything under 32px counts as a miss (`minWidth`).
//   4. the site's own /favicon.ico — covers what the icon service doesn't
//      know: localhost dev servers, *.vercel.app / *.pages.dev, new domains
// Whatever is left after every source misses renders as a tinted monogram.
function chromeFaviconUrl(pageUrl) {
    try {
        const rt = globalThis.chrome?.runtime;
        if (!rt?.id || !rt.getURL) return null;
        const u = new URL(rt.getURL('/_favicon/'));
        u.searchParams.set('pageUrl', pageUrl);
        u.searchParams.set('size', '64');
        return u.toString();
    } catch {
        return null; // not an extension page
    }
}

function faviconSources({ url, favIconUrl }) {
    const out = [];
    if (favIconUrl && /^(https?:|data:)/.test(favIconUrl)) out.push({ src: favIconUrl });
    if (url) {
        const cached = chromeFaviconUrl(url);
        if (cached) out.push({ src: cached });
    }
    try {
        const u = new URL(url);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
            out.push({ src: `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(u.origin)}&sz=64`, minWidth: 32 });
            out.push({ src: `${u.origin}/favicon.ico` });
        }
    } catch { /* not a url */ }
    const seen = new Set();
    return out.filter(x => !seen.has(x.src) && seen.add(x.src));
}

// The icon box shared by suite tiles and favorites: walks faviconSources()
// on error, and tints itself from the icon's own dominant colour — sampled
// from Chrome's same-origin `_favicon` cache, since the displayed source may
// be cross-origin and unreadable. Without the extension it stays neutral; the
// monogram fallback gets a stable per-host colour.
export function TileIcon({ item, label, children }) {
    const sources = useMemo(() => faviconSources(item), [item.url, item.favIconUrl]); // eslint-disable-line react-hooks/exhaustive-deps
    const [i, setI] = useState(0);
    const [info, setInfo] = useState({ tint: null, darkMono: false });
    const failed = i >= sources.length;
    const chromeSrc = chromeFaviconUrl(item.url);

    useEffect(() => { setI(0); }, [sources]);
    useEffect(() => {
        let alive = true;
        loadIconInfo(chromeSrc).then(x => { if (alive) setInfo(x); });
        return () => { alive = false; };
    }, [chromeSrc]);

    let host = '';
    try { host = new URL(item.url).hostname; } catch { /* keep '' */ }
    const tint = info.tint;
    // Every local dev server is "localhost" — colour its monogram by name instead.
    const local = !host || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
    // The monogram is text on its own tinted tile, so it gets a contrast-checked
    // version of the tint (--tint-text); the tile background keeps the raw one.
    const fallback = failed ? fallbackTint((local ? label : host) || '?') : null;
    const style = fallback ? { '--tint': fallback, '--tint-text': readableTint(fallback) } : tint ? { '--tint': tint } : undefined;
    // Inversion is only known for the same-origin Chrome cache copy, so only
    // applied when that's the one on screen.
    const invert = !failed && info.darkMono && sources[i].src === chromeSrc;
    return (
        <div className="suite-tile-icon" style={style}>
            {failed
                ? <span className="suite-tile-fallback">{(label || host || '?').charAt(0).toUpperCase()}</span>
                : <img
                    src={sources[i].src}
                    alt=""
                    className={`suite-tile-img${invert ? ' is-inverted' : ''}`}
                    onError={() => setI(n => n + 1)}
                    onLoad={e => { if (e.currentTarget.naturalWidth < (sources[i].minWidth || 0)) setI(n => n + 1); }}
                />}
            {children}
        </div>
    );
}

