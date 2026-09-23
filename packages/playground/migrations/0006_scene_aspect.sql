-- Canvas width/height, stored so the gallery listing never reads css.
-- NULL on older rows; listScenes computes and backfills those on first read.
ALTER TABLE scenes ADD COLUMN aspect REAL;
