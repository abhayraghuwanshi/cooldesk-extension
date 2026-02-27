// HTTP and WebSocket request handlers

use crate::sidecar::data::*;
use crate::sidecar::storage::{save_data, ChangeTracker};
use crate::sidecar::sync::*;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Shared application state
pub struct AppState {
    pub sync_data: Arc<RwLock<SyncData>>,
    pub change_tracker: Arc<RwLock<ChangeTracker>>,
    pub ws_broadcast: tokio::sync::broadcast::Sender<String>,
}

impl AppState {
    pub fn new(ws_broadcast: tokio::sync::broadcast::Sender<String>) -> Self {
        Self {
            sync_data: Arc::new(RwLock::new(crate::sidecar::storage::load_data())),
            change_tracker: Arc::new(RwLock::new(ChangeTracker::new())),
            ws_broadcast,
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
    log::info!("[Sidecar] Broadcasting jump-to-tab: {}", req.tab_id);

    state.broadcast(
        "jump-to-tab",
        serde_json::json!({
            "tabId": req.tab_id,
            "windowId": req.window_id
        }),
    );

    Ok(Json(SuccessResponse { success: true }))
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
use crate::sidecar::llm::tasks::{summarize, categorize, group_workspaces, suggest_related, enhance_url, suggest_workspaces, parse_command};

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

pub async fn llm_download(Json(req): Json<DownloadModelRequest>) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    if download_model(&req.model_name).await.is_ok() {
        Ok(Json(SuccessResponse { success: true }))
    } else {
        Ok(Json(SuccessResponse { success: false }))
    }
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

use crate::sidecar::llm_v2::CoolDeskAgent;
use crate::sidecar::llm_v2::memory::MemoryManager;
use crate::sidecar::storage::{load_agent_state, save_agent_state, SavedAgentState};
use crate::sidecar::data::{
    V2CreateSessionRequest, V2SessionResponse, V2ChatRequest, V2ChatResponse,
    V2AddMemoryRequest, V2SessionSummary,
};
use lazy_static::lazy_static;
use tokio::sync::Mutex;

lazy_static! {
    /// Global agent instance (created lazily)
    static ref GLOBAL_AGENT: Mutex<Option<CoolDeskAgent>> = Mutex::new(None);
}

/// Initialize or get the global agent, loading persisted state
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

/// Save agent state to disk
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

/// Create a new session
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

/// List all sessions
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

/// Get a specific session's history
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

/// Delete a session
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

/// Chat with the agent
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

/// Get memory facts
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

/// Add a memory fact
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

/// Clear all memory
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

