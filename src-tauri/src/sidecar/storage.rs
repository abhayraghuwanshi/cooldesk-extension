// JSON file-based persistence for sync data

use crate::sidecar::data::SyncData;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Get the data directory path
pub fn get_data_dir() -> PathBuf {
    // Use current working directory + sync-data (same as Node.js version)
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join("sync-data")
}

/// Get the data file path
pub fn get_data_file() -> PathBuf {
    get_data_dir().join("sync-data.json")
}

/// Ensure data directory exists
pub fn ensure_data_dir() -> std::io::Result<()> {
    let dir = get_data_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    Ok(())
}

/// Load sync data from disk
pub fn load_data() -> SyncData {
    let file_path = get_data_file();

    if !file_path.exists() {
        log::info!("[Sidecar] No existing data file, starting fresh");
        return SyncData::default();
    }

    match fs::read_to_string(&file_path) {
        Ok(content) => {
            match serde_json::from_str::<SyncData>(&content) {
                Ok(mut data) => {
                    log::info!("[Sidecar] Loaded sync data from disk: {} notes, {} workspaces, {} urls, {} pins, {} urlNotes, {} tabs (cached)",
                        data.notes.len(), data.workspaces.len(), data.urls.len(),
                        data.pins.len(), data.url_notes.len(), data.tabs.len());
                    // Clear runtime-only maps (not persisted)
                    data.device_tabs_map.clear();
                    data.client_to_device.clear();
                    // NOTE: tabs are intentionally kept so the app shows last-known tabs
                    // immediately on startup. The extension will push fresh tabs on reconnect.
                    data
                }
                Err(e) => {
                    log::warn!("[Sidecar] Failed to parse sync data: {}", e);
                    SyncData::default()
                }
            }
        }
        Err(e) => {
            log::warn!("[Sidecar] Failed to read sync data file: {}", e);
            SyncData::default()
        }
    }
}

/// Save sync data to disk
pub fn save_data(data: &SyncData) -> std::io::Result<()> {
    ensure_data_dir()?;
    let file_path = get_data_file();
    log::debug!("[Sidecar] Saving sync data: {} notes, {} workspaces to {:?}",
        data.notes.len(), data.workspaces.len(), file_path);
    let content = serde_json::to_string_pretty(data)?;
    let content_len = content.len();
    fs::write(&file_path, content)?;
    log::debug!("[Sidecar] Save complete: {} bytes written", content_len);
    Ok(())
}

/// Async save with error logging
pub async fn save_data_async(data: Arc<RwLock<SyncData>>) {
    let data_guard = data.read().await;
    if let Err(e) = save_data(&data_guard) {
        log::warn!("[Sidecar] Failed to save sync data: {}", e);
    }
}

/// Simple hash for change detection (mirrors Node.js implementation)
pub fn simple_hash(data: &str) -> String {
    let mut hash: i32 = 0;
    for c in data.chars() {
        let char_code = c as i32;
        hash = ((hash << 5).wrapping_sub(hash)).wrapping_add(char_code);
        hash &= hash; // Convert to 32bit integer
    }
    format!("{:x}", hash)
}

/// Change detection tracker
#[derive(Default)]
pub struct ChangeTracker {
    last_hashes: std::collections::HashMap<String, String>,
}

// ==========================================
// Agent Memory Persistence
// ==========================================

use crate::sidecar::llm_v2::memory::{ConversationSession, LongTermMemory};

/// Agent memory file path
fn get_agent_memory_file() -> PathBuf {
    get_data_dir().join("agent-memory.json")
}

/// Agent conversations file path
fn get_agent_conversations_file() -> PathBuf {
    get_data_dir().join("agent-conversations.json")
}

/// Saved agent memory state
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SavedAgentState {
    pub long_term_memory: LongTermMemory,
    pub conversations: Vec<ConversationSession>,
    pub saved_at: i64,
}

/// Load agent state from disk
pub fn load_agent_state() -> SavedAgentState {
    let memory_file = get_agent_memory_file();

    if !memory_file.exists() {
        log::info!("[Agent Storage] No existing agent memory, starting fresh");
        return SavedAgentState::default();
    }

    match fs::read_to_string(&memory_file) {
        Ok(content) => {
            match serde_json::from_str::<SavedAgentState>(&content) {
                Ok(state) => {
                    log::info!(
                        "[Agent Storage] Loaded agent state: {} facts, {} conversations",
                        state.long_term_memory.facts.len(),
                        state.conversations.len()
                    );
                    state
                }
                Err(e) => {
                    log::warn!("[Agent Storage] Failed to parse agent state: {}", e);
                    SavedAgentState::default()
                }
            }
        }
        Err(e) => {
            log::warn!("[Agent Storage] Failed to read agent state: {}", e);
            SavedAgentState::default()
        }
    }
}

/// Save agent state to disk
pub fn save_agent_state(state: &SavedAgentState) -> std::io::Result<()> {
    ensure_data_dir()?;
    let file_path = get_agent_memory_file();

    log::debug!(
        "[Agent Storage] Saving agent state: {} facts, {} conversations",
        state.long_term_memory.facts.len(),
        state.conversations.len()
    );

    let content = serde_json::to_string_pretty(state)?;
    fs::write(&file_path, content)?;

    Ok(())
}

/// Save just the long-term memory
pub fn save_long_term_memory(memory: &LongTermMemory) -> std::io::Result<()> {
    let mut state = load_agent_state();
    state.long_term_memory = memory.clone();
    state.saved_at = chrono::Utc::now().timestamp_millis();
    save_agent_state(&state)
}

/// Save just the conversations
pub fn save_conversations(conversations: &[ConversationSession]) -> std::io::Result<()> {
    let mut state = load_agent_state();
    state.conversations = conversations.to_vec();
    state.saved_at = chrono::Utc::now().timestamp_millis();
    save_agent_state(&state)
}

impl ChangeTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if data has changed since last broadcast
    pub fn has_changed(&mut self, data_type: &str, data: &serde_json::Value) -> bool {
        let data_str = serde_json::to_string(data).unwrap_or_default();
        let current_hash = simple_hash(&data_str);

        let last_hash = self.last_hashes.get(data_type);
        if last_hash == Some(&current_hash) {
            return false;
        }

        self.last_hashes.insert(data_type.to_string(), current_hash);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_hash() {
        let hash1 = simple_hash("test");
        let hash2 = simple_hash("test");
        let hash3 = simple_hash("different");

        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_change_tracker() {
        let mut tracker = ChangeTracker::new();
        let data = serde_json::json!({"key": "value"});

        // First check should return true (changed)
        assert!(tracker.has_changed("test", &data));

        // Same data should return false
        assert!(!tracker.has_changed("test", &data));

        // Different data should return true
        let new_data = serde_json::json!({"key": "new_value"});
        assert!(tracker.has_changed("test", &new_data));
    }
}
