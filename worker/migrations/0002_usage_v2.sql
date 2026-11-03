-- Usage analytics v2 (app 2.0.18+). Additive only: older app versions and the
-- previous worker keep working against the migrated database.
--
-- Apply BEFORE deploying the new worker:
--   wrangler d1 execute cooldesk-analytics --remote --file=migrations/0002_usage_v2.sql

ALTER TABLE pings ADD COLUMN channel        TEXT;                         -- release | test | local | dev
ALTER TABLE pings ADD COLUMN active_minutes INTEGER NOT NULL DEFAULT 0;   -- minutes with user input
ALTER TABLE pings ADD COLUMN ping_failures  INTEGER NOT NULL DEFAULT 0;   -- earlier pings that didn't arrive
ALTER TABLE pings ADD COLUMN pings          INTEGER NOT NULL DEFAULT 1;   -- pings received that day
ALTER TABLE pings ADD COLUMN ui_seen        INTEGER NOT NULL DEFAULT 1;   -- 0 = only the Rust first-run ping arrived
ALTER TABLE pings ADD COLUMN first_run      INTEGER NOT NULL DEFAULT 0;   -- 1 on the day the install first launched

-- Integer use counts per whitelisted feature. First use of a feature is
-- MIN(date) per (install_id, feature).
CREATE TABLE IF NOT EXISTS feature_counts (
  install_id TEXT NOT NULL,
  date       TEXT NOT NULL,
  feature    TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (install_id, date, feature)
);
CREATE INDEX IF NOT EXISTS idx_feature_counts_date ON feature_counts(date);

-- The one-time in-app "how's it going?" answer, after 7 active days.
CREATE TABLE IF NOT EXISTS feedback (
  install_id  TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  rating      TEXT NOT NULL,              -- great | okay | not_for_me
  app_version TEXT
);

-- cool-desk.com/uninstall answers (os: windows | macos | linux | extension). Not linked to an install id — the uninstaller
-- doesn't pass one.
CREATE TABLE IF NOT EXISTS goodbyes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  app_version TEXT,
  os          TEXT,
  reason      TEXT NOT NULL
);
