import { active, audit, check, fields, member, now, number, rate, text } from './core.js';

const uuid = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
function date(v) {
  check(
    typeof v === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      v >= '1900-01-01' &&
      v <= now().slice(0, 10) &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    'Kayıt tarihi geçersiz',
  );
  return v;
}
export async function historyRead(s, c, key) {
  check(uuid(key), 'İlan adresi geçersiz');
  const listing = await s.get('ilanlar', key);
  check(
    listing && (active(listing) || c.admin || listing.kullanici_id === c.uid),
    'İlan bulunamadı',
    404,
  );
  return (await s.get('ilan_gecmis', key)) || { belgeler: [], kilometre: [] };
}
export async function historySave(s, c, key, value, file) {
  member(c);
  fields(value, ['belgeler', 'kilometre', 'yayin_onayi']);
  const listing = await s.get('ilanlar', key);
  check(listing?.kullanici_id === c.uid && listing.durum !== 'siliniyor', 'İlan yetkisi yok', 403);
  check(Array.isArray(value.belgeler) && value.belgeler.length <= 5, 'En çok 5 belge eklenebilir');
  check(
    Array.isArray(value.kilometre) && value.kilometre.length <= 30,
    'En çok 30 kilometre kaydı eklenebilir',
  );
  check(
    typeof value.yayin_onayi === 'boolean' && (!value.belgeler.length || value.yayin_onayi),
    'Belge paylaşım onayı gerekli',
  );
  const belgeler = [],
    ids = new Set(),
    paths = new Set();
  for (const row of value.belgeler) {
    fields(row, ['id', 'ad', 'tur', 'tarih', 'dosya']);
    check(uuid(row.id) && !ids.has(row.id), 'Belge kimliği geçersiz');
    check(
      ['ekspertiz', 'acik_artirma', 'bakim', 'muayene', 'diger'].includes(row.tur),
      'Belge türü geçersiz',
    );
    check(
      typeof row.dosya === 'string' && !row.dosya.startsWith('https:') && !paths.has(row.dosya),
      'Belge yolu geçersiz',
    );
    await file('ekspertiz', row.dosya, c.uid, key);
    belgeler.push({
      id: row.id,
      ad: text(row.ad, 2, 100),
      tur: row.tur,
      tarih: date(row.tarih),
      dosya: row.dosya,
    });
    ids.add(row.id);
    paths.add(row.dosya);
  }
  const dates = new Set(),
    kilometre = value.kilometre
      .map((row) => {
        fields(row, ['tarih', 'km', 'belge_id']);
        const tarih = date(row.tarih),
          km = number(row.km, 0, 2000000);
        check(
          Number.isInteger(km) && !dates.has(tarih),
          'Kilometre kaydı geçersiz; her tarih bir kez girilebilir',
        );
        check(row.belge_id === null || ids.has(row.belge_id), 'Kaynak belge bulunamadı');
        dates.add(tarih);
        return { tarih, km, belge_id: row.belge_id };
      })
      .sort((a, b) => a.tarih.localeCompare(b.tarih));
  const old = await s.get('ilan_gecmis', key);
  if (
    old &&
    JSON.stringify([old.belgeler, old.kilometre, old.yayin_onayi]) ===
      JSON.stringify([belgeler, kilometre, value.yayin_onayi])
  )
    return;
  await rate(s, c.uid, 'ilan_gecmis', 20);
  const row = {
    ilan_id: key,
    belgeler,
    kilometre,
    yayin_onayi: value.yayin_onayi,
    guncelleme: now(),
  };
  s.put('ilan_gecmis', key, row);
  await audit(s, c, 'ilan_gecmis', key, old, row);
}
