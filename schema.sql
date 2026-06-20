-- D1 (SQLite) schema for the travel log. See docs/TRAVEL_LOG_PLAN.md §8.
--   Apply locally:  wrangler d1 execute travel --local  --file=schema.sql
--   Apply to cloud: wrangler d1 execute travel --remote --file=schema.sql
-- Idempotent (IF NOT EXISTS) so it is safe to re-run.

-- A place is either somewhere visited or a wishlist target; checking off a
-- wishlist item flips status to 'visited'.
CREATE TABLE IF NOT EXISTS places (
  id          TEXT PRIMARY KEY,            -- uuid
  name        TEXT NOT NULL,               -- e.g. "Kyoto, Japan"
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'visited'   -- 'visited' | 'wishlist'
                 CHECK (status IN ('visited','wishlist')),
  visited_at  TEXT,                        -- start date (used when no photos; else derived from photos)
  visited_end TEXT,                        -- optional end date for a manually-entered date range
  notes       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,            -- uuid
  place_id    TEXT NOT NULL REFERENCES places(id),  -- cascade handled in the Function
  r2_key      TEXT NOT NULL,               -- full-res original in R2
  thumb_key   TEXT NOT NULL,               -- small display thumbnail in R2
  taken_at    TEXT,                        -- EXIF DateTimeOriginal (timeline axis)
  lat         REAL,                        -- per-photo GPS (may differ slightly from place)
  lng         REAL,
  caption     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_place    ON photos(place_id);
CREATE INDEX IF NOT EXISTS idx_photos_taken_at ON photos(taken_at);
CREATE INDEX IF NOT EXISTS idx_places_status   ON places(status);

-- Saved map-view presets (quick-jump buttons). Editable by the 2 writers in edit mode.
CREATE TABLE IF NOT EXISTS presets (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  zoom        INTEGER NOT NULL DEFAULT 10,
  created_at  TEXT NOT NULL
);
