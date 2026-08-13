//! Run a terminal-based AI CLI (Claude Code, opencode, …) and stream its output
//! back to the UI.
//!
//! This is deliberately not `run_project_command`: that one spawns a *visible*
//! console with `cmd /k` and never sees the output again, which is right for
//! "start the dev server" and useless for "ask the agent something and read the
//! answer". Here the process is headless, stdout and stderr are streamed line by
//! line as Tauri events, and the frontend reassembles them.
//!
//! Nothing about this module knows which CLI it is running. The adapter (binary
//! name, argument template, whether the prompt goes on argv or stdin) is chosen
//! in JS and passed in, so a CLI nobody has thought of yet works by adding a
//! config entry rather than Rust.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

lazy_static::lazy_static! {
    /// Live runs, so a slow agent can be cancelled from the UI.
    static ref RUNNING: Mutex<HashMap<String, Child>> = Mutex::new(HashMap::new());

    /// PATH as the user's login shell would build it, computed once and cached.
    ///
    /// A macOS (or Linux) app launched from Finder/Dock/Spotlight is a child of
    /// launchd, not of a shell, so it only inherits launchd's minimal PATH
    /// (`/usr/bin:/bin:/usr/sbin:/sbin` plus a couple of Apple entries). Every
    /// directory a user adds themselves — nvm, a Homebrew prefix, `~/.local/bin`
    /// where `npm install -g` and plenty of installers put things — is added by
    /// `.zshrc`/`.zprofile`, which nothing but an interactive login shell ever
    /// sources. Windows has no equivalent gap: PATH there is a registry-wide
    /// environment variable every process inherits, which is why this only
    /// shows up on macOS/Linux ("works on Windows, not on Mac").
    #[cfg(not(target_os = "windows"))]
    static ref ENRICHED_PATH: String = compute_enriched_path();
}

/// Ask `$SHELL -ilc` for its PATH and merge it in front of launchd's, so
/// directories a dotfile adds win over the bare-bones default without losing
/// anything already present. Run on a side thread with a timeout: an rc file
/// that hangs (network mount, slow `nvm`/`conda` init) must not freeze the
/// whole app on first launch — it just falls back to whatever PATH we started
/// with.
#[cfg(not(target_os = "windows"))]
fn compute_enriched_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = std::process::Command::new(&shell)
            .args(["-ilc", "echo -n \"$PATH\""])
            .output();
        let _ = tx.send(result);
    });

    let shell_path = rx
        .recv_timeout(std::time::Duration::from_secs(3))
        .ok()
        .and_then(|r| r.ok())
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    match shell_path {
        Some(shell_path) => merge_paths(&shell_path, &current),
        None => current,
    }
}

/// Concatenate two PATHs, keeping first occurrence order (`a` wins ties).
#[cfg(not(target_os = "windows"))]
fn merge_paths(a: &str, b: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for dir in std::env::split_paths(a).chain(std::env::split_paths(b)) {
        if seen.insert(dir.clone()) {
            out.push(dir);
        }
    }
    std::env::join_paths(out)
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|_| a.to_string())
}

#[derive(Debug, Clone, Serialize)]
struct OutputEvent {
    id: String,
    /// "stdout" | "stderr"
    stream: String,
    line: String,
}

#[derive(Debug, Clone, Serialize)]
struct DoneEvent {
    id: String,
    code: Option<i32>,
    /// Set when the process could not be started or was killed.
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AiCliSpec {
    /// Executable name or absolute path, e.g. "claude" or "opencode".
    pub bin: String,
    /// Fully-resolved arguments. The JS adapter has already substituted the
    /// prompt if this CLI takes it on argv.
    pub args: Vec<String>,
    /// Prompt to write to the child's stdin, if this CLI reads it there.
    /// Preferred over argv: prompts carry newlines and quotes, and every shell
    /// and CLI disagrees about how those survive an argument.
    pub stdin: Option<String>,
    /// Working directory — the project folder, so a repo-aware agent has context.
    pub cwd: Option<String>,
}

/// Resolve an executable against PATH, honouring Windows' executable extensions.
///
/// `Command::new("claude")` fails on Windows when the CLI was installed by npm,
/// and the reason is worth spelling out because the obvious fix is wrong.
///
/// npm writes *three* shims side by side into its bin directory:
///
///   claude       — an extensionless sh script, for Git Bash / Cygwin
///   claude.cmd   — a batch shim, what cmd.exe and PowerShell actually run
///   claude.ps1   — a PowerShell shim
///
/// Only the `.cmd` is startable from Win32. Trying the bare name first — which
/// is the natural thing to write, and what this function used to do — lands on
/// the sh script, and `CreateProcess` rejects it with os error 193, "not a
/// valid Win32 application". So on Windows the PATHEXT candidates must be
/// tried across *every* PATH directory before the bare name is considered at
/// all; a per-directory preference isn't enough, because the sh script and the
/// batch shim live in the same directory.
fn resolve_bin(bin: &str) -> String {
    let p = std::path::Path::new(bin);
    if p.is_absolute() || bin.contains('/') || bin.contains('\\') {
        return bin.to_string();
    }

    #[cfg(target_os = "windows")]
    let path = std::env::var("PATH").ok();
    #[cfg(not(target_os = "windows"))]
    let path = Some(ENRICHED_PATH.clone());

    let Some(path) = path else {
        return bin.to_string();
    };
    let dirs: Vec<_> = std::env::split_paths(&path).collect();

    #[cfg(target_os = "windows")]
    {
        let exts: Vec<String> = std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|e| !e.is_empty())
            .map(|e| e.to_ascii_lowercase())
            .collect();

        // Pass 1: anything Windows considers executable, in PATHEXT order.
        for dir in &dirs {
            for ext in &exts {
                let candidate = dir.join(format!("{}{}", bin, ext));
                if candidate.is_file() {
                    return candidate.to_string_lossy().into_owned();
                }
            }
        }
        // Pass 2: a bare file, last resort. Probably a shell script we cannot
        // start, but a clear "not a valid Win32 application" beats "not found".
        for dir in &dirs {
            let direct = dir.join(bin);
            if direct.is_file() {
                return direct.to_string_lossy().into_owned();
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        for dir in &dirs {
            let direct = dir.join(bin);
            if direct.is_file() {
                return direct.to_string_lossy().into_owned();
            }
        }
    }

    // Not found — hand the bare name to the OS and let it produce the error.
    bin.to_string()
}

/// True if the named CLI can be found on PATH. Lets the UI list only the
/// adapters that would actually run instead of failing at the first prompt.
#[tauri::command]
pub fn ai_cli_detect(bins: Vec<String>) -> HashMap<String, bool> {
    bins.into_iter()
        .map(|b| {
            let resolved = resolve_bin(&b);
            let found = resolved != b || std::path::Path::new(&resolved).is_file();
            (b, found)
        })
        .collect()
}

/// Forward one pipe to the UI, a line at a time.
///
/// A generic fn rather than a closure: stdout and stderr are different types,
/// and a closure would be monomorphised to whichever one called it first.
async fn pump<R>(reader: Option<R>, stream: &'static str, app: AppHandle, id: String)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let Some(reader) = reader else { return };
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = app.emit(
            "ai-cli-output",
            OutputEvent {
                id: id.clone(),
                stream: stream.to_string(),
                line,
            },
        );
    }
}

/// Is this a shell script rather than a real executable?
///
/// `CreateProcess` — which is all `Command::spawn` does — can only start PE
/// images. Handed a `.cmd` it fails with os error 193, "not a valid Win32
/// application". That is exactly what npm-installed CLIs are: `claude` on PATH
/// is `claude.cmd`, a batch shim around node. Those have to go through cmd.exe.
#[cfg(target_os = "windows")]
fn is_batch(path: &str) -> bool {
    let l = path.to_ascii_lowercase();
    l.ends_with(".cmd") || l.ends_with(".bat")
}

/// Quote one argument for cmd.exe's parser.
///
/// Not the same rules as the MSVC parser `Command::arg` targets: cmd also
/// treats `&`, `|`, `<`, `>`, `^` and `()` as metacharacters, so anything
/// containing them must be quoted even when it has no spaces.
#[cfg(target_os = "windows")]
fn quote_for_cmd(s: &str) -> String {
    if s.is_empty() {
        return "\"\"".to_string();
    }
    if !s.chars().any(|c| " \t\"&|<>^()".contains(c)) {
        return s.to_string();
    }
    format!("\"{}\"", s.replace('"', "\\\""))
}

/// Spawn the CLI and stream its output. Returns as soon as the process starts;
/// completion arrives as an `ai-cli-done` event.
#[tauri::command]
pub async fn ai_cli_run(app: AppHandle, id: String, spec: AiCliSpec) -> Result<(), String> {
    let bin = resolve_bin(&spec.bin);

    #[cfg(target_os = "windows")]
    let mut cmd = if is_batch(&bin) {
        // `cmd /c "<script> <args…>"` — the outer quotes around the whole
        // command are required when the script path itself is quoted,
        // otherwise cmd strips the first and last quote of the line and the
        // path breaks apart at its spaces. Built with raw_arg so Rust's own
        // (different) quoting doesn't get applied on top. raw_arg comes from
        // tokio's Command on Windows — no CommandExt import needed.
        let mut line = String::from("/c \"");
        line.push_str(&quote_for_cmd(&bin));
        for a in &spec.args {
            line.push(' ');
            line.push_str(&quote_for_cmd(a));
        }
        line.push('"');

        let mut c = Command::new(std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()));
        c.raw_arg(line);
        c
    } else {
        let mut c = Command::new(&bin);
        c.args(&spec.args);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new(&bin);
        c.args(&spec.args);
        // Same reasoning as `resolve_bin`: this process only has launchd's
        // bare PATH, and the child needs the login shell's version too, both
        // to run at all (`claude` is a node shebang script) and to find
        // whatever it shells out to internally (git, node, ripgrep, …).
        c.env("PATH", &*ENRICHED_PATH);
        c
    };

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if spec.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });

    if let Some(dir) = spec.cwd.as_ref().filter(|d| !d.is_empty()) {
        // Same `\\?\` strip as run_project_command — the extended-length prefix
        // is valid for Win32 file APIs but not as a process working directory.
        let dir = dir.strip_prefix(r"\\?\").unwrap_or(dir);
        cmd.current_dir(dir);
    }

    // Headless: no console window should flash up on Windows. This is the whole
    // difference in intent from run_project_command, which wants a visible one.
    #[cfg(target_os = "windows")]
    {
        // tokio's Command exposes creation_flags directly on Windows.
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start `{}`: {}", spec.bin, e))?;

    if let Some(prompt) = spec.stdin {
        let mut sink = child
            .stdin
            .take()
            .ok_or_else(|| "stdin was not piped".to_string())?;
        sink.write_all(prompt.as_bytes())
            .await
            .map_err(|e| format!("Failed to write prompt: {}", e))?;
        // Dropping the handle closes stdin — without it a CLI reading to EOF
        // waits forever and the run looks hung.
        drop(sink);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Park the child so ai_cli_cancel can reach it.
    RUNNING.lock().unwrap().insert(id.clone(), child);

    let out_task = tokio::spawn(pump(stdout, "stdout", app.clone(), id.clone()));
    let err_task = tokio::spawn(pump(stderr, "stderr", app.clone(), id.clone()));

    tauri::async_runtime::spawn(async move {
        let _ = out_task.await;
        let _ = err_task.await;

        // Take the child back out to await it; if cancel got there first it is
        // already gone and the kill is what ended the streams.
        let child = RUNNING.lock().unwrap().remove(&id);
        let (code, error) = match child {
            Some(mut c) => match c.wait().await {
                Ok(status) => (status.code(), None),
                Err(e) => (None, Some(e.to_string())),
            },
            None => (None, Some("cancelled".to_string())),
        };

        let _ = app.emit("ai-cli-done", DoneEvent { id, code, error });
    });

    Ok(())
}

/// Kill a run in flight. The streams end, which drives the done event.
#[tauri::command]
pub async fn ai_cli_cancel(id: String) -> Result<(), String> {
    let child = RUNNING.lock().unwrap().remove(&id);
    if let Some(mut c) = child {
        c.kill().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
