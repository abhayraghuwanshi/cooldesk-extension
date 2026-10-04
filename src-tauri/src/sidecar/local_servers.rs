//! Live local dev servers, grouped by the project that runs them.
//!
//! The activity feed's "Local" tab used to treat every `localhost:PORT` as its
//! own app. A dev server that finds its port taken (Vite: 5173 → 5174 → …) or
//! one an AI agent starts in the background then shows up as several unrelated
//! rows, and a port that died yesterday looks the same as one that is up.
//! This answers, for each listening port: which process, which project folder
//! (the process's working directory, walked up to the project root), who
//! launched it (an AI CLI such as Claude Code, or the user), and what that
//! project's `.cooldesk/services.json` says the port is for.
//!
//! Read-only. Starting or stopping a server is a Tauri command, never an HTTP
//! route — command execution must not be reachable from a localhost socket.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalServer {
    pub port: u16,
    pub pid: u32,
    pub process: String,
    /// The process's working directory. None where the OS won't say (Windows).
    pub cwd: Option<String>,
    /// Project root the cwd belongs to (nearest `.cooldesk/` or `.git` ancestor).
    pub project_root: Option<String>,
    /// An AI CLI found among the process's ancestors ("claude", "codex", …).
    pub launcher: Option<String>,
    /// The matching `.cooldesk/services.json` entry's label, if this port is declared.
    pub declared_label: Option<String>,
    /// When the process started (ms since epoch). History on this port from
    /// before then belongs to whatever app held the port previously.
    pub started_at: Option<u64>,
}

/// AI CLIs whose children are flagged as agent-started.
const LAUNCHERS: &[&str] = &["claude", "codex", "opencode", "aider", "gemini", "cursor-agent"];

/// The sidecar's own port and other infrastructure that is never a dev server.
const IGNORED_PORTS: &[u16] = &[4545];

#[cfg(not(target_os = "windows"))]
fn listening() -> Vec<(u16, u32, String)> {
    // -F pcn: machine-readable records — `p<pid>`, `c<command>`, then one
    // `n<addr>:<port>` per socket. Robust to spaces in command names, unlike
    // splitting the human table.
    let Ok(out) = std::process::Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"])
        .output()
    else {
        return vec![];
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut rows = vec![];
    let mut seen = HashSet::new();
    let (mut pid, mut cmd) = (0u32, String::new());
    for line in text.lines() {
        let (tag, rest) = line.split_at(line.len().min(1));
        match tag {
            "p" => pid = rest.parse().unwrap_or(0),
            "c" => cmd = rest.to_string(),
            "n" => {
                if let Some(port) = rest.rsplit_once(':').and_then(|(_, p)| p.parse::<u16>().ok()) {
                    if pid != 0 && seen.insert((port, pid)) {
                        rows.push((port, pid, cmd.clone()));
                    }
                }
            }
            _ => {}
        }
    }
    rows
}

#[cfg(target_os = "windows")]
fn listening() -> Vec<(u16, u32, String)> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let run = |cmd: &str, args: &[&str]| {
        std::process::Command::new(cmd)
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default()
    };
    let mut names = HashMap::new();
    for line in run("tasklist", &["/FO", "CSV", "/NH"]).lines() {
        let f: Vec<&str> = line.split("\",\"").collect();
        if f.len() >= 2 {
            if let Ok(pid) = f[1].trim_matches('"').parse::<u32>() {
                names.insert(pid, f[0].trim_matches('"').to_string());
            }
        }
    }
    let mut rows = vec![];
    let mut seen = HashSet::new();
    for line in run("netstat", &["-ano", "-p", "tcp"]).lines() {
        let c: Vec<&str> = line.split_whitespace().collect();
        if c.len() < 5 || !c[3].eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        let (Some(port), Ok(pid)) = (
            c[1].rsplit_once(':').and_then(|(_, p)| p.parse::<u16>().ok()),
            c[4].parse::<u32>(),
        ) else {
            continue;
        };
        if pid != 0 && seen.insert((port, pid)) {
            rows.push((port, pid, names.get(&pid).cloned().unwrap_or_default()));
        }
    }
    rows
}

/// Working directory per pid, one `lsof` call for all of them.
#[cfg(not(target_os = "windows"))]
fn cwds(pids: &[u32]) -> HashMap<u32, String> {
    let mut map = HashMap::new();
    if pids.is_empty() {
        return map;
    }
    let list = pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let Ok(out) = std::process::Command::new("lsof")
        .args(["-a", "-d", "cwd", "-F", "pn", "-p", &list])
        .output()
    else {
        return map;
    };
    let mut pid = 0u32;
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if let Some(p) = line.strip_prefix('p') {
            pid = p.parse().unwrap_or(0);
        } else if let Some(n) = line.strip_prefix('n') {
            if pid != 0 {
                map.insert(pid, n.to_string());
            }
        }
    }
    map
}

#[cfg(target_os = "windows")]
fn cwds(_pids: &[u32]) -> HashMap<u32, String> {
    HashMap::new() // another process's cwd isn't exposed without debugging APIs
}

/// `ps` elapsed time `[[dd-]hh:]mm:ss` → seconds. (`etimes` would be simpler
/// but macOS's ps doesn't have it.)
fn parse_etime(s: &str) -> Option<u64> {
    let (days, rest) = match s.split_once('-') {
        Some((d, r)) => (d.parse::<u64>().ok()?, r),
        None => (0, s),
    };
    let parts: Vec<u64> = rest.split(':').map(|p| p.parse().ok()).collect::<Option<_>>()?;
    let (h, m, sec) = match parts.as_slice() {
        [m, s] => (0, *m, *s),
        [h, m, s] => (*h, *m, *s),
        _ => return None,
    };
    Some(days * 86_400 + h * 3_600 + m * 60 + sec)
}

/// pid → (ppid, command basename, seconds running) for the whole process table.
#[cfg(not(target_os = "windows"))]
fn process_table() -> HashMap<u32, (u32, String, Option<u64>)> {
    let mut map = HashMap::new();
    let Ok(out) = std::process::Command::new("ps").args(["-A", "-o", "pid=,ppid=,etime=,comm="]).output() else {
        return map;
    };
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let mut it = line.split_whitespace();
        let (Some(pid), Some(ppid), Some(etime)) = (it.next(), it.next(), it.next()) else { continue };
        let comm: String = it.collect::<Vec<_>>().join(" ");
        let base = comm.rsplit('/').next().unwrap_or(&comm).to_string();
        if let (Ok(pid), Ok(ppid)) = (pid.parse(), ppid.parse()) {
            map.insert(pid, (ppid, base, parse_etime(etime)));
        }
    }
    map
}

#[cfg(target_os = "windows")]
fn process_table() -> HashMap<u32, (u32, String, Option<u64>)> {
    HashMap::new()
}

/// The nearest AI-CLI ancestor of `pid`, if any.
fn launcher_of(pid: u32, table: &HashMap<u32, (u32, String, Option<u64>)>) -> Option<String> {
    let mut cur = pid;
    for _ in 0..16 {
        let (ppid, _, _) = table.get(&cur)?;
        if *ppid <= 1 {
            return None;
        }
        if let Some((_, name, _)) = table.get(ppid) {
            let lower = name.to_lowercase();
            if let Some(l) = LAUNCHERS.iter().find(|l| lower == **l) {
                return Some(l.to_string());
            }
        }
        cur = *ppid;
    }
    None
}

/// Walk up from `cwd` to the project root: the nearest ancestor holding a
/// `.cooldesk/cooldesk.json`, else the nearest with `.git`, else `cwd` itself.
/// A monorepo's `web/` dev server thereby belongs to the repo, not to `web`.
fn project_root(cwd: &Path, home: Option<&Path>) -> PathBuf {
    let mut git: Option<PathBuf> = None;
    for dir in cwd.ancestors() {
        if home.is_some_and(|h| dir == h) || dir.parent().is_none() {
            break;
        }
        if dir.join(".cooldesk").join("cooldesk.json").is_file() {
            return dir.to_path_buf();
        }
        if git.is_none() && dir.join(".git").exists() {
            git = Some(dir.to_path_buf());
        }
    }
    git.unwrap_or_else(|| cwd.to_path_buf())
}

fn read_list(path: &Path, key: &str) -> Vec<Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get(key).and_then(|a| a.as_array()).cloned())
        .unwrap_or_default()
}

fn project_name(root: &Path) -> String {
    let manifest = root.join(".cooldesk").join("cooldesk.json");
    fs::read_to_string(manifest)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.pointer("/project/name").and_then(|n| n.as_str()).map(str::to_string))
        .unwrap_or_else(|| {
            root.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| root.to_string_lossy().into_owned())
        })
}

/// `.cooldesk` projects on disk that declare services — so a project that is
/// *not* running can still be recognised from its history ("you ran this on
/// :3000") and offered a Start. The disk scan is cached: the Local tab polls.
fn known_projects() -> Vec<Value> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    static CACHE: Mutex<Option<(Instant, Vec<Value>)>> = Mutex::new(None);
    if let Some((at, v)) = CACHE.lock().unwrap().as_ref() {
        if at.elapsed() < Duration::from_secs(60) {
            return v.clone();
        }
    }
    let found = crate::sidecar::cooldesk::discover_projects(&[], 4);
    let list: Vec<Value> = found["projects"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| {
            let root = PathBuf::from(p.get("path")?.as_str()?);
            let cd = root.join(".cooldesk");
            let services = read_list(&cd.join("services.json"), "services");
            if services.is_empty() {
                return None;
            }
            Some(json!({
                "root": root.to_string_lossy(),
                "name": project_name(&root),
                "hasCooldesk": true,
                "services": services,
                "commands": read_list(&cd.join("commands.json"), "commands"),
            }))
        })
        .collect();
    *CACHE.lock().unwrap() = Some((Instant::now(), list.clone()));
    list
}

/// `{ servers: [LocalServer], projects: [{ root, name, services, commands }] }`
/// — projects are those with a live server plus known `.cooldesk` projects
/// that declare services, each carrying its services and commands so the UI
/// can say "your port is 5173" and offer to start it.
pub fn local_servers() -> Value {
    let me = std::process::id();
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);

    let rows: Vec<_> = listening()
        .into_iter()
        .filter(|(port, pid, _)| *pid != me && !IGNORED_PORTS.contains(port))
        .collect();
    let pids: Vec<u32> = rows.iter().map(|r| r.1).collect::<HashSet<_>>().into_iter().collect();
    let cwd_map = cwds(&pids);
    let table = process_table();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let mut projects: HashMap<PathBuf, Value> = HashMap::new();
    let mut servers = vec![];
    for (port, pid, process) in rows {
        let cwd = cwd_map.get(&pid).cloned();
        // System daemons (AirPlay receiver on :5000/:7000, mDNS, …) run from
        // "/" — not something the user started from a project. Unknown cwd
        // (Windows) is kept: there's no way to tell, and hiding a real dev
        // server is worse than listing a system one.
        if cfg!(not(target_os = "windows")) && cwd.as_deref().map_or(true, |c| c == "/") {
            continue;
        }
        let root = cwd.as_ref().map(|c| project_root(Path::new(c), home.as_deref()));

        let mut declared_label = None;
        if let Some(root) = &root {
            let entry = projects.entry(root.clone()).or_insert_with(|| {
                let cd = root.join(".cooldesk");
                json!({
                    "root": root.to_string_lossy(),
                    "name": project_name(root),
                    "hasCooldesk": cd.join("cooldesk.json").is_file(),
                    "services": read_list(&cd.join("services.json"), "services"),
                    "commands": read_list(&cd.join("commands.json"), "commands"),
                })
            });
            declared_label = entry["services"].as_array().and_then(|svcs| {
                svcs.iter()
                    .find(|s| s.get("port").and_then(|p| p.as_u64()) == Some(port as u64))
                    .and_then(|s| s.get("label").and_then(|l| l.as_str()).map(str::to_string))
            });
        }

        servers.push(LocalServer {
            port,
            pid,
            process,
            launcher: launcher_of(pid, &table),
            started_at: table.get(&pid).and_then(|(_, _, e)| *e).map(|secs| now_ms.saturating_sub(secs * 1000)),
            project_root: root.map(|r| r.to_string_lossy().into_owned()),
            cwd,
            declared_label,
        });
    }
    servers.sort_by_key(|s| s.port);

    for p in known_projects() {
        if let Some(root) = p.get("root").and_then(|r| r.as_str()) {
            projects.entry(PathBuf::from(root)).or_insert(p);
        }
    }

    json!({
        "servers": servers,
        "projects": projects.into_values().collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_prefers_cooldesk_then_git() {
        let base = std::env::temp_dir().join(format!("cd-ls-{}", std::process::id()));
        let web = base.join("repo").join("web").join("src");
        fs::create_dir_all(&web).unwrap();
        fs::create_dir_all(base.join("repo").join(".git")).unwrap();
        assert_eq!(project_root(&web, Some(&base)), base.join("repo"));

        fs::create_dir_all(base.join("repo").join(".cooldesk")).unwrap();
        fs::write(base.join("repo/.cooldesk/cooldesk.json"), r#"{"project":{"name":"Repo"}}"#).unwrap();
        fs::create_dir_all(base.join("repo/web/.git")).unwrap(); // nested git (submodule) loses to .cooldesk
        assert_eq!(project_root(&web, Some(&base)), base.join("repo"));
        assert_eq!(project_name(&base.join("repo")), "Repo");
    }

    #[test]
    fn launcher_walks_ancestors() {
        let mut t = HashMap::new();
        t.insert(10, (9, "node".to_string(), None));
        t.insert(9, (8, "npm".to_string(), None));
        t.insert(8, (7, "zsh".to_string(), None));
        t.insert(7, (1, "claude".to_string(), None));
        assert_eq!(launcher_of(10, &t).as_deref(), Some("claude"));
        t.insert(7, (1, "Terminal".to_string(), None));
        assert_eq!(launcher_of(10, &t), None);
    }

    #[test]
    fn etime_formats() {
        assert_eq!(parse_etime("05:07"), Some(307));
        assert_eq!(parse_etime("01:02:03"), Some(3723));
        assert_eq!(parse_etime("2-01:02:03"), Some(2 * 86400 + 3723));
        assert_eq!(parse_etime("bad"), None);
    }

    /// Smoke test against this machine — prints what the endpoint would return.
    #[test]
    #[ignore]
    fn print_live() {
        println!("{}", serde_json::to_string_pretty(&local_servers()).unwrap());
    }
}
