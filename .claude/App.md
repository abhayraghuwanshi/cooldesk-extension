# CoolDesk - Application Architecture

## Overview

CoolDesk is a productivity desktop application that combines browser tab management, app launching, workspace organization, and AI-powered search into a unified experience. It runs as both an Electron desktop app and a Chrome extension.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **UI Framework** | React 19.1.1 |
| **Desktop Runtime** | Electron 33.3.1, Tauri 2.x (alternative) |
| **Build Tool** | Vite 7.1.2 |
| **Database** | IndexedDB (cooldesk-unified-db, v8) |
| **Search** | Fuse.js, FlexSearch |
| **Collaboration** | Yjs (CRDT), y-webrtc |
| **Local AI** | node-llama-cpp 3.0.0 |
| **Icons** | FontAwesome 7.x |

---

## Project Structure

```
extension/
├── electron-main.js          # Main process (IPC, app discovery, windows)
├── electron-preload.js       # Secure IPC bridge to renderer
├── index.html                # Entry point
│
├── src/
│   ├── App.jsx               # Main React component
│   ├── spotlight-main.jsx    # Spotlight entry point
│   │
│   ├── components/
│   │   ├── GlobalSpotlight.jsx    # Command palette (Alt+K)
│   │   ├── cooldesk/
│   │   │   ├── TabManagement.jsx  # Tab grouping & sync
│   │   │   ├── TabCard.jsx        # Tab/App card components
│   │   │   └── ...
│   │   └── ...
│   │
│   ├── services/
│   │   ├── searchService.js       # Federated search
│   │   ├── syncOrchestrator.js    # Browser ↔ Electron sync
│   │   ├── extensionApi.js        # Cross-env API abstraction
│   │   └── ...
│   │
│   ├── db/
│   │   ├── unified-db.js          # IndexedDB schema
│   │   ├── unified-api.js         # CRUD operations
│   │   └── ...
│   │
│   └── background/
│       ├── background.js          # Extension background script
│       └── searchIndexer.js       # Search indexing
│
├── AppScanner.exe            # Windows app discovery (C#)
├── AppFocus.exe              # Window focus utility
└── BrowserFocus.exe          # Browser tab focus utility
```

---

## Core Features

### 1. Spotlight (GlobalSpotlight.jsx)

**Purpose:** Quick app launcher and universal search (Alt+K)

**How it works:**
1. User presses Alt+K → Spotlight window appears
2. `refreshElectronCache()` loads fresh data
3. User types → 50ms debounce → search executes
4. Results from: installed apps, running apps, tabs, workspaces, bookmarks
5. LRU cache (100 entries) for instant repeated queries

**Key files:**
- [src/components/GlobalSpotlight.jsx](../src/components/GlobalSpotlight.jsx)
- [src/services/searchService.js](../src/services/searchService.js)

**Data flow:**
```
User types → debounce(50ms) → searchElectronCache() → results
                                    ↓
                         electronDataCache (in-memory)
                                    ↓
                    [tabs, runningApps, installedApps, workspaces]
```

---

### 2. App Discovery (electron-main.js)

**Purpose:** Detect installed and running applications

#### Installed Apps
- **Windows:** AppScanner.exe scans registry + Program Files
- **macOS:** Scans /Applications directory
- **Linux:** Parses .desktop files

**Cache:** 24-hour TTL, persisted to `installed-apps-cache.json`

#### Running Apps
- **Windows:** PowerShell + Win32 API (EnumWindows)
- **macOS:** osascript + ps
- **Linux:** wmctrl / ps-list

**Cache:** 5-second TTL (dynamic data)

#### Icon Cache
- In-memory Map + disk persistence (`icon-cache.json`)
- Icons fetched via `app.getFileIcon()` or from AppScanner.exe
- Prevents re-fetching on every search

**Key functions:**
```javascript
getInstalledApps()        // Returns cached or fresh installed apps
getRunningApps()          // Returns currently running apps
getInstalledAppsWindows() // Windows-specific scanning
fetchIconsForApps(apps)   // Batch icon fetching with cache
```

---

### 3. Tab Management (TabManagement.jsx)

**Purpose:** Display, group, and manage browser tabs

**Features:**
- Auto-grouping by domain
- Smart sorting (by recency, focus time, interactions)
- Focus mode (show only relevant tabs)
- Real-time sync with browser

**Data sources:**
- **Electron:** `window.electronAPI.getTabs()` via IPC
- **Extension:** `chrome.tabs.query({})`

**Components:**
- `TabCard` - Individual tab display
- `AppCard` - Running app display (uses `app.icon` property)
- `TabGroupCard` - Grouped tabs by domain

**Key files:**
- [src/components/cooldesk/TabManagement.jsx](../src/components/cooldesk/TabManagement.jsx)
- [src/components/cooldesk/TabCard.jsx](../src/components/cooldesk/TabCard.jsx)

---

### 4. Search Service (searchService.js)

**Purpose:** Federated search across all data sources

**Cache TTLs:**
| Data Type | TTL |
|-----------|-----|
| tabs | 5 seconds |
| runningApps | 5 seconds |
| workspaces | 60 seconds |
| installedApps | 24 hours |
| history | 2 minutes |
| bookmarks | 5 minutes |

**Search flow:**
```javascript
quickSearch(query)
  ↓
isElectron() ? searchElectronCache() : searchLocalIndex()
  ↓
deduplicateByUrl() → sort by score → slice(0, maxResults)
```

**Key functions:**
```javascript
refreshElectronCache(force)  // Refresh stale caches
searchElectronCache(query)   // In-memory search
isCacheFresh(type)           // Check if cache is valid
```

---

### 5. Sync Orchestrator (syncOrchestrator.js)

**Purpose:** Bidirectional sync between browser extension and Electron

**Sync modes:**
1. **IPC Sync** - Direct Electron IPC (fastest)
2. **HTTP Sync** - Extension → Electron via localhost
3. **WebSocket Sync** - Real-time event subscription

**Data synced:**
- Workspaces, URLs, workspace_urls
- Notes, pins, settings
- Daily memory, activity

**Change detection:**
- Hash-based comparison prevents sync loops
- 5-second debounce on pushes
- `isApplyingRemoteUpdate` flag prevents echo

---

## IPC API Reference

### Electron → Renderer (electron-preload.js)

**App Discovery:**
```javascript
window.electronAPI.getRunningApps()     // Get running apps with icons
window.electronAPI.getInstalledApps()   // Get installed apps with icons
window.electronAPI.focusApp(pid)        // Focus app by PID
window.electronAPI.launchApp(path)      // Launch app by path
```

**Tabs:**
```javascript
window.electronAPI.getTabs()            // Get synced browser tabs
window.electronAPI.subscribe('tabs-updated', callback)
```

**Data:**
```javascript
window.electronAPI.getWorkspaces()
window.electronAPI.setWorkspaces(data)
window.electronAPI.getSettings()
window.electronAPI.setSettings(data)
```

**Messages:**
```javascript
window.electronAPI.sendMessage({ type: 'SEARCH_APPS', query: '...' })
window.electronAPI.sendMessage({ type: 'JUMP_TO_TAB', tabId: 123 })
```

---

## Database Schema (IndexedDB)

**Database:** `cooldesk-unified-db` (version 8)

**Stores:**
| Store | Purpose |
|-------|---------|
| WORKSPACES | Workspace definitions |
| WORKSPACE_URLS | URL memberships |
| NOTES | Standalone notes |
| URL_NOTES | URL-attached notes |
| PINS | Pinned items |
| ACTIVITY_SERIES | Raw activity (48h) |
| DAILY_ANALYTICS | Aggregated stats |
| SETTINGS | App settings |
| DASHBOARD | Dashboard layout |

---

## Caching Strategy

### In-Memory Caches

| Cache | Location | TTL | Purpose |
|-------|----------|-----|---------|
| `electronDataCache` | searchService.js | Varies | Search data |
| `iconCache` | electron-main.js | Session | App icons |
| `installedAppsCache` | electron-main.js | 24h | Installed apps |
| `searchCache` (LRU) | GlobalSpotlight.jsx | Session | Search results |

### Disk Caches

| File | Location | Purpose |
|------|----------|---------|
| `installed-apps-cache.json` | userData | Installed apps |
| `icon-cache.json` | userData | App icons |

### Cache Invalidation

- **TTL expiration** - Automatic refresh when stale
- **Version bump** - `INSTALLED_APPS_CACHE_VERSION` forces refresh
- **Force refresh** - `refreshElectronCache(true)`

---

## Common Issues & Fixes

### Apps not showing in Spotlight
1. Check `installedAppsCache` is populated
2. Verify `AppScanner.exe` runs without errors
3. Check cache version (`INSTALLED_APPS_CACHE_VERSION`)
4. Look for timeout issues (10s timeout for getInstalledApps)

### Icons not loading
1. Check `iconCache` Map has entries
2. Verify `icon-cache.json` exists in userData
3. Ensure `fetchIconsForApps()` preserves existing icons
4. Check `app.getFileIcon()` succeeds

### Tab sync not working
1. Check WebSocket connection to Electron
2. Verify `syncOrchestrator.init()` completed
3. Look for debounce delays (2-7 seconds)
4. Check `tabs-updated` IPC event fires

### Search returns empty
1. Check `electronDataCache` state in console
2. Verify `refreshElectronCache()` completes
3. Check timeout values (was 3s, now 10s)
4. Ensure IPC handlers are registered

---

## Key Configuration

### Timeouts
```javascript
// searchService.js
getInstalledApps timeout: 10000ms
getRunningApps timeout: 1000ms
getTabs timeout: 1000ms

// electron-main.js
AppScanner.exe timeout: 10000ms
PowerShell timeout: 15000ms
```

### Cache TTLs
```javascript
INSTALLED_APPS_CACHE_TTL = 24 * 60 * 60 * 1000  // 24 hours
CACHE_TTL.tabs = 5000                            // 5 seconds
CACHE_TTL.runningApps = 5000                     // 5 seconds
```

---

## Build Commands

```bash
npm run dev              # Vite dev server
npm run dev:electron     # Electron + Vite
npm run build            # Production build
npm run build:electron   # Electron production
npm run tauri dev        # Tauri development
npm run tauri build      # Tauri production
```

---

## File Quick Reference

| What | Where |
|------|-------|
| Main process | [electron-main.js](../electron-main.js) |
| IPC bridge | [electron-preload.js](../electron-preload.js) |
| Spotlight UI | [src/components/GlobalSpotlight.jsx](../src/components/GlobalSpotlight.jsx) |
| Tab management | [src/components/cooldesk/TabManagement.jsx](../src/components/cooldesk/TabManagement.jsx) |
| Search service | [src/services/searchService.js](../src/services/searchService.js) |
| Sync logic | [src/services/syncOrchestrator.js](../src/services/syncOrchestrator.js) |
| Database API | [src/db/unified-api.js](../src/db/unified-api.js) |
| Extension background | [src/background/background.js](../src/background/background.js) |
