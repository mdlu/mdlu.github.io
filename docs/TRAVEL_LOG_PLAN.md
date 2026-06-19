# Travel Log — Full Implementation Plan

> A permanent, shared **map of places & memories** for two people — at any scale, from a neighborhood
> spot to an overseas trip. Pins for places they've been (click-to-open photo carousels), a checkable
> "places to go" wishlist, photo upload/delete that persists for all visitors, automatic location
> inference from photo EXIF GPS, photo dates/times, **editable region presets** (quick-jump
> bookmarks), and a timeline view. Works on mobile and desktop.

---

## 1. Context

**Why this exists.** The current site (`mindren.lu`) is a single static `index.html` (Bootstrap 5 +
FontAwesome via CDN, Comfortaa font) hosted on GitHub Pages with a custom domain via `CNAME`. The
goal is to add a *permanent*, shared **map of meaningful places** between two people (a couple),
readable by the public. **Scope is general, not travel-only:** it captures everyday memories and
ideas for places to go *within* their own cities as much as far-off trips — so the design stays
neutral across scales (a local café up to an overseas trip).

**What it must do** (from the request):
1. An interactive **map** of meaningful places (memories), at any scale — local to international.
2. Click a place → **popup carousel** of that place's photos.
3. A **"places to go"** wishlist that can be **checked off** once visited.
4. **Upload and delete** photos per place; they **persist globally** for all visitors (not
   `localStorage`).
5. **Auto-infer location** from a photo's GPS EXIF when present.
6. **Date/time** per photo, taken from EXIF metadata.
7. A **timeline view** in a sidebar to scroll locations over time.
8. **Editable region presets** — quick-jump buttons (e.g. Boston, the SF Bay Area). The two writers
   can save the current map view as a named preset, rename presets, and delete presets (with a
   confirmation prompt).
9. Usable on **mobile and desktop**.

**Constraints / preferences:** only **2 writers** ever; public read; **simple and cheap** (free
tier ideal); keep it as close to the current GitHub Pages setup as possible.

**Decisions already made** (from planning Q&A):
- **Photos stored at full resolution.** Non-HEIC originals kept as-is; **iPhone HEIC is converted to
  a high-quality full-res JPEG on upload** (HEIC discarded — see §6) for universal fast display.
- **Write access = one shared passphrase** (no per-person accounts; type a secret once, remembered
  after; verified server-side).
- This plan document lives in the repo at `docs/TRAVEL_LOG_PLAN.md`.

**Intended outcome:** a new `/travel/` page on the existing site, buildless vanilla JS to match the
current site, backed by a tiny serverless API so the two of you can add/remove photos that everyone
can see — at effectively $0/month.

---

## 2. TL;DR — Recommended architecture

Host the whole thing on **Cloudflare Pages**, auto-deployed from your existing GitHub repo, so the
site *and* the small backend function *and* the database *and* the photo storage all live on one
platform (same origin → no CORS, direct R2/D1 access, one deploy). You keep `mindren.lu` and keep
using GitHub for your code — Cloudflare just watches the repo and redeploys on every push. (GitHub
Pages remains a viable fallback; see [§3](#3-hosting-cloudflare-pages-vs-github-pages).)

```
                          mindren.lu  (Cloudflare Pages — auto-deployed from your GitHub repo)
                          /travel/  ── static page (Leaflet map + sidebar)
                                │
          ┌─────────────────────┼──────────────────────────────┐
          │ reads (public)       │ writes (passphrase-gated)     │ photo files
          ▼                      ▼                               ▼
   GET data.json / API     Pages Function    ──────►  Cloudflare R2 (photos)
   (places, photos,        (serverless ~15-line         • full-res originals
    wishlist, dates)        file; checks pass-           • + small thumbnails
          ▲                  phrase; R2/D1 binds)        • 10 GB free, ZERO egress
          │                      │                       • served directly, public
          └──── Cloudflare D1 ◄──┘
                (SQLite: places / photos / wishlist metadata)
```

| Concern              | Choice                                                            | Why |
|----------------------|------------------------------------------------------------------|-----|
| Hosting (frontend)   | **Cloudflare Pages** (recommended) — auto-deploys from GitHub repo | One platform: site + backend + DB + storage; same origin (no CORS); keep `mindren.lu`. GitHub Pages works as a fallback. |
| Photo files          | **Cloudflare R2**                                                | 10 GB free, **zero egress fees** — best for full-res + public viewing |
| Structured data      | **Cloudflare D1** (SQLite)                                       | Free, SQL makes timeline date-ranges + wishlist trivial |
| Write API + auth     | **Cloudflare Pages Function** (~15-line serverless file; passphrase + R2/D1 bindings) | Serverless — no machine to run; secret stays server-side; public reads, gated writes |
| Map library          | **Leaflet** + **Leaflet.markercluster**                         | 42 KB, no build step, huge plugin ecosystem, great on mobile |
| Basemap tiles        | **MapTiler** (or **OpenFreeMap**)                               | Free, no credit card; never use raw OSM tiles |
| Photo carousel       | **Swiper.js** in the Leaflet popup (+ optional Fancybox lightbox)| Touch-friendly, free |
| EXIF read            | **exifr** (reads GPS + date from JPEG **and HEIC**)             | Most robust; reads iPhone HEIC directly, no conversion |
| HEIC display         | **heic2any** (only for non-Safari browsers)                     | Converts HEIC→JPEG for display |
| Resize/thumbnails    | **browser-image-compression** (thumbnail only; original kept)  | Keeps map fast without touching the full-res original |
| Reverse geocode      | **Nominatim** (throttled 1 req/s, cached)                       | Free, GPS → place name |
| Timeline             | **noUiSlider** (or HTML range) filtering markers by `taken_at`  | Light, no heavy plugin |

**Estimated cost: ~$0/month** for years (see [§11](#11-cost-summary)). The only realistic future
cost is R2 storage above 10 GB, at **$0.015/GB/month** (e.g. 50 GB of full-res photos ≈ **$0.60/mo**).

> **Note on the full-resolution choice.** Storing full-res photos is exactly why R2 wins here.
> Supabase Storage (1 GB free, metered egress) would fill after ~200–300 phone photos and charge
> for public views; Firebase now requires a billing card and meters egress. R2's zero-egress +
> 10 GB free is the only option that stays free with full-res photos *and* public visitors. Your
> originals are stored untouched; we additionally generate a tiny thumbnail per photo purely so the
> map/grid loads fast (the full-res image loads only when a visitor opens it).

---

## 3. Hosting: Cloudflare Pages vs GitHub Pages

**Recommendation: host on Cloudflare Pages**, deployed automatically from your existing GitHub repo.
Because this project needs a backend anyway (to check the passphrase and write photos), Pages is
strictly simpler than GitHub Pages: it bundles the static site, the serverless function, the
database, and the photo storage on one platform, same-origin, with one deploy. You keep `mindren.lu`
and keep using GitHub for your code — Cloudflare watches the repo and redeploys on every `git push`.

| | **Cloudflare Pages** (recommended) | **GitHub Pages** (current) |
|---|---|---|
| Cost | Free, **unlimited bandwidth** | Free, 100 GB/mo soft bandwidth cap |
| Serverless backend | ✅ **Built in** ("Pages Functions") — frontend + backend in one repo/deploy | ❌ None — you'd need a *separate* Cloudflare Worker on another domain |
| Reaches R2 / D1 | ✅ Direct **bindings** — no API keys, no CORS (same origin) | ❌ Cross-origin → must configure CORS + manage keys |
| Deploys from GitHub | ✅ Connect repo → every push auto-deploys | ✅ Native |
| Custom domain | ✅ `mindren.lu` | ✅ `mindren.lu` |
| Downside | One-time DNS migration (minutes, ~zero downtime) | Static-only; forces an awkward separate backend |

**Why it matters here:** with GitHub Pages, the passphrase-checking function would have to live on a
separate Worker at a different origin → CORS + credential juggling. With Cloudflare Pages the function
sits in a `/functions` folder *in the same repo*, deploys with the site, and reads/writes R2 + D1
directly via bindings. You don't lose GitHub — it stays your source of truth; Cloudflare just hosts
and adds the backend. The only cost is a one-time DNS pointer change for `mindren.lu`.

**It's serverless — there is no machine.** A Pages Function is a small JS file Cloudflare runs
on-demand at its edge (spins up in ~1 ms, scales to zero when idle). Nothing to rent, patch, or keep
alive. The only option in this plan that would involve a real machine is the self-hosted PocketBase
route in §4 — which we are **not** taking.

**Two tempting shortcuts to avoid either way** (researched and rejected):
- ❌ **Committing photos into the git repo.** ~1 GB published-site/repo soft limit; binary photos
  bloat history and slow clones, and **Git LFS is *not* dereferenced by Pages** (serves the pointer
  text, not the image). [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits),
  [Git LFS](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage).
- ❌ **Calling the GitHub API from the browser with a token.** Any token in client JS is publicly
  visible in DevTools and lets an attacker rewrite your site. Non-starter.

*(GitHub Pages remains a fine fallback if you'd rather not migrate DNS — you'd just deploy the one
function as a standalone Cloudflare Worker on a subdomain like `travel-api.mindren.lu` and enable
CORS for `mindren.lu`.)*

---

## 4. Backend options — full comparison (with articles)

You asked to see all options. Here is the landscape for **(a) the database** and **(b) the photo
files**, with 2026 free tiers and the gotcha that usually bites (egress) and links.

### 4.1 Full-stack backends (DB + storage + auth in one)

| Option | Free tier (2026) | Pros | Cons | Verdict for us |
|--------|------------------|------|------|----------------|
| **Cloudflare (R2 + D1 + Workers)** | R2 10 GB + **zero egress**, 1M writes/10M reads; D1 free tier; Workers 100k req/day; Pages unlimited | Zero egress = unlimited public photo views cost $0; never sleeps; 10 GB storage; one vendor; presigned uploads keep secrets server-side | Must write/deploy a small Worker; D1 is SQLite (single-writer, fine for 2); presigned-URL + CORS to get right | ✅ **Best fit** given full-res + passphrase + public |
| **Supabase (Postgres + Storage + Auth)** | 500 MB DB, **1 GB** storage, 5 GB egress, 50k MAU | Zero backend code; auto REST API; SQL; RLS; realtime; magic-link auth built in | **1 GB storage too small for full-res**; **egress metered**; **free project pauses after 7 days idle** (~30 s wake); | ⚠️ Great DX but storage/egress wrong for full-res |
| **Firebase (Firestore + Storage + Auth)** | Card now required for Storage (Blaze) since Feb 2026; metered | Mature SDK; never pauses; realtime; easy auth | **Requires billing card**; per-read + **$0.15/GB egress** = bill-shock risk on public photo views; NoSQL makes date-range timeline awkward | ❌ Avoid: no longer free-first, egress trap |
| **PocketBase (self-hosted, single binary)** | Free software; needs a host | All-in-one (DB+storage+auth+admin UI); full data ownership; no limits but your disk | You run a VPS (Oracle Cloud Always-Free or ~$5/mo): backups, SSL, uptime are on you; SQLite single-writer | ⚠️ Cheapest-with-ops if you want to self-host |

Articles:
[Supabase pricing](https://supabase.com/pricing) ·
[Supabase storage pricing](https://supabase.com/docs/guides/storage/pricing) ·
[Firebase pricing](https://firebase.google.com/pricing) ·
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) ·
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) ·
[PocketBase FAQ](https://pocketbase.io/faq/) ·
[Supabase vs Firebase for startups](https://horizon.dev/blog/supabase-vs-firebase-startups/) ·
[The true cost of Supabase](https://www.metacto.com/blogs/the-true-cost-of-supabase-a-comprehensive-guide-to-pricing-integration-and-maintenance)

### 4.2 Storage-only options (pair with any DB)

| Option | Free tier | Notes |
|--------|-----------|-------|
| **Cloudflare R2** | 10 GB, **zero egress** | Best for full-res + public; S3-compatible presigned uploads. [Docs](https://www.cloudflare.com/products/r2/) |
| **Backblaze B2** | 10 GB; free egress up to 3× stored/day then $0.01/GB | Cheap; free egress via Cloudflare CDN. [Pricing](https://www.backblaze.com/cloud-storage/pricing) |
| **Cloudinary** | 25 "credits"/mo (≈25 GB storage *or* transforms) | Great for auto-thumbnails/transforms; suspends (not charges) over quota. [Pricing](https://cloudinary.com/pricing) |
| **ImgBB** | Unlimited storage + bandwidth, 32 MB/image | Simple but no folders/transforms; project not actively developed |

### 4.3 Database-only options (pair with R2/B2)

| Option | Free tier | Notes |
|--------|-----------|-------|
| **Cloudflare D1** (SQLite) | Free tier, no egress | Co-located with Worker/R2; SQL. [Docs](https://developers.cloudflare.com/d1/platform/pricing/) |
| **Turso** (libSQL/SQLite) | 5 GB, 500M reads/mo, 10M writes/mo | HTTP API callable from a Worker; cheap overage. [Pricing](https://turso.tech/pricing) |
| **Neon** (Postgres) | Generous free Postgres | If you prefer Postgres over SQLite |

### 4.4 "Git as a database" (rejected)

Decap/TinaCMS-style "store JSON + images in the repo" approaches **don't handle binary photos well**
(no LFS dereferencing on Pages, repo bloat). Fine for *text* metadata, not for photos.
[Decap GitHub backend](https://decapcms.org/docs/github-backend/).

### 4.5 Why Cloudflare wins *for your specific choices*

Your two choices — **full-resolution storage** and a **shared passphrase** — point unambiguously at
Cloudflare:
- Full-res + public viewing makes **egress the dominant cost**. R2 is the only mainstream option with
  **zero egress**, so unlimited visitors viewing full-res photos cost **$0**.
- 10 GB free (vs Supabase 1 GB) holds ~2–3× more full-res photos before any charge, and overage is a
  trivial **$0.015/GB/mo**.
- A shared passphrase **needs a server-side check** anyway (so it can't be bypassed) — that's exactly
  one small Worker, which also mints R2 upload URLs and writes D1 metadata. One vendor, one deploy.

> If you'd rather avoid writing any backend code at all and accept smaller storage + a weekly
> keep-alive ping, **Supabase + a single shared account** is the fallback. But it conflicts with the
> full-res choice, so Cloudflare is recommended.

---

## 5. Map, tiles & geocoding

- **Library — Leaflet + Leaflet.markercluster.** Leaflet is ~42 KB, DOM-based (no WebGL), drops in
  via a `<script>` tag next to your existing Bootstrap CDN, and has the richest plugin ecosystem.
  `Leaflet.markercluster` groups nearby place-markers and shows per-cluster counts.
  [Leaflet](https://leafletjs.com/) · [markercluster](https://github.com/Leaflet/Leaflet.markercluster).
  - *Gotcha:* markercluster doesn't auto-refresh on dynamic add/remove — after an upload/delete, call
    `clusterGroup.clearLayers()` and re-add markers.
- **Tiles — MapTiler** (100k loads/mo free, no credit card, commercial use OK) as primary;
  **Stadia Maps** (200k/mo free, no card, personal use) as an equally-good alternative. If you want
  **zero keys/quotas**, **OpenFreeMap** has no registration/limits but is *vector* tiles → it pairs
  with **MapLibre GL JS** instead of Leaflet. ❌ **Never** use raw `tile.openstreetmap.org` — its
  [usage policy](https://operations.osmfoundation.org/policies/tiles/) forbids production apps.
  [MapTiler pricing](https://www.maptiler.com/cloud/pricing/) · [Stadia pricing](https://stadiamaps.com/pricing/).
- **Reverse geocoding — Nominatim** (lat/lng → place name), free public API at **1 request/second**.
  Done **client-side** (`geo.js`) — each user's own IP, throttled to ~1/sec and cached; the browser
  identifies via Referer (User-Agent can't be set from `fetch`). The suggested name is shown in a
  confirmable prompt, so the user can accept or edit it (and it's the fallback if lookup is empty).
  For the volume here (a few new places per trip) this is plenty.
  [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).
- **Carousel — Swiper.js** inside the Leaflet popup (touch swipe, free). Optional **Fancybox** for a
  fullscreen lightbox when a photo is tapped.

---

## 6. Photo & EXIF pipeline (client-side)

All metadata extraction happens **in the browser, on the original file, before any re-encoding** —
because canvas/compression and HEIC→JPEG conversion **strip EXIF**, and some phones/transfers strip
GPS too.

**Ordered pipeline (per selected photo):**

1. **Select** — `<input type="file" accept="image/*" multiple>` (works on iOS/Android).
2. **Read EXIF from the original** with **exifr** (`exifr.parse(file, ['GPSLatitude','GPSLongitude','DateTimeOriginal','Orientation'])`).
   exifr reads **HEIC directly** (no conversion needed) and auto-converts GPS DMS → decimal lat/lng.
   Capture `Orientation` now to avoid sideways thumbnails later.
3. **Date/time** — use `DateTimeOriginal` as `taken_at` (the timeline timestamp). Fallbacks:
   file `lastModified`, then a manual date picker.
4. **Location** —
   - If GPS present: **auto-place** the photo. Find the nearest existing place within ~**200 m**
     (proximity grouping so 30 photos at one beach become one marker) — attach to it, else create a
     new place and **reverse-geocode** (Nominatim, throttled + cached) for its name.
   - If GPS absent (common — see below): **manual fallback** — let the user drop/confirm a marker on
     the map or pick an existing place, and type a name. *This fallback is mandatory, not optional.*
5. **HEIC → JPEG on upload** — if the file is HEIC/HEIF, convert it once to a full-res, high-quality
   JPEG (**heic2any**, q≈0.92) and store *that*; the raw HEIC is discarded. This gives universal, fast
   display in every browser (no render-time WASM). Trade-off: loses HDR/10-bit and is a one-time lossy
   re-encode (visually imperceptible). EXIF was already read from the original in step 2. Non-HEIC
   files are kept as-is.
6. **Thumbnail** — generate a small (~600 px long-edge) JPEG with **browser-image-compression**
   (`useWebWorker:true`, orientation handled) for fast map/carousel rendering. The **full-res image**
   (the converted JPEG for HEIC, or the untouched original for JPEG/PNG) is stored at full resolution.
   The heavy libs (exifr, heic2any, compression) **lazy-load only when a writer uploads**.
7. **Upload** — `POST` the original + thumbnail to the Pages Function, which writes them to R2 via its
   binding (`env.BUCKET.put(...)`) and inserts the metadata row in D1 (place, lat/lng, `taken_at`, R2
   keys, caption). At 3–5 MB/photo this is the simplest path. *(Optional, only if you later want to
   keep big files off compute: have the Function mint a short-lived R2 presigned PUT URL and upload
   straight to R2.)*
8. **Refresh** — re-fetch data and re-render the cluster layer.

**EXIF-stripping reality (plan for it):** direct iPhone camera-roll photos keep GPS ~95% of the time,
but **AirDrop-to-Mac, iCloud "optimized" downloads, screenshots, and social-media re-shares strip GPS**
(timestamps usually survive). Assume **~60–70% of uploads have usable GPS** → the manual placement
fallback will be used regularly.

**Libraries:** `exifr` (EXIF, incl. HEIC), `heic2any` (HEIC→JPEG for non-Safari display only),
`browser-image-compression` (thumbnail), `@turf/distance` (optional, proximity grouping). All load
buildless via CDN/ESM. Sources: [exifr](https://github.com/MikeKovarik/exifr),
[heic2any](https://github.com/alexcorvi/heic2any),
[browser-image-compression](https://github.com/Donaldcwl/browser-image-compression).

**Gotchas:** canvas re-encode strips EXIF (read first); heic2any strips EXIF (read first);
iOS Safari may report `file.type` as `''` for HEIC (sniff magic bytes or accept both); double-rotation
risk (Safari + canvas both auto-apply orientation — use exifr's orientation, don't guess); Nominatim
needs `User-Agent` and 1 req/s throttle.

---

## 7. Auth / write protection (shared passphrase)

You chose **one shared passphrase** — the lowest-friction option. It's tiny: ~15 lines in the Pages
Function, one secret, **no accounts, no email service, no machine**.

**Simplest version (recommended to start):**

1. Store the passphrase as an encrypted **environment variable** in the Cloudflare Pages dashboard
   (`EDIT_PASSWORD`) — never in client JS, never in the repo.
2. When either of you clicks "Edit", you type the passphrase **once**; the browser saves it in
   `localStorage` and sends it as a header (`x-edit-password`) on every write. Feels like no login
   after day one.
3. The Function compares the header to `env.EDIT_PASSWORD` before touching R2/D1; mismatch → `401`.
   **Reads need no password** (public). Over HTTPS this is safe for two trusted people.

```js
// functions/api/photos.js — runs only when you add a photo
export async function onRequestPost({ request, env }) {
  if (request.headers.get('x-edit-password') !== env.EDIT_PASSWORD)
    return new Response('Not allowed', { status: 401 });    // the public can't write
  const photo = await request.json();
  await env.DB.prepare('INSERT INTO photos (...) VALUES (...)').bind(/* ... */).run();
  return Response.json({ ok: true });
}
```

**Optional hardening (later):** exchange the passphrase once for a signed token (HMAC/JWT, ~30-day
expiry) via `POST /api/login`, store the token instead of the raw password, and verify its signature
on writes. Rotating access = change the env var (and signing key) in the dashboard; saved credentials
stop working.

**The rule that drives all of this:** never ship a write-capable key/secret in static JS — it lives
only in the Function's environment; the public only ever gets read access.
[Securing S3 presigned URLs](https://aws.amazon.com/blogs/compute/securing-amazon-s3-presigned-urls-for-serverless-applications/).

---

## 8. Data model (Cloudflare D1 / SQLite)

```sql
-- A place is either somewhere visited or a wishlist target; checking off a
-- wishlist item flips status to 'visited'.
CREATE TABLE places (
  id          TEXT PRIMARY KEY,            -- uuid/slug
  name        TEXT NOT NULL,               -- e.g. "Kyoto, Japan"
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'visited'  -- 'visited' | 'wishlist'
                 CHECK (status IN ('visited','wishlist')),
  visited_at  TEXT,                        -- ISO date set when checked off / first photo
  notes       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  place_id    TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  r2_key      TEXT NOT NULL,               -- full-res original in R2
  thumb_key   TEXT NOT NULL,               -- small display thumbnail in R2
  taken_at    TEXT,                        -- EXIF DateTimeOriginal (timeline axis)
  lat         REAL,                        -- per-photo GPS (may differ slightly from place)
  lng         REAL,
  caption     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_photos_place    ON photos(place_id);
CREATE INDEX idx_photos_taken_at ON photos(taken_at);
CREATE INDEX idx_places_status   ON places(status);

-- Saved map-view presets (quick-jump buttons), editable in edit mode.
CREATE TABLE presets (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  zoom        INTEGER NOT NULL DEFAULT 10,
  created_at  TEXT NOT NULL
);
```

- **Wishlist** = `places` rows with `status='wishlist'`. **Check off** = `PATCH` to
  `status='visited'` (+ set `visited_at`); its photos then appear.
- **Timeline** = `SELECT ... ORDER BY taken_at`, filtered by the slider's date range.
- **Photos persist for all visitors** because they live in R2 + D1, read by everyone.

**Backend API (Pages Function — runs on Cloudflare Workers under the hood):**

| Method & path                 | Auth     | Purpose |
|-------------------------------|----------|---------|
| `GET  /api/data`              | public   | All places + photos + presets as JSON (frontend loads on start) |
| `GET  /api/photo/<key>`       | public   | Stream a photo/thumbnail from R2 |
| `POST /api/verify`            | password | Check the passphrase (used to turn on edit mode) |
| `POST /api/photos` (multipart)| password | Upload original + thumbnail → R2, insert metadata (auto-place by GPS proximity) |
| `DELETE /api/photos/:id`      | password | Delete R2 objects + D1 row |
| `POST /api/places`            | password | Create a place or wishlist item |
| `PATCH /api/places/:id`       | password | Check off wishlist → visited; edit name/notes |
| `DELETE /api/places/:id`      | password | Delete a place (cascade its photos) |
| `POST /api/places/:id/merge`  | password | Merge a place into another (move its photos, delete it) |
| `POST /api/presets`           | password | Save the current map view as a named preset |
| `PATCH /api/presets/:id`      | password | Rename a preset (or move it) |
| `DELETE /api/presets/:id`     | password | Delete a preset |
| `POST /api/login`             | password | *(optional hardening)* exchange passphrase for a signed token |
| `POST /api/upload-url`        | password | *(optional)* mint an R2 presigned PUT URL instead of uploading via the Function |

*Optional read optimization:* the Function can also write a `data.json` snapshot to the public R2
bucket on every change, so the frontend reads that static file (zero Worker invocations for reads).
Start simple with `GET /api/data`; add the snapshot only if needed.

---

## 9. Frontend: layout, features, files

**Buildless vanilla JS + Bootstrap**, matching the current site (no framework, no build step). New
files (the existing `index.html`, `style.css`, etc. are untouched except an optional nav link):

```
/travel/index.html              # the map page (own <head>; NO <base target> — would break JS) ✓
/assets/css/travel.css          # map + floating controls + sidebar + responsive styles ✓
/assets/js/travel/config.js     # API base path, tile source, map defaults ✓
/assets/js/travel/util.js       # escapeHtml / fmtDate helpers ✓
/assets/js/travel/api.js        # fetch helpers (getData, photoUrl, authed writes, presets) ✓
/assets/js/travel/auth.js       # edit-mode passphrase (verify + remember in localStorage) ✓
/assets/js/travel/map.js        # Leaflet + markercluster + Swiper popups + presets/getView ✓
/assets/js/travel/app.js        # bootstrap: data, map, sidebar, presets, edit mode ✓
/assets/js/travel/upload.js     # (Phase 3) file → exifr → heic2any → thumbnail → upload
/assets/js/travel/timeline.js   # (Phase 5) noUiSlider date filter + chronological list
/functions/api/[[path]].js      # Pages Function = the backend (routes from §8) ✓
/schema.sql, /seed.sql          # D1 schema + local sample data ✓
/wrangler.toml, /package.json   # bindings + wrangler dev/deploy scripts ✓
/.dev.vars                      # local EDIT_PASSWORD (gitignored) ✓
```

Libraries via CDN (jsDelivr / esm.sh): Leaflet, Leaflet.markercluster, Swiper (popup carousel),
Fancybox (fullscreen gallery), noUiSlider. The upload-only libs — exifr, heic2any,
browser-image-compression — **lazy-load on first upload** so public viewers don't download them.
Reuse the existing Comfortaa for visual consistency. (Fancybox is free for personal/non-commercial
use; swap to PhotoSwipe (MIT) if that ever matters.)

**Layout — desktop:** full-height **Leaflet map**; a floating list button (top-right) opens a
**collapsible sidebar** with *Visited* / *To Go* tabs (a *Timeline* tab is added in Phase 5); a
floating **✎ edit** button unlocks edit mode (passphrase); a right-side **Views** sidebar (★ button)
holds the saved presets; Leaflet's zoom control is top-left.

**Layout — mobile:** map fills the screen; the sidebar becomes a **bottom sheet** that slides up
(Bootstrap offcanvas or a simple CSS sheet). Timeline slider spans the bottom; popups/carousels are
width-constrained so they don't overflow small screens. Test pinch-zoom and swipe on real devices.

**Feature mapping:**
- *Map of places* → clustered markers; visited vs wishlist styled differently (filled vs hollow).
- *Click → photo carousel* → marker popup hosts a Swiper carousel of the place's thumbnails; tap a
  photo → **fullscreen, swipeable, zoomable gallery** of that place (Fancybox).
- *Region presets / views* → DB-backed quick-jump list in the right **Views** sidebar; in edit mode, save the current view as a named
  preset, rename it, or delete one (with a confirm). Seed defaults: World / Boston / SF Bay.
- *Edit mode / write access* → the ✎ button unlocks edit mode via the shared passphrase (remembered
  per device); writes go to the Function → R2/D1. Public users only read.
- *Manage places (edit mode)* → **drag a pin** to move it (persists via `PATCH /places/:id`); a
  **"Merge into…"** dropdown in a place's popup combines it into another place (its photos move over,
  the old place is removed).
- *Wishlist with check-off* → the *To Go* tab lists `status='wishlist'` places; checking flips them
  to `visited` (writers only).
- *Upload/delete photos, persists for all* → edit mode → upload pipeline (§6) / per-photo delete.
- *Auto-location from EXIF* → §6 step 4; manual fallback when GPS missing.
- *Dates/times* → each photo's `taken_at` (from EXIF) is shown; a **place's date is derived from its
  photos** (a single date or a range). `visited_at` is only a fallback for photo-less places, and
  photo dates drive the timeline.
- *Timeline view* → noUiSlider range filters markers + the sidebar list by `taken_at`.

**Inspiration to borrow from** (researched):
[`jasonlcy91/embers-of-life-china-trip-2026`](https://github.com/jasonlcy91/embers-of-life-china-trip-2026)
(pure-HTML timeline slider + mobile-first reveals),
[`reedtang666/travel-map`](https://github.com/reedtang666/travel-map)
(couple's map + wishlist + timeline; data-as-JSON pattern — swap its AMap for Leaflet),
[`Yorik56/GeoGallery`](https://github.com/Yorik56/GeoGallery) (single-file EXIF-GPS → map).

---

## 10. Phased build plan

- **Phase 0 — Accounts & schema (no app code).** Create a Cloudflare account; create a Pages project
  connected to the GitHub repo; create an R2 bucket (public read) + a D1 database and bind both to the
  project; apply `schema.sql`; set `EDIT_PASSWORD` as an encrypted Pages env var; get a MapTiler key;
  point `mindren.lu` at the Pages project.
- **Phase 1 — Backend (Pages Function).** Implement the routes (§8): public `GET /api/data` and
  password-gated photo/place CRUD (upload writes to R2 + inserts into D1). Test entirely locally with
  `wrangler pages dev` against the simulated local D1/R2 — no cloud, no cost.
- **Phase 2 — Static scaffold + read path (public).** New `/travel/` page: full-screen Leaflet +
  MapTiler tiles + collapsible sidebar shell; load `/api/data`; render clustered markers; Swiper
  carousel in popups. Confirm mobile + desktop render. *Delivers the public experience.*
- **Phase 3 — Auth + upload/delete.** Passphrase unlock → token in `localStorage`; upload form with
  the full EXIF pipeline (§6: exifr → HEIC handling → thumbnail → presigned upload → metadata);
  delete. Re-render clusters after writes.
- **Phase 4 — Auto-geolocation & dates.** Auto-place by GPS + Nominatim reverse-geocode
  (throttled/cached) + proximity grouping; manual placement fallback; store/display `taken_at`.
- **Phase 5 — Timeline sidebar.** noUiSlider date range filtering markers + a scrollable
  chronological list.
- **Phase 6 — Wishlist.** Places-to-go list with check-off (writers only) + distinct map markers.
- **Phase 7 — Polish & hardening.** Real iPhone/Android QA; cluster refresh after add/delete; upload
  progress/error states; CORS + token-expiry review; loading/empty states; add a "Travel" link from
  the homepage.

---

## 11. Cost summary

| Item | Free tier | Realistic cost |
|------|-----------|----------------|
| Cloudflare Pages (hosting) | Free, unlimited bandwidth | **$0** |
| Cloudflare R2 (photos) | 10 GB + **zero egress** | **$0** until 10 GB; then **$0.015/GB/mo** (50 GB ≈ $0.60/mo) |
| Cloudflare D1 (data) | Free tier (ample for 2 users) | **$0** |
| Cloudflare Pages Functions (API) | 100k req/day | **$0** (Workers Paid $5/mo only if vastly exceeded) |
| MapTiler tiles | 100k loads/mo | **$0** |
| Nominatim geocoding | Free (1 req/s) | **$0** |
| Domain | already own `mindren.lu` | **$0** |

**Total: ~$0/month**, scaling to cents/month only when the photo library exceeds 10 GB. No credit
card is strictly required to start (R2 needs a card on file for overage but won't charge within free
tier). Contrast: Supabase = $0 (with pausing + 1 GB) or $25/mo; Firebase = card required + egress
bill-shock risk.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| **EXIF GPS frequently missing** (AirDrop/iCloud/screenshots strip it) | Mandatory manual marker-placement fallback; remember last location to pre-fill consecutive photos |
| Full-res storage grows | R2 10 GB free + $0.015/GB after; thumbnails keep the map fast regardless |
| markercluster goes stale after add/delete | `clearLayers()` + re-add after every write |
| Nominatim rate-limit/IP block | Throttle to 1 req/s, send `User-Agent`, cache every result |
| Presigned URL expiry / CORS misconfig → silent upload fail | ~15 min TTL, regenerate on retry, explicit upload progress/error UI |
| HEIC display on non-Safari | heic2any convert-for-display; read EXIF from original first |
| Orientation double-rotation | Use exifr's orientation; apply once in the thumbnail step |
| Passphrase leak | Secret + HMAC key live only in the Worker; rotate via `wrangler secret put` to invalidate all tokens |
| Mobile upload UX (no preview, slow on cellular) | Show thumbnails + progress; allow retry |
| D1 SQLite single-writer | Fine for 2 users; rare simultaneous writes just retry |

---

## 13. Verification / testing (end-to-end)

1. **Run the whole thing locally with one command:** `wrangler pages dev` serves the static site, the
   Pages Function, **and** a local **simulated R2 + D1** (Miniflare; persisted in `.wrangler/`). No
   cloud, no cost. Apply the schema once: `wrangler d1 execute travel --local --file=schema.sql`. Open
   the printed `http://localhost:8788`.
2. **Exercise it locally:** the map, clustering, and popup carousel render against your local data;
   hit write routes with a wrong vs right passphrase (`401` vs `200`); uploaded photos land in
   **local** R2 and rows in **local** D1 (inspect with
   `wrangler d1 execute travel --local --command "SELECT * FROM photos"`).
3. **EXIF pipeline:** test with (a) an iPhone **HEIC with GPS**, (b) an Android **JPEG with GPS**,
   (c) a **screenshot / GPS-stripped** image → confirm auto-place for a/b, manual fallback for c, and
   correct `taken_at` parsing.
4. **Full-res + thumbnail:** verify the original lands in R2 untouched (same bytes/dimensions) and a
   small thumbnail is generated and used on the map.
5. **Write/persist:** upload from one browser; load the site in a **fresh/incognito browser** (no
   token) → the photo is visible to the public. Delete it → gone for everyone.
6. **Wishlist:** add a wishlist place, check it off → becomes a visited marker.
7. **Timeline:** drag the slider → markers/list filter by date correctly.
8. **Mobile:** load on a real iPhone (Safari) and Android (Chrome): map gestures, bottom sheet,
   popup sizing, upload from camera roll, HEIC display.
9. **Security:** confirm the passphrase/secret never appears in any client JS or network response,
   and that writes fail without a valid token. Re-check CORS only allows `mindren.lu`.
10. **Deploy:** just `git push` — Cloudflare Pages auto-builds and deploys the site + Function.
    Every branch/PR also gets a **preview URL**, so you can test a change in a real cloud environment
    before it reaches production `mindren.lu`. Re-run 3–9 against the preview, then promote.

---

## 14. Open decisions / future enhancements

- **Hosting:** Cloudflare Pages (recommended — site + backend in one repo/deploy, same-origin) vs
  staying on GitHub Pages with a standalone Worker. Easy to switch later either way.
- **Tiles:** MapTiler (recommended) vs OpenFreeMap (no key, but requires MapLibre instead of Leaflet).
- **Nice-to-haves later:** trip grouping (auto-cluster photos into named trips by date+place), routes/
  lines between places, map "fog of war"/visited-countries overlay, captions/journaling per place,
  EXIF-camera info, private vs public places, bulk import of a phone album, a weekly DB backup export.

---

### Appendix — primary sources

GitHub Pages limits & LFS:
[limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits),
[LFS](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage) ·
Cloudflare: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) ·
Backends: [Supabase pricing](https://supabase.com/pricing),
[Firebase pricing](https://firebase.google.com/pricing),
[Turso pricing](https://turso.tech/pricing),
[PocketBase](https://pocketbase.io/faq/),
[Backblaze B2](https://www.backblaze.com/cloud-storage/pricing) ·
Maps/tiles: [Leaflet](https://leafletjs.com/),
[Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster),
[MapTiler pricing](https://www.maptiler.com/cloud/pricing/),
[Stadia pricing](https://stadiamaps.com/pricing/),
[OSM tile policy](https://operations.osmfoundation.org/policies/tiles/),
[Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) ·
EXIF/photos: [exifr](https://github.com/MikeKovarik/exifr),
[heic2any](https://github.com/alexcorvi/heic2any),
[browser-image-compression](https://github.com/Donaldcwl/browser-image-compression) ·
Inspiration: [embers-of-life](https://github.com/jasonlcy91/embers-of-life-china-trip-2026),
[travel-map](https://github.com/reedtang666/travel-map),
[GeoGallery](https://github.com/Yorik56/GeoGallery),
[Dawarich](https://github.com/Freika/dawarich) ·
Security: [Securing S3 presigned URLs](https://aws.amazon.com/blogs/compute/securing-amazon-s3-presigned-urls-for-serverless-applications/).
