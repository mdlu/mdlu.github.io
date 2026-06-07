// Small shared helpers for the travel log.

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s)
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// A label for a set of dates: a single date, or "earliest – latest" if they span more than one day.
export function dateRangeLabel(dates) {
  const ds = (dates || []).map((s) => new Date(s)).filter((d) => !isNaN(d.getTime())).sort((a, b) => a - b);
  if (!ds.length) return '';
  const a = fmtDate(ds[0]); const b = fmtDate(ds[ds.length - 1]);
  return a === b ? a : `${a} – ${b}`;
}
