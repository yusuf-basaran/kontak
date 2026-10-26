import { $, $$, empty, fail, loginPrompt, meta, money, notify, pageHead } from '../ui.js';
import { D, locale, status, t } from '../i18n.js';
import { state } from '../state.js';
import { rpc, signed } from '../api.js';
import { params } from '../context.js';
import { esc, key } from '../utils.js';
import { button, check, guard, inp, label, safeAction, select } from '../forms.js';

export async function adminPage() {
  meta(t('seoAdminTitle'), t('seoAdminDescription'));
  $('#main').innerHTML = pageHead('adminTitle');
  if (!state.db || !state.user) {
    $('#main').insertAdjacentHTML('beforeend', loginPrompt());
    return;
  }
  if (!(await rpc('yetkim'))) {
    $('#main').insertAdjacentHTML('beforeend', `<p>${esc(t('adminOnly'))}</p>`);
    return;
  }
  const tabs = [
    ['genel', 'overview'],
    ['ilanlar', 'myListings'],
    ['paketler', 'packages'],
    ['paket_talepleri', 'requests'],
    ['abonelikler', 'subscriptions'],
    ['ayarlar', 'settings'],
    ['gelir_ozeti', 'income'],
    ['profil', 'users'],
    ['firmalar', 'firms'],
    ['sikayetler', 'reports'],
    ['randevular', 'appointment'],
    ['oneriler', 'suggestions'],
    ['kategoriler', 'category'],
    ['markalar', 'make'],
    ['modeller', 'model'],
    ['donanimlar', 'equipment'],
    ['bannerlar', 'banners'],
    ['yazilar', 'journal'],
    ['sayfalar', 'pages'],
    ['iletisim', 'contact'],
    ['islem_kaydi', 'audit'],
  ];
  let tab = params.get('sekme') || 'genel',
    rows = [];
  $('#main').insertAdjacentHTML(
    'beforeend',
    `<nav class="tabs admin-tabs">` +
      `${tabs.map(([v, k]) => `<button data-admin-tab="${esc(v)}">${esc(t(k))}</button>`).join('')}` +
      `</nav><div class="result-tools"><input id="admin-search" type="search" aria-label="` +
      `${esc(t('search'))}` +
      `" placeholder="` +
      `${esc(t('search'))}` +
      `"><button class="btn" id="admin-new">` +
      `${esc(t('newRow'))}` +
      `</button><button class="text-btn" id="admin-merge">` +
      `${esc(t('merge'))}` +
      `</button></div><div id="admin-content"></div>`,
  );
  async function draw() {
    rows = await rpc('admin_veri', { p_tablo: tab });
    $$('[data-admin-tab]').forEach((b) => b.classList.toggle('active', b.dataset.adminTab === tab));
    $('#admin-new').hidden = ![
      'paketler',
      'kategoriler',
      'markalar',
      'modeller',
      'donanimlar',
      'bannerlar',
      'yazilar',
      'sayfalar',
    ].includes(tab);
    $('#admin-merge').hidden = !['markalar', 'modeller'].includes(tab);
    renderRows();
  }
  function renderRows() {
    const target = $('#admin-content'),
      search = key($('#admin-search').value);
    if (tab === 'genel') {
      target.innerHTML =
        `<div class="stats">` +
        `${[
          ['ilan', 'myListings'],
          ['uye', 'users'],
          ['mesaj', 'messages'],
          ['talep', 'requests'],
        ]
          .map(([v, k]) => `<div><strong>${esc(rows[v])}</strong><span>${esc(t(k))}</span></div>`)
          .join('')}` +
        `</div>`;
      return;
    }
    const list = rows.filter((r) => key(JSON.stringify(r)).includes(search));
    if (tab === 'ayarlar') {
      target.innerHTML = list
        .map(
          (r) =>
            `<section class="panel"><form data-setting="` +
            `${esc(r.anahtar)}` +
            `"><h2>` +
            `${esc(r.anahtar)}` +
            `</h2><textarea name="deger" rows="3">` +
            `${esc(JSON.stringify(r.deger))}` +
            `</textarea>` +
            `${button('save')}` +
            `</form></section>`,
        )
        .join('');
      $$('[data-setting]').forEach((f) =>
        guard(f, async (data) => {
          await rpc('admin_duzenle', {
            p_tablo: 'ayarlar',
            p_id: f.dataset.setting,
            p_veri: JSON.parse(data.get('deger')),
          });
          notify(t('success'));
        }),
      );
      return;
    }
    if (tab === 'paket_talepleri') {
      target.innerHTML =
        list
          .map(
            (r) =>
              `<section class="panel"><h2>` +
              `${esc(r.referans_kodu)}` +
              ` · ` +
              `${esc(r.ozet.ad)}` +
              `</h2><p>` +
              `${esc(r.kullanici_id)}` +
              ` · ` +
              `${esc(status(r.durum))}` +
              ` · ` +
              `${esc(money(r.ozet.fiyat, r.ozet.para_birimi))}` +
              `</p><p>` +
              `${esc(r.kullanici_notu)}` +
              `</p>` +
              `${r.dekont_dosya ? `<button class="text-btn" data-admin-receipt="${esc(r.dekont_dosya)}">${esc(t('report'))}</button>` : ''}` +
              `<form data-admin-request="` +
              `${esc(r.id)}` +
              `" class="fields">` +
              `${label(
                'status',
                select(
                  'durum',
                  [
                    ['odeme_bekliyor', 'paymentWaiting'],
                    ['onaylandi', 'approved'],
                    ['reddedildi', 'rejected'],
                    ['iptal', 'cancelled'],
                  ],
                  r.durum,
                  false,
                ),
              )}` +
              `${label('amount', inp('fiyat', 'number', r.ozet.fiyat, 'min="0" step="0.01"'))}` +
              `${label('adminNote', `<textarea name="admin_notu">${esc(r.admin_notu)}</textarea>`)}` +
              `${label('receiptNote', `<textarea name="makbuz_notu">${esc(r.makbuz_notu)}</textarea>`)}` +
              `${button('save')}` +
              `</form></section>`,
          )
          .join('') || empty();
      $$('[data-admin-receipt]').forEach(
        (b) =>
          (b.onclick = safeAction(async () =>
            window.open(await signed('dekontlar', b.dataset.adminReceipt), '_blank', 'noopener'),
          )),
      );
      $$('[data-admin-request]').forEach((f) =>
        guard(f, async (data) => {
          await rpc('talep_isle', {
            p_talep: f.dataset.adminRequest,
            p_durum: data.get('durum'),
            p_not: data.get('admin_notu'),
            p_makbuz: data.get('makbuz_notu'),
            p_fiyat:
              data.get('durum') === 'odeme_bekliyor' && data.get('fiyat') !== ''
                ? Number(data.get('fiyat'))
                : null,
          });
          await draw();
        }),
      );
      return;
    }
    if (tab === 'ilanlar') {
      target.innerHTML =
        `<div class="actions"><button class="text-btn" id="expired-archive">${esc(t('archive'))} · ${esc(t('expired'))}</button></div>` +
        list
          .map(
            (r) =>
              `<section class="panel"><h2><a href="ilan.html?id=` +
              `${esc(r.id)}` +
              `">` +
              `${esc(r.baslik)}` +
              `</a></h2><p>` +
              `${esc(r.no)}` +
              ` · ` +
              `${esc(status(r.durum))}` +
              ` · ` +
              `${esc(r.kullanici_id)}` +
              `</p>` +
              `${r.uyari ? `<p class="warning">${esc(t('safety'))}</p>` : ''}` +
              `<form data-admin-listing="` +
              `${esc(r.id)}` +
              `" class="fields">` +
              `${label(
                'status',
                select(
                  'durum',
                  [
                    ['beklemede', 'pendingListing'],
                    ['yayinda', 'published'],
                    ['reddedildi', 'rejected'],
                    ['kaldirildi', 'hiddenListing'],
                    ['arsiv', 'archive'],
                  ],
                  r.durum,
                  false,
                ),
              )}` +
              `${label('promote', select('onecikarma', ['seckin', 'hizli', 'prestij', 'vurgulu'], r.onecikarma))}` +
              `${label('endDate', inp('onecikarma_bitis', 'datetime-local', r.onecikarma_bitis ? new Date(r.onecikarma_bitis).toISOString().slice(0, 16) : ''))}` +
              `${check('gizli', 'hiddenListing', r.gizli)}` +
              `${button('save')}` +
              `</form></section>`,
          )
          .join('');
      $$('[data-admin-listing]').forEach((f) =>
        guard(f, async (data) => {
          await rpc('admin_duzenle', {
            p_tablo: 'ilanlar',
            p_id: f.dataset.adminListing,
            p_veri: {
              durum: data.get('durum'),
              onecikarma: data.get('onecikarma') || null,
              onecikarma_bitis: data.get('onecikarma_bitis')
                ? new Date(data.get('onecikarma_bitis')).toISOString()
                : null,
              gizli: data.has('gizli'),
            },
          });
          await draw();
        }),
      );
      $('#expired-archive').onclick = safeAction(async () => {
        for (const r of rows.filter((r) => r.durum === 'suresi_doldu'))
          await rpc('admin_duzenle', {
            p_tablo: 'ilanlar',
            p_id: r.id,
            p_veri: { durum: 'arsiv' },
          });
        await draw();
      });
      return;
    }
    if (tab === 'abonelikler') {
      target.innerHTML = list
        .map(
          (r) =>
            `<section class="panel"><h2>` +
            `${esc(r.kullanici_id)}` +
            `</h2><p>` +
            `${esc(status(r.durum))}` +
            ` · ` +
            `${esc(new Date(r.bitis).toLocaleString(locale()))}` +
            ` · ` +
            `${esc(Math.ceil((new Date(r.bitis) - Date.now()) / 86400000))}` +
            ` ` +
            `${esc(t('daysLeft'))}` +
            `</p><form data-subscription="` +
            `${esc(r.id)}` +
            `" class="fields">` +
            `${label('listingQuota', inp('kalan_ilan', 'number', r.kalan_ilan, 'min="0" required'))}` +
            `${label('promotionQuota', inp('kalan_onecikarma', 'number', r.kalan_onecikarma, 'min="0" required'))}` +
            `${label('endDate', inp('bitis', 'datetime-local', new Date(r.bitis).toISOString().slice(0, 16), 'required'))}` +
            `${label(
              'status',
              select(
                'durum',
                [
                  ['aktif', 'active'],
                  ['bitti', 'ended'],
                  ['iptal', 'cancelled'],
                ],
                r.durum,
                false,
              ),
            )}` +
            `${button('save')}` +
            `</form></section>`,
        )
        .join('');
      $$('[data-subscription]').forEach((f) =>
        guard(f, async (data) => {
          await rpc('admin_duzenle', {
            p_tablo: 'abonelikler',
            p_id: f.dataset.subscription,
            p_veri: {
              kalan_ilan: Number(data.get('kalan_ilan')),
              kalan_onecikarma: Number(data.get('kalan_onecikarma')),
              bitis: new Date(data.get('bitis')).toISOString(),
              durum: data.get('durum'),
            },
          });
          await draw();
        }),
      );
      return;
    }
    const cols = [...new Set(list.flatMap((r) => Object.keys(r)))].filter(
      (k) => !['icerik', 'icerik_en', 'onceki', 'sonraki', 'detay', 'fotograflar'].includes(k),
    );
    target.innerHTML =
      `<div class="table-scroll"><table><thead><tr>` +
      `${cols.map((k) => `<th>${esc(D[k] ? t(k) : k)}</th>`).join('')}` +
      `<th></th></tr></thead><tbody>` +
      `${list
        .map(
          (r, i) =>
            `<tr>` +
            `${cols.map((k) => `<td>${esc(typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k])}</td>`).join('')}` +
            `<td>` +
            `${
              tab === 'oneriler'
                ? `<button class="text-btn" data-proposal="` +
                  `${esc(r.id)}` +
                  `" data-value="true">` +
                  `${esc(t('approve'))}` +
                  `</button><button class="text-btn" data-proposal="` +
                  `${esc(r.id)}` +
                  `" data-value="false">` +
                  `${esc(t('reject'))}` +
                  `</button>`
                : tab === 'profil'
                  ? `<button class="text-btn" data-block="` +
                    `${esc(r.id)}` +
                    `">` +
                    `${esc(t('block'))}` +
                    `</button><button class="text-btn" data-unblock="` +
                    `${esc(r.id)}` +
                    `">` +
                    `${esc(t('unblock'))}` +
                    `</button><button class="text-btn" data-verify="` +
                    `${esc(r.id)}` +
                    `">` +
                    `${esc(t('approve'))}` +
                    `</button>`
                  : ['islem_kaydi', 'gelir_ozeti', 'iletisim'].includes(tab)
                    ? ''
                    : `<button class="text-btn" data-row="${esc(i)}">${esc(t('edit'))}</button>`
            }` +
            `</td></tr>`,
        )
        .join('')}` +
      `</tbody></table></div>`;
    $$('[data-row]').forEach((b) => (b.onclick = () => editRow(list[Number(b.dataset.row)])));
    $$('[data-proposal]').forEach(
      (b) =>
        (b.onclick = safeAction(async () => {
          await rpc('oneri_onayla', {
            p_id: b.dataset.proposal,
            p_onay: b.dataset.value === 'true',
          });
          await draw();
        })),
    );
    $$('[data-verify]').forEach(
      (b) =>
        (b.onclick = safeAction(async () => {
          await rpc('yonet', {
            p_tablo: 'kullanici',
            p_id: b.dataset.verify,
            p_veri: { dogrulandi: true },
          });
          await draw();
        })),
    );
    $$('[data-block],[data-unblock]').forEach(
      (b) =>
        (b.onclick = safeAction(async () => {
          await rpc('yonet', {
            p_tablo: 'kullanici',
            p_id: b.dataset.block || b.dataset.unblock,
            p_veri: { engelli: !!b.dataset.block },
          });
          notify(t('success'));
        })),
    );
  }
  function editRow(row) {
    const data = { ...row };
    delete data.id;
    delete data.olusturma;
    delete data.guncelleme;
    const d = document.createElement('dialog');
    const initial = row ? data : adminDefaults(tab);
    d.innerHTML =
      `<form><h2>` +
      `${esc(t('edit'))}` +
      `</h2>` +
      `${label('jsonData', `<textarea name="veri" rows="18" required spellcheck="false">${esc(JSON.stringify(initial, null, 2))}</textarea>`)}` +
      `${button('save')}` +
      `<button type="button" class="text-btn">` +
      `${esc(t('cancel'))}` +
      `</button></form>`;
    document.body.append(d);
    $('button[type=button]', d).onclick = () => d.close();
    d.onclose = () => d.remove();
    guard($('form', d), async (f) => {
      await rpc('yonet', {
        p_tablo: tab,
        p_id: row?.id || row?.slug || null,
        p_veri: JSON.parse(f.get('veri')),
      });
      d.close();
      await draw();
    });
    d.showModal();
  }
  $$('[data-admin-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.adminTab;
        history.replaceState(null, '', `?sekme=${tab}`);
        $('#admin-search').value = '';
        draw().catch(fail);
      }),
  );
  $('#admin-search').oninput = renderRows;
  $('#admin-new').onclick = () => editRow(null);
  $('#admin-merge').onclick = () => {
    const d = document.createElement('dialog');
    d.innerHTML =
      `<form><h2>` +
      `${esc(t('merge'))}` +
      `</h2>` +
      `${label('oldId', inp('eski', 'number', '', 'required'))}` +
      `${label('newId', inp('yeni', 'number', '', 'required'))}` +
      `${button('apply')}` +
      `<button type="button" class="text-btn">` +
      `${esc(t('cancel'))}` +
      `</button></form>`;
    document.body.append(d);
    $('button[type=button]', d).onclick = () => d.close();
    d.onclose = () => d.remove();
    guard($('form', d), async (f) => {
      await rpc('birlestir', {
        p_tur: tab === 'markalar' ? 'marka' : 'model',
        p_eski: Number(f.get('eski')),
        p_yeni: Number(f.get('yeni')),
      });
      d.close();
      await draw();
    });
    d.showModal();
  };
  await draw();
}

export function adminDefaults(tab) {
  return (
    {
      paketler: {
        ad: '',
        hedef: 'bireysel',
        ilan_kotasi: 0,
        onecikarma_hakki: 0,
        sure_gun: 30,
        fiyat: null,
        para_birimi: 'GBP',
        aciklama: '',
        aktif: true,
        sira: 0,
      },
      kategoriler: { ad: '', ad_en: '', slug: '', ust_id: null, arac_tipi: 'otomobil', sira: 0 },
      markalar: { ad: '', anahtar: '', tip: 'otomobil' },
      modeller: { marka_id: null, ad: '', anahtar: '', bas_yil: null, bit_yil: null },
      donanimlar: { grup: 'Güvenlik', ad: '', ad_en: '', arac_tipi: ['otomobil'] },
      bannerlar: {
        yer: 1,
        baslik: '',
        baslik_en: '',
        metin: '',
        metin_en: '',
        baglanti: '',
        aktif: true,
      },
      yazilar: {
        slug: '',
        baslik: '',
        baslik_en: '',
        ozet: '',
        ozet_en: '',
        icerik: '',
        icerik_en: '',
        kategori: '',
        aktif: true,
      },
      sayfalar: { slug: '', baslik: '', baslik_en: '', icerik: '', icerik_en: '' },
    }[tab] || {}
  );
}
