# Learning Web Development in Rust
### Based on the CoolDesk codebase — for Java developers

This guide uses real code from `src-tauri/src/` to teach Rust web concepts.
You already know Java and DSA — this guide leans on that constantly.

---

## Table of Contents

1. [Rust vs Java: The Mental Model Shift](#1-rust-vs-java-the-mental-model-shift)
2. [Ownership and Borrowing](#2-ownership-and-borrowing)
3. [Structs and Traits (Java Classes and Interfaces)](#3-structs-and-traits)
4. [Enums and Pattern Matching](#4-enums-and-pattern-matching)
5. [Error Handling with Result](#5-error-handling-with-result)
6. [Option: Null Done Right](#6-option-null-done-right)
7. [Async/Await and Tokio](#7-asyncawait-and-tokio)
8. [Shared State with Arc and RwLock](#8-shared-state-with-arc-and-rwlock)
9. [JSON with Serde](#9-json-with-serde)
10. [Building HTTP APIs with Axum](#10-building-http-apis-with-axum)
11. [WebSockets](#11-websockets)
12. [Dependency Management with Cargo](#12-dependency-management-with-cargo)

---

## 1. Rust vs Java: The Mental Model Shift

### Java's approach
In Java, the JVM manages memory for you. Objects live on the heap, the GC collects them. You share objects freely with references.

```java
List<String> list = new ArrayList<>();
list.add("hello");
doSomething(list); // Java passes a reference — both caller and callee share it
```

### Rust's approach
Rust has **no garbage collector**. The compiler tracks who *owns* each value and frees memory automatically when the owner goes out of scope. This is called **ownership**.

```rust
let list: Vec<String> = vec!["hello".to_string()];
do_something(list); // list is MOVED into the function — you can't use it after this
```

> **Key insight**: Java has references everywhere. Rust has one owner at a time. To share, you *borrow* (`&T`) or clone.

### Why it matters for web dev
- No GC pauses → predictable latency
- No data races → the compiler prevents them
- You pay close attention to *who owns* shared state (like your HTTP server's `AppState`)

---

## 2. Ownership and Borrowing

### The three rules
1. Each value has exactly one owner.
2. When the owner goes out of scope, the value is dropped (freed).
3. You can have many immutable borrows (`&T`) OR one mutable borrow (`&mut T`) — never both at once.

### In your code

**`handlers.rs:614`** — `params.q.unwrap_or_default()` takes ownership of `q` out of `params`.

**`handlers.rs:628`** — Reading the global cache:
```rust
let cached = crate::APP_CACHE.read().ok()
    .map(|c| c.clone())   // clone() — we can't keep the read guard open, so we copy the data out
    .unwrap_or_default();
```

Java equivalent: `List<Value> cached = new ArrayList<>(APP_CACHE);`  
Why clone? Because the `RwLock` read guard would hold the lock for the whole function. Cloning lets us drop the lock fast.

### Borrowing vs moving

```rust
// BORROW — caller still owns `name` after this
let score = fuzzy_score(&name, &query);  // handlers.rs:652

// MOVE — takes ownership
let result = do_something(name);         // name is gone from this scope
```

`&str` in function signatures = "I just want to look at this string, not own it." Think of it like a read-only view in Java.

---

## 3. Structs and Traits

### Java class → Rust struct + impl

Java:
```java
public class AppState {
    private SyncData syncData;
    public AppState(BroadcastSender tx) { ... }
    public void broadcast(String type, JsonNode payload) { ... }
}
```

Rust (`handlers.rs:18`):
```rust
pub struct AppState {
    pub sync_data: Arc<RwLock<SyncData>>,
    pub ws_broadcast: tokio::sync::broadcast::Sender<String>,
    pub pending_jumps: Arc<std::sync::Mutex<VecDeque<serde_json::Value>>>,
}

impl AppState {
    pub fn new(ws_broadcast: tokio::sync::broadcast::Sender<String>) -> Self { ... }
    pub fn broadcast(&self, msg_type: &str, payload: serde_json::Value) { ... }
}
```

`impl` blocks are where methods live. `&self` = Java's `this` (read-only). `&mut self` = mutable access.

### Traits (Java Interfaces)

```rust
// Like Java: interface Serialize { String toJson(); }
// Rust:
#[derive(serde::Serialize)]
pub struct SearchFileResult {
    pub path: String,
    pub date: String,
}
```

`#[derive(...)]` auto-generates trait implementations. `Serialize` from `serde` is like `JsonSerializable` — it lets the type be converted to JSON. Your `lib.rs:344` uses this.

### Visibility

| Java | Rust |
|------|------|
| `public` | `pub` |
| `private` (default) | no keyword (default) |
| `protected` | `pub(super)` |
| package-private | `pub(crate)` |

---

## 4. Enums and Pattern Matching

### Java enums are simple. Rust enums carry data.

Java:
```java
enum Status { OK, ERROR }
```

Rust:
```rust
// Each variant can hold different data
enum Result<T, E> {
    Ok(T),   // success — carries the value
    Err(E),  // failure — carries the error
}
```

This is the most important enum in Rust — it's how every function signals success or failure.

### Pattern matching = switch on steroids

Your `server.rs:425` — the WebSocket message dispatcher:
```rust
match msg.msg_type.as_str() {
    "push-tabs"      => { /* handle tabs */ }
    "push-workspaces"=> { /* handle workspaces */ }
    "llm-chat"       => { /* handle LLM */ }
    _                => { /* default case */ }
}
```

Java equivalent:
```java
switch (msg.getMsgType()) {
    case "push-tabs": ...
    case "push-workspaces": ...
    default: ...
}
```

But Rust's `match` is exhaustive — the compiler **errors** if you miss a case.

### Destructuring in match

`handlers.rs:280`:
```rust
let (node_type, id_prefix, edge_type) = if app_type == "folder" || ... {
    ("folder", "folder", "folder_in_workspace")
} else if app_type == "file" {
    ("file", "file", "file_in_workspace")
} else {
    ("app", "app", "app_in_workspace")
};
```

In Rust, `if` is an *expression* — it returns a value. No need for a ternary operator.

---

## 5. Error Handling with Result

### Java throws exceptions. Rust returns errors.

Java:
```java
public SyncData parseJson(String json) throws IOException { ... }
```

Rust:
```rust
fn parse_json(json: &str) -> Result<SyncData, serde_json::Error> { ... }
```

The caller *must* handle the error — no unchecked exceptions.

### The `?` operator

`lib.rs:57`:
```rust
std::fs::write(&scan_file, &scan_output.stdout)
    .map_err(|e| format!("Failed to write temp file: {}", e))?;
```

`?` means: "if this is `Err`, return early from this function with that error." It's equivalent to:
```java
try {
    Files.write(scanFile, data);
} catch (IOException e) {
    throw new RuntimeException("Failed to write temp file: " + e.getMessage());
}
```

### map_err

`lib.rs:44`:
```rust
app.shell().sidecar("AppScanner")
    .map_err(|e| format!("AppScanner sidecar not found: {}", e))?
```

`map_err` converts the error type. Think of it as `.catch(e -> new MyException(e))` in Java streams.

### Common patterns

```rust
// Return early on error
let result = risky_operation()?;

// Provide a default value on error
let value = risky_operation().unwrap_or_default();
let value = risky_operation().unwrap_or(42);

// Log and continue
if let Err(e) = risky_operation() {
    log::warn!("Failed: {}", e);
}
```

---

## 6. Option: Null Done Right

`Option<T>` replaces `null`. There is no `null` in Rust.

```rust
enum Option<T> {
    Some(T),  // has a value
    None,     // no value
}
```

### In your code

`handlers.rs:199`:
```rust
pub fn extract_editor_project(app_name: &str, title: &str) -> Option<String> {
    let is_editor = EDITOR_NAME_PATTERNS.iter().any(|p| name_lower.contains(p));
    if !is_editor { return None; }       // like returning null in Java
    // ...
    Some(project.to_string())            // like returning the value in Java
}
```

Usage (`server.rs:99`):
```rust
if let Some(proj) = extract_editor_project(&app.name, &app.title) {
    // proj is a String here — unwrapped safely
}
```

`if let Some(x) = option` is idiomatic Rust for "if this Option has a value, bind it to x."

Java equivalent:
```java
Optional<String> proj = extractEditorProject(app.name, app.title);
proj.ifPresent(p -> { /* use p */ });
```

### Chaining with `and_then`

`server.rs:312`:
```rust
match headers.get("origin").and_then(|v| v.to_str().ok()) {
    Some(origin) => ALLOWED_PREFIXES.iter().any(|prefix| origin.starts_with(prefix)),
    None => true,
}
```

`and_then` on `Option` = `flatMap` in Java streams. It chains operations that might fail.

---

## 7. Async/Await and Tokio

### Java threads vs Rust async

Java uses OS threads (Spring's `@Async`, `ExecutorService`). Rust uses **async tasks** — lightweight, not OS threads. Many tasks run on a small thread pool. This is why your server handles many connections with low memory.

The runtime is **Tokio** (declared in `Cargo.toml:37`):
```toml
tokio = { version = "1", features = ["full"] }
```

### async fn

Any function that does I/O should be `async`:

`handlers.rs:111`:
```rust
pub async fn get_workspaces(State(state): State<Arc<AppState>>) -> Json<Vec<Workspace>> {
    let data = state.sync_data.read().await;  // await = suspend until the lock is available
    Json(data.workspaces.clone())
}
```

Java equivalent with Spring:
```java
@GetMapping("/workspaces")
public CompletableFuture<List<Workspace>> getWorkspaces() {
    return CompletableFuture.supplyAsync(() -> state.getWorkspaces());
}
```

### Spawning background tasks

`server.rs:35` — the tab polling loop:
```rust
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;  // wait 30s without blocking a thread
        tab_poll_state.broadcast("request-tabs", serde_json::json!({}));
    }
});
```

Java: `ScheduledExecutorService.scheduleAtFixedRate(...)`. Tokio's version is more efficient — the task suspends during `tick().await` and uses zero CPU.

### `move` closures

`server.rs:35` uses `async move`. `move` means the closure takes *ownership* of all captured variables (`tab_poll_state` here), so they can live beyond the current function's scope. Required for async tasks since they might outlive their spawning function.

### tokio::select!

`server.rs:395`:
```rust
tokio::select! {
    _ = &mut send_task => recv_task.abort(),
    _ = &mut recv_task => send_task.abort(),
}
```

"Run both tasks. When the first one finishes, cancel the other." This is how WebSocket connections are managed cleanly. Java doesn't have a direct equivalent — you'd use `CompletableFuture.anyOf`.

---

## 8. Shared State with Arc and RwLock

### The problem

Your server handles many concurrent requests. They all need to read/write `SyncData`. In Java, you'd use `synchronized` or `ReadWriteLock`. Rust enforces the same at compile time.

### Arc — Atomic Reference Counting

```
Arc<T>  ≈  Java's shared reference / AtomicReference
```

`Arc` lets multiple owners share one value. Each clone increments a counter; when all clones drop, the value is freed.

`handlers.rs:19`:
```rust
pub sync_data: Arc<RwLock<SyncData>>,
```

In `server.rs:30`:
```rust
let state = Arc::new(AppState::new(ws_tx.clone()));
// Now we can .clone() the Arc cheaply and pass it to multiple tasks
```

### RwLock — Read-Write Lock

```
RwLock<T>  ≈  Java's ReadWriteLock
```

Many readers OR one writer. Prevents data races:

```rust
// Read (many simultaneous readers OK)
let data = state.sync_data.read().await;
Json(data.workspaces.clone())

// Write (exclusive — blocks all readers)
let mut data = state.sync_data.write().await;
data.workspaces = merge_workspaces_by_name(...);
```

`handlers.rs:78`:
```rust
pub async fn save_and_broadcast_excluding(...) {
    {
        let data = self.sync_data.read().await;  // short read lock
        save_data(&data)?;
    }  // <- lock dropped here (end of block)
    // ... then broadcast without holding the lock
}
```

**Critical pattern**: Always drop locks as early as possible. The `{ }` block forces the lock to drop when the block ends. If you hold a write lock while doing I/O, you block all readers.

### Global singletons with lazy_static

`lib.rs:17`:
```rust
lazy_static::lazy_static! {
    pub static ref APP_CACHE: Arc<RwLock<Vec<serde_json::Value>>> =
        Arc::new(RwLock::new(Vec::new()));
}
```

Java equivalent:
```java
private static final ReadWriteLock APP_CACHE_LOCK = new ReentrantReadWriteLock();
private static final List<JsonNode> APP_CACHE = new ArrayList<>();
```

`lazy_static!` initializes the value on first access (like a lazy singleton in Java).

---

## 9. JSON with Serde

### Java uses Jackson. Rust uses Serde.

Add to `Cargo.toml`:
```toml
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

### Serialize / Deserialize

`handlers.rs:1082`:
```rust
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]      // maps snake_case fields to camelCase JSON keys
pub struct FullSyncRequest {
    #[serde(default)]                   // field is optional in JSON; use Default if missing
    pub workspaces: Option<Vec<Workspace>>,
    pub urls: Option<Vec<UrlEntry>>,
}
```

Java Jackson equivalent:
```java
public class FullSyncRequest {
    @JsonProperty("workspaces") private List<Workspace> workspaces;
    @JsonInclude(NON_NULL) ...
}
```

### Dynamic JSON with `serde_json::Value`

When you don't know the shape at compile time:

`handlers.rs:683`:
```rust
Some(serde_json::json!({
    "id": app["id"],
    "name": name,
    "score": score,
    "isRunning": is_running,
}))
```

`serde_json::json!()` is a macro that builds JSON at runtime — like `ObjectNode` in Jackson or `Map.of()` in Java.

### Deserializing from HTTP body

Axum does this automatically when you use `Json<T>` as a parameter:
```rust
pub async fn post_workspaces(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<Vec<Workspace>>,   // axum parses the body into Vec<Workspace> for you
) -> StatusCode { ... }
```

---

## 10. Building HTTP APIs with Axum

Axum is your web framework (like Spring MVC or JAX-RS in Java).

### Defining routes

`server.rs:211`:
```rust
let app = Router::new()
    .route("/health",     get(health))
    .route("/workspaces", get(get_workspaces).post(post_workspaces))
    .route("/search",     get(search_apps))
    .layer(cors)
    .with_state(state);   // inject shared state into all handlers
```

Spring equivalent:
```java
@RestController
@RequestMapping("/workspaces")
public class WorkspaceController {
    @GetMapping  public List<Workspace> getWorkspaces() { ... }
    @PostMapping public ResponseEntity<?> postWorkspaces(...) { ... }
}
```

### Handler function signature

Axum uses *extractors* — each parameter tells Axum how to extract it from the request:

```rust
pub async fn get_activity(
    State(state): State<Arc<AppState>>,  // extract shared state
    Query(query): Query<ActivityQuery>,  // extract ?since=123 query params
) -> Json<Vec<Activity>> {              // return type auto-serialized to JSON
```

| Extractor | What it extracts | Java equivalent |
|-----------|-----------------|-----------------|
| `State(s)` | Shared app state | `@Autowired` / DI |
| `Query(q)` | URL query params `?key=val` | `@RequestParam` |
| `Json(b)` | Request body parsed as JSON | `@RequestBody` |
| `Path(p)` | Path params `/items/:id` | `@PathVariable` |

### Response types

```rust
Json<T>          // 200 OK with JSON body
StatusCode       // just an HTTP status code
(StatusCode, Json<T>)  // status + body
Result<Json<T>, (StatusCode, Json<ErrorResponse>)>  // success or typed error
```

`handlers.rs:1042`:
```rust
pub async fn cmd_jump_to_tab(...) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    // ...
    Ok(Json(SuccessResponse { success: true }))
}
```

### CORS

`server.rs:205`:
```rust
let cors = CorsLayer::new()
    .allow_origin(allowed_origins)
    .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
    .allow_headers([header::CONTENT_TYPE]);
```

Axum uses *tower middleware layers* for cross-cutting concerns (CORS, auth, logging). Applied with `.layer(cors)` on the router.

---

## 11. WebSockets

WebSocket = persistent bidirectional connection. Your server uses it to push real-time updates to the Chrome extension.

### Upgrade handler

`server.rs:319`:
```rust
async fn ws_handler(
    headers: HeaderMap,
    ws: WebSocketUpgrade,               // Axum provides this if the request is a WS upgrade
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
        .into_response()
}
```

### Broadcast channel

`server.rs:27`:
```rust
let (ws_tx, _) = broadcast::channel::<String>(100);
```

This is a many-to-many channel: one sender, many receivers. Each WebSocket client subscribes:

`server.rs:349`:
```rust
let mut broadcast_rx = state.ws_broadcast.subscribe();
// ...
while let Ok(msg) = broadcast_rx.recv().await {
    sender.send(Message::Text(msg.into())).await?;
}
```

Java equivalent using Spring WebSocket:
```java
messagingTemplate.convertAndSend("/topic/updates", payload);
```

### Concurrent send/receive

`server.rs:374`:
```rust
let mut send_task = tokio::spawn(async move {
    // forward broadcast messages → this WebSocket client
});
let mut recv_task = tokio::spawn(async move {
    // receive messages from this WebSocket client
});
tokio::select! {        // when either finishes (client disconnects), kill the other
    _ = &mut send_task => recv_task.abort(),
    _ = &mut recv_task => send_task.abort(),
}
```

Two tasks per connection: one for sending, one for receiving. `select!` cleans up both when either fails.

---

## 12. Dependency Management with Cargo

Cargo = Maven/Gradle for Rust. `Cargo.toml` = `pom.xml`.

### `Cargo.toml` basics

```toml
[package]
name = "app"
version = "0.1.0"
edition = "2021"       # Rust edition — like Java LTS version

[dependencies]
axum = { version = "0.7", features = ["ws"] }   # opt-in features (like Maven classifiers)
tokio = { version = "1", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }

[dev-dependencies]
tempfile = "3.10"      # only in tests (like Maven test scope)

[[bin]]                # multiple binaries in one crate
name = "matcher"
path = "src/bin/matcher.rs"
```

### Optional features

`Cargo.toml:19`:
```toml
[features]
llm = ["llama-cpp-2"]   # cargo build --features llm to enable this
```

In code (`handlers.rs:1407`):
```rust
#[cfg(feature = "llm")]   // only compiled when --features llm is passed
pub async fn v2_chat(...) { ... }
```

Java equivalent: Maven profiles.

### Platform-specific deps

`Cargo.toml:78`:
```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [...] }

[target.'cfg(target_os = "macos")'.dependencies]
core-graphics = "0.23"
```

Compile-time OS detection. In code:
```rust
#[cfg(target_os = "windows")]
{ /* windows-only code */ }
#[cfg(target_os = "macos")]
{ /* macOS-only code */ }
```

---

## Putting It All Together

Here's the flow when the Chrome extension calls `GET /search?q=chrome`:

```
Chrome extension
    │
    │  HTTP GET /search?q=chrome
    ▼
server.rs  →  .route("/search", get(search_apps))
    │
    ▼
handlers.rs  →  search_apps(Query(params))
    │
    ├─ reads APP_CACHE (Arc<RwLock<Vec<Value>>>) — global app list
    │       crate::APP_CACHE.read().ok().map(|c| c.clone())
    │
    ├─ runs fuzzy_score(name, &query) for each app
    │       Rust port of your JS fuzzyScore — same algorithm you know
    │
    ├─ sorts by score (b.cmp(a) — descending)
    │
    └─ returns Json(serde_json::json!({ "results": results }))
            │
            ▼
        axum serializes → HTTP 200 response body
```

---

## Next Steps

Once you're comfortable with the above, explore:

1. **Lifetimes** — when `&T` isn't enough and you need `&'a T`. Rarely needed in web code.
2. **Traits in depth** — `Iterator`, `From`/`Into`, `Display`. Rust's standard library is trait-heavy.
3. **Closures** — you've seen them in `.map()`, `.filter()`. They capture by reference or move.
4. **Iterators** — `.iter().filter_map(...).collect()` replaces most for loops. Already used extensively in your handlers.
5. **Testing** — `cargo test`. Unit tests live in the same file with `#[cfg(test)]`.

### Recommended resources

- **The Rust Book** — [doc.rust-lang.org/book](https://doc.rust-lang.org/book) — free, thorough
- **Rust by Example** — [doc.rust-lang.org/rust-by-example](https://doc.rust-lang.org/rust-by-example)
- **Tokio tutorial** — [tokio.rs/tokio/tutorial](https://tokio.rs/tokio/tutorial)
- **Axum examples** — [github.com/tokio-rs/axum/tree/main/examples](https://github.com/tokio-rs/axum/tree/main/examples)
