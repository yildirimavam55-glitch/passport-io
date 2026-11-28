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
  // Ürün anahtarını okunur yap: country:de → Almanya, region:eu → Avrupa, global → Global
  const itemName = (key) => { const [type, id] = String(key || "").split(":"); if (type === "country" && id) { try { return new Intl.DisplayNames(["tr"], { type: "region" }).of(id.toUpperCase()); } catch (_) { return id; } } if (type === "global") return "Global"; return ({ eu: "Avrupa", europe: "Avrupa", asia: "Asya", na: "Kuzey Amerika", me: "Orta Doğu", latam: "Latin Amerika", af: "Afrika", africa: "Afrika" })[id] || key || "–"; };
  const planTitle = (t) => String(t || "").replace(/· (\d+)$/, "· $1 gün");
  const product = (key, title) => `<b>${esc(itemName(key))}</b>${title ? ` · ${esc(planTitle(title))}` : ""}`;
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
    ["", "", "Genel"], ["overview", "◧", "Genel bakış"],
    ["", "", "Satış"], ["orders", "🧾", "Siparişler"], ["payments", "💳", "Ödemeler"], ["refunds", "↩", "İade talepleri"], ["esims", "📶", "eSIM'ler"], ["airport", "🛋", "Lounge & Fast Track"], ["discounts", "🏷", "İndirim kodları"],
    ["", "", "Müşteriler"], ["customers", "👥", "Müşteriler"], ["newsletter", "📨", "Bülten"], ["popup", "🎁", "Pop-up & kampanya"], ["support", "✉", "Destek talepleri"], ["questions", "💬", "Lina soruları"],
    ["", "", "Online mağaza"], ["editor", "✎", "Mağaza editörü"], ["guides", "📖", "Rehberler"], ["translations", "🌐", "Diller & çeviri"], ["pricing", "₺", "Fiyatlar & rakipler"],
    ["", "", "Ayarlar"], ["settings", "⚙", "Entegrasyonlar"], ["audit", "📜", "İşlem kaydı"], ["security", "🔒", "Güvenlik"],
  ];
  let view = "overview", userEmail = "", counts = {};
  function shell(title, body, sub = "") {
    app.innerHTML = `
      <div class="pl">
        <aside class="pl-side">
          <div class="pl-brand"><span class="pl-logo">◉</span><span>passport<em>.io</em><small>Mağaza yönetimi</small></span></div>
          ${NAV.map(([id, ic, label]) => !id ? `<div class="pl-group">${esc(label)}</div>` : `<a class="pl-nav ${id === view ? "is-active" : ""}" href="#${id}"><i>${ic}</i>${label}${counts[id] ? `<span class="pl-count">${counts[id]}</span>` : ""}</a>`).join("")}
          <div class="pl-sep"></div>
          <a class="pl-nav" href="../index.html" target="_blank" rel="noopener"><i>↗</i>Mağazayı gör</a>
        </aside>
        <main class="pl-main">
          <div class="pl-top">
            <div style="display:flex;gap:12px;align-items:center"><button class="pl-btn pl-btn--line pl-btn--sm pl-burger" data-menu>☰</button><h1>${esc(title)}${sub ? `<span class="pl-sub">${esc(sub)}</span>` : ""}</h1></div>
            <div class="pl-user"><span class="pl-avatar">${esc((userEmail || "?").slice(0, 1).toUpperCase())}</span><span>${esc(userEmail)}</span> <button class="pl-btn pl-btn--line pl-btn--sm" data-logout>Çıkış</button></div>
          </div>
          ${body}
        </main>
      </div>`;
    // Spaltennamen an jede Zelle hängen – am Handy werden Tabellen zu Karten (siehe panel.css)
    app.querySelectorAll(".pl-table-wrap table").forEach((tb) => {
      const heads = [...tb.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      tb.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => { if (heads[i] && !td.hasAttribute("colspan")) td.dataset.label = heads[i]; }));
    });
  }
  const loading = (title) => shell(title, `<p class="pl-loading">Yükleniyor …</p>`);
  const table = (head, rows, empty) => `<div class="pl-table-wrap"><table><thead><tr>${head.map((h) => `<th${h.startsWith("#") ? ' class="num"' : ""}>${esc(h.replace(/^#/, ""))}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="pl-empty">${esc(empty)}</td></tr>`}</tbody></table></div>`;

  /* ---------- Dashboard-Bausteine ---------- */
  const eurF = (n) => money(n, "EUR");
  const delta = (cur, prev) => {
    if (!prev && !cur) return `<span class="pl-delta flat">±0 %</span>`;
    if (!prev) return `<span class="pl-delta up">▲ yeni</span>`;
    const p = Math.round(((cur - prev) / prev) * 100);
    return `<span class="pl-delta ${p > 0 ? "up" : p < 0 ? "down" : "flat"}">${p > 0 ? "▲" : p < 0 ? "▼" : "±"} ${Math.abs(p)} %</span>`;
  };
  // Mini-Kurve für eine KPI-Karte
  const spark = (vals) => {
    if (!vals.length) return "";
    const max = Math.max(1, ...vals), w = 96, h = 34, step = w / Math.max(1, vals.length - 1);
    const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`).join(" ");
    return `<svg class="pl-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#2ef58a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/></svg>`;
  };
  // Große Umsatzkurve (Fläche + Bestellbalken) mit Hover-Tooltip
  function areaChart(series) {
    const w = 760, h = 230, pad = { l: 8, r: 8, t: 14, b: 26 };
    const vals = series.map((d) => d.revenue), maxV = Math.max(1, ...vals), maxO = Math.max(1, ...series.map((d) => d.orders));
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b, step = iw / Math.max(1, series.length - 1);
    const x = (i) => pad.l + i * step, y = (v) => pad.t + ih - (v / maxV) * ih;
    const line = series.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.revenue).toFixed(1)}`).join("");
    const area = `${line}L${x(series.length - 1).toFixed(1)},${pad.t + ih}L${x(0).toFixed(1)},${pad.t + ih}Z`;
    const bw = Math.max(2, Math.min(14, step * 0.5));
    const bars = series.map((d, i) => d.orders ? `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(pad.t + ih - (d.orders / maxO) * ih * 0.35).toFixed(1)}" width="${bw.toFixed(1)}" height="${((d.orders / maxO) * ih * 0.35).toFixed(1)}" rx="2" fill="#6aa8ff" opacity=".35"/>` : "").join("");
    const grid = [0.25, 0.5, 0.75, 1].map((f) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${(pad.t + ih - f * ih).toFixed(1)}" y2="${(pad.t + ih - f * ih).toFixed(1)}" stroke="#1e2925" stroke-dasharray="3 5"/>`).join("");
    const n = series.length, ticks = [0, Math.round(n / 3), Math.round((2 * n) / 3), n - 1].filter((v, i, a) => a.indexOf(v) === i);
    const labels = ticks.map((i) => `<text x="${x(i).toFixed(1)}" y="${h - 6}" font-size="11" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" fill="#7f8d87">${day(series[i].day)}</text>`).join("");
    return `<div class="pl-chartwrap"><svg viewBox="0 0 ${w} ${h}" class="pl-chart" data-chart role="img" aria-label="Ciro grafiği">
      <defs><linearGradient id="plg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2ef58a" stop-opacity=".35"/><stop offset="1" stop-color="#2ef58a" stop-opacity="0"/></linearGradient></defs>
      ${grid}${bars}<path d="${area}" fill="url(#plg)"/><path d="${line}" fill="none" stroke="#2ef58a" stroke-width="2.2" stroke-linejoin="round"/>
      <line data-cursor x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" stroke="#2ef58a" stroke-opacity=".5" visibility="hidden"/>
      <circle data-dot r="4.5" fill="#070a09" stroke="#2ef58a" stroke-width="2.5" visibility="hidden"/>${labels}
      <rect x="0" y="0" width="${w}" height="${h}" fill="transparent" data-hit/></svg><div class="pl-tip" hidden></div></div>
      <div class="pl-legend"><span><i style="background:#2ef58a"></i>Ciro (EUR)</span><span><i style="background:#6aa8ff;opacity:.6"></i>Sipariş</span></div>`;
  }
  function wireChart(el, series) {
    const svg = $("[data-chart]", el); if (!svg) return;
    const tip = $(".pl-tip", el), cur = $("[data-cursor]", svg), dot = $("[data-dot]", svg);
    const w = 760, h = 230, pad = { l: 8, r: 8, t: 14, b: 26 }, ih = h - pad.t - pad.b, maxV = Math.max(1, ...series.map((d) => d.revenue));
    const step = (w - pad.l - pad.r) / Math.max(1, series.length - 1);
    $("[data-hit]", svg).addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect(), sx = ((e.clientX - r.left) / r.width) * w;
      const i = Math.max(0, Math.min(series.length - 1, Math.round((sx - pad.l) / step))), d = series[i];
      const px = pad.l + i * step, py = pad.t + ih - (d.revenue / maxV) * ih;
      cur.setAttribute("x1", px); cur.setAttribute("x2", px); cur.setAttribute("visibility", "visible");
      dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("visibility", "visible");
      tip.hidden = false; tip.style.left = `${(px / w) * 100}%`; tip.style.top = `${(py / h) * 100}%`;
      tip.innerHTML = `${esc(day(d.day))} · <b>${esc(eurF(d.revenue))}</b> · ${d.orders} sipariş`;
    });
    $("[data-hit]", svg).addEventListener("mouseleave", () => { tip.hidden = true; cur.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); });
  }

  /* ---------- Görünümler ---------- */
  async function overview() {
    loading("Genel bakış");
    const d = await api("GET", "?view=overview");
    counts = { refunds: d.openRefunds, support: d.openSupport, questions: d.openQuestions };
    const k = d.kpi || {}, s = d.status, series = d.series || [];
    const last = (n) => series.slice(-n).map((x) => x.revenue);
    const check = [
      ["eSIM Access (veri paketleri)", s.esimAccess, "Supabase secret: ESIMACCESS_ACCESS_CODE"],
      ["eSIM Go (sınırsız paketler)", s.esimGo, "Supabase secret: ESIMGO_API_KEY"],
      ["Ödeme sağlayıcısı", !!s.payment, "Ödeme sağlayıcısını seç ve bağla (PAYMENT_PROVIDER)"],
      ["Mağaza editörü (GitHub)", s.contentEditor, "Supabase secret: GITHUB_CONTENT_TOKEN"],
      ["Google ile giriş", s.google, "Supabase → Authentication → Providers → Google"],
      ["Apple ile giriş", s.apple, "Supabase → Authentication → Providers → Apple"],
      ["Test modu kapalı", !s.testOrders, "Yayından önce ALLOW_TEST_ORDERS secret'ını sil"],
      ["İki adımlı doğrulama", d.mfa?.hasFactor, "Menü → Güvenlik"],
    ];
    const done = check.filter((c) => c[1]).length;
    const hello = new Date().getHours() < 12 ? "Günaydın" : new Date().getHours() < 18 ? "İyi günler" : "İyi akşamlar";
    // Kennzahl-Karte (Hochformat): Betrag, Vergleich, Details und eigene Kurve über den Zeitraum
    const fmtDay = (iso) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" }).format(new Date(iso + "T12:00:00Z"));
    const miniChart = (win) => {
      if (!win.length) return "";
      const vals = win.map((x) => x.revenue || 0), max = Math.max(1, ...vals), w = 300, h = 96, step = w / Math.max(1, vals.length - 1);
      const y = (v) => (h - 6 - (v / max) * (h - 16)).toFixed(1);
      const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`);
      const gid = "g" + Math.random().toString(36).slice(2, 8);
      return `<div class="pl-kpi__chart"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2ef58a" stop-opacity=".35"/><stop offset="1" stop-color="#2ef58a" stop-opacity="0"/></linearGradient></defs>
          <polygon points="0,${h} ${pts.join(" ")} ${w},${h}" fill="url(#${gid})"/>
          <polyline points="${pts.join(" ")}" fill="none" stroke="#2ef58a" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
        <div class="pl-kpi__axis"><span>${esc(fmtDay(win[0].day))}</span><span>en yüksek ${esc(eurF(Math.max(...vals)))}</span><span>${esc(fmtDay(win[win.length - 1].day))}</span></div></div>`;
    };
    const row = (l, val, cmp) => `<div class="pl-kpi__row"><span>${esc(l)}</span><b>${val}</b>${cmp != null ? `<small>${cmp}</small>` : ""}</div>`;
    const card = (label, v, prev, prevLabel, winDays, hero) => {
      const win = series.slice(-winDays), best = win.reduce((a, x) => ((x.revenue || 0) > (a?.revenue || 0) ? x : a), null);
      const aov = v.orders ? v.revenue / v.orders : 0, paov = prev?.orders ? prev.revenue / prev.orders : 0;
      return `
      <div class="pl-card pl-kpi ${hero ? "pl-kpi--hero" : ""}">
        <span class="pl-kpi__label">${esc(label)}</span><b class="pl-kpi__value">${esc(eurF(v.revenue || 0))}</b>
        <div class="pl-kpi__meta">${delta(v.revenue || 0, prev?.revenue || 0)}<span>${esc(prevLabel)}</span></div>
        <div class="pl-kpi__rows">
          ${row("Sipariş", String(v.orders || 0), prev ? `önceki ${prev.orders || 0}` : null)}
          ${row("Ø sepet", esc(eurF(aov)), prev ? `önceki ${esc(eurF(paov))}` : null)}
          ${row("Önceki dönem", esc(eurF(prev?.revenue || 0)))}
          ${row("En iyi gün", best && best.revenue ? `${esc(fmtDay(best.day))} · ${esc(eurF(best.revenue))}` : "–")}
        </div>
        ${miniChart(win)}<small class="pl-kpi__foot">Eğri: son ${winDays} gün</small>
      </div>`;
    };
    const top = d.topItems || [], topMax = Math.max(1, ...top.map((t) => t.revenue));
    shell("Genel bakış", `
      <div class="pl-kpis" data-kpis>
        ${card("Bugün", k.today || {}, k.yesterday, "dün ile karşılaştırma", 7, true)}
        ${card("Son 7 gün", k.week || {}, k.prevWeek, "önceki 7 gün", 14)}
        ${card("Bu ay", k.month || {}, k.prevMonth, "geçen ayın aynı dönemi", 30)}
        <div class="pl-card pl-kpi">
          <span class="pl-kpi__label">Toplam ciro</span><b class="pl-kpi__value">${esc(eurF(k.total?.revenue || 0))}</b>
          <div class="pl-kpi__meta"><span>başlangıçtan bugüne</span></div>
          <div class="pl-kpi__rows">
            ${row("Sipariş", String(k.total?.orders || 0))}
            ${row("Ø sepet", esc(eurF(k.total?.orders ? k.total.revenue / k.total.orders : 0)))}
            ${row("Müşteri", String(d.customers || 0), `+${d.newCustomers30 || 0} son 30 gün`)}
            ${row("Aktif eSIM", `${d.esimsActive || 0} / ${d.esims || 0}`)}
          </div>
          ${miniChart(series.slice(-90))}<small class="pl-kpi__foot">Eğri: son 90 gün</small>
        </div>
      </div>
      <div class="pl-dots" data-kpi-dots aria-hidden="true">${[0, 1, 2, 3].map((i) => `<i class="${i ? "" : "is-on"}"></i>`).join("")}</div>
      <div class="pl-two">
        <div class="pl-card pl-chartcard"><h2>Ciro gelişimi <span class="pl-seg" data-range>${[7, 30, 90].map((n) => `<button type="button" data-days="${n}" class="${n === 30 ? "is-active" : ""}">${n} gün</button>`).join("")}</span></h2><div data-chartbox>${areaChart(series.slice(-30))}</div></div>
        <div class="pl-card"><h2>Bekleyen işler</h2>
          <div class="pl-tasks">
            <a class="pl-task" href="#refunds"><span>İade talepleri</span><b class="${d.openRefunds ? "warn" : ""}">${d.openRefunds}</b></a>
            <a class="pl-task" href="#support"><span>Destek talepleri</span><b class="${d.openSupport ? "warn" : ""}">${d.openSupport}</b></a>
            <a class="pl-task" href="#questions"><span>Lina'nın yanıtlayamadığı sorular</span><b>${d.openQuestions}</b></a>
            <a class="pl-task" href="#esims"><span>Aktif eSIM / toplam</span><b>${d.esimsActive} / ${d.esims}</b></a>
          </div>
          <h2 style="margin-top:18px">En çok satan destinasyonlar <small>30 gün</small></h2>
          ${top.length ? `<div class="pl-bars">${top.map((t) => `<div class="pl-bar"><span>${esc(itemName(t.key))} <small class="pl-note">· ${t.orders} sipariş</small></span><b>${esc(eurF(t.revenue))}</b><div class="pl-bar__track"><i style="width:${Math.round((t.revenue / topMax) * 100)}%"></i></div></div>`).join("")}</div>` : `<p class="pl-help">Henüz satış yok.</p>`}
        </div>
      </div>
      <div class="pl-two">
        <div class="pl-card"><h2>Son siparişler <small><a href="#orders">Tümü →</a></small></h2>${ordersTable(d.recent, false)}</div>
        <div class="pl-card"><h2>Yayına hazır mı? <small>${done} / ${check.length} tamam</small></h2>
          <div class="pl-progress"><i style="width:${Math.round((done / check.length) * 100)}%"></i></div>
          <div class="pl-check">${check.map(([l, ok, how]) => `<div><span>${esc(l)}${ok ? "" : `<small>${esc(how)}</small>`}</span><span class="pl-badge ${ok ? "ok" : "warn"}">${ok ? "Tamam" : "Eksik"}</span></div>`).join("")}</div>
        </div>
      </div>`, `${hello} · ${new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}`);
    // Wisch-Karten am Handy: Punkte unter den Karten zeigen die aktuelle Karte
    const kp = $("[data-kpis]"), dots = $$("[data-kpi-dots] i");
    kp?.addEventListener("scroll", () => {
      const cards = [...kp.children], mid = kp.scrollLeft + kp.clientWidth / 2;
      const i = cards.reduce((best, c, n) => (Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - mid) ? n : best), 0);
      dots.forEach((d2, n) => d2.classList.toggle("is-on", n === i));
    }, { passive: true });
    const box = $("[data-chartbox]");
    wireChart(box, series.slice(-30));
    $("[data-range]").addEventListener("click", (e) => {
      const b = e.target.closest("[data-days]"); if (!b) return;
      $$("[data-range] button").forEach((x) => x.classList.toggle("is-active", x === b));
      const sl = series.slice(-Number(b.dataset.days));
      box.innerHTML = areaChart(sl); wireChart(box, sl);
    });
  }

  /* ---------- Mağaza editörü (eigene Datei panel-editor.js) ---------- */
  async function editor() {
    if (!window.PPEditor) { shell("Mağaza editörü", `<div class="pl-card"><p>Editör yüklenemedi.</p></div>`); return; }
    const file = sessionStorage.getItem("pl_edfile") || undefined; sessionStorage.removeItem("pl_edfile");
    window.PPEditor.open({ api, toast, esc, file, close: () => { location.hash = file?.startsWith("content/posts/") ? "guides" : "overview"; } });
  }

  function ordersTable(list, editable = true) {
    return table(["Tarih", "Müşteri", "Ürün", "#Tutar", "Durum"], list.map((o) => `<tr><td>${esc(date(o.created_at))}</td><td>${esc(o.email || o.customer_email || "–")}</td><td>${product(o.item_key, o.title)}${o.test ? ' <span class="pl-badge warn">Test</span>' : ""}</td>
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
      <div class="pl-card">${table(["Tarih", "Müşteri", "Ürün", "#Tutar", "#İade", "Sağlayıcı", "Ödeme no", "Durum"], d.payments.map((p) => `<tr><td>${esc(date(p.paid_at || p.created_at))}</td><td>${esc(p.customer_email || "–")}</td><td>${product(p.item_key, p.title)}${p.test ? ' <span class="pl-badge warn">Test</span>' : ""}</td><td class="num">${esc(money(p.amount, p.currency))}</td><td class="num">${p.refunded_amount ? esc(money(p.refunded_amount, p.currency)) : "–"}</td><td>${esc(p.payment_provider || "–")}</td><td><span class="mono">${esc(p.payment_ref || "–")}</span></td><td>${badge(p.status, ORDER_ST)}</td></tr>`), "Henüz ödeme yok. Ödeme sağlayıcısı bağlandığında ödemeler burada görünür.")}</div>`);
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
        <td><select data-esim="${esc(e.id)}">${Object.entries(ESIM_ST).map(([k, l]) => `<option value="${k}" ${k === e.status ? "selected" : ""}>${l}</option>`).join("")}</select>${e.test ? `<button class="pl-btn pl-btn--sm" data-simulate="${esc(e.id)}" title="Yalnızca test eSIM: aktif, kullanım ve kalan süre ile göster">Aktif göster</button>` : ""}</td></tr>`), "Henüz eSIM yok.")}</div>`);
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
        ${table(["Ürün", "#GB", "#Gün", "#Fiyat", "Rakip", "Kontrol", ""], d.competitors.map((c) => `<tr><td>${esc(itemName(c.item_key))} <span class="pl-note">${esc(c.item_key)}</span></td><td class="num">${esc(c.gb == null ? "tümü" : Number(c.gb) === 0 ? "Sınırsız" : c.gb)}</td><td class="num">${esc(c.days ?? "tümü")}</td><td class="num">${esc(money(c.price, c.currency))}</td><td>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.competitor)}</a>` : esc(c.competitor)}</td><td>${esc(date(c.checked_at))}</td><td><button class="pl-btn pl-btn--red pl-btn--sm" data-del="${esc(c.id)}">Sil</button></td></tr>`), "Henüz rakip fiyatı yok – alış × çarpan uygulanır.")}
      </div>
      <div class="pl-card"><h2>Satış fiyatı önizlemesi <small>${p.source === "mock" ? "test verilerine göre" : "sağlayıcı alış fiyatlarına göre"} · ${esc(p.currency)}</small></h2>
        <div class="pl-tools"><label class="pl-field">Filtre<input data-pfilter placeholder="ör. country:jp"></label></div>
        ${table(["Ürün", "Tarife", "#Alış", "Rakip", "#Satış fiyatı", "#Marj", "Kural"], p.rows.map((r) => { const m = r.cost ? Math.round(((r.price - r.cost) / r.price) * 100) : null; return `<tr data-prow="${esc(r.key)}"><td>${esc(itemName(r.key))}</td><td>${r.unlimited ? `Sınırsız · ${esc(r.days)} gün` : r.gb ? `${esc(r.gb)} GB · ${esc(r.days)} gün` : esc(r.name || r.id)}</td><td class="num">${esc(money(r.cost, p.currency))}</td><td>${esc(r.competitor || "–")}</td><td class="num"><b>${esc(money(r.price, p.currency))}</b></td><td class="num">${m != null ? "%" + m : "–"}</td><td><span class="pl-badge ${String(r.rule).startsWith("competitor") ? "ok" : ""}">${esc(ruleLabel(r.rule))}</span></td></tr>`; }), "Önizleme yok.")}
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
          ${row("Mağaza editörü (GitHub)", s.contentEditor, "Secret: GITHUB_CONTENT_TOKEN – GitHub'da yalnızca bu depo için \"Contents: Read and write\" izinli ince ayarlı token", dash("settings/functions"))}
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

  /* ---------- Bülten (Newsletter) ---------- */
  async function newsletter() {
    loading("Bülten");
    const d = await api("GET", "?view=newsletter");
    const LN = { tr: "Türkçe", en: "English", de: "Deutsch", ar: "العربية", ru: "Русский", fr: "Français", es: "Español" };
    const st = sessionStorage.getItem("pl_nl") || "active";
    const list = d.subscribers.filter((s) => st === "all" ? true : st === "active" ? !s.unsubscribed_at : !!s.unsubscribed_at);
    shell("Bülten", `
      <div class="pl-grid">
        <div class="pl-card pl-kpi pl-kpi--hero"><span>Aktif aboneler</span><b>${d.active}</b><div class="pl-kpi__meta"><span>+${d.new30} son 30 gün</span></div></div>
        <div class="pl-card pl-kpi"><span>Toplam kayıt</span><b>${d.total}</b><div class="pl-kpi__meta"><span>${d.total - d.active} abonelikten çıktı</span></div></div>
        <div class="pl-card pl-kpi" style="grid-column:span 2"><span>Dillere göre</span><div class="pl-bars" style="margin-top:10px">${Object.entries(d.byLang).sort((a, b) => b[1] - a[1]).map(([l, n]) => `<div class="pl-bar"><span>${esc(LN[l] || l)}</span><b>${n}</b><div class="pl-bar__track"><i style="width:${Math.round((n / Math.max(1, d.active)) * 100)}%"></i></div></div>`).join("") || `<p class="pl-help">Henüz abone yok.</p>`}</div></div>
      </div>
      <div class="pl-card">
        <div class="pl-tools">
          <label class="pl-field">Durum<select data-nlfilter><option value="active" ${st === "active" ? "selected" : ""}>Aktif</option><option value="unsub" ${st === "unsub" ? "selected" : ""}>Çıkanlar</option><option value="all" ${st === "all" ? "selected" : ""}>Tümü</option></select></label>
          <label class="pl-field">Ara<input data-search placeholder="e-posta"></label>
          <button class="pl-btn pl-btn--line" data-csv>CSV indir</button>
          <form data-nladd style="display:flex;gap:8px;align-items:end;margin-left:auto"><label class="pl-field">Elle ekle<input name="email" type="email" placeholder="ornek@mail.com" required></label><button class="pl-btn pl-btn--green" type="submit">Ekle</button></form>
        </div>
        <p class="pl-help">Aboneler sitedeki bülten formundan gelir; onay metni kayıtla birlikte saklanır (KVKK). E-posta göndermek için listeyi CSV olarak <b>Brevo, Mailchimp veya Resend</b>'e aktar. Silme işlemi kalıcıdır (veri silme talebi).</p>
        ${table(["Tarih", "E-posta", "Dil", "Kaynak", "Durum", ""], list.map((s) => `<tr data-row="${esc(s.email)}"><td>${esc(date(s.created_at))}</td><td>${esc(s.email)}</td><td>${esc(LN[s.lang] || s.lang || "–")}</td><td><span class="pl-note">${esc(s.source || "–")}</span></td>
          <td>${s.unsubscribed_at ? `<span class="pl-badge bad">Çıktı</span>` : `<span class="pl-badge ok">Aktif</span>`}</td>
          <td class="pl-actions">${s.unsubscribed_at ? `<button class="pl-btn pl-btn--sm" data-nl="newsletter_resub" data-id="${s.id}">Geri al</button>` : `<button class="pl-btn pl-btn--sm" data-nl="newsletter_unsub" data-id="${s.id}">Çıkar</button>`}<button class="pl-btn pl-btn--sm pl-btn--red" data-nl="newsletter_delete" data-id="${s.id}">Sil</button></td></tr>`), "Kayıt yok.")}
      </div>`, `${d.active} aktif abone`);
    lastCsv = { name: "bulten", rows: list.map((s) => ({ email: s.email, dil: s.lang || "", tarih: s.created_at, durum: s.unsubscribed_at ? "cikti" : "aktif", kaynak: s.source || "", onay: s.consent_text || "" })) };
  }

  /* ---------- Rehberler (Ratgeber / Blog) ---------- */
  async function guides() {
    loading("Rehberler");
    let d, err = "";
    try { d = await api("POST", "", { action: "posts_list" }); }
    catch (e) {
      err = e.message;
      // Ohne GitHub-Token: veröffentlichte Artikel aus der Seite anzeigen
      const blog = await fetch("../content/blog.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({}));
      d = { posts: (blog.tr?.posts || []).map((p) => ({ id: p.id, title: p.title, date: p.date, category: p.category, image: p.image, draft: false, langs: [] })) };
    }
    const ro = err === "github_missing";
    const img = (u) => !u ? "" : /^https?:/.test(u) ? (u.includes("images.unsplash.com") ? u.split("?")[0] + "?w=160&h=110&fit=crop&q=60" : u) : "../" + u;
    shell("Rehberler", `
      ${ro ? `<div class="pl-card" style="margin-bottom:14px;border-color:rgba(255,200,87,.35)"><p class="pl-help" style="margin:0;color:var(--amber)">Yazı eklemek, düzenlemek ve silmek için Supabase secret'ı <b>GITHUB_CONTENT_TOKEN</b> gerekli. Şu an yalnızca yayındaki yazılar listeleniyor.</p></div>` : ""}
      <div class="pl-card">
        <div class="pl-tools">
          <label class="pl-field">Ara<input data-search placeholder="başlık"></label>
          <form data-newpost style="display:flex;gap:8px;align-items:end;margin-left:auto"><label class="pl-field">Yeni rehber başlığı<input name="title" required placeholder="ör. İtalya'da internet: 2027 rehberi" style="min-width:280px"></label><button class="pl-btn pl-btn--green" type="submit" ${ro ? "disabled" : ""}>+ Yeni rehber</button></form>
        </div>
        <p class="pl-help">Rehberler sitede <b>Dergi / blog</b> bölümünde ve kendi sayfalarında görünür. <b>Taslak</b> yazılar yayınlanmaz. Düzenle → Mağaza editörü açılır (7 dil, görsel, metin).</p>
        ${table(["", "Başlık", "Kategori", "Tarih", "Diller", "Durum", ""], d.posts.map((p) => `<tr data-row="${esc((p.title || "").toLowerCase())}">
          <td>${p.image ? `<img src="${esc(img(p.image))}" alt="" style="width:64px;height:44px;object-fit:cover;border-radius:8px;display:block">` : ""}</td>
          <td><b>${esc(p.title || p.id)}</b><br><span class="pl-note mono">${esc(p.id)}</span></td><td>${esc(p.category || "–")}</td><td>${esc(p.date || "–")}</td>
          <td><span class="pl-note">TR${(p.langs || []).length ? " · " + p.langs.map((l) => l.toUpperCase()).join(" · ") : ""}</span></td>
          <td>${p.draft ? `<span class="pl-badge warn">Taslak</span>` : `<span class="pl-badge ok">Yayında</span>`}</td>
          <td class="pl-actions"><button class="pl-btn pl-btn--sm" data-editpost="${esc(p.id)}">Düzenle</button><a class="pl-btn pl-btn--sm" href="../blog.html?p=${esc(p.id)}" target="_blank" rel="noopener">Gör ↗</a>${ro ? "" : `<button class="pl-btn pl-btn--sm pl-btn--red" data-delpost="${esc(p.id)}">Sil</button>`}</td></tr>`), "Henüz rehber yok.")}
      </div>`, `${d.posts.length} yazı`);
  }

  /* ---------- Diller & çeviri ---------- */
  const T_LANGS = [["en", "English"], ["de", "Deutsch"], ["ar", "العربية"], ["ru", "Русский"], ["fr", "Français"], ["es", "Español"], ["it", "Italiano"], ["pt", "Português"], ["nl", "Nederlands"], ["pl", "Polski"], ["ja", "日本語"], ["ko", "한국어"]];
  const T_FILES = [["content/site.json", "Ana sayfa"], ["content/ui.json", "Arayüz metinleri"], ["content/assistant.json", "Lina & SSS"], ["content/install.json", "Kurulum rehberi"], ["content/account.json", "Müşteri hesabı"], ["content/pages.json", "Yasal sayfalar"], ["content/reviews.json", "Değerlendirmeler"], ["content/esim.json", "eSIM ülkeleri"]];
  // Übersetzbare Texte: Zeichenketten, aber keine Links, Bilder, Codes, Farben, Daten
  const T_SKIP = /^(image|images|img|url|href|link|icon|color|green|dark|code|id|type|date|cta|country|countryCode|pricesUrl|questionsUrl|linaUrl|mapCodes|slug|value|style|tap|toggle|kind|currency|email|phone|logo|flag)$/i;
  function tLeaves(obj, path = [], out = []) {
    if (typeof obj === "string") { const s = obj.trim(); if (s && !/^(https?:|\/|#|[a-z0-9_-]+\.(png|jpe?g|webp|svg)$)/i.test(s) && !/^[#0-9a-f]{4,7}$/i.test(s) && /\p{L}{2,}/u.test(s)) out.push({ path, text: obj }); return out; }
    if (Array.isArray(obj)) { obj.forEach((v, i) => tLeaves(v, [...path, i], out)); return out; }
    if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) { if (!T_SKIP.test(k)) tLeaves(v, [...path, k], out); }
    return out;
  }
  const KF = (o) => (o && typeof o === "object" ? (o.id !== undefined ? "id" : o.code !== undefined ? "code" : null) : null);
  // Fremdsprachen-Wert lesen/schreiben wie die Seite mischt (Listen mit id/code über den Schlüssel, sonst Index)
  function tGet(data, lang, path) {
    let b = data.tr, o = data[lang];
    for (const p of path) {
      if (o == null) return undefined;
      if (typeof p === "number" && Array.isArray(b) && KF(b[p]) && Array.isArray(o)) { const k = KF(b[p]); o = o.find((x) => x && x[k] === b[p][k]); }
      else o = o[p];
      b = b?.[p];
    }
    return o;
  }
  function tSet(data, lang, path, value) {
    data[lang] ??= {};
    let b = data.tr, o = data[lang];
    for (let i = 0; i < path.length; i++) {
      const p = path[i], last = i === path.length - 1;
      if (typeof p === "number" && Array.isArray(b) && KF(b[p])) {
        const k = KF(b[p]); let el = o.find((x) => x && x[k] === b[p][k]);
        if (!el) { el = { [k]: b[p][k] }; o.push(el); }
        if (last) return; o = el;
      } else if (last) { o[p] = value; return; }
      else { if (o[p] == null) o[p] = Array.isArray(b?.[p]) ? [] : {}; o = o[p]; }
      b = b?.[p];
    }
  }
  async function translations() {
    loading("Diller & çeviri");
    const files = await Promise.all(T_FILES.map(async ([f, label]) => { try { return { f, label, data: await fetch("../" + f, { cache: "no-cache" }).then((r) => r.json()) }; } catch (_) { return { f, label, data: null }; } }));
    const cov = files.filter((x) => x.data?.tr).map((x) => {
      const leaves = tLeaves(x.data.tr);
      const per = Object.fromEntries(T_LANGS.map(([l]) => [l, leaves.filter((lf) => { const v = tGet(x.data, l, lf.path); return typeof v === "string" && v.trim(); }).length]));
      return { ...x, total: leaves.length, per };
    });
    const sel = sessionStorage.getItem("pl_tfile") || "content/site.json", lang = sessionStorage.getItem("pl_tlang") || "en", onlyMissing = sessionStorage.getItem("pl_tmiss") !== "0";
    const cur = cov.find((c) => c.f === sel) || cov[0];
    const pct = (n, t) => (t ? Math.round((n / t) * 100) : 100);
    const leaves = cur ? tLeaves(cur.data.tr) : [];
    const rows = leaves.map((lf, i) => ({ ...lf, i, val: tGet(cur.data, lang, lf.path) })).filter((r) => !onlyMissing || !(typeof r.val === "string" && r.val.trim()));
    shell("Diller & çeviri", `
      <div class="pl-card" style="margin-bottom:16px"><h2>Çeviri durumu <small>Türkçe ana dildir; boş metinlerde sitede Türkçe görünür</small></h2>
        ${table(["İçerik", "#Metin", ...T_LANGS.map(([, n]) => "#" + n)], cov.map((c) => `<tr><td><b>${esc(c.label)}</b><br><span class="pl-note mono">${esc(c.f)}</span></td><td class="num">${c.total}</td>${T_LANGS.map(([l]) => { const p = pct(c.per[l], c.total); return `<td class="num"><span class="pl-badge ${p >= 95 ? "ok" : p >= 60 ? "warn" : "bad"}">%${p}</span></td>`; }).join("")}</tr>`), "İçerik yok.")}
      </div>
      <div class="pl-card">
        <h2>Çevir</h2>
        <div class="pl-tools">
          <label class="pl-field">İçerik<select data-tfile>${cov.map((c) => `<option value="${esc(c.f)}" ${c.f === cur?.f ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>
          <label class="pl-field">Dil<select data-tlang>${T_LANGS.map(([l, n]) => `<option value="${l}" ${l === lang ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          <label class="pl-field">Göster<select data-tmiss><option value="1" ${onlyMissing ? "selected" : ""}>Sadece eksikler</option><option value="0" ${onlyMissing ? "" : "selected"}>Tümü</option></select></label>
          <span style="margin-left:auto" class="pl-note">${rows.length} metin</span>
          <button class="pl-btn pl-btn--green" data-tsave disabled>Kaydet</button>
        </div>
        <p class="pl-help">Soldaki Türkçe metni seçilen dile çevir ve kaydet. Kaydetme için <b>GITHUB_CONTENT_TOKEN</b> gerekli; değişiklik 1–2 dakikada yayında.</p>
        <div class="pl-table-wrap"><table><thead><tr><th style="width:45%">Türkçe</th><th>${esc(T_LANGS.find((x) => x[0] === lang)?.[1] || lang)}</th></tr></thead><tbody>
          ${rows.slice(0, 400).map((r) => `<tr><td style="vertical-align:top"><span class="pl-note mono" style="font-size:11px">${esc(r.path.join(" › "))}</span><br>${esc(r.text.length > 400 ? r.text.slice(0, 400) + " …" : r.text)}</td>
            <td><textarea class="pl-tr" data-ti="${r.i}" rows="${Math.min(8, Math.max(2, Math.ceil(r.text.length / 60)))}" dir="${lang === "ar" ? "rtl" : "ltr"}" style="width:100%;border-radius:10px;border:1px solid var(--line2);background:var(--bg2);color:var(--ink);padding:8px 10px;font:inherit;resize:vertical">${esc(typeof r.val === "string" ? r.val : "")}</textarea></td></tr>`).join("") || `<tr><td colspan="2" class="pl-empty">Bu dilde eksik metin yok 🎉</td></tr>`}
        </tbody></table></div>
        ${rows.length > 400 ? `<p class="pl-help">İlk 400 metin gösteriliyor – kaydettikten sonra kalanlar görünür.</p>` : ""}
      </div>`, "7 dil · eksik metinleri tamamla");
    // Bearbeiten → beim Speichern frische Datei (mit sha) von GitHub holen, Änderungen einsetzen
    const changed = new Map();
    app.querySelectorAll(".pl-tr").forEach((ta) => ta.addEventListener("input", () => { changed.set(+ta.dataset.ti, ta.value); $("[data-tsave]").disabled = false; }));
    $("[data-tsave]").addEventListener("click", async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Kaydediliyor …";
      try {
        const g = await api("POST", "", { action: "content_get", file: cur.f });
        const data = g.data || cur.data;
        for (const [i, v] of changed) tSet(data, lang, leaves[i].path, v.trim());
        await api("POST", "", { action: "content_put", file: cur.f, data, sha: g.sha });
        toast(`${changed.size} çeviri kaydedildi. Site 1–2 dakikada güncellenir.`);
        changed.clear(); btn.textContent = "Kaydedildi";
      } catch (err) { toast(err.message === "github_missing" ? "Kaydetmek için GITHUB_CONTENT_TOKEN gerekli." : "Kaydedilemedi: " + err.message); btn.disabled = false; btn.textContent = "Kaydet"; }
    });
  }

  /* ---------- İndirim kodları ---------- */
  async function discounts() {
    loading("İndirim kodları");
    const d = await api("GET", "?view=discounts");
    const used = (code) => d.usage.filter((u) => u.coupon === code && ["paid", "fulfilled"].includes(u.status));
    const dt = (v) => (v ? new Date(v).toISOString().slice(0, 16) : "");
    const stateOf = (c) => { const n = Date.now(); if (!c.active) return ["Kapalı", ""]; if (c.ends_at && new Date(c.ends_at) < n) return ["Süresi doldu", "bad"]; if (c.starts_at && new Date(c.starts_at) > n) return ["Planlandı", "warn"]; if (c.max_uses && c.used_count >= c.max_uses) return ["Tükendi", "bad"]; return ["Aktif", "ok"]; };
    shell("İndirim kodları", `
      <div class="pl-card" style="margin-bottom:16px"><h2>Yeni indirim kodu</h2>
        <form class="pl-form" data-disc style="grid-template-columns:repeat(4,minmax(0,1fr));">
          <label class="pl-field">Kod<input name="code" required placeholder="YAZ25" style="text-transform:uppercase"></label>
          <label class="pl-field">Tür<select name="kind"><option value="percent">Yüzde (%)</option><option value="fixed">Sabit tutar (€)</option></select></label>
          <label class="pl-field">Değer<input name="value" type="number" step="0.01" min="0.01" required placeholder="10"></label>
          <label class="pl-field">En az sepet (€)<input name="min_amount" type="number" step="0.01" min="0" value="0"></label>
          <label class="pl-field">Başlangıç<input name="starts_at" type="datetime-local"></label>
          <label class="pl-field">Bitiş<input name="ends_at" type="datetime-local"></label>
          <label class="pl-field">Kullanım sınırı<input name="max_uses" type="number" min="1" placeholder="sınırsız"></label>
          <label class="pl-field">Not<input name="note" placeholder="ör. Instagram kampanyası"></label>
          <button class="pl-btn pl-btn--green" type="submit">Kodu oluştur</button>
        </form>
        <p class="pl-help" style="margin:12px 0 0">Müşteri kodu <b>sepette</b> “Uygula” ile girer; kampanya kodunu “Pop-up & kampanya” ile sitede de gösterebilirsin. Kod sunucuda kontrol edilir; indirim siparişte görünür. Sabit tutar ve en az sepet EUR cinsindendir, diğer para birimlerinde güncel kurla çevrilir.</p>
      </div>
      <div class="pl-card"><h2>Kodlar <small>${d.codes.length}</small></h2>
        ${table(["Kod", "İndirim", "Geçerlilik", "#Kullanım", "#İndirim toplamı", "Durum", ""], d.codes.map((c) => { const [lbl, cls] = stateOf(c); const u = used(c.code); const sum = u.reduce((a, o) => ((a[o.currency] = (a[o.currency] || 0) + Number(o.discount || 0)), a), {});
          return `<tr><td><b class="mono" style="font-size:14px">${esc(c.code)}</b>${c.note ? `<br><span class="pl-note">${esc(c.note)}</span>` : ""}</td>
          <td>${c.kind === "percent" ? `%${Number(c.value)}` : esc(money(c.value, "EUR"))}${Number(c.min_amount) ? `<br><span class="pl-note">en az ${esc(money(c.min_amount, "EUR"))}</span>` : ""}</td>
          <td><span class="pl-note">${c.starts_at ? esc(date(c.starts_at)) : "hemen"} → ${c.ends_at ? esc(date(c.ends_at)) : "süresiz"}</span></td>
          <td class="num">${c.used_count}${c.max_uses ? ` / ${c.max_uses}` : ""}</td>
          <td class="num">${Object.entries(sum).map(([cur, v]) => esc(money(v, cur))).join("<br>") || "–"}</td>
          <td><span class="pl-badge ${cls}">${lbl}</span></td>
          <td class="pl-actions"><button class="pl-btn pl-btn--sm" data-dtoggle="${c.id}" data-active="${c.active ? 0 : 1}">${c.active ? "Kapat" : "Aç"}</button><button class="pl-btn pl-btn--sm pl-btn--red" data-ddel="${c.id}">Sil</button></td></tr>`; }), "Henüz indirim kodu yok.")}
      </div>`, "Kampanya kodları");
  }

  /* ---------- Pop-up & kampanya: Website-Fenster (Aktion mit Code – sonst Newsletter) ---------- */
  async function popup() {
    loading("Pop-up & kampanya");
    const d = await api("GET", "?view=popup");
    const st = d.settings, n = st.newsletter, p = st.promo;
    const dt = (v) => { if (!v) return ""; const x = new Date(v); return new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); }; // Ortszeit fürs Datumsfeld
    const usable = d.codes.filter((c) => c.active && (!c.ends_at || new Date(c.ends_at) > Date.now()) && (!c.max_uses || c.used_count < c.max_uses));
    const label = (c) => `${c.code} – ${c.kind === "percent" ? "%" + Number(c.value) : money(c.value, "EUR")}`;
    const opts = (sel) => `<option value="">– seçilmedi –</option>` + d.codes.map((c) => `<option value="${esc(c.code)}" ${c.code === sel ? "selected" : ""} ${usable.includes(c) ? "" : "disabled"}>${esc(label(c))}${usable.includes(c) ? "" : " (geçersiz)"}</option>`).join("");
    const L = [["tr", "Türkçe"], ["de", "Deutsch"], ["en", "English"], ["ar", "العربية"], ["ru", "Русский"], ["fr", "Français"], ["es", "Español"], ["it", "Italiano"], ["pt", "Português"], ["nl", "Nederlands"], ["pl", "Polski"], ["ja", "日本語"], ["ko", "한국어"]];
    const live = d.live || {};
    const liveText = live.type === "promo" ? `<b>Kampanya</b> gösteriliyor: kod <b class="mono">${esc(live.code)}</b> (${live.kind === "percent" ? "%" + live.value : esc(money(live.value, "EUR"))})${live.endsAt ? " · bitiş " + esc(date(live.endsAt)) : ""}`
      : live.type === "newsletter" ? `<b>Bülten penceresi</b> gösteriliyor${live.offer ? ` – kayıttan sonra hoş geldin kodu (${live.offer.kind === "percent" ? "%" + live.offer.value : esc(money(live.offer.value, "EUR"))})` : " – indirim vaadi olmadan"}`
      : "Şu anda <b>hiçbir pencere</b> gösterilmiyor.";
    shell("Pop-up & kampanya", `
      <div class="pl-card" style="margin-bottom:16px"><h2>Şu an sitede</h2><p class="pl-help" style="margin:0">${liveText}</p>
        <p class="pl-help" style="margin:10px 0 0">Kural: Aktif bir kampanya varsa bülten yerine kampanya penceresi açılır. Ziyaretçi pencereyi kapatırsa ${st.everyDays} gün boyunca tekrar görmez; bültene kaydolan bülten penceresini bir daha görmez. Hesap ve yönetim sayfalarında pencere açılmaz.</p></div>
      <form data-popup>
      <div class="pl-two">
        <div class="pl-card"><h2>Bülten penceresi <small>${d.subscribers} abone</small></h2>
          <label class="pl-switch"><input type="checkbox" name="nl_enabled" ${n.enabled ? "checked" : ""}> Bülten penceresini göster</label>
          <div class="pl-form" style="grid-template-columns:1fr 1fr;margin-top:12px">
            <label class="pl-field">Gecikme (saniye)<input name="nl_delay" type="number" min="0" max="60" value="${n.delay}"></label>
            <label class="pl-field">Tekrar gösterme (gün)<input name="everyDays" type="number" min="1" max="90" value="${st.everyDays}"></label>
            <label class="pl-field" style="grid-column:1/-1">Hoş geldin kodu (kayıttan hemen sonra gösterilir)<select name="nl_code">${opts(n.welcomeCode)}</select></label>
          </div>
          <p class="pl-help">Kod seçilirse pencere “E-postanı gir, %10 kazan” der ve kayıttan sonra kodu gösterir (kod sepete otomatik eklenir). Kod seçilmezse indirim vaat edilmez. Yeni kodu “İndirim kodları”nda oluştur – ör. HOSGELDIN10, %10.</p>
        </div>
        <div class="pl-card"><h2>Kampanya penceresi</h2>
          <label class="pl-switch"><input type="checkbox" name="pr_enabled" ${p.enabled ? "checked" : ""}> Kampanyayı göster (bülten yerine)</label>
          <div class="pl-form" style="grid-template-columns:1fr 1fr;margin-top:12px">
            <label class="pl-field" style="grid-column:1/-1">Kampanya kodu<select name="pr_code">${opts(p.code)}</select></label>
            <label class="pl-field">Başlangıç (boş = hemen)<input name="pr_start" type="datetime-local" value="${dt(p.startsAt)}"></label>
            <label class="pl-field">Bitiş (boş = kodun bitişi)<input name="pr_end" type="datetime-local" value="${dt(p.endsAt)}"></label>
          </div>
          <p class="pl-help">Başlık ve metin boş kalırsa her dilde otomatik yazılır (ör. “Black Friday: %20 indirim”). Kendi metnini yazmak istersen aşağıdaki diller için doldur; boş diller otomatik metni kullanır.</p>
          <details class="pl-details"><summary>Kendi başlık ve metnin (isteğe bağlı)</summary>
            ${L.map(([c, nm]) => `<div class="pl-form" style="grid-template-columns:1fr 2fr;margin-top:8px"><label class="pl-field">${nm} başlık<input name="t_${c}" maxlength="80" value="${esc(p.title?.[c] || "")}" ${c === "ar" ? 'dir="rtl"' : ""}></label><label class="pl-field">${nm} metin<input name="x_${c}" maxlength="220" value="${esc(p.text?.[c] || "")}" ${c === "ar" ? 'dir="rtl"' : ""}></label></div>`).join("")}
          </details>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:4px"><button class="pl-btn pl-btn--green" type="submit">Kaydet</button><a class="pl-btn" href="../index.html?popup=preview" target="_blank" rel="noopener">Sitede önizle ↗</a></div>
      </form>
      <div class="pl-card" style="margin-top:22px" id="yeni-kod"><h2>Yeni kod veya kampanya oluştur</h2>
        <form class="pl-form pl-form--code" data-pcode>
          <label class="pl-field">Kod<input name="code" required minlength="3" maxlength="32" placeholder="ör. HOSGELDIN10" style="text-transform:uppercase" autocomplete="off"></label>
          <label class="pl-field">Tür<select name="kind"><option value="percent">Yüzde (%)</option><option value="fixed">Sabit tutar (€)</option></select></label>
          <label class="pl-field">Değer<input name="value" type="number" step="0.01" min="0.01" required placeholder="10"></label>
          <label class="pl-field">En az sepet (€)<input name="min_amount" type="number" step="0.01" min="0" value="0"></label>
          <label class="pl-field">Başlangıç (boş = hemen)<input name="starts_at" type="datetime-local"></label>
          <label class="pl-field">Bitiş (boş = süresiz)<input name="ends_at" type="datetime-local"></label>
          <label class="pl-field">Kullanım sınırı<input name="max_uses" type="number" min="1" placeholder="sınırsız"></label>
          <label class="pl-field">Not<input name="note" placeholder="ör. Black Friday"></label>
          <label class="pl-field pl-field--wide">Oluşturduktan sonra<select name="use">
            <option value="">Sadece kodu oluştur</option>
            <option value="welcome" ${n.welcomeCode ? "" : "selected"}>Bülten penceresinde hoş geldin kodu yap</option>
            <option value="promo">Kampanya penceresinde göster (bülten yerine)</option></select></label>
          <button class="pl-btn pl-btn--green pl-field--wide" type="submit">Oluştur</button>
        </form>
        <p class="pl-help" style="margin:12px 0 0">Kampanya seçersen başlangıç ve bitiş tarihi pencereye de aktarılır; kampanya bitince site otomatik olarak bülten penceresine döner.</p>
      </div>
      <div class="pl-card" style="margin-top:16px"><h2>Kodlar <small>${d.codes.length}</small></h2>
        ${d.codes.length ? table(["Kod", "İndirim", "Geçerlilik", "Kullanım", "Pencerede", ""], d.codes.map((c) => {
          const where = [c.code === n.welcomeCode ? '<span class="pl-badge ok">Hoş geldin</span>' : "", c.code === p.code && p.enabled ? '<span class="pl-badge ok">Kampanya</span>' : ""].join(" ") || '<span class="pl-note">–</span>';
          const ok = usable.includes(c);
          return `<tr><td><b class="mono" style="font-size:14px">${esc(c.code)}</b>${c.note ? `<br><span class="pl-note">${esc(c.note)}</span>` : ""}</td>
            <td>${c.kind === "percent" ? `%${Number(c.value)}` : esc(money(c.value, "EUR"))}${Number(c.min_amount) ? `<br><span class="pl-note">en az ${esc(money(c.min_amount, "EUR"))}</span>` : ""}</td>
            <td><span class="pl-note">${c.starts_at ? esc(date(c.starts_at)) : "hemen"} → ${c.ends_at ? esc(date(c.ends_at)) : "süresiz"}</span>${ok ? "" : '<br><span class="pl-badge bad">geçersiz</span>'}</td>
            <td class="num">${c.used_count}${c.max_uses ? ` / ${c.max_uses}` : ""}</td>
            <td>${where}</td>
            <td class="pl-actions">${ok ? `<button class="pl-btn pl-btn--sm" type="button" data-puse="welcome" data-code="${esc(c.code)}">Hoş geldin</button><button class="pl-btn pl-btn--sm" type="button" data-puse="promo" data-code="${esc(c.code)}">Kampanya</button>` : ""}<button class="pl-btn pl-btn--sm" data-dtoggle="${c.id}" data-active="${c.active ? 0 : 1}">${c.active ? "Kapat" : "Aç"}</button><button class="pl-btn pl-btn--sm pl-btn--red" data-ddel="${c.id}">Sil</button></td></tr>`;
        })) : '<p class="pl-help" style="margin:0">Henüz kod yok – yukarıdan ilkini oluştur.</p>'}
      </div>`, "Pencere, kodlar ve kampanyalar – hepsi tek sayfada");
    const assign = async (use, code, startsAt, endsAt) => {
      const next = JSON.parse(JSON.stringify(st));
      if (use === "welcome") { next.newsletter.welcomeCode = code; next.newsletter.enabled = true; }
      if (use === "promo") { next.promo = { ...next.promo, enabled: true, code, startsAt: startsAt || null, endsAt: endsAt || null }; }
      await api("POST", "", { action: "popup_save", settings: next });
    };
    $("[data-pcode]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, fd = Object.fromEntries(new FormData(f)), btn = $("button[type=submit]", f);
      const iso = (x) => (x ? new Date(x).toISOString() : "");
      const row = { ...fd, code: String(fd.code).toUpperCase().replace(/[^A-Z0-9_-]/g, ""), starts_at: iso(fd.starts_at), ends_at: iso(fd.ends_at) };
      delete row.use;
      if (!/^[A-Z0-9_-]{3,32}$/.test(row.code)) return toast("Kod 3–32 harf/rakam olmalı.");
      btn.disabled = true;
      try {
        await api("POST", "", { action: "discount_save", ...row });
        if (fd.use) await assign(fd.use, row.code, row.starts_at, row.ends_at);
        toast(fd.use === "welcome" ? "Kod oluşturuldu ve hoş geldin kodu yapıldı." : fd.use === "promo" ? "Kampanya oluşturuldu – sitede 1 dakika içinde görünür." : "Kod oluşturuldu.");
        popup();
      } catch (err) { btn.disabled = false; toast(err.message === "exists" ? "Bu kod zaten var." : err.message === "invalid" ? "Değerleri kontrol et (yüzde en fazla 100)." : "Kaydedilemedi: " + err.message); }
    });
    $$("[data-puse]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const c = d.codes.find((x) => x.code === b.dataset.code);
      try { await assign(b.dataset.puse, b.dataset.code, c?.starts_at, c?.ends_at); toast(b.dataset.puse === "welcome" ? "Hoş geldin kodu ayarlandı." : "Kampanya açıldı."); popup(); }
      catch (err) { b.disabled = false; toast("Kaydedilemedi: " + err.message); }
    }));
    $("[data-popup]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, v = (k) => f.elements[k]?.value || "";
      const loc = (x) => (x ? new Date(x).toISOString() : null);
      const settings = {
        newsletter: { enabled: f.nl_enabled.checked, delay: Number(v("nl_delay")), welcomeCode: v("nl_code") || null },
        promo: { enabled: f.pr_enabled.checked, code: v("pr_code") || null, startsAt: loc(v("pr_start")), endsAt: loc(v("pr_end")),
          title: Object.fromEntries(L.map(([c]) => [c, v("t_" + c)])), text: Object.fromEntries(L.map(([c]) => [c, v("x_" + c)])) },
        everyDays: Number(v("everyDays")),
      };
      if (settings.promo.enabled && !settings.promo.code) return toast("Kampanya için bir kod seç.");
      const btn = $("button[type=submit]", f); btn.disabled = true;
      try { await api("POST", "", { action: "popup_save", settings }); toast("Kaydedildi – sitede 1 dakika içinde görünür."); popup(); }
      catch (err) { btn.disabled = false; toast("Kaydedilemedi: " + err.message); }
    });
  }


  /* ---------- Lounge & Fast Track (Partner-Zustellung ohne API) ---------- */
  const AIR_ST = { new: "Yeni", sent: "Partnere gönderildi", accepted: "Partner kabul etti", delivered: "Teslim edildi", declined: "Partner reddetti", failed: "Kaçırıldı", cancelled: "İptal" };
  const airCls = (s) => (s === "delivered" ? "ok" : ["new", "sent", "accepted"].includes(s) ? "warn" : "bad");
  const PROD = { lounge: "Lounge", fasttrack: "Fast Track" };
  let airLast = null; // Ergebnis des letzten Versands (Link/WhatsApp zum Antippen)
  async function airport() {
    loading("Lounge & Fast Track");
    const d = await api("GET", "?view=airport");
    const tab = sessionStorage.getItem("pl_air") || "bookings";
    const flt = sessionStorage.getItem("pl_airf") || "open";
    const S = d.settings, ch = d.channels;
    const partnerName = (id) => d.partners.find((p) => p.id === id)?.name || "–";
    const editO = JSON.parse(sessionStorage.getItem("pl_air_eo") || "null"), editP = JSON.parse(sessionStorage.getItem("pl_air_ep") || "null");
    const list = d.bookings.filter((b) => flt === "all" || (flt === "open" ? ["new", "sent", "accepted", "declined"].includes(b.status) : b.status === flt));
    const openN = d.bookings.filter((b) => ["new", "sent", "accepted", "declined"].includes(b.status) && !b.test).length;
    const late = (b) => b.due_at && ["sent", "accepted"].includes(b.status) && new Date(b.due_at) < Date.now();
    const files = (b) => (b.files || []).map((f) => `<a class="pl-airfile" href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.name)}">${f.type === "application/pdf" ? "PDF" : `<img src="${esc(f.url)}" alt="">`}</a>${b.status !== "delivered" ? `<button class="pl-btn pl-btn--sm pl-btn--line" data-afrm="${esc(b.id)}" data-path="${esc(f.path)}" title="Kaldır">×</button>` : ""}`).join("");
    const bookingRow = (b) => `<tr>
      <td>${esc(date(b.created_at))}${b.test ? ' <span class="pl-badge warn">Test</span>' : ""}<br><span class="pl-note mono">#${esc(String(b.id).slice(0, 8))}</span></td>
      <td><b>${esc(b.travel_date)}</b> ${esc(b.travel_time || "")}<br><span class="pl-note">${esc(b.flight || "uçuş no yok")}</span></td>
      <td><b>${esc(PROD[b.product] || b.product)} · ${esc(b.airport)}</b><br><span class="pl-note">${esc(b.title || "")}</span></td>
      <td>${b.persons} kişi<br><span class="pl-note">${esc((b.names || []).join(", "))}</span>${b.customer_note ? `<br><span class="pl-note">“${esc(b.customer_note)}”</span>` : ""}</td>
      <td>${esc(b.customer_email || "–")}${b.customer_phone ? `<br><span class="pl-note">${esc(b.customer_phone)}</span>` : ""}${b.order ? `<br>${badge(b.order.status, ORDER_ST)} ${esc(money(b.order.amount, b.order.currency))}` : ""}</td>
      <td><select data-apartner="${esc(b.id)}" ${b.status === "delivered" ? "disabled" : ""}><option value="">– otomatik –</option>${d.partners.map((p) => `<option value="${esc(p.id)}" ${p.id === b.partner_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        ${b.cost ? `<br><span class="pl-note">Alış: ${esc(money(b.cost, b.cost_currency))}</span>` : ""}</td>
      <td><span class="pl-badge ${airCls(b.status)}">${esc(AIR_ST[b.status] || b.status)}</span>${late(b) ? '<br><span class="pl-badge bad">Süre aşıldı</span>' : ""}
        ${b.due_at && ["sent", "accepted"].includes(b.status) ? `<br><span class="pl-note">Teslim: ${esc(date(b.due_at))}</span>` : ""}${b.reminders ? `<br><span class="pl-note">${b.reminders}× hatırlatıldı</span>` : ""}
        ${b.partner_note ? `<br><span class="pl-note">Partner: ${esc(b.partner_note)}</span>` : ""}</td>
      <td><div class="pl-airfiles">${files(b)}</div>
        <div class="pl-actions" style="flex-wrap:wrap">
          ${!["delivered", "cancelled"].includes(b.status) ? `<button class="pl-btn pl-btn--sm ${b.status === "new" || b.status === "declined" ? "pl-btn--green" : ""}" data-asend="${esc(b.id)}">${b.status === "new" ? "Partnere gönder" : "Tekrar gönder"}</button>` : ""}
          ${b.has_link ? `<button class="pl-btn pl-btn--sm pl-btn--line" data-alink="${esc(b.id)}">Link / WhatsApp</button>` : ""}
          ${b.status !== "delivered" && b.status !== "cancelled" ? `<label class="pl-btn pl-btn--sm pl-btn--line">Voucher yükle<input type="file" hidden accept="image/png,image/jpeg,image/webp,application/pdf" data-aup="${esc(b.id)}"></label>` : ""}
          ${(b.files || []).length && b.status !== "delivered" ? `<button class="pl-btn pl-btn--sm pl-btn--green" data-adeliver="${esc(b.id)}">Müşteriye teslim et</button>` : ""}
          <select data-astatus="${esc(b.id)}" title="Durumu elle değiştir"><option value="">Durum…</option>${Object.entries(AIR_ST).filter(([k]) => k !== "delivered" && k !== b.status).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select>
        </div>
        <details class="pl-details"><summary>Geçmiş & not</summary>
          <ul class="pl-airlog">${(b.log || []).slice().reverse().map((l) => `<li><span class="pl-note">${esc(date(l.at))} · ${esc(l.who)}</span><br>${esc(l.what)}</li>`).join("")}</ul>
          <textarea data-anote="${esc(b.id)}" rows="2" placeholder="Dahili not" style="width:100%">${esc(b.admin_note || "")}</textarea>
        </details></td></tr>`;

    const lastBox = airLast ? `<div class="pl-card pl-airlast"><h2>${airLast.channels?.length ? `Gönderildi: ${esc(airLast.channels.join(" + "))}` : "Otomatik kanal yok – linki kendin gönder"}${airLast.partner ? ` <small>${esc(airLast.partner)}</small>` : ""}</h2>
      <div class="pl-actions" style="flex-wrap:wrap">${airLast.wa ? `<a class="pl-btn pl-btn--green" href="${esc(airLast.wa)}" target="_blank" rel="noopener">WhatsApp'ta aç ve gönder</a>` : ""}
      <button class="pl-btn pl-btn--line" data-acopy="${esc(airLast.link)}">Partner linkini kopyala</button><a class="pl-btn pl-btn--line" href="${esc(airLast.link)}" target="_blank" rel="noopener">Portalı önizle</a><button class="pl-btn pl-btn--line" data-aclose>Kapat</button></div>
      <p class="pl-help" style="margin:10px 0 0">Link gizlidir – yalnızca partnere gönder. Partner bu sayfada voucher'ı yükler ve “Tamamlandı”ya dokunur; müşteri hesabında hemen görür.</p></div>` : "";

    const tabs = [["bookings", `Rezervasyonlar${openN ? ` (${openN})` : ""}`], ["offers", "Fiyat listesi"], ["partners", "Partnerler"], ["settings", "Ayarlar"]];
    const head = `<div class="pl-tools" style="justify-content:space-between;flex-wrap:wrap"><span class="pl-seg" data-airtabs>${tabs.map(([k, l]) => `<button type="button" data-airtab="${k}" class="${k === tab ? "is-active" : ""}">${esc(l)}</button>`).join("")}</span>
      <span class="pl-note">E-posta: <b>${ch.mail ? "✓ açık" : "✗ kapalı"}</b> · WhatsApp API: <b>${ch.whatsapp ? "✓ açık" : "✗ kapalı (wa.me linki)"}</b> · Sitede rezervasyon: <b>${S.enabled ? "✓ açık" : "✗ kapalı"}</b></span></div>`;

    let body = "";
    if (tab === "bookings") body = `
      <p class="pl-help">Akış: müşteri öder → rezervasyon <b>otomatik</b> partnere gider (e-posta / WhatsApp, gizli link) → partner portalda voucher/QR'ı yükler → müşteri hesabında görür ve e-posta alır. Bekçi her 15 dakikada hatırlatır, süre aşılırsa seni uyarır. Partner WhatsApp'tan gönderdiyse: <b>Voucher yükle</b> → <b>Müşteriye teslim et</b>.</p>
      <div class="pl-tools"><label class="pl-field">Filtre<select data-airf>${[["open", "Açık"], ["delivered", "Teslim edildi"], ["failed", "Kaçırıldı"], ["cancelled", "İptal"], ["all", "Tümü"]].map(([k, l]) => `<option value="${k}" ${k === flt ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        ${d.offers.length ? `<label class="pl-field">Deneme<select data-atestoffer>${d.offers.filter((o) => o.active).map((o) => `<option value="${esc(o.id)}">${esc(o.airport)} · ${esc(PROD[o.product])} · ${esc(o.title)}</option>`).join("")}</select></label><button class="pl-btn pl-btn--line" data-atest>Test rezervasyonu oluştur</button>` : ""}</div>
      <div class="pl-card">${table(["Oluşturma", "Uçuş", "Ürün", "Yolcular", "Müşteri / sipariş", "Partner", "Durum", "İşlem"], list.map(bookingRow), "Rezervasyon yok.")}</div>`;
    if (tab === "offers") body = `
      <p class="pl-help">Partnerin fiyat listesi (alış fiyatı, kişi başı). Satış fiyatı <b>fiyat kuralından</b> hesaplanır: alış × (1 + %${S.markup_pct}), en az alış + min. marj (Fiyatlar & rakipler), ,99'a yuvarlanır. Alış fiyatı asla sitede görünmez.</p>
      <div class="pl-card" style="margin-bottom:16px"><h2>${editO ? "Teklifi düzenle" : "Yeni teklif"}</h2>
        <form class="pl-form" data-aoffer style="grid-template-columns:repeat(4,minmax(0,1fr))">
          <input type="hidden" name="id" value="${esc(editO?.id || "")}">
          <label class="pl-field">Ürün<select name="product"><option value="lounge" ${editO?.product !== "fasttrack" ? "selected" : ""}>Lounge</option><option value="fasttrack" ${editO?.product === "fasttrack" ? "selected" : ""}>Fast Track</option></select></label>
          <label class="pl-field">Havalimanı (IATA)<input name="airport" required maxlength="3" placeholder="IST" style="text-transform:uppercase" value="${esc(editO?.airport || "")}"></label>
          <label class="pl-field">Havalimanı adı<input name="airport_name" placeholder="İstanbul Havalimanı" value="${esc(editO?.airport_name || "")}"></label>
          <label class="pl-field">Terminal<input name="terminal" placeholder="Dış hatlar" value="${esc(editO?.terminal || "")}"></label>
          <label class="pl-field" style="grid-column:span 2">Başlık (müşteri görür)<input name="title" required placeholder="IGA Lounge – 3 saat" value="${esc(editO?.title || "")}"></label>
          <label class="pl-field" style="grid-column:span 2">Açıklama (müşteri görür)<input name="details" placeholder="Açık büfe, içecekler, Wi-Fi, duş" value="${esc(editO?.details || "")}"></label>
          <label class="pl-field">Alış fiyatı / kişi<input name="cost" required inputmode="decimal" placeholder="35,00" value="${esc(editO?.cost ?? "")}"></label>
          <label class="pl-field">Para birimi<select name="cost_currency">${["EUR", "USD", "TRY", "GBP", "CHF"].map((c) => `<option ${c === (editO?.cost_currency || "EUR") ? "selected" : ""}>${c}</option>`).join("")}</select></label>
          <label class="pl-field">Partner<select name="partner_id"><option value="">– ilk aktif partner –</option>${d.partners.map((p) => `<option value="${esc(p.id)}" ${p.id === editO?.partner_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
          <label class="pl-field">En fazla kişi<input name="max_persons" type="number" min="1" max="20" value="${esc(editO?.max_persons ?? 8)}"></label>
          <label class="pl-field">Min. ön süre (saat)<input name="lead_hours" type="number" min="0" max="720" value="${esc(editO?.lead_hours ?? 24)}"></label>
          <label class="pl-switch" style="align-self:center"><input type="checkbox" name="active" ${editO?.active === false ? "" : "checked"}> Aktif</label>
          <div class="pl-actions"><button class="pl-btn pl-btn--green" type="submit">${editO ? "Kaydet" : "Ekle"}</button>${editO ? `<button type="button" class="pl-btn pl-btn--line" data-aoclear>Vazgeç</button>` : ""}</div>
        </form></div>
      <div class="pl-card"><h2>Teklifler <small>${d.offers.length}</small></h2>${table(["Havalimanı", "Ürün", "Başlık", "#Alış", "#Satış (EUR)", "#Marj", "Partner", "Ön süre", ""], d.offers.map((o) => {
        const m = o.price_eur && o.cost_currency === "EUR" ? Math.round((1 - o.cost / o.price_eur) * 100) + " %" : "–";
        return `<tr><td><b>${esc(o.airport)}</b>${o.airport_name ? `<br><span class="pl-note">${esc(o.airport_name)}${o.terminal ? " · " + esc(o.terminal) : ""}</span>` : ""}</td><td>${esc(PROD[o.product])}</td><td>${esc(o.title)}${o.active ? "" : ' <span class="pl-badge">Kapalı</span>'}</td>
          <td class="num">${esc(money(o.cost, o.cost_currency))}</td><td class="num">${o.price_eur != null ? esc(money(o.price_eur, "EUR")) : "kur yok"}</td><td class="num">${m}</td><td>${esc(partnerName(o.partner_id))}</td><td>${o.lead_hours} sa</td>
          <td class="pl-actions"><button class="pl-btn pl-btn--sm" data-aoedit="${esc(o.id)}">Düzenle</button><button class="pl-btn pl-btn--sm pl-btn--red" data-aodel="${esc(o.id)}">Sil</button></td></tr>`; }), "Henüz teklif yok – partnerinin fiyat listesini ekle.")}</div>`;
    if (tab === "partners") body = `
      <p class="pl-help">Lounge/Fast Track erişimini satın alan kişi veya firma. Rezervasyonlar e-posta ve/veya WhatsApp ile gelir (dil: partnerin dili). En az e-posta ya da WhatsApp gerekli.</p>
      <div class="pl-card" style="margin-bottom:16px"><h2>${editP ? "Partneri düzenle" : "Yeni partner"}</h2>
        <form class="pl-form" data-apartnerf style="grid-template-columns:repeat(4,minmax(0,1fr))">
          <input type="hidden" name="id" value="${esc(editP?.id || "")}">
          <label class="pl-field">Ad<input name="name" required placeholder="Ahmet (Lounge)" value="${esc(editP?.name || "")}"></label>
          <label class="pl-field">E-posta<input name="email" type="email" placeholder="ahmet@ornek.com" value="${esc(editP?.email || "")}"></label>
          <label class="pl-field">WhatsApp (ülke koduyla)<input name="whatsapp" inputmode="tel" placeholder="90 532 123 45 67" value="${esc(editP?.whatsapp || "")}"></label>
          <label class="pl-field">Dil<select name="language">${[["tr", "Türkçe"], ["de", "Deutsch"], ["en", "English"]].map(([k, l]) => `<option value="${k}" ${k === (editP?.language || "tr") ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="pl-field" style="grid-column:span 3">Not (dahili)<input name="notes" placeholder="ör. ödeme haftalık, gece 00–08 arası ulaşılamaz" value="${esc(editP?.notes || "")}"></label>
          <label class="pl-switch" style="align-self:center"><input type="checkbox" name="active" ${editP?.active === false ? "" : "checked"}> Aktif</label>
          <div class="pl-actions"><button class="pl-btn pl-btn--green" type="submit">${editP ? "Kaydet" : "Ekle"}</button>${editP ? `<button type="button" class="pl-btn pl-btn--line" data-apclear>Vazgeç</button>` : ""}</div>
        </form></div>
      <div class="pl-card">${table(["Ad", "E-posta", "WhatsApp", "Dil", "Durum", ""], d.partners.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.notes ? `<br><span class="pl-note">${esc(p.notes)}</span>` : ""}</td><td>${esc(p.email || "–")}</td><td>${p.whatsapp ? `<a href="https://wa.me/${esc(p.whatsapp)}" target="_blank" rel="noopener">+${esc(p.whatsapp)}</a>` : "–"}</td><td>${esc(p.language.toUpperCase())}</td><td>${p.active ? '<span class="pl-badge ok">Aktif</span>' : '<span class="pl-badge">Kapalı</span>'}</td>
        <td class="pl-actions"><button class="pl-btn pl-btn--sm" data-apedit="${esc(p.id)}">Düzenle</button><button class="pl-btn pl-btn--sm pl-btn--red" data-apdel="${esc(p.id)}">Sil</button></td></tr>`), "Henüz partner yok.")}</div>`;
    if (tab === "settings") body = `
      <div class="pl-two"><div class="pl-card"><h2>Kurallar</h2>
        <form class="pl-form" data-aset style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <label class="pl-switch" style="grid-column:span 2"><input type="checkbox" name="enabled" ${S.enabled ? "checked" : ""}> Sitede Lounge/Fast Track rezervasyonu aç</label>
          <label class="pl-field">Kâr payı (%)<input name="markup_pct" type="number" min="0" max="500" step="1" value="${S.markup_pct}"></label>
          <label class="pl-field">Partner teslim süresi (saat)<input name="sla_hours" type="number" min="1" max="168" step="0.5" value="${S.sla_hours}"></label>
          <label class="pl-field">Hatırlatma sonrası (saat)<input name="reminder_hours" type="number" min="0.5" max="48" step="0.5" value="${S.reminder_hours}"></label>
          <label class="pl-field">En fazla hatırlatma<input name="max_reminders" type="number" min="0" max="5" value="${S.max_reminders}"></label>
          <label class="pl-field">Kalkıştan kaç saat önce “kaçırıldı”<input name="cutoff_hours" type="number" min="0" max="48" step="0.5" value="${S.cutoff_hours}"></label>
          <span></span>
          <label class="pl-switch" style="grid-column:span 2"><input type="checkbox" name="auto_send" ${S.auto_send ? "checked" : ""}> Ödenen rezervasyonu otomatik partnere gönder</label>
          <label class="pl-switch" style="grid-column:span 2"><input type="checkbox" name="send_test" ${S.send_test ? "checked" : ""}> Test siparişlerini de partnere gönder</label>
          <label class="pl-switch" style="grid-column:span 2"><input type="checkbox" name="notify_admin" ${S.notify_admin ? "checked" : ""}> Sorunlarda beni e-postayla uyar (ADMIN_MAIL)</label>
          <button class="pl-btn pl-btn--green" type="submit">Kaydet</button>
        </form></div>
        <div class="pl-card"><h2>Kanallar</h2><div class="pl-check">
          <div><span>E-posta (Resend)<small>Supabase secrets: RESEND_API_KEY, MAIL_FROM (doğrulanmış alan adı). Partnere, müşteriye ve sana e-posta.</small></span><span class="pl-badge ${ch.mail ? "ok" : "warn"}">${ch.mail ? "Tamam" : "Eksik"}</span></div>
          <div><span>WhatsApp Business API (Meta)<small>WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE (2 değişkenli onaylı şablon: {{1}} özet, {{2}} link), isteğe bağlı WHATSAPP_TEMPLATE_LANG. Yoksa panelde “WhatsApp'ta aç” linki.</small></span><span class="pl-badge ${ch.whatsapp ? "ok" : "warn"}">${ch.whatsapp ? "Tamam" : "Eksik"}</span></div>
          <div><span>Bekçi (her 15 dk)<small>GitHub Actions “Lounge-Wächter”: hatırlatır, süre aşımında uyarır, kalkışa çok az kala “kaçırıldı” yapar.</small></span><span class="pl-badge ok">Açık</span></div>
        </div></div></div>`;

    shell("Lounge & Fast Track", `${head}${lastBox}${body}`, "Partner üzerinden teslimat");
  }

  const VIEWS = { airport, overview, editor, newsletter, popup, guides, translations, discounts, orders, payments, refunds, support, questions, customers, esims, pricing, settings, audit, security };
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
    const sim = e.target.closest("[data-simulate]");
    if (sim) { sim.disabled = true; await api("POST", "", { action: "esim_simulate", id: sim.dataset.simulate }).then(() => toast("Test eSIM artık aktif görünüyor (müşteri hesabında kontrol et)."), (err) => toast("Olmadı: " + err.message)); return show(); }
    if (q) { q.disabled = true; await api("POST", "", { action: "question_handled", id: q.dataset.question }); toast("İşlendi."); return questions(); }
    // Zweistufige Bestätigung für endgültige Aktionen (kein Browser-Dialog)
    const sure = (b, label) => { if (b.dataset.confirm) return true; b.dataset.confirm = "1"; const old = b.textContent; b.textContent = label || "Emin misin?"; setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.textContent = old; } }, 4000); return false; };
    const nl = e.target.closest("[data-nl]");
    if (nl) { if (nl.dataset.nl === "newsletter_delete" && !sure(nl, "Kalıcı sil?")) return; nl.disabled = true; await api("POST", "", { action: nl.dataset.nl, id: nl.dataset.id }).then(() => toast("Kaydedildi."), () => toast("Kaydedilemedi.")); return newsletter(); }
    const ep = e.target.closest("[data-editpost]");
    if (ep) { sessionStorage.setItem("pl_edfile", `content/posts/${ep.dataset.editpost}.json`); location.hash = "editor"; return; }
    const dp = e.target.closest("[data-delpost]");
    if (dp) { if (!sure(dp, "Kalıcı sil?")) return; dp.disabled = true; await api("POST", "", { action: "content_delete", file: `content/posts/${dp.dataset.delpost}.json` }).then(() => toast("Silindi – site 1–2 dakikada güncellenir."), (err) => toast("Silinemedi: " + err.message)); return guides(); }
    const dt = e.target.closest("[data-dtoggle]");
    if (dt) { dt.disabled = true; await api("POST", "", { action: "discount_toggle", id: dt.dataset.dtoggle, active: dt.dataset.active === "1" }).then(() => toast("Kaydedildi."), () => toast("Kaydedilemedi.")); return show(); }
    const dd = e.target.closest("[data-ddel]");
    if (dd) { if (!sure(dd, "Sil?")) return; dd.disabled = true; await api("POST", "", { action: "discount_delete", id: dd.dataset.ddel }).then(() => toast("Silindi."), () => toast("Silinemedi.")); return show(); }    /* Lounge & Fast Track */
    const at = e.target.closest("[data-airtab]");
    if (at) { sessionStorage.setItem("pl_air", at.dataset.airtab); return airport(); }
    if (e.target.closest("[data-aclose]")) { airLast = null; return airport(); }
    const ac = e.target.closest("[data-acopy]");
    if (ac) { try { await navigator.clipboard.writeText(ac.dataset.acopy); toast("Link kopyalandı."); } catch (_) { prompt("Linki kopyala:", ac.dataset.acopy); } return; }
    const as = e.target.closest("[data-asend]");
    if (as) { as.disabled = true; await api("POST", "", { action: "airport_send", id: as.dataset.asend }).then((r) => { airLast = r; toast(r.channels.length ? `Gönderildi (${r.channels.join(" + ")}).` : "Link hazır – WhatsApp ile gönder."); }, (err) => toast(err.message === "no_partner" ? "Önce bir partner ekle (Partnerler)." : "Gönderilemedi: " + err.message)); return airport(); }
    const al = e.target.closest("[data-alink]");
    if (al) { al.disabled = true; await api("POST", "", { action: "airport_link", id: al.dataset.alink }).then((r) => { airLast = { ...r, channels: [], partner: "" }; }, () => toast("Link yok.")); return airport(); }
    const adl = e.target.closest("[data-adeliver]");
    if (adl) { if (!sure(adl, "Müşteriye gönderilsin mi?")) return; adl.disabled = true; await api("POST", "", { action: "airport_deliver", id: adl.dataset.adeliver }).then((r) => toast(r.mailed ? "Teslim edildi – müşteriye e-posta gitti." : "Teslim edildi – müşteri hesabında görür."), (err) => toast(err.message === "no_file" ? "Önce voucher yükle." : "Olmadı: " + err.message)); return airport(); }
    const arm = e.target.closest("[data-afrm]");
    if (arm) { if (!sure(arm, "Sil?")) return; await api("POST", "", { action: "airport_file_remove", id: arm.dataset.afrm, path: arm.dataset.path }).then(() => toast("Kaldırıldı."), () => toast("Olmadı.")); return airport(); }
    if (e.target.closest("[data-atest]")) { const o = $("[data-atestoffer]")?.value; if (!o) return; await api("POST", "", { action: "airport_test", offer_id: o }).then(() => toast("Test rezervasyonu oluşturuldu – “Partnere gönder” ile dene."), (err) => toast("Olmadı: " + err.message)); return airport(); }
    const aoe = e.target.closest("[data-aoedit]");
    if (aoe) { const d = await api("GET", "?view=airport"); sessionStorage.setItem("pl_air_eo", JSON.stringify(d.offers.find((o) => o.id === aoe.dataset.aoedit) || null)); return airport(); }
    if (e.target.closest("[data-aoclear]")) { sessionStorage.removeItem("pl_air_eo"); return airport(); }
    const aod = e.target.closest("[data-aodel]");
    if (aod) { if (!sure(aod, "Sil?")) return; await api("POST", "", { action: "airport_offer_delete", id: aod.dataset.aodel }).then(() => toast("Silindi."), () => toast("Silinemedi.")); return airport(); }
    const ape = e.target.closest("[data-apedit]");
    if (ape) { const d = await api("GET", "?view=airport"); sessionStorage.setItem("pl_air_ep", JSON.stringify(d.partners.find((p) => p.id === ape.dataset.apedit) || null)); return airport(); }
    if (e.target.closest("[data-apclear]")) { sessionStorage.removeItem("pl_air_ep"); return airport(); }
    const apd = e.target.closest("[data-apdel]");
    if (apd) { if (!sure(apd, "Sil?")) return; await api("POST", "", { action: "airport_partner_delete", id: apd.dataset.apdel }).then(() => toast("Silindi."), () => toast("Silinemedi.")); return airport(); }
  });
  app.addEventListener("change", async (e) => {
    if (e.target.matches("[data-airf]")) { sessionStorage.setItem("pl_airf", e.target.value); return airport(); }
    const ast = e.target.closest("[data-astatus]");
    if (ast && ast.value) { await api("POST", "", { action: "airport_status", id: ast.dataset.astatus, status: ast.value }).then(() => toast("Durum kaydedildi."), () => toast("Kaydedilemedi.")); return airport(); }
    const apr = e.target.closest("[data-apartner]");
    if (apr) { await api("POST", "", { action: "airport_partner", id: apr.dataset.apartner, partner_id: apr.value }).then(() => toast("Partner kaydedildi."), () => toast("Kaydedilemedi.")); return; }
    const anote = e.target.closest("[data-anote]");
    if (anote) { await api("POST", "", { action: "airport_note", id: anote.dataset.anote, note: anote.value }).then(() => toast("Not kaydedildi."), () => toast("Kaydedilemedi.")); return; }
    const aup = e.target.closest("[data-aup]");
    if (aup && aup.files[0]) {
      const f = aup.files[0];
      if (f.size > 8 * 1024 * 1024) return toast("Dosya çok büyük (en fazla 8 MB).");
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      toast("Yükleniyor …");
      await api("POST", "", { action: "airport_upload", id: aup.dataset.aup, name: f.name, type: f.type, data }).then(() => toast("Yüklendi – şimdi “Müşteriye teslim et”."), (err) => toast(err.message === "type" ? "Yalnızca PNG, JPG, WEBP veya PDF." : "Yüklenemedi: " + err.message));
      return airport();
    }
    const o = e.target.closest("[data-order]");
    if (o) { await api("POST", "", { action: "order_status", id: o.dataset.order, status: o.value }).then(() => toast("Durum kaydedildi."), () => toast("Kaydedilemedi.")); return; }
    const es = e.target.closest("[data-esim]");
    if (es) { await api("POST", "", { action: "esim_status", id: es.dataset.esim, status: es.value }).then(() => toast("Durum kaydedildi."), () => toast("Kaydedilemedi.")); return; }
    const t = e.target.closest("[data-ticket]");
    if (t) { await api("POST", "", { action: "support_update", id: t.dataset.ticket, status: t.value }).then(() => toast("Durum kaydedildi."), () => toast("Kaydedilemedi.")); return; }
    if (e.target.matches("[data-ofilter]")) { sessionStorage.setItem("pl_ost", e.target.value); orders(); }
    if (e.target.matches("[data-nlfilter]")) { sessionStorage.setItem("pl_nl", e.target.value); newsletter(); }
    if (e.target.matches("[data-tfile]")) { sessionStorage.setItem("pl_tfile", e.target.value); translations(); }
    if (e.target.matches("[data-tlang]")) { sessionStorage.setItem("pl_tlang", e.target.value); translations(); }
    if (e.target.matches("[data-tmiss]")) { sessionStorage.setItem("pl_tmiss", e.target.value); translations(); }
  });
  app.addEventListener("input", (e) => {
    if (e.target.matches("[data-search]")) { const q = e.target.value.trim().toLowerCase(); $$("[data-row]").forEach((r) => (r.hidden = !!q && !r.dataset.row.includes(q))); }
    if (e.target.matches("[data-pfilter]")) { const q = e.target.value.trim().toLowerCase(); $$("[data-prow]").forEach((r) => (r.hidden = !!q && !r.dataset.prow.includes(q))); }
  });
  app.addEventListener("submit", async (e) => {
    const f = e.target;
    if (f.matches("[data-aoffer], [data-apartnerf], [data-aset]")) {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      d.active = f.active ? f.active.checked : undefined;
      const btn = $("button[type=submit]", f); if (btn) btn.disabled = true;
      try {
        if (f.matches("[data-aoffer]")) { await api("POST", "", { action: "airport_offer_save", ...d }); sessionStorage.removeItem("pl_air_eo"); toast("Teklif kaydedildi."); }
        if (f.matches("[data-apartnerf]")) { await api("POST", "", { action: "airport_partner_save", ...d }); sessionStorage.removeItem("pl_air_ep"); toast("Partner kaydedildi."); }
        if (f.matches("[data-aset]")) { const settings = { ...d }; ["enabled", "auto_send", "send_test", "notify_admin"].forEach((k) => (settings[k] = !!f[k].checked)); await api("POST", "", { action: "airport_settings", settings }); toast("Ayarlar kaydedildi."); }
        return airport();
      } catch (err) { toast(err.message === "invalid" ? "Girdileri kontrol et (e-posta veya WhatsApp gerekli; IATA 3 harf)." : "Kaydedilemedi: " + err.message); if (btn) btn.disabled = false; }
      return;
    }
    if (f.matches("[data-nladd], [data-newpost], [data-disc]")) {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const btn = $("button[type=submit]", f); if (btn) btn.disabled = true;
      try {
        if (f.matches("[data-nladd]")) { await api("POST", "", { action: "newsletter_add", email: d.email }); toast("Abone eklendi."); return newsletter(); }
        if (f.matches("[data-disc]")) { await api("POST", "", { action: "discount_save", ...d }); toast("İndirim kodu oluşturuldu."); return discounts(); }
        if (f.matches("[data-newpost]")) {
          // Neuer Ratgeber als Entwurf; dann direkt im Editor öffnen
          const slug = String(d.title).toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "rehber-" + Date.now();
          const file = `content/posts/${slug}.json`;
          const ex = await api("POST", "", { action: "content_get", file });
          if (ex.data) { toast("Bu adla bir yazı zaten var – başlığı değiştir."); if (btn) btn.disabled = false; return; }
          const tr = { date: new Date().toISOString().slice(0, 10), title: d.title, excerpt: "", category: "eSIM Rehberi", readTime: "5 dk", image: "", body: "## Giriş\n\nMetni buraya yaz.", cta: "esim", draft: true };
          await api("POST", "", { action: "content_put", file, data: { tr } });
          toast("Taslak oluşturuldu – editör açılıyor.");
          sessionStorage.setItem("pl_edfile", file); location.hash = "editor"; return;
        }
      } catch (err) { toast(err.message === "exists" ? "Bu kod zaten var." : err.message === "github_missing" ? "Bunun için GITHUB_CONTENT_TOKEN gerekli." : "Kaydedilemedi: " + err.message); if (btn) btn.disabled = false; }
      return;
    }
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
