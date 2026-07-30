-- Dedupe gate: the SHA-256 of the scene's *normalized* source (minified, so
-- whitespace/comment-only edits collapse to the same value). Unique, so the
-- same scene can't be published twice under different titles.
ALTER TABLE scenes ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS scenes_content ON scenes (content_hash);
