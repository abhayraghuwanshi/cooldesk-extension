//! Reads a project's committed `.cooldesk/` workspace folder — the shared project
//! knowledge authored by the CoolDesk Claude Code plugin — into a single JSON blob for
//! the desktop app to render (dock, todos, decisions, README).
//!
//! Read-only by design: the app never writes `.cooldesk/`. The plugin/AI owns authoring
//! it, and it is committed to the project's git repo. See the `cooldesk` plugin for the
//! on-disk format contract.

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// Read `<project_path>/.cooldesk/` into a structured value.
///
/// Never errors: returns `{ "exists": false, .. }` when the folder or `cooldesk.json`
/// manifest is absent, so callers can treat any project path uniformly.
pub fn read_cooldesk(project_path: &str) -> Value {
    let root: PathBuf = Path::new(project_path).join(".cooldesk");
    if !root.is_dir() {
        return json!({ "exists": false, "path": project_path });
    }

    let read_json = |name: &str| -> Option<Value> {
        fs::read_to_string(root.join(name))
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    };
    let read_text = |name: &str| -> Option<String> { fs::read_to_string(root.join(name)).ok() };
    let list_dir = |name: &str| -> Vec<String> {
        let mut out = vec![];
        if let Ok(entries) = fs::read_dir(root.join(name)) {
            for e in entries.flatten() {
                if let Some(n) = e.file_name().to_str() {
                    if !n.starts_with('.') {
                        out.push(n.to_string());
                    }
                }
            }
        }
        out.sort();
        out
    };

    // A `.cooldesk/` without a manifest isn't a real workspace yet.
    let manifest = match read_json("cooldesk.json") {
        Some(m) => m,
        None => return json!({ "exists": false, "path": project_path, "reason": "no cooldesk.json" }),
    };

    json!({
        "exists": true,
        "path": project_path,
        "manifest": manifest,
        "todos": read_json("todos.json"),
        "commands": read_json("commands.json"),
        "services": read_json("services.json"),
        "readme": read_text("README.md"),
        "architecture": read_text("architecture.md"),
        "decisions": read_text("decisions.md"),
        "docs": {
            "knowledge": list_dir("knowledge"),
            "prompts": list_dir("prompts"),
            "workflows": list_dir("workflows"),
            "notes": list_dir("notes"),
        }
    })
}
