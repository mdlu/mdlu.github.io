// Leaflet map: clustered place markers + photo-carousel popups.
import { CONFIG } from './config.js';
import { photoUrl } from './api.js';
import { escapeHtml, fmtDate, placeDateText, placeInterval } from './util.js';

let map, cluster;
let photosByPlace = {};
let allPlaces = [];
let editing = false;
let handlers = {};
let searchMarker = null;

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

// Fly to a search result, drop a temporary pin there, and offer to add it as a place.
export function goToResult(r) {
  if (!map || !r) return;
  clearSearchMarker();
  searchMarker = L.marker([r.lat, r.lng], { icon: searchIcon(), zIndexOffset: 1000 }).addTo(map);
  searchMarker.bindPopup(() => searchPopupEl(r), { maxWidth: 280, minWidth: 200, className: 'tl-popup-wrap' });
  searchMarker.on('popupopen', (e) => {
    const root = e.popup.getElement();
    if (!root) return;
    const btn = root.querySelector('.tl-search-add');
    if (btn) btn.addEventListener('click', () => handlers.onAddSearchResult && handlers.onAddSearchResult(r));
    const wbtn = root.querySelector('.tl-search-add-wishlist');
    if (wbtn) wbtn.addEventListener('click', () => handlers.onAddSearchResultWishlist && handlers.onAddSearchResultWishlist(r));
  });
  if (r.bbox) map.fitBounds(r.bbox, { maxZoom: 16, padding: [20, 20] });
  else map.setView([r.lat, r.lng], 14);
  searchMarker.openPopup();
}

export function clearSearchMarker() {
  if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
}

function searchIcon() {
  return L.divIcon({
    className: 'tl-pin tl-pin-search', html: '<span class="tl-pin-dot"></span>',
    iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12],
  });
}

function searchPopupEl(r) {
  const el = document.createElement('div');
  el.className = 'tl-popup';
  el.innerHTML = `
    <div class="tl-popup-head"><h3>${escapeHtml(r.label)}</h3></div>
    ${editing
      ? `<div class="tl-search-actions">
           <button class="tl-btn tl-btn-primary tl-search-add">+ Add as a place</button>
           <button class="tl-btn tl-btn-wish tl-search-add-wishlist">+ Add as a place to go</button>
         </div>`
      : `<div class="tl-hint">Turn on edit mode to add this as a place.</div>`}`;
  return el;
}

// Render all places; returns { placeId: marker } for sidebar fly-to.
export function render(data, range) {
  photosByPlace = groupPhotos(data.photos || []);
  allPlaces = data.places || [];
  cluster.clearLayers();
  const markers = {};
  for (const place of allPlaces) {
    if (!placeInRange(place, range)) continue;
    const m = L.marker([place.lat, place.lng], { icon: iconFor(place.status), draggable: editing });
    m.bindPopup(() => popupEl(place), { maxWidth: 300, minWidth: 240, className: 'tl-popup-wrap' });
    m.off('click');                 // hover-preview + click-to-pin instead of Leaflet's click-to-open
    m._pinned = false; m._overPopup = false;
    m.on('mouseover', () => { clearTimeout(m._closeTimer); if (!m._pinned) m.openPopup(); });
    m.on('mouseout', () => { if (!m._pinned) scheduleClose(m); });
    m.on('click', () => {
      if (m._pinned) { m._pinned = false; m.closePopup(); }
      else { m._pinned = true; m.openPopup(); }
    });
    m.on('popupopen', (e) => {
      initCarousel(e.popup);
      const el = e.popup.getElement();
      if (el) {
        el.addEventListener('mouseenter', () => { m._overPopup = true; clearTimeout(m._closeTimer); });
        el.addEventListener('mouseleave', () => { m._overPopup = false; if (!m._pinned) scheduleClose(m); });
      }
    });
    m.on('popupclose', () => { m._pinned = false; m._overPopup = false; clearTimeout(m._closeTimer); });
    if (editing) m.on('dragend', () => handlers.onMovePlace && handlers.onMovePlace(place, m.getLatLng()));
    markers[place.id] = m;
    cluster.addLayer(m);
  }
  return markers;
}

// A place passes the date filter if it's undated (no photos) or has a photo within [start, end].
function placeInRange(place, range) {
  if (!range) return true;
  const iv = placeInterval(place, (photosByPlace[place.id] || []).map((p) => p.taken_at).filter(Boolean));
  if (!iv) return true;                              // undated places always show
  return iv[0] <= range[1] && iv[1] >= range[0];     // place's date span overlaps the selected window
}

export function flyToPlace(markers, id) {
  const m = markers[id];
  if (!m) return;
  m._pinned = true;                 // intentional open -> stays until clicked/closed
  cluster.zoomToShowLayer(m, () => {
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 8), { duration: 0.6 });
    m.openPopup();
  });
}

// Reopen a place's popup in place (no fly) — used after edits/uploads so it stays up.
export function reopenPlace(markers, id) {
  const m = markers[id];
  if (!m) return;
  m._pinned = true;                 // after an edit/add, keep the popup up
  cluster.zoomToShowLayer(m, () => m.openPopup());
}

// ---------- internals ----------

// Close a hover-opened popup shortly after the cursor leaves both the marker and the popup,
// so there's time to move onto the popup and click its arrows/buttons.
function scheduleClose(m) {
  clearTimeout(m._closeTimer);
  m._closeTimer = setTimeout(() => { if (!m._pinned && !m._overPopup) m.closePopup(); }, 250);
}

function groupPhotos(photos) {
  const by = {};
  for (const p of photos) (by[p.place_id] ||= []).push(p);
  for (const k in by) by[k].sort(byTakenAt);
  return by;
}

// Oldest -> newest by taken_at; undated photos go last.
function byTakenAt(a, b) {
  const ta = a.taken_at || '', tb = b.taken_at || '';
  if (!ta && !tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return ta.localeCompare(tb);
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
  const gmaps = `<a class="tl-gmaps" href="https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}" target="_blank" rel="noopener" title="Open in Google Maps">Maps&nbsp;&#8599;</a>`;
  const photoDates = photos.map((p) => p.taken_at).filter(Boolean);
  const dateLabel = placeDateText(place, photoDates);
  const date = dateLabel ? `<span>${escapeHtml(dateLabel)}</span>` : '';
  const notes = place.notes ? `<span class="tl-notes">${escapeHtml(place.notes)}</span>` : '';
  const others = allPlaces.filter((q) => q.id !== place.id);
  const tools = editing ? `
    <div class="tl-edit-tools">
      <button class="tl-btn tl-editdetails">Edit</button>
      ${place.status === 'wishlist'
        ? `<button class="tl-btn tl-checkvisited">Mark as visited</button>`
        : `<label class="tl-btn">Add photos<input type="file" accept="image/*" multiple hidden class="tl-addphotos"></label>`}
      <button class="tl-btn tl-btn-danger tl-delplace">Delete place</button>
    </div>
    ${others.length ? `<div class="tl-merge-row">
      <select class="tl-merge"><option value="">Merge into…</option>${others.map((q) => `<option value="${q.id}">${escapeHtml(q.name)}</option>`).join('')}</select>
    </div>` : ''}
    <div class="tl-hint">Tip: drag the pin to move this place.</div>` : '';

  el.innerHTML = `
    <div class="tl-popup-head"><h3>${escapeHtml(place.name)}</h3>${badge}${gmaps}</div>
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
    const mergeSel = el.querySelector('.tl-merge');
    if (mergeSel) mergeSel.addEventListener('change', () => {
      if (mergeSel.value) handlers.onMergePlace && handlers.onMergePlace(place, mergeSel.value);
    });
    const checkBtn = el.querySelector('.tl-checkvisited');
    if (checkBtn) checkBtn.addEventListener('click', () => handlers.onCheckOff && handlers.onCheckOff(place.id));
    const editBtn = el.querySelector('.tl-editdetails');
    if (editBtn) editBtn.addEventListener('click', () => handlers.onEditPlace && handlers.onEditPlace(place));
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
