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
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=15&addressdetails=1`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) name = nameFrom(await res.json());
  } catch { /* offline/blocked — caller falls back to a manual name */ }
  cache.set(key, name);
  return name;
}

// Forward search (autocomplete) via Photon (komoot) — built for as-you-type, free, CORS-enabled.
export async function searchPlaces(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map(featureToResult).filter(Boolean);
  } catch {
    return [];
  }
}

function featureToResult(f) {
  const c = f.geometry && f.geometry.coordinates;
  if (!c) return null;
  const p = f.properties || {};
  const label = [p.name, p.city || p.state || p.county, p.country]
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  let bbox = null;
  if (Array.isArray(p.extent) && p.extent.length === 4) {
    const [w, n, e, s] = p.extent;   // Photon extent = [west, north, east, south]
    bbox = [[s, w], [n, e]];
  }
  return { label: label || p.name || `${c[1].toFixed(4)}, ${c[0].toFixed(4)}`, lat: c[1], lng: c[0], bbox };
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
  // Most specific named feature at the point (POI, then street/area), then the locality, then country.
  const specific = d.name || a.amenity || a.tourism || a.leisure || a.shop || a.building
    || a.road || a.neighbourhood || a.suburb || '';
  const locality = a.city || a.town || a.village || a.municipality || a.county || a.state || '';
  const parts = [];
  if (specific) parts.push(specific);
  if (locality && locality !== specific) parts.push(locality);
  if (a.country && !parts.includes(a.country)) parts.push(a.country);
  return parts.slice(0, 3).join(', ') || d.display_name || '';
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
