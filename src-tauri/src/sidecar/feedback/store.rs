//! Persistent storage for feedback data

use super::types::*;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Feedback store with persistence and aggregation
pub struct FeedbackStore {
    state: Arc<RwLock<FeedbackState>>,
    data_dir: PathBuf,
}

#[allow(dead_code)]
impl FeedbackStore {
    /// Create new store with data directory
    pub fn new(data_dir: PathBuf) -> Self {
        let state = Self::load_state(&data_dir);
        Self {
            state: Arc::new(RwLock::new(state)),
            data_dir,
        }
    }

    /// Get the feedback state file path
    fn state_file(data_dir: &PathBuf) -> PathBuf {
        data_dir.join("feedback-state.json")
    }

    /// Load state from disk
    fn load_state(data_dir: &PathBuf) -> FeedbackState {
        let file_path = Self::state_file(data_dir);

        if !file_path.exists() {
            log::info!("[Feedback] No existing feedback state, starting fresh");
            return FeedbackState::new();
        }

        match fs::read_to_string(&file_path) {
            Ok(content) => match serde_json::from_str::<FeedbackState>(&content) {
                Ok(state) => {
                    log::info!(
                        "[Feedback] Loaded feedback state: {} events, {} co-occurrences",
                        state.events.len(),
                        state.url_co_occurrences.len()
                    );
                    state
                }
                Err(e) => {
                    log::warn!("[Feedback] Failed to parse feedback state: {}", e);
                    FeedbackState::new()
                }
            },
            Err(e) => {
                log::warn!("[Feedback] Failed to read feedback state: {}", e);
                FeedbackState::new()
            }
        }
    }

    /// Save state to disk
    pub async fn save(&self) -> std::io::Result<()> {
        // Ensure directory exists
        if !self.data_dir.exists() {
            fs::create_dir_all(&self.data_dir)?;
        }

        let mut state = self.state.write().await;
        state.saved_at = chrono::Utc::now().timestamp_millis();
        state.trim_events();

        let file_path = Self::state_file(&self.data_dir);
        let content = serde_json::to_string_pretty(&*state)?;
        fs::write(&file_path, content)?;

        log::debug!(
            "[Feedback] Saved feedback state: {} events",
            state.events.len()
        );
        Ok(())
    }

    /// Record a new feedback event
    pub async fn record_event(&self, event: FeedbackEvent) {
        let mut state = self.state.write().await;

        // Update stats by type
        let type_key = serde_json::to_string(&event.suggestion_type)
            .unwrap_or_else(|_| "unknown".to_string())
            .trim_matches('"')
            .to_string();

        let stats = state
            .stats_by_type
            .entry(type_key)
            .or_insert_with(SuggestionStats::default);

        stats.record(&event.action, event.response_time_ms);

        // Update total
        state.total_events += 1;

        // Store event
        state.events.push(event);

        log::debug!("[Feedback] Recorded event, total: {}", state.total_events);
    }

    /// Record URL co-occurrence (seen together)
    pub async fn record_co_occurrence(&self, url1: &str, url2: &str, is_workspace: bool) {
        let mut state = self.state.write().await;

        let normalized1 = normalize_url(url1);
        let normalized2 = normalize_url(url2);

        if normalized1 == normalized2 {
            return; // Skip self-pairs
        }

        // Find or create co-occurrence record
        let co_occ = Self::find_or_create_co_occurrence(
            &mut state.url_co_occurrences,
            normalized1,
            normalized2,
        );

        if is_workspace {
            co_occ.workspace_count += 1;
        } else {
            co_occ.session_count += 1;
        }
        co_occ.last_seen = chrono::Utc::now().timestamp_millis();
    }

    /// Record explicit feedback on URL grouping
    pub async fn record_grouping_feedback(
        &self,
        url1: &str,
        url2: &str,
        positive: bool,
    ) {
        let mut state = self.state.write().await;

        let normalized1 = normalize_url(url1);
        let normalized2 = normalize_url(url2);

        if normalized1 == normalized2 {
            return;
        }

        let co_occ = Self::find_or_create_co_occurrence(
            &mut state.url_co_occurrences,
            normalized1,
            normalized2,
        );

        if positive {
            co_occ.positive_feedback += 1;
        } else {
            co_occ.negative_feedback += 1;
        }
        co_occ.last_seen = chrono::Utc::now().timestamp_millis();
    }

    fn find_or_create_co_occurrence(
        co_occurrences: &mut Vec<UrlCoOccurrence>,
        url1: String,
        url2: String,
    ) -> &mut UrlCoOccurrence {
        // Ensure consistent ordering
        let (u1, u2) = if url1 <= url2 {
            (url1, url2)
        } else {
            (url2, url1)
        };

        let key = format!("{}|{}", u1, u2);

        // Find existing
        let pos = co_occurrences.iter().position(|c| c.key() == key);

        if let Some(idx) = pos {
            &mut co_occurrences[idx]
        } else {
            co_occurrences.push(UrlCoOccurrence::new(u1, u2));
            co_occurrences.last_mut().unwrap()
        }
    }

    /// Get stats for a suggestion type
    pub async fn get_stats(&self, suggestion_type: &SuggestionType) -> SuggestionStats {
        let state = self.state.read().await;
        let type_key = serde_json::to_string(suggestion_type)
            .unwrap_or_else(|_| "unknown".to_string())
            .trim_matches('"')
            .to_string();

        state
            .stats_by_type
            .get(&type_key)
            .cloned()
            .unwrap_or_default()
    }

    /// Get all stats
    pub async fn get_all_stats(&self) -> HashMap<String, SuggestionStats> {
        let state = self.state.read().await;
        state.stats_by_type.clone()
    }

    /// Get URL affinity score (how strongly two URLs should be grouped)
    pub async fn get_url_affinity(&self, url1: &str, url2: &str) -> f64 {
        let state = self.state.read().await;

        let normalized1 = normalize_url(url1);
        let normalized2 = normalize_url(url2);

        let (u1, u2) = if normalized1 <= normalized2 {
            (normalized1, normalized2)
        } else {
            (normalized2, normalized1)
        };

        let key = format!("{}|{}", u1, u2);

        state
            .url_co_occurrences
            .iter()
            .find(|c| c.key() == key)
            .map(|c| c.affinity_score())
            .unwrap_or(0.0)
    }

    /// Get URLs with high affinity to a given URL
    pub async fn get_related_urls(&self, url: &str, min_affinity: f64) -> Vec<(String, f64)> {
        let state = self.state.read().await;
        let normalized = normalize_url(url);

        let mut related: Vec<(String, f64)> = state
            .url_co_occurrences
            .iter()
            .filter_map(|c| {
                let score = c.affinity_score();
                if score < min_affinity {
                    return None;
                }

                if c.url1 == normalized {
                    Some((c.url2.clone(), score))
                } else if c.url2 == normalized {
                    Some((c.url1.clone(), score))
                } else {
                    None
                }
            })
            .collect();

        // Sort by affinity (highest first)
        related.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        related
    }

    /// Get recent events (for debugging/inspection)
    pub async fn get_recent_events(&self, limit: usize) -> Vec<FeedbackEvent> {
        let state = self.state.read().await;
        state
            .events
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    /// Get event count
    pub async fn event_count(&self) -> u64 {
        let state = self.state.read().await;
        state.total_events
    }

    /// Export state for analysis
    pub async fn export_state(&self) -> FeedbackState {
        let state = self.state.read().await;
        state.clone()
    }

    /// Record an app launch (for search ranking feedback)
    pub async fn record_app_launch(&self, app_name: &str, action: &UserAction, response_time_ms: Option<i64>) {
        let mut state = self.state.write().await;
        let key = normalize_app_name(app_name);

        let stats = state.app_stats.entry(key).or_insert_with(SuggestionStats::default);
        stats.record(action, response_time_ms);

        log::debug!("[Feedback] Recorded app launch: {} -> {:?}", app_name, action);
    }

    /// Get stats for a specific app
    pub async fn get_app_stats(&self, app_name: &str) -> SuggestionStats {
        let state = self.state.read().await;
        let key = normalize_app_name(app_name);
        state.app_stats.get(&key).cloned().unwrap_or_default()
    }

    /// Get all app stats (for batch ranking)
    pub async fn get_all_app_stats(&self) -> std::collections::HashMap<String, SuggestionStats> {
        let state = self.state.read().await;
        state.app_stats.clone()
    }

    /// Record a URL click (for search ranking feedback). When `query` is given,
    /// also learns the (query → URL) association so the same keyword ranks this
    /// link higher next time.
    pub async fn record_url_click(&self, url: &str, action: &UserAction, response_time_ms: Option<i64>, query: Option<&str>) {
        let mut state = self.state.write().await;
        let key = normalize_url(url);

        let stats = state.url_stats.entry(key.clone()).or_insert_with(SuggestionStats::default);
        stats.record(action, response_time_ms);

        // Only accepted clicks teach the query association — a dismissal for a
        // query shouldn't strengthen it.
        if let (Some(q), UserAction::Accepted) = (query, action) {
            let q = q.trim().to_lowercase();
            if !q.is_empty() && q.len() <= 100 {
                let assoc_key = format!("{}|{}", q, key);
                if let Some(entry) = state.query_url_clicks.iter_mut().find(|c| c.key() == assoc_key) {
                    entry.count = entry.count.saturating_add(1);
                    entry.last_seen = chrono::Utc::now().timestamp_millis();
                } else {
                    state.query_url_clicks.push(QueryUrlClick::new(q, key.clone()));
                }
                // Keep the table bounded: drop the weakest (oldest/rarest) entries.
                if state.query_url_clicks.len() > 2000 {
                    state.query_url_clicks.sort_by(|a, b| {
                        b.score().partial_cmp(&a.score()).unwrap_or(std::cmp::Ordering::Equal)
                    });
                    state.query_url_clicks.truncate(1500);
                }
            }
        }

        log::debug!("[Feedback] Recorded URL click: {} -> {:?}", key, action);
    }

    /// Get stats for a specific URL
    pub async fn get_url_stats(&self, url: &str) -> SuggestionStats {
        let state = self.state.read().await;
        let key = normalize_url(url);
        state.url_stats.get(&key).cloned().unwrap_or_default()
    }

    /// Get all URL stats (for batch ranking)
    pub async fn get_all_url_stats(&self) -> std::collections::HashMap<String, SuggestionStats> {
        let state = self.state.read().await;
        state.url_stats.clone()
    }

    /// Ranking boosts for URL search results, keyed by normalized URL.
    ///
    /// Two signals, mirroring the app-side `calculate_rl_boost`:
    /// - global: URLs the user picks often from search, whatever they typed (0–10)
    /// - query:  URLs picked for THIS query before — exact or prefix match, so
    ///   "prod" already benefits from clicks recorded under "product" (0–15)
    ///
    /// Total is capped at 25 so learned preference re-orders comparable matches
    /// but can never beat a strong direct keyword match.
    pub async fn get_url_boosts(&self, query: &str) -> std::collections::HashMap<String, f64> {
        let state = self.state.read().await;
        let q = query.trim().to_lowercase();

        let mut boosts: std::collections::HashMap<String, f64> = std::collections::HashMap::new();

        // Global per-URL signal
        for (url, stats) in &state.url_stats {
            if stats.total_shown == 0 {
                continue;
            }
            let acceptance = stats.acceptance_rate() * 7.0;
            let usage = (stats.total_shown as f64 + 1.0).ln().min(3.0);
            boosts.insert(url.clone(), acceptance + usage);
        }

        // Query-specific signal (prefix match either way)
        if !q.is_empty() {
            for c in &state.query_url_clicks {
                let related = c.query == q || c.query.starts_with(&q) || q.starts_with(&c.query);
                if !related {
                    continue;
                }
                // score() is recency-decayed ln(count+1): 1 click ≈ 0.7, 10 ≈ 2.4
                let query_boost = (c.score() * 6.0).min(15.0);
                *boosts.entry(c.url.clone()).or_insert(0.0) += query_boost;
            }
        }

        for v in boosts.values_mut() {
            *v = v.min(25.0);
        }
        boosts
    }

    /// Record an app-workspace association (when app is added to or used with a workspace)
    pub async fn record_app_workspace(&self, app_name: &str, app_path: &str, workspace_name: &str) {
        let mut state = self.state.write().await;

        let normalized_path = app_path.to_lowercase();
        let normalized_workspace = workspace_name.to_lowercase();
        let key = format!("{}|{}", normalized_path, normalized_workspace);

        // Find existing or create new association
        if let Some(assoc) = state.app_workspace_associations.iter_mut().find(|a| a.key() == key) {
            assoc.count += 1;
            assoc.last_seen = chrono::Utc::now().timestamp_millis();
        } else {
            state.app_workspace_associations.push(AppWorkspaceAssociation::new(
                normalize_app_name(app_name),
                normalized_path,
                normalized_workspace,
            ));
        }

        log::debug!("[Feedback] Recorded app-workspace: {} -> {}", app_name, workspace_name);
    }

    /// Suggest apps for a given workspace based on learned associations
    pub async fn suggest_apps_for_workspace(&self, workspace_name: &str, limit: usize) -> Vec<(String, String, f64)> {
        let state = self.state.read().await;
        let normalized_workspace = workspace_name.to_lowercase();

        let mut suggestions: Vec<(String, String, f64)> = state
            .app_workspace_associations
            .iter()
            .filter(|a| a.workspace_name == normalized_workspace)
            .map(|a| (a.app_name.clone(), a.app_path.clone(), a.score()))
            .collect();

        // Sort by score descending
        suggestions.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
        suggestions.truncate(limit);
        suggestions
    }

    /// Suggest workspaces for a given app based on learned associations
    pub async fn suggest_workspaces_for_app(&self, app_path: &str, limit: usize) -> Vec<(String, f64)> {
        let state = self.state.read().await;
        let normalized_path = app_path.to_lowercase();

        let mut suggestions: Vec<(String, f64)> = state
            .app_workspace_associations
            .iter()
            .filter(|a| a.app_path == normalized_path)
            .map(|a| (a.workspace_name.clone(), a.score()))
            .collect();

        // Sort by score descending
        suggestions.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        suggestions.truncate(limit);
        suggestions
    }

    /// Get all app-workspace associations (for debugging/analysis)
    pub async fn get_all_app_workspace_associations(&self) -> Vec<AppWorkspaceAssociation> {
        let state = self.state.read().await;
        state.app_workspace_associations.clone()
    }

    /// Get all URL co-occurrences (for graph building)
    pub async fn get_all_co_occurrences(&self) -> Vec<UrlCoOccurrence> {
        let state = self.state.read().await;
        state.url_co_occurrences.clone()
    }

    /// Record a session snapshot — everything active at the same moment.
    /// Records all pairwise co-occurrences. Capped at 20 items to avoid N² blowup.
    pub async fn record_snapshot(&self, items: Vec<String>) {
        if items.len() < 2 { return; }
        let items: Vec<_> = items.into_iter().take(20).collect();
        let mut state = self.state.write().await;
        let now = chrono::Utc::now().timestamp_millis();

        for i in 0..items.len() {
            for j in (i + 1)..items.len() {
                let key = ItemCoOccurrence::make_key(&items[i], &items[j]);
                if let Some(co) = state.item_co_occurrences.iter_mut().find(|c| c.key() == key) {
                    co.session_count = co.session_count.saturating_add(1);
                    co.last_seen = now;
                } else {
                    state.item_co_occurrences.push(
                        ItemCoOccurrence::new(items[i].clone(), items[j].clone())
                    );
                }
            }
        }
    }

    /// Get all cross-type item co-occurrences (for graph building)
    pub async fn get_all_item_co_occurrences(&self) -> Vec<ItemCoOccurrence> {
        let state = self.state.read().await;
        state.item_co_occurrences.clone()
    }
}

/// Normalize app name for consistent lookup
fn normalize_app_name(name: &str) -> String {
    name.to_lowercase()
        .trim()
        .replace(".exe", "")
        .replace(" ", "_")
}

/// Normalize URL for comparison (extract domain + path, remove tracking params)
fn normalize_url(url: &str) -> String {
    // Parse URL
    if let Ok(parsed) = url::Url::parse(url) {
        let host = parsed.host_str().unwrap_or("");
        let path = parsed.path();

        // Remove www prefix
        let host = host.strip_prefix("www.").unwrap_or(host);

        // Remove trailing slash from path
        let path = path.trim_end_matches('/');

        // Skip common tracking parameters
        format!("{}{}", host.to_lowercase(), path.to_lowercase())
    } else {
        // Fallback: just lowercase
        url.to_lowercase()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_record_event() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        let event = FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Accepted,
            "Test Workspace".to_string(),
        );

        store.record_event(event).await;

        let stats = store.get_stats(&SuggestionType::WorkspaceGroup).await;
        assert_eq!(stats.total_shown, 1);
        assert_eq!(stats.accepted, 1);
    }

    #[tokio::test]
    async fn test_url_affinity() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        // Record some co-occurrences
        store
            .record_co_occurrence("https://github.com/foo", "https://github.com/bar", true)
            .await;
        store
            .record_co_occurrence("https://github.com/foo", "https://github.com/bar", true)
            .await;

        let affinity = store
            .get_url_affinity("https://github.com/foo", "https://github.com/bar")
            .await;

        assert!(affinity > 0.0);
    }

    #[tokio::test]
    async fn url_click_with_query_learns_keyword_association() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        // Two accepted clicks on the same result for the query "product"
        store.record_url_click("https://shop.com/product/42", &UserAction::Accepted, None, Some("product")).await;
        store.record_url_click("https://shop.com/product/42", &UserAction::Accepted, None, Some("Product")).await;
        // A click without a query only feeds global stats
        store.record_url_click("https://other.com/page", &UserAction::Accepted, None, None).await;

        let boosts = store.get_url_boosts("product").await;
        let clicked = boosts.get("shop.com/product/42").copied().unwrap_or(0.0);
        let other = boosts.get("other.com/page").copied().unwrap_or(0.0);
        assert!(clicked > other, "query-matched URL must outrank query-less one ({clicked} vs {other})");

        // Prefix of the learned query gets the boost too ("prod" while typing)
        let prefix = store.get_url_boosts("prod").await;
        assert!(
            prefix.get("shop.com/product/42").copied().unwrap_or(0.0) > other,
            "prefix query should reuse the learned association"
        );

        // Unrelated query gets only the global component
        let unrelated = store.get_url_boosts("banana").await;
        let unrelated_boost = unrelated.get("shop.com/product/42").copied().unwrap_or(0.0);
        assert!(unrelated_boost < clicked, "query boost must not leak to unrelated queries");
    }

    #[tokio::test]
    async fn rejected_click_does_not_learn_query_association() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        store.record_url_click("https://spam.com/x", &UserAction::Rejected, None, Some("product")).await;

        let state = store.export_state().await;
        assert!(state.query_url_clicks.is_empty(), "rejections must not create query associations");
    }

    #[tokio::test]
    async fn url_boosts_are_capped() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        for _ in 0..50 {
            store.record_url_click("https://a.com/hot", &UserAction::Accepted, None, Some("hot")).await;
        }

        let boosts = store.get_url_boosts("hot").await;
        let b = boosts.get("a.com/hot").copied().unwrap_or(0.0);
        assert!(b > 0.0 && b <= 25.0, "boost must be positive and capped at 25, got {b}");
    }

    #[test]
    fn test_normalize_url() {
        assert_eq!(
            normalize_url("https://www.github.com/foo/bar"),
            "github.com/foo/bar"
        );
        assert_eq!(
            normalize_url("https://GitHub.com/FOO/"),
            "github.com/foo"
        );
    }
}
