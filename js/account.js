/* ==========================================================================
   passport.io – Kundenkonto (nur auf account.html geladen)
   Anmeldung: E-Mail + Passwort mit 6-stelligem Code, Google, Apple (Supabase Auth)
   Profil: gebuchte eSIMs mit QR-Code, Verbrauch, Restlaufzeit; Bestellungen; Einstellungen
   Wird von app.js mit window.PP_ACCOUNT(ctx) gestartet.
   ========================================================================== */
window.PP_ACCOUNT = function (ctx) {
  "use strict";
  const { root, A, esc, icon, flag, LANG, LOCALE, LANGS, CUR, ESIM, toast, cfg } = ctx;
  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => [...el.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);
  const here = location.origin + location.pathname;
  const fmtDate = (d) => { try { return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric" }).format(new Date(d)); } catch (_) { return d; } };
  const fmtTime = (d) => { try { return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" }).format(new Date(d)); } catch (_) { return ""; } };
  const money = (n, c) => { try { return new Intl.NumberFormat(LOCALE, { style: "currency", currency: c, currencyDisplay: "narrowSymbol" }).format(n); } catch (_) { return `${n} ${c}`; } };
  const gb = (mb) => { const v = Number(mb || 0) / 1024; return `${v >= 10 ? v.toFixed(0) : v.toFixed(v ? 1 : 0).replace(/\.0$/, "")} GB`.replace(".", LOCALE.startsWith("en") ? "." : ","); };
  const countryName = (c) => ESIM.countries.find((x) => x.code === c)?.name || (c || "").toUpperCase();

  if (!cfg?.url || !cfg?.anonKey || !window.supabase) {
    root.innerHTML = `<div class="acct-card acct-card--center"><h1 class="acct-title">${esc(A("title"))}</h1><p class="acct-sub">${esc(A("notConfigured"))}</p></div>`;
    return;
  }
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  // Nur Anmeldewege zeigen, die in Supabase wirklich eingeschaltet sind (sonst landet man auf einer Fehlerseite)
  let enabled = { google: false, apple: false };
  const providersReady = fetch(`${cfg.url}/auth/v1/settings`, { headers: { apikey: cfg.anonKey } })
    .then((r) => r.json()).then((s) => { enabled = { google: !!s.external?.google, apple: !!s.external?.apple }; }).catch(() => {});
  // Fehler aus einer abgebrochenen Google/Apple-Anmeldung (…#error=…) verständlich anzeigen
  const oauthError = new URLSearchParams(location.hash.slice(1)).get("error_description") || params.get("error_description");

  // Alte Kauf-Links (account.html?buy=…&plan=…) bestellen nicht mehr direkt – ein fremder Link könnte sonst
  // nach der Anmeldung eine Bestellung auslösen. Sie legen das Paket nur in den Warenkorb und öffnen ihn.
  if (params.get("buy") && params.get("plan")) {
    try {
      const c = JSON.parse(localStorage.getItem("pp_cart") || "[]");
      if (Array.isArray(c) && c.length < 10) c.push({ item: String(params.get("buy")).slice(0, 60), plan: String(params.get("plan")).slice(0, 80), at: Date.now() });
      localStorage.setItem("pp_cart", JSON.stringify(c));
    } catch (_) {}
    location.replace("index.html?cart=1");
    return;
  }
  // Kasse aus dem Warenkorb: account.html?cart=1 – Artikel und geprüfter Rabattcode liegen im Browser (app.js)
  const readLS = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (_) { return null; } };
  if (params.has("cart")) {
    const items = (readLS("pp_cart") || []).filter((x) => x && x.item && x.plan).slice(0, 10);
    const c = readLS("pp_cart_coupon");
    if (items.length) { try { sessionStorage.setItem("pp_buy", JSON.stringify({ cart: items.map((x) => ({ item: x.item, plan: x.plan })), coupon: c?.code, couponFor: c?.for })); } catch (_) {} }
    history.replaceState(null, "", location.pathname + location.hash);
  }
  const pendingBuy = () => { try { return JSON.parse(sessionStorage.getItem("pp_buy") || "null"); } catch (_) { return null; } };

  /* ---------- Fehlertexte ---------- */
  const errText = (e) => {
    const m = String(e?.message || e || "").toLowerCase();
    if (/invalid login|invalid credentials/.test(m)) return A("errInvalid");
    if (/already registered|already exists|user_already_exists/.test(m)) return A("errExists");
    if (/password/.test(m) && /(weak|short|least|characters)/.test(m)) return A("errWeak");
    if (/token|otp|expired|invalid code/.test(m)) return A("errCode");
    if (/rate|too many|security purposes/.test(m)) return A("errRate");
    if (/fetch|network/.test(m)) return A("errNetwork");
    return A("errGeneric");
  };
  const userErr = (text) => Object.assign(new Error(text), { user: true }); // Meldung direkt anzeigen
  const strong = (p) => p.length >= 8 && /[a-zA-ZğüşöçıİĞÜŞÖÇ\p{L}]/u.test(p) && /\d/.test(p);

  /* ---------- Bausteine ---------- */
  const field = (name, type, label, extra = "") => `
    <label class="acct-field"><span>${esc(label)}</span>
      <input name="${name}" type="${type}" ${extra} required>
    </label>`;
  const pwField = (name, label, auto) => `
    <label class="acct-field"><span>${esc(label)}</span>
      <span class="acct-pw"><input name="${name}" type="password" autocomplete="${auto}" minlength="8" required>
      <button type="button" class="acct-eye" data-eye aria-label="${esc(A("showPassword"))}">${eye}</button></span>
    </label>`;
  const eye = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const socialHtml = () => !enabled.google && !enabled.apple ? "" : `
    <div class="acct-social">
      ${enabled.google ? `<button type="button" class="acct-oauth" data-oauth="google"><svg viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.8-5.4 3.8-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12Z"/></svg>${esc(A("google"))}</button>` : ""}
      ${enabled.apple ? `<button type="button" class="acct-oauth acct-oauth--apple" data-oauth="apple"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M16.4 12.7c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.5-1-2.5-3.9ZM14 5.6c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4Z"/></svg>${esc(A("apple"))}</button>` : ""}
    </div>
    <div class="acct-or"><span>${esc(A("or"))}</span></div>`;
  const shell = (title, sub, body, foot = "") => `
    <div class="acct-card">
      <a class="acct-logo" href="index.html" aria-label="passport.io"><svg class="logo__mark"><use href="#i-pass"/></svg></a>
      <h1 class="acct-title">${esc(title)}</h1>
      ${sub ? `<p class="acct-sub">${sub}</p>` : ""}
      ${pendingBuy() ? `<p class="acct-note">${esc(A("buyLogin"))}</p>` : ""}
      ${body}
      <p class="acct-msg" role="alert" aria-live="polite"></p>
      ${foot ? `<div class="acct-foot">${foot}</div>` : ""}
    </div>`;
  const say = (text, ok) => { const m = $(".acct-msg"); if (m) { m.textContent = text || ""; m.classList.toggle("is-ok", !!ok); } };
  const busy = (form, on) => { const b = $("button[type=submit]", form); if (b) { b.disabled = on; b.classList.toggle("is-busy", on); } };
  const go = (view, data) => { state.data = data || {}; location.hash = view; render(); };
  const state = { view: "", data: {}, account: null, tab: "esims" };

  /* ---------- Ansichten: Anmeldung ---------- */
  const views = {
    login: () => shell(A("loginTitle"), esc(A("loginSub")), `${socialHtml()}
      <form data-form="login" novalidate>
        ${field("email", "email", A("email"), 'autocomplete="email" inputmode="email"')}
        ${pwField("password", A("password"), "current-password")}
        <a class="acct-link acct-forgot" href="#forgot">${esc(A("forgot"))}</a>
        <button class="btn btn--green acct-submit" type="submit">${esc(A("login"))}</button>
      </form>`, `${esc(A("noAccount"))} <a class="acct-link" href="#register">${esc(A("register"))}</a>`),

    register: () => shell(A("registerTitle"), esc(A("registerSub")), `${socialHtml()}
      <form data-form="register" novalidate>
        ${field("name", "text", A("name"), 'autocomplete="name" maxlength="120"')}
        ${field("email", "email", A("email"), 'autocomplete="email" inputmode="email"')}
        ${pwField("password", A("password"), "new-password")}
        <p class="acct-hint">${esc(A("passwordHint"))}</p>
        <label class="acct-check"><input type="checkbox" name="terms"> <span>${esc(A("termsAccept"))}</span></label>
        <label class="acct-check"><input type="checkbox" name="marketing"> <span>${esc(A("marketing"))}</span></label>
        <button class="btn btn--green acct-submit" type="submit">${esc(A("register"))}</button>
      </form>`, `${esc(A("haveAccount"))} <a class="acct-link" href="#login">${esc(A("login"))}</a>`),

    verify: () => shell(A("verifyTitle"), A("verifySub", { email: `<b>${esc(state.data.email || "")}</b>` }), `
      <form data-form="verify" novalidate>
        <label class="acct-field"><span>${esc(A("code"))}</span>
          <input name="code" class="acct-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="8" required></label>
        <button class="btn btn--green acct-submit" type="submit">${esc(A("verify"))}</button>
      </form>
      <button type="button" class="acct-link acct-resend" data-resend="signup">${esc(A("resend"))}</button>`,
      `<a class="acct-link" href="#login">${esc(A("back"))}</a>`),

    forgot: () => shell(A("forgotTitle"), esc(A("forgotSub")), `
      <form data-form="forgot" novalidate>
        ${field("email", "email", A("email"), 'autocomplete="email" inputmode="email"')}
        <button class="btn btn--green acct-submit" type="submit">${esc(A("sendCode"))}</button>
      </form>`, `<a class="acct-link" href="#login">${esc(A("back"))}</a>`),

    reset: () => shell(A("resetTitle"), state.data.email ? A("resetSub", { email: `<b>${esc(state.data.email)}</b>` }) : esc(A("resetSubLink")), `
      <form data-form="reset" novalidate>
        ${state.data.email ? `<label class="acct-field"><span>${esc(A("code"))}</span><input name="code" class="acct-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required></label>` : ""}
        ${pwField("password", A("newPassword"), "new-password")}
        <p class="acct-hint">${esc(A("passwordHint"))}</p>
        <button class="btn btn--green acct-submit" type="submit">${esc(A("savePassword"))}</button>
      </form>
      ${state.data.email ? `<button type="button" class="acct-link acct-resend" data-resend="recovery">${esc(A("resend"))}</button>` : ""}`,
      `<a class="acct-link" href="#login">${esc(A("back"))}</a>`),
  };

  /* ---------- Ansicht: Profil ---------- */
  const statusLabel = (s) => A("status_" + s);
  function esimCard(e) {
    const total = Number(e.data_total_mb || 0), used = Math.min(total || Infinity, Number(e.data_used_mb || 0));
    const pct = total ? Math.round((used / total) * 100) : 0;
    const left = Math.max(0, total - used);
    const live = ["active", "installed"].includes(e.status);
    return `
      <article class="esim ${"esim--" + esc(e.status)}">
        <header class="esim__head">
          ${e.country && e.country.length === 2 ? `<img class="esim__flag" src="${flag(e.country)}" alt="">` : `<span class="esim__flag esim__flag--globe">${icon("globe")}</span>`}
          <div><h3>${esc(countryName(e.country))}</h3><p>${esc(e.plan_name ? e.plan_name.replace(/^Unlimited/, A("unlimited")).replace(/·\s*(\d+)$/, (m, n) => "· " + A("days", { n })) : "")}</p></div>
          <span class="esim__badge">${esc(statusLabel(e.status))}</span>
        </header>
        ${e.test ? `<p class="esim__test">${esc(A("testBadge"))}</p>` : ""}
        ${e.status === "processing" ? `<p class="esim__test">${esc(A("processingNote"))}</p>` : ""}
        ${e.unlimited ? `
        <div class="esim__usage">
          <div class="esim__bar esim__bar--unl" aria-hidden="true"><i style="width:100%"></i></div>
          <div class="esim__nums"><span>${esc(A("dataUsedUnl", { used: gb(Number(e.data_used_mb || 0)) }))}</span><b>${esc(A("unlimited"))}</b></div>
        </div>` : `
        <div class="esim__usage">
          <div class="esim__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
          <div class="esim__nums"><span>${esc(A("dataUsed", { used: gb(used), total: gb(total) }))}</span><b>${esc(A("dataLeft", { left: gb(left) }))}</b></div>
        </div>`}
        <dl class="esim__facts">
          <div><dt>${esc(A("remaining"))}</dt><dd>${e.days_left != null ? esc(A("daysLeft", { n: e.days_left })) : esc(A("validity", { n: e.validity_days || "–" }))}</dd></div>
          <div><dt>${esc(A("validUntilLabel"))}</dt><dd>${e.expires_at ? esc(fmtDate(e.expires_at)) : esc(A("startsOnUse"))}</dd></div>
          <div><dt>ICCID</dt><dd class="esim__mono">${esc(e.iccid || "–")}</dd></div>
        </dl>
        <div class="esim__actions">
          ${e.lpa && !["expired", "cancelled"].includes(e.status) ? `<button type="button" class="btn btn--green btn--sm" data-qr="${esc(e.id)}">${icon("qr")} ${esc(A("showQr"))}</button>` : ""}
          <a class="btn btn--line btn--sm" href="install.html">${esc(A("install"))}</a>
        </div>
        ${e.usage_checked_at && live ? `<p class="esim__upd">${esc(A("updated", { time: fmtTime(e.usage_checked_at) }))}</p>` : ""}
      </article>`;
  }
  function profileView() {
    const a = state.account, p = a.profile || {}, name = (p.full_name || "").split(" ")[0];
    const tabs = [["esims", A("tabEsims")], ["orders", A("tabOrders")], ["profile", A("tabProfile")]];
    let body = "";
    if (state.tab === "esims") {
      body = a.esims.length ? `<div class="esim-grid">${a.esims.map(esimCard).join("")}</div>`
        : `<div class="acct-empty">${icon("sim")}<h3>${esc(A("emptyTitle"))}</h3><p>${esc(A("emptyText"))}</p><a class="btn btn--green" href="index.html#esim">${esc(A("emptyCta"))}</a></div>`;
    } else if (state.tab === "orders") {
      // Retoure: nur bezahlte Bestellungen innerhalb der Frist, deren eSIM noch nicht installiert ist
      const refundable = (o) => {
        if (!["paid", "fulfilled"].includes(o.status)) return false;
        if (Date.now() - new Date(o.created_at).getTime() > (a.refundDays || 30) * 864e5) return false;
        return !(a.esims || []).some((e) => e.order_id === o.id && (!["processing", "ready", "cancelled"].includes(e.status) || e.activated_at));
      };
      body = a.orders.length ? `<div class="orders">${a.orders.map((o) => {
        const rr = (a.refunds || []).find((r) => r.order_id === o.id);
        return `
        <div class="order order--wrap"><div><b>${esc(countryName((o.item_key || "").split(":")[1]))}</b><span>${esc(fmtDate(o.created_at))} · ${esc((o.title || "").replace(/·\s*(\d+)$/, (m, n) => "· " + A("days", { n })))}</span></div>
        <div class="order__right"><b>${esc(money(o.amount, o.currency))}</b><span class="order__st order__st--${esc(o.status)}">${esc(A("order_" + o.status))}${o.test ? " · Test" : ""}</span></div>
        ${rr ? `<p class="order__refund order__refund--${esc(rr.status)}">${esc(A("refund_" + rr.status))}</p>`
          : refundable(o) ? `<details class="order__more"><summary>${esc(A("refundBtn"))}</summary>
            <form data-form="refund" data-order="${esc(o.id)}" class="acct-panel acct-panel--inline">
              <p class="acct-hint">${esc(A("refundText", { days: a.refundDays || 30 }))}</p>
              <label class="acct-field"><span>${esc(A("refundReason"))}</span><input name="reason" maxlength="1000"></label>
              <button class="btn btn--line btn--sm acct-submit" type="submit">${esc(A("refundSend"))}</button>
              <p class="acct-msg" role="status"></p>
            </form></details>` : ""}
        </div>`; }).join("")}</div>`
        : `<div class="acct-empty"><p>${esc(A("ordersEmpty"))}</p></div>`;
    } else {
      const provs = (a.user.providers || []).map((x) => (x === "email" ? A("email") : x[0].toUpperCase() + x.slice(1))).join(", ");
      body = `
        <form class="acct-panel" data-form="support">
          <h3>${esc(A("supportTitle"))}</h3>
          <p class="acct-hint">${esc(A("supportText"))}</p>
          <label class="acct-field"><span>${esc(A("supportSubject"))}</span><input name="subject" maxlength="160"></label>
          <label class="acct-field"><span>${esc(A("supportMessage"))}</span><textarea name="message" rows="4" maxlength="4000" required></textarea></label>
          <button class="btn btn--dark acct-submit" type="submit">${esc(A("supportSend"))}</button>
          <p class="acct-msg" role="status"></p>
          ${(a.tickets || []).length ? `<p class="acct-hint"><b>${esc(A("supportHistory"))}:</b> ${(a.tickets || []).map((tk) => `${esc(fmtDate(tk.created_at))} · ${esc(tk.subject || "–")} (${esc(A("ticket_" + tk.status))})`).join(" · ")}</p>` : ""}
        </form>
        <form class="acct-panel" data-form="profile">
          <h3>${esc(A("profileTitle"))}</h3>
          <label class="acct-field"><span>${esc(A("name"))}</span><input name="full_name" maxlength="120" value="${esc(p.full_name || "")}" autocomplete="name"></label>
          <label class="acct-field"><span>${esc(A("email"))}</span><input value="${esc(a.user.email || "")}" disabled></label>
          <div class="acct-row">
            <label class="acct-field"><span>${esc(A("language"))}</span><select name="language">${LANGS.languages.map((l) => `<option value="${l.code}" ${(p.language || LANG) === l.code ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
            <label class="acct-field"><span>${esc(A("currency"))}</span><select name="currency">${(LANGS.currencies || []).map((c) => `<option value="${c.code}" ${(p.currency || CUR) === c.code ? "selected" : ""}>${c.code}</option>`).join("")}</select></label>
          </div>
          <label class="acct-check"><input type="checkbox" name="marketing" ${p.marketing ? "checked" : ""}> <span>${esc(A("marketing"))}</span></label>
          <button class="btn btn--dark acct-submit" type="submit">${esc(A("save"))}</button>
          <p class="acct-msg" role="status"></p>
        </form>
        <form class="acct-panel" data-form="password">
          <h3>${esc(A("securityTitle"))}</h3>
          <p class="acct-hint">${esc(A("connected"))}: <b>${esc(provs || "–")}</b> · ${esc(A("memberSince", { date: fmtDate(a.user.created_at) }))}</p>
          ${pwField("password", A("newPassword"), "new-password")}
          <p class="acct-hint">${esc(A("passwordHint"))}</p>
          <button class="btn btn--line acct-submit" type="submit">${esc(A("changePassword"))}</button>
          <p class="acct-msg" role="status"></p>
        </form>
        <form class="acct-panel acct-panel--danger" data-form="delete">
          <h3>${esc(A("deleteTitle"))}</h3>
          <p class="acct-hint">${esc(A("deleteText"))}</p>
          <label class="acct-field"><span>${esc(A("deleteConfirm", { word: A("deleteWord") }))}</span><input name="confirm" autocomplete="off"></label>
          <button class="btn acct-danger acct-submit" type="submit">${esc(A("deleteBtn"))}</button>
          <p class="acct-msg" role="status"></p>
        </form>`;
    }
    return `
      <div class="acct-dash">
        <header class="acct-dash__head">
          <div><p class="kicker kicker--dark">${esc(A("title"))}</p><h1 class="h2">${esc(name ? A("hello", { name }) : A("helloNoName"))}</h1><p class="acct-sub">${esc(a.user.email || "")}</p></div>
          <button type="button" class="btn btn--line btn--sm" data-logout>${esc(A("logout"))}</button>
        </header>
        <div class="faq__filters acct-tabs" role="tablist">${tabs.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}" class="${state.tab === id ? "is-active" : ""}" aria-selected="${state.tab === id}">${esc(l)}${id === "esims" && a.esims.length ? ` <small>${a.esims.length}</small>` : ""}</button>`).join("")}</div>
        <div class="acct-body">${body}</div>
      </div>`;
  }

  /* ---------- QR-Code-Fenster ---------- */
  function openQr(e) {
    let svg = "";
    try { const q = window.qrcode(0, "M"); q.addData(e.lpa); q.make(); svg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (_) { svg = ""; }
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `
      <div class="modal__backdrop" data-close></div>
      <div class="modal__panel qr-panel" role="dialog" aria-modal="true" aria-label="${esc(A("qrTitle"))}">
        <button class="modal__close icon-btn" type="button" data-close aria-label="${esc(A("close"))}">${icon("x")}</button>
        <h3 class="h3">${esc(A("qrTitle"))}</h3>
        <p class="modal__lead">${esc(A("qrSub"))}</p>
        ${e.test ? `<p class="esim__test">${esc(A("testBadge"))}</p>` : ""}
        <div class="qr-box">${svg}</div>
        ${ios ? `<a class="btn btn--dark qr-ios" href="https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(e.lpa)}">${esc(A("iosInstall"))}</a>` : ""}
        <dl class="qr-codes">
          ${[["smdp", e.smdp_address], ["activation", e.activation_code]].filter(([, v]) => v).map(([k, v]) => `
            <div><dt>${esc(A(k))}</dt><dd><code>${esc(v)}</code><button type="button" class="acct-copy" data-copy="${esc(v)}">${esc(A("copy"))}</button></dd></div>`).join("")}
        </dl>
        <p class="modal__tip">${esc(A("qrWarn"))}</p>
        <a class="link-arrow" href="install.html">${esc(A("install"))} ${icon("arrow")}</a>
      </div>`;
    document.body.appendChild(m);
    document.body.style.overflow = "hidden";
    const close = () => { m.remove(); document.body.style.overflow = ""; };
    m.addEventListener("click", async (ev) => {
      if (ev.target.closest("[data-close]")) return close();
      const c = ev.target.closest("[data-copy]");
      if (c) {
        try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = A("copied"); setTimeout(() => (c.textContent = A("copy")), 1500); }
        catch (_) { const r = document.createRange(); r.selectNodeContents(c.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); }
      }
    });
    document.addEventListener("keydown", function k(ev) { if (ev.key === "Escape") { close(); document.removeEventListener("keydown", k); } });
  }

  /* ---------- Server: Konto-Funktion ---------- */
  async function api(method, body) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error("unauthorized");
    const r = await fetch(cfg.accountUrl, { method, headers: { Authorization: `Bearer ${session.access_token}`, apikey: cfg.anonKey, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 409) throw Object.assign(new Error(d.error || "server"), { status: r.status, data: d });
    return { status: r.status, ...d };
  }
  let loading = false;
  async function loadAccount() {
    if (loading) return; loading = true;
    root.innerHTML = `<div class="acct-loading">${esc(A("loading"))}</div>`;
    try { state.account = await api("GET"); }
    catch (e) { loading = false; if (e.message === "unauthorized" || e.status === 401) { await sb.auth.signOut(); return go("login"); } root.innerHTML = `<div class="acct-card"><p class="acct-sub">${esc(errText(e))}</p></div>`; return; }
    loading = false;
    const b = pendingBuy();
    if (b) {
      try { sessionStorage.removeItem("pp_buy"); } catch (_) {}
      toast(A("buying"));
      // Ein Artikel (alter Weg) oder der ganze Warenkorb – je Artikel eine Bestellung, Rabattcode nur für den gewählten Artikel
      const list = b.cart || [{ item: b.item, plan: b.plan }];
      let couponLeft = b.coupon, done = 0; const okIdx = [];
      try {
        for (const [k, it] of list.entries()) {
          const useCoupon = couponLeft && (!b.cart || !b.couponFor || it.plan === b.couponFor);
          const r = await api("POST", { action: "order", item: it.item, planId: it.plan, currency: CUR, coupon: useCoupon ? couponLeft : undefined });
          if (useCoupon) { couponLeft = undefined; if (r.coupon === "invalid") toast(A("couponInvalid")); }
          if (r.status === 409) { toast(A("payMissing")); break; }
          if (r.esim) { done++; okIdx.push(k); }
        }
        if (done) {
          toast(A("buyDone")); state.account = await api("GET");
          // Bestellte Artikel aus dem Warenkorb nehmen (der Rest bleibt für später)
          if (b.cart) {
            try {
              const left = readLS("pp_cart") || [];
              for (const k of okIdx) { const at = left.findIndex((x) => x.item === list[k].item && x.plan === list[k].plan); if (at >= 0) left.splice(at, 1); }
              localStorage.setItem("pp_cart", JSON.stringify(left));
              if (!couponLeft) localStorage.removeItem("pp_cart_coupon");
            } catch (_) {}
          }
        }
      } catch (e) { toast(errText(e)); }
    }
    state.view = "profile";
    render();
  }

  /* ---------- Darstellung und Ereignisse ---------- */
  function render() {
    const v = (location.hash || "").slice(1);
    if (state.account) { root.innerHTML = profileView(); return; }
    state.view = views[v] ? v : "login";
    root.innerHTML = views[state.view]();
    $("input:not([type=checkbox])")?.focus({ preventScroll: true });
  }

  root.addEventListener("click", async (e) => {
    const eyeBtn = e.target.closest("[data-eye]");
    if (eyeBtn) { const i = eyeBtn.previousElementSibling; i.type = i.type === "password" ? "text" : "password"; return; }
    const o = e.target.closest("[data-oauth]");
    if (o) {
      const { error } = await sb.auth.signInWithOAuth({ provider: o.dataset.oauth, options: { redirectTo: here } });
      if (error) say(errText(error));
      return;
    }
    const rs = e.target.closest("[data-resend]");
    if (rs) {
      if (rs.disabled) return;
      const email = state.data.email;
      const { error } = rs.dataset.resend === "signup" ? await sb.auth.resend({ type: "signup", email }) : await sb.auth.resetPasswordForEmail(email, { redirectTo: here + "#reset" });
      say(error ? errText(error) : A("resent"), !error);
      rs.disabled = true; let s = 60;
      const tick = setInterval(() => { s--; rs.textContent = s > 0 ? A("resendIn", { s }) : A("resend"); if (s <= 0) { clearInterval(tick); rs.disabled = false; } }, 1000);
      return;
    }
    const tab = e.target.closest("[data-tab]");
    if (tab) { state.tab = tab.dataset.tab; render(); return; }
    const qr = e.target.closest("[data-qr]");
    if (qr) { const es = state.account.esims.find((x) => x.id === qr.dataset.qr); if (es) openQr(es); return; }
    if (e.target.closest("[data-logout]")) { await sb.auth.signOut(); state.account = null; go("login"); }
  });

  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, kind = f.dataset.form, d = Object.fromEntries(new FormData(f));
    const msg = (t, ok) => { const m = $(".acct-msg", f.closest(".acct-panel") || root); if (m) { m.textContent = t; m.classList.toggle("is-ok", !!ok); } };
    const email = String(d.email || "").trim().toLowerCase();
    busy(f, true);
    try {
      if (kind === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password: d.password });
        if (error) {
          if (/not confirmed/i.test(error.message)) { await sb.auth.resend({ type: "signup", email }); go("verify", { email }); say(A("errNotConfirmed")); return; }
          throw error;
        }
        await loadAccount();
      } else if (kind === "register") {
        if (!f.terms.checked) throw userErr(A("errTerms"));
        if (!strong(d.password)) throw userErr(A("errWeak"));
        const { data, error } = await sb.auth.signUp({ email, password: d.password, options: { emailRedirectTo: here, data: { full_name: String(d.name || "").trim(), language: LANG, marketing: !!f.marketing.checked } } });
        if (error) throw error;
        if (data.session) return loadAccount();                       // E-Mail-Bestätigung ausgeschaltet
        if (data.user && !data.user.identities?.length) throw new Error("already registered");
        go("verify", { email });
      } else if (kind === "verify") {
        const { error } = await sb.auth.verifyOtp({ email: state.data.email, token: String(d.code).trim(), type: "email" });
        if (error) throw error;
        await loadAccount();
      } else if (kind === "forgot") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here + "#reset" });
        if (error) throw error;
        go("reset", { email });
      } else if (kind === "reset") {
        if (!strong(d.password)) throw userErr(A("errWeak"));
        if (state.data.email) { const { error } = await sb.auth.verifyOtp({ email: state.data.email, token: String(d.code).trim(), type: "recovery" }); if (error) throw error; }
        const { error } = await sb.auth.updateUser({ password: d.password });
        if (error) throw error;
        toast(A("passwordSaved"));
        await loadAccount();
      } else if (kind === "profile") {
        await api("POST", { action: "profile", full_name: d.full_name, language: d.language, currency: d.currency, marketing: !!f.marketing.checked });
        state.account.profile = { ...state.account.profile, full_name: d.full_name, language: d.language, currency: d.currency, marketing: !!f.marketing.checked };
        msg(A("saved"), true);
        // Gewählte Sprache und Währung auch für die Webseite übernehmen
        try { localStorage.setItem("pp_lang", d.language); localStorage.setItem("pp_cur", d.currency); } catch (_) {}
        if (d.language !== LANG) setTimeout(() => (location.href = `${location.pathname}?lang=${d.language}&keep=1`), 600);
      } else if (kind === "password") {
        if (!strong(d.password)) throw userErr(A("errWeak"));
        const { error } = await sb.auth.updateUser({ password: d.password });
        if (error) throw error;
        f.reset(); msg(A("passwordSaved"), true);
      } else if (kind === "refund") {
        const res = await api("POST", { action: "refund_request", orderId: f.dataset.order, reason: d.reason });
        if (res.error) throw new Error(res.error); // 409-Antworten (Frist, bereits beantragt …) werfen in api() nicht
        toast(A("refundSent"));
        state.account = await api("GET"); render();
      } else if (kind === "support") {
        await api("POST", { action: "support", subject: d.subject, message: d.message });
        f.reset(); msg(A("supportSent"), true);
      } else if (kind === "delete") {
        if (String(d.confirm || "").trim().toLocaleUpperCase(LOCALE) !== A("deleteWord").toLocaleUpperCase(LOCALE)) throw userErr(A("deleteConfirm", { word: A("deleteWord") }));
        await api("POST", { action: "delete" });
        await sb.auth.signOut();
        state.account = null; toast(A("deleted")); go("login");
      }
    } catch (err) {
      const known = !!err.user;
      const apiMsg = { too_late: "errTooLate", esim_used: "errEsimUsed", already_requested: "errAlready", rate_limited: "errRate", invalid: "errGeneric" }[err.message];
      (["profile", "password", "delete", "refund", "support"].includes(kind) ? msg : say)(known ? err.message : apiMsg ? A(apiMsg) : errText(err));
    } finally { busy(f, false); }
  });

  window.addEventListener("hashchange", () => { if (!state.account) render(); });
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { state.account = null; go("reset", {}); }        // Link aus der E-Mail statt Code
    else if (event === "SIGNED_IN" && session && !state.account && state.view !== "reset") loadAccount();
  });
  Promise.all([sb.auth.getSession(), providersReady]).then(([{ data: { session } }]) => {
    if (session) return loadAccount();
    render();
    if (oauthError) say(errText(oauthError));
  });
};
