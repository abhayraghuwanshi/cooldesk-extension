// A short "what's open in this app right now" label — the code editor's
// active file, a browser's active tab title, etc. — derived from the running
// window's title vs. its process name. Shared by GlobalSpotlight's own
// recommendations list and ContextItem's compact pill, so both describe a
// running app identically.
export function getRunningAppContext(app) {
    const title = (app?.title || '').trim();
    const appName = (app?.name || '').trim();
    if (!title) return null;

    const normalizedApp = appName.toLowerCase().replace(/\.exe$/i, '');
    const isEditor = ['code', 'vscode', 'visual studio code', 'cursor', 'windsurf', 'zed'].some(key =>
        normalizedApp.includes(key)
    );

    if (isEditor) {
        const parts = title.split(/\s[-–—]\s/).map(part => part.trim()).filter(Boolean);
        const editorSuffixes = new Set([
            'visual studio code',
            'code',
            'cursor',
            'windsurf',
            'zed'
        ]);

        while (parts.length > 0 && editorSuffixes.has(parts[parts.length - 1].toLowerCase())) {
            parts.pop();
        }

        if (parts.length >= 2) return parts[parts.length - 1];
        if (parts.length === 1 && parts[0].toLowerCase() !== title.toLowerCase()) return parts[0];
    }

    return title !== appName ? title : null;
}
