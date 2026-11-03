# CoolDesk Analytics Worker

A Cloudflare Worker that backs CoolDesk's anonymous usage analytics. It proxies
the latest GitHub release (so the desktop app's update check works from one URL)
and records an anonymous daily ping into a D1 database.

**What it stores:** `install_id` (random UUID, no identity), UTC `date`, `os`,
`app_version`, `install_source`, coarse `locale`, and a `spotlight_opens`
counter. No IPs, no search queries, no URLs, no personal data.

## Deploy

```bash
cd worker
npm install -g wrangler        # or: npx wrangler ...
wrangler login

# 1. Create the D1 database, then paste the printed database_id into wrangler.toml
wrangler d1 create cooldesk-analytics

# 2. Apply the schema
wrangler d1 execute cooldesk-analytics --remote --file=schema.sql

# 3. Deploy
wrangler deploy
```

Then route `cool-desk.com/api/version` to the Worker — either uncomment the
`[[routes]]` block in `wrangler.toml` (if the zone is on this account) or add a
Custom Domain / route in the Cloudflare dashboard. The desktop client posts to
`https://cool-desk.com/api/version`; until the route is live it transparently
falls back to GitHub, so nothing breaks.

## Verify

```bash
# Returns the latest release JSON and records a ping:
curl -X POST https://cool-desk.com/api/version \
  -H 'content-type: application/json' \
  -d '{"install_id":"test-123","os":"windows","app_version":"1.2.8","install_source":"winget","locale":"en","spotlight_opens":3}'

# Inspect the data:
wrangler d1 execute cooldesk-analytics --remote \
  --command "SELECT * FROM pings ORDER BY date DESC LIMIT 10"
```

## Upgrading an existing database (usage analytics v2, app 2.0.18+)

Order matters — migrate first, then deploy. The migration is additive, so the
current worker and every shipped app keep working against it; the new worker
writes columns that only exist after it.

```bash
wrangler d1 execute cooldesk-analytics --remote --file=migrations/0002_usage_v2.sql
wrangler deploy
```

Ship the 2.0.18 app only after both. (An older worker would still answer, but
it ignores the new counters, and the app would clear them as delivered.)

## What a ping means

| Field | Meaning |
|---|---|
| `event` | `first_run` — sent from Rust on the launch that created the install id, before any window. `heartbeat` — from the main window: at launch, every 6h, and on the first input of a new UTC day. |
| `ui_seen` | 0 when only the first-run ping arrived that day: the app started but its window never loaded. |
| `active_minutes` | Minutes with any input (click, key, scroll) in a CoolDesk window. **Use `active_minutes > 0` for real usage** — a row alone only means the app was running. |
| `channel` | `release` (tagged CI build), `test` (manual CI run), `local` (release build on a dev machine), `dev` (debug). Filter on `release`. |
| `install_source` | Windows: `winget`, `direct`, `msi` or `legacy` (installed before the marker existed). macOS `dmg`, Linux `linux`. |
| `ping_failures` | Earlier pings that didn't reach this endpoint (offline, blocked). Their counters arrive late, not lost. |

Every new column is NULL / default for rows written by app versions before
2.0.18, so filter on `app_version >= '2.0.18'` (or `channel = 'release'`) when
comparing like with like.

## Metrics (run against D1)

```sql
-- Daily active users: installs with real input that day
SELECT date, COUNT(*) AS dau
FROM pings WHERE channel = 'release' AND active_minutes > 0
GROUP BY date ORDER BY date DESC;

-- Daily running installs (includes idle), the old "DAU"
SELECT date, COUNT(DISTINCT install_id) AS running FROM pings GROUP BY date ORDER BY date DESC;

-- WAU / MAU (active)
SELECT COUNT(DISTINCT CASE WHEN date >= date('now','-6 day')  THEN install_id END) AS wau,
       COUNT(DISTINCT CASE WHEN date >= date('now','-29 day') THEN install_id END) AS mau
FROM pings WHERE channel = 'release' AND active_minutes > 0;

-- New installs per day, and how many never got a window up
SELECT date, COUNT(*) AS first_runs, SUM(ui_seen = 0) AS ui_never_loaded
FROM pings WHERE first_run = 1 AND channel = 'release'
GROUP BY date ORDER BY date DESC;

-- Day-1 / day-7 / day-30 retention by first-seen week (active days only)
WITH first AS (
  SELECT install_id, MIN(date) AS d0 FROM pings
  WHERE channel = 'release' GROUP BY install_id
), act AS (
  SELECT DISTINCT install_id, date FROM pings WHERE active_minutes > 0
)
SELECT strftime('%Y-W%W', f.d0) AS cohort, COUNT(DISTINCT f.install_id) AS installs,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN julianday(a.date) - julianday(f.d0) BETWEEN 1 AND 1   THEN f.install_id END) / COUNT(DISTINCT f.install_id), 1) AS d1_pct,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN julianday(a.date) - julianday(f.d0) BETWEEN 7 AND 13  THEN f.install_id END) / COUNT(DISTINCT f.install_id), 1) AS d7_pct,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN julianday(a.date) - julianday(f.d0) BETWEEN 30 AND 59 THEN f.install_id END) / COUNT(DISTINCT f.install_id), 1) AS d30_pct
FROM first f LEFT JOIN act a USING (install_id)
GROUP BY cohort ORDER BY cohort DESC;

-- Feature reach over the last 7 days: share of active installs using each
SELECT feature, COUNT(DISTINCT install_id) AS installs, SUM(count) AS uses
FROM feature_counts WHERE date >= date('now','-6 day')
GROUP BY feature ORDER BY installs DESC;

-- Activation: how many installs ever used each feature, by first-seen week
SELECT feature, COUNT(DISTINCT install_id) AS installs_ever FROM feature_counts GROUP BY feature;

-- Install source and version of today's active users
SELECT install_source, os, app_version, COUNT(*) AS installs
FROM pings WHERE date = date('now') AND active_minutes > 0
GROUP BY 1, 2, 3 ORDER BY installs DESC;

-- Upgrade adoption: share of this week's active installs on each version
SELECT app_version, COUNT(DISTINCT install_id) AS installs
FROM pings WHERE date >= date('now','-6 day') AND active_minutes > 0
GROUP BY app_version ORDER BY installs DESC;

-- Delivery health: how often pings fail before getting through
SELECT date, SUM(ping_failures) AS late_pings, COUNT(*) AS rows FROM pings GROUP BY date ORDER BY date DESC;

-- 7-day prompt answers, and uninstall reasons
SELECT rating, COUNT(*) FROM feedback GROUP BY rating;
SELECT reason, COUNT(*) FROM goodbyes GROUP BY reason ORDER BY 2 DESC;
```

## Note on `install_source`

One Windows installer serves both winget and direct downloads, so the build
stamp can't tell them apart. Since 2.0.18 the NSIS installer records it at
install time (`src-tauri/nsis/installer-hooks.nsh` → `<app config dir>/install_source`):

- `winget` — the winget manifest passes `/SOURCE=winget`. This needs
  `InstallerSwitches: Custom: /SOURCE=winget` on the installer in the
  `CoolDesk.CoolDesk` manifest in microsoft/winget-pkgs. Add it once; Komac
  (run by winget-releaser) carries it into later versions — check after each
  release.
- `direct` — any other fresh install.
- in-app updates leave the value alone.

Installs from before 2.0.18 report `legacy` until reinstalled; MSI installs
report `msi`. macOS is stamped `dmg`, Linux `linux`.

winget *download* counts: the release publishes a byte-identical
`CoolDesk_<v>_x64-setup-winget.exe` that only the winget manifest points at,
so its GitHub download count is winget installs/upgrades and the plain
`-setup.exe` counts direct downloads.
