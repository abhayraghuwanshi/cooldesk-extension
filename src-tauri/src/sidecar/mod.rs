// Sidecar Server Module
// Rust replacement for Node.js sidecar

pub mod data;
pub mod storage;
pub mod sync;
pub mod server;
pub mod handlers;
pub mod llm;
pub mod llm_v2;

pub use server::start_server;
