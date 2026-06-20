-- CoolDesk anonymous analytics — D1 schema.
-- One row per install per day. Re-pings on the same day UPSERT the row and
-- accumulate the spotlight counter. No IPs, no queries, no personal data.

CREATE TABLE IF NOT EXISTS pings (
  install_id      TEXT NOT NULL,
  date            TEXT NOT NULL,           -- YYYY-MM-DD (UTC, set server-side)
  os              TEXT,                    -- windows | macos | linux
  app_version     TEXT,
  install_source  TEXT,                    -- winget | github | dmg | unknown
  locale          TEXT,                    -- coarse 2-letter, e.g. "en"
  spotlight_opens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (install_id, date)
);

-- Speeds up the per-day aggregate queries (DAU, spotlight totals).
CREATE INDEX IF NOT EXISTS idx_pings_date ON pings(date);
