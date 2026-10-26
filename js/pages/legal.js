import { params } from '../context.js';
import { $, box, empty, meta, notify, pageHead, safety } from '../ui.js';
import { state } from '../state.js';
import { D, t } from '../i18n.js';
import { query, rpc, table } from '../api.js';
import { esc } from '../utils.js';
import { paragraphs } from './posts.js';
import { button, guard, inp, label } from '../forms.js';

export async function legalPage() {
  const slug = params.get('s') || 'hakkimizda';
  $('#main').innerHTML = pageHead('brand');
  if (!state.db) {
    $('#main').insertAdjacentHTML('beforeend', `<p class="empty">${esc(t('connect'))}</p>`);
    return;
  }
  const p = await query(table('sayfalar').eq('slug', slug).maybeSingle());
  if (!p) {
    $('#main').insertAdjacentHTML('beforeend', empty());
    return;
  }
  const title = state.lang === 'en' ? p.baslik_en : p.baslik;
  meta(
    D['seoTitle_' + slug] ? t('seoTitle_' + slug) : title,
    D['seo_' + slug]
      ? t('seo_' + slug)
      : (state.lang === 'en' ? p.icerik_en : p.icerik)?.replace(/\s+/g, ' ').trim().slice(0, 160),
  );
  $('#main').innerHTML =
    `<article class="panel prose legal"><h1>` +
    `${esc(title)}` +
    `</h1>` +
    `${paragraphs(state.lang === 'en' ? p.icerik_en : p.icerik)}` +
    `</article>` +
    `${['guvenli-alim', 'guvenli-satis'].includes(slug) ? safety() : ''}`;
  if (['reklam-ver', 'iletisim'].includes(slug)) {
    $('#main').insertAdjacentHTML(
      'beforeend',
      box(
        'contact',
        `<form id="contact-form">` +
          `${label('name', inp('ad', 'text', state.me?.ad || '', 'required minlength="2" maxlength="100" autocomplete="name"'))}` +
          `${label('email', inp('eposta', 'email', state.user?.email || '', 'required maxlength="254" autocomplete="email"'))}` +
          `${label('title', inp('konu', 'text', title, 'required minlength="2" maxlength="140"'))}` +
          `${label('description', '<textarea name="metin" required minlength="5" maxlength="4000"></textarea>')}` +
          `${button('send')}` +
          `<p id="contact-status" role="status" hidden></p>` +
          `</form>`,
      ),
    );
    const form = $('#contact-form'),
      status = $('#contact-status');
    guard(form, async (f) => {
      status.hidden = true;
      await rpc('iletisim_gonder', Object.fromEntries(f));
      form.elements.metin.value = '';
      status.textContent = t('contactSent');
      status.hidden = false;
      notify(t('contactSent'));
    });
  }
}
