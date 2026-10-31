import {
  Store,
  check,
  member,
  object,
  fields,
  text,
  now,
  days,
  id,
  hash,
  same,
  active,
  published,
  mapRows,
  setting,
  rate,
  notify,
} from './core.js';
import { saveEditor } from './editor.js';
import { historyRead } from './history.js';
import { deleteListing } from './deletion.js';
import { read, search, statistics } from './data.js';
import { write, primary } from './write.js';
import { packages } from './packages.js';
import { quota, photos, saveListing } from './listings.js';
import { conversation, seller } from './messages.js';
import { adminData, adminWrite, approve, merge } from './admin.js';

const readonly = [
  'arac_gecmisi',
  'baslangic',
  'ana_sayfa',
  'arac_sozlugu',
  'genel_ayarlar',
  'sayaclar',
  'ana_akim',
  'ilan_ara',
  'ilan_durum',
  'satici',
  'model_ozeti',
  'istatistiklerim',
  'profilim',
  'yetkim',
  'admin_veri',
  'admin_talepler',
  'banka_bilgisi',
];
export function createService({ db, auth, bucket }) {
  let catalogue, references;
  async function context(user) {
    if (!user) return { uid: null, verified: false, admin: false };
    const role = (await db.collection('_yetkiler').doc(user.uid).get()).data();
    check(!user.disabled && !role?.engelli, 'Hesap erişimi kapalı', 403);
    return {
      uid: user.uid,
      verified: !!user.emailVerified,
      phone: user.phoneNumber || null,
      admin: !!role?.admin && !!user.emailVerified,
    };
  }
  async function file(bucketName, path, uid, parent) {
    check(
      ['dekontlar', 'ekspertiz', 'ilanlar', 'firmalar'].includes(bucketName),
      'Dosya alanı geçersiz',
    );
    let name = path;
    check(typeof name === 'string' && name.length <= 3000, 'Dosya yolu geçersiz');
    if (name.startsWith('https://')) {
      const url = new URL(name);
      check(
        url.hostname === 'firebasestorage.googleapis.com' &&
          url.pathname.startsWith('/v0/b/' + bucket.name + '/o/'),
        'Dosya kaynağı geçersiz',
      );
      name = decodeURIComponent(url.pathname.split('/o/')[1]);
      check(name.startsWith(bucketName + '/'), 'Dosya alanı geçersiz');
      name = name.slice(bucketName.length + 1);
    }
    check(
      name.startsWith(uid + '/') &&
        (!parent || name.startsWith(uid + '/' + parent + '/')) &&
        !name.includes('..'),
      'Dosya size ait değil',
      403,
    );
    const target = bucket.file(bucketName + '/' + name);
    const [exists] = await target.exists();
    check(exists, 'Dosya bulunamadı');
    const [meta] = await target.getMetadata();
    const images = ['image/jpeg', 'image/png', 'image/webp'];
    const types = ['dekontlar', 'ekspertiz'].includes(bucketName)
      ? ['application/pdf', 'image/jpeg', 'image/png']
      : images;
    check(
      Number(meta.size) <= (['dekontlar', 'firmalar'].includes(bucketName) ? 5242880 : 10485760) &&
        types.includes(meta.contentType),
      'Dosya türü veya boyutu geçersiz',
    );
    return target;
  }
  async function dispatch(s, c, name, p) {
    if (name === 'iletisim_gonder') {
      fields(p, ['ad', 'eposta', 'konu', 'metin', 'website_check']);
      check(p.website_check === '', 'Geçersiz işlem');
      const row = {
        id: id(),
        kullanici_id: c.uid,
        ad: text(p.ad, 2, 100),
        eposta: text(p.eposta, 5, 254).toLowerCase(),
        konu: text(p.konu, 2, 140),
        metin: text(p.metin, 5, 4000),
        olusturma: now(),
      };
      check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.eposta), 'E-posta adresi geçersiz');
      check(c.clientId || c.uid, 'İstek kaynağı gerekli', 403);
      const fingerprint = JSON.stringify([row.eposta, row.konu, row.metin]);
      await rate(s, c.clientId || c.uid, 'iletisim', 5, fingerprint);
      if (c.uid && c.clientId) await rate(s, c.uid, 'iletisim', 5, fingerprint);
      s.put('iletisim', row.id, row);
      for (const role of (await s.all('_yetkiler')).filter((r) => r.admin && !r.engelli))
        await notify(s, role.kullanici_id, 'iletisim', { iletisim_id: row.id }, row.id, false);
      return { id: row.id };
    }
    if (name === 'arac_gecmisi') {
      fields(p, ['p_ilan']);
      return historyRead(s, c, p.p_ilan);
    }
    if (name === 'ilan_kaydet') return saveEditor(s, c, p, file);
    if (name === 'profil_kaydet') {
      check(c.uid, 'Giriş yapın', 401);
      fields(p, ['ad', 'tip']);
      if (await s.get('profil', c.uid)) return null;
      const profile = {
        id: c.uid,
        ad: text(p.ad, 1, 100),
        tip: p.tip || 'bireysel',
        telefon: null,
        sehir: null,
        eposta_ozet: true,
        telefon_goster: true,
        dogrulandi: false,
        olusturma: now(),
      };
      check(['bireysel', 'kurumsal'].includes(profile.tip), 'Hesap türü geçersiz');
      s.put('profil', c.uid, profile);
      if (!(await s.get('_yetkiler', c.uid)))
        s.put('_yetkiler', c.uid, { kullanici_id: c.uid, admin: false, engelli: false });
      return null;
    }
    if (name === 'baslangic') {
      fields(p, ['p_sozluk', 'p_donanim']);
      check(typeof p.p_sozluk === 'boolean' && typeof p.p_donanim === 'boolean');
      if (!references || references.until < Date.now())
        references = {
          until: Date.now() + 60000,
          data: Promise.all([
            read(
              s,
              { uid: null, admin: false },
              { table: 'kategoriler', op: 'read', order: [['sira', true]] },
            ),
            read(s, { uid: null, admin: false }, { table: 'donanimlar', op: 'read' }),
            dispatch(s, c, 'genel_ayarlar', {}),
          ]),
        };
      try {
        const [[cats, eqs, settings], lex] = await Promise.all([
          references.data,
          p.p_sozluk ? dispatch(s, c, 'arac_sozlugu', {}) : null,
        ]);
        return { cats: cats.data, eqs: p.p_donanim ? eqs.data : [], settings, lex };
      } catch (error) {
        references = null;
        throw error;
      }
    }

    if (name === 'ana_sayfa') {
      fields(p, ['p_son']);
      check(Array.isArray(p.p_son) && p.p_son.length <= 10);
      const [cars, firms, posts, banners, counts] = await Promise.all([
        dispatch(s, c, 'ana_akim', p),
        read(s, c, {
          table: 'firmalar',
          op: 'read',
          filters: [['one_cikan', 'eq', true]],
          limit: 12,
        }),
        read(s, c, {
          table: 'yazilar',
          op: 'read',
          filters: [['aktif', 'eq', true]],
          order: [['yayin', false]],
          limit: 3,
        }),
        read(s, c, { table: 'bannerlar', op: 'read', filters: [['aktif', 'eq', true]] }),
        dispatch(s, c, 'sayaclar', {}),
      ]);
      return { cars, firms: firms.data, posts: posts.data, banners: banners.data, counts };
    }
    if (name === 'arac_sozlugu') {
      if (!catalogue || catalogue.until < Date.now())
        catalogue = {
          until: Date.now() + 300000,
          data: (async () => {
            const snapshot = await s.get('_katalog', 'aktif');
            if (snapshot?.aktif) {
              const rows = await Promise.all(snapshot.parcalar.map((k) => s.get('_katalog', k)));
              if (rows.every(Boolean)) {
                const lex = { markalar: [], modeller: [], surum: snapshot.surum };
                for (const row of rows) lex[row.tur].push(...JSON.parse(row.veri));
                return lex;
              }
            }
            const [makes, models] = await Promise.all([s.all('markalar'), s.all('modeller')]);
            return {
              markalar: makes.map((m) => [m.id, m.ad, m.tip]),
              modeller: models.map((m) => [
                m.id,
                m.marka_id,
                m.ad,
                m.bas_yil ?? null,
                m.bit_yil ?? null,
              ]),
            };
          })(),
        };
      try {
        return await catalogue.data;
      } catch (error) {
        catalogue = null;
        throw error;
      }
    }
    if (name === 'genel_ayarlar') {
      const out = {};
      await Promise.all(
        ['kurlar', 'sosyal', 'iletisim_telefon', 'sms_zorunlu', 'giris_saglayicilari'].map(
          async (k) => {
            out[k] = await setting(
              s,
              k,
              k === 'sms_zorunlu'
                ? false
                : k === 'giris_saglayicilari'
                  ? []
                  : k === 'iletisim_telefon'
                    ? ''
                    : {},
            );
          },
        ),
      );
      return out;
    }
    if (name === 'profilim') {
      member(c);
      return await s.get('profil', c.uid);
    }
    if (name === 'yetkim') return c.admin;
    if (name === 'ilan_ara') return search(s, c, p.p || {});
    if (name === 'satici') return seller(s, c, p.p_id);
    if (name === 'model_ozeti') {
      const rows = (await s.all('ilanlar', [['model_id', '==', p.p_model]])).filter(
        (r) =>
          published(r) &&
          r.para_birimi === (p.p_para || 'GBP') &&
          (!p.p_yil || Math.abs(r.yil - p.p_yil) <= 1) &&
          (!p.p_km || Math.abs(r.km - p.p_km) <= 30000) &&
          (!p.p_yakit || r.yakit === p.p_yakit) &&
          (!p.p_vites || r.vites === p.p_vites),
      );
      return statistics(rows);
    }
    if (name === 'ilan_durum') {
      const r = (await s.all('ilanlar', [['no', '==', Number(p.p_no)]]))[0];
      return r &&
        (r.kullanici_id === c.uid ||
          c.admin ||
          (r.yayin &&
            ['yayinda', 'satildi', 'kaldirildi', 'suresi_doldu', 'arsiv'].includes(r.durum)))
        ? { id: r.id, no: r.no, durum: r.gizli ? 'kaldirildi' : r.durum }
        : null;
    }
    if (name === 'sayaclar') {
      const rows = (await s.all('ilanlar')).filter(published),
        cats = await s.all('kategoriler'),
        result = { kullanilmis: 0, sifir: 0, parca: 0, firma: (await s.all('firmalar')).length };
      for (const r of rows) {
        const cat = cats.find((k) => same(k.id, r.kategori_id));
        if (cat)
          for (const key of ['kullanilmis', 'sifir', 'parca'])
            if (cat.slug.startsWith(key)) result[key]++;
      }
      return result;
    }
    if (name === 'ana_akim') {
      const r = await search(s, c, { sayfa: 1 });
      const wanted = new Set([...(p.p_son || []), ...r.ilanlar.map((x) => x.id)]);
      const publicRows = (await s.all('ilanlar')).filter(
        (x) => published(x) && (wanted.has(x.id) || Date.parse(x.onecikarma_bitis) > Date.now()),
      );
      const { card } = await import('./data.js');
      return Promise.all(publicRows.slice(0, 100).map((x) => card(s, x, c)));
    }
    if (['talep_ac', 'talep_isle', 'dekont_ekle', 'banka_bilgisi'].includes(name))
      return packages(s, c, name, p, file);
    if (name === 'kota') return quota(s, c, p);
    if (['foto_al', 'foto_oturum', 'foto_ekle'].includes(name)) return photos(s, c, name, p, file);
    if (['konusma_ac', 'mesaj_yaz', 'okundu'].includes(name)) return conversation(s, c, name, p);
    if (name === 'admin_veri') return adminData(s, c, p.p_tablo);
    if (name === 'admin_talepler') return adminData(s, c, 'paket_talepleri');
    if (['yonet', 'admin_duzenle'].includes(name)) return adminWrite(s, c, p);
    if (name === 'oneri_onayla') return approve(s, c, p);
    if (name === 'birlestir') return merge(s, c, p);
    if (name === 'arama_gecmis') {
      member(c);
      let rows = (await s.get('_aramalar', c.uid))?.rows || [];
      if (p.p_sorgu) {
        text(p.p_sorgu, 1, 4000);
        rows = [
          { query: p.p_sorgu, time: Date.now() },
          ...rows.filter((r) => r.query !== p.p_sorgu),
        ].slice(0, 10);
        s.put('_aramalar', c.uid, { rows });
      }
      return rows;
    }
    if (name === 'ilan_kopyala') {
      member(c);
      const original = await s.get('ilanlar', p.p_ilan);
      check(original?.kullanici_id === c.uid && original.durum !== 'siliniyor', 'İlan bulunamadı');
      const data = Object.fromEntries(
        [
          'kategori_id',
          'marka_id',
          'model_id',
          'diger_marka',
          'diger_model',
          'baslik',
          'aciklama',
          'yil',
          'km',
          'fiyat',
          'para_birimi',
          'yakit',
          'vites',
          'sehir',
          'detay',
          'fotograflar',
          'video',
        ].map((k) => [k, original[k] ?? null]),
      );
      data.detay = { ...original.detay };
      delete data.detay.sasi;
      delete data.detay.plaka_no;
      const copy = await saveListing(s, c, data, null, file);
      for (const table of ['ilan_parca', 'ilan_donanim'])
        for (const r of await s.all(table, [['ilan_id', '==', original.id]])) {
          const next = { ...r, ilan_id: copy.id };
          s.put(table, primary(table, next), next);
        }
      s.put('ilanlar', copy.id, {
        ...copy,
        _parts: original._parts || {},
        _equipment: original._equipment || [],
      });
      return copy.id;
    }
    if (name === 'istatistiklerim') {
      member(c);
      fields(p, ['p_ilanlar']);
      check(Array.isArray(p.p_ilanlar) && p.p_ilanlar.length <= 100, 'En çok 100 ilan seçilebilir');
      return mapRows([...new Set(p.p_ilanlar)], async (id) => {
        const listing = await s.get('ilanlar', id);
        check(listing?.kullanici_id === c.uid, 'İlan yetkisi yok', 403);
        return { id, ...(await dispatch(s, c, 'istatistik', { p_ilan: id })) };
      });
    }
    if (name === 'istatistik') {
      const listing = await s.get('ilanlar', p.p_ilan);
      check(
        listing && (active(listing) || listing.kullanici_id === c.uid || c.admin),
        'İlan bulunamadı',
      );
      let stats = (await s.get('_istatistik', listing.id)) || { goruntulenme: 0, telefon: 0 };
      if (
        ['goruntulenme', 'telefon'].includes(p.p_tur) &&
        typeof p.p_kim === 'string' &&
        p.p_kim.length >= 16 &&
        p.p_kim.length <= 100
      ) {
        const key = hash(listing.id + ':' + p.p_kim + ':' + p.p_tur + ':' + now().slice(0, 10));
        if (!(await s.get('_ziyaretler', key))) {
          s.put('_ziyaretler', key, { ilan_id: listing.id, expires: days(30) });
          stats = { ...stats, [p.p_tur]: stats[p.p_tur] + 1 };
          s.put('_istatistik', listing.id, stats);
        }
      }
      const out = {
        goruntulenme: stats.goruntulenme,
        favori: (await s.all('favoriler', [['ilan_id', '==', listing.id]])).length,
      };
      if (c.admin || c.uid === listing.kullanici_id) {
        out.telefon = stats.telefon;
        out.mesaj = (await s.all('konusmalar', [['ilan_id', '==', listing.id]])).length;
      }
      return out;
    }
    if (name === 'dosya_url' || name === 'gecmis_dosya') {
      const historyFile = name === 'gecmis_dosya';
      let fileName, bucketName;
      if (historyFile) {
        fields(p, ['p_ilan', 'p_belge']);
        const history = await historyRead(s, c, p.p_ilan);
        const document = history.belgeler.find((r) => r.id === p.p_belge);
        check(document, 'Belge bulunamadı', 404);
        fileName = document.dosya;
        bucketName = 'ekspertiz';
      } else {
        fileName = text(p.file, 1, 600);
        bucketName = p.bucket;
      }
      let uid = c.uid,
        parent;
      if (bucketName === 'dekontlar') {
        member(c);
        const r = (await s.all('paket_talepleri', [['dekont_dosya', '==', fileName]]))[0];
        check(r && (c.admin || r.kullanici_id === c.uid), 'Dekont erişimi yok', 403);
        uid = r.kullanici_id;
        parent = r.id;
      } else if (bucketName === 'ekspertiz') {
        const r = historyFile
            ? { ilan_id: p.p_ilan }
            : (await s.all('ilan_ekspertiz', [['dosya', '==', fileName]]))[0],
          listing = r && (await s.get('ilanlar', r.ilan_id));
        check(
          listing && (active(listing) || c.admin || listing.kullanici_id === c.uid),
          'Rapor erişimi yok',
          403,
        );
        uid = listing.kullanici_id;
        parent = listing.id;
      } else check(false, 'Özel dosya alanı geçersiz');
      const target = await file(bucketName, fileName, uid, parent);
      const token = hash(id() + id());
      s.put('_dosyalar', hash(token), { path: target.name, expires: Date.now() + 120000 });
      return '/api/dosya?token=' + token;
    }
    if (name === 'hesap_sil') {
      member(c);
      for (const row of await s.all('ilanlar', [['kullanici_id', '==', c.uid]]))
        s.put('ilanlar', row.id, {
          ...row,
          durum: 'arsiv',
          baslik: 'Kapatılan hesap',
          aciklama: '',
          fotograflar: [],
          detay: {},
        });
      const profile = await s.get('profil', c.uid);
      s.put('profil', c.uid, {
        ...profile,
        ad: 'Kapatılan hesap',
        telefon: null,
        sehir: null,
        eposta_ozet: false,
      });
      const role = await s.get('_yetkiler', c.uid);
      s.put('_yetkiler', c.uid, { ...role, kullanici_id: c.uid, engelli: true });
      return null;
    }
    check(false, 'İşlem bulunamadı', 404);
  }
  return {
    context,
    async execute(body, user, clientId) {
      object(body);
      const c = await context(user),
        p = body.data || {};
      c.clientId = clientId;
      object(p);
      if (!body.query && body.name === 'ilan_sil')
        return { data: await deleteListing(db, bucket, c, p), error: null };
      const isRead = body.query ? body.query.op === 'read' : readonly.includes(body.name);
      if (isRead) {
        const s = new Store(db);
        if (body.query?.table === 'piyasa_fiyatlari') {
          const all = (await s.all('ilanlar')).filter(published),
            groups = {};
          for (const r of all) {
            const key = [r.marka_id, r.model_id, r.yil, r.para_birimi].join(':');
            (groups[key] ||= []).push(r);
          }
          const rows = Object.values(groups).map((rows) => ({
            ...statistics(rows),
            marka_id: rows[0].marka_id,
            model_id: rows[0].model_id,
            yil: rows[0].yil,
            para_birimi: rows[0].para_birimi,
          }));
          const { matches } = await import('./core.js');
          return { data: rows.filter((r) => matches(r, body.query.filters)), error: null };
        }
        return body.query
          ? read(s, c, body.query)
          : { data: await dispatch(s, c, body.name, p), error: null };
      }
      const result = await db.runTransaction(async (tx) => {
        const s = new Store(db, tx);
        if (c.uid) {
          const lock = (await s.get('_kilitler', c.uid)) || { version: 0 };
          s.put('_kilitler', c.uid, { version: lock.version + 1 });
        }
        const result = body.query
          ? await write(s, c, body.query, file)
          : { data: await dispatch(s, c, body.name, p), error: null };
        s.flush();
        return result;
      });
      if (
        ['oneri_onayla', 'birlestir'].includes(body.name) ||
        (['yonet', 'admin_duzenle'].includes(body.name) &&
          ['markalar', 'modeller'].includes(p.p_tablo))
      ) {
        catalogue = null;
        await db.collection('_katalog').doc('aktif').set({ aktif: false }, { merge: true });
      }
      if (['yonet', 'admin_duzenle'].includes(body.name)) references = null;
      if (body.name === 'hesap_sil') {
        await auth.revokeRefreshTokens(c.uid);
        await auth.updateUser(c.uid, { disabled: true });
      }
      return result;
    },
  };
}
