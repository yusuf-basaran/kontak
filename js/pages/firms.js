import {
  $,
  $$,
  bindCards,
  box,
  card,
  clip,
  empty,
  icon,
  meta,
  notify,
  pageHead,
  path,
} from '../ui.js';
import { locale, number, t } from '../i18n.js';
import { state } from '../state.js';
import { esc, key } from '../utils.js';
import { button, guard, inp, label, select } from '../forms.js';
import { cityList } from '../data.js';
import { need, query, rpc, table } from '../api.js';
import { params } from '../context.js';
import { qrSvg } from '../media.js';
import { mapContent } from './list.js';

export async function firmsPage() {
  meta(t('seoFirmsTitle'), t('seoFirmsDescription'));
  $('#main').innerHTML =
    pageHead(
      'firms',
      state.settings.iletisim_telefon
        ? `<a href="tel:${esc(state.settings.iletisim_telefon.replace(/[^+0-9]/g, ''))}">${esc(state.settings.iletisim_telefon)}</a>`
        : '',
    ) +
    (`<div class="tabs">` +
      `${['galeri', 'yetkili_satici', 'parca_tedarikcisi', 'ekspertiz_merkezi'].map((k) => `<button data-firm-type="${esc(k)}">${esc(t(k))}</button>`).join('')}` +
      `</div><form id="firm-filter" class="result-tools">` +
      `${label('companyName', inp('q', 'search'))}` +
      `${label('city', select('sehir', cityList))}` +
      `</form><div id="firm-list" class="firms"></div>`);
  const all = state.db
    ? await query(table('firmalar').order('one_cikan', { ascending: false }).order('ad'))
    : [];
  let type = params.get('tur') || 'galeri';
  function draw() {
    $$('[data-firm-type]').forEach((b) =>
      b.classList.toggle('active', b.dataset.firmType === type),
    );
    const f = $('#firm-filter'),
      list = all.filter(
        (c) =>
          c.tur === type &&
          (!f.sehir.value || c.sehir === f.sehir.value) &&
          key(c.ad).includes(key(f.q.value)),
      );
    $('#firm-list').innerHTML =
      list
        .map(
          (c) =>
            `<a class="firm-card" href="firma.html?id=` +
            `${esc(c.id)}` +
            `">` +
            `${c.logo ? `<img width="80" height="80" class="firm-logo" src="${path(c.logo)}" alt="${esc(c.ad)}" loading="lazy">` : `<span class="firm-initial">${esc(c.ad[0])}</span>`}` +
            `<div><h3>` +
            `${esc(c.ad)}` +
            `</h3><p>` +
            `${esc(c.sehir)}` +
            `</p>` +
            `${c.dogrulandi ? `<small>${esc(t('verifiedCompany'))}</small>` : ''}` +
            `</div>` +
            `${icon('arrow')}` +
            `</a>`,
        )
        .join('') || empty();
  }
  $$('[data-firm-type]').forEach(
    (b) =>
      (b.onclick = () => {
        type = b.dataset.firmType;
        draw();
      }),
  );
  $('#firm-filter').oninput = draw;
  $('#firm-filter').onsubmit = (e) => e.preventDefault();
  draw();
}

export function companyOpen(hours) {
  if (!hours) return null;
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Nicosia' })),
    day = hours[d.getDay()],
    time = d.toTimeString().slice(0, 5);
  return Array.isArray(day) && day.length === 2 ? time >= day[0] && time < day[1] : false;
}

export async function firmPage() {
  meta(t('seoFirmsTitle'), t('seoFirmsDescription'));
  $('#main').innerHTML = pageHead('firms');
  if (!state.db) {
    $('#main').insertAdjacentHTML('beforeend', empty());
    return;
  }
  const c = await query(
    table('firmalar')
      .eq('id', params.get('id') || '00000000-0000-4000-8000-000000000000')
      .maybeSingle(),
  );
  if (!c) {
    $('#main').insertAdjacentHTML('beforeend', empty());
    return;
  }
  meta(
    c.ad + (state.lang === 'en' ? ' - Cars for Sale' : ' - Satılık Araçlar'),
    c.hakkinda,
    c.kapak || c.logo,
  );
  const b = c.bilgiler || {},
    [list, reviews] = await Promise.all([
      rpc('ilan_ara', { p: { satici: c.kullanici_id } }),
      query(table('yorumlar').eq('firma_id', c.id).order('olusturma', { ascending: false })),
    ]),
    open = companyOpen(b.saatler);
  const href = new URL(`firma.html?id=${c.id}`, location.href).href;
  $('#main').innerHTML =
    `${c.kapak ? `<img width="1200" height="360" fetchpriority="high" class="company-cover" src="${path(c.kapak)}" alt="${esc(c.ad)}">` : ''}` +
    `<div class="page-head"><h1>` +
    `${esc(c.ad)}` +
    `</h1>` +
    `${c.dogrulandi ? `<span class="badge-inline">${esc(t('verifiedCompany'))}</span>` : ''}` +
    `</div><div class="detail-layout"><div>` +
    `${box(
      'aboutCompany',
      `${c.logo ? `<img width="80" height="80" class="firm-logo" src="${path(c.logo)}" alt="${esc(c.ad)}">` : ''}` +
        `<p class="prose">` +
        `${esc(c.hakkinda || '')}` +
        `</p><p>` +
        `${esc(b.adres || c.sehir)}` +
        `</p>` +
        `${
          c.telefon
            ? `<a class="btn" href="tel:` +
              `${esc(c.telefon.replace(/[^+0-9]/g, ''))}` +
              `">` +
              `${esc(t('call'))}` +
              `</a> <a href="https://wa.me/` +
              `${esc(c.telefon.replace(/\D/g, ''))}` +
              `" target="_blank" rel="noopener">WhatsApp</a>`
            : ''
        }` +
        `${b.web ? `<p><a href="${path(b.web)}" target="_blank" rel="noopener">${esc(t('website'))}</a></p>` : ''}` +
        `${Object.entries(b.sosyal || {})
          .map(
            ([n, url]) =>
              `<a class="social-link" href="${path(url)}" rel="noopener" target="_blank">${esc(n)}</a>`,
          )
          .join('')}`,
    )}` +
    `${box(
      'hoursOpen',
      `${open === null ? '' : `<strong>${esc(t(open ? 'openNow' : 'closedNow'))}</strong>`}` +
        `<dl class="spec-table">` +
        `${Object.entries(b.saatler || {})
          .map(
            ([d, h]) =>
              `<div><dt>${esc(new Intl.DateTimeFormat(locale(), { weekday: 'long' }).format(new Date(2026, 0, 4 + Number(d))))}</dt><dd>${esc(h.join(' – '))}</dd></div>`,
          )
          .join('')}` +
        `</dl>`,
    )}` +
    `<div class="listing-list">` +
    `${list.ilanlar.map(card).join('') || empty()}` +
    `</div>` +
    `${box(
      'reviews',
      `<p>` +
        `${esc(t('rating'))}` +
        `: ` +
        `${esc(reviews.length ? number((reviews.reduce((s, r) => s + r.puan, 0) / reviews.length).toFixed(1)) : '—')}` +
        ` / 5</p>` +
        `${reviews.map((r) => `<article class="review"><strong>${esc(r.puan)}/5</strong><p>${esc(r.metin)}</p></article>`).join('')}` +
        `<form id="review-form">` +
        `${label('rating', select('puan', [1, 2, 3, 4, 5], 5, false))}` +
        `${label('description', '<textarea name="metin" required minlength="3" maxlength="2000"></textarea>')}` +
        `${button('send')}` +
        `</form>`,
    )}` +
    `</div><aside>` +
    `${box('share', `${qrSvg(href)}<p><a href="${esc(href)}">${esc(href)}</a></p><button class="text-btn" id="share-company">${esc(t('share'))}</button>`)}` +
    `${box('mapView', mapContent([{ sehir: c.sehir }]))}` +
    `${
      c.tur === 'ekspertiz_merkezi'
        ? box(
            'appointment',
            `<form id="appointment">` +
              `${label('name', inp('ad', 'text', state.me?.ad || '', 'required minlength="2" maxlength="100"'))}` +
              `${label('phone', inp('telefon', 'tel', state.me?.telefon || '', 'required minlength="7" maxlength="30"'))}` +
              `${label('date', inp('tarih', 'datetime-local', '', 'required'))}` +
              `${label('note', '<textarea name="notu" maxlength="2000"></textarea>')}` +
              `${button('send')}` +
              `</form>`,
          )
        : ''
    }` +
    `</aside></div>`;
  $('#share-company').onclick = () => clip(href);
  guard($('#review-form'), async (f) => {
    need();
    await query(
      state.db
        .from('yorumlar')
        .insert({ firma_id: c.id, puan: Number(f.get('puan')), metin: f.get('metin') }),
    );
    await firmPage();
    notify(t('success'));
  });
  if ($('#appointment'))
    guard($('#appointment'), async (f) => {
      need();
      await query(
        state.db.from('randevular').insert({
          firma_id: c.id,
          ad: f.get('ad'),
          telefon: f.get('telefon'),
          sehir: c.sehir,
          tarih: new Date(f.get('tarih')).toISOString(),
          notu: f.get('notu'),
        }),
      );
      $('#appointment').reset();
      notify(t('appointmentSent'));
    });
  bindCards();
}
