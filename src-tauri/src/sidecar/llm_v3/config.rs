use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudConfig {
    pub provider: String, // "openai" | "anthropic"
    pub api_key: String,
    pub model: String,
}

impl Default for CloudConfig {
    fn default() -> Self {
        Self {
            provider: "openai".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
        }
    }
}

fn config_path() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join("sync-data").join("cloud_config.json")
}

pub fn load_config() -> CloudConfig {
    let path = config_path();
    if !path.exists() {
        return CloudConfig::default();
    }
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => CloudConfig::default(),
    }
}

pub fn save_config(config: &CloudConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Returns the API key — config file takes priority, env var is the fallback.
pub fn get_api_key() -> Option<String> {
    let from_file = load_config().api_key;
    if !from_file.is_empty() {
        return Some(from_file);
    }
    std::env::var("OPENAI_API_KEY").ok().filter(|k| !k.is_empty())
}

/// Mask an API key for safe display: "sk-abc...xyz1"
pub fn mask_key(key: &str) -> String {
    if key.len() <= 8 {
        return "***".to_string();
    }
    let prefix = &key[..6];
    let suffix = &key[key.len() - 4..];
    format!("{}...{}", prefix, suffix)
}
