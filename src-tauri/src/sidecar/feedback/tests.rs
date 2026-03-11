//! Tests for the implicit feedback/reinforcement learning module

#[cfg(test)]
mod feedback_types_tests {
    use crate::sidecar::feedback::types::*;

    #[test]
    fn test_user_action_rewards() {
        assert_eq!(UserAction::Accepted.base_reward(), 1.0);
        assert_eq!(UserAction::Rejected.base_reward(), -1.0);
        assert_eq!(UserAction::Modified.base_reward(), 0.5);
        assert_eq!(UserAction::Ignored.base_reward(), -0.2);
        assert_eq!(UserAction::Previewed.base_reward(), 0.1);
        assert_eq!(UserAction::Undone.base_reward(), -0.8);
    }

    #[test]
    fn test_feedback_event_creation() {
        let event = FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Accepted,
            "Development".to_string(),
        );

        assert_eq!(event.suggestion_type, SuggestionType::WorkspaceGroup);
        assert_eq!(event.action, UserAction::Accepted);
        assert_eq!(event.suggestion_content, "Development");
        assert!(event.timestamp > 0);
        assert!(!event.id.is_empty());
    }

    #[test]
    fn test_feedback_event_with_context() {
        let event = FeedbackEvent::new(
            SuggestionType::UrlToWorkspace,
            UserAction::Modified,
            "Research".to_string(),
        )
        .with_context(
            Some("My Project".to_string()),
            vec!["https://github.com".to_string(), "https://stackoverflow.com".to_string()],
        )
        .with_response_time(1500)
        .with_modification("Research & Development".to_string());

        assert_eq!(event.context_workspace, Some("My Project".to_string()));
        assert_eq!(event.context_urls.len(), 2);
        assert_eq!(event.response_time_ms, Some(1500));
        assert_eq!(event.modified_content, Some("Research & Development".to_string()));
    }

    #[test]
    fn test_suggestion_stats_recording() {
        let mut stats = SuggestionStats::default();

        stats.record(&UserAction::Accepted, Some(500));
        assert_eq!(stats.total_shown, 1);
        assert_eq!(stats.accepted, 1);
        assert_eq!(stats.cumulative_reward, 1.0);

        stats.record(&UserAction::Rejected, Some(1000));
        assert_eq!(stats.total_shown, 2);
        assert_eq!(stats.rejected, 1);
        assert_eq!(stats.cumulative_reward, 0.0); // 1.0 + (-1.0)

        stats.record(&UserAction::Modified, None);
        assert_eq!(stats.total_shown, 3);
        assert_eq!(stats.modified, 1);
        assert_eq!(stats.cumulative_reward, 0.5); // 0.0 + 0.5
    }

    #[test]
    fn test_suggestion_stats_rates() {
        let mut stats = SuggestionStats::default();

        // Empty stats
        assert_eq!(stats.acceptance_rate(), 0.5); // Prior neutral
        assert_eq!(stats.rejection_rate(), 0.0);

        // 2 accepted, 1 rejected
        stats.record(&UserAction::Accepted, None);
        stats.record(&UserAction::Accepted, None);
        stats.record(&UserAction::Rejected, None);

        assert!((stats.acceptance_rate() - 0.666).abs() < 0.01);
        assert!((stats.rejection_rate() - 0.333).abs() < 0.01);
    }

    #[test]
    fn test_url_co_occurrence() {
        let co_occ = UrlCoOccurrence::new(
            "https://github.com".to_string(),
            "https://stackoverflow.com".to_string(),
        );

        // Should be ordered consistently
        assert!(co_occ.url1 <= co_occ.url2);
        assert_eq!(co_occ.workspace_count, 0);
        assert_eq!(co_occ.affinity_score(), 0.0);
    }

    #[test]
    fn test_url_co_occurrence_affinity() {
        let mut co_occ = UrlCoOccurrence::new(
            "https://github.com".to_string(),
            "https://docs.rs".to_string(),
        );

        // Add positive signals
        co_occ.workspace_count = 5;
        co_occ.session_count = 3;
        co_occ.positive_feedback = 2;

        let score = co_occ.affinity_score();
        assert!(score > 0.0);
        assert!(score <= 1.0);

        // Add negative feedback
        co_occ.negative_feedback = 10;
        let new_score = co_occ.affinity_score();
        assert!(new_score < score); // Should decrease
    }

    #[test]
    fn test_feedback_state_trim() {
        let mut state = FeedbackState::new();

        // Add more than MAX_EVENTS
        for i in 0..(FeedbackState::MAX_EVENTS + 100) {
            state.events.push(FeedbackEvent::new(
                SuggestionType::WorkspaceGroup,
                UserAction::Accepted,
                format!("Event {}", i),
            ));
        }

        assert!(state.events.len() > FeedbackState::MAX_EVENTS);

        state.trim_events();

        assert_eq!(state.events.len(), FeedbackState::MAX_EVENTS);
        // Should keep most recent events
        assert!(state.events.last().unwrap().suggestion_content.contains("5099"));
    }
}

#[cfg(test)]
mod feedback_store_tests {
    use crate::sidecar::feedback::{FeedbackStore, FeedbackEvent, SuggestionType, UserAction};
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_store_creation() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        assert_eq!(store.event_count().await, 0);
    }

    #[tokio::test]
    async fn test_record_and_retrieve_event() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        let event = FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Accepted,
            "Test Workspace".to_string(),
        );

        store.record_event(event).await;

        assert_eq!(store.event_count().await, 1);

        let events = store.get_recent_events(10).await;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].suggestion_content, "Test Workspace");
    }

    #[tokio::test]
    async fn test_stats_aggregation() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        // Record multiple events of same type
        for _ in 0..3 {
            store.record_event(FeedbackEvent::new(
                SuggestionType::WorkspaceGroup,
                UserAction::Accepted,
                "Test".to_string(),
            )).await;
        }

        store.record_event(FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Rejected,
            "Test".to_string(),
        )).await;

        let stats = store.get_all_stats().await;
        let workspace_stats = stats.get("workspace_group").unwrap();

        assert_eq!(workspace_stats.total_shown, 4);
        assert_eq!(workspace_stats.accepted, 3);
        assert_eq!(workspace_stats.rejected, 1);
    }

    #[tokio::test]
    async fn test_url_co_occurrence_recording() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        store.record_co_occurrence(
            "https://github.com/foo",
            "https://github.com/bar",
            true, // workspace
        ).await;

        store.record_co_occurrence(
            "https://github.com/foo",
            "https://github.com/bar",
            true,
        ).await;

        let affinity = store.get_url_affinity(
            "https://github.com/foo",
            "https://github.com/bar",
        ).await;

        assert!(affinity > 0.0);
    }

    #[tokio::test]
    async fn test_url_affinity_symmetry() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        store.record_co_occurrence(
            "https://a.com",
            "https://b.com",
            true,
        ).await;

        let affinity1 = store.get_url_affinity("https://a.com", "https://b.com").await;
        let affinity2 = store.get_url_affinity("https://b.com", "https://a.com").await;

        assert_eq!(affinity1, affinity2);
    }

    #[tokio::test]
    async fn test_related_urls() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        // Create relationships
        for _ in 0..5 {
            store.record_co_occurrence("https://main.com", "https://related1.com", true).await;
        }
        for _ in 0..3 {
            store.record_co_occurrence("https://main.com", "https://related2.com", true).await;
        }

        let related = store.get_related_urls("https://main.com", 0.0).await;

        assert_eq!(related.len(), 2);
        // Higher affinity should come first
        assert!(related[0].1 >= related[1].1);
    }

    #[tokio::test]
    async fn test_grouping_feedback() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        // Positive feedback
        store.record_grouping_feedback(
            "https://a.com",
            "https://b.com",
            true,
        ).await;

        let affinity = store.get_url_affinity("https://a.com", "https://b.com").await;
        assert!(affinity > 0.0);

        // Negative feedback
        store.record_grouping_feedback(
            "https://a.com",
            "https://b.com",
            false,
        ).await;

        let new_affinity = store.get_url_affinity("https://a.com", "https://b.com").await;
        assert!(new_affinity < affinity);
    }

    #[tokio::test]
    async fn test_persistence() {
        let dir = tempdir().unwrap();

        // Create store and add data
        {
            let store = FeedbackStore::new(dir.path().to_path_buf());

            store.record_event(FeedbackEvent::new(
                SuggestionType::WorkspaceGroup,
                UserAction::Accepted,
                "Persistent".to_string(),
            )).await;

            store.save().await.unwrap();
        }

        // Load from disk
        {
            let store = FeedbackStore::new(dir.path().to_path_buf());
            let events = store.get_recent_events(10).await;

            assert_eq!(events.len(), 1);
            assert_eq!(events[0].suggestion_content, "Persistent");
        }
    }
}

#[cfg(test)]
mod rewards_tests {
    use crate::sidecar::feedback::{FeedbackEvent, SuggestionType, UserAction};
    use crate::sidecar::feedback::rewards::{RewardCalculator, TDLearner};
    use crate::sidecar::feedback::types::SuggestionStats;

    #[test]
    fn test_immediate_reward_basic() {
        let calc = RewardCalculator::new();

        let event = FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Accepted,
            "Test".to_string(),
        );

        let reward = calc.immediate_reward(&event);
        assert_eq!(reward, 1.0);
    }

    #[test]
    fn test_immediate_reward_with_fast_response() {
        let calc = RewardCalculator::new();

        let event = FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Accepted,
            "Test".to_string(),
        ).with_response_time(500); // Fast response

        let reward = calc.immediate_reward(&event);
        assert!(reward > 1.0); // Should be boosted
        assert_eq!(reward, 1.2);
    }

    #[test]
    fn test_immediate_reward_with_slow_response() {
        let calc = RewardCalculator::new();

        let event = FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Accepted,
            "Test".to_string(),
        ).with_response_time(20000); // Very slow

        let reward = calc.immediate_reward(&event);
        assert!(reward < 1.0); // Should be penalized
    }

    #[test]
    fn test_immediate_reward_with_modification() {
        let calc = RewardCalculator::new();

        let event = FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Accepted,
            "Test".to_string(),
        ).with_modification("Modified Test".to_string());

        let reward = calc.immediate_reward(&event);
        assert_eq!(reward, 0.8); // Partial credit
    }

    #[test]
    fn test_ucb_score_exploration() {
        let calc = RewardCalculator::new();

        // New suggestion (never shown)
        let empty_stats = SuggestionStats::default();
        let score = calc.ucb_score(&empty_stats, 100);

        assert!(score.is_infinite()); // Should explore first
    }

    #[test]
    fn test_ucb_score_exploitation() {
        let calc = RewardCalculator::new();

        let mut stats = SuggestionStats::default();
        for _ in 0..10 {
            stats.record(&UserAction::Accepted, None);
        }

        let score = calc.ucb_score(&stats, 100);
        assert!(score.is_finite());
        assert!(score > 0.0);
    }

    #[test]
    fn test_thompson_sampling_bounds() {
        let calc = RewardCalculator::new();

        let mut stats = SuggestionStats::default();
        stats.record(&UserAction::Accepted, None);
        stats.record(&UserAction::Rejected, None);

        // Sample multiple times and check bounds
        for _ in 0..100 {
            let sample = calc.thompson_sample(&stats);
            assert!(sample >= 0.0);
            assert!(sample <= 1.0);
        }
    }

    #[test]
    fn test_rank_suggestions() {
        let calc = RewardCalculator::new();

        let mut good_stats = SuggestionStats::default();
        for _ in 0..10 {
            good_stats.record(&UserAction::Accepted, None);
        }

        let mut bad_stats = SuggestionStats::default();
        for _ in 0..10 {
            bad_stats.record(&UserAction::Rejected, None);
        }

        let suggestions = vec![
            ("bad", bad_stats),
            ("good", good_stats),
        ];

        let ranked = calc.rank_suggestions(suggestions, false);

        // Good should rank higher than bad
        assert_eq!(ranked[0], "good");
    }

    #[test]
    fn test_td_learner_update() {
        let mut learner = TDLearner::new(0.1, 0.9);

        // Initial state value should be 0
        assert_eq!(learner.value("workspace_a"), 0.0);

        // Update with positive reward
        learner.update("workspace_a", 1.0, None);
        assert!(learner.value("workspace_a") > 0.0);

        // Update with negative reward
        learner.update("workspace_a", -1.0, None);
        let value_after_negative = learner.value("workspace_a");

        // Should have decreased but still influenced by prior
        assert!(value_after_negative < 0.1);
    }

    #[test]
    fn test_td_learner_chain() {
        let mut learner = TDLearner::new(0.5, 0.9);

        // state_a -> state_b -> terminal
        learner.update("state_b", 1.0, None); // Final state gets reward
        learner.update("state_a", 0.0, Some("state_b")); // Predecessor gets discounted value

        assert!(learner.value("state_a") > 0.0);
        assert!(learner.value("state_a") < learner.value("state_b"));
    }
}

#[cfg(test)]
mod pattern_tracker_tests {
    use crate::sidecar::feedback::patterns::PatternTracker;

    #[test]
    fn test_record_url_workspace() {
        let mut tracker = PatternTracker::new();

        // Train with multiple URLs to build confidence
        for i in 0..3 {
            tracker.record_url_workspace(
                &format!("https://github.com/repo{}", i),
                &format!("Repository {}", i),
                "Development",
            );
        }

        // Should be able to suggest based on domain
        let suggestions = tracker.suggest_workspaces(
            "https://github.com/another/repo",
            "Another Repository",
            3,
        );

        assert!(!suggestions.is_empty());
        assert_eq!(suggestions[0].0, "Development");
    }

    #[test]
    fn test_multiple_associations() {
        let mut tracker = PatternTracker::new();

        // Train with multiple URLs
        for i in 0..5 {
            tracker.record_url_workspace(
                &format!("https://github.com/repo{}", i),
                &format!("Repository {}", i),
                "Development",
            );
        }

        for i in 0..3 {
            tracker.record_url_workspace(
                &format!("https://stackoverflow.com/q/{}", i),
                &format!("Question {}", i),
                "Research",
            );
        }

        // GitHub URLs should suggest Development
        let github_suggestion = tracker.suggest_workspace(
            "https://github.com/new/project",
            "New Project",
        );
        assert_eq!(github_suggestion.unwrap().0, "Development");

        // StackOverflow URLs should suggest Research
        let so_suggestion = tracker.suggest_workspace(
            "https://stackoverflow.com/questions/123",
            "How to do X?",
        );
        assert_eq!(so_suggestion.unwrap().0, "Research");
    }

    #[test]
    fn test_suggest_multiple_workspaces() {
        let mut tracker = PatternTracker::new();

        // URL associated with multiple workspaces
        tracker.record_url_workspace(
            "https://docs.rust-lang.org",
            "Rust Documentation",
            "Learning",
        );
        tracker.record_url_workspace(
            "https://docs.rust-lang.org",
            "Rust Documentation",
            "Development",
        );
        tracker.record_url_workspace(
            "https://docs.rust-lang.org",
            "Rust Documentation",
            "Development",
        );

        let suggestions = tracker.suggest_workspaces(
            "https://docs.rust-lang.org/book",
            "The Rust Book",
            3,
        );

        assert!(!suggestions.is_empty());
        // Development should score higher (2 occurrences vs 1)
        assert_eq!(suggestions[0].0, "Development");
    }

    #[test]
    fn test_keyword_matching() {
        let mut tracker = PatternTracker::new();

        // Train with multiple samples to build confidence
        for i in 0..3 {
            tracker.record_url_workspace(
                &format!("https://example{}.com/rust-tutorial", i),
                "Learn Rust Programming",
                "Rust Learning",
            );
        }

        // Should match on keyword "rust" - use suggest_workspaces which has no threshold
        let suggestions = tracker.suggest_workspaces(
            "https://different-site.com/rust-guide",
            "Rust Guide for Beginners",
            3,
        );

        // Should have at least one suggestion based on keyword matching
        assert!(!suggestions.is_empty());
        assert_eq!(suggestions[0].0, "Rust Learning");
    }

    #[test]
    fn test_workspace_domains() {
        let mut tracker = PatternTracker::new();

        tracker.record_url_workspace(
            "https://github.com/a",
            "A",
            "Dev",
        );
        tracker.record_url_workspace(
            "https://gitlab.com/b",
            "B",
            "Dev",
        );
        tracker.record_url_workspace(
            "https://github.com/c",
            "C",
            "Dev",
        );

        let domains = tracker.workspace_domains("Dev");

        assert_eq!(domains.len(), 2);
        // github.com should have count 2
        let github = domains.iter().find(|(d, _)| d == "github.com");
        assert!(github.is_some());
        assert_eq!(github.unwrap().1, 2);
    }

    #[test]
    fn test_no_false_positives() {
        let mut tracker = PatternTracker::new();

        tracker.record_url_workspace(
            "https://specific-domain.com/page",
            "Specific Page",
            "Specific Workspace",
        );

        // Completely different URL should not have strong match
        let suggestions = tracker.suggest_workspaces(
            "https://completely-different.com/other",
            "Other Page With No Common Keywords",
            3,
        );

        // Should be empty or have very low scores (no domain/keyword overlap)
        // The only potential match would be from common stop words, which should be filtered
        if !suggestions.is_empty() {
            // If there are any suggestions, they should have low scores
            assert!(suggestions[0].1 < 1.0, "Score should be low for unrelated URLs");
        }
    }
}

#[cfg(test)]
mod integration_tests {
    use crate::sidecar::feedback::{
        FeedbackStore, FeedbackEvent, SuggestionType, UserAction,
        PatternTracker,
    };
    use crate::sidecar::feedback::rewards::RewardCalculator;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_full_workflow() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());
        let mut tracker = PatternTracker::new();
        let calc = RewardCalculator::new();

        // Simulate user workflow:
        // 1. User groups github URLs into "Development"
        let urls = vec![
            ("https://github.com/repo1", "Repo 1"),
            ("https://github.com/repo2", "Repo 2"),
            ("https://github.com/repo3", "Repo 3"),
        ];

        for (url, title) in &urls {
            tracker.record_url_workspace(url, title, "Development");

            // Record co-occurrence between all pairs
            for (other_url, _) in &urls {
                if url != other_url {
                    store.record_co_occurrence(url, other_url, true).await;
                }
            }
        }

        // 2. User accepts a workspace grouping suggestion
        let event = FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Accepted,
            "Development".to_string(),
        )
        .with_context(
            Some("Development".to_string()),
            urls.iter().map(|(u, _)| u.to_string()).collect(),
        )
        .with_response_time(800);

        store.record_event(event.clone()).await;

        // 3. Calculate reward
        let reward = calc.immediate_reward(&event);
        assert!(reward > 1.0); // Fast acceptance = boosted reward

        // 4. New GitHub URL should suggest "Development"
        let suggestion = tracker.suggest_workspace(
            "https://github.com/new-repo",
            "New Repository",
        );
        assert_eq!(suggestion.unwrap().0, "Development");

        // 5. URLs should have positive affinity
        let affinity = store.get_url_affinity(
            "https://github.com/repo1",
            "https://github.com/repo2",
        ).await;
        assert!(affinity > 0.0);

        // 6. Verify stats
        let stats = store.get_all_stats().await;
        let workspace_stats = stats.get("workspace_group").unwrap();
        assert_eq!(workspace_stats.accepted, 1);
    }

    #[tokio::test]
    async fn test_learning_from_rejection() {
        let dir = tempdir().unwrap();
        let store = FeedbackStore::new(dir.path().to_path_buf());

        // Initially group two URLs together
        store.record_co_occurrence(
            "https://work.com",
            "https://personal.com",
            true,
        ).await;

        let initial_affinity = store.get_url_affinity(
            "https://work.com",
            "https://personal.com",
        ).await;

        // User rejects grouping
        store.record_grouping_feedback(
            "https://work.com",
            "https://personal.com",
            false,
        ).await;

        // Record the rejection event
        let event = FeedbackEvent::new(
            SuggestionType::WorkspaceGroup,
            UserAction::Rejected,
            "Mixed Workspace".to_string(),
        );
        store.record_event(event).await;

        let final_affinity = store.get_url_affinity(
            "https://work.com",
            "https://personal.com",
        ).await;

        // Affinity should decrease after rejection
        assert!(final_affinity < initial_affinity);

        // Stats should reflect rejection
        let stats = store.get_all_stats().await;
        let workspace_stats = stats.get("workspace_group").unwrap();
        assert_eq!(workspace_stats.rejected, 1);
    }
}
