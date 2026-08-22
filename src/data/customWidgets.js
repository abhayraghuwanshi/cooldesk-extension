/**
 * User-authored widgets: a single pasted HTML file per widget, rendered in
 * the extension's sandboxed page (widget-sandbox.html). Stored whole in
 * localStorage — widget HTML is a few KB; the widget's own *data* lives in
 * the shared widget IndexedDB under a "c:<id>:" prefix via the host bridge.
 */

const STORAGE_KEY = 'cooldesk-custom-widgets';
export const CUSTOM_ID_PREFIX = 'custom-';

export function isCustomWidgetId(id) {
    return typeof id === 'string' && id.startsWith(CUSTOM_ID_PREFIX);
}

export function loadCustomWidgets() {
    try {
        const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (!Array.isArray(arr)) return [];
        return arr
            .filter(w => w && isCustomWidgetId(w.id) && typeof w.html === 'string')
            .map(w => ({
                id: w.id,
                name: String(w.name || 'Custom widget'),
                desc: String(w.desc || 'Your own widget.'),
                category: 'Custom',
                h: Math.min(480, Math.max(80, Number(w.h) || 180)),
                html: w.html,
                custom: true,
            }));
    } catch {
        return [];
    }
}

function persist(list) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(
            list.map(({ id, name, desc, h, html }) => ({ id, name, desc, h, html }))
        ));
    } catch { /* storage full or unavailable */ }
}

export function saveCustomWidget({ name, h, html }) {
    const entry = {
        id: `${CUSTOM_ID_PREFIX}${Date.now().toString(36)}`,
        name: (name || '').trim() || 'Custom widget',
        desc: 'Your own widget.',
        category: 'Custom',
        h: Math.min(480, Math.max(80, Number(h) || 180)),
        html,
        custom: true,
    };
    persist([...loadCustomWidgets(), entry]);
    return entry;
}

export function deleteCustomWidget(id) {
    persist(loadCustomWidgets().filter(w => w.id !== id));
}

export function renameCustomWidget(id, name) {
    const clean = (name || '').trim();
    if (!clean) return null;
    const list = loadCustomWidgets();
    const idx = list.findIndex(w => w.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], name: clean };
    persist(list);
    return list[idx];
}

/**
 * Prompt the user copies into any AI chat. The contract mirrors what the
 * official widgets rely on (theme tokens, 100vh flex root, cooldesk.store).
 */
export const CUSTOM_WIDGET_PROMPT = `Build me a self-contained widget for my CoolDesk dashboard. Reply with ONE complete HTML file and nothing else (no markdown fences, no explanation).

Hard rules:
- Fully self-contained: inline all CSS and JS. No external scripts, stylesheets, fonts, images or imports.
- Root layout: html,body{margin:0;height:100%} and one <main class="widget"> with height:100vh; box-sizing:border-box; padding:14px 16px; overflow:hidden; display:flex; flex-direction:column; gap:10px.
- Theme: the host sets <html data-theme="dark"> or "light". Use these tokens and support both:
  :root{--bg:#0b0b0e;--fg:#fafafa;--muted:rgba(255,255,255,.45);--faint:rgba(255,255,255,.14);--card:rgba(255,255,255,.05);--accent:#7cb3ff}
  [data-theme=light]{--bg:#f6f6f3;--fg:#141414;--muted:rgba(0,0,0,.5);--faint:rgba(0,0,0,.12);--card:rgba(0,0,0,.045);--accent:#2563eb}
  body{background:var(--bg);color:var(--fg);font-family:ui-sans-serif,system-ui,sans-serif}
- Persistence (if the widget needs to remember anything): use window.cooldesk.store.get(key, fallback) and window.cooldesk.store.set(key, value). Synchronous, JSON-serializable values. Guard with: if (window.cooldesk).
- Network (only if needed): fetch() to public, keyless APIs is fine. Handle failure with a quiet "Offline" state.
- Design language: compact and quiet. Small uppercase letter-spaced labels (font-family:ui-monospace;font-size:10px;letter-spacing:.22em;color:var(--muted)), one big focal value if applicable (font-weight:800), hairline dividers (1px solid var(--faint)), a single accent color. No borders around the page — the host draws the tile.
- It renders about 240-480px wide and TARGET_HEIGHT px tall. Everything must fit without scrolling.

The widget I want: [DESCRIBE IT HERE — what it shows, what's clickable, what it remembers]
Target height: [180] px
`;
