// Real browser history for spotlight search.
//
// The sidecar's activity log is one row per *domain* (the extension folds
// every URL down to its site for usage stats), so it can't answer "which
// reddit pages have I been on" — searching "/u reddit" surfaced a single
// history row while Chrome itself held hundreds. This reads the Chromium
// family's own `History` SQLite databases (Chrome, Arc, Brave, Edge,
// Vivaldi, Chromium; every profile) at query time instead. No extension
// needed.
//
// The browser keeps the file locked while running, so we query a private
// copy, re-copied when the original's mtime changes but at most every
// COPY_TTL — a search runs per keystroke and the file is tens of MB.

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

const COPY_TTL: Duration = Duration::from_secs(30);
/// Chrome stores times as microseconds since 1601-01-01.
const WEBKIT_EPOCH_OFFSET_MS: i64 = 11_644_473_600_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryHit {
    pub url: String,
    pub title: String,
    pub visit_count: i64,
    pub last_visit_time: i64,
    pub browser: String,
}

struct CachedCopy {
    copy: PathBuf,
    source_mtime: SystemTime,
    checked: Instant,
}

lazy_static::lazy_static! {
    static ref COPIES: Mutex<HashMap<PathBuf, CachedCopy>> = Mutex::new(HashMap::new());
}

/// (browser label, user-data dir) for each Chromium browser we know about.
fn browser_roots() -> Vec<(&'static str, PathBuf)> {
    #[cfg(target_os = "macos")]
    let (base, dirs): (Option<PathBuf>, &[(&str, &str)]) = (
        dirs::data_dir(),
        &[
            ("chrome", "Google/Chrome"),
            ("arc", "Arc/User Data"),
            ("brave", "BraveSoftware/Brave-Browser"),
            ("edge", "Microsoft Edge"),
            ("vivaldi", "Vivaldi"),
            ("chromium", "Chromium"),
        ],
    );
    #[cfg(target_os = "windows")]
    let (base, dirs): (Option<PathBuf>, &[(&str, &str)]) = (
        dirs::data_local_dir(),
        &[
            ("chrome", "Google/Chrome/User Data"),
            ("brave", "BraveSoftware/Brave-Browser/User Data"),
            ("edge", "Microsoft/Edge/User Data"),
            ("vivaldi", "Vivaldi/User Data"),
            ("chromium", "Chromium/User Data"),
        ],
    );
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (base, dirs): (Option<PathBuf>, &[(&str, &str)]) = (
        dirs::config_dir(),
        &[
            ("chrome", "google-chrome"),
            ("brave", "BraveSoftware/Brave-Browser"),
            ("chromium", "chromium"),
        ],
    );

    let Some(base) = base else { return Vec::new() };
    dirs.iter().map(|(name, rel)| (*name, base.join(rel))).collect()
}

/// Every profile's History file: `Default` plus `Profile N`.
fn history_files() -> Vec<(&'static str, PathBuf)> {
    let mut out = Vec::new();
    for (browser, root) in browser_roots() {
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name != "Default" && !name.starts_with("Profile ") {
                continue;
            }
            let file = entry.path().join("History");
            if file.is_file() {
                out.push((browser, file));
            }
        }
    }
    out
}

/// Path to a fresh-enough private copy of `source`.
fn readable_copy(source: &Path) -> Option<PathBuf> {
    let mut copies = COPIES.lock().ok()?;
    if let Some(c) = copies.get_mut(source) {
        if c.checked.elapsed() < COPY_TTL && c.copy.is_file() {
            return Some(c.copy.clone());
        }
        let mtime = std::fs::metadata(source).and_then(|m| m.modified()).ok()?;
        if mtime == c.source_mtime && c.copy.is_file() {
            c.checked = Instant::now();
            return Some(c.copy.clone());
        }
    }

    let mtime = std::fs::metadata(source).and_then(|m| m.modified()).ok()?;
    let key = format!("{:x}", fnv1a(&source.to_string_lossy()));
    let copy = std::env::temp_dir().join(format!("cooldesk-history-{key}.sqlite"));
    std::fs::copy(source, &copy).ok()?;
    copies.insert(
        source.to_path_buf(),
        CachedCopy { copy: copy.clone(), source_mtime: mtime, checked: Instant::now() },
    );
    Some(copy)
}

/// Stable short hash for the copy's file name (FNV-1a; no crypto needed).
fn fnv1a(s: &str) -> u64 {
    s.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

fn escape_like(q: &str) -> String {
    q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

fn query_file(browser: &'static str, db: &Path, query: &str, limit: usize) -> rusqlite::Result<Vec<HistoryHit>> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    // Every word of the query must appear in the url or title, in any order:
    // "big boss" finds "Watch Bigg Boss" (big ⊂ bigg), which matching the
    // whole phrase as one substring missed.
    let words: Vec<String> = query.split_whitespace().map(|w| format!("%{}%", escape_like(w))).collect();
    if words.is_empty() {
        return Ok(Vec::new());
    }
    let word_conds: Vec<String> = (0..words.len())
        .map(|i| format!("(url || ' ' || IFNULL(title, '')) LIKE ?{} ESCAPE '\\'", i + 3))
        .collect();
    let sql = format!(
        "SELECT url, title, visit_count, last_visit_time FROM urls
         WHERE hidden = 0
           AND {}
           AND (url LIKE 'http://%' OR url LIKE 'https://%')
         ORDER BY (visit_count + 2 * typed_count) * CASE
                    WHEN last_visit_time > ?2 - 86400000000 THEN 1.0
                    WHEN last_visit_time > ?2 - 7 * 86400000000 THEN 0.7
                    WHEN last_visit_time > ?2 - 30 * 86400000000 THEN 0.45
                    WHEN last_visit_time > ?2 - 90 * 86400000000 THEN 0.25
                    ELSE 0.1 END DESC,
                  last_visit_time DESC
         LIMIT ?1",
        word_conds.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let now_micros = (chrono::Utc::now().timestamp_millis() + WEBKIT_EPOCH_OFFSET_MS) * 1000;
    let mut params: Vec<rusqlite::types::Value> = vec![(limit as i64).into(), now_micros.into()];
    params.extend(words.into_iter().map(Into::into));
    let rows = stmt.query_map(rusqlite::params_from_iter(params), |r| {
        let micros: i64 = r.get(3)?;
        Ok(HistoryHit {
            url: r.get(0)?,
            title: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            visit_count: r.get(2)?,
            last_visit_time: micros / 1000 - WEBKIT_EPOCH_OFFSET_MS,
            browser: browser.to_string(),
        })
    })?;
    rows.collect()
}

/// Query params that only record how a page was reached, not which page it
/// is. Two URLs differing only in these are the same page.
fn is_noise_param(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k.starts_with("utm_")
        || matches!(
            k.as_str(),
            "fbclid" | "gclid" | "msclkid" | "igshid" | "mc_cid" | "mc_eid" | "si" | "ref" | "ref_src"
                | "ref_url" | "share_id" | "rdt" | "context" | "screen_view_count" | "ext-referrer"
                | "source_id" | "composer_entry" | "correlation_id"
        )
}

/// Identity of the page a URL points at, for collapsing near-duplicates:
/// no `www.`, fragment, trailing slash or tracking params. A reddit post is
/// keyed by its id alone, since the slug changes (a removed post's becomes
/// `removed_by_reddit`) and comment permalinks live under it.
fn page_key(raw: &str) -> String {
    let Ok(u) = url::Url::parse(raw) else { return raw.to_string() };
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let segs: Vec<&str> = u.path_segments().map(|s| s.filter(|p| !p.is_empty()).collect()).unwrap_or_default();

    let is_reddit = host == "reddit.com" || host.ends_with(".reddit.com");
    let path = if is_reddit {
        let lower: Vec<String> = segs.iter().map(|s| s.to_ascii_lowercase()).collect();
        match lower.as_slice() {
            [r, sub, c, id, ..] if r == "r" && c == "comments" => format!("r/{sub}/comments/{id}"),
            _ => lower.join("/"),
        }
    } else {
        segs.join("/")
    };

    let mut params: Vec<(String, String)> =
        u.query_pairs().filter(|(k, _)| !is_noise_param(k)).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    params.sort();
    let query: Vec<String> = params.into_iter().map(|(k, v)| format!("{k}={v}")).collect();

    if query.is_empty() {
        format!("{host}/{path}")
    } else {
        format!("{host}/{path}?{}", query.join("&"))
    }
}

/// Visits weighted by how recently the page was last seen — same buckets as
/// the SQL ordering above and the spotlight's historyFrecencyScore, so the
/// rows cut here are the ones that would have ranked lowest there anyway.
fn frecency(h: &HistoryHit, now_ms: i64) -> f64 {
    let days = (now_ms - h.last_visit_time).max(0) as f64 / 86_400_000.0;
    let recency = if days < 1.0 { 1.0 } else if days < 7.0 { 0.7 } else if days < 30.0 { 0.45 } else if days < 90.0 { 0.25 } else { 0.1 };
    h.visit_count as f64 * recency
}

/// `raw` without tracking params or fragment — the URL a collapsed row opens.
fn clean_url(raw: &str) -> String {
    let Ok(mut u) = url::Url::parse(raw) else { return raw.to_string() };
    let kept: Vec<(String, String)> =
        u.query_pairs().filter(|(k, _)| !is_noise_param(k)).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    if kept.is_empty() {
        u.set_query(None);
    } else {
        u.query_pairs_mut().clear().extend_pairs(kept);
    }
    u.set_fragment(None);
    u.into()
}

/// Which of a page's URLs a row should open: a plain one over a comment
/// permalink or tracking-tagged variant, then the most visited.
fn url_rank(raw: &str, visits: i64) -> (bool, i64) {
    let plain = !raw.contains("/comment/") && clean_url(raw) == raw;
    (plain, visits)
}

/// Search every Chromium profile's history for `query` (substring of url or
/// title), most-visited first, one row per page across browsers (see
/// page_key). Visits add up across the collapsed URLs; the row opens the
/// best of them by url_rank, cleaned.
pub fn search(query: &str, limit: usize) -> Vec<HistoryHit> {
    let query = query.trim();
    if query.is_empty() || limit == 0 {
        return Vec::new();
    }

    // Collapsing shrinks the list, so pull more than asked for.
    let per_file = (limit * 3).min(600);
    // key -> (merged row, url_rank of the URL it currently opens)
    let mut by_page: HashMap<String, (HistoryHit, (bool, i64))> = HashMap::new();
    for (browser, file) in history_files() {
        let Some(copy) = readable_copy(&file) else { continue };
        let hits = match query_file(browser, &copy, query, per_file) {
            Ok(h) => h,
            Err(e) => {
                log::debug!("[BrowserHistory] {} unreadable: {}", file.display(), e);
                continue;
            }
        };
        for hit in hits {
            match by_page.get_mut(&page_key(&hit.url)) {
                Some((merged, best)) => {
                    merged.visit_count += hit.visit_count;
                    let rank = url_rank(&hit.url, hit.visit_count);
                    if rank > *best {
                        *best = rank;
                        merged.url = hit.url.clone();
                    }
                    if hit.last_visit_time > merged.last_visit_time {
                        merged.last_visit_time = hit.last_visit_time;
                        if !hit.title.is_empty() {
                            merged.title = hit.title;
                        }
                    }
                }
                None => {
                    let rank = url_rank(&hit.url, hit.visit_count);
                    by_page.insert(page_key(&hit.url), (hit, rank));
                }
            }
        }
    }

    let mut out: Vec<HistoryHit> = by_page
        .into_values()
        .map(|(mut h, _)| {
            h.url = clean_url(&h.url);
            h
        })
        .collect();
    let now = chrono::Utc::now().timestamp_millis();
    out.sort_by(|a, b| frecency(b, now).total_cmp(&frecency(a, now)).then(b.last_visit_time.cmp(&a.last_visit_time)));
    out.truncate(limit);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn searches_a_chromium_history_db() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("History");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER,
                                typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER);
             INSERT INTO urls VALUES (1, 'https://www.reddit.com/r/rust', 'r/rust', 3, 0, 13300000000000000, 0);
             INSERT INTO urls VALUES (2, 'https://www.reddit.com/u/me', 'overview for me', 9, 0, 13300000000000000, 0);
             INSERT INTO urls VALUES (3, 'https://example.com/100%_off', 'sale', 1, 0, 13300000000000000, 0);
             INSERT INTO urls VALUES (4, 'https://reddit.com/hidden', 'hidden', 50, 0, 13300000000000000, 1);",
        )
        .unwrap();
        drop(conn);

        let hits = query_file("chrome", &db, "reddit", 10).unwrap();
        assert_eq!(hits.iter().map(|h| h.url.as_str()).collect::<Vec<_>>(),
                   vec!["https://www.reddit.com/u/me", "https://www.reddit.com/r/rust"]);

        // LIKE wildcards in the query are literal.
        assert_eq!(query_file("chrome", &db, "100%_", 10).unwrap().len(), 1);
        assert_eq!(query_file("chrome", &db, "_", 10).unwrap().len(), 1);

        // Words match independently, in any order, across url and title.
        assert_eq!(query_file("chrome", &db, "overview red", 10).unwrap().len(), 1);
        assert_eq!(query_file("chrome", &db, "rust reddit", 10).unwrap().len(), 1);
        assert_eq!(query_file("chrome", &db, "rust overview", 10).unwrap().len(), 0);
    }

    #[test]
    fn page_key_collapses_near_duplicates() {
        let same = |a: &str, b: &str| assert_eq!(page_key(a), page_key(b), "{a} vs {b}");
        same("https://www.reddit.com/r/cooldesk/", "https://reddit.com/r/cooldesk");
        same("https://www.reddit.com/r/MacApps/", "https://www.reddit.com/r/macapps/");
        same(
            "https://www.reddit.com/r/cooldesk/comments/1wv3zi3/i_built_lumabar/",
            "https://www.reddit.com/r/cooldesk/comments/1wv3zi3/removed_by_reddit/?screen_view_count=1&ext-referrer=DIRECT",
        );
        same(
            "https://www.reddit.com/r/x/comments/1x87bvf/post/",
            "https://www.reddit.com/r/x/comments/1x87bvf/comment/pha90uu/?screen_view_count=8",
        );
        same("https://example.com/a?utm_source=x#top", "https://example.com/a");

        let differ = |a: &str, b: &str| assert_ne!(page_key(a), page_key(b), "{a} vs {b}");
        differ("https://www.reddit.com/?feed=home", "https://www.reddit.com/");
        differ("https://youtube.com/watch?v=1", "https://youtube.com/watch?v=2");
        differ("https://github.com/A/repo", "https://github.com/a/repo");
    }

    #[test]
    fn clean_url_strips_tracking_only() {
        assert_eq!(
            clean_url("https://www.reddit.com/r/x/comments/1/c/?screen_view_count=2&ext-referrer=DIRECT#lightbox"),
            "https://www.reddit.com/r/x/comments/1/c/"
        );
        assert_eq!(clean_url("https://youtube.com/watch?v=1&utm_source=x"), "https://youtube.com/watch?v=1");
        assert!(url_rank("https://r.com/r/x/comments/1/post/", 1) > url_rank("https://r.com/r/x/comments/1/comment/z/", 9));
    }
}
