# CoolDesk Extension - Workspace System Documentation

## Overview

The Workspace system provides intelligent organization of URLs into themed collections with activity-based sorting, pinning, team sharing, and advanced URL grouping features.

---

## Architecture

```
Workspace System
├── WorkspaceList (Main Container)
│   ├── WorkspaceCard (Individual Workspace Display)
│   ├── GroupedLinksPopover (URL Group Display)
│   └── UrlAnalyticsPopover (Analytics Display)
├── Database Layer (IndexedDB)
└── Activity Scoring Engine
```

---

## Components

### 1. WorkspaceList Component

**Location:** [src/components/cooldesk/WorkspaceList.jsx](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/WorkspaceList.jsx)

#### Purpose
Main workspace management interface with activity-based sorting, pinning, view modes, and browser bookmarks integration.

#### Key Features
- **Activity-based Sorting** - Ranks workspaces by usage score
- **Pin/Unpin Workspaces** - Keep important workspaces at top
- **View Modes** - Grid or List view
- **Browser Bookmarks** - Integrated bookmark access
- **Team Sharing** - Share workspaces with P2P teams
- **Lazy Loading** - Pagination (6 workspaces initially)
- **Search** - Filter bookmarks by title/URL

#### Props

```javascript
{
  savedWorkspaces: Array,      // All workspaces
  onWorkspaceClick: Function,  // Workspace click handler
  activeWorkspaceId: String,   // Currently active workspace
  expandedWorkspaceId: String, // Currently expanded workspace
  pinnedWorkspaces: Array,     // Array of pinned workspace names
  onTogglePin: Function,       // Pin/unpin handler
  onAddUrl: Function          // Add URL to workspace handler
}
```

#### State Management

```javascript
{
  viewMode: 'list' | 'grid',        // View mode (persisted)
  bookmarks: Array,                  // Browser bookmarks
  bookmarkSearch: String,            // Bookmark search query
  workspaceLimit: Number,            // Pagination limit (default: 6)
  isSortingByActivity: Boolean,      // Activity sorting enabled
  workspaceScores: Map,              // Activity scores cache
  isShareModalOpen: Boolean          // Team share modal state
}
```

#### Activity Scoring Algorithm

```javascript
// Composite score formula
const calculateWorkspaceScore = async (workspace) => {
  // 1. Aggregate URL analytics
  const totalVisits = sum(url.totalVisits);
  const totalTime = sum(url.totalTime);
  const mostRecentVisit = max(url.lastVisit);
  
  // 2. Calculate components
  const timeInHours = totalTime / (1000 * 60 * 60);
  const recencyBonus = Math.max(0, 100 - (Date.now() - mostRecentVisit) / (1000 * 60 * 60 * 24));
  
  // 3. Composite score
  const score = (totalVisits * 10) + (timeInHours * 50) + recencyBonus;
  
  return score;
};
```

#### Caching Strategy

```javascript
// Cache scores to avoid expensive recalculations
const cacheKey = 'cooldesk_workspace_scores';
const cacheHashKey = 'cooldesk_workspace_scores_hash';

// Check cache validity
const workspacesHash = workspaces.map(w => w.id + (w.urls?.length || 0)).join(',');
if (lastHash === workspacesHash) {
  // Use cached scores
  return cachedScores;
}

// Recalculate and cache
const scores = await calculateScores(workspaces);
localStorage.setItem(cacheKey, JSON.stringify(scores));
localStorage.setItem(cacheHashKey, workspacesHash);
```

#### Sections

1. **Pinned Workspaces** - Always shown first
2. **All Workspaces** - Sorted by activity or alphabetically
3. **Browser Bookmarks** - Collapsible section with search

---

### 2. WorkspaceCard Component

**Location:** [src/components/cooldesk/WorkspaceCard.jsx](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/WorkspaceCard.jsx)

#### Purpose
Individual workspace display with URL grouping, analytics, and actions.

#### Props

```javascript
{
  workspace: Object,          // Workspace data
  onClick: Function,          // Click handler
  isExpanded: Boolean,        // Expansion state
  isActive: Boolean,          // Active state
  compact: Boolean,           // Compact mode (list view)
  isPinned: Boolean,          // Pin state
  onPin: Function,            // Pin handler
  onDelete: Function,         // Delete handler
  onAddUrl: Function          // Add URL handler
}
```

#### Workspace Object Structure

```javascript
{
  id: String,                 // Unique ID
  name: String,               // Workspace name
  description: String,        // Optional description
  icon: String,               // Icon name (default: 'folder')
  urls: Array,                // Array of URL objects
  createdAt: Number,          // Creation timestamp
  updatedAt: Number           // Last update timestamp
}
```

#### URL Object Structure

```javascript
{
  url: String,                // Full URL
  title: String,              // Page title
  addedAt: Number,            // When added to workspace
  favicon: String             // Optional favicon URL
}
```

#### URL Sorting by Usage

```javascript
// Sort URLs within workspace by activity
const sortUrlsByUsage = async () => {
  const urlsWithStats = await Promise.all(
    urls.map(async (urlObj) => {
      const stats = await getUrlAnalytics(urlObj.url);
      return { ...urlObj, stats };
    })
  );
  
  const sorted = urlsWithStats.sort((a, b) => {
    const scoreA = calculateUrlScore(a.stats);
    const scoreB = calculateUrlScore(b.stats);
    return scoreB - scoreA;
  });
  
  setSortedUrls(sorted);
};

// Score calculation
const calculateUrlScore = (stats) => {
  const visits = stats.totalVisits * 10;
  const time = (stats.totalTime / (1000 * 60 * 60)) * 50;
  const recency = Math.max(0, 100 - (Date.now() - stats.lastVisit) / (1000 * 60 * 60 * 24));
  return visits + time + recency;
};
```

#### Advanced URL Grouping

Groups URLs by domain/service for compact view:

```javascript
// Grouping rules
const getGroupingInfo = (url) => {
  // GitHub: Group by owner
  if (domain === 'github.com') {
    return {
      key: `github-${owner}`,
      label: owner,
      subLabel: 'GitHub'
    };
  }
  
  // Google Services: Group by service
  if (domain.endsWith('.google.com')) {
    return {
      key: `google-${service}`,
      label: service,
      subLabel: 'Google'
    };
  }
  
  // Notion: Group by workspace
  if (domain.includes('notion.site')) {
    return {
      key: `notion-${subdomain}`,
      label: subdomain,
      subLabel: 'Notion'
    };
  }
  
  // Default: Group by domain
  return {
    key: domain,
    label: formatDomainName(url),
    domain: domain
  };
};
```

#### View Modes

**Grid View** - Card layout with full details
```javascript
<div className="workspace-card">
  <div className="workspace-card-header">
    <div className="workspace-icon" />
    <div className="workspace-info">
      <div className="workspace-name">{name}</div>
      <div className="workspace-count">{urlCount} URLs</div>
    </div>
  </div>
  <ul className="workspace-links">
    {urls.map(url => <li>{url.title}</li>)}
  </ul>
</div>
```

**List View (Compact)** - macOS Dock-style with grouped icons
```javascript
<div className="compact-card-inner">
  <div className="compact-workspace-icon" />
  <div className="compact-workspace-info">
    <div className="compact-workspace-name">{name}</div>
    <div className="compact-workspace-count">{urlCount} URLs</div>
  </div>
  <div className="compact-icons-container">
    {groupedItems.map(item => (
      item.type === 'group' ? 
        <GroupPill urls={item.urls} /> : 
        <SingleIcon url={item.url} />
    ))}
  </div>
</div>
```

#### Category Icons

```javascript
const CATEGORY_ICONS = {
  finance: faChartLine,
  health: faHeartPulse,
  education: faGraduationCap,
  sports: faFutbol,
  social: faHashtag,
  travel: faPlane,
  entertainment: faFilm,
  shopping: faShoppingBag,
  food: faUtensils,
  utilities: faTools
};
```

---

## Database Layer

### API Functions

**Location:** [src/db/unified-api.js](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/db/unified-api.js)

```javascript
// Workspace CRUD
await saveWorkspace(workspace);           // Create or update
await listWorkspaces();                   // List all workspaces
await deleteWorkspace(workspaceId);       // Delete workspace
await updateItemWorkspace(itemId, wsId);  // Move item to workspace

// URL Analytics
await getUrlAnalytics(url);               // Get usage stats
await upsertUrl(urlData);                 // Update URL data
```

### Database Schema

**Workspaces Store (IndexedDB)**
```javascript
{
  storeName: 'workspaces',
  keyPath: 'id',
  indexes: [
    { name: 'name', keyPath: 'name', unique: true },
    { name: 'createdAt', keyPath: 'createdAt' },
    { name: 'updatedAt', keyPath: 'updatedAt' }
  ]
}
```

**URL Analytics Store**
```javascript
{
  storeName: 'urlAnalytics',
  keyPath: 'url',
  indexes: [
    { name: 'totalVisits', keyPath: 'totalVisits' },
    { name: 'lastVisit', keyPath: 'lastVisit' },
    { name: 'totalTime', keyPath: 'totalTime' }
  ]
}
```

---

## Performance Optimizations

### 1. Memoization

```javascript
// Memoize workspace card to prevent re-renders
export const WorkspaceCard = memo(function WorkspaceCard({ ... }) {
  // Component logic
});

// Memoize sorted workspaces
const sortedUnpinned = useMemo(() => {
  return unpinned.sort((a, b) => {
    const scoreA = workspaceScores.get(a.id) || 0;
    const scoreB = workspaceScores.get(b.id) || 0;
    return scoreB - scoreA;
  });
}, [unpinned, workspaceScores]);
```

### 2. Debounced Score Calculation

```javascript
// Debounce expensive score calculations (500ms)
const loadActivityScores = useMemo(
  () => debounce(async () => {
    const scores = await calculateScores(workspaces);
    setWorkspaceScores(scores);
  }, 500),
  [workspaces]
);
```

### 3. Lazy Loading with requestIdleCallback

```javascript
// Defer score calculation to idle time
if (window.requestIdleCallback) {
  window.requestIdleCallback(() => loadActivityScores(), { timeout: 2000 });
} else {
  loadActivityScores();
}
```

### 4. Responsive Icon Display

```javascript
// Calculate visible icons based on container width
const calculateVisibleItems = () => {
  const containerWidth = container.offsetWidth;
  const iconWidth = 44; // Single icon
  const groupWidth = 86; // Group pill
  const reservedWidth = 45; // "+N more" button
  
  let count = 0;
  let usedWidth = 0;
  
  for (const item of groupedItems) {
    const itemWidth = item.type === 'group' ? groupWidth : iconWidth;
    if (usedWidth + itemWidth <= containerWidth - reservedWidth) {
      usedWidth += itemWidth;
      count++;
    }
  }
  
  setVisibleCount(Math.max(1, Math.min(count, 8)));
};
```

---

## Usage Examples

### Creating a Workspace

```javascript
const workspace = {
  id: `ws_${Date.now()}`,
  name: 'Work Projects',
  description: 'All work-related links',
  icon: 'folder',
  urls: [
    { url: 'https://github.com/myorg/repo', title: 'Main Repo' },
    { url: 'https://linear.app/team/issues', title: 'Issues' }
  ],
  createdAt: Date.now(),
  updatedAt: Date.now()
};

await saveWorkspace(workspace);
```

### Adding URL to Workspace

```javascript
const addUrlToWorkspace = async (workspace, url) => {
  const updatedWorkspace = {
    ...workspace,
    urls: [...workspace.urls, { url, title: '', addedAt: Date.now() }],
    updatedAt: Date.now()
  };
  
  await saveWorkspace(updatedWorkspace);
};
```

### Pinning a Workspace

```javascript
const handleTogglePin = (workspaceName) => {
  const newPinned = pinnedWorkspaces.includes(workspaceName)
    ? pinnedWorkspaces.filter(n => n !== workspaceName)
    : [...pinnedWorkspaces, workspaceName];
  
  setPinnedWorkspaces(newPinned);
  localStorage.setItem('cooldesk_pinned_workspaces', JSON.stringify(newPinned));
};
```

---

## Styling

### CSS Classes

```css
/* Workspace Card */
.cooldesk-workspace-card { /* Base card */ }
.cooldesk-workspace-card.active { /* Active state */ }
.cooldesk-workspace-card.compact { /* List view */ }

/* Compact View */
.compact-card-inner { /* List view container */ }
.compact-workspace-icon { /* Workspace icon */ }
.compact-icons-container { /* URL icons container */ }
.compact-url-icon { /* Single URL icon */ }
.compact-url-group { /* Grouped URLs pill */ }

/* Grid View */
.workspace-card-header { /* Card header */ }
.workspace-links { /* URL list */ }
.workspace-link-item { /* Individual URL */ }
```

### Theme Variables

```css
--glass-bg: rgba(15, 23, 42, 0.95);
--border-primary: rgba(148, 163, 184, 0.2);
--text-primary: #F1F5F9;
--text-secondary: #94A3B8;
--accent-blue: #60A5FA;
--accent-purple: #8B5CF6;
```

---

## Team Sharing

### Share Workspace with Team

```javascript
// Open share modal
<ShareToTeamModal
  isOpen={isShareModalOpen}
  onClose={() => setIsShareModalOpen(false)}
  contextWorkspace={activeWorkspace}
/>

// Share implementation
const shareWorkspace = async (workspace, teamId) => {
  await p2pStorage.addItemToTeam(teamId, {
    type: 'WORKSPACE_SHARE',
    payload: workspace,
    timestamp: Date.now()
  });
};
```

---

## Troubleshooting

### Workspaces not sorting by activity
- Check `isSortingByActivity` state
- Clear cache: `localStorage.removeItem('cooldesk_workspace_scores')`
- Verify URL analytics are being tracked

### Pinned workspaces not persisting
- Check localStorage: `cooldesk_pinned_workspaces`
- Verify `onTogglePin` handler is called
- Check browser storage permissions

### URL grouping not working
- Verify URL format is valid
- Check `getGroupingInfo()` logic
- Ensure compact mode is enabled

### Performance issues
- Increase debounce delay (500ms → 1000ms)
- Reduce workspace limit (6 → 3)
- Disable activity sorting temporarily

---

## Future Enhancements

- [ ] Workspace templates
- [ ] Bulk URL import (CSV, JSON)
- [ ] Workspace tags/categories
- [ ] Collaborative workspaces (real-time)
- [ ] Workspace export/import
- [ ] URL deduplication
- [ ] Workspace analytics dashboard
- [ ] Custom workspace icons
- [ ] Nested workspaces
- [ ] Workspace search

---

## Related Components

- [WorkspaceCard](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/WorkspaceCard.jsx) - Individual workspace display
- [GroupedLinksPopover](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/GroupedLinksPopover.jsx) - URL group display
- [UrlAnalyticsPopover](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/UrlAnalyticsPopover.jsx) - Analytics display
- [ShareToTeamModal](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/popups/ShareToTeamModal.jsx) - Team sharing UI

---

## API Reference

### WorkspaceList Methods

```javascript
// Public methods (via ref)
handleDeleteWorkspace(workspace)  // Delete workspace
handleBookmarkClick(url)          // Open bookmark
```

### WorkspaceCard Methods

```javascript
// Public methods (via ref)
sortUrlsByUsage()                 // Re-sort URLs
calculateVisibleItems()           // Recalculate visible icons
```

### Database Functions

```javascript
// Import from db/index.js
import { 
  saveWorkspace, 
  listWorkspaces, 
  deleteWorkspace,
  getUrlAnalytics,
  upsertUrl
} from './db/index.js';
```
