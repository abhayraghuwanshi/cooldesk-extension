// Sidecar Server Module
// Rust replacement for Node.js sidecar

pub mod data;
pub mod storage;
pub mod sync;
pub mod server;
pub mod handlers;
pub mod llm;

pub use server::start_server;
