// Map a search result onto the shape a workspace stores. Workspaces hold two
// kinds of thing — urls[] and apps[] — so every result has to land as one or
// the other, and anything that is neither (a Windows setting, a control-panel
// applet, another workspace) simply isn't addable. Returning null says so;
// the caller reports it rather than silently dropping the click.
export function resultToWorkspaceItem(item) {
    if (!item) return null;
    // A workspace can't be filed into a workspace. It's called out rather than
    // left to the default branch because workspace rows can carry a `url`,
    // which would otherwise quietly add the workspace as a link.
    if (item.type === 'workspace') return null;
    switch (item.type) {
        case 'tab':
        case 'bookmark':
        case 'history':
        case 'url':
            return item.url
                ? { kind: 'url', url: item.url, title: item.title || item.name || item.url, favicon: item.favicon || null }
                : null;
        case 'folder':
            return item.path ? { kind: 'app', name: item.name || item.title, path: item.path, appType: 'folder', icon: null } : null;
        case 'file':
            return item.path ? { kind: 'app', name: item.name || item.title, path: item.path, appType: 'file', icon: null } : null;
        case 'app':
            return item.path
                ? { kind: 'app', name: item.name || item.title, path: item.path, icon: item.icon || null }
                : null;
        default:
            // A bare url with no recognised type still files as a link.
            return item.url
                ? { kind: 'url', url: item.url, title: item.title || item.name || item.url, favicon: item.favicon || null }
                : null;
    }
}
