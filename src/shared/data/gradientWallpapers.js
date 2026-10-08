/**
 * Gradient wallpapers — soft overlapping colour fields in the spirit of
 * Safari's start-page backgrounds.
 *
 * Each one is a small SVG built here and handed around as a data: URI, so it
 * slots into the same `--wallpaper-url` / picker / rotation plumbing as the
 * Unsplash photos: no network, nothing to bundle, sharp at any resolution
 * (the page paints it with background-size: cover, and the SVG slices to
 * fill). A blob is a radial gradient fading to transparent; stacking a few
 * over a base colour gives the mesh look. A faint grain keeps the long
 * smooth ramps from banding on 8-bit displays.
 */

const W = 1600;
const H = 1000;

// [cx, cy, rx, ry, color, rotation?] — positions in the 1600×1000 box.
const PRESETS = [
    {
        name: 'Sonoma Dusk',
        base: '#1b1035',
        blobs: [
            [250, 850, 900, 650, '#ff5f6d'],
            [1350, 900, 800, 600, '#ffb347'],
            [1300, 150, 850, 600, '#5b6cff'],
            [400, 100, 700, 500, '#b04bff'],
        ],
    },
    {
        name: 'Peach Bloom',
        base: '#f6c6b8',
        blobs: [
            [200, 200, 800, 600, '#ff9a8b'],
            [1400, 250, 800, 650, '#fcd5a8'],
            [900, 950, 1000, 600, '#c8a2f0'],
            [1500, 950, 600, 500, '#ff6f91'],
        ],
    },
    {
        name: 'Lagoon',
        base: '#04263f',
        blobs: [
            [300, 300, 900, 650, '#00c6c2'],
            [1300, 800, 900, 650, '#0072ff'],
            [1450, 150, 600, 450, '#7af5d8'],
            [500, 950, 700, 450, '#123c8c'],
        ],
    },
    {
        name: 'Aurora',
        base: '#071a1f',
        blobs: [
            [350, 700, 1000, 450, '#1de9b6', -18],
            [1200, 350, 900, 420, '#7c4dff', -18],
            [800, 100, 700, 300, '#00b0ff', -10],
            [1450, 900, 600, 400, '#1b5e20'],
        ],
    },
    {
        name: 'Citrus',
        base: '#ff8a3d',
        blobs: [
            [250, 150, 900, 600, '#ffe259'],
            [1400, 300, 800, 600, '#ff5e62'],
            [700, 950, 900, 550, '#ffa751'],
            [1500, 1000, 600, 450, '#ff3c8e'],
        ],
    },
    {
        name: 'Midnight Iris',
        base: '#070b24',
        blobs: [
            [1200, 850, 900, 600, '#3d2bd6'],
            [300, 250, 800, 550, '#8e2de2'],
            [1450, 150, 500, 380, '#00d2ff'],
            [200, 950, 600, 400, '#1a237e'],
        ],
    },
    {
        name: 'Rose Quartz',
        base: '#e9d5f2',
        blobs: [
            [300, 800, 850, 600, '#f7a8c4'],
            [1300, 200, 900, 600, '#b8c6ff'],
            [1400, 950, 700, 500, '#ffd1dc'],
            [400, 100, 600, 420, '#d7b4f3'],
        ],
    },
    {
        name: 'Ember',
        base: '#1a0505',
        blobs: [
            [300, 900, 900, 600, '#ff3d00'],
            [1300, 700, 850, 600, '#d50000'],
            [1200, 100, 700, 450, '#ff9100'],
            [200, 150, 500, 380, '#6a1b1b'],
        ],
    },
    {
        name: 'Glacier',
        base: '#cfe6ff',
        blobs: [
            [250, 250, 850, 600, '#8ec5ff'],
            [1350, 300, 800, 600, '#e0f2ff'],
            [800, 950, 1000, 550, '#6aa8ff'],
            [1500, 900, 500, 400, '#b5fffc'],
        ],
    },
    {
        name: 'Graphite Glow',
        base: '#121317',
        blobs: [
            [1300, 200, 800, 550, '#3a4a7a'],
            [300, 850, 850, 550, '#4a3a6a'],
            [900, 500, 600, 400, '#2a2d38'],
        ],
    },
];

function buildSvg({ base, blobs }) {
    const defs = blobs.map(([, , , , color], i) => (
        `<radialGradient id="b${i}"><stop offset="0" stop-color="${color}"/>`
        + `<stop offset=".45" stop-color="${color}" stop-opacity=".55"/>`
        + `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`
    )).join('');
    const shapes = blobs.map(([cx, cy, rx, ry, , rot = 0], i) => (
        `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#b${i})"`
        + (rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : '') + '/>'
    )).join('');
    const grain = '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch"/>'
        + '<feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .05 0"/></filter>';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">`
        + `<defs>${defs}${grain}</defs>`
        + `<rect width="${W}" height="${H}" fill="${base}"/>${shapes}`
        + `<rect width="${W}" height="${H}" filter="url(#n)"/></svg>`;
}

// Fully escaped — no raw quotes, spaces or parens — because these URIs get
// wrapped in url(...) unquoted (picker thumbnails) and parsed back out of
// url("...") with a non-greedy regex (readWallpaper in OverviewDashboard).
function toDataUri(svg) {
    return 'data:image/svg+xml,' + encodeURIComponent(svg)
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/'/g, '%27');
}

export const GRADIENT_WALLPAPERS = PRESETS.map((p, i) => {
    const url = toDataUri(buildSvg(p));
    return { id: `gradient-${i + 1}`, name: p.name, url, thumbnail: url, category: 'gradient' };
});
