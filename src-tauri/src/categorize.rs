use std::collections::HashMap;
use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppCategory {
    pub category: String,
    pub source: String, // "winget", "homebrew", "plist", "spotlight", "fallback"
    pub confidence: f32, // 0.0 - 1.0
}

/// Cross-platform app categorization
pub struct Categorizer {
    cache: HashMap<String, AppCategory>,
}

impl Categorizer {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
        }
    }

    /// Main entry point - tries platform-specific sources then falls back
    pub fn categorize(&mut self, app_name: &str, app_path: &str) -> AppCategory {
        // Check cache first
        let cache_key = app_path.to_lowercase();
        if let Some(cached) = self.cache.get(&cache_key) {
            return cached.clone();
        }

        let result = self.categorize_impl(app_name, app_path);
        self.cache.insert(cache_key, result.clone());
        result
    }

    fn categorize_impl(&self, app_name: &str, app_path: &str) -> AppCategory {
        #[cfg(target_os = "windows")]
        {
            // Try winget first
            if let Some(cat) = self.try_winget(app_name) {
                return cat;
            }
        }

        #[cfg(target_os = "macos")]
        {
            // Try macOS sources in order of reliability
            if let Some(cat) = self.try_plist(app_path) {
                return cat;
            }
            if let Some(cat) = self.try_spotlight(app_path) {
                return cat;
            }
            if let Some(cat) = self.try_homebrew(app_name) {
                return cat;
            }
        }

        // Fallback: heuristic based on path/name
        self.heuristic_category(app_name, app_path)
    }

    // ==================== Windows ====================

    #[cfg(target_os = "windows")]
    fn try_winget(&self, app_name: &str) -> Option<AppCategory> {
        let output = Command::new("winget")
            .args(["show", app_name, "--accept-source-agreements"])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse "Category: <value>" from winget output
        for line in stdout.lines() {
            if let Some(cat) = line.strip_prefix("Category:") {
                let category = cat.trim().to_string();
                if !category.is_empty() {
                    return Some(AppCategory {
                        category: self.normalize_category(&category),
                        source: "winget".to_string(),
                        confidence: 0.95,
                    });
                }
            }
        }
        None
    }

    // ==================== macOS ====================

    #[cfg(target_os = "macos")]
    fn try_plist(&self, app_path: &str) -> Option<AppCategory> {
        // Find the .app bundle
        let app_bundle = if app_path.contains(".app/") {
            app_path.split(".app/").next()?.to_string() + ".app"
        } else if app_path.ends_with(".app") {
            app_path.to_string()
        } else {
            return None;
        };

        let plist_path = format!("{}/Contents/Info.plist", app_bundle);

        // Use defaults to read plist
        let output = Command::new("defaults")
            .args(["read", &plist_path, "LSApplicationCategoryType"])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let category = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if category.is_empty() {
            return None;
        }

        // LSApplicationCategoryType is like "public.app-category.developer-tools"
        let clean_cat = category
            .replace("public.app-category.", "")
            .replace("-", " ");

        Some(AppCategory {
            category: self.normalize_category(&clean_cat),
            source: "plist".to_string(),
            confidence: 0.98,
        })
    }

    #[cfg(target_os = "macos")]
    fn try_spotlight(&self, app_path: &str) -> Option<AppCategory> {
        let output = Command::new("mdls")
            .args(["-name", "kMDItemAppStoreCategory", app_path])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        // Output: kMDItemAppStoreCategory = "Developer Tools"
        let category = stdout
            .split('=')
            .nth(1)?
            .trim()
            .trim_matches('"')
            .to_string();

        if category.is_empty() || category == "(null)" {
            return None;
        }

        Some(AppCategory {
            category: self.normalize_category(&category),
            source: "spotlight".to_string(),
            confidence: 0.95,
        })
    }

    #[cfg(target_os = "macos")]
    fn try_homebrew(&self, app_name: &str) -> Option<AppCategory> {
        // Try both cask and formula
        let output = Command::new("brew")
            .args(["info", "--json=v2", app_name])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let json: serde_json::Value = serde_json::from_str(&stdout).ok()?;

        // Check casks first
        if let Some(casks) = json.get("casks").and_then(|c| c.as_array()) {
            if let Some(cask) = casks.first() {
                if let Some(desc) = cask.get("desc").and_then(|d| d.as_str()) {
                    return Some(AppCategory {
                        category: self.infer_from_description(desc),
                        source: "homebrew".to_string(),
                        confidence: 0.7,
                    });
                }
            }
        }

        None
    }

    // ==================== Fallback ====================

    fn heuristic_category(&self, app_name: &str, app_path: &str) -> AppCategory {
        let name_lower = app_name.to_lowercase();
        let path_lower = app_path.to_lowercase();

        let category = if self.matches_any(&name_lower, &["code", "studio", "ide", "vim", "emacs", "sublime", "atom"]) {
            "Developer Tools"
        } else if self.matches_any(&name_lower, &["chrome", "firefox", "safari", "edge", "brave", "opera"]) {
            "Browsers"
        } else if self.matches_any(&name_lower, &["slack", "teams", "discord", "zoom", "skype", "telegram", "whatsapp"]) {
            "Communication"
        } else if self.matches_any(&name_lower, &["spotify", "music", "vlc", "itunes", "audacity"]) {
            "Music"
        } else if self.matches_any(&name_lower, &["photoshop", "gimp", "figma", "sketch", "illustrator"]) {
            "Graphics & Design"
        } else if self.matches_any(&name_lower, &["word", "excel", "powerpoint", "notion", "obsidian", "onenote"]) {
            "Productivity"
        } else if self.matches_any(&name_lower, &["steam", "epic", "game", "xbox", "playstation"]) {
            "Games"
        } else if path_lower.contains("game") {
            "Games"
        } else if path_lower.contains("developer") || path_lower.contains("sdk") {
            "Developer Tools"
        } else {
            "Other"
        };

        AppCategory {
            category: category.to_string(),
            source: "heuristic".to_string(),
            confidence: 0.5,
        }
    }

    fn matches_any(&self, text: &str, patterns: &[&str]) -> bool {
        patterns.iter().any(|p| text.contains(p))
    }

    #[cfg(target_os = "macos")]
    fn infer_from_description(&self, desc: &str) -> String {
        let desc_lower = desc.to_lowercase();
        if desc_lower.contains("browser") { "Browsers" }
        else if desc_lower.contains("editor") || desc_lower.contains("ide") || desc_lower.contains("development") { "Developer Tools" }
        else if desc_lower.contains("chat") || desc_lower.contains("messaging") || desc_lower.contains("communication") { "Communication" }
        else if desc_lower.contains("music") || desc_lower.contains("audio") { "Music" }
        else if desc_lower.contains("video") || desc_lower.contains("media") { "Video" }
        else if desc_lower.contains("game") { "Games" }
        else { "Utilities" }.to_string()
    }

    /// Normalize category names to your 16 standard categories
    fn normalize_category(&self, raw: &str) -> String {
        let lower = raw.to_lowercase();

        // Map to your standard 16 categories
        let category = match lower.as_str() {
            s if s.contains("develop") || s.contains("programming") => "Developer Tools",
            s if s.contains("browser") || s.contains("web") => "Browsers",
            s if s.contains("social") || s.contains("chat") || s.contains("messag") => "Communication",
            s if s.contains("music") || s.contains("audio") => "Music",
            s if s.contains("video") || s.contains("movie") => "Video",
            s if s.contains("photo") || s.contains("graphic") || s.contains("design") => "Graphics & Design",
            s if s.contains("game") || s.contains("gaming") => "Games",
            s if s.contains("productivity") || s.contains("office") || s.contains("business") => "Productivity",
            s if s.contains("finance") || s.contains("money") => "Finance",
            s if s.contains("education") || s.contains("learning") => "Education",
            s if s.contains("news") || s.contains("weather") => "News",
            s if s.contains("health") || s.contains("fitness") => "Health & Fitness",
            s if s.contains("travel") || s.contains("navigation") => "Travel",
            s if s.contains("shopping") || s.contains("food") => "Shopping",
            s if s.contains("utility") || s.contains("tool") => "Utilities",
            _ => return raw.to_string(), // Keep original if no match
        };
        category.to_string()
    }
}

/// Batch categorize multiple apps
pub fn categorize_apps(apps: &[(String, String)]) -> HashMap<String, AppCategory> {
    let mut categorizer = Categorizer::new();
    apps.iter()
        .map(|(name, path)| (path.clone(), categorizer.categorize(name, path)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heuristic() {
        let cat = Categorizer::new();
        let result = cat.heuristic_category("Visual Studio Code", "C:\\Program Files\\VS Code\\code.exe");
        assert_eq!(result.category, "Developer Tools");
    }
}
