import { $, $$, box, notify } from './ui.js';
import { locale, number, t } from './i18n.js';
import { esc, historyDrop } from './utils.js';
import { rpc, uploadFile } from './api.js';
import { inp, label, safeAction } from './forms.js';

const types = ['ekspertiz', 'acik_artirma', 'bakim', 'muayene', 'diger'];
const today = () => new Date().toISOString().slice(0, 10);
const day = (v) => new Date(v + 'T12:00:00Z').toLocaleDateString(locale());
const validDate = (v) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  v >= '1900-01-01' &&
  v <= today() &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const options = (rows) =>
  rows.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join('');
function mileageTable(rows, docs) {
  return `<div class="history-table"><table><thead><tr><th scope="col">${esc(t('historyDate'))}</th><th scope="col">${esc(t('km'))}</th><th scope="col">${esc(t('historySource'))}</th></tr></thead><tbody>${rows
    .map((r) => {
      const doc = docs.find((d) => d.id === r.belge_id);
      return `<tr><td>${esc(day(r.tarih))}</td><td>${esc(number(r.km))} km</td><td>${esc(t(doc ? 'historyDocument' : 'historySeller'))}${doc ? ` · ${esc(doc.ad)}` : ''}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}
export function historyBox(history = {}, km) {
  const docs = history.belgeler || [],
    rows = [...(history.kilometre || [])].sort((a, b) => a.tarih.localeCompare(b.tarih));
  const lo = Math.min(...rows.map((r) => r.km)),
    hi = Math.max(...rows.map((r) => r.km));
  const start = Date.parse(rows[0]?.tarih),
    span = Date.parse(rows.at(-1)?.tarih) - start;
  const points = rows
    .map(
      (r) =>
        `${Math.round(30 + ((Date.parse(r.tarih) - start) / Math.max(1, span)) * 740)},${Math.round(160 - ((r.km - lo) / Math.max(1, hi - lo)) * 130)}`,
    )
    .join(' ');
  return box(
    'vehicleHistory',
    `<div class="vehicle-history"><p class="muted">${esc(t('historyNotice'))}</p>${!docs.length && !rows.length ? `<p>${esc(t('historyEmpty'))}</p>` : ''}<h3>${esc(t('historyDocs'))}</h3>${docs.length ? `<ul class="history-docs">${docs.map((d) => `<li><div><strong>${esc(d.ad)}</strong><p class="muted">${esc(t('history_' + d.tur))} · ${esc(day(d.tarih))}</p><span class="badge-inline">${esc(t('historyUnverified'))}</span></div><button type="button" class="btn secondary" data-history-doc="${esc(d.id)}">${esc(t('historyRead'))}</button></li>`).join('')}</ul>` : `<p class="muted">${esc(t('historyNoDocs'))}</p>`}<h3>${esc(t('historyMileage'))}</h3><p class="muted">${esc(t('historyMileageNote'))}</p>${historyDrop(rows, km) ? `<p class="history-warning" role="note">${esc(t('historyDrop'))}</p>` : ''}${
      rows.length > 1
        ? `<svg class="history-chart" viewBox="0 0 800 200" role="img" aria-label="${esc(t('historyChart'))}"><path class="history-axis" d="M30 20V170H780"/><polyline points="${esc(points)}"/>${points
            .split(' ')
            .map((p, i) => {
              const [x, y] = p.split(',');
              return `<circle cx="${x}" cy="${y}" r="5"><title>${esc(day(rows[i].tarih))}: ${esc(number(rows[i].km))} km</title></circle>`;
            })
            .join('')}</svg>`
        : ''
    }${rows.length ? mileageTable(rows, docs) : `<p class="muted">${esc(t('historyNoKm'))}</p>`}<details class="history-codes"><summary>${esc(t('historyCodes'))}</summary><p class="muted">${esc(t('historyCodesNote'))}</p>${label('historyCode', `<select data-history-code>${options(['A', 'U', 'W', 'S', 'C', 'X', 'XX'].map((k) => [k, k]))}</select>`)}<p data-history-explanation aria-live="polite">${esc(t('historyCodeA'))}</p></details></div>`,
  );
}
export function bindHistory(root, listing) {
  const code = $('[data-history-code]', root);
  if (code)
    code.onchange = () => {
      $('[data-history-explanation]', root).textContent = t('historyCode' + code.value);
    };
  $$('[data-history-doc]', root).forEach((b) => {
    b.disabled = !listing;
    b.onclick = safeAction(async () => {
      const tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      try {
        const url = await rpc('gecmis_dosya', { p_ilan: listing, p_belge: b.dataset.historyDoc });
        if (tab) tab.location.replace(url);
        else location.assign(url);
      } catch (e) {
        tab?.close();
        throw e;
      }
    });
  });
}
export function historyEditor(root, initial = {}) {
  let docs = [...(initial.belgeler || [])],
    rows = [...(initial.kilometre || [])];
  const pending = new Map();
  const dateInput = (name) => inp(name, 'date', '', `min="1900-01-01" max="${today()}"`);
  root.innerHTML = `<h2>${esc(t('vehicleHistory'))}</h2><p>${esc(t('historyIntro'))}</p><p class="history-warning">${esc(t('historyPrivacy'))}</p><p class="muted">${esc(t('historyLimits'))}</p><div class="fields">${label('historyName', inp('history_name', 'text', '', 'maxlength="100"'))}${label('historyType', `<select name="history_type">${options(types.map((k) => [k, t('history_' + k)]))}</select>`)}${label('historyDate', dateInput('history_date'))}${label('historyFile', '<input type="file" name="history_file" accept="application/pdf,image/jpeg,image/png">')}</div><label class="check"><input type="checkbox" name="history_consent" ${initial.yayin_onayi ? 'checked' : ''}><span>${esc(t('historyConsent'))}</span></label><button type="button" class="btn secondary" data-history-add-doc>${esc(t('historyAddDoc'))}</button><div data-history-docs aria-live="polite"></div><h3>${esc(t('historyMileage'))}</h3><div class="fields">${label('historyDate', dateInput('history_km_date'))}${label('km', inp('history_km', 'number', '', 'min="0" max="2000000" step="1"'))}${label('historySource', '<select name="history_source"></select>')}</div><button type="button" class="btn secondary" data-history-add-km>${esc(t('historyAddKm'))}</button><div data-history-rows aria-live="polite"></div>`;
  const field = (name) => $(`[name="${name}"]`, root);
  function draw() {
    $('[data-history-docs]', root).innerHTML =
      `<ul class="history-docs">${docs.map((d) => `<li><div><strong>${esc(d.ad)}</strong><p class="muted">${esc(t('history_' + d.tur))} · ${esc(day(d.tarih))}${pending.has(d.id) ? ` · ${esc(t('historyPending'))}` : ''}</p></div><button type="button" class="text-btn" data-history-remove-doc="${esc(d.id)}" aria-label="${esc(t('remove') + ': ' + d.ad)}">${esc(t('remove'))}</button></li>`).join('')}</ul>`;
    const source = field('history_source'),
      selected = source.value;
    source.innerHTML = options([
      ['', t('historySeller')],
      ...docs.map((d) => [d.id, t('historyDocument') + ': ' + d.ad]),
    ]);
    if (docs.some((d) => d.id === selected)) source.value = selected;
    $('[data-history-rows]', root).innerHTML = rows.length
      ? mileageTable(rows, docs) +
        `<div class="history-remove">${rows.map((r, i) => `<button type="button" class="text-btn" data-history-remove-km="${i}" aria-label="${esc(t('remove') + ': ' + day(r.tarih))}">${esc(t('remove'))} · ${esc(day(r.tarih))}</button>`).join('')}</div>`
      : '';
    $$('[data-history-remove-doc]', root).forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.historyRemoveDoc;
        docs = docs.filter((d) => d.id !== id);
        pending.delete(id);
        rows = rows.map((r) => (r.belge_id === id ? { ...r, belge_id: null } : r));
        draw();
      };
    });
    $$('[data-history-remove-km]', root).forEach((b) => {
      b.onclick = () => {
        rows.splice(Number(b.dataset.historyRemoveKm), 1);
        draw();
      };
    });
  }
  $('[data-history-add-doc]', root).onclick = () => {
    const file = field('history_file').files[0],
      ad = field('history_name').value.trim(),
      tarih = field('history_date').value;
    if (
      !file ||
      !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) ||
      file.size > 10485760
    )
      return notify(t('fileError'));
    if (docs.length >= 5 || ad.length < 2 || !validDate(tarih) || !field('history_consent').checked)
      return notify(t('historyInvalid'));
    const id = crypto.randomUUID();
    docs.push({ id, ad, tur: field('history_type').value, tarih, dosya: '' });
    pending.set(id, file);
    field('history_file').value = '';
    field('history_name').value = '';
    field('history_date').value = '';
    draw();
  };
  $('[data-history-add-km]', root).onclick = () => {
    const tarih = field('history_km_date').value,
      raw = field('history_km').value,
      km = Number(raw);
    if (
      rows.length >= 30 ||
      !validDate(tarih) ||
      raw === '' ||
      !Number.isInteger(km) ||
      km < 0 ||
      km > 2000000 ||
      rows.some((r) => r.tarih === tarih)
    )
      return notify(t('historyInvalid'));
    rows.push({ tarih, km, belge_id: field('history_source').value || null });
    rows.sort((a, b) => a.tarih.localeCompare(b.tarih));
    field('history_km_date').value = '';
    field('history_km').value = '';
    draw();
  };
  draw();
  return {
    data: () => ({
      belgeler: docs,
      kilometre: rows,
      yayin_onayi: field('history_consent').checked,
    }),
    pending: () => pending.size > 0,
    upload: async (id) => {
      if (docs.length && !field('history_consent').checked) throw Error(t('historyInvalid'));
      for (const [key, file] of pending) {
        const doc = docs.find((d) => d.id === key);
        if (doc) doc.dosya = await uploadFile('ekspertiz', file, id);
        pending.delete(key);
      }
      draw();
    },
  };
}
