// Per-day, per-domain browsing dwell rolled up from the extension's Activity
// rows, persisted as sync-data/activity/sites-YYYY-MM-DD.json so site history
// survives the in-memory activity cap (last 1000 rows ≈ a week).
//
// The extension's `time` field is a *cumulative* per-URL counter, and it
// over-counts when several tabs of the same site run at once (each tab feeds
// the same counter). A day's dwell is therefore the counter delta within the
// day, clamped to the observed heartbeat span — rows sync every few seconds
// while a site is actually in use, so the span is an honest upper bound.

use std::collections::HashMap;
use std::path::PathBuf;

use chrono::{Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::data::Activity;

const HEARTBEAT_GRACE_MS: i64 = 30_000;
const RETENTION_DAYS: i64 = 90; // matches the sampler's apps-*.json retention
const MAX_DAYS_QUERY: i64 = 90;

// =============================================================================
// DATA MODEL + PERSISTENCE
// =============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SitesDay {
    pub date: String,
    /// domain -> active seconds that day
    #[serde(default)]
    pub domains: HashMap<String, u64>,
    #[serde(default)]
    pub updated_at: i64,
}

fn activity_dir() -> PathBuf {
    crate::sidecar::storage::get_data_dir().join("activity")
}

fn sites_file(date: &str) -> PathBuf {
    activity_dir().join(format!("sites-{}.json", date))
}

fn load_day(date: &str) -> Option<SitesDay> {
    let content = std::fs::read_to_string(sites_file(date)).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_day(day: &SitesDay) {
    if day.date.is_empty() || day.domains.is_empty() {
        return;
    }
    if let Err(e) = std::fs::create_dir_all(activity_dir()) {
        log::warn!("[Sites] cannot create activity dir: {}", e);
        return;
    }
    match serde_json::to_string_pretty(day) {
        Ok(content) => {
            if let Err(e) = std::fs::write(sites_file(&day.date), content) {
                log::warn!("[Sites] failed to save {}: {}", day.date, e);
            }
        }
        Err(e) => log::warn!("[Sites] serialize failed: {}", e),
    }
}

fn prune_old_files() {
    let Ok(entries) = std::fs::read_dir(activity_dir()) else { return };
    let cutoff = (Local::now() - chrono::Duration::days(RETENTION_DAYS))
        .format("sites-%Y-%m-%d.json")
        .to_string();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Lexicographic compare works because of the fixed sites-YYYY-MM-DD.json shape
        if name.starts_with("sites-") && name.ends_with(".json") && name < cutoff {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

// =============================================================================
// ROLLUP
// =============================================================================

/// Local-midnight bounds (ms) for a YYYY-MM-DD date string.
fn day_bounds(date: &str) -> Option<(i64, i64)> {
    let nd = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let start = Local
        .from_local_datetime(&nd.and_hms_opt(0, 0, 0)?)
        .earliest()?
        .timestamp_millis();
    Some((start, start + 24 * 3600 * 1000))
}

/// Bare host for a groupable web page: http(s) only, no www., no local dev
/// hosts (CoolDesk's own UI lives on localhost and would track itself).
fn domain_of(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    let host = parsed.host_str()?;
    let host = host.strip_prefix("www.").unwrap_or(host).to_lowercase();
    if host.is_empty() || super::sampler::is_local_host(&host) {
        return None;
    }
    Some(host)
}

#[derive(Default)]
struct UrlAgg {
    before_ms: i64,
    min_in: i64,
    max_in: i64,
    first_ts: i64,
    last_ts: i64,
    seen: bool,
}

/// Roll activity rows up to domain -> active seconds within [start_ms, end_ms).
pub fn rollup_day(rows: &[Activity], start_ms: i64, end_ms: i64) -> HashMap<String, u64> {
    let mut per_url: HashMap<&str, UrlAgg> = HashMap::new();
    for a in rows {
        let (Some(url), Some(ts)) = (a.url.as_deref(), a.timestamp) else { continue };
        if ts >= end_ms {
            continue;
        }
        let t = a.time.unwrap_or(0).max(0);
        let e = per_url.entry(url).or_default();
        if ts < start_ms {
            e.before_ms = e.before_ms.max(t);
        } else {
            if !e.seen {
                e.min_in = t;
                e.first_ts = ts;
            }
            e.seen = true;
            e.min_in = e.min_in.min(t);
            e.max_in = e.max_in.max(t);
            e.first_ts = e.first_ts.min(ts);
            e.last_ts = e.last_ts.max(ts);
        }
    }

    let mut by_domain: HashMap<String, u64> = HashMap::new();
    for (url, e) in per_url {
        if !e.seen {
            continue;
        }
        let Some(domain) = domain_of(url) else { continue };
        // Baseline: last counter value before the day; if that's missing (row
        // evicted / counter reset) fall back to the first value seen in the day.
        let baseline = if e.before_ms > 0 && e.before_ms <= e.max_in {
            e.before_ms
        } else {
            e.min_in
        };
        let span = e.last_ts - e.first_ts + HEARTBEAT_GRACE_MS;
        let dwell_ms = (e.max_in - baseline).min(span);
        if dwell_ms <= 0 {
            continue;
        }
        *by_domain.entry(domain).or_insert(0) += (dwell_ms / 1000) as u64;
    }
    by_domain
}

// =============================================================================
// PUBLIC API
// =============================================================================

/// Compute today's rollup from the live rows and max-merge it into today's
/// file. Max-merge keeps earlier-in-the-day dwell even after the source rows
/// are evicted from the in-memory activity list.
pub fn persist_today(rows: &[Activity]) {
    let date = Local::now().format("%Y-%m-%d").to_string();
    let Some((start, end)) = day_bounds(&date) else { return };
    let computed = rollup_day(rows, start, end);
    if computed.is_empty() {
        return;
    }
    let mut day = load_day(&date).unwrap_or_else(|| SitesDay {
        date: date.clone(),
        ..Default::default()
    });
    let mut changed = false;
    for (domain, secs) in computed {
        let cur = day.domains.entry(domain).or_insert(0);
        if secs > *cur {
            *cur = secs;
            changed = true;
        }
    }
    if changed {
        day.updated_at = chrono::Utc::now().timestamp_millis();
        save_day(&day);
        prune_old_files();
    }
}

/// GET /activity/site-usage?days=N — last N days (oldest first), each
/// { date, domains: { "github.com": secs } }. Persisted files are merged with
/// a live rollup of the in-memory rows so today is always current.
pub fn site_usage(rows: &[Activity], days: i64) -> Value {
    let days = days.clamp(1, MAX_DAYS_QUERY);
    let mut out = Vec::with_capacity(days as usize);
    for offset in (0..days).rev() {
        let date = (Local::now() - chrono::Duration::days(offset))
            .format("%Y-%m-%d")
            .to_string();
        let mut domains = load_day(&date).map(|d| d.domains).unwrap_or_default();
        if let Some((start, end)) = day_bounds(&date) {
            for (domain, secs) in rollup_day(rows, start, end) {
                let cur = domains.entry(domain).or_insert(0);
                if secs > *cur {
                    *cur = secs;
                }
            }
        }
        out.push(json!({ "date": date, "domains": domains }));
    }
    json!({ "days": out })
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn row(url: &str, ts: i64, time_ms: i64) -> Activity {
        Activity {
            url: Some(url.to_string()),
            timestamp: Some(ts),
            time: Some(time_ms),
            ..Default::default()
        }
    }

    const DAY: i64 = 1_000_000_000_000; // arbitrary day start
    const END: i64 = DAY + 24 * 3600 * 1000;

    #[test]
    fn counter_delta_within_day() {
        let rows = vec![
            row("https://github.com", DAY - 1000, 600_000), // 10m before the day
            row("https://github.com", DAY + 1000, 660_000),
            row("https://github.com", DAY + 300_000, 900_000), // ends at 15m
        ];
        let up = rollup_day(&rows, DAY, END);
        // 15m − 10m = 5m, span ≈ 5m + grace — delta wins
        assert_eq!(up["github.com"], 300);
    }

    #[test]
    fn inflated_counter_is_clamped_to_heartbeat_span() {
        // 7 minutes of wall clock but the counter "grew" 103 minutes
        // (several tabs feeding one counter) — span + grace must win.
        let rows = vec![
            row("https://reddit.com", DAY, 4 * 60_000),
            row("https://reddit.com", DAY + 7 * 60_000, 107 * 60_000),
        ];
        let up = rollup_day(&rows, DAY, END);
        assert_eq!(up["reddit.com"], (7 * 60_000 + HEARTBEAT_GRACE_MS) as u64 / 1000);
    }

    #[test]
    fn missing_baseline_uses_first_value_in_day() {
        // No rows before the day (evicted): the first observed value is the
        // baseline, so old cumulative time is not attributed to this day.
        let rows = vec![
            row("https://news.ycombinator.com", DAY + 1000, 3_600_000),
            row("https://news.ycombinator.com", DAY + 121_000, 3_720_000),
        ];
        let up = rollup_day(&rows, DAY, END);
        assert_eq!(up["news.ycombinator.com"], 120);
    }

    #[test]
    fn backwards_counter_reset_does_not_go_negative() {
        // cool-desk.com's counter was observed running backwards
        let rows = vec![
            row("https://cool-desk.com", DAY + 1000, 700_000),
            row("https://cool-desk.com", DAY + 61_000, 400_000),
        ];
        let up = rollup_day(&rows, DAY, END);
        // min_in = 400_000 baseline, max_in = 700_000 → 300s, span 90s wins
        assert_eq!(up["cool-desk.com"], 90);
    }

    #[test]
    fn localhost_and_non_http_excluded() {
        let rows = vec![
            row("http://localhost:5173/app", DAY + 1000, 60_000),
            row("chrome-extension://abc/page.html", DAY + 1000, 60_000),
            row("https://www.github.com/repo", DAY, 0),
            row("https://www.github.com/repo", DAY + 90_000, 60_000),
        ];
        let up = rollup_day(&rows, DAY, END);
        assert_eq!(up.len(), 1);
        assert_eq!(up["github.com"], 60); // www. stripped, delta 60s < span
    }

    #[test]
    fn domains_accumulate_across_urls() {
        let rows = vec![
            row("https://github.com/a", DAY, 0),
            row("https://github.com/a", DAY + 60_000, 60_000),
            row("https://github.com/b", DAY + 120_000, 0),
            row("https://github.com/b", DAY + 180_000, 30_000),
        ];
        let up = rollup_day(&rows, DAY, END);
        assert_eq!(up["github.com"], 90);
    }
}
