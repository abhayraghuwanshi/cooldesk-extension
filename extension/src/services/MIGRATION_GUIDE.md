# Localhost Sync Migration Guide

This guide explains how to migrate from direct `extensionApi` usage to the new conditional sync system.

## Overview

The new sync system provides a configurable switch to enable/disable localhost HTTP calls. This allows users to run the extension in standalone mode or with desktop host integration.

## Migration Steps

### 1. Update Imports

**Before:**
```javascript
import { getHostWorkspaces, setHostTabs, enqueueOpenInChrome } from '../services/extensionApi';
```

**After:**
```javascript
import { getHostWorkspaces, setHostTabs, enqueueOpenInChrome } from '../services/conditionalSync';
```

### 2. Files to Update

The following files need their imports updated:

- [x] `src/db.js` - ✅ Already updated
- [ ] `src/App.jsx`
- [ ] `src/background/workspaces.js`
- [ ] `src/background/activity.js`
- [ ] `src/background/bridge.js`
- [ ] `src/hooks/useDashboardData.js`
- [ ] `src/components/CoolFeedSection.jsx`
- [ ] `src/components/CurrentTabsSection.jsx`
- [ ] `src/components/PingsSection.jsx`

### 3. Chrome Extension APIs (Keep Direct)

These imports should remain using `extensionApi` directly:
- `hasChrome, hasRuntime, hasStorage`
- `onMessage, sendMessage`
- `storageGet, storageSet, storageRemove`
- `tabs, windows, openOptionsPage`

### 4. Host Sync APIs (Use Conditional)

These imports should use `conditionalSync`:
- `getHost*` functions (getHostWorkspaces, getHostTabs, etc.)
- `setHost*` functions (setHostWorkspaces, setHostTabs, etc.)  
- `enqueueOpenInChrome, openExternalUrl`
- `getRedirectDecision, focusWindow, getProcesses`

## Configuration

Users can now configure sync settings in the Settings Modal > Sync tab:

### Master Switch
- **Enable Host Sync**: Turn on/off all localhost communication

### Individual Features
- **Sync Workspaces**: Workspace data synchronization
- **Sync Tabs**: Browser tab sharing
- **Sync Activity**: Browsing activity tracking
- **Sync Settings**: Extension settings sync
- **Sync Dashboard**: Dashboard data sync
- **Enable Redirects**: URL redirection capability
- **Enable Host Actions**: Host-initiated browser control

### Host Configuration
- **HTTP URL**: Default `http://127.0.0.1:4000`
- **WebSocket URL**: Default `ws://127.0.0.1:4000`

## Benefits

1. **Privacy Control**: Users can disable localhost sync entirely
2. **Standalone Mode**: Extension works without desktop host
3. **Granular Control**: Enable/disable specific sync features
4. **Error Resilience**: Graceful fallback when host unavailable
5. **Performance**: Skip unnecessary network calls when disabled

## Testing

When sync is disabled, all host sync functions return `{ ok: true, disabled: true }` without making HTTP calls.

## Example Usage

```javascript
import { getSyncStatus, willSyncToHost } from '../services/conditionalSync';

// Check if workspaces will sync to host
if (willSyncToHost('syncWorkspaces')) {
  console.log('Workspaces will sync to desktop app');
}

// Get complete sync status
const status = getSyncStatus();
console.log('Host sync enabled:', status.hostSyncEnabled);
```