/* ==========================================================================
   passport.io – Seiten-Baukasten
   Lädt die Inhalte aus /content/*.json und baut daraus die Seite.
   Reihenfolge und Sichtbarkeit der Bereiche: content/site.json -> "sections".
   ========================================================================== */
(async () => {
  "use strict";

  /* ---------------- Sprache & Inhalte laden ----------------
     Jede Datei in content/ enthält alle Sprachen: { "tr": {...}, "en": {...}, "de": {...} }.
     Die Standardsprache (content/languages.json → default, Türkisch) ist vollständig;
     andere Sprachen enthalten nur die Texte. Fehlt ein Text, gilt die Standardsprache.
     Sprache = ?lang=… (Umschalter) › gespeicherte Wahl › Sprache des Geräts › Standard. */
  const PAGE = document.body.dataset.page || "home";
  // Schutz gegen Einbetten in fremde Seiten (Clickjacking) – GitHub Pages kann dafür keine Header setzen
  // Ausnahme: die Live-Vorschau im eigenen Mağaza editörü (gleiche Herkunft, ?editor=1)
  const sameOriginParent = (() => { try { return window.parent !== window && window.parent.location.origin === location.origin; } catch (_) { return false; } })();
  const EDITOR = sameOriginParent && new URLSearchParams(location.search).get("editor") === "1";
  if (window.top !== window.self && !EDITOR) { try { window.top.location = window.self.location.href; } catch (_) { document.documentElement.innerHTML = ""; return; } }
  // Im Editor: noch nicht gespeicherte Entwürfe (sessionStorage „pp_draft:<datei>“) statt der veröffentlichten Datei
  const draft = (p) => { if (!EDITOR) return null; try { const s = sessionStorage.getItem("pp_draft:" + p); return s ? JSON.parse(s) : null; } catch (_) { return null; } };
  const getJSON = (p) => { const d = draft(p); if (d) return Promise.resolve(d); return fetch(p, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); }); };
  const KEY = (o) => (o && typeof o === "object" ? (o.id ?? o.code) : undefined);
  function merge(base, over) {
    if (over === undefined || over === null) return base;
    if (Array.isArray(base)) {
      if (!Array.isArray(over)) return base;
      if (base.length && typeof base[0] === "object") {
        if (KEY(base[0]) !== undefined) return base.map((b) => merge(b, over.find((o) => KEY(o) === KEY(b))));
        return base.map((b, i) => merge(b, over[i]));
      }
      return over;
    }
    if (base && typeof base === "object") { const out = { ...base }; for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]); return out; }
    return over;
  }
  let RAW_AI, RAW_UI, RAW_SYN = {}, SITE, ESIM, AI, BLOG, REVIEWS, INSTALL, UI, LANGS, LANG, LOCALE, CUR, RTL = false, PRICES = null, POST = null, ACC = null, AUTH = null, CONTENT_PAGE = null;
  const POST_ID = PAGE === "blog" ? (new URLSearchParams(location.search).get("p") || "").replace(/[^a-z0-9-]/gi, "") : "";
  try {
    LANGS = await getJSON("content/languages.json");
    const params = new URLSearchParams(location.search);
    const store = (k, v) => { try { if (v) localStorage.setItem(k, v); return localStorage.getItem(k); } catch (_) { return null; } };
    const devLangs = navigator.languages?.length ? navigator.languages : [navigator.language || ""];
    // Sprache
    const codes = LANGS.languages.map((l) => l.code);
    const pick = (c) => { c = String(c || "").toLowerCase().split(/[-_]/)[0]; return codes.includes(c) ? c : null; };
    // Sprache: Link (?lang=) gilt nur für diesen Besuch; dauerhaft gemerkt wird nur die Wahl im Umschalter (&keep=1).
    // Ohne beides gilt die Sprache des Handys/Browsers – z. B. spanisches Handy in Frankreich → Spanisch.
    const keep = params.get("keep") === "1";
    const fromUrl = pick(params.get("lang"));
    const session = (k, v) => { try { if (v) sessionStorage.setItem(k, v); return sessionStorage.getItem(k); } catch (_) { return null; } };
    const visitLang = pick(session("pp_lang_visit", fromUrl));
    const savedLang = pick(store("pp_lang", keep ? fromUrl : null));
    LANG = fromUrl || visitLang || savedLang || devLangs.map(pick).find(Boolean) || LANGS.default;
    if (keep) { params.delete("keep"); history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash); }
    const meta = LANGS.languages.find((l) => l.code === LANG);
    LOCALE = meta.locale || LANG;
    RTL = meta.dir === "rtl";
    document.documentElement.lang = LANG;
    document.documentElement.dir = meta.dir || "ltr";
    if (meta.font) {
      // Schrift mit arabischen Zeichen nachladen (Schibsted Grotesk hat keine)
      document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="https://fonts.bunny.net/css2?family=${encodeURIComponent(meta.font)}:wght@400;500;600;700&display=swap">`);
      document.documentElement.style.setProperty("--font", `"${meta.font}", "Schibsted Grotesk", system-ui, sans-serif`);
    }
    // Währung: ?cur=… › gespeicherte Wahl › Land des Geräts › Standard der Sprache
    const curCodes = (LANGS.currencies || []).map((c) => c.code);
    const pickCur = (c) => { c = String(c || "").toUpperCase(); return curCodes.includes(c) ? c : null; };
    const curUrl = pickCur(params.get("cur"));
    const region = devLangs.map((l) => (String(l).split(/[-_]/)[1] || "").toUpperCase()).find(Boolean);
    const savedCur = pickCur(store("pp_cur", keep ? curUrl : null)) || pickCur(session("pp_cur_visit", curUrl));
    CUR = curUrl || savedCur || pickCur(LANGS.regionCurrency?.[region]) || pickCur(meta.currency) || curCodes[0] || "EUR";
    const loc = (d) => d && merge(d[LANGS.default], d[LANG]);
    const synP = getJSON("content/lina-synonyms.json").catch(() => ({})); // Umgangssprache → einheitliche Begriffe (Lina)
    const raw = await Promise.all([
      ...["site", "esim", "assistant", "blog", "reviews", "ui"].map((n) => getJSON(`content/${n}.json`)),
      PAGE === "install" ? getJSON("content/install.json") : null,
      POST_ID ? getJSON(`content/posts/${POST_ID}.json`).catch(() => null) : null, // Artikel (fehlt er → Übersicht)
    ]);
    [SITE, ESIM, AI, BLOG, REVIEWS, UI, INSTALL, POST] = raw.map(loc);
    [RAW_AI, RAW_UI] = [raw[2], raw[5]]; // Lina antwortet in der Sprache der Frage – dafür alle Sprachen
    RAW_SYN = await synP;

    if (POST) POST.id = POST_ID;
    if (PAGE === "page") {
      const pid = (params.get("p") || "").replace(/[^a-z0-9-]/gi, "");
      const all = loc(await getJSON("content/pages.json"));
      CONTENT_PAGE = (all.pages || []).find((x) => x.id === pid) || (all.pages || [])[0] || null;
    }
    if (PAGE === "account") {
      // Texte des Kundenkontos und öffentliche Supabase-Angaben (auth.json wird beim Veröffentlichen erzeugt)
      [ACC, AUTH] = await Promise.all([getJSON("content/account.json").then(loc), getJSON("content/auth.json").catch(() => null)]);
    }
  } catch (err) {
    document.getElementById("page").innerHTML = `<p style="padding:120px 24px;text-align:center">İçerik yüklenemedi · Content could not be loaded.</p>`;
    console.error(err);
    return;
  }
  /* Oberflächentext: t("priceFrom", { p: "4 €" }) – Texte in content/ui.json */
  const t = (k, v = {}) => String(UI[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => (x in v ? v[x] : m));

  /* ---------------- Helfer ---------------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  /* Preis im Format der Sprache, in der Währung, die die Schnittstelle geliefert hat (kurzes Zeichen: $, €, ₺, £) */
  // Kurzes, international bekanntes Zeichen (manche Sprachen schreiben sonst „US$“ oder „UK£“)
  const SYM = (c) => { try { return new Intl.NumberFormat("en", { style: "currency", currency: c, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value || c; } catch (_) { return c; } };
  const eur = (n) => {
    const cur = PRICES?.currency || CUR || "EUR";
    try {
      return new Intl.NumberFormat(LOCALE, { style: "currency", currency: cur, currencyDisplay: "narrowSymbol", minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2 })
        .formatToParts(Number(n)).map((p) => (p.type === "currency" ? SYM(cur) : p.value)).join("");
    } catch (_) { return `${Number(n).toFixed(2)} ${cur}`; }
  };
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;
  /* Anker-Links (#esim) zeigen auf Unterseiten zurück zur Startseite */
  const href = (u = "") => (PAGE !== "home" && u.startsWith("#") ? "index.html" + u : u);
  const flag = (code) => `https://flagcdn.com/w80/${code}.png`;
  /* Zahlungslogos (Simple Icons, monochrom) */
  const PAY = { applepay: "Apple Pay", googlepay: "Google Pay", klarna: "Klarna", paypal: "PayPal", visa: "Visa", mastercard: "Mastercard", americanexpress: "American Express" };
  // Logos liegen selbst gehostet in img/pay (kein Drittanbieter-CDN, keine IP-Weitergabe)
  const payLogo = (slug) => `<img class="pay-logo pay-logo--${esc(slug)}" src="img/pay/${esc(slug)}.svg" alt="${esc(PAY[slug] || slug)}" title="${esc(PAY[slug] || slug)}" loading="lazy">`;
  /* Für Suche & Assistent: Kleinschreibung, ohne Akzente (ü→u, ş→s, ı→i …), nur Buchstaben/Ziffern */
  const normFor = (loc) => (s) => String(s).toLocaleLowerCase(loc).replace(/ı/g, "i").replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ًͯ-ٰٟ]/g, "").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ё/g, "е").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  const norm = normFor(LOCALE);
  /* Ländernamen kommen automatisch in der Sprache des Besuchers (Browser); Suche kennt alle Sprachen */
  const regionNames = (loc) => { try { return new Intl.DisplayNames([loc], { type: "region" }); } catch (_) { return null; } };
  const DN = regionNames(LOCALE), ALT = LANGS.languages.map((l) => regionNames(l.locale)).filter(Boolean);
  ESIM.countries.forEach((c) => {
    const C = c.code.toUpperCase(), orig = c.name;
    try { c.name = DN?.of(C) || orig; } catch (_) {}
    c.names = [...new Set([orig, c.name, ...ALT.map((d) => { try { return d.of(C); } catch (_) { return ""; } }), C === "TR" ? "Turkey" : ""].filter(Boolean).map(norm))];
  });
  /* Bild-URL in passender Größe (Unsplash) – eigene Uploads bleiben unverändert */
  const img = (url, w = 800, h) => !url ? "" : url.includes("images.unsplash.com") ? `${url.split("?")[0]}?auto=format&fit=crop&q=75&w=${w}${h ? `&h=${h}` : ""}` : url;
  /* Mini-Markdown für Antworten: **fett**, [Link](url), "- " Aufzählung, Leerzeile = Absatz */
  const md = (s = "") => {
    if (/<[a-z][\s\S]*>/i.test(s)) return s; // bereits HTML
    // Links nur zu sicheren Zielen (keine javascript:-Adressen aus Inhalten)
    const safeHref = (u) => (/^(https?:\/\/|mailto:|tel:|#|[a-z0-9_./-]+(\?[^"]*)?(#.*)?$)/i.test(u) && !/^\s*(javascript|data|vbscript):/i.test(u) ? u : "#");
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[(.+?)\]\((.+?)\)/g, (_, txt, url) => `<a href="${safeHref(url)}"${/^https?:/i.test(url) ? ' rel="noopener" target="_blank"' : ""}>${txt}</a>`);
    return s.trim().split(/\n{2,}/).map((block) => {
      const lines = block.split("\n");
      const h = /^(#{2,3}) (.+)$/.exec(block.trim());
      if (h && lines.length === 1) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
      if (lines.every((l) => /^\s*\d+[.)] /.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)] /, ""))}</li>`).join("")}</ol>`;
      if (lines.every((l) => /^> /.test(l))) return `<blockquote>${lines.map((l) => inline(l.slice(2))).join("<br>")}</blockquote>`;
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    }).join("");
  };

  /* ================================================================
     PREISE – GRUNDREGEL: Jeder Preis auf der Seite kommt aus der Preis-Schnittstelle.
     Keine Preise in Inhalten, im Admin oder im Code. Ist die Schnittstelle nicht
     erreichbar, steht dort „Preis folgt“ – niemals ein ausgedachter Wert.
     Adresse: content/site.json → api.pricesUrl (lokal: Testdaten in api/prices.json,
     live: Supabase-Funktion supabase/functions/prices, die die Anbieter-APIs abfragt).
     ================================================================ */
  const NA = SITE.api?.unavailableText || t("priceNA");
  async function loadPrices() {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 6000);
    try {
      // Gewünschte Währung mitschicken – umgerechnet wird nur auf dem Server (offizieller EZB-Kurs)
      const u = new URL(SITE.api?.pricesUrl || "api/prices.json", location.href);
      u.searchParams.set("currency", CUR);
      const r = await fetch(u, { cache: "no-cache", signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!data || !data.esim) throw new Error("Ungültige Antwort");
      PRICES = data;
    } catch (err) {
      console.warn("Preise nicht verfügbar:", err.message);
      PRICES = null;
    } finally { clearTimeout(timeout); }
  }
  await loadPrices();

  const minPrice = (plans) => (plans && plans.length ? Math.min(...plans.map((p) => p.price)) : null);
  /* Pakete zu einem Schlüssel: "country:tr", "region:eu", "global" */
  const plansOf = (key) => {
    if (!PRICES) return [];
    const [type, id] = key.split(":"), E = PRICES.esim || {};
    if (type === "country") return E.countries?.[id]?.plans || [];
    if (type === "region") return E.regions?.[id]?.plans || [];
    if (type === "global") return E.global?.plans || [];
    return [];
  };
  /* Preis zu einem Schlüssel: "esim" (günstigste eSIM), "lounge", "fasttrack", "vignette", "country:tr" … */
  const priceOf = (key) => {
    if (!PRICES || !key) return null;
    if (key === "esim") {
      const E = PRICES.esim || {};
      return minPrice([
        ...Object.values(E.countries || {}).flatMap((c) => c.plans || []),
        ...Object.values(E.regions || {}).flatMap((c) => c.plans || []),
        ...(E.global?.plans || []),
      ]);
    }
    if (["lounge", "fasttrack", "vignette"].includes(key)) return PRICES[key]?.from ?? null;
    return minPrice(plansOf(key));
  };
  /* Preis-Baustein – wird automatisch aktualisiert, sobald Preise (nach-)geladen sind */
  /* tpl = Vorlage aus ui.json mit {p}, z. B. t("priceFrom") → „ab {p}“ / „{p}'dan başlayan“ */
  const withPrice = (tpl, v) => (tpl ? tpl.replace("{p}", eur(v)) : eur(v));
  const P = (key, tpl = "", inline = false) => {
    const v = priceOf(key);
    const na = inline ? '<span class="price__skel"></span>' : esc(NA);
    return `<span class="price${v == null ? " price--na" : ""}${inline ? " price--inline" : ""}" data-price="${esc(key)}" data-tpl="${esc(tpl)}">${v == null ? na : esc(withPrice(tpl, v))}</span>`;
  };
  /* Texte aus dem Admin dürfen Platzhalter enthalten: {fiyat:esim}, {price:lounge}, {preis:country:tr} … */
  const fill = (text = "") => esc(text).replace(/\{(?:preis|price|fiyat):([a-z]+(?::[a-z0-9-]+)?)\}/gi, (_, k) => P(k.toLowerCase(), "", true));
  /* Angebot sichtbar? Solange keine Preise da sind: ja (mit „Preis folgt“). Sonst nur, wenn die API es führt. */
  const offered = (key) => !PRICES || plansOf(key).length > 0;
  const popularPlan = (plans) => plans.find((p) => p.popular) || plans[Math.min(2, plans.length - 1)];
  // Volumen-Beschriftung: „5 GB“ oder „Unbegrenzt“ (Unlimited-Tarife von eSIM Go)
  const vol = (p) => (p.unlimited ? t("unlimited") : `${p.gb} GB`);
  const volDays = (p) => (p.unlimited ? t("unlimitedDays", { days: p.days }) : t("gbDays", { gb: p.gb, days: p.days }));
  function refreshPrices() {
    $$("[data-price]").forEach((s) => {
      const v = priceOf(s.dataset.price);
      s.classList.toggle("price--na", v == null);
      if (v == null) s.innerHTML = s.classList.contains("price--inline") ? '<span class="price__skel"></span>' : esc(NA);
      else s.textContent = withPrice(s.dataset.tpl, v);
    });
  }
  if (!PRICES) {
    // Im Hintergrund erneut versuchen und Preise nachtragen
    let tries = 0;
    const retry = setInterval(async () => {
      tries++;
      await loadPrices();
      if (PRICES) { clearInterval(retry); refreshPrices(); }
      else if (tries >= 5) clearInterval(retry);
    }, 8000);
  }

  /* Markenfarben aus dem CMS */
  if (SITE.theme) {
    SITE.theme.green && document.documentElement.style.setProperty("--green", SITE.theme.green);
    SITE.theme.dark && document.documentElement.style.setProperty("--dark", SITE.theme.dark);
  }

  /* ---------------- Toast ---------------- */
  let toastTimer;
  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3400);
  };

  /* ================================================================
     BEREICHE (jeder Bereich = render() liefert HTML, init() macht ihn interaktiv)
     ================================================================ */
  const sections = {};

  /* ---------- HERO ---------- */
  sections.hero = {
    render: (c = SITE.hero) => `
      <section class="hero" id="top">
        <div class="hero__bg" aria-hidden="true"><img class="hero__img" src="${img(c.image, 2200)}" alt="" fetchpriority="high" /><div class="hero__shade"></div></div>
        <div class="container hero__content">
          <p class="kicker">${esc(c.kicker)}</p>
          <h1 class="hero__title">${fill(c.title)}<span>${fill(c.subtitle)}</span></h1>
          ${searchForm("search--hero", c.searchPlaceholder, c.searchButton)}
          <div class="hero__meta">
            <ul class="hero__facts">
              ${(c.facts || []).map((f) => `<li>${f.icon === "trustpilot" ? `<span class="tp-mini">${icon("star")}</span>` : icon(f.icon || "check")}${fill(f.text)}</li>`).join("")}
            </ul>
            ${(c.payments || []).length ? `<div class="hero__pay" role="group" aria-label="${esc(c.paymentsLabel || t("payMethods"))}">${c.payments.map(payLogo).join("")}</div>` : ""}
          </div>
        </div>
        <div class="strip">
          <div class="container strip__inner">
            ${(c.products || []).map((p) => {
              const inner = `<span class="strip__label">${esc(p.label)}</span><span class="strip__text">${fill(p.text)}</span><span class="strip__price">${p.comingSoon ? esc(p.soonText || "") : P(p.priceKey, t("priceFrom"))}</span>`;
              return p.comingSoon || !p.url
                ? `<div class="strip__item strip__item--soon" id="vignette">${inner}</div>`
                : `<a href="${esc(p.url)}" class="strip__item">${inner}</a>`;
            }).join("")}
          </div>
        </div>
      </section>`,
  };

  /* ---------- BELIEBTE REISEZIELE ---------- */
  const popular = () => ESIM.countries.filter((c) => c.popular && offered("country:" + c.code));
  sections.destinations = {
    render: (c = SITE.destinations) => `
      <section class="section" id="esim">
        <div class="container">
          <div class="head-split">
            <div><p class="kicker kicker--dark">${esc(c.kicker)}</p><h2 class="h2">${esc(c.title)}</h2></div>
            ${c.showSearch ? searchForm("search--inline", c.searchPlaceholder) : ""}
          </div>
        </div>
        <div class="rail" id="popular-rail" tabindex="0" aria-label="${esc(t("railLabel"))}">
          ${popular().map((d, i) => {
            const plans = plansOf("country:" + d.code);
            const pop = plans.length ? popularPlan(plans) : null;
            return `
            <button class="dest" type="button" data-country="${esc(d.code)}">
              <img src="${img(d.image, 1000, 800)}" alt="${esc(d.name)}" loading="${i < 4 ? "eager" : "lazy"}">
              ${d.tag ? `<span class="dest__tag">${esc(d.tag)}</span>` : ""}
              <span class="dest__body">
                <span class="dest__name"><img class="dest__flag" src="${flag(d.code)}" alt="">${esc(d.name)}</span>
                <span class="dest__price">${P("country:" + d.code, t("priceFrom"))}</span>
                <span class="dest__more">
                  ${pop ? `<span class="dest__plan"><b>${esc(volDays(pop))}</b> ${esc(t("planFor", { p: eur(pop.price) }))} <em>${esc(t("popular"))}</em></span>` : ""}
                  <span class="dest__feat">${esc(t("destFeatures"))}</span>
                  <span class="dest__cta">${esc(t("viewPlans"))} ${icon("arrow")}</span>
                </span>
              </span>
            </button>`; }).join("")}
        </div>
        <div class="container rail-foot">
          <span class="rail-foot__hint">${esc(c.hint)}</span>
          <div class="rail-nav">
            <button class="icon-btn" type="button" data-rail-prev aria-label="${esc(t("prev"))}">${icon("chev-l")}</button>
            <button class="icon-btn" type="button" data-rail-next aria-label="${esc(t("next"))}">${icon("chev-r")}</button>
          </div>
        </div>
      </section>`,
    init(el) {
      const rail = $("#popular-rail", el);
      const cards = $$(".dest", rail);
      // Pfeile + Ziehen mit der Maus
      wireRail(rail, $("[data-rail-prev]", el), $("[data-rail-next]", el));
      // Öffnen beim Darüberfahren läuft komplett über CSS (:hover) – kein Verschieben, kein Verrutschen.
      // Auf Touch-Geräten: erstes Antippen öffnet die Karte, zweites Antippen zeigt die Pakete.
      const touch = !matchMedia("(hover: hover)").matches;
      rail.addEventListener("click", (e) => {
        const d = e.target.closest(".dest");
        if (!d) return;
        if (touch && !d.classList.contains("is-open")) {
          cards.forEach((c) => { c.classList.toggle("is-open", c === d); c.setAttribute("aria-expanded", c === d); });
          return;
        }
        openPlans(ESIM.countries.find((x) => x.code === d.dataset.country));
      });
    },
  };

  /* ---------- REGIONALE & GLOBALE PAKETE (Weltkarte) ---------- */
  const MAP_LIBS = [
    "https://cdn.jsdelivr.net/npm/d3-array@3.2.4/dist/d3-array.min.js",
    "https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/dist/d3-geo.min.js",
    "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js",
  ];
  const MAP_DATA = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
  const loadScript = (src) => new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });

  sections.packages = {
    render: (c = SITE.packages) => {
      const regions = [
        ...ESIM.regional.filter((r) => offered("region:" + r.id)).map((r) => ({ ...r, kind: "region" })),
        ...(plansOf("global").length || !PRICES ? [{ id: "global", kind: "global", name: c.globalName || "Global", note: c.globalText, title: c.globalTitle }] : []),
      ];
      return `
      <section class="section section--paper" id="packages">
        <div class="container">
          <div class="head-split">
            <div><p class="kicker kicker--dark">${esc(c.kicker)}</p><h2 class="h2">${esc(c.title)}</h2></div>
            <p class="head-split__note">${esc(c.note)}</p>
          </div>
          <div class="wmap">
            <div class="wmap__map">
              <svg class="wmap__svg" viewBox="0 0 960 470" role="img" aria-label="${esc(t("mapLabel"))}"><g class="wmap__land"></g><ellipse class="wmap__ring" cx="480" cy="235" rx="0" ry="0"></ellipse></svg>
              <span class="wmap__legend"><i></i> ${esc(t("mapLegend"))}</span>
            </div>
            <div class="wmap__side">
              <div class="wmap__tabs" role="tablist" aria-label="${esc(t("chooseRegion"))}">
                ${regions.map((r, i) => `<button type="button" role="tab" class="wtab ${i === 0 ? "is-active" : ""}" aria-selected="${i === 0}" data-tab="${i}">${esc(r.name)}<span class="wtab__bar"><span></span></span></button>`).join("")}
              </div>
              ${regions.map((r, i) => `
                <div class="wdetail" data-detail="${i}" ${i === 0 ? "" : "hidden"}>
                  ${r.kind === "global" ? `
                    <p class="kicker kicker--dark">${esc(c.globalKicker)}</p>
                    <h3>${esc(r.title)}</h3>
                    <p class="wdetail__note">${esc(r.note)}</p>
                    <div class="gpicks gpicks--light">
                      ${plansOf("global").map((g, k) => `
                        <button class="gpick ${g.featured ? "gpick--featured" : ""}" type="button" data-global="${k}">
                          ${g.featured ? `<span class="gpick__badge">${esc(t("bestseller"))}</span>` : ""}
                          <b>${esc(vol(g))}</b><span>${esc(t("days", { n: g.days }))}</span><strong>${eur(g.price)}</strong>
                        </button>`).join("")}
                    </div>` : `
                    <p class="kicker kicker--dark">${esc(t("regionalPackage"))}</p>
                    <h3>${esc(r.name)}</h3>
                    <p class="wdetail__note">${esc(r.note)}</p>
                    <ul class="wdetail__facts"><li><b>${r.countries}</b> ${esc(t("factCountries"))}</li><li><b>${esc(r.data)}</b> ${esc(t("factData"))}</li><li><b>${esc(t("factDaysUpTo"))}</b> ${esc(t("factDays"))}</li></ul>
                    <div class="wdetail__foot">
                      <span class="wdetail__price">${P("region:" + r.id, t("priceFrom"))}</span>
                      <button class="btn btn--dark" type="button" data-region="${esc(r.id)}">${esc(t("viewPlans"))} ${icon("arrow")}</button>
                    </div>`}
                </div>`).join("")}
            </div>
          </div>
        </div>
      </section>`;
    },
    init(el) {
      const regions = [...ESIM.regional.filter((r) => offered("region:" + r.id)), ...(plansOf("global").length || !PRICES ? [{ id: "global" }] : [])];
      const tabs = $$(".wtab", el), details = $$(".wdetail", el);
      const svg = $(".wmap__svg", el), land = $(".wmap__land", el), ring = $(".wmap__ring", el);
      let paths = [], geo = null, cur = 0;
      const DURATION = 6000;
      let timer = null, stopped = matchMedia("(prefers-reduced-motion: reduce)").matches, visible = false;

      // Weltkarte zeichnen (echte Ländergrenzen, Natural-Earth-Daten)
      const ready = (async () => {
        try {
          for (const s of MAP_LIBS) await loadScript(s);
          const world = await fetch(MAP_DATA).then((r) => r.json());
          const all = topojson.feature(world, world.objects.countries).features.filter((f) => f.id !== "010"); // ohne Antarktis
          const projection = d3.geoNaturalEarth1().fitExtent([[8, 8], [952, 462]], { type: "FeatureCollection", features: all });
          const path = d3.geoPath(projection);
          land.innerHTML = all.map((f) => `<path d="${path(f)}" data-id="${f.id}"></path>`).join("");
          paths = $$("path", land);
          // Für den Kreis: bei Ländern mit Überseegebieten nur die größte Fläche berücksichtigen
          const main = (f) => {
            if (f.geometry.type !== "MultiPolygon") return f;
            let best = null, area = -1;
            f.geometry.coordinates.forEach((coords) => { const g = { type: "Polygon", coordinates: coords }; const a = d3.geoArea(g); if (a > area) { area = a; best = g; } });
            return { type: "Feature", geometry: best };
          };
          geo = { all, path, main };
          el.classList.add("wmap--ready");
        } catch (err) { console.warn("Weltkarte konnte nicht geladen werden", err); el.classList.add("wmap--fallback"); }
      })();

      const highlight = (i) => {
        if (!geo) return;
        const r = regions[i];
        const codes = r.id === "global" ? null : new Set(r.mapCodes || []);
        paths.forEach((p) => p.classList.toggle("is-on", !codes || codes.has(p.dataset.id)));
        if (!codes) { ring.classList.add("is-hidden"); return; }
        const feats = geo.all.filter((f) => codes.has(f.id)).map(geo.main);
        if (!feats.length) { ring.classList.add("is-hidden"); return; }
        const [[x0, y0], [x1, y1]] = geo.path.bounds({ type: "FeatureCollection", features: feats });
        const pad = 26;
        ring.classList.remove("is-hidden");
        ring.style.cx = `${(x0 + x1) / 2}px`; ring.style.cy = `${(y0 + y1) / 2}px`;
        ring.style.rx = `${(x1 - x0) / 2 * 1.18 + pad}px`; ring.style.ry = `${(y1 - y0) / 2 * 1.18 + pad}px`;
      };

      const show = (i) => {
        cur = (i + tabs.length) % tabs.length;
        tabs.forEach((t, k) => { t.classList.toggle("is-active", k === cur); t.setAttribute("aria-selected", k === cur); });
        details.forEach((d, k) => (d.hidden = k !== cur));
        el.classList.toggle("wmap--auto", !stopped);
        const bar = $(".wtab__bar span", tabs[cur]); bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
        const tabsBox = $(".wmap__tabs", el);
        if (tabsBox.scrollWidth > tabsBox.clientWidth) tabsBox.scrollTo({ left: tabs[cur].offsetLeft - 16, behavior: "smooth" });
        ready.then(() => highlight(cur));
      };
      const schedule = () => { clearTimeout(timer); if (!stopped && visible) timer = setTimeout(() => { show(cur + 1); schedule(); }, DURATION); };
      tabs.forEach((t, i) => t.addEventListener("click", () => { stopped = true; clearTimeout(timer); show(i); }));
      const box = $(".wmap", el);
      box.addEventListener("mouseenter", () => { clearTimeout(timer); el.classList.add("wmap--paused"); });
      box.addEventListener("mouseleave", () => { el.classList.remove("wmap--paused"); if (!stopped) { show(cur); schedule(); } });
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) { show(cur); schedule(); } else clearTimeout(timer); }, { threshold: 0.4 }).observe(box);
      show(0);

      el.addEventListener("click", (e) => {
        const r = e.target.closest("[data-region]");
        if (r) openPlans(ESIM.regional.find((x) => x.id === r.dataset.region));
        const g = e.target.closest("[data-global]");
        if (g) { const p = plansOf("global")[+g.dataset.global]; if (p?.id) location.href = `account.html?buy=global&plan=${encodeURIComponent(p.id)}`; }
      });
    },
  };

  /* ---------- WAS IST EINE eSIM ---------- */
  // Kleine Handy-Bildschirme für die drei Schritte (Pakete und Preise kommen aus der Schnittstelle)
  function stepScreen(i, s, c) {
    if (i === 0) {
      const d = popular()[0];
      const plans = d ? plansOf("country:" + d.code).slice(0, 4) : [];
      return phoneScreen({ title: d ? d.name : s.title, type: "plans", items: plans });
    }
    if (i === 1) return phoneScreen({ type: "qr", caption: s.title });
    return phoneScreen({ type: "done", title: s.title, caption: c.imageCaption || "" });
  }
  sections.howto = {
    render: (c = SITE.howto) => `
      <section class="section" id="howto">
        <div class="container">
          <div class="how2__head">
            <p class="kicker kicker--dark">${esc(c.kicker)}</p>
            <h2 class="h2">${esc(c.title)}</h2>
            <p class="lead">${esc(c.text)}</p>
          </div>
          <ol class="how2__track" data-steps>
            ${(c.steps || []).map((s, i) => `
              <li class="how2__card">
                <div class="how2__visual">${stepScreen(i, s, c)}</div>
                <div class="how2__body">
                  <span class="how2__n">${String(i + 1).padStart(2, "0")}<i>/${String((c.steps || []).length).padStart(2, "0")}</i></span>
                  <h3>${esc(s.title)}</h3>
                  <p>${esc(s.text)}</p>
                </div>
              </li>`).join("")}
          </ol>
          <div class="how2__dots" aria-hidden="true">${(c.steps || []).map((_, i) => `<button type="button" tabindex="-1" class="${i ? "" : "is-active"}" data-dot="${i}"></button>`).join("")}</div>
          <div class="how__actions how2__actions">
            <button class="btn btn--dark" type="button" data-open-device-check>${icon("phone")} ${esc(c.button)}</button>
            ${c.guideLink ? `<a class="link-arrow" href="install.html">${esc(c.guideLink)} ${icon("arrow")}</a>` : ""}
          </div>
        </div>
      </section>`,
    init(el) {
      // Wischkarten: Punkte zeigen, welcher Schritt gerade sichtbar ist
      const track = $("[data-steps]", el), dots = $$("[data-dot]", el);
      if (!track || !dots.length) return;
      const cards = [...track.children];
      const sync = () => {
        const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
        let best = 0, dist = Infinity;
        cards.forEach((k, i) => { const r = k.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - mid); if (d < dist) { dist = d; best = i; } });
        dots.forEach((d, i) => d.classList.toggle("is-active", i === best));
      };
      track.addEventListener("scroll", () => requestAnimationFrame(sync), { passive: true });
      dots.forEach((d, i) => d.addEventListener("click", () => {
        const r = cards[i].getBoundingClientRect(), tr = track.getBoundingClientRect();
        track.scrollBy({ left: r.left + r.width / 2 - (tr.left + tr.width / 2), behavior: "smooth" });
      }));
    },
  };

  /* ---------- LOUNGE & FAST TRACK ---------- */
  sections.airport = {
    render: (c = SITE.airport) => `
      <section class="section section--dark" id="airport">
        <div class="container">
          <div class="head-split">
            <div><p class="kicker">${esc(c.kicker)}</p><h2 class="h2">${esc(c.title)}</h2></div>
            <p class="head-split__note head-split__note--light">${esc(c.note)}</p>
          </div>
          <div class="airport">
            ${(c.cards || []).map((k) => `
              <article class="airport__card" tabindex="0" aria-expanded="false" data-product="${esc(k.priceKey || "")}">
                <img src="${img(k.image, 1200)}" alt="" loading="lazy" />
                <span class="airport__plus" aria-hidden="true">${icon("plus")}</span>
                <div class="airport__body">
                  <h3>${esc(k.title)}</h3>
                  <p class="airport__price">${P(k.priceKey, t("priceFromPerson"))}</p>
                  <div class="airport__more">
                    <p class="airport__text">${esc(k.text)}</p>
                    <ul class="ticks">${(k.ticks || []).map((t) => `<li>${icon("check")}${esc(t)}</li>`).join("")}</ul>
                    <a href="#ap-from" class="btn btn--green btn--sm airport__cta" data-pick="${esc(k.priceKey || "")}">${esc(k.button)} ${icon("arrow")}</a>
                  </div>
                </div>
              </article>`).join("")}
          </div>
          <form class="airport-search" data-airport-search>
            <div class="airport-search__field">
              <label for="ap-from">${esc(t("airportLabel"))}</label>
              <input id="ap-from" type="text" placeholder="${esc(t("airportPlaceholder"))}" list="airports" />
              <datalist id="airports">${(c.airports || []).map((a) => `<option value="${esc(a)}"></option>`).join("")}</datalist>
            </div>
            <div class="airport-search__field"><label for="ap-date">${esc(t("departDate"))}</label><input id="ap-date" type="date" /></div>
            <div class="airport-search__field airport-search__field--sm"><label for="ap-pax">${esc(t("persons"))}</label><select id="ap-pax"><option>1</option><option selected>2</option><option>3</option><option>4</option><option>5+</option></select></div>
            <div class="airport-search__toggle" role="group" aria-label="${esc(t("product"))}"><label><input type="checkbox" value="lounge" checked /> ${esc(t("catLounge"))}</label><label><input type="checkbox" value="fasttrack" /> ${esc(t("catFasttrack"))}</label></div>
            <button class="btn btn--green" type="submit">${esc(c.searchButton)}</button>
          </form>
        </div>
      </section>`,
    init(el) {
      $("#ap-date", el).valueAsDate = new Date(Date.now() + 7 * 864e5);
      // Karten wie bei den eSIM-Reisezielen: Darüberfahren (CSS) oder Antippen öffnet die Details
      const cards = $$(".airport__card", el);
      const touch = !matchMedia("(hover: hover)").matches;
      const openCard = (card) => cards.forEach((c) => { const on = c === card && !c.classList.contains("is-open"); c.classList.toggle("is-open", on); c.setAttribute("aria-expanded", on); });
      el.addEventListener("click", (e) => {
        const pick = e.target.closest("[data-pick]");
        if (pick) {
          // Zur Suche springen und das passende Produkt vorauswählen
          e.preventDefault();
          $$(".airport-search__toggle input", el).forEach((i) => (i.checked = i.value === pick.dataset.pick));
          $(".airport-search", el).scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => $("#ap-from", el).focus({ preventScroll: true }), 500);
          return;
        }
        const card = e.target.closest(".airport__card");
        if (card && (touch || !card.matches(":hover"))) openCard(card);
      });
      el.addEventListener("keydown", (e) => {
        const card = e.target.closest?.(".airport__card");
        if (card && e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openCard(card); }
      });
      $("[data-airport-search]", el).addEventListener("submit", (e) => {
        e.preventDefault();
        const ap = $("#ap-from", el).value.trim();
        if (!ap) { $("#ap-from", el).focus(); toast(t("chooseAirport")); return; }
        toast(t("airportSearching", { ap }));
      });
    },
  };

  /* ---------- BEWERTUNGEN ---------- */
  const stars = (n) => Array.from({ length: 5 }, (_, i) => `<span class="${i < n ? "" : "is-empty"}">${icon("star")}</span>`).join("");
  sections.reviews = {
    render: (c = SITE.reviews) => `
      <section class="section section--tight" id="reviews">
        <!-- TRUSTPILOT: Hier später das offizielle TrustBox-Widget (z. B. „Carousel“) einsetzen. Werte = DEMO. -->
        <div class="container reviews-bar" id="trustpilot-widget">
          <div class="reviews-bar__score">
            <span class="reviews-bar__num">${esc(c.score)}</span>
            <div>
              <div class="tp-stars" aria-label="${esc(t("starsOf", { n: c.score }))}">${stars(4)}<span class="tp-part">${icon("star")}</span></div>
              <p><b>${esc(c.label)}</b> · ${esc(t("reviewsOn", { count: c.count }))}${previewOn ? ` <span class="demo-tag">${esc(t("reviewsDemo"))}</span>` : ""}</p>
            </div>
          </div>
          <a href="${esc(c.linkUrl)}" class="link-arrow" target="_blank" rel="noopener">${esc(c.linkText)} ${icon("arrow-ur")}</a>
        </div>
        <div class="marquee" aria-label="${esc(t("reviewsLabel"))}">
          <div class="marquee__track">
            ${[0, 1].map((copy) => (REVIEWS.items || []).map((r) => `
              <article class="review" ${copy ? 'aria-hidden="true"' : ""}>
                <div class="tp-stars tp-stars--sm" aria-label="${esc(t("starsOf", { n: r.stars }))}">${stars(r.stars)}</div>
                <h4>${esc(r.title)}</h4>
                <p>${esc(r.text)}</p>
                <span class="review__foot"><b>${esc(r.name)}</b> · ${esc(r.date)}</span>
              </article>`).join("")).join("")}
          </div>
        </div>
      </section>`,
    init(el) {
      // Geschwindigkeit an die Anzahl der Bewertungen anpassen (ca. 7 s pro Karte)
      const n = (REVIEWS.items || []).length || 1;
      $(".marquee__track", el).style.animationDuration = `${n * 7}s`;
    },
  };

  /* ---------- DIGITALER ASSISTENT + FAQ ---------- */
  const PERSONA = AI.persona || { name: t("assistantFallbackName"), role: "", image: "", intro: "", badge: "" };
  // Laufende Fragenleiste unter Lina: zuerst die Hilfe-Themen (Geräte-Check, Anleitung, Paketberatung),
  // dann Schnellfragen und die meistgefragten FAQ. Zwei Reihen laufen gegeneinander; Antippen = Lina antwortet.
  function questionBand() {
    const seen = new Set(), items = [];
    const push = (text, attr, ic) => { const k = String(text || "").trim().toLocaleLowerCase(LOCALE); if (!k || seen.has(k)) return; seen.add(k); items.push({ text, attr, ic }); };
    (AI.banners || []).forEach((b) => push(b.title, `data-action="${esc(b.action)}"`, b.icon || "chat"));
    (AI.suggestions || []).forEach((s) => push(s, `data-suggest="${esc(s)}"`, "chat"));
    const linked = new Set((AI.banners || []).map((b) => b.action)); // FAQ, die schon ein Hilfe-Thema öffnet, nicht doppelt zeigen
    [...(AI.faqs || [])].filter((f) => !linked.has(f.id)).sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10).forEach((f) => push(f.question, `data-faq="${esc(f.id)}"`, "chat"));
    if (!items.length) return "";
    const rows = [items.filter((_, i) => i % 2 === 0), items.filter((_, i) => i % 2 === 1)].filter((r) => r.length);
    const chip = (it, dup) => `<button type="button" class="qchip" ${it.attr}${dup ? ' tabindex="-1" aria-hidden="true"' : ""}>${icon(it.ic)}<span>${esc(it.text)}</span></button>`;
    return `
      <div class="qband">
        <p class="qband__title"><span class="dot"></span> ${esc(t("popularAsk"))}</p>
        ${rows.map((r, i) => `
          <div class="qband__row${i ? " qband__row--rev" : ""}">
            <div class="qband__track" style="--qdur:${Math.max(28, r.length * 7)}s">${r.map((it) => chip(it)).join("")}${r.map((it) => chip(it, true)).join("")}</div>
          </div>`).join("")}
      </div>`;
  }
  sections.assistant = {
    render: (c = SITE.assistant) => `
      <section class="section section--paper" id="assistant">
        <div class="container">
          <div class="head-split">
            <div><p class="kicker kicker--dark">${esc(c.kicker)}</p><h2 class="h2">${esc(c.title)}</h2></div>
            <p class="head-split__note">${esc(c.note)}</p>
          </div>
          <div class="helpdesk">
          <aside class="persona">
            <img class="persona__img" src="${img(PERSONA.image, 900, 1100)}" alt="${esc(PERSONA.name)}, ${esc(PERSONA.role)}" loading="lazy">
            <div class="persona__body">
              <span class="persona__badge"><span class="dot"></span> ${esc(PERSONA.badge)}</span>
              <h3>${esc(t("helloIam", { name: PERSONA.name }))}</h3>
              <p class="persona__role">${esc(PERSONA.role)}</p>
              <p class="persona__intro">${esc(PERSONA.intro)}</p>
              <button type="button" class="persona__team" data-handoff>${icon("chat")} ${esc(t("talkHuman"))}</button>
            </div>
          </aside>
          <div class="assistant">
            <div class="assistant__head">
              <img class="assistant__avatar" src="${img(PERSONA.image, 120, 120)}" alt="">
              <div><b>${esc(PERSONA.name)}</b><small><span class="dot"></span> ${esc(PERSONA.badge)}</small></div>
            </div>
            <div class="assistant__log" id="assistant-log" aria-live="polite"></div>
            <form class="assistant__form" id="assistant-form" autocomplete="off">
              <input type="text" id="assistant-input" placeholder="${esc(t("askPlaceholder"))}" aria-label="${esc(t("askLabel"))}" />
              <button type="submit" class="assistant__send" aria-label="${esc(t("send"))}">${icon("send")}</button>
            </form>
          </div>
          </div>
          ${questionBand()}
          <div class="faq" id="faq">
            <div class="faq__side">
              <h3 class="h3">${esc(c.faqTitle)}</h3>
              <p>${esc(c.faqText)}</p>
              <div class="faq__filters" id="faq-filters" role="tablist" aria-label="${esc(t("faqCats"))}"></div>
            </div>
            <div class="faq__list" id="faq-list"></div>
          </div>
        </div>
      </section>`,
    init: initAssistant,
  };

  /* ---------- BLOG ---------- */
  // Artikel-Adresse und -Bild (ohne eigenes Bild: Bild des Reiseziels aus esim.json)
  const postUrl = (p) => p.url && p.url !== "#" ? p.url : `blog.html?p=${encodeURIComponent(p.id || "")}`;
  const postImage = (p) => p.image || ESIM.countries.find((c) => c.code === p.country)?.image || SITE.hero?.image;
  const postDate = (d) => { try { return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric" }).format(new Date(d)); } catch (_) { return d || ""; } };
  const mdFill = (s) => md(s).replace(/\{(?:preis|price|fiyat):([a-z]+(?::[a-z0-9-]+)?)\}/gi, (_, k) => P(k.toLowerCase(), "", true));

  /* ---------- UNTERSEITE: MAGAZIN (Übersicht + Artikel) ---------- */
  sections.blogPage = {
    render: () => {
      const all = BLOG.posts || [];
      if (!POST) {
        const cats = [...new Set(all.map((p) => p.category).filter(Boolean))];
        return `<div class="mag-page">
          <section class="guide-hero mag-hero">
            <div class="container">
              <a class="guide-back" href="index.html">${icon("chev-l")} ${esc(t("home"))}</a>
              <p class="kicker">${esc(SITE.blog?.kicker || "")}</p>
              <h1 class="guide-hero__title">${esc(SITE.blog?.title || "")}</h1>
              <p class="guide-hero__intro">${esc(t("blogIntro"))}</p>
            </div>
          </section>
          <section class="section mag">
            <div class="container">
              <div class="faq__filters mag__filters">
                <button type="button" class="is-active" data-cat="">${esc(t("blogAll"))}</button>
                ${cats.map((c) => `<button type="button" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
              </div>
              <div class="mag__grid">
                ${all.map((p) => `
                  <a class="mag-card" href="${esc(postUrl(p))}" data-cat="${esc(p.category || "")}">
                    <div class="post__img"><img src="${img(postImage(p), 800)}" alt="" loading="lazy"></div>
                    <span class="post__meta"><b>${esc(p.category || "")}</b> · ${esc(t("readTime", { t: p.readTime || "" }))}</span>
                    <h2>${esc(p.title)}</h2>
                    <p>${esc(p.excerpt || "")}</p>
                  </a>`).join("")}
              </div>
            </div>
          </section></div>`;
      }
      const meta = all.find((p) => p.id === POST.id) || {};
      const country = POST.country ? ESIM.countries.find((c) => c.code === POST.country) : null;
      const related = all.filter((p) => p.id !== POST.id).slice(0, 3);
      const cta = country
        ? `<div class="art-cta">
             <div><p class="kicker">${esc(t("blogCtaKicker"))}</p><h3>${esc(t("plansFor", { country: country.name }))}</h3><p>${P("country:" + country.code, t("priceFrom"))}</p></div>
             <button class="btn btn--green" type="button" data-plans="${esc(country.code)}">${esc(t("blogCtaEsim"))} ${icon("arrow")}</button>
           </div>`
        : `<div class="art-cta">
             <div><p class="kicker">${esc(t("blogCtaKicker"))}</p><h3>${esc(t(POST.cta === "airport" ? "blogCtaAirportTitle" : "blogCtaEsimTitle"))}</h3><p>${POST.cta === "airport" ? P("lounge", t("priceFromPerson")) : P("esim", t("priceFrom"))}</p></div>
             <a class="btn btn--green" href="index.html#${POST.cta === "airport" ? "airport" : "esim"}">${esc(t(POST.cta === "airport" ? "blogCtaAirport" : "blogCtaEsim"))} ${icon("arrow")}</a>
           </div>`;
      return `
        <article class="art">
          <header class="guide-hero art-hero">
            <div class="container art__narrow">
              <a class="guide-back" href="blog.html">${icon("chev-l")} ${esc(t("blogAll"))}</a>
              <p class="kicker">${esc(POST.category || meta.category || "")}</p>
              <h1 class="guide-hero__title">${esc(POST.title || meta.title || "")}</h1>
              <p class="guide-hero__intro">${esc(POST.excerpt || meta.excerpt || "")}</p>
              <p class="art__meta">${esc(postDate(POST.date))} · ${esc(t("readTime", { t: POST.readTime || meta.readTime || "" }))}</p>
            </div>
          </header>
          <div class="container art__narrow">
            <figure class="art__img"><img src="${img(postImage({ ...meta, ...POST }), 1400)}" alt="" fetchpriority="high"></figure>
            <div class="art__body">${mdFill(POST.body || "")}</div>
            ${cta}
          </div>
          ${related.length ? `
          <section class="section art-more">
            <div class="container">
              <h2 class="h3">${esc(t("blogRelated"))}</h2>
              <div class="mag__grid">
                ${related.map((p) => `
                  <a class="mag-card" href="${esc(postUrl(p))}">
                    <div class="post__img"><img src="${img(postImage(p), 800)}" alt="" loading="lazy"></div>
                    <span class="post__meta"><b>${esc(p.category || "")}</b> · ${esc(t("readTime", { t: p.readTime || "" }))}</span>
                    <h2>${esc(p.title)}</h2>
                  </a>`).join("")}
              </div>
            </div>
          </section>` : ""}
        </article>`;
    },
    init(el) {
      el.addEventListener("click", (e) => {
        const f = e.target.closest("[data-cat]");
        if (f && f.tagName === "BUTTON") {
          $$(".mag__filters button", el).forEach((b) => b.classList.toggle("is-active", b === f));
          $$(".mag-card", el).forEach((c) => (c.hidden = !!f.dataset.cat && c.dataset.cat !== f.dataset.cat));
          return;
        }
        const p = e.target.closest("[data-plans]");
        if (p) openPlans(ESIM.countries.find((c) => c.code === p.dataset.plans));
      });
    },
  };

  /* ---------- UNTERSEITE: INHALTS- UND RECHTSSEITEN (content/pages.json) ---------- */
  sections.contentPage = {
    render: () => !CONTENT_PAGE ? "" : `
      <article class="art legal">
        <header class="guide-hero art-hero">
          <div class="container art__narrow">
            <a class="guide-back" href="index.html">${icon("chev-l")} ${esc(t("home"))}</a>
            <h1 class="guide-hero__title">${esc(CONTENT_PAGE.title)}</h1>
          </div>
        </header>
        <div class="container art__narrow"><div class="art__body">${md(CONTENT_PAGE.body || "")}</div></div>
      </article>`,
  };

  /* ---------- UNTERSEITE: KUNDENKONTO (Logik in js/account.js) ---------- */
  sections.accountPage = {
    render: () => `<section class="acct-page"><div class="container" id="account-root"><div class="acct-loading">${esc(ACC?.loading || "…")}</div></div></section>`,
    async init(el) {
      const A = (k, v = {}) => String(ACC?.[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => (x in v ? v[x] : m));
      const cfg = AUTH?.url && AUTH?.anonKey ? { ...AUTH, accountUrl: AUTH.accountUrl || `${AUTH.url}/functions/v1/account` } : null;
      try {
        if (cfg) await Promise.all([
          loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"),
          loadScript("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"),
        ]);
        await loadScript(`js/account.js?v=${encodeURIComponent(document.querySelector('script[src*="app.js"]')?.src.split("v=")[1] || "1")}`);
        window.PP_ACCOUNT({ root: $("#account-root", el), A, ACC, esc, icon, flag, LANG, LOCALE, LANGS, CUR, ESIM, toast, cfg });
      } catch (err) {
        console.error(err);
        $("#account-root", el).innerHTML = `<p class="acct-sub">${esc(A("errNetwork"))}</p>`;
      }
    },
  };

  sections.blog = {
    render: (c = SITE.blog) => `
      <section class="section" id="blog">
        <div class="container">
          <div class="head-split">
            <div><p class="kicker kicker--dark">${esc(c.kicker)}</p><h2 class="h2">${esc(c.title)}</h2></div>
            <a href="${esc(c.linkUrl)}" class="link-arrow">${esc(c.linkText)} ${icon("arrow")}</a>
          </div>
          <div class="blog">
            ${(BLOG.posts || []).slice(0, 5).map((p, i) => `
              <a class="post ${i === 0 ? "post--lead" : ""}" href="${esc(postUrl(p))}">
                <div class="post__img"><img src="${img(postImage(p), i === 0 ? 1200 : 700)}" alt="" loading="lazy"></div>
                <span class="post__meta"><b>${esc(p.category)}</b> · ${esc(t("readTime", { t: p.readTime }))}</span>
                <h3>${esc(p.title)}</h3>
                ${i === 0 ? `<p>${esc(p.excerpt)}</p>` : ""}
              </a>`).join("")}
          </div>
        </div>
      </section>`,
  };

  /* ---------- NEWSLETTER ---------- */
  sections.newsletter = {
    render: (c = SITE.newsletter) => `
      <section class="cta">
        <div class="container cta__inner">
          <div><h2>${esc(c.title)}</h2><p>${esc(c.text)}</p></div>
          <div>
            <form class="cta__form" data-newsletter>
              <input type="email" name="email" required placeholder="${esc(c.placeholder)}" aria-label="${esc(t("emailLabel"))}" />
              <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="handoff__hp">
              <button class="btn btn--green" type="submit">${esc(c.button)}</button>
            </form>
            <p class="cta__consent">${esc(t("newsletterConsent"))}</p>
          </div>
        </div>
      </section>`,
    init(el) {
      // Anmeldung wird gespeichert (Panel → Bülten); Einwilligungstext wird mitgespeichert
      $("[data-newsletter]", el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.currentTarget, btn = $("button", f);
        btn.disabled = true;
        try {
          const url = SITE.api?.questionsUrl;
          if (url) {
            const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "newsletter", email: f.email.value.trim(), website: f.website.value, lang: LANG, page: location.pathname, consent: t("newsletterConsent") }) });
            if (!r.ok && r.status !== 204) throw new Error(String(r.status));
          }
          f.parentElement.innerHTML = `<p class="cta__ok">${esc(SITE.newsletter.success)}</p>`;
        } catch (_) { btn.disabled = false; f.email.setCustomValidity(t("newsletterError")); f.email.reportValidity(); setTimeout(() => f.email.setCustomValidity(""), 3000); }
      });
    },
  };

  /* ---------- UNTERSEITE: eSIM-INSTALLATIONSANLEITUNG ---------- */
  // Zeichnet einen Handy-Bildschirm (iOS- oder Android-Stil) aus den Daten eines Schritts
  function phoneScreen(s = {}) {
    const android = s.style === "android";
    const toggle = (v) => `<span class="ptoggle ${v === "on" ? "is-on" : ""}"></span>`;
    const tapDot = `<span class="ptap" aria-hidden="true"></span>`;
    let body = "";
    if (s.type === "qr") {
      body = `<div class="pscan"><div class="pscan__frame">${icon("qr")}<span class="pscan__line"></span></div><p>${esc(s.caption || "")}</p></div>`;
    } else if (s.type === "plans") {
      body = `<div class="plist">${(s.items || []).map((p) => `
        <div class="prow ${p.popular ? "is-tap" : ""}">
          <span class="prow__label"><b>${esc(p.gb)} GB</b><small>${esc(t("days", { n: p.days }))}</small></span>
          <span class="prow__value price">${eur(p.price)}</span>
        </div>`).join("")}</div>`;
    } else if (s.type === "done") {
      body = `<div class="pdone"><span class="pdone__icon">${icon("check")}</span><b>${esc(s.title)}</b><p>${icon("wifi")} ${esc(s.caption || "")}</p></div>`;
    } else {
      body = `<div class="plist">${(s.items || []).map((it) => `
        <div class="prow ${it.tap ? "is-tap" : ""} ${it.accent ? "is-accent" : ""} ${it.selected ? "is-selected" : ""}">
          ${it.color ? `<span class="prow__icon" style="background:${esc(it.color)}"></span>` : ""}
          ${s.type === "choice" && !it.toggle ? `<span class="pradio ${it.selected ? "is-on" : ""}"></span>` : ""}
          <span class="prow__label">${esc(it.label)}${android && it.value ? `<small>${esc(it.value)}</small>` : ""}</span>
          ${!android && it.value ? `<span class="prow__value">${esc(it.value)}</span>` : ""}
          ${it.toggle ? toggle(it.toggle) : s.type !== "choice" && !it.accent ? `<span class="prow__chev">${icon("chev-r")}</span>` : ""}
          ${it.tap ? tapDot : ""}
        </div>`).join("")}</div>`;
    }
    const showTitle = !["qr", "done"].includes(s.type);
    return `
      <div class="pmock ${android ? "pmock--android" : "pmock--ios"}" aria-hidden="true">
        <div class="pmock__screen">
          <div class="pmock__status"><span>9:41</span><span class="pmock__isl"></span><span>${icon("wifi")}</span></div>
          ${showTitle ? `<div class="pmock__head">${android ? "" : `<span class="pmock__back">${icon("chev-l")}</span>`}<b>${esc(s.title || "")}</b></div>` : ""}
          ${body}
        </div>
      </div>`;
  }

  sections.installGuide = {
    render: (c = INSTALL) => `<div class="guide-page">
      <section class="guide-hero">
        <div class="container">
          <a class="guide-back" href="index.html#assistant">${icon("chev-l")} ${esc(t("backHelp"))}</a>
          <p class="kicker">${esc(c.kicker)}</p>
          <h1 class="guide-hero__title">${esc(c.title)}</h1>
          <p class="guide-hero__intro">${esc(c.intro)}</p>
          <div class="guide-tabs" role="tablist" aria-label="${esc(t("choosePhone"))}">
            ${(c.platforms || []).map((p, i) => `<button type="button" role="tab" class="guide-tab ${i === 0 ? "is-active" : ""}" aria-selected="${i === 0}" data-platform="${esc(p.id)}"><b>${esc(p.label)}</b><small>${esc(p.sub || "")}</small></button>`).join("")}
          </div>
        </div>
      </section>
      <section class="section guide">
        <div class="container">
          <div class="guide-before">
            <h2 class="h3">${esc(c.beforeTitle)}</h2>
            <ul>${(c.before || []).map((b) => `<li>${icon("check")}<span>${esc(b)}</span></li>`).join("")}</ul>
          </div>
          ${(c.platforms || []).map((p, pi) => `
            <div class="gcar" data-panel="${esc(p.id)}" ${pi === 0 ? "" : "hidden"} role="tabpanel">
              <div class="gcar__track" tabindex="0" aria-label="${esc(p.label)}">
                ${(p.steps || []).map((st, i) => `<figure class="gcar__slide${i ? "" : " is-active"}" data-i="${i}">${phoneScreen(st.screen)}</figure>`).join("")}
              </div>
              <div class="gcar__nav">
                <button type="button" class="gcar__btn" data-dir="-1" aria-label="${esc(t("prevStep"))}" disabled>${icon("chev-l")}</button>
                <div class="gcar__mid">
                  <span class="gcar__count">${esc(t("stepOf", { i: 1, n: (p.steps || []).length }))}</span>
                  <span class="gcar__bar"><i style="width:${100 / Math.max(1, (p.steps || []).length)}%"></i></span>
                </div>
                <button type="button" class="gcar__btn" data-dir="1" aria-label="${esc(t("nextStep"))}">${icon("chev-r")}</button>
              </div>
              <div class="gcar__texts" aria-live="polite">
                ${(p.steps || []).map((st, i) => `
                  <article class="gcar__text" data-i="${i}" ${i ? "hidden" : ""}>
                    <h3>${esc(st.title)}</h3>
                    <div class="gstep__text">${md(st.text)}</div>
                    ${st.tip ? `<div class="gstep__tip">${icon("bulb")}<div>${md(st.tip)}</div></div>` : ""}
                  </article>`).join("")}
              </div>
            </div>`).join("")}

          <div class="guide-trouble">
            <h2 class="h3">${esc(c.troubleTitle)}</h2>
            <div class="faq__list">
              ${(c.trouble || []).map((t, i) => `
                <div class="faq__item">
                  <button class="faq__q" type="button" aria-expanded="false" aria-controls="tr-${i}"><span>${esc(t.q)}</span>${icon("plus")}</button>
                  <div class="faq__a" id="tr-${i}"><div><div>${md(t.a)}</div></div></div>
                </div>`).join("")}
            </div>
          </div>

          <div class="guide-help">
            ${AI.persona?.image ? `<img src="${img(AI.persona.image, 200, 200)}" alt="">` : ""}
            <div><h3>${esc(c.helpTitle)}</h3><p>${esc(c.helpText)}</p></div>
            <a class="btn btn--green" href="index.html#assistant">${icon("chat")} ${esc(c.helpButton)}</a>
          </div>
        </div>
      </section></div>`,
    init(el) {
      const tabs = $$(".guide-tab", el);
      // Wisch-Galerie je Gerät: Bilder nach rechts/links, Pfeile darunter, darunter die Beschreibung des aktuellen Schritts
      const cars = $$(".gcar", el).map((car) => {
        const track = $(".gcar__track", car), slides = $$(".gcar__slide", car), texts = $$(".gcar__text", car);
        const [prev, next] = $$(".gcar__btn", car), count = $(".gcar__count", car), bar = $(".gcar__bar i", car);
        const n = slides.length; let cur = 0;
        const show = (i) => {
          if (i === cur && slides[i].classList.contains("is-active")) return;
          cur = i;
          slides.forEach((s, k) => s.classList.toggle("is-active", k === i));
          texts.forEach((x, k) => (x.hidden = k !== i));
          count.textContent = t("stepOf", { i: i + 1, n });
          bar.style.width = `${((i + 1) / n) * 100}%`;
          prev.disabled = i === 0; next.disabled = i === n - 1;
        };
        let target = null, unlock = 0; // während des Sprungs per Pfeil keine Zwischenschritte anzeigen
        const go = (i, smooth = true) => {
          i = Math.max(0, Math.min(n - 1, i));
          target = i; clearTimeout(unlock); unlock = setTimeout(() => (target = null), 1500);
          const r = slides[i].getBoundingClientRect(), tr = track.getBoundingClientRect();
          track.scrollBy({ left: r.left + r.width / 2 - (tr.left + tr.width / 2), behavior: smooth ? "smooth" : "auto" });
          show(i);
        };
        let raf = 0;
        track.addEventListener("scroll", () => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
            let best = 0, dist = Infinity;
            slides.forEach((s, k) => { const r = s.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - mid); if (d < dist) { dist = d; best = k; } });
            if (target !== null) { if (best !== target) return; target = null; }
            show(best);
          });
        }, { passive: true });
        prev.addEventListener("click", () => go(cur - 1));
        next.addEventListener("click", () => go(cur + 1));
        slides.forEach((s, k) => s.addEventListener("click", () => go(k)));
        const rtl = document.documentElement.dir === "rtl";
        track.addEventListener("keydown", (e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); go(cur + (rtl ? -1 : 1)); }
          if (e.key === "ArrowLeft") { e.preventDefault(); go(cur + (rtl ? 1 : -1)); }
        });
        // Handy-Bild in fester Größe zeichnen und als Ganzes auf die Breite des Platzes verkleinern (Texte im Bild bleiben im Verhältnis)
        const fit = () => { const w = slides[0]?.offsetWidth; if (w) slides.forEach((s) => { const m = s.firstElementChild; if (m) m.style.zoom = (w / 270).toFixed(3); }); };
        fit(); addEventListener("resize", fit, { passive: true });
        return { car, reset: () => { fit(); go(0, false); } };
      });
      const pick = (id) => {
        tabs.forEach((t) => { const on = t.dataset.platform === id; t.classList.toggle("is-active", on); t.setAttribute("aria-selected", on); });
        $$("[data-panel]", el).forEach((p) => (p.hidden = p.dataset.panel !== id));
        cars.find((c) => c.car.dataset.panel === id)?.reset();
      };
      tabs.forEach((t) => t.addEventListener("click", () => pick(t.dataset.platform)));
      // Gerät automatisch vorwählen
      const ua = navigator.userAgent;
      if (/Android/i.test(ua)) pick(/SM-|Samsung/i.test(ua) ? "samsung" : "pixel");
      el.addEventListener("click", (e) => {
        const q = e.target.closest(".faq__q"); if (!q) return;
        const open = q.getAttribute("aria-expanded") !== "true";
        q.setAttribute("aria-expanded", open); q.nextElementSibling.classList.toggle("is-open", open);
      });
    },
  };

  /* ================================================================
     SEITE ZUSAMMENBAUEN
     ================================================================ */
  // Vorschau-Hinweis (solange Bewertungen, Preise und Bilder Platzhalter sind)
  const previewOn = SITE.preview?.enabled;
  if (previewOn) document.body.insertAdjacentHTML("afterbegin", `<div class="preview-bar">${esc(SITE.preview.text)}${PRICES?.source === "mock" ? esc(t("previewMock")) : ""}</div>`);

  // Seitentitel, Beschreibung und Sprachversionen für Suchmaschinen (hreflang)
  document.title = POST ? `${POST.title} | passport.io` : CONTENT_PAGE ? `${CONTENT_PAGE.title} | passport.io` : PAGE === "account" ? `${ACC?.title || "Account"} | passport.io` : t(PAGE === "install" ? "installMetaTitle" : PAGE === "blog" ? "blogMetaTitle" : "metaTitle");
  document.querySelector('meta[name="description"]')?.setAttribute("content", POST ? (POST.excerpt || "") : PAGE === "blog" ? t("blogIntro") : t("metaDescription"));
  if (POST) {
    // Artikel-Angaben für Suchmaschinen (strukturierte Daten)
    const ld = { "@context": "https://schema.org", "@type": "Article", headline: POST.title, description: POST.excerpt, inLanguage: LANG, datePublished: POST.date, dateModified: POST.date,
      image: [img(postImage(POST), 1400)], author: { "@type": "Organization", name: "passport.io" }, publisher: { "@type": "Organization", name: "passport.io" },
      mainEntityOfPage: location.origin + location.pathname + `?p=${POST.id}&lang=${LANG}` };
    document.head.insertAdjacentHTML("beforeend", `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`);
  }
  // Links im Umschalter: Wahl dauerhaft merken (keep=1)
  const prefUrl = (k, v) => { const u = new URL(location.href); v ? u.searchParams.set(k, v) : u.searchParams.delete(k); u.searchParams.set("keep", "1"); return u.pathname + u.search + u.hash; };
  const langUrl = (code) => prefUrl("lang", code);
  // Angezeigte Währung = die, in der die Schnittstelle tatsächlich geliefert hat
  const SHOWN_CUR = PRICES?.currency || CUR;
  // Flagge je Sprache (languages.json → flag) und Münz-Symbol je Währung (→ icon, sonst Währungszeichen)
  const LANG_META = LANGS.languages.find((l) => l.code === LANG) || {};
  const langFlag = (l) => (l.flag ? `<img class="lang__flag" src="https://flagcdn.com/w40/${esc(l.flag)}.png" srcset="https://flagcdn.com/w80/${esc(l.flag)}.png 2x" alt="" width="20" height="20">` : icon("globe"));
  const coin = (code) => (LANGS.currencies || []).find((c) => c.code === code)?.icon || SYM(code);
  const curName = (c) => { try { const n = new Intl.DisplayNames([LOCALE], { type: "currency" }).of(c.code); return n ? n.charAt(0).toLocaleUpperCase(LOCALE) + n.slice(1) : c.name; } catch (_) { return c.name; } };
  const cleanUrl = (code) => { const q = new URLSearchParams(); if (POST) q.set("p", POST.id); if (code) q.set("lang", code); const s = q.toString(); return location.origin + location.pathname + (s ? "?" + s : ""); };
  document.head.insertAdjacentHTML("beforeend", `<link rel="canonical" href="${esc(cleanUrl(LANG))}">`);
  document.head.insertAdjacentHTML("beforeend", [...LANGS.languages.map((l) => `<link rel="alternate" hreflang="${esc(l.code)}" href="${esc(cleanUrl(l.code))}">`),
    `<link rel="alternate" hreflang="x-default" href="${esc(cleanUrl(null))}">`].join(""));
  // Feste Texte im HTML-Gerüst (Geräte-Check) übersetzen
  $$("[data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
  $$("[data-i18n-html]").forEach((n) => (n.innerHTML = t(n.dataset.i18nHtml)));
  $$("[data-i18n-placeholder]").forEach((n) => (n.placeholder = t(n.dataset.i18nPlaceholder)));
  $$("[data-i18n-aria]").forEach((n) => n.setAttribute("aria-label", t(n.dataset.i18nAria)));
  // Ankündigungsleiste
  if (SITE.announcement?.enabled && SITE.announcement.text) {
    $("#announce").innerHTML = `<div class="announce">${SITE.announcement.link ? `<a href="${esc(href(SITE.announcement.link))}">${esc(SITE.announcement.text)}</a>` : esc(SITE.announcement.text)}</div>`;
  }

  // Navigation
  const brand = `<span>${esc(SITE.brand.name)}<em>${esc(SITE.brand.suffix)}</em></span>`;
  // Angemeldet? (Supabase legt die Sitzung unter sb-<projekt>-auth-token ab – ohne die Bibliothek zu laden)
  const sbRef = (() => { try { return new URL(SITE.api?.pricesUrl || "").hostname.split(".")[0]; } catch (_) { return ""; } })();
  const signedIn = (() => { try { return !!(sbRef && localStorage.getItem(`sb-${sbRef}-auth-token`)); } catch (_) { return false; } })();
  $("#nav").innerHTML = `
    <div class="nav__inner container">
      <a href="index.html" class="logo" aria-label="${esc(t("home"))}"><svg class="logo__mark"><use href="#i-pass"/></svg>${brand}</a>
      <nav class="nav__links" aria-label="${esc(t("mainNav"))}">
        ${(SITE.nav || []).map((n) => `<a href="${esc(href(n.url))}">${esc(n.label)}${n.badge ? ` <small>${esc(n.badge)}</small>` : ""}</a>`).join("")}
        <a href="account.html" class="nav__account">${esc(t(signedIn ? "myAccount" : "login"))}</a>
      </nav>
      <div class="nav__actions">
        <button class="theme-btn" type="button" data-theme-toggle aria-label="${esc(t(document.documentElement.dataset.theme === "dark" ? "themeLight" : "themeDark"))}">
          <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>
          <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20.4 14.6A8.5 8.5 0 0 1 9.4 3.6a8.5 8.5 0 1 0 11 11Z"/></svg>
        </button>
        <div class="lang">
          <button class="nav__locale" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${esc(t("language"))} / ${esc(t("currency"))}">${langFlag(LANG_META)}<span>${esc(LANG.toUpperCase())}</span><b class="coin coin--sm">${esc(coin(SHOWN_CUR))}</b></button>
          <div class="lang__menu" hidden>
            <div class="lang__group">
              <p class="lang__title">${esc(t("language"))}</p>
              <ul>${LANGS.languages.map((l) => `<li><a href="${esc(prefUrl("lang", l.code))}" hreflang="${esc(l.code)}" lang="${esc(l.code)}" aria-current="${l.code === LANG}"><span class="lang__item">${langFlag(l)}<span dir="${esc(l.dir || "ltr")}">${esc(l.name)}</span></span> <small>${esc(l.code.toUpperCase())}</small></a></li>`).join("")}</ul>
            </div>
            <div class="lang__group">
              <p class="lang__title">${esc(t("currency"))}</p>
              <ul>${(LANGS.currencies || []).map((c) => `<li><a href="${esc(prefUrl("cur", c.code))}" aria-current="${c.code === SHOWN_CUR}"><span class="lang__item"><b class="coin">${esc(coin(c.code))}</b>${esc(curName(c))}</span> <small>${esc(c.code)}</small></a></li>`).join("")}</ul>
            </div>
          </div>
        </div>
        <a href="account.html" class="nav__login">${esc(t(signedIn ? "myAccount" : "login"))}</a>
        <button class="nav__burger" type="button" aria-label="${esc(t("menuOpen"))}" aria-expanded="false">${icon("menu")}</button>
      </div>
    </div>`;
  // Hell/Dunkel: Wahl speichern; ohne Wahl folgt die Seite der Systemeinstellung
  const root = document.documentElement, themeBtn = $("[data-theme-toggle]");
  const setTheme = (mode, save) => {
    root.classList.add("theme-anim");
    root.dataset.theme = mode;
    if (save) { try { localStorage.setItem("pp_theme", mode); } catch (_) {} }
    themeBtn?.setAttribute("aria-label", t(mode === "dark" ? "themeLight" : "themeDark"));
    setTimeout(() => root.classList.remove("theme-anim"), 500);
  };
  themeBtn?.addEventListener("click", () => setTheme(root.dataset.theme === "dark" ? "light" : "dark", true));
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", (e) => {
    let saved = null; try { saved = localStorage.getItem("pp_theme"); } catch (_) {}
    if (!saved) setTheme(e.matches ? "dark" : "light", false);
  });
  // Sprachumschalter
  const langBox = $(".lang"), langBtn = $(".nav__locale"), langMenu = $(".lang__menu");
  const setLangMenu = (open) => {
    // Handy: Panel direkt unter der Navigation (auch wenn oben noch ein Hinweis steht)
    if (open && matchMedia("(max-width: 640px)").matches) {
      const top = Math.max(8, Math.round($("#nav").getBoundingClientRect().bottom + 6));
      langMenu.style.top = `${top}px`; langMenu.style.maxHeight = `${innerHeight - top - 12}px`;
    } else { langMenu.style.top = ""; langMenu.style.maxHeight = ""; }
    langMenu.hidden = !open; langBox.classList.toggle("is-open", open); langBtn.setAttribute("aria-expanded", open);
  };
  langBtn.addEventListener("click", (e) => { e.stopPropagation(); setLangMenu(langMenu.hidden); });
  document.addEventListener("click", (e) => { if (!langBox.contains(e.target)) setLangMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setLangMenu(false); });

  // Bereiche in der Reihenfolge aus dem CMS
  const page = $("#page");
  const active = PAGE === "install" ? [{ type: "installGuide" }]
    : PAGE === "blog" ? [{ type: "blogPage" }]
    : PAGE === "account" ? [{ type: "accountPage" }]
    : PAGE === "page" ? [{ type: "contentPage" }]
    : (SITE.sections || []).filter((s) => s.enabled !== false && sections[s.type]);
  page.innerHTML = active.map((s) => sections[s.type].render()).join("");
  active.forEach((s, i) => sections[s.type].init?.(page.children[i]));

  // Inhalte beim Scrollen sanft einblenden (wie bei Apple/Samsung); bei „Bewegung reduzieren“ aus
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  $$(".hero__content > *").forEach((n, i) => n.style.setProperty("--d", `${0.15 + i * 0.12}s`));
  if (!calm && window.CSS?.supports?.("animation-timeline: view()")) {
    // Moderne Browser: Bewegung hängt direkt am Scrollen (läuft rückwärts beim Hochscrollen) – siehe styles.css „has-scrolly“
    document.documentElement.classList.add("has-scrolly");
  } else if ("IntersectionObserver" in window && !calm) {
    document.documentElement.classList.add("has-reveal");
    const io = new IntersectionObserver((list) => list.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    const mark = (sel, cls = "reveal") => $$(sel).forEach((n) => { n.classList.add(cls); io.observe(n); });
    $$(".blog > .post").forEach((n, i) => n.style.setProperty("--d", `${Math.min(i, 4) * 0.08}s`));
    mark(".hero__content > *, .strip, #page .head-split, .how2__head, .rail, .wmap, .airport-search, .reviews-bar, .marquee, .qband, .helpdesk, .faq__side, .faq__list, .blog > .post, .cta__inner, .footer__grid");
    mark(".how2__track, .airport", "reveal-kids");
  }

  // Navigation liegt transparent über dem Hero, wenn er an erster Stelle steht
  const nav = $("#nav");
  const heroFirst = active[0]?.type === "hero";
  if (heroFirst && !$("#announce").children.length && !previewOn) nav.classList.add("nav--over");
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 40);
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  $(".nav__burger").addEventListener("click", (e) => { const o = nav.classList.toggle("is-open"); e.currentTarget.setAttribute("aria-expanded", o); });
  $$(".nav__links a").forEach((a) => a.addEventListener("click", () => nav.classList.remove("is-open")));

  // Footer
  const F = SITE.footer;
  $("#footer").innerHTML = `
    <div class="container">
      <div class="footer__grid">
        <div class="footer__brand"><a href="index.html" class="logo"><svg class="logo__mark"><use href="#i-pass"/></svg>${brand}</a><p>${esc(F.tagline)}</p></div>
        ${(F.columns || []).map((col) => `<div><h4>${esc(col.title)}</h4>${(col.links || []).map((l) => `<a href="${esc(href(l.url))}">${esc(l.label)}</a>`).join("")}</div>`).join("")}
      </div>
      <div class="footer__pay" aria-label="${esc(t("payMethods"))}">${(F.payments || []).map(payLogo).join("")}</div>
      <div class="footer__bottom"><span>${esc(F.copyright)}</span><nav>${(F.legal || []).map((l) => `<a href="${esc(href(l.url))}">${esc(l.label)}</a>`).join("")}</nav></div>
    </div>`;

  // Suchfelder & Geräte-Check verdrahten
  $$("[data-search]").forEach(wireSearch);
  $$("[data-open-device-check]").forEach((b) => b.addEventListener("click", openDeviceCheck));

  /* ================================================================
     BAUSTEINE
     ================================================================ */
  function searchForm(mod, placeholder, button) {
    return `
      <form class="search ${mod}" role="search" data-search autocomplete="off">
        <svg class="search__icon"><use href="#i-search"/></svg>
        <input type="text" class="search__input" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" />
        ${button ? `<button class="btn btn--green search__btn" type="submit">${esc(button)}</button>` : ""}
        <ul class="search__results" role="listbox" hidden></ul>
      </form>`;
  }

  function wireSearch(form) {
    const index = [
      ...ESIM.countries.map((c) => ({ ...c, kind: t("kindCountry") })),
      ...ESIM.regional.map((r) => ({ ...r, names: [norm(r.name)], kind: t("kindRegion", { n: r.countries }) })),
    ];
    const input = $(".search__input", form), list = $(".search__results", form);
    let items = [], active = -1;
    // Treffer auch bei Eingabe in anderen Sprachen (z. B. „Turkey“, „Türkei“, „Türkiye“)
    const score = (it, nq) => {
      const n = norm(it.name);
      if (n.startsWith(nq)) return 4;
      if (n.split(" ").some((w) => w.startsWith(nq))) return 3;
      if ((it.names || []).some((a) => a.startsWith(nq) || a.split(" ").some((w) => w.startsWith(nq)))) return 2;
      // „U.S. Virgin Islands“ ~ „US Virgin Islands“, „St. Vincent & Grenadines“ ~ „St Vincent & the Grenadines“
      const words = nq.split(" ").filter(Boolean), flat = nq.replace(/ /g, "");
      if ([n, ...(it.names || [])].some((a) => a.replace(/ /g, "").startsWith(flat) || words.every((q) => a.split(" ").some((w) => w.startsWith(q))))) return 2;
      return n.includes(nq) ? 1 : 0;
    };
    const find = (q) => {
      const nq = norm(q);
      if (!nq) return popular().slice(0, 6).map((c) => ({ ...c, kind: t("popular") }));
      return index.map((it) => ({ it, s: score(it, nq) }))
        .filter((x) => x.s).sort((a, b) => b.s - a.s || a.it.name.localeCompare(b.it.name, LOCALE)).slice(0, 8).map((x) => x.it);
    };
    const mark = (name, q) => { const i = name.toLowerCase().indexOf(q.toLowerCase()); return !q || i < 0 ? esc(name) : esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + q.length)) + "</mark>" + esc(name.slice(i + q.length)); };
    const render = () => {
      const q = input.value.trim();
      items = find(q); active = -1;
      list.innerHTML = items.length ? items.map((it, i) => `
        <li role="option" data-i="${i}" aria-selected="false">
          <img class="r-thumb" src="${it.image ? img(it.image, 120, 90) : flag(it.code)}" alt="" loading="lazy">
          <span class="r-name">${mark(it.name, q)}<span class="r-type">${esc(it.kind)}</span></span>
          <span class="r-price">${P((it.code ? "country:" + it.code : "region:" + it.id), t("priceFrom"))}</span>
        </li>`).join("") : `<li class="r-empty">${esc(t("noResult", { q }))}</li>`;
      list.hidden = false;
    };
    const setActive = (i) => { const lis = $$("li[data-i]", list); if (!lis.length) return; active = (i + lis.length) % lis.length; lis.forEach((li, k) => li.setAttribute("aria-selected", k === active)); lis[active].scrollIntoView({ block: "nearest" }); };
    const choose = (it) => { list.hidden = true; input.value = it.name; openPlans(it); };
    input.addEventListener("focus", render);
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Escape") list.hidden = true;
    });
    list.addEventListener("mousedown", (e) => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); choose(items[+li.dataset.i]); } });
    form.addEventListener("submit", (e) => { e.preventDefault(); if (!items.length) render(); const it = items[active >= 0 ? active : 0]; if (it && input.value.trim()) choose(it); else input.focus(); });
    document.addEventListener("click", (e) => { if (!form.contains(e.target)) list.hidden = true; });
  }

  function wireRail(rail, prev, next) {
    // Bei Rechts-nach-links (Arabisch) läuft der Slider andersherum; scrollLeft ist dann ≤ 0
    const dir = RTL ? -1 : 1;
    const step = () => (rail.firstElementChild?.offsetWidth || 260) * 2 + 28;
    const update = () => { if (!prev) return; const pos = Math.abs(rail.scrollLeft); prev.disabled = pos < 4; next.disabled = pos + rail.clientWidth >= rail.scrollWidth - 4; };
    prev?.addEventListener("click", () => rail.scrollBy({ left: -step() * dir }));
    next?.addEventListener("click", () => rail.scrollBy({ left: step() * dir }));
    rail.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    // Mit der Maus ziehen (Desktop)
    let down = false, x0 = 0, l0 = 0, moved = false;
    rail.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") return; down = true; moved = false; x0 = e.clientX; l0 = rail.scrollLeft; });
    window.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) > 5) { moved = true; rail.style.scrollSnapType = "none"; rail.style.scrollBehavior = "auto"; }
      if (moved) rail.scrollLeft = l0 - dx;
    });
    window.addEventListener("pointerup", () => { if (!down) return; down = false; rail.style.scrollSnapType = ""; rail.style.scrollBehavior = ""; });
    rail.addEventListener("click", (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    rail.addEventListener("dragstart", (e) => e.preventDefault());
  }

  /* ---------- Paketauswahl ---------- */
  function openPlans(item) {
    if (!item) return;
    // Pakete und Preise ausschließlich aus der Preis-Schnittstelle
    // Datenpakete zuerst (nach Preis), dann Unlimited (nach Laufzeit); Reiter nur, wenn es beides gibt
    const all = plansOf(item.code ? "country:" + item.code : "region:" + item.id);
    const plans = [
      ...all.filter((p) => !p.unlimited).sort((a, b) => a.gb - b.gb || a.days - b.days || a.price - b.price),
      ...all.filter((p) => p.unlimited).sort((a, b) => a.days - b.days || a.price - b.price),
    ];
    const hasData = plans.some((p) => !p.unlimited), hasUnl = plans.some((p) => p.unlimited);
    const pre = Math.max(0, plans.findIndex((p) => p.popular));
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal__backdrop" data-close-modal></div>
      <div class="modal__panel modal__panel--plans" role="dialog" aria-modal="true" aria-label="${esc(t("plansAria", { name: item.name }))}">
        <button class="modal__close icon-btn" type="button" data-close-modal aria-label="${esc(t("close"))}">${icon("x")}</button>
        <div class="modal__hero">
          ${item.image ? `<img src="${img(item.image, 1000, 340)}" alt="">` : item.code ? `<img class="modal__hero-flag" src="https://flagcdn.com/w640/${esc(item.code)}.png" alt="">` : ""}
          <h3>${item.code ? `<img class="dest__flag" src="${flag(item.code)}" alt="">` : ""}${esc(item.name)}</h3>
        </div>
        <p class="modal__lead">${item.countries ? esc(t("modalCountries", { n: item.countries })) : ""}${esc(t("modalLead"))}</p>
        ${plans.length ? `${hasData && hasUnl ? `<div class="plan-tabs" role="tablist">
            <button type="button" role="tab" class="plan-tab ${plans[pre].unlimited ? "" : "is-active"}" aria-selected="${!plans[pre].unlimited}" data-ptab="data">${esc(t("tabData"))}</button>
            <button type="button" role="tab" class="plan-tab ${plans[pre].unlimited ? "is-active" : ""}" aria-selected="${!!plans[pre].unlimited}" data-ptab="unl">${icon("wifi")} ${esc(t("tabUnlimited"))}</button>
          </div>` : ""}
          <div class="plan-info" data-pinfo hidden></div>
          <div class="plan-list" role="radiogroup" aria-label="${esc(t("dataVolume"))}">
          ${plans.map((p, i) => `
            <div class="plan-row" data-kind="${p.unlimited ? "unl" : "data"}" ${hasData && hasUnl && !!p.unlimited !== !!plans[pre].unlimited ? "hidden" : ""}>
              <label class="plan ${i === pre ? "is-active" : ""} ${p.unlimited ? "plan--unl" : ""}">
                <input type="radio" name="plan" value="${i}" ${i === pre ? "checked" : ""}>
                <span class="plan__gb">${esc(vol(p))}</span><span class="plan__days">${esc(t("days", { n: p.days }))}</span>
                ${p.popular ? `<span class="plan__pop">${esc(t("popular"))}</span>` : ""}
                <span class="plan__price">${eur(p.price)}</span>
                <button type="button" class="plan__info" data-info="${i}" aria-expanded="false" aria-controls="pd-${i}" aria-label="${esc(t("detToggle"))}" title="${esc(t("detToggle"))}">${icon("chev-r")}</button>
              </label>
              <div class="plan-det" id="pd-${i}" hidden></div>
            </div>`).join("")}
        </div>
        <details class="plan-coupon"><summary>${esc(t("couponToggle"))}</summary><input type="text" name="coupon" maxlength="32" autocomplete="off" placeholder="${esc(t("couponPlaceholder"))}" aria-label="${esc(t("couponToggle"))}"></details>
        <button class="btn btn--dark plan-buy" type="button" style="width:100%;margin-top:14px">${esc(t("checkout"))} · <span>${eur(plans[pre].price)}</span></button>
        <p class="plan-note">${icon("shield")} ${esc(t("moneyBack"))}</p>`
        : `<div class="device-result__none">${esc(SITE.api?.modalUnavailableText || t("modalUnavailable"))}</div>`}
      </div>`;
    document.body.appendChild(modal);
    document.body.style.overflow = "hidden";
    const close = () => { modal.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    modal.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-modal]")) return close();
      const info = e.target.closest("[data-info]");
      if (info) { e.preventDefault(); e.stopPropagation(); toggleDetails(info); return; }
      const tab = e.target.closest("[data-ptab]");
      if (!tab) return;
      // Reiter wechseln: passende Tarife zeigen und den ersten (bzw. beliebten) auswählen
      const kind = tab.dataset.ptab;
      $$(".plan-tab", modal).forEach((b) => { b.classList.toggle("is-active", b === tab); b.setAttribute("aria-selected", b === tab); });
      const rows = $$(".plan-row", modal);
      rows.forEach((l) => (l.hidden = l.dataset.kind !== kind));
      const hint = $(".plan-hint", modal);
      if (hint) hint.hidden = kind !== "unl";
      renderInfo(kind);
      const first = rows.find((l) => l.dataset.kind === kind && plans[+$("input", l).value].popular) || rows.find((l) => l.dataset.kind === kind);
      if (first) { const inp = $("input", first); inp.checked = true; inp.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    modal.addEventListener("change", (e) => {
      if (e.target.name !== "plan") return;
      $$(".plan", modal).forEach((l) => l.classList.toggle("is-active", l.contains(e.target)));
      $(".plan-buy span", modal).textContent = eur(plans[+e.target.value].price);
    });
    // Kaufen → Kundenkonto (Anmeldung, dann Bestellung; Preis prüft der Server über die Preis-Schnittstelle)
    $(".plan-buy", modal)?.addEventListener("click", () => {
      const plan = plans[+($("input[name=plan]:checked", modal)?.value ?? pre)];
      if (!plan) return;
      const key = item.code ? "country:" + item.code : "region:" + item.id;
      // Rabattcode wird nur weitergereicht – geprüft und berechnet wird er auf dem Server
      const coupon = ($("input[name=coupon]", modal)?.value || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
      location.href = `account.html?buy=${encodeURIComponent(key)}&plan=${encodeURIComponent(plan.id)}${coupon ? `&coupon=${encodeURIComponent(coupon)}` : ""}`;
    });
    // Fokus auf den vorgewählten Tarif, ohne dass das Fenster nach unten springt – Land und Bild bleiben oben sichtbar
    const sel = $("input:checked", modal);
    sel?.focus({ preventScroll: true });
    $(".modal__panel", modal).scrollTop = 0;
    const pl = $(".plan-list", modal), row = sel?.closest(".plan-list > *");
    if (pl && row) { pl.scrollTop = 0; const r = row.getBoundingClientRect(), b = pl.getBoundingClientRect(); if (r.bottom > b.bottom) pl.scrollTop = r.bottom - b.bottom + 12; }

    /* ---- Tarif-Details (aus der Anbieter-API, pro Land einmal nachgeladen) ---- */
    const itemKey = item.code ? "country:" + item.code : "region:" + item.id;
    let details = null;
    const loadDetails = () => details ??= (async () => {
      try {
        if (!SITE.api?.pricesUrl) return {};
        const u = new URL(SITE.api.pricesUrl, location.href);
        u.searchParams.set("item", itemKey);
        const r = await fetch(u, { headers: { Accept: "application/json" } });
        const d = r.ok ? await r.json() : null;
        return Object.fromEntries((d?.plans || []).map((x) => [x.id, x.meta || null]));
      } catch (_) { return {}; }
    })();
    const placeName = (code) => { const c = String(code).toUpperCase() === "UK" ? "GB" : String(code).toUpperCase(); try { return DN?.of(c) || c; } catch (_) { return c; } };
    const detailRows = (p, m) => {
      const rows = [];
      const add = (k, v) => v && rows.push(`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`);
      if (p.unlimited) add(t("detData"), m?.hs && m?.fup ? t("detDataUnl", { hs: String(m.hs).replace(".", ","), fup: m.fup }) : t("detDataUnlPlain"));
      else { add(t("detData"), t("detDataStd", { gb: p.gb })); add(t("detAfter"), m?.fup ? m.fup : t(m?.top === false ? "detAfterStop" : "detAfterTopup")); }
      add(t("detValidity"), t("detValidityTxt", { n: p.days }));
      if (m) {
        if (m.net?.length) add(t("detNetwork"), m.net.map((n) => (n.t ? `${n.n} (${n.t})` : n.n)).join(", "));
        if (m.spd) add(t("detSpeed"), m.spd.split("/").join(" · "));
        if (m.act) add(t("detActivation"), t(m.act === "network" ? "detActNetwork" : "detActInstall"));
        if (m.win) add(t("detWindow"), t("detWindowTxt", { n: m.win }));
        if (m.ip) add(t("detIp"), t("detIpTxt", { list: m.ip.split(/[/,]/).filter(Boolean).map(placeName).join(", ") }));
        if (typeof m.top === "boolean") add(t("detTopup"), t(m.top ? "yes" : "no"));
        if (!m.voice) add(t("detType"), t("detTypeTxt"));
      }
      return `<dl class="plan-det__list">${rows.join("")}</dl>${m ? "" : `<p class="plan-det__none">${esc(t("detNone"))}</p>`}`;
    };
    // Einmal oben: Netzbetreiber, Technik und Geschwindigkeitsregel – passend zum gewählten Reiter
    const SPD = ["2G", "3G", "4G", "LTE", "5G"];
    const renderInfo = async (kind) => {
      const box = $("[data-pinfo]", modal);
      if (!box) return;
      const d = await loadDetails();
      const metas = plans.filter((p) => (kind === "unl") === !!p.unlimited).map((p) => d[p.id]).filter(Boolean);
      if (!metas.length) { box.hidden = true; return; }
      const nets = [...new Map(metas.flatMap((m) => m.net || []).map((n) => [n.n.toLowerCase(), n.n])).values()].slice(0, 5);
      const top = metas.flatMap((m) => (m.spd || "").split("/")).filter(Boolean).sort((a, b) => SPD.indexOf(a) - SPD.indexOf(b)).pop();
      const fupM = metas.find((m) => m.hs && m.fup);
      const rows = [];
      if (nets.length || top) rows.push(`<div><dt>${esc(t("detNetwork"))}</dt><dd>${esc([nets.join(" · "), top].filter(Boolean).join(" · "))}</dd></div>`);
      rows.push(`<div><dt>${esc(t("infoLimit"))}</dt><dd>${esc(kind === "unl"
        ? (fupM ? t("sumUnl", { hs: String(fupM.hs).replace(".", ","), fup: fupM.fup }) : t("detDataUnlPlain"))
        : t(metas.some((m) => m.top === false) ? "infoNoLimitStop" : "infoNoLimit"))}</dd></div>`);
      box.innerHTML = `<dl>${rows.join("")}</dl>`;
      box.hidden = false;
    };
    renderInfo(plans[pre]?.unlimited ? "unl" : "data");
    async function toggleDetails(btn) {
      const i = +btn.dataset.info, box = $("#pd-" + i, modal), open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      box.hidden = open;
      if (open || box.dataset.ready) return;
      box.innerHTML = `<p class="plan-det__none">${esc(t("detLoading"))}</p>`;
      const d = await loadDetails();
      box.innerHTML = detailRows(plans[i], d[plans[i].id] || null);
      box.dataset.ready = "1";
    }
  }

  /* ---------- Geräte-Check ---------- */
  function openDeviceCheck() {
    const m = $("#device-modal"), input = $("#device-input");
    m.hidden = false; document.body.style.overflow = "hidden";
    input.value = ""; $("#device-result").innerHTML = "";
    setTimeout(() => input.focus(), 50);
  }
  const closeDevice = () => { $("#device-modal").hidden = true; document.body.style.overflow = ""; };
  if ($("#device-input")?.type === "text") {
  $("#device-modal").addEventListener("click", (e) => { if (e.target.closest("[data-close-modal]")) closeDevice(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#device-modal") && !$("#device-modal").hidden) closeDevice(); });
  $("#device-input").addEventListener("input", (e) => {
    const q = norm(e.target.value), out = $("#device-result");
    if (q.length < 2) { out.innerHTML = ""; return; }
    // Wortanfänge vergleichen ("s24" findet "Galaxy S24", "8" aber nicht "iPhone 18"); "iphone15pro" ohne Leerzeichen geht auch
    const terms = q.split(" "), flat = q.replace(/ /g, "");
    const score = (d) => {
      const n = norm(d), words = n.split(" "), f = n.replace(/ /g, "");
      if (n === q || f === flat) return 3;
      if (terms.every((t) => words.some((w) => w.startsWith(t)))) return 2;
      return flat.length >= 4 && /\d/.test(flat) && /[a-z]/.test(flat) && f.includes(flat) ? 1 : 0;
    };
    const hits = [...(AI.devices || []).map((d) => ({ d, ok: true })), ...(AI.devicesNo || []).map((d) => ({ d, ok: false }))]
      .map((h) => ({ ...h, s: score(h.d) })).filter((h) => h.s).sort((a, b) => b.s - a.s || a.d.length - b.d.length).slice(0, 12);
    out.innerHTML = hits.length
      ? `<ul class="device-result__list">${hits.map((h) => h.ok
          ? `<li>${icon("check")}<span>${t("deviceOk", { d: esc(h.d) })}</span></li>`
          : `<li class="is-no">${icon("x")}<span>${t("deviceNo", { d: esc(h.d) })}</span></li>`).join("")}</ul>${hits.some((h) => h.ok) ? `<p class="device-result__note">${t("deviceRegion")}</p>` : ""}`
      : `<div class="device-result__none">${t("deviceNone", { q: esc(e.target.value) })}</div>`;
  });
  }

  /* ---------- Assistent ---------- */
  function initAssistant(el) {
    const log = $("#assistant-log", el);
    const faqs = AI.faqs || [];

    const add = (html, who = "bot", P) => {
      const m = document.createElement("div"); m.className = `msg msg--${who}`; m.innerHTML = html;
      if (P && P.code !== LANG) { m.lang = P.code; m.dir = P.dir; } // Antwort in anderer Sprache als die Seite
      log.appendChild(m); log.scrollTop = log.scrollHeight; return m;
    };
    const typing = () => { const t = add(`<span class="typing"><span></span><span></span><span></span></span>`); t.style.padding = "0"; return t; };

    // Treffer-Suche: Stichwörter (auch mit Endungen/Tippfehlern), Fragetext voll, Antworttext halb.
    // Häufige Wörter („esim“, „lounge“) zählen weniger als seltene.
    const same = (a, b) => {
      if (a === b) return true;
      const m = Math.min(a.length, b.length);
      if (m < 4) return false;
      let i = 0; while (i < m && a[i] === b[i]) i++;
      return i === m || i >= Math.max(5, m - 2);
    };
    const makeRanker = (list, nrm) => {
      const idx = list.map((f) => {
        const kws = (f.keywords || []).map((k) => nrm(k)).filter(Boolean).map((k) => ({ k, w: k.split(" ") }));
        const qw = nrm(f.question).split(" ").filter((w) => w.length > 3);
        const aw = [...new Set(nrm(String(f.answer || "").replace(/\]\([^)]*\)/g, " ")).split(" ").filter((w) => w.length > 3))];
        return { f, kws, qw, aw, words: new Set([...kws.flatMap((x) => x.w), ...qw]) };
      });
      const df = new Map();
      idx.forEach((e) => e.words.forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
      const common = (w) => (df.get(w) || 0) > Math.max(3, idx.length * 0.1);
      const weight = (w) => { const ds = w.filter((x) => x.length > 2).map((x) => df.get(x) || 1); const d = ds.length ? Math.max(1, Math.min(...ds)) : 1; return 1 / (1 + Math.log2(d) / 3); };
      return (text) => {
        const nq = nrm(text), q = " " + nq + " ";
        const toks = nq.split(" ").filter(Boolean);
        return idx.map(({ f, kws, qw, aw }) => {
          let s = 0; const used = new Set();
          // Jedes Suchwort zählt pro FAQ nur einmal – viele Varianten desselben Stichworts blähen sonst auf
          const hit = (w) => { const t = w.map((x) => toks.findIndex((y) => (x.length < 4 ? y === x : same(y, x)))); return t.every((i) => i >= 0) ? t : null; };
          // Erst exakte Treffer, dann ähnliche – sonst „verbraucht“ ein ähnliches Stichwort das Wort vor dem exakten
          const isExact = ({ k, w }) => q.includes(" " + k + " ") || (w.length > 1 && (q.includes(" " + k) || q.includes(k + " ")));
          [...kws.filter(isExact), ...kws.filter((x) => !isExact(x))].forEach(({ k, w }) => {
            const weak = w.length === 1 && common(k);
            const exact = isExact({ k, w });
            const t = exact || (!weak && w.some((x) => x.length >= 4)) ? hit(w) : null;
            if (!t && !exact) return;
            if (t && t.every((i) => used.has(i))) return;
            (t || []).forEach((i) => used.add(i));
            s += (exact ? (weak ? 1 : 2 + w.length) : 0.5 + w.length) * (weak ? 1 : weight(w));
          });
          toks.forEach((t) => { if (t.length <= 3 || common(t)) return; if (qw.some((w) => same(t, w))) s += 1; else if (aw.some((w) => same(t, w))) s += 0.5; });
          return { f, s };
        }).sort((a, b) => b.s - a.s);
      };
    };

    // Umgangssprache → einheitliche Begriffe (content/lina-synonyms.json), auf Frage UND FAQ-Texte angewendet
    const canonFor = (rules, nrm) => {
      const list = Object.entries(rules || {}).filter(([k]) => !k.startsWith("_"))
        .flatMap(([vars, canon]) => vars.split("|").map((v) => [nrm(v), nrm(canon)]))
        .filter(([v]) => v).sort((a, b) => b[0].length - a[0].length);
      return (s) => { let x = " " + nrm(s) + " "; for (const [v, c] of list) if (x.includes(" " + v + " ")) x = x.split(" " + v + " ").join(" " + c + " "); return x.trim().replace(/\s+/g, " "); };
    };
    // Ein Paket pro Sprache: Texte (fehlende aus der Standardsprache), Suche und Wortschatz zur Spracherkennung
    const SCRIPT = { ar: /[\u0600-\u06ff]/, ru: /[\u0400-\u04ff]/ };
    const scriptOf = (s) => Object.keys(SCRIPT).find((c) => SCRIPT[c].test(s)) || "latn";
    const PACKS = LANGS.languages.map((l) => {
      const own = (RAW_AI && RAW_AI[l.code]) || {};
      const data = l.code === LANG ? AI : merge(RAW_AI[LANGS.default], own);
      const ui = l.code === LANG ? UI : merge(RAW_UI[LANGS.default], RAW_UI[l.code]);
      const nrm = l.code === LANG ? norm : normFor(l.locale);
      const vocab = new Set(nrm([own.greeting, own.fallback, ...(own.suggestions || []), ...(own.faqs || []).flatMap((f) => [f.question, f.answer, ...(f.keywords || [])])].join(" ")).split(" ").filter((w) => w.length > 1));
      return { code: l.code, dir: l.dir || "ltr", script: SCRIPT[l.code] ? l.code : "latn", data, ui, norm: nrm, vocab,
        rank: makeRanker(data.faqs || [], canonFor(RAW_SYN[l.code], nrm)), byId: Object.fromEntries((data.faqs || []).map((f) => [f.id, f])) };
    });
    const HOME = PACKS.find((p) => p.code === LANG);
    const packOf = (code) => PACKS.find((p) => p.code === code) || HOME;
    const tx = (P, k, v) => (P.ui && P.ui[k] != null ? String(P.ui[k]).replace(/\{(\w+)\}/g, (m, x) => (v && x in v ? v[x] : m)) : t(k, v));
    // Sprache der Frage: Schrift (Arabisch/Kyrillisch), sonst Wörter, die nur in einer Sprache vorkommen.
    // Unklar → die Sprache, deren Antworten am besten passen; im Zweifel die Seitensprache.
    const detect = (text, cands) => {
      const sc = cands.map((x) => ({ x, s: 0 }));
      [...new Set(cands[0].p.norm(text).split(" ").filter((w) => w.length > 1))].forEach((tok) => { const inL = sc.filter((y) => y.x.p.vocab.has(tok)); inL.forEach((y) => (y.s += 1 / inL.length)); });
      sc.sort((a, b) => b.s - a.s);
      return sc.length === 1 || (sc[0].s >= 0.5 && sc[0].s - (sc[1] ? sc[1].s : 0) >= 0.5) ? sc[0].x : null;
    };
    const search = (text) => {
      const sc = scriptOf(text);
      let res = PACKS.filter((p) => p.script === sc).map((p) => ({ p, r: p.rank(text) }));
      if (!res.length) res = [{ p: HOME, r: HOME.rank(text) }];
      const det = detect(text, res);
      if (det) return det;
      const own = res.find((x) => x.p === HOME);
      const best = res.reduce((a, b) => (b.r[0].s > a.r[0].s ? b : a));
      return !own || best.r[0].s - own.r[0].s >= (own.r[0].s >= 3 ? 2 : 1) ? best : own;
    };
    // Land in der Frage erkennen – in jeder unterstützten Sprache („Mısır'da“, „in Ägypten“, „in Egypt“)
    const findCountry = (text) => { const q = " " + norm(text) + " "; return ESIM.countries.find((c) => (c.names || [norm(c.name)]).some((n) => n.length > 2 && q.includes(" " + n + " "))); };

    // „Mit einem Menschen sprechen“: kurzes Formular → Anfrage landet im Verwaltungspanel (Destek talepleri).
    // Ohne konfigurierte Adresse bleibt der E-Mail-Link als Ausweg.
    const contact = () => {
      const url = SITE.api?.questionsUrl;
      if (!url) return add(`${esc(AI.contactText)}<div class="msg__action"><a class="btn btn--dark btn--sm" href="mailto:${esc(AI.contactEmail)}">${icon("mail")} ${esc(t("writeEmail"))}</a></div>`);
      add(`${esc(AI.contactText)}
        <form class="handoff" data-handoff-form novalidate>
          <input name="name" placeholder="${esc(t("handoffName"))}" maxlength="120" autocomplete="name">
          <input name="email" type="email" placeholder="${esc(t("handoffEmail"))}" maxlength="254" autocomplete="email" required>
          <textarea name="message" rows="3" placeholder="${esc(t("handoffMsg"))}" maxlength="4000" required></textarea>
          <input name="website" tabindex="-1" autocomplete="off" class="handoff__hp" aria-hidden="true">
          <button class="btn btn--dark btn--sm" type="submit">${icon("send")} ${esc(t("handoffSend"))}</button>
        </form>`);
    };
    el.addEventListener("submit", async (e) => {
      const f = e.target.closest("[data-handoff-form]");
      if (!f) return;
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      if (!/^\S+@\S+\.\S+$/.test(d.email || "") || String(d.message || "").trim().length < 5) { toast(t("handoffErr")); return; }
      f.querySelector("button").disabled = true;
      try {
        const r = await fetch(SITE.api.questionsUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "support", ...d, page: `${location.pathname} · ${LANG}` }) });
        if (!r.ok) throw new Error(String(r.status));
        f.outerHTML = `<p class="handoff__ok">${esc(t("handoffSent"))}</p>`;
      } catch (_) { f.querySelector("button").disabled = false; toast(t("handoffErr")); }
    });

    // Lina mit KI (optional, SITE.api.linaUrl): formuliert aus den passendsten FAQs eine Antwort in der Sprache der Frage.
    // Nur wenn die Stichwortsuche nicht ganz sicher ist; ist die KI aus oder langsam, bleibt es bei der Stichwortsuche.
    let aiOff = !SITE.api?.linaUrl;
    const askAI = async (text, hit) => {
      if (aiOff) return null;
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);
      try {
        const ids = hit.r.filter((r) => r.s > 0).slice(0, 6).map((r) => r.f.id);
        const r = await fetch(SITE.api.linaUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, lang: hit.p.code, ids }), signal: ctl.signal });
        if (r.status === 503) { aiOff = true; return null; } // KI nicht eingerichtet → für diesen Besuch nicht mehr fragen
        if (!r.ok) return null;
        return await r.json();
      } catch (_) { return null; } finally { clearTimeout(timer); }
    };

    function respond(text, forced, forcedLang) {
      const dots = typing();
      const hit = forced ? { p: packOf(forcedLang), r: [{ f: forced, s: 99 }] } : search(text);
      const top = hit.r[0];
      const useAI = !forced && !aiOff && !(top && top.s >= 5) && !findCountry(text);
      const started = Date.now();
      (useAI ? askAI(text, hit) : Promise.resolve(null)).then((ai) => setTimeout(() => {
        dots.remove();
        const P = hit.p, ranked = hit.r;
        if (ai && ai.answer) {
          const PA = P; // Antwortsprache = Sprache der Frage
          const steps = ((PA.byId[ai.faq] || {}).next || []).map((id) => PA.byId[id]).filter(Boolean);
          const rel = [...steps, ...ranked.filter((r) => r.s >= 2).map((r) => r.f)].filter((f, i, a) => f.id !== ai.faq && a.findIndex((x) => x.id === f.id) === i).slice(0, 4);
          const btns = rel.map((f) => `<button type="button" data-faq="${esc(f.id)}" data-lang="${esc(PA.code)}">${esc(f.question)}</button>`).join("");
          add(md(String(ai.answer).replace(/</g, "‹"))
            + (btns ? `<div class="msg__related">${btns}</div>` : "")
            + (ai.handoff
              ? `<div class="msg__action"><button class="btn btn--dark btn--sm" type="button" data-handoff>${icon("chat")} ${esc(tx(PA, "talkTeam"))}</button></div>`
              : `<div class="msg__feedback">${esc(tx(PA, "helpful"))} <button type="button" data-fb="yes">${esc(tx(PA, "yes"))}</button><button type="button" data-fb="no">${esc(tx(PA, "no"))}</button></div>`), "bot", PA);
          track(ai.handoff ? "assistant_unanswered" : "assistant_answer", { faq_id: ai.faq || "", lang: PA.code, ai: 1, ...(ai.handoff ? { question: text } : {}) });
          return;
        }
        const best = ranked[0];
        const second = ranked[1] ? ranked[1].s : 0;
        // Sicher: Score ≥ 3 – oder ≥ 2 mit deutlichem Abstand zum Zweitplatzierten
        const sure = best && (best.s >= 3 || (best.s >= 2 && best.s - second >= 1.5));
        const btn = (f) => `<button type="button" data-faq="${esc(f.id)}" data-lang="${esc(P.code)}">${esc(f.question)}</button>`;
        const country = forced ? null : findCountry(text);
        if (country && (!best || best.s < 6)) {
          const cp = priceOf("country:" + country.code);
          add(`${tx(P, "countryAnswer", { country: esc(country.name), price: cp != null ? tx(P, "countryPrice", { p: eur(cp) }) : "" })}<div class="msg__action"><button class="btn btn--green btn--sm" type="button" data-plans="${esc(country.code)}">${esc(tx(P, "plansFor", { country: country.name }))}</button></div>`, "bot", P);
        } else if (sure) {
          // Erst die hinterlegten nächsten Schritte (z. B. Roaming → Datenleitung → Netzwahl), dann ähnliche Fragen
          const steps = (best.f.next || []).map((id) => P.byId[id]).filter(Boolean);
          const related = [...steps, ...ranked.slice(1, 4).filter((r) => r.s >= 2).map((r) => r.f)].filter((f, i, a) => f.id !== best.f.id && a.findIndex((x) => x.id === f.id) === i).slice(0, 5);
          add(md(best.f.answer)
            + (related.length ? `<div class="msg__related">${related.map((f) => btn(f)).join("")}</div>` : "")
            + `<div class="msg__feedback">${esc(tx(P, "helpful"))} <button type="button" data-fb="yes">${esc(tx(P, "yes"))}</button><button type="button" data-fb="no">${esc(tx(P, "no"))}</button></div>`, "bot", P);
          track("assistant_answer", { faq_id: best.f.id, lang: P.code });
        } else {
          // Keine sichere Antwort: die naheliegendsten Fragen anbieten, bevor es zum Team geht
          const near = ranked.filter((r) => r.s >= 1).slice(0, 3);
          const fb = P.data.fallback || AI.fallback;
          add((near.length ? `${esc(tx(P, "didYouMean"))}<div class="msg__related">${near.map((r) => btn(r.f)).join("")}</div><p class="msg__else">${esc(fb)}</p>` : esc(fb))
            + `<div class="msg__action"><button class="btn btn--dark btn--sm" type="button" data-handoff>${icon("chat")} ${esc(tx(P, "talkTeam"))}</button></div>`, "bot", P);
          track("assistant_unanswered", { question: text, lang: P.code });
        }
      }, Math.max(0, 450 + Math.random() * 450 - (Date.now() - started))));
    }
    const ask = (text, forced, lang) => { add(esc(text), "user"); respond(text, forced, lang); };

    el.addEventListener("click", (e) => {
      // Frage aus der Leiste: Chat in den Blick holen, dann fragen
      const fromBand = e.target.closest(".qband");
      if (fromBand && e.target.closest("[data-faq], [data-suggest]")) $(".assistant", el).scrollIntoView({ behavior: "smooth", block: "center" });
      const f = e.target.closest("[data-faq]"); if (f) { const P = packOf(f.dataset.lang); const it = P.byId[f.dataset.faq]; if (it) setTimeout(() => ask(it.question, it, P.code), fromBand ? 350 : 0); return; }
      const p = e.target.closest("[data-plans]"); if (p) { openPlans(ESIM.countries.find((c) => c.code === p.dataset.plans)); return; }
      const s = e.target.closest("[data-suggest]"); if (s) { const q = s.dataset.suggest || s.textContent.trim(); setTimeout(() => ask(q), fromBand ? 350 : 0); return; }
      const fb = e.target.closest("[data-fb]");
      if (fb) { fb.parentElement.innerHTML = fb.dataset.fb === "yes" ? esc(t("thanksFeedback")) : `${esc(t("pity"))} <button type="button" data-handoff>${esc(t("talkTeam"))}</button>`; return; }
      if (e.target.closest("[data-handoff]")) { add(esc(t("talkTeam")), "user"); setTimeout(contact, 350); return; }
      const b = e.target.closest("[data-action]");
      if (b) {
        if (b.dataset.action === "device-check") return openDeviceCheck();
        if (/\.html|^https?:|^\//.test(b.dataset.action)) { location.href = b.dataset.action; return; }
        const it = HOME.byId[b.dataset.action];
        $(".assistant", el).scrollIntoView({ behavior: "smooth", block: "center" });
        if (it) setTimeout(() => ask(it.question, it), 350);
      }
    });
    $("#assistant-form", el).addEventListener("submit", (e) => { e.preventDefault(); const i = $("#assistant-input", el); const v = i.value.trim(); if (!v) return; i.value = ""; ask(v); });
    add(esc(AI.greeting));

    /* FAQ – automatisch nach Häufigkeit sortiert */
    const CATS = [["all", t("catAll")], ["esim", t("catEsim")], ["probleme", t("catTrouble")], ["lounge", t("catLounge")], ["fasttrack", t("catFasttrack")], ["zahlung", t("catPayment")], ["allgemein", t("catGeneral")]]
      .filter(([id]) => id === "all" || faqs.some((f) => f.category === id));
    const sorted = [...faqs].sort((a, b) => (b.views || 0) - (a.views || 0));
    const hot = new Set(sorted.slice(0, 3).map((f) => f.id));
    const FIRST = 4, STEP = 8;
    let cat = "all", shown = FIRST;
    const filters = $("#faq-filters", el), list = $("#faq-list", el);
    filters.innerHTML = CATS.map(([id, label], i) => `<button type="button" role="tab" data-cat="${id}" class="${i ? "" : "is-active"}" aria-selected="${!i}">${esc(label)}</button>`).join("");
    filters.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]"); if (!b) return;
      cat = b.dataset.cat; shown = FIRST;
      $$("button", filters).forEach((x) => { x.classList.toggle("is-active", x === b); x.setAttribute("aria-selected", x === b); });
      renderFaq();
    });
    function renderFaq() {
      const items = sorted.filter((f) => cat === "all" || f.category === cat);
      const limit = Math.min(shown, items.length), rest = items.length - limit;
      list.innerHTML = items.slice(0, limit).map((f) => `
        <div class="faq__item">
          <button class="faq__q" type="button" aria-expanded="false" aria-controls="faq-${esc(f.id)}"><span>${esc(f.question)}${hot.has(f.id) ? `<span class="faq__hot">${esc(t("hot"))}</span>` : ""}</span>${icon("plus")}</button>
          <div class="faq__a" id="faq-${esc(f.id)}"><div><div>${md(f.answer)}</div></div></div>
        </div>`).join("") + (rest > 0 || limit > FIRST ? `<div class="faq__more">${rest > 0 ? `<button class="btn btn--line" type="button" data-more>${esc(t("moreFaq", { n: rest }))}</button>` : ""}${limit > FIRST ? `<button class="faq__less" type="button" data-less>${esc(t("lessFaq"))}</button>` : ""}</div>` : "");
    }
    list.addEventListener("click", (e) => {
      if (e.target.closest("[data-more]")) { const n = shown; shown += STEP; renderFaq(); $$(".faq__q", list)[n]?.focus({ preventScroll: true }); return; }
      if (e.target.closest("[data-less]")) { shown = FIRST; renderFaq(); $("#faq", el).scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      const q = e.target.closest(".faq__q"); if (!q) return;
      const open = q.getAttribute("aria-expanded") !== "true";
      q.setAttribute("aria-expanded", open); q.nextElementSibling.classList.toggle("is-open", open);
    });
    renderFaq();
  }

  /* Analytics-Haken (GA4, Plausible …): unbeantwortete Fragen zeigen, was im Assistenten noch fehlt */
  function track(event, data) {
    window.dataLayer?.push({ event, ...data });
    if (event === "assistant_unanswered") {
      try { const k = "pp_unanswered"; const a = JSON.parse(localStorage.getItem(k) || "[]"); a.push({ ...data, at: Date.now() }); localStorage.setItem(k, JSON.stringify(a.slice(-100))); } catch (_) {}
      // An Supabase melden, damit das Team daraus neue FAQ-Einträge macht
      const url = SITE.api?.questionsUrl;
      if (url) fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: data.question, page: `${location.pathname} · ${LANG}` }), keepalive: true }).catch(() => {});
    }
  }

  // Sprung zu einem Anker nach dem Aufbau (z. B. /#faq)
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
