# CoolDesk Extension - Component Overview

## Overview Dashboard Components

The Overview Dashboard provides a unified view of workspaces, notes, and activity feeds. It's designed for performance and reusability.

### Component Architecture

```
OverviewDashboard (Parent)
├── WorkspaceCard (Reusable)
├── NotesWidget (Reusable)
└── ActivityFeed (Lazy-loaded, Reusable)
```

---

## 1. OverviewDashboard Component

**Location:** [src/components/cooldesk/OverviewDashboard.jsx](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/OverviewDashboard.jsx)

### Purpose
Main dashboard view that displays recent workspaces, quick notes, and activity feed in a responsive grid layout.

### Key Features
- **Activity-based sorting** - Uses `sortWorkspacesByActivity()` to show most relevant workspaces
- **LocalStorage caching** - Caches sorted results to avoid expensive DB queries
- **Lazy loading** - ActivityFeed is code-split for better initial load performance
- **Responsive layout** - Two-column grid (workspaces/notes + activity feed)

### Props

```javascript
{
  savedWorkspaces: Array,      // All saved workspaces
  onWorkspaceClick: Function,  // Workspace click handler
  activeWorkspaceId: String,   // Currently active workspace ID
  expandedWorkspaceId: String, // Currently expanded workspace ID
  onAddNote: Function,         // Note creation handler
  pinnedWorkspaces: Array,     // Array of pinned workspace names
  onAddUrl: Function          // URL addition handler
}
```

### Performance Optimizations

1. **Cache Strategy**
   ```javascript
   // Caches sorted workspaces with hash validation
   const workspacesHash = useMemo(() => 
     savedWorkspaces.map(w => w.id + (w.urls?.length || 0)).join(',')
   , [savedWorkspaces]);
   ```

2. **Deferred Loading**
   ```javascript
   // Uses requestIdleCallback to defer heavy sorting
   if (window.requestIdleCallback) {
     window.requestIdleCallback(() => loadRecentWorkspaces(), { timeout: 2000 });
   }
   ```

3. **Layout Shift Prevention**
   ```javascript
   // Reserves space to prevent CLS
   minHeight: '200px'
   ```

### Usage Example

```jsx
<OverviewDashboard
  savedWorkspaces={workspaces}
  onWorkspaceClick={(ws) => setActiveWorkspace(ws)}
  activeWorkspaceId={activeId}
  expandedWorkspaceId={expandedId}
  onAddNote={handleAddNote}
  pinnedWorkspaces={['Work', 'Personal']}
  onAddUrl={handleAddUrl}
/>
```

---

## 2. ActivityFeed Component

**Location:** [src/components/cooldesk/ActivityFeed.jsx](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/ActivityFeed.jsx)

### Purpose
Unified activity feed showing favorites, chats, tabs, and calendar events with real-time updates.

### Key Features
- **Multi-source aggregation** - Combines chats, tabs, and calendar events
- **Real-time updates** - Event-driven updates with debouncing
- **Tabbed interface** - Filter by All, Calendar, Chats, or Tabs
- **Responsive favorites** - Dynamically adjusts visible favorites based on width
- **Calendar integration** - Syncs with Google Calendar via scraper

### Component Structure

```javascript
ActivityFeed
├── Favorites Bar (Quick Links)
├── Tab Selector (All/Calendar/Chats/Tabs)
└── Feed Content
    ├── Calendar View (Clock + Events)
    └── Activity List (Chats + Tabs)
```

### Data Sources

1. **Quick Links (Favorites)**
   - Priority: UI State → Chrome History
   - Deduplicates by hostname
   - Limit: 8 items

2. **Chats**
   - Source: `listScrapedChats()` from IndexedDB
   - Platforms: ChatGPT, Claude, Gemini, Grok, Perplexity
   - Sorted by `scrapedAt` timestamp

3. **Tabs**
   - Source: `chrome.tabs.query()`
   - Real-time updates via tab events
   - Filters out `chrome://` URLs

4. **Calendar Events**
   - Source: `chrome.storage.local` (calendar_events)
   - Scraped from Google Calendar
   - Manual sync trigger available

### Real-Time Updates

```javascript
// Debounced updates (500ms) on tab events
chrome.tabs.onCreated.addListener(debouncedUpdate);
chrome.tabs.onRemoved.addListener(debouncedUpdate);
chrome.tabs.onUpdated.addListener(debouncedUpdate);
chrome.tabs.onActivated.addListener(debouncedUpdate);

// Storage listener for calendar/chat updates
chrome.storage.onChanged.addListener(storageListener);
```

### Responsive Favorites

```javascript
// Calculates visible favorites based on container width
const calculateVisibleFavorites = () => {
  const iconWidth = 52; // 44px + 8px gap
  const reservedWidth = 50; // for "+N more" button
  const count = Math.floor((containerWidth - reservedWidth) / iconWidth);
  setVisibleFavCount(Math.max(1, Math.min(count, 8)));
};
```

### Usage Example

```jsx
import { lazy, Suspense } from 'react';

const ActivityFeed = lazy(() => 
  import('./ActivityFeed').then(m => ({ default: m.ActivityFeed }))
);

// In component
<Suspense fallback={<div>Loading feed...</div>}>
  <ActivityFeed />
</Suspense>
```

### Standalone Usage

ActivityFeed is **fully standalone** and can be used anywhere:

```jsx
// In any component
import { ActivityFeed } from './components/cooldesk/ActivityFeed';

function MyDashboard() {
  return (
    <div className="my-layout">
      <ActivityFeed />
    </div>
  );
}
```

---

## Reusability Guide

### When to Reuse OverviewDashboard
- ✅ Need a complete dashboard view with workspaces + activity
- ✅ Want activity-based workspace sorting
- ✅ Need integrated notes widget
- ❌ Only need activity feed (use ActivityFeed directly)
- ❌ Need custom workspace layout (use WorkspaceCard directly)

### When to Reuse ActivityFeed
- ✅ Need standalone activity/feed view
- ✅ Want favorites + chats + tabs + calendar
- ✅ Need real-time updates
- ✅ Can be used in sidebar, popup, or any container
- ✅ Fully self-contained (no props required)

### Customization Points

**OverviewDashboard:**
- Workspace count: Change `.slice(0, 4)` to show more/fewer
- Grid layout: Modify `.overview-dashboard-grid` CSS
- Cache duration: Adjust `workspacesHash` logic

**ActivityFeed:**
- Favorites limit: Change `slice(0, 8)` in `loadQuickLinks()`
- Feed items limit: Change `slice(0, 20)` in `loadFeed()`
- Debounce delay: Modify `debounce(func, 500)` milliseconds
- Tab filters: Modify `['all', 'calendar', 'chats', 'tabs']` array

---

## Performance Best Practices

### OverviewDashboard
1. **Use memoization** for expensive computations
2. **Cache sorted results** in localStorage
3. **Lazy load** ActivityFeed to improve LCP
4. **Reserve space** to prevent layout shifts

### ActivityFeed
1. **Debounce updates** (500ms) to avoid excessive re-renders
2. **Use ResizeObserver** for responsive favorites
3. **Limit data** (8 favorites, 20 feed items)
4. **Event-driven** updates instead of polling

---

## Styling

Both components use:
- **CSS Custom Properties** for theming
- **Inline styles** for dynamic values
- **CSS classes** from `cooldesk.css`

### Key CSS Classes
- `.cooldesk-panel` - Main container
- `.cooldesk-workspace-card` - Workspace cards
- `.overview-dashboard-grid` - Dashboard grid layout
- `.overview-left-column` - Left column (workspaces + notes)
- `.overview-activity-column` - Right column (activity feed)

---

## Dependencies

### OverviewDashboard
- `sortWorkspacesByActivity` from `utils/ranking.js`
- `getUrlAnalytics` from `db/index.js`
- `WorkspaceCard`, `NotesWidget` components

### ActivityFeed
- `listScrapedChats` from `db/index.js`
- `getFaviconUrl` from `utils/helpers.js`
- `chrome.tabs` API
- `chrome.storage` API
- FontAwesome icons

---

## Future Enhancements

### OverviewDashboard
- [ ] Configurable workspace count
- [ ] Drag-and-drop workspace reordering
- [ ] Workspace preview on hover

### ActivityFeed
- [ ] Infinite scroll for feed items
- [ ] Search/filter within feed
- [ ] Custom favorite management UI
- [ ] Calendar event creation
- [ ] Pin/unpin favorites

---

## Related Components

- [WorkspaceCard](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/WorkspaceCard.jsx) - Individual workspace display
- [NotesWidget](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/NotesWidget.jsx) - Quick notes interface
- [RecentChats](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/RecentChats.jsx) - Chat history display

---

## Troubleshooting

### OverviewDashboard shows stale data
- Clear localStorage cache: `localStorage.removeItem('cooldesk_recent_workspaces')`
- Check `workspacesHash` is updating correctly

### ActivityFeed not updating
- Verify Chrome extension permissions (tabs, storage)
- Check browser console for event listener errors
- Ensure debounce isn't blocking updates (reduce delay)

### Calendar events not showing
- Open Google Calendar tab to trigger scraper
- Click "Sync" button in Calendar tab
- Check `chrome.storage.local.get(['calendar_events'])`
