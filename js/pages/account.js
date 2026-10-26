import {
  $,
  $$,
  bindCards,
  box,
  card,
  empty,
  fail,
  icon,
  loginPrompt,
  meta,
  notify,
  pageHead,
} from '../ui.js';
import { locale, status, t } from '../i18n.js';
import { button, check, confirmAction, guard, inp, promoteDialog, safeAction } from '../forms.js';
import { state } from '../state.js';
import { query, rpc, table } from '../api.js';
import { params } from '../context.js';
import { accountTabs } from '../data.js';
import { csvParse, esc, filterUrl, read, write } from '../utils.js';
import { myPackages } from './packages.js';
import { profilePage } from './profile.js';

export async function accountPage() {
  meta(t('seoAccountTitle'), t('seoAccountDescription'));
  $('#main').innerHTML = pageHead('account', button('logout', 'logout', 'text-btn'));
  if (!state.db || !state.user) {
    $('#main').insertAdjacentHTML('beforeend', loginPrompt());
    return;
  }
  state.me = await rpc('profilim');
  let tab = params.get('sekme') || 'ilanlar';
  $('#main').insertAdjacentHTML(
    'beforeend',
    `<nav class="tabs" id="account-tabs">${accountTabs.map(([k, v]) => `<button data-account="${esc(k)}">${esc(t(v))}</button>`).join('')}</nav><div id="account-content"></div>`,
  );
  $('#logout').onclick = safeAction(async () => {
    await state.db.auth.signOut();
    write('bc-favs', []);
    location.href = 'index.html';
  });
  $$('[data-account]').forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.account;
        history.replaceState(null, '', `?sekme=${tab}`);
        draw().catch(fail);
      }),
  );
  async function draw() {
    $$('[data-account]').forEach((b) => b.classList.toggle('active', b.dataset.account === tab));
    const target = $('#account-content');
    if (tab === 'ilanlar') {
      const list = await query(
        table('ilan_kartlari')
          .eq('kullanici_id', state.user.id)
          .order('olusturma', { ascending: false }),
      );
      target.innerHTML =
        `<div class="actions"><a class="btn" href="ilan-ver.html">` +
        `${esc(t('sell'))}` +
        `</a>` +
        `${
          state.me.tip === 'kurumsal'
            ? `<button class="text-btn" id="csv-open">` +
              `${esc(t('csv'))}` +
              `</button><button class="text-btn" id="bulk-price">` +
              `${esc(t('bulkPrice'))}` +
              `</button><button class="text-btn" id="bulk-hide">` +
              `${esc(t('bulkHide'))}` +
              `</button><a href="hesabim.html?sekme=profil">` +
              `${esc(t('companyName'))}` +
              `</a>`
            : ''
        }` +
        `</div><div class="listing-list">` +
        `${
          list
            .map(
              (c) =>
                `<div class="account-listing">` +
                `${state.me.tip === 'kurumsal' ? `<label class="check"><input type="checkbox" data-bulk="${esc(c.id)}">${esc(c.baslik)}</label>` : ''}` +
                `${card(c)}` +
                `<div class="account-tools"><div class="account-summary"><span class="listing-state">` +
                `${esc(status(c.durum))}` +
                `</span><span data-stat="${esc(c.id)}"></span></div><div class="actions"><a class="text-btn" href="ilan-ver.html?id=` +
                `${esc(c.id)}` +
                `">` +
                `${icon('edit')}${esc(t('edit'))}` +
                `</a>` +
                `${[
                  ['copy', 'copy', 'copy'],
                  ['kaldir', 'unpublish', 'pause'],
                  ['satildi', 'markSold', 'check'],
                  ['yayinla', 'renew', 'renew'],
                  ['yukari', 'bump', 'up'],
                  ['sil', 'remove', 'trash'],
                ]
                  .map(
                    ([op, k, symbol]) =>
                      `<button class="text-btn" data-listing-op="${esc(op)}" data-id="${esc(c.id)}">${icon(symbol)}${esc(t(k))}</button>`,
                  )
                  .join('')}` +
                `<button class="text-btn" data-own-promote="` +
                `${esc(c.id)}` +
                `">` +
                `${icon('promote')}${esc(t('promote'))}` +
                `</button></div></div></div>`,
            )
            .join('') || empty()
        }` +
        `</div>`;
      bindCards();
      $$('[data-listing-op]').forEach(
        (b) =>
          (b.onclick = safeAction(async () => {
            if (b.dataset.listingOp === 'sil') {
              const id = b.dataset.id,
                listing = list.find((c) => c.id === id);
              if (
                !(await confirmAction(
                  t('deleteListing'),
                  `${listing.baslik}\n\n${t('confirmListingDelete')}`,
                  'deleteForever',
                ))
              )
                return;
              await rpc('ilan_sil', { p_ilan: id, p_onay: true });
              for (const key of ['bc-favs', 'bc-recent', 'bc-compare'])
                write(
                  key,
                  read(key).filter((value) => value !== id),
                );
              if (read('bc-draft', '') === id) write('bc-draft', '');
              state.cars = state.cars.filter((c) => c.id !== id);
              state.listed = state.listed.filter((c) => c.id !== id);
              notify(t('listingDeleted'));
              await draw();
              return;
            }
            if (b.dataset.listingOp === 'copy') {
              const n = await rpc('ilan_kopyala', { p_ilan: b.dataset.id });
              location.href = `ilan-ver.html?id=${n}`;
              return;
            }
            await rpc('kota', { p_ilan: b.dataset.id, p_islem: b.dataset.listingOp });
            await draw();
          })),
      );
      $$('[data-own-promote]').forEach(
        (b) => (b.onclick = () => promoteDialog(b.dataset.ownPromote)),
      );
      for (let start = 0; start < list.length; start += 100) {
        const stats = await rpc('istatistiklerim', {
          p_ilanlar: list.slice(start, start + 100).map((c) => c.id),
        });
        for (const s of stats) {
          const n = $$('[data-stat]').find((n) => n.dataset.stat === s.id);
          if (n)
            n.textContent = `${s.goruntulenme || 0} ${t('views')} · ${s.favori || 0} ${t('favs')} · ${s.mesaj || 0} ${t('messageCount')} · ${s.telefon || 0} ${t('phoneClicks')}`;
        }
      }
      if (state.me.tip === 'kurumsal') {
        $('#csv-open').onclick = csvDialog;
        $('#bulk-price').onclick = () => bulkDialog(list, false);
        $('#bulk-hide').onclick = () => bulkDialog(list, true);
      }
    } else if (tab === 'paketler') await myPackages(target);
    else if (tab === 'favoriler' || tab === 'takip') {
      let q = table('favoriler').eq('kullanici_id', state.user.id);
      if (tab === 'takip') q = q.eq('fiyat_takibi', true);
      const f = await query(q),
        list = f.length
          ? await query(
              table('ilan_kartlari').in(
                'id',
                f.map((x) => x.ilan_id),
              ),
            )
          : [];
      target.innerHTML = `<div class="listing-list">${list.map(card).join('') || empty()}</div>`;
      bindCards();
    } else if (tab === 'aramalar') {
      const [list, hist] = await Promise.all([
        query(table('aramalar').eq('kullanici_id', state.user.id)),
        rpc('arama_gecmis'),
      ]);
      target.innerHTML =
        list
          .map(
            (a) =>
              `<section class="panel"><h2>` +
              `${esc(a.ad)}` +
              `</h2><a href="ilanlar.html?` +
              `${esc(filterUrl(a.filtre))}` +
              `">` +
              `${esc(t('search'))}` +
              `</a>` +
              `${check('mail_' + a.id, 'emailSummary', a.eposta)}` +
              `<button class="text-btn" data-delete-search="` +
              `${esc(a.id)}` +
              `">` +
              `${esc(t('remove'))}` +
              `</button></section>`,
          )
          .join('') +
        box(
          'history',
          [...hist, ...read('bc-searches')]
            .filter((s, i, a) => a.findIndex((x) => x.query === s.query) === i)
            .slice(0, 10)
            .map(
              (s) =>
                `<p><a href="ilanlar.html?${esc(s.query)}">${esc(new URLSearchParams(s.query).get('q') || s.query)}</a></p>`,
            )
            .join('') || empty(),
        );
      $$('[data-delete-search]').forEach(
        (b) =>
          (b.onclick = safeAction(async () => {
            await query(state.db.from('aramalar').delete().eq('id', b.dataset.deleteSearch));
            await draw();
          })),
      );
      list.forEach((a) => {
        $(`[name="mail_${a.id}"]`).onchange = safeAction(async (e) => {
          await query(
            state.db.from('aramalar').update({ eposta: e.target.checked }).eq('id', a.id),
          );
        });
      });
    } else if (tab === 'saticilar') {
      const follow = await query(table('takipler').eq('kullanici_id', state.user.id)),
        list = await Promise.all(follow.map((f) => rpc('satici', { p_id: f.satici_id })));
      target.innerHTML =
        list
          .map(
            (s) =>
              `<section class="panel"><a href="ilanlar.html?satici=` +
              `${esc(s.id)}` +
              `">` +
              `${esc(s.firma?.ad || s.ad)}` +
              `</a><button class="text-btn" data-unfollow="` +
              `${esc(s.id)}` +
              `">` +
              `${esc(t('remove'))}` +
              `</button></section>`,
          )
          .join('') || empty();
      $$('[data-unfollow]').forEach(
        (b) =>
          (b.onclick = safeAction(async () => {
            await query(state.db.from('takipler').delete().eq('satici_id', b.dataset.unfollow));
            await draw();
          })),
      );
    } else if (tab === 'bildirimler') {
      const list = await query(
        table('bildirimler')
          .eq('kullanici_id', state.user.id)
          .order('olusturma', { ascending: false })
          .limit(100),
      );
      target.innerHTML =
        button('allRead', 'all-read') +
        list
          .map(
            (n) =>
              `<section class="panel ` +
              `${n.okundu ? '' : 'unread'}` +
              `"><p>` +
              `${notificationText(n)}` +
              `</p><small>` +
              `${esc(new Date(n.olusturma).toLocaleString(locale()))}` +
              `</small>` +
              `${n.veri.ilan_id ? `<a href="ilan.html?id=${esc(n.veri.ilan_id)}">${esc(t('view'))}</a>` : n.veri.konusma_id ? `<a href="mesajlar.html?k=${esc(n.veri.konusma_id)}">${esc(t('messages'))}</a>` : n.veri.iletisim_id ? `<a href="admin.html?sekme=iletisim">${esc(t('contact'))}</a>` : ''}` +
              `</section>`,
          )
          .join('');
      $('#all-read').onclick = safeAction(async () => {
        await query(
          state.db.from('bildirimler').update({ okundu: true }).eq('kullanici_id', state.user.id),
        );
        await draw();
      });
    } else await profilePage(target);
  }
  await draw();
}

export function notificationText(n) {
  const keys = {
    yeni_mesaj: 'messages',
    arama_eslesmesi: 'mySearches',
    fiyat_degisti: 'track',
    ilan_bitiyor: 'myListings',
    paket_talebi: 'myPackages',
    paket_bitti: 'expired',
    paket_bitiyor: 'endDate',
    sikayet: 'reports',
    sikayet_sonucu: 'reports',
    randevu: 'appointment',
    iletisim: 'contact',
  };
  return `${esc(t(keys[n.tur] || 'notifications'))} ${n.veri.durum ? esc(status(n.veri.durum)) : ''} ${esc(n.veri.not || n.veri.sonuc || n.veri.arama || n.veri.bitis || '')}`;
}

export function csvDialog() {
  const d = document.createElement('dialog');
  d.innerHTML =
    `<form><h2>` +
    `${esc(t('csv'))}` +
    `</h2><p>` +
    `${esc(t('csvHelp'))}` +
    `</p><input name="file" type="file" accept=".csv,text/csv" required>` +
    `${button('upload')}` +
    `<button type="button" class="text-btn">` +
    `${esc(t('cancel'))}` +
    `</button><output></output></form>`;
  document.body.append(d);
  $('button[type=button]', d).onclick = () => d.close();
  d.onclose = () => d.remove();
  guard($('form', d), async (f) => {
    const file = f.get('file');
    if (file.size > 1048576) throw Error(t('fileError'));
    const [headers, ...rows] = csvParse((await file.text()).replace(/^\uFEFF/, ''));
    const allowed = [
      'kategori_id',
      'baslik',
      'marka_id',
      'model_id',
      'yil',
      'km',
      'fiyat',
      'para_birimi',
      'sehir',
    ];
    if (headers.some((h) => !allowed.includes(h)) || rows.length > 100) throw Error(t('invalid'));
    let n = 0;
    for (const row of rows) {
      const data = Object.fromEntries(
        headers.map((h, i) => [
          h,
          ['kategori_id', 'marka_id', 'model_id', 'yil', 'km', 'fiyat'].includes(h)
            ? row[i]
              ? Number(row[i])
              : null
            : row[i],
        ]),
      );
      await query(state.db.from('ilanlar').insert(data));
      $('output', d).textContent = String(++n);
    }
    notify(t('success'));
  });
  d.showModal();
}

export function bulkDialog(list, hide) {
  const ids = $$('[data-bulk]:checked').map((n) => n.dataset.bulk);
  if (!ids.length) return;
  const d = document.createElement('dialog');
  d.innerHTML =
    `<form><h2>` +
    `${esc(t(hide ? 'bulkHide' : 'bulkPrice'))}` +
    `</h2>` +
    `${!hide ? inp('percent', 'number', 0, 'min="-99" max="1000" required') : ''}` +
    `<p>` +
    `${esc(ids.length)}` +
    `</p>` +
    `${button('apply')}` +
    `<button type="button" class="text-btn">` +
    `${esc(t('cancel'))}` +
    `</button></form>`;
  document.body.append(d);
  $('button[type=button]', d).onclick = () => d.close();
  d.onclose = () => d.remove();
  guard($('form', d), async (f) => {
    for (const id of ids) {
      if (hide) await rpc('kota', { p_ilan: id, p_islem: 'kaldir' });
      else
        await query(
          state.db
            .from('ilanlar')
            .update({
              fiyat:
                Math.round(
                  list.find((c) => c.id === id).fiyat * (1 + Number(f.get('percent')) / 100) * 100,
                ) / 100,
            })
            .eq('id', id),
        );
    }
    d.close();
    await accountPage();
  });
  d.showModal();
}
