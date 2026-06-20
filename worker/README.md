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

## Metrics (run against D1)

```sql
-- Daily active installs
SELECT date, COUNT(DISTINCT install_id) AS dau FROM pings GROUP BY date ORDER BY date DESC;

-- Total installs ever
SELECT COUNT(DISTINCT install_id) AS installs FROM pings;

-- New installs per day (first time each install was seen)
SELECT first_seen AS date, COUNT(*) AS new_installs
FROM (SELECT install_id, MIN(date) AS first_seen FROM pings GROUP BY install_id)
GROUP BY first_seen ORDER BY first_seen DESC;

-- Spotlight opens per day
SELECT date, SUM(spotlight_opens) AS opens FROM pings GROUP BY date ORDER BY date DESC;

-- Breakdown by channel / OS / version (today)
SELECT install_source, os, app_version, COUNT(DISTINCT install_id) AS installs
FROM pings WHERE date = strftime('%Y-%m-%d','now')
GROUP BY install_source, os, app_version;
```

## Note on `install_source`

The Windows build is distributed through **both** winget and direct GitHub
download as the *same* artifact, so the build-time stamp marks all Windows
installs `winget`. To truly split winget vs. direct download you'd need a runtime
heuristic (e.g. machine-scope `Program Files` vs. user-scope `LocalAppData`
install path) in `install_source()` in `src-tauri/src/lib.rs`. macOS is stamped
`dmg`.
