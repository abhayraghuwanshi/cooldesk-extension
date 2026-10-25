// Highlights and notes made on pages in the browser pane (page tools: see
// browser_pane/tools.rs + tools.js). Stored in one JSON file in app data,
// keyed by a normalized page URL. Everything that arrives from a page is
// validated here — the page tools run in an isolated world the site can't
// reach, but the text they quote is the site's.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

const FILE: &str = "annotations.json";
pub const COLORS: [&str; 5] = ["yellow", "green", "blue", "pink", "purple"];
const MAX_EXACT: usize = 4000;
const MAX_CONTEXT: usize = 200;
const MAX_NOTE: usize = 10_000;
const MAX_ID: usize = 64;

lazy_static::lazy_static! {
    static ref LOCK: Mutex<()> = Mutex::new(());
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Quote {
    pub exact: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub suffix: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Highlight {
    pub id: String,
    pub color: String,
    #[serde(default)]
    pub note: String,
    pub quote: Quote,
    /// ms since epoch. Set by `create` — the page doesn't send it, so it must
    /// default when parsing a page's message (it was required, and every
    /// highlight was rejected as "bad highlight").
    #[serde(default)]
    pub created: i64,
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct PageNotes {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub items: Vec<Highlight>,
}

type Store = HashMap<String, PageNotes>;

/// Same page however it was reached: drop the #fragment and tracking params.
pub fn normalize_url(raw: &str) -> String {
    let Ok(mut url) = url::Url::parse(raw) else { return raw.to_string() };
    url.set_fragment(None);
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| {
            let k = k.to_ascii_lowercase();
            !(k.starts_with("utm_") || matches!(k.as_str(), "fbclid" | "gclid" | "mc_cid" | "mc_eid" | "ref_src" | "igshid"))
        })
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if kept.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut().clear().extend_pairs(kept);
    }
    url.to_string()
}

fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(FILE))
}

fn read(app: &tauri::AppHandle) -> Store {
    path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write(app: &tauri::AppHandle, store: &Store) -> Result<(), String> {
    let p = path(app)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(store).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn valid_color(c: &str) -> bool {
    COLORS.contains(&c)
}

/// Read-modify-write under the lock, then tell the UI which page changed.
fn modify<T>(app: &tauri::AppHandle, page_url: &str, f: impl FnOnce(&mut PageNotes) -> T) -> Result<T, String> {
    let key = normalize_url(page_url);
    let out = {
        let _guard = LOCK.lock().unwrap();
        let mut store = read(app);
        let page = store.entry(key.clone()).or_default();
        if page.url.is_empty() {
            page.url = key.clone();
        }
        let out = f(page);
        if page.items.is_empty() {
            store.remove(&key);
        }
        write(app, &store)?;
        out
    };
    let _ = app.emit("highlights-changed", serde_json::json!({ "url": key }));
    Ok(out)
}

pub fn list_for(app: &tauri::AppHandle, page_url: &str) -> Vec<Highlight> {
    let _guard = LOCK.lock().unwrap();
    read(app).remove(&normalize_url(page_url)).map(|p| p.items).unwrap_or_default()
}

/// From the page tools: a new highlight (validated).
pub fn create(app: &tauri::AppHandle, page_url: &str, title: &str, h: Highlight) -> Result<(), String> {
    if h.id.is_empty() || h.id.len() > MAX_ID || !valid_color(&h.color) || h.quote.exact.trim().is_empty() {
        return Err("invalid highlight".into());
    }
    let h = Highlight {
        id: h.id,
        color: h.color,
        note: clip(&h.note, MAX_NOTE),
        quote: Quote {
            exact: clip(&h.quote.exact, MAX_EXACT),
            prefix: clip(&h.quote.prefix, MAX_CONTEXT),
            suffix: clip(&h.quote.suffix, MAX_CONTEXT),
        },
        created: chrono::Utc::now().timestamp_millis(),
    };
    let title = clip(title, 300);
    modify(app, page_url, |page| {
        if !title.is_empty() {
            page.title = title;
        }
        if !page.items.iter().any(|x| x.id == h.id) {
            page.items.push(h);
        }
    })
}

pub fn update(app: &tauri::AppHandle, page_url: &str, id: &str, color: Option<String>, note: Option<String>) -> Result<bool, String> {
    if let Some(c) = &color {
        if !valid_color(c) {
            return Err("invalid color".into());
        }
    }
    modify(app, page_url, |page| {
        let Some(h) = page.items.iter_mut().find(|h| h.id == id) else { return false };
        if let Some(c) = color {
            h.color = c;
        }
        if let Some(n) = note {
            h.note = clip(&n, MAX_NOTE);
        }
        true
    })
}

pub fn delete(app: &tauri::AppHandle, page_url: &str, id: &str) -> Result<bool, String> {
    modify(app, page_url, |page| {
        let before = page.items.len();
        page.items.retain(|h| h.id != id);
        page.items.len() != before
    })
}

// ── Commands for the Notes panel ─────────────────────────────────────────

#[derive(Serialize)]
pub struct PageNotesOut {
    url: String,
    title: String,
    items: Vec<Highlight>,
}

#[tauri::command]
pub fn highlights_list(app: tauri::AppHandle, url: String) -> PageNotesOut {
    let key = normalize_url(&url);
    let _guard = LOCK.lock().unwrap();
    let page = read(&app).remove(&key).unwrap_or_default();
    PageNotesOut { url: key, title: page.title, items: page.items }
}

#[tauri::command]
pub fn highlights_update(app: tauri::AppHandle, url: String, id: String, color: Option<String>, note: Option<String>) -> Result<(), String> {
    update(&app, &url, &id, color, note)?;
    crate::browser_pane::tools::refresh_pages(&app, &url);
    Ok(())
}

#[tauri::command]
pub fn highlights_delete(app: tauri::AppHandle, url: String, id: String) -> Result<(), String> {
    delete(&app, &url, &id)?;
    crate::browser_pane::tools::refresh_pages(&app, &url);
    Ok(())
}
