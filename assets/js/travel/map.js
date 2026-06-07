// Leaflet map: clustered place markers + photo-carousel popups.
import { CONFIG } from './config.js';
import { photoUrl } from './api.js';
import { escapeHtml, fmtDate, dateRangeLabel } from './util.js';

let map, cluster;
let photosByPlace = {};
let editing = false;
let handlers = {};

export function setEditing(v) { editing = !!v; }
export function setHandlers(h) { handlers = h || {}; }

// One-shot: next map click returns its latlng (for adding a place by clicking the map).
export function pickLocation(cb) {
  const onClick = (e) => { map.off('click', onClick); map.getContainer().style.cursor = ''; cb(e.latlng); };
  map.getContainer().style.cursor = 'crosshair';
  map.on('click', onClick);
}

export function initMap() {
  map = L.map('map', {
    center: CONFIG.MAP.center,
    zoom: CONFIG.MAP.zoom,
    minZoom: CONFIG.MAP.minZoom,
    maxZoom: CONFIG.MAP.maxZoom,
    worldCopyJump: true,                    // allow natural infinite east/west wrapping
    maxBounds: [[-85, -1e5], [85, 1e5]],    // bound latitude only — stops infinite north/south
    maxBoundsViscosity: 1.0,
  });
  L.tileLayer(CONFIG.TILES.url, CONFIG.TILES.options).addTo(map);
  cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
  map.addLayer(cluster);
  return map;
}

// Jump the map to a preset area (CONFIG.PRESETS).
export function applyPreset(preset) {
  if (!map || !preset) return;
  if (preset.bounds) map.fitBounds(preset.bounds, { padding: [20, 20] });
  else if (preset.center) map.setView(preset.center, preset.zoom);
  else if (preset.lat != null && preset.lng != null) map.setView([preset.lat, preset.lng], preset.zoom || 10);
}

// Current map view, for saving as a new preset.
export function getView() {
  const c = map.getCenter();
  return { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), zoom: map.getZoom() };
}

// Render all places; returns { placeId: marker } for sidebar fly-to.
export function render(data) {
  photosByPlace = groupPhotos(data.photos || []);
  cluster.clearLayers();
  const markers = {};
  for (const place of data.places || []) {
    const m = L.marker([place.lat, place.lng], { icon: iconFor(place.status) });
    m.bindPopup(() => popupEl(place), { maxWidth: 300, minWidth: 240, className: 'tl-popup-wrap' });
    m.on('popupopen', (e) => initCarousel(e.popup));
    markers[place.id] = m;
    cluster.addLayer(m);
  }
  return markers;
}

export function flyToPlace(markers, id) {
  const m = markers[id];
  if (!m) return;
  cluster.zoomToShowLayer(m, () => {
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 8), { duration: 0.6 });
    m.openPopup();
  });
}

// ---------- internals ----------

function groupPhotos(photos) {
  const by = {};
  for (const p of photos) (by[p.place_id] ||= []).push(p);
  for (const k in by) by[k].sort((a, b) => String(a.taken_at || '').localeCompare(String(b.taken_at || '')));
  return by;
}

function iconFor(status) {
  return L.divIcon({
    className: `tl-pin tl-pin-${status === 'wishlist' ? 'wishlist' : 'visited'}`,
    html: '<span class="tl-pin-dot"></span>',
    iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12],
  });
}

function popupEl(place) {
  const photos = photosByPlace[place.id] || [];
  const el = document.createElement('div');
  el.className = 'tl-popup';

  let media;
  if (photos.length) {
    const slides = photos.map((p) => `
      <div class="swiper-slide">
        <a href="${photoUrl(p.r2_key)}" data-fancybox="tl-${place.id}" data-caption="${escapeHtml([fmtDate(p.taken_at), p.caption].filter(Boolean).join(' · '))}" target="_blank" rel="noopener">
          <img src="${photoUrl(p.thumb_key)}" loading="lazy" alt="">
        </a>
        ${p.taken_at ? `<div class="tl-cap tl-cap-date">${fmtDate(p.taken_at)}</div>` : ''}
        ${p.caption ? `<div class="tl-cap">${escapeHtml(p.caption)}</div>` : ''}
        ${editing ? `<button class="tl-photo-del" data-photo="${p.id}" title="Delete photo" aria-label="Delete photo">&times;</button>` : ''}
      </div>`).join('');
    media = `
      <div class="swiper tl-swiper">
        <div class="swiper-wrapper">${slides}</div>
        <div class="swiper-pagination"></div>
        <div class="swiper-button-prev"></div>
        <div class="swiper-button-next"></div>
      </div>`;
  } else {
    media = `<div class="tl-noimg">No photos yet</div>`;
  }

  const badge = place.status === 'wishlist' ? '<span class="tl-badge">Wishlist</span>' : '';
  const photoDates = photos.map((p) => p.taken_at).filter(Boolean);
  const dateLabel = photoDates.length ? dateRangeLabel(photoDates) : (place.visited_at ? fmtDate(place.visited_at) : '');
  const date = dateLabel ? `<span>${escapeHtml(dateLabel)}</span>` : '';
  const notes = place.notes ? `<span class="tl-notes">${escapeHtml(place.notes)}</span>` : '';
  const tools = editing ? `
    <div class="tl-edit-tools">
      <label class="tl-btn">Add photos<input type="file" accept="image/*" multiple hidden class="tl-addphotos"></label>
      <button class="tl-btn tl-btn-danger tl-delplace">Delete place</button>
    </div>` : '';

  el.innerHTML = `
    <div class="tl-popup-head"><h3>${escapeHtml(place.name)}</h3>${badge}</div>
    ${media}
    <div class="tl-popup-meta">${date}${notes}</div>
    ${tools}`;

  if (editing) {
    const addInput = el.querySelector('.tl-addphotos');
    if (addInput) addInput.addEventListener('change', (e) => handlers.onAddPhotos && handlers.onAddPhotos(place, e.target.files));
    const delPlaceBtn = el.querySelector('.tl-delplace');
    if (delPlaceBtn) delPlaceBtn.addEventListener('click', () => handlers.onDeletePlace && handlers.onDeletePlace(place));
    el.querySelectorAll('.tl-photo-del').forEach((b) =>
      b.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        handlers.onDeletePhoto && handlers.onDeletePhoto(b.getAttribute('data-photo'), place);
      }));
  }
  return el;
}

function initCarousel(popup) {
  const root = popup.getElement() && popup.getElement().querySelector('.tl-swiper');
  if (!root || root._swiper || typeof Swiper === 'undefined') return;
  root._swiper = new Swiper(root, {
    pagination: { el: root.querySelector('.swiper-pagination'), clickable: true },
    navigation: {
      nextEl: root.querySelector('.swiper-button-next'),
      prevEl: root.querySelector('.swiper-button-prev'),
    },
  });
  setTimeout(() => root._swiper && root._swiper.update(), 60);
}
