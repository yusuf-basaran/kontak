import { render } from './js/navigation.js';
import { cfg } from './js/config.js';
import { state } from './js/state.js';
import { read, write } from './js/utils.js';
import { $, notify } from './js/ui.js';
import { t } from './js/i18n.js';
import { query, rpc, table } from './js/api.js';
import { load } from './js/pages/home.js';
import { createClient } from './js/firebase.js';

async function start() {
  if (document.body.dataset.page === '404') {
    state.phase = 'ready';
    render();
    return;
  }
  render();
  try {
    state.db = await createClient(cfg);
    if (!state.db) {
      state.phase = 'unconfigured';
      render();
      return;
    }
    const { data } = await state.db.auth.getUser();
    state.user = data?.user;
    const page = document.body.dataset.page;
    if (!state.user && ['account', 'editor', 'photos', 'messages', 'admin'].includes(page)) {
      state.phase = 'ready';
      render();
      return;
    }
    const references = async () => {
      const vehicles = ['home', 'list', 'editor', 'valuation', 'model', 'wanted'].includes(page);
      let cached, refs;
      if (vehicles) {
        try {
          cached = JSON.parse(sessionStorage.getItem('bc-vehicles') || 'null');
        } catch {}
      }
      if (
        cached?.url === state.db.projectId &&
        cached.schema === 2 &&
        Date.now() - cached.time < 300000
      )
        state.lex = cached.data;
      else cached = null;
      const equipment = ['list', 'editor', 'detail', 'compare'].includes(page);
      try {
        refs = JSON.parse(sessionStorage.getItem('bc-references') || 'null');
      } catch {}
      if (refs?.url !== state.db.projectId || refs.schema !== 2 || Date.now() - refs.time >= 60000)
        refs = null;
      if (refs && (!equipment || refs.equipment) && (!vehicles || cached)) {
        state.cats = refs.cats;
        state.eqs = equipment ? refs.eqs : [];
        state.settings = refs.settings;
        return;
      }
      const data = await rpc('baslangic', { p_sozluk: vehicles && !cached, p_donanim: equipment });
      try {
        sessionStorage.setItem(
          'bc-references',
          JSON.stringify({
            url: state.db.projectId,
            schema: 2,
            time: Date.now(),
            cats: data.cats,
            eqs: equipment ? data.eqs : refs?.eqs || [],
            equipment: equipment || refs?.equipment || false,
            settings: data.settings,
          }),
        );
      } catch {}
      state.cats = data.cats;
      state.eqs = data.eqs;
      state.settings = data.settings;
      if (data.lex) {
        state.lex = data.lex;
        try {
          sessionStorage.setItem(
            'bc-vehicles',
            JSON.stringify({
              url: state.db.projectId,
              schema: 2,
              time: Date.now(),
              data: state.lex,
            }),
          );
        } catch {}
      }
    };
    const favorites = async () => {
      if (!state.user) return;
      const favs = read('bc-favs');
      if (favs.length) {
        const r = await state.db.from('favoriler').upsert(
          favs.map((id) => ({ kullanici_id: state.user.id, ilan_id: id, fiyat_takibi: true })),
          { onConflict: 'kullanici_id,ilan_id', ignoreDuplicates: true },
        );
        if (r.error) notify(t('error'));
      }
      const r = await state.db
        .from('favoriler')
        .select('ilan_id')
        .eq('kullanici_id', state.user.id);
      if (!r.error)
        write(
          'bc-favs',
          r.data.map((f) => f.ilan_id),
        );
    };
    const profile = async () => {
      if (!state.user) return;
      state.me = await rpc('profilim');
      if (!state.me) {
        await rpc('profil_kaydet', {
          ad: state.user.email?.split('@')[0]?.slice(0, 100) || t('name'),
          tip: 'bireysel',
        });
        state.me = await rpc('profilim');
      }
      const pending = read('bc-company', null);
      if (pending && pending.email?.toLowerCase() === state.user.email?.toLowerCase()) {
        let firm = await query(table('firmalar').eq('kullanici_id', state.user.id).maybeSingle());
        if (!firm)
          firm = await query(
            state.db
              .from('firmalar')
              .insert({ kullanici_id: state.user.id, ad: pending.ad, tur: pending.tur })
              .select()
              .single(),
          );
        await query(
          state.db.from('firma_ozel').upsert({ firma_id: firm.id, vergi: pending.vergi }),
        );
        write('bc-company', null);
      }
    };
    await Promise.all([references(), favorites(), profile(), page === 'home' ? load(false) : null]);
    state.phase = 'ready';
    render();
    if (state.user) {
      const refresh = async () => {
        const r = await state.db
          .from('bildirimler')
          .select('id', { count: 'exact', head: true })
          .eq('kullanici_id', state.user.id)
          .eq('okundu', false);
        const n = $('#notification-count');
        if (n) {
          n.hidden = !r.count;
          n.textContent = r.count > 99 ? '99+' : r.count;
        }
      };
      const messages = async () => {
        const r = await state.db
          .from('mesajlar')
          .select('id', { count: 'exact', head: true })
          .neq('gonderen_id', state.user.id)
          .eq('okundu', false);
        const n = $('#message-count');
        if (n) {
          n.hidden = !r.count;
          n.textContent = r.count > 99 ? '99+' : r.count;
        }
      };
      await Promise.all([refresh(), messages()]);
      state.db
        .channel(`unread:${state.user.id}`)
        .on('change', { table: 'mesajlar' }, messages)
        .subscribe();
      state.db
        .channel(`notifications:${state.user.id}`)
        .on(
          'change',
          {
            table: 'bildirimler',
            filter: `kullanici_id=eq.${state.user.id}`,
          },
          refresh,
        )
        .subscribe();
    }
  } catch {
    state.phase = 'error';
    render();
  }
}
state.lang =
  (new URLSearchParams(location.search).get('lang') || read('bc-lang', 'tr')) === 'en'
    ? 'en'
    : 'tr';
const category =
  new URLSearchParams(location.search).get('kategori') ||
  { '/kullanilmis': 'kullanilmis', '/sifir': 'sifir', '/parca': 'parca' }[location.pathname];
state.mainCat = ['kullanilmis', 'sifir', 'parca'].includes(category) ? category : 'kullanilmis';
start();

for (const event of ['online', 'offline'])
  window.addEventListener(event, () => {
    const banner = $('#connection-status');
    if (banner) banner.hidden = navigator.onLine;
  });
if ('serviceWorker' in navigator && isSecureContext) {
  const register = () =>
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
