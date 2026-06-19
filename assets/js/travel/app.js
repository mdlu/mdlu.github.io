// Entry point: load data, build the map + sidebar.
import { getData, createPlace, updatePlace, deletePlace, deletePhoto, mergePlace, createPreset, updatePreset, deletePreset } from './api.js';
import { initMap, render, flyToPlace, applyPreset, getView, setEditing, setHandlers, pickLocation } from './map.js';
import { getPassword, hasPassword, promptAndStore } from './auth.js';
import { processFile, uploadProcessed, uploadPhoto } from './upload.js';
import { reverseGeocode, distanceMeters, centroidOf, groupByProximity } from './geo.js';
import { escapeHtml, fmtDate, dateRangeLabel } from './util.js';

const state = { data: null, markers: {}, editing: false };

async function main() {
  initMap();
  if (window.Fancybox) window.Fancybox.bind('[data-fancybox]');  // fullscreen photo gallery
  wireUi();
  try {
    state.data = await getData();
  } catch (err) {
    showError('Could not load travel data — is the dev server running? (' + err.message + ')');
    return;
  }
  state.markers = render(state.data);
  buildSidebar(state.data);
  renderPresets();
}

function wireUi() {
  const sb = document.getElementById('sidebar');
  const views = document.getElementById('views');
  document.getElementById('toggle-sidebar').addEventListener('click', () => { views.classList.remove('open'); sb.classList.toggle('open'); });
  document.getElementById('close-sidebar').addEventListener('click', () => sb.classList.remove('open'));
  document.getElementById('toggle-views').addEventListener('click', () => { sb.classList.remove('open'); views.classList.toggle('open'); });
  document.getElementById('close-views').addEventListener('click', () => views.classList.remove('open'));
  document.getElementById('toggle-edit').addEventListener('click', toggleEdit);
  document.getElementById('add-place').addEventListener('click', onAddPlace);
  const addPhotosInput = document.querySelector('#add-photos input');
  if (addPhotosInput) addPhotosInput.addEventListener('change', (e) => { onAddPhotosAuto(e.target.files); e.target.value = ''; });
  setHandlers({ onAddPhotos, onDeletePhoto, onDeletePlace, onMovePlace, onMergePlace });
  renderPresets();
  document.querySelectorAll('.tl-tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tl-tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const tab = t.getAttribute('data-tab');
      document.getElementById('tab-visited').classList.toggle('hidden', tab !== 'visited');
      document.getElementById('tab-wishlist').classList.toggle('hidden', tab !== 'wishlist');
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
        <button class="tl-view-act" data-edit="${p.id}" title="Rename" aria-label="Rename ${escapeHtml(p.label)}">&#9998;</button>
        <button class="tl-view-act tl-view-del" data-del="${p.id}" title="Delete" aria-label="Delete ${escapeHtml(p.label)}">&times;</button>` : ''}
    </div>`).join('');
  if (!presets.length && !state.editing) html += '<div class="tl-empty">No saved views yet.</div>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-preset]').forEach((b) => {
    b.addEventListener('click', () => {
      applyPreset(presets.find((x) => x.id === b.getAttribute('data-preset')));
      if (window.matchMedia('(max-width: 768px)').matches) document.getElementById('views').classList.remove('open');
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
  if (state.data) state.markers = render(state.data);   // re-create markers so draggable matches edit mode
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
  state.markers = render(state.data);
  buildSidebar(state.data);
  renderPresets();
  if (reopenId && state.markers[reopenId]) flyToPlace(state.markers, reopenId);
}

async function onAddPlace() {
  showInfo('Click the map to drop the new place…');
  pickLocation(async (latlng) => {
    hideInfo();
    const name = window.prompt('Name this place:');
    if (!name || !name.trim()) return;
    const res = await createPlace({ name: name.trim(), lat: latlng.lat, lng: latlng.lng, status: 'visited' }, getPassword());
    if (!res.ok) { window.alert('Could not create place (' + res.status + ').'); return; }
    const place = await res.json();
    if (window.matchMedia('(max-width: 768px)').matches) document.getElementById('sidebar').classList.remove('open');
    await refresh(place.id);
  });
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
  state.markers = render(state.data);   // re-cluster at the new position
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
  const photoCount = {};
  const photoDates = {};
  for (const ph of data.photos) {
    photoCount[ph.place_id] = (photoCount[ph.place_id] || 0) + 1;
    if (ph.taken_at) (photoDates[ph.place_id] ||= []).push(ph.taken_at);
  }
  const dateOf = (p) => {
    const ds = photoDates[p.id] || [];
    return ds.length ? dateRangeLabel(ds) : (p.visited_at ? fmtDate(p.visited_at) : '');
  };
  const sortKey = (p) => {
    const ds = (photoDates[p.id] || []).slice().sort();
    return ds.length ? ds[ds.length - 1] : (p.visited_at || '');
  };

  const visited = data.places.filter((p) => p.status === 'visited')
    .sort((a, b) => String(sortKey(b)).localeCompare(String(sortKey(a))));
  const wishlist = data.places.filter((p) => p.status === 'wishlist').sort((a, b) => a.name.localeCompare(b.name));

  document.getElementById('list-visited').innerHTML =
    visited.map((p) => placeRow(p, photoCount[p.id] || 0, dateOf(p))).join('') || emptyMsg('No places yet — add your first!');
  document.getElementById('list-wishlist').innerHTML =
    wishlist.map((p) => placeRow(p, photoCount[p.id] || 0, dateOf(p))).join('') || emptyMsg('Nothing on the wishlist yet.');

  document.querySelectorAll('[data-place]').forEach((el) => {
    el.addEventListener('click', () => {
      flyToPlace(state.markers, el.getAttribute('data-place'));
      if (window.matchMedia('(max-width: 768px)').matches) closeSidebar();
    });
  });
}

function placeRow(p, n, dateLabel) {
  const meta = [dateLabel, n ? `${n} photo${n > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  return `<button class="tl-row" data-place="${p.id}">
    <span class="tl-row-name">${escapeHtml(p.name)}</span>
    <span class="tl-row-meta">${escapeHtml(meta)}</span>
  </button>`;
}

function emptyMsg(t) { return `<div class="tl-empty">${escapeHtml(t)}</div>`; }
function showError(msg) {
  const e = document.getElementById('error');
  e.textContent = msg;
  e.classList.remove('hidden');
}

main();
