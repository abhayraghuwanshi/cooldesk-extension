use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;
use std::time::Instant;
use tokio::sync::Mutex;
use std::sync::Arc;

/// Idle timeout before auto-unloading model (5 minutes)
const IDLE_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub size: String,
    pub ram: String,
    pub quality: String,
    pub speed: String,
    pub description: String,
    pub filename: String,
    pub downloaded: bool,
    pub file_size: u64,
    pub is_loaded: bool,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmStatus {
    pub initialized: bool,
    pub model_loaded: bool,
    pub current_model: Option<String>,
    pub is_loading: bool,
    pub load_progress: f32,
    pub models_dir: String,
}

/// Internal state with last-used tracking (not serialized)
pub struct LlmInternalState {
    pub status: LlmStatus,
    pub last_used: Option<Instant>,
}

// Store a global status
lazy_static::lazy_static! {
    pub static ref GLOBAL_LLM_STATE: Arc<Mutex<LlmInternalState>> = Arc::new(Mutex::new(LlmInternalState {
        status: LlmStatus {
            initialized: false,
            model_loaded: false,
            current_model: None,
            is_loading: false,
            load_progress: 0.0,
            models_dir: String::new(),
        },
        last_used: None,
    }));
}

pub fn get_models_dir() -> PathBuf {
    let mut path = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push(".cooldesk");
    path.push("models");
    let _ = fs::create_dir_all(&path);
    path
}

pub async fn initialize_llm() -> Result<(), String> {
    let mut state = GLOBAL_LLM_STATE.lock().await;
    state.status.models_dir = get_models_dir().to_string_lossy().to_string();
    state.status.initialized = true;

    // Start idle checker background task
    tokio::spawn(idle_unload_checker());

    Ok(())
}

/// Background task that unloads the model after idle timeout
async fn idle_unload_checker() {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await; // Check every minute

        let should_unload = {
            let state = GLOBAL_LLM_STATE.lock().await;
            if !state.status.model_loaded {
                false
            } else if let Some(last_used) = state.last_used {
                last_used.elapsed().as_secs() > IDLE_TIMEOUT_SECS
            } else {
                false
            }
        };

        if should_unload {
            log::info!("[LLM] Auto-unloading model after {} seconds of inactivity", IDLE_TIMEOUT_SECS);
            let _ = unload_model().await;
        }
    }
}

pub async fn get_available_models() -> Result<Vec<ModelInfo>, String> {
    let models_dir = get_models_dir();
    let state = GLOBAL_LLM_STATE.lock().await;
    let current_model = state.status.current_model.clone();
    drop(state);

    let mut models = Vec::new();

    // Single recommended model: Qwen2.5-7B - best for categorization, summarization, and general tasks
    // Using bartowski's quantization (reliable community source)
    let model_definitions = vec![
        ("Qwen2.5-7B-Instruct-Q4_K_M.gguf", "Qwen2.5 7B", "4.7 GB", "6-8 GB", "Excellent", "Good", "Recommended - Best for categorization & reasoning", "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf"),
    ];

    for (filename, name, size, ram, quality, speed, desc, url) in model_definitions {
        let mut path = models_dir.clone();
        path.push(filename);

        let mut downloaded = false;
        let mut file_size = 0;

        if let Ok(metadata) = std::fs::metadata(&path) {
            if metadata.is_file() {
                file_size = metadata.len();
                // Only consider downloaded if file is > 100MB (valid GGUF, not error page)
                // A 7B Q4 model should be ~4.7GB
                if file_size > 100_000_000 {
                    downloaded = true;
                } else {
                    // File is too small - likely corrupted or error page, delete it
                    log::warn!("[LLM] Deleting corrupted/incomplete model file: {:?} ({} bytes)", path, file_size);
                    let _ = std::fs::remove_file(&path);
                    file_size = 0;
                }
            }
        }

        let is_loaded = current_model.as_deref() == Some(filename);
        
        models.push(ModelInfo {
            name: name.to_string(),
            size: size.to_string(),
            ram: ram.to_string(),
            quality: quality.to_string(),
            speed: speed.to_string(),
            description: desc.to_string(),
            filename: filename.to_string(),
            downloaded,
            file_size,
            is_loaded,
            download_url: url.to_string(),
        });
    }

    Ok(models)
}

pub async fn get_status() -> Result<LlmStatus, String> {
    let state = GLOBAL_LLM_STATE.lock().await;
    Ok(state.status.clone())
}

pub async fn load_model(name: &str, gpu_layers: u32) -> Result<(), String> {
    {
        let mut state = GLOBAL_LLM_STATE.lock().await;
        if state.status.is_loading {
            return Err("Model is already loading".to_string());
        }
        state.status.is_loading = true;
        state.status.load_progress = 10.0;
    }

    let mut model_path = get_models_dir();
    model_path.push(name);

    if !model_path.exists() {
        let mut state = GLOBAL_LLM_STATE.lock().await;
        state.status.is_loading = false;
        state.status.load_progress = 0.0;
        return Err(format!("Model file not found: {:?}", model_path));
    }

    log::info!("[LLM] Loading model from: {:?} (gpu_layers: {})", model_path, gpu_layers);

    // Actually load via the engine
    #[cfg(not(feature = "llm"))]
    return Err("LLM feature not compiled in this build".to_string());

    #[cfg(feature = "llm")]
    match super::engine::engine_load_model(model_path, gpu_layers).await {
        Ok(_) => {
            let mut state = GLOBAL_LLM_STATE.lock().await;
            state.status.is_loading = false;
            state.status.model_loaded = true;
            state.status.load_progress = 100.0;
            state.status.current_model = Some(name.to_string());
            state.last_used = Some(Instant::now());
            log::info!("[LLM] Model loaded successfully: {}", name);
            Ok(())
        }
        Err(e) => {
            let mut state = GLOBAL_LLM_STATE.lock().await;
            state.status.is_loading = false;
            state.status.load_progress = 0.0;
            log::error!("[LLM] Model load failed: {}", e);
            Err(e)
        }
    }
}

pub async fn download_model(
    name: &str,
    progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>>,
) -> Result<String, String> {
    // Look up the download URL from model definitions
    let models = get_available_models().await?;
    let model = models.iter().find(|m| m.filename == name)
        .ok_or_else(|| format!("Unknown model: {}", name))?;

    if model.downloaded {
        return Ok(format!("Model {} already downloaded", name));
    }

    let url = model.download_url.clone();
    let mut path = get_models_dir();
    path.push(name);

    {
        let mut state = GLOBAL_LLM_STATE.lock().await;
        state.status.is_loading = true;
        state.status.load_progress = 0.0;
    }

    log::info!("[LLM] Downloading model {} from {}", name, url);

    // Download with streaming and progress
    let client = reqwest::Client::new();
    let response = client.get(&url).send().await
        .map_err(|e| format!("Request failed: {}", e))?;

    let total_size = response.content_length().unwrap_or(0);
    log::info!("[LLM] Download size: {} bytes ({:.1} GB)", total_size, total_size as f64 / 1_000_000_000.0);

    // Create temp file for writing
    let mut file = tokio::fs::File::create(&path).await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    use tokio::io::AsyncWriteExt;
    use futures_util::StreamExt;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut last_progress_pct: u64 = 0;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk).await
            .map_err(|e| format!("Write error: {}", e))?;

        downloaded += chunk.len() as u64;

        // Update progress (only when percentage changes to avoid spam)
        if total_size > 0 {
            let progress_pct = (downloaded * 100) / total_size;
            if progress_pct != last_progress_pct {
                last_progress_pct = progress_pct;

                // Update global state
                {
                    let mut state = GLOBAL_LLM_STATE.lock().await;
                    state.status.load_progress = progress_pct as f32;
                }

                // Call progress callback if provided
                if let Some(ref cb) = progress_callback {
                    cb(downloaded, total_size);
                }
            }
        }
    }

    file.flush().await.map_err(|e| format!("Flush error: {}", e))?;

    log::info!("[LLM] Model downloaded: {} ({} bytes)", name, downloaded);

    let mut state = GLOBAL_LLM_STATE.lock().await;
    state.status.load_progress = 100.0;
    state.status.is_loading = false;

    Ok(path.to_string_lossy().to_string())
}

pub async fn unload_model() -> Result<(), String> {
    // Actually unload from the engine thread
    #[cfg(feature = "llm")]
    let _ = super::engine::engine_unload_model().await;

    let mut state = GLOBAL_LLM_STATE.lock().await;
    state.status.model_loaded = false;
    state.status.current_model = None;
    state.last_used = None;
    log::info!("[LLM] Model unloaded");
    Ok(())
}

/// Auto-load the first available downloaded model (called before chat)
pub async fn ensure_model_loaded() -> Result<(), String> {
    // Check if already loaded
    {
        let state = GLOBAL_LLM_STATE.lock().await;
        if state.status.model_loaded {
            return Ok(());
        }
        if state.status.is_loading {
            return Err("Model is currently loading".to_string());
        }
    }

    // Find first downloaded model
    let models = get_available_models().await?;
    let downloaded_model = models.iter().find(|m| m.downloaded);

    match downloaded_model {
        Some(model) => {
            log::info!("[LLM] Auto-loading model: {}", model.filename);
            // Use 0 GPU layers by default for compatibility
            load_model(&model.filename, 0).await
        }
        None => Err("No model downloaded. Please download a model first.".to_string()),
    }
}

/// Update last_used timestamp (call after each successful inference)
pub async fn touch_last_used() {
    let mut state = GLOBAL_LLM_STATE.lock().await;
    state.last_used = Some(Instant::now());
}

