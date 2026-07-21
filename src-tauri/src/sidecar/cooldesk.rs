//! Reads a project's committed `.cooldesk/` workspace folder — the shared project
//! knowledge authored by the CoolDesk Claude Code plugin — into a single JSON blob for
//! the desktop app to render (dock, todos, decisions, README).
//!
//! Read-only by design: the app never writes `.cooldesk/`. The plugin/AI owns authoring
//! it, and it is committed to the project's git repo. See the `cooldesk` plugin for the
//! on-disk format contract.
//!
//! Linking / groups: a hub project may carry `.cooldesk/group.json` listing member
//! projects (star topology — scales to many projects without N² pairwise links). When
//! present, the reader resolves each member's own `.cooldesk/` and returns them under
//! `group` + `members` so the app can show one merged workspace.

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// Read a single project's `.cooldesk/` (no group recursion).
/// Returns `{ "exists": false, .. }` when the folder or manifest is absent.
fn read_one(project_root: &Path) -> Value {
    let root = project_root.join(".cooldesk");
    if !root.is_dir() {
        return json!({ "exists": false, "path": project_root.to_string_lossy() });
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

    let manifest = match read_json("cooldesk.json") {
        Some(m) => m,
        None => {
            return json!({ "exists": false, "path": project_root.to_string_lossy(), "reason": "no cooldesk.json" })
        }
    };

    json!({
        "exists": true,
        "path": project_root.to_string_lossy(),
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

/// Resolve a member path (possibly containing `..`) against the hub root, cleaning it up
/// for display when the target exists.
fn resolve_member(base: &Path, rel: &str) -> PathBuf {
    let joined = base.join(rel);
    fs::canonicalize(&joined).unwrap_or(joined)
}

/// Windows `fs::canonicalize` returns extended-length paths (`\\?\C:\...`), which CMD
/// refuses as a working directory. Strip the verbatim prefix for the string we hand back.
fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

/// Read `<project_path>/.cooldesk/`, following a `group.json` hub manifest if present.
/// Never errors: absent folders/manifests yield `{ "exists": false }`.
pub fn read_cooldesk(project_path: &str) -> Value {
    let base = Path::new(project_path);
    let mut result = read_one(base);
    if result.get("exists").and_then(|v| v.as_bool()) != Some(true) {
        return result;
    }

    // Follow the group hub manifest, if this project has one.
    let group_path = base.join(".cooldesk").join("group.json");
    if let Ok(s) = fs::read_to_string(&group_path) {
        if let Ok(group_doc) = serde_json::from_str::<Value>(&s) {
            let group_info = group_doc.get("group").cloned().unwrap_or(Value::Null);
            let mut members = vec![];
            if let Some(arr) = group_doc.get("members").and_then(|m| m.as_array()) {
                for m in arr {
                    let rel = m.get("path").and_then(|p| p.as_str()).unwrap_or(".");
                    let member_root = resolve_member(base, rel);
                    let one = read_one(&member_root);
                    members.push(json!({
                        "name": m.get("name").cloned().unwrap_or(Value::Null),
                        "path": display_path(&member_root),
                        "repo": m.get("repo").cloned().unwrap_or(Value::Null),
                        "exists": one.get("exists").cloned().unwrap_or(Value::Bool(false)),
                        "project": one.get("manifest").and_then(|mm| mm.get("project")).cloned().unwrap_or(Value::Null),
                        "resources": one.get("manifest").and_then(|mm| mm.get("resources")).cloned().unwrap_or(Value::Null),
                        "todos": one.get("todos").cloned().unwrap_or(Value::Null),
                        "commands": one.get("commands").cloned().unwrap_or(Value::Null),
                        "services": one.get("services").cloned().unwrap_or(Value::Null),
                        "docs": one.get("docs").cloned().unwrap_or(Value::Null),
                    }));
                }
            }
            if let Value::Object(map) = &mut result {
                map.insert("group".to_string(), group_info);
                map.insert("members".to_string(), Value::Array(members));
            }
        }
    }

    result
}
