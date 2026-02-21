//! Actual llama-cpp-2 engine that runs inference on a background thread.
//! All llama operations happen on a single dedicated thread via channels.

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;

/// Commands sent to the engine thread
enum EngineCommand {
    LoadModel {
        path: PathBuf,
        gpu_layers: u32,
        respond: mpsc::Sender<Result<(), String>>,
    },
    UnloadModel {
        respond: mpsc::Sender<Result<(), String>>,
    },
    Chat {
        prompt: String,
        max_tokens: u32,
        respond: mpsc::Sender<Result<String, String>>,
    },
}

/// Global sender to communicate with the engine thread
static ENGINE_TX: Mutex<Option<mpsc::Sender<EngineCommand>>> = Mutex::new(None);

/// Start the engine background thread (call once at startup)
pub fn start_engine() {
    let mut tx_guard = ENGINE_TX.lock().unwrap();
    if tx_guard.is_some() {
        return; // Already started
    }

    let (tx, rx) = mpsc::channel::<EngineCommand>();
    *tx_guard = Some(tx);
    drop(tx_guard);

    std::thread::spawn(move || {
        engine_thread(rx);
    });

    log::info!("[LLM Engine] Background thread started");
}

/// The engine thread loop - owns all llama objects
fn engine_thread(rx: mpsc::Receiver<EngineCommand>) {
    // Initialize the backend once
    let backend = match LlamaBackend::init() {
        Ok(b) => b,
        Err(e) => {
            log::error!("[LLM Engine] Failed to init backend: {:?}", e);
            return;
        }
    };

    let gpu_supported = backend.supports_gpu_offload();
    log::info!("[LLM Engine] Backend initialized, GPU offload supported: {}", gpu_supported);

    let mut current_model: Option<LlamaModel> = None;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            EngineCommand::LoadModel { path, gpu_layers, respond } => {
                log::info!("[LLM Engine] Loading model: {:?} (gpu_layers: {})", path, gpu_layers);

                // Unload previous model
                current_model = None;

                let mut params = LlamaModelParams::default();
                if gpu_layers > 0 && gpu_supported {
                    params = params.with_n_gpu_layers(gpu_layers);
                    log::info!("[LLM Engine] GPU offload enabled: {} layers", gpu_layers);
                }

                match LlamaModel::load_from_file(&backend, &path, &params) {
                    Ok(model) => {
                        log::info!("[LLM Engine] Model loaded successfully");
                        current_model = Some(model);
                        let _ = respond.send(Ok(()));
                    }
                    Err(e) => {
                        log::error!("[LLM Engine] Failed to load model: {:?}", e);
                        let _ = respond.send(Err(format!("Failed to load: {:?}", e)));
                    }
                }
            }

            EngineCommand::UnloadModel { respond } => {
                current_model = None;
                log::info!("[LLM Engine] Model unloaded");
                let _ = respond.send(Ok(()));
            }

            EngineCommand::Chat {
                prompt,
                max_tokens,
                respond,
            } => {
                let model = match &current_model {
                    Some(m) => m,
                    None => {
                        let _ = respond.send(Err("No model loaded".to_string()));
                        continue;
                    }
                };

                let result = run_inference(model, &backend, &prompt, max_tokens);
                let _ = respond.send(result);
            }
        }
    }

    log::info!("[LLM Engine] Thread exiting");
}

/// Run inference on the model (called from engine thread)
fn run_inference(
    model: &LlamaModel,
    backend: &LlamaBackend,
    prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    // Build chat template prompt
    let system_msg = LlamaChatMessage::new(
        "system".to_string(),
        "You are CoolDesk AI, a helpful desktop assistant. Be concise and direct.".to_string(),
    )
    .map_err(|e| format!("Failed to create system message: {:?}", e))?;

    let user_msg = LlamaChatMessage::new("user".to_string(), prompt.to_string())
        .map_err(|e| format!("Failed to create user message: {:?}", e))?;

    let messages = vec![system_msg, user_msg];

    // Get chat template from model, fallback to chatml
    let template = model
        .chat_template(None)
        .or_else(|_| llama_cpp_2::model::LlamaChatTemplate::new("chatml"))
        .map_err(|e| format!("Failed to get chat template: {:?}", e))?;

    let formatted_prompt = model
        .apply_chat_template(&template, &messages, true)
        .map_err(|e| format!("Failed to apply chat template: {:?}", e))?;

    log::debug!(
        "[LLM Engine] Formatted prompt ({} chars): {}...",
        formatted_prompt.len(),
        &formatted_prompt[..formatted_prompt.len().min(200)]
    );

    // Create context
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(std::num::NonZeroU32::new(1024))
        .with_n_threads(4)
        .with_n_threads_batch(4);

    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|e| format!("Failed to create context: {:?}", e))?;

    // Tokenize
    let tokens = model
        .str_to_token(&formatted_prompt, llama_cpp_2::model::AddBos::Always)
        .map_err(|e| format!("Tokenization failed: {:?}", e))?;

    log::info!("[LLM Engine] Prompt tokenized: {} tokens", tokens.len());

    // Create batch and add tokens
    let mut batch = LlamaBatch::new(1024, 1);

    let last_idx = tokens.len() as i32 - 1;
    for (i, token) in tokens.iter().enumerate() {
        let is_last = i as i32 == last_idx;
        batch
            .add(*token, i as i32, &[0], is_last)
            .map_err(|_| "Failed to add token to batch".to_string())?;
    }

    // Decode prompt
    ctx.decode(&mut batch)
        .map_err(|e| format!("Decode failed: {:?}", e))?;

    // Set up sampling
    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::temp(0.7),
        LlamaSampler::dist(42),
    ]);

    // Generate tokens
    let mut output_tokens: Vec<LlamaToken> = Vec::new();
    let mut n_cur = batch.n_tokens();
    let eos_token = model.token_eos();

    let mut decoder = encoding_rs::UTF_8.new_decoder();

    // First sample: logits are at the last position in the prompt batch
    let mut logits_idx = batch.n_tokens() - 1;

    for _ in 0..max_tokens {
        let new_token = sampler.sample(&ctx, logits_idx);

        // Check for EOS
        if new_token == eos_token {
            break;
        }

        output_tokens.push(new_token);

        // Prepare next batch (single token)
        batch.clear();
        batch
            .add(new_token, n_cur, &[0], true)
            .map_err(|_| "Failed to add generated token".to_string())?;

        ctx.decode(&mut batch)
            .map_err(|e| format!("Decode failed: {:?}", e))?;

        n_cur += 1;
        // After a single-token batch, logits are always at index 0
        logits_idx = 0;
    }

    // Convert tokens to string
    let mut result = String::new();
    for token in &output_tokens {
        if let Ok(piece) = model.token_to_piece(*token, &mut decoder, false, None) {
            result.push_str(&piece);
        }
    }

    log::info!(
        "[LLM Engine] Generated {} tokens: {}...",
        output_tokens.len(),
        &result[..result.len().min(100)]
    );

    Ok(result.trim().to_string())
}

// ==========================================
// Public async API (called from handlers)
// ==========================================

fn send_command(cmd: EngineCommand) -> Result<(), String> {
    let tx_guard = ENGINE_TX.lock().map_err(|e| format!("Lock error: {}", e))?;
    let tx = tx_guard
        .as_ref()
        .ok_or_else(|| "Engine not started".to_string())?;
    tx.send(cmd).map_err(|e| format!("Send error: {}", e))
}

/// Load a model file (async-safe, sends to engine thread)
pub async fn engine_load_model(path: PathBuf, gpu_layers: u32) -> Result<(), String> {
    start_engine(); // ensure engine is running

    let (tx, rx) = mpsc::channel();
    send_command(EngineCommand::LoadModel { path, gpu_layers, respond: tx })?;

    tokio::task::spawn_blocking(move || rx.recv().map_err(|e| format!("Recv error: {}", e))?)
        .await
        .map_err(|e| format!("Join error: {}", e))?
}

/// Unload the current model (async-safe)
pub async fn engine_unload_model() -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    send_command(EngineCommand::UnloadModel { respond: tx })?;

    tokio::task::spawn_blocking(move || rx.recv().map_err(|e| format!("Recv error: {}", e))?)
        .await
        .map_err(|e| format!("Join error: {}", e))?
}

/// Run chat inference (async-safe)
pub async fn engine_chat(prompt: String, max_tokens: u32) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();
    send_command(EngineCommand::Chat {
        prompt,
        max_tokens,
        respond: tx,
    })?;

    tokio::task::spawn_blocking(move || rx.recv().map_err(|e| format!("Recv error: {}", e))?)
        .await
        .map_err(|e| format!("Join error: {}", e))?
}
