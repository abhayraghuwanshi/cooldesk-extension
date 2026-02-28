# CoolDesk LLM v2 Agent Architecture

This document explains the architecture and data flow of the **LLM v2 Agent** implementation within the Rust sidecar of the CoolDesk extension.

## Overview

The CoolDesk Agent is a stateful, tool-augmented AI assistant running locally via `node-llama-cpp`. 
Unlike traditional systems where all user data is dumped directly into the AI's prompt context (often hitting token limits), this agent uses a **"Tool Calling" (Agents) architecture**, pulling in data dynamically exactly when needed via an injected reference to the shared frontend state.

The key components are located in `src-tauri/src/sidecar/llm_v2/`:
1. `agent.rs`: The main orchestration layer. It manages conversations, tool execution loops, and long-term memory.
2. `tools.rs`: The actual functions the LLM can decide to execute (e.g., searching workspaces or notes).
3. `memory.rs`: Manages short-term (chat history) and long-term (user facts) memory.
4. `client.rs`: Handles the HTTP interface with the local LLM running in Node.js.

## Architecture

```mermaid
graph TD
    User([User Chat Request]) --> A[Axum Server in server.rs]
    A --> B{CoolDeskAgent.chat()}
    
    subgraph "Rust Sidecar (src-tauri)"
        B --> C[MemoryManager]
        C -. "Fetch Session History & Facts" .-> B
        B --> D[PromptBuilder]
        D --> E[LocalLlamaClient]
        
        E -. "Returns JSON Tool Call\n<tool>search_notes</tool>" .-> B
        
        B --> F[ToolRegistry]
        F --> G[SearchNotesTool]
        
        %% The core trick
        H[(SyncData\nArc<RwLock>)] -. "Read Lock" .-> G
        G -. "Subset of Notes" .-> B
        
        B -. "Append tool response\nto history" .-> E
        E -. "Final Human Answer" .-> B
    end
    
    B --> Return([Response back through WebSocket/HTTP])
```

## How Data is Passed Safely

The major architectural choice here is that **raw data files and JSON lists are NOT passed to the LLM directly.** 

### 1. The `SyncData` Memory Store
All user data (notes, workspaces, URLs, pins, activity) that is synchronized from the extension front-end is held in memory in an `Arc<RwLock<SyncData>>`. This acts as a centralized, thread-safe cache.

### 2. Passing by Reference Context
When the `CoolDeskAgent` is instantiated inside the Axum server state, it is given a cloned ARC reference to this `SyncData`.
```rust
pub fn new(sync_data: Arc<RwLock<SyncData>>) -> Self {
    Self {
        // ...
        tools: ToolRegistry::with_defaults(sync_data),
    }
}
```

### 3. Tool Execution
The LLM is prompted with a list of available tools (provided by the `ToolRegistry`). When the LLM decides it needs information (e.g., the user says *"Find my notes about React"*), it generates a structured tool call command.

The Agent intercepts this, routes the arguments to `SearchNotesTool::execute()`, and **only then** does the tool acquire an asynchronous read-lock on `SyncData`.

```rust
// Inside SearchNotesTool::execute()
let data = self.sync_data.read().await;

let matching_notes: Vec<_> = data.notes.iter()
    .filter(|n| /* search logic */)
    .take(5) // Limit context size
    .collect();
```

### 4. Injecting the Result
The tool returns a formatted text string (e.g., a bulleted list of the top 5 notes). This string is appended to the conversation history as a `ChatMessage::tool_response(...)`. The conversation history is then sent *back* to the LLM so it can formulate the final, human-readable answer.

## File Map

- `src-tauri/src/sidecar/data.rs` - Defines `SyncData`, representing the centralized data shapes.
- `src-tauri/src/sidecar/llm_v2/agent.rs` - Orchestrates the loop: Chat -> LLM -> Tool Call -> Exec Tool -> LLM -> Answer.
- `src-tauri/src/sidecar/llm_v2/tools.rs` - Contains individual tool definitions (`SearchWorkspacesTool`, `WebSearchTool`, etc.) and the logic for pulling data slices out of `SyncData`.
- `src-tauri/src/sidecar/llm_v2/memory.rs` - Tracks the historical state across a session.
- `src-tauri/src/sidecar/server.rs` - Routes incoming WS/HTTP requests from the frontend down into the Agent API.
