import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { bootstrap, firstAdmin } from './bootstrap.js';
import { createService } from './service.js';
import { Store, check, rate, hash } from './core.js';
import { maintenance, cleanup, listingEvent, emailQueue } from './jobs.js';
import { createSeo } from './seo.js';
import { pendingDeletions } from './deletion.js';

initializeApp();
setGlobalOptions({
  region: 'europe-west1',
  maxInstances: 10,
  memory: '256MiB',
  timeoutSeconds: 120,
});
const db = getFirestore(),
  auth = getAuth(),
  service = createService({
    db,
    auth,
    bucket: getStorage().bucket(),
  });
const publicPage = createSeo(db, service);
export const seo = onRequest(async (req, res) => {
  res.set('X-Content-Type-Options', 'nosniff');
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.set('Allow', 'GET, HEAD').status(405).end();
      return;
    }
    await bootstrap(db);
    const page = await publicPage(req.originalUrl);
    res.set('Cache-Control', page.cache || 'public, max-age=0, s-maxage=300');
    if (page.noindex) res.set('X-Robots-Tag', 'noindex, follow');
    res
      .status(page.status)
      .type(page.type || 'html')
      .send(page.body);
  } catch (error) {
    console.error('Sayfa sunulamadı', error.code || error.message);
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').status(503).send('KONTAK');
  }
});
export const api = onRequest(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method === 'GET' && req.path.endsWith('/dosya')) {
      check(
        typeof req.query.token === 'string' && /^[a-f0-9]{64}$/.test(req.query.token),
        'Dosya bağlantısı geçersiz',
        403,
      );
      const record = (await db.collection('_dosyalar').doc(hash(req.query.token)).get()).data();
      check(record && record.expires > Date.now(), 'Dosya bağlantısının süresi doldu', 403);
      const file = getStorage().bucket().file(record.path),
        [meta] = await file.getMetadata();
      res.type(meta.contentType);
      res.set(
        'Content-Disposition',
        'inline; filename="' +
          record.path
            .split('/')
            .at(-1)
            .replace(/[^a-zA-Z0-9._-]/g, '_') +
          '"',
      );
      file
        .createReadStream()
        .on('error', () => res.destroy())
        .pipe(res);
      return;
    }
    check(req.method === 'POST', 'Yalnız POST kullanılabilir', 405);
    check(
      req.is('application/json') && JSON.stringify(req.body || {}).length <= 1000000,
      'İstek biçimi veya boyutu geçersiz',
    );
    let user;
    if (req.headers.authorization) {
      check(/^Bearer \S+$/.test(req.headers.authorization), 'Oturum geçersiz', 401);
      const token = await auth.verifyIdToken(req.headers.authorization.slice(7), true);
      user = await auth.getUser(token.uid);
    }
    await bootstrap(db);
    if (user) await firstAdmin(db, user, process.env.INITIAL_ADMIN_EMAIL);
    await db.runTransaction(async (tx) => {
      const s = new Store(db, tx);
      await rate(s, user?.uid || hash(req.ip || 'guest'), 'api', 240);
      s.flush();
    });
    const result = await service.execute(req.body, user, hash(req.ip || 'guest'));
    res.json(result);
  } catch (error) {
    const status = error.status || (String(error.code || '').startsWith('auth/') ? 401 : 500);
    if (status === 500) console.error('İstek başarısız', error.code || error.message);
    res.status(status).json({
      data: null,
      error: {
        message: status === 500 ? 'İşlem tamamlanamadı' : error.message,
        ...(error.hint === 'paketler.html' ? { hint: error.hint } : {}),
      },
    });
  }
});
export const bakim = onSchedule('every 15 minutes', async () => {
  await maintenance(db);
  await pendingDeletions(db, getStorage().bucket());
});
export const temizlik = onSchedule({ schedule: '20 3 * * *', timeZone: 'UTC' }, () => cleanup(db));
export const eposta = onSchedule(
  {
    schedule: 'every 2 minutes',
    secrets: process.env.MAIL_ENABLED === 'true' ? ['MAIL_API_KEY'] : [],
  },
  () =>
    emailQueue(db, auth, {
      url: process.env.MAIL_API_URL,
      key: process.env.MAIL_API_KEY,
      from: process.env.MAIL_FROM,
    }),
);
export const ilanBildirim = onDocumentWritten('ilanlar/{id}', (event) =>
  listingEvent(db, event.data.before.data(), event.data.after.data(), event.id),
);
