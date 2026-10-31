import { $, $$, card, loginPrompt, meta, notify, pageHead, path } from '../ui.js';
import { t } from '../i18n.js';
import { state } from '../state.js';
import { params } from '../context.js';
import { esc, read, write } from '../utils.js';
import { need, query, rpc, table, uploadFile } from '../api.js';
import { check, guard, inp, label, safeAction, select } from '../forms.js';
import {
  bindVehicleEquipment,
  bindPanels,
  bindVehicles,
  bodyBox,
  bodySvg,
  categorySelect,
  equipmentBox,
  equipmentEdit,
  vehicleForm,
} from '../vehicle.js';
import { bodyStates, cityList, partsDef } from '../data.js';
import { qrSvg, resizePhoto } from '../media.js';
import { bindHistory, historyBox, historyEditor } from '../history.js';

export async function editorPage() {
  meta(t('seoEditorTitle'), t('seoEditorDescription'));
  $('#main').innerHTML = pageHead('editorTitle');
  if (!state.db || !state.user) {
    $('#main').insertAdjacentHTML('beforeend', loginPrompt());
    return;
  }
  const listingId = params.get('id') || read('bc-draft', '');
  let c = listingId
    ? await query(
        table('ilanlar').eq('id', listingId).eq('kullanici_id', state.user.id).maybeSingle(),
      )
    : null;
  if (!c)
    c = {
      kategori_id: state.cats.find((k) => k.slug === 'kullanilmis-binek')?.id,
      baslik: '',
      detay: {},
      fotograflar: [],
      ...read('bc-valuation', {}),
    };
  if (!c.id) {
    const make = state.lex.markalar.find((m) => String(m[0]) === String(c.marka_id || c.marka));
    if (make)
      c.kategori_id =
        state.cats.find((k) => k.slug.startsWith('kullanilmis-') && k.arac_tipi === make[2])?.id ||
        c.kategori_id;
  }
  let id = c.id,
    photos = [...(c.fotograflar || [])],
    parts = {},
    gear = [],
    report,
    historyData = {};
  if (id) {
    const [p, e, r, h] = await Promise.all([
      query(table('ilan_parca').eq('ilan_id', id)),
      query(table('ilan_donanim').eq('ilan_id', id)),
      query(table('ilan_ekspertiz').eq('ilan_id', id).maybeSingle()),
      rpc('arac_gecmisi', { p_ilan: id }),
    ]);
    parts = Object.fromEntries(p.map((x) => [x.parca, x.durum]));
    gear = e.map((x) => x.donanim_id);
    report = r;
    historyData = h || {};
  }
  const steps = ['category', 'vehicleInfo', 'bodyBox', 'expert', 'photos', 'pricing', 'preview'];
  let step = 0;
  $('#main').insertAdjacentHTML(
    'beforeend',
    `<nav class="steps">` +
      `${steps.map((k, i) => `<span data-step-label="${esc(i)}">${esc(i + 1)}. ${esc(t(k))}</span>`).join('')}` +
      `</nav><form id="editor"><fieldset data-step="0" class="panel">` +
      `${label('category', categorySelect('kategori_id', c.kategori_id, false))}` +
      `</fieldset><fieldset data-step="1" class="panel">` +
      `${label('title', inp('baslik', 'text', c.baslik, 'required minlength="5" maxlength="140"'))}` +
      `${vehicleForm()}` +
      `<div class="fields">` +
      `${label('km', inp('km', 'number', c.km, 'min="0"'))}` +
      `${label('fuel', select('yakit', ['petrol', 'diesel', 'hybrid', 'mild', 'plugin', 'electric'], c.yakit))}` +
      `${label('gear', select('vites', ['automatic', 'manual'], c.vites))}` +
      `${['motor', 'beygir', 'renk', 'kasa', 'cekis', 'grade', 'sasi', 'plaka_no'].map((k, i) => label(['engine', 'power', 'color', 'body', 'drive', 'grade', 'chassis', 'plateNo'][i], inp('d_' + k, 'text', c.detay[k]))).join('')}` +
      `${label('steering', select('d_direksiyon', ['right', 'left'], c.detay.direksiyon))}` +
      `${label('plate', select('d_plaka', ['localPlate', 'trPlate', 'importPlate'], c.detay.plaka))}` +
      `${label('origin', select('d_ulke', ['uk', 'japan', 'other'], c.detay.ulke))}` +
      `</div>` +
      `${label('description', `<textarea name="aciklama" maxlength="12000">${esc(c.aciklama || '')}</textarea>`)}` +
      `${label('website', inp('video', 'url', c.video))}` +
      `</fieldset><fieldset data-step="2" class="panel"><div class="section-head"><h2>` +
      `${esc(t('bodyBox'))}` +
      `</h2><button type="button" class="text-btn" id="all-original">` +
      `${esc(t('allOriginal'))}` +
      `</button></div><div id="body-editor">` +
      `${bodySvg(parts, true)}` +
      `</div><p id="panel-label" aria-live="polite"></p><h2 class="subheading">` +
      `${esc(t('equipment'))}` +
      `</h2><div id="equipment-editor">` +
      `${equipmentEdit(gear)}` +
      `</div></fieldset><fieldset data-step="3" class="panel">` +
      `${label('expert', '<input type="file" name="rapor" accept="application/pdf,image/png,image/jpeg">')}` +
      `<small>PDF / JPG / PNG · 10 MB</small>` +
      `${label('inspectionFirm', inp('ekspertiz_firma', 'text', report?.firma))}` +
      `${label('inspectionDate', inp('ekspertiz_tarih', 'date', report?.tarih))}` +
      `<div id="history-editor" class="history-editor"></div>` +
      `</fieldset><fieldset data-step="4" class="panel"><p>` +
      `${esc(t('maxPhotos'))}` +
      `</p>` +
      `${check('watermark', 'watermark')}` +
      `<input type="file" id="photo-files" accept="image/jpeg,image/png,image/webp" multiple><div class="photo-sort" id="photo-sort"></div>` +
      `<button type="button" class="text-btn" id="phone-photo">` +
      `${esc(t('phonePhotos'))}` +
      `</button><div id="photo-qr"></div></fieldset><fieldset data-step="5" class="panel"><div class="fields">` +
      `${label('amount', inp('fiyat', 'number', c.fiyat, 'min="0" step="0.01"'))}` +
      `${label('currency', select('para_birimi', ['GBP', 'EUR', 'USD', 'TL'], c.para_birimi || 'GBP', false))}` +
      `${label('city', select('sehir', cityList, c.sehir || state.me?.sehir || 'Girne', false))}` +
      `${label('phone', inp('d_telefon', 'tel', c.detay.telefon || state.me?.telefon || ''))}` +
      `${label('ownerCount', inp('d_ownerCount', 'number', c.detay.ownerCount, 'min="1"'))}` +
      `</div><div class="checks">` +
      `${['customs', 'trade', 'finance', 'warranty', 'firstOwner', 'service', 'records', 'documents'].map((k) => check('d_' + k, k, c.detay[k] === true)).join('')}` +
      `</div></fieldset><fieldset data-step="6" id="editor-preview" class="panel"></fieldset><div class="editor-actions">` +
      `<button type="button" class="btn secondary" id="step-prev">` +
      `${esc(t('prev'))}` +
      `</button><button type="button" class="text-btn" id="draft-save">` +
      `${esc(t('saveDraft'))}` +
      `</button><button type="button" class="btn" id="step-next">` +
      `${esc(t('next'))}` +
      `</button><button type="submit" class="btn" id="publish">` +
      `${esc(t('publish'))}` +
      `</button></div></form>`,
  );
  const form = $('#editor'),
    records = historyEditor($('#history-editor'), historyData),
    values = bindVehicles(form);
  const mark = state.lex.markalar.find((m) => String(m[0]) === String(c.marka_id || c.marka)),
    model = state.lex.modeller.find((m) => String(m[0]) === String(c.model_id || c.model));
  if (mark) {
    if (!form.tip.disabled) form.tip.value = mark[2];
    form.tip.dispatchEvent(new Event('change'));
    form.marka.value = mark[1];
    form.marka.dispatchEvent(new Event('input'));
  }
  if (model) {
    form.model.value = model[2];
    form.model.dispatchEvent(new Event('input'));
  }
  form.yil.value = c.yil || '';
  if (c.diger_marka) {
    form.marka.value = t('other');
    form.marka.dispatchEvent(new Event('input'));
    form.diger_marka.value = c.diger_marka;
  }
  if (c.diger_model) {
    form.model.value = t('other');
    form.model.dispatchEvent(new Event('input'));
    form.diger_model.value = c.diger_model;
  }
  function bindBody() {
    $$('[data-part]', $('#body-editor')).forEach((p) => {
      const activate = () => {
        const k = p.dataset.part,
          next = bodyStates[(bodyStates.indexOf(parts[k] || '') + 1) % bodyStates.length];
        if (next) parts[k] = next;
        else delete parts[k];
        const focus = k;
        $('#body-editor').innerHTML = bodySvg(parts, true);
        bindBody();
        const n = $$('[data-part]', $('#body-editor')).find((n) => n.dataset.part === focus);
        n?.focus();
        $('#panel-label').textContent = n?.getAttribute('aria-label');
      };
      p.onclick = activate;
      p.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      };
      p.onfocus = () => ($('#panel-label').textContent = p.getAttribute('aria-label'));
    });
  }
  bindBody();
  $('#all-original').onclick = () => {
    parts = Object.fromEntries(partsDef.map((p) => [p[0], 'orijinal']));
    $('#body-editor').innerHTML = bodySvg(parts, true);
    bindBody();
  };
  function data() {
    const f = new FormData(form),
      v = values(),
      detay = {};
    for (const [k, val] of f) if (k.startsWith('d_')) detay[k.slice(2)] = val === 'on' ? true : val;
    return {
      kategori_id: Number(f.get('kategori_id')),
      marka_id: v.marka ? Number(v.marka) : null,
      model_id: v.model ? Number(v.model) : null,
      diger_marka: v.diger_marka || null,
      diger_model: v.diger_model || null,
      baslik: f.get('baslik'),
      aciklama: f.get('aciklama'),
      yil: v.yil ? Number(v.yil) : null,
      km: f.get('km') !== '' ? Number(f.get('km')) : null,
      fiyat: f.get('fiyat') !== '' ? Number(f.get('fiyat')) : null,
      para_birimi: f.get('para_birimi'),
      yakit: f.get('yakit'),
      vites: f.get('vites'),
      sehir: f.get('sehir'),
      detay,
      fotograflar: photos,
      video: f.get('video') || null,
    };
  }
  bindVehicleEquipment(form, $('#equipment-editor'));
  let saving;
  async function persist(publish = false) {
    if (saving) {
      await saving;
      return persist(publish);
    }
    saving = (async () => {
      need();
      const d = data(),
        phone = d.detay.telefon;
      delete d.detay.telefon;
      if (d.baslik.length < 5) throw Error(t('invalid'));
      let uploaded;
      const save = async (publishing, includeHistory = true) => {
        const result = await rpc('ilan_kaydet', {
          p_ilan: id || null,
          p_veri: d,
          p_parcalar: parts,
          p_donanim: $$('[name=donanim]:checked', form).map((e) => Number(e.value)),
          p_rapor: uploaded || null,
          p_gecmis: includeHistory ? records.data() : null,
          p_telefon: phone || null,
          p_tip: form.tip.value,
          p_yayin: publishing,
        });
        id = result.id;
        history.replaceState(null, '', `?id=${id}`);
        write('bc-draft', id);
        return id;
      };
      const file = form.rapor.files[0];
      if ((file || records.pending()) && !id) await save(false, false);
      if (file) {
        if (!form.ekspertiz_firma.value || !form.ekspertiz_tarih.value) throw Error(t('invalid'));
        uploaded = {
          dosya: await uploadFile('ekspertiz', file, id),
          firma: form.ekspertiz_firma.value,
          tarih: form.ekspertiz_tarih.value,
        };
      }
      await records.upload(id);
      await save(publish);
      if (uploaded) {
        report = { ...uploaded, ilan_id: id };
        form.rapor.value = '';
      }
      return id;
    })();
    try {
      return await saving;
    } finally {
      saving = null;
    }
  }

  function updateStep() {
    const current = $(`[data-step="${step}"]`);
    $$('[data-step]').forEach((f) => (f.hidden = f !== current));
    $$('[data-step-label]').forEach((n) =>
      n.classList.toggle('active', Number(n.dataset.stepLabel) === step),
    );
    $('#step-prev').hidden = step === 0;
    $('#step-next').hidden = step === 6;
    $('#publish').hidden = step !== 6;
    if (step === 6) {
      const d = data(),
        m = state.lex.markalar.find((m) => m[0] === d.marka_id),
        o = state.lex.modeller.find((m) => m[0] === d.model_id);
      $('#editor-preview').innerHTML =
        card({
          ...d,
          id: id || 'preview',
          marka: m?.[1],
          model: o?.[2],
          parca_sayisi: Object.keys(parts).length,
          boyali: Object.values(parts).filter((s) => ['boyali', 'lokal_boyali'].includes(s)).length,
          degisen: Object.values(parts).filter((s) => s === 'degisen').length,
          hasarli: Object.values(parts).filter((s) => s === 'hasarli').length,
        }) +
        bodyBox(parts, report) +
        historyBox(records.data(), d.km) +
        equipmentBox($$('[name=donanim]:checked', form).map((e) => Number(e.value)));
      bindPanels();
      bindHistory($('#editor-preview'), null);
    }
  }
  $('#step-next').onclick = () => {
    for (const el of $$('input,select,textarea', $(`[data-step="${step}"]`)))
      if (!el.checkValidity()) {
        el.reportValidity();
        return;
      }
    step++;
    updateStep();
  };
  $('#step-prev').onclick = () => {
    step--;
    updateStep();
  };
  $('#draft-save').onclick = safeAction(async () => {
    await persist();
    notify(t('success'));
  });
  guard(form, async () => {
    try {
      await persist(true);
      write('bc-draft', '');
      write('bc-valuation', {});
      location.href = 'hesabim.html';
    } catch (e) {
      if (e.hint === 'paketler.html') {
        await persist();
        location.href = 'paketler.html';
      } else throw e;
    }
  });
  function drawPhotos() {
    $('#photo-sort').innerHTML = photos
      .map(
        (src, i) =>
          `<div draggable="true" data-photo-index="` +
          `${esc(i)}` +
          `"><img width="160" height="120" loading="lazy" src="` +
          `${path(src)}` +
          `" alt="` +
          `${esc(t('photos'))}` +
          ` ` +
          `${esc(i + 1)}` +
          `"><button type="button" data-photo-delete="` +
          `${esc(i)}` +
          `" aria-label="` +
          `${esc(t('remove'))}` +
          `">×</button><span>` +
          `${esc(i + 1)}` +
          `</span></div>`,
      )
      .join('');
    let from;
    $$('[data-photo-index]').forEach((n) => {
      n.ondragstart = () => (from = Number(n.dataset.photoIndex));
      n.ondragover = (e) => e.preventDefault();
      n.ondrop = safeAction(async (e) => {
        e.preventDefault();
        const to = Number(n.dataset.photoIndex),
          [item] = photos.splice(from, 1);
        photos.splice(to, 0, item);
        drawPhotos();
        if (id) await query(state.db.from('ilanlar').update({ fotograflar: photos }).eq('id', id));
      });
    });
    $$('[data-photo-delete]').forEach(
      (b) =>
        (b.onclick = safeAction(async () => {
          photos.splice(Number(b.dataset.photoDelete), 1);
          drawPhotos();
          if (id)
            await query(state.db.from('ilanlar').update({ fotograflar: photos }).eq('id', id));
        })),
    );
  }
  async function addPhotos(files) {
    await persist();
    for (const file of files) {
      if (photos.length >= 15) break;
      const f = await resizePhoto(file, form.watermark.checked);
      photos = await rpc('foto_ekle', { p_ilan: id, p_url: await uploadFile('ilanlar', f, id) });
      drawPhotos();
    }
  }
  $('#photo-files').onchange = safeAction(async (e) => {
    await addPhotos(e.target.files);
    e.target.value = '';
  });
  const area = $('[data-step="4"]');
  area.ondragover = (e) => e.preventDefault();
  area.ondrop = safeAction(async (e) => {
    if (e.dataTransfer.files.length) await addPhotos(e.dataTransfer.files);
  });
  $('#phone-photo').onclick = safeAction(async () => {
    await persist();
    const kod = await rpc('foto_oturum', { p_ilan: id }),
      url = new URL(`foto.html?kod=${kod}`, location.href).href;
    $('#photo-qr').innerHTML =
      qrSvg(url) + `<p>${esc(t('photoSession'))}</p><a href="${esc(url)}">${esc(url)}</a>`;
    state.db
      .channel(`photos:${id}`)
      .on('change', { table: 'ilanlar', filter: `id=eq.${id}` }, (p) => {
        photos = p.new.fotograflar || photos;
        drawPhotos();
      })
      .subscribe();
  });
  drawPhotos();
  updateStep();
}
