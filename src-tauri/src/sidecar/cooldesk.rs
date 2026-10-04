//! Reads a project's committed `.cooldesk/` workspace folder — the shared project
//! knowledge authored by the CoolDesk Claude Code plugin — into a single JSON blob for
//! the desktop app to render (dock, todos, decisions, README).
//!
//! Mostly read-only: the plugin/AI owns authoring `.cooldesk/`, and it is committed to
//! the project's git repo. The app writes in exactly two places — project linking
//! (`group.json`, see `link_project`) and resources (`update_resources`):
//!
//!   shared   `cooldesk.json` → `resources`   committed; portable items only (web
//!            urls, paths relative to the repo) — what teammates get on pull.
//!   personal `local/resources.json`          gitignored via `.cooldesk/.gitignore`;
//!            local file paths, items found in the user's own tabs/history.
//!
//! Personal data is never written unless `local/` is verifiably ignored.
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

    // Contents of `notes/*.md|*.txt` — the app renders them read-only next to the
    // README. Capped so one huge or runaway file can't bloat every panel fetch.
    let read_notes = || -> Vec<Value> {
        const MAX_NOTES: usize = 50;
        const MAX_BYTES: u64 = 256 * 1024;
        let mut out = vec![];
        for name in list_dir("notes") {
            if out.len() >= MAX_NOTES {
                break;
            }
            let lower = name.to_lowercase();
            if !(lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt")) {
                continue;
            }
            let path = root.join("notes").join(&name);
            let too_big = fs::metadata(&path).map(|m| !m.is_file() || m.len() > MAX_BYTES).unwrap_or(true);
            if too_big {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                out.push(json!({ "name": name, "content": content }));
            }
        }
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
        "notes": read_notes(),
        // Personal, gitignored resources (see update_resources).
        "local": read_json("local/resources.json"),
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
                        "notes": one.get("notes").cloned().unwrap_or(Value::Null),
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
// Discovery
//
// Reading a `.cooldesk/` folder requires already knowing where it is. Until this
// existed the app only ever learned that from the plugin's `/cooldesk/announce`
// — which means a repo that was initialised while the app was closed (or on
// another machine, or before a reinstall) stayed invisible forever. This walks
// the usual places projects live and reports every `.cooldesk/` it finds, so the
// app can surface them as workspaces without waiting for a plugin hook to fire.
// ---------------------------------------------------------------------------

/// Folders that never contain a project root but are expensive to walk.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "vendor",
    "coverage",
    "__pycache__",
    "venv",
    "appdata",
    "application data",
    "$recycle.bin",
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "library", // macOS
];

/// Upper bound on directories visited per scan. A pathological home folder must
/// not turn app start into a disk crawl; hitting this just truncates results.
const SCAN_BUDGET: usize = 40_000;

/// Home-relative folders people keep code in. The home dir itself is scanned too
/// (at a shallower depth), so this list only buys extra depth where it pays off.
fn default_roots() -> Vec<PathBuf> {
    let home = dirs_home();
    let Some(home) = home else { return vec![] };
    let mut roots = vec![home.clone()];
    for name in [
        "projects",
        "Projects",
        "dev",
        "Dev",
        "code",
        "Code",
        "src",
        "source",
        "repos",
        "Repos",
        "work",
        "git",
        "Desktop",
        "Documents",
        "Documents/GitHub",
        "OneDrive/Documents",
    ] {
        let p = home.join(name);
        if p.is_dir() {
            roots.push(p);
        }
    }
    roots
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
}

fn should_skip(name: &str) -> bool {
    // Dot-folders are config, caches and VCS internals — never project roots.
    // `.cooldesk` itself is probed directly, never descended into.
    name.starts_with('.') || SKIP_DIRS.contains(&name.to_lowercase().as_str())
}

/// Depth-first walk collecting project roots (canonical paths) into `found`.
fn walk(dir: &Path, depth_left: usize, budget: &mut usize, found: &mut Vec<PathBuf>) {
    if *budget == 0 {
        return;
    }
    *budget -= 1;

    if dir.join(".cooldesk").join("cooldesk.json").is_file() {
        found.push(dir.to_path_buf());
        // Keep descending: a monorepo hub can own member projects in subfolders.
    }
    if depth_left == 0 {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if should_skip(name) {
            continue;
        }
        walk(&entry.path(), depth_left - 1, budget, found);
    }
}

/// Find every `.cooldesk/` project under the given roots (or the default dev
/// folders when none are given) and return an identity summary for each.
///
/// Deliberately shallow: only the manifest's `project` block plus group role,
/// which is all the app needs to decide "is this a workspace I should show?".
/// The full read still goes through `read_cooldesk` for whichever one is opened.
pub fn discover_projects(extra_roots: &[String], depth: usize) -> Value {
    let started = std::time::Instant::now();
    let mut budget = SCAN_BUDGET;
    let mut found: Vec<PathBuf> = vec![];

    let mut roots: Vec<PathBuf> = extra_roots
        .iter()
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .collect();
    roots.extend(default_roots());

    // The home dir is broad and shallow; explicit dev roots earn full depth.
    let home = dirs_home();
    for root in &roots {
        let d = if Some(root) == home.as_ref() { 2 } else { depth };
        walk(root, d, &mut budget, &mut found);
    }

    // Roots overlap by design (home contains ~/projects), so dedupe by resolved
    // path — the same project reached two ways must appear once.
    let mut seen = std::collections::HashSet::new();
    let mut projects = vec![];
    for root in found {
        let canonical = fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
        if !seen.insert(canonical.clone()) {
            continue;
        }
        let one = read_one(&root);
        if one.get("exists").and_then(|v| v.as_bool()) != Some(true) {
            continue;
        }
        let manifest = one.get("manifest");
        projects.push(json!({
            "path": display_path(&canonical),
            "name": project_name(&root),
            "project": manifest.and_then(|m| m.get("project")).cloned().unwrap_or(Value::Null),
            // Group role, so the app can prefer hubs when presenting a suite.
            "isHub": root.join(".cooldesk").join("group.json").is_file(),
            "group": manifest.and_then(|m| m.get("group")).cloned().unwrap_or(Value::Null),
        }));
    }

    json!({
        "projects": projects,
        "scanned": SCAN_BUDGET - budget,
        "truncated": budget == 0,
        "ms": started.elapsed().as_millis() as u64,
    })
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

/// Where a resource is stored. See the module docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceScope {
    Local,
    Shared,
}

/// Dedupe key for a resource: its url or path, case-folded, trailing slash dropped.
fn resource_key(r: &Value) -> Option<String> {
    let raw = r
        .get("url")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| r.get("path").and_then(|v| v.as_str()))?;
    let k = raw.trim().trim_end_matches(['/', '\\']).to_lowercase();
    (!k.is_empty()).then_some(k)
}

/// Is this a machine-specific location that must never reach a committed file?
/// Absolute paths (`/Users/..`, `C:\..`, `\\server`), `~`, and `file:` urls.
fn is_machine_specific(s: &str) -> bool {
    let t = s.trim();
    let lower = t.to_lowercase();
    lower.starts_with("file:")
        || t.starts_with('/')
        || t.starts_with('\\')
        || t.starts_with('~')
        || (t.len() >= 3 && t.as_bytes()[1] == b':' && t.as_bytes()[0].is_ascii_alphabetic())
}

/// Keep only the fields a resource is allowed to carry, and check it fits `scope`.
fn sanitize_resource(raw: &Value, scope: ResourceScope) -> Result<Value, String> {
    let get = |k: &str| raw.get(k).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());
    let url = get("url");
    let path = get("path");
    if url.is_none() && path.is_none() {
        return Err("resource needs a url or a path".into());
    }
    if let Some(u) = url {
        let lower = u.to_lowercase();
        let web = lower.starts_with("http://") || lower.starts_with("https://");
        // Shared: web links only (a relative file belongs in `path`). Personal may
        // also hold file: urls, but never script/data schemes.
        let ok = web || (scope == ResourceScope::Local && lower.starts_with("file:"));
        if !ok {
            return Err(format!("unsupported url: {u}"));
        }
    }
    if scope == ResourceScope::Shared {
        for v in [url, path].into_iter().flatten() {
            if is_machine_specific(v) {
                return Err(format!(
                    "{v} is a local path — save it as personal, or use a path relative to the project"
                ));
            }
        }
        if path.is_some_and(|p| p.split(['/', '\\']).any(|seg| seg == "..")) {
            return Err("shared paths must stay inside the project".into());
        }
    }
    let kind = get("type").unwrap_or(if url.is_some() { "link" } else { "file" });
    let mut out = serde_json::Map::new();
    out.insert("type".into(), json!(kind));
    out.insert("name".into(), json!(get("name").or(url).or(path).unwrap_or_default()));
    if let Some(u) = url {
        out.insert("url".into(), json!(u));
    }
    if let Some(p) = path {
        out.insert("path".into(), json!(p));
    }
    // Provenance is useful locally ("found in history"); in a shared manifest it
    // would just leak how one person found the link.
    if scope == ResourceScope::Local {
        if let Some(src) = get("source") {
            out.insert("source".into(), json!(src));
        }
        out.insert("addedAt".into(), json!(chrono_millis()));
    }
    Ok(Value::Object(out))
}

fn chrono_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Make sure `.cooldesk/local/` is ignored by git before anything personal is
/// written there: append `local/` to `.cooldesk/.gitignore` if it is missing, then
/// ask git itself. Refuses (rather than writing) if files under `local/` are
/// already tracked — a .gitignore line doesn't untrack them, so the next commit
/// would still publish them.
fn ensure_local_ignored(project_root: &Path) -> Result<PathBuf, String> {
    let cd = project_root.join(".cooldesk");
    let gi = cd.join(".gitignore");
    let current = fs::read_to_string(&gi).unwrap_or_default();
    let has = current
        .lines()
        .map(str::trim)
        .any(|l| matches!(l, "local" | "local/" | "/local" | "/local/" | "local/*" | "/local/*"));
    if !has {
        let mut body = current;
        if !body.is_empty() && !body.ends_with('\n') {
            body.push('\n');
        }
        body.push_str("# Personal — never committed (CoolDesk writes local file paths and\n# browsing-derived links here).\nlocal/\n");
        fs::write(&gi, body).map_err(|e| format!("write {}: {e}", gi.display()))?;
    }

    let local = cd.join("local");
    fs::create_dir_all(&local).map_err(|e| format!("create {}: {e}", local.display()))?;

    // Only meaningful inside a git work tree; no git (or not a repo) means there
    // is nothing that could commit the file.
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .current_dir(project_root)
            .output()
            .ok()
            .filter(|o| o.status.success())
    };
    if git(&["rev-parse", "--is-inside-work-tree"]).is_some() {
        if let Some(out) = git(&["ls-files", "--", ".cooldesk/local"]) {
            if !String::from_utf8_lossy(&out.stdout).trim().is_empty() {
                return Err("files in .cooldesk/local/ are already committed — run `git rm -r --cached .cooldesk/local` first so personal data stays out of git".into());
            }
        }
        if git(&["check-ignore", "-q", ".cooldesk/local/resources.json"]).is_none() {
            return Err(".cooldesk/local/ is not ignored by git (a negation rule may override it) — refusing to write personal data there".into());
        }
    }
    Ok(local)
}

/// Add and/or remove resources in one project's shared manifest or personal list.
/// `remove` takes urls or paths. Returns the re-read `.cooldesk/` on success.
pub fn update_resources(
    project_path: &str,
    scope: ResourceScope,
    add: &[Value],
    remove: &[String],
) -> Result<Value, String> {
    let root = Path::new(project_path);
    let manifest_path = root.join(".cooldesk").join("cooldesk.json");
    if !manifest_path.is_file() {
        return Err(format!("{} has no .cooldesk/cooldesk.json", root.display()));
    }

    // Validate everything before touching disk — all or nothing.
    let clean: Vec<Value> = add
        .iter()
        .map(|r| sanitize_resource(r, scope))
        .collect::<Result<_, _>>()?;

    let (file, mut doc) = match scope {
        ResourceScope::Shared => {
            let doc: Value = serde_json::from_str(&fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("cooldesk.json is not valid JSON: {e}"))?;
            (manifest_path, doc)
        }
        ResourceScope::Local => {
            let file = ensure_local_ignored(root)?.join("resources.json");
            let doc = fs::read_to_string(&file)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .filter(|v| v.is_object())
                .unwrap_or_else(|| json!({ "resources": [] }));
            (file, doc)
        }
    };

    let obj = doc.as_object_mut().ok_or("resource file is not a JSON object")?;
    let list = obj.entry("resources").or_insert_with(|| json!([]));
    if !list.is_array() {
        *list = json!([]);
    }
    let arr = list.as_array_mut().unwrap();

    let drop: std::collections::HashSet<String> = remove
        .iter()
        .map(|r| r.trim().trim_end_matches(['/', '\\']).to_lowercase())
        .collect();
    arr.retain(|r| resource_key(r).map_or(true, |k| !drop.contains(&k)));

    for r in clean {
        let key = resource_key(&r);
        if key.is_some() && arr.iter().any(|x| resource_key(x) == key) {
            continue; // already there
        }
        arr.push(r);
    }

    write_json(&file, &doc)?;
    Ok(read_cooldesk(project_path))
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
    #[ignore = "manual: scans the real machine"]
    fn discovery_real_machine() {
        let out = discover_projects(&[], 4);
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    }

    #[test]
    fn discovery_finds_projects_and_skips_noise() {
        let (root, hub, _member) = scratch("discover");
        // Nested project: a monorepo member must still be found.
        let nested = hub.join("packages").join("api");
        fs::create_dir_all(nested.join(".cooldesk")).unwrap();
        fs::write(
            nested.join(".cooldesk").join("cooldesk.json"),
            r#"{"schemaVersion":1,"project":{"id":"api","name":"API"}}"#,
        )
        .unwrap();
        // Noise that must never be walked into or reported.
        fs::create_dir_all(root.join("node_modules").join("pkg").join(".cooldesk")).unwrap();
        fs::write(
            root.join("node_modules").join("pkg").join(".cooldesk").join("cooldesk.json"),
            r#"{"schemaVersion":1,"project":{"id":"nope","name":"Nope"}}"#,
        )
        .unwrap();

        let out = discover_projects(&[root.to_string_lossy().to_string()], 4);
        let names: Vec<&str> = out["projects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["name"].as_str().unwrap())
            .collect();

        assert!(names.contains(&"Alpha App"), "hub found, got {names:?}");
        assert!(names.contains(&"Beta Service"), "sibling found, got {names:?}");
        assert!(names.contains(&"API"), "nested project found, got {names:?}");
        assert!(!names.contains(&"Nope"), "node_modules skipped, got {names:?}");

        // Overlapping roots must not produce the same project twice.
        let dupe = discover_projects(
            &[
                root.to_string_lossy().to_string(),
                hub.to_string_lossy().to_string(),
            ],
            4,
        );
        let paths: Vec<&str> = dupe["projects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["path"].as_str().unwrap())
            .collect();
        let mut uniq = paths.clone();
        uniq.sort_unstable();
        uniq.dedup();
        assert_eq!(paths.len(), uniq.len(), "duplicate roots deduped, got {paths:?}");

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


#[cfg(test)]
mod resource_tests {
    use super::*;

    fn project(tag: &str, git: bool) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cd-res-{tag}-{}", chrono_millis()));
        fs::create_dir_all(dir.join(".cooldesk")).unwrap();
        fs::write(dir.join(".cooldesk/cooldesk.json"), r#"{"schemaVersion":1,"project":{"id":"p","name":"P"},"resources":[]}"#).unwrap();
        if git {
            std::process::Command::new("git").args(["init", "-q"]).current_dir(&dir).status().unwrap();
        }
        dir
    }

    #[test]
    fn local_write_adds_gitignore_and_is_ignored() {
        let dir = project("local", true);
        let p = dir.to_string_lossy().to_string();
        let res = update_resources(&p, ResourceScope::Local, &[json!({"path":"/Users/me/spec.pdf","source":"history"})], &[]).unwrap();
        assert_eq!(res["local"]["resources"][0]["path"], "/Users/me/spec.pdf");
        assert!(fs::read_to_string(dir.join(".cooldesk/.gitignore")).unwrap().contains("local/"));
        let ignored = std::process::Command::new("git")
            .args(["check-ignore", "-q", ".cooldesk/local/resources.json"])
            .current_dir(&dir).status().unwrap().success();
        assert!(ignored);
        // dedupe
        update_resources(&p, ResourceScope::Local, &[json!({"path":"/Users/me/spec.pdf/"})], &[]).unwrap();
        let again = read_cooldesk(&p);
        assert_eq!(again["local"]["resources"].as_array().unwrap().len(), 1);
        // remove
        let gone = update_resources(&p, ResourceScope::Local, &[], &["/users/me/spec.pdf".into()]).unwrap();
        assert_eq!(gone["local"]["resources"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn shared_rejects_machine_paths_and_keeps_portable_ones() {
        let dir = project("shared", false);
        let p = dir.to_string_lossy().to_string();
        for bad in ["/Users/me/x", "C:\\x", "file:///x", "~/x", "../other"] {
            assert!(update_resources(&p, ResourceScope::Shared, &[json!({"path": bad})], &[]).is_err(), "{bad}");
        }
        assert!(update_resources(&p, ResourceScope::Shared, &[json!({"url":"javascript:alert(1)"})], &[]).is_err());
        let ok = update_resources(&p, ResourceScope::Shared, &[json!({"url":"https://docs.rs","name":"Docs","source":"history"}), json!({"path":"docs/spec.md"})], &[]).unwrap();
        let arr = ok["manifest"]["resources"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert!(arr[0].get("source").is_none(), "provenance must not reach the shared manifest");
    }

    #[test]
    fn refuses_when_local_is_tracked() {
        let dir = project("tracked", true);
        fs::create_dir_all(dir.join(".cooldesk/local")).unwrap();
        fs::write(dir.join(".cooldesk/local/resources.json"), "{}").unwrap();
        std::process::Command::new("git").args(["add", "-f", ".cooldesk/local/resources.json"]).current_dir(&dir).status().unwrap();
        let p = dir.to_string_lossy().to_string();
        let err = update_resources(&p, ResourceScope::Local, &[json!({"url":"https://a.b"})], &[]).unwrap_err();
        assert!(err.contains("already committed"), "{err}");
    }
}
