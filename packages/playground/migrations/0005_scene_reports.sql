-- One row per (scene, signed-in reporter); the scene hides at N distinct reporters.
CREATE TABLE IF NOT EXISTS scene_reports (
  scene_id   TEXT NOT NULL,
  reporter   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS scene_reports_unique ON scene_reports (scene_id, reporter);
