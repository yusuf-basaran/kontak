export async function createClient(cfg) {
  let config = cfg.firebase;
  if (!config?.projectId) {
    try {
      const cached = JSON.parse(sessionStorage.getItem('bc-firebase') || 'null');
      if (cached?.data?.projectId && Date.now() - cached.time < 3600000) config = cached.data;
    } catch {}
    if (!config?.projectId) {
      const r = await fetch('/__/firebase/init.json', { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        config = await r.json();
        try {
          sessionStorage.setItem('bc-firebase', JSON.stringify({ time: Date.now(), data: config }));
        } catch {}
      }
    }
  }
  if (!config?.projectId) return null;
  const base = 'https://www.gstatic.com/firebasejs/13.0.0/';
  const [appSdk, authSdk] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
  ]);
  const app = appSdk.initializeApp(config);
  const auth = authSdk.getAuth(app);
  const emailLanguage = () => {
    auth.languageCode = document.documentElement.lang === 'en' ? 'en' : 'tr';
  };
  if (cfg.emulators) {
    authSdk.connectAuthEmulator(auth, `http://${cfg.emulators.host}:9099`, {
      disableWarnings: true,
    });
  }
  let firestoreReady, storageReady;
  const firestore = () =>
    (firestoreReady ||= import(base + 'firebase-firestore.js').then((sdk) => {
      const db = sdk.getFirestore(app);
      if (cfg.emulators) sdk.connectFirestoreEmulator(db, cfg.emulators.host, 8085);
      return { sdk, db };
    }));
  const fileStorage = () =>
    (storageReady ||= import(base + 'firebase-storage.js').then((sdk) => {
      const storage = sdk.getStorage(app);
      if (cfg.emulators) sdk.connectStorageEmulator(storage, cfg.emulators.host, 9199);
      return { sdk, storage };
    }));
  await auth.authStateReady();
  if (auth.currentUser && !auth.currentUser.emailVerified) {
    try {
      await authSdk.reload(auth.currentUser);
      if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true);
    } catch (error) {
      if (
        ![
          'auth/user-disabled',
          'auth/user-token-expired',
          'auth/invalid-user-token',
          'auth/user-not-found',
        ].includes(error.code)
      )
        throw error;
      await authSdk.signOut(auth);
    }
  }
  const user = () =>
    auth.currentUser && { id: auth.currentUser.uid, email: auth.currentUser.email };
  async function call(data) {
    try {
      const token = await auth.currentUser?.getIdToken();
      const r = await fetch(cfg.api || '/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });
      const result = await r.json();
      if (r.status === 401 && token) await authSdk.signOut(auth);
      if (!r.ok || result.error)
        throw Object.assign(Error(result.error?.message || 'İşlem tamamlanamadı'), {
          hint: result.error?.hint,
        });
      return result;
    } catch (error) {
      return { data: null, error };
    }
  }
  const result = async (fn) => {
    try {
      return { data: await fn(), error: null };
    } catch (error) {
      return { data: null, error };
    }
  };
  let verification, pendingCredential;
  async function linkPending() {
    const current = auth.currentUser;
    if (!current?.emailVerified || pendingCredential?.email !== current.email?.toLowerCase())
      return;
    if (!current.providerData.some((p) => p.providerId === pendingCredential.credential.providerId))
      await authSdk.linkWithCredential(current, pendingCredential.credential);
    pendingCredential = null;
  }
  const client = {
    projectId: config.projectId,
    auth: {
      getUser: async () => ({ data: { user: auth.currentUser?.emailVerified ? user() : null } }),
      signOut: () =>
        result(() => {
          pendingCredential = null;
          return authSdk.signOut(auth);
        }),
      signInWithPassword: ({ email, password }) =>
        result(async () => {
          await authSdk.signInWithEmailAndPassword(auth, email, password);
          if (!auth.currentUser.emailVerified) {
            await authSdk.signOut(auth);
            throw Error('E-posta adresinizi doğrulayın');
          }
          await linkPending();
          return { user: user() };
        }),
      signInWithOAuth: ({ provider, emailRedirectTo }) =>
        result(async () => {
          if (!['google', 'facebook'].includes(provider)) throw Error('Geçersiz giriş sağlayıcısı');
          const Type =
            provider === 'google' ? authSdk.GoogleAuthProvider : authSdk.FacebookAuthProvider;
          const source = new Type();
          if (provider === 'google') source.setCustomParameters({ prompt: 'select_account' });
          else source.addScope('email');
          emailLanguage();
          try {
            await authSdk.signInWithPopup(auth, source);
          } catch (error) {
            if (error.code === 'auth/account-exists-with-different-credential') {
              const credential = Type.credentialFromError(error);
              if (credential && error.customData?.email)
                pendingCredential = { credential, email: error.customData.email.toLowerCase() };
            }
            throw error;
          }
          const current = auth.currentUser;
          if (!current.email) {
            pendingCredential = null;
            await authSdk.signOut(auth);
            throw Object.assign(Error('E-posta adresi gerekli'), { code: 'auth/missing-email' });
          }
          await linkPending();
          const r = await call({
            name: 'profil_kaydet',
            data: {
              ad: (current.displayName || current.email.split('@')[0]).slice(0, 100),
              tip: 'bireysel',
            },
          });
          if (r.error) throw r.error;
          if (!current.emailVerified) {
            await authSdk.sendEmailVerification(current, { url: emailRedirectTo });
            return { verification: 'link' };
          }
          return { user: user() };
        }),
      signUp: ({ email, password, options }) =>
        result(async () => {
          try {
            await authSdk.createUserWithEmailAndPassword(auth, email, password);
          } catch (error) {
            if (error.code !== 'auth/email-already-in-use') throw error;
            await authSdk.signInWithEmailAndPassword(auth, email, password);
            if (auth.currentUser.emailVerified) throw error;
          }
          const r = await call({ name: 'profil_kaydet', data: options.data });
          if (r.error) throw r.error;
          emailLanguage();
          await authSdk.sendEmailVerification(auth.currentUser, { url: options.emailRedirectTo });
          return { user: user(), verification: 'link' };
        }),
      resetPasswordForEmail: (email, options) =>
        result(() => {
          emailLanguage();
          return authSdk.sendPasswordResetEmail(auth, email, { url: options.redirectTo });
        }),
      updateUser: (data) =>
        result(async () => {
          if (data.password) return authSdk.updatePassword(auth.currentUser, data.password);
          if (data.phone) {
            let node = document.getElementById('firebase-recaptcha');
            if (!node) {
              node = document.createElement('div');
              node.id = 'firebase-recaptcha';
              document.body.append(node);
            }
            const verifier = new authSdk.RecaptchaVerifier(auth, node, { size: 'invisible' });
            try {
              verification = await new authSdk.PhoneAuthProvider(auth).verifyPhoneNumber(
                data.phone,
                verifier,
              );
            } finally {
              verifier.clear();
            }
          }
        }),
      verifyOtp: ({ token }) =>
        result(async () => {
          if (!verification) throw Error('Önce doğrulama kodu isteyin');
          await authSdk.updatePhoneNumber(
            auth.currentUser,
            authSdk.PhoneAuthProvider.credential(verification, token),
          );
          verification = null;
        }),
    },
    rpc: (name, data = {}) => call({ name, data }),
    from(name) {
      const data = { table: name, op: 'read', filters: [], order: [] };
      let pending;
      const q = {
        select(cols = '*', options = {}) {
          data.cols = cols;
          data.head = !!options.head;
          return q;
        },
        eq(k, v) {
          data.filters.push([k, 'eq', v]);
          return q;
        },
        neq(k, v) {
          data.filters.push([k, 'neq', v]);
          return q;
        },
        in(k, v) {
          data.filters.push([k, 'in', v]);
          return q;
        },
        or(value) {
          data.or = value;
          return q;
        },
        order(k, options = {}) {
          data.order.push([k, options.ascending !== false]);
          return q;
        },
        limit(n) {
          data.limit = n;
          return q;
        },
        single() {
          data.one = 'required';
          return q;
        },
        maybeSingle() {
          data.one = 'optional';
          return q;
        },
        insert(value) {
          data.op = 'insert';
          data.value = value;
          return q;
        },
        upsert(value, options = {}) {
          data.op = 'upsert';
          data.value = value;
          data.ignoreDuplicates = !!options.ignoreDuplicates;
          return q;
        },
        update(value) {
          data.op = 'update';
          data.value = value;
          return q;
        },
        delete() {
          data.op = 'delete';
          return q;
        },
        then(ok, fail) {
          pending ||= call({ query: data });
          return pending.then(ok, fail);
        },
      };
      return q;
    },
    storage: {
      from(bucket) {
        return {
          upload: (name, file) =>
            result(async () => {
              const { sdk, storage } = await fileStorage();
              await sdk.uploadBytes(sdk.ref(storage, `${bucket}/${name}`), file, {
                contentType: file.type,
              });
              return { path: name };
            }),
          getPublicUrl: (name) => ({
            data: {
              publicUrl: `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${encodeURIComponent(bucket + '/' + name)}?alt=media`,
            },
          }),
          createSignedUrl: async (name) => {
            const r = await call({ name: 'dosya_url', data: { bucket, file: name } });
            return r.error ? r : { data: { signedUrl: r.data }, error: null };
          },
        };
      },
    },
    channel() {
      const subscriptions = [],
        stops = [];
      let closed = false;
      const channel = {
        on(event, options, fn) {
          subscriptions.push({ options, fn });
          return channel;
        },
        subscribe() {
          firestore()
            .then(({ sdk: fs, db }) => {
              if (closed) return;
              for (const { options, fn } of subscriptions) {
                let target;
                const filters = [];
                if (options.filter) {
                  const [field, value] = options.filter.split('=eq.');
                  if (field === 'id') target = fs.doc(db, options.table, value);
                  else filters.push(fs.where(field, '==', value));
                }
                if (options.table === 'mesajlar')
                  filters.push(fs.where('katilimcilar', 'array-contains', auth.currentUser.uid));
                if (options.table === 'bildirimler' && !options.filter)
                  filters.push(fs.where('kullanici_id', '==', auth.currentUser.uid));
                target ||= fs.query(fs.collection(db, options.table), ...filters);
                let initial = true;
                stops.push(
                  fs.onSnapshot(
                    target,
                    (snap) => {
                      if (initial) {
                        initial = false;
                        return;
                      }
                      fn({ new: typeof snap.data === 'function' ? snap.data() : null });
                    },
                    (error) => console.error(error.code),
                  ),
                );
              }
            })
            .catch((error) => console.error(error.code || error.message));
          return channel;
        },
        unsubscribe() {
          closed = true;
          stops.splice(0).forEach((stop) => stop());
        },
      };
      return channel;
    },
    removeChannel: (channel) => channel.unsubscribe(),
  };
  return client;
}
