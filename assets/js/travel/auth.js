// Edit-mode auth: the shared passphrase, remembered in localStorage so it's typed once per device.
import { CONFIG } from './config.js';

const KEY = 'tl_edit_pw';

export function getPassword() { return localStorage.getItem(KEY) || ''; }
export function hasPassword() { return !!getPassword(); }
export function clearPassword() { localStorage.removeItem(KEY); }

export async function verify(pw) {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/verify`, { method: 'POST', headers: { 'x-edit-password': pw } });
    return res.ok;
  } catch {
    return false;
  }
}

// Prompt for the passphrase, verify it against the backend, store on success.
export async function promptAndStore() {
  const pw = window.prompt('Enter the edit passphrase to turn on edit mode:');
  if (pw == null || pw === '') return false;
  if (await verify(pw)) { localStorage.setItem(KEY, pw); return true; }
  window.alert('Incorrect passphrase.');
  return false;
}
