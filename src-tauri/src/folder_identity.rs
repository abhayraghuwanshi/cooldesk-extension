//! What a folder *is*, for the workspace cards' folder tiles: its tech stack
//! (from marker files — the tile shows that stack's logo, so a folder reads at
//! the same weight as the link favicons beside it) and its git branch / dirty
//! state (the badge under the tile when no dev server is running from it).
//!
//! Read-only and cheap: one `read_dir` of the folder, at most one small
//! `package.json` read, and — only inside a git repo — one `git status`.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderIdentity {
    /// Stack key the frontend maps to a logo ("react", "rust", "tauri", …).
    pub stack: Option<String>,
    /// Current branch, or a short commit hash when HEAD is detached.
    pub branch: Option<String>,
    /// Uncommitted changes to tracked files under this folder.
    pub dirty: bool,
}

/// Dependencies in package.json → the framework they mean. Checked in order,
/// so a Next app (which also depends on react) reads as Next.
const JS_FRAMEWORKS: &[(&str, &str)] = &[
    ("next", "nextjs"),
    ("@angular/core", "angular"),
    ("svelte", "svelte"),
    ("vue", "vuejs"),
    ("electron", "electron"),
    ("react", "react"),
    ("vite", "vitejs"),
    ("typescript", "typescript"),
];

fn detect_stack(dir: &Path, names: &[String]) -> Option<String> {
    let has = |n: &str| names.iter().any(|x| x == n);
    let has_prefix = |p: &str| names.iter().any(|x| x.starts_with(p));

    // Tauri before Rust/JS: a Tauri app has both a Cargo.toml and a package.json.
    if has("src-tauri") || has("tauri.conf.json") {
        return Some("tauri".into());
    }
    if has_prefix("next.config.") {
        return Some("nextjs".into());
    }
    if has("package.json") {
        if let Ok(text) = fs::read_to_string(dir.join("package.json")) {
            if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&text) {
                let dep = |name: &str| {
                    ["dependencies", "devDependencies", "peerDependencies"]
                        .iter()
                        .any(|k| pkg.get(k).and_then(|d| d.get(name)).is_some())
                };
                if let Some((_, stack)) = JS_FRAMEWORKS.iter().find(|(d, _)| dep(d)) {
                    return Some((*stack).into());
                }
            }
        }
        if has("bun.lockb") || has("bun.lock") {
            return Some("bun".into());
        }
        return Some("nodejs".into());
    }
    if has("Cargo.toml") {
        return Some("rust".into());
    }
    if has("go.mod") {
        return Some("go".into());
    }
    if has("pyproject.toml") || has("requirements.txt") || has("setup.py") || has("Pipfile") {
        return Some("python".into());
    }
    if has("pubspec.yaml") {
        return Some("flutter".into());
    }
    if has("Package.swift") || names.iter().any(|n| n.ends_with(".xcodeproj")) {
        return Some("swift".into());
    }
    if has("pom.xml") || has_prefix("build.gradle") {
        return Some(if has_prefix("build.gradle.kts") { "kotlin" } else { "java" }.into());
    }
    if has("Gemfile") {
        return Some("ruby".into());
    }
    if has("composer.json") {
        return Some("php".into());
    }
    if has("CMakeLists.txt") {
        return Some("cplusplus".into());
    }
    if has("Dockerfile") || has_prefix("docker-compose") {
        return Some("docker".into());
    }
    // No project marker: a folder that is mostly notes reads as Markdown.
    let files: Vec<&String> = names.iter().filter(|n| !n.starts_with('.') && n.contains('.')).collect();
    let md = files.iter().filter(|n| n.ends_with(".md") || n.ends_with(".mdx")).count();
    if md > 0 && md * 2 >= files.len() {
        return Some("markdown".into());
    }
    None
}

/// Nearest ancestor (or self) holding `.git` — a dir, or a file for worktrees.
fn repo_root(dir: &Path) -> Option<PathBuf> {
    dir.ancestors().find(|p| p.join(".git").exists()).map(Path::to_path_buf)
}

/// Branch from `.git/HEAD` without spawning git. Worktrees keep a `.git` file
/// pointing at their real git dir (`gitdir: …`).
fn read_branch(root: &Path) -> Option<String> {
    let dot_git = root.join(".git");
    let git_dir = if dot_git.is_file() {
        let text = fs::read_to_string(&dot_git).ok()?;
        let p = PathBuf::from(text.trim().strip_prefix("gitdir:")?.trim());
        if p.is_absolute() { p } else { root.join(p) }
    } else {
        dot_git
    };
    let head = fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();
    match head.strip_prefix("ref: refs/heads/") {
        Some(b) => Some(b.to_string()),
        None => head.get(..7).map(str::to_string), // detached: short hash
    }
}

/// Tracked-file changes under `dir` only (`-- .`), untracked ignored — a fresh
/// build output shouldn't light the badge.
fn is_dirty(dir: &Path) -> bool {
    std::process::Command::new("git")
        .args(["status", "--porcelain", "--untracked-files=no", "--", "."])
        .current_dir(dir)
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false)
}

pub fn folder_identity(path: &str) -> FolderIdentity {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return FolderIdentity::default();
    }
    let names: Vec<String> = fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();
    let stack = detect_stack(dir, &names);
    let (branch, dirty) = match repo_root(dir) {
        Some(root) => (read_branch(&root), is_dirty(dir)),
        None => (None, false),
    };
    FolderIdentity { stack, branch, dirty }
}

