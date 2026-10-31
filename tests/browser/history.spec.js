import { test, expect } from '@playwright/test';
import { id, setup } from '../fixtures/setup.js';

const docId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const record = {
  belgeler: [
    {
      id: docId,
      ad: '<img src=x onerror=alert(1)>',
      tur: 'bakim',
      tarih: '2024-01-01',
      dosya: 'owner/listing/report.pdf',
    },
  ],
  kilometre: [
    { tarih: '2023-01-01', km: 50000, belge_id: null },
    { tarih: '2024-01-01', km: 40000, belge_id: docId },
  ],
  yayin_onayi: true,
};

test('Araç geçmişi belge kaynağını, kilometre düşüşünü ve hasar açıklamasını gösterir', async ({
  page,
}) => {
  await setup(page, (f) => {
    f.history = record;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ilan.html?id=' + id);
  const history = page.locator('.vehicle-history');
  await expect(history).toBeVisible();
  await expect(history).toContainText('Doğrulanmamış belge');
  await expect(history).toContainText('Satıcı beyanı');
  await expect(history).toContainText('Yüklenen belge');
  await expect(history).toContainText(record.belgeler[0].ad);
  await expect(history.locator('img')).toHaveCount(0);
  await expect(history.locator('.history-warning')).toContainText('kilometre düşüşü');
  await expect(history.getByRole('img')).toHaveAttribute('aria-label', /tablo/);
  await history.locator('summary').click();
  await history.locator('[data-history-code]').selectOption('XX');
  await expect(history.locator('[data-history-explanation]')).toContainText('değiştirilmiş');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#language').click();
  await expect(page.locator('.vehicle-history')).toContainText('Unverified document');
});

test('İlan formu belge ve kilometre kayıtlarını taslak kaydına ekler', async ({ page }) => {
  await setup(page);
  await page.goto('/ilan-ver.html?id=' + id);
  await expect(page.locator('#editor')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.locator('#step-next').click();
  const history = page.locator('#history-editor');
  await expect(history).toBeVisible();
  await history.locator('[name=history_name]').fill('Bakım belgesi');
  await history.locator('[name=history_date]').fill('2024-01-01');
  await history.locator('[name=history_type]').selectOption('bakim');
  await history.locator('[name=history_file]').setInputFiles({
    name: 'bakim.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nbakim'),
  });
  await history.locator('[data-history-add-doc]').click();
  await expect(history.locator('[data-history-docs] li')).toHaveCount(0);
  await history.locator('[name=history_consent]').check();
  await history.locator('[data-history-add-doc]').click();
  await expect(history.locator('[data-history-docs]')).toContainText('Bakım belgesi');
  await history.locator('[name=history_km_date]').fill('2024-01-01');
  await history.locator('[name=history_km]').fill('40000');
  await history
    .locator('[name=history_source]')
    .selectOption({ label: 'Yüklenen belge: Bakım belgesi' });
  await history.locator('[data-history-add-km]').click();
  await page.locator('#draft-save').click();
  await expect(page.locator('#notice')).toContainText('İşlem tamamlandı');
  const saved = await page.evaluate(
    () => globalThis.calls.filter((c) => c.name === 'ilan_kaydet').at(-1).p.p_gecmis,
  );
  expect(saved.belgeler[0].dosya).toMatch(/\.pdf$/);
  expect(saved.kilometre[0]).toEqual({
    tarih: '2024-01-01',
    km: 40000,
    belge_id: saved.belgeler[0].id,
  });
  await history.locator('[data-history-remove-doc]').click();
  await expect(history.locator('[data-history-rows]')).toContainText('Satıcı beyanı');
  await page.locator('#draft-save').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          globalThis.calls.filter((c) => c.name === 'ilan_kaydet').at(-1).p.p_gecmis.belgeler
            .length,
      ),
    )
    .toBe(0);
});
