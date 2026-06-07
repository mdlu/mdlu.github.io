// Entry point: load data, build the map + sidebar.
import { getData, createPreset, updatePreset, deletePreset } from './api.js';
import { initMap, render, flyToPlace, applyPreset, getView } from './map.js';
import { getPassword, hasPassword, promptAndStore } from './auth.js';
import { escapeHtml, fmtDate } from './util.js';

const state = { data: null, markers: {}, editing: false };

async function main() {
  initMap();
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

function buildSidebar(data) {
  const photoCount = {};
  for (const ph of data.photos) photoCount[ph.place_id] = (photoCount[ph.place_id] || 0) + 1;

  const visited = data.places.filter((p) => p.status === 'visited').sort(byVisitedDesc);
  const wishlist = data.places.filter((p) => p.status === 'wishlist').sort((a, b) => a.name.localeCompare(b.name));

  document.getElementById('list-visited').innerHTML =
    visited.map((p) => placeRow(p, photoCount[p.id] || 0)).join('') || emptyMsg('No places yet — add your first!');
  document.getElementById('list-wishlist').innerHTML =
    wishlist.map((p) => placeRow(p, photoCount[p.id] || 0)).join('') || emptyMsg('Nothing on the wishlist yet.');

  document.querySelectorAll('[data-place]').forEach((el) => {
    el.addEventListener('click', () => {
      flyToPlace(state.markers, el.getAttribute('data-place'));
      if (window.matchMedia('(max-width: 768px)').matches) closeSidebar();
    });
  });
}

function placeRow(p, n) {
  const meta = [p.visited_at ? fmtDate(p.visited_at) : '', n ? `${n} photo${n > 1 ? 's' : ''}` : '']
    .filter(Boolean).join(' · ');
  return `<button class="tl-row" data-place="${p.id}">
    <span class="tl-row-name">${escapeHtml(p.name)}</span>
    <span class="tl-row-meta">${escapeHtml(meta)}</span>
  </button>`;
}

function emptyMsg(t) { return `<div class="tl-empty">${escapeHtml(t)}</div>`; }
function byVisitedDesc(a, b) { return String(b.visited_at || '').localeCompare(String(a.visited_at || '')); }
function showError(msg) {
  const e = document.getElementById('error');
  e.textContent = msg;
  e.classList.remove('hidden');
}

main();
