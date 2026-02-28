//! Implicit Feedback Module for Reinforcement Learning
//!
//! This module implements click-based implicit feedback collection and
//! reinforcement learning signals for workspace grouping optimization.
//!
//! ## Architecture
//! - `FeedbackEvent`: Records user interactions with suggestions
//! - `FeedbackStore`: Persistent storage with scoring algorithms
//! - `RewardCalculator`: Computes rewards for RL-based ranking
//! - `PatternTracker`: Tracks URL/workspace co-occurrence patterns

pub mod types;
pub mod store;
pub mod rewards;
pub mod patterns;

#[cfg(test)]
mod tests;

pub use types::*;
pub use store::FeedbackStore;
pub use rewards::RewardCalculator;
pub use patterns::PatternTracker;
