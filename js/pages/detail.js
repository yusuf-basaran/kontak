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
  money,
  notify,
  pageHead,
  path,
  price,
  safety,
  skeleton,
  titleLink,
} from '../ui.js';
import { state } from '../state.js';
import { locale, number, t } from '../i18n.js';
import { need, query, rpc, signed, table } from '../api.js';
import { params } from '../context.js';
import { esc, read, write } from '../utils.js';
import { bindPanels, bodyBox, equipmentBox } from '../vehicle.js';
import { mapContent } from './list.js';
import { button, guard, inp, label, reportForm, safeAction, select } from '../forms.js';
import { cityList } from '../data.js';
import { bindHistory, historyBox } from '../history.js';

export async function detailPage(id) {
  $('#main').innerHTML =
    pageHead('detailTitle') +
    (state.db ? skeleton(2) : `<p class="empty">${esc(t('connect'))}</p>`);
  if (!state.db) return;
  let q = table('ilan_kartlari');
  if (params.get('no')) q = q.eq('no', params.get('no'));
  else q = q.eq('id', params.get('id') || '00000000-0000-4000-8000-000000000000');
  const c = await query(q.maybeSingle());
  if (id !== state.routeId) return;
  if (!c) {
    document.querySelector('meta[name=robots]').content = 'noindex,follow';
    meta(t('listingUnavailable'));
    const similar = await rpc('ilan_ara', { p: { sayfa: 1 } });
    if (id !== state.routeId) return;
    $('#main').innerHTML =
      pageHead('listingUnavailable') +
      titleLink('similar', 'ilanlar.html') +
      '<div class="listing-list">' +
      (similar.ilanlar.slice(0, 3).map(card).join('') || empty()) +
      '</div>';
    bindCards();
    return;
  }
  write('bc-recent', [c.id, ...read('bc-recent').filter((x) => x !== c.id)].slice(0, 10));
  meta(
    [c.yil, c.marka || c.diger_marka, c.model || c.diger_model, c.detay?.paket]
      .filter(Boolean)
      .join(' ') +
      ' - ' +
      price(c),
    `${c.marka || c.diger_marka || ''} ${c.model || c.diger_model || ''}, ${c.yil || ''}, ${c.km != null ? number(c.km) + ' km, ' : ''}${c.yakit ? t(c.yakit) + ', ' : ''}${c.vites ? t(c.vites) + ', ' : ''}${money(c.fiyat, c.para_birimi)}, ${c.sehir || ''}`,
    c.fotograflar?.[0],
  );
  const [ps, es, report, seller, hist, market, records] = await Promise.all([
    query(table('ilan_parca').eq('ilan_id', c.id)),
    query(table('ilan_donanim').eq('ilan_id', c.id)),
    query(table('ilan_ekspertiz').eq('ilan_id', c.id).maybeSingle()),
    rpc('satici', { p_id: c.kullanici_id }),
    query(table('fiyat_gecmisi').eq('ilan_id', c.id).order('tarih')),
    query(
      table('piyasa_fiyatlari')
        .eq('marka_id', c.marka_id || 0)
        .eq('model_id', c.model_id || 0)
        .eq('yil', c.yil || 0)
        .eq('para_birimi', c.para_birimi)
        .maybeSingle(),
    ),
    rpc('arac_gecmisi', { p_ilan: c.id }),
  ]);
  if (id !== state.routeId) return;
  const data = Object.fromEntries(ps.map((p) => [p.parca, p.durum])),
    attrs = [
      ['make', c.marka || c.diger_marka],
      ['model', c.model || c.diger_model],
      ['year', c.yil],
      ['km', c.km],
      ['fuel', t(c.yakit)],
      ['gear', t(c.vites)],
      ['engine', c.detay.motor],
      ['power', c.detay.beygir],
      ['color', c.detay.renk],
      ['body', c.detay.kasa],
      ['drive', c.detay.cekis],
      ['steering', t(c.detay.direksiyon)],
      ['plate', t(c.detay.plaka)],
      ['origin', t(c.detay.ulke)],
      ['grade', c.detay.grade],
      ['city', c.sehir],
      ['listingNo', c.no],
      ['date', new Date(c.yayin || c.olusturma).toLocaleDateString(locale())],
    ],
    diff = market && c.fiyat ? (c.fiyat / market.medyan - 1) * 100 : null;
  $('#main').innerHTML =
    pageHead('detailTitle', `<span>${esc(t('listingNo'))} ${esc(c.no)}</span>`) +
    (`<h2 class="detail-title">` +
      `${esc(c.baslik)}` +
      `</h2>` +
      `${c.model_id ? `<a class="text-btn" href="model.html?model=${esc(c.model_id)}">${esc(t('modelTitle'))}</a>` : ''}` +
      `${c.uyari ? safety() : ''}` +
      `<div class="detail-layout"><div><section class="panel gallery"><button class="gallery-main" id="photo-open">` +
      `${c.fotograflar[0] ? `<img id="main-photo" src="${path(c.fotograflar[0])}" alt="${esc(c.baslik)}" width="960" height="640" fetchpriority="high">` : `<span class="no-photo">${icon('car')}${esc(t('noPhoto'))}</span>`}` +
      `</button><div class="thumbs">` +
      `${c.fotograflar.map((src, i) => `<button data-photo="${esc(i)}" aria-label="${esc(c.baslik)} ${esc(i + 1)}"><img src="${path(src)}" alt="${esc(c.baslik)} ${esc(i + 1)}" width="72" height="56" loading="lazy"></button>`).join('')}` +
      `</div>` +
      `${c.video ? `<a target="_blank" rel="noopener" href="${path(c.video)}">${esc(t('video'))}</a>` : ''}` +
      `</section>` +
      `${box('vehicleInfo', `<dl class="spec-table">${attrs.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${esc(v || t('unknown'))}</dd></div>`).join('')}</dl>`)}` +
      `${bodyBox(data, report)}` +
      `${historyBox(records || {}, c.km)}` +
      `${equipmentBox(es.map((e) => e.donanim_id))}` +
      `${box(
        'declaration',
        `<dl class="spec-table">` +
          `${['firstOwner', 'ownerCount', 'service', 'records', 'documents'].map((k) => `<div><dt>${esc(t(k))}</dt><dd>${esc(c.detay[k] === true ? t('yes') : c.detay[k] === false ? t('no') : c.detay[k] || t('unknown'))}</dd></div>`).join('')}` +
          `</dl>`,
      )}` +
      `${box('description', `<p class="prose">${esc(c.aciklama)}</p>`)}` +
      `${hist.length > 1 ? box('history', '<canvas id="price-chart" width="800" height="210" role="img"></canvas>') : ''}` +
      `${box('mapView', mapContent([c]))}` +
      `${safety()}` +
      `</div><aside><section class="panel seller"><strong class="detail-price">` +
      `${esc(price(c))}` +
      `</strong>` +
      `${diff !== null ? `<p class="market">${esc(t(diff < -10 ? 'below' : diff > 10 ? 'above' : 'fair'))} · %${esc(number(Math.abs(Math.round(diff))))}</p>` : ''}` +
      `<h2>` +
      `${esc(seller?.firma?.ad || seller?.ad || c.satici)}` +
      `</h2>` +
      `${seller?.firma?.dogrulandi ? `<span class="badge-inline">${esc(t('verifiedCompany'))}</span>` : ''}` +
      `${seller?.yanit != null ? `<p>${esc(t('replyTime'))}: ${esc(number(Math.max(0.1, seller.yanit / 3600).toFixed(1)))} ${esc(t('hours'))}</p>` : ''}` +
      `<div class="actions vertical">` +
      `${
        seller?.telefon
          ? `<a class="btn" data-phone href="tel:` +
            `${esc(seller.telefon.replace(/[^+0-9]/g, ''))}` +
            `">` +
            `${esc(t('call'))}` +
            `</a><a class="btn secondary" href="https://wa.me/` +
            `${esc(seller.telefon.replace(/\D/g, ''))}` +
            `" target="_blank" rel="noopener">WhatsApp</a>`
          : ''
      }` +
      `<button class="btn secondary" id="message-seller">` +
      `${esc(t('sendMessage'))}` +
      `</button><button class="text-btn" id="follow-seller">` +
      `${esc(t('follow'))}` +
      `</button><a href="ilanlar.html?satici=` +
      `${esc(c.kullanici_id)}` +
      `">` +
      `${esc(t('otherListings'))}` +
      `</a><button class="text-btn" id="price-watch">` +
      `${esc(t('track'))}` +
      `</button></div><p id="detail-stats" class="muted"></p><div class="actions"><button class="text-btn" id="share">` +
      `${esc(t('share'))}` +
      `</button><button class="text-btn" id="print">` +
      `${esc(t('print'))}` +
      `</button><a href="https://wa.me/?text=` +
      `${encodeURIComponent(location.href)}` +
      `" target="_blank" rel="noopener">WhatsApp</a></div><button class="text-btn" id="report-listing">` +
      `${esc(t('reportListing'))}` +
      `</button>` +
      `${
        state.user?.id === c.kullanici_id
          ? `<div class="actions">` +
            `${select('promote', ['seckin', 'hizli', 'prestij', 'vurgulu'], 'seckin', false)}` +
            `<button class="btn" id="promote">` +
            `${esc(t('promote'))}` +
            `</button><a href="paketler.html">` +
            `${esc(t('buyRights'))}` +
            `</a></div>`
          : ''
      }` +
      `</section>` +
      `${box(
        'calculator',
        `<form id="calculator" class="fields">` +
          `${label('depositAmount', inp('deposit', 'number', 0, 'min="0"'))}` +
          `${label('months', inp('months', 'number', 36, 'min="1" max="120" required'))}` +
          `${label('interest', inp('interest', 'number', 0, 'min="0" max="100" step="0.1"'))}` +
          `${button('calculate')}` +
          `<output id="monthly"></output></form><small>` +
          `${esc(t('calcNote'))}` +
          `</small>`,
      )}` +
      `${box(
        'askInspection',
        `<form id="inspection" class="fields">` +
          `${label('name', inp('ad', 'text', state.me?.ad || '', 'required'))}` +
          `${label('phone', inp('telefon', 'tel', state.me?.telefon || '', 'required'))}` +
          `${label('city', select('sehir', cityList, c.sehir, false))}` +
          `${button('send')}` +
          `</form>`,
      )}` +
      `</aside></div><div id="similar"></div><dialog id="lightbox"><button id="lightbox-close" aria-label="` +
      `${esc(t('cancel'))}` +
      `">×</button><button id="photo-prev" aria-label="` +
      `${esc(t('prev'))}` +
      `">‹</button><img width="1200" height="800" alt="` +
      `${esc(c.baslik)}` +
      `"><button id="photo-next" aria-label="` +
      `${esc(t('next'))}` +
      `">›</button></dialog>`);
  bindPanels();
  bindHistory($('#main'), c.id);
  let index = 0;
  const showPhoto = (n) => {
    index = (n + c.fotograflar.length) % c.fotograflar.length;
    const src = c.fotograflar[index];
    if (src) {
      $('#main-photo').src = src;
      $('#lightbox img').src = src;
    }
  };
  $$('[data-photo]').forEach((b) => (b.onclick = () => showPhoto(Number(b.dataset.photo))));
  $('#photo-open').onclick = () => {
    if (c.fotograflar.length) {
      showPhoto(index);
      $('#lightbox').showModal();
    }
  };
  $('#lightbox-close').onclick = () => $('#lightbox').close();
  $('#photo-prev').onclick = () => showPhoto(index - 1);
  $('#photo-next').onclick = () => showPhoto(index + 1);
  $('#lightbox').onkeydown = (e) => {
    if (e.key === 'ArrowRight') showPhoto(index + 1);
    if (e.key === 'ArrowLeft') showPhoto(index - 1);
  };
  let touch;
  $('#lightbox img').ontouchstart = (e) => (touch = e.touches[0].clientX);
  $('#lightbox img').ontouchend = (e) => {
    const d = e.changedTouches[0].clientX - touch;
    if (Math.abs(d) > 40) showPhoto(index + (d < 0 ? 1 : -1));
  };
  $('#message-seller').onclick = safeAction(async () => {
    need();
    location.href = `mesajlar.html?k=${await rpc('konusma_ac', { p_ilan: c.id })}`;
  });
  $('#follow-seller').onclick = safeAction(async () => {
    need();
    await query(
      state.db.from('takipler').upsert({ kullanici_id: state.user.id, satici_id: c.kullanici_id }),
    );
    notify(t('success'));
  });
  $('#price-watch').onclick = safeAction(async () => {
    need();
    await query(
      state.db
        .from('favoriler')
        .upsert({ kullanici_id: state.user.id, ilan_id: c.id, fiyat_takibi: true }),
    );
    notify(t('success'));
  });
  $('#share').onclick = () => clip(location.href);
  $('#print').onclick = () => print();
  $('#report-listing').onclick = safeAction(() => reportForm(c.id));
  if ($('#promote'))
    $('#promote').onclick = safeAction(async () => {
      await rpc('kota', { p_ilan: c.id, p_islem: 'onecikar', p_tur: $('[name=promote]').value });
      notify(t('success'));
    });
  $('#calculator').onsubmit = safeAction(() => {
    const f = $('#calculator'),
      amount = Math.max(0, Number(c.fiyat || 0) - Number(f.deposit.value)),
      n = Number(f.months.value),
      r = Number(f.interest.value) / 1200;
    $('#monthly').textContent = money(
      r ? (amount * r) / (1 - (1 + r) ** -n) : amount / n,
      c.para_birimi,
    );
  });
  guard($('#inspection'), async (f) => {
    need();
    await query(
      state.db.from('randevular').insert({
        ilan_id: c.id,
        ad: f.get('ad'),
        telefon: f.get('telefon'),
        sehir: f.get('sehir'),
      }),
    );
    $('#inspection').reset();
    notify(t('appointmentSent'));
  });
  $$('[data-report]').forEach(
    (b) =>
      (b.onclick = safeAction(async () =>
        window.open(await signed('ekspertiz', b.dataset.report), '_blank', 'noopener'),
      )),
  );
  if (hist.length > 1) {
    const canvas = $('#price-chart'),
      ctx = canvas.getContext('2d'),
      items = hist.filter((h) => h.para_birimi === c.para_birimi && h.fiyat != null),
      vals = items.map((h) => Number(h.fiyat)),
      lo = Math.min(...vals),
      hi = Math.max(...vals);
    canvas.setAttribute(
      'aria-label',
      items.map((h) => `${h.tarih.slice(0, 10)}: ${money(h.fiyat, h.para_birimi)}`).join('; '),
    );
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--orange');
    ctx.lineWidth = 3;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = 40 + (i * 720) / Math.max(1, vals.length - 1),
        y = 170 - ((v - lo) / Math.max(1, hi - lo)) * 130;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted');
    ctx.font = '14px Arial';
    ctx.fillText(money(lo, c.para_birimi), 40, 202);
    ctx.fillText(money(hi, c.para_birimi), 40, 20);
  }
  const visitor = read('bc-visitor', '') || crypto.randomUUID();
  write('bc-visitor', visitor);
  const stats = await rpc('istatistik', { p_ilan: c.id, p_tur: 'goruntulenme', p_kim: visitor });
  if (id !== state.routeId) return;
  $('#detail-stats').textContent =
    `${stats.goruntulenme || 0} ${t('views')} · ${stats.favori || 0} ${t('favs')}`;
  $$('[data-phone]').forEach(
    (b) =>
      (b.onclick = () =>
        rpc('istatistik', { p_ilan: c.id, p_tur: 'telefon', p_kim: visitor }).catch(() => {})),
  );
  const sim = await rpc('ilan_ara', {
    p: { marka: String(c.marka_id || ''), model: String(c.model_id || '') },
  });
  $('#similar').innerHTML =
    titleLink('similar', 'ilanlar.html') +
    `<div class="listing-list">${
      sim.ilanlar
        .filter((x) => x.id !== c.id)
        .slice(0, 3)
        .map(card)
        .join('') || empty()
    }</div>`;
  bindCards();
  let schema = $('#vehicle-schema');
  if (!schema) {
    schema = document.createElement('script');
    schema.id = 'vehicle-schema';
    schema.type = 'application/ld+json';
    document.head.append(schema);
  }
  schema.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Vehicle',
    name: c.baslik,
    ...(c.marka || c.diger_marka ? { brand: c.marka || c.diger_marka } : {}),
    ...(c.model || c.diger_model ? { model: c.model || c.diger_model } : {}),
    ...(c.yil ? { vehicleModelDate: String(c.yil) } : {}),
    ...(c.km != null
      ? {
          mileageFromOdometer: {
            '@type': 'QuantitativeValue',
            value: Number(c.km),
            unitCode: 'KMT',
          },
        }
      : {}),
    ...(c.yakit ? { fuelType: t(c.yakit) } : {}),
    ...(c.vites ? { vehicleTransmission: t(c.vites) } : {}),
    ...(c.detay?.kasa ? { bodyType: c.detay.kasa } : {}),
    ...(c.detay?.renk ? { color: c.detay.renk } : {}),
    ...(c.fotograflar?.length ? { image: c.fotograflar } : {}),
    offers:
      c.fiyat != null
        ? {
            '@type': 'Offer',
            areaServed: 'KKTC',
            availability: 'https://schema.org/' + (c.durum === 'satildi' ? 'SoldOut' : 'InStock'),
            price: c.fiyat,
            priceCurrency: c.para_birimi === 'TL' ? 'TRY' : c.para_birimi,
            url: $('link[rel=canonical]')?.href || location.href,
          }
        : undefined,
  });
}
