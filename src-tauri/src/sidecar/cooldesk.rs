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

    // A member carries only a back-pointer (`group` in its own cooldesk.json).
    // Resolve it to an absolute path so the app can offer a way home — without
    // this, a member project knows it belongs to a group but can't say where.
    if let Some(back) = result
        .get("manifest")
        .and_then(|m| m.get("group"))
        .cloned()
        .filter(|g| !g.is_null())
    {
        let rel = back.get("hub").and_then(|h| h.as_str()).unwrap_or("..");
        let hub_root = resolve_member(base, rel);
        let hub_exists = hub_root.join(".cooldesk").join("cooldesk.json").is_file();
        if let Value::Object(map) = &mut result {
            map.insert(
                "hub".to_string(),
                json!({
                    "name": back.get("name").cloned().unwrap_or(Value::Null),
                    "path": display_path(&hub_root),
                    "repo": back.get("hubRepo").cloned().unwrap_or(Value::Null),
                    "exists": hub_exists,
                }),
            );
        }
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
                        // README (and other long-form docs) so the app can show each
                        // linked project's committed knowledge, not just the hub's.
                        "readme": one.get("readme").cloned().unwrap_or(Value::Null),
                        "architecture": one.get("architecture").cloned().unwrap_or(Value::Null),
                        "decisions": one.get("decisions").cloned().unwrap_or(Value::Null),
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

// ---------------------------------------------------------------------------
// Linking (write path)
//
// The rest of this module is read-only by design — the plugin/AI authors
// `.cooldesk/`. Linking is the one exception: it is a small, well-defined
// mutation the user performs from the file manager, and it writes exactly what
// `/cd-link` writes, so a group authored either way is identical:
//
//   hub    -> `.cooldesk/group.json`  (star model: the hub owns the member list)
//   member -> a single `group` back-pointer in its `.cooldesk/cooldesk.json`
//
// Nothing else is touched — in particular never the machine-owned `auto` block.
// ---------------------------------------------------------------------------

/// Pretty-print JSON the way the plugin does (2-space indent, trailing newline)
/// and write it atomically, so an interrupted write can't truncate a committed
/// manifest.
fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let mut body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    body.push('\n');
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("rename {}: {e}", path.display()))
}

/// Slugify a project name for a group id: "CoolDesk App" -> "cooldesk-app".
fn kebab(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Relative path from `base` to `target`, POSIX-style ("../sibling"), so a group
/// survives being cloned somewhere else. Falls back to an absolute path when the
/// two live on different roots (different drive letters on Windows).
fn relative_path(base: &Path, target: &Path) -> String {
    let b = fs::canonicalize(base).unwrap_or_else(|_| base.to_path_buf());
    let t = fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf());
    if b == t {
        return ".".to_string();
    }
    let bc: Vec<_> = b.components().collect();
    let tc: Vec<_> = t.components().collect();
    let shared = bc.iter().zip(tc.iter()).take_while(|(x, y)| x == y).count();
    if shared == 0 {
        return display_path(&t); // different drive/root — relative is impossible
    }
    let mut parts: Vec<String> = vec!["..".to_string(); bc.len() - shared];
    parts.extend(
        tc[shared..]
            .iter()
            .map(|c| c.as_os_str().to_string_lossy().to_string()),
    );
    parts.join("/")
}

/// A project's git remote, the canonical fallback when a relative path doesn't
/// resolve on someone else's machine. `None` when there is no remote.
fn git_remote(root: &Path) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(root)
        .output()
        .ok()?;
    let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if url.is_empty() {
        None
    } else {
        Some(url)
    }
}

/// The project's declared name, falling back to its folder name.
fn project_name(root: &Path) -> String {
    read_one(root)
        .get("manifest")
        .and_then(|m| m.get("project"))
        .and_then(|p| p.get("name"))
        .and_then(|n| n.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            root.file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default()
        })
}

/// Link `member_path` into `hub_path`'s group (star model, `/cd-link` semantics).
///
/// Creates `group.json` seeded with the hub itself when absent, appends the
/// member (deduped by resolved path), and writes the member's back-pointer.
/// Returns the refreshed workspace for the hub.
pub fn link_project(hub_path: &str, member_path: &str) -> Result<Value, String> {
    let hub = Path::new(hub_path);
    let member = Path::new(member_path);
    if !hub.join(".cooldesk").join("cooldesk.json").is_file() {
        return Err("This project has no .cooldesk/cooldesk.json — run /cd-init first".into());
    }
    if !member.is_dir() {
        return Err(format!("No such folder: {member_path}"));
    }
    let hub_c = fs::canonicalize(hub).unwrap_or_else(|_| hub.to_path_buf());
    let member_c = fs::canonicalize(member).unwrap_or_else(|_| member.to_path_buf());
    if hub_c == member_c {
        return Err("A project can't be linked to itself".into());
    }

    let hub_name = project_name(hub);
    let group_file = hub.join(".cooldesk").join("group.json");

    // 1. Load or seed group.json (the hub is always its own first member).
    let mut doc: Value = fs::read_to_string(&group_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| {
            json!({
                "schemaVersion": 1,
                "group": {
                    "id": format!("{}-suite", kebab(&hub_name)),
                    "name": format!("{hub_name} Suite"),
                },
                "members": [{
                    "name": kebab(&hub_name),
                    "path": ".",
                    "repo": git_remote(hub),
                }],
            })
        });

    let group_name = doc
        .get("group")
        .and_then(|g| g.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or(&hub_name)
        .to_string();

    // 2. Append the member, skipping duplicates by *resolved* path — the same
    //    folder can be named by many different relative strings.
    let members = doc
        .get_mut("members")
        .and_then(|m| m.as_array_mut())
        .ok_or("group.json has no members array")?;
    let already = members.iter().any(|m| {
        let rel = m.get("path").and_then(|p| p.as_str()).unwrap_or(".");
        resolve_member(hub, rel) == member_c
    });
    if !already {
        members.push(json!({
            "name": kebab(&project_name(member)),
            "path": relative_path(hub, member),
            "repo": git_remote(member),
        }));
    }
    write_json(&group_file, &doc)?;

    // 3. Back-pointer in the member's own manifest — one link home, never to
    //    sibling members. Skipped when the target isn't a cooldesk project yet.
    let member_manifest = member.join(".cooldesk").join("cooldesk.json");
    if let Ok(s) = fs::read_to_string(&member_manifest) {
        if let Ok(mut m) = serde_json::from_str::<Value>(&s) {
            if let Value::Object(map) = &mut m {
                map.insert(
                    "group".to_string(),
                    json!({
                        "name": group_name,
                        "hub": relative_path(member, hub),
                        "hubRepo": git_remote(hub),
                    }),
                );
                write_json(&member_manifest, &m)?;
            }
        }
    }

    Ok(read_cooldesk(hub_path))
}

/// Drop a member from the hub's group and remove its back-pointer.
pub fn unlink_project(hub_path: &str, member_path: &str) -> Result<Value, String> {
    let hub = Path::new(hub_path);
    let member = Path::new(member_path);
    let member_c = fs::canonicalize(member).unwrap_or_else(|_| member.to_path_buf());
    let group_file = hub.join(".cooldesk").join("group.json");
    let mut doc: Value = fs::read_to_string(&group_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or("This project has no group.json")?;

    if let Some(members) = doc.get_mut("members").and_then(|m| m.as_array_mut()) {
        members.retain(|m| {
            let rel = m.get("path").and_then(|p| p.as_str()).unwrap_or(".");
            // Keep the hub's own entry (".") regardless.
            rel == "." || resolve_member(hub, rel) != member_c
        });
    }
    write_json(&group_file, &doc)?;

    let member_manifest = member.join(".cooldesk").join("cooldesk.json");
    if let Ok(s) = fs::read_to_string(&member_manifest) {
        if let Ok(mut m) = serde_json::from_str::<Value>(&s) {
            if let Value::Object(map) = &mut m {
                map.remove("group");
                write_json(&member_manifest, &m)?;
            }
        }
    }

    Ok(read_cooldesk(hub_path))
}

#[cfg(test)]
mod link_tests {
    use super::*;

    /// Build two throwaway `.cooldesk` projects under a unique temp dir.
    fn scratch(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("cooldesk-link-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let hub = root.join("alpha");
        let member = root.join("beta");
        for (dir, id, name) in [(&hub, "alpha", "Alpha App"), (&member, "beta", "Beta Service")] {
            fs::create_dir_all(dir.join(".cooldesk")).unwrap();
            fs::write(
                dir.join(".cooldesk").join("cooldesk.json"),
                format!(
                    r#"{{"schemaVersion":1,"project":{{"id":"{id}","name":"{name}","status":"active"}}}}"#
                ),
            )
            .unwrap();
        }
        (root, hub, member)
    }

    fn read(path: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn link_seeds_group_and_writes_back_pointer() {
        let (root, hub, member) = scratch("seed");

        link_project(&hub.to_string_lossy(), &member.to_string_lossy()).unwrap();

        // Hub owns the member list, seeded with itself first.
        let group = read(&hub.join(".cooldesk").join("group.json"));
        assert_eq!(group["schemaVersion"], 1);
        assert_eq!(group["group"]["id"], "alpha-app-suite");
        assert_eq!(group["group"]["name"], "Alpha App Suite");
        let members = group["members"].as_array().unwrap();
        assert_eq!(members.len(), 2);
        assert_eq!(members[0]["path"], ".");
        assert_eq!(members[1]["name"], "beta-service");
        // Relative + POSIX so the group survives a clone elsewhere.
        assert_eq!(members[1]["path"], "../beta");

        // Member carries exactly one back-pointer home, and keeps its own data.
        let m = read(&member.join(".cooldesk").join("cooldesk.json"));
        assert_eq!(m["group"]["name"], "Alpha App Suite");
        assert_eq!(m["group"]["hub"], "../alpha");
        assert_eq!(m["project"]["id"], "beta");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn linking_twice_does_not_duplicate() {
        let (root, hub, member) = scratch("dupe");
        let h = hub.to_string_lossy().to_string();

        link_project(&h, &member.to_string_lossy()).unwrap();
        // Same folder named a different way must still dedupe (resolved path).
        let indirect = hub.join("..").join("beta");
        link_project(&h, &indirect.to_string_lossy()).unwrap();

        let group = read(&hub.join(".cooldesk").join("group.json"));
        assert_eq!(group["members"].as_array().unwrap().len(), 2);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unlink_removes_member_and_back_pointer_but_keeps_hub() {
        let (root, hub, member) = scratch("unlink");
        let h = hub.to_string_lossy().to_string();
        let m = member.to_string_lossy().to_string();

        link_project(&h, &m).unwrap();
        unlink_project(&h, &m).unwrap();

        let group = read(&hub.join(".cooldesk").join("group.json"));
        let members = group["members"].as_array().unwrap();
        assert_eq!(members.len(), 1, "hub's own entry survives");
        assert_eq!(members[0]["path"], ".");

        let mm = read(&member.join(".cooldesk").join("cooldesk.json"));
        assert!(mm.get("group").is_none(), "back-pointer removed");
        assert_eq!(mm["project"]["id"], "beta", "member's own data untouched");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn member_reports_a_resolved_way_back_to_its_hub() {
        let (root, hub, member) = scratch("backlink");
        link_project(&hub.to_string_lossy(), &member.to_string_lossy()).unwrap();

        // Reading the *member* must surface the hub, resolved to an absolute
        // path — otherwise a member knows it's in a group but not where.
        let m = read_cooldesk(&member.to_string_lossy());
        assert_eq!(m["hub"]["name"], "Alpha App Suite");
        assert_eq!(m["hub"]["exists"], true);
        assert!(
            m["hub"]["path"].as_str().unwrap().ends_with("alpha"),
            "hub path resolves to the hub folder, got {:?}",
            m["hub"]["path"]
        );
        // A member owns no group.json, so it must not claim to be a hub.
        assert!(m.get("group").is_none() || m["group"].is_null());

        // The hub itself has no back-pointer — it's the root of the star.
        let h = read_cooldesk(&hub.to_string_lossy());
        assert!(h.get("hub").is_none());
        assert_eq!(h["group"]["name"], "Alpha App Suite");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_self_link_and_non_project_hub() {
        let (root, hub, _member) = scratch("reject");
        let h = hub.to_string_lossy().to_string();

        assert!(link_project(&h, &h).is_err(), "self-link refused");

        let plain = root.join("not-a-project");
        fs::create_dir_all(&plain).unwrap();
        assert!(
            link_project(&plain.to_string_lossy(), &h).is_err(),
            "hub without cooldesk.json refused"
        );

        let _ = fs::remove_dir_all(root);
    }
}
