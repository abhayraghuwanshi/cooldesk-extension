# Knowledge Graph

An Obsidian-style force-directed graph that shows how your browser tabs, desktop apps, local folders, and media co-occur across work sessions — growing organically without any manual input.

---

## What It Shows

The graph has five node types and two sources of edges.

### Node Types

| Type | Color | Shape | Example |
|------|-------|-------|---------|
| `workspace` | Indigo | Rounded rect | "Dev", "Finance" |
| `url` | Green | Circle | `github.com`, `localhost:3000` |
| `app` | Amber | Circle | VS Code, Postman, Slack |
| `folder` | Yellow | Diamond | `extension` (open project) |
| `file` | Slate | Small square | `report.xlsx` |
| `media` | Pink | Double-circle | Spotify, VLC |

### Edge Types

| Type | Color | Meaning |
|------|-------|---------|
| `url_in_workspace` | Green | URL explicitly added to a workspace |
| `app_in_workspace` | Amber | App associated with a workspace via feedback |
| `folder_in_workspace` | Yellow | Project folder added to a workspace |
| `file_in_workspace` | Slate | File added to a workspace |
| `co_occurrence` | Indigo | Two URLs explicitly grouped by user |
| `session_co_occurrence` | Purple | Two items active at the same time (automatic) |

Edge **width** = weight (0–1). Edge **color opacity** fades for unconnected nodes when a node is selected.

---

## How the Graph Grows Automatically

Every **30 seconds**, the Rust sidecar takes a snapshot of everything currently active on the machine:

```
Snapshot @ 14:32:00
  apps:    [vscode, terminal, chrome, postman]
  tabs:    [localhost:3000, github.com, npmjs.com]
  folders: [extension]          ← parsed from VS Code window title
  media:   [spotify]            ← detected by app name pattern
```

Every item pair in the same snapshot gets a `session_co_occurrence` edge increment. After 50 snapshots where VS Code + localhost:3000 appear together, that edge has `session_count = 50` and will be visible in the graph.

**Session boundary**: a gap of more than 30 minutes between snapshots is treated as a new session. Items from different sessions are never connected.

### What is captured automatically

| Item | Captured | Detail |
|------|----------|--------|
| Desktop apps | ✅ | All visible apps via Win32 API |
| Browser tabs | ✅ | Domain only (`github.com`, not full URL) |
| Editor projects | ✅ | Project name from window title (`"index.jsx — extension — VS Code"` → `extension`) |
| Media apps | ✅ | Spotify, VLC, music apps by name pattern |
| Open files | ⚠️ | Filename only if app puts it in title bar — no full path |
| Full folder paths | ❌ | Only project name, not `C:\Users\...\extension` |

---

## Data Model

### Rust (`src-tauri/src/sidecar/`)

#### `data.rs`

```rust
// Workspace now persists the apps array (was silently dropped before)
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub urls: Vec<WorkspaceUrl>,
    pub apps: Vec<WorkspaceApp>,   // ← new: folders, files, desktop apps
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

pub struct WorkspaceApp {
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub app_type: Option<String>,  // "default" | "folder" | "file" | "vscode" | "cursor" | ...
    pub added_at: Option<i64>,
}

// Graph response types
pub struct GraphNode { pub id, node_type, label, title, weight }
pub struct GraphEdge { pub source, target, edge_type, weight }
pub struct GraphResponse { pub nodes, edges, meta }
```

#### `feedback/types.rs`

```rust
// Cross-type item co-occurrence — recorded automatically from session snapshots
pub struct ItemCoOccurrence {
    pub item1: String,        // "url::github.com", "app::vscode", "folder::extension"
    pub item2: String,        // Always item1 <= item2 (lexicographic, for dedup)
    pub session_count: u32,   // Times seen active simultaneously
    pub last_seen: i64,
}
// Score = log(session_count+1) × exp(-age_days/30)  — decays over 30 days
```

Added to `FeedbackState`:
```rust
pub item_co_occurrences: Vec<ItemCoOccurrence>,  // #[serde(default)] — backward compat
```

#### `feedback/store.rs`

```rust
// Record all N×(N-1)/2 pairs from one snapshot (capped at 20 items)
pub async fn record_snapshot(&self, items: Vec<String>)

// Read for graph building
pub async fn get_all_item_co_occurrences(&self) -> Vec<ItemCoOccurrence>
pub async fn get_all_co_occurrences(&self) -> Vec<UrlCoOccurrence>
```

#### `handlers.rs`

```rust
// Parses editor window titles to extract open project name
// "data.json — myproject — Visual Studio Code" → Some("myproject")
pub fn extract_editor_project(app_name: &str, title: &str) -> Option<String>

// Called by the background loop — delegates to FeedbackStore::record_snapshot
pub async fn record_session_snapshot(items: Vec<String>)

// GET /graph — builds the full node+edge response from:
//   Pass 1: workspaces (urls + apps)
//   Pass 2: url_co_occurrences (explicit user feedback)
//   Pass 3: app_workspace_associations (feedback store)
//   Pass 4: item_co_occurrences (automatic session snapshots)
pub async fn get_graph(State(state): State<Arc<AppState>>) -> Json<GraphResponse>
```

#### `server.rs`

New 30-second background task alongside the existing 15-second activity tracker:

```rust
tokio::spawn(async move {
    loop {
        interval.tick().await;  // 30s

        // Session boundary check (>30 min gap = new session, skip recording)
        // Collect: visible apps + current tabs + editor projects + media apps
        // Record: all pairwise co-occurrences via record_session_snapshot()
    }
});
```

### `GET /graph` endpoint

```
GET http://localhost:4545/graph
```

```json
{
  "nodes": [
    { "id": "ws::dev",        "type": "workspace", "label": "Dev",       "weight": 6 },
    { "id": "url::github.com","type": "url",        "label": "github.com","weight": 4 },
    { "id": "app::vscode",    "type": "app",        "label": "vscode",    "weight": 3 },
    { "id": "folder::extension","type":"folder",    "label": "extension", "weight": 8 },
    { "id": "media::spotify", "type": "media",      "label": "spotify",   "weight": 2 }
  ],
  "edges": [
    { "source": "url::github.com", "target": "ws::dev",        "type": "url_in_workspace",      "weight": 1.0 },
    { "source": "app::vscode",     "target": "folder::extension","type":"session_co_occurrence", "weight": 0.72 },
    { "source": "url::github.com", "target": "media::spotify",  "type": "session_co_occurrence", "weight": 0.31 }
  ],
  "meta": { "generatedAt": 1714267200000, "nodeCount": 5, "edgeCount": 3 }
}
```

**Node weight** = degree (number of unique connections). Used to size nodes in the UI.

**Trim limits**: top 200 URL nodes, top 50 app nodes, all workspaces/folders/files/media.

---

## Frontend

### Files

| File | Purpose |
|------|---------|
| `src/services/graphService.js` | `fetchGraph(forceRefresh, signal)` — 30s cache, abort-safe |
| `src/components/cooldesk/KnowledgeGraph.jsx` | `GraphCanvas` (embeddable) + `KnowledgeGraph` (modal) |
| `src/components/cooldesk/KnowledgeGraph.css` | Styles for both embedded and modal views |

### `GraphCanvas` (embeddable)

Self-contained component. Renders the force-directed graph, filter pills, live badge, and tooltip. Can be dropped anywhere:

```jsx
import { GraphCanvas } from './KnowledgeGraph';

// Embedded in a panel
<div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
  <GraphCanvas />
</div>
```

### `KnowledgeGraph` (modal)

Full-screen overlay wrapping `GraphCanvas`:

```jsx
import { KnowledgeGraph } from './KnowledgeGraph';

<KnowledgeGraph isOpen={graphOpen} onClose={() => setGraphOpen(false)} />
```

Opened from `CoolDeskContainer` via the `faDiagramProject` button in the header or `Ctrl+Shift+G`.

### Live Updates

`GraphCanvas` polls `GET /graph` every **30 seconds** when Live mode is on (default). Skips re-render if nodes and edges haven't changed. A pulsing green dot indicates live mode; click it to pause.

### Interactions

| Action | Result |
|--------|--------|
| Click node | Highlight connected nodes; fade others to 20% opacity |
| Hover node | Tooltip with label, type, weight |
| Click background | Deselect |
| Filter pill | Show only that node type + their direct connections |
| Labels toggle | Show/hide text labels (workspace labels always visible at low zoom) |
| Fit button | `zoomToFit(400, 40)` — re-centres after simulation settles |
| `Ctrl+Shift+G` | Toggle graph modal |

---

## Node Size Formula

```
radius = 5 + √weight × 2
```

| Weight | Radius | Meaning |
|--------|--------|---------|
| 1 | 7px | Rarely connected |
| 5 | 9.5px | A few connections |
| 10 | 11.3px | Moderately connected |
| 25 | 15px | Highly connected hub |

Weight is capped at degree (number of unique connections) — never accumulates raw session counts.

---

## How to Verify It's Working

1. Start the Tauri desktop app
2. Open VS Code with a project, open a browser tab, play music
3. Wait 30–60 seconds
4. Open the graph (`Ctrl+Shift+G` or the graph button in the header)
5. You should see nodes for the app, the tab domain, and the editor project — connected by purple `session_co_occurrence` edges

To inspect raw data:
```bash
curl http://localhost:4545/graph | jq '.nodes | length'
curl http://localhost:4545/graph | jq '.edges[] | select(.type == "session_co_occurrence")'
```
