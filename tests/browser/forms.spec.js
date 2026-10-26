import { test, expect } from '@playwright/test';
import { setup, id } from '../fixtures/setup.js';

const ready = (page, form) =>
  page.waitForFunction(
    (s) => Date.now() - Number(document.querySelector(s)?.dataset.start) >= 700,
    form,
  );
const calls = (page, name) =>
  page.evaluate((name) => (globalThis.calls || []).filter((c) => c.name === name), name);

function contact(f) {
  f.guest = true;
  for (const [slug, baslik, baslik_en] of [
    ['iletisim', 'İletişim', 'Contact'],
    ['reklam-ver', 'Reklam Ver', 'Advertise'],
  ])
    f.tables.sayfalar.push({
      slug,
      baslik,
      baslik_en,
      icerik: 'Mesajınızı iletişim formundan iletin.',
      icerik_en: 'Send your message using the contact form.',
    });
}

for (const slug of ['iletisim', 'reklam-ver'])
  for (const lang of ['tr', 'en'])
    test(`Ziyaretçi formu tek gönderim ve kalıcı onay sunar: ${slug}/${lang}`, async ({ page }) => {
      await setup(page, (f) => {
        contact(f);
        f.rpcDelay = { iletisim_gonder: 600 };
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/sayfa.html?s=${slug}&lang=${lang}`);
      const form = page.locator('#contact-form'),
        send = form.locator('button');
      await send.click();
      expect(await calls(page, 'iletisim_gonder')).toEqual([]);
      await form.locator('[name=ad]').fill('Kıyı Ziyaretçi');
      await form.locator('[name=eposta]').fill('ziyaretci@example.invalid');
      await form.locator('[name=metin]').fill('Araç ilanı hakkında bilgi almak istiyorum.');
      await ready(page, '#contact-form');
      await send.click();
      await expect(send).toBeDisabled();
      await form.evaluate((f) => f.requestSubmit());
      await expect(page.locator('#contact-status')).toHaveText(
        lang === 'en'
          ? 'Your message has been sent to the management team.'
          : 'Mesajınız yönetim ekibine iletildi.',
      );
      expect(await calls(page, 'iletisim_gonder')).toHaveLength(1);
      await expect(send).toBeEnabled();
      await expect(form.locator('[name=metin]')).toHaveValue('');
      await expect(page).toHaveURL(new RegExp(`sayfa.html\\?s=${slug}`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    });

test('İletişim hatasında metin korunur; yeniden deneme ve bot alanı çalışır', async ({ page }) => {
  await setup(page, (f) => {
    contact(f);
    f.rpcFailures = ['iletisim_gonder'];
  });
  await page.goto('/sayfa.html?s=iletisim');
  const form = page.locator('#contact-form');
  await form.locator('[name=ad]').fill('Kıyı Ziyaretçi');
  await form.locator('[name=eposta]').fill('ziyaretci@example.invalid');
  await form.locator('[name=metin]').fill('İlan konusunda bilgi almak istiyorum.');
  await ready(page, '#contact-form');
  await form.locator('button').click();
  await expect(page.locator('#notice')).toContainText('Bağlantı kesildi');
  await expect(form.locator('button')).toBeEnabled();
  await expect(form.locator('[name=metin]')).toHaveValue('İlan konusunda bilgi almak istiyorum.');
  await expect(page.locator('#contact-status')).toBeHidden();
  await form.locator('[name=website_check]').evaluate((n) => {
    n.value = 'spam';
  });
  await form.locator('button').click();
  expect(await calls(page, 'iletisim_gonder')).toHaveLength(1);
  await form.locator('[name=website_check]').evaluate((n) => {
    n.value = '';
  });
  await page.evaluate(() => {
    globalThis.fixture.rpcFailures = [];
  });
  await form.locator('button').click();
  await expect(page.locator('#contact-status')).toBeVisible();
  expect(await calls(page, 'iletisim_gonder')).toHaveLength(2);
});

test('Profil değişikliği sekme dönüşünde korunur; kapalı SMS düğmeleri görünmez', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/hesabim.html?sekme=profil');
  await page.locator('#profile [name=ad]').fill('Kıyı Üye');
  await page.locator('#profile [name=telefon]').fill('+905331234567');
  await ready(page, '#profile');
  await page.locator('#profile button').click();
  await expect(page.locator('#notice')).toContainText('İşlem tamamlandı');
  await expect(page.locator('#sms-phone, #sms-code')).toHaveCount(0);
  await page.locator('[data-account=ilanlar]').click();
  await page.locator('[data-account=profil]').click();
  await expect(page.locator('#profile [name=ad]')).toHaveValue('Kıyı Üye');
  await expect(page.locator('#profile [name=telefon]')).toHaveValue('+905331234567');
});

test('Etkin SMS doğrulaması profil ekranında kalır', async ({ page }) => {
  await setup(page, (f) => {
    f.settings = { sms_zorunlu: true };
  });
  await page.goto('/hesabim.html?sekme=profil');
  await expect(page.locator('#sms-phone')).toBeVisible();
  await expect(page.locator('#sms-code')).toBeVisible();
});

test('Yönetici eski ve yeni iletişim kayıtlarında gönderen bilgilerini görür', async ({ page }) => {
  await setup(page, (f) => {
    f.tables.iletisim = [
      { id: 'eski-kayit', konu: 'Eski başvuru', metin: 'Önceki iletişim kaydı.' },
      {
        id: 'yeni-kayit',
        ad: 'Kıyı Ziyaretçi',
        eposta: 'ziyaretci@example.invalid',
        konu: 'Yeni başvuru',
        metin: 'İletişim formundan gelen mesaj.',
      },
    ];
  });
  await page.goto('/admin.html?sekme=iletisim');
  await expect(page.locator('#admin-content')).toContainText('Kıyı Ziyaretçi');
  await expect(page.locator('#admin-content')).toContainText('ziyaretci@example.invalid');
  await page.locator('#admin-search').fill('ziyaretci@example.invalid');
  await expect(page.locator('#admin-content tbody tr')).toHaveCount(1);
});

test('Ekspertiz talebi gönderilir ve başarı onayı gösterilir', async ({ page }) => {
  await setup(page);
  await page.goto('/ilan.html?id=' + id);
  const form = page.locator('#inspection');
  await form.locator('[name=ad]').fill('Kıyı Üye');
  await form.locator('[name=telefon]').fill('+905331234567');
  await form.locator('[name=sehir]').selectOption('Girne');
  await ready(page, '#inspection');
  await form.locator('button').click();
  await expect(page.locator('#notice')).toContainText('Randevu talebiniz alındı.');
  expect((await calls(page, 'randevular:insert'))[0].p).toMatchObject({
    ilan_id: id,
    sehir: 'Girne',
  });
});

test('Firma randevusu tarih ve notuyla gönderilir', async ({ page }) => {
  let firm;
  await setup(page, (f) => {
    firm = f.tables.firmalar[0].id;
    f.tables.firmalar[0].tur = 'ekspertiz_merkezi';
  });
  await page.goto('/firma.html?id=' + firm);
  const form = page.locator('#appointment');
  await form.locator('[name=tarih]').fill('2030-11-20T10:30');
  await form.locator('[name=notu]').fill('Satın alma öncesi kontrol.');
  await ready(page, '#appointment');
  await form.locator('button').click();
  await expect(page.locator('#notice')).toContainText('Randevu talebiniz alındı.');
  expect((await calls(page, 'randevular:insert'))[0].p).toMatchObject({
    firma_id: firm,
    notu: 'Satın alma öncesi kontrol.',
  });
  await expect(form.locator('[name=tarih]')).toHaveValue('');
});

test('Mesaj ve şikâyet formları ilgili kayda gönderir', async ({ page }) => {
  await setup(page);
  await page.goto('/mesajlar.html');
  await page.locator('#message-form textarea').fill('Araç halen satışta mı?');
  await ready(page, '#message-form');
  await page.locator('#message-form button').click();
  expect((await calls(page, 'mesaj_yaz'))[0].p.p_metin).toBe('Araç halen satışta mı?');
  await expect(page.locator('#message-form textarea')).toHaveValue('');
  await page.goto('/ilan.html?id=' + id);
  await page.locator('#report-listing').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[name=sebep]').selectOption('fiyat');
  await dialog.locator('[name=notu]').fill('İlan fiyatı kontrol edilsin.');
  await ready(page, 'dialog form');
  await dialog.getByRole('button', { name: 'Gönder', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await calls(page, 'sikayetler:insert'))[0].p).toMatchObject({
    ilan_id: id,
    sebep: 'fiyat',
  });
});
