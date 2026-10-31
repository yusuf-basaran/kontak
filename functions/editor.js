import { check, fields, member, same } from './core.js';
import { write, parts } from './write.js';
import { quota } from './listings.js';
import { historySave } from './history.js';

export async function saveEditor(s, c, p, file) {
  member(c);
  fields(p, [
    'p_ilan',
    'p_veri',
    'p_parcalar',
    'p_donanim',
    'p_rapor',
    'p_gecmis',
    'p_telefon',
    'p_tip',
    'p_yayin',
  ]);
  fields(p.p_parcalar, parts);
  check(
    Array.isArray(p.p_donanim) && p.p_donanim.length <= 100 && p.p_donanim.every(Number.isInteger),
    'Donanım seçimi geçersiz',
  );
  check(p.p_yayin === undefined || typeof p.p_yayin === 'boolean', 'Yayın seçimi geçersiz');
  const old = p.p_ilan ? await s.get('ilanlar', p.p_ilan) : null;
  check(!p.p_ilan || old?.kullanici_id === c.uid, 'İlan bulunamadı', 404);
  if (p.p_telefon) {
    const profile = await s.get('profil', c.uid);
    if (profile?.telefon !== p.p_telefon)
      await write(
        s,
        c,
        {
          table: 'profil',
          op: 'update',
          value: { telefon: p.p_telefon },
          filters: [['id', 'eq', c.uid]],
        },
        file,
      );
  }
  const result = await write(
    s,
    c,
    {
      table: 'ilanlar',
      op: old ? 'update' : 'insert',
      value: p.p_veri,
      filters: old ? [['id', 'eq', old.id]] : [],
    },
    file,
  );
  const listing = result.data[0],
    id = listing.id;
  const category = await s.get('kategoriler', listing.kategori_id);
  for (const equipment of p.p_donanim) {
    const row = await s.get('donanimlar', equipment);
    check(
      row && (!category.arac_tipi || row.arac_tipi.includes(category.arac_tipi)),
      'Donanım araç türüne uygun değil',
    );
  }
  const rows = {
    ilan_parca: Object.entries(p.p_parcalar).map(([parca, durum]) => ({
      ilan_id: id,
      parca,
      durum,
    })),
    ilan_donanim: [...new Set(p.p_donanim)].map((donanim_id) => ({ ilan_id: id, donanim_id })),
  };
  for (const [table, next] of Object.entries(rows)) {
    const key = table === 'ilan_parca' ? 'parca' : 'donanim_id';
    const previous = await s.all(table, [['ilan_id', '==', id]]);
    for (const row of previous)
      if (!next.some((n) => same(n[key], row[key])))
        await write(
          s,
          c,
          {
            table,
            op: 'delete',
            filters: [
              ['ilan_id', 'eq', id],
              [key, 'eq', row[key]],
            ],
          },
          file,
        );
    const changed = next.filter(
      (n) =>
        !previous.some(
          (r) => same(r[key], n[key]) && (table !== 'ilan_parca' || r.durum === n.durum),
        ),
    );
    if (changed.length) await write(s, c, { table, op: 'upsert', value: changed }, file);
  }
  if (p.p_rapor) {
    fields(p.p_rapor, ['dosya', 'firma', 'tarih']);
    await write(
      s,
      c,
      { table: 'ilan_ekspertiz', op: 'upsert', value: { ...p.p_rapor, ilan_id: id } },
      file,
    );
  }
  if (p.p_gecmis != null) await historySave(s, c, id, p.p_gecmis, file);
  if (listing.diger_marka || listing.diger_model) {
    const make = listing.marka_id && (await s.get('markalar', listing.marka_id));
    const suggestion = {
      tip: category.arac_tipi || p.p_tip,
      marka: listing.diger_marka || make?.ad,
      model: listing.diger_model || '',
    };
    const previous = await s.all('oneriler', [['kullanici_id', '==', c.uid]]);
    if (
      !previous.some(
        (r) =>
          r.tip === suggestion.tip && r.marka === suggestion.marka && r.model === suggestion.model,
      )
    )
      await write(s, c, { table: 'oneriler', op: 'insert', value: suggestion }, file);
  }
  return p.p_yayin && ['taslak', 'kaldirildi', 'suresi_doldu', 'reddedildi'].includes(listing.durum)
    ? quota(s, c, { p_ilan: id, p_islem: 'yayinla' })
    : { id, durum: listing.durum };
}
