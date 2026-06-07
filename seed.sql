-- Sample data for LOCAL dev only (gives the map something to show before real uploads).
-- Safe to re-run (INSERT OR IGNORE).  wrangler d1 execute travel --local --file=seed.sql
INSERT OR IGNORE INTO places (id, name, lat, lng, status, visited_at, notes, created_at) VALUES
  ('seed-boston',    'Boston, MA, USA',     42.3601,  -71.0589, 'visited',  '2024-09-12', 'Where it started',  '2024-09-12T00:00:00Z'),
  ('seed-nyc',       'New York, NY, USA',   40.7128,  -74.0060, 'visited',  '2024-12-31', 'New Year''s trip',  '2024-12-31T00:00:00Z'),
  ('seed-kyoto',     'Kyoto, Japan',        35.0116,  135.7681, 'visited',  '2025-04-03', 'Cherry blossoms',   '2025-04-03T00:00:00Z'),
  ('seed-reykjavik', 'Reykjavik, Iceland',  64.1466,  -21.9426, 'wishlist', NULL,         'Northern lights',   '2026-01-01T00:00:00Z'),
  ('seed-banff',     'Banff, Canada',       51.1784, -115.5708, 'wishlist', NULL,         'Lake Louise',       '2026-01-01T00:00:00Z');

INSERT OR IGNORE INTO presets (id, label, lat, lng, zoom, created_at) VALUES
  ('preset-world',  'World',  20.0000,    0.0000,  2, '2026-01-01T00:00:00Z'),
  ('preset-boston', 'Boston', 42.3601,  -71.0589, 11, '2026-01-01T00:00:01Z'),
  ('preset-sfbay',  'SF Bay', 37.5600, -122.1000,  9, '2026-01-01T00:00:02Z');
