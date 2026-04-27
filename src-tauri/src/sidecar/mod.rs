// Sidecar Server Module
// Rust replacement for Node.js sidecar

pub mod data;
pub mod storage;
pub mod sync;
pub mod server;
pub mod handlers;
pub mod llm;
#[cfg(feature = "llm")]
pub mod llm_v2;
pub mod feedback;
pub mod llm_v3;

pub use server::start_server;
pub use feedback::{FeedbackStore, FeedbackEvent, SuggestionType, UserAction};
