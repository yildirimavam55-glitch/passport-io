# passport.io – Yayına hazırlık listesi

Durum: 24.11.2026. Teknik altyapı hazır; aşağıdaki maddeler tamamlanmadan satışa başlanmamalı.
Yönetim panelinde **Genel bakış → “Yayına hazır mı?”** listesi canlı durumu gösterir.

## 1. Hukuk ve resmi işlemler (en kritik)

- [ ] **BTK / eSIM satış yetkisi:** BTK, 2025'te Türkiye'de yetkisi olmayan yurt dışı eSIM
      sağlayıcılarına (Airalo, Holafly, Nomad vb.) erişim engeli getirdi. passport.io'nun ve
      eSIM sağlayıcısının Türkiye'den satış için hangi izne ihtiyaç duyduğunu **bir avukatla
      netleştir**. Gerekirse BTK yetkili bir sağlayıcıyla çalış. (Kaynak: haberler; resmi BTK
      metni bulunamadı.)
- [ ] **Şirket ve vergi:** vergi levhası, e-Fatura / e-Arşiv entegrasyonu (mali müşavir).
- [ ] **ETBİS kaydı** (eticaret.gov.tr) – faaliyete başlamadan önce; QR kodu sitenin alt
      kısmına eklenmeli.
- [ ] **KVKK:** aydınlatma metni hazır (Gizlilik sayfası) – avukata kontrol ettir; gerekiyorsa VERBİS kaydı.
- [ ] **Yasal metinler:** Künye, Gizlilik, Kullanım koşulları, Cayma hakkı, Mesafeli satış
      sözleşmesi taslak olarak hazır (İçerik editörü → “Sayfalar & yasal metinler”).
      **[KÖŞELİ PARANTEZ]** içindeki bilgileri doldur ve avukata onaylat.
- [ ] **İade süresi** yasal metinlerde ve Supabase secret `REFUND_DAYS` ile aynı olmalı (varsayılan 30).
- [ ] **AB müşterileri:** AB'deki bireysel müşterilere satışta KDV genellikle müşterinin ülkesinde
      doğar (OSS). eSIM için durumu mali müşavirle netleştir.

## 2. Ödeme

- [ ] Ödeme sağlayıcısını seç (Türk şirketi: iyzico / PayTR; AB şirketi: Stripe) ve başvur.
- [ ] Entegrasyon (yazılım tarafında yapılacak): sunucuda ödeme oturumu, **3D Secure**,
      webhook **imza doğrulaması**, tutarın siparişle karşılaştırılması, ödeme numarasının tek
      kullanımı (veritabanında hazır), ödeme onayından sonra eSIM teslimi.
- [ ] Ödeme adımında **ön bilgilendirme formu ve mesafeli satış sözleşmesi onay kutusu** +
      dijital içerikte cayma hakkının sona erdiğine dair açık onay.
- [ ] Alt bilgideki ödeme logoları yalnızca gerçekten sunulan yöntemleri göstermeli (ör. Klarna/PayPal).

## 3. Sağlayıcılar ve anahtarlar (Supabase → Edge Functions → Secrets)

- [ ] eSIM: `ESIM_API_URL`, `ESIM_API_KEY` – alış fiyatı alanı, sipariş ve kullanım uç noktaları
      `supabase/functions/_shared/esim-provider.ts` içinde sağlayıcıya göre eşleştirilmeli.
- [ ] Lounge / Fast Track: `LOUNGE_API_URL/KEY`, `FASTTRACK_API_URL/KEY`.
- [ ] `ADMIN_EMAILS` = yönetici e-postaları; `ADMIN_REQUIRE_MFA=true` (tüm yöneticilere 2FA zorunlu).
- [ ] `ALLOW_TEST_ORDERS` **silinmiş** olmalı.

## 4. Giriş, e-posta, güvenlik (Supabase panosu)

- [ ] **SMTP** (Resend, Brevo, Postmark …) – varsayılan gönderim yalnızca test içindir.
- [ ] E-posta şablonları: `supabase/templates/*.html` içeriğini yapıştır.
- [ ] Google ve Apple ile giriş: istemci bilgilerini gir (ayrıntılar ANLEITUNG.md).
- [ ] **Bot koruması:** Authentication → Attack Protection → CAPTCHA (Cloudflare Turnstile önerilir).
- [ ] Şifre politikası: en az 8 karakter, harf + rakam; mümkünse sızdırılmış şifre koruması.
- [ ] Yönlendirme adresleri: canlı alan adının `account.html` adresi.
- [ ] Yöneticiler panelde **Güvenlik → İki adımlı doğrulama**yı kursun.

## 5. Alan adı ve yayın

- [ ] `passport.io` → GitHub Pages özel alan adı, “Enforce HTTPS” açık; repo değişkeni `SITE_URL`.
- [ ] Google Search Console: `sitemap.xml` gönder.
- [ ] Önizleme çubuğunu kapat (İçerik editörü → Ana sayfa & tasarım → Önizleme notu).
- [ ] Örnek değerlendirmeleri Trustpilot widget'ı ile değiştir; Unsplash görsellerini kendi görsellerinle değiştir
      (Karadağ görseli yanlış – Doha gösteriyor).
- [ ] Çevirileri (özellikle Arapça, Rusça) anadili konuşan biri kontrol etsin.
- [ ] Gerçek telefonlarda (iPhone, Samsung, Pixel) uçtan uca test: kayıt → kod → satın alma → QR → kurulum → iade talebi.

## 6. Yazılımda yapılanlar (güvenlik kontrolü)

- Fiyatlar yalnızca sunucuda, sağlayıcı API'sinden hesaplanır; alış fiyatları asla dışarı verilmez.
- Satır düzeyinde erişim (RLS): her müşteri yalnızca kendi verisini görür.
- Hesap silinince siparişler yasal saklama için anonim olarak korunur.
- Sipariş, destek ve iade taleplerinde kötüye kullanım sınırları; bot tuzağı alanı.
- Yönetim: e-posta listesi + doğrulanmış e-posta + iki adımlı doğrulama; tüm işlemler kayıt altında.
- İçerik güvenlik politikası (CSP), başka sitelere gömülme koruması, güvenli bağlantılar.
- Yazı tipleri Bunny Fonts üzerinden (Google Fonts yerine, KVKK/GDPR).
- Depoda gizli anahtar yok; tüm anahtarlar Supabase secret olarak saklanır.
