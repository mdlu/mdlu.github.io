// Client-side photo pipeline: read EXIF (date + GPS) from the ORIGINAL, convert HEIC->JPEG,
// make a thumbnail, then upload. Heavy libs are lazy-loaded only when a writer actually uploads.
import { authedFetch } from './api.js';
import { getPassword } from './auth.js';

const LIBS = [
  'https://cdn.jsdelivr.net/npm/exifr/dist/full.umd.js',                              // window.exifr
  'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',                 // window.heic2any
  'https://cdn.jsdelivr.net/npm/browser-image-compression@2/dist/browser-image-compression.js', // window.imageCompression
];

let libsPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}
function ensureLibs() {
  if (!libsPromise) libsPromise = Promise.all(LIBS.map(loadScript));
  return libsPromise;
}

// Returns { full: File, thumb: File|null, takenAt: ISO|null, lat, lng }.
export async function processFile(file) {
  await ensureLibs();

  // 1) EXIF from the ORIGINAL (before any conversion/re-encode strips it)
  let gps = null, meta = null;
  try { gps = await window.exifr.gps(file); } catch { /* no gps */ }
  try { meta = await window.exifr.parse(file, ['DateTimeOriginal']); } catch { /* no exif */ }
  const takenAt = toIso(meta && meta.DateTimeOriginal);
  const lat = gps && gps.latitude != null ? gps.latitude : null;
  const lng = gps && gps.longitude != null ? gps.longitude : null;

  // 2) full image: convert HEIC/HEIF -> JPEG (full res, high quality); other formats kept as-is
  let full = file;
  if (isHeic(file)) {
    const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(out) ? out[0] : out;
    full = new File([blob], renameExt(file.name, 'jpg'), { type: 'image/jpeg' });
  }

  // 3) thumbnail (~600px) for fast map/grid rendering (browser-image-compression handles orientation)
  let thumb = null;
  try {
    thumb = await window.imageCompression(full, {
      maxWidthOrHeight: 600, maxSizeMB: 0.2, useWebWorker: true,
      fileType: 'image/jpeg', initialQuality: 0.7,
    });
  } catch { thumb = null; }

  return { full, thumb, takenAt, lat, lng };
}

export async function uploadPhoto(placeId, file) {
  const { full, thumb, takenAt, lat, lng } = await processFile(file);
  const fd = new FormData();
  fd.append('original', full, full.name || 'photo.jpg');
  if (thumb) fd.append('thumb', thumb, 'thumb.jpg');
  fd.append('meta', JSON.stringify({ place_id: placeId, taken_at: takenAt, lat, lng }));
  const res = await authedFetch('/photos', { method: 'POST', body: fd }, getPassword());
  if (!res.ok) throw new Error('upload failed (' + res.status + ')');
  return res.json();
}

function isHeic(file) {
  const t = (file.type || '').toLowerCase(), n = (file.name || '').toLowerCase();
  return t.includes('heic') || t.includes('heif') || n.endsWith('.heic') || n.endsWith('.heif');
}
function renameExt(name, ext) { return (name || 'photo').replace(/\.[^.]+$/, '') + '.' + ext; }
function toIso(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}
