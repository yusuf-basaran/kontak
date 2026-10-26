import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { initializeApp, getFirestore, getAuth, getStorage } from '../../scripts/firebase/admin.mjs';
import { seed } from '../../scripts/firebase/seed.mjs';
import { createService } from '../../functions/service.js';
import { maintenance } from '../../functions/jobs.js';
import { pendingDeletions } from '../../functions/deletion.js';
import { hash, id } from '../../functions/core.js';
import { firstAdmin } from '../../functions/bootstrap.js';

const project = 'demo-beta-car',
  bucketName = project + '.appspot.com';
assert.ok(
  process.env.FIRESTORE_EMULATOR_HOST &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST &&
    process.env.FIREBASE_STORAGE_EMULATOR_HOST,
  'Emülatörler gerekli',
);
initializeApp({ projectId: project, storageBucket: bucketName });
const db = getFirestore(),
  auth = getAuth(),
  bucket = getStorage().bucket(),
  service = createService({ db, auth, bucket });
const users = {},
  tokens = {};
const rpc = async (uid, name, data = {}) =>
  (await service.execute({ name, data }, users[uid])).data;
const query = async (uid, table, op = 'read', value, filters = [], more = {}) =>
  (await service.execute({ query: { table, op, value, filters, ...more } }, users[uid])).data;
const doc = async (table, key) => (await db.collection(table).doc(String(key)).get()).data();
const put = (table, key, data) => db.collection(table).doc(String(key)).set(data);
const reject = (fn, pattern = /./) => assert.rejects(fn, pattern);
const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const rest = (url, uid, options = {}) =>
  fetch(url, {
    ...options,
    headers: { ...(uid ? { Authorization: 'Bearer ' + tokens[uid] } : {}), ...options.headers },
  });
const firestore = (table, key) =>
  `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents/${table}/${key}`;
const upload = async (uid, path, contentType = 'application/pdf', bytes = 'rapor') =>
  rest(
    `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucketName}/o?uploadType=media&name=${encodeURIComponent(path)}`,
    uid,
    { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes },
  );

await test('Firebase sunucu işlemleri ve erişim kuralları', async (t) => {
  await seed(project);
  for (const uid of ['uye-a', 'uye-b', 'uye-c', 'yonetici', 'dogrulanmamis']) {
    await auth.deleteUser(uid).catch(() => {});
    users[uid] = await auth.createUser({
      uid,
      email: uid + '@example.invalid',
      password: 'Test-parola-42!',
      emailVerified: uid !== 'dogrulanmamis',
    });
    await rpc(uid, 'profil_kaydet', { ad: uid, tip: 'bireysel' });
    const response = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: users[uid].email,
          password: 'Test-parola-42!',
          returnSecureToken: true,
        }),
      },
    );
    const result = await response.json();
    assert.ok(result.idToken, JSON.stringify(result));
    tokens[uid] = result.idToken;
  }
  await put('_yetkiler', 'yonetici', { kullanici_id: 'yonetici', admin: true, engelli: false });
  await t.test('Kaldırılan doğrulama uçları hesap onayı vermez', async () => {
    for (const name of ['eposta_kod_durumu', 'eposta_kod_gonder', 'eposta_kod_onayla']) {
      await reject(() => service.execute({ name, data: {} }, users.dogrulanmamis));
      await reject(() => service.execute({ name, data: {} }));
    }
    assert.equal((await auth.getUser('dogrulanmamis')).emailVerified, false);
  });
  await t.test('Başlangıç verisi ve ana sayfa yalnız açık alanları birleştirir', async () => {
    await put('ayarlar', 'iban', { anahtar: 'iban', deger: 'PRIVATE-BANK-ACCOUNT' });
    const data = await rpc(null, 'baslangic', { p_sozluk: true, p_donanim: true });
    assert.ok(data.cats.length && data.eqs.length && data.lex.markalar.length);
    assert.deepEqual(Object.keys(data.settings).sort(), [
      'iletisim_telefon',
      'kurlar',
      'sms_zorunlu',
      'sosyal',
    ]);
    assert.doesNotMatch(JSON.stringify(data), /PRIVATE-BANK-ACCOUNT/);
    const brief = await rpc(null, 'baslangic', { p_sozluk: false, p_donanim: false });
    assert.equal(brief.lex, null);
    assert.deepEqual(brief.eqs, []);
    const home = await rpc(null, 'ana_sayfa', { p_son: [] });
    assert.ok(Array.isArray(home.cars) && Array.isArray(home.posts));
    assert.ok(home.posts.every((p) => p.aktif && Date.parse(p.yayin) <= Date.now()));
    assert.doesNotMatch(JSON.stringify(home), /PRIVATE-BANK-ACCOUNT/);
    await reject(rpc(null, 'baslangic', { p_sozluk: true, p_donanim: true, iban: true }));
    await reject(rpc(null, 'ana_sayfa', { p_son: Array(11).fill('x') }));
  });
  let listing, request, pack, conversation;
  const base = {
    baslik: 'Şehir içi bakım kayıtlı araç',
    kategori_id: 4,
    marka_id: 3,
    model_id: 1,
    yil: 2018,
    km: 50000,
    fiyat: 12000,
    para_birimi: 'GBP',
    sehir: 'Girne',
    aciklama: 'Bakım kayıtları incelenebilir.',
    detay: {},
    fotograflar: [],
  };
  const catalogue = await rpc(null, 'arac_sozlugu');
  base.marka_id = catalogue.modeller[0][1];
  base.model_id = catalogue.modeller[0][0];
  base.yil = Math.min(2018, catalogue.modeller[0][4]);
  base.kategori_id =
    (await query(null, 'kategoriler')).find((r) => r.arac_tipi === 'otomobil')?.id || 4;
  await t.test(
    'Hosting sayfa, ikon, güvenlik başlıkları ve API yönlendirmesini sunar',
    async () => {
      const home = await fetch('http://127.0.0.1:5000/');
      assert.equal(home.status, 200);
      assert.match(await home.text(), /id="seo-schema"/);
      assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
      assert.equal((await fetch('http://127.0.0.1:5000/assets/icon-192.png')).status, 200);
      const manifestResponse = await fetch('http://127.0.0.1:5000/manifest.json');
      assert.equal(manifestResponse.headers.get('cache-control'), 'no-cache');
      const manifest = await manifestResponse.json();
      assert.equal(manifest.name, 'KONTAK');
      assert.ok(manifest.icons.every((icon) => /^\/assets\/icon-\d+\.png\?v=/.test(icon.src)));
      const legacyIcon = await fetch('http://127.0.0.1:5000/icon-192.png', { redirect: 'manual' });
      assert.equal(legacyIcon.status, 301);
      assert.equal(legacyIcon.headers.get('location'), '/assets/icon-192.png');
      assert.equal((await fetch('http://127.0.0.1:5000/bulunamayan-sayfa')).status, 404);
      const response = await fetch('http://127.0.0.1:5000/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'sayaclar' }),
      });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).data.firma, 0);
    },
  );
  await t.test('Yetki yükseltme, doğrulanmamış hesap ve özel kayıtlar kapalıdır', async () => {
    assert.equal((await rest(firestore('_yetkiler', 'yonetici'), 'uye-a')).status, 403);
    assert.equal(
      (
        await rest(firestore('_yetkiler', 'uye-a'), 'uye-a', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { admin: { booleanValue: true } } }),
        })
      ).status,
      403,
    );
    await reject(() => rpc('uye-a', 'admin_veri', { p_tablo: 'ayarlar' }), /Yönetici/);
    await reject(
      () => query('uye-a', 'profil', 'update', { dogrulandi: true }, [['id', 'eq', 'uye-a']]),
      /yetkisi/,
    );
    await reject(() => rpc('dogrulanmamis', 'talep_ac', { p_paket: 'x' }), /Doğrulanmış/);
    assert.deepEqual(await query(null, 'ayarlar'), []);
    const response = await fetch(`http://127.0.0.1:5001/${project}/europe-west1/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens['uye-a'] },
      body: JSON.stringify({ name: 'profilim' }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).data.id, 'uye-a');
  });
  await t.test('Hatalı yazma istekleri de sunucu hız sınırına sayılır', async () => {
    const key = hash('uye-a:api'),
      before = (await doc('_hiz', key))?.daily || 0;
    const response = await rest(`http://127.0.0.1:5001/${project}/europe-west1/api`, 'uye-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'ilan_kaydet',
        data: { p_veri: { ...base, kullanici_id: 'uye-b' }, p_parcalar: {}, p_donanim: [] },
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await doc('_hiz', key)).daily, before + 1);
  });
  await t.test('İlan sahipliği, ücretsiz limit, gövde ve donanım korunur', async () => {
    listing = (await query('uye-a', 'ilanlar', 'insert', base, [], { one: 'required' })).id;
    await query('uye-a', 'ilan_parca', 'upsert', {
      ilan_id: listing,
      parca: 'kaput',
      durum: 'orijinal',
    });
    await query('uye-a', 'ilan_donanim', 'upsert', { ilan_id: listing, donanim_id: 1 });
    await reject(
      () =>
        query('uye-b', 'ilan_parca', 'upsert', {
          ilan_id: listing,
          parca: 'tavan',
          durum: 'degisen',
        }),
      /yetkisi/,
    );
    await rpc('uye-a', 'kota', { p_ilan: listing, p_islem: 'yayinla' });
    assert.equal((await doc('ilanlar', listing)).durum, 'yayinda');
    assert.equal((await rpc(null, 'ilan_ara', { p: { id: listing } })).toplam, 1);
    await reject(() => rpc('uye-b', 'kota', { p_ilan: listing, p_islem: 'kaldir' }), /bulunamadı/);
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        (
          await query(
            'uye-a',
            'ilanlar',
            'insert',
            { ...base, baslik: 'Bakım kayıtlı araç ' + i },
            [],
            { one: 'required' },
          )
        ).id,
      );
    for (const id of ids.slice(0, 2))
      await rpc('uye-a', 'kota', { p_ilan: id, p_islem: 'yayinla' });
    await reject(() => rpc('uye-a', 'kota', { p_ilan: ids[2], p_islem: 'yayinla' }), /Paket al/);
    await rpc('uye-a', 'kota', { p_ilan: listing, p_islem: 'yukari' });
    await reject(() => rpc('uye-a', 'kota', { p_ilan: listing, p_islem: 'yukari' }), /Günde/);
  });
  await t.test('Tek ilan kaydı, ilişkiler ve yayın aynı işlemde tamamlanır', async () => {
    const payload = {
      p_veri: base,
      p_parcalar: { kaput: 'orijinal', tavan: 'boyali' },
      p_donanim: [1],
      p_telefon: '+905338000001',
      p_tip: 'otomobil',
      p_yayin: false,
    };
    const saved = await rpc('uye-c', 'ilan_kaydet', payload);
    const row = await doc('ilanlar', saved.id);
    assert.deepEqual(row._parts, payload.p_parcalar);
    assert.deepEqual(row._equipment, [1]);
    assert.equal((await doc('profil', 'uye-c')).telefon, payload.p_telefon);
    const updated = {
      ...payload,
      p_ilan: saved.id,
      p_veri: { ...base, baslik: 'Güncel araç başlığı' },
      p_parcalar: { kaput: 'orijinal' },
      p_yayin: true,
    };
    await rpc('uye-c', 'ilan_kaydet', updated);
    assert.equal((await doc('ilanlar', saved.id)).durum, 'yayinda');
    assert.equal((await doc('ilanlar', saved.id))._parts.tavan, undefined);
    await rpc('uye-c', 'ilan_kaydet', updated);
    assert.equal((await doc('ilanlar', saved.id)).durum, 'yayinda');
    await reject(() => rpc('uye-b', 'ilan_kaydet', updated), /bulunamadı/);
    await reject(
      () =>
        rpc('uye-c', 'ilan_kaydet', {
          ...updated,
          p_yayin: false,
          p_parcalar: { kaput: 'yanlis' },
          p_veri: { ...base, baslik: 'Kaydedilmemesi gereken başlık' },
        }),
      /Kaporta/,
    );
    assert.equal((await doc('ilanlar', saved.id)).baslik, 'Güncel araç başlığı');
    await reject(
      () => rpc('uye-c', 'ilan_kaydet', { ...payload, p_veri: { ...base, kategori_id: 4 } }),
      /kategori/,
    );
    await reject(() => rpc('uye-c', 'istatistiklerim', { p_ilanlar: [listing] }), /yetkisi/);
    const stats = await rpc('uye-c', 'istatistiklerim', { p_ilanlar: [saved.id] });
    assert.equal(stats[0].id, saved.id);
    await rpc('uye-c', 'kota', { p_ilan: saved.id, p_islem: 'arsiv' });
  });
  await t.test(
    'SEO yönlendirmesi ilan, yazı, sitemap ve özel sayfa durumlarını sunar',
    async () => {
      const base = 'http://127.0.0.1:5000';
      const listingPage = await fetch(base + '/ilan.html?id=' + listing);
      assert.equal(listingPage.status, 200);
      assert.equal(listingPage.headers.get('cache-control'), 'no-store');
      const html = await listingPage.text();
      assert.match(html, /id="vehicle-schema"/);
      assert.match(html, /Şehir içi bakım kayıtlı araç/);
      assert.match(html, /rel="canonical"/);
      const draft = (await query('uye-a', 'ilanlar')).find((r) => r.durum === 'taslak');
      const hidden = await fetch(base + '/ilan.html?id=' + draft.id);
      assert.equal(hidden.status, 404);
      assert.equal(hidden.headers.get('cache-control'), 'no-store');
      assert.match(hidden.headers.get('x-robots-tag'), /noindex/);
      const post = (await query(null, 'yazilar'))[0];
      const article = await fetch(
        base + '/yazilar.html?s=' + encodeURIComponent(post.slug) + '&lang=en',
      );
      assert.match(await article.text(), /"@type":"Article"/);
      const sitemap = await fetch(base + '/sitemap.xml');
      assert.equal(sitemap.status, 200);
      const xml = await sitemap.text();
      assert.match(xml, new RegExp(listing));
      assert.doesNotMatch(xml, new RegExp(draft.id));
      assert.match((await fetch(base + '/hesabim.html')).headers.get('x-robots-tag'), /noindex/);
      assert.equal((await fetch(base + '/index.html', { redirect: 'manual' })).status, 301);
    },
  );
  await t.test('Eşzamanlı paket taleplerinden yalnız biri açılır; IBAN gizli kalır', async () => {
    pack = (await query(null, 'paketler')).find(
      (r) => r.hedef === 'bireysel' && r.ilan_kotasi > 0,
    ).id;
    const requests = await Promise.allSettled([
      rpc('uye-a', 'talep_ac', { p_paket: pack }),
      rpc('uye-a', 'talep_ac', { p_paket: pack }),
    ]);
    assert.equal(requests.filter((r) => r.status === 'fulfilled').length, 1);
    request = requests.find((r) => r.status === 'fulfilled').value;
    await reject(() => rpc('uye-a', 'banka_bilgisi', { p_talep: request }), /kapalı/);
    for (const [key, value] of [
      ['iban', 'TR00 TEST'],
      ['hesap_sahibi', 'Test hesabı'],
      ['banka', 'Test bankası'],
    ])
      await rpc('yonetici', 'yonet', { p_tablo: 'ayarlar', p_id: key, p_veri: value });
    await rpc('yonetici', 'talep_isle', {
      p_talep: request,
      p_durum: 'odeme_bekliyor',
      p_fiyat: 25,
    });
    assert.equal((await rpc('uye-a', 'banka_bilgisi', { p_talep: request })).iban, 'TR00 TEST');
    await reject(() => rpc('uye-b', 'banka_bilgisi', { p_talep: request }), /bulunamadı/);
    assert.equal((await rest(firestore('paket_talepleri', request), 'uye-a')).status, 403);
    assert.equal((await query('uye-b', 'paket_talepleri')).length, 0);
  });
  await t.test('Dekont türü, boyutu, sahipliği ve zaman aşımı uygulanır', async () => {
    const path = `dekontlar/uye-a/${request}/dekont.pdf`;
    assert.equal((await upload('uye-b', path)).status, 403);
    assert.equal((await upload('uye-a', path.replace('.pdf', '.html'), 'text/html')).status, 403);
    assert.equal(
      (
        await upload(
          'uye-a',
          path.replace('.pdf', '-buyuk.pdf'),
          'application/pdf',
          new Uint8Array(5242881),
        )
      ).status,
      403,
    );
    const response = await upload('uye-a', path);
    assert.ok(response.ok, await response.text());
    assert.equal(
      (
        await rest(
          `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media`,
          'uye-b',
        )
      ).status,
      403,
    );
    await rpc('uye-a', 'dekont_ekle', { p_talep: request, p_dosya: `uye-a/${request}/dekont.pdf` });
    await rpc('yonetici', 'talep_isle', {
      p_talep: request,
      p_durum: 'onaylandi',
      p_makbuz: 'Yalnız yönetim',
    });
    assert.equal(
      (await doc('abonelikler', request)).kalan_ilan,
      (await doc('paketler', pack)).ilan_kotasi,
    );
    await reject(
      () => rpc('yonetici', 'talep_isle', { p_talep: request, p_durum: 'onaylandi' }),
      /geçişi/,
    );
    assert.equal((await query('uye-a', 'paket_talepleri'))[0].makbuz_notu, undefined);
    await reject(
      () => query('uye-a', 'abonelikler', 'update', { kalan_ilan: 100 }, [['id', 'eq', request]]),
      /kapalı/,
    );
    assert.equal((await upload('uye-a', path.replace('.pdf', '-sonra.pdf'))).status, 403);
    const api = `http://127.0.0.1:5001/${project}/europe-west1/api`;
    const link = await rest(api, 'uye-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'dosya_url',
        data: { bucket: 'dekontlar', file: `uye-a/${request}/dekont.pdf` },
      }),
    });
    assert.equal(link.status, 200, await link.clone().text());
    const pathUrl = (await link.json()).data,
      url = api + pathUrl.slice(4);
    assert.equal((await fetch(url)).status, 200);
    const token = new URL(url).searchParams.get('token');
    await db.collection('_dosyalar').doc(hash(token)).update({ expires: 0 });
    assert.equal((await fetch(url)).status, 403);
  });
  await t.test('Son öne çıkarma hakkı eşzamanlı isteklerde bir kez kullanılır', async () => {
    await rpc('yonetici', 'yonet', {
      p_tablo: 'abonelikler',
      p_id: request,
      p_veri: { kalan_onecikarma: 1 },
    });
    const result = await Promise.allSettled([
      rpc('uye-a', 'kota', { p_ilan: listing, p_islem: 'onecikar', p_tur: 'seckin' }),
      rpc('uye-a', 'kota', { p_ilan: listing, p_islem: 'onecikar', p_tur: 'prestij' }),
    ]);
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await doc('abonelikler', request)).kalan_onecikarma, 0);
  });
  await t.test('Mesaj erişimi, okundu, tekrar sınırı, kapora uyarısı ve engelleme', async () => {
    conversation = await rpc('uye-b', 'konusma_ac', { p_ilan: listing });
    const message = await rpc('uye-b', 'mesaj_yaz', {
      p_konusma: conversation,
      p_metin: 'IBAN veya kapora isteniyor mu?',
    });
    assert.equal((await doc('mesajlar', message)).uyari, true);
    await reject(
      () =>
        rpc('uye-b', 'mesaj_yaz', {
          p_konusma: conversation,
          p_metin: 'IBAN veya kapora isteniyor mu?',
        }),
      /tekrarlanamaz/,
    );
    await reject(
      () => rpc('uye-c', 'mesaj_yaz', { p_konusma: conversation, p_metin: 'Merhaba' }),
      /bulunamadı/,
    );
    assert.equal((await rest(firestore('mesajlar', message), 'uye-a')).status, 200);
    assert.equal((await rest(firestore('mesajlar', message), 'uye-c')).status, 403);
    await rpc('uye-a', 'okundu', { p_konusma: conversation });
    assert.equal((await doc('mesajlar', message)).okundu, true);
    await query('uye-a', 'engeller', 'upsert', { kullanici_id: 'uye-a', engellenen_id: 'uye-b' });
    await reject(
      () => rpc('uye-b', 'mesaj_yaz', { p_konusma: conversation, p_metin: 'Araç duruyor mu?' }),
      /gönderilemiyor/,
    );
    await reject(
      () => rpc('uye-a', 'mesaj_yaz', { p_konusma: conversation, p_metin: 'x'.repeat(4001) }),
      /uzunluğu/,
    );
  });
  await t.test('Formlar sunucuda doğrulanır; üç şikâyette ilan gizlenir', async () => {
    await reject(
      () => query('uye-a', 'iletisim', 'insert', { konu: 'Konu', metin: 'x'.repeat(4001) }),
      /uzunluğu/,
    );
    await reject(
      () =>
        query('uye-a', 'randevular', 'insert', {
          ilan_id: listing,
          ad: 'Üye',
          telefon: '<script>',
          notu: '',
        }),
      /Telefon/,
    );
    await put('firmalar', 'randevu-merkezi', {
      id: 'randevu-merkezi',
      kullanici_id: 'uye-c',
      ad: 'Kıyı Kontrol',
      tur: 'ekspertiz_merkezi',
      sehir: 'Girne',
    });
    const appointment = {
      firma_id: 'randevu-merkezi',
      ad: 'Kıyı Üye',
      telefon: '+905331234567',
      tarih: future(2),
      notu: 'Araç kontrolü.',
    };
    const booked = await query('uye-a', 'randevular', 'insert', appointment);
    assert.ok((await query('uye-c', 'randevular')).some((r) => r.id === booked[0].id));
    assert.ok(
      (await rpc('yonetici', 'admin_veri', { p_tablo: 'randevular' })).some(
        (r) => r.id === booked[0].id,
      ),
    );
    await reject(
      () => query('uye-a', 'randevular', 'insert', { ...appointment, tarih: future(-1) }),
      /Gelecek/,
    );
    await reject(
      () => query('uye-a', 'randevular', 'insert', { ...appointment, tarih: 'geçersiz' }),
      /Gelecek/,
    );
    for (const uid of ['uye-b', 'uye-c', 'yonetici'])
      await query(uid, 'sikayetler', 'insert', {
        ilan_id: listing,
        sebep: 'fiyat',
        notu: 'Fiyat doğrulansın',
      });
    assert.equal((await doc('ilanlar', listing)).gizli, true);
    assert.equal((await rpc(null, 'ilan_ara', { p: { id: listing } })).toplam, 0);
  });
  await t.test(
    'Ziyaretçi iletişimi kaydedilir, yönetici görür; tekrar ve yetkisiz erişim engellenir',
    async () => {
      const data = {
        ad: 'Ziyaretçi Üye',
        eposta: 'ziyaretci@example.invalid',
        konu: 'İletişim kontrolü',
        metin: 'İlan düzenleme hakkında bilgi almak istiyorum.',
        website_check: '',
      };
      const send = (value) =>
        rest('http://127.0.0.1:5000/api', null, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'iletisim_gonder', data: value }),
        });
      const response = await send(data);
      assert.equal(response.status, 200, await response.clone().text());
      const key = (await response.json()).data.id,
        row = await doc('iletisim', key);
      assert.equal(row.kullanici_id, null);
      assert.equal(row.eposta, data.eposta);
      assert.equal(row.metin, data.metin);
      assert.ok(
        (await rpc('yonetici', 'admin_veri', { p_tablo: 'iletisim' })).some((r) => r.id === key),
      );
      const notices = (await query('yonetici', 'bildirimler')).filter(
        (n) => n.veri.iletisim_id === key,
      );
      assert.equal(notices.length, 1);
      assert.equal(await doc('_eposta', notices[0].id), undefined);
      assert.deepEqual(await query(null, 'iletisim'), []);
      assert.deepEqual(await query('uye-a', 'iletisim'), []);
      assert.equal((await rest(firestore('iletisim', key), 'uye-a')).status, 403);
      assert.equal((await send({ ...data, metin: '  ' + data.metin + '  ' })).status, 429);
      for (const patch of [
        { eposta: 'yanlis' },
        { website_check: 'spam' },
        { metin: 'x'.repeat(4001) },
        { kullanici_id: 'yonetici' },
      ])
        assert.equal((await send({ ...data, ...patch })).status, patch.kullanici_id ? 403 : 400);
      await reject(() => service.execute({ name: 'iletisim_gonder', data }), /kaynağı/);
      const dailyKey = hash('daily-contact:iletisim');
      await put('_hiz', dailyKey, { day: new Date().toISOString().slice(0, 10), daily: 20 });
      await reject(
        () => service.execute({ name: 'iletisim_gonder', data }, null, 'daily-contact'),
        /sınırı/,
      );
    },
  );
  await t.test('Tarayıcı gerçek Firebase SDK ile giriş yapıp sunucuya erişir', async () => {
    const server = spawn(process.execPath, ['scripts/serve.mjs'], {
      env: { ...process.env, PORT: '4180', FIREBASE_EMULATORS: 'true' },
      stdio: 'ignore',
    });
    let browser;
    try {
      for (let i = 0; i < 50; i++) {
        try {
          if ((await fetch('http://127.0.0.1:4180/')).ok) break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      browser = await chromium.launch({
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        ...(process.env.CHROMIUM_PROXY
          ? { proxy: { server: process.env.CHROMIUM_PROXY, bypass: '127.0.0.1,localhost' } }
          : {}),
      });
      const page = await browser.newPage({ ignoreHTTPSErrors: !!process.env.CHROMIUM_PROXY });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') console.log('Tarayıcı:', m.text());
      });
      page.on('requestfailed', (r) =>
        console.log('İstek:', new URL(r.url()).pathname, r.failure()?.errorText),
      );
      await page.route(
        /^https:\/\/(identitytoolkit|securetoken|firestore|firebasestorage)\.googleapis\.com\//,
        (route) => {
          errors.push('Canlı servis çağrısı');
          return route.abort();
        },
      );

      await page.goto('http://127.0.0.1:4180/giris.html');
      const loadedState = await page.evaluateHandle(
        async () => (await import('/js/state.js')).state,
      );
      await page.waitForFunction((state) => state.phase === 'ready', loadedState);
      await loadedState.dispose();
      assert.equal(
        await page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .some((r) => /firebase-(firestore|storage)\.js/.test(r.name)),
        ),
        false,
      );
      let interrupted = false;
      await page.route('**/api', (route) => {
        const request = route.request().postDataJSON();
        if (request.name === 'profil_kaydet' && !interrupted) {
          interrupted = true;
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'Bağlantı kesildi' } }),
          });
        }
        return route.continue();
      });
      const registration = await page.evaluate(async () => {
        const { state } = await import('/js/state.js');
        const value = {
          email: 'yeni-uye@example.invalid',
          password: 'Test-parola-42!',
          options: {
            data: { ad: 'Yeni Üye', tip: 'bireysel' },
            emailRedirectTo: new URL('hesabim.html', location.href).href,
          },
        };
        const first = await state.db.auth.signUp(value),
          second = await state.db.auth.signUp(value);
        const hidden = !(await state.db.auth.getUser()).data.user;
        await state.db.auth.signOut();
        return {
          failed: !!first.error,
          error: second.error?.message || null,
          uid: second.data?.user?.id,
          hidden,
        };
      });
      assert.equal(registration.failed, true);
      assert.equal(registration.error, null);
      assert.equal(registration.hidden, true);
      assert.equal((await doc('profil', registration.uid)).ad, 'Yeni Üye');
      await page.unroute('**/api');
      const unverifiedLogin = await page.evaluate(async () => {
        const { state } = await import('/js/state.js');
        const response = await state.db.auth.signInWithPassword({
          email: 'yeni-uye@example.invalid',
          password: 'Test-parola-42!',
        });
        return { error: response.error?.message, user: (await state.db.auth.getUser()).data.user };
      });
      assert.match(unverifiedLogin.error, /E-posta adresinizi doğrulayın/);
      assert.equal(unverifiedLogin.user, null);
      const outbox = await (
        await fetch(
          `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${project}/oobCodes`,
        )
      ).json();
      const link = outbox.oobCodes.find(
        (r) => r.email === 'yeni-uye@example.invalid' && r.requestType === 'VERIFY_EMAIL',
      );
      assert.ok(link?.oobLink && link.oobCode);
      const confirmation = await fetch(
        `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oobCode: link.oobCode }),
        },
      );
      assert.equal(confirmation.status, 200);
      const linkedUser = await page.evaluate(async () => {
        const { state } = await import('/js/state.js');
        const response = await state.db.auth.signInWithPassword({
          email: 'yeni-uye@example.invalid',
          password: 'Test-parola-42!',
        });
        if (response.error) throw response.error;
        const profile = await state.db.rpc('profilim');
        if (profile.error) throw profile.error;
        await state.db.auth.signOut();
        return { uid: response.data.user.id, profile: profile.data.id };
      });
      assert.equal(linkedUser.uid, registration.uid);
      assert.equal(linkedUser.profile, registration.uid);
      assert.equal((await auth.getUser(registration.uid)).emailVerified, true);
      await page.locator('[name="email"]').fill('uye-a@example.invalid');
      await page.locator('[name="password"]').fill('Test-parola-42!');
      await page.waitForTimeout(1000);
      await page.locator('#auth-form .btn').click();
      try {
        await page.waitForURL('**/hesabim.html', { timeout: 30000 });
      } catch (error) {
        console.log('Giriş ekranı:', await page.locator('#main').innerText());
        console.log('Uyarı:', await page.locator('#notice').allTextContents());
        console.log('Hatalar:', errors);
        throw error;
      }
      await page.waitForFunction(() =>
        document.querySelector('#main')?.textContent.includes('İlanlarım'),
      );
      assert.deepEqual(errors, []);
      await page.locator('[data-account="paketler"]').click();
      await page.waitForFunction(() =>
        document.querySelector('#account-content')?.textContent.includes('BC-'),
      );
      assert.equal(
        await page.evaluate(async () => {
          const { state } = await import('/js/state.js');
          return state.user.id;
        }),
        'uye-a',
      );
      const file = await page.evaluate(async () => {
        const { state } = await import('/js/state.js');
        const result = await state.db.storage
          .from('firmalar')
          .upload('uye-a/sdk-native.png', new Blob(['gorsel'], { type: 'image/png' }));
        if (result.error) throw result.error;
        return result.data.path;
      });
      assert.equal(file, 'uye-a/sdk-native.png');
      assert.equal((await bucket.file('firmalar/' + file).exists())[0], true);
      await page.evaluate(async () => {
        const { state } = await import('/js/state.js');
        globalThis.nativeEvents = 0;
        state.db
          .channel('native-test')
          .on('change', { table: 'bildirimler', filter: 'kullanici_id=eq.uye-a' }, () => {
            globalThis.nativeEvents++;
          })
          .subscribe();
      });
      for (let i = 0; i < 30 && !(await page.evaluate(() => globalThis.nativeEvents)); i++) {
        await put('bildirimler', 'sdk-native', {
          kullanici_id: 'uye-a',
          okundu: false,
          tur: 'test',
          veri: { sira: i },
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(await page.evaluate(() => globalThis.nativeEvents > 0));
      await auth.updateUser('uye-a', { disabled: true });
      await page.reload();
      const refreshedState = await page.evaluateHandle(
        async () => (await import('/js/state.js')).state,
      );
      await page.waitForFunction((state) => state.phase === 'ready', refreshedState);
      assert.equal(await refreshedState.evaluate((state) => state.user || null), null);
      await refreshedState.dispose();
      assert.ok(await page.locator('a[href^="giris.html"]').count());
      await auth.updateUser('uye-a', { disabled: false });
      await page.goto('http://127.0.0.1:4180/sayfa.html?s=iletisim');
      await page.locator('#contact-form [name=ad]').fill('Ziyaretçi Kontrol');
      await page.locator('#contact-form [name=eposta]').fill('tarayici@example.invalid');
      await page
        .locator('#contact-form [name=metin]')
        .fill('Tarayıcı formundan gelen iletişim mesajı.');
      await page.waitForFunction(
        () => Date.now() - Number(document.querySelector('#contact-form').dataset.start) >= 700,
      );
      await page.locator('#contact-form button').click();
      await page.waitForFunction(() =>
        document.querySelector('#contact-status')?.textContent.includes('yönetim ekibine iletildi'),
      );
      const saved = (
        await db.collection('iletisim').where('eposta', '==', 'tarayici@example.invalid').get()
      ).docs.map((d) => d.data());
      assert.equal(saved.length, 1);
      assert.equal(saved[0].kullanici_id, null);
      assert.equal(await page.locator('#contact-form [name=metin]').inputValue(), '');
      assert.ok(page.url().includes('sayfa.html?s=iletisim'));
    } finally {
      await browser?.close();
      server.kill();
      await once(server, 'exit');
    }
  });
  await t.test(
    'Kalıcı silme sahiplik ve onay ister; dosyaları ve 500 üzeri bağlı kaydı temizler',
    async () => {
      const key = id(),
        copy = id(),
        uid = 'uye-a';
      await put('ilanlar', key, {
        ...base,
        id: key,
        kullanici_id: uid,
        durum: 'taslak',
        fotograflar: [],
        olusturma: future(0),
      });
      const photo = `ilanlar/${uid}/${key}/kapak.png`,
        shared = `ilanlar/${uid}/${key}/ortak.png`,
        removed = `ilanlar/${uid}/${key}/eski.png`,
        report = `ekspertiz/${uid}/${key}/rapor.pdf`;
      for (const path of [photo, shared, removed, report])
        assert.equal(
          (await upload(uid, path, path.endsWith('.pdf') ? 'application/pdf' : 'image/png')).status,
          200,
        );
      const url = (path) =>
        `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media`;
      await db
        .collection('ilanlar')
        .doc(key)
        .update({ fotograflar: [url(photo), url(shared)] });
      await put('ilanlar', copy, {
        ...base,
        id: copy,
        kullanici_id: uid,
        durum: 'taslak',
        fotograflar: [url(shared)],
      });
      await put('ilan_ekspertiz', key, {
        ilan_id: key,
        dosya: `${uid}/${key}/rapor.pdf`,
        firma: 'Kıyı Kontrol',
        tarih: future(0),
      });
      const signed = await rpc(uid, 'dosya_url', {
        bucket: 'ekspertiz',
        file: `${uid}/${key}/rapor.pdf`,
      });
      for (const table of [
        'ilan_parca',
        'ilan_donanim',
        'fiyat_gecmisi',
        'randevular',
        'sikayetler',
        '_foto',
        '_araclar',
        '_ziyaretler',
      ])
        await put(table, 'silme-' + key, { ilan_id: key });
      for (const table of ['_haklar', '_istatistik']) await put(table, key, { ucretli: true });
      await put('islem_kaydi', 'eski-' + key, { kayit: key, onceki: { ...base } });
      await put('bildirimler', 'bildirim-' + key, { kullanici_id: uid, veri: { ilan_id: key } });
      await put('_eposta', 'bildirim-' + key, { kullanici_id: uid, durum: 'beklemede' });
      await put('konusmalar', 'konusma-' + key, {
        ilan_id: key,
        alici_id: 'uye-b',
        satici_id: uid,
        katilimcilar: ['uye-b', uid],
      });
      await put('mesajlar', 'mesaj-' + key, {
        konusma_id: 'konusma-' + key,
        metin: 'Araç bilgisi',
        katilimcilar: ['uye-b', uid],
      });
      const batch = db.bulkWriter();
      for (let n = 0; n < 520; n++)
        batch.set(db.collection('favoriler').doc(key + '-' + n), {
          ilan_id: key,
          kullanici_id: 'uye-b',
        });
      await batch.close();
      await reject(rpc(null, 'ilan_sil', { p_ilan: key, p_onay: true }), /giriş/i);
      await reject(rpc('dogrulanmamis', 'ilan_sil', { p_ilan: key, p_onay: true }), /Doğrulanmış/);
      await reject(rpc('uye-b', 'ilan_sil', { p_ilan: key, p_onay: true }), /bulunamadı/);
      await reject(rpc(uid, 'ilan_sil', { p_ilan: key }), /onayı/);
      assert.ok(await doc('ilanlar', key));
      assert.equal((await bucket.file(photo).exists())[0], true);
      const quotaBefore = (await doc('abonelikler', request)).kalan_ilan;
      await rpc(uid, 'ilan_sil', { p_ilan: key, p_onay: true });
      for (const table of ['ilanlar', '_haklar', '_istatistik', '_silinen_ilanlar'])
        assert.equal(await doc(table, key), undefined);
      for (const table of [
        'ilan_parca',
        'ilan_donanim',
        'ilan_ekspertiz',
        'fiyat_gecmisi',
        'favoriler',
        'randevular',
        'sikayetler',
        '_foto',
        '_araclar',
        '_ziyaretler',
      ])
        assert.equal((await db.collection(table).where('ilan_id', '==', key).get()).size, 0, table);
      for (const path of [photo, removed, report])
        assert.equal((await bucket.file(path).exists())[0], false, path);
      assert.equal((await bucket.file(shared).exists())[0], true);
      assert.equal(await doc('bildirimler', 'bildirim-' + key), undefined);
      assert.equal(await doc('_eposta', 'bildirim-' + key), undefined);
      assert.equal((await db.collection('_dosyalar').where('path', '==', report).get()).size, 0);
      assert.equal((await fetch('http://127.0.0.1:5000' + signed)).status, 403);
      assert.equal((await doc('konusmalar', 'konusma-' + key)).ilan_id, null);
      assert.equal((await doc('mesajlar', 'mesaj-' + key)).metin, 'Araç bilgisi');
      const logs = await db.collection('islem_kaydi').where('kayit', '==', key).get();
      assert.equal(logs.size, 1);
      assert.deepEqual(logs.docs[0].data().onceki, { id: key });
      assert.equal((await doc('abonelikler', request)).kalan_ilan, quotaBefore);
      await rpc(uid, 'ilan_sil', { p_ilan: copy, p_onay: true });
      assert.equal((await bucket.file(shared).exists())[0], false);
    },
  );
  await t.test('Kesilen dosya temizliği başarı bildirmez; bakım silmeyi tamamlar', async () => {
    const key = id(),
      uid = 'uye-a',
      path = `ilanlar/${uid}/${key}/kapak.png`;
    await put('ilanlar', key, {
      ...base,
      id: key,
      kullanici_id: uid,
      durum: 'taslak',
      fotograflar: [],
    });
    assert.equal((await upload(uid, path, 'image/png')).status, 200);
    const blocked = createService({
      db,
      auth,
      bucket: {
        name: bucket.name,
        getFiles: bucket.getFiles.bind(bucket),
        file: () => {
          throw Error('Dosya servisi kesildi');
        },
      },
    });
    await reject(
      blocked.execute({ name: 'ilan_sil', data: { p_ilan: key, p_onay: true } }, users[uid]),
      /kesildi/,
    );
    assert.equal((await doc('ilanlar', key)).durum, 'siliniyor');
    assert.ok(await doc('_silinen_ilanlar', key));
    assert.equal((await rest(firestore('_silinen_ilanlar', key), uid)).status, 403);
    assert.equal((await upload(uid, `ilanlar/${uid}/${key}/sonra.png`, 'image/png')).status, 403);
    await reject(rpc(uid, 'kota', { p_ilan: key, p_islem: 'kaldir' }), /siliniyor/);
    await reject(
      query(uid, 'ilanlar', 'update', { baslik: 'Yeni başlık' }, [['id', 'eq', key]]),
      /siliniyor/,
    );
    await reject(rpc(uid, 'ilan_kopyala', { p_ilan: key }), /bulunamadı/);
    await pendingDeletions(db, bucket);
    assert.equal(await doc('ilanlar', key), undefined);
    assert.equal(await doc('_silinen_ilanlar', key), undefined);
    assert.equal((await bucket.file(path).exists())[0], false);
  });
  await t.test('İlk yönetici doğrulanmış sunucu ayarıyla yalnız bir kez atanır', async () => {
    await firstAdmin(db, users.dogrulanmamis, users.dogrulanmamis.email);
    assert.equal((await doc('_yetkiler', 'dogrulanmamis')).admin, false);
    await firstAdmin(db, users['uye-c'], 'farkli@example.invalid');
    assert.equal((await doc('_yetkiler', 'uye-c')).admin, false);
    await firstAdmin(db, users['uye-c'], users['uye-c'].email);
    assert.equal((await doc('_yetkiler', 'uye-c')).admin, true);
    await firstAdmin(db, users['uye-b'], users['uye-b'].email);
    assert.equal((await doc('_yetkiler', 'uye-b')).admin, false);
  });
  await t.test('Zamanlanmış bakım süreleri uygular ve yinelenen bildirim göndermez', async () => {
    const pending = await rpc('uye-b', 'talep_ac', { p_paket: pack });
    await db
      .collection('paket_talepleri')
      .doc(pending)
      .update({ olusturma: future(-8) });
    await db
      .collection('abonelikler')
      .doc(request)
      .update({ bitis: future(-1) });
    await maintenance(db);
    await maintenance(db);
    assert.equal((await doc('paket_talepleri', pending)).durum, 'suresi_doldu');
    assert.equal((await doc('abonelikler', request)).durum, 'bitti');
    const notices = await db.collection('bildirimler').where('kullanici_id', '==', 'uye-a').get();
    assert.equal(notices.docs.filter((d) => d.data().tur === 'paket_bitti').length, 1);
  });
});
