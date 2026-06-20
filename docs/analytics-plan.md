# CoolDesk Analytics — Implementation Plan

## Goal

Know **daily active users**, **installations**, and **spotlight engagement** —
without a third-party SDK, without a leakable "secret" (impossible in an
open-source client anyway), and with a single disclosed, opt-out daily ping that
rides infrastructure we already own (Cloudflare + `cool-desk.com`).

## Why this shape

- The app already phones home for update checks (`check_winget_update` in
  `src-tauri/src/lib.rs:57`, and the Tauri updater hitting `latest.json`). We
  reuse that heartbeat instead of adding a new SDK.
- Those checks currently hit GitHub, which gives us no analytics. We point the
  check at **our own Cloudflare Worker**, which proxies GitHub's latest release
  (update-check keeps working) **and** records the ping.
- An open-source client has no secrets: any ingest endpoint/key is public and
  spoofable. We accept best-effort counts — fine at this scale — rather than
  pretending otherwise.

## The payload (one ping per app, ~once/day)

```json
{
  "install_id": "<random UUID, generated once, stored locally>",
  "date": "2026-06-20",
  "os": "windows",
  "app_version": "1.2.7",
  "install_source": "winget",
  "locale": "en",
  "spotlight_opens": 14
}
```

- **All scalar, no free-text, no per-action stream.** Never send search queries,
  URLs, or tab/workspace titles — that is the invasive line we do not cross.
- `spotlight_opens` is the count accumulated locally since the last ping, then
  reset to 0.
- Everything else (new vs returning, DAU/WAU/MAU, retention, churn) is **derived
  server-side** from `install_id` + `date` — we do not send flags for it.

## Components to build

### 1. Cloudflare Worker — `cool-desk.com/api/version`
- On `GET`/`POST`: read the JSON body (the payload above), insert a row into D1,
  and return the latest GitHub release JSON (proxied/cached) so the client's
  update check still works from one endpoint.
- Cache the GitHub upstream (~5 min) to avoid rate limits.
- Basic hygiene: ignore malformed bodies; optional per-IP rate limit. Do **not**
  store IPs.

### 2. D1 schema
```sql
CREATE TABLE pings (
  install_id      TEXT NOT NULL,
  date            TEXT NOT NULL,        -- YYYY-MM-DD (UTC)
  os              TEXT,
  app_version     TEXT,
  install_source  TEXT,
  locale          TEXT,
  spotlight_opens INTEGER DEFAULT 0,
  PRIMARY KEY (install_id, date)        -- one row per install per day; re-ping updates it
);
```
Queries:
- **DAU** = `SELECT COUNT(DISTINCT install_id) FROM pings WHERE date = ?`
- **Installs (total)** = `SELECT COUNT(DISTINCT install_id) FROM pings`
- **New installs/day** = first-seen date per `install_id`
- **Spotlight/day** = `SELECT SUM(spotlight_opens) FROM pings WHERE date = ?`

### 3. Rust client — `src-tauri/src/lib.rs`
- Repoint `check_winget_update` (`lib.rs:57`) from
  `api.github.com/.../releases/latest` to `https://cool-desk.com/api/version`,
  sending the payload. Keep parsing `tag_name`/`html_url` from the proxied
  response so `UpdateInfo` is unchanged and the Settings UI keeps working as-is.
- **install_id**: generate a UUID once, persist via `tauri-plugin-store` (or a
  file in the app data dir); read it on each ping.
- **install_source**: stamped at build time (see §5); read from an env/baked
  constant. Fallback `"unknown"`.
- **os/locale**: from `std::env::consts::OS` and the system locale; `app_version`
  from `app.package_info().version`.
- Gate the whole send behind the opt-out flag (§4): if disabled, still do the
  update check against GitHub directly (or skip the analytics body).

### 4. Spotlight counter + opt-out toggle (frontend)
- **Counter**: in `src/components/GlobalSpotlight.jsx`, increment a
  `localStorage` counter (`spotlight_opens`) on open — the focus/mount path
  around `GlobalSpotlight.jsx:259-273`. The Rust ping reads + resets it (exposed
  via a tiny Tauri command, or written to the shared store the ping reads).
- **Opt-out**: add an "Anonymous usage stats" toggle in the **Updates** section
  of `src/components/popups/SettingsModal.jsx` (mirror the `autoUpdateEnabled`
  pattern at `SettingsModal.jsx:843-848`; persist via `storageSet`). Default
  per your privacy policy / target regions.

### 5. `install_source` build stamp
- Distribution channels: `winget`, `github`, `dmg`, (later) `store`.
- Stamp at build time via an env var the release workflow sets per target, baked
  into the binary (e.g. `env!("COOLDESK_INSTALL_SOURCE")` with a build.rs default
  of `"unknown"`). Wire it in `.github/workflows/release.yml` per matrix entry.

### 6. Disclosure (required)
- One short paragraph in a privacy doc + a link from Settings: what's collected
  (the 7 scalar fields), that it's anonymous, and how to opt out. This is what
  keeps us onside with Chrome Web Store / Microsoft Store policy and GDPR.

## Explicitly out of scope (keep it simple)
- ❌ Search queries / URLs / titles, workspace or tab counts.
- ❌ Per-event streams, precise geo, IP storage, hardware fingerprinting.
- ❌ Third-party analytics SDK (Aptabase/PostHog/GA) — not needed.

## Verification
- Worker: `curl -X POST https://cool-desk.com/api/version -d '<sample payload>'`
  returns latest-release JSON; confirm a row lands in D1.
- Client: run the app, open Settings → "Check for updates"; confirm one row with
  the right `os`/`app_version`/`install_source`, and that `spotlight_opens`
  reflects opens since last ping then resets.
- Opt-out: toggle off → confirm no analytics body is sent (update check still
  works).
- Dashboards: run the DAU / installs / spotlight queries against D1 and sanity-
  check against your own usage.
