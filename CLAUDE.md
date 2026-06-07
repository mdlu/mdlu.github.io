# CLAUDE.md — mindren.lu personal site + Travel Log

## What this repo is
Personal website for Mindren Lu, served as a **plain static site (no build step)**:
- `index.html` — homepage (Bootstrap 5 + FontAwesome + Comfortaa, all via CDN).
- `assets/`, `Resume.pdf`, `CNAME` (custom domain `mindren.lu`).

Currently hosted on **GitHub Pages**.

**In progress:** a **Travel Log** at `/travel/` — an interactive map of places visited with photo
carousels, a checkable "places to go" wishlist, photo upload/delete that persists for all visitors,
EXIF auto-geolocation, photo dates, and a timeline. Full plan in **`docs/TRAVEL_LOG_PLAN.md`** — read
it before working on the travel log.

## Status (keep this honest)
- Planning: ✅ complete (`docs/TRAVEL_LOG_PLAN.md`).
- Implementation: ⛔ not started. The `/travel/` page, `/functions/`, `wrangler.toml`, and
  `schema.sql` **do not exist yet** — they're created during the build. Don't assume they're present.

## Target architecture (travel log)
- **Hosting:** Cloudflare Pages (whole repo), auto-deployed from GitHub. Static site at root, backend
  in `/functions`. Migrating off GitHub Pages — but cut DNS over only at the very end.
- **Photos:** Cloudflare R2 (full-res originals kept untouched + small thumbnails). Zero egress.
- **Data:** Cloudflare D1 (SQLite): `places`, `photos` tables (schema in plan §8 → `schema.sql`).
- **Backend:** a Cloudflare Pages Function in `/functions/api/` (reaches R2 + D1 via bindings —
  serverless, no machine).
- **Auth:** one shared passphrase in env var `EDIT_PASSWORD`, checked server-side. Public = read-only.
- **Frontend:** buildless vanilla JS; Leaflet + Leaflet.markercluster; MapTiler tiles; Swiper carousel;
  noUiSlider timeline; exifr / heic2any / browser-image-compression for photos.

## Conventions (important)
- **No build step.** Load libraries via CDN/ESM (jsDelivr / esm.sh). Match the existing site's style
  (Bootstrap 5, Comfortaa). Keep it vanilla — no framework.
- **Never** put a password, write key, or any secret in client-side JS. Secrets live only in the Pages
  Function environment.
- **Do NOT** add `<base target="_blank">` to `/travel/` — the homepage uses it, but it would break
  in-page JS/anchors on the travel page. Give the travel page its own `<head>`.
- **Photos:** read EXIF from the **original** file with `exifr` **before** any resize / HEIC
  conversion (canvas re-encode and heic2any both strip EXIF). Store the full-res original untouched;
  also generate a ~400px thumbnail for the map/carousel.
- **Reverse geocoding (Nominatim):** throttle to 1 req/sec, send a `User-Agent` header, and **cache**
  every result. Fall back to manual marker placement when a photo has no GPS (expect ~30–40% of
  photos to lack it).
- **Leaflet.markercluster** doesn't refresh on dynamic changes — after any upload/delete, call
  `clearLayers()` and re-add markers.
- Public read needs no auth; only writes (upload / delete / edit / check-off) require the passphrase.

## Local development (test fully before deploying)
Everything runs locally — no cloud account, no DNS, no cost.
```
# one-time: create the local D1 database from the schema
wrangler d1 execute travel --local --file=schema.sql

# run site + function + local (simulated) R2 & D1 together
wrangler pages dev                # serves http://localhost:8788; bindings read from wrangler.toml

# inspect local data
wrangler d1 execute travel --local --command "SELECT * FROM photos"

# edit passphrase: locally put EDIT_PASSWORD in a .dev.vars file; for prod use the dashboard or:
wrangler pages secret put EDIT_PASSWORD
```
- Quick static-only preview (no backend): `python3 -m http.server` then open `/travel/`.
- Test on a phone: `wrangler pages dev --ip 0.0.0.0` + your laptop's LAN IP, or a `cloudflared`
  tunnel. (Mobile Safari + HEIC is the key thing to test on a real device.)
- External APIs (MapTiler tiles, Nominatim) work from localhost with a key / `User-Agent`.

## Deploy / DNS
- Every `git push` auto-builds on Cloudflare Pages; each branch gets its own `*.pages.dev`
  **preview URL** with an isolated preview DB/bucket.
- **Do NOT repoint `mindren.lu` until the feature is done.** Develop on localhost + `*.pages.dev`; the
  live homepage stays on GitHub Pages until the final cutover.
- To test the custom domain early without touching the apex, attach a subdomain (e.g.
  `travel.mindren.lu`) to the Pages project.

## File layout (target)
```
index.html, assets/, Resume.pdf, CNAME   # existing homepage (unchanged)
docs/TRAVEL_LOG_PLAN.md                   # the plan (source of truth)
travel/index.html                         # travel log page (own <head>, no <base target>)
assets/css/travel.css
assets/js/travel/*.js                     # app, map, upload, timeline, wishlist, api, config
functions/api/[[route]].js                # Pages Function backend (routes in plan §8)
schema.sql                                # D1 schema (plan §8)
wrangler.toml                             # R2 + D1 bindings + pages output dir
```

## Build order
Follow the phases in plan §10 (Phase 0 → 7). Verify each phase locally with `wrangler pages dev`
before moving to the next. In Phase 0, add `.wrangler/`, `node_modules/`, and `.dev.vars` to
`.gitignore`.
