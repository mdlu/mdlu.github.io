// Thin wrapper around the backend API (see functions/api/[[path]].js).
import { CONFIG } from './config.js';

export async function getData() {
  const res = await fetch(`${CONFIG.API_BASE}/data`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /data failed (${res.status})`);
  return res.json();
}

// Public URL for a stored photo/thumbnail (served by the Function from R2).
export function photoUrl(key) {
  return `${CONFIG.API_BASE}/photo/${key}`;
}

// --- write helpers (used once auth/upload land in Phase 3) ---

export async function authedFetch(path, opts = {}, password) {
  const headers = new Headers(opts.headers || {});
  if (password) headers.set('x-edit-password', password);
  const res = await fetch(`${CONFIG.API_BASE}${path}`, { ...opts, headers });
  return res;
}

export async function createPlace(place, password) {
  return authedFetch('/places', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(place),
  }, password);
}

export async function deletePlace(id, password) {
  return authedFetch(`/places/${id}`, { method: 'DELETE' }, password);
}

export async function deletePhoto(id, password) {
  return authedFetch(`/photos/${id}`, { method: 'DELETE' }, password);
}

export async function createPreset(preset, password) {
  return authedFetch('/presets', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(preset),
  }, password);
}

export async function updatePreset(id, patch, password) {
  return authedFetch(`/presets/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
  }, password);
}

export async function deletePreset(id, password) {
  return authedFetch(`/presets/${id}`, { method: 'DELETE' }, password);
}
