//! Built-in terminal: a real login shell in a pseudo-terminal per Browse
//! terminal tab. The frontend (xterm.js, `features/terminal/`) draws it;
//! here we spawn the shell, pipe keystrokes in and stream output back.
//!
//! Output goes over a Tauri `Channel` as raw bytes (an ArrayBuffer in JS, no
//! JSON/base64 per chunk) and xterm decodes UTF-8 itself, so a multi-byte
//! character split across two reads is fine. When the shell exits the same
//! channel gets one JSON message, `{ "exit": code }`.
//!
//! Only CoolDesk's own UI may drive a shell: `guard_remote_webviews` already
//! rejects every app command from web content, and each command here also
//! checks the caller is the main window.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Mutex, OnceLock};
use tauri::ipc::{Channel, InvokeResponseBody};

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
}

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn require_main(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err("Terminal is only available in the main window".into())
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 }
}

/// The user's shell, started as a login shell so PATH, aliases and the
/// prompt match their own terminal (an app opened from Finder doesn't get
/// the shell profile's environment otherwise).
/// zsh startup files that load the user's own (same order, same ZDOTDIR
/// they'd normally see) and then, only if the prompt is still macOS's
/// stock `user@host dir %`, shorten it to `dir %` — the user@host part ate
/// half a narrow panel. A prompt the user set themselves is left alone —
/// except in a compact shell (the docked sidebar's, a few dozen columns
/// wide), which always gets a bare `%`: a themed prompt's path and git
/// segments wrapped every line there, and even one long folder name took a
/// third of it. The folder goes in the terminal title instead, which the
/// panel's bar shows. It's re-applied before each prompt so themes that
/// rebuild PROMPT in their own precmd (p10k, …) don't win.
/// (The same wrapper trick VS Code's terminal uses.)
const ZSH_FORWARD: &str = r#"if [[ -f "$COOLDESK_USER_ZDOTDIR/FILE" ]]; then
  COOLDESK_ZDOTDIR=$ZDOTDIR
  ZDOTDIR=$COOLDESK_USER_ZDOTDIR
  . "$COOLDESK_USER_ZDOTDIR/FILE"
  COOLDESK_USER_ZDOTDIR=$ZDOTDIR
  ZDOTDIR=$COOLDESK_ZDOTDIR
fi
"#;
const ZSH_RC_TAIL: &str = r#"[[ "$PROMPT" == '%n@%m %1~ %# ' ]] && PROMPT='%1~ %# '
if [[ -n "$COOLDESK_COMPACT_PROMPT" ]]; then
  _cooldesk_compact_prompt() { PROMPT='%# '; RPROMPT=''; print -Pn '\e]0;%~\a'; }
  precmd_functions+=(_cooldesk_compact_prompt)
  _cooldesk_compact_prompt
fi
unset COOLDESK_COMPACT_PROMPT
"#;
const ZSH_LOGIN_TAIL: &str = r#"ZDOTDIR=$COOLDESK_USER_ZDOTDIR
unset COOLDESK_ZDOTDIR COOLDESK_USER_ZDOTDIR
"#;

/// Write the wrapper files (cheap; rewritten each time so an app update
/// takes effect). Returns the folder to use as ZDOTDIR.
fn zsh_wrapper(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().ok()?.join("shell").join("zsh");
    std::fs::create_dir_all(&dir).ok()?;
    for file in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
        let mut body = ZSH_FORWARD.replace("FILE", file);
        if file == ".zshrc" {
            body.push_str(ZSH_RC_TAIL);
        }
        if file == ".zlogin" {
            body.push_str(ZSH_LOGIN_TAIL);
        }
        std::fs::write(dir.join(file), body).ok()?;
    }
    Some(dir)
}

fn shell_command(app: &tauri::AppHandle, cwd: Option<&str>, compact: bool) -> CommandBuilder {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-NoLogo");
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".to_string());
        let is_zsh = std::path::Path::new(&shell).file_name().map(|n| n == "zsh").unwrap_or(false);
        let mut c = CommandBuilder::new(&shell);
        c.arg("-l");
        if is_zsh {
            if let Some(dir) = zsh_wrapper(app) {
                let user = std::env::var("ZDOTDIR").ok().filter(|s| !s.is_empty())
                    .or_else(|| dirs::home_dir().map(|h| h.to_string_lossy().into_owned()));
                if let Some(user) = user {
                    c.env("COOLDESK_USER_ZDOTDIR", user);
                    c.env("ZDOTDIR", dir);
                }
            }
        }
        c
    };

    let home = dirs::home_dir();
    let dir = cwd
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir())
        .or(home);
    if let Some(dir) = dir {
        cmd.cwd(dir);
    }
    // Don't hand the shell the environment of whatever launched CoolDesk:
    // in development that's `npm run tauri dev` (npm_*, TAURI_*, CARGO_*)
    // and often a Claude Code session (CLAUDE*), whose markers make a
    // `claude` run in this terminal think it's a child session (transcript
    // saving off). A login shell rebuilds the rest from the profile.
    for (key, _) in std::env::vars_os() {
        let k = key.to_string_lossy();
        if ["CLAUDE", "npm_", "TAURI_", "CARGO", "RUST_BACKTRACE", "VITE_"].iter().any(|p| k.starts_with(p)) {
            cmd.env_remove(&key);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "CoolDesk");
    if compact {
        cmd.env("COOLDESK_COMPACT_PROMPT", "1");
    }
    if std::env::var("LANG").map(|v| v.is_empty()).unwrap_or(true) {
        cmd.env("LANG", "en_US.UTF-8");
    }
    cmd
}

/// Start a shell for terminal `id` (one per tab mount) in `cwd`. `compact`:
/// a very narrow terminal, which gets a short prompt (see ZSH_RC_TAIL).
#[tauri::command]
pub fn terminal_open(
    webview: tauri::Webview,
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    compact: Option<bool>,
    output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    require_main(&webview)?;
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| format!("openpty: {e}"))?;
    let mut child = pair
        .slave
        .spawn_command(shell_command(tauri::Manager::app_handle(&webview), cwd.as_deref(), compact.unwrap_or(false)))
        .map_err(|e| format!("spawn shell: {e}"))?;
    // The slave end belongs to the shell now; holding it open here would
    // keep the reader from seeing EOF when the shell exits.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    let pid = child.process_id();

    // Replace (and end) any session left under the same id.
    if let Some(mut old) = sessions().lock().unwrap().insert(
        id.clone(),
        Session { writer, master: pair.master, killer, pid },
    ) {
        let _ = old.killer.kill();
    }

    std::thread::Builder::new()
        .name(format!("terminal-{id}"))
        .spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if output.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                            break;
                        }
                    }
                }
            }
            let code = child.wait().map(|s| s.exit_code() as i64).unwrap_or(-1);
            let _ = output.send(InvokeResponseBody::Json(format!("{{\"exit\":{code}}}")));
            // Only drop the entry if it's still ours (a reopen may have
            // replaced it under the same id).
            let mut map = sessions().lock().unwrap();
            if map.get(&id).map(|s| s.pid) == Some(pid) {
                map.remove(&id);
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Keystrokes / pasted text from xterm.
#[tauri::command]
pub fn terminal_write(webview: tauri::Webview, id: String, data: String) -> Result<(), String> {
    require_main(&webview)?;
    let mut map = sessions().lock().unwrap();
    let s = map.get_mut(&id).ok_or("No such terminal")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(webview: tauri::Webview, id: String, cols: u16, rows: u16) -> Result<(), String> {
    require_main(&webview)?;
    let map = sessions().lock().unwrap();
    let s = map.get(&id).ok_or("No such terminal")?;
    s.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

/// End the shell (tab closed). Dropping the master hangs up the pty, which
/// ends most shells on its own; the kill covers anything ignoring SIGHUP.
#[tauri::command]
pub fn terminal_close(webview: tauri::Webview, id: String) -> Result<(), String> {
    require_main(&webview)?;
    if let Some(mut s) = sessions().lock().unwrap().remove(&id) {
        let _ = s.killer.kill();
    }
    Ok(())
}

/// App quit: end every shell.
pub fn close_all() {
    if let Ok(mut map) = sessions().lock() {
        for (_, mut s) in map.drain() {
            let _ = s.killer.kill();
        }
    }
}
