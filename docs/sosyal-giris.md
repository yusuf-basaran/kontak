# Google ve Facebook ile giriş

Firebase Authentication, sağlayıcı oturumunu doğrular. Site sağlayıcı erişim anahtarını veritabanında veya tarayıcı kayıtlarında saklamaz. Google temel profilini; Facebook temel profil ve e-posta iznini kullanır. Giriş penceresi doğrudan kullanıcı tıklamasıyla açılır. Yönlendirmeli giriş kullanılmaz.

Yeni hesap için bireysel profil açılır. Var olan profil, kurumsal hesap türü, ilanlar ve yetkiler korunur. Aynı e-posta başka bir giriş yöntemine bağlıysa, kullanıcı mevcut giriş yöntemiyle aynı ekranda giriş yaparak bekleyen sağlayıcıyı bağlayabilir. Bağlama kimlik bilgisi yalnız açık sayfanın belleğinde tutulur; sayfa kapanırsa sağlayıcıya yeniden tıklanır. E-postası doğrulanmamış hesap, Firebase doğrulama bağlantısını tamamlamadan üye işlemlerini kullanamaz.

## Sağlayıcıları eşitleme

Firebase Console > Authentication > Sign-in method ekranındaki ayarlar asıl yapılandırmadır. Site yalnız `ayarlar/giris_saglayicilari` listesindeki etkin yöntemleri gösterir. Kimlik bilgileri bu listeye yazılmaz.

```bash
node scripts/firebase/providers.mjs beta-car-a019a9b0
```

Komut sağlayıcıların etkinliğini okur, sitedeki düğmeleri eşitler ve hesap/veri silme talimatı sayfası eksikse ekler. Var olan sayfa içeriğini değiştirmez. Yönetim > Ayarlar > `giris_saglayicilari` alanı da yalnız düğme görünürlüğünü düzenler. Firebase sağlayıcısını ayrıca açmak gerekir. Ayar değişikliği en geç bir dakika içinde görünür.

Google kimlik bilgileri Firebase'de hazırsa etkinleştirmek ve eşitlemek için:

```bash
node scripts/firebase/providers.mjs beta-car-a019a9b0 --google
```

## Facebook kurulumu

1. [Meta Developers](https://developers.facebook.com/apps/) hesabında KONTAK uygulamasını açın veya Facebook Login kullanımına uygun bir uygulama ekleyin.
2. Uygulamanın web sitesi adresini `https://kon-tak.vercel.app/` yapın.
3. Facebook Login ayarlarında geçerli OAuth dönüş adresini aşağıdaki değerle kaydedin:

```text
https://beta-car-a019a9b0.firebaseapp.com/__/auth/handler
```

4. Gizlilik bağlantısı: `https://kon-tak.vercel.app/sayfa.html?s=gizlilik-politikasi`
5. Veri silme talimatı bağlantısı: `https://kon-tak.vercel.app/sayfa.html?s=veri-silme-talebi`
6. Kullanım koşulları: `https://kon-tak.vercel.app/sayfa.html?s=bireysel-uye-sozlesmesi`
7. [Firebase Authentication](https://console.firebase.google.com/project/beta-car-a019a9b0/authentication/providers) içinde Facebook sağlayıcısına Meta App ID ve App Secret değerlerini girin ve sağlayıcıyı açın. App Secret kaynak koduna, istemci ayarına veya sohbet mesajına yazılmaz.
8. Meta panelinde Facebook Login, `public_profile` ve `email` erişimlerini; istenen inceleme, doğrulama ve canlı yayın adımlarını tamamlayın. Geliştirme modunda yalnız uygulamanın yetkili test hesapları giriş yapabilir.
9. Eşitleme komutunu çalıştırın. Facebook düğmesi açılır; yeni dağıtım gerekmez.

Gizlilik ve üyelik sayfalarındaki işletmeci alanları, Meta incelemesine gönderilmeden önce tamamlanmalıdır. Alan adı değiştiğinde Firebase yetkili alan adları, Meta web sitesi ve ilgili politika bağlantıları birlikte güncellenir.

## Kontrol

Google ve Facebook için yeni hesap, mevcut hesap, pencereyi iptal etme, engellenen açılır pencere, doğrulanmamış e-posta ve güvenli site içi dönüş ayrı denenir. Gerçek SDK testleri Firebase emülatörüyle çalışır; üretimde sağlayıcı giriş ekranına ulaşma ayrıca kontrol edilir. Test için gerçek kullanıcı hesabı açılmaz.

[Google giriş belgeleri](https://firebase.google.com/docs/auth/web/google-signin) · [Facebook giriş belgeleri](https://firebase.google.com/docs/auth/web/facebook-login) · [Tarayıcı yönlendirme kısıtları](https://firebase.google.com/docs/auth/web/redirect-best-practices)
