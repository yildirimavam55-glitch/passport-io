/* ==========================================================================
   passport.io – Shop-Verwaltung (Übersicht, Bestellungen, Kunden, eSIMs, Preise, Anbieter)
   Anmeldung über Supabase; Zugriff nur für E-Mails im Secret ADMIN_EMAILS (Funktion „admin“).
   ========================================================================== */
(async () => {
  "use strict";
  const app = document.getElementById("app");
  if (window.top !== window.self) { app.innerHTML = ""; return; }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s, el = app) => el.querySelector(s);
  const $$ = (s, el = app) => [...el.querySelectorAll(s)];
  const date = (d) => (d ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d)) : "–");
  const money = (n, c) => { try { return new Intl.NumberFormat("de-DE", { style: "currency", currency: c || "EUR" }).format(n); } catch (_) { return `${n} ${c}`; } };
  const gb = (mb) => `${(Number(mb || 0) / 1024).toFixed(1).replace(".", ",")} GB`;
  const toast = (t) => { const d = document.createElement("div"); d.className = "pl-toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3200); };
  const ORDER_ST = { pending: "Zahlung ausstehend", paid: "Bezahlt", fulfilled: "Abgeschlossen", failed: "Fehlgeschlagen", refunded: "Erstattet", cancelled: "Storniert" };
  const ESIM_ST = { ready: "Bereit", installed: "Installiert", active: "Aktiv", depleted: "Aufgebraucht", expired: "Abgelaufen", cancelled: "Storniert" };
  const stClass = (s) => (["paid", "fulfilled", "active"].includes(s) ? "ok" : ["pending", "ready", "installed"].includes(s) ? "warn" : ["failed", "cancelled", "expired", "depleted"].includes(s) ? "bad" : "");

  let cfg = null;
  try { cfg = await fetch("../content/auth.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)); } catch (_) {}
  if (!cfg?.url || !window.supabase) { app.innerHTML = `<div class="pl-login"><form><h1>Shop-Verwaltung</h1><p>Supabase ist für diese Seite noch nicht verbunden. Die Verwaltung funktioniert auf der veröffentlichten Seite.</p></form></div>`; return; }
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

  /* ---------- Anmeldung ---------- */
  function login(msg = "") {
    app.innerHTML = `
      <div class="pl-login"><form data-login>
        <h1>passport.io · Shop-Verwaltung</h1>
        <p>Nur für das Team. Zugriff haben die E-Mail-Adressen im Supabase-Secret <b>ADMIN_EMAILS</b>.</p>
        <label class="pl-field">E-Mail<input name="email" type="email" autocomplete="email" required></label>
        <label class="pl-field">Passwort<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="pl-btn pl-btn--green" type="submit">Anmelden</button>
        <p class="pl-msg">${esc(msg)}</p>
        <p>Noch kein Konto? Zuerst auf der <a href="../account.html#register">Kontoseite</a> registrieren und die E-Mail bestätigen.</p>
      </form></div>`;
    $("[data-login]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, m = $(".pl-msg");
      m.textContent = "";
      const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      if (error) { m.textContent = /invalid/i.test(error.message) ? "E-Mail oder Passwort falsch." : error.message; return; }
      start();
    });
  }

  /* ---------- Gerüst ---------- */
  const NAV = [
    ["overview", "▦", "Übersicht"], ["orders", "🧾", "Bestellungen"], ["customers", "👥", "Kunden"],
    ["esims", "📶", "eSIMs"], ["pricing", "€", "Preise & Wettbewerb"], ["settings", "⚙", "Anbieter & Einstellungen"],
  ];
  let view = (location.hash.slice(1) || "overview"), userEmail = "";
  function shell(title, body) {
    app.innerHTML = `
      <div class="pl">
        <aside class="pl-side">
          <div class="pl-brand">passport<em>.io</em><small>Shop-Verwaltung</small></div>
          ${NAV.map(([id, ic, label]) => `<a class="pl-nav ${id === view ? "is-active" : ""}" href="#${id}"><i>${ic}</i>${label}</a>`).join("")}
          <a class="pl-nav" href="./" target="_blank" rel="noopener"><i>✎</i>Inhalte bearbeiten ↗</a>
          <div class="pl-sep"></div>
          <a class="pl-nav" href="../index.html" target="_blank" rel="noopener"><i>↗</i>Shop ansehen</a>
        </aside>
        <main class="pl-main">
          <div class="pl-top">
            <div style="display:flex;gap:10px;align-items:center"><button class="pl-btn pl-btn--line pl-btn--sm pl-burger" data-menu>☰</button><h1>${esc(title)}</h1></div>
            <div class="pl-user">${esc(userEmail)} <button class="pl-btn pl-btn--line pl-btn--sm" data-logout>Abmelden</button></div>
          </div>
          ${body}
        </main>
      </div>`;
  }
  const loading = (title) => shell(title, `<p class="pl-loading">Wird geladen …</p>`);

  /* ---------- Ansichten ---------- */
  async function overview() {
    loading("Übersicht");
    const d = await api("GET", "?view=overview");
    const rev = Object.entries(d.revenue);
    const s = d.status;
    const check = [
      ["eSIM-Anbieter", s.esim, "Secrets ESIM_API_URL und ESIM_API_KEY in Supabase eintragen."],
      ["Zahlungsanbieter", !!s.payment, "Zahlungsanbieter festlegen und anbinden (PAYMENT_PROVIDER)."],
      ["Anmeldung mit Google", s.google, "Supabase → Authentication → Providers → Google einschalten."],
      ["Anmeldung mit Apple", s.apple, "Supabase → Authentication → Providers → Apple einschalten."],
      ["Inhalts-Editor online (GitHub)", s.cmsGithub, "GitHub OAuth-App anlegen, GITHUB_CLIENT_ID/SECRET eintragen."],
      ["Testmodus aus", !s.testOrders, "Secret ALLOW_TEST_ORDERS vor dem Start entfernen."],
    ];
    shell("Übersicht", `
      <div class="pl-grid">
        <div class="pl-card pl-kpi"><span>Umsatz (bezahlt)</span><b>${rev.length ? rev.map(([c, v]) => esc(money(v, c))).join("<br>") : "0 €"}</b></div>
        <div class="pl-card pl-kpi"><span>Bestellungen (30 Tage)</span><b>${d.orders30}</b></div>
        <div class="pl-card pl-kpi"><span>Kunden</span><b>${d.customers}</b></div>
        <div class="pl-card pl-kpi"><span>eSIMs aktiv / gesamt</span><b>${d.esimsActive} / ${d.esims}</b></div>
      </div>
      <div class="pl-two">
        <div class="pl-card"><h2>Letzte Bestellungen</h2>${ordersTable(d.recent, false)}</div>
        <div class="pl-card"><h2>Startklar? <small>Verkaufsbereitschaft</small></h2>
          <div class="pl-check">${check.map(([l, ok, how]) => `<div><span>${esc(l)}${ok ? "" : `<small>${esc(how)}</small>`}</span><span class="pl-badge ${ok ? "ok" : "warn"}">${ok ? "Erledigt" : "Offen"}</span></div>`).join("")}</div>
          <h2 style="margin-top:18px">Bestellstatus</h2>
          <div class="pl-check">${Object.entries(d.byStatus).map(([k, v]) => `<div><span>${esc(ORDER_ST[k])}</span><b>${v}</b></div>`).join("")}</div>
        </div>
      </div>`);
  }

  function ordersTable(list, editable = true) {
    if (!list.length) return `<p class="pl-empty">Noch keine Bestellungen.</p>`;
    return `<div class="pl-table-wrap"><table><thead><tr><th>Datum</th><th>Kunde</th><th>Produkt</th><th class="num">Betrag</th><th>Status</th></tr></thead><tbody>
      ${list.map((o) => `<tr><td>${esc(date(o.created_at))}</td><td>${esc(o.email)}</td><td>${esc(o.item_key)} · ${esc(o.title || "")}${o.test ? ' <span class="pl-badge warn">Test</span>' : ""}</td>
        <td class="num">${esc(money(o.amount, o.currency))}</td>
        <td>${editable ? `<select data-order="${esc(o.id)}">${Object.entries(ORDER_ST).map(([k, l]) => `<option value="${k}" ${k === o.status ? "selected" : ""}>${l}</option>`).join("")}</select>` : `<span class="pl-badge ${stClass(o.status)}">${esc(ORDER_ST[o.status] || o.status)}</span>`}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  async function orders() {
    loading("Bestellungen");
    const st = sessionStorage.getItem("pl_ost") || "";
    const d = await api("GET", `?view=orders${st ? "&status=" + st : ""}`);
    shell("Bestellungen", `
      <div class="pl-tools"><label class="pl-field">Status<select data-ofilter><option value="">Alle</option>${Object.entries(ORDER_ST).map(([k, l]) => `<option value="${k}" ${k === st ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <p class="pl-help">Status ändern setzt nur den Eintrag. <b>Erstattungen</b> zusätzlich beim Zahlungsanbieter auslösen.</p>
      <div class="pl-card">${ordersTable(d.orders)}</div>`);
  }

  async function customers() {
    loading("Kunden");
    const d = await api("GET", "?view=customers");
    shell("Kunden", `
      <div class="pl-tools"><label class="pl-field">Suchen<input data-search placeholder="E-Mail oder Name"></label></div>
      <div class="pl-card"><div class="pl-table-wrap"><table><thead><tr><th>E-Mail</th><th>Name</th><th>Sprache</th><th>Registriert</th><th>Letzte Anmeldung</th><th>Anmeldung</th><th class="num">Bestellungen</th><th>Newsletter</th></tr></thead><tbody>
      ${d.customers.map((c) => `<tr data-row="${esc((c.email + " " + (c.full_name || "")).toLowerCase())}"><td>${esc(c.email)}</td><td>${esc(c.full_name || "–")}</td><td>${esc((c.language || "–").toUpperCase())}</td><td>${esc(date(c.created_at))}</td><td>${esc(date(c.last_sign_in_at))}</td><td>${esc((c.providers || []).join(", "))}</td><td class="num">${c.paid} / ${c.orders}</td><td>${c.marketing ? '<span class="pl-badge ok">Ja</span>' : "–"}</td></tr>`).join("") || `<tr><td colspan="8" class="pl-empty">Noch keine Kunden.</td></tr>`}
      </tbody></table></div></div>`);
  }

  async function esims() {
    loading("eSIMs");
    const d = await api("GET", "?view=esims");
    shell("eSIMs", `
      <div class="pl-card"><div class="pl-table-wrap"><table><thead><tr><th>Datum</th><th>Kunde</th><th>Land</th><th>Tarif</th><th>ICCID</th><th class="num">Verbrauch</th><th>Gültig bis</th><th>Status</th></tr></thead><tbody>
      ${d.esims.map((e) => `<tr><td>${esc(date(e.created_at))}</td><td>${esc(e.email)}</td><td>${esc((e.country || "").toUpperCase())}</td><td>${esc(e.plan_name || "")}${e.test ? ' <span class="pl-badge warn">Test</span>' : ""}</td><td><span class="mono">${esc(e.iccid || "–")}</span></td>
        <td class="num">${esc(gb(e.data_used_mb))} / ${esc(gb(e.data_total_mb))}</td><td>${esc(e.expires_at ? date(e.expires_at) : "ab Aktivierung")}</td>
        <td><select data-esim="${esc(e.id)}">${Object.entries(ESIM_ST).map(([k, l]) => `<option value="${k}" ${k === e.status ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("") || `<tr><td colspan="8" class="pl-empty">Noch keine eSIMs.</td></tr>`}
      </tbody></table></div></div>`);
  }

  async function pricing() {
    loading("Preise & Wettbewerb");
    const d = await api("GET", "?view=pricing");
    const s = d.settings, p = d.preview;
    const ruleLabel = (r) => ({ competitor: "Wettbewerb − Tick", markup: "Einkauf × Faktor" }[String(r).split("+")[0]] || r) + (String(r).includes("+floor") ? " → Untergrenze" : "");
    shell("Preise & Wettbewerb", `
      <div class="pl-card" style="margin-bottom:14px"><h2>Preisregel</h2>
        <p class="pl-help">Gibt es einen <b>Wettbewerbspreis</b> für dasselbe Produkt (gleiches Land, Volumen, Laufzeit), verkaufen wir <b>einen Tick günstiger</b>. Sonst <b>Einkaufspreis × Faktor</b>. Nie unter dem <b>Mindestpreis</b> und nie unter <b>Einkauf + Mindestmarge</b> (Schutz vor Verlustverkäufen).</p>
        <form class="pl-form" data-settings>
          <label class="pl-field">Faktor (ohne Wettbewerb)<input name="markup_factor" type="number" step="0.01" min="1" value="${esc(s.markup_factor)}"></label>
          <label class="pl-field">Tick unter Wettbewerb (€)<input name="undercut_eur" type="number" step="0.01" min="0" value="${esc(s.undercut_eur)}"></label>
          <label class="pl-field">Mindestpreis (€)<input name="min_price_eur" type="number" step="0.01" min="0" value="${esc(s.min_price_eur)}"></label>
          <label class="pl-field">Mindestmarge (%)<input name="min_margin_pct" type="number" step="1" min="0" value="${esc(s.min_margin_pct)}"></label>
          <label class="pl-field">Auf ,99 runden<select name="round_99"><option value="1" ${s.round_99 ? "selected" : ""}>Ja</option><option value="0" ${s.round_99 ? "" : "selected"}>Nein</option></select></label>
          <button class="pl-btn pl-btn--green" type="submit">Speichern</button>
        </form>
      </div>
      <div class="pl-card" style="margin-bottom:14px"><h2>Wettbewerbspreise <small>${d.competitors.length} Einträge</small></h2>
        <p class="pl-help">Produkt-Schlüssel: <b>country:jp</b>, <b>region:europe</b>, <b>global</b>, <b>lounge</b>, <b>fasttrack</b>. Volumen/Tage leer lassen = gilt für alle Varianten.</p>
        <form class="pl-form pl-form--comp" data-comp>
          <label class="pl-field">Produkt<input name="item_key" placeholder="country:jp" required></label>
          <label class="pl-field">GB<input name="gb" type="number" step="0.1" min="0"></label>
          <label class="pl-field">Tage<input name="days" type="number" step="1" min="0"></label>
          <label class="pl-field">Preis<input name="price" type="number" step="0.01" min="0.01" required></label>
          <label class="pl-field">Währung<input name="currency" value="EUR" maxlength="3" required></label>
          <label class="pl-field">Wettbewerber<input name="competitor" placeholder="z. B. Airalo" required></label>
          <label class="pl-field">Quelle (Link)<input name="url" type="url" placeholder="https://"></label>
          <button class="pl-btn" type="submit">Hinzufügen</button>
        </form>
        <details style="margin:14px 0"><summary style="cursor:pointer;font-weight:600">CSV importieren</summary>
          <p class="pl-help" style="margin-top:10px">Eine Zeile je Preis: <b>produkt;gb;tage;preis;währung;wettbewerber;link</b> – z. B. <span class="mono">country:jp;5;30;9.50;EUR;Airalo;https://…</span></p>
          <form data-import style="display:grid;gap:10px"><label class="pl-field">Daten<textarea name="csv" placeholder="country:jp;5;30;9.50;EUR;Airalo;https://..."></textarea></label><button class="pl-btn pl-btn--line" type="submit" style="justify-self:start">Importieren</button></form>
        </details>
        <div class="pl-table-wrap"><table><thead><tr><th>Produkt</th><th class="num">GB</th><th class="num">Tage</th><th class="num">Preis</th><th>Wettbewerber</th><th>Geprüft</th><th></th></tr></thead><tbody>
          ${d.competitors.map((c) => `<tr><td>${esc(c.item_key)}</td><td class="num">${esc(c.gb ?? "alle")}</td><td class="num">${esc(c.days ?? "alle")}</td><td class="num">${esc(money(c.price, c.currency))}</td><td>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.competitor)}</a>` : esc(c.competitor)}</td><td>${esc(date(c.checked_at))}</td><td><button class="pl-btn pl-btn--red pl-btn--sm" data-del="${esc(c.id)}">Löschen</button></td></tr>`).join("") || `<tr><td colspan="7" class="pl-empty">Noch keine Wettbewerbspreise – es gilt Einkauf × Faktor.</td></tr>`}
        </tbody></table></div>
      </div>
      <div class="pl-card"><h2>Vorschau Verkaufspreise <small>${p.source === "mock" ? "auf Basis der Testdaten" : "auf Basis der Anbieter-Einkaufspreise"} · ${esc(p.currency)}</small></h2>
        <div class="pl-tools"><label class="pl-field">Filtern<input data-pfilter placeholder="z. B. country:jp"></label></div>
        <div class="pl-table-wrap"><table><thead><tr><th>Produkt</th><th>Tarif</th><th class="num">Einkauf</th><th>Wettbewerb</th><th class="num">Verkaufspreis</th><th class="num">Marge</th><th>Regel</th></tr></thead><tbody>
          ${p.rows.map((r) => { const m = r.cost ? Math.round(((r.price - r.cost) / r.price) * 100) : null; return `<tr data-prow="${esc(r.key)}"><td>${esc(r.key)}</td><td>${r.gb ? `${esc(r.gb)} GB · ${esc(r.days)} T.` : esc(r.name || r.id)}</td><td class="num">${esc(money(r.cost, p.currency))}</td><td>${esc(r.competitor || "–")}</td><td class="num"><b>${esc(money(r.price, p.currency))}</b></td><td class="num">${m != null ? m + " %" : "–"}</td><td><span class="pl-badge ${String(r.rule).startsWith("competitor") ? "ok" : ""}">${esc(ruleLabel(r.rule))}</span></td></tr>`; }).join("")}
        </tbody></table></div>
      </div>`);
  }

  async function settings() {
    loading("Anbieter & Einstellungen");
    const d = await api("GET", "?view=overview");
    const s = d.status;
    const row = (label, ok, how, link) => `<div><span><b>${esc(label)}</b><small>${how}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">öffnen ↗</a>` : ""}</small></span><span class="pl-badge ${ok ? "ok" : "warn"}">${ok ? "Aktiv" : "Offen"}</span></div>`;
    shell("Anbieter & Einstellungen", `
      <p class="pl-help">API-Schlüssel und Passwörter gehören <b>nie</b> in den Code oder in diese Seite. Sie werden in Supabase als <b>Secrets</b> hinterlegt – nur der Server kann sie lesen.</p>
      <div class="pl-two">
        <div class="pl-card"><h2>Anbieter-Schnittstellen</h2><div class="pl-check">
          ${row("eSIM-Anbieter", s.esim, "Secrets ESIM_API_URL, ESIM_API_KEY (Einkaufspreise, Bestellung, Verbrauch)", dash("settings/functions"))}
          ${row("Lounge-Anbieter", s.lounge, "Secrets LOUNGE_API_URL, LOUNGE_API_KEY", dash("settings/functions"))}
          ${row("Fast-Track-Anbieter", s.fasttrack, "Secrets FASTTRACK_API_URL, FASTTRACK_API_KEY", dash("settings/functions"))}
          ${row("Zahlungsanbieter", !!s.payment, "Secret PAYMENT_PROVIDER + Schlüssel des Anbieters", dash("settings/functions"))}
          ${row("Testmodus aus", !s.testOrders, "ALLOW_TEST_ORDERS stellt Test-eSIMs ohne Zahlung aus – vor dem Start löschen", dash("settings/functions"))}
          ${row("Währungen", true, `Aktiv: ${esc(s.currencies)} (Secret CURRENCIES)`, dash("settings/functions"))}
        </div></div>
        <div class="pl-card"><h2>Anmeldung & E-Mail</h2><div class="pl-check">
          ${row("Google-Anmeldung", s.google, "Google Cloud: OAuth-Client, Weiterleitung …/auth/v1/callback", dash("auth/providers"))}
          ${row("Apple-Anmeldung", s.apple, "Apple Developer: Services ID + Key", dash("auth/providers"))}
          ${row("E-Mail-Vorlagen", true, "Inhalt aus supabase/templates einfügen", dash("auth/templates"))}
          ${row("Eigener Mailversand (SMTP)", false, "Pflicht vor dem Start – z. B. Resend, Brevo, Postmark", dash("settings/auth"))}
          ${row("Weiterleitungsadressen", true, "account.html der Live-Domain eintragen", dash("auth/url-configuration"))}
          ${row("Inhalts-Editor (GitHub)", s.cmsGithub, "GitHub OAuth-App, Secrets GITHUB_CLIENT_ID/SECRET", dash("settings/functions"))}
        </div></div>
      </div>`);
  }

  const VIEWS = { overview, orders, customers, esims, pricing, settings };
  async function show() {
    view = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
    try { await VIEWS[view](); }
    catch (err) {
      if (err.status === 401) return login();
      if (err.status === 403) { await sb.auth.signOut(); return login("Dieses Konto hat keinen Admin-Zugriff. E-Mail im Supabase-Secret ADMIN_EMAILS eintragen (und E-Mail bestätigen)."); }
      shell("Fehler", `<div class="pl-card"><p>Daten konnten nicht geladen werden (${esc(err.message)}). Ist die Funktion „admin“ veröffentlicht?</p></div>`);
    }
  }

  /* ---------- Ereignisse ---------- */
  app.addEventListener("click", async (e) => {
    if (e.target.closest("[data-logout]")) { await sb.auth.signOut(); return login(); }
    if (e.target.closest("[data-menu]")) { $(".pl").classList.toggle("menu-open"); return; }
    const del = e.target.closest("[data-del]");
    if (del) { del.disabled = true; await api("POST", "", { action: "competitor_delete", id: del.dataset.del }); toast("Gelöscht."); pricing(); }
  });
  app.addEventListener("change", async (e) => {
    const o = e.target.closest("[data-order]");
    if (o) { await api("POST", "", { action: "order_status", id: o.dataset.order, status: o.value }).then(() => toast("Status gespeichert."), () => toast("Fehler beim Speichern.")); return; }
    const es = e.target.closest("[data-esim]");
    if (es) { await api("POST", "", { action: "esim_status", id: es.dataset.esim, status: es.value }).then(() => toast("Status gespeichert."), () => toast("Fehler beim Speichern.")); return; }
    if (e.target.matches("[data-ofilter]")) { sessionStorage.setItem("pl_ost", e.target.value); orders(); }
  });
  app.addEventListener("input", (e) => {
    if (e.target.matches("[data-search]")) { const q = e.target.value.trim().toLowerCase(); $$("[data-row]").forEach((r) => (r.hidden = !!q && !r.dataset.row.includes(q))); }
    if (e.target.matches("[data-pfilter]")) { const q = e.target.value.trim().toLowerCase(); $$("[data-prow]").forEach((r) => (r.hidden = !!q && !r.dataset.prow.includes(q))); }
  });
  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f));
    const btn = $("button[type=submit]", f); if (btn) btn.disabled = true;
    try {
      if (f.matches("[data-settings]")) { await api("POST", "", { action: "pricing_settings", ...d, round_99: d.round_99 === "1" }); toast("Preisregel gespeichert – gilt sofort für die Webseite."); return pricing(); }
      if (f.matches("[data-comp]")) { await api("POST", "", { action: "competitor_save", ...d }); toast("Wettbewerbspreis gespeichert."); return pricing(); }
      if (f.matches("[data-import]")) {
        const rows = String(d.csv || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^produkt/i.test(l)).map((l) => {
          const [item_key, gbv, days, price, currency, competitor, url] = l.split(/[;\t]/).map((x) => (x ?? "").trim());
          return { item_key, gb: gbv, days, price: String(price || "").replace(",", "."), currency: currency || "EUR", competitor, url };
        });
        const r = await api("POST", "", { action: "competitor_import", rows });
        toast(`${r.imported} importiert${r.skipped ? `, ${r.skipped} übersprungen (Format prüfen)` : ""}.`);
        return pricing();
      }
    } catch (err) { toast(err.message === "invalid" ? "Eingaben prüfen." : "Fehler beim Speichern."); }
    finally { if (btn) btn.disabled = false; }
  });
  window.addEventListener("hashchange", () => { $(".pl")?.classList.remove("menu-open"); show(); });

  async function start() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return login();
    userEmail = session.user.email || "";
    show();
  }
  start();
})();
