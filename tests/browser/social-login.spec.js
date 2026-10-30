import { test, expect } from '@playwright/test';
import { setup } from '../fixtures/setup.js';

for (const provider of ['google', 'facebook'])
  for (const lang of ['tr', 'en'])
    test(`${provider} girişi parola istemeden güvenli dönüşü korur: ${lang}`, async ({ page }) => {
      await setup(page, (f) => {
        f.guest = true;
        f.settings = { giris_saglayicilari: [provider] };
        f.oauthDelay = 400;
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/giris.html?next=%2Fhesabim.html%3Fsekme%3Dprofil&lang=${lang}`);
      const b = page.locator(`[data-social=${provider}]`);
      await expect(b).toBeVisible();
      await expect(page.locator('[data-social]')).toHaveCount(1);
      await b.click();
      await expect(b).toBeDisabled();
      expect(
        await page.evaluate(() => globalThis.calls.find((c) => c.name === 'oauth')?.p),
      ).toMatchObject({ provider });
      await page.waitForURL('**/hesabim.html?sekme=profil');
      const data = await page.evaluate(() => globalThis.calls || []);
      expect(data.some((c) => c.name === 'signin')).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    });

for (const code of [
  'auth/popup-closed-by-user',
  'auth/popup-blocked',
  'auth/account-exists-with-different-credential',
])
  test(`Sosyal giriş hatası mevcut formu korur: ${code}`, async ({ page }) => {
    await setup(page, (f) => {
      f.guest = true;
      f.settings = { giris_saglayicilari: ['google', 'facebook'] };
      f.oauthError = code;
    });
    await page.goto('/giris.html');
    await page.locator('[name=email]').fill('uye@example.invalid');
    await page.locator('[data-social=google]').click();
    await expect(page.locator('[data-social=google]')).toBeEnabled();
    await expect(page.locator('[name=email]')).toHaveValue('uye@example.invalid');
    await expect(page).toHaveURL(/giris.html$/);
    if (code === 'auth/popup-closed-by-user') await expect(page.locator('#notice')).toBeEmpty();
    else
      await expect(page.locator('#notice')).toContainText(
        code === 'auth/popup-blocked' ? 'Giriş penceresi engellendi' : 'mevcut giriş yönteminizle',
      );
    expect(
      await page.evaluate(() => globalThis.calls.filter((c) => c.name === 'oauth')),
    ).toHaveLength(1);
  });

test('Doğrulanmamış sosyal hesap bağlantılı e-posta onayında kalır', async ({ page }) => {
  await setup(page, (f) => {
    f.guest = true;
    f.settings = { giris_saglayicilari: ['facebook'] };
    f.oauthVerification = true;
  });
  await page.goto('/giris.html');
  await page.locator('[data-social=facebook]').click();
  await expect(page.locator('#notice')).toContainText(
    'E-posta doğrulama bağlantınızı kontrol edin',
  );
  await expect(page).toHaveURL(/giris.html$/);
  await page.locator('[data-auth=reset]').click();
  await expect(page.locator('[data-social]')).toHaveCount(0);
});

test('Kapalı sağlayıcılar görünmez ve dış adrese dönüş engellenir', async ({ page }) => {
  await setup(page, (f) => {
    f.guest = true;
    f.settings = { giris_saglayicilari: ['google', 'javascript:alert(1)'] };
  });
  await page.goto('/giris.html?next=https%3A%2F%2Fexample.invalid%2Fhesabim.html');
  await expect(page.locator('[data-social]')).toHaveCount(1);
  await page.locator('[data-social=google]').click();
  await page.waitForURL('**/hesabim.html');
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
});
