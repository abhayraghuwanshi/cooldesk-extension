// Data structures for sidecar sync

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Main sync data structure - mirrors Node.js syncData
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncData {
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub urls: Vec<UrlEntry>,
    #[serde(default)]
    pub settings: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub activity: Vec<Activity>,
    #[serde(default)]
    pub notes: Vec<Note>,
    #[serde(default)]
    pub url_notes: Vec<UrlNote>,
    #[serde(default)]
    pub pins: Vec<Pin>,
    #[serde(default)]
    pub scraped_chats: Vec<ScrapedChat>,
    #[serde(default)]
    pub scraped_configs: Vec<ScrapedConfig>,
    #[serde(default)]
    pub daily_memory: Vec<DailyMemory>,
    #[serde(default)]
    pub ui_state: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub dashboard: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub tabs: Vec<Tab>,
    #[serde(default)]
    pub last_updated: HashMap<String, i64>,

    /// Device tabs map - NOT persisted (transient)
    #[serde(skip)]
    pub device_tabs_map: HashMap<String, Vec<Tab>>,

    /// Map of WebSocket client_id to the device_id they are using
    #[serde(skip)]
    pub client_to_device: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceApp {
    pub name: String,
    #[serde(default)]
    pub path: String,
    pub icon: Option<String>,
    /// "default" | "folder" | "file" | "vscode" | "cursor" | "windsurf" | "idea" | ...
    pub app_type: Option<String>,
    pub added_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub urls: Vec<WorkspaceUrl>,
    #[serde(default)]
    pub apps: Vec<WorkspaceApp>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUrl {
    pub url: String,
    pub title: Option<String>,
    pub added_at: Option<i64>,
    pub created_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlEntry {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: i64,
    pub url: String,
    pub title: String,
    #[serde(rename = "favIconUrl", alias = "faviconUrl")]
    pub favicon_url: Option<String>,
    pub window_id: Option<i64>,
    #[serde(rename = "_deviceId")]
    pub device_id: Option<String>,
    /// Browser type: "chrome", "edge", "firefox", "safari", "other"
    pub browser: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: Option<String>,
    pub timestamp: Option<i64>,
    #[serde(rename = "type")]
    pub activity_type: Option<String>,
    pub url: Option<String>,
    pub title: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
    // Extended activity metrics
    pub time: Option<i64>,           // Time spent in ms
    pub scroll: Option<i32>,         // Scroll depth percentage
    pub clicks: Option<i32>,         // Click count
    pub forms: Option<i32>,          // Form submissions
    pub visit_count: Option<i32>,    // Total visits
    pub return_visits: Option<i32>,  // Visits on different days
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub folder: Option<String>,
    pub text: Option<String>,
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    pub status: Option<String>,
    pub audio_data: Option<String>,
    pub duration: Option<f64>,
    pub has_transcription: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub url: Option<String>,
    pub url_title: Option<String>,
    pub created_at: i64,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlNote {
    pub id: String,
    pub url: String,
    pub content: Option<String>,
    pub text: Option<String>,
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    pub completed: Option<bool>,
    pub selected_text: Option<String>,
    pub description: Option<String>,
    pub title: Option<String>,
    pub screenshot: Option<String>,
    pub image_data: Option<String>,
    pub tags: Option<Vec<String>>,
    pub created_at: i64,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub favicon: Option<String>,
    #[serde(default)]
    pub created_at: Option<i64>,
    #[serde(default)]
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapedChat {
    pub chat_id: String,
    pub url: String,
    pub title: String,
    pub platform: String,
    pub scraped_at: i64,
    pub source: Option<String>,
    pub messages: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
    pub content: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapedConfig {
    pub domain: String,
    pub selector: Option<String>,
    pub container: Option<String>,
    pub links: Option<String>,
    pub full: Option<String>,
    pub sample: Option<serde_json::Value>,
    pub enabled: Option<bool>,
    pub source: Option<String>,
    pub excluded_domains: Option<Vec<String>>,
    pub excluded_patterns: Option<Vec<String>>,
    pub included_patterns: Option<Vec<String>>,
    pub scrape_limit: Option<i64>,
    pub title_source: Option<String>,
    pub title_selector: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: i64,
    pub saved_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyMemory {
    pub id: String,
    pub user_id: String,
    pub date: String,
    pub session_ids: Option<Vec<String>>,
    pub top_urls: Option<Vec<serde_json::Value>>,
    pub note_count: Option<i64>,
    pub highlight_count: Option<i64>,
    pub summary: Option<String>,
    pub created_at: i64,
    pub updated_at: Option<i64>,
}

// ==========================================
// WebSocket Message Types
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
    /// Client ID for sender exclusion from broadcasts
    #[serde(skip_serializing_if = "Option::is_none", rename = "clientId")]
    pub client_id: Option<String>,
}

impl WsMessage {
    pub fn new(msg_type: &str, payload: serde_json::Value) -> Self {
        Self {
            msg_type: msg_type.to_string(),
            payload: Some(payload),
            timestamp: Some(chrono::Utc::now().timestamp_millis()),
            client_id: None,
        }
    }

    pub fn simple(msg_type: &str) -> Self {
        Self {
            msg_type: msg_type.to_string(),
            payload: None,
            timestamp: Some(chrono::Utc::now().timestamp_millis()),
            client_id: None,
        }
    }
}

// ==========================================
// HTTP Request/Response Types
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpToTabRequest {
    pub tab_id: i64,
    pub window_id: Option<i64>,
    pub url: Option<String>,
    pub device_id: Option<String>,
    /// Browser that owns this tab: "chrome", "edge", etc.
    /// When set, only the matching browser extension handles the jump.
    pub browser: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
}

// ==========================================
// Sync State Payload
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatePayload {
    pub workspaces: Vec<Workspace>,
    pub tabs: Vec<Tab>,
    pub urls: Vec<UrlEntry>,
    pub settings: HashMap<String, serde_json::Value>,
    pub notes: Vec<Note>,
    pub url_notes: Vec<UrlNote>,
    pub pins: Vec<Pin>,
    pub scraped_chats: Vec<ScrapedChat>,
    pub scraped_configs: Vec<ScrapedConfig>,
    pub daily_memory: Vec<DailyMemory>,
    pub ui_state: HashMap<String, serde_json::Value>,
    pub dashboard: HashMap<String, serde_json::Value>,
    pub last_updated: HashMap<String, i64>,
}

impl From<&SyncData> for SyncStatePayload {
    fn from(data: &SyncData) -> Self {
        Self {
            workspaces: data.workspaces.clone(),
            tabs: data.tabs.clone(),
            urls: data.urls.clone(),
            settings: data.settings.clone(),
            notes: data.notes.clone(),
            url_notes: data.url_notes.clone(),
            pins: data.pins.clone(),
            scraped_chats: data.scraped_chats.clone(),
            scraped_configs: data.scraped_configs.clone(),
            daily_memory: data.daily_memory.clone(),
            ui_state: data.ui_state.clone(),
            dashboard: data.dashboard.clone(),
            last_updated: data.last_updated.clone(),
        }
    }
}

// ==========================================
// Tabs Push Payload
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushTabsPayload {
    #[serde(default)]
    pub tabs: Vec<Tab>,
    pub device_id: Option<String>,
}

// ==========================================
// LLM v2 Agent Data Types
// ==========================================

/// Persistent conversation for the agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversation {
    pub id: String,
    pub title: Option<String>,
    pub messages: Vec<AgentMessage>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A message in an agent conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<serde_json::Value>,
    pub timestamp: i64,
}

/// Long-term memory storage for the agent
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemory {
    pub facts: Vec<AgentMemoryFact>,
    pub updated_at: i64,
}

/// A fact stored in agent memory
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryFact {
    pub id: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub created_at: i64,
}

// ==========================================
// LLM v2 Request/Response Types
// ==========================================

/// Request to create a new agent session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2CreateSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// Response after creating a session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2SessionResponse {
    pub session_id: String,
    pub created_at: i64,
}

/// Request for v2 chat
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2ChatRequest {
    pub session_id: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

/// Response from v2 chat
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2ChatResponse {
    pub ok: bool,
    pub session_id: String,
    pub response: String,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tools_used: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Request to add memory
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2AddMemoryRequest {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

/// Session summary for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2SessionSummary {
    pub id: String,
    pub title: Option<String>,
    pub message_count: usize,
    pub created_at: i64,
    pub updated_at: i64,
}

// ==========================================
// Feedback/RL Request/Response Types
// ==========================================

/// Request to record a feedback event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedbackEventRequest {
    /// Type of suggestion
    pub suggestion_type: String,
    /// User action: accepted, rejected, modified, ignored, previewed, undone
    pub action: String,
    /// The suggestion content (optional — may be absent if item has no url/name)
    #[serde(default)]
    pub suggestion_content: String,
    /// Current workspace context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_workspace: Option<String>,
    /// Active URLs for context
    #[serde(default)]
    pub context_urls: Vec<String>,
    /// Time from suggestion shown to action (ms)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_time_ms: Option<i64>,
    /// If modified, what user changed it to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_content: Option<String>,
    /// Session ID if from agent
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Tool name if from agent tool
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
}

/// Response for feedback stats
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackStatsResponse {
    pub stats_by_type: HashMap<String, serde_json::Value>,
    pub total_events: u64,
}

/// Request to record URL grouping feedback
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlGroupingFeedbackRequest {
    /// First URL
    pub url1: String,
    /// Second URL
    pub url2: String,
    /// Whether grouping was positive (accepted) or negative (rejected)
    pub positive: bool,
}

/// Request to get workspace suggestions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSuggestionRequest {
    pub url: String,
    pub title: String,
    #[serde(default = "default_suggestion_count")]
    pub count: usize,
}

fn default_suggestion_count() -> usize {
    3
}

/// Response for workspace suggestions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSuggestionResponse {
    pub suggestions: Vec<ScoredSuggestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredSuggestion {
    pub workspace_name: String,
    pub score: f64,
}

/// Request to record URL-workspace association
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordUrlWorkspaceRequest {
    pub url: String,
    pub title: String,
    pub workspace_name: String,
}

/// Request to record app launch feedback
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppLaunchRequest {
    /// App name (e.g., "Chrome", "Visual Studio Code")
    pub app_name: String,
    /// User action: "accepted" (launched), "rejected" (dismissed), "ignored" (timeout)
    #[serde(default = "default_accepted")]
    pub action: String,
    /// Optional response time in ms (time from showing result to user action)
    pub response_time_ms: Option<i64>,
}

fn default_accepted() -> String {
    "accepted".to_string()
}

/// Request to record URL click feedback
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlClickRequest {
    /// URL that was clicked
    pub url: String,
    /// Optional title for context
    pub title: Option<String>,
    /// User action: "accepted" (clicked), "rejected" (dismissed), "ignored" (timeout)
    #[serde(default = "default_accepted")]
    pub action: String,
    /// Optional response time in ms
    pub response_time_ms: Option<i64>,
}

/// Response for URL affinity query
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlAffinityResponse {
    pub affinity: f64,
    pub related_urls: Vec<RelatedUrl>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedUrl {
    pub url: String,
    pub affinity: f64,
}

/// Request to record app-workspace association
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordAppWorkspaceRequest {
    /// App name (display name)
    pub app_name: String,
    /// App path (unique identifier)
    pub app_path: String,
    /// Workspace name this app is associated with
    pub workspace_name: String,
}

/// Request to suggest apps for a workspace
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestAppsRequest {
    /// Workspace name to get app suggestions for
    pub workspace_name: String,
    /// Maximum number of suggestions
    #[serde(default = "default_app_suggestion_count")]
    pub count: usize,
}

fn default_app_suggestion_count() -> usize {
    10
}

/// Response for app suggestions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSuggestionResponse {
    pub suggestions: Vec<SuggestedApp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedApp {
    pub app_name: String,
    pub app_path: String,
    pub score: f64,
}

/// Request to suggest workspaces for an app
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestWorkspacesForAppRequest {
    /// App path to get workspace suggestions for
    pub app_path: String,
    /// Optional app name for context
    #[serde(default)]
    pub app_name: Option<String>,
    /// Maximum number of suggestions
    #[serde(default = "default_workspace_for_app_count")]
    pub count: usize,
}

fn default_workspace_for_app_count() -> usize {
    5
}

// Note: Reuses WorkspaceSuggestionResponse and ScoredSuggestion from above

// ── Knowledge Graph ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String, // "url" | "app" | "folder" | "file" | "workspace"
    pub label: String,
    pub title: Option<String>,
    pub weight: u32, // visit / association count → drives node radius in UI
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub edge_type: String,
    pub weight: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<i64>, // ms timestamp — used by frontend time filter
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphResponse {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub meta: serde_json::Value,
}
