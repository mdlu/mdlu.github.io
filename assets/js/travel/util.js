// Small shared helpers for the travel log.

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Parse a date-only string (YYYY-MM-DD) as LOCAL midnight to avoid a UTC off-by-one;
// full ISO timestamps and Date objects pass through unchanged.
function parseDate(s) {
  if (s instanceof Date) return s;
  const m = typeof s === 'string' && s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
}

export function fmtDate(s) {
  if (!s) return '';
  const d = parseDate(s);
  return isNaN(d.getTime()) ? String(s)
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// A label for a set of dates: a single date, or "earliest – latest" if they span more than one day.
export function dateRangeLabel(dates) {
  const ds = (dates || []).map(parseDate).filter((d) => !isNaN(d.getTime())).sort((a, b) => a - b);
  if (!ds.length) return '';
  const a = fmtDate(ds[0]); const b = fmtDate(ds[ds.length - 1]);
  return a === b ? a : `${a} – ${b}`;
}

// Display date for a place: from its photos if any, else its manual visited_at/visited_end range.
export function placeDateText(place, photoDates) {
  if (photoDates && photoDates.length) return dateRangeLabel(photoDates);
  if (place.visited_at) return place.visited_end ? dateRangeLabel([place.visited_at, place.visited_end]) : fmtDate(place.visited_at);
  return '';
}

// A place's date span [startMs, endMs] for the timeline — from photos if any, else manual dates;
// null if the place has no date at all. (Uses raw ms; consistent for range/overlap math.)
export function placeInterval(place, photoDates) {
  const ts = (photoDates || []).map((s) => parseDate(s).getTime()).filter((t) => !isNaN(t));
  if (ts.length) return [Math.min(...ts), Math.max(...ts)];
  if (place.visited_at) {
    const a = parseDate(place.visited_at).getTime();
    const b = place.visited_end ? parseDate(place.visited_end).getTime() : a;
    if (!isNaN(a)) return [Math.min(a, isNaN(b) ? a : b), Math.max(a, isNaN(b) ? a : b)];
  }
  return null;
}
