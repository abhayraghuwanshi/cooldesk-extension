//! Reward calculation for reinforcement learning
//!
//! Implements Thompson Sampling-inspired reward signals for ranking suggestions.

use super::types::*;
use std::collections::HashMap;

/// Reward calculator for RL-based suggestion ranking
pub struct RewardCalculator {
    /// Learning rate for reward updates
    learning_rate: f64,
    /// Discount factor for temporal difference
    gamma: f64,
    /// Exploration bonus (UCB-style)
    exploration_weight: f64,
}

impl Default for RewardCalculator {
    fn default() -> Self {
        Self {
            learning_rate: 0.1,
            gamma: 0.95,
            exploration_weight: 1.0,
        }
    }
}

impl RewardCalculator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_learning_rate(mut self, lr: f64) -> Self {
        self.learning_rate = lr;
        self
    }

    pub fn with_gamma(mut self, gamma: f64) -> Self {
        self.gamma = gamma;
        self
    }

    pub fn with_exploration(mut self, weight: f64) -> Self {
        self.exploration_weight = weight;
        self
    }

    /// Calculate immediate reward from a feedback event
    pub fn immediate_reward(&self, event: &FeedbackEvent) -> f64 {
        let base = event.action.base_reward();

        // Adjust based on response time (faster = more confident)
        let time_factor = if let Some(rt) = event.response_time_ms {
            if rt < 1000 {
                1.2 // Quick decision = confident
            } else if rt < 5000 {
                1.0 // Normal
            } else if rt < 15000 {
                0.9 // Hesitant
            } else {
                0.7 // Very hesitant / likely distracted
            }
        } else {
            1.0
        };

        // Modification penalty/bonus
        let mod_factor = if event.modified_content.is_some() {
            0.8 // Partial credit for modification
        } else {
            1.0
        };

        base * time_factor * mod_factor
    }

    /// Calculate UCB (Upper Confidence Bound) score for exploration-exploitation
    /// Higher score = should show this suggestion more
    pub fn ucb_score(&self, stats: &SuggestionStats, total_suggestions: u32) -> f64 {
        if stats.total_shown == 0 {
            return f64::INFINITY; // Explore unknown suggestions first
        }

        let avg_reward = stats.avg_reward();
        let exploration_term = self.exploration_weight
            * ((total_suggestions as f64).ln() / stats.total_shown as f64).sqrt();

        avg_reward + exploration_term
    }

    /// Thompson Sampling: sample from posterior Beta distribution
    /// Returns a score to rank suggestions
    pub fn thompson_sample(&self, stats: &SuggestionStats) -> f64 {
        // Beta(alpha, beta) where alpha = successes + 1, beta = failures + 1
        let alpha = (stats.accepted + stats.modified) as f64 + 1.0;
        let beta = (stats.rejected + stats.ignored) as f64 + 1.0;

        // Sample from Beta distribution using the simple approximation
        // For production, use a proper Beta distribution sampler
        beta_sample(alpha, beta)
    }

    /// Contextual reward: adjust based on context similarity
    pub fn contextual_reward(
        &self,
        event: &FeedbackEvent,
        current_context_urls: &[String],
    ) -> f64 {
        let base_reward = self.immediate_reward(event);

        // Boost reward if context matches
        let context_overlap = event
            .context_urls
            .iter()
            .filter(|u| current_context_urls.contains(u))
            .count();

        let context_factor = if event.context_urls.is_empty() {
            1.0
        } else {
            1.0 + (context_overlap as f64 / event.context_urls.len() as f64) * 0.5
        };

        base_reward * context_factor
    }

    /// Calculate expected value for a workspace grouping suggestion
    pub fn workspace_grouping_value(
        &self,
        url_affinities: &[(String, String, f64)], // (url1, url2, affinity)
        stats: &SuggestionStats,
    ) -> f64 {
        // Base value from historical stats
        let base_value = stats.avg_reward();

        // Bonus from URL affinities
        let affinity_sum: f64 = url_affinities.iter().map(|(_, _, a)| a).sum();
        let affinity_count = url_affinities.len().max(1) as f64;
        let avg_affinity = affinity_sum / affinity_count;

        // Combine: historical performance + learned URL relationships
        base_value * 0.4 + avg_affinity * 0.6
    }

    /// Rank multiple suggestions by expected value
    pub fn rank_suggestions<T>(
        &self,
        suggestions: Vec<(T, SuggestionStats)>,
        use_thompson: bool,
    ) -> Vec<T> {
        let total: u32 = suggestions.iter().map(|(_, s)| s.total_shown).sum();

        let mut scored: Vec<(T, f64)> = suggestions
            .into_iter()
            .map(|(item, stats)| {
                let score = if use_thompson {
                    self.thompson_sample(&stats)
                } else {
                    self.ucb_score(&stats, total)
                };
                (item, score)
            })
            .collect();

        // Sort by score descending
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        scored.into_iter().map(|(item, _)| item).collect()
    }
}

/// Simple Beta distribution sampler (approximation using normal distribution)
/// For more accuracy, use a proper statistics crate
fn beta_sample(alpha: f64, beta: f64) -> f64 {
    // Use the mean + some variance based on parameters
    // This is a simplification; for production, use rand_distr::Beta
    let mean = alpha / (alpha + beta);
    let variance = (alpha * beta) / ((alpha + beta).powi(2) * (alpha + beta + 1.0));
    let std_dev = variance.sqrt();

    // Add some randomness (in production, use proper random sampling)
    let random_factor = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .subsec_nanos() as f64
        / 1_000_000_000.0
        - 0.5)
        * 2.0; // [-1, 1]

    (mean + random_factor * std_dev).clamp(0.0, 1.0)
}

/// Temporal Difference learning for session-based rewards
pub struct TDLearner {
    /// State values: workspace_name -> expected reward
    state_values: HashMap<String, f64>,
    /// Learning rate
    alpha: f64,
    /// Discount factor
    gamma: f64,
}

impl TDLearner {
    pub fn new(alpha: f64, gamma: f64) -> Self {
        Self {
            state_values: HashMap::new(),
            alpha,
            gamma,
        }
    }

    /// Update state value after observing reward
    pub fn update(&mut self, state: &str, reward: f64, next_state: Option<&str>) {
        let current_value = *self.state_values.get(state).unwrap_or(&0.0);
        let next_value = next_state
            .and_then(|s| self.state_values.get(s))
            .copied()
            .unwrap_or(0.0);

        // TD(0) update: V(s) = V(s) + α * (r + γ*V(s') - V(s))
        let td_error = reward + self.gamma * next_value - current_value;
        let new_value = current_value + self.alpha * td_error;

        self.state_values.insert(state.to_string(), new_value);
    }

    /// Get expected value for a state
    pub fn value(&self, state: &str) -> f64 {
        *self.state_values.get(state).unwrap_or(&0.0)
    }

    /// Get all state values
    pub fn all_values(&self) -> &HashMap<String, f64> {
        &self.state_values
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_immediate_reward() {
        let calc = RewardCalculator::new();

        let event = FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Accepted,
            "Test".to_string(),
        )
        .with_response_time(500); // Quick response

        let reward = calc.immediate_reward(&event);
        assert!(reward > 1.0); // Should be boosted due to quick response
    }

    #[test]
    fn test_ucb_score() {
        let calc = RewardCalculator::new();

        let mut stats = SuggestionStats::default();
        stats.record(&UserAction::Accepted, None);
        stats.record(&UserAction::Accepted, None);
        stats.record(&UserAction::Rejected, None);

        let score = calc.ucb_score(&stats, 10);
        assert!(score > 0.0);
    }

    #[test]
    fn test_td_learner() {
        let mut learner = TDLearner::new(0.1, 0.9);

        // Simulate: state A -> reward 1.0 -> state B
        learner.update("workspace_a", 1.0, Some("workspace_b"));

        assert!(learner.value("workspace_a") > 0.0);
    }
}
