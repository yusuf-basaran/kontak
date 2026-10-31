import { Store, check, fields, member, now, audit } from './core.js';

async function batches(query, change) {
  for (;;) {
    const rows = await query.limit(200).get();
    if (rows.empty) return;
    const batch = query.firestore.batch();
    for (const row of rows.docs) change(batch, row);
    await batch.commit();
  }
}

function imagePath(value, bucket, uid) {
  try {
    const url = new URL(value);
    if (
      url.hostname !== 'firebasestorage.googleapis.com' ||
      !url.pathname.startsWith('/v0/b/' + bucket.name + '/o/')
    )
      return null;
    const path = decodeURIComponent(url.pathname.split('/o/')[1]);
    return path.startsWith('ilanlar/' + uid + '/') && !path.includes('..') ? path : null;
  } catch {
    return null;
  }
}

export async function purgeListing(db, bucket, key) {
  const ref = db.collection('_silinen_ilanlar').doc(key),
    task = (await ref.get()).data();
  if (!task) return;
  const uid = task.kullanici_id;
  const other = await db.collection('ilanlar').where('kullanici_id', '==', uid).get();
  const used = new Set(
    other.docs
      .filter((d) => d.id !== key)
      .flatMap((d) =>
        (d.data().fotograflar || []).map((url) => imagePath(url, bucket, uid)).filter(Boolean),
      ),
  );
  const files = new Set(task.fotograflar.map((url) => imagePath(url, bucket, uid)).filter(Boolean));
  for (const area of ['ilanlar', 'ekspertiz']) {
    const [rows] = await bucket.getFiles({ prefix: `${area}/${uid}/${key}/` });
    for (const file of rows) files.add(file.name);
  }
  for (const path of files)
    if (!used.has(path)) await bucket.file(path).delete({ ignoreNotFound: true });
  for (const area of ['ilanlar', 'ekspertiz']) {
    const prefix = `${area}/${uid}/${key}/`;
    await batches(
      db
        .collection('_dosyalar')
        .where('path', '>=', prefix)
        .where('path', '<', prefix + '\uf8ff'),
      (batch, row) => batch.delete(row.ref),
    );
  }
  await batches(db.collection('konusmalar').where('ilan_id', '==', key), (batch, row) =>
    batch.update(row.ref, { ilan_id: null }),
  );
  await batches(db.collection('bildirimler').where('veri.ilan_id', '==', key), (batch, row) => {
    batch.delete(row.ref);
    batch.delete(db.collection('_eposta').doc(row.id));
  });
  for (const name of [
    'ilan_parca',
    'ilan_donanim',
    'ilan_ekspertiz',
    'ilan_gecmis',
    'fiyat_gecmisi',
    'favoriler',
    'randevular',
    'sikayetler',
    '_foto',
    '_araclar',
    '_ziyaretler',
  ])
    await batches(db.collection(name).where('ilan_id', '==', key), (batch, row) =>
      batch.delete(row.ref),
    );
  for (const field of ['kayit', 'onceki.ilan_id', 'sonraki.ilan_id'])
    await batches(db.collection('islem_kaydi').where(field, '==', key), (batch, row) =>
      batch.delete(row.ref),
    );
  await db.runTransaction(async (tx) => {
    const s = new Store(db, tx);
    if (!(await s.get('_silinen_ilanlar', key))) return;
    for (const name of ['ilanlar', '_haklar', '_istatistik', '_silinen_ilanlar']) s.del(name, key);
    await audit(s, { uid }, 'ilanlar', key, { id: key }, null);
    s.flush();
  });
}

export async function deleteListing(db, bucket, c, p) {
  const uid = member(c);
  fields(p, ['p_ilan', 'p_onay']);
  check(p.p_onay === true, 'Kalıcı silme onayı gerekli');
  check(typeof p.p_ilan === 'string' && /^[a-f0-9-]{36}$/i.test(p.p_ilan), 'İlan adresi geçersiz');
  await db.runTransaction(async (tx) => {
    const s = new Store(db, tx),
      row = await s.get('ilanlar', p.p_ilan),
      task = await s.get('_silinen_ilanlar', p.p_ilan);
    check((row || task)?.kullanici_id === uid, 'İlan bulunamadı', 404);
    const lock = (await s.get('_kilitler', uid)) || { version: 0 };
    s.put('_kilitler', uid, { version: lock.version + 1 });
    if (!task) {
      s.put('_silinen_ilanlar', row.id, {
        ilan_id: row.id,
        kullanici_id: uid,
        fotograflar: row.fotograflar || [],
        olusturma: now(),
      });
      s.put('ilanlar', row.id, { ...row, durum: 'siliniyor', gizli: true, guncelleme: now() });
    }
    s.flush();
  });
  await purgeListing(db, bucket, p.p_ilan);
  return { id: p.p_ilan };
}

export async function pendingDeletions(db, bucket) {
  for (const row of (await db.collection('_silinen_ilanlar').get()).docs) {
    try {
      await purgeListing(db, bucket, row.id);
    } catch (error) {
      console.error('İlan silme tamamlanamadı', row.id, error.code || error.message);
    }
  }
}
