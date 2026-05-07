// HTTP and WebSocket request handlers

use crate::sidecar::data::*;
use crate::sidecar::feedback::SuggestionStats;
use crate::sidecar::storage::{save_data, ChangeTracker};
use crate::sidecar::sync::*;
use crate::system::RunningApp;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Shared application state
pub struct AppState {
    pub sync_data: Arc<RwLock<SyncData>>,
    pub change_tracker: Arc<RwLock<ChangeTracker>>,
    pub ws_broadcast: tokio::sync::broadcast::Sender<String>,
    /// Pending jump-to-tab actions for HTTP polling fallback.
    /// Extensions poll GET /cmd/jump-next to dequeue and handle them.
    pub pending_jumps: Arc<std::sync::Mutex<VecDeque<serde_json::Value>>>,
}

impl AppState {
    pub fn new(ws_broadcast: tokio::sync::broadcast::Sender<String>) -> Self {
        let mut data = crate::sidecar::storage::load_data();

        // Pre-populate device_tabs_map from persisted tabs so that when only
        // one browser pushes fresh tabs on startup, the other browsers' persisted
        // tabs are not wiped from data.tabs until they reconnect and push their own.
        for tab in &data.tabs {
            if let Some(device_id) = &tab.device_id {
                data.device_tabs_map
                    .entry(device_id.clone())
                    .or_default()
                    .push(tab.clone());
            }
        }

        Self {
            sync_data: Arc::new(RwLock::new(data)),
            change_tracker: Arc::new(RwLock::new(ChangeTracker::new())),
            ws_broadcast,
            pending_jumps: Arc::new(std::sync::Mutex::new(VecDeque::new())),
        }
    }

    /// Broadcast message to all WebSocket clients
    pub fn broadcast(&self, msg_type: &str, payload: serde_json::Value) {
        let msg = WsMessage::new(msg_type, payload);
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = self.ws_broadcast.send(json);
        }
    }

    /// Broadcast message excluding a specific client (sender)
    pub fn broadcast_excluding(&self, msg_type: &str, payload: serde_json::Value, exclude_client: &str) {
        let mut msg = WsMessage::new(msg_type, payload);
        // Include the client to exclude - clients will check this and skip if it matches their ID
        msg.client_id = Some(format!("exclude:{}", exclude_client));
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = self.ws_broadcast.send(json);
        }
    }

    /// Save data and broadcast update
    pub async fn save_and_broadcast(&self, data_type: &str, payload: serde_json::Value) {
        self.save_and_broadcast_excluding(data_type, payload, None).await;
    }

    /// Save data and broadcast update, optionally excluding a client
    pub async fn save_and_broadcast_excluding(&self, data_type: &str, payload: serde_json::Value, exclude_client: Option<&str>) {
        // Save to disk
        {
            let data = self.sync_data.read().await;
            if let Err(e) = save_data(&data) {
                log::warn!("[Sidecar] Failed to save: {}", e);
            }
        }

        // Check for changes before broadcasting
        let should_broadcast = {
            let mut tracker = self.change_tracker.write().await;
            tracker.has_changed(data_type, &payload)
        };

        if should_broadcast {
            if let Some(client_id) = exclude_client {
                self.broadcast_excluding(&format!("{}-updated", data_type), payload, client_id);
            } else {
                self.broadcast(&format!("{}-updated", data_type), payload);
            }
        }
    }
}

// ==========================================
// GET Handlers
// ==========================================

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        timestamp: chrono::Utc::now().timestamp_millis(),
    })
}

pub async fn get_workspaces(State(state): State<Arc<AppState>>) -> Json<Vec<Workspace>> {
    let data = state.sync_data.read().await;
    Json(data.workspaces.clone())
}

pub async fn get_urls(State(state): State<Arc<AppState>>) -> Json<Vec<UrlEntry>> {
    let data = state.sync_data.read().await;
    Json(data.urls.clone())
}

pub async fn get_tabs(State(state): State<Arc<AppState>>) -> Json<Vec<Tab>> {
    let data = state.sync_data.read().await;
    Json(data.tabs.clone())
}

pub async fn get_settings(
    State(state): State<Arc<AppState>>,
) -> Json<HashMap<String, serde_json::Value>> {
    let data = state.sync_data.read().await;
    Json(data.settings.clone())
}

pub async fn get_notes(State(state): State<Arc<AppState>>) -> Json<Vec<Note>> {
    let data = state.sync_data.read().await;
    log::info!("[Sidecar] HTTP GET /notes returning {} notes", data.notes.len());
    Json(data.notes.clone())
}

pub async fn get_url_notes(State(state): State<Arc<AppState>>) -> Json<Vec<UrlNote>> {
    let data = state.sync_data.read().await;
    Json(data.url_notes.clone())
}

pub async fn get_pins(State(state): State<Arc<AppState>>) -> Json<Vec<Pin>> {
    let data = state.sync_data.read().await;
    Json(data.pins.clone())
}

pub async fn get_scraped_chats(State(state): State<Arc<AppState>>) -> Json<Vec<ScrapedChat>> {
    let data = state.sync_data.read().await;
    Json(data.scraped_chats.clone())
}

pub async fn get_scraped_configs(State(state): State<Arc<AppState>>) -> Json<Vec<ScrapedConfig>> {
    let data = state.sync_data.read().await;
    Json(data.scraped_configs.clone())
}

pub async fn get_daily_memory(State(state): State<Arc<AppState>>) -> Json<Vec<DailyMemory>> {
    let data = state.sync_data.read().await;
    Json(data.daily_memory.clone())
}

pub async fn get_ui_state(
    State(state): State<Arc<AppState>>,
) -> Json<HashMap<String, serde_json::Value>> {
    let data = state.sync_data.read().await;
    Json(data.ui_state.clone())
}

pub async fn get_dashboard(
    State(state): State<Arc<AppState>>,
) -> Json<HashMap<String, serde_json::Value>> {
    let data = state.sync_data.read().await;
    Json(data.dashboard.clone())
}

// ── Knowledge Graph ───────────────────────────────────────────────────────────

const EDITOR_APP_TYPES: &[&str] = &[
    "vscode", "cursor", "windsurf", "idea", "webstorm", "pycharm",
    "goland", "phpstorm", "rider", "clion", "rubymine", "fleet", "zed", "sublime",
];

const EDITOR_NAME_PATTERNS: &[&str] = &[
    "visual studio code", "code", "cursor", "windsurf",
    "intellij idea", "webstorm", "pycharm", "goland",
];

const MEDIA_APP_PATTERNS: &[&str] = &[
    "spotify", "music", "vlc", "foobar", "winamp", "tidal", "deezer",
    "youtube music", "apple music", "soundcloud",
];

/// Extract the open project name from an editor's window title.
/// VS Code format: "filename — project — Visual Studio Code"
pub fn extract_editor_project(app_name: &str, title: &str) -> Option<String> {
    let name_lower = app_name.to_lowercase();
    let is_editor = EDITOR_NAME_PATTERNS.iter().any(|p| name_lower.contains(p));
    if !is_editor { return None; }

    let parts: Vec<&str> = title.split(" — ").collect();
    if parts.len() < 2 { return None; }

    let project = parts[parts.len() - 2]
        .trim()
        .trim_start_matches(['●', '•', ' '])
        .trim_end_matches(" (Workspace)")
        .trim();

    if !project.is_empty() && project.len() < 60 {
        Some(project.to_string())
    } else {
        None
    }
}

/// Called by the background snapshot loop — records all pairwise co-occurrences.
pub async fn record_session_snapshot(items: Vec<String>) {
    let store_mutex = get_feedback_store().await;
    let guard = store_mutex.lock().await;
    if let Some(store) = guard.as_ref() {
        store.record_snapshot(items).await;
    }
}

fn normalize_url_for_graph(url: &str) -> String {
    // Domain-only so workspace URLs ("github.com/user/repo") and snapshot URLs
    // ("github.com") resolve to the same node ID, enabling app↔url edges.
    if let Ok(parsed) = url::Url::parse(url) {
        let host = parsed.host_str().unwrap_or(url);
        host.strip_prefix("www.").unwrap_or(host).to_lowercase()
    } else {
        log::warn!("[graph] malformed URL in graph normalization: {}", &url[..url.len().min(80)]);
        format!("raw::{}", url.to_lowercase())
    }
}

pub async fn get_graph(State(state): State<Arc<AppState>>) -> Json<GraphResponse> {
    use std::collections::HashMap;

    let mut nodes: HashMap<String, GraphNode> = HashMap::new();
    let mut edges: Vec<GraphEdge> = Vec::new();

    // ── Pass 1: Workspaces → URL / App / Folder / File nodes + membership edges ──
    {
        let data = state.sync_data.read().await;
        for ws in &data.workspaces {
            let ws_id = format!("ws::{}", ws.name.to_lowercase());
            let url_count = ws.urls.len() as u32;
            let app_count = ws.apps.len() as u32;
            nodes.entry(ws_id.clone()).or_insert_with(|| GraphNode {
                id: ws_id.clone(),
                node_type: "workspace".to_string(),
                label: ws.name.clone(),
                title: None,
                weight: url_count + app_count,
            });

            for wu in &ws.urls {
                let norm = normalize_url_for_graph(&wu.url);
                let url_id = format!("url::{}", norm);
                let entry = nodes.entry(url_id.clone()).or_insert_with(|| GraphNode {
                    id: url_id.clone(),
                    node_type: "url".to_string(),
                    label: norm.clone(),
                    title: wu.title.clone(),
                    weight: 0,
                });
                entry.weight = entry.weight.saturating_add(1);
                edges.push(GraphEdge {
                    source: url_id,
                    target: ws_id.clone(),
                    edge_type: "url_in_workspace".to_string(), weight: 1.0, last_seen: None,
                });
            }

            for app in &ws.apps {
                let app_type = app.app_type.as_deref().unwrap_or("default");
                let (node_type, id_prefix, edge_type) = if app_type == "folder" || EDITOR_APP_TYPES.contains(&app_type) {
                    ("folder", "folder", "folder_in_workspace")
                } else if app_type == "file" {
                    ("file", "file", "file_in_workspace")
                } else {
                    ("app", "app", "app_in_workspace")
                };

                let node_id = format!("{}::{}", id_prefix, app.name.to_lowercase());
                let entry = nodes.entry(node_id.clone()).or_insert_with(|| GraphNode {
                    id: node_id.clone(),
                    node_type: node_type.to_string(),
                    label: app.name.clone(),
                    title: Some(app.path.clone()),
                    weight: 0,
                });
                entry.weight = entry.weight.saturating_add(1);
                edges.push(GraphEdge {
                    source: node_id,
                    target: ws_id.clone(),
                    edge_type: edge_type.to_string(),
                    weight: 1.0,
                    last_seen: None,
                });
            }
        }
    } // sync_data lock dropped

    // ── Pass 2, 3 & 4: FeedbackStore data ──
    // Clone everything out under one short lock window, then drop the mutex.
    let (co_occurrences, assocs, item_co_occurrences) = {
        let store_mutex = get_feedback_store().await;
        let store_guard = store_mutex.lock().await;
        if let Some(store) = store_guard.as_ref() {
            let co    = store.get_all_co_occurrences().await;
            let asc   = store.get_all_app_workspace_associations().await;
            let items = store.get_all_item_co_occurrences().await;
            (co, asc, items)
        } else {
            (vec![], vec![], vec![])
        }
        // store_guard (outer mutex) dropped here
    };

    // Pass 2: URL co-occurrence edges
    for co in &co_occurrences {
        let score = co.affinity_score();
        if score <= 0.0 { continue; }

        let src_id = format!("url::{}", co.url1);
        let tgt_id = format!("url::{}", co.url2);

        nodes.entry(src_id.clone()).or_insert_with(|| GraphNode {
            id: src_id.clone(), node_type: "url".to_string(),
            label: co.url1.clone(), title: None, weight: 0,
        });
        nodes.entry(tgt_id.clone()).or_insert_with(|| GraphNode {
            id: tgt_id.clone(), node_type: "url".to_string(),
            label: co.url2.clone(), title: None, weight: 0,
        });

        edges.push(GraphEdge {
            source: src_id,
            target: tgt_id,
            edge_type: "co_occurrence".to_string(),
            weight: score.min(1.0),
            last_seen: None,
        });
    }

    // Pass 3: App-workspace associations
    for assoc in &assocs {
        let app_id = format!("app::{}", assoc.app_name);
        let ws_id  = format!("ws::{}", assoc.workspace_name);

        if !nodes.contains_key(&ws_id) { continue; }

        let entry = nodes.entry(app_id.clone()).or_insert_with(|| GraphNode {
            id: app_id.clone(), node_type: "app".to_string(),
            label: assoc.app_name.clone(), title: None, weight: 0,
        });
        entry.weight = entry.weight.saturating_add(1); // degree: +1 per workspace association

        let w = (assoc.score().min(5.0) / 5.0).max(0.01);
        edges.push(GraphEdge {
            source: app_id,
            target: ws_id,
            edge_type: "app_in_workspace".to_string(),
            weight: w,
            last_seen: None,
        });
    }

    // ── Pass 4: Cross-type item co-occurrences from session snapshots ──
    for co in &item_co_occurrences {
        let score = co.score();
        if score <= 0.0 || co.session_count < 2 { continue; } // filter one-off noise

        let node_type_from_id = |id: &str| -> &'static str {
            if id.starts_with("url::") { "url" }
            else if id.starts_with("folder::") { "folder" }
            else if id.starts_with("file::") { "file" }
            else if id.starts_with("media::") { "media" }
            else { "app" }
        };

        let label_from_id = |id: &str| -> String {
            id.splitn(2, "::").nth(1).unwrap_or(id).replace('_', " ").to_string()
        };

        for item_id in [&co.item1, &co.item2] {
            let entry = nodes.entry(item_id.clone()).or_insert_with(|| GraphNode {
                id: item_id.clone(),
                node_type: node_type_from_id(item_id).to_string(),
                label: label_from_id(item_id),
                title: None,
                weight: 0,
            });
            // Weight = degree (number of unique connections), not accumulated session counts.
            // This keeps weights bounded (max = number of distinct co-occurring items).
            entry.weight = entry.weight.saturating_add(1);
        }

        edges.push(GraphEdge {
            source: co.item1.clone(),
            target: co.item2.clone(),
            edge_type: "session_co_occurrence".to_string(),
            weight: (score / 5.0).min(1.0),
            last_seen: Some(co.last_seen),
        });
    }

    // ── Pass 5: Workspace bridge edges ───────────────────────────────────────
    // Two workspaces that share a URL or app are implicitly related.
    // Draw a weak link between them so the graph is a connected web, not isolated stars.
    {
        use std::collections::HashSet;
        // Build: ws_id → set of connected resource node IDs
        let mut ws_resources: std::collections::HashMap<String, HashSet<String>> = nodes
            .values()
            .filter(|n| n.node_type == "workspace")
            .map(|n| (n.id.clone(), HashSet::new()))
            .collect();

        for edge in &edges {
            if matches!(
                edge.edge_type.as_str(),
                "url_in_workspace" | "app_in_workspace" | "folder_in_workspace"
            ) {
                if let Some(set) = ws_resources.get_mut(&edge.target) {
                    set.insert(edge.source.clone());
                }
            }
        }

        let ws_ids: Vec<String> = ws_resources.keys().cloned().collect();
        for i in 0..ws_ids.len() {
            for j in (i + 1)..ws_ids.len() {
                let shared = ws_resources[&ws_ids[i]]
                    .intersection(&ws_resources[&ws_ids[j]])
                    .count();
                if shared > 0 {
                    edges.push(GraphEdge {
                        source: ws_ids[i].clone(),
                        target: ws_ids[j].clone(),
                        edge_type: "shared_resource".to_string(),
                        weight: (shared as f64 / 5.0).min(1.0),
                        last_seen: None,
                    });
                }
            }
        }
    }

    // ── Trim: cap node counts to keep the graph readable ──
    let mut url_nodes: Vec<_> = nodes.values()
        .filter(|n| n.node_type == "url")
        .cloned()
        .collect();
    url_nodes.sort_by(|a, b| b.weight.cmp(&a.weight));
    let keep_urls: std::collections::HashSet<String> = url_nodes
        .into_iter().take(200).map(|n| n.id).collect();

    let mut app_nodes: Vec<_> = nodes.values()
        .filter(|n| n.node_type == "app")
        .cloned()
        .collect();
    app_nodes.sort_by(|a, b| b.weight.cmp(&a.weight));
    let keep_apps: std::collections::HashSet<String> = app_nodes
        .into_iter().take(50).map(|n| n.id).collect();

    nodes.retain(|id, n| match n.node_type.as_str() {
        "url"  => keep_urls.contains(id),
        "app"  => keep_apps.contains(id),
        _      => true, // keep all workspaces, folders, files, media
    });

    let node_ids: std::collections::HashSet<_> = nodes.keys().cloned().collect();
    edges.retain(|e| node_ids.contains(&e.source) && node_ids.contains(&e.target));

    let node_count = nodes.len();
    let edge_count = edges.len();

    Json(GraphResponse {
        nodes: nodes.into_values().collect(),
        edges,
        meta: serde_json::json!({
            "generatedAt": chrono::Utc::now().timestamp_millis(),
            "nodeCount": node_count,
            "edgeCount": edge_count,
        }),
    })
}

#[derive(Debug, serde::Deserialize)]
pub struct ActivityQuery {
    since: Option<i64>,
}

pub async fn get_activity(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ActivityQuery>,
) -> Json<Vec<Activity>> {
    let data = state.sync_data.read().await;
    let activity = if let Some(since) = query.since {
        data.activity
            .iter()
            .filter(|a| a.timestamp.unwrap_or(0) > since)
            .cloned()
            .collect()
    } else {
        data.activity.clone()
    };
    Json(activity)
}

pub async fn get_focused_app() -> Json<serde_json::Value> {
    if let Some(app) = crate::system::get_focused_app_info().await {
        Json(serde_json::to_value(app).unwrap_or(serde_json::Value::Null))
    } else {
        Json(serde_json::Value::Null)
    }
}

pub async fn get_visible_apps() -> Json<Vec<RunningApp>> {
    Json(crate::system::get_visible_apps_info().await)
}

/// Get ALL apps across all virtual desktops (not just current)
pub async fn get_all_desktop_apps() -> Json<Vec<RunningApp>> {
    Json(crate::system::get_all_desktop_apps_info().await)
}

/// Search apps by query — fuzzy match against installed+running list
/// GET /search?q=chrome&limit=10
#[derive(Debug, serde::Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub limit: Option<usize>,
}

/// Calculate RL-based boost for an app based on feedback history
/// Returns a score boost (0-15 points) based on acceptance rate and usage
fn calculate_rl_boost(app_name: &str, app_stats: &std::collections::HashMap<String, SuggestionStats>) -> u32 {
    let key = app_name.to_lowercase().trim().replace(".exe", "").replace(" ", "_");

    if let Some(stats) = app_stats.get(&key) {
        if stats.total_shown == 0 {
            return 0;
        }

        // Boost based on acceptance rate (max 10 points)
        let acceptance_boost = (stats.acceptance_rate() * 10.0) as u32;

        // Small boost for frequently used apps (max 5 points, log scale)
        let usage_boost = ((stats.total_shown as f64).ln().min(5.0)) as u32;

        acceptance_boost + usage_boost
    } else {
        0
    }
}

/// Port of the JS fuzzyScore function — returns 0-100
fn fuzzy_score(text: &str, query: &str) -> u32 {
    if text.is_empty() || query.is_empty() { return 0; }

    let tl = text.to_lowercase();
    let ql = query.to_lowercase();

    if tl == ql { return 100; }
    if tl.starts_with(&ql) { return 95; }

    let t_words: Vec<&str> = tl.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    let q_words: Vec<&str> = ql.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();

    // Word boundary: single-word query starts a word in text
    if q_words.len() == 1 && t_words.iter().any(|w| w.starts_with(ql.as_str())) { return 90; }

    // Acronym: "vsc" → "Visual Studio Code"
    if ql.len() >= 2 && t_words.len() > 1 {
        let acronym: String = t_words.iter().filter_map(|w| w.chars().next()).collect();
        if acronym == ql { return 85; }
        if acronym.starts_with(ql.as_str()) { return 82; }
    }

    // Contains full query
    if tl.contains(ql.as_str()) { return 75; }

    // All query words appear in text
    if q_words.len() > 1 {
        let all_match = q_words.iter().all(|qw| tl.contains(qw) || t_words.iter().any(|tw| tw.starts_with(qw)));
        if all_match { return 65; }
    }

    // Query is substring of a word
    if t_words.iter().any(|w| w.contains(ql.as_str())) { return 60; }

    // Character sequence match (fuzzy)
    let q_chars: Vec<char> = ql.chars().collect();
    let mut qi = 0usize;
    for tc in tl.chars() {
        if qi < q_chars.len() && tc == q_chars[qi] { qi += 1; }
    }
    if qi == q_chars.len() {
        let tlen = tl.chars().count().max(1) as u32;
        return 30 + (q_chars.len() as u32 * 10 / tlen).min(20);
    }

    0
}

pub async fn search_apps(Query(params): Query<SearchQuery>) -> Json<serde_json::Value> {
    let query = params.q.unwrap_or_default();
    let limit = params.limit.unwrap_or(20);

    // Load app feedback stats for RL-based boosting
    let app_stats = {
        let store_mutex = get_feedback_store().await;
        let store_guard = store_mutex.lock().await;
        if let Some(store) = store_guard.as_ref() {
            store.get_all_app_stats().await
        } else {
            std::collections::HashMap::new()
        }
    };

    // Try the populated AppMatcher cache first (full installed + running list)
    let cached = crate::APP_CACHE.read().ok()
        .map(|c| c.clone())
        .unwrap_or_default();

    let source;
    let mut results: Vec<serde_json::Value> = if !cached.is_empty() {
        source = "cache";
        cached.iter().filter_map(|app| {
            let name  = app["name"].as_str().unwrap_or("");
            let title = app["title"].as_str().unwrap_or("");

            if query.is_empty() {
                // No query: return running apps only
                if !app["isRunning"].as_bool().unwrap_or(false) { return None; }
                return Some(serde_json::json!({
                    "id": app["id"], "name": name, "title": title,
                    "titles": app["titles"],
                    "path": app["path"], "pid": app["pid"], "hwnd": app["hwnd"], "score": 100,
                    "isRunning": true, "isVisible": app["isVisible"],
                    "cloaked": app["cloaked"], "isOnCurrentDesktop": app["isOnCurrentDesktop"],
                    "icon": app["icon"], "source": app["source"],
                }));
            }

            let name_score  = fuzzy_score(name, &query);
            let title_score = fuzzy_score(title, &query);
            // Also score against each individual window title (multi-window Electron apps)
            let titles_score = app["titles"].as_array()
                .map(|arr| arr.iter()
                    .filter_map(|t| t.as_str())
                    .map(|t| fuzzy_score(t, &query))
                    .max()
                    .unwrap_or(0))
                .unwrap_or(0);
            let match_score = name_score.max(title_score).max(titles_score);
            if match_score == 0 { return None; }

            let is_running = app["isRunning"].as_bool().unwrap_or(false);
            let is_visible = app["isVisible"].as_bool().unwrap_or(false);
            let cloaked    = app["cloaked"].as_i64().unwrap_or(0);

            // Base score from running/visibility status
            let base_score: u32 = if is_running {
                if is_visible && cloaked == 0 { match_score.max(85) + 15 }
                else if cloaked > 0           { match_score.max(80) + 12 }
                else                          { match_score.max(75) + 10 }
            } else {
                match_score.min(75)
            };

            // Apply RL boost based on user feedback history
            let rl_boost = calculate_rl_boost(name, &app_stats);
            let score = (base_score + rl_boost).min(100);

            Some(serde_json::json!({
                "id": app["id"], "name": name, "title": title,
                "titles": app["titles"],
                "path": app["path"], "pid": app["pid"], "hwnd": app["hwnd"],
                "score": score,
                "isRunning": is_running, "isVisible": is_visible,
                "cloaked": cloaked, "isOnCurrentDesktop": app["isOnCurrentDesktop"],
                "icon": app["icon"], "source": app["source"],
                "rlBoost": rl_boost,
            }))
        }).collect()
    } else {
        // Cache empty (first launch before Spotlight opened) — fallback to live running windows
        source = "live";
        let apps = crate::system::get_all_desktop_apps_info().await;
        apps.iter().filter_map(|a| {
            let base_score = fuzzy_score(&a.name, &query).max(fuzzy_score(&a.title, &query));
            if base_score == 0 && !query.is_empty() { return None; }

            // Apply RL boost
            let rl_boost = calculate_rl_boost(&a.name, &app_stats);
            let score = if query.is_empty() {
                (100u32 + rl_boost).min(100)
            } else {
                (base_score + rl_boost).min(100)
            };

            Some(serde_json::json!({
                "id": a.id, "name": a.name, "title": a.title,
                "path": a.path, "pid": a.pid,
                "score": score,
                "isRunning": true, "isVisible": true, "cloaked": 0,
                "isOnCurrentDesktop": a.is_on_current_desktop,
                "rlBoost": rl_boost,
            }))
        }).collect()
    };

    results.sort_by(|a, b| {
        b["score"].as_u64().unwrap_or(0).cmp(&a["score"].as_u64().unwrap_or(0))
    });
    results.truncate(limit);

    Json(serde_json::json!({ "query": query, "results": results, "source": source }))
}

// ==========================================
// POST Handlers
// ==========================================

pub async fn post_workspaces(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<Vec<Workspace>>,
) -> StatusCode {
    {
        let mut data = state.sync_data.write().await;
        data.workspaces = merge_workspaces_by_name(data.workspaces.clone(), incoming);
        data.last_updated
            .insert("workspaces".to_string(), chrono::Utc::now().timestamp_millis());
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.workspaces).unwrap_or_default()
    };
    state.save_and_broadcast("workspaces", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_urls(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<Vec<UrlEntry>>,
) -> StatusCode {
    {
        let mut data = state.sync_data.write().await;
        data.urls = merge_urls(data.urls.clone(), incoming);
        data.last_updated
            .insert("urls".to_string(), chrono::Utc::now().timestamp_millis());
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.urls).unwrap_or_default()
    };
    state.save_and_broadcast("urls", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_tabs(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<serde_json::Value>,
) -> StatusCode {
    // Parse incoming - can be array or object with tabs + deviceId
    let (tabs, device_id): (Vec<Tab>, String) = if incoming.is_array() {
        let tabs: Vec<Tab> = serde_json::from_value(incoming).unwrap_or_default();
        (tabs, "http-unknown".to_string())
    } else if let Ok(payload) = serde_json::from_value::<PushTabsPayload>(incoming) {
        (
            payload.tabs,
            payload.device_id.unwrap_or_else(|| "http-unknown".to_string()),
        )
    } else {
        return StatusCode::BAD_REQUEST;
    };

    {
        let mut data = state.sync_data.write().await;
        data.device_tabs_map.insert(device_id, tabs);
        data.tabs = recompute_aggregated_tabs(&data.device_tabs_map);
        data.last_updated
            .insert("tabs".to_string(), chrono::Utc::now().timestamp_millis());
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.tabs).unwrap_or_default()
    };
    state.save_and_broadcast("tabs", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_settings(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<HashMap<String, serde_json::Value>>,
) -> StatusCode {
    {
        let mut data = state.sync_data.write().await;
        data.settings = merge_settings(data.settings.clone(), incoming);
        data.last_updated
            .insert("settings".to_string(), chrono::Utc::now().timestamp_millis());
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.settings).unwrap_or_default()
    };
    state.save_and_broadcast("settings", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_activity(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<serde_json::Value>,
) -> StatusCode {
    let activities: Vec<Activity> = if incoming.is_array() {
        serde_json::from_value(incoming).unwrap_or_default()
    } else {
        vec![serde_json::from_value(incoming).unwrap_or_default()]
    };

    {
        let mut data = state.sync_data.write().await;
        data.activity = append_activity(data.activity.clone(), activities.clone());
        data.last_updated
            .insert("activity".to_string(), chrono::Utc::now().timestamp_millis());
    }

    // Broadcast only new activities
    let payload = serde_json::to_value(&activities).unwrap_or_default();
    state.save_and_broadcast("activity", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_notes(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<Vec<Note>>,
) -> StatusCode {
    log::info!("[Sidecar] HTTP POST /notes received {} notes", incoming.len());
    for (i, note) in incoming.iter().take(3).enumerate() {
        log::info!("[Sidecar] HTTP POST /notes note[{}]: id={}, title={:?}, createdAt={}",
            i, note.id, note.title, note.created_at);
    }

    {
        let mut data = state.sync_data.write().await;
        let before_count = data.notes.len();
        data.notes = merge_notes(data.notes.clone(), incoming);
        let after_count = data.notes.len();
        log::info!("[Sidecar] HTTP POST /notes merged: {} -> {} notes", before_count, after_count);

        data.last_updated
            .insert("notes".to_string(), chrono::Utc::now().timestamp_millis());
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.notes).unwrap_or_default()
    };
    state.save_and_broadcast("notes", payload).await;
    log::info!("[Sidecar] HTTP POST /notes broadcast complete");

    StatusCode::NO_CONTENT
}

pub async fn post_url_notes(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<Vec<UrlNote>>,
) -> StatusCode {
    {
        let mut data = state.sync_data.write().await;
        data.url_notes = merge_url_notes(data.url_notes.clone(), incoming);
        data.last_updated
            .insert("urlNotes".to_string(), chrono::Utc::now().timestamp_millis());
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.url_notes).unwrap_or_default()
    };
    state.save_and_broadcast("url-notes", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_pins(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<Vec<Pin>>,
) -> StatusCode {
    {
        let mut data = state.sync_data.write().await;
        data.pins = merge_pins(data.pins.clone(), incoming);
        data.last_updated
            .insert("pins".to_string(), chrono::Utc::now().timestamp_millis());
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.pins).unwrap_or_default()
    };
    state.save_and_broadcast("pins", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_scraped_chats(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<Vec<ScrapedChat>>,
) -> StatusCode {
    {
        let mut data = state.sync_data.write().await;
        data.scraped_chats = merge_scraped_chats(data.scraped_chats.clone(), incoming);
        data.last_updated.insert(
            "scrapedChats".to_string(),
            chrono::Utc::now().timestamp_millis(),
        );
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.scraped_chats).unwrap_or_default()
    };
    state.save_and_broadcast("scraped-chats", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_scraped_configs(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<Vec<ScrapedConfig>>,
) -> StatusCode {
    {
        let mut data = state.sync_data.write().await;
        data.scraped_configs = merge_scraped_configs(data.scraped_configs.clone(), incoming);
        data.last_updated.insert(
            "scrapedConfigs".to_string(),
            chrono::Utc::now().timestamp_millis(),
        );
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.scraped_configs).unwrap_or_default()
    };
    state.save_and_broadcast("scraped-configs", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_daily_memory(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<Vec<DailyMemory>>,
) -> StatusCode {
    {
        let mut data = state.sync_data.write().await;
        data.daily_memory = merge_daily_memory(data.daily_memory.clone(), incoming);
        data.last_updated.insert(
            "dailyMemory".to_string(),
            chrono::Utc::now().timestamp_millis(),
        );
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.daily_memory).unwrap_or_default()
    };
    state.save_and_broadcast("daily-memory", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_ui_state(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<HashMap<String, serde_json::Value>>,
) -> StatusCode {
    {
        let mut data = state.sync_data.write().await;
        data.ui_state.extend(incoming);
        data.last_updated
            .insert("uiState".to_string(), chrono::Utc::now().timestamp_millis());
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.ui_state).unwrap_or_default()
    };
    state.save_and_broadcast("ui-state", payload).await;

    StatusCode::NO_CONTENT
}

pub async fn post_dashboard(
    State(state): State<Arc<AppState>>,
    Json(mut incoming): Json<HashMap<String, serde_json::Value>>,
) -> StatusCode {
    // Safety check: prevent recursive 'data' key
    if incoming.contains_key("data") {
        log::warn!("[Sidecar] Blocked recursive dashboard.data payload");
        incoming.remove("data");
    }

    {
        let mut data = state.sync_data.write().await;
        data.dashboard.extend(incoming);
        data.last_updated.insert(
            "dashboard".to_string(),
            chrono::Utc::now().timestamp_millis(),
        );
    }

    let payload = {
        let data = state.sync_data.read().await;
        serde_json::to_value(&data.dashboard).unwrap_or_default()
    };
    state.save_and_broadcast("dashboard", payload).await;

    StatusCode::NO_CONTENT
}

// ==========================================
// Command Handlers
// ==========================================

pub async fn cmd_jump_to_tab(
    State(state): State<Arc<AppState>>,
    Json(req): Json<JumpToTabRequest>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    log::info!("[Sidecar] Broadcasting jump-to-tab: tabId={} browser={:?} deviceId={:?} url={:?}",
        req.tab_id, req.browser, req.device_id, req.url);

    let payload = serde_json::json!({
        "tabId": req.tab_id,
        "windowId": req.window_id,
        "url": req.url,
        "deviceId": req.device_id,
        "browser": req.browser
    });

    // WS broadcast (fast path — may be missed if service worker is suspended)
    state.broadcast("jump-to-tab", payload.clone());

    // HTTP queue (reliable fallback — extension polls GET /cmd/jump-next at ~1s)
    if let Ok(mut q) = state.pending_jumps.lock() {
        q.push_back(payload);
        // Keep at most 10 queued jumps to avoid stale buildup
        while q.len() > 10 {
            q.pop_front();
        }
    }

    Ok(Json(SuccessResponse { success: true }))
}

/// Poll for the next pending jump-to-tab action.
/// Extensions call this every ~1s. Returns the action and removes it from the queue.
/// Returns `{"action": null}` when the queue is empty.
pub async fn cmd_jump_next(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let action = state.pending_jumps.lock().ok().and_then(|mut q| q.pop_front());
    if let Some(ref a) = action {
        log::info!("[Sidecar] HTTP poll dequeued jump: tabId={} browser={:?} deviceId={:?}",
            a.get("tabId").and_then(|v| v.as_i64()).unwrap_or(-1),
            a.get("browser").and_then(|v| v.as_str()),
            a.get("deviceId").and_then(|v| v.as_str()),
        );
    }
    Json(serde_json::json!({ "action": action }))
}

// ==========================================
// Full Sync Handler
// ==========================================

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullSyncRequest {
    #[serde(default)]
    pub workspaces: Option<Vec<Workspace>>,
    #[serde(default)]
    pub urls: Option<Vec<UrlEntry>>,
    #[serde(default)]
    pub tabs: Option<Vec<Tab>>,
    #[serde(default)]
    pub settings: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    pub notes: Option<Vec<Note>>,
}

pub async fn post_sync(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FullSyncRequest>,
) -> Json<SyncData> {
    {
        let mut data = state.sync_data.write().await;

        if let Some(workspaces) = req.workspaces {
            data.workspaces = merge_workspaces_by_name(data.workspaces.clone(), workspaces);
        }
        if let Some(urls) = req.urls {
            data.urls = merge_urls(data.urls.clone(), urls);
        }
        if let Some(tabs) = req.tabs {
            data.tabs = tabs;
        }
        if let Some(settings) = req.settings {
            data.settings = merge_settings(data.settings.clone(), settings);
        }
        if let Some(notes) = req.notes {
            data.notes = merge_notes(data.notes.clone(), notes);
        }

        if let Err(e) = save_data(&data) {
            log::warn!("[Sidecar] Failed to save: {}", e);
        }
    }

    state.broadcast(
        "sync-complete",
        serde_json::json!({"timestamp": chrono::Utc::now().timestamp_millis()}),
    );

    let data = state.sync_data.read().await;
    Json(data.clone())
}

// ==========================================
// LLM Handlers (Phase 2 Migration)
// ==========================================

use crate::sidecar::llm::models::{ModelInfo, LlmStatus, get_available_models, get_status, load_model, unload_model, download_model};
use crate::sidecar::llm::inference::{chat};
use crate::sidecar::llm::tasks::{summarize, group_workspaces, suggest_related, enhance_url, suggest_workspaces, parse_command};

pub async fn llm_models() -> Json<HashMap<String, ModelInfo>> {
    if let Ok(models) = get_available_models().await {
        let map: HashMap<String, ModelInfo> = models
            .into_iter()
            .map(|m| (m.filename.clone(), m))
            .collect();
        Json(map)
    } else {
        Json(HashMap::new())
    }
}

pub async fn llm_status() -> Json<LlmStatus> {
    if let Ok(status) = get_status().await {
        Json(status)
    } else {
        Json(LlmStatus {
            initialized: false,
            model_loaded: false,
            current_model: None,
            is_loading: false,
            load_progress: 0.0,
            models_dir: String::new(),
        })
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadModelRequest {
    pub model_name: String,
    #[serde(default)]
    pub gpu_layers: Option<u32>,
}

pub async fn llm_load(Json(req): Json<LoadModelRequest>) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    let gpu_layers = req.gpu_layers.unwrap_or(0);
    if load_model(&req.model_name, gpu_layers).await.is_ok() {
        Ok(Json(SuccessResponse { success: true }))
    } else {
        Ok(Json(SuccessResponse { success: false }))
    }
}

pub async fn llm_unload() -> StatusCode {
    let _ = unload_model().await;
    StatusCode::NO_CONTENT
}

#[derive(Debug, serde::Deserialize)]
pub struct ChatRequest {
    pub prompt: String,
}

#[derive(Debug, serde::Serialize)]
pub struct ChatResponse {
    pub response: String,
}

pub async fn llm_chat(Json(req): Json<ChatRequest>) -> Json<ChatResponse> {
    if let Ok(response) = chat(&req.prompt).await {
        Json(ChatResponse { response })
    } else {
        Json(ChatResponse { response: "".to_string() })
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct SummarizeRequest {
    pub text: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadModelRequest {
    pub model_name: String,
}

pub async fn llm_download(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DownloadModelRequest>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    let model_name = req.model_name.clone();
    let model_name_for_callback = req.model_name.clone();
    let broadcast_sender = state.ws_broadcast.clone();
    let state_clone = state.clone();

    // Spawn download in background so we can return immediately
    tokio::spawn(async move {
        // Create a progress callback that broadcasts to WebSocket clients
        let progress_callback: Box<dyn Fn(u64, u64) + Send + Sync> = Box::new(move |downloaded, total| {
            let progress = if total > 0 {
                (downloaded * 100) / total
            } else {
                0
            };

            let msg = serde_json::json!({
                "type": "llm-download-progress",
                "payload": {
                    "modelName": model_name_for_callback,
                    "progress": progress,
                    "downloaded": downloaded,
                    "total": total
                }
            });

            if let Ok(json) = serde_json::to_string(&msg) {
                let _ = broadcast_sender.send(json);
            }
        });

        match download_model(&model_name, Some(progress_callback)).await {
            Ok(_) => {
                // Send completion message
                state_clone.broadcast("llm-download-complete", serde_json::json!({
                    "modelName": model_name,
                    "success": true
                }));
            }
            Err(e) => {
                log::error!("[LLM] Download failed: {}", e);
                state_clone.broadcast("llm-download-error", serde_json::json!({
                    "modelName": model_name,
                    "error": e
                }));
            }
        }
    });

    // Return immediately - progress/completion via WebSocket
    Ok(Json(SuccessResponse { success: true }))
}

pub async fn llm_summarize(Json(req): Json<SummarizeRequest>) -> Json<ChatResponse> {
    if let Ok(response) = summarize(&req.text, 3).await {
        Json(ChatResponse { response })
    } else {
        Json(ChatResponse { response: "".to_string() })
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupWorkspacesRequest {
    pub items: String,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub custom_prompt: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct GroupWorkspacesResponse {
    pub result: String,
    pub ok: bool,
}

pub async fn llm_group_workspaces(Json(req): Json<GroupWorkspacesRequest>) -> Json<GroupWorkspacesResponse> {
    let context = req.context.unwrap_or_default();
    let custom_prompt = req.custom_prompt.as_deref();

    if let Ok(result) = group_workspaces(&req.items, &context, custom_prompt).await {
        Json(GroupWorkspacesResponse { result, ok: true })
    } else {
        Json(GroupWorkspacesResponse { result: "".to_string(), ok: false })
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestRelatedRequest {
    pub workspace_urls: String,
    #[serde(default)]
    pub history: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct SuggestRelatedResponse {
    pub suggestions: String,
    pub ok: bool,
}

pub async fn llm_suggest_related(Json(req): Json<SuggestRelatedRequest>) -> Json<SuggestRelatedResponse> {
    let history = req.history.unwrap_or_default();

    if let Ok(suggestions) = suggest_related(&req.workspace_urls, &history).await {
        Json(SuggestRelatedResponse { suggestions, ok: true })
    } else {
        Json(SuggestRelatedResponse { suggestions: "[]".to_string(), ok: false })
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhanceUrlRequest {
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub content_hint: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct EnhanceUrlResponse {
    pub result: String,
    pub ok: bool,
}

pub async fn llm_enhance_url(Json(req): Json<EnhanceUrlRequest>) -> Json<EnhanceUrlResponse> {
    if let Ok(result) = enhance_url(&req.title, &req.url, req.content_hint.as_deref()).await {
        Json(EnhanceUrlResponse { result, ok: true })
    } else {
        Json(EnhanceUrlResponse { result: "".to_string(), ok: false })
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct SuggestWorkspacesRequest {
    pub urls: serde_json::Value,
}

#[derive(Debug, serde::Serialize)]
pub struct SuggestWorkspacesResponse {
    pub suggestions: Vec<String>,
    pub ok: bool,
}

pub async fn llm_suggest_workspaces(Json(req): Json<SuggestWorkspacesRequest>) -> Json<SuggestWorkspacesResponse> {
    let urls_json = serde_json::to_string(&req.urls).unwrap_or_default();
    if let Ok(res) = suggest_workspaces(&urls_json).await {
        // Try to parse as JSON array
        let suggestions: Vec<String> = serde_json::from_str(&res).unwrap_or_else(|_| vec![res]);
        Json(SuggestWorkspacesResponse { suggestions, ok: true })
    } else {
        Json(SuggestWorkspacesResponse { suggestions: Vec::new(), ok: false })
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct ParseCommandRequest {
    pub command: String,
    #[serde(default)]
    pub context: Option<serde_json::Value>,
}

#[derive(Debug, serde::Serialize)]
pub struct ParseCommandResponse {
    pub parsed: serde_json::Value,
    pub ok: bool,
}

pub async fn llm_parse_command(Json(req): Json<ParseCommandRequest>) -> Json<ParseCommandResponse> {
    let context_str = req.context.map(|c| c.to_string()).unwrap_or_default();
    if let Ok(res) = parse_command(&req.command, &context_str).await {
        let parsed: serde_json::Value = serde_json::from_str(&res).unwrap_or_else(|_| serde_json::json!({ "error": "parse_failed", "raw": res }));
        Json(ParseCommandResponse { parsed, ok: true })
    } else {
        Json(ParseCommandResponse { parsed: serde_json::json!({}), ok: false })
    }
}

// ==========================================
// LLM v2 Handlers (Agent with Memory)
// ==========================================

#[cfg(feature = "llm")]
use crate::sidecar::llm_v2::CoolDeskAgent;
#[cfg(feature = "llm")]
use crate::sidecar::storage::{load_agent_state, save_agent_state, SavedAgentState};
#[cfg(feature = "llm")]
use crate::sidecar::data::{
    V2CreateSessionRequest, V2SessionResponse, V2ChatRequest, V2ChatResponse,
    V2AddMemoryRequest, V2SessionSummary,
};
use lazy_static::lazy_static;
use tokio::sync::Mutex;

#[cfg(feature = "llm")]
lazy_static! {
    /// Global agent instance (created lazily)
    static ref GLOBAL_AGENT: Mutex<Option<CoolDeskAgent>> = Mutex::new(None);
}

#[cfg(feature = "llm")]
async fn get_or_init_agent(sync_data: Arc<RwLock<SyncData>>) -> &'static Mutex<Option<CoolDeskAgent>> {
    let mut agent_guard = GLOBAL_AGENT.lock().await;
    if agent_guard.is_none() {
        log::info!("[LLM v2] Initializing global agent");

        // Create the agent
        let agent = CoolDeskAgent::new(sync_data);

        // Load persisted state
        let saved_state = load_agent_state();
        if !saved_state.long_term_memory.facts.is_empty() || !saved_state.conversations.is_empty() {
            log::info!(
                "[LLM v2] Restoring {} facts and {} conversations from disk",
                saved_state.long_term_memory.facts.len(),
                saved_state.conversations.len()
            );

            let memory = agent.memory();
            let mut mem = memory.write().await;
            mem.set_long_term(saved_state.long_term_memory);
            mem.import_sessions(saved_state.conversations);
        }

        *agent_guard = Some(agent);
    }
    drop(agent_guard);
    &GLOBAL_AGENT
}

#[cfg(feature = "llm")]
async fn save_agent_to_disk(agent: &CoolDeskAgent) {
    let memory = agent.memory();
    let mem = memory.read().await;

    let state = SavedAgentState {
        long_term_memory: mem.export_long_term().clone(),
        conversations: mem.export_sessions(),
        saved_at: chrono::Utc::now().timestamp_millis(),
    };

    if let Err(e) = save_agent_state(&state) {
        log::warn!("[LLM v2] Failed to save agent state: {}", e);
    }
}

#[cfg(feature = "llm")]
pub async fn v2_create_session(
    State(state): State<Arc<AppState>>,
    Json(req): Json<V2CreateSessionRequest>,
) -> Json<V2SessionResponse> {
    let agent_mutex = get_or_init_agent(state.sync_data.clone()).await;
    let agent_guard = agent_mutex.lock().await;

    if let Some(agent) = agent_guard.as_ref() {
        let session_id = if let Some(id) = req.session_id {
            // Use provided session ID
            let memory = agent.memory();
            let mut mem = memory.write().await;
            mem.get_or_create_session(&id);
            id
        } else {
            agent.create_session().await
        };

        Json(V2SessionResponse {
            session_id,
            created_at: chrono::Utc::now().timestamp_millis(),
        })
    } else {
        Json(V2SessionResponse {
            session_id: String::new(),
            created_at: 0,
        })
    }
}

#[cfg(feature = "llm")]
pub async fn v2_list_sessions(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<V2SessionSummary>> {
    let agent_mutex = get_or_init_agent(state.sync_data.clone()).await;
    let agent_guard = agent_mutex.lock().await;

    if let Some(agent) = agent_guard.as_ref() {
        let memory = agent.memory();
        let mem = memory.read().await;
        let sessions: Vec<V2SessionSummary> = mem
            .list_sessions()
            .iter()
            .map(|s| V2SessionSummary {
                id: s.id.clone(),
                title: s.title.clone(),
                message_count: s.messages.len(),
                created_at: s.created_at,
                updated_at: s.updated_at,
            })
            .collect();
        Json(sessions)
    } else {
        Json(Vec::new())
    }
}

#[cfg(feature = "llm")]
pub async fn v2_get_session(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    let agent_mutex = get_or_init_agent(state.sync_data.clone()).await;
    let agent_guard = agent_mutex.lock().await;

    if let Some(agent) = agent_guard.as_ref() {
        let history = agent.get_session_history(&session_id).await;
        Json(serde_json::json!({
            "sessionId": session_id,
            "messages": history,
        }))
    } else {
        Json(serde_json::json!({
            "sessionId": session_id,
            "messages": [],
            "error": "Agent not initialized"
        }))
    }
}

#[cfg(feature = "llm")]
pub async fn v2_delete_session(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> StatusCode {
    let agent_mutex = get_or_init_agent(state.sync_data.clone()).await;
    let agent_guard = agent_mutex.lock().await;

    if let Some(agent) = agent_guard.as_ref() {
        agent.delete_session(&session_id).await;
    }

    StatusCode::NO_CONTENT
}

#[cfg(feature = "llm")]
pub async fn v2_chat(
    State(state): State<Arc<AppState>>,
    Json(req): Json<V2ChatRequest>,
) -> Json<V2ChatResponse> {
    let agent_mutex = get_or_init_agent(state.sync_data.clone()).await;
    let agent_guard = agent_mutex.lock().await;

    if let Some(agent) = agent_guard.as_ref() {
        match agent.chat(&req.session_id, &req.message).await {
            Ok(response) => {
                // Save state after successful chat
                save_agent_to_disk(agent).await;

                Json(V2ChatResponse {
                    ok: true,
                    session_id: response.session_id,
                    response: response.content,
                    tools_used: response.tools_used,
                    request_id: req.request_id,
                    error: None,
                })
            }
            Err(e) => {
                Json(V2ChatResponse {
                    ok: false,
                    session_id: req.session_id,
                    response: String::new(),
                    tools_used: Vec::new(),
                    request_id: req.request_id,
                    error: Some(e),
                })
            }
        }
    } else {
        Json(V2ChatResponse {
            ok: false,
            session_id: req.session_id,
            response: String::new(),
            tools_used: Vec::new(),
            request_id: req.request_id,
            error: Some("Agent not initialized".to_string()),
        })
    }
}

#[cfg(feature = "llm")]
pub async fn v2_get_memory(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let agent_mutex = get_or_init_agent(state.sync_data.clone()).await;
    let agent_guard = agent_mutex.lock().await;

    if let Some(agent) = agent_guard.as_ref() {
        let facts = agent.get_memory_facts().await;
        Json(serde_json::json!({
            "facts": facts,
        }))
    } else {
        Json(serde_json::json!({
            "facts": [],
        }))
    }
}

#[cfg(feature = "llm")]
pub async fn v2_add_memory(
    State(state): State<Arc<AppState>>,
    Json(req): Json<V2AddMemoryRequest>,
) -> Json<SuccessResponse> {
    let agent_mutex = get_or_init_agent(state.sync_data.clone()).await;
    let agent_guard = agent_mutex.lock().await;

    if let Some(agent) = agent_guard.as_ref() {
        agent.add_memory_fact(&req.content, req.category.as_deref()).await;
        // Save after adding memory
        save_agent_to_disk(agent).await;
        Json(SuccessResponse { success: true })
    } else {
        Json(SuccessResponse { success: false })
    }
}

#[cfg(feature = "llm")]
pub async fn v2_clear_memory(
    State(state): State<Arc<AppState>>,
) -> StatusCode {
    let agent_mutex = get_or_init_agent(state.sync_data.clone()).await;
    let agent_guard = agent_mutex.lock().await;

    if let Some(agent) = agent_guard.as_ref() {
        agent.clear_long_term_memory().await;
    }

    StatusCode::NO_CONTENT
}

// ==========================================
// Simple Agent (Context-Injection Model)
// ==========================================

#[cfg(feature = "llm")]
use crate::sidecar::llm_v2::SimpleAgent;

/// Request for simple agent chat
#[cfg(feature = "llm")]
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleChatRequest {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

/// Simple chat - context-injection approach (no tool routing)
/// This endpoint injects user data as context and lets the LLM respond naturally.
#[cfg(feature = "llm")]
pub async fn v2_simple_chat(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SimpleChatRequest>,
) -> Json<serde_json::Value> {
    let simple_agent = SimpleAgent::new(state.sync_data.clone());

    match simple_agent.chat(&req.message).await {
        response if response.ok => {
            Json(serde_json::json!({
                "ok": true,
                "response": response.response,
                "actions": response.actions,
                "requestId": req.request_id,
            }))
        }
        response => {
            Json(serde_json::json!({
                "ok": false,
                "error": response.error.unwrap_or_else(|| "Unknown error".to_string()),
                "requestId": req.request_id,
            }))
        }
    }
}

// ==========================================
// LLM v3 Handlers (Cloud AI via rig-core)
// ==========================================

use crate::sidecar::llm_v3::{SimpleAgentV3, CloudAgent, load_config, save_config, get_api_key, mask_key};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V3SimpleChatRequest {
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V3ChatRequest {
    pub message: String,
    pub request_id: Option<String>,
}

/// Simple context-injection chat — drop-in replacement for /llm/v2/simple-chat
/// Requires OPENAI_API_KEY env var.
pub async fn v3_simple_chat(
    State(state): State<Arc<AppState>>,
    Json(req): Json<V3SimpleChatRequest>,
) -> Json<serde_json::Value> {
    log::info!("[v3] simple-chat: {}", &req.message[..req.message.len().min(60)]);
    let agent = SimpleAgentV3::new(state.sync_data.clone());
    let result = agent.chat(&req.message).await;

    Json(serde_json::json!({
        "ok": result.ok,
        "response": result.response,
        "actions": result.actions,
        "provider": result.provider,
        "requestId": req.request_id,
        "error": result.error,
    }))
}

/// Agentic chat with tool calling — uses rig's built-in tool loop.
/// Requires OPENAI_API_KEY env var.
pub async fn v3_chat(
    State(state): State<Arc<AppState>>,
    Json(req): Json<V3ChatRequest>,
) -> Json<serde_json::Value> {
    log::info!("[v3] chat: {}", &req.message[..req.message.len().min(60)]);
    let agent = CloudAgent::new(state.sync_data.clone());
    let result = agent.chat(&req.message).await;

    Json(serde_json::json!({
        "ok": result.ok,
        "response": result.content,
        "provider": result.provider,
        "requestId": req.request_id,
        "error": result.error,
    }))
}

/// Returns whether cloud AI is configured (API key is set).
pub async fn v3_status() -> Json<serde_json::Value> {
    let config = load_config();
    let configured = get_api_key().is_some();
    Json(serde_json::json!({
        "ok": configured,
        "provider": config.provider,
        "model": config.model,
        "configured": configured,
        "message": if configured { "Cloud AI ready" } else { "Add your API key in Settings → AI" }
    }))
}

/// GET /llm/v3/config — returns current config with masked key.
pub async fn v3_get_config() -> Json<serde_json::Value> {
    let config = load_config();
    let key = get_api_key().unwrap_or_default();
    let masked = if key.is_empty() { String::new() } else { mask_key(&key) };
    Json(serde_json::json!({
        "provider": config.provider,
        "model": config.model,
        "apiKeyMasked": masked,
        "configured": !key.is_empty(),
    }))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V3ConfigRequest {
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
}

/// POST /llm/v3/config — save provider, API key, model.
pub async fn v3_save_config(Json(req): Json<V3ConfigRequest>) -> Json<serde_json::Value> {
    let mut config = load_config();

    if let Some(p) = req.provider { config.provider = p; }
    if let Some(k) = req.api_key  { config.api_key = k; }
    if let Some(m) = req.model    { config.model = m; }

    match save_config(&config) {
        Ok(_) => Json(serde_json::json!({ "ok": true, "message": "Config saved" })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

// ==========================================
// Feedback/RL Handlers
// ==========================================

use crate::sidecar::feedback::{
    FeedbackStore, FeedbackEvent, SuggestionType, UserAction,
    PatternTracker, RewardCalculator,
};
use crate::sidecar::data::{
    FeedbackEventRequest, FeedbackStatsResponse, UrlGroupingFeedbackRequest,
    WorkspaceSuggestionRequest, WorkspaceSuggestionResponse, ScoredSuggestion,
    RecordUrlWorkspaceRequest, UrlAffinityResponse, RelatedUrl, AppLaunchRequest,
    RecordAppWorkspaceRequest, SuggestAppsRequest, AppSuggestionResponse, SuggestedApp,
    SuggestWorkspacesForAppRequest,
};

lazy_static! {
    /// Global feedback store
    static ref FEEDBACK_STORE: Mutex<Option<FeedbackStore>> = Mutex::new(None);
    /// Global pattern tracker
    static ref PATTERN_TRACKER: Mutex<PatternTracker> = Mutex::new(PatternTracker::new());
    /// Reward calculator
    static ref REWARD_CALCULATOR: RewardCalculator = RewardCalculator::new();
}

/// Initialize or get feedback store
async fn get_feedback_store() -> &'static Mutex<Option<FeedbackStore>> {
    let mut store_guard = FEEDBACK_STORE.lock().await;
    if store_guard.is_none() {
        let data_dir = crate::sidecar::storage::get_data_dir();
        *store_guard = Some(FeedbackStore::new(data_dir));
        log::info!("[Feedback] Initialized feedback store");
    }
    drop(store_guard);
    &FEEDBACK_STORE
}

/// Parse suggestion type from string
fn parse_suggestion_type(s: &str) -> SuggestionType {
    match s.to_lowercase().as_str() {
        "workspace_group" | "workspacegroup" => SuggestionType::WorkspaceGroup,
        "url_to_workspace" | "urltoworkspace" => SuggestionType::UrlToWorkspace,
        "related_resource" | "relatedresource" => SuggestionType::RelatedResource,
        "tool_result" | "toolresult" => SuggestionType::ToolResult,
        "tab_category" | "tabcategory" => SuggestionType::TabCategory,
        "workspace_name" | "workspacename" => SuggestionType::WorkspaceName,
        "app_launch" | "applaunch" => SuggestionType::AppLaunch,
        _ => SuggestionType::WorkspaceGroup,
    }
}

/// Parse user action from string
fn parse_user_action(s: &str) -> UserAction {
    match s.to_lowercase().as_str() {
        "accepted" | "accept" => UserAction::Accepted,
        "rejected" | "reject" => UserAction::Rejected,
        "modified" | "modify" => UserAction::Modified,
        "ignored" | "ignore" => UserAction::Ignored,
        "previewed" | "preview" => UserAction::Previewed,
        "undone" | "undo" => UserAction::Undone,
        _ => UserAction::Ignored,
    }
}

/// Record a feedback event
pub async fn feedback_record_event(
    Json(req): Json<FeedbackEventRequest>,
) -> Json<SuccessResponse> {
    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        let mut event = FeedbackEvent::new(
            parse_suggestion_type(&req.suggestion_type),
            parse_user_action(&req.action),
            req.suggestion_content,
        );

        event = event.with_context(req.context_workspace, req.context_urls);

        if let Some(rt) = req.response_time_ms {
            event = event.with_response_time(rt);
        }

        if let Some(modified) = req.modified_content {
            event = event.with_modification(modified);
        }

        if let Some(session_id) = req.session_id {
            event = event.with_session(session_id);
        }

        if let Some(tool_name) = req.tool_name {
            event = event.with_tool(tool_name);
        }

        store.record_event(event).await;

        // Save periodically (every 10 events or so)
        let count = store.event_count().await;
        if count % 10 == 0 {
            let _ = store.save().await;
        }

        Json(SuccessResponse { success: true })
    } else {
        Json(SuccessResponse { success: false })
    }
}

/// Get feedback statistics
pub async fn feedback_get_stats() -> Json<FeedbackStatsResponse> {
    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        let stats = store.get_all_stats().await;
        let total = store.event_count().await;

        let stats_json: std::collections::HashMap<String, serde_json::Value> = stats
            .into_iter()
            .map(|(k, v)| (k, serde_json::to_value(v).unwrap_or_default()))
            .collect();

        Json(FeedbackStatsResponse {
            stats_by_type: stats_json,
            total_events: total,
        })
    } else {
        Json(FeedbackStatsResponse {
            stats_by_type: std::collections::HashMap::new(),
            total_events: 0,
        })
    }
}

/// Record URL grouping feedback
pub async fn feedback_record_grouping(
    Json(req): Json<UrlGroupingFeedbackRequest>,
) -> Json<SuccessResponse> {
    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        store
            .record_grouping_feedback(&req.url1, &req.url2, req.positive)
            .await;
        Json(SuccessResponse { success: true })
    } else {
        Json(SuccessResponse { success: false })
    }
}

/// Get URL affinity
pub async fn feedback_get_affinity(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Json<UrlAffinityResponse> {
    let url1 = params.get("url1").cloned().unwrap_or_default();
    let url2 = params.get("url2").cloned().unwrap_or_default();

    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        let affinity = store.get_url_affinity(&url1, &url2).await;
        let related = store.get_related_urls(&url1, 0.3).await;

        Json(UrlAffinityResponse {
            affinity,
            related_urls: related
                .into_iter()
                .map(|(url, aff)| RelatedUrl { url, affinity: aff })
                .collect(),
        })
    } else {
        Json(UrlAffinityResponse {
            affinity: 0.0,
            related_urls: Vec::new(),
        })
    }
}

/// Record URL-workspace association (for pattern learning)
pub async fn feedback_record_url_workspace(
    Json(req): Json<RecordUrlWorkspaceRequest>,
) -> Json<SuccessResponse> {
    let mut tracker = PATTERN_TRACKER.lock().await;
    tracker.record_url_workspace(&req.url, &req.title, &req.workspace_name);

    // Also record co-occurrence for URLs in same workspace
    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        // This would ideally get other URLs in the same workspace
        // For now, just record the association
        store.record_co_occurrence(&req.url, &req.url, true).await;
    }

    Json(SuccessResponse { success: true })
}

/// Get workspace suggestions for a URL
pub async fn feedback_suggest_workspace(
    Json(req): Json<WorkspaceSuggestionRequest>,
) -> Json<WorkspaceSuggestionResponse> {
    let tracker = PATTERN_TRACKER.lock().await;
    let suggestions = tracker.suggest_workspaces(&req.url, &req.title, req.count);

    Json(WorkspaceSuggestionResponse {
        suggestions: suggestions
            .into_iter()
            .map(|(name, score)| ScoredSuggestion {
                workspace_name: name,
                score,
            })
            .collect(),
    })
}

/// Get recent feedback events (for debugging)
pub async fn feedback_get_events(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Json<Vec<serde_json::Value>> {
    let limit: usize = params
        .get("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(20);

    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        let events = store.get_recent_events(limit).await;
        Json(
            events
                .into_iter()
                .map(|e| serde_json::to_value(e).unwrap_or_default())
                .collect(),
        )
    } else {
        Json(Vec::new())
    }
}

/// Save feedback state to disk
pub async fn feedback_save() -> StatusCode {
    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        if store.save().await.is_ok() {
            StatusCode::NO_CONTENT
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

/// Record app launch feedback (for RL-based search ranking)
pub async fn feedback_app_launch(
    Json(req): Json<AppLaunchRequest>,
) -> Json<SuccessResponse> {
    let action = parse_user_action(&req.action);

    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        // Record to app-specific stats for search ranking
        store.record_app_launch(&req.app_name, &action, req.response_time_ms).await;

        // Also record as a general feedback event for analytics
        let event = FeedbackEvent::new(
            SuggestionType::AppLaunch,
            action,
            req.app_name.clone(),
        ).with_response_time(req.response_time_ms.unwrap_or(0));

        store.record_event(event).await;

        // Save periodically
        let count = store.event_count().await;
        if count % 10 == 0 {
            let _ = store.save().await;
        }

        log::info!("[Feedback] Recorded app launch: {} -> {}", req.app_name, req.action);
        Json(SuccessResponse { success: true })
    } else {
        Json(SuccessResponse { success: false })
    }
}

/// Record URL click feedback (for RL-based saved links ranking)
pub async fn feedback_url_click(
    Json(req): Json<UrlClickRequest>,
) -> Json<SuccessResponse> {
    let action = parse_user_action(&req.action);

    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        // Record to URL-specific stats for search ranking
        store.record_url_click(&req.url, &action, req.response_time_ms).await;

        // Also record as a general feedback event for analytics
        let event = FeedbackEvent::new(
            SuggestionType::UrlClick,
            action,
            req.url.clone(),
        ).with_response_time(req.response_time_ms.unwrap_or(0));

        store.record_event(event).await;

        // Save periodically
        let count = store.event_count().await;
        if count % 10 == 0 {
            let _ = store.save().await;
        }

        log::info!("[Feedback] Recorded URL click: {} -> {}", req.url, req.action);
        Json(SuccessResponse { success: true })
    } else {
        Json(SuccessResponse { success: false })
    }
}

/// Record app-workspace association (for learning which apps belong to which workspaces)
pub async fn feedback_record_app_workspace(
    Json(req): Json<RecordAppWorkspaceRequest>,
) -> Json<SuccessResponse> {
    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        store.record_app_workspace(&req.app_name, &req.app_path, &req.workspace_name).await;

        // Save periodically
        let count = store.event_count().await;
        if count % 10 == 0 {
            let _ = store.save().await;
        }

        log::info!("[Feedback] Recorded app-workspace: {} -> {}", req.app_name, req.workspace_name);
        Json(SuccessResponse { success: true })
    } else {
        Json(SuccessResponse { success: false })
    }
}

/// Suggest apps for a workspace based on learned associations
pub async fn feedback_suggest_apps(
    Json(req): Json<SuggestAppsRequest>,
) -> Json<AppSuggestionResponse> {
    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        let suggestions = store.suggest_apps_for_workspace(&req.workspace_name, req.count).await;

        Json(AppSuggestionResponse {
            suggestions: suggestions
                .into_iter()
                .map(|(name, path, score)| SuggestedApp {
                    app_name: name,
                    app_path: path,
                    score,
                })
                .collect(),
        })
    } else {
        Json(AppSuggestionResponse {
            suggestions: Vec::new(),
        })
    }
}

/// Suggest workspaces for an app based on learned associations
pub async fn feedback_suggest_workspaces_for_app(
    Json(req): Json<SuggestWorkspacesForAppRequest>,
) -> Json<WorkspaceSuggestionResponse> {
    let store_mutex = get_feedback_store().await;
    let store_guard = store_mutex.lock().await;

    if let Some(store) = store_guard.as_ref() {
        let suggestions = store.suggest_workspaces_for_app(&req.app_path, req.count).await;

        Json(WorkspaceSuggestionResponse {
            suggestions: suggestions
                .into_iter()
                .map(|(name, score)| ScoredSuggestion {
                    workspace_name: name,
                    score,
                })
                .collect(),
        })
    } else {
        Json(WorkspaceSuggestionResponse {
            suggestions: Vec::new(),
        })
    }
}

