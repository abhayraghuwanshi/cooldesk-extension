//! LLM v2 Module - Agent with Memory Support
//!
//! This module provides an agentic AI system with:
//! - Short-term memory: Conversation history within sessions
//! - Long-term memory: Persistent facts across sessions
//! - Tool support: Extensible tool system for agent actions
//! - Multi-turn conversations: Context-aware responses
//!
//! ## Simple Agent (Recommended)
//! The `simple_agent` module provides a context-injection approach that
//! lets the LLM naturally understand queries without keyword routing.

pub mod memory;
pub mod conversation;
pub mod client;
pub mod agent;
pub mod tools;
pub mod simple_agent;

pub use agent::CoolDeskAgent;
pub use simple_agent::SimpleAgent;
