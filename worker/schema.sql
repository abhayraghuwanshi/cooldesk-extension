-- CoolDesk anonymous analytics — D1 schema (fresh database).
-- An existing database gets the same shape from migrations/0002_usage_v2.sql.
-- One row per install per day; re-pings the same day UPSERT the row and add to
-- its counters. No IPs, no queries, no URLs, no personal data.

CREATE TABLE IF NOT EXISTS pings (
  install_id      TEXT NOT NULL,
  date            TEXT NOT NULL,           -- YYYY-MM-DD (UTC, set server-side)
  os              TEXT,                    -- windows | macos | linux
  app_version     TEXT,
  install_source  TEXT,                    -- winget | direct | msi | legacy | dmg | linux | unknown
  locale          TEXT,                    -- coarse 2-letter, e.g. "en"
  spotlight_opens INTEGER NOT NULL DEFAULT 0,
  channel         TEXT,                    -- release | test | local | dev
  active_minutes  INTEGER NOT NULL DEFAULT 0,
  ping_failures   INTEGER NOT NULL DEFAULT 0,
  pings           INTEGER NOT NULL DEFAULT 1,
  ui_seen         INTEGER NOT NULL DEFAULT 1,
  first_run       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (install_id, date)
);
CREATE INDEX IF NOT EXISTS idx_pings_date ON pings(date);

CREATE TABLE IF NOT EXISTS feature_counts (
  install_id TEXT NOT NULL,
  date       TEXT NOT NULL,
  feature    TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (install_id, date, feature)
);
CREATE INDEX IF NOT EXISTS idx_feature_counts_date ON feature_counts(date);

CREATE TABLE IF NOT EXISTS feedback (
  install_id  TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  rating      TEXT NOT NULL,
  app_version TEXT
);

CREATE TABLE IF NOT EXISTS goodbyes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  app_version TEXT,
  os          TEXT,                    -- windows | macos | linux | extension
  reason      TEXT NOT NULL
);
