// Merge logic for sync data
// Mirrors the Node.js merge helpers

use crate::sidecar::data::*;
use std::collections::HashMap;

/// Normalize URL for comparison
fn normalize_url(url: &str) -> String {
    let url_str = if url.starts_with("http") {
        url.to_string()
    } else {
        format!("https://{}", url)
    };

    match url::Url::parse(&url_str) {
        Ok(parsed) => {
            let host = parsed.host_str().unwrap_or("");
            let host_normalized = host.trim_start_matches("www.").to_lowercase();
            let path = parsed.path().trim_end_matches('/');
            let query = parsed.query().map(|q| format!("?{}", q)).unwrap_or_default();
            format!("{}://{}{}{}", parsed.scheme(), host_normalized, path, query)
        }
        Err(_) => url.to_lowercase(),
    }
}

/// Get timestamp from an item for merge comparison
fn get_timestamp(item: &serde_json::Value) -> i64 {
    item.get("updatedAt")
        .or_else(|| item.get("scrapedAt"))
        .or_else(|| item.get("createdAt"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
}

/// Merge arrays by ID (last-write-wins based on timestamps)
pub fn merge_array_by_id<T>(local: Vec<T>, remote: Vec<T>, id_field: &str) -> Vec<T>
where
    T: Clone + serde::Serialize + serde::de::DeserializeOwned,
{
    let mut merged: HashMap<String, serde_json::Value> = HashMap::new();

    // Helper to get ID from item
    let get_id = |item: &serde_json::Value| -> Option<String> {
        match id_field {
            "chatId" => item.get("chatId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            "domain" => item.get("domain").and_then(|v| v.as_str()).map(|s| s.to_string()),
            _ => item.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
        }
    };

    // Add local items
    for item in &local {
        if let Ok(json) = serde_json::to_value(item) {
            if let Some(id) = get_id(&json) {
                merged.insert(id, json);
            }
        }
    }

    // Merge remote items (last-write-wins)
    for item in &remote {
        if let Ok(json) = serde_json::to_value(item) {
            if let Some(id) = get_id(&json) {
                let remote_time = get_timestamp(&json);

                if let Some(existing) = merged.get(&id) {
                    let local_time = get_timestamp(existing);
                    if remote_time >= local_time {
                        merged.insert(id, json);
                    }
                } else {
                    merged.insert(id, json);
                }
            }
        }
    }

    // Convert back to Vec<T>
    merged
        .into_values()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect()
}

/// Deduplicate URLs within a workspace
fn dedupe_urls(urls: Vec<WorkspaceUrl>) -> Vec<WorkspaceUrl> {
    let mut seen: HashMap<String, WorkspaceUrl> = HashMap::new();

    for url_obj in urls {
        let normalized = normalize_url(&url_obj.url);

        if let Some(existing) = seen.get(&normalized) {
            let existing_time = existing.added_at.or(existing.created_at).unwrap_or(0);
            let new_time = url_obj.added_at.or(url_obj.created_at).unwrap_or(0);

            // Keep the one with title, or the newer one
            if (existing.title.is_none() && url_obj.title.is_some()) || new_time > existing_time {
                seen.insert(normalized, url_obj);
            }
        } else {
            seen.insert(normalized, url_obj);
        }
    }

    seen.into_values().collect()
}

/// Merge workspaces by name (special merge logic)
pub fn merge_workspaces_by_name(local: Vec<Workspace>, remote: Vec<Workspace>) -> Vec<Workspace> {
    let mut merged: HashMap<String, Workspace> = HashMap::new();

    // Add local workspaces
    for ws in local {
        let key = ws.name.to_lowercase().trim().to_string();
        let mut ws_deduped = ws;
        ws_deduped.urls = dedupe_urls(ws_deduped.urls);
        merged.insert(key, ws_deduped);
    }

    // Merge remote workspaces
    for ws in remote {
        let key = ws.name.to_lowercase().trim().to_string();

        if let Some(existing) = merged.get(&key) {
            let remote_time = ws.updated_at.or(ws.created_at).unwrap_or(0);
            let local_time = existing.updated_at.or(existing.created_at).unwrap_or(0);

            // Combine URLs from both
            let mut combined_urls = existing.urls.clone();
            combined_urls.extend(ws.urls.clone());
            let deduped_urls = dedupe_urls(combined_urls);

            // Use the newer metadata but preserve local ID
            let merged_ws = if remote_time > local_time {
                Workspace {
                    id: existing.id.clone(),
                    name: ws.name,
                    urls: deduped_urls,
                    created_at: ws.created_at,
                    updated_at: Some(std::cmp::max(remote_time, local_time)),
                }
            } else {
                Workspace {
                    id: existing.id.clone(),
                    name: existing.name.clone(),
                    urls: deduped_urls,
                    created_at: existing.created_at,
                    updated_at: Some(std::cmp::max(remote_time, local_time)),
                }
            };

            merged.insert(key, merged_ws);
        } else {
            let mut ws_deduped = ws;
            ws_deduped.urls = dedupe_urls(ws_deduped.urls);
            merged.insert(key, ws_deduped);
        }
    }

    merged.into_values().collect()
}

/// Recompute aggregated tabs from device tabs map
pub fn recompute_aggregated_tabs(device_tabs_map: &HashMap<String, Vec<Tab>>) -> Vec<Tab> {
    let mut all_tabs = Vec::new();

    for (device_id, tabs) in device_tabs_map {
        for tab in tabs {
            let mut tab_with_device = tab.clone();
            tab_with_device.device_id = Some(device_id.clone());
            all_tabs.push(tab_with_device);
        }
    }

    log::info!(
        "[Sidecar] Recomputed tabs: {} total from {} devices",
        all_tabs.len(),
        device_tabs_map.len()
    );

    all_tabs
}

/// Merge URLs
pub fn merge_urls(local: Vec<UrlEntry>, remote: Vec<UrlEntry>) -> Vec<UrlEntry> {
    merge_array_by_id(local, remote, "id")
}

/// Merge notes
pub fn merge_notes(local: Vec<Note>, remote: Vec<Note>) -> Vec<Note> {
    merge_array_by_id(local, remote, "id")
}

/// Merge URL notes
pub fn merge_url_notes(local: Vec<UrlNote>, remote: Vec<UrlNote>) -> Vec<UrlNote> {
    merge_array_by_id(local, remote, "id")
}

/// Merge pins
pub fn merge_pins(local: Vec<Pin>, remote: Vec<Pin>) -> Vec<Pin> {
    merge_array_by_id(local, remote, "id")
}

/// Merge scraped chats
pub fn merge_scraped_chats(local: Vec<ScrapedChat>, remote: Vec<ScrapedChat>) -> Vec<ScrapedChat> {
    merge_array_by_id(local, remote, "chatId")
}

/// Merge scraped configs
pub fn merge_scraped_configs(local: Vec<ScrapedConfig>, remote: Vec<ScrapedConfig>) -> Vec<ScrapedConfig> {
    merge_array_by_id(local, remote, "domain")
}

/// Merge daily memory
pub fn merge_daily_memory(local: Vec<DailyMemory>, remote: Vec<DailyMemory>) -> Vec<DailyMemory> {
    merge_array_by_id(local, remote, "id")
}

/// Merge settings (simple object merge)
pub fn merge_settings(
    local: HashMap<String, serde_json::Value>,
    remote: HashMap<String, serde_json::Value>,
) -> HashMap<String, serde_json::Value> {
    let mut merged = local;
    merged.extend(remote);
    merged
}

/// Append activity (limited to last 1000)
pub fn append_activity(mut existing: Vec<Activity>, new_activities: Vec<Activity>) -> Vec<Activity> {
    existing.extend(new_activities);
    // Keep only last 1000
    if existing.len() > 1000 {
        existing = existing.split_off(existing.len() - 1000);
    }
    existing
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_url() {
        assert_eq!(
            normalize_url("https://www.example.com/path/"),
            "https://example.com/path"
        );
        assert_eq!(
            normalize_url("http://Example.Com/"),
            "http://example.com"
        );
        assert_eq!(
            normalize_url("example.com"),
            "https://example.com"
        );
    }

    #[test]
    fn test_merge_workspaces() {
        let local = vec![Workspace {
            id: "1".to_string(),
            name: "Work".to_string(),
            urls: vec![WorkspaceUrl {
                url: "https://github.com".to_string(),
                title: Some("GitHub".to_string()),
                added_at: Some(1000),
                created_at: None,
            }],
            created_at: Some(1000),
            updated_at: Some(1000),
        }];

        let remote = vec![Workspace {
            id: "2".to_string(),
            name: "work".to_string(), // Same name, different case
            urls: vec![WorkspaceUrl {
                url: "https://gitlab.com".to_string(),
                title: Some("GitLab".to_string()),
                added_at: Some(2000),
                created_at: None,
            }],
            created_at: Some(2000),
            updated_at: Some(2000),
        }];

        let merged = merge_workspaces_by_name(local, remote);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].urls.len(), 2); // Both URLs combined
        assert_eq!(merged[0].id, "1"); // Preserves local ID
    }
}
