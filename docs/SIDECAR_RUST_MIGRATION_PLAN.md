# Sidecar Rust Migration Plan

## Overview

Migrate the Node.js sidecar server to Rust for:
- **No Node.js dependency** - Single binary, easier distribution
- **Better performance** - Native compilation, lower memory usage
- **Simpler Tauri integration** - Direct integration into the Tauri app

---

## Current Architecture (Node.js)

```
sidecar/
├── server.js          # HTTP + WebSocket server (port 4000)
├── localLLM.js        # node-llama-cpp integration
└── package.json       # Dependencies: ws, node-llama-cpp, ps-list, open
```

**Functionality:**
1. **Sync Server** - HTTP/WebSocket for browser extension sync
2. **Data Persistence** - JSON file storage
3. **Local LLM** - Chat, summarization, categorization using llama.cpp

---

## Migration Comparison: Node.js vs Rust LLM

### node-llama-cpp (Current)

| Aspect | Details |
|--------|---------|
| **Maturity** | Stable, well-maintained |
| **Models** | GGUF format (llama.cpp compatible) |
| **Features** | Chat sessions, streaming, embeddings |
| **Memory** | Higher due to Node.js runtime (~100MB+ overhead) |
| **CPU/GPU** | Supports both via llama.cpp backend |
| **Ease of use** | Easy, JavaScript API |

### llama-cpp-rs (Rust Alternative)

| Aspect | Details |
|--------|---------|
| **Maturity** | Active development, may have rough edges |
| **Models** | Same GGUF format (same llama.cpp backend) |
| **Features** | Lower-level API, streaming supported |
| **Memory** | Lower (~50-80% less than Node.js version) |
| **CPU/GPU** | Same capabilities as node-llama-cpp |
| **Ease of use** | Requires more boilerplate code |

### Migration Risks

| Risk | Mitigation |
|------|------------|
| **llama-cpp-rs API stability** | Pin to specific version, test thoroughly |
| **Different model loading behavior** | Test with all supported models |
| **Streaming implementation** | Use tokio channels for async streaming |
| **Build complexity** | llama.cpp compilation requires cmake |

### Recommendation

**Proceed with Rust migration** because:
1. Eliminates Node.js dependency entirely
2. Single binary distribution
3. Better memory efficiency (important for LLM)
4. Native Tauri integration (can move into main binary later)
5. Same llama.cpp backend = same model compatibility

---

## Migration Phases

### Phase 1: Core Server (No LLM) ⭐ Start Here
**Goal:** Replace Node.js HTTP/WebSocket server with Rust

**Components:**
- HTTP server (axum)
- WebSocket server (tokio-tungstenite)
- JSON persistence (serde_json)
- Data sync logic

**Files to create:**
```
src-tauri/src/sidecar/
├── mod.rs              # Module exports
├── server.rs           # HTTP + WS server
├── data.rs             # Data structures
├── storage.rs          # JSON persistence
├── sync.rs             # Merge logic
└── handlers.rs         # Request handlers
```

**Endpoints to implement:**
- GET: /health, /workspaces, /urls, /tabs, /settings, /notes, etc.
- POST: /workspaces, /urls, /tabs, /sync, /cmd/jump-to-tab, etc.
- WebSocket: push-*, request-state, sync-state

**Estimated effort:** 2-3 days

---

### Phase 2: LLM Integration
**Goal:** Add local LLM support using llama-cpp-rs

**Crate:** `llama-cpp-2` (most active Rust bindings)

**Components:**
- Model management (download, load, unload)
- Chat completion
- Streaming responses
- Specialized tasks (summarize, categorize)

**Files to add:**
```
src-tauri/src/sidecar/
├── llm/
│   ├── mod.rs          # LLM module
│   ├── models.rs       # Model definitions
│   ├── inference.rs    # Chat/completion
│   └── tasks.rs        # Summarize, categorize, etc.
```

**Cargo.toml additions:**
```toml
[dependencies]
llama-cpp-2 = "0.1"  # or llama-cpp = "0.3"
```

**Estimated effort:** 3-4 days

---

### Phase 3: Integration & Cleanup
**Goal:** Integrate into Tauri, remove Node.js sidecar

**Tasks:**
1. Option A: Keep as separate binary (externalBin)
2. Option B: Embed into main Tauri binary (recommended)
3. Remove sidecar/ folder and Node.js dependencies
4. Update build scripts

**Estimated effort:** 1 day

---

## Detailed Data Structures

### Rust Equivalents

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncData {
    pub workspaces: Vec<Workspace>,
    pub urls: Vec<Url>,
    pub settings: HashMap<String, serde_json::Value>,
    pub activity: Vec<Activity>,
    pub notes: Vec<Note>,
    pub url_notes: Vec<UrlNote>,
    pub pins: Vec<Pin>,
    pub scraped_chats: Vec<ScrapedChat>,
    pub scraped_configs: Vec<ScrapedConfig>,
    pub daily_memory: Vec<DailyMemory>,
    pub ui_state: HashMap<String, serde_json::Value>,
    pub dashboard: HashMap<String, serde_json::Value>,
    pub tabs: Vec<Tab>,
    pub last_updated: HashMap<String, i64>,

    #[serde(skip)]
    pub device_tabs_map: HashMap<String, Vec<Tab>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub urls: Vec<WorkspaceUrl>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tab {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub favicon_url: Option<String>,
    pub window_id: Option<i64>,
    #[serde(rename = "_deviceId")]
    pub device_id: Option<String>,
}

// WebSocket Messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WsMessage {
    #[serde(rename = "request-state")]
    RequestState,
    #[serde(rename = "sync-state")]
    SyncState(SyncStatePayload),
    #[serde(rename = "push-tabs")]
    PushTabs(PushTabsPayload),
    #[serde(rename = "tabs-updated")]
    TabsUpdated(Vec<Tab>),
    // ... more message types
}
```

---

## Crate Dependencies

```toml
[dependencies]
# Web server
axum = { version = "0.7", features = ["ws"] }
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = "0.21"
tower-http = { version = "0.5", features = ["cors"] }

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# LLM (Phase 2)
llama-cpp-2 = "0.1"

# Utilities
tracing = "0.1"
tracing-subscriber = "0.3"
directories = "5"  # For ~/.cooldesk paths
reqwest = { version = "0.11", features = ["stream"] }  # Model downloads
```

---

## Migration Steps Checklist

### Phase 1: Core Server
- [ ] Create `src-tauri/src/sidecar/` module structure
- [ ] Define data structures in `data.rs`
- [ ] Implement JSON storage in `storage.rs`
- [ ] Implement merge logic in `sync.rs`
- [ ] Create HTTP server with axum in `server.rs`
- [ ] Add WebSocket support
- [ ] Implement all GET endpoints
- [ ] Implement all POST endpoints
- [ ] Implement WebSocket message handlers
- [ ] Add CORS support
- [ ] Test with browser extension

### Phase 2: LLM
- [ ] Add llama-cpp-2 dependency
- [ ] Implement model management
- [ ] Implement chat completion
- [ ] Implement streaming
- [ ] Implement summarize/categorize tasks
- [ ] Test with existing models

### Phase 3: Integration
- [ ] Spawn server on app startup
- [ ] Remove Node.js sidecar
- [ ] Update tauri.conf.json
- [ ] Test full application
- [ ] Update documentation

---

## File Size Comparison (Estimated)

| Component | Node.js | Rust |
|-----------|---------|------|
| Server code | ~50KB | ~200KB (compiled) |
| Node.js runtime | ~40MB | 0 |
| llama.cpp bindings | ~5MB | ~2MB |
| **Total additional** | **~45MB** | **~2MB** |

---

## Recommendation

**Start with Phase 1** - This gives immediate benefits:
- Removes Node.js dependency for sync server
- Simpler distribution
- Can keep Node.js LLM as fallback while Phase 2 is developed

**Timeline:**
- Phase 1: 2-3 days
- Phase 2: 3-4 days
- Phase 3: 1 day
- **Total: ~1 week**

---

## Alternative: Hybrid Approach

If LLM migration is too risky, consider:

1. **Migrate only sync server to Rust** (Phase 1)
2. **Keep LLM in separate Node.js process** (optional sidecar)
3. **Communicate via HTTP** between Rust server and Node LLM

This reduces risk while still eliminating Node.js for core functionality.
