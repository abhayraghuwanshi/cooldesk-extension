use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;
use tokio::sync::Mutex;
use std::sync::Arc;

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

// Store a global status
lazy_static::lazy_static! {
    pub static ref GLOBAL_LLM_STATE: Arc<Mutex<LlmStatus>> = Arc::new(Mutex::new(LlmStatus {
        initialized: false,
        model_loaded: false,
        current_model: None,
        is_loading: false,
        load_progress: 0.0,
        models_dir: String::new(), // Will be initialized
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
    state.models_dir = get_models_dir().to_string_lossy().to_string();
    state.initialized = true;
    Ok(())
}

pub async fn get_available_models() -> Result<Vec<ModelInfo>, String> {
    let models_dir = get_models_dir();
    let state = GLOBAL_LLM_STATE.lock().await;
    let current_model = state.current_model.clone();
    drop(state);

    let mut models = Vec::new();

    let model_definitions = vec![
        ("llama-3.2-1b-instruct.Q4_K_M.gguf", "Llama 3.2 1B", "800 MB", "2-3 GB", "Good", "Fast", "Recommended - Good balance", "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"),
        ("qwen2.5-1.5b-instruct.Q4_K_M.gguf", "Qwen2.5 1.5B", "1 GB", "2-4 GB", "Good", "Fast", "Strong reasoning ability", "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"),
        ("smollm2-1.7b-instruct.Q4_K_M.gguf", "SmolLM2 1.7B", "1 GB", "2-4 GB", "Good", "Fast", "Efficient and capable", "https://huggingface.co/bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf"),
        ("qwen2.5-0.5b-instruct.Q4_K_M.gguf", "Qwen2.5 0.5B", "400 MB", "1-2 GB", "Basic", "Ultra Fast", "Ultra light, simple tasks", "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf")
    ];

    for (filename, name, size, ram, quality, speed, desc, url) in model_definitions {
        let mut path = models_dir.clone();
        path.push(filename);
        
        let mut downloaded = false;
        let mut file_size = 0;
        
        if let Ok(metadata) = std::fs::metadata(&path) {
            if metadata.is_file() {
                downloaded = true;
                file_size = metadata.len();
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
    Ok(state.clone())
}

pub async fn load_model(name: &str, gpu_layers: u32) -> Result<(), String> {
    {
        let mut state = GLOBAL_LLM_STATE.lock().await;
        if state.is_loading {
            return Err("Model is already loading".to_string());
        }
        state.is_loading = true;
        state.load_progress = 10.0;
    }

    let mut model_path = get_models_dir();
    model_path.push(name);

    if !model_path.exists() {
        let mut state = GLOBAL_LLM_STATE.lock().await;
        state.is_loading = false;
        state.load_progress = 0.0;
        return Err(format!("Model file not found: {:?}", model_path));
    }

    log::info!("[LLM] Loading model from: {:?} (gpu_layers: {})", model_path, gpu_layers);

    // Actually load via the engine
    match super::engine::engine_load_model(model_path, gpu_layers).await {
        Ok(_) => {
            let mut state = GLOBAL_LLM_STATE.lock().await;
            state.is_loading = false;
            state.model_loaded = true;
            state.load_progress = 100.0;
            state.current_model = Some(name.to_string());
            log::info!("[LLM] Model loaded successfully: {}", name);
            Ok(())
        }
        Err(e) => {
            let mut state = GLOBAL_LLM_STATE.lock().await;
            state.is_loading = false;
            state.load_progress = 0.0;
            log::error!("[LLM] Model load failed: {}", e);
            Err(e)
        }
    }
}

pub async fn download_model(name: &str) -> Result<String, String> {
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
        state.is_loading = true;
        state.load_progress = 0.0;
    }

    log::info!("[LLM] Downloading model {} from {}", name, url);

    // Download using reqwest
    match reqwest::get(&url).await {
        Ok(response) => {
            let total_size = response.content_length().unwrap_or(0);
            let bytes = response.bytes().await
                .map_err(|e| format!("Download failed: {}", e))?;

            tokio::fs::write(&path, &bytes).await
                .map_err(|e| format!("Failed to save model: {}", e))?;

            log::info!("[LLM] Model downloaded: {} ({} bytes)", name, bytes.len());

            let mut state = GLOBAL_LLM_STATE.lock().await;
            state.load_progress = 100.0;
            state.is_loading = false;

            Ok(path.to_string_lossy().to_string())
        }
        Err(e) => {
            let mut state = GLOBAL_LLM_STATE.lock().await;
            state.is_loading = false;
            state.load_progress = 0.0;
            Err(format!("Download failed: {}", e))
        }
    }
}

pub async fn unload_model() -> Result<(), String> {
    // Actually unload from the engine thread
    let _ = super::engine::engine_unload_model().await;

    let mut state = GLOBAL_LLM_STATE.lock().await;
    state.model_loaded = false;
    state.current_model = None;
    log::info!("[LLM] Model unloaded");
    Ok(())
}

