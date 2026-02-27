//! # Configuration Module
//!
//! This module handles loading and managing configuration from environment variables.
//! It demonstrates several important Rust patterns:
//! - Structs with named fields
//! - The Default trait for sensible defaults
//! - Error handling with Result types
//! - String ownership vs borrowing

use anyhow::{Context, Result};
use std::env;

// =============================================================================
// CONFIGURATION STRUCT
// =============================================================================
/// Main configuration for the research agent.
///
/// # Rust Concept: Structs
/// Structs are Rust's way of creating custom data types. They're similar to
/// classes in other languages but without inheritance. Each field has a name
/// and type.
///
/// # Rust Concept: Derive Macros
/// The #[derive(...)] attribute automatically implements common traits:
/// - Debug: Allows printing with {:?} format
/// - Clone: Creates a deep copy of the struct
#[derive(Debug, Clone)]
pub struct Config {
    /// The Ollama model to use (e.g., "llama3.2", "deepseek-v3.2")
    pub model: String,

    /// Ollama server URL (default: http://localhost:11434)
    pub ollama_host: String,

    /// Temperature for LLM responses (0.0 = deterministic, 1.0 = creative)
    /// Lower values produce more focused, factual responses
    pub temperature: f32,

    /// Maximum number of search results to analyze
    pub max_search_results: usize,

    /// Log level for the application
    pub log_level: String,
}

// =============================================================================
// DEFAULT IMPLEMENTATION
// =============================================================================
/// # Rust Concept: The Default Trait
///
/// The Default trait provides a way to create a "default" value for a type.
/// This is useful when you want sensible defaults that can be overridden.
///
/// We implement it manually here to show the pattern, but you can also
/// derive it with #[derive(Default)] for simple cases.
impl Default for Config {
    fn default() -> Self {
        Self {
            // Use a common, capable model as default
            model: "llama3.2".to_string(),

            // Standard Ollama default port
            ollama_host: "http://localhost:11434".to_string(),

            // Moderate temperature - balanced between creativity and focus
            temperature: 0.7,

            // Analyze top 5 search results by default
            max_search_results: 5,

            // Info level logging by default
            log_level: "info".to_string(),
        }
    }
}

// =============================================================================
// CONFIGURATION LOADING
// =============================================================================
impl Config {
    /// Load configuration from environment variables.
    ///
    /// # Rust Concept: Result Type
    ///
    /// Result<T, E> is Rust's way of handling operations that can fail.
    /// - Ok(value) indicates success with a value
    /// - Err(error) indicates failure with an error
    ///
    /// We use `anyhow::Result<T>` which is shorthand for `Result<T, anyhow::Error>`.
    /// anyhow::Error can hold any error type, making it great for applications.
    ///
    /// # Rust Concept: The ? Operator
    ///
    /// The `?` operator is syntactic sugar for error propagation.
    /// If the Result is Ok, it unwraps the value.
    /// If the Result is Err, it returns early from the function with that error.
    ///
    /// # Example
    /// ```
    /// let config = Config::from_env()?;
    /// println!("Using model: {}", config.model);
    /// ```
    pub fn from_env() -> Result<Self> {
        // Load .env file if it exists (silently ignore if not found)
        // This is useful for local development
        let _ = dotenvy::dotenv();

        // Start with default values
        let mut config = Config::default();

        // Override with environment variables if set
        //
        // # Rust Concept: if let
        // `if let` is a concise way to handle a single pattern match.
        // It's equivalent to:
        //   match env::var("OLLAMA_MODEL") {
        //       Ok(val) => { config.model = val; }
        //       Err(_) => { /* do nothing */ }
        //   }
        if let Ok(val) = env::var("OLLAMA_MODEL") {
            config.model = val;
        }

        if let Ok(val) = env::var("OLLAMA_API_BASE_URL") {
            config.ollama_host = val;
        }

        // Parse temperature from string to f32
        // .context() adds helpful error messages when things fail
        if let Ok(val) = env::var("TEMPERATURE") {
            config.temperature = val
                .parse()
                .context("TEMPERATURE must be a valid floating-point number (e.g., 0.7)")?;
        }

        if let Ok(val) = env::var("MAX_SEARCH_RESULTS") {
            config.max_search_results = val
                .parse()
                .context("MAX_SEARCH_RESULTS must be a valid positive integer")?;
        }

        if let Ok(val) = env::var("RUST_LOG") {
            config.log_level = val;
        }

        Ok(config)
    }

    /// Validate the configuration.
    ///
    /// This ensures all values are within acceptable ranges before the agent starts.
    /// It's better to fail fast with a clear error than to fail later with a confusing one!
    pub fn validate(&self) -> Result<()> {
        // Temperature must be between 0 and 2 (OpenAI/Ollama range)
        if !(0.0..=2.0).contains(&self.temperature) {
            anyhow::bail!(
                "Temperature must be between 0.0 and 2.0, got: {}",
                self.temperature
            );
        }

        // Must have at least 1 search result
        if self.max_search_results == 0 {
            anyhow::bail!("MAX_SEARCH_RESULTS must be at least 1");
        }

        // Model name can't be empty
        if self.model.is_empty() {
            anyhow::bail!("OLLAMA_MODEL cannot be empty");
        }

        Ok(())
    }
}

// =============================================================================
// UNIT TESTS
// =============================================================================
/// # Rust Concept: Unit Tests
///
/// Tests in Rust are functions annotated with #[test].
/// They're placed in a special module annotated with #[cfg(test)].
/// The #[cfg(test)] means this code is only compiled during testing.
///
/// Run tests with: cargo test
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();

        assert_eq!(config.model, "llama3.2");
        assert_eq!(config.ollama_host, "http://localhost:11434");
        assert!((config.temperature - 0.7).abs() < f32::EPSILON);
        assert_eq!(config.max_search_results, 5);
    }

    #[test]
    fn test_config_validation_valid() {
        let config = Config::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_config_validation_invalid_temperature() {
        let mut config = Config::default();
        config.temperature = 3.0; // Invalid: above 2.0
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_validation_invalid_search_results() {
        let mut config = Config::default();
        config.max_search_results = 0; // Invalid: must be at least 1
        assert!(config.validate().is_err());
    }
}
