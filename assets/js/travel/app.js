// Entry point: load data, build the map + sidebar.
import { getData, createPlace, updatePlace, deletePlace, deletePhoto, mergePlace, createPreset, updatePreset, deletePreset } from './api.js';
import { initMap, render, flyToPlace, applyPreset, getView, goToResult, clearSearchMarker, setEditing, setHandlers, pickLocation } from './map.js';
import { getPassword, hasPassword, promptAndStore } from './auth.js';
import { processFile, uploadProcessed, uploadPhoto } from './upload.js';
import { reverseGeocode, searchPlaces, distanceMeters, centroidOf, groupByProximity } from './geo.js';
import { openModal } from './modal.js';
import { escapeHtml, fmtDate, dateRangeLabel, placeDateText, placeInterval } from './util.js';

const state = { data: null, markers: {}, editing: false, range: null, filterVisited: '', filterWishlist: '' };
let timelineSlider = null;
let searchResults = [];
let searchTimer = null;

function rerender() { state.markers = render(state.data, state.range); }

async function main() {
  initMap();
  if (window.Fancybox) window.Fancybox.bind('[data-fancybox]');  // fullscreen photo gallery
  wireUi();
  if (!window.matchMedia('(max-width: 768px)').matches) document.getElementById('sidebar').classList.add('open'); // open by default on desktop
  try {
    state.data = await getData();
  } catch (err) {
    showError('Could not load travel data — is the dev server running? (' + err.message + ')');
    return;
  }
  rerender();
  buildSidebar(state.data);
  renderPresets();
  buildTimeline();
}

function wireUi() {
  const sb = document.getElementById('sidebar');
  document.getElementById('toggle-sidebar').addEventListener('click', () => sb.classList.toggle('open'));
  document.getElementById('close-sidebar').addEventListener('click', () => sb.classList.remove('open'));
  document.getElementById('toggle-edit').addEventListener('click', toggleEdit);
  document.getElementById('add-place').addEventListener('click', onAddPlace);
  document.getElementById('add-wishlist').addEventListener('click', onAddWishlist);
  const addPhotosInput = document.querySelector('#add-photos input');
  if (addPhotosInput) addPhotosInput.addEventListener('change', (e) => { onAddPhotosAuto(e.target.files); e.target.value = ''; });
  setHandlers({ onAddPhotos, onDeletePhoto, onDeletePlace, onMovePlace, onMergePlace, onCheckOff, onEditPlace, onAddSearchResult });
  wireSearch();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') maybeAutoRefresh(); });
  window.addEventListener('focus', maybeAutoRefresh);
  setInterval(maybeAutoRefresh, 25000);
  renderPresets();
  document.querySelectorAll('.tl-tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tl-tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const tab = t.getAttribute('data-tab');
      ['visited', 'wishlist', 'timeline', 'views'].forEach((name) => {
        document.getElementById('tab-' + name).classList.toggle('hidden', tab !== name);
      });
    });
  });
}

function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); }

function renderPresets() {
  const wrap = document.getElementById('list-views');
  if (!wrap) return;
  const presets = (state.data && state.data.presets) || [];
  let html = state.editing ? `<button class="tl-saveview" id="save-view">+ Save current view</button>` : '';
  html += presets.map((p) => `
    <div class="tl-view-row">
      <button class="tl-view" data-preset="${p.id}">${escapeHtml(p.label)}</button>
      ${state.editing ? `
        <button class="tl-view-act" data-edit="${p.id}" title="Rename" aria-label="Rename ${escapeHtml(p.label)}"><i class="fa-solid fa-pen"></i></button>
        <button class="tl-view-act tl-view-del" data-del="${p.id}" title="Delete" aria-label="Delete ${escapeHtml(p.label)}"><i class="fa-solid fa-xmark"></i></button>` : ''}
    </div>`).join('');
  if (!presets.length && !state.editing) html += '<div class="tl-empty">No saved views yet.</div>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-preset]').forEach((b) => {
    b.addEventListener('click', () => {
      applyPreset(presets.find((x) => x.id === b.getAttribute('data-preset')));
      if (window.matchMedia('(max-width: 768px)').matches) document.getElementById('sidebar').classList.remove('open');
    });
  });
  if (state.editing) {
    wrap.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => onRenamePreset(b.getAttribute('data-edit'))));
    wrap.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => onDeletePreset(b.getAttribute('data-del'))));
    const sv = document.getElementById('save-view');
    if (sv) sv.addEventListener('click', onSaveView);
  }
}

async function toggleEdit() {
  if (!state.editing) {
    if (!hasPassword() && !(await promptAndStore())) return;
    state.editing = true;
  } else {
    state.editing = false;
  }
  document.body.classList.toggle('tl-editing', state.editing);
  setEditing(state.editing);
  if (state.data) rerender();   // re-create markers so draggable matches edit mode
  const btn = document.getElementById('toggle-edit');
  if (btn) btn.title = state.editing ? 'Editing — click to finish' : 'Edit mode';
  renderPresets();
}

async function onSaveView() {
  const label = window.prompt('Name this preset (e.g. "Our neighborhood"):');
  if (!label) return;
  const v = getView();
  const res = await createPreset({ label, lat: v.lat, lng: v.lng, zoom: v.zoom }, getPassword());
  if (!res.ok) { window.alert('Could not save preset (' + res.status + ').'); return; }
  state.data.presets.push(await res.json());
  renderPresets();
}

async function onRenamePreset(id) {
  const p = (state.data.presets || []).find((x) => x.id === id);
  if (!p) return;
  const label = window.prompt('Rename preset:', p.label);
  if (label == null) return;
  const trimmed = label.trim();
  if (!trimmed || trimmed === p.label) return;
  const res = await updatePreset(id, { label: trimmed }, getPassword());
  if (!res.ok) { window.alert('Could not rename preset (' + res.status + ').'); return; }
  const updated = await res.json();
  const i = state.data.presets.findIndex((x) => x.id === id);
  if (i >= 0) state.data.presets[i] = updated;
  renderPresets();
}

async function onDeletePreset(id) {
  const p = (state.data.presets || []).find((x) => x.id === id);
  if (!p) return;
  if (!window.confirm(`Delete the preset “${p.label}”?`)) return;
  const res = await deletePreset(id, getPassword());
  if (!res.ok) { window.alert('Could not delete preset (' + res.status + ').'); return; }
  state.data.presets = state.data.presets.filter((x) => x.id !== id);
  renderPresets();
}

async function refresh(reopenId) {
  state.data = await getData();
  rerender();
  buildSidebar(state.data);
  renderPresets();
  buildTimeline();
  if (reopenId && state.markers[reopenId]) flyToPlace(state.markers, reopenId);
}

// Lighter refresh for auto-sync: re-pull data and re-render, but keep the timeline
// slider where the user left it (don't rebuild it).
async function softRefresh() {
  let data;
  try { data = await getData(); } catch { return; }
  state.data = data;
  rerender();
  buildSidebar(state.data);
  renderPresets();
  buildTimelineList();
}

// Auto-refresh to pick up the other person's changes — but never mid-interaction.
function maybeAutoRefresh() {
  if (document.body.classList.contains('tl-editing')) return;                       // you're editing
  if (!document.getElementById('modal').classList.contains('hidden')) return;       // a dialog is open
  if (document.querySelector('.leaflet-popup')) return;                             // a place popup is open
  const ms = document.getElementById('map-search-input');
  if (ms && document.activeElement === ms) return;                                  // typing in map search
  const msr = document.getElementById('map-search-results');
  if (msr && !msr.classList.contains('hidden')) return;                             // suggestions showing
  softRefresh();
}

async function onAddPlace() {
  showInfo('Click the map to drop the new place…');
  pickLocation(async (latlng) => {
    hideInfo();
    const suggested = await reverseGeocode(latlng.lat, latlng.lng);
    const data = await openModal({ title: 'Add place', name: suggested || '', requireWhen: true, confirmLabel: 'Add place' });
    if (!data) return;
    await createVisitedPlace(latlng, data);
  });
}

async function onAddSearchResult(r) {
  const data = await openModal({ title: 'Add place', name: r.label || '', requireWhen: true, confirmLabel: 'Add place' });
  if (!data) return;
  clearSearchMarker();
  await createVisitedPlace({ lat: r.lat, lng: r.lng }, data);
}

async function createVisitedPlace(latlng, data) {
  showInfo('Saving…');
  const res = await createPlace({
    name: data.name, lat: latlng.lat, lng: latlng.lng, status: 'visited',
    notes: data.notes || null,
    visited_at: data.from,
    visited_end: data.to,
  }, getPassword());
  if (!res.ok) { hideInfo(); window.alert('Could not create place (' + res.status + ').'); return; }
  const place = await res.json();
  if (data.photos.length) await uploadMany(place.id, data.photos);
  hideInfo();
  if (window.matchMedia('(max-width: 768px)').matches) document.getElementById('sidebar').classList.remove('open');
  await refresh(place.id);
}

async function uploadMany(placeId, files) {
  let done = 0, failed = 0;
  for (const f of files) {
    showInfo(`Uploading ${done + 1}/${files.length}…`);
    try { await uploadPhoto(placeId, f); } catch (e) { failed += 1; }
    done += 1;
  }
  if (failed) window.alert(`${failed} of ${files.length} photo(s) couldn't be uploaded.`);
}

async function onAddWishlist() {
  showInfo('Click the map to drop the place you want to go…');
  pickLocation(async (latlng) => {
    hideInfo();
    const suggested = await reverseGeocode(latlng.lat, latlng.lng);
    const data = await openModal({ title: 'Add a place to go', name: suggested || '', requireWhen: false, confirmLabel: 'Add' });
    if (!data) return;
    const res = await createPlace({ name: data.name, lat: latlng.lat, lng: latlng.lng, status: 'wishlist', notes: data.notes || null }, getPassword());
    if (!res.ok) { window.alert('Could not add (' + res.status + ').'); return; }
    const place = await res.json();
    if (window.matchMedia('(max-width: 768px)').matches) document.getElementById('sidebar').classList.remove('open');
    await refresh(place.id);
  });
}

async function onCheckOff(id) {
  const place = state.data.places.find((p) => p.id === id);
  if (!place) return;
  const data = await openModal({
    title: `Mark "${place.name}" as visited`, name: place.name, notes: place.notes || '',
    requireWhen: true, confirmLabel: 'Mark visited',
  });
  if (!data) return;
  showInfo('Saving…');
  // Always set status + dates; only send name/notes if the user actually changed them
  // (so a concurrent rename by the other person isn't clobbered).
  const patch = { status: 'visited', visited_at: data.from, visited_end: data.to };
  if (data.name && data.name !== place.name) patch.name = data.name;
  if ((data.notes || '') !== (place.notes || '')) patch.notes = data.notes;
  const res = await updatePlace(id, patch, getPassword());
  if (!res.ok) { hideInfo(); window.alert('Could not update (' + res.status + ').'); return; }
  if (data.photos.length) await uploadMany(id, data.photos);
  hideInfo();
  await refresh(id);
}

async function onEditPlace(place) {
  const data = await openModal({
    title: 'Edit name / notes', name: place.name, notes: place.notes || '',
    requireWhen: false, confirmLabel: 'Save',
  });
  if (!data) return;
  const patch = {};                                   // only send what actually changed
  if (data.name && data.name !== place.name) patch.name = data.name;
  if ((data.notes || '') !== (place.notes || '')) patch.notes = data.notes;
  if (!Object.keys(patch).length) return;             // nothing changed
  const res = await updatePlace(place.id, patch, getPassword());
  if (!res.ok) { window.alert('Could not save (' + res.status + ').'); return; }
  await refresh(place.id);
}

async function onAddPhotos(place, fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let done = 0, failed = 0;
  showInfo(`Uploading 0/${files.length}…`);
  for (const f of files) {
    try { await uploadPhoto(place.id, f); } catch (e) { failed += 1; }
    done += 1;
    showInfo(`Uploading ${done}/${files.length}…`);
  }
  hideInfo();
  if (failed) window.alert(`${failed} of ${files.length} photo(s) couldn't be uploaded.`);
  await refresh(place.id);
}

async function onDeletePhoto(photoId, place) {
  if (!window.confirm('Delete this photo?')) return;
  const res = await deletePhoto(photoId, getPassword());
  if (!res.ok) { window.alert('Could not delete photo (' + res.status + ').'); return; }
  await refresh(place && place.id);
}

async function onDeletePlace(place) {
  if (!window.confirm(`Delete “${place.name}” and all its photos?`)) return;
  const res = await deletePlace(place.id, getPassword());
  if (!res.ok) { window.alert('Could not delete place (' + res.status + ').'); return; }
  await refresh();
}

// Add a batch of photos and auto-place them on the map by their GPS.
async function onAddPhotosAuto(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  // 1) process all (EXIF date + GPS, HEIC->JPEG, thumbnail)
  const processed = [];
  for (let i = 0; i < files.length; i++) {
    showInfo(`Reading ${i + 1}/${files.length}…`);
    try { processed.push(await processFile(files[i])); } catch (e) { /* skip unreadable */ }
  }
  const geo = processed.filter((p) => p.lat != null && p.lng != null);
  const noGeo = processed.filter((p) => p.lat == null || p.lng == null);

  // 2) group GPS photos by proximity (~200 m), then match an existing place or create one per group
  let uploaded = 0;
  for (const group of groupByProximity(geo, 200)) {
    const c = centroidOf(group);
    let place = nearestPlace(c, 200);
    if (!place) {
      showInfo('Looking up place name…');
      const suggested = await reverseGeocode(c.lat, c.lng);
      const name = window.prompt('Name this place:', suggested || '');
      if (!name || !name.trim()) continue;               // user skipped this group
      const res = await createPlace({ name: name.trim(), lat: c.lat, lng: c.lng, status: 'visited' }, getPassword());
      if (!res.ok) { window.alert('Could not create place (' + res.status + ').'); continue; }
      place = await res.json();
      state.data.places.push(place);                     // so later groups can match it
    }
    for (const ph of group) {
      showInfo(`Uploading ${++uploaded}/${geo.length}…`);
      try { await uploadProcessed(place.id, ph); } catch (e) { /* keep going */ }
    }
  }

  // 3) photos without GPS -> let the user place them on the map
  hideInfo();
  if (noGeo.length && window.confirm(`${noGeo.length} photo(s) had no location. Place them on the map now?`)) {
    await placeNoGeoPhotos(noGeo);
  }
  await refresh();
}

function nearestPlace(pt, meters) {
  let best = null, bestD = Infinity;
  for (const p of state.data.places) {
    const d = distanceMeters(pt, { lat: p.lat, lng: p.lng });
    if (d < bestD) { bestD = d; best = p; }
  }
  return best && bestD <= meters ? best : null;
}

function placeNoGeoPhotos(photos) {
  return new Promise((resolve) => {
    showInfo('Click the map to place the photo(s) without location…');
    pickLocation(async (latlng) => {
      hideInfo();
      let place = nearestPlace({ lat: latlng.lat, lng: latlng.lng }, 200);
      if (!place) {
        const suggested = await reverseGeocode(latlng.lat, latlng.lng);
        const name = window.prompt('Name this place:', suggested || '');
        if (!name || !name.trim()) return resolve();
        const res = await createPlace({ name: name.trim(), lat: latlng.lat, lng: latlng.lng, status: 'visited' }, getPassword());
        if (!res.ok) { window.alert('Could not create place (' + res.status + ').'); return resolve(); }
        place = await res.json();
      }
      let i = 0;
      for (const ph of photos) { showInfo(`Uploading ${++i}/${photos.length}…`); try { await uploadProcessed(place.id, ph); } catch (e) { /* */ } }
      hideInfo();
      resolve();
    });
  });
}

async function onMovePlace(place, latlng) {
  const res = await updatePlace(place.id, { lat: latlng.lat, lng: latlng.lng }, getPassword());
  if (!res.ok) { window.alert('Could not move place (' + res.status + ').'); await refresh(place.id); return; }
  const p = state.data.places.find((x) => x.id === place.id);
  if (p) { p.lat = latlng.lat; p.lng = latlng.lng; }
  rerender();   // re-cluster at the new position
}

async function onMergePlace(place, intoId) {
  const target = state.data.places.find((x) => x.id === intoId);
  if (!target) return;
  if (!window.confirm(`Merge “${place.name}” into “${target.name}”?\nIts photos move there and “${place.name}” is removed.`)) {
    await refresh();   // reset the dropdown
    return;
  }
  const res = await mergePlace(place.id, intoId, getPassword());
  if (!res.ok) { window.alert('Could not merge (' + res.status + ').'); return; }
  await refresh(intoId);
}

function photoDatesByPlace() {
  const m = {};
  for (const ph of state.data.photos || []) if (ph.taken_at) (m[ph.place_id] ||= []).push(ph.taken_at);
  return m;
}

function buildTimeline() {
  const sliderEl = document.getElementById('timeline-slider');
  const labels = document.getElementById('timeline-labels');
  if (!sliderEl || !labels) return;
  if (timelineSlider) { timelineSlider.destroy(); timelineSlider = null; }

  const photoDates = photoDatesByPlace();
  const ts = (state.data.places || [])
    .map((p) => placeInterval(p, photoDates[p.id] || []))
    .filter(Boolean).flat();

  if (ts.length < 1 || !window.noUiSlider) {
    labels.textContent = 'No dated places yet.';
    sliderEl.innerHTML = '';
    document.getElementById('list-timeline').innerHTML = '';
    state.range = null;
    return;
  }

  const day = 86400000;
  const lo = Math.min(...ts);
  const hi = Math.max(Math.max(...ts), lo + day);
  state.range = null; // start unfiltered (full span)

  // Year tick marks (a labelled line at each Jan 1 within the span); months if it's under a year.
  const years = [];
  for (let y = new Date(lo).getUTCFullYear(); y <= new Date(hi).getUTCFullYear() + 1; y++) {
    const t = Date.UTC(y, 0, 1);
    if (t >= lo && t <= hi) years.push(t);
  }
  const pips = years.length >= 1
    ? { mode: 'values', values: years, density: 100, format: { to: (v) => String(new Date(+v).getUTCFullYear()), from: Number } }
    : { mode: 'count', values: 4, density: 100, format: { to: (v) => new Date(+v).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), from: Number } };

  window.noUiSlider.create(sliderEl, {
    start: [lo, hi], connect: true, behaviour: 'drag',
    range: { min: lo, max: hi }, step: day, pips,
  });
  timelineSlider = sliderEl.noUiSlider;

  let rafPending = false;
  timelineSlider.on('update', (vals) => {
    const a = Math.round(+vals[0]); const b = Math.round(+vals[1]);
    labels.textContent = `${fmtDate(new Date(a))} – ${fmtDate(new Date(b))}`;
    state.range = (a <= lo && b >= hi) ? null : [a, b + day - 1];
    if (rafPending) return;                 // live as you drag, throttled to one redraw per frame
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; rerender(); buildTimelineList(); });
  });
  document.getElementById('timeline-reset').onclick = () => timelineSlider.set([lo, hi]);

  buildTimelineList();
}

function buildTimelineList() {
  const wrap = document.getElementById('list-timeline');
  if (!wrap) return;
  const range = state.range;
  const photoDates = photoDatesByPlace();
  const overlaps = (iv) => !range || (iv[0] <= range[1] && iv[1] >= range[0]);

  const rows = (state.data.places || []).map((p) => {
    const iv = placeInterval(p, photoDates[p.id] || []);
    if (!iv || !overlaps(iv)) return null;
    return { place: p, start: iv[0], label: placeDateText(p, photoDates[p.id] || []) };
  }).filter(Boolean).sort((a, b) => b.start - a.start);   // reverse chronological by start date

  wrap.innerHTML = rows.length
    ? rows.map((r) => `<button class="tl-row" data-place="${r.place.id}">
        <span class="tl-row-name">${escapeHtml(r.place.name)}</span>
        <span class="tl-row-meta">${escapeHtml(r.label)}</span>
      </button>`).join('')
    : '<div class="tl-empty">No places in this date range.</div>';

  wrap.querySelectorAll('[data-place]').forEach((el) => el.addEventListener('click', () => {
    flyToPlace(state.markers, el.getAttribute('data-place'));
    if (window.matchMedia('(max-width: 768px)').matches) document.getElementById('sidebar').classList.remove('open');
  }));
}

function wireSearch() {
  const sv = document.getElementById('search-visited');
  if (sv) sv.addEventListener('input', () => { state.filterVisited = sv.value; if (state.data) buildSidebar(state.data); });
  const sw = document.getElementById('search-wishlist');
  if (sw) sw.addEventListener('input', () => { state.filterWishlist = sw.value; if (state.data) buildSidebar(state.data); });
  wireMapSearch();
}

function wireMapSearch() {
  const input = document.getElementById('map-search-input');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { hideMapResults(); return; }
    searchTimer = setTimeout(async () => { searchResults = await searchPlaces(q); renderMapResults(); }, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimer);
      if (searchResults.length) { selectMapResult(0); return; }
      searchPlaces(input.value.trim()).then((r) => { searchResults = r; if (r.length) selectMapResult(0); });
    } else if (e.key === 'Escape') { hideMapResults(); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(hideMapResults, 150));
}

function renderMapResults() {
  const box = document.getElementById('map-search-results');
  if (!box) return;
  if (!searchResults.length) { hideMapResults(); return; }
  box.innerHTML = searchResults.map((r, i) => `<button class="tl-mapsearch-item" data-i="${i}">${escapeHtml(r.label)}</button>`).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('[data-i]').forEach((b) =>
    b.addEventListener('mousedown', (e) => { e.preventDefault(); selectMapResult(+b.getAttribute('data-i')); }));
}

function selectMapResult(i) {
  const r = searchResults[i];
  if (!r) return;
  goToResult(r);
  const input = document.getElementById('map-search-input');
  if (input) input.value = r.label;
  hideMapResults();
}

function hideMapResults() {
  const box = document.getElementById('map-search-results');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}

function showInfo(msg) {
  const e = document.getElementById('status');
  if (!e) return;
  e.textContent = msg; e.classList.remove('hidden');
}
function hideInfo() {
  const e = document.getElementById('status');
  if (e) e.classList.add('hidden');
}

function buildSidebar(data) {
  const photoDates = {};
  for (const ph of data.photos) {
    if (ph.taken_at) (photoDates[ph.place_id] ||= []).push(ph.taken_at);
  }
  const dateOf = (p) => placeDateText(p, photoDates[p.id] || []);
  const sortKey = (p) => {
    const ds = (photoDates[p.id] || []).slice().sort();
    return ds.length ? ds[ds.length - 1] : (p.visited_at || '');
  };

  const fv = (state.filterVisited || '').toLowerCase();
  const fw = (state.filterWishlist || '').toLowerCase();
  const visited = data.places.filter((p) => p.status === 'visited' && (!fv || p.name.toLowerCase().includes(fv)))
    .sort((a, b) => String(sortKey(b)).localeCompare(String(sortKey(a))));
  const wishlist = data.places.filter((p) => p.status === 'wishlist' && (!fw || p.name.toLowerCase().includes(fw)))
    .sort((a, b) => a.name.localeCompare(b.name));

  document.getElementById('list-visited').innerHTML =
    visited.map((p) => placeRow(p, dateOf(p))).join('') || emptyMsg(fv ? 'No matches.' : 'No places yet — add your first!');
  document.getElementById('list-wishlist').innerHTML =
    wishlist.map((p) => wishlistRow(p, dateOf(p))).join('') || emptyMsg(fw ? 'No matches.' : 'Nothing on the wishlist yet.');

  document.querySelectorAll('#list-visited [data-place], #list-wishlist [data-place]').forEach((el) => {
    el.addEventListener('click', () => {
      flyToPlace(state.markers, el.getAttribute('data-place'));
      if (window.matchMedia('(max-width: 768px)').matches) closeSidebar();
    });
  });
  document.querySelectorAll('#list-wishlist [data-check]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    onCheckOff(el.getAttribute('data-check'));
  }));
}

function placeRow(p, dateLabel) {
  return `<button class="tl-row" data-place="${p.id}">
    <span class="tl-row-name">${escapeHtml(p.name)}</span>
    <span class="tl-row-meta">${escapeHtml(dateLabel || '')}</span>
  </button>`;
}

function wishlistRow(p, dateLabel) {
  const main = `<button class="tl-row" data-place="${p.id}">
    <span class="tl-row-name">${escapeHtml(p.name)}</span>
    <span class="tl-row-meta">${escapeHtml(dateLabel || '')}</span>
  </button>`;
  if (!state.editing) return main;
  return `<div class="tl-wish-row">${main}<button class="tl-check" data-check="${p.id}" title="Mark as visited" aria-label="Mark ${escapeHtml(p.name)} as visited"></button></div>`;
}

function emptyMsg(t) { return `<div class="tl-empty">${escapeHtml(t)}</div>`; }
function showError(msg) {
  const e = document.getElementById('error');
  e.textContent = msg;
  e.classList.remove('hidden');
}

main();
