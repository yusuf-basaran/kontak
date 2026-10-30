export async function createClient() {
  if (globalThis.fixture.delay) await new Promise((r) => setTimeout(r, globalThis.fixture.delay));
  if (globalThis.fixture.failure) throw Error('Bağlantı kesildi');
  const { tables: T, me: ME, lex: L, guest } = globalThis.fixture;
  const record = (name, p) => (globalThis.calls ||= []).push({ name, p });
  const client = {
    projectId: 'demo-beta-car',
    auth: {
      getUser: async () => ({
        data: { user: guest ? null : { id: ME.id, email: 'uye@example.invalid' } },
      }),
      signOut: async () => ({}),
      signInWithPassword: async (p) => {
        record('signin', p);
        return globalThis.fixture.unverified
          ? { error: Error('E-posta adresinizi doğrulayın') }
          : { data: { user: ME } };
      },
      signUp: async (p) => {
        record('register', p);
        return { data: { user: ME, verification: 'link' } };
      },
      signInWithOAuth: async (p) => {
        record('oauth', p);
        if (globalThis.fixture.oauthDelay)
          await new Promise((r) => setTimeout(r, globalThis.fixture.oauthDelay));
        return globalThis.fixture.oauthError
          ? {
              error: Object.assign(Error('Giriş tamamlanamadı'), {
                code: globalThis.fixture.oauthError,
              }),
            }
          : {
              data: globalThis.fixture.oauthVerification ? { verification: 'link' } : { user: ME },
            };
      },
      resetPasswordForEmail: async (email, options) => {
        record('resetPassword', { email, options });
        return {};
      },
      updateUser: async () => ({}),
      verifyOtp: async () => ({}),
    },
    from(name) {
      let list = [...(T[name] || [])],
        one = false,
        op = 'read',
        value;
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          list = list.filter((r) => String(r[k]) === String(v));
          return q;
        },
        neq(k, v) {
          list = list.filter((r) => r[k] !== v);
          return q;
        },
        in(k, v) {
          list = list.filter((r) => v.includes(r[k]));
          return q;
        },
        or() {
          return q;
        },
        order() {
          return q;
        },
        limit(n) {
          list = list.slice(0, n);
          return q;
        },
        single() {
          one = true;
          return q;
        },
        maybeSingle() {
          one = true;
          return q;
        },
        insert(v) {
          op = 'insert';
          value = v;
          list = [{ id: crypto.randomUUID(), ...v }];
          return q;
        },
        update(v) {
          op = 'update';
          value = v;
          return q;
        },
        delete() {
          op = 'delete';
          return q;
        },
        upsert(v) {
          op = 'upsert';
          value = v;
          return q;
        },
        then(ok, bad) {
          if (op !== 'read') record(name + ':' + op, value);
          return Promise.resolve({
            data: one ? list[0] || null : list,
            count: list.length,
            error: null,
          }).then(ok, bad);
        },
      };
      return q;
    },
    rpc(name, p = {}) {
      record(name, p);
      let listings = T.ilan_kartlari.filter((c) => !p.p?.sehir || c.sehir === p.p.sehir);
      if (p.p?.q) {
        const norm = (s) =>
          String(s || '')
            .normalize('NFKD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');
        listings = listings.filter((c) =>
          norm([c.baslik, c.marka, c.model, c.no].join(' ')).includes(norm(p.p.q)),
        );
      }
      if (p.p?.sira === 'fiyat_artan') listings.sort((a, b) => a.fiyat - b.fiyat);
      if (p.p?.sira === 'fiyat_azalan') listings.sort((a, b) => b.fiyat - a.fiyat);
      const out = {
        baslangic: {
          cats: T.kategoriler,
          eqs: p.p_donanim ? T.donanimlar : [],
          lex: p.p_sozluk ? L : null,
          settings: { kurlar: { GBP: 1, EUR: 1.2 }, ...globalThis.fixture.settings },
        },
        ana_sayfa: {
          cars: T.ilan_kartlari,
          firms: T.firmalar.filter((f) => f.one_cikan),
          posts: T.yazilar.filter((f) => f.aktif).slice(0, 3),
          banners: T.bannerlar || [],
          counts: { kullanilmis: listings.length, sifir: 0, parca: 0, firma: 1 },
        },
        ilan_kaydet: { id: p.p_ilan || T.ilanlar[0].id, durum: p.p_yayin ? 'yayinda' : 'taslak' },
        istatistiklerim: (p.p_ilanlar || []).map((id) => ({
          id,
          goruntulenme: 4,
          favori: 2,
          mesaj: 1,
          telefon: 1,
        })),
        arac_sozlugu: L,
        genel_ayarlar: { kurlar: { GBP: 1, EUR: 1.2 } },
        profilim: ME,
        ana_akim: T.ilan_kartlari,
        arama_gecmis: [],
        model_ozeti: {
          adet: 8,
          medyan: 24000,
          ortalama: 24500,
          en_dusuk: 21000,
          en_yuksek: 28000,
          alt: 22000,
          ust: 26000,
          dagilim: [
            [0, 2],
            [1, 4],
            [4, 2],
          ],
        },
        sayaclar: { kullanilmis: listings.length, sifir: 0, parca: 0, firma: 1 },
        ilan_ara: { toplam: listings.length, ilanlar: listings },
        satici: { id: ME.id, ad: ME.ad, telefon: ME.telefon, firma: T.firmalar[0], yanit: 3600 },
        istatistik: { goruntulenme: 4, favori: 2, telefon: 1, mesaj: 1 },
        yetkim: true,
        iletisim_gonder: { id: 'contact-test' },
        banka_bilgisi: {
          iban: 'TEST-ACCOUNT',
          banka: 'Deneme Bankası',
          hesap_sahibi: 'Deneme Hesabı',
          tutar: 100,
          para_birimi: 'GBP',
          odeme_notu: '',
        },
        admin_veri:
          p.p_tablo === 'genel' ? { ilan: 1, uye: 2, mesaj: 3, talep: 1 } : T[p.p_tablo] || [],
        admin_talepler: T.paket_talepleri,
        foto_oturum: ME.id,
        foto_al: T.ilanlar[0].id,
        konusma_ac: T.konusmalar[0].id,
        kota: { id: T.ilanlar[0].id, durum: 'yayinda' },
      };
      if (name === 'ilan_sil' && !globalThis.fixture.rpcFailures?.includes(name)) {
        T.ilanlar = T.ilanlar.filter((c) => c.id !== p.p_ilan);
        T.ilan_kartlari = T.ilan_kartlari.filter((c) => c.id !== p.p_ilan);
        out.ilan_sil = { id: p.p_ilan };
      }
      const response = globalThis.fixture.rpcFailures?.includes(name)
        ? { data: null, error: Error('Bağlantı kesildi') }
        : { data: out[name] ?? true, error: null };
      return globalThis.fixture.rpcDelay?.[name]
        ? new Promise((resolve) =>
            setTimeout(() => resolve(response), globalThis.fixture.rpcDelay[name]),
          )
        : Promise.resolve(response);
    },
    storage: {
      from() {
        return {
          upload: async () => ({ data: { path: 'test.jpg' } }),
          getPublicUrl: () => ({ data: { publicUrl: '/assets/logo.webp' } }),
          createSignedUrl: async () => ({ data: { signedUrl: '/assets/logo.webp' } }),
        };
      },
    },
    channel() {
      const c = {
        on() {
          return c;
        },
        subscribe() {
          return c;
        },
      };
      return c;
    },
    removeChannel() {},
  };
  return client;
}
