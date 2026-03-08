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
}

#[derive(Debug, Clone)]
pub struct WorkspaceAssociation {
    pub workspace_name: String,
    pub count: u32,
    pub last_seen: i64,
    pub acceptance_rate: f64,
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
        }
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

    /// Record that a URL was added to a workspace
    pub fn record_url_workspace(&mut self, url: &str, title: &str, workspace_name: &str) {
        let now = chrono::Utc::now().timestamp_millis();

        // Track domain association
        if let Some(domain) = Self::extract_domain(url) {
            let associations = self.domain_workspaces.entry(domain).or_default();
            if let Some(assoc) = associations
                .iter_mut()
                .find(|a| a.workspace_name == workspace_name)
            {
                assoc.count += 1;
                assoc.last_seen = now;
            } else {
                associations.push(WorkspaceAssociation {
                    workspace_name: workspace_name.to_string(),
                    count: 1,
                    last_seen: now,
                    acceptance_rate: 1.0,
                });
            }
        }

        // Track keyword associations
        for keyword in Self::extract_keywords(title, url) {
            let associations = self.keyword_workspaces.entry(keyword).or_default();
            if let Some(assoc) = associations
                .iter_mut()
                .find(|a| a.workspace_name == workspace_name)
            {
                assoc.count += 1;
                assoc.last_seen = now;
            } else {
                associations.push(WorkspaceAssociation {
                    workspace_name: workspace_name.to_string(),
                    count: 1,
                    last_seen: now,
                    acceptance_rate: 1.0,
                });
            }
        }
    }

    /// Update acceptance rate for a workspace suggestion
    pub fn record_suggestion_result(
        &mut self,
        url: &str,
        title: &str,
        workspace_name: &str,
        accepted: bool,
    ) {
        // Update domain association
        if let Some(domain) = Self::extract_domain(url) {
            if let Some(associations) = self.domain_workspaces.get_mut(&domain) {
                if let Some(assoc) = associations
                    .iter_mut()
                    .find(|a| a.workspace_name == workspace_name)
                {
                    // Exponential moving average
                    let value = if accepted { 1.0 } else { 0.0 };
                    assoc.acceptance_rate = assoc.acceptance_rate * 0.9 + value * 0.1;
                }
            }
        }

        // Update keyword associations
        for keyword in Self::extract_keywords(title, url) {
            if let Some(associations) = self.keyword_workspaces.get_mut(&keyword) {
                if let Some(assoc) = associations
                    .iter_mut()
                    .find(|a| a.workspace_name == workspace_name)
                {
                    let value = if accepted { 1.0 } else { 0.0 };
                    assoc.acceptance_rate = assoc.acceptance_rate * 0.9 + value * 0.1;
                }
            }
        }
    }

    /// Suggest workspace for a URL based on learned patterns
    pub fn suggest_workspace(&self, url: &str, title: &str) -> Option<(String, f64)> {
        let mut scores: HashMap<String, f64> = HashMap::new();

        // Domain-based scoring
        if let Some(domain) = Self::extract_domain(url) {
            if let Some(associations) = self.domain_workspaces.get(&domain) {
                for assoc in associations {
                    let score = (assoc.count as f64).ln() * assoc.acceptance_rate;
                    *scores.entry(assoc.workspace_name.clone()).or_default() += score * 2.0; // Domain weight
                }
            }
        }

        // Keyword-based scoring
        for keyword in Self::extract_keywords(title, url) {
            if let Some(associations) = self.keyword_workspaces.get(&keyword) {
                for assoc in associations {
                    let score = (assoc.count as f64).ln() * assoc.acceptance_rate;
                    *scores.entry(assoc.workspace_name.clone()).or_default() += score;
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
                    let score = (assoc.count as f64).ln().max(0.1) * assoc.acceptance_rate;
                    *scores.entry(assoc.workspace_name.clone()).or_default() += score * 2.0;
                }
            }
        }

        // Keyword-based scoring
        for keyword in Self::extract_keywords(title, url) {
            if let Some(associations) = self.keyword_workspaces.get(&keyword) {
                for assoc in associations {
                    let score = (assoc.count as f64).ln().max(0.1) * assoc.acceptance_rate;
                    *scores.entry(assoc.workspace_name.clone()).or_default() += score;
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
        PatternExport {
            domain_workspaces: self
                .domain_workspaces
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        v.iter()
                            .map(|a| ExportedAssociation {
                                workspace_name: a.workspace_name.clone(),
                                count: a.count,
                                acceptance_rate: a.acceptance_rate,
                            })
                            .collect(),
                    )
                })
                .collect(),
            category_patterns: self.category_patterns.clone(),
        }
    }

    /// Import patterns from persistence
    pub fn import(&mut self, data: PatternExport) {
        let now = chrono::Utc::now().timestamp_millis();

        for (domain, assocs) in data.domain_workspaces {
            let entry = self.domain_workspaces.entry(domain).or_default();
            for a in assocs {
                entry.push(WorkspaceAssociation {
                    workspace_name: a.workspace_name,
                    count: a.count,
                    last_seen: now,
                    acceptance_rate: a.acceptance_rate,
                });
            }
        }

        self.category_patterns = data.category_patterns;
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
    pub category_patterns: HashMap<String, CategoryPattern>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExportedAssociation {
    pub workspace_name: String,
    pub count: u32,
    pub acceptance_rate: f64,
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
