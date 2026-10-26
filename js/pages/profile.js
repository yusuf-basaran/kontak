import { state } from '../state.js';
import { query, rpc, table, uploadFile } from '../api.js';
import { $, box, empty, notify } from '../ui.js';
import { button, check, guard, inp, label, safeAction, select } from '../forms.js';
import { cityList } from '../data.js';
import { locale, status, t } from '../i18n.js';
import { esc } from '../utils.js';

export async function profilePage(target) {
  const company =
    state.me.tip === 'kurumsal'
      ? await query(table('firmalar').eq('kullanici_id', state.user.id).maybeSingle())
      : null;
  target.innerHTML =
    box(
      'profile',
      `<form id="profile" class="fields">` +
        `${label('name', inp('ad', 'text', state.me.ad, 'required'))}` +
        `${label('phone', inp('telefon', 'tel', state.me.telefon || ''))}` +
        `${label('city', select('sehir', cityList, state.me.sehir))}` +
        `${check('eposta_ozet', 'emailSummary', state.me.eposta_ozet)}` +
        `${check('telefon_goster', 'showPhone', state.me.telefon_goster)}` +
        `${button('save')}` +
        `</form>`,
    ) +
    box(
      'changePassword',
      `<form id="change-password">${label('password', inp('password', 'password', '', 'minlength="10" required'))}${button('save')}</form>`,
    ) +
    (state.settings.sms_zorunlu
      ? box(
          'phoneVerify',
          `<form id="sms-phone">` +
            `${label('phone', inp('phone', 'tel', state.me.telefon || '', 'required'))}` +
            `${button('send')}` +
            `</form><form id="sms-code">` +
            `${label('code', inp('code', 'text', '', 'pattern="[0-9]{6}" required'))}` +
            `${button('checkCode')}` +
            `</form>`,
        )
      : '') +
    (company ? companyEdit(company) : '') +
    `<button class="danger" id="delete-account">${esc(t('deleteAccount'))}</button>`;
  guard($('#profile'), async (f) => {
    const data = {
      ad: f.get('ad'),
      telefon: f.get('telefon'),
      sehir: f.get('sehir') || null,
      eposta_ozet: f.has('eposta_ozet'),
      telefon_goster: f.has('telefon_goster'),
    };
    await query(state.db.from('profil').update(data).eq('id', state.user.id));
    Object.assign(state.me, data);
    notify(t('success'));
  });
  guard($('#change-password'), async (f) => {
    const r = await state.db.auth.updateUser({ password: f.get('password') });
    if (r.error) throw r.error;
    notify(t('success'));
  });
  if ($('#sms-phone'))
    guard($('#sms-phone'), async (f) => {
      const r = await state.db.auth.updateUser({ phone: f.get('phone') });
      if (r.error) throw r.error;
      notify(t('success'));
    });
  if ($('#sms-code'))
    guard($('#sms-code'), async (f) => {
      const r = await state.db.auth.verifyOtp({
        phone: $('#sms-phone').phone.value,
        token: f.get('code'),
        type: 'phone_change',
      });
      if (r.error) throw r.error;
      notify(t('success'));
    });
  $('#delete-account').onclick = safeAction(async () => {
    if (confirm(t('confirmDelete'))) {
      await rpc('hesap_sil');
      await state.db.auth.signOut();
      location.href = 'index.html';
    }
  });
  if (company) {
    bindCompany(company);
    const appointments = await query(
      table('randevular').eq('firma_id', company.id).order('olusturma', { ascending: false }),
    );
    target.insertAdjacentHTML(
      'beforeend',
      box(
        'appointment',
        appointments
          .map(
            (r) =>
              `<article class="review"><p>` +
              `${esc(r.ad)}` +
              ` · ` +
              `${esc(r.telefon)}` +
              ` · ` +
              `${esc(r.tarih ? new Date(r.tarih).toLocaleString(locale()) : '')}` +
              `</p><p>` +
              `${esc(r.notu)}` +
              `</p><p>` +
              `${esc(status(r.durum))}` +
              `</p></article>`,
          )
          .join('') || empty(),
      ),
    );
  }
}

export function companyEdit(c) {
  const b = c.bilgiler || {};
  return box(
    'companyName',
    `<form id="company-edit" class="fields">` +
      `${label('companyName', inp('ad', 'text', c.ad, 'required'))}` +
      `${label('city', select('sehir', cityList, c.sehir, false))}` +
      `${label('phone', inp('telefon', 'tel', c.telefon || ''))}` +
      `${label('aboutCompany', `<textarea name="hakkinda">${esc(c.hakkinda || '')}</textarea>`)}` +
      `${label('address', inp('adres', 'text', b.adres))}` +
      `${label(
        'hoursOpen',
        `<textarea name="saatler">` +
          `${esc(JSON.stringify(b.saatler || { 1: ['09:00', '18:00'], 2: ['09:00', '18:00'], 3: ['09:00', '18:00'], 4: ['09:00', '18:00'], 5: ['09:00', '18:00'], 6: ['09:00', '14:00'] }))}` +
          `</textarea>`,
      )}` +
      `${label('website', inp('web', 'url', b.web))}` +
      `${label('social', `<textarea name="sosyal">${esc(JSON.stringify(b.sosyal || {}))}</textarea>`)}` +
      `${label('photos', `<input name="logo" type="file" accept="image/png,image/jpeg,image/webp"><input name="kapak" type="file" accept="image/png,image/jpeg,image/webp">`)}` +
      `${button('save')}` +
      `</form>`,
  );
}

export function bindCompany(c) {
  guard($('#company-edit'), async (f) => {
    const logo = f.get('logo'),
      kapak = f.get('kapak'),
      data = {
        ad: f.get('ad'),
        sehir: f.get('sehir'),
        telefon: f.get('telefon'),
        hakkinda: f.get('hakkinda'),
        bilgiler: {
          ...c.bilgiler,
          adres: f.get('adres'),
          saatler: JSON.parse(f.get('saatler')),
          web: f.get('web'),
          sosyal: JSON.parse(f.get('sosyal')),
        },
      };
    if (logo?.size) data.logo = await uploadFile('firmalar', logo, 'logo', 5242880);
    if (kapak?.size) data.kapak = await uploadFile('firmalar', kapak, 'kapak', 5242880);
    await query(state.db.from('firmalar').update(data).eq('id', c.id));
    notify(t('success'));
  });
}
