// Reverse geocoding (Nominatim, client-side, throttled + cached) and geo helpers.
// Client-side keeps requests on each user's own IP (kinder to Nominatim) and needs no backend.

const cache = new Map();
let lastCall = 0;

export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);
  const wait = Math.max(0, 1100 - (Date.now() - lastCall)); // honor Nominatim's ~1 req/sec
  if (wait) await sleep(wait);
  lastCall = Date.now();
  let name = '';
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) name = nameFrom(await res.json());
  } catch { /* offline/blocked — caller falls back to a manual name */ }
  cache.set(key, name);
  return name;
}

export function distanceMeters(a, b) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function centroidOf(items) {
  const n = items.length || 1;
  return {
    lat: items.reduce((s, p) => s + p.lat, 0) / n,
    lng: items.reduce((s, p) => s + p.lng, 0) / n,
  };
}

// Greedy clustering: each item joins the first group whose centroid is within `meters`, else starts one.
export function groupByProximity(items, meters) {
  const groups = [];
  for (const it of items) {
    const g = groups.find((grp) => distanceMeters(centroidOf(grp), { lat: it.lat, lng: it.lng }) <= meters);
    if (g) g.push(it); else groups.push([it]);
  }
  return groups;
}

function nameFrom(d) {
  const a = d.address || {};
  const local = a.city || a.town || a.village || a.suburb || a.neighbourhood || a.county || a.state || '';
  return [local, a.country].filter(Boolean).join(', ') || d.display_name || '';
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
