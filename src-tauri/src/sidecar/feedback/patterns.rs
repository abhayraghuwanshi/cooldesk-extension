//! Pattern tracking for workspace/URL associations
//!
//! Learns patterns from user behavior to improve grouping suggestions.
//! NOTE: Many methods are not yet connected to UI but preserved for RAG system expansion.

#![allow(dead_code)]

use std::collections::HashMap;

/// Tracks URL and workspace patterns for learning
pub struct PatternTracker {
    /// Domain -> workspace name associations
    domain_workspaces: HashMap<String, Vec<WorkspaceAssociation>>,
    /// Keyword -> workspace associations
    keyword_workspaces: HashMap<String, Vec<WorkspaceAssociation>>,
    /// Category patterns learned from user groupings
    category_patterns: HashMap<String, CategoryPattern>,
    /// Agent placements the user applied that are still on probation — see
    /// `check_placements` and `placement_used`.
    pending: Vec<PendingPlacement>,
}

/// How long an applied agent placement is watched for a delayed verdict.
pub const PROBATION_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// An agent placement the user applied. Hitting Apply is a weak "yes" — it
/// may have been a skim — so for a week afterwards the placement is watched:
/// removing it is a rejection, opening it through CoolDesk a real acceptance.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PendingPlacement {
    pub url: String,
    #[serde(default)]
    pub title: String,
    pub workspace: String,
    pub placed_at: i64,
}

/// What became of a pending placement, as of a workspace snapshot.
#[derive(Debug, Clone, PartialEq)]
pub enum PlacementVerdict {
    /// Gone from its workspace (or the workspace is gone).
    Removed { url: String, workspace: String },
    /// Gone from its workspace, and now in these others instead.
    Moved { url: String, from: String, to: Vec<String> },
}

/// Compare urls ignoring scheme-less trivia: trailing slash and `www.`.
fn same_page(a: &str, b: &str) -> bool {
    let n = |u: &str| {
        let u = u.trim().trim_end_matches('/');
        let u = u.split_once("://").map_or(u, |(_, rest)| rest);
        u.strip_prefix("www.").unwrap_or(u).to_lowercase()
    };
    n(a) == n(b)
}

#[derive(Debug, Clone)]
pub struct WorkspaceAssociation {
    pub workspace_name: String,
    /// Times a url like this was actually filed here.
    pub count: u32,
    pub last_seen: i64,
    /// Posterior mean of "the user keeps this placement" — see `rate`.
    pub acceptance_rate: f64,
    /// Placements here the user kept: their own adds, and agent proposals applied.
    pub accepted: u32,
    /// Agent placements here the user unticked or discarded.
    pub rejected: u32,
}

impl WorkspaceAssociation {
    fn new(workspace_name: &str, now: i64) -> Self {
        Self { workspace_name: workspace_name.to_string(), count: 0, last_seen: now, acceptance_rate: 0.5, accepted: 0, rejected: 0 }
    }

    /// Beta(1,1) posterior mean: one rejection after one acceptance is a coin
    /// flip, not the barely-moved 0.9 the old 0.1-step moving average gave —
    /// an explicit "no" from the user should count for something.
    fn update_rate(&mut self) {
        self.acceptance_rate = (self.accepted as f64 + 1.0) / ((self.accepted + self.rejected) as f64 + 2.0);
    }

    /// Ranking weight. `count` can be 0 for a placement that was only ever
    /// rejected, so it's floored before the log.
    fn score(&self) -> f64 {
        (self.count.max(1) as f64).ln().max(0.1) * self.acceptance_rate
    }
}

/// Find this workspace's association in a list, adding an empty one if missing.
fn assoc_for<'a>(list: &'a mut Vec<WorkspaceAssociation>, workspace_name: &str, now: i64) -> &'a mut WorkspaceAssociation {
    match list.iter().position(|a| a.workspace_name == workspace_name) {
        Some(i) => &mut list[i],
        None => {
            list.push(WorkspaceAssociation::new(workspace_name, now));
            list.last_mut().unwrap()
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CategoryPattern {
    pub category: String,
    pub domains: Vec<String>,
    pub keywords: Vec<String>,
    pub total_matches: u32,
    pub confidence: f64,
}

impl PatternTracker {
    pub fn new() -> Self {
        Self {
            domain_workspaces: HashMap::new(),
            keyword_workspaces: HashMap::new(),
            category_patterns: HashMap::new(),
            pending: Vec::new(),
        }
    }

    /// Start watching placements the user just applied from an agent proposal.
    pub fn add_pending(&mut self, placements: impl IntoIterator<Item = (String, String, String)>, now: i64) {
        for (workspace, url, title) in placements {
            self.pending.retain(|p| !(p.workspace == workspace && same_page(&p.url, &url)));
            self.pending.push(PendingPlacement { url, title, workspace, placed_at: now });
        }
    }

    pub fn pending(&self) -> &[PendingPlacement] {
        &self.pending
    }

    /// Settle pending placements against what the workspaces hold now.
    ///
    /// `workspaces` is (name, urls) as of `taken_at`. Only placements made
    /// before the snapshot are judged — one applied while the snapshot was
    /// being read would look removed. A placement past probation that's still
    /// in place is dropped with no further reward; Apply already counted it.
    /// An empty snapshot is treated as a failed read, not "everything deleted".
    pub fn check_placements(&mut self, workspaces: &[(String, Vec<String>)], taken_at: i64, now: i64) -> Vec<PlacementVerdict> {
        if workspaces.is_empty() {
            return Vec::new();
        }
        let mut verdicts = Vec::new();
        let mut keep = Vec::new();
        for p in std::mem::take(&mut self.pending) {
            if p.placed_at >= taken_at {
                keep.push(p);
                continue;
            }
            let home = workspaces.iter().find(|(name, _)| *name == p.workspace);
            let still_there = home.is_some_and(|(_, urls)| urls.iter().any(|u| same_page(u, &p.url)));
            if still_there {
                if now - p.placed_at < PROBATION_MS {
                    keep.push(p);
                }
                continue;
            }
            let to: Vec<String> = workspaces.iter()
                .filter(|(name, urls)| *name != p.workspace && urls.iter().any(|u| same_page(u, &p.url)))
                .map(|(name, _)| name.clone())
                .collect();
            let verdict = if to.is_empty() {
                PlacementVerdict::Removed { url: p.url.clone(), workspace: p.workspace.clone() }
            } else {
                PlacementVerdict::Moved { url: p.url.clone(), from: p.workspace.clone(), to }
            };
            self.apply_verdict(&verdict, &p.title);
            verdicts.push(verdict);
        }
        self.pending = keep;
        verdicts
    }

    fn apply_verdict(&mut self, verdict: &PlacementVerdict, title: &str) {
        match verdict {
            PlacementVerdict::Removed { url, workspace } => self.record_suggestion_result(url, title, workspace, false),
            PlacementVerdict::Moved { url, from, to } => {
                self.record_suggestion_result(url, title, from, false);
                for ws in to {
                    self.record_url_workspace(url, title, ws);
                }
            }
        }
    }

    /// The user opened `url` through CoolDesk: every pending placement of it
    /// is confirmed (one more acceptance) and leaves probation. Returns the
    /// workspaces confirmed.
    pub fn placement_used(&mut self, url: &str) -> Vec<String> {
        let (used, keep): (Vec<_>, Vec<_>) = std::mem::take(&mut self.pending)
            .into_iter()
            .partition(|p| same_page(&p.url, url));
        self.pending = keep;
        for p in &used {
            self.record_suggestion_result(&p.url, &p.title, &p.workspace, true);
        }
        used.into_iter().map(|p| p.workspace).collect()
    }

    /// Extract domain from URL
    fn extract_domain(url: &str) -> Option<String> {
        url::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
            .map(|h| h.strip_prefix("www.").unwrap_or(&h).to_string())
    }

    /// Extract keywords from title/URL
    fn extract_keywords(title: &str, url: &str) -> Vec<String> {
        let mut keywords = Vec::new();

        // Split title into words
        for word in title.split_whitespace() {
            let clean = word
                .trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase();
            if clean.len() >= 3 && !is_stop_word(&clean) {
                keywords.push(clean);
            }
        }

        // Extract path segments from URL
        if let Ok(parsed) = url::Url::parse(url) {
            for segment in parsed.path().split('/') {
                let clean = segment
                    .trim_matches(|c: char| !c.is_alphanumeric())
                    .to_lowercase();
                if clean.len() >= 3 && !is_stop_word(&clean) {
                    keywords.push(clean);
                }
            }
        }

        keywords
    }

    /// Record that a URL was added to a workspace (by the user, or an agent
    /// proposal they applied): one more filing, and one more acceptance.
    pub fn record_url_workspace(&mut self, url: &str, title: &str, workspace_name: &str) {
        let now = chrono::Utc::now().timestamp_millis();
        for list in self.lists_for(url, title) {
            let assoc = assoc_for(list, workspace_name, now);
            assoc.count += 1;
            assoc.accepted += 1;
            assoc.last_seen = now;
            assoc.update_rate();
        }
    }

    /// The user's verdict on a placement they didn't make themselves (an
    /// agent proposal). A rejection is remembered even for a pairing never
    /// seen before, so the same bad guess loses weight next time.
    pub fn record_suggestion_result(
        &mut self,
        url: &str,
        title: &str,
        workspace_name: &str,
        accepted: bool,
    ) {
        let now = chrono::Utc::now().timestamp_millis();
        for list in self.lists_for(url, title) {
            let assoc = assoc_for(list, workspace_name, now);
            if accepted { assoc.accepted += 1 } else { assoc.rejected += 1 }
            assoc.last_seen = now;
            assoc.update_rate();
        }
    }

    /// The domain list and each keyword list this url/title touches.
    fn lists_for(&mut self, url: &str, title: &str) -> Vec<&mut Vec<WorkspaceAssociation>> {
        let domain = Self::extract_domain(url);
        let mut keywords = Self::extract_keywords(title, url);
        keywords.sort();
        keywords.dedup();
        let mut out = Vec::new();
        if let Some(domain) = domain {
            out.push(self.domain_workspaces.entry(domain).or_default());
        }
        for k in &keywords {
            self.keyword_workspaces.entry(k.clone()).or_default();
        }
        out.extend(self.keyword_workspaces.iter_mut().filter(|(k, _)| keywords.binary_search(k).is_ok()).map(|(_, v)| v));
        out
    }

    /// How often the user turned down placing this url's site in each
    /// workspace, most-rejected first.
    pub fn rejections(&self, url: &str) -> Vec<(String, u32)> {
        self.verdicts(url).into_iter().filter(|v| v.2 > 0).map(|(ws, _, rejected)| (ws, rejected)).collect()
    }

    /// (workspace, kept, turned down) for this url's site, most-rejected first.
    pub fn verdicts(&self, url: &str) -> Vec<(String, u32, u32)> {
        let Some(domain) = Self::extract_domain(url) else { return Vec::new() };
        let mut out: Vec<(String, u32, u32)> = self.domain_workspaces.get(&domain).into_iter().flatten()
            .map(|a| (a.workspace_name.clone(), a.accepted, a.rejected))
            .collect();
        out.sort_by(|a, b| b.2.cmp(&a.2).then(b.1.cmp(&a.1)));
        out
    }

    /// Suggest workspace for a URL based on learned patterns
    pub fn suggest_workspace(&self, url: &str, title: &str) -> Option<(String, f64)> {
        let mut scores: HashMap<String, f64> = HashMap::new();

        // Domain-based scoring
        if let Some(domain) = Self::extract_domain(url) {
            if let Some(associations) = self.domain_workspaces.get(&domain) {
                for assoc in associations {
                    *scores.entry(assoc.workspace_name.clone()).or_default() += assoc.score() * 2.0; // Domain weight
                }
            }
        }

        // Keyword-based scoring
        for keyword in Self::extract_keywords(title, url) {
            if let Some(associations) = self.keyword_workspaces.get(&keyword) {
                for assoc in associations {
                    *scores.entry(assoc.workspace_name.clone()).or_default() += assoc.score();
                }
            }
        }

        // Find best match
        scores
            .into_iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .filter(|(_, score)| *score > 0.5) // Minimum confidence threshold
    }

    /// Get top N workspace suggestions for a URL
    pub fn suggest_workspaces(&self, url: &str, title: &str, n: usize) -> Vec<(String, f64)> {
        let mut scores: HashMap<String, f64> = HashMap::new();

        // Domain-based scoring
        if let Some(domain) = Self::extract_domain(url) {
            if let Some(associations) = self.domain_workspaces.get(&domain) {
                for assoc in associations {
                    *scores.entry(assoc.workspace_name.clone()).or_default() += assoc.score() * 2.0;
                }
            }
        }

        // Keyword-based scoring
        for keyword in Self::extract_keywords(title, url) {
            if let Some(associations) = self.keyword_workspaces.get(&keyword) {
                for assoc in associations {
                    *scores.entry(assoc.workspace_name.clone()).or_default() += assoc.score();
                }
            }
        }

        let mut suggestions: Vec<(String, f64)> = scores.into_iter().collect();
        suggestions.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        suggestions.truncate(n);
        suggestions
    }

    /// Get domains associated with a workspace
    pub fn workspace_domains(&self, workspace_name: &str) -> Vec<(String, u32)> {
        self.domain_workspaces
            .iter()
            .filter_map(|(domain, assocs)| {
                assocs
                    .iter()
                    .find(|a| a.workspace_name == workspace_name)
                    .map(|a| (domain.clone(), a.count))
            })
            .collect()
    }

    /// Learn a category pattern from user groupings
    pub fn learn_category(&mut self, category: &str, urls: &[(String, String)]) {
        // urls is Vec<(url, title)>
        let mut domains = Vec::new();
        let mut keywords = Vec::new();

        for (url, title) in urls {
            if let Some(domain) = Self::extract_domain(url) {
                if !domains.contains(&domain) {
                    domains.push(domain);
                }
            }
            for kw in Self::extract_keywords(title, url) {
                if !keywords.contains(&kw) {
                    keywords.push(kw);
                }
            }
        }

        let pattern = self
            .category_patterns
            .entry(category.to_string())
            .or_insert_with(|| CategoryPattern {
                category: category.to_string(),
                domains: Vec::new(),
                keywords: Vec::new(),
                total_matches: 0,
                confidence: 0.5,
            });

        // Merge domains and keywords
        for d in domains {
            if !pattern.domains.contains(&d) {
                pattern.domains.push(d);
            }
        }
        for k in keywords {
            if !pattern.keywords.contains(&k) {
                pattern.keywords.push(k);
            }
        }
        pattern.total_matches += 1;
    }

    /// Suggest category for a URL
    pub fn suggest_category(&self, url: &str, title: &str) -> Option<(String, f64)> {
        let domain = Self::extract_domain(url);
        let keywords = Self::extract_keywords(title, url);

        let mut best_match: Option<(String, f64)> = None;

        for (_, pattern) in &self.category_patterns {
            let mut score = 0.0;

            // Domain match
            if let Some(ref d) = domain {
                if pattern.domains.contains(d) {
                    score += 2.0;
                }
            }

            // Keyword matches
            for kw in &keywords {
                if pattern.keywords.contains(kw) {
                    score += 1.0;
                }
            }

            // Normalize by pattern size
            let max_possible = 2.0 + pattern.keywords.len() as f64;
            let normalized = score / max_possible.max(1.0);

            if let Some((_, best_score)) = &best_match {
                if normalized > *best_score {
                    best_match = Some((pattern.category.clone(), normalized));
                }
            } else if normalized > 0.2 {
                best_match = Some((pattern.category.clone(), normalized));
            }
        }

        best_match
    }

    /// Export patterns for persistence
    pub fn export(&self) -> PatternExport {
        let dump = |map: &HashMap<String, Vec<WorkspaceAssociation>>| {
            map.iter()
                .map(|(k, v)| {
                    (k.clone(), v.iter().map(|a| ExportedAssociation {
                        workspace_name: a.workspace_name.clone(),
                        count: a.count,
                        acceptance_rate: a.acceptance_rate,
                        accepted: a.accepted,
                        rejected: a.rejected,
                        last_seen: a.last_seen,
                    }).collect())
                })
                .collect()
        };
        PatternExport {
            domain_workspaces: dump(&self.domain_workspaces),
            keyword_workspaces: dump(&self.keyword_workspaces),
            category_patterns: self.category_patterns.clone(),
            pending: self.pending.clone(),
        }
    }

    /// Import patterns from persistence
    pub fn import(&mut self, data: PatternExport) {
        let now = chrono::Utc::now().timestamp_millis();
        let load = |map: &mut HashMap<String, Vec<WorkspaceAssociation>>, from: HashMap<String, Vec<ExportedAssociation>>| {
            for (key, assocs) in from {
                let entry = map.entry(key).or_default();
                for a in assocs {
                    // Older exports had only count + rate: every filing was an acceptance.
                    let accepted = if a.accepted + a.rejected == 0 { a.count } else { a.accepted };
                    entry.push(WorkspaceAssociation {
                        workspace_name: a.workspace_name,
                        count: a.count,
                        last_seen: if a.last_seen > 0 { a.last_seen } else { now },
                        acceptance_rate: a.acceptance_rate,
                        accepted,
                        rejected: a.rejected,
                    });
                }
            }
        };
        load(&mut self.domain_workspaces, data.domain_workspaces);
        load(&mut self.keyword_workspaces, data.keyword_workspaces);
        self.category_patterns = data.category_patterns;
        self.pending = data.pending;
    }

    /// Load from `path`, or start empty if it's missing or unreadable.
    pub fn load(path: &std::path::Path) -> Self {
        let mut tracker = Self::new();
        match std::fs::read_to_string(path) {
            Ok(text) => match serde_json::from_str::<PatternExport>(&text) {
                Ok(data) => {
                    tracker.import(data);
                    log::info!("[Patterns] Loaded {} domain patterns", tracker.domain_workspaces.len());
                }
                Err(e) => log::warn!("[Patterns] Ignoring unreadable {}: {}", path.display(), e),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log::warn!("[Patterns] Could not read {}: {}", path.display(), e),
        }
        tracker
    }

    /// Write to `path` via a temp file, so a crash mid-write never leaves a
    /// truncated file that `load` would throw away along with everything learned.
    pub fn save(&self, path: &std::path::Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(&self.export())?)?;
        std::fs::rename(&tmp, path)
    }
}

impl Default for PatternTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PatternExport {
    pub domain_workspaces: HashMap<String, Vec<ExportedAssociation>>,
    #[serde(default)]
    pub keyword_workspaces: HashMap<String, Vec<ExportedAssociation>>,
    #[serde(default)]
    pub category_patterns: HashMap<String, CategoryPattern>,
    #[serde(default)]
    pub pending: Vec<PendingPlacement>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExportedAssociation {
    pub workspace_name: String,
    pub count: u32,
    pub acceptance_rate: f64,
    #[serde(default)]
    pub accepted: u32,
    #[serde(default)]
    pub rejected: u32,
    #[serde(default)]
    pub last_seen: i64,
}

/// Common stop words to filter out
fn is_stop_word(word: &str) -> bool {
    matches!(
        word,
        "the" | "and" | "for" | "with" | "this" | "that" | "from" | "have" | "are"
            | "was" | "were" | "been" | "being" | "has" | "had" | "does" | "did"
            | "will" | "would" | "could" | "should" | "may" | "might" | "must"
            | "shall" | "can" | "need" | "dare" | "ought" | "used" | "http"
            | "https" | "www" | "com" | "org" | "net" | "html" | "htm" | "php"
            | "asp" | "aspx" | "jsp"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_domain() {
        assert_eq!(
            PatternTracker::extract_domain("https://www.github.com/foo"),
            Some("github.com".to_string())
        );
        assert_eq!(
            PatternTracker::extract_domain("https://docs.rust-lang.org/book"),
            Some("docs.rust-lang.org".to_string())
        );
    }

    #[test]
    fn test_extract_keywords() {
        let keywords =
            PatternTracker::extract_keywords("Rust Programming Guide", "https://example.com/rust");
        assert!(keywords.contains(&"rust".to_string()));
        assert!(keywords.contains(&"programming".to_string()));
        assert!(keywords.contains(&"guide".to_string()));
    }

    #[test]
    fn test_suggest_workspace() {
        let mut tracker = PatternTracker::new();

        // Train with some data
        tracker.record_url_workspace(
            "https://github.com/repo1",
            "My Repo",
            "Development",
        );
        tracker.record_url_workspace(
            "https://github.com/repo2",
            "Another Repo",
            "Development",
        );
        tracker.record_url_workspace(
            "https://github.com/repo3",
            "Third Repo",
            "Development",
        );

        // Test suggestion
        let suggestion = tracker.suggest_workspace(
            "https://github.com/newrepo",
            "New Project",
        );

        assert!(suggestion.is_some());
        let (workspace, _) = suggestion.unwrap();
        assert_eq!(workspace, "Development");
    }
}

#[cfg(test)]
mod learning_tests {
    use super::*;

    const URL: &str = "https://dashboard.stripe.com/payments";

    fn score_for(t: &PatternTracker, ws: &str) -> f64 {
        t.suggest_workspaces(URL, "Payments", 5).into_iter().find(|(w, _)| w == ws).map_or(0.0, |(_, s)| s)
    }

    #[test]
    fn a_rejection_outweighs_nothing_and_lowers_a_kept_placement() {
        let mut t = PatternTracker::new();
        t.record_url_workspace(URL, "Payments", "Billing");
        t.record_url_workspace(URL, "Payments", "Billing");
        let before = score_for(&t, "Billing");
        t.record_suggestion_result(URL, "Payments", "Billing", false);
        assert!(score_for(&t, "Billing") < before);

        // Rejected-only pairing: remembered, ranked below a kept one, no NaN.
        t.record_suggestion_result(URL, "Payments", "Social", false);
        let social = score_for(&t, "Social");
        assert!(social.is_finite() && social < score_for(&t, "Billing"));
        let mut rejected = t.rejections(URL);
        rejected.sort();
        assert_eq!(rejected, vec![("Billing".to_string(), 1), ("Social".to_string(), 1)]);
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = std::env::temp_dir().join(format!("cooldesk-patterns-{}", std::process::id()));
        let path = dir.join("workspace-patterns.json");
        let mut t = PatternTracker::new();
        t.record_url_workspace(URL, "Payments", "Billing");
        t.record_suggestion_result(URL, "Payments", "Social", false);
        t.save(&path).unwrap();

        let loaded = PatternTracker::load(&path);
        assert_eq!(loaded.suggest_workspaces(URL, "Payments", 1)[0].0, "Billing");
        assert_eq!(loaded.rejections(URL), vec![("Social".to_string(), 1)]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn old_exports_without_counts_still_load() {
        let old = r#"{"domain_workspaces":{"dashboard.stripe.com":[{"workspace_name":"Billing","count":3,"acceptance_rate":0.9}]},"category_patterns":{}}"#;
        let mut t = PatternTracker::new();
        t.import(serde_json::from_str(old).unwrap());
        assert_eq!(t.suggest_workspaces(URL, "", 1)[0].0, "Billing");
        // Treated as three acceptances, so one rejection doesn't wipe it out.
        t.record_suggestion_result(URL, "", "Billing", false);
        assert!(score_for(&t, "Billing") > 0.5);
    }
}

#[cfg(test)]
mod probation_tests {
    use super::*;

    const URL: &str = "https://dashboard.stripe.com/payments";
    const DAY: i64 = 24 * 60 * 60 * 1000;

    fn tracker_with_placement(at: i64) -> PatternTracker {
        let mut t = PatternTracker::new();
        t.record_url_workspace(URL, "Payments", "Billing");
        t.add_pending([("Billing".into(), URL.into(), "Payments".into())], at);
        t
    }

    fn ws(name: &str, urls: &[&str]) -> (String, Vec<String>) {
        (name.into(), urls.iter().map(|u| u.to_string()).collect())
    }

    #[test]
    fn still_in_place_stays_pending_then_expires_quietly() {
        let mut t = tracker_with_placement(0);
        let snap = [ws("Billing", &["https://www.dashboard.stripe.com/payments/"])];
        assert!(t.check_placements(&snap, DAY, DAY).is_empty());
        assert_eq!(t.pending().len(), 1);
        assert!(t.check_placements(&snap, 8 * DAY, 8 * DAY).is_empty());
        assert!(t.pending().is_empty());
        assert!(t.rejections(URL).is_empty());
    }

    #[test]
    fn removal_within_probation_is_a_rejection() {
        let mut t = tracker_with_placement(0);
        let v = t.check_placements(&[ws("Billing", &[]), ws("Other", &["https://x.com"])], DAY, DAY);
        assert_eq!(v, vec![PlacementVerdict::Removed { url: URL.into(), workspace: "Billing".into() }]);
        assert_eq!(t.verdicts(URL), vec![("Billing".to_string(), 1, 1)]);
        assert!(t.pending().is_empty());
    }

    #[test]
    fn moving_it_rejects_the_old_home_and_files_the_new_one() {
        let mut t = tracker_with_placement(0);
        let v = t.check_placements(&[ws("Billing", &[]), ws("Finance", &[URL])], DAY, DAY);
        assert_eq!(v, vec![PlacementVerdict::Moved { url: URL.into(), from: "Billing".into(), to: vec!["Finance".into()] }]);
        assert_eq!(t.suggest_workspaces(URL, "Payments", 1)[0].0, "Finance");
    }

    #[test]
    fn empty_or_older_snapshots_judge_nothing() {
        let mut t = tracker_with_placement(5 * DAY);
        assert!(t.check_placements(&[], 6 * DAY, 6 * DAY).is_empty());
        // Snapshot read before the placement was applied: it can't know about it yet.
        assert!(t.check_placements(&[ws("Billing", &[])], 4 * DAY, 6 * DAY).is_empty());
        assert_eq!(t.pending().len(), 1);
    }

    #[test]
    fn opening_it_confirms_and_ends_probation() {
        let mut t = tracker_with_placement(0);
        assert_eq!(t.placement_used("http://dashboard.stripe.com/payments/"), vec!["Billing".to_string()]);
        assert!(t.pending().is_empty());
        assert_eq!(t.verdicts(URL), vec![("Billing".to_string(), 2, 0)]);
        assert!(t.placement_used(URL).is_empty());
    }

    #[test]
    fn pending_survives_save_and_load() {
        let mut t = tracker_with_placement(42);
        let dir = std::env::temp_dir().join(format!("cd-probation-{}", std::process::id()));
        let path = dir.join("p.json");
        t.save(&path).unwrap();
        let loaded = PatternTracker::load(&path);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(loaded.pending(), t.pending());
        t.placement_used(URL);
    }
}
