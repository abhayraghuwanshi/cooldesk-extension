// MCP endpoint for the /agent chat — the agent's window onto CoolDesk's data.
//
// The /agent run is a terminal AI CLI in a sandboxed folder: it can't see the
// user's tabs, history or apps, so before this it either got a fixed snapshot
// pasted into its prompt or said "I can't see your browser". The sidecar
// already holds all of that (tabs and activity pushed by the extension, app
// usage from the sampler, learned url→workspace patterns), so it serves it as
// MCP tools the agent can query on demand — "which of my tabs belong
// together", "what have I been reading about stripe this week".
//
// Read-only by design. Nothing here changes a workspace: the agent still
// proposes changes as a json action block the user has to Apply in the UI.
//
// Transport is the stateless subset of MCP's Streamable HTTP: every POST is a
// JSON-RPC message (or batch) answered with application/json, no sessions,
// no server-initiated SSE (GET → 405, which the spec says means "no stream").

use crate::sidecar::data::{Activity, Tab, Workspace};
use crate::sidecar::handlers::{learned_workspace_suggestions, learned_workspace_verdicts, AppState};
use crate::sidecar::sites::domain_of;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

const SERVER_NAME: &str = "cooldesk";
const DEFAULT_PROTOCOL: &str = "2025-06-18";
const DAY_MS: i64 = 24 * 3600 * 1000;

const INSTRUCTIONS: &str = "Read-only access to the user's CoolDesk data: open browser tabs \
(grouped by window), browsing history with visit counts and time spent, per-site and per-app \
usage, pages not yet in any workspace, and CoolDesk's learned url→workspace patterns. Use it \
to ground answers and workspace proposals in what the user actually uses. These tools never \
change anything.";

pub async fn mcp_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    // Only local CLIs talk to this, and they send no Origin. Any Origin means a
    // web page is trying to read the user's history through localhost.
    if headers.contains_key("origin") {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }

    let responses: Vec<Value> = match body {
        Value::Array(batch) => {
            let mut out = Vec::new();
            for msg in batch {
                if let Some(r) = handle_message(&state, msg).await {
                    out.push(r);
                }
            }
            if out.is_empty() {
                return StatusCode::ACCEPTED.into_response();
            }
            return Json(Value::Array(out)).into_response();
        }
        msg => handle_message(&state, msg).await.into_iter().collect(),
    };
    match responses.into_iter().next() {
        Some(r) => Json(r).into_response(),
        // Notifications and responses get no body.
        None => StatusCode::ACCEPTED.into_response(),
    }
}

/// No server-to-client stream and no sessions to end.
pub async fn mcp_other() -> impl IntoResponse {
    StatusCode::METHOD_NOT_ALLOWED
}

async fn handle_message(state: &AppState, msg: Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    // A notification (no id) or a client's response to us: nothing to answer.
    let id = id?;
    let params = msg.get("params").cloned().unwrap_or(Value::Null);

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or(DEFAULT_PROTOCOL),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
            "instructions": INSTRUCTIONS,
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_list() })),
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match call_tool(state, name, &args).await {
                Some(text) => Ok(json!({ "content": [{ "type": "text", "text": text }] })),
                None => Err((-32602, format!("Unknown tool: {name}"))),
            }
        }
        _ => Err((-32601, format!("Method not found: {method}"))),
    };

    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    })
}

fn tool_list() -> Value {
    let days = |default: i64, max: i64| json!({
        "type": "integer", "minimum": 1, "maximum": max,
        "description": format!("How many days back to look (default {default})."),
    });
    let limit = |default: i64| json!({
        "type": "integer", "minimum": 1, "maximum": 200,
        "description": format!("Maximum rows to return (default {default})."),
    });
    json!([
        {
            "name": "open_tabs",
            "description": "The browser tabs open right now, grouped by browser window. Tabs kept together in one window are often one task — a strong hint for grouping. Each tab says which workspaces already contain it.",
            "inputSchema": { "type": "object", "properties": {} },
        },
        {
            "name": "visited_sites",
            "description": "Websites the user spent time on, one row per site, with time spent, on how many days, last visit and the title of the last page seen there; most-used first. CoolDesk's activity log records sites, not individual pages — for exact page urls use open_tabs. Optional text filter (all words must match the site or title).",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string", "description": "Words to match in the site or page title." },
                "days": days(14, 90),
                "limit": limit(60),
            } },
        },
        {
            "name": "unfiled_pages",
            "description": "What the user actually uses that is NOT in any workspace yet: open tabs whose url isn't saved anywhere, plus sites with recent time spent that no workspace links to. Grouped by site, busiest first, with time spent, CoolDesk's learned workspace guesses, and workspaces the user has declined for that site. Start here when asked to organise, group or tidy.",
            "inputSchema": { "type": "object", "properties": {
                "days": days(14, 90),
                "limit": limit(40),
            } },
        },
        {
            "name": "site_usage",
            "description": "Time spent per website (domain), summed over the last N days, with which workspaces already link to that site.",
            "inputSchema": { "type": "object", "properties": { "days": days(7, 30), "limit": limit(40) } },
        },
        {
            "name": "app_usage",
            "description": "Time spent per desktop app over the last N days, with the window contexts inside each (editor project names, document titles) — shows which projects and tools are used together.",
            "inputSchema": { "type": "object", "properties": { "days": days(7, 30), "limit": limit(25) } },
        },
        {
            "name": "list_apps",
            "description": "Installed and running desktop apps with their paths (use the path exactly for add_app). Without a query, lists running apps.",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string", "description": "Text to match in the app name or window title." },
                "limit": limit(30),
            } },
        },
        {
            "name": "suggest_workspace",
            "description": "CoolDesk's learned guess (from the user's past filing) for which existing workspaces a url belongs in, with scores, plus workspaces the user has explicitly declined for it.",
            "inputSchema": { "type": "object", "required": ["url"], "properties": {
                "url": { "type": "string" },
                "title": { "type": "string" },
            } },
        },
    ])
}

async fn call_tool(state: &AppState, name: &str, args: &Value) -> Option<String> {
    let int = |key: &str, default: i64, max: i64| {
        args.get(key).and_then(|v| v.as_i64()).unwrap_or(default).clamp(1, max)
    };
    let text = |key: &str| args.get(key).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();

    Some(match name {
        "open_tabs" => {
            let data = state.sync_data.read().await;
            open_tabs(&data.tabs, &Membership::new(&data.workspaces))
        }
        "visited_sites" => {
            let data = state.sync_data.read().await;
            visited_sites(&data.activity, &Membership::new(&data.workspaces), &text("query"), int("days", 14, 90), int("limit", 60, 200) as usize)
        }
        "unfiled_pages" => {
            let (rows, tabs, members) = {
                let data = state.sync_data.read().await;
                (data.activity.clone(), data.tabs.clone(), Membership::new(&data.workspaces))
            };
            unfiled_pages(&rows, &tabs, &members, int("days", 14, 90), int("limit", 40, 200) as usize).await
        }
        "site_usage" => {
            let (rows, members) = {
                let data = state.sync_data.read().await;
                (data.activity.clone(), Membership::new(&data.workspaces))
            };
            site_usage(&rows, &members, int("days", 7, 30), int("limit", 40, 200) as usize)
        }
        "app_usage" => app_usage(int("days", 7, 30) as u32, int("limit", 25, 200) as usize).await,
        "list_apps" => list_apps(&text("query"), int("limit", 30, 200) as usize),
        "suggest_workspace" => {
            let url = text("url");
            if url.is_empty() {
                return Some("Pass a url.".into());
            }
            let learned = Learned::of(&url, &text("title"), 5).await;
            if learned.guesses.is_empty() && learned.declined.is_empty() {
                "No learned pattern for this url yet.".into()
            } else {
                let mut out: Vec<String> = learned.guesses.iter().map(|(ws, score)| format!("- {ws}  (score {score:.2})")).collect();
                out.extend(learned.declined.iter().map(|(ws, n)| format!("- NOT {ws}: the user declined that {}", times(*n))));
                out.join("\n")
            }
        }
        _ => return None,
    })
}

// ── What CoolDesk has learned about where a url goes ──────────────────────────

/// Learned guesses for a url, minus any workspace the user has turned down
/// for its site more often than they kept it — those are listed as declined
/// instead, so the agent stops re-proposing them.
struct Learned {
    guesses: Vec<(String, f64)>,
    declined: Vec<(String, u32)>,
}

impl Learned {
    async fn of(url: &str, title: &str, n: usize) -> Self {
        let declined: Vec<(String, u32)> = learned_workspace_verdicts(url).await
            .into_iter()
            .filter(|(_, kept, rejected)| rejected > kept)
            .map(|(ws, _, rejected)| (ws, rejected))
            .collect();
        let mut guesses = learned_workspace_suggestions(url, title, n + declined.len()).await;
        guesses.retain(|(ws, _)| !declined.iter().any(|(d, _)| d == ws));
        guesses.truncate(n);
        Self { guesses, declined }
    }
}

fn times(n: u32) -> String {
    if n == 1 { "once".into() } else { format!("{n}×") }
}

// ── Which workspaces already hold a page / site ───────────────────────────────

struct Membership {
    by_url: HashMap<String, Vec<String>>,
    by_domain: HashMap<String, Vec<String>>,
}

impl Membership {
    fn new(workspaces: &[Workspace]) -> Self {
        let mut by_url: HashMap<String, Vec<String>> = HashMap::new();
        let mut by_domain: HashMap<String, Vec<String>> = HashMap::new();
        for ws in workspaces {
            for u in &ws.urls {
                push_unique(by_url.entry(norm_url(&u.url)).or_default(), &ws.name);
                if let Some(d) = domain_of(&u.url) {
                    push_unique(by_domain.entry(d).or_default(), &ws.name);
                }
            }
        }
        Self { by_url, by_domain }
    }

    fn of_url(&self, url: &str) -> &[String] {
        self.by_url.get(&norm_url(url)).map(|v| v.as_slice()).unwrap_or(&[])
    }

    fn of_domain(&self, domain: &str) -> &[String] {
        self.by_domain.get(domain).map(|v| v.as_slice()).unwrap_or(&[])
    }
}

fn push_unique(v: &mut Vec<String>, s: &str) {
    if !v.iter().any(|x| x == s) {
        v.push(s.to_string());
    }
}

/// Same page regardless of fragment, trailing slash or case of the host.
fn norm_url(url: &str) -> String {
    let no_frag = url.split('#').next().unwrap_or(url);
    no_frag.trim_end_matches('/').to_lowercase()
}

fn tag(names: &[String]) -> String {
    if names.is_empty() { String::new() } else { format!("  [in: {}]", names.join(", ")) }
}

/// Pages worth showing an agent: real web pages on a named host — not new-tab,
/// CoolDesk's own UI, or a bare IP like the `http://0.1` a typo leaves behind.
fn is_page(url: &str) -> bool {
    domain_of(url).is_some_and(|host| {
        host.rsplit('.').next().is_some_and(|tld| tld.chars().any(|c| c.is_ascii_alphabetic())) && host.contains('.')
    })
}

/// Titles like a GitHub repo's full tagline cost tokens and add nothing.
fn short(title: &str) -> String {
    let t = title.trim();
    if t.chars().count() <= 90 { t.to_string() } else { format!("{}…", t.chars().take(89).collect::<String>()) }
}

// ── Activity → per-site time and last page ─────────────────────────────────────

struct Site {
    domain: String,
    url: String,
    title: String,
    last_ts: i64,
    dwell_ms: i64,
    active_days: u32,
}

/// Active time per site over the last `days`, from the same per-day rollups
/// the usage dashboard shows (sites.rs). The raw activity log is a rolling
/// window of the last ~1000 events whose dwell is cumulative per session, so
/// summing it directly over-counts and forgets anything older than a day or two.
fn site_totals(rows: &[Activity], days: i64) -> HashMap<String, (u64, u32)> {
    let usage = crate::sidecar::sites::site_usage(rows, days);
    let mut totals: HashMap<String, (u64, u32)> = HashMap::new();
    for day in usage["days"].as_array().into_iter().flatten() {
        for (domain, secs) in day["domains"].as_object().into_iter().flatten() {
            let secs = secs.as_u64().unwrap_or(0);
            if secs == 0 {
                continue;
            }
            let t = totals.entry(domain.clone()).or_default();
            t.0 += secs;
            t.1 += 1;
        }
    }
    totals
}

/// Every site with time spent in the last `days`, busiest first, with the url
/// and title of the last page seen there (activity rows carry the origin and
/// the latest page title).
fn sites_since(rows: &[Activity], days: i64) -> Vec<Site> {
    let since_ms = now_ms() - days * DAY_MS;
    let mut sites: HashMap<String, Site> = HashMap::new();
    for a in rows {
        let (Some(url), Some(ts)) = (a.url.as_deref(), a.timestamp) else { continue };
        if ts < since_ms || !is_page(url) {
            continue;
        }
        let Some(domain) = domain_of(url) else { continue };
        let site = sites.entry(domain.clone()).or_insert_with(|| Site {
            domain, url: String::new(), title: String::new(), last_ts: 0, dwell_ms: 0, active_days: 0,
        });
        if ts >= site.last_ts {
            site.last_ts = ts;
            site.url = url.to_string();
            site.title = a.title.clone().unwrap_or_default();
        }
    }
    for (domain, (secs, active_days)) in site_totals(rows, days) {
        if !is_page(&format!("https://{domain}")) {
            continue;
        }
        let site = sites.entry(domain.clone()).or_insert_with(|| Site {
            url: format!("https://{domain}"), domain, title: String::new(), last_ts: 0, dwell_ms: 0, active_days: 0,
        });
        site.dwell_ms = secs as i64 * 1000;
        site.active_days = active_days;
    }
    let mut sites: Vec<Site> = sites.into_values().filter(|s| s.dwell_ms > 0 || s.last_ts > 0).collect();
    sites.sort_by(|a, b| (b.dwell_ms / 60_000, b.last_ts).cmp(&(a.dwell_ms / 60_000, a.last_ts)));
    sites
}

fn days_label(n: u32) -> String {
    format!("{n} day{}", if n == 1 { "" } else { "s" })
}

fn last_seen(s: &Site) -> String {
    if s.last_ts > 0 { format!(" · last {}", ago(s.last_ts)) } else { String::new() }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn ago(ts: i64) -> String {
    let days = (now_ms() - ts).max(0) / DAY_MS;
    match days {
        0 => "today".into(),
        1 => "yesterday".into(),
        n => format!("{n}d ago"),
    }
}

fn minutes(ms: i64) -> String {
    let m = ms / 60_000;
    if m >= 60 { format!("{}h{:02}m", m / 60, m % 60) } else { format!("{m}m") }
}

fn title_or_url(title: &str, url: &str) -> String {
    if title.trim().is_empty() { url.to_string() } else { short(title) }
}

// ── Tools ──────────────────────────────────────────────────────────────────────

fn open_tabs(tabs: &[Tab], members: &Membership) -> String {
    // BTreeMap keeps windows in a stable order between calls.
    let mut windows: BTreeMap<(String, i64), Vec<&Tab>> = BTreeMap::new();
    for t in tabs.iter().filter(|t| is_page(&t.url)) {
        let browser = t.browser.clone().unwrap_or_else(|| "browser".into());
        windows.entry((browser, t.window_id.unwrap_or(0))).or_default().push(t);
    }
    if windows.is_empty() {
        return "No open tabs reported. The CoolDesk browser extension may not be connected.".into();
    }
    let mut out = vec![format!("{} open tabs in {} windows:", windows.values().map(|v| v.len()).sum::<usize>(), windows.len())];
    for (n, ((browser, _), tabs)) in windows.iter().enumerate() {
        out.push(format!("\nWindow {} ({browser}, {} tabs):", n + 1, tabs.len()));
        for t in tabs {
            out.push(format!("  - {} — {}{}", title_or_url(&t.title, &t.url), t.url, tag(members.of_url(&t.url))));
        }
    }
    out.join("\n")
}

fn visited_sites(rows: &[Activity], members: &Membership, query: &str, days: i64, limit: usize) -> String {
    let words: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
    let sites: Vec<Site> = sites_since(rows, days)
        .into_iter()
        .filter(|s| {
            let hay = format!("{} {}", s.title, s.url).to_lowercase();
            words.iter().all(|w| hay.contains(w))
        })
        .collect();
    if sites.is_empty() {
        return if words.is_empty() {
            format!("No browsing recorded in the last {days} days.")
        } else {
            format!("No site matching \"{query}\" in the last {days} days.")
        };
    }
    let mut out = vec![format!("{} sites in the last {days} days{}, most-used first:",
        sites.len(), if words.is_empty() { String::new() } else { format!(" matching \"{query}\"") })];
    for s in sites.iter().take(limit) {
        let last_page = if s.title.trim().is_empty() { String::new() } else { format!(" · last page \"{}\"", short(&s.title)) };
        out.push(format!("  - {} ({}) · {} over {}{}{}{}",
            s.domain, s.url, minutes(s.dwell_ms), days_label(s.active_days), last_seen(s), last_page,
            tag(members.of_domain(&s.domain))));
    }
    if sites.len() > limit {
        out.push(format!("  … {} more (raise limit or narrow the query)", sites.len() - limit));
    }
    out.join("\n")
}

async fn unfiled_pages(rows: &[Activity], tabs: &[Tab], members: &Membership, days: i64, limit: usize) -> String {
    #[derive(Default)]
    struct Group { tabs: Vec<(String, String)>, history: Option<String>, dwell_ms: i64 }
    let usage: HashMap<String, Site> = sites_since(rows, days)
        .into_iter()
        .map(|s| (s.domain.clone(), s))
        .collect();
    let mut groups: HashMap<String, Group> = HashMap::new();

    // Open tabs are the only page-level signal: unfiled means this exact url
    // isn't saved anywhere.
    let mut seen: HashSet<String> = HashSet::new();
    for t in tabs.iter().filter(|t| is_page(&t.url)) {
        if !members.of_url(&t.url).is_empty() || !seen.insert(norm_url(&t.url)) {
            continue;
        }
        let Some(domain) = domain_of(&t.url) else { continue };
        groups.entry(domain).or_default().tabs.push((t.title.clone(), t.url.clone()));
    }
    // History is per site, so a site is unfiled only when no workspace links to it at all.
    for (domain, site) in &usage {
        if members.of_domain(domain).is_empty() {
            groups.entry(domain.clone()).or_default().history = Some(format!(
                "{} over {}{}{}",
                minutes(site.dwell_ms), days_label(site.active_days), last_seen(site),
                if site.title.trim().is_empty() { String::new() } else { format!(" (\"{}\")", short(&site.title)) },
            ));
        }
    }
    for (domain, g) in groups.iter_mut() {
        g.dwell_ms = usage.get(domain).map_or(0, |s| s.dwell_ms);
    }

    if groups.is_empty() {
        return format!("Every open tab, and every site used in the last {days} days, is already in a workspace.");
    }
    // An open tab is worth ~10 minutes of past use: it's what the user is doing now.
    let weight = |g: &Group| g.dwell_ms + g.tabs.len() as i64 * 600_000;
    let mut groups: Vec<(String, Group)> = groups.into_iter().collect();
    groups.sort_by(|a, b| weight(&b.1).cmp(&weight(&a.1)));

    let tab_count: usize = groups.iter().map(|(_, g)| g.tabs.len()).sum();
    let mut out = vec![format!("{} sites not in any workspace ({tab_count} unsaved open tabs; usage from the last {days} days):", groups.len())];
    let mut shown = 0;
    for (domain, g) in &groups {
        if shown >= limit {
            break;
        }
        let sample = g.tabs.first().map(|(t, u)| (u.clone(), t.clone()))
            .or_else(|| usage.get(domain).map(|s| (s.url.clone(), s.title.clone())))
            .unwrap_or_default();
        let learned = Learned::of(&sample.0, &sample.1, 3).await;
        let mut head = format!("\n{domain} — {} spent", minutes(g.dwell_ms));
        let related = members.of_domain(domain);
        if !related.is_empty() {
            head.push_str(&format!(" · other pages of this site are in: {}", related.join(", ")));
        }
        if !learned.guesses.is_empty() {
            let g: Vec<String> = learned.guesses.iter().map(|(ws, score)| format!("{ws} ({score:.1})")).collect();
            head.push_str(&format!(" · learned guesses: {}", g.join(", ")));
        }
        if !learned.declined.is_empty() {
            let d: Vec<String> = learned.declined.iter().map(|(ws, n)| format!("{ws} {}", times(*n))).collect();
            head.push_str(&format!(" · user declined putting this site in: {} — don't propose that again", d.join(", ")));
        }
        out.push(head);
        for (title, url) in g.tabs.iter().take(8) {
            out.push(format!("  - open tab: {} — {url}", title_or_url(title, url)));
        }
        if g.tabs.len() > 8 {
            out.push(format!("  … {} more open tabs on {domain}", g.tabs.len() - 8));
        }
        if let Some(h) = &g.history {
            let url = usage.get(domain).map(|s| s.url.as_str()).unwrap_or("");
            out.push(format!("  - site: {url} · {h}"));
        }
        shown += 1;
    }
    if groups.len() > shown {
        out.push(format!("\n({} more sites not shown — raise limit)", groups.len() - shown));
    }
    out.join("\n")
}

fn site_usage(rows: &[Activity], members: &Membership, days: i64, limit: usize) -> String {
    let mut totals: Vec<(String, (u64, u32))> = site_totals(rows, days).into_iter().collect();
    if totals.is_empty() {
        return format!("No site usage recorded in the last {days} days.");
    }
    totals.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));
    let mut out = vec![format!("Time per site, last {days} days:")];
    for (domain, (secs, active_days)) in totals.iter().take(limit) {
        out.push(format!("  - {domain} · {} · {}{}",
            minutes(*secs as i64 * 1000), days_label(*active_days), tag(members.of_domain(domain))));
    }
    out.join("\n")
}

async fn app_usage(days: u32, limit: usize) -> String {
    let usage = crate::sidecar::sampler::get_usage(None, Some(days)).await;
    let mut apps: Vec<(&String, &Value)> = usage["totals"].as_object().map(|m| m.iter().collect()).unwrap_or_default();
    apps.retain(|(_, v)| v["activeS"].as_u64().unwrap_or(0) > 0);
    if apps.is_empty() {
        return format!("No app usage recorded in the last {days} days.");
    }
    apps.sort_by(|a, b| b.1["activeS"].as_u64().cmp(&a.1["activeS"].as_u64()));
    let mut out = vec![format!("Time per app, last {days} days:")];
    for (name, v) in apps.into_iter().take(limit) {
        out.push(format!("  - {name} · {}", minutes(v["activeS"].as_u64().unwrap_or(0) as i64 * 1000)));
        let mut ctx: Vec<(&String, u64)> = v["contexts"].as_object()
            .map(|m| m.iter().map(|(k, s)| (k, s.as_u64().unwrap_or(0))).collect())
            .unwrap_or_default();
        ctx.sort_by(|a, b| b.1.cmp(&a.1));
        for (c, secs) in ctx.into_iter().take(5) {
            out.push(format!("      {c} · {}", minutes(secs as i64 * 1000)));
        }
    }
    out.join("\n")
}

fn list_apps(query: &str, limit: usize) -> String {
    let cache = crate::APP_CACHE.read().map(|c| c.clone()).unwrap_or_default();
    if cache.is_empty() {
        return "The app list hasn't been scanned yet.".into();
    }
    let q = query.to_lowercase();
    let mut apps: Vec<&Value> = cache.iter().filter(|a| {
        if q.is_empty() {
            return a["isRunning"].as_bool().unwrap_or(false);
        }
        let mut hay = format!("{} {}", a["name"].as_str().unwrap_or(""), a["title"].as_str().unwrap_or(""));
        for t in a["titles"].as_array().into_iter().flatten() {
            hay.push(' ');
            hay.push_str(t.as_str().unwrap_or(""));
        }
        hay.to_lowercase().contains(&q)
    }).collect();
    apps.sort_by_key(|a| !a["isRunning"].as_bool().unwrap_or(false));
    if apps.is_empty() {
        return if q.is_empty() { "No running apps reported.".into() } else { format!("No app matching \"{query}\".") };
    }
    let mut out = vec![if q.is_empty() { "Running apps:".to_string() } else { format!("Apps matching \"{query}\":") }];
    for a in apps.into_iter().take(limit) {
        let name = a["title"].as_str().filter(|s| !s.is_empty()).or(a["name"].as_str()).unwrap_or("?");
        let path = a["path"].as_str().unwrap_or("");
        let running = if a["isRunning"].as_bool().unwrap_or(false) { " · running" } else { "" };
        let windows: Vec<&str> = a["titles"].as_array().into_iter().flatten().filter_map(|t| t.as_str()).take(3).collect();
        let windows = if windows.is_empty() { String::new() } else { format!(" · windows: {}", windows.join(" | ")) };
        out.push(format!("  - {name}  [{path}]{running}{windows}"));
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, url: &str, ts: i64, time: i64) -> Activity {
        Activity { id: Some(id.into()), url: Some(url.into()), title: Some("T".into()), timestamp: Some(ts), time: Some(time), ..Default::default() }
    }

    #[test]
    fn a_site_keeps_its_latest_page() {
        let now = now_ms();
        let mut old = row("s1", "https://example-shop.test", now - 3000, 60_000);
        old.title = Some("Pricing".into());
        let mut new = row("s2", "https://example-shop.test", now - 1000, 60_000);
        new.title = Some("Docs".into());
        let sites = sites_since(&[old, new], 1);
        let site = sites.iter().find(|s| s.domain == "example-shop.test").unwrap();
        assert_eq!(site.title, "Docs");
    }

    #[test]
    fn local_and_old_rows_are_skipped() {
        let now = now_ms();
        let rows = vec![
            row("a", "http://localhost:5173/", now, 60_000),
            row("b", "https://github.com/", now - 30 * DAY_MS, 60_000),
            row("c", "http://0.1", now, 60_000),
        ];
        // Persisted day rollups on this machine may add sites; none of these rows may.
        let sites = sites_since(&rows, 14);
        assert!(sites.iter().all(|s| s.domain != "localhost" && s.domain != "0.0.0.1"));
        assert!(sites.iter().all(|s| s.last_ts != now - 30 * DAY_MS));
    }

    #[tokio::test]
    async fn notifications_get_no_reply_and_unknown_methods_error() {
        let state = AppState {
            sync_data: Default::default(),
            change_tracker: Arc::new(tokio::sync::RwLock::new(crate::sidecar::storage::ChangeTracker::new())),
            ws_broadcast: tokio::sync::broadcast::channel(1).0,
            pending_jumps: Default::default(),
            pending_closes: Default::default(),
        };
        assert!(handle_message(&state, json!({"jsonrpc":"2.0","method":"notifications/initialized"})).await.is_none());
        let r = handle_message(&state, json!({"jsonrpc":"2.0","id":1,"method":"nope"})).await.unwrap();
        assert_eq!(r["error"]["code"], -32601);
        let r = handle_message(&state, json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})).await.unwrap();
        assert!(r["result"]["tools"].as_array().unwrap().len() >= 5);
    }
}
