-- Anonymous scene submissions. One table; a scene is 2-100KB of CSS text.
CREATE TABLE IF NOT EXISTS scenes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  css        TEXT NOT NULL,
  ip_hash    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reports    INTEGER NOT NULL DEFAULT 0,
  hidden     INTEGER NOT NULL DEFAULT 0
);

-- Gallery listing.
CREATE INDEX IF NOT EXISTS scenes_recent ON scenes (hidden, created_at DESC);
-- Per-IP submission rate limiting.
CREATE INDEX IF NOT EXISTS scenes_ip ON scenes (ip_hash, created_at);
