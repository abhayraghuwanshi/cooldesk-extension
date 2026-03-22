// HTTP + WebSocket server for sidecar

use crate::sidecar::data::*;
use crate::sidecar::handlers::*;
use crate::sidecar::sync::*;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{header, HeaderMap, HeaderValue, Method},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

const PORT: u16 = 4545;
const WS_MAX_PAYLOAD: usize = 100 * 1024 * 1024; // 100MB

/// Start the sidecar server
pub async fn start_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Create broadcast channel for WebSocket messages
    let (ws_tx, _) = broadcast::channel::<String>(100);

    // Create shared state
    let state = Arc::new(AppState::new(ws_tx.clone()));

    // Start background app activity tracking
    let tracker_state = state.clone();
    tokio::spawn(async move {
        let mut last_visible_set: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        
        loop {
            interval.tick().await;
            
            let visible_apps = crate::system::get_visible_apps_info().await;
            let mut current_visible_set = std::collections::HashSet::new();
            let mut newly_visible = Vec::new();
            
            for app in visible_apps {
                if crate::system::is_browser(&app.name) { continue; }
                
                let app_identity = format!("{}:{}", app.name, app.title);
                current_visible_set.insert(app_identity.clone());
                
                if !last_visible_set.contains(&app_identity) {
                    newly_visible.push(app);
                }
            }

            if !newly_visible.is_empty() {
                let now = chrono::Utc::now().timestamp_millis();
                let mut activities = Vec::new();

                for app in newly_visible {
                    let activity = Activity {
                        id: Some(format!("activity-{}", now)),
                        timestamp: Some(now),
                        activity_type: Some("app".to_string()),
                        url: Some(app.path.clone()),
                        title: Some(app.title.clone()),
                        created_at: Some(now),
                        updated_at: Some(now),
                        ..Default::default()  // Fill remaining fields (time, scroll, clicks, etc.) with None
                    };
                    activities.push(activity);
                }

                // Update state and broadcast
                {
                    let mut data = tracker_state.sync_data.write().await;
                    for act in &activities {
                        data.activity.push(act.clone());
                    }
                    // Keep last 1000
                    if data.activity.len() > 1000 {
                        let to_remove = data.activity.len() - 1000;
                        data.activity.drain(0..to_remove);
                    }
                }

                tracker_state.broadcast("activity-updated", serde_json::to_value(activities).unwrap_or_default());
            }

            last_visible_set = current_visible_set;
        }
    });

    // Allowed origins for security - only our extension and Tauri webview
    // TODO: Replace YOUR_EXTENSION_ID with your actual Chrome extension ID
    let allowed_origins: Vec<HeaderValue> = vec![
        "chrome-extension://kbgfibnflipndmhofhoocjjmljjkkjop".parse().unwrap(),
        "tauri://localhost".parse().unwrap(),
        "http://tauri.localhost".parse().unwrap(),
        "http://localhost:5173".parse().unwrap(),  // Vite dev server
        "http://127.0.0.1:5173".parse().unwrap(),
        "http://localhost:1420".parse().unwrap(),  // Tauri dev
        "http://127.0.0.1:1420".parse().unwrap(),
    ];

    // CORS configuration - restrict to allowed origins
    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE]);

    // Build router
    let app = Router::new()
        // Health check
        .route("/health", get(health))
        // App search (for testing recommendations)
        .route("/search", get(search_apps))
        // GET endpoints
        .route("/workspaces", get(get_workspaces).post(post_workspaces))
        .route("/urls", get(get_urls).post(post_urls))
        .route("/tabs", get(get_tabs).post(post_tabs))
        .route("/settings", get(get_settings).post(post_settings))
        .route("/activity", get(get_activity).post(post_activity))
        .route("/activity/focused", get(get_focused_app))
        .route("/activity/visible", get(get_visible_apps))
        .route("/activity/all-desktops", get(get_all_desktop_apps))
        .route("/notes", get(get_notes).post(post_notes))
        .route("/url-notes", get(get_url_notes).post(post_url_notes))
        .route("/pins", get(get_pins).post(post_pins))
        .route("/scraped-chats", get(get_scraped_chats).post(post_scraped_chats))
        .route("/scraped-configs", get(get_scraped_configs).post(post_scraped_configs))
        .route("/daily-memory", get(get_daily_memory).post(post_daily_memory))
        .route("/ui-state", get(get_ui_state).post(post_ui_state))
        .route("/dashboard", get(get_dashboard).post(post_dashboard))
        // Commands
        .route("/cmd/jump-to-tab", post(cmd_jump_to_tab))
        // Full sync
        .route("/sync", post(post_sync))
        // WebSocket
        .route("/ws", get(ws_handler))
        // Fallback for root WebSocket connection
        .route("/", get(ws_handler))
        // LLM specific endpoints
        .route("/llm/models", get(llm_models))
        .route("/llm/status", get(llm_status))
        .route("/llm/download", post(llm_download))
        .route("/llm/load", post(llm_load))
        .route("/llm/unload", post(llm_unload))
        .route("/llm/chat", post(llm_chat))
        .route("/llm/summarize", post(llm_summarize))
        .route("/llm/group-workspaces", post(llm_group_workspaces))
        .route("/llm/suggest-related", post(llm_suggest_related))
        .route("/llm/enhance-url", post(llm_enhance_url))
        .route("/llm/suggest-workspaces", post(llm_suggest_workspaces))
        .route("/llm/parse-command", post(llm_parse_command))
        // LLM v2 Agent endpoints
        .route("/llm/v2/sessions", get(v2_list_sessions).post(v2_create_session))
        .route("/llm/v2/sessions/:id", get(v2_get_session).delete(v2_delete_session))
        .route("/llm/v2/chat", post(v2_chat))
        .route("/llm/v2/memory", get(v2_get_memory).post(v2_add_memory))
        .route("/llm/v2/memory/clear", post(v2_clear_memory))
        // Simple Agent endpoint (context-injection, no tool routing)
        .route("/llm/v2/simple-chat", post(v2_simple_chat))
        // Feedback/RL endpoints
        .route("/feedback/event", post(feedback_record_event))
        .route("/feedback/stats", get(feedback_get_stats))
        .route("/feedback/grouping", post(feedback_record_grouping))
        .route("/feedback/affinity", get(feedback_get_affinity))
        .route("/feedback/url-workspace", post(feedback_record_url_workspace))
        .route("/feedback/suggest-workspace", post(feedback_suggest_workspace))
        .route("/feedback/events", get(feedback_get_events))
        .route("/feedback/save", post(feedback_save))
        .route("/feedback/app-launch", post(feedback_app_launch))
        .route("/feedback/url-click", post(feedback_url_click))
        .route("/feedback/app-workspace", post(feedback_record_app_workspace))
        .route("/feedback/suggest-apps", post(feedback_suggest_apps))
        .route("/feedback/suggest-workspaces-for-app", post(feedback_suggest_workspaces_for_app))
        .layer(cors)
        .with_state(state);

    let addr = format!("127.0.0.1:{}", PORT);
    log::info!("[Sidecar] Server running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Check if origin is allowed for WebSocket connections
fn is_allowed_origin(headers: &HeaderMap) -> bool {
    const ALLOWED_PREFIXES: &[&str] = &[
        "chrome-extension://",
        "tauri://",
        "http://tauri.localhost",
        "http://localhost:",
        "http://127.0.0.1:",
    ];

    match headers.get("origin").and_then(|v| v.to_str().ok()) {
        Some(origin) => ALLOWED_PREFIXES.iter().any(|prefix| origin.starts_with(prefix)),
        None => true, // Allow requests with no Origin (internal/native calls)
    }
}

/// WebSocket upgrade handler
async fn ws_handler(
    headers: HeaderMap,
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // Check origin for WebSocket connections
    if !is_allowed_origin(&headers) {
        log::warn!("[Sidecar] WebSocket connection rejected - invalid origin: {:?}",
            headers.get("origin"));
        return (axum::http::StatusCode::FORBIDDEN, "Forbidden").into_response();
    }

    ws.max_message_size(WS_MAX_PAYLOAD)
        .on_upgrade(move |socket| handle_ws_connection(socket, state))
        .into_response()
}

/// Handle individual WebSocket connection
async fn handle_ws_connection(socket: WebSocket, state: Arc<AppState>) {
    let client_id = format!(
        "client-{}-{}",
        chrono::Utc::now().timestamp_millis(),
        rand::random::<u16>()
    );

    log::info!("[Sidecar] WebSocket client connected: {}", client_id);

    let (mut sender, mut receiver) = socket.split();

    // Subscribe to broadcasts
    let mut broadcast_rx = state.ws_broadcast.subscribe();

    // Send initial sync state with client ID so client knows its identity
    {
        let data = state.sync_data.read().await;
        log::info!("[Sidecar] Sending initial sync-state to {}: {} notes, {} workspaces, {} tabs, {} urls, {} pins, {} urlNotes",
            client_id, data.notes.len(), data.workspaces.len(), data.tabs.len(),
            data.urls.len(), data.pins.len(), data.url_notes.len());

        let sync_state = SyncStatePayload::from(&*data);
        log::info!("[Sidecar] SyncStatePayload notes count: {}", sync_state.notes.len());

        // Include clientId in the message so client can identify itself
        let msg = WsMessage::new("sync-state", serde_json::to_value(&sync_state).unwrap_or_default());
        // Add clientId to the message
        let mut msg_json = serde_json::to_value(&msg).unwrap_or_default();
        if let Some(obj) = msg_json.as_object_mut() {
            obj.insert("clientId".to_string(), serde_json::json!(client_id));
        }
        if let Ok(json) = serde_json::to_string(&msg_json) {
            log::debug!("[Sidecar] sync-state JSON length: {} bytes", json.len());
            let _ = sender.send(Message::Text(json.into())).await;
        }
    }

    // Spawn task to forward broadcasts to this client
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = broadcast_rx.recv().await {
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages
    let state_clone = state.clone();
    let client_id_for_recv = client_id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                handle_ws_message(&state_clone, &client_id_for_recv, &text).await;
            }
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    log::info!("[Sidecar] WebSocket client disconnected: {}", client_id);

    // Only clean up the client_to_device mapping on disconnect — do NOT clear tabs.
    // Chrome service workers frequently suspend and resume, triggering spurious disconnect
    // events. Clearing tabs on disconnect would cause the Tauri app to briefly see 0 tabs
    // every time the service worker sleeps. The extension always pushes fresh tabs on
    // reconnect, so stale entries in device_tabs_map are overwritten automatically.
    {
        let mut data = state.sync_data.write().await;
        data.client_to_device.remove(&client_id);
    }
}

/// Handle incoming WebSocket message
async fn handle_ws_message(state: &Arc<AppState>, client_id: &str, text: &str) {
    let msg: WsMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            log::warn!("[Sidecar] Invalid WebSocket message from {}: {}", client_id, e);
            return;
        }
    };

    log::debug!("[Sidecar] Message from {}: type={}", client_id, msg.msg_type);

    match msg.msg_type.as_str() {
        "identify" => {
            // Client identification - just log it
            if let Some(payload) = &msg.payload {
                let client_type = payload.get("client").and_then(|v| v.as_str()).unwrap_or("unknown");
                log::info!("[Sidecar] Client {} identified as: {}", client_id, client_type);
            }
        }

        "request-state" => {
            // Send current sync state
            let data = state.sync_data.read().await;
            let sync_state = SyncStatePayload::from(&*data);
            state.broadcast("sync-state", serde_json::to_value(&sync_state).unwrap_or_default());
        }

        "push-workspaces" => {
            if let Some(payload) = msg.payload {
                if let Ok(workspaces) = serde_json::from_value::<Vec<Workspace>>(payload) {
                    let mut data = state.sync_data.write().await;
                    data.workspaces = merge_workspaces_by_name(data.workspaces.clone(), workspaces);
                    data.last_updated.insert("workspaces".to_string(), chrono::Utc::now().timestamp_millis());

                    let payload = serde_json::to_value(&data.workspaces).unwrap_or_default();
                    drop(data);
                    // Exclude sender from broadcast to prevent sync loop
                    state.save_and_broadcast_excluding("workspaces", payload, Some(client_id)).await;
                }
            }
        }

        "push-urls" => {
            if let Some(payload) = msg.payload {
                if let Ok(urls) = serde_json::from_value::<Vec<UrlEntry>>(payload) {
                    let mut data = state.sync_data.write().await;
                    data.urls = merge_urls(data.urls.clone(), urls);
                    data.last_updated.insert("urls".to_string(), chrono::Utc::now().timestamp_millis());

                    let payload = serde_json::to_value(&data.urls).unwrap_or_default();
                    drop(data);
                    state.save_and_broadcast_excluding("urls", payload, Some(client_id)).await;
                }
            }
        }

        "push-tabs" => {
            if let Some(payload) = msg.payload {
                let (tabs, device_id) = if payload.is_array() {
                    (serde_json::from_value::<Vec<Tab>>(payload.clone()).unwrap_or_default(), format!("ws-{}", client_id))
                } else if let Ok(push_payload) = serde_json::from_value::<PushTabsPayload>(payload.clone()) {
                    let d_id = push_payload.device_id.unwrap_or_else(|| format!("ws-{}", client_id));
                    (push_payload.tabs, d_id)
                } else {
                    return;
                };

                let mut data = state.sync_data.write().await;
                // Track this client's device association for reliable cleanup on disconnect
                data.client_to_device.insert(client_id.to_string(), device_id.clone());
                
                data.device_tabs_map.insert(device_id, tabs);
                data.tabs = recompute_aggregated_tabs(&data.device_tabs_map);
                data.last_updated.insert("tabs".to_string(), chrono::Utc::now().timestamp_millis());

                let payload = serde_json::to_value(&data.tabs).unwrap_or_default();
                drop(data);
                state.save_and_broadcast_excluding("tabs", payload, Some(client_id)).await;
            }
        }

        "push-settings" => {
            if let Some(payload) = msg.payload {
                if let Ok(settings) = serde_json::from_value::<std::collections::HashMap<String, serde_json::Value>>(payload) {
                    let mut data = state.sync_data.write().await;
                    data.settings.extend(settings);
                    data.last_updated.insert("settings".to_string(), chrono::Utc::now().timestamp_millis());

                    let payload = serde_json::to_value(&data.settings).unwrap_or_default();
                    drop(data);
                    state.save_and_broadcast_excluding("settings", payload, Some(client_id)).await;
                }
            }
        }

        "push-notes" => {
            log::info!("[Sidecar] WS push-notes received from {}", client_id);
            if let Some(payload) = msg.payload {
                log::info!("[Sidecar] WS push-notes payload type: {}",
                    if payload.is_array() { "array" } else if payload.is_object() { "object" } else { "other" });

                match serde_json::from_value::<Vec<Note>>(payload.clone()) {
                    Ok(notes) => {
                        log::info!("[Sidecar] WS push-notes parsed {} notes", notes.len());

                        let mut data = state.sync_data.write().await;
                        let before_count = data.notes.len();
                        data.notes = merge_notes(data.notes.clone(), notes);
                        let after_count = data.notes.len();
                        log::info!("[Sidecar] WS push-notes merged: {} -> {} notes", before_count, after_count);

                        data.last_updated.insert("notes".to_string(), chrono::Utc::now().timestamp_millis());

                        let payload = serde_json::to_value(&data.notes).unwrap_or_default();
                        drop(data);
                        state.save_and_broadcast_excluding("notes", payload, Some(client_id)).await;
                        log::info!("[Sidecar] WS push-notes broadcast complete");
                    }
                    Err(e) => {
                        log::error!("[Sidecar] WS push-notes failed to parse: {}", e);
                    }
                }
            } else {
                log::warn!("[Sidecar] WS push-notes received with no payload");
            }
        }

        "push-url-notes" => {
            if let Some(payload) = msg.payload {
                if let Ok(url_notes) = serde_json::from_value::<Vec<UrlNote>>(payload) {
                    let mut data = state.sync_data.write().await;
                    data.url_notes = merge_url_notes(data.url_notes.clone(), url_notes);
                    data.last_updated.insert("urlNotes".to_string(), chrono::Utc::now().timestamp_millis());

                    let payload = serde_json::to_value(&data.url_notes).unwrap_or_default();
                    drop(data);
                    state.save_and_broadcast_excluding("url-notes", payload, Some(client_id)).await;
                }
            }
        }

        "push-pins" => {
            if let Some(payload) = msg.payload {
                if let Ok(pins) = serde_json::from_value::<Vec<Pin>>(payload) {
                    let mut data = state.sync_data.write().await;
                    data.pins = merge_pins(data.pins.clone(), pins);
                    data.last_updated.insert("pins".to_string(), chrono::Utc::now().timestamp_millis());

                    let payload = serde_json::to_value(&data.pins).unwrap_or_default();
                    drop(data);
                    state.save_and_broadcast_excluding("pins", payload, Some(client_id)).await;
                }
            }
        }

        "push-scraped-chats" => {
            if let Some(payload) = msg.payload {
                if let Ok(chats) = serde_json::from_value::<Vec<ScrapedChat>>(payload) {
                    let mut data = state.sync_data.write().await;
                    data.scraped_chats = merge_scraped_chats(data.scraped_chats.clone(), chats);
                    data.last_updated.insert("scrapedChats".to_string(), chrono::Utc::now().timestamp_millis());

                    let payload = serde_json::to_value(&data.scraped_chats).unwrap_or_default();
                    drop(data);
                    state.save_and_broadcast_excluding("scraped-chats", payload, Some(client_id)).await;
                }
            }
        }

        "push-scraped-configs" => {
            if let Some(payload) = msg.payload {
                if let Ok(configs) = serde_json::from_value::<Vec<ScrapedConfig>>(payload) {
                    let mut data = state.sync_data.write().await;
                    data.scraped_configs = merge_scraped_configs(data.scraped_configs.clone(), configs);
                    data.last_updated.insert("scrapedConfigs".to_string(), chrono::Utc::now().timestamp_millis());

                    let payload = serde_json::to_value(&data.scraped_configs).unwrap_or_default();
                    drop(data);
                    state.save_and_broadcast_excluding("scraped-configs", payload, Some(client_id)).await;
                }
            }
        }

        "push-daily-memory" => {
            if let Some(payload) = msg.payload {
                if let Ok(memory) = serde_json::from_value::<Vec<DailyMemory>>(payload) {
                    let mut data = state.sync_data.write().await;
                    data.daily_memory = merge_daily_memory(data.daily_memory.clone(), memory);
                    data.last_updated.insert("dailyMemory".to_string(), chrono::Utc::now().timestamp_millis());

                    let payload = serde_json::to_value(&data.daily_memory).unwrap_or_default();
                    drop(data);
                    state.save_and_broadcast_excluding("daily-memory", payload, Some(client_id)).await;
                }
            }
        }

        "push-ui-state" => {
            if let Some(payload) = msg.payload {
                if let Ok(ui_state) = serde_json::from_value::<std::collections::HashMap<String, serde_json::Value>>(payload) {
                    let mut data = state.sync_data.write().await;
                    data.ui_state.extend(ui_state);
                    data.last_updated.insert("uiState".to_string(), chrono::Utc::now().timestamp_millis());

                    let payload = serde_json::to_value(&data.ui_state).unwrap_or_default();
                    drop(data);
                    state.save_and_broadcast_excluding("ui-state", payload, Some(client_id)).await;
                }
            }
        }

        "push-dashboard" => {
            if let Some(payload) = msg.payload {
                if let Ok(mut dashboard) = serde_json::from_value::<std::collections::HashMap<String, serde_json::Value>>(payload) {
                    // Safety check
                    if dashboard.contains_key("data") {
                        log::warn!("[Sidecar] Blocked recursive dashboard.data payload");
                        dashboard.remove("data");
                    }

                    let mut data = state.sync_data.write().await;
                    data.dashboard.extend(dashboard);
                    data.last_updated.insert("dashboard".to_string(), chrono::Utc::now().timestamp_millis());

                    let payload = serde_json::to_value(&data.dashboard).unwrap_or_default();
                    drop(data);
                    state.save_and_broadcast_excluding("dashboard", payload, Some(client_id)).await;
                }
            }
        }

        "push-activity" => {
            if let Some(payload) = msg.payload {
                let activities: Vec<Activity> = if payload.is_array() {
                    serde_json::from_value(payload).unwrap_or_default()
                } else {
                    vec![serde_json::from_value(payload).unwrap_or_default()]
                };

                let mut data = state.sync_data.write().await;
                data.activity = append_activity(data.activity.clone(), activities.clone());
                data.last_updated.insert("activity".to_string(), chrono::Utc::now().timestamp_millis());

                let payload = serde_json::to_value(&activities).unwrap_or_default();
                drop(data);
                state.save_and_broadcast_excluding("activity", payload, Some(client_id)).await;
            }
        }

        "request-native-focus" => {
            if let Some(payload) = msg.payload {
                let browser = payload.get("browser").and_then(|v| v.as_str()).unwrap_or("unknown");
                log::info!("[Sidecar] Native focus requested for: {}", browser);
                state.broadcast("native-focus", payload);
            }
        }

        // ==========================================
        // LLM WebSocket Handlers (for localAIService.js)
        // ==========================================

        "llm-get-status" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if let Ok(status) = crate::sidecar::llm::models::get_status().await {
                let mut response = serde_json::to_value(&status).unwrap_or_default();
                if let Some(obj) = response.as_object_mut() {
                    obj.insert("ok".to_string(), serde_json::json!(true));
                    obj.insert("requestId".to_string(), serde_json::json!(request_id));
                }
                state.broadcast("llm-status", response);
            }
        }

        "llm-get-models" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if let Ok(models) = crate::sidecar::llm::models::get_available_models().await {
                let models_map: std::collections::HashMap<String, _> = models
                    .into_iter()
                    .map(|m| (m.filename.clone(), m))
                    .collect();
                state.broadcast("llm-models", serde_json::json!({
                    "ok": true,
                    "requestId": request_id,
                    "models": models_map
                }));
            }
        }

        "llm-load-model" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let model_name = msg.payload.as_ref()
                .and_then(|p| p.get("modelName"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let gpu_layers = msg.payload.as_ref()
                .and_then(|p| p.get("gpuLayers"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;

            log::info!("[Sidecar] WS llm-load-model: {} (gpu_layers: {})", model_name, gpu_layers);

            match crate::sidecar::llm::models::load_model(&model_name, gpu_layers).await {
                Ok(_) => {
                    state.broadcast("llm-model-loaded", serde_json::json!({
                        "ok": true,
                        "requestId": request_id,
                        "modelName": model_name
                    }));
                }
                Err(e) => {
                    state.broadcast("llm-model-loaded", serde_json::json!({
                        "ok": false,
                        "requestId": request_id,
                        "error": e
                    }));
                }
            }
        }

        "llm-chat" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let prompt = msg.payload.as_ref()
                .and_then(|p| p.get("prompt"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            match crate::sidecar::llm::inference::chat(&prompt).await {
                Ok(response) => {
                    state.broadcast("llm-chat-response", serde_json::json!({
                        "ok": true,
                        "requestId": request_id,
                        "response": response
                    }));
                }
                Err(e) => {
                    state.broadcast("llm-chat-response", serde_json::json!({
                        "ok": false,
                        "requestId": request_id,
                        "error": e
                    }));
                }
            }
        }

        "llm-summarize" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let text = msg.payload.as_ref()
                .and_then(|p| p.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let max_length = msg.payload.as_ref()
                .and_then(|p| p.get("maxLength"))
                .and_then(|v| v.as_u64())
                .unwrap_or(3) as usize;

            match crate::sidecar::llm::tasks::summarize(&text, max_length).await {
                Ok(summary) => {
                    state.broadcast("llm-chat-response", serde_json::json!({
                        "ok": true,
                        "requestId": request_id,
                        "summary": summary
                    }));
                }
                Err(e) => {
                    state.broadcast("llm-chat-response", serde_json::json!({
                        "ok": false,
                        "requestId": request_id,
                        "error": e
                    }));
                }
            }
        }

        "llm-categorize" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = msg.payload.as_ref()
                .and_then(|p| p.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let url = msg.payload.as_ref()
                .and_then(|p| p.get("url"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let categories: Vec<String> = msg.payload.as_ref()
                .and_then(|p| p.get("categories"))
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();

            match crate::sidecar::llm::tasks::categorize(&title, &url, categories).await {
                Ok(category) => {
                    state.broadcast("llm-chat-response", serde_json::json!({
                        "ok": true,
                        "requestId": request_id,
                        "category": category
                    }));
                }
                Err(e) => {
                    state.broadcast("llm-chat-response", serde_json::json!({
                        "ok": false,
                        "requestId": request_id,
                        "error": e
                    }));
                }
            }
        }

        "llm-suggest-workspaces" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let urls = msg.payload.as_ref()
                .and_then(|p| p.get("urls"))
                .unwrap_or(&serde_json::Value::Null);

            let urls_json = serde_json::to_string(urls).unwrap_or_default();
            match crate::sidecar::llm::tasks::suggest_workspaces(&urls_json).await {
                Ok(res) => {
                    let suggestions: Vec<String> = serde_json::from_str(&res).unwrap_or_else(|_| vec![res]);
                    state.broadcast("llm-suggest-workspaces-response", serde_json::json!({
                        "ok": true,
                        "requestId": request_id,
                        "suggestions": suggestions
                    }));
                }
                Err(e) => {
                    state.broadcast("llm-suggest-workspaces-response", serde_json::json!({
                        "ok": false,
                        "requestId": request_id,
                        "error": e
                    }));
                }
            }
        }

        "llm-parse-command" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let command = msg.payload.as_ref()
                .and_then(|p| p.get("command"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let context = msg.payload.as_ref()
                .and_then(|p| p.get("context"))
                .unwrap_or(&serde_json::Value::Null);

            let context_str = context.to_string();
            match crate::sidecar::llm::tasks::parse_command(&command, &context_str).await {
                Ok(res) => {
                    let parsed: serde_json::Value = serde_json::from_str(&res).unwrap_or_else(|_| serde_json::json!({ "error": "parse_failed", "raw": res }));
                    state.broadcast("llm-parse-command-response", serde_json::json!({
                        "ok": true,
                        "requestId": request_id,
                        "parsed": parsed
                    }));
                }
                Err(e) => {
                    state.broadcast("llm-parse-command-response", serde_json::json!({
                        "ok": false,
                        "requestId": request_id,
                        "error": e
                    }));
                }
            }
        }

        "llm-group-workspaces" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let items = msg.payload.as_ref()
                .and_then(|p| p.get("items"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let context = msg.payload.as_ref()
                .and_then(|p| p.get("context"))
                .and_then(|v| v.as_str())
                .map(String::from);
            let custom_prompt = msg.payload.as_ref()
                .and_then(|p| p.get("customPrompt"))
                .and_then(|v| v.as_str())
                .map(String::from);

            match crate::sidecar::llm::tasks::group_workspaces(
                &items,
                context.as_deref().unwrap_or(""),
                custom_prompt.as_deref()
            ).await {
                Ok(result) => {
                    state.broadcast("llm-group-workspaces-response", serde_json::json!({
                        "ok": true,
                        "requestId": request_id,
                        "result": result
                    }));
                }
                Err(e) => {
                    state.broadcast("llm-group-workspaces-response", serde_json::json!({
                        "ok": false,
                        "requestId": request_id,
                        "error": e
                    }));
                }
            }
        }

        "llm-suggest-related" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let workspace_urls = msg.payload.as_ref()
                .and_then(|p| p.get("workspaceUrls"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let history = msg.payload.as_ref()
                .and_then(|p| p.get("history"))
                .and_then(|v| v.as_str())
                .map(String::from);

            match crate::sidecar::llm::tasks::suggest_related(
                &workspace_urls,
                history.as_deref().unwrap_or("")
            ).await {
                Ok(suggestions) => {
                    state.broadcast("llm-suggest-related-response", serde_json::json!({
                        "ok": true,
                        "requestId": request_id,
                        "suggestions": suggestions
                    }));
                }
                Err(e) => {
                    state.broadcast("llm-suggest-related-response", serde_json::json!({
                        "ok": false,
                        "requestId": request_id,
                        "error": e
                    }));
                }
            }
        }

        "llm-enhance-url" => {
            let request_id = msg.payload.as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = msg.payload.as_ref()
                .and_then(|p| p.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let url = msg.payload.as_ref()
                .and_then(|p| p.get("url"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let content_hint = msg.payload.as_ref()
                .and_then(|p| p.get("contentHint"))
                .and_then(|v| v.as_str())
                .map(String::from);

            match crate::sidecar::llm::tasks::enhance_url(
                &title,
                &url,
                content_hint.as_deref()
            ).await {
                Ok(result) => {
                    state.broadcast("llm-enhance-url-response", serde_json::json!({
                        "ok": true,
                        "requestId": request_id,
                        "result": result
                    }));
                }
                Err(e) => {
                    state.broadcast("llm-enhance-url-response", serde_json::json!({
                        "ok": false,
                        "requestId": request_id,
                        "error": e
                    }));
                }
            }
        }

        _ => {
            log::debug!("[Sidecar] Unknown message type: {}", msg.msg_type);
        }
    }
}
