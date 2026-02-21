// HTTP + WebSocket server for sidecar

use crate::sidecar::data::*;
use crate::sidecar::handlers::*;
use crate::sidecar::sync::*;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{header, Method},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};

const PORT: u16 = 4000;
const WS_MAX_PAYLOAD: usize = 100 * 1024 * 1024; // 100MB

/// Start the sidecar server
pub async fn start_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Create broadcast channel for WebSocket messages
    let (ws_tx, _) = broadcast::channel::<String>(100);

    // Create shared state
    let state = Arc::new(AppState::new(ws_tx.clone()));

    // CORS configuration
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE]);

    // Build router
    let app = Router::new()
        // Health check
        .route("/health", get(health))
        // GET endpoints
        .route("/workspaces", get(get_workspaces).post(post_workspaces))
        .route("/urls", get(get_urls).post(post_urls))
        .route("/tabs", get(get_tabs).post(post_tabs))
        .route("/settings", get(get_settings).post(post_settings))
        .route("/activity", get(get_activity).post(post_activity))
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
        .layer(cors)
        .with_state(state);

    let addr = format!("127.0.0.1:{}", PORT);
    log::info!("[Sidecar] Server running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// WebSocket upgrade handler
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.max_message_size(WS_MAX_PAYLOAD)
        .on_upgrade(move |socket| handle_ws_connection(socket, state))
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

    // Send initial sync state
    {
        let data = state.sync_data.read().await;
        log::info!("[Sidecar] Sending initial sync-state to {}: {} notes, {} workspaces, {} tabs, {} urls, {} pins, {} urlNotes",
            client_id, data.notes.len(), data.workspaces.len(), data.tabs.len(),
            data.urls.len(), data.pins.len(), data.url_notes.len());

        let sync_state = SyncStatePayload::from(&*data);
        log::info!("[Sidecar] SyncStatePayload notes count: {}", sync_state.notes.len());

        let msg = WsMessage::new("sync-state", serde_json::to_value(&sync_state).unwrap_or_default());
        if let Ok(json) = serde_json::to_string(&msg) {
            log::debug!("[Sidecar] sync-state JSON length: {} bytes", json.len());
            let _ = sender.send(Message::Text(json.into())).await;
        }
    }

    // Spawn task to forward broadcasts to this client
    let client_id_clone = client_id.clone();
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
                    state.save_and_broadcast("workspaces", payload).await;
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
                    state.save_and_broadcast("urls", payload).await;
                }
            }
        }

        "push-tabs" => {
            if let Some(payload) = msg.payload {
                let (tabs, device_id) = if payload.is_array() {
                    let tabs: Vec<Tab> = serde_json::from_value(payload).unwrap_or_default();
                    (tabs, format!("ws-{}", client_id))
                } else if let Ok(push_payload) = serde_json::from_value::<PushTabsPayload>(payload) {
                    (push_payload.tabs, push_payload.device_id.unwrap_or_else(|| format!("ws-{}", client_id)))
                } else {
                    return;
                };

                let mut data = state.sync_data.write().await;
                data.device_tabs_map.insert(device_id, tabs);
                data.tabs = recompute_aggregated_tabs(&data.device_tabs_map);
                data.last_updated.insert("tabs".to_string(), chrono::Utc::now().timestamp_millis());

                let payload = serde_json::to_value(&data.tabs).unwrap_or_default();
                drop(data);
                state.save_and_broadcast("tabs", payload).await;
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
                    state.save_and_broadcast("settings", payload).await;
                }
            }
        }

        "push-notes" => {
            log::info!("[Sidecar] WS push-notes received from {}", client_id);
            if let Some(payload) = msg.payload {
                log::info!("[Sidecar] WS push-notes payload type: {}",
                    if payload.is_array() { "array" } else if payload.is_object() { "object" } else { "other" });
                log::debug!("[Sidecar] WS push-notes raw payload: {}",
                    serde_json::to_string(&payload).unwrap_or_else(|_| "failed to serialize".to_string()));

                match serde_json::from_value::<Vec<Note>>(payload.clone()) {
                    Ok(notes) => {
                        log::info!("[Sidecar] WS push-notes parsed {} notes", notes.len());
                        for (i, note) in notes.iter().take(3).enumerate() {
                            log::info!("[Sidecar] WS push-notes note[{}]: id={}, title={:?}",
                                i, note.id, note.title);
                        }

                        let mut data = state.sync_data.write().await;
                        let before_count = data.notes.len();
                        data.notes = merge_notes(data.notes.clone(), notes);
                        let after_count = data.notes.len();
                        log::info!("[Sidecar] WS push-notes merged: {} -> {} notes", before_count, after_count);

                        data.last_updated.insert("notes".to_string(), chrono::Utc::now().timestamp_millis());

                        let payload = serde_json::to_value(&data.notes).unwrap_or_default();
                        drop(data);
                        state.save_and_broadcast("notes", payload).await;
                        log::info!("[Sidecar] WS push-notes broadcast complete");
                    }
                    Err(e) => {
                        log::error!("[Sidecar] WS push-notes failed to parse: {}", e);
                        log::error!("[Sidecar] WS push-notes payload was: {}",
                            serde_json::to_string(&payload).unwrap_or_else(|_| "failed".to_string()));
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
                    state.save_and_broadcast("url-notes", payload).await;
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
                    state.save_and_broadcast("pins", payload).await;
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
                    state.save_and_broadcast("scraped-chats", payload).await;
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
                    state.save_and_broadcast("scraped-configs", payload).await;
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
                    state.save_and_broadcast("daily-memory", payload).await;
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
                    state.save_and_broadcast("ui-state", payload).await;
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
                    state.save_and_broadcast("dashboard", payload).await;
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
                state.save_and_broadcast("activity", payload).await;
            }
        }

        "request-native-focus" => {
            if let Some(payload) = msg.payload {
                let browser = payload.get("browser").and_then(|v| v.as_str()).unwrap_or("unknown");
                log::info!("[Sidecar] Native focus requested for: {}", browser);
                state.broadcast("native-focus", payload);
            }
        }

        _ => {
            log::debug!("[Sidecar] Unknown message type: {}", msg.msg_type);
        }
    }
}
