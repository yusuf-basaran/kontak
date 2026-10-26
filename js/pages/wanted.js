import { $, $$, box, empty, meta, money, pageHead } from '../ui.js';
import { t } from '../i18n.js';
import { bindVehicles, vehicleForm } from '../vehicle.js';
import { button, guard, inp, label, safeAction, select } from '../forms.js';
import { cityList } from '../data.js';
import { need, query, rpc, table } from '../api.js';
import { state } from '../state.js';
import { esc } from '../utils.js';

export async function wantedPage() {
  meta(t('seoWantedTitle'), t('seoWantedDescription'));
  $('#main').innerHTML =
    pageHead('wantedTitle') +
    box(
      'newWanted',
      `<form id="wanted-form">` +
        `${vehicleForm()}` +
        `<div class="fields">` +
        `${label('title', inp('baslik', 'text', '', 'required minlength="5" maxlength="140"'))}` +
        `${label('budgetAmount', inp('butce', 'number', '', 'min="0"'))}` +
        `${label('currency', select('para_birimi', ['GBP', 'EUR', 'USD', 'TL'], 'GBP', false))}` +
        `${label('city', select('sehir', cityList))}` +
        `</div>` +
        `${label('description', '<textarea name="metin" required minlength="3" maxlength="3000"></textarea>')}` +
        `${button('send')}` +
        `</form>`,
    ) +
    `<div id="wanted-list"></div>`;
  const f = $('#wanted-form'),
    v = bindVehicles(f);
  guard(f, async (data) => {
    need();
    const a = v();
    await query(
      state.db.from('talepler').insert({
        marka_id: a.marka ? Number(a.marka) : null,
        model_id: a.model ? Number(a.model) : null,
        baslik: data.get('baslik'),
        butce: data.get('butce') ? Number(data.get('butce')) : null,
        para_birimi: data.get('para_birimi'),
        sehir: data.get('sehir'),
        metin: data.get('metin'),
      }),
    );
    await wantedPage();
  });
  if (!state.db) return;
  const list = await query(
    table('talepler').eq('aktif', true).order('olusturma', { ascending: false }).limit(100),
  );
  $('#wanted-list').innerHTML =
    list
      .map(
        (r) =>
          `<section class="panel"><div class="section-head"><h2>` +
          `${esc(r.baslik)}` +
          `</h2><strong class="price">` +
          `${esc(money(r.butce, r.para_birimi))}` +
          `</strong></div><p>` +
          `${esc(r.sehir)}` +
          `</p><p class="prose">` +
          `${esc(r.metin)}` +
          `</p>` +
          `${r.kullanici_id === state.user?.id ? `<button class="text-btn" data-close-wanted="${esc(r.id)}">${esc(t('remove'))}</button>` : `<button class="text-btn" data-contact-wanted="${esc(r.kullanici_id)}">${esc(t('sendMessage'))}</button>`}` +
          `</section>`,
      )
      .join('') || empty();
  $$('[data-contact-wanted]').forEach(
    (b) =>
      (b.onclick = safeAction(async () => {
        need();
        location.href = `mesajlar.html?k=${await rpc('konusma_ac', { p_satici: b.dataset.contactWanted })}`;
      })),
  );
  $$('[data-close-wanted]').forEach(
    (b) =>
      (b.onclick = safeAction(async () => {
        await query(
          state.db.from('talepler').update({ aktif: false }).eq('id', b.dataset.closeWanted),
        );
        await wantedPage();
      })),
  );
}
