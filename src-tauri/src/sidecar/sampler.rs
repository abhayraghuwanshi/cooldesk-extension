// Focus sampler: attributes wall-clock time to desktop apps using three signals
// (foreground window, input recency, audio emission) and persists one small JSON
// file per day under sync-data/activity/ — separate from the big sync-data.json.
//
// Attribution per 30s sample (active and passive never blend):
//   focused + recent input            -> focused app gains ACTIVE time
//   focused + idle + audible          -> focused app gains MEDIA time
//   audible + not focused             -> that app gains PASSIVE MEDIA time
//   idle + silent                     -> nothing (open != used)
//
// Input recency uses a decay window rather than a hard cutoff so reading/thinking
// (bursty input) keeps earning credit: full weight <= 120s idle, half to 300s.
// Design: docs/PROJECT_INTERVIEW_BANK.md "focus sampler" section.

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::RwLock;

const SAMPLE_SECS: u64 = 30;
const FLUSH_EVERY_SAMPLES: u32 = 10; // ~5 minutes
const RETENTION_DAYS: i64 = 90;
const MAX_CONTEXTS_PER_APP: usize = 24;
const AUDIO_PEAK_THRESHOLD: f32 = 0.01;

// =============================================================================
// DATA MODEL — one file per day: sync-data/activity/apps-YYYY-MM-DD.json
// =============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDayUsage {
    #[serde(default)]
    pub active_s: u64,
    #[serde(default)]
    pub media_s: u64,
    #[serde(default)]
    pub passive_media_s: u64,
    /// Active seconds per window context: editor project name when the title
    /// parses as one, otherwise the raw (truncated) title. Browsers excluded —
    /// the extension already tracks per-URL engagement.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub contexts: HashMap<String, u64>,
}

/// Point-in-time capture of what was open: feeds the timeline hover
/// ("3pm — VS Code, terminal, localhost:5173, github.com").
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub ts: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub apps: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tab_domains: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub localhost: Vec<String>,
}

const MAX_SNAPSHOTS_PER_DAY: usize = 320; // every ~5 min ≈ 288/day + slack

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayUsage {
    pub date: String,
    #[serde(default)]
    pub sample_secs: u64,
    #[serde(default)]
    pub apps: HashMap<String, AppDayUsage>,
    /// Active seconds per hour ("14") per context (project/file, or app name
    /// for browsers) — the day-timeline data.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub hourly: HashMap<String, HashMap<String, u64>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub snapshots: Vec<Snapshot>,
    #[serde(default)]
    pub updated_at: i64,
}

impl DayUsage {
    fn new(date: String) -> Self {
        Self { date, sample_secs: SAMPLE_SECS, ..Default::default() }
    }
}

lazy_static::lazy_static! {
    static ref TODAY: RwLock<DayUsage> = RwLock::new(DayUsage::default());
}

// =============================================================================
// PERSISTENCE
// =============================================================================

fn activity_dir() -> PathBuf {
    crate::sidecar::storage::get_data_dir().join("activity")
}

fn day_file(date: &str) -> PathBuf {
    activity_dir().join(format!("apps-{}.json", date))
}

fn today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn load_day(date: &str) -> Option<DayUsage> {
    let content = std::fs::read_to_string(day_file(date)).ok()?;
    let mut day: DayUsage = serde_json::from_str(&content).ok()?;
    merge_decorated_keys(&mut day);
    Some(day)
}

/// Re-merge context keys recorded before decoration stripping existed (or
/// under an older strip rule) — "⠂ Build UI" folds into "Build UI".
fn merge_decorated_keys(day: &mut DayUsage) {
    for usage in day.apps.values_mut() {
        let old = std::mem::take(&mut usage.contexts);
        for (key, secs) in old {
            let clean = strip_decor(&key).trim_end().to_string();
            let clean = if clean.is_empty() { key } else { clean };
            *usage.contexts.entry(clean).or_insert(0) += secs;
        }
    }
    let old_hours = std::mem::take(&mut day.hourly);
    for (hour, per_key) in old_hours {
        let entry = day.hourly.entry(hour).or_default();
        for (key, secs) in per_key {
            let clean = strip_decor(&key).trim_end().to_string();
            let clean = if clean.is_empty() { key } else { clean };
            *entry.entry(clean).or_insert(0) += secs;
        }
    }
}

fn save_day(day: &DayUsage) {
    if day.date.is_empty() || day.apps.is_empty() {
        return;
    }
    if let Err(e) = std::fs::create_dir_all(activity_dir()) {
        log::warn!("[Sampler] cannot create activity dir: {}", e);
        return;
    }
    match serde_json::to_string_pretty(day) {
        Ok(content) => {
            if let Err(e) = std::fs::write(day_file(&day.date), content) {
                log::warn!("[Sampler] failed to save {}: {}", day.date, e);
            }
        }
        Err(e) => log::warn!("[Sampler] serialize failed: {}", e),
    }
}

fn prune_old_files() {
    let Ok(entries) = std::fs::read_dir(activity_dir()) else { return };
    let cutoff = (Local::now() - chrono::Duration::days(RETENTION_DAYS))
        .format("apps-%Y-%m-%d.json")
        .to_string();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Lexicographic compare works because of the fixed apps-YYYY-MM-DD.json shape
        if name.starts_with("apps-") && name.ends_with(".json") && name < cutoff {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

// =============================================================================
// WIN32 SIGNALS (each returns a safe default off-Windows)
// =============================================================================

/// Seconds since the last keyboard/mouse/touch/pen input, system-wide.
#[cfg(target_os = "windows")]
fn idle_seconds() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    unsafe {
        let mut lii = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut lii).as_bool() {
            (GetTickCount().wrapping_sub(lii.dwTime) / 1000) as u64
        } else {
            0
        }
    }
}

/// True when the workstation is locked (input desktop is the secure desktop).
#[cfg(target_os = "windows")]
fn session_locked() -> bool {
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_READOBJECTS,
    };
    unsafe {
        match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS) {
            Ok(h) => {
                let _ = CloseDesktop(h);
                false
            }
            Err(_) => true,
        }
    }
}

/// Lowercase exe names of processes currently emitting sound on any active
/// render device (WASAPI session peak above threshold). Browser audio runs in
/// child processes but shares the exe name, so name-level matching still works.
#[cfg(target_os = "windows")]
fn audible_app_names() -> std::collections::HashSet<String> {
    use windows::core::Interface;
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Media::Audio::{
        eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    let mut names = std::collections::HashSet::new();
    unsafe {
        let com = CoInitializeEx(None, COINIT_MULTITHREADED);
        let result: windows::core::Result<()> = (|| {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
            for d in 0..devices.GetCount()? {
                let Ok(device) = devices.Item(d) else { continue };
                let Ok(mgr) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
                    continue;
                };
                let Ok(sessions) = mgr.GetSessionEnumerator() else { continue };
                let count = sessions.GetCount().unwrap_or(0);
                for i in 0..count {
                    let Ok(ctrl) = sessions.GetSession(i) else { continue };
                    if ctrl.GetState().map(|s| s != AudioSessionStateActive).unwrap_or(true) {
                        continue;
                    }
                    let Ok(meter) = ctrl.cast::<IAudioMeterInformation>() else { continue };
                    if meter.GetPeakValue().unwrap_or(0.0) < AUDIO_PEAK_THRESHOLD {
                        continue;
                    }
                    let Ok(ctrl2) = ctrl.cast::<IAudioSessionControl2>() else { continue };
                    let Ok(pid) = ctrl2.GetProcessId() else { continue };
                    if pid == 0 {
                        continue; // system sounds session
                    }
                    if let Some(name) = process_exe_name(pid) {
                        names.insert(name);
                    }
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            log::debug!("[Sampler] audio session enum failed: {}", e);
        }
        if com.is_ok() {
            CoUninitialize();
        }
    }
    names
}

#[cfg(target_os = "windows")]
fn process_exe_name(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let res = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);
        res.ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/']).next().map(|s| s.to_lowercase())
    }
}

#[cfg(not(target_os = "windows"))]
fn idle_seconds() -> u64 {
    0
}
#[cfg(not(target_os = "windows"))]
fn session_locked() -> bool {
    false
}
#[cfg(not(target_os = "windows"))]
fn audible_app_names() -> std::collections::HashSet<String> {
    std::collections::HashSet::new()
}

// =============================================================================
// SAMPLING
// =============================================================================

/// Input-recency weight with decay: reading/thinking produces bursty input, so
/// credit fades instead of cutting off (full <=120s, half <=300s, zero after).
fn input_weight(idle_s: u64) -> f64 {
    match idle_s {
        0..=120 => 1.0,
        121..=300 => 0.5,
        _ => 0.0,
    }
}

/// Document/image extensions worth surfacing as a context of their own.
const DOC_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "psd", "ai", "fig", "xd",
    "pdf", "mp4", "mov", "mp3", "wav", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "csv", "md", "txt",
];

const TERMINAL_APPS: &[&str] = &[
    "windowsterminal", "cmd.exe", "powershell", "pwsh", "alacritty", "wezterm", "conemu",
];

/// Leading decoration some apps prepend to titles — terminal spinners
/// (braille frames, ✳), bullets, unsaved markers. Stripped so "⠂ Build UI"
/// and "Build UI" merge into ONE context instead of one per spinner frame.
fn strip_decor(title: &str) -> &str {
    title.trim_start_matches(|c: char| {
        c.is_whitespace()
            || ('\u{2800}'..='\u{28FF}').contains(&c) // braille spinner frames
            || matches!(c, '✳' | '✻' | '✽' | '·' | '•' | '●' | '*' | '∙' | '⋆' | '‣' | '◦' | '|')
    })
}

/// First filename-looking token in a window title, path prefix stripped.
/// Catches "logo.png - Paint" and "banner.psd @ 100% (RGB/8)" alike.
fn filename_in_title(title: &str) -> Option<String> {
    for raw in title.split([' ', '—', '–', '|', '(', ')', '[', ']', '"']) {
        let token = raw.trim_matches(['*', '●', '•', ',', ';', ':']);
        if let Some((stem, ext)) = token.rsplit_once('.') {
            if !stem.is_empty() && DOC_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                let name = token.rsplit(['\\', '/']).next().unwrap_or(token);
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Best available context for the focused window, most specific source first:
/// editor project > Explorer folder > terminal cwd > document filename > raw title.
/// Normalizing here lets the same folder/file merge across apps (Explorer time
/// and editor time on "extension" land in the same key).
fn normalize_context(app_name: &str, title: &str) -> String {
    let title = strip_decor(title).trim_end();
    if let Some(project) = crate::sidecar::handlers::extract_editor_project(app_name, title) {
        return project;
    }
    let name_lower = app_name.to_lowercase();

    if name_lower.starts_with("explorer") {
        if let Some(folder) = title.strip_suffix(" - File Explorer") {
            let folder = folder.trim();
            if !folder.is_empty() {
                return folder.chars().take(80).collect();
            }
        }
    }

    // Terminal titles are often the cwd — keep the last path segment
    if TERMINAL_APPS.iter().any(|t| name_lower.contains(t)) && title.contains(['\\', '/']) {
        if let Some(seg) = title.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next() {
            let seg = seg.trim();
            if !seg.is_empty() {
                return seg.chars().take(80).collect();
            }
        }
    }

    if let Some(file) = filename_in_title(title) {
        return file;
    }

    title.chars().take(80).collect()
}

fn add_context(app: &mut AppDayUsage, context: String, secs: u64) {
    if app.contexts.len() >= MAX_CONTEXTS_PER_APP && !app.contexts.contains_key(&context) {
        *app.contexts.entry("(other)".to_string()).or_insert(0) += secs;
    } else {
        *app.contexts.entry(context).or_insert(0) += secs;
    }
}

async fn sample_once(
    state: &std::sync::Arc<crate::sidecar::handlers::AppState>,
    last_focused: &mut Option<String>,
) -> bool {
    if session_locked() {
        return false;
    }

    let date = today_str();
    // Day rollover: persist the finished day, start a fresh aggregate.
    {
        let mut today = TODAY.write().await;
        if today.date != date {
            save_day(&today);
            *today = load_day(&date).unwrap_or_else(|| DayUsage::new(date.clone()));
        }
    }

    let idle = idle_seconds();
    let weight = input_weight(idle);
    let audible = tokio::task::spawn_blocking(audible_app_names)
        .await
        .unwrap_or_default();

    if weight == 0.0 && audible.is_empty() {
        return false; // idle + silent: nothing to attribute
    }

    let focused = crate::system::get_focused_app_info().await;
    let focused_name = focused.as_ref().map(|a| a.name.to_lowercase());

    let mut today = TODAY.write().await;
    let mut recorded = false;

    if let (Some(name), Some(app)) = (&focused_name, &focused) {
        if weight > 0.0 {
            let secs = (SAMPLE_SECS as f64 * weight) as u64;
            // No contexts for browsers (extension owns per-URL detail) or for
            // CoolDesk itself (its own window titles are not a "project").
            let is_self = name.contains("cooldesk");
            let context = (!is_self
                && !crate::system::is_browser(&app.name)
                && !app.title.is_empty())
            .then(|| normalize_context(&app.name, &app.title))
            .filter(|c| !c.is_empty());

            let entry = today.apps.entry(name.clone()).or_default();
            entry.active_s += secs;
            if let Some(ctx) = &context {
                add_context(entry, ctx.clone(), secs);
            }

            // Hour bucket keyed by context when we have one, app name otherwise
            // (browsers land under their app name; the extension owns per-URL detail).
            let hour = Local::now().format("%H").to_string();
            let hour_key = context.unwrap_or_else(|| name.clone());
            *today.hourly.entry(hour).or_default().entry(hour_key).or_insert(0) += secs;
            // Focus moved to a different app: notify the frontend feed. This
            // replaced the old visible-apps tracker loop that persisted app
            // rows into sync-data.json — the event shape stays the same.
            if last_focused.as_ref() != Some(name) && !crate::system::is_browser(&app.name) {
                let now = chrono::Utc::now().timestamp_millis();
                state.broadcast(
                    "activity-updated",
                    json!([{
                        "id": format!("activity-{}", now),
                        "timestamp": now,
                        "type": "app",
                        "url": app.path,
                        "title": app.title,
                        "appName": app.name,
                        "createdAt": now,
                        "updatedAt": now
                    }]),
                );
            }
            *last_focused = Some(name.clone());
            recorded = true;
        } else if audible.contains(name) {
            today.apps.entry(name.clone()).or_default().media_s += SAMPLE_SECS;
            recorded = true;
        }
    }

    for name in &audible {
        if Some(name) == focused_name.as_ref() {
            continue; // already attributed above (active or media)
        }
        today.apps.entry(name.clone()).or_default().passive_media_s += SAMPLE_SECS;
        recorded = true;
    }

    if recorded {
        today.updated_at = chrono::Utc::now().timestamp_millis();
    }
    recorded
}

/// True for hostnames that are local dev servers rather than real sites.
fn is_local_host(host: &str) -> bool {
    host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.starts_with("127.")
        || host == "0.0.0.0"
        || host == "[::1]"
}

/// Capture what's open right now (visible apps + tab domains + dev servers)
/// into the day's snapshot ring buffer.
async fn capture_snapshot(state: &std::sync::Arc<crate::sidecar::handlers::AppState>) {
    let visible = crate::system::get_visible_apps_info().await;
    let mut apps: Vec<String> = Vec::new();
    for app in &visible {
        if crate::system::is_browser(&app.name) {
            continue;
        }
        let name = app.name.to_lowercase();
        if !apps.contains(&name) {
            apps.push(name);
        }
    }

    let (mut tab_domains, mut localhost) = (Vec::new(), Vec::new());
    {
        let data = state.sync_data.read().await;
        let mut seen = std::collections::HashSet::new();
        for tab in data.device_tabs_map.values().flatten() {
            let Ok(parsed) = url::Url::parse(&tab.url) else { continue };
            let Some(host) = parsed.host_str() else { continue };
            let host = host.strip_prefix("www.").unwrap_or(host).to_lowercase();
            if !seen.insert(host.clone()) {
                continue;
            }
            if is_local_host(&host) {
                let entry = match parsed.port() {
                    Some(p) => format!("{}:{}", host, p),
                    None => host,
                };
                if localhost.len() < 8 {
                    localhost.push(entry);
                }
            } else if tab_domains.len() < 12 {
                tab_domains.push(host);
            }
        }
    }

    if apps.is_empty() && tab_domains.is_empty() && localhost.is_empty() {
        return;
    }

    let mut today = TODAY.write().await;
    today.snapshots.push(Snapshot {
        ts: chrono::Utc::now().timestamp_millis(),
        apps,
        tab_domains,
        localhost,
    });
    if today.snapshots.len() > MAX_SNAPSHOTS_PER_DAY {
        let excess = today.snapshots.len() - MAX_SNAPSHOTS_PER_DAY;
        today.snapshots.drain(0..excess);
    }
}

/// Background loop: sample every 30s; every ~5 minutes capture a snapshot of
/// what's open and flush to the day file. Spawned from the sidecar on Windows.
pub async fn run_sampler_loop(state: std::sync::Arc<crate::sidecar::handlers::AppState>) {
    prune_old_files();
    {
        let date = today_str();
        let mut today = TODAY.write().await;
        *today = load_day(&date).unwrap_or_else(|| DayUsage::new(date));
    }
    log::info!("[Sampler] focus sampler started ({}s interval)", SAMPLE_SECS);

    let mut interval = tokio::time::interval(std::time::Duration::from_secs(SAMPLE_SECS));
    interval.tick().await; // skip immediate tick
    let mut unsaved: u32 = 0;
    let mut tick: u32 = 0;
    let mut last_focused: Option<String> = None;

    loop {
        interval.tick().await;
        tick = tick.wrapping_add(1);
        if sample_once(&state, &mut last_focused).await {
            unsaved += 1;
        }
        if tick % FLUSH_EVERY_SAMPLES == 0 {
            if !session_locked() {
                capture_snapshot(&state).await;
            }
            if unsaved > 0 {
                save_day(&*TODAY.read().await);
                unsaved = 0;
            }
        }
    }
}

// =============================================================================
// READ API (used by the /activity/app-usage handler)
// =============================================================================

/// Per-key daily series + direction over the requested window. `extract` picks
/// what to trend from each day (app active time, or context active time).
fn trend_series<F>(list: &[DayUsage], extract: F) -> Vec<Value>
where
    F: Fn(&DayUsage, &mut HashMap<String, u64>),
{
    let n = list.len();
    let mut by_key: HashMap<String, Vec<u64>> = HashMap::new();
    for (i, day) in list.iter().enumerate() {
        let mut day_vals: HashMap<String, u64> = HashMap::new();
        extract(day, &mut day_vals);
        for (key, secs) in day_vals {
            by_key.entry(key).or_insert_with(|| vec![0; n])[i] = secs;
        }
    }

    let mut rows: Vec<(String, Vec<u64>, u64)> = by_key
        .into_iter()
        .map(|(key, daily)| {
            let total = daily.iter().sum();
            (key, daily, total)
        })
        .collect();
    rows.sort_by_key(|(_, _, total)| std::cmp::Reverse(*total));

    rows.into_iter()
        .map(|(key, daily, total)| {
            // Compare first vs second half of the window to get a direction.
            let half = daily.len() / 2;
            let (first, second) = daily.split_at(daily.len() - half);
            let avg = |xs: &[u64]| {
                if xs.is_empty() { 0.0 } else { xs.iter().sum::<u64>() as f64 / xs.len() as f64 }
            };
            let (a, b) = (avg(first), avg(second));
            let (direction, change_pct) = if a == 0.0 && b > 0.0 {
                ("new", 100.0)
            } else if a == 0.0 {
                ("steady", 0.0)
            } else {
                let pct = (b - a) / a * 100.0;
                let dir = if pct > 25.0 { "rising" } else if pct < -25.0 { "falling" } else { "steady" };
                (dir, pct)
            };
            json!({
                "name": key,
                "totalActiveS": total,
                "dailyActiveS": daily,
                "direction": direction,
                "changePct": change_pct.round(),
            })
        })
        .collect()
}

/// Trends across a window of days: per-app and per-context (project/file)
/// active-time series, sorted by total, each with a rising/falling direction.
fn compute_trends(list: &[DayUsage]) -> Value {
    let apps = trend_series(list, |day, out| {
        for (name, usage) in &day.apps {
            *out.entry(name.clone()).or_insert(0) += usage.active_s;
        }
    });
    let contexts = trend_series(list, |day, out| {
        for usage in day.apps.values() {
            for (ctx, secs) in &usage.contexts {
                *out.entry(ctx.clone()).or_insert(0) += secs;
            }
        }
    });
    json!({ "apps": apps, "contexts": contexts })
}

/// `date=None, days=None` -> today (live). `date=YYYY-MM-DD` -> that day.
/// `days=N` -> the last N days plus per-app totals and trends across them.
pub async fn get_usage(date: Option<String>, days: Option<u32>) -> Value {
    let today = today_str();

    if let Some(n) = days {
        let n = n.clamp(1, RETENTION_DAYS as u32);
        let mut list: Vec<DayUsage> = Vec::new();
        for i in (0..n).rev() {
            let d = (Local::now() - chrono::Duration::days(i as i64))
                .format("%Y-%m-%d")
                .to_string();
            if d == today {
                let live = TODAY.read().await.clone();
                if !live.date.is_empty() {
                    list.push(live);
                }
            } else if let Some(day) = load_day(&d) {
                list.push(day);
            }
        }
        // Multi-day responses are for trends; drop the per-day detail payloads
        // (a 30-day window would otherwise ship ~10k snapshot entries). Fetch a
        // single date to get hourly + snapshots.
        for day in &mut list {
            day.hourly.clear();
            day.snapshots.clear();
        }

        let mut totals: HashMap<String, AppDayUsage> = HashMap::new();
        for day in &list {
            for (name, usage) in &day.apps {
                let t = totals.entry(name.clone()).or_default();
                t.active_s += usage.active_s;
                t.media_s += usage.media_s;
                t.passive_media_s += usage.passive_media_s;
                for (ctx, secs) in &usage.contexts {
                    *t.contexts.entry(ctx.clone()).or_insert(0) += secs;
                }
            }
        }
        return json!({ "days": list, "totals": totals, "trends": compute_trends(&list) });
    }

    let d = date.unwrap_or_else(|| today.clone());
    if d == today {
        json!(TODAY.read().await.clone())
    } else {
        load_day(&d)
            .map(|day| json!(day))
            .unwrap_or_else(|| json!(DayUsage::new(d)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_input_weight_decay() {
        assert_eq!(input_weight(0), 1.0);
        assert_eq!(input_weight(120), 1.0);
        assert_eq!(input_weight(121), 0.5);
        assert_eq!(input_weight(300), 0.5);
        assert_eq!(input_weight(301), 0.0);
    }

    #[test]
    fn test_context_cap_overflows_into_other() {
        let mut app = AppDayUsage::default();
        for i in 0..MAX_CONTEXTS_PER_APP {
            add_context(&mut app, format!("ctx{}", i), 30);
        }
        add_context(&mut app, "one-too-many".to_string(), 30);
        add_context(&mut app, "another".to_string(), 30);
        assert_eq!(app.contexts.len(), MAX_CONTEXTS_PER_APP + 1); // cap + "(other)"
        assert_eq!(app.contexts.get("(other)"), Some(&60));
        // Existing keys still accumulate past the cap
        add_context(&mut app, "ctx0".to_string(), 30);
        assert_eq!(app.contexts.get("ctx0"), Some(&60));
    }

    #[test]
    fn test_normalize_context_sources() {
        // Editor project (via extract_editor_project)
        assert_eq!(
            normalize_context("Code.exe", "sampler.rs — extension — Visual Studio Code"),
            "extension"
        );
        // File Explorer folder merges with the editor's project key
        assert_eq!(
            normalize_context("explorer.exe", "extension - File Explorer"),
            "extension"
        );
        // Terminal cwd → last path segment
        assert_eq!(
            normalize_context("WindowsTerminal.exe", r"C:\Users\raghu\projects\extension"),
            "extension"
        );
        // Terminal with a non-path title falls through to the raw title
        assert_eq!(
            normalize_context("WindowsTerminal.exe", "Design multi-agent system"),
            "Design multi-agent system"
        );
        // Image files in viewers/editors
        assert_eq!(normalize_context("mspaint.exe", "logo-2.png - Paint"), "logo-2.png");
        assert_eq!(
            normalize_context("Photoshop.exe", "banner.psd @ 100% (RGB/8)"),
            "banner.psd"
        );
        // Unsaved-marker and path prefixes stripped from filename tokens
        assert_eq!(
            normalize_context("notepad.exe", r"*C:\notes\todo.md - Notepad"),
            "todo.md"
        );
        // Terminal spinner frames (Claude Code tab titles) merge into one key
        assert_eq!(
            normalize_context("WindowsTerminal.exe", "✳ Design multi-agent system"),
            normalize_context("WindowsTerminal.exe", "⠂ Design multi-agent system")
        );
        assert_eq!(
            normalize_context("WindowsTerminal.exe", "· Design multi-agent system"),
            "Design multi-agent system"
        );
        // No signal at all -> raw title fallback
        assert_eq!(normalize_context("someapp.exe", "Main Window"), "Main Window");
    }

    fn day_with(date: &str, app: &str, ctx: &str, active_s: u64) -> DayUsage {
        let mut day = DayUsage::new(date.to_string());
        let entry = day.apps.entry(app.to_string()).or_default();
        entry.active_s = active_s;
        entry.contexts.insert(ctx.to_string(), active_s);
        day
    }

    #[test]
    fn test_trends_directions() {
        // code.exe ramps up 1h -> 4h; figma appears only in the second half
        let mut days = vec![
            day_with("2026-07-01", "code.exe", "extension", 3600),
            day_with("2026-07-02", "code.exe", "extension", 3600),
            day_with("2026-07-03", "code.exe", "extension", 14400),
            day_with("2026-07-04", "code.exe", "extension", 14400),
        ];
        days[2].apps.entry("figma.exe".to_string()).or_default().active_s = 7200;
        days[3].apps.entry("figma.exe".to_string()).or_default().active_s = 7200;

        let trends = compute_trends(&days);
        let apps = trends["apps"].as_array().unwrap();

        // Sorted by total: code.exe (10h) first, figma (4h) second
        assert_eq!(apps[0]["name"], "code.exe");
        assert_eq!(apps[0]["direction"], "rising"); // 1h avg -> 4h avg
        assert_eq!(apps[0]["totalActiveS"], 36000);
        assert_eq!(apps[1]["name"], "figma.exe");
        assert_eq!(apps[1]["direction"], "new"); // absent in first half

        // Context series aggregates across apps
        let contexts = trends["contexts"].as_array().unwrap();
        assert_eq!(contexts[0]["name"], "extension");
        assert_eq!(contexts[0]["dailyActiveS"], json!([3600, 3600, 14400, 14400]));
    }

    #[test]
    fn test_day_usage_roundtrip() {
        let mut day = DayUsage::new("2026-01-01".to_string());
        let entry = day.apps.entry("code.exe".to_string()).or_default();
        entry.active_s = 300;
        entry.contexts.insert("extension".to_string(), 300);
        day.hourly
            .entry("14".to_string())
            .or_default()
            .insert("extension".to_string(), 300);
        day.snapshots.push(Snapshot {
            ts: 1,
            apps: vec!["code.exe".to_string()],
            tab_domains: vec!["github.com".to_string()],
            localhost: vec!["localhost:5173".to_string()],
        });
        let json_str = serde_json::to_string(&day).unwrap();
        let back: DayUsage = serde_json::from_str(&json_str).unwrap();
        assert_eq!(back.apps["code.exe"].active_s, 300);
        assert_eq!(back.apps["code.exe"].contexts["extension"], 300);
        assert_eq!(back.hourly["14"]["extension"], 300);
        assert_eq!(back.snapshots[0].localhost, vec!["localhost:5173"]);

        // Old day files (no hourly/snapshots) must still parse
        let legacy: DayUsage =
            serde_json::from_str(r#"{"date":"2026-01-01","sampleSecs":30,"apps":{},"updatedAt":0}"#)
                .unwrap();
        assert!(legacy.hourly.is_empty() && legacy.snapshots.is_empty());
    }

    #[test]
    fn test_is_local_host() {
        for h in ["localhost", "app.localhost", "127.0.0.1", "0.0.0.0", "mybox.local"] {
            assert!(is_local_host(h), "{} should be local", h);
        }
        for h in ["github.com", "127a.example.com", "local.example.com"] {
            assert!(!is_local_host(h), "{} should NOT be local", h);
        }
    }

    // Smoke test the real Win32 signals on this machine: must not panic or hang.
    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn test_win32_signals_smoke() {
        assert!(!session_locked(), "test runs in an unlocked session");
        let idle = idle_seconds();
        assert!(idle < 3600, "idle {}s implausible while tests run", idle);
        let audible = tokio::task::spawn_blocking(audible_app_names).await.unwrap();
        // Just exercise the COM path; content depends on what's playing.
        println!("audible now: {:?}", audible);
        let (ws_tx, _) = tokio::sync::broadcast::channel::<String>(8);
        let state = std::sync::Arc::new(crate::sidecar::handlers::AppState::new(ws_tx));
        let mut last_focused = None;
        let recorded = sample_once(&state, &mut last_focused).await;
        let today = TODAY.read().await;
        println!("sample recorded={} apps={:?}", recorded, today.apps.keys());
    }
}
