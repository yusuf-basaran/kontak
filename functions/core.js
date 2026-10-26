import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

export const id = () => randomUUID();
export const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
export const now = () => new Date().toISOString();
export const days = (n, t = Date.now()) => new Date(t + n * 86400000).toISOString();
export const norm = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
export const same = (a, b) => String(a ?? '') === String(b ?? '');
export const warning = (s) => /kapora|ön\s*ödeme|on\s*odeme|iban|havale/i.test(s);
export const active = (r) =>
  !!r &&
  !r.gizli &&
  ((r.durum === 'yayinda' && Date.parse(r.bitis) > Date.now()) ||
    (r.durum === 'satildi' && Date.parse(r.satilma) > Date.now() - 7 * 86400000));
export const published = (r) => active(r) && r.durum === 'yayinda';
export function check(ok, message = 'Geçersiz işlem', status = 400) {
  if (!ok) throw Object.assign(Error(message), { status });
}
export function text(v, min = 0, max = 2000) {
  check(
    typeof v === 'string' && v.trim().length >= min && v.length <= max,
    'Metin uzunluğu geçersiz',
  );
  return v.trim();
}
export function number(v, min = 0, max = 1e12) {
  check(
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max,
    'Sayı aralığı geçersiz',
  );
  return v;
}
export function object(v) {
  check(v && !Array.isArray(v) && typeof v === 'object', 'Kayıt biçimi geçersiz');
  const visit = (x) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(visit);
    for (const [k, value] of Object.entries(x)) {
      check(!['__proto__', 'prototype', 'constructor'].includes(k), 'Alan adı geçersiz');
      visit(value);
    }
  };
  visit(v);
  return v;
}
export function fields(v, allowed) {
  object(v);
  check(
    Object.keys(v).every((k) => allowed.includes(k)),
    'Alan değiştirme yetkisi yok',
    403,
  );
  return v;
}
export const clean = (r) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
export function matches(r, filters = []) {
  return filters.every(([k, op, v]) =>
    op === 'eq'
      ? same(r[k], v)
      : op === 'neq'
        ? !same(r[k], v)
        : op === 'in' && Array.isArray(v) && v.some((x) => same(r[k], x)),
  );
}
export async function mapRows(rows, fn) {
  const out = [];
  for (let n = 0; n < rows.length; n += 16)
    out.push(...(await Promise.all(rows.slice(n, n + 16).map(fn))));
  return out;
}
export class Store {
  constructor(db, tx) {
    this.db = db;
    this.tx = tx;
    this.cache = new Map();
    this.writes = new Map();
    this.queries = new Map();
    this.reads = new Map();
  }
  ref(name, key) {
    check(
      /^[a-z_]+$/.test(name) && /^[a-zA-Z0-9_-]{1,180}$/.test(String(key)),
      'Kayıt adresi geçersiz',
    );
    return this.db.collection(name).doc(String(key));
  }
  async get(name, key) {
    const ref = this.ref(name, key);
    if (!this.cache.has(ref.path)) {
      if (!this.reads.has(ref.path))
        this.reads.set(
          ref.path,
          (this.tx ? this.tx.get(ref) : ref.get())
            .then((snap) => {
              if (!this.cache.has(ref.path))
                this.cache.set(ref.path, snap.exists ? snap.data() : null);
              return this.cache.get(ref.path);
            })
            .catch((error) => {
              this.reads.delete(ref.path);
              throw error;
            }),
        );
      return this.reads.get(ref.path);
    }
    return this.cache.get(ref.path);
  }
  async all(name, where = []) {
    let q = this.db.collection(name);
    for (const [k, op, v] of where) q = q.where(k, op, v);
    const queryKey = JSON.stringify([name, where]);
    if (!this.queries.has(queryKey)) this.queries.set(queryKey, this.tx ? this.tx.get(q) : q.get());
    const snap = await this.queries.get(queryKey);
    const rows = new Map();
    snap.docs.forEach((d) => {
      if (!this.cache.has(d.ref.path)) this.cache.set(d.ref.path, d.data());
      const r = this.cache.get(d.ref.path);
      if (r) rows.set(d.id, r);
    });
    for (const [path, r] of this.cache)
      if (path.split('/')[0] === name && this.writes.has(path)) {
        if (
          r &&
          where.every(([k, op, v]) =>
            op === '=='
              ? same(r[k], v)
              : op === 'array-contains' && Array.isArray(r[k]) && r[k].some((x) => same(x, v)),
          )
        )
          rows.set(path.split('/')[1], r);
        else rows.delete(path.split('/')[1]);
      }
    return [...rows.values()];
  }
  put(name, key, value) {
    const ref = this.ref(name, key);
    let r = { ...value };
    if (name === 'paket_talepleri') r._deadline = Timestamp.fromDate(new Date(r.son_odeme || 0));
    if (name === 'yazilar')
      r = { ...r, _publish: Timestamp.fromDate(new Date(r.yayin || Date.now())) };
    if (name === 'ilanlar')
      r = {
        ...r,
        _public: active(r),
        _expires: Timestamp.fromDate(
          new Date(r.durum === 'satildi' ? days(7, Date.parse(r.satilma)) : r.bitis || 0),
        ),
      };
    this.cache.set(ref.path, r);
    this.writes.set(ref.path, { ref, value: r });
    return r;
  }
  del(name, key) {
    const ref = this.ref(name, key);
    this.cache.set(ref.path, null);
    this.writes.set(ref.path, { ref, value: null });
  }
  async seq(name) {
    const r = (await this.get('_sayaclar', name)) || { n: 0 };
    this.put('_sayaclar', name, { n: r.n + 1 });
    return r.n + 1;
  }
  flush() {
    check(this.tx || this.writes.size === 0, 'İşlem oturumu gerekli', 500);
    check(this.writes.size <= 450, 'İşlem en çok 450 kaydı değiştirebilir');
    for (const { ref, value } of this.writes.values()) {
      if (value) this.tx.set(ref, value);
      else this.tx.delete(ref);
    }
  }
}
export async function rate(s, uid, area, limit, fingerprint) {
  const key = hash(uid + ':' + area),
    t = Date.now();
  const r = (await s.get('_hiz', key)) || {};
  const minute = (r.minute || []).filter((x) => x > t - 60000);
  const daily = r.day === new Date(t).toISOString().slice(0, 10) ? r.daily || 0 : 0;
  check(
    minute.length < limit &&
      daily < (area === 'iletisim' ? 20 : area === 'mesaj' ? 500 : area === 'api' ? 20000 : 1000),
    'İşlem sınırı; daha sonra tekrar deneyin',
    429,
  );
  const repeats = Object.fromEntries(
    Object.entries(r.repeats || {}).filter(([, v]) => v > t - 300000),
  );
  if (fingerprint) {
    const f = hash(fingerprint);
    check(!repeats[f], 'Aynı işlem kısa aralıklarla tekrarlanamaz', 429);
    repeats[f] = t;
  }
  s.put('_hiz', key, {
    minute: [...minute, t],
    daily: daily + 1,
    day: new Date(t).toISOString().slice(0, 10),
    repeats,
    expires: days(2),
  });
}
export async function setting(s, name, fallback) {
  return (await s.get('ayarlar', name))?.deger ?? fallback;
}
export async function audit(s, c, name, key, before, after) {
  const keyId = id();
  s.put('islem_kaydi', keyId, {
    id: keyId,
    kullanici_id: c.uid || null,
    tablo: name,
    kayit: String(key),
    islem: !before ? 'INSERT' : !after ? 'DELETE' : 'UPDATE',
    onceki: before || null,
    sonraki: after || null,
    tarih: now(),
  });
}
export async function notify(s, uid, type, data = {}, unique = id(), email = true) {
  const key = hash(uid + ':' + unique);
  if (await s.get('bildirimler', key)) return;
  s.put('bildirimler', key, {
    id: key,
    kullanici_id: uid,
    tur: type,
    veri: data,
    okundu: false,
    olusturma: now(),
  });
  const p = await s.get('profil', uid);
  if (email && p?.eposta_ozet)
    s.put('_eposta', key, {
      id: key,
      kullanici_id: uid,
      tur: type,
      durum: 'beklemede',
      deneme: 0,
      olusturma: now(),
      son_deneme: null,
    });
}
export const admin = (c) => check(c.admin, 'Yönetici yetkisi gerekli', 403);
export const member = (c) => {
  check(c.uid && c.verified && !c.blocked, 'Doğrulanmış hesapla giriş yapın', 403);
  return c.uid;
};
