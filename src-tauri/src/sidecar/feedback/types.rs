//! Feedback data types for implicit reinforcement learning

use serde::{Deserialize, Serialize};

/// Types of suggestions the system can make
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionType {
    /// Workspace grouping suggestion
    WorkspaceGroup,
    /// URL added to workspace
    UrlToWorkspace,
    /// Related resource suggestion
    RelatedResource,
    /// Tool result from agent
    ToolResult,
    /// Tab categorization
    TabCategory,
    /// Workspace name suggestion
    WorkspaceName,
    /// App launched from search
    AppLaunch,
    /// URL/link clicked from search or saved links
    UrlClick,
}

/// User actions on suggestions (implicit feedback signals)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UserAction {
    /// User clicked/accepted the suggestion
    Accepted,
    /// User explicitly rejected/dismissed
    Rejected,
    /// User modified the suggestion before accepting
    Modified,
    /// Suggestion was shown but user ignored it (timeout)
    Ignored,
    /// User hovered/previewed but didn't act
    Previewed,
    /// User undid a previous acceptance
    Undone,
}

impl UserAction {
    /// Base reward value for this action type
    /// Positive = good signal, Negative = bad signal
    pub fn base_reward(&self) -> f64 {
        match self {
            UserAction::Accepted => 1.0,
            UserAction::Rejected => -1.0,
            UserAction::Modified => 0.5,   // Partial acceptance
            UserAction::Ignored => -0.2,   // Weak negative signal
            UserAction::Previewed => 0.1,  // Weak positive signal
            UserAction::Undone => -0.8,    // Strong negative (regret)
        }
    }
}

/// A single feedback event recording user interaction
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackEvent {
    /// Unique event ID
    pub id: String,
    /// Type of suggestion that was shown
    pub suggestion_type: SuggestionType,
    /// What the user did
    pub action: UserAction,
    /// When this happened (unix timestamp ms)
    pub timestamp: i64,
    /// The suggestion content (workspace name, URL, etc.)
    pub suggestion_content: String,
    /// Context: what workspace/URL was active when suggestion was made
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_workspace: Option<String>,
    /// Context: URLs that were visible/active
    #[serde(default)]
    pub context_urls: Vec<String>,
    /// Time between suggestion shown and action (ms)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_time_ms: Option<i64>,
    /// If modified, what the user changed it to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_content: Option<String>,
    /// Session ID if from agent conversation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Tool name if this was a tool result
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
}

impl FeedbackEvent {
    pub fn new(
        suggestion_type: SuggestionType,
        action: UserAction,
        suggestion_content: String,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            suggestion_type,
            action,
            timestamp: chrono::Utc::now().timestamp_millis(),
            suggestion_content,
            context_workspace: None,
            context_urls: Vec::new(),
            response_time_ms: None,
            modified_content: None,
            session_id: None,
            tool_name: None,
        }
    }

    pub fn with_context(mut self, workspace: Option<String>, urls: Vec<String>) -> Self {
        self.context_workspace = workspace;
        self.context_urls = urls;
        self
    }

    pub fn with_response_time(mut self, ms: i64) -> Self {
        self.response_time_ms = Some(ms);
        self
    }

    pub fn with_modification(mut self, modified: String) -> Self {
        self.modified_content = Some(modified);
        self
    }

    pub fn with_session(mut self, session_id: String) -> Self {
        self.session_id = Some(session_id);
        self
    }

    pub fn with_tool(mut self, tool_name: String) -> Self {
        self.tool_name = Some(tool_name);
        self
    }
}

/// Aggregated statistics for a specific suggestion pattern
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionStats {
    /// Total times this pattern was suggested
    pub total_shown: u32,
    /// Times accepted
    pub accepted: u32,
    /// Times rejected
    pub rejected: u32,
    /// Times modified
    pub modified: u32,
    /// Times ignored
    pub ignored: u32,
    /// Cumulative reward score
    pub cumulative_reward: f64,
    /// Average response time (ms)
    pub avg_response_time_ms: f64,
    /// Last updated timestamp
    pub last_updated: i64,
}

impl SuggestionStats {
    /// Acceptance rate (accepted / total)
    pub fn acceptance_rate(&self) -> f64 {
        if self.total_shown == 0 {
            return 0.5; // Prior: neutral
        }
        self.accepted as f64 / self.total_shown as f64
    }

    /// Rejection rate
    pub fn rejection_rate(&self) -> f64 {
        if self.total_shown == 0 {
            return 0.0;
        }
        self.rejected as f64 / self.total_shown as f64
    }

    /// Engagement rate (accepted + modified) / total
    pub fn engagement_rate(&self) -> f64 {
        if self.total_shown == 0 {
            return 0.5;
        }
        (self.accepted + self.modified) as f64 / self.total_shown as f64
    }

    /// Average reward per suggestion
    pub fn avg_reward(&self) -> f64 {
        if self.total_shown == 0 {
            return 0.0;
        }
        self.cumulative_reward / self.total_shown as f64
    }

    /// Update stats with a new feedback event
    pub fn record(&mut self, action: &UserAction, response_time_ms: Option<i64>) {
        self.total_shown += 1;
        self.cumulative_reward += action.base_reward();
        self.last_updated = chrono::Utc::now().timestamp_millis();

        match action {
            UserAction::Accepted => self.accepted += 1,
            UserAction::Rejected => self.rejected += 1,
            UserAction::Modified => self.modified += 1,
            UserAction::Ignored => self.ignored += 1,
            UserAction::Previewed => {} // Don't count as shown
            UserAction::Undone => self.rejected += 1, // Treat undo as rejection
        }

        // Update running average of response time
        if let Some(rt) = response_time_ms {
            let n = self.total_shown as f64;
            self.avg_response_time_ms =
                self.avg_response_time_ms * ((n - 1.0) / n) + (rt as f64 / n);
        }
    }
}

/// URL pair co-occurrence tracking for learning associations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlCoOccurrence {
    /// Normalized URL 1
    pub url1: String,
    /// Normalized URL 2
    pub url2: String,
    /// Times seen together in same workspace
    pub workspace_count: u32,
    /// Times opened in same session (within time window)
    pub session_count: u32,
    /// Explicit positive feedback (grouped together)
    pub positive_feedback: u32,
    /// Explicit negative feedback (ungrouped/separated)
    pub negative_feedback: u32,
    /// Last seen timestamp
    pub last_seen: i64,
}

impl UrlCoOccurrence {
    pub fn new(url1: String, url2: String) -> Self {
        // Ensure consistent ordering for deduplication
        let (u1, u2) = if url1 <= url2 {
            (url1, url2)
        } else {
            (url2, url1)
        };

        Self {
            url1: u1,
            url2: u2,
            workspace_count: 0,
            session_count: 0,
            positive_feedback: 0,
            negative_feedback: 0,
            last_seen: chrono::Utc::now().timestamp_millis(),
        }
    }

    /// Affinity score: how strongly these URLs should be grouped
    /// Range: -1.0 (should separate) to 1.0 (should group)
    pub fn affinity_score(&self) -> f64 {
        let total_signals = self.workspace_count + self.session_count
            + self.positive_feedback + self.negative_feedback;

        if total_signals == 0 {
            return 0.0; // No data
        }

        // Weight different signals
        let positive = (self.workspace_count as f64 * 0.3)
            + (self.session_count as f64 * 0.2)
            + (self.positive_feedback as f64 * 1.0);

        let negative = self.negative_feedback as f64 * 1.0;

        // Normalize to [-1, 1]
        let raw_score = (positive - negative) / (positive + negative + 1.0);
        raw_score.clamp(-1.0, 1.0)
    }

    /// Key for HashMap storage
    pub fn key(&self) -> String {
        format!("{}|{}", self.url1, self.url2)
    }
}

/// Workspace pattern tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePattern {
    /// Pattern identifier (e.g., domain, keyword, category)
    pub pattern: String,
    /// Workspaces this pattern has been associated with
    pub workspace_names: Vec<String>,
    /// URLs matching this pattern
    pub matching_urls: Vec<String>,
    /// Times this pattern was used for grouping
    pub usage_count: u32,
    /// Acceptance rate for suggestions using this pattern
    pub acceptance_rate: f64,
    /// Last updated
    pub last_updated: i64,
}

/// Persistent feedback state
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackState {
    /// All recorded feedback events (rolling window)
    pub events: Vec<FeedbackEvent>,
    /// Stats by suggestion type
    pub stats_by_type: std::collections::HashMap<String, SuggestionStats>,
    /// Stats per app (keyed by normalized app name)
    #[serde(default)]
    pub app_stats: std::collections::HashMap<String, SuggestionStats>,
    /// Stats per URL (keyed by normalized URL)
    #[serde(default)]
    pub url_stats: std::collections::HashMap<String, SuggestionStats>,
    /// URL co-occurrence data
    pub url_co_occurrences: Vec<UrlCoOccurrence>,
    /// Workspace patterns
    pub workspace_patterns: Vec<WorkspacePattern>,
    /// Global stats
    pub total_events: u64,
    /// Last save timestamp
    pub saved_at: i64,
}

impl FeedbackState {
    /// Maximum events to keep in memory
    pub const MAX_EVENTS: usize = 5000;

    pub fn new() -> Self {
        Self::default()
    }

    /// Trim old events if over limit
    pub fn trim_events(&mut self) {
        if self.events.len() > Self::MAX_EVENTS {
            // Keep most recent events
            let drain_count = self.events.len() - Self::MAX_EVENTS;
            self.events.drain(0..drain_count);
        }
    }
}
