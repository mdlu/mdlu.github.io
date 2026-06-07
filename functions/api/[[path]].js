// Cloudflare Pages Function — the travel-log backend API.
// Catch-all for /api/*. Reaches D1 (env.DB) and R2 (env.BUCKET) via bindings (wrangler.toml).
//
// Public (no auth):
//   GET    /api/data            -> { places, photos }
//   GET    /api/photo/<key...>  -> streams a photo/thumbnail from R2
// Password-gated (header  x-edit-password == env.EDIT_PASSWORD):
//   POST   /api/photos          -> multipart {original, thumb?, meta} -> R2 + D1 row
//   DELETE /api/photos/:id      -> remove R2 objects + D1 row
//   POST   /api/places          -> json {name,lat,lng,status?,visited_at?,notes?} -> D1 row
//   PATCH  /api/places/:id       -> update place (e.g. check off wishlist -> visited)
//   DELETE /api/places/:id       -> delete place + cascade its photos (R2 + D1)
//
// Same-origin (Pages serves the site + this function), so no CORS needed.

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const path = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);

  try {
    // ---- public reads ----
    if (method === 'GET' && path[0] === 'data') return getData(env);
    if (method === 'GET' && path[0] === 'photo') return getPhoto(env, path.slice(1).join('/'));

    // ---- everything below requires the shared passphrase ----
    if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);

    if (method === 'POST'   && path[0] === 'verify')                      return json({ ok: true });
    if (method === 'POST'   && path[0] === 'presets' && path.length === 1) return addPreset(request, env);
    if (method === 'PATCH'  && path[0] === 'presets' && path[1])           return updatePreset(request, env, path[1]);
    if (method === 'DELETE' && path[0] === 'presets' && path[1])           return deletePreset(env, path[1]);
    if (method === 'POST'   && path[0] === 'photos' && path.length === 1) return addPhoto(request, env);
    if (method === 'DELETE' && path[0] === 'photos' && path[1])           return deletePhoto(env, path[1]);
    if (method === 'POST'   && path[0] === 'places' && path.length === 1) return addPlace(request, env);
    if (method === 'PATCH'  && path[0] === 'places' && path[1])           return patchPlace(request, env, path[1]);
    if (method === 'DELETE' && path[0] === 'places' && path[1])           return deletePlace(env, path[1]);

    return json({ error: 'not found', method, path }, 404);
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

// ----------------------------- handlers -----------------------------

async function getData(env) {
  const places = (await env.DB.prepare(
    `SELECT id, name, lat, lng, status, visited_at, notes, created_at FROM places`
  ).all()).results || [];
  const photos = (await env.DB.prepare(
    `SELECT id, place_id, r2_key, thumb_key, taken_at, lat, lng, caption, created_at
       FROM photos ORDER BY taken_at`
  ).all()).results || [];
  const presets = (await env.DB.prepare(
    `SELECT id, label, lat, lng, zoom, created_at FROM presets ORDER BY created_at`
  ).all()).results || [];
  return json({ places, photos, presets }, 200, { 'cache-control': 'no-store' });
}

async function getPhoto(env, key) {
  if (!key) return new Response('missing key', { status: 400 });
  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}

async function addPhoto(request, env) {
  const form = await request.formData();
  const original = form.get('original');
  const thumb = form.get('thumb');
  let meta = {};
  try { meta = JSON.parse(form.get('meta') || '{}'); } catch { /* ignore */ }

  if (!original || typeof original.arrayBuffer !== 'function') return json({ error: 'missing original file' }, 400);
  if (!meta.place_id) return json({ error: 'missing meta.place_id' }, 400);

  const id = crypto.randomUUID();
  const r2_key = `photos/${id}.${extFor(original.type)}`;
  const thumb_key = (thumb && typeof thumb.arrayBuffer === 'function') ? `thumbs/${id}.jpg` : r2_key;

  await env.BUCKET.put(r2_key, await original.arrayBuffer(), {
    httpMetadata: { contentType: original.type || 'application/octet-stream' },
  });
  if (thumb_key !== r2_key) {
    await env.BUCKET.put(thumb_key, await thumb.arrayBuffer(), {
      httpMetadata: { contentType: thumb.type || 'image/jpeg' },
    });
  }

  const created_at = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO photos (id, place_id, r2_key, thumb_key, taken_at, lat, lng, caption, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, meta.place_id, r2_key, thumb_key,
    meta.taken_at || null, numOrNull(meta.lat), numOrNull(meta.lng), meta.caption || null, created_at
  ).run();

  return json({ id, place_id: meta.place_id, r2_key, thumb_key, taken_at: meta.taken_at || null, created_at });
}

async function deletePhoto(env, id) {
  const row = await env.DB.prepare(`SELECT r2_key, thumb_key FROM photos WHERE id = ?`).bind(id).first();
  if (!row) return json({ error: 'not found' }, 404);
  await env.BUCKET.delete(row.r2_key);
  if (row.thumb_key && row.thumb_key !== row.r2_key) await env.BUCKET.delete(row.thumb_key);
  await env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

async function addPlace(request, env) {
  const b = await request.json().catch(() => ({}));
  if (!b.name || b.lat == null || b.lng == null) return json({ error: 'name, lat, lng required' }, 400);
  const id = b.id || crypto.randomUUID();
  const status = b.status === 'wishlist' ? 'wishlist' : 'visited';
  const created_at = new Date().toISOString();
  const visited_at = b.visited_at || (status === 'visited' ? created_at.slice(0, 10) : null);
  await env.DB.prepare(
    `INSERT INTO places (id, name, lat, lng, status, visited_at, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, b.name, Number(b.lat), Number(b.lng), status, visited_at, b.notes || null, created_at).run();
  return json({ id, name: b.name, lat: Number(b.lat), lng: Number(b.lng), status, visited_at, notes: b.notes || null, created_at });
}

async function patchPlace(request, env, id) {
  const b = await request.json().catch(() => ({}));
  const cur = await env.DB.prepare(`SELECT * FROM places WHERE id = ?`).bind(id).first();
  if (!cur) return json({ error: 'not found' }, 404);
  const name = b.name ?? cur.name;
  const lat = b.lat != null ? Number(b.lat) : cur.lat;
  const lng = b.lng != null ? Number(b.lng) : cur.lng;
  const notes = b.notes ?? cur.notes;
  const status = (b.status === 'visited' || b.status === 'wishlist') ? b.status : cur.status;
  let visited_at = b.visited_at ?? cur.visited_at;
  if (status === 'visited' && !visited_at) visited_at = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `UPDATE places SET name=?, lat=?, lng=?, status=?, visited_at=?, notes=? WHERE id=?`
  ).bind(name, lat, lng, status, visited_at, notes, id).run();
  return json({ id, name, lat, lng, status, visited_at, notes });
}

async function deletePlace(env, id) {
  const photos = (await env.DB.prepare(`SELECT r2_key, thumb_key FROM photos WHERE place_id = ?`).bind(id).all()).results || [];
  for (const p of photos) {
    await env.BUCKET.delete(p.r2_key);
    if (p.thumb_key && p.thumb_key !== p.r2_key) await env.BUCKET.delete(p.thumb_key);
  }
  await env.DB.prepare(`DELETE FROM photos WHERE place_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM places WHERE id = ?`).bind(id).run();
  return json({ ok: true, deletedPhotos: photos.length });
}

async function addPreset(request, env) {
  const b = await request.json().catch(() => ({}));
  if (!b.label || b.lat == null || b.lng == null) return json({ error: 'label, lat, lng required' }, 400);
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const zoom = Number.isFinite(Number(b.zoom)) ? Math.round(Number(b.zoom)) : 10;
  const label = String(b.label).slice(0, 60);
  await env.DB.prepare(
    `INSERT INTO presets (id, label, lat, lng, zoom, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, label, Number(b.lat), Number(b.lng), zoom, created_at).run();
  return json({ id, label, lat: Number(b.lat), lng: Number(b.lng), zoom, created_at });
}

async function updatePreset(request, env, id) {
  const b = await request.json().catch(() => ({}));
  const cur = await env.DB.prepare(`SELECT * FROM presets WHERE id = ?`).bind(id).first();
  if (!cur) return json({ error: 'not found' }, 404);
  const label = (b.label != null && String(b.label).trim()) ? String(b.label).slice(0, 60) : cur.label;
  const lat = b.lat != null ? Number(b.lat) : cur.lat;
  const lng = b.lng != null ? Number(b.lng) : cur.lng;
  const zoom = b.zoom != null ? Math.round(Number(b.zoom)) : cur.zoom;
  await env.DB.prepare(`UPDATE presets SET label=?, lat=?, lng=?, zoom=? WHERE id=?`).bind(label, lat, lng, zoom, id).run();
  return json({ id, label, lat, lng, zoom, created_at: cur.created_at });
}

async function deletePreset(env, id) {
  await env.DB.prepare(`DELETE FROM presets WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

// ----------------------------- helpers -----------------------------

function authorized(request, env) {
  const supplied = request.headers.get('x-edit-password') || '';
  const expected = env.EDIT_PASSWORD || '';
  if (!expected || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function numOrNull(v) { return (v == null || v === '' || isNaN(Number(v))) ? null : Number(v); }

function extFor(mime) {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png':  return 'png';
    case 'image/webp': return 'webp';
    case 'image/heic': return 'heic';
    case 'image/heif': return 'heif';
    default:           return 'jpg';
  }
}
