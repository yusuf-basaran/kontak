import { client } from './client.mjs';
import { readFile } from 'node:fs/promises';

const project = process.argv[2],
  flags = process.argv.slice(3);
if (flags.some((f) => !['--google', '--facebook'].includes(f))) throw Error('Seçenek geçersiz');
const api = await client(project, 'https://identitytoolkit.googleapis.com', 'admin/v2');
const enabled = [];
for (const provider of ['google', 'facebook']) {
  const path = `projects/${project}/defaultSupportedIdpConfigs/${provider}.com`;
  let config;
  try {
    config = (await api.get(path)).body;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (flags.includes('--' + provider)) {
    if (!config?.clientId || !config?.clientSecret)
      throw Error(`${provider}: sağlayıcı bilgilerini Firebase Authentication ekranına girin`);
    await api.patch(path, { enabled: true }, { queryParams: { updateMask: 'enabled' } });
    config = (await api.get(path)).body;
  }
  if (config?.enabled && config.clientId && config.clientSecret) enabled.push(provider);
}
const store = await client(project, 'https://firestore.googleapis.com');
const name = `projects/${project}/databases/(default)/documents/ayarlar/giris_saglayicilari`;
let old;
try {
  old = (await store.get(name)).body;
} catch (error) {
  if (error.status !== 404) throw error;
}
const writes = [
  {
    update: {
      name,
      fields: {
        anahtar: { stringValue: 'giris_saglayicilari' },
        deger: { arrayValue: { values: enabled.map((p) => ({ stringValue: p })) } },
      },
    },
    currentDocument: old ? { updateTime: old.updateTime } : { exists: false },
  },
];
const page = JSON.parse(
  await readFile(new URL('../../functions/data.json', import.meta.url), 'utf8'),
).sayfalar.find((p) => p.slug === 'veri-silme-talebi');
const pageName = `projects/${project}/databases/(default)/documents/sayfalar/${page.slug}`;
try {
  await store.get(pageName);
} catch (error) {
  if (error.status !== 404) throw error;
  writes.push({
    update: {
      name: pageName,
      fields: Object.fromEntries(Object.entries(page).map(([k, v]) => [k, { stringValue: v }])),
    },
    currentDocument: { exists: false },
  });
}
await store.post(`projects/${project}/databases/(default)/documents:commit`, { writes });
console.log(`Etkin giriş yöntemleri: ${enabled.join(', ') || 'yalnız e-posta'}`);
