# Kurulum

## Gereksinimler

Node.js 22+, Java 21+ ve Firebase hesabı gerekir. Statik arayüzde framework kullanılmaz. Firebase Hosting, Authentication, Firestore Standard, Cloud Storage ve Cloud Functions aynı projede çalışır. Bölge `europe-west1` olarak seçilmiştir. Functions, Scheduler ve Storage için projenin uygun faturalandırma planı gerekir; site içinde ödeme alınmaz.

```bash
npm ci
npm ci --prefix functions
npx playwright install chromium
npm run firebase:emulators
```

Site `http://127.0.0.1:5000`, emülatör yönetimi `http://127.0.0.1:4000` adresindedir. `demo-beta-car` yerel test kimliğidir; üretim projesi değildir. Emülatörde ilk API isteği eksik başlangıç kayıtlarını ekler; mevcut kayıtları değiştirmez. Emülatörler kapanınca veriler kalıcı değildir. E-posta doğrulama bağlantıları Auth emülatör çıktısında görünür. `npm run dev` yalnız arayüzü 4173 portunda açar.

## Canlı proje ve yayın

```bash
npx firebase login --no-localhost
npm run firebase:deploy
```

Betik oturumu kontrol eder, `.firebaserc` yoksa benzersiz kimlikle KONTAK projesi açar ve web uygulamasını kaydeder. Auth, Firestore Standard, kurallar, indeksler, silme koruması ve başlangıç verilerini uygular. Public web yapılandırmasıyla build alır; Blaze denetiminden sonra Storage, Functions ve Hosting dağıtımını çalıştırır. Belirli proje için `npm run firebase:deploy -- PROJE_KIMLIGI` kullanılır. Mevcut veritabanı yeniden açılmaz ve silinmez. Google hesabında proje açma yetkisi bulunmalıdır.

Yayın betiği Cloud Storage varsayılan bucket alanını Firebase REST API üzerinden `europe-west1` bölgesinde hazırlar. Storage hizmet hesabına, dosya kurallarının Firestore sahiplik kayıtlarını okuyabilmesi için `roles/firebaserules.firestoreServiceAgent` rolünü ekler; mevcut yetkileri korur. Firebase CLI etkileşimsiz dağıtımda bu rolü otomatik denetlemez. Bu adımlar sabit sürümlü Firebase CLI oturumunu kullanır; kimlik bilgilerini dosyaya aktarmaz. Hesap veya faturalandırma nedeniyle engellenirse Firebase Console üzerinde bildirilen gereksinim tamamlanıp aynı komut yeniden çalıştırılır. Google hesabına giriş ve faturalandırma onayları hesap sahibi tarafından tamamlanır; dosyalara parola veya ödeme bilgisi yazılmaz.

İlk Eventarc dağıtımında hizmet hesabı yetkilerinin yayılması birkaç dakika sürebilir. `roles/eventarc.serviceAgent` ataması mevcutsa aynı yayın komutu tekrar çalıştırılır. Artifact Registry saklama ayarı Firebase Console veya `firebase functions:artifacts:setpolicy` ile yönetilir; mevcut projede otomatik imaj silme kapalıdır.

Firebase Hosting `/__/firebase/init.json` üzerinden public web yapılandırmasını sağlar. Başka bir statik sunucu için `FIREBASE_WEB_CONFIG` ortam değişkenine yalnız web SDK alanlarını içeren JSON verilebilir. Build bunu `.build/js/config.js` dosyasına yazar. Kaynak `cfg.url`, `cfg.anon` ve `cfg.firebase` boş kalır. Service account anahtarı veya sunucu kimliği statik çıktıya girmez.

## Authentication ve ilk yönetici

`firebase.json` e-posta/parola girişini açar, anonim üyeliği kapatır; `firebase deploy --only auth` bu ayarı uygular. Firebase Console > Authentication > Settings > Authorized domains içine gerçek alan adı eklenir. E-posta doğrulama ve parola sıfırlama şablonları, gönderen alan adı ve parola politikası kontrol edilir. Doğrulanmamış üye ilan veya mesaj yazamaz.

Google ve Facebook için [sosyal giriş kurulumunu](sosyal-giris.md) uygulayın. Sağlayıcı kimlik bilgileri Firebase Authentication'da tutulur. `node scripts/firebase/providers.mjs PROJE_KIMLIGI` komutu, etkin sağlayıcılarla sitedeki giriş düğmelerini eşitler.

Yayın komutu öncesinde `INITIAL_ADMIN_EMAIL` ortam değişkeni verilirse betik bunu Git dışındaki proje ortam dosyasına ekler. Elle kurulumda ilk yönetici için `functions/.env.PROJE_KIMLIGI` dosyasında `INITIAL_ADMIN_EMAIL` değeri hesap sahibinin e-postası olarak tanımlanır. Dosya Git dışındadır. Functions yayımlandıktan sonra bu adresle kayıt olunur ve e-posta doğrulanır. İlk doğrulanmış istek, `_kurulum/yonetici` kaydını ve özel `_yetkiler` rolünü bir kez yazar. Ardından bu ortam değişkeni kaldırılıp Functions tekrar yayımlanabilir. İstemci e-postayla rol atayamaz; rol kullanıcı tarafından değiştirilemeyen sunucu ayarına bağlıdır.

Alternatif olarak, yetkili ortamda Application Default Credentials ile:

```bash
node scripts/firebase/set-admin.mjs PROJE_KIMLIGI YONETICI_EPOSTASI
```

Betik yalnız e-postası doğrulanmış Firebase Auth hesabını yetkilendirir. Kimlik dosyası depoya veya Hosting çıktısına eklenmez.

## Veri ve erişim

`functions/data.json` kategori, donanım, fiyatsız paket, ayar, başlangıç araç sözlüğü ve içerik kayıtlarını içerir. Canlı yayın betiği bu kayıtları Google hesabının CLI oturumuyla atomik olarak uygular; emülatör ve ilk API isteği için aynı başlangıç verileri sunucuda da bulunur. İşlem işareti varsa tekrar ekleme yapılmaz. `scripts/firebase/initial.mjs` özel anahtar dosyası gerektirmez. Elle aktarım için yetkili sunucu ortamında `npm run firebase:seed -- PROJE_KIMLIGI` kullanılır. `--update` mevcut başlangıç kayıtlarının üzerine yazar; yalnız bilinçli içerik güncellemesinde kullanılır.

Firestore koleksiyonları eski tablo adlarını korur. İlişkiler kimlik alanlarıyla kurulur. `_yetkiler`, `_haklar`, `_hiz`, `_kilitler`, `_eposta` gibi iç koleksiyonlar istemciye kapalıdır. Doğrudan istemci yazmaları tüm koleksiyonlarda reddedilir. Üye işlemleri `/api` üzerinden Auth doğrulaması, sahiplik, veri sınırları ve Firestore transaction denetiminden geçer. Realtime karşılığı Firestore `onSnapshot` dinleyicileridir.

Araç sözlüğü sunucuda beş dakika önbellekte tutulur; yönetici marka/model değişiklikleri bu önbelleği temizler. İstemci ayrıca sessionStorage önbelleği kullanır. Arama, kaporta/donanım filtreleri ve medyan hesapları sunucuda çalışır; SQL view veya pg_cron gerekmez. Geniş aramalar aday ilanları okuyarak filtreler. Katalog büyüdükçe okuma maliyeti ve gecikme izlenmeli, indeksli sorgu veya ayrı arama indeksi planlanmalıdır.

Eski Supabase SQL dosyaları ve `supabase/` dizini geçmiş kurulum için korunur; Firebase'de çalıştırılmaz. Canlı Supabase verisi otomatik taşınmaz. Mevcut canlı veri varsa dışa aktarma, UID eşlemesi ve dosya aktarımı ayrı planlanmalıdır.

## Storage

Tek Firebase bucket içinde dört yol kullanılır:

| Yol                               | Okuma              | İzinli tür      | Sınır |
| --------------------------------- | ------------------ | --------------- | ----- |
| `ilanlar/{uid}/{ilan}/{dosya}`    | Açık               | JPEG, PNG, WebP | 10 MB |
| `firmalar/{uid}/…`                | Açık               | JPEG, PNG, WebP | 5 MB  |
| `ekspertiz/{uid}/{ilan}/{dosya}`  | Sahibi ve yönetici | PDF, JPEG, PNG  | 10 MB |
| `dekontlar/{uid}/{talep}/{dosya}` | Sahibi ve yönetici | PDF, JPEG, PNG  | 5 MB  |

Yüklemede doğrulanmış hesap, sahiplik ve ilgili ilan/talep kontrol edilir. Dekont yalnız ödeme bekleyen veya reddedilmiş, süresi dolmamış talebe eklenir. İstemci dosyanın üzerine yazamaz. İlan detayında erişime açık ekspertiz raporu ve yetkili dekont görüntülemesi için sunucu 120 saniyelik rastgele bağlantı verir. Bucket genel IAM erişimine açılmaz.

## Paket, kota ve telefon

Yönetici paket adını, fiyatını, kotasını ve süresini panelden belirler. IBAN, banka, hesap sahibi, ücretsiz ilan limiti, öne çıkarma ve zaman aşımı süreleri ayarlardan gelir. Banka bilgisi yalnız talep sahibinin ödeme bekleyen talebine açılır. Onay ve abonelik aynı transaction içinde gerçekleşir. Kota istemci tarafından artırılamaz; kaldırma hak iade etmez. Yenileme önceki ilan hakkını korur.

SMS kapalıyken `sms_zorunlu` false kalır. Firebase Authentication telefon sağlayıcısı, izinli SMS bölgeleri ve test numaraları yapılandırıldıktan sonra telefon doğrulaması denenir; ardından ayar açılır. Yayında Auth telefonu ile profil telefonu eşleşmelidir.

## Zamanlanmış işler ve e-posta

Cloud Scheduler işlevleri: `bakim` 15 dakikada bir yarım kalan kalıcı silmeleri tamamlar, talep/abonelik/ilan sürelerini kontrol eder; `temizlik` her gün 03:20 UTC geçici kayıtları siler; `eposta` iki dakikada bir bildirim kuyruğunu işler. İlan yazma tetikleyicisi `ilanBildirim` kayıtlı arama ve fiyat takibi bildirimlerini yazar. Yerel testler bakım fonksiyonunu doğrudan çağırır; canlı Scheduler çalışması ayrıca doğrulanır.

E-posta doğrulama ve şifre sıfırlama Firebase Authentication bağlantılarıyla tamamlanır. Ayrıntılar [e-posta doğrulama belgesindedir](eposta-dogrulama.md). Uygulama bildirimleri için HTTPS JSON e-posta sağlayıcısı gerekir. Sunucu ortamında `MAIL_ENABLED=true`, `MAIL_API_URL` ve `MAIL_FROM` tanımlanır. Sağlayıcı anahtarı:

```bash
npx firebase functions:secrets:set MAIL_API_KEY --project PROJE_KIMLIGI
npx firebase deploy --only functions --project PROJE_KIMLIGI
```

`api` ve `eposta` işlevleri etkin ayarda bu sırrı bağlar. Uç nokta Bearer doğrulamasıyla `from`, `to`, `subject`, `text` alanlarını ve `Idempotency-Key` başlığını kabul etmelidir. Sağlayıcı yoksa kuyruk saklanır, teslimat gerçekleşmez. E-posta tercihi kapalı üyelere bildirim e-postası gönderilmez.

## Araç sözlüğü

Kökteki tek seferlik `seed.js` ve `.seed-state.json` Git dışındadır. Betik Firebase Admin SDK ve Application Default Credentials kullanır; tarayıcıya kimlik bilgisi taşımaz. `GCLOUD_PROJECT` ile hedef proje seçilir. vPIC markalarını ve 1950'den çalıştırıldığı yıla kadar modelleri tarar, aynı adları birleştirir ve kaldığı yıldan sürer. Japonya/İngiltere ekleri aynı koleksiyonlara yazılır. Kaynağın kapsamadığı sınıflar yönetici tarafından denetlenir.

## Kontroller

```bash
npm run lint
npm test
npm run test:firebase
npm run test:browser
npm run build
```

Tarayıcı için isteğe bağlı `CHROMIUM_PATH` kullanılabilir. [Yayın kontrol listesi](yayin-kontrol-listesi.md) ve [kabul testleri](kabul-testleri.md) canlı projede tamamlanır.

## Vercel ön yüzü

Geçici ana adres `https://kon-tak.vercel.app` olarak kullanılır. Vercel, statik dosyaları `.build` dizininden sunar; Firebase web yapılandırması, API, herkese açık HTML ve sitemap isteklerini `vercel.json` üzerinden mevcut Firebase Hosting adresine iletir. Tarayıcıdaki adres Vercel olarak kalır. Kaynak bağlantı alanları boş kalabilir; Vercel ortamına service account ya da sunucu anahtarı girilmez. Üretim alan adı Firebase Auth yetkili alan adları arasında bulunmalıdır.

Vercel projesinde Framework: Other, build komutu `npm run build -- --firebase`, çıktı dizini `.build` ve üretim dalı `main` kullanılır. Firebase sunucu şablonları veya SEO ayarları değiştiğinde önce Firebase `seo` işlevi yayımlanır; GitHub üretim commit'i Vercel yayınını başlatır. Ana alan adı geçişinde SEO ana adresi, canonical/paylaşım etiketleri, robots/sitemap ve Auth yetkili alan adları birlikte güncellenir. Firebase arka uç adresi yönlendirme hedefi olarak korunur.

Kalıcı ilan silme, doğrulanmış ilan sahibinin `ilan_sil` isteğinde açık onay vermesini gerektirir. İlan silinirken değişiklik ve dosya yükleme kapatılır; fotoğraflar, raporlar ve bağlı ilan kayıtları temizlenmeden başarı yanıtı dönmez. Kesilen işler özel `_silinen_ilanlar` kuyruğundan yeniden yürütülür. Başka bir ilanda kullanılan fotoğraflar, son referans kalkınca silinir. Mesaj geçmişi korunur, silinen ilanla bağlantısı kaldırılır. İşlem kaydında yalnız ilan kimliği, işlemi yapan üye ve tarih tutulur; kullanılmış paket hakkı iade edilmez.
