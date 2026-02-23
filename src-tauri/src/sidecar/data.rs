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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub urls: Vec<WorkspaceUrl>,
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
