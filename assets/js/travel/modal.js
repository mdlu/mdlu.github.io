// A small reusable modal that collects { name, notes, photos, from, to }.
// opts: { title, name, notes, requireWhen, confirmLabel }
// requireWhen=true shows the "when did you go" section and requires photos OR a From date.

import { readPhotoDates } from './upload.js';

let resolver = null;
let wired = false;
let requireWhen = false;

const el = (id) => document.getElementById(id);

function validate() {
  const nameOk = el('m-name').value.trim().length > 0;
  const whenOk = !requireWhen || el('m-photos').files.length > 0 || !!el('m-from').value;
  el('modal-ok').disabled = !(nameOk && whenOk);
}

function close(result) {
  el('modal').classList.add('hidden');
  const r = resolver; resolver = null;
  if (r) r(result);
}

function wire() {
  if (wired) return;
  wired = true;
  el('modal-cancel').addEventListener('click', () => close(null));
  el('modal-ok').addEventListener('click', () => {
    close({
      name: el('m-name').value.trim(),
      notes: el('m-notes').value.trim(),
      photos: el('m-photos').files ? Array.from(el('m-photos').files) : [],
      from: el('m-from').value || null,
      to: el('m-to').value || null,
    });
  });
  ['m-name', 'm-from'].forEach((id) => {
    el(id).addEventListener('input', validate);
    el(id).addEventListener('change', validate);
  });
  el('m-photos').addEventListener('change', onPhotosChosen);
  el('modal').addEventListener('click', (e) => { if (e.target === el('modal')) close(null); });
}

// When photos are chosen, read their EXIF dates and auto-fill From/To.
async function onPhotosChosen() {
  validate();
  const files = el('m-photos').files ? Array.from(el('m-photos').files) : [];
  const status = el('m-when-status');
  if (!files.length) { if (status) status.textContent = ''; return; }
  if (status) status.textContent = 'Reading photo dates…';
  const { from, to } = await readPhotoDates(files);
  if (from) el('m-from').value = from;
  if (to && to !== from) el('m-to').value = to;
  if (status) status.textContent = from ? 'Dates filled in from photos — edit if needed.' : 'No dates found in photos; enter them below.';
  validate();
}

export function openModal(opts = {}) {
  wire();
  requireWhen = !!opts.requireWhen;
  el('modal-title').textContent = opts.title || '';
  el('m-name').value = opts.name || '';
  el('m-notes').value = opts.notes || '';
  el('m-photos').value = '';
  el('m-from').value = '';
  el('m-to').value = '';
  const st = el('m-when-status'); if (st) st.textContent = '';
  el('m-when').classList.toggle('hidden', !requireWhen);
  el('modal-ok').textContent = opts.confirmLabel || 'Confirm';
  el('modal').classList.remove('hidden');
  validate();
  setTimeout(() => el('m-name').focus(), 30);
  return new Promise((resolve) => { resolver = resolve; });
}
