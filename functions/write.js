import {
  member,
  check,
  fields,
  text,
  number,
  object,
  id,
  now,
  active,
  same,
  rate,
  audit,
  notify,
} from './core.js';
import { read } from './data.js';
import { saveListing } from './listings.js';

const allowed = {
  profil: ['ad', 'telefon', 'sehir', 'eposta_ozet', 'telefon_goster'],
  firmalar: [
    'kullanici_id',
    'ad',
    'tur',
    'sehir',
    'logo',
    'kapak',
    'hakkinda',
    'telefon',
    'bilgiler',
  ],
  firma_ozel: ['firma_id', 'vergi'],
  ilan_parca: ['ilan_id', 'parca', 'durum'],
  ilan_donanim: ['ilan_id', 'donanim_id'],
  ilan_ekspertiz: ['ilan_id', 'dosya', 'firma', 'tarih'],
  favoriler: ['kullanici_id', 'ilan_id', 'fiyat_takibi'],
  takipler: ['kullanici_id', 'satici_id'],
  engeller: ['kullanici_id', 'engellenen_id'],
  aramalar: ['ad', 'filtre', 'eposta'],
  bildirimler: ['okundu'],
  talepler: ['marka_id', 'model_id', 'baslik', 'butce', 'para_birimi', 'sehir', 'metin', 'aktif'],
  sikayetler: ['ilan_id', 'mesaj_id', 'sebep', 'notu'],
  randevular: ['firma_id', 'ilan_id', 'ad', 'telefon', 'sehir', 'tarih', 'notu'],
  iletisim: ['konu', 'metin'],
  oneriler: ['tip', 'marka', 'model'],
  yorumlar: ['firma_id', 'puan', 'metin'],
};
export const parts = [
  'on_tampon',
  'kaput',
  'tavan',
  'bagaj',
  'arka_tampon',
  'sol_on_camurluk',
  'sag_on_camurluk',
  'sol_on_kapi',
  'sag_on_kapi',
  'sol_arka_kapi',
  'sag_arka_kapi',
  'sol_arka_camurluk',
  'sag_arka_camurluk',
];
const states = ['orijinal', 'lokal_boyali', 'boyali', 'degisen', 'hasarli'];
export function primary(table, r) {
  const keys = {
    profil: ['id'],
    firma_ozel: ['firma_id'],
    ilan_ekspertiz: ['ilan_id'],
    ilan_parca: ['ilan_id', 'parca'],
    ilan_donanim: ['ilan_id', 'donanim_id'],
    favoriler: ['kullanici_id', 'ilan_id'],
    takipler: ['kullanici_id', 'satici_id'],
    engeller: ['kullanici_id', 'engellenen_id'],
    yorumlar: ['kullanici_id', 'firma_id'],
  }[table];
  return keys ? keys.map((k) => r[k]).join('_') : r.id;
}
async function owner(s, c, table, r) {
  if (table === 'profil') return r.id === c.uid;
  if (table === 'firma_ozel') return (await s.get('firmalar', r.firma_id))?.kullanici_id === c.uid;
  if (table.startsWith('ilan_')) {
    const listing = await s.get('ilanlar', r.ilan_id);
    return listing?.kullanici_id === c.uid && listing.durum !== 'siliniyor';
  }
  return r.kullanici_id === c.uid;
}
async function validate(s, c, table, r, file) {
  if (table === 'profil') {
    text(r.ad, 1, 100);
    if (r.telefon) text(r.telefon, 7, 30);
    check(
      typeof r.eposta_ozet === 'boolean' && typeof r.telefon_goster === 'boolean',
      'Tercih geçersiz',
    );
  } else if (table === 'firmalar') {
    check((await s.get('profil', c.uid))?.tip === 'kurumsal', 'Kurumsal hesap gerekli');
    text(r.ad, 2, 140);
    check(
      ['galeri', 'yetkili_satici', 'parca_tedarikcisi', 'ekspertiz_merkezi'].includes(r.tur),
      'Firma türü geçersiz',
    );
    check(
      !(await s.all('firmalar', [['kullanici_id', '==', c.uid]])).some((x) => x.id !== r.id),
      'Firma kaydı zaten var',
    );
    if (r.bilgiler) object(r.bilgiler);
    text(r.hakkinda || '', 0, 8000);
    for (const key of ['logo', 'kapak']) if (r[key]) await file('firmalar', r[key], c.uid);
  } else if (table === 'firma_ozel') text(r.vergi || '', 0, 50);
  else if (table === 'ilan_parca')
    check(parts.includes(r.parca) && states.includes(r.durum), 'Kaporta seçimi geçersiz');
  else if (table === 'ilan_donanim')
    check(await s.get('donanimlar', r.donanim_id), 'Donanım bulunamadı');
  else if (table === 'ilan_ekspertiz') {
    text(r.firma, 1, 160);
    check(!Number.isNaN(Date.parse(r.tarih)), 'Rapor tarihi geçersiz');
    await file('ekspertiz', r.dosya, c.uid, r.ilan_id);
  } else if (table === 'favoriler')
    check(active(await s.get('ilanlar', r.ilan_id)), 'İlan bulunamadı');
  else if (table === 'takipler' || table === 'engeller') {
    const uid = r.satici_id || r.engellenen_id;
    check(uid !== c.uid && (await s.get('profil', uid)), 'Kullanıcı bulunamadı');
  } else if (table === 'aramalar') {
    text(r.ad, 1, 120);
    object(r.filtre);
    check(JSON.stringify(r.filtre).length <= 8000, 'Filtre çok uzun');
    for (const k of [
      'marka',
      'model',
      'yil',
      'min',
      'max',
      'yil_min',
      'yil_max',
      'km_max',
      'sayfa',
    ])
      if (r.filtre[k] != null && r.filtre[k] !== '')
        check(Number.isFinite(Number(r.filtre[k])), 'Arama filtresi geçersiz');
    if (r.filtre.detay) object(r.filtre.detay);
    if (r.filtre.donanim)
      check(
        Array.isArray(r.filtre.donanim) &&
          r.filtre.donanim.length <= 100 &&
          r.filtre.donanim.every((x) => Number.isInteger(Number(x))),
        'Donanım filtresi geçersiz',
      );
  } else if (table === 'bildirimler')
    check(typeof r.okundu === 'boolean', 'Bildirim tercihi geçersiz');
  else if (table === 'talepler') {
    text(r.baslik, 3, 160);
    text(r.metin, 3, 4000);
    if (r.butce != null) number(r.butce);
    check(['GBP', 'EUR', 'USD', 'TL'].includes(r.para_birimi), 'Para birimi geçersiz');
  } else if (table === 'sikayetler') {
    check(
      !!r.ilan_id !== !!r.mesaj_id &&
        ['sahte', 'kapora', 'fiyat', 'satilmis', 'diger'].includes(r.sebep),
      'Şikâyet hedefi geçersiz',
    );
    text(r.notu || '', 0, 2000);
    if (r.ilan_id) check(active(await s.get('ilanlar', r.ilan_id)), 'İlan bulunamadı');
    else {
      const m = await s.get('mesajlar', r.mesaj_id),
        k = m && (await s.get('konusmalar', m.konusma_id));
      check(
        k && [k.alici_id, k.satici_id].includes(c.uid) && m.gonderen_id !== c.uid,
        'Mesaj bulunamadı',
      );
    }
    check(
      !(await s.all('sikayetler', [['kullanici_id', '==', c.uid]])).some(
        (x) => x.id !== r.id && (r.ilan_id ? x.ilan_id === r.ilan_id : x.mesaj_id === r.mesaj_id),
      ),
      'Şikâyet zaten kaydedilmiş',
    );
  } else if (table === 'randevular') {
    text(r.ad, 2, 100);
    text(r.telefon, 7, 30);
    check(/^[+0-9 ()-]+$/.test(r.telefon), 'Telefon geçersiz');
    text(r.notu || '', 0, 2000);
    check(r.firma_id || r.ilan_id, 'Randevu hedefi gerekli');
    if (r.firma_id) {
      check(await s.get('firmalar', r.firma_id), 'Firma bulunamadı');
      check(
        typeof r.tarih === 'string' && Date.parse(r.tarih) > Date.now(),
        'Gelecek bir randevu tarihi seçin',
      );
    }
    if (r.ilan_id) check(active(await s.get('ilanlar', r.ilan_id)), 'İlan bulunamadı');
  } else if (table === 'iletisim') {
    text(r.konu, 2, 160);
    text(r.metin, 5, 4000);
  } else if (table === 'oneriler') {
    text(r.marka, 1, 100);
    text(r.model || '', 0, 100);
    check(
      [
        'otomobil',
        'suv',
        'motosiklet',
        'ticari',
        'minivan',
        'is_makinesi',
        'atv',
        'karavan',
        'deniz',
      ].includes(r.tip),
      'Araç türü geçersiz',
    );
  } else if (table === 'yorumlar') {
    number(r.puan, 1, 5);
    check(Number.isInteger(r.puan), 'Puan geçersiz');
    text(r.metin, 3, 2000);
    const f = await s.get('firmalar', r.firma_id);
    check(f, 'Firma bulunamadı');
    const conv = (await s.all('konusmalar')).filter(
      (x) =>
        [x.alici_id, x.satici_id].includes(c.uid) &&
        [x.alici_id, x.satici_id].includes(f.kullanici_id),
    );
    let sent = false;
    for (const k of conv)
      if (
        (await s.all('mesajlar', [['konusma_id', '==', k.id]])).some((x) => x.gonderen_id === c.uid)
      )
        sent = true;
    check(sent, 'Yorum için firmayla mesajlaşmış olmalısınız');
  }
}
async function relation(s, table, r, remove) {
  if (!['ilan_parca', 'ilan_donanim', 'ilan_ekspertiz'].includes(table)) return;
  const listing = await s.get('ilanlar', r.ilan_id);
  if (!listing) return;
  if (table === 'ilan_parca') {
    listing._parts = { ...listing._parts };
    if (remove) delete listing._parts[r.parca];
    else listing._parts[r.parca] = r.durum;
  }
  if (table === 'ilan_donanim')
    listing._equipment = remove
      ? (listing._equipment || []).filter((x) => !same(x, r.donanim_id))
      : [...new Set([...(listing._equipment || []), r.donanim_id])];
  if (table === 'ilan_ekspertiz') listing._report = !remove;
  s.put('ilanlar', listing.id, listing);
}
export async function write(s, c, q, file) {
  member(c);
  check(q.table === 'ilanlar' || allowed[q.table], 'Yazma erişimi kapalı', 403);
  check(['insert', 'upsert', 'update', 'delete'].includes(q.op), 'İşlem geçersiz');
  if (q.table === 'profil')
    check(q.op === 'update', 'Profil kaydı yalnız kayıt işlemiyle açılır', 403);
  if (['sikayetler', 'randevular', 'iletisim', 'oneriler', 'yorumlar'].includes(q.table))
    check(['insert', 'upsert'].includes(q.op), 'İşlem yetkisi yok', 403);
  if (q.table === 'bildirimler') check(q.op === 'update', 'İşlem yetkisi yok', 403);
  await rate(
    s,
    c.uid,
    q.table,
    q.table === 'ilanlar'
      ? 50
      : q.table === 'sikayetler'
        ? 3
        : ['iletisim', 'randevular', 'talepler', 'oneriler'].includes(q.table)
          ? 5
          : 30,
    ['sikayetler', 'randevular', 'iletisim', 'talepler', 'oneriler'].includes(q.table)
      ? JSON.stringify(q.value)
      : null,
  );
  const visibleRows = ['update', 'delete'].includes(q.op)
    ? (await read(s, c, { ...q, op: 'read', cols: '*', one: null, limit: 1000 })).data
    : [];
  const oldRows = await Promise.all(visibleRows.map((r) => s.get(q.table, primary(q.table, r))));
  if (['update', 'delete'].includes(q.op)) check(q.filters?.length, 'Hedef filtre gerekli');
  const values = ['insert', 'upsert'].includes(q.op)
    ? Array.isArray(q.value)
      ? q.value
      : [q.value]
    : oldRows;
  check(values.length <= 100, 'Tek işlemde en çok 100 kayıt');
  const result = [];
  for (const value of values) {
    const data = ['insert', 'upsert'].includes(q.op) ? value : q.value;
    if (q.table === 'ilanlar') {
      check(q.op !== 'delete', 'İlanı kalıcı silme işlemiyle kaldırın');
      const row = await saveListing(s, c, data, q.op === 'update' ? value : null, file);
      result.push(row);
      continue;
    }
    if (q.op !== 'delete') fields(data, allowed[q.table]);
    let row = ['insert', 'upsert'].includes(q.op)
      ? { id: id(), kullanici_id: c.uid, olusturma: now(), ...data }
      : { ...value, ...data };
    if (q.table === 'firmalar') row = { dogrulandi: false, one_cikan: false, bilgiler: {}, ...row };
    if (q.table === 'talepler') row = { aktif: true, para_birimi: 'GBP', ...row };
    if (['sikayetler', 'randevular', 'oneriler'].includes(q.table))
      row = { durum: 'beklemede', notu: '', ...row };
    if (q.table === 'favoriler') row = { fiyat_takibi: false, ...row };
    if (q.table === 'aramalar') row = { eposta: false, ...row };
    const key = primary(q.table, row);
    check(key, 'Kayıt anahtarı gerekli');
    const old = await s.get(q.table, key);
    if (old && q.op === 'upsert') row = { ...old, ...data };
    check(await owner(s, c, q.table, row), 'Kayıt yetkisi yok', 403);
    if (old) check(await owner(s, c, q.table, old), 'Kayıt yetkisi yok', 403);
    if (q.op === 'delete') {
      s.del(q.table, key);
      await relation(s, q.table, row, true);
      continue;
    }
    check(!old || ['update', 'upsert'].includes(q.op), 'Kayıt zaten var');
    if (old && q.ignoreDuplicates) continue;
    await validate(s, c, q.table, row, file);
    if (q.table === 'sikayetler') {
      if (row.ilan_id) {
        const reports = (await s.all('sikayetler', [['ilan_id', '==', row.ilan_id]])).filter(
          (x) => x.durum === 'beklemede',
        );
        if (reports.length >= 2) {
          const listing = await s.get('ilanlar', row.ilan_id);
          s.put('ilanlar', listing.id, { ...listing, gizli: true });
        }
      }
      for (const role of (await s.all('_yetkiler')).filter((x) => x.admin && !x.engelli))
        await notify(s, role.kullanici_id, 'sikayet', { sikayet_id: row.id });
    }
    if (q.table === 'randevular' && row.firma_id) {
      const firm = await s.get('firmalar', row.firma_id);
      await notify(s, firm.kullanici_id, 'randevu', { randevu_id: row.id });
    }
    s.put(q.table, key, row);
    await relation(s, q.table, row, false);
    if (['sikayetler', 'randevular', 'oneriler', 'firmalar'].includes(q.table))
      await audit(s, c, q.table, key, old, row);
    result.push(row);
  }
  const count = result.length;
  let output = result.map((r) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))),
  );
  if (q.cols && q.cols !== '*')
    output = output.map((r) =>
      Object.fromEntries(
        q.cols
          .split(',')
          .filter((k) => k in r)
          .map((k) => [k, r[k]]),
      ),
    );
  return { data: q.one ? output[0] || null : output, count, error: null };
}
