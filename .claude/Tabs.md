# CoolDesk Extension - Tab Management System Documentation

## Overview

The Tab Management system provides intelligent browser tab organization, automatic grouping by domain, real-time updates, and auto-cleanup features to prevent tab overload.

---

## Architecture

```
Tab Management System
├── TabManagement (Main UI Component)
│   ├── TabCard (Individual Tab Display)
│   └── TabGroupCard (Domain-grouped Tabs)
├── Background Service (tabCleanup.js)
│   ├── Auto-cleanup Logic
│   ├── Protected Tab Rules
│   └── Tab Grouping Service
└── Chrome APIs
    ├── chrome.tabs
    ├── chrome.tabGroups
    └── chrome.alarms
```

---

## Components

### 1. TabManagement Component

**Location:** [src/components/cooldesk/TabManagement.jsx](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/TabManagement.jsx)

#### Purpose
Main tab management interface with real-time tab display, domain grouping, and auto-group toggle.

#### Key Features
- **Real-time Updates**: Event-driven tab list updates
- **Domain Grouping**: Automatic grouping by hostname
- **Auto-group Toggle**: Enable/disable automatic tab grouping
- **Pinned Tabs Section**: Dedicated section for pinned tabs
- **Lazy Loading**: "Load More" button for large tab counts
- **Debounced Refresh**: 300ms debounce to prevent excessive updates

#### State Management

```javascript
{
  tabs: Array,              // All browser tabs
  tabsLoading: Boolean,     // Loading state
  expandedDomain: String,   // Currently expanded domain group
  autoGroupEnabled: Boolean,// Auto-group feature state
  visibleTabsCount: Number  // Pagination (default: 12)
}
```

#### Real-time Event Listeners

```javascript
// Listens to all tab events
const events = [
  chrome.tabs.onCreated,
  chrome.tabs.onUpdated,
  chrome.tabs.onRemoved,
  chrome.tabs.onActivated,
  chrome.tabs.onMoved,
  chrome.tabs.onDetached,
  chrome.tabs.onAttached
];

// Debounced refresh (300ms)
events.forEach(event => {
  event.addListener(debouncedRefresh);
});
```

#### Tab Sorting

```javascript
// Sort order: Active first, then by window + index
tabs.sort((a, b) => {
  if (a.active && !b.active) return -1;
  if (!a.active && b.active) return 1;
  if (a.windowId !== b.windowId) return a.windowId - b.windowId;
  return a.index - b.index;
});
```

#### Domain Grouping

```javascript
const tabsByDomain = () => {
  const grouped = {};
  tabs.forEach(tab => {
    const url = new URL(tab.url);
    const domain = url.hostname;
    if (!grouped[domain]) grouped[domain] = [];
    grouped[domain].push(tab);
  });
  return grouped;
};
```

#### Auto-group Toggle

```javascript
// Send message to background service
const toggleAutoGroup = async () => {
  const response = await chrome.runtime.sendMessage({
    type: 'TOGGLE_AUTO_GROUP',
    enabled: !autoGroupEnabled
  });
  
  if (response?.success) {
    setAutoGroupEnabled(!autoGroupEnabled);
    refreshTabs();
  }
};
```

---

### 2. TabCard Component

**Location:** [src/components/cooldesk/TabCard.jsx](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/TabCard.jsx)

#### Purpose
Individual tab display card with actions (click, close, pin).

#### Props

```javascript
{
  tab: Object,          // Chrome tab object
  onClick: Function,    // Tab activation handler
  onClose: Function,    // Tab close handler
  onPin: Function,      // Pin/unpin handler
  isPinned: Boolean,    // Pin state
  isActive: Boolean     // Active state
}
```

#### Tab Object Structure

```javascript
{
  id: Number,           // Tab ID
  url: String,          // Tab URL
  title: String,        // Page title
  favIconUrl: String,   // Favicon URL
  active: Boolean,      // Is active tab
  pinned: Boolean,      // Is pinned
  windowId: Number,     // Window ID
  index: Number,        // Tab index in window
  audible: Boolean,     // Playing audio
  mutedInfo: Object     // Mute state
}
```

#### Features
- **Favicon Display**: Shows page favicon with fallback
- **Active Indicator**: Visual highlight for active tab
- **Pinned Badge**: Shows pin status
- **Audio Indicator**: Shows if tab is playing audio
- **Hover Actions**: Close and pin buttons on hover

---

### 3. TabGroupCard Component

**Location:** [src/components/cooldesk/TabCard.jsx](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/TabCard.jsx)

#### Purpose
Displays grouped tabs by domain with expand/collapse.

#### Props

```javascript
{
  domain: String,       // Domain name
  tabs: Array,          // Tabs for this domain
  onClick: Function,    // Expand/collapse handler
  isExpanded: Boolean   // Expansion state
}
```

#### Features
- **Tab Count Badge**: Shows number of tabs in group
- **Favicon Grid**: Displays favicons of grouped tabs
- **Expand/Collapse**: Toggle to show/hide individual tabs
- **Domain Display**: Shows clean domain name

---

## Background Service (Auto-cleanup)

**Location:** [src/background/tabCleanup.js](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/background/tabCleanup.js)

### Purpose
Automatic tab cleanup service that closes inactive tabs based on configurable rules.

### Key Features
- **Scheduled Cleanup**: Runs on alarm (configurable interval)
- **Protected Tabs**: Never closes pinned, active, or audio-playing tabs
- **Domain Whitelist**: Protects important domains (Gmail, GitHub, etc.)
- **Age-based Cleanup**: Closes tabs older than threshold
- **Tab Limit Enforcement**: Closes oldest tabs when limit exceeded

### Protected Tab Rules

```javascript
// Tabs that are NEVER auto-closed
const isProtected = (tab) => {
  return tab.pinned ||                    // Pinned tabs
         tab.active ||                    // Active tab
         tab.audible ||                   // Playing audio
         isProtectedDomain(tab.url) ||    // Important domains
         isRecentlyAccessed(tab);         // Recently used
};

// Protected domains
const PROTECTED_DOMAINS = [
  'mail.google.com',
  'github.com',
  'calendar.google.com',
  'drive.google.com',
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com'
];
```

### Cleanup Algorithm

```javascript
// 1. Get all tabs
const allTabs = await chrome.tabs.query({});

// 2. Filter out protected tabs
const closableTabs = allTabs.filter(tab => !isProtected(tab));

// 3. Sort by last accessed time (oldest first)
closableTabs.sort((a, b) => a.lastAccessed - b.lastAccessed);

// 4. Close tabs based on rules
if (settings.enableTabLimit && allTabs.length > settings.maxTabs) {
  // Close oldest tabs to meet limit
  const toClose = closableTabs.slice(0, allTabs.length - settings.maxTabs);
  await chrome.tabs.remove(toClose.map(t => t.id));
}

// 5. Close tabs older than threshold
if (settings.enableAutoCleanup) {
  const threshold = Date.now() - (settings.cleanupAfterHours * 60 * 60 * 1000);
  const oldTabs = closableTabs.filter(t => t.lastAccessed < threshold);
  await chrome.tabs.remove(oldTabs.map(t => t.id));
}
```

### Configuration

```javascript
// Stored in chrome.storage.local
{
  enableAutoCleanup: Boolean,      // Enable auto-cleanup
  enableTabLimit: Boolean,         // Enable tab limit
  maxTabs: Number,                 // Max tabs (default: 50)
  cleanupAfterHours: Number,       // Hours before cleanup (default: 24)
  cleanupInterval: Number,         // Cleanup frequency in minutes (default: 60)
  protectedDomains: Array          // Custom protected domains
}
```

---

## Auto-grouping Feature

### Purpose
Automatically groups tabs by domain using Chrome's Tab Groups API.

### How It Works

```javascript
// 1. Group tabs by domain
const tabsByDomain = {};
tabs.forEach(tab => {
  const domain = new URL(tab.url).hostname;
  if (!tabsByDomain[domain]) tabsByDomain[domain] = [];
  tabsByDomain[domain].push(tab);
});

// 2. Create tab groups for domains with 2+ tabs
for (const [domain, domainTabs] of Object.entries(tabsByDomain)) {
  if (domainTabs.length >= 2) {
    const tabIds = domainTabs.map(t => t.id);
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: domain,
      collapsed: false
    });
  }
}
```

### Toggle Auto-group

```javascript
// Message handler in background service
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TOGGLE_AUTO_GROUP') {
    if (msg.enabled) {
      // Enable auto-grouping
      chrome.storage.local.set({ autoGroupEnabled: true });
      groupAllTabs();
    } else {
      // Disable and ungroup all
      chrome.storage.local.set({ autoGroupEnabled: false });
      ungroupAllTabs();
    }
    sendResponse({ success: true });
  }
});
```

---

## Performance Optimizations

### 1. Debounced Updates

```javascript
// Prevents excessive re-renders on rapid tab events
const debouncedRefresh = debounce(() => refreshTabs(), 300);
```

### 2. Lazy Loading

```javascript
// Show 12 tabs initially, load more on demand
const [visibleTabsCount, setVisibleTabsCount] = useState(12);

// Load more button
<button onClick={() => setVisibleTabsCount(prev => prev + 12)}>
  Show More ({tabs.length - visibleTabsCount} remaining)
</button>
```

### 3. Conditional Loading State

```javascript
// Only show loading on initial empty state
if (tabs.length === 0) setTabsLoading(true);
```

### 4. Memoized Domain Grouping

```javascript
const tabsByDomain = useCallback(() => {
  // Expensive grouping operation
  return grouped;
}, [tabs]);
```

---

## UI Sections

### 1. Pinned Tabs
- Shows all pinned tabs
- Always visible when pinned tabs exist
- Count badge

### 2. Grouped by Domain
- Shows domains with 2+ tabs
- Expandable groups
- Favicon grid preview

### 3. All Tabs
- Complete tab list
- Pagination (12 per page)
- Load more button

---

## Tab Actions

### Activate Tab

```javascript
const handleTabClick = async (tab) => {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
};
```

### Close Tab

```javascript
const handleTabClose = async (tab) => {
  await chrome.tabs.remove(tab.id);
};
```

### Pin/Unpin Tab

```javascript
const handleTabPin = async (tab) => {
  await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
};
```

---

## Usage Examples

### Basic Usage

```jsx
import { TabManagement } from './components/cooldesk/TabManagement';

function Dashboard() {
  return (
    <div className="dashboard">
      <TabManagement />
    </div>
  );
}
```

### With Custom Styling

```jsx
<div style={{ height: '600px', overflow: 'hidden' }}>
  <TabManagement />
</div>
```

---

## Styling

### CSS Classes

```css
.tabs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.tab-card {
  background: var(--glass-bg);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-card:hover {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.3);
}

.tab-card.active {
  border-color: #3B82F6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}
```

---

## Settings Integration

### Tab Cleanup Settings

Users can configure cleanup behavior in Settings:

```javascript
// Settings UI
<SettingsSection title="Tab Management">
  <Toggle
    label="Enable Auto-cleanup"
    checked={settings.enableAutoCleanup}
    onChange={(val) => updateSetting('enableAutoCleanup', val)}
  />
  
  <NumberInput
    label="Max Tabs"
    value={settings.maxTabs}
    onChange={(val) => updateSetting('maxTabs', val)}
    min={10}
    max={200}
  />
  
  <NumberInput
    label="Cleanup After (hours)"
    value={settings.cleanupAfterHours}
    onChange={(val) => updateSetting('cleanupAfterHours', val)}
    min={1}
    max={168}
  />
</SettingsSection>
```

---

## Troubleshooting

### Tabs not updating
- Check Chrome extension permissions (tabs, tabGroups)
- Verify event listeners are attached
- Check browser console for errors

### Auto-group not working
- Ensure `autoGroupEnabled` is true in storage
- Check background service is running
- Verify Tab Groups API is available

### Protected tabs being closed
- Check protected domain list
- Verify tab properties (pinned, active, audible)
- Review cleanup threshold settings

### Performance issues with many tabs
- Increase debounce delay (300ms → 500ms)
- Reduce visible tabs count (12 → 6)
- Enable lazy loading

---

## Future Enhancements

- [ ] Custom tab groups (manual grouping)
- [ ] Tab search/filter
- [ ] Tab sorting options (by domain, date, title)
- [ ] Tab session save/restore
- [ ] Tab export (bookmarks, JSON)
- [ ] Tab analytics (most visited, time spent)
- [ ] Tab preview on hover
- [ ] Bulk tab actions (close all, pin all)
- [ ] Tab history (recently closed)
- [ ] Tab sync across devices

---

## Related Components

- [TabCard](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/TabCard.jsx) - Individual tab display
- [ActivityFeed](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/ActivityFeed.jsx) - Shows active tabs in feed
- [SettingsModal](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/popups/SettingsModal.jsx) - Tab cleanup settings

---

## API Reference

### TabManagement Methods

```javascript
// Public methods (via ref)
refreshTabs()           // Manually refresh tab list
toggleAutoGroup()       // Toggle auto-grouping
```

### Chrome APIs Used

```javascript
// Tab operations
chrome.tabs.query()
chrome.tabs.update()
chrome.tabs.remove()
chrome.tabs.group()

// Tab events
chrome.tabs.onCreated
chrome.tabs.onUpdated
chrome.tabs.onRemoved
chrome.tabs.onActivated

// Tab groups
chrome.tabGroups.update()
chrome.tabGroups.query()

// Storage
chrome.storage.local.get()
chrome.storage.local.set()

// Alarms
chrome.alarms.create()
chrome.alarms.onAlarm
```
