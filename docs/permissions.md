# Chrome Extension Permission Justifications

This document explains every permission requested in `manifest.json`. It doubles
as the justification text for Chrome Web Store review.

## Single purpose

CoolDesk is a **productivity enhancement extension** that captures and organizes
web content for daily note-taking and workspace management. Its primary function
is to help users collect, categorize, and manage information from their browsing
sessions in an organized workspace environment.

## Required permissions

### `activeTab`
Access the currently active tab to capture selected text and page metadata. Only
accesses the active tab when the user initiates an action.

### `storage`
Store captured notes, workspace data, and user preferences locally. All data is
stored on the user's device.

### `tabs`
Access tab information for workspace organization and tab management features
(cleanup, categorization based on open tabs).

### `tabGroups` / `windows`
Organize tabs into groups and manage workspace windows.

### `sessions`
Access recently closed tabs so users can restore accidentally closed tabs.

### `history`
Enhance workspace organization by analyzing visit patterns, and provide context
for captured content.

### `bookmarks`
Integrate bookmarked content with captured notes and workspace organization.

### `idle`
Detect user idle state to optimize background operations (cleanup, sync) and
reduce resource usage when the user is away.

### `search`
Search through captured notes and workspace content.

### `scripting`
Inject content scripts for text-selection capture and the floating access
button. Scripts only activate on user interaction.

### `alarms`
Schedule periodic background tasks (cleanup, sync) efficiently.

### `commands`
Provide keyboard shortcuts for quick access to extension features.

### `topSites`
Surface frequently visited sites on the new-tab dashboard.

## Host permissions

### `http://*/*` and `https://*/*`
Capture selected text and inject minimal interface elements on any site the user
chooses. Broad host permissions are necessary because users may capture content
from any domain.

## Privacy & security

- **Local storage only** — all captured content and user data is stored locally
  using Chrome's storage API.
- **No external servers** — the extension does not transmit user data to external
  servers by default.
- **User-initiated** — content is captured only when users explicitly select text
  or interact with the extension.
- **Isolated content scripts** — they inject minimal interface elements, with no
  `eval()` or unsafe execution.
