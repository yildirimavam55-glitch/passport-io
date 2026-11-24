/* ==========================================================================
   passport.io – Mağaza yönetimi (Shop-Verwaltung)
   Genel bakış, siparişler, ödemeler, iadeler, destek talepleri, Lina soruları,
   müşteriler, eSIM'ler, fiyatlar & rakipler, entegrasyonlar, işlem kaydı, güvenlik (2FA).
   Erişim: Supabase girişi + ADMIN_EMAILS listesindeki e-postalar (Funktion „admin“).
   ========================================================================== */
(async () => {
  "use strict";
  const app = document.getElementById("app");
  if (window.top !== window.self) { app.innerHTML = ""; return; }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s, el = app) => el.querySelector(s);
  const $$ = (s, el = app) => [...el.querySelectorAll(s)];
  const date = (d) => (d ? new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d)) : "–");
  const day = (d) => new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(new Date(d));
  const money = (n, c) => { try { return new Intl.NumberFormat("tr-TR", { style: "currency", currency: c || "EUR" }).format(n || 0); } catch (_) { return `${n} ${c}`; } };
  const gb = (mb) => `${(Number(mb || 0) / 1024).toFixed(1).replace(".", ",")} GB`;
  const toast = (t) => { const d = document.createElement("div"); d.className = "pl-toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3200); };
  const ORDER_ST = { pending: "Ödeme bekleniyor", paid: "Ödendi", fulfilled: "Tamamlandı", failed: "Başarısız", refunded: "İade edildi", cancelled: "İptal" };
  const ESIM_ST = { processing: "Hazırlanıyor", ready: "Kuruluma hazır", installed: "Kuruldu", active: "Aktif", depleted: "Veri bitti", expired: "Süresi doldu", cancelled: "İptal" };
  const REF_ST = { open: "Bekliyor", approved: "Onaylandı", rejected: "Reddedildi" };
  const SUP_ST = { open: "Açık", answered: "Yanıtlandı", closed: "Kapatıldı" };
  const stClass = (s) => (["paid", "fulfilled", "active", "approved", "answered", "closed"].includes(s) ? "ok" : ["pending", "ready", "installed", "open"].includes(s) ? "warn" : ["failed", "cancelled", "expired", "depleted", "rejected", "refunded"].includes(s) ? "bad" : "");
  const badge = (s, map) => `<span class="pl-badge ${stClass(s)}">${esc(map[s] || s)}</span>`;

  let cfg = null;
  try { cfg = await fetch("../content/auth.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)); } catch (_) {}
  if (!cfg?.url || !window.supabase) { app.innerHTML = `<div class="pl-login"><form><h1>Mağaza yönetimi</h1><p>Bu sayfa için Supabase henüz bağlı değil. Yönetim paneli yayındaki sitede çalışır.</p></form></div>`; return; }
  const ref = new URL(cfg.url).hostname.split(".")[0];
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const fnUrl = `${cfg.url}/functions/v1/admin`;
  const dash = (path) => `https://supabase.com/dashboard/project/${ref}/${path}`;

  async function api(method, query = "", body) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw Object.assign(new Error("unauthorized"), { status: 401 });
    const r = await fetch(fnUrl + query, { method, headers: { Authorization: `Bearer ${session.access_token}`, apikey: cfg.anonKey, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || "server"), { status: r.status });
    return d;
  }

  /* ---------- Giriş ve iki adımlı doğrulama ---------- */
  function login(msg = "") {
    app.innerHTML = `
      <div class="pl-login"><form data-login>
        <h1>passport.io · Mağaza yönetimi</h1>
        <p>Yalnızca ekip için. Erişim, Supabase'deki <b>ADMIN_EMAILS</b> listesindeki e-postalara açıktır.</p>
        <label class="pl-field">E-posta<input name="email" type="email" autocomplete="email" required></label>
        <label class="pl-field">Şifre<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="pl-btn pl-btn--green" type="submit">Giriş yap</button>
        <p class="pl-msg">${esc(msg)}</p>
        <p>Hesabın yok mu? Önce <a href="../account.html#register">hesap sayfasında</a> kayıt ol ve e-postanı doğrula.</p>
      </form></div>`;
    $("[data-login]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, m = $(".pl-msg");
      m.textContent = "";
      const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      if (error) { m.textContent = /invalid/i.test(error.message) ? "E-posta veya şifre hatalı." : error.message; return; }
      start();
    });
  }
  async function mfaChallenge(msg = "") {
    const { data } = await sb.auth.mfa.listFactors();
    const factor = (data?.totp || []).find((f) => f.status === "verified");
    if (!factor) return mfaSetup("Yönetim için iki adımlı doğrulama zorunlu. Lütfen kurulumu tamamla.");
    app.innerHTML = `
      <div class="pl-login"><form data-mfa>
        <h1>İki adımlı doğrulama</h1>
        <p>Doğrulama uygulamandaki (Google Authenticator, 1Password, Authy …) 6 haneli kodu gir.</p>
        <label class="pl-field">Kod<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
        <button class="pl-btn pl-btn--green" type="submit">Doğrula</button>
        <p class="pl-msg">${esc(msg)}</p>
        <button type="button" class="pl-btn pl-btn--line" data-logout>Çıkış yap</button>
      </form></div>`;
    $("[data-mfa]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: e.target.code.value.trim() });
      if (error) return mfaChallenge("Kod hatalı. Tekrar dene.");
      show();
    });
  }
  async function mfaSetup(msg = "") {
    // Yarım kalmış kurulumları temizle, yeni bir TOTP oluştur
    const { data: list } = await sb.auth.mfa.listFactors();
    for (const f of (list?.all || []).filter((x) => x.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "passport.io yönetim" });
    if (error) { shell("Güvenlik", `<div class="pl-card"><p>İki adımlı doğrulama başlatılamadı: ${esc(error.message)}. Supabase → Authentication → MFA altında TOTP açık mı?</p></div>`); return; }
    const body = `
      <div class="pl-card" style="max-width:560px"><h2>İki adımlı doğrulamayı kur</h2>
        <p class="pl-help">${esc(msg || "Yönetim hesabını şifre çalınmasına karşı korur.")} QR kodu doğrulama uygulamanla tara, ardından gösterilen 6 haneli kodu gir.</p>
        <img src="${esc(data.totp.qr_code)}" alt="QR" width="200" height="200" style="background:#fff;border-radius:12px;padding:8px">
        <p class="pl-help">Elle giriş anahtarı: <span class="mono">${esc(data.totp.secret)}</span></p>
        <form data-mfa-setup style="display:grid;gap:10px;max-width:260px"><label class="pl-field">Kod<input name="code" inputmode="numeric" maxlength="6" required></label><button class="pl-btn pl-btn--green" type="submit">Etkinleştir</button><p class="pl-msg"></p></form>
      </div>`;
    if ($(".pl")) { $(".pl-main").innerHTML = `<div class="pl-top"><h1>Güvenlik</h1></div>${body}`; } else app.innerHTML = `<div class="pl-login">${body}</div>`;
    $("[data-mfa-setup]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error: err } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: e.target.code.value.trim() });
      if (err) { $(".pl-msg", e.target).textContent = "Kod hatalı. Uygulamadaki güncel kodu gir."; return; }
      toast("İki adımlı doğrulama etkin.");
      location.hash = "overview"; show();
    });
  }

  /* ---------- İskelet ---------- */
  const NAV = [
    ["overview", "▦", "Genel bakış"], ["orders", "🧾", "Siparişler"], ["payments", "💳", "Ödemeler"],
    ["refunds", "↩", "İade talepleri"], ["support", "✉", "Destek talepleri"], ["questions", "💬", "Lina soruları"],
    ["customers", "👥", "Müşteriler"], ["esims", "📶", "eSIM'ler"], ["pricing", "₺", "Fiyatlar & rakipler"],
    ["settings", "⚙", "Entegrasyonlar"], ["audit", "📜", "İşlem kaydı"], ["security", "🔒", "Güvenlik"],
  ];
  let view = "overview", userEmail = "", counts = {};
  function shell(title, body) {
    app.innerHTML = `
      <div class="pl">
        <aside class="pl-side">
          <div class="pl-brand">passport<em>.io</em><small>Mağaza yönetimi</small></div>
          ${NAV.map(([id, ic, label]) => `<a class="pl-nav ${id === view ? "is-active" : ""}" href="#${id}"><i>${ic}</i>${label}${counts[id] ? `<span class="pl-count">${counts[id]}</span>` : ""}</a>`).join("")}
          <a class="pl-nav" href="./" target="_blank" rel="noopener"><i>✎</i>İçerikleri düzenle ↗</a>
          <div class="pl-sep"></div>
          <a class="pl-nav" href="../index.html" target="_blank" rel="noopener"><i>↗</i>Mağazayı gör</a>
        </aside>
        <main class="pl-main">
          <div class="pl-top">
            <div style="display:flex;gap:10px;align-items:center"><button class="pl-btn pl-btn--line pl-btn--sm pl-burger" data-menu>☰</button><h1>${esc(title)}</h1></div>
            <div class="pl-user">${esc(userEmail)} <button class="pl-btn pl-btn--line pl-btn--sm" data-logout>Çıkış yap</button></div>
          </div>
          ${body}
        </main>
      </div>`;
  }
  const loading = (title) => shell(title, `<p class="pl-loading">Yükleniyor …</p>`);
  const table = (head, rows, empty) => `<div class="pl-table-wrap"><table><thead><tr>${head.map((h) => `<th${h.startsWith("#") ? ' class="num"' : ""}>${esc(h.replace(/^#/, ""))}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="pl-empty">${esc(empty)}</td></tr>`}</tbody></table></div>`;

  /* Son 30 günün grafiği (SVG çubuklar) */
  function chart(days, cur) {
    const vals = days.map((d) => d.revenue[cur] || 0), max = Math.max(1, ...vals);
    const w = 720, h = 180, bw = w / days.length;
    const bars = days.map((d, i) => { const v = d.revenue[cur] || 0, bh = Math.round((v / max) * (h - 30)); return `<g><title>${day(d.day)} · ${money(v, cur)} · ${d.orders} sipariş</title><rect x="${(i * bw + 2).toFixed(1)}" y="${h - 20 - bh}" width="${(bw - 4).toFixed(1)}" height="${Math.max(bh, 1)}" rx="3" fill="${v ? "#2ef58a" : "#dfe8e3"}"/></g>`; }).join("");
    const labels = [0, 10, 20, 29].map((i) => `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${h - 4}" font-size="11" text-anchor="middle" fill="#6b7671">${day(days[i].day)}</text>`).join("");
    return `<svg viewBox="0 0 ${w} ${h}" class="pl-chart" role="img" aria-label="Son 30 gün ciro">${bars}${labels}</svg>`;
  }

  /* ---------- Görünümler ---------- */
  async function overview() {
    loading("Genel bakış");
    const d = await api("GET", "?view=overview");
    counts = { refunds: d.openRefunds, support: d.openSupport, questions: d.openQuestions };
    const rev = Object.entries(d.revenue);
    const cur = rev.sort((a, b) => b[1] - a[1])[0]?.[0] || "EUR";
    const s = d.status;
    const check = [
      ["eSIM Access (veri paketleri)", s.esimAccess, "Supabase secret: ESIMACCESS_ACCESS_CODE"],
      ["eSIM Go (sınırsız paketler)", s.esimGo, "Supabase secret: ESIMGO_API_KEY (+ ESIMGO_CURRENCY)"],
      ["Ödeme sağlayıcısı", !!s.payment, "Ödeme sağlayıcısını seç ve bağla (PAYMENT_PROVIDER)"],
      ["Google ile giriş", s.google, "Supabase → Authentication → Providers → Google"],
      ["Apple ile giriş", s.apple, "Supabase → Authentication → Providers → Apple"],
      ["İçerik editörü (GitHub)", s.cmsGithub, "GitHub OAuth uygulaması, GITHUB_CLIENT_ID/SECRET"],
      ["Test modu kapalı", !s.testOrders, "Yayından önce ALLOW_TEST_ORDERS secret'ını sil"],
      ["İki adımlı doğrulama", d.mfa?.hasFactor, "Menü → Güvenlik"],
    ];
    shell("Genel bakış", `
      <div class="pl-grid">
        <div class="pl-card pl-kpi"><span>Ciro (ödenmiş)</span><b>${rev.length ? rev.map(([c, v]) => esc(money(v, c))).join("<br>") : esc(money(0, "EUR"))}</b></div>
        <div class="pl-card pl-kpi"><span>Sipariş (30 gün)</span><b>${d.orders30}</b></div>
        <div class="pl-card pl-kpi"><span>Müşteri</span><b>${d.customers}</b></div>
        <div class="pl-card pl-kpi"><span>eSIM aktif / toplam</span><b>${d.esimsActive} / ${d.esims}</b></div>
      </div>
      <div class="pl-grid pl-grid--3">
        <a class="pl-card pl-kpi pl-link" href="#refunds"><span>Bekleyen iade talepleri</span><b class="${d.openRefunds ? "warn" : ""}">${d.openRefunds}</b></a>
        <a class="pl-card pl-kpi pl-link" href="#support"><span>Açık destek talepleri</span><b class="${d.openSupport ? "warn" : ""}">${d.openSupport}</b></a>
        <a class="pl-card pl-kpi pl-link" href="#questions"><span>Lina'nın yanıtlayamadığı sorular</span><b>${d.openQuestions}</b></a>
      </div>
      <div class="pl-card" style="margin-bottom:14px"><h2>Son 30 gün <small>ciro (${esc(cur)}) ve sipariş · test siparişleri hariç</small></h2>${chart(d.days, cur)}</div>
      <div class="pl-two">
        <div class="pl-card"><h2>Son siparişler</h2>${ordersTable(d.recent, false)}</div>
        <div class="pl-card"><h2>Yayına hazır mı? <small>satış kontrol listesi</small></h2>
          <div class="pl-check">${check.map(([l, ok, how]) => `<div><span>${esc(l)}${ok ? "" : `<small>${esc(how)}</small>`}</span><span class="pl-badge ${ok ? "ok" : "warn"}">${ok ? "Tamam" : "Eksik"}</span></div>`).join("")}</div>
          <h2 style="margin-top:18px">Sipariş durumları</h2>
          <div class="pl-check">${Object.entries(d.byStatus).map(([k, v]) => `<div><span>${esc(ORDER_ST[k])}</span><b>${v}</b></div>`).join("")}</div>
        </div>
      </div>`);
  }

  function ordersTable(list, editable = true) {
    return table(["Tarih", "Müşteri", "Ürün", "#Tutar", "Durum"], list.map((o) => `<tr><td>${esc(date(o.created_at))}</td><td>${esc(o.email || o.customer_email || "–")}</td><td>${esc(o.item_key)} · ${esc(o.title || "")}${o.test ? ' <span class="pl-badge warn">Test</span>' : ""}</td>
        <td class="num">${esc(money(o.amount, o.currency))}</td>
        <td>${editable ? `<select data-order="${esc(o.id)}">${Object.entries(ORDER_ST).map(([k, l]) => `<option value="${k}" ${k === o.status ? "selected" : ""}>${l}</option>`).join("")}</select>${o.status === "paid" ? ` <button class="pl-btn pl-btn--green" data-fulfill="${esc(o.id)}" title="Sağlayıcıdan eSIM satın alır ve müşteriye teslim eder">eSIM teslim et</button>` : ""}` : badge(o.status, ORDER_ST)}</td></tr>`), "Henüz sipariş yok.");
  }

  async function orders() {
    loading("Siparişler");
    const st = sessionStorage.getItem("pl_ost") || "";
    const d = await api("GET", `?view=orders${st ? "&status=" + st : ""}`);
    shell("Siparişler", `
      <div class="pl-tools"><label class="pl-field">Durum<select data-ofilter><option value="">Tümü</option>${Object.entries(ORDER_ST).map(([k, l]) => `<option value="${k}" ${k === st ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="pl-btn pl-btn--line" data-csv="orders">CSV indir</button></div>
      <p class="pl-help">Durum değişikliği yalnızca kaydı günceller. <b>Para iadesini</b> ayrıca ödeme sağlayıcısında başlat. Durumu <b>Ödendi</b> olan siparişlerde <b>eSIM teslim et</b>, eSIM'i sağlayıcıdan (eSIM Access / eSIM Go) gerçekten satın alır – bakiyenizden düşülür.</p>
      <div class="pl-card">${ordersTable(d.orders)}</div>`);
    lastCsv = { name: "siparisler", rows: d.orders.map((o) => ({ tarih: o.created_at, musteri: o.email, urun: o.item_key, tarife: o.title, tutar: o.amount, para: o.currency, durum: ORDER_ST[o.status], test: o.test ? "evet" : "" })) };
  }

  async function payments() {
    loading("Ödemeler");
    const d = await api("GET", "?view=payments");
    const sums = (o) => Object.entries(o).map(([c, v]) => esc(money(v, c))).join("<br>") || esc(money(0, "EUR"));
    shell("Ödemeler", `
      <div class="pl-grid pl-grid--3">
        <div class="pl-card pl-kpi"><span>Brüt tahsilat</span><b>${sums(d.gross)}</b></div>
        <div class="pl-card pl-kpi"><span>İade edilen</span><b>${sums(d.refunded)}</b></div>
        <div class="pl-card pl-kpi"><span>Ödeme kaydı</span><b>${d.payments.length}</b></div>
      </div>
      <div class="pl-tools"><button class="pl-btn pl-btn--line" data-csv="payments">CSV indir (muhasebe)</button></div>
      <div class="pl-card">${table(["Tarih", "Müşteri", "Ürün", "#Tutar", "#İade", "Sağlayıcı", "Ödeme no", "Durum"], d.payments.map((p) => `<tr><td>${esc(date(p.paid_at || p.created_at))}</td><td>${esc(p.customer_email || "–")}</td><td>${esc(p.item_key)} · ${esc(p.title || "")}${p.test ? ' <span class="pl-badge warn">Test</span>' : ""}</td><td class="num">${esc(money(p.amount, p.currency))}</td><td class="num">${p.refunded_amount ? esc(money(p.refunded_amount, p.currency)) : "–"}</td><td>${esc(p.payment_provider || "–")}</td><td><span class="mono">${esc(p.payment_ref || "–")}</span></td><td>${badge(p.status, ORDER_ST)}</td></tr>`), "Henüz ödeme yok. Ödeme sağlayıcısı bağlandığında ödemeler burada görünür.")}</div>`);
    lastCsv = { name: "odemeler", rows: d.payments.map((p) => ({ tarih: p.paid_at || p.created_at, musteri: p.customer_email, urun: p.item_key, tutar: p.amount, iade: p.refunded_amount, para: p.currency, saglayici: p.payment_provider, odeme_no: p.payment_ref, durum: ORDER_ST[p.status], test: p.test ? "evet" : "" })) };
  }

  async function refunds() {
    loading("İade talepleri");
    const d = await api("GET", "?view=refunds");
    shell("İade talepleri", `
      <p class="pl-help">Müşteriler, <b>kurulmamış</b> eSIM'ler için süre içinde iade talep edebilir. <b>Onayla</b> → sipariş “İade edildi”, eSIM kapatılır. Para iadesini ödeme sağlayıcısında yap.</p>
      <div class="pl-card">${table(["Tarih", "Müşteri", "Sipariş", "#Tutar", "Gerekçe", "Durum", ""], d.refunds.map((r) => `<tr><td>${esc(date(r.created_at))}</td><td>${esc(r.customer_email || "–")}</td><td>${esc(r.orders?.item_key || "")} · ${esc(r.orders?.title || "")}</td><td class="num">${r.orders ? esc(money(r.orders.amount, r.orders.currency)) : "–"}</td><td>${esc(r.reason || "–")}${r.admin_note ? `<br><small class="pl-note">Not: ${esc(r.admin_note)}</small>` : ""}</td><td>${badge(r.status, REF_ST)}${r.decided_by ? `<br><small class="pl-note">${esc(r.decided_by)}</small>` : ""}</td>
        <td>${r.status === "open" ? `<div class="pl-actions"><button class="pl-btn pl-btn--green pl-btn--sm" data-refund="${esc(r.id)}" data-decision="approve">Onayla</button><button class="pl-btn pl-btn--red pl-btn--sm" data-refund="${esc(r.id)}" data-decision="reject">Reddet</button></div>` : ""}</td></tr>`), "İade talebi yok.")}</div>`);
  }

  async function support() {
    loading("Destek talepleri");
    const d = await api("GET", "?view=support");
    shell("Destek talepleri", `
      <p class="pl-help">Hesap sayfasından ve Lina'nın “Bir insanla konuşmak istiyorum” akışından gelen talepler. Müşteriye e-postayla yanıt ver, sonra durumu güncelle.</p>
      <div class="pl-card">${table(["Tarih", "Kimden", "Konu", "Mesaj", "Durum"], d.tickets.map((t) => `<tr><td>${esc(date(t.created_at))}</td><td>${esc(t.name || "")}<br><a href="mailto:${esc(t.email)}">${esc(t.email)}</a></td><td>${esc(t.subject || "–")}</td><td class="pl-msgcell">${esc(t.message)}</td>
        <td><select data-ticket="${esc(t.id)}">${Object.entries(SUP_ST).map(([k, l]) => `<option value="${k}" ${k === t.status ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`), "Destek talebi yok.")}</div>`);
  }

  async function questions() {
    loading("Lina soruları");
    const d = await api("GET", "?view=questions");
    shell("Lina soruları", `
      <p class="pl-help">Lina'nın yanıtlayamadığı sorular. Sık gelenler için içerik editöründe (<b>Yardım merkezi → Asistan & SSS</b>) yeni bir SSS ekle, sonra “İşlendi” olarak işaretle.</p>
      <div class="pl-card">${table(["Tarih", "Soru", "Sayfa", ""], d.questions.map((q) => `<tr><td>${esc(date(q.created_at))}</td><td>${esc(q.question)}</td><td>${esc(q.page || "–")}</td><td>${q.handled ? '<span class="pl-badge ok">İşlendi</span>' : `<button class="pl-btn pl-btn--line pl-btn--sm" data-question="${esc(q.id)}">İşlendi</button>`}</td></tr>`), "Soru yok.")}</div>`);
  }

  async function customers() {
    loading("Müşteriler");
    const d = await api("GET", "?view=customers");
    shell("Müşteriler", `
      <div class="pl-tools"><label class="pl-field">Ara<input data-search placeholder="E-posta veya ad"></label></div>
      <div class="pl-card">${table(["E-posta", "Ad", "Dil", "Kayıt", "Son giriş", "Giriş yöntemi", "#Sipariş (ödenmiş/toplam)", "Bülten"], d.customers.map((c) => `<tr data-row="${esc((c.email + " " + (c.full_name || "")).toLowerCase())}"><td>${esc(c.email)}</td><td>${esc(c.full_name || "–")}</td><td>${esc((c.language || "–").toUpperCase())}</td><td>${esc(date(c.created_at))}</td><td>${esc(date(c.last_sign_in_at))}</td><td>${esc((c.providers || []).join(", "))}</td><td class="num">${c.paid} / ${c.orders}</td><td>${c.marketing ? '<span class="pl-badge ok">Evet</span>' : "–"}</td></tr>`), "Henüz müşteri yok.")}</div>`);
  }

  async function esims() {
    loading("eSIM'ler");
    const d = await api("GET", "?view=esims");
    shell("eSIM'ler", `
      <div class="pl-card">${table(["Tarih", "Müşteri", "Ülke", "Tarife", "ICCID", "#Kullanım", "Bitiş", "Durum"], d.esims.map((e) => `<tr><td>${esc(date(e.created_at))}</td><td>${esc(e.email)}</td><td>${esc((e.country || "").toUpperCase())}</td><td>${esc(e.plan_name || "")}${e.test ? ' <span class="pl-badge warn">Test</span>' : ""}</td><td><span class="mono">${esc(e.iccid || "–")}</span></td>
        <td class="num">${esc(gb(e.data_used_mb))} / ${esc(e.unlimited ? "Sınırsız" : gb(e.data_total_mb))}</td><td>${esc(e.expires_at ? date(e.expires_at) : "aktivasyonla başlar")}</td>
        <td><select data-esim="${esc(e.id)}">${Object.entries(ESIM_ST).map(([k, l]) => `<option value="${k}" ${k === e.status ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`), "Henüz eSIM yok.")}</div>`);
  }

  async function pricing() {
    loading("Fiyatlar & rakipler");
    const d = await api("GET", "?view=pricing");
    const s = d.settings, p = d.preview;
    const ruleLabel = (r) => ({ competitor: "Rakip − 1 tık", markup: "Alış × çarpan" }[String(r).split("+")[0]] || r) + (String(r).includes("+floor") ? " → alt sınır" : "");
    shell("Fiyatlar & rakipler", `
      <div class="pl-card" style="margin-bottom:14px"><h2>Fiyat kuralı</h2>
        <p class="pl-help">Aynı ürün için (aynı ülke, veri miktarı, süre) <b>rakip fiyatı</b> varsa (ör. Airalo), en ucuz rakibin <b>bir tık altındaki ,99 fiyatı</b> kullanılır (10,06 € → 9,99 € · 9,99 € → 8,99 €). Yoksa <b>alış fiyatı × çarpan</b>, en yakın ,99'a yuvarlanır. Fiyat hiçbir zaman <b>en düşük fiyatın</b> (2,99 €) ve <b>alış + asgari kâr marjının</b> altına inmez (zararına satış koruması; 0 % = alış fiyatının altına inmez).</p>
        <form class="pl-form" data-settings>
          <label class="pl-field">Çarpan (rakip yoksa)<input name="markup_factor" type="number" step="0.01" min="1" value="${esc(s.markup_factor)}"></label>
          <label class="pl-field">Rakibin altında (€, sonra ,99'a yuvarlanır)<input name="undercut_eur" type="number" step="0.01" min="0" value="${esc(s.undercut_eur)}"></label>
          <label class="pl-field">En düşük fiyat (€)<input name="min_price_eur" type="number" step="0.01" min="0" value="${esc(s.min_price_eur)}"></label>
          <label class="pl-field">Asgari kâr marjı (%)<input name="min_margin_pct" type="number" step="1" min="0" value="${esc(s.min_margin_pct)}"></label>
          <label class="pl-field">,99'a yuvarla<select name="round_99"><option value="1" ${s.round_99 ? "selected" : ""}>Evet</option><option value="0" ${s.round_99 ? "" : "selected"}>Hayır</option></select></label>
          <button class="pl-btn pl-btn--green" type="submit">Kaydet</button>
        </form>
      </div>
      <div class="pl-card" style="margin-bottom:14px"><h2>Rakip fiyatları <small>${d.competitors.length} kayıt</small></h2>
        <p class="pl-help">Ürün anahtarı: <b>country:jp</b>, <b>region:europe</b>, <b>global</b>, <b>lounge</b>, <b>fasttrack</b>. GB/gün boş = tüm varyantlar için geçerli; <b>GB = 0 sınırsız paket</b> demektir. Fiyatlar değişir – <b>düzenli olarak kontrol et</b> (“Kontrol” sütunu).</p>
        <form class="pl-form pl-form--comp" data-comp>
          <label class="pl-field">Ürün<input name="item_key" placeholder="country:jp" required></label>
          <label class="pl-field">GB<input name="gb" type="number" step="0.1" min="0"></label>
          <label class="pl-field">Gün<input name="days" type="number" step="1" min="0"></label>
          <label class="pl-field">Fiyat<input name="price" type="number" step="0.01" min="0.01" required></label>
          <label class="pl-field">Para birimi<input name="currency" value="EUR" maxlength="3" required></label>
          <label class="pl-field">Rakip<input name="competitor" placeholder="ör. Nomad" required></label>
          <label class="pl-field">Kaynak (link)<input name="url" type="url" placeholder="https://"></label>
          <button class="pl-btn" type="submit">Ekle</button>
        </form>
        <details style="margin:14px 0"><summary style="cursor:pointer;font-weight:600">CSV içe aktar</summary>
          <p class="pl-help" style="margin-top:10px">Her satırda bir fiyat: <b>ürün;gb;gün;fiyat;para;rakip;link</b> – ör. <span class="mono">country:jp;5;30;9.50;USD;Nomad;https://…</span></p>
          <form data-import style="display:grid;gap:10px"><label class="pl-field">Veri<textarea name="csv" placeholder="country:jp;5;30;9.50;USD;Nomad;https://..."></textarea></label><button class="pl-btn pl-btn--line" type="submit" style="justify-self:start">İçe aktar</button></form>
        </details>
        ${table(["Ürün", "#GB", "#Gün", "#Fiyat", "Rakip", "Kontrol", ""], d.competitors.map((c) => `<tr><td>${esc(c.item_key)}</td><td class="num">${esc(c.gb == null ? "tümü" : Number(c.gb) === 0 ? "Sınırsız" : c.gb)}</td><td class="num">${esc(c.days ?? "tümü")}</td><td class="num">${esc(money(c.price, c.currency))}</td><td>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.competitor)}</a>` : esc(c.competitor)}</td><td>${esc(date(c.checked_at))}</td><td><button class="pl-btn pl-btn--red pl-btn--sm" data-del="${esc(c.id)}">Sil</button></td></tr>`), "Henüz rakip fiyatı yok – alış × çarpan uygulanır.")}
      </div>
      <div class="pl-card"><h2>Satış fiyatı önizlemesi <small>${p.source === "mock" ? "test verilerine göre" : "sağlayıcı alış fiyatlarına göre"} · ${esc(p.currency)}</small></h2>
        <div class="pl-tools"><label class="pl-field">Filtre<input data-pfilter placeholder="ör. country:jp"></label></div>
        ${table(["Ürün", "Tarife", "#Alış", "Rakip", "#Satış fiyatı", "#Marj", "Kural"], p.rows.map((r) => { const m = r.cost ? Math.round(((r.price - r.cost) / r.price) * 100) : null; return `<tr data-prow="${esc(r.key)}"><td>${esc(r.key)}</td><td>${r.unlimited ? `Sınırsız · ${esc(r.days)} gün` : r.gb ? `${esc(r.gb)} GB · ${esc(r.days)} gün` : esc(r.name || r.id)}</td><td class="num">${esc(money(r.cost, p.currency))}</td><td>${esc(r.competitor || "–")}</td><td class="num"><b>${esc(money(r.price, p.currency))}</b></td><td class="num">${m != null ? "%" + m : "–"}</td><td><span class="pl-badge ${String(r.rule).startsWith("competitor") ? "ok" : ""}">${esc(ruleLabel(r.rule))}</span></td></tr>`; }), "Önizleme yok.")}
      </div>`);
  }

  async function settings() {
    loading("Entegrasyonlar");
    const d = await api("GET", "?view=overview");
    const s = d.status;
    const row = (label, ok, how, link) => `<div><span><b>${esc(label)}</b><small>${how}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">aç ↗</a>` : ""}</small></span><span class="pl-badge ${ok ? "ok" : "warn"}">${ok ? "Aktif" : "Eksik"}</span></div>`;
    shell("Entegrasyonlar", `
      <p class="pl-help">API anahtarları ve şifreler <b>asla</b> koda veya bu sayfaya yazılmaz. Supabase'de <b>secret</b> olarak saklanır – yalnızca sunucu okuyabilir.</p>
      <div class="pl-two">
        <div class="pl-card"><h2>Sağlayıcı arayüzleri</h2><div class="pl-check">
          ${row("eSIM Access – veri paketleri", s.esimAccess, "Secret: ESIMACCESS_ACCESS_CODE (console.esimaccess.com → Developer). Bakiye yüklü olmalı.", dash("settings/functions"))}
          ${row("eSIM Go – sınırsız paketler", s.esimGo, "Secret: ESIMGO_API_KEY (sso.esim-go.com → Account Settings → API Details), ESIMGO_CURRENCY (ör. USD)", dash("settings/functions"))}
          ${row("Lounge sağlayıcısı", s.lounge, "Secret: LOUNGE_API_URL, LOUNGE_API_KEY", dash("settings/functions"))}
          ${row("Fast Track sağlayıcısı", s.fasttrack, "Secret: FASTTRACK_API_URL, FASTTRACK_API_KEY", dash("settings/functions"))}
          ${row("Ödeme sağlayıcısı", !!s.payment, "Secret: PAYMENT_PROVIDER + sağlayıcı anahtarları", dash("settings/functions"))}
          ${row("Test modu kapalı", !s.testOrders, "ALLOW_TEST_ORDERS ödemesiz test eSIM'i üretir – yayından önce sil", dash("settings/functions"))}
          ${row("Para birimleri", true, `Aktif: ${esc(s.currencies)} (secret CURRENCIES)`, dash("settings/functions"))}
        </div></div>
        <div class="pl-card"><h2>Giriş & e-posta</h2><div class="pl-check">
          ${row("Google ile giriş", s.google, "Google Cloud: OAuth istemcisi, yönlendirme …/auth/v1/callback", dash("auth/providers"))}
          ${row("Apple ile giriş", s.apple, "Apple Developer: Services ID + anahtar", dash("auth/providers"))}
          ${row("E-posta şablonları", true, "supabase/templates içeriğini yapıştır", dash("auth/templates"))}
          ${row("Kendi e-posta gönderimi (SMTP)", false, "Yayından önce zorunlu – ör. Resend, Brevo, Postmark", dash("settings/auth"))}
          ${row("Bot koruması (CAPTCHA)", false, "Supabase → Authentication → Attack Protection → Turnstile/hCaptcha", dash("auth/protection"))}
          ${row("Yönlendirme adresleri", true, "Yayındaki alan adının account.html adresini ekle", dash("auth/url-configuration"))}
          ${row("İçerik editörü (GitHub)", s.cmsGithub, "GitHub OAuth uygulaması, GITHUB_CLIENT_ID/SECRET", dash("settings/functions"))}
        </div></div>
      </div>`);
  }

  async function audit() {
    loading("İşlem kaydı");
    const d = await api("GET", "?view=audit");
    shell("İşlem kaydı", `
      <p class="pl-help">Yönetim panelindeki tüm değişiklikler: kim, ne zaman, ne yaptı.</p>
      <div class="pl-card">${table(["Tarih", "Yönetici", "İşlem", "Hedef"], d.audit.map((a) => `<tr><td>${esc(date(a.created_at))}</td><td>${esc(a.admin_email)}</td><td>${esc(a.action)}</td><td><span class="mono">${esc(a.target || "–")}</span></td></tr>`), "Henüz kayıt yok.")}</div>`);
  }

  async function security() {
    loading("Güvenlik");
    const { data } = await sb.auth.mfa.listFactors();
    const verified = (data?.totp || []).filter((f) => f.status === "verified");
    shell("Güvenlik", `
      <div class="pl-card" style="max-width:640px"><h2>İki adımlı doğrulama (2FA)</h2>
        <p class="pl-help">Etkinleştirdikten sonra panele girişte şifrenin yanında doğrulama uygulamasındaki kod da istenir. Tüm yöneticiler için zorunlu kılmak için Supabase secret: <b>ADMIN_REQUIRE_MFA=true</b>.</p>
        ${verified.length ? `<p><span class="pl-badge ok">Etkin</span> ${verified.map((f) => esc(f.friendly_name || "TOTP")).join(", ")}</p>` : `<button class="pl-btn pl-btn--green" data-mfa-start>Kurulumu başlat</button>`}
      </div>`);
  }

  const VIEWS = { overview, orders, payments, refunds, support, questions, customers, esims, pricing, settings, audit, security };
  let lastCsv = null;
  async function show() {
    view = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
    try { await VIEWS[view](); }
    catch (err) {
      if (err.status === 401) return login();
      if (err.message === "mfa_required") return mfaChallenge();
      if (err.message === "mfa_setup_required") return mfaSetup("Yönetim için iki adımlı doğrulama zorunlu.");
      if (err.status === 403) { await sb.auth.signOut(); return login("Bu hesabın yönetim yetkisi yok. E-postayı Supabase secret ADMIN_EMAILS listesine ekle (ve e-postanı doğrula)."); }
      shell("Hata", `<div class="pl-card"><p>Veriler yüklenemedi (${esc(err.message)}). “admin” fonksiyonu yayında mı?</p></div>`);
    }
  }
  const csvDownload = () => {
    if (!lastCsv?.rows.length) return toast("İndirilecek veri yok.");
    const cols = Object.keys(lastCsv.rows[0]);
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const text = "﻿" + [cols.join(";"), ...lastCsv.rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = `${lastCsv.name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  /* ---------- Olaylar ---------- */
  app.addEventListener("click", async (e) => {
    if (e.target.closest("[data-logout]")) { await sb.auth.signOut(); return login(); }
    if (e.target.closest("[data-menu]")) { $(".pl").classList.toggle("menu-open"); return; }
    if (e.target.closest("[data-csv]")) return csvDownload();
    if (e.target.closest("[data-mfa-start]")) return mfaSetup();
    const del = e.target.closest("[data-del]");
    if (del) { del.disabled = true; await api("POST", "", { action: "competitor_delete", id: del.dataset.del }); toast("Silindi."); return pricing(); }
    const rf = e.target.closest("[data-refund]");
    if (rf) {
      const note = rf.dataset.decision === "reject" ? (prompt("Ret gerekçesi (müşteriye iletmek için not):") ?? null) : "";
      if (note === null) return;
      rf.disabled = true;
      await api("POST", "", { action: "refund_decide", id: rf.dataset.refund, decision: rf.dataset.decision, note }).then(() => toast("Kaydedildi."), () => toast("Kaydedilemedi."));
      return refunds();
    }
    const ff = e.target.closest("[data-fulfill]");
    if (ff) {
      if (!ff.dataset.confirm) { ff.dataset.confirm = "1"; ff.textContent = "Emin misin? Tekrar tıkla"; setTimeout(() => { if (ff.isConnected) { delete ff.dataset.confirm; ff.textContent = "eSIM teslim et"; } }, 5000); return; }
      ff.disabled = true; ff.textContent = "Teslim ediliyor…";
      await api("POST", "", { action: "order_fulfill", id: ff.dataset.fulfill }).then(
        (r) => toast(r.already ? "Bu siparişin eSIM'i zaten var." : r.esimStatus === "processing" ? "Sipariş verildi – profil hazırlanıyor, müşteri birkaç dakika içinde görür." : "eSIM teslim edildi."),
        (err) => toast("Teslim edilemedi: " + (err.message || "hata")));
      return orders();
    }
    const q = e.target.closest("[data-question]");
    if (q) { q.disabled = true; await api("POST", "", { action: "question_handled", id: q.dataset.question }); toast("İşlendi."); return questions(); }
  });
  app.addEventListener("change", async (e) => {
    const o = e.target.closest("[data-order]");
    if (o) { await api("POST", "", { action: "order_status", id: o.dataset.order, status: o.value }).then(() => toast("Durum kaydedildi."), () => toast("Kaydedilemedi.")); return; }
    const es = e.target.closest("[data-esim]");
    if (es) { await api("POST", "", { action: "esim_status", id: es.dataset.esim, status: es.value }).then(() => toast("Durum kaydedildi."), () => toast("Kaydedilemedi.")); return; }
    const t = e.target.closest("[data-ticket]");
    if (t) { await api("POST", "", { action: "support_update", id: t.dataset.ticket, status: t.value }).then(() => toast("Durum kaydedildi."), () => toast("Kaydedilemedi.")); return; }
    if (e.target.matches("[data-ofilter]")) { sessionStorage.setItem("pl_ost", e.target.value); orders(); }
  });
  app.addEventListener("input", (e) => {
    if (e.target.matches("[data-search]")) { const q = e.target.value.trim().toLowerCase(); $$("[data-row]").forEach((r) => (r.hidden = !!q && !r.dataset.row.includes(q))); }
    if (e.target.matches("[data-pfilter]")) { const q = e.target.value.trim().toLowerCase(); $$("[data-prow]").forEach((r) => (r.hidden = !!q && !r.dataset.prow.includes(q))); }
  });
  app.addEventListener("submit", async (e) => {
    const f = e.target;
    if (!f.matches("[data-settings], [data-comp], [data-import]")) return;
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const btn = $("button[type=submit]", f); if (btn) btn.disabled = true;
    try {
      if (f.matches("[data-settings]")) { await api("POST", "", { action: "pricing_settings", ...d, round_99: d.round_99 === "1" }); toast("Fiyat kuralı kaydedildi – sitede hemen geçerli."); return pricing(); }
      if (f.matches("[data-comp]")) { await api("POST", "", { action: "competitor_save", ...d }); toast("Rakip fiyatı kaydedildi."); return pricing(); }
      const rows = String(d.csv || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(ürün|urun|produkt)/i.test(l)).map((l) => {
        const [item_key, gbv, days, price, currency, competitor, url] = l.split(/[;\t]/).map((x) => (x ?? "").trim());
        return { item_key, gb: gbv, days, price: String(price || "").replace(",", "."), currency: currency || "EUR", competitor, url };
      });
      const r = await api("POST", "", { action: "competitor_import", rows });
      toast(`${r.imported} kayıt eklendi${r.skipped ? `, ${r.skipped} atlandı (biçimi kontrol et)` : ""}.`);
      return pricing();
    } catch (err) { toast(err.message === "invalid" ? "Girdileri kontrol et." : "Kaydedilemedi."); }
    finally { if (btn) btn.disabled = false; }
  });
  window.addEventListener("hashchange", () => { $(".pl")?.classList.remove("menu-open"); show(); });

  async function start() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return login();
    userEmail = session.user.email || "";
    // İki adımlı doğrulaması olan hesaplar önce kodu girer
    // (Der Server prüft die Stufe ohnehin selbst; ein Fehler hier blockiert das Panel nicht)
    try {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") return mfaChallenge();
    } catch (_) { /* weiter, der Server entscheidet */ }
    show();
  }
  start();
})();
