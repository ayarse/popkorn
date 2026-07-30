-- Submissions are Clerk-authenticated from here on. Existing rows keep NULL
-- user_id (they were published anonymously) and render without a byline.
ALTER TABLE scenes ADD COLUMN user_id TEXT;
ALTER TABLE scenes ADD COLUMN author TEXT;

-- Per-user rate limiting, replacing the per-IP one.
CREATE INDEX IF NOT EXISTS scenes_user ON scenes (user_id, created_at);
