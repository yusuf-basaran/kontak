import { t } from './i18n.js';

export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function read(key, fallback = []) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function write(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

export const key = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const formatPrice = (n, currency, locale, empty) =>
  n == null ? empty : `${new Intl.NumberFormat(locale).format(n)} ${String(currency)}`;

export function csvParse(text) {
  const rows = [];
  let row = [],
    field = '',
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quote = !quote;
    } else if (c === ',' && !quote) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quote) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  if (quote) throw Error(t('invalid'));
  return rows;
}

export function filterUrl(p) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (k === 'detay') {
      for (const [a, b] of Object.entries(v)) q.set('d_' + a, b);
    } else if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else q.set(k, v);
  }
  return q.toString();
}

export function historyDrop(rows, km) {
  const sorted = [...rows].sort((a, b) => a.tarih.localeCompare(b.tarih));
  return (
    sorted.some((r, i) => i > 0 && r.km < sorted[i - 1].km) ||
    (sorted.length > 0 && km != null && km < sorted.at(-1).km)
  );
}
