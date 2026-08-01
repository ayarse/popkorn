-- Space-separated slugs (lowercase, [a-z0-9-]), at most 5 per scene.
ALTER TABLE scenes ADD COLUMN tags TEXT NOT NULL DEFAULT '';
