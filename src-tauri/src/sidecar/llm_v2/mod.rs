//! LLM v2 Module - Rig-style Agent with Memory Support
//!
//! This module provides an agentic AI system with:
//! - Short-term memory: Conversation history within sessions
//! - Long-term memory: Persistent facts across sessions
//! - Tool support: Extensible tool system for agent actions
//! - Multi-turn conversations: Context-aware responses

pub mod memory;
pub mod conversation;
pub mod client;
pub mod agent;
pub mod tools;

pub use agent::CoolDeskAgent;
