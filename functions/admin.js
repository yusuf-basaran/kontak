import {
  admin,
  check,
  object,
  fields,
  text,
  number,
  id,
  norm,
  now,
  audit,
  notify,
} from './core.js';
import { tables } from './data.js';

export const settings = [
  'iban',
  'hesap_sahibi',
  'banka',
  'odeme_notu',
  'ucretsiz_ilan_limiti',
  'onecikarma_gun',
  'talep_zaman_asimi_gun',
  'ilan_onayi',
  'sms_zorunlu',
  'giris_saglayicilari',
  'kurlar',
  'sosyal',
  'iletisim_telefon',
];
const editable = {
  paketler: [
    'ad',
    'hedef',
    'ilan_kotasi',
    'onecikarma_hakki',
    'sure_gun',
    'fiyat',
    'para_birimi',
    'aciklama',
    'aktif',
    'sira',
  ],
  kategoriler: ['ad', 'ad_en', 'slug', 'ust_id', 'arac_tipi', 'sira'],
  markalar: ['ad', 'anahtar', 'tip'],
  modeller: ['marka_id', 'ad', 'anahtar', 'bas_yil', 'bit_yil'],
  donanimlar: ['grup', 'ad', 'ad_en', 'arac_tipi'],
  bannerlar: ['yer', 'baslik', 'baslik_en', 'metin', 'metin_en', 'resim', 'baglanti', 'aktif'],
  yazilar: [
    'slug',
    'baslik',
    'baslik_en',
    'ozet',
    'ozet_en',
    'icerik',
    'icerik_en',
    'kapak',
    'kategori',
    'yayin',
    'aktif',
  ],
  sayfalar: ['slug', 'baslik', 'baslik_en', 'icerik', 'icerik_en'],
  firmalar: [
    'ad',
    'tur',
    'sehir',
    'logo',
    'kapak',
    'hakkinda',
    'telefon',
    'dogrulandi',
    'one_cikan',
    'bilgiler',
  ],
  sikayetler: ['durum', 'sonuc'],
  randevular: ['durum', 'notu'],
  abonelikler: ['kalan_ilan', 'kalan_onecikarma', 'bitis', 'durum'],
  ilanlar: ['durum', 'gizli', 'onecikarma', 'onecikarma_bitis'],
};
export async function adminData(s, c, table) {
  admin(c);
  if (table === 'genel') {
    const date = now().slice(0, 10),
      result = {};
    for (const [k, name] of [
      ['ilan', 'ilanlar'],
      ['uye', 'profil'],
      ['mesaj', 'mesajlar'],
    ])
      result[k] = (await s.all(name)).filter((r) => r.olusturma?.slice(0, 10) === date).length;
    result.talep = (await s.all('paket_talepleri')).filter((r) =>
      ['beklemede', 'dekont_yuklendi'].includes(r.durum),
    ).length;
    return result;
  }
  if (table === 'gelir_ozeti') {
    const result = {};
    for (const r of await s.all('paket_talepleri'))
      if (r.durum === 'onaylandi') {
        const month = r.guncelleme.slice(0, 7),
          key = month + ':' + r.ozet.para_birimi;
        result[key] ||= { ay: month, para_birimi: r.ozet.para_birimi, talep_sayisi: 0, toplam: 0 };
        result[key].talep_sayisi++;
        result[key].toplam += r.ozet.fiyat;
      }
    return Object.values(result);
  }
  check(tables.includes(table) && !table.startsWith('_'), 'Tablo erişimi kapalı');
  const rows = await s.all(table);
  if (table === 'profil')
    for (const r of rows) {
      const role = await s.get('_yetkiler', r.id);
      r.engelli = !!role?.engelli;
    }
  return rows
    .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))))
    .sort((a, b) => (b.olusturma || b.tarih || '').localeCompare(a.olusturma || a.tarih || ''))
    .slice(0, 1000);
}
async function validate(s, name, r) {
  if (name === 'paketler') {
    text(r.ad, 1, 120);
    check(['bireysel', 'kurumsal'].includes(r.hedef), 'Hedef geçersiz');
    for (const k of ['ilan_kotasi', 'onecikarma_hakki', 'sure_gun']) {
      number(r[k], k === 'sure_gun' ? 1 : 0, 100000);
      check(Number.isInteger(r[k]), 'Kota tam sayı olmalı');
    }
    if (r.fiyat != null) number(r.fiyat);
    check(['GBP', 'EUR', 'USD', 'TL'].includes(r.para_birimi), 'Para birimi geçersiz');
    check(typeof r.aktif === 'boolean', 'Paket durumu geçersiz');
  }
  if (name === 'abonelikler') {
    number(r.kalan_ilan, 0, 100000);
    number(r.kalan_onecikarma, 0, 100000);
    check(
      !Number.isNaN(Date.parse(r.bitis)) && ['aktif', 'bitti', 'iptal'].includes(r.durum),
      'Abonelik geçersiz',
    );
  }
  if (name === 'modeller') {
    check(await s.get('markalar', r.marka_id), 'Marka bulunamadı');
    if (r.bas_yil != null) number(r.bas_yil, 1950, 2200);
    if (r.bit_yil != null) number(r.bit_yil, r.bas_yil || 1950, 2200);
  }
  if (name === 'ilanlar') {
    check(
      [
        'taslak',
        'beklemede',
        'yayinda',
        'reddedildi',
        'kaldirildi',
        'satildi',
        'suresi_doldu',
        'arsiv',
      ].includes(r.durum),
      'İlan durumu geçersiz',
    );
    if (r.onecikarma)
      check(
        ['seckin', 'hizli', 'prestij', 'vurgulu'].includes(r.onecikarma),
        'Öne çıkarma türü geçersiz',
      );
    if (r.durum === 'yayinda' && !r.bitis) {
      r.yayin = now();
      r.bitis = new Date(Date.now() + 30 * 86400000).toISOString();
    }
  }
  if (['yazilar', 'sayfalar'].includes(name))
    for (const k of ['baslik', 'baslik_en', 'icerik', 'icerik_en'])
      text(r[k], 1, k.startsWith('icerik') ? 100000 : 200);
  if (['kategoriler', 'markalar', 'modeller', 'donanimlar'].includes(name)) text(r.ad, 1, 120);
}
export async function adminWrite(s, c, p) {
  admin(c);
  const name = p.p_tablo;
  if (name !== 'ayarlar') object(p.p_veri);
  if (name === 'ayarlar') {
    check(settings.includes(p.p_id), 'Ayar geçersiz');
    const value = p.p_veri;
    if (['ucretsiz_ilan_limiti', 'onecikarma_gun', 'talep_zaman_asimi_gun'].includes(p.p_id)) {
      number(value, p.p_id === 'ucretsiz_ilan_limiti' ? 0 : 1, 10000);
      check(Number.isInteger(value), 'Süre tam sayı olmalı');
    }
    if (['sms_zorunlu', 'ilan_onayi'].includes(p.p_id))
      check(typeof value === 'boolean', 'Ayar geçersiz');
    if (p.p_id === 'giris_saglayicilari')
      check(
        Array.isArray(value) &&
          value.length <= 2 &&
          value.every((v) => ['google', 'facebook'].includes(v)) &&
          new Set(value).size === value.length,
        'Giriş sağlayıcısı geçersiz',
      );
    const old = await s.get(name, p.p_id),
      next = { anahtar: p.p_id, deger: value };
    s.put(name, p.p_id, next);
    await audit(s, c, name, p.p_id, old, next);
    return null;
  }
  if (name === 'kullanici') {
    fields(p.p_veri, ['engelli', 'dogrulandi']);
    const user = await s.get('profil', p.p_id);
    check(user, 'Kullanıcı bulunamadı');
    const role = (await s.get('_yetkiler', p.p_id)) || {
      kullanici_id: p.p_id,
      admin: false,
      engelli: false,
    };
    if ('engelli' in p.p_veri) {
      check(typeof p.p_veri.engelli === 'boolean', 'Engel durumu geçersiz');
      s.put('_yetkiler', p.p_id, { ...role, engelli: p.p_veri.engelli });
    }
    if ('dogrulandi' in p.p_veri) {
      check(typeof p.p_veri.dogrulandi === 'boolean', 'Doğrulama geçersiz');
      s.put('profil', p.p_id, { ...user, dogrulandi: p.p_veri.dogrulandi });
    }
    await audit(s, c, name, p.p_id, role, p.p_veri);
    return null;
  }
  check(editable[name], 'Tablo düzenleme kapalı');
  fields(p.p_veri, editable[name]);
  const key =
    p.p_id ||
    (['kategoriler', 'markalar', 'modeller', 'donanimlar', 'bannerlar'].includes(name)
      ? await s.seq(name)
      : name === 'sayfalar'
        ? p.p_veri.slug
        : id());
  const old = await s.get(name, key);
  if (name === 'abonelikler' && old) {
    const lock = (await s.get('_kilitler', old.kullanici_id)) || { version: 0 };
    s.put('_kilitler', old.kullanici_id, { version: lock.version + 1 });
  }
  const defaults = {
    paketler: {
      ilan_kotasi: 0,
      onecikarma_hakki: 0,
      sure_gun: 30,
      fiyat: null,
      para_birimi: 'GBP',
      aciklama: '',
      aktif: true,
      sira: 0,
    },
    kategoriler: { ust_id: null, sira: 0 },
    markalar: {},
    modeller: { bas_yil: null, bit_yil: null },
    bannerlar: { aktif: true },
    yazilar: { aktif: true, yayin: now() },
  };
  const next = { id: key, ...defaults[name], ...old, ...p.p_veri };
  if (['markalar', 'modeller'].includes(name)) next.anahtar = norm(next.ad);
  await validate(s, name, next);
  s.put(name, key, next);
  await audit(s, c, name, key, old, next);
  if (name === 'sikayetler') {
    await notify(s, next.kullanici_id, 'sikayet_sonucu', {
      sonuc: next.sonuc || '',
      durum: next.durum,
    });
  }
  return null;
}
export async function approve(s, c, p) {
  admin(c);
  const r = await s.get('oneriler', p.p_id);
  check(r?.durum === 'beklemede', 'Öneri bulunamadı');
  if (p.p_onay) {
    let make = (await s.all('markalar')).find(
      (x) => x.tip === r.tip && x.anahtar === norm(r.marka),
    );
    if (!make) {
      const key = await s.seq('markalar');
      make = { id: key, ad: r.marka, tip: r.tip, anahtar: norm(r.marka) };
      s.put('markalar', key, make);
    }
    if (
      r.model &&
      !(await s.all('modeller', [['marka_id', '==', make.id]])).some(
        (x) => x.anahtar === norm(r.model),
      )
    ) {
      const key = await s.seq('modeller');
      s.put('modeller', key, {
        id: key,
        marka_id: make.id,
        ad: r.model,
        anahtar: norm(r.model),
        bas_yil: null,
        bit_yil: null,
      });
    }
  }
  const next = { ...r, durum: p.p_onay ? 'onaylandi' : 'reddedildi' };
  s.put('oneriler', r.id, next);
  await audit(s, c, 'oneriler', r.id, r, next);
  return null;
}
export async function merge(s, c, p) {
  admin(c);
  check(p.p_eski !== p.p_yeni && ['marka', 'model'].includes(p.p_tur), 'Birleştirme geçersiz');
  const table = p.p_tur === 'marka' ? 'markalar' : 'modeller',
    a = await s.get(table, p.p_eski),
    b = await s.get(table, p.p_yeni);
  check(a && b, 'Kayıt bulunamadı');
  if (table === 'modeller') check(a.marka_id === b.marka_id, 'Markalar aynı olmalı');
  const changes = [];
  if (table === 'markalar')
    for (const model of await s.all('modeller', [['marka_id', '==', a.id]])) {
      const target = (await s.all('modeller', [['marka_id', '==', b.id]])).find(
        (m) => m.anahtar === model.anahtar,
      );
      changes.push([model.id, target?.id || model.id]);
      if (target) s.del('modeller', model.id);
      else s.put('modeller', model.id, { ...model, marka_id: b.id });
    }
  for (const name of ['ilanlar', 'talepler'])
    for (const row of await s.all(name)) {
      if (table === 'modeller' && row.model_id === a.id)
        s.put(name, row.id, { ...row, model_id: b.id });
      if (table === 'markalar' && row.marka_id === a.id)
        s.put(name, row.id, {
          ...row,
          marka_id: b.id,
          model_id: changes.find(([old]) => old === row.model_id)?.[1] || row.model_id,
        });
    }
  s.del(table, a.id);
  await audit(s, c, table, a.id, a, b);
  return null;
}
