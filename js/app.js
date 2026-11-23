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
  const getJSON = (p) => fetch(p, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); });
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
  let SITE, ESIM, AI, BLOG, REVIEWS, INSTALL, UI, LANGS, LANG, LOCALE, CUR, RTL = false, PRICES = null;
  try {
    LANGS = await getJSON("content/languages.json");
    const params = new URLSearchParams(location.search);
    const store = (k, v) => { try { if (v) localStorage.setItem(k, v); return localStorage.getItem(k); } catch (_) { return null; } };
    const devLangs = navigator.languages?.length ? navigator.languages : [navigator.language || ""];
    // Sprache
    const codes = LANGS.languages.map((l) => l.code);
    const pick = (c) => { c = String(c || "").toLowerCase().split(/[-_]/)[0]; return codes.includes(c) ? c : null; };
    const fromUrl = pick(params.get("lang"));
    const savedLang = pick(store("pp_lang", fromUrl)); // Auswahl aus dem Umschalter merken
    LANG = fromUrl || savedLang || devLangs.map(pick).find(Boolean) || LANGS.default;
    const meta = LANGS.languages.find((l) => l.code === LANG);
    LOCALE = meta.locale || LANG;
    RTL = meta.dir === "rtl";
    document.documentElement.lang = LANG;
    document.documentElement.dir = meta.dir || "ltr";
    if (meta.font) {
      // Schrift mit arabischen Zeichen nachladen (Schibsted Grotesk hat keine)
      document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(meta.font)}:wght@400;500;600;700&display=swap">`);
      document.documentElement.style.setProperty("--font", `"${meta.font}", "Schibsted Grotesk", system-ui, sans-serif`);
    }
    // Währung: ?cur=… › gespeicherte Wahl › Land des Geräts › Standard der Sprache
    const curCodes = (LANGS.currencies || []).map((c) => c.code);
    const pickCur = (c) => { c = String(c || "").toUpperCase(); return curCodes.includes(c) ? c : null; };
    const curUrl = pickCur(params.get("cur"));
    const region = devLangs.map((l) => (String(l).split(/[-_]/)[1] || "").toUpperCase()).find(Boolean);
    const savedCur = pickCur(store("pp_cur", curUrl));
    CUR = curUrl || savedCur || pickCur(LANGS.regionCurrency?.[region]) || pickCur(meta.currency) || curCodes[0] || "EUR";
    const loc = (d) => d && merge(d[LANGS.default], d[LANG]);
    [SITE, ESIM, AI, BLOG, REVIEWS, UI, INSTALL] = (await Promise.all([
      ...["site", "esim", "assistant", "blog", "reviews", "ui"].map((n) => getJSON(`content/${n}.json`)),
      PAGE === "install" ? getJSON("content/install.json") : null,
    ])).map(loc);
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
  const payLogo = (slug) => `<img class="pay-logo pay-logo--${esc(slug)}" src="https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/${esc(slug)}.svg" alt="${esc(PAY[slug] || slug)}" title="${esc(PAY[slug] || slug)}" loading="lazy">`;
  /* Für Suche & Assistent: Kleinschreibung, ohne Akzente (ü→u, ş→s, ı→i …), nur Buchstaben/Ziffern */
  const norm = (s) => String(s).toLocaleLowerCase(LOCALE).replace(/ı/g, "i").replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ًͯ-ٰٟ]/g, "").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ё/g, "е").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
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
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    return s.trim().split(/\n{2,}/).map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
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
        <img class="hero__img" src="${img(c.image, 2200)}" alt="" fetchpriority="high" />
        <div class="hero__shade" aria-hidden="true"></div>
        <div class="container hero__content">
          <p class="kicker">${esc(c.kicker)}</p>
          <h1 class="hero__title">${fill(c.title)}<span>${fill(c.subtitle)}</span></h1>
          ${searchForm("search--hero", c.searchPlaceholder, c.searchButton)}
          <ul class="hero__facts">
            ${(c.facts || []).map((f) => `<li>${f.icon === "trustpilot" ? `<span class="tp-mini">${icon("star")}</span>` : icon(f.icon || "check")}${fill(f.text)}</li>`).join("")}
          </ul>
          ${(c.payments || []).length ? `<div class="hero__pay"><span>${esc(c.paymentsLabel || "")}</span>${c.payments.map(payLogo).join("")}</div>` : ""}
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
                  ${pop ? `<span class="dest__plan"><b>${esc(t("gbDays", { gb: pop.gb, days: pop.days }))}</b> ${esc(t("planFor", { p: eur(pop.price) }))} <em>${esc(t("popular"))}</em></span>` : ""}
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
                          <b>${g.gb} GB</b><span>${esc(t("days", { n: g.days }))}</span><strong>${eur(g.price)}</strong>
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
        if (g) { const p = plansOf("global")[+g.dataset.global]; if (p) toast(t("globalCheckout", { name: p.name || "Global", gb: p.gb })); }
      });
    },
  };

  /* ---------- WAS IST EINE eSIM ---------- */
  sections.howto = {
    render: (c = SITE.howto) => `
      <section class="section" id="howto">
        <div class="container how">
          <figure class="how__media">
            <img src="${img(c.image, 1100)}" alt="" loading="lazy" />
            ${c.imageCaption ? `<figcaption><span class="dot"></span> ${esc(c.imageCaption)}</figcaption>` : ""}
          </figure>
          <div class="how__body">
            <p class="kicker kicker--dark">${esc(c.kicker)}</p>
            <h2 class="h2">${esc(c.title)}</h2>
            <p class="lead">${esc(c.text)}</p>
            <ol class="how__steps">
              ${(c.steps || []).map((s, i) => `<li><span class="how__n">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div></li>`).join("")}
            </ol>
            <div class="how__actions">
              <button class="btn btn--dark" type="button" data-open-device-check>${icon("phone")} ${esc(c.button)}</button>
              ${c.guideLink ? `<a class="link-arrow" href="install.html">${esc(c.guideLink)} ${icon("arrow")}</a>` : ""}
            </div>
          </div>
        </div>
      </section>`,
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
              <article class="airport__card">
                <img src="${img(k.image, 1200)}" alt="" loading="lazy" />
                <div class="airport__body">
                  <h3>${esc(k.title)}</h3>
                  <p>${esc(k.text)}</p>
                  <ul class="ticks">${(k.ticks || []).map((t) => `<li>${icon("check")}${esc(t)}</li>`).join("")}</ul>
                  <div class="airport__foot"><span>${P(k.priceKey, t("priceFromPerson"))}</span><a href="#ap-from" class="btn btn--green btn--sm">${esc(k.button)}</a></div>
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
            <div class="airport-search__toggle" role="group" aria-label="${esc(t("product"))}"><label><input type="checkbox" checked /> ${esc(t("catLounge"))}</label><label><input type="checkbox" /> ${esc(t("catFasttrack"))}</label></div>
            <button class="btn btn--green" type="submit">${esc(c.searchButton)}</button>
          </form>
        </div>
      </section>`,
    init(el) {
      $("#ap-date", el).valueAsDate = new Date(Date.now() + 7 * 864e5);
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
  sections.assistant = {
    render: (c = SITE.assistant) => `
      <section class="section section--paper" id="assistant">
        <div class="container">
          <div class="head-split">
            <div><p class="kicker kicker--dark">${esc(c.kicker)}</p><h2 class="h2">${esc(c.title)}</h2></div>
            <p class="head-split__note">${esc(c.note)}</p>
          </div>
          <div class="banners">
            ${(AI.banners || []).map((b, i) => `
              <button class="banner banner--${i + 1}" type="button" data-action="${esc(b.action)}">
                <span class="banner__icon">${icon(b.icon || "chat")}</span>
                <span class="banner__go">${icon("arrow")}</span>
                <h3>${esc(b.title)}</h3>
                <p>${esc(b.text)}</p>
              </button>`).join("")}
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
            <div class="assistant__chips">${(AI.suggestions || []).map((s) => `<button type="button" data-suggest>${esc(s)}</button>`).join("")}</div>
            <form class="assistant__form" id="assistant-form" autocomplete="off">
              <input type="text" id="assistant-input" placeholder="${esc(t("askPlaceholder"))}" aria-label="${esc(t("askLabel"))}" />
              <button type="submit" class="assistant__send" aria-label="${esc(t("send"))}">${icon("send")}</button>
            </form>
          </div>
          </div>
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
              <a class="post ${i === 0 ? "post--lead" : ""}" href="${esc(p.url || "#")}">
                <div class="post__img"><img src="${img(p.image, i === 0 ? 1200 : 700)}" alt="" loading="lazy"></div>
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
          <form class="cta__form" data-newsletter>
            <input type="email" required placeholder="${esc(c.placeholder)}" aria-label="${esc(t("emailLabel"))}" />
            <button class="btn btn--green" type="submit">${esc(c.button)}</button>
          </form>
        </div>
      </section>`,
    init(el) {
      $("[data-newsletter]", el).addEventListener("submit", (e) => { e.preventDefault(); e.currentTarget.outerHTML = `<p class="cta__ok">${esc(SITE.newsletter.success)}</p>`; });
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
            <div class="guide-steps" data-panel="${esc(p.id)}" ${pi === 0 ? "" : "hidden"} role="tabpanel">
              ${(p.steps || []).map((st, i) => `
                <article class="gstep">
                  ${phoneScreen(st.screen)}
                  <div class="gstep__body">
                    <span class="gstep__n">${esc(t("stepOf", { i: i + 1, n: p.steps.length }))}</span>
                    <h3>${esc(st.title)}</h3>
                    <div class="gstep__text">${md(st.text)}</div>
                    ${st.tip ? `<div class="gstep__tip">${icon("bulb")}<div>${md(st.tip)}</div></div>` : ""}
                  </div>
                </article>`).join("")}
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
      const pick = (id) => {
        tabs.forEach((t) => { const on = t.dataset.platform === id; t.classList.toggle("is-active", on); t.setAttribute("aria-selected", on); });
        $$("[data-panel]", el).forEach((p) => (p.hidden = p.dataset.panel !== id));
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
  document.title = t(PAGE === "install" ? "installMetaTitle" : "metaTitle");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("metaDescription"));
  const prefUrl = (k, v) => { const u = new URL(location.href); v ? u.searchParams.set(k, v) : u.searchParams.delete(k); return u.pathname + u.search + u.hash; };
  const langUrl = (code) => prefUrl("lang", code);
  // Angezeigte Währung = die, in der die Schnittstelle tatsächlich geliefert hat
  const SHOWN_CUR = PRICES?.currency || CUR;
  const curSymbol = SYM;
  const curName = (c) => { try { const n = new Intl.DisplayNames([LOCALE], { type: "currency" }).of(c.code); return n ? n.charAt(0).toLocaleUpperCase(LOCALE) + n.slice(1) : c.name; } catch (_) { return c.name; } };
  const cleanUrl = (code) => location.origin + location.pathname + (code ? `?lang=${code}` : "");
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
  $("#nav").innerHTML = `
    <div class="nav__inner container">
      <a href="index.html" class="logo" aria-label="${esc(t("home"))}"><svg class="logo__mark"><use href="#i-pass"/></svg>${brand}</a>
      <nav class="nav__links" aria-label="${esc(t("mainNav"))}">
        ${(SITE.nav || []).map((n) => `<a href="${esc(href(n.url))}">${esc(n.label)}${n.badge ? ` <small>${esc(n.badge)}</small>` : ""}</a>`).join("")}
      </nav>
      <div class="nav__actions">
        <div class="lang">
          <button class="nav__locale" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${esc(t("language"))} / ${esc(t("currency"))}">${icon("globe")}<span>${esc(LANG.toUpperCase())} · ${esc(SHOWN_CUR)}</span></button>
          <div class="lang__menu" hidden>
            <div class="lang__group">
              <p class="lang__title">${esc(t("language"))}</p>
              <ul>${LANGS.languages.map((l) => `<li><a href="${esc(prefUrl("lang", l.code))}" hreflang="${esc(l.code)}" lang="${esc(l.code)}" aria-current="${l.code === LANG}"><span dir="${esc(l.dir || "ltr")}">${esc(l.name)}</span> <small>${esc(l.code.toUpperCase())}</small></a></li>`).join("")}</ul>
            </div>
            <div class="lang__group">
              <p class="lang__title">${esc(t("currency"))}</p>
              <ul>${(LANGS.currencies || []).map((c) => `<li><a href="${esc(prefUrl("cur", c.code))}" aria-current="${c.code === SHOWN_CUR}"><span><b class="lang__sym">${esc(curSymbol(c.code))}</b> ${esc(curName(c))}</span> <small>${esc(c.code)}</small></a></li>`).join("")}</ul>
            </div>
          </div>
        </div>
        <a href="#" class="nav__login">${esc(t("login"))}</a>
        <button class="nav__burger" type="button" aria-label="${esc(t("menuOpen"))}" aria-expanded="false">${icon("menu")}</button>
      </div>
    </div>`;
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
  const active = PAGE === "install"
    ? [{ type: "installGuide" }]
    : (SITE.sections || []).filter((s) => s.enabled !== false && sections[s.type]);
  page.innerHTML = active.map((s) => sections[s.type].render()).join("");
  active.forEach((s, i) => sections[s.type].init?.(page.children[i]));

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
    const plans = [...plansOf(item.code ? "country:" + item.code : "region:" + item.id)].sort((a, b) => a.price - b.price);
    const pre = Math.max(0, plans.findIndex((p) => p.popular));
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal__backdrop" data-close-modal></div>
      <div class="modal__panel modal__panel--plans" role="dialog" aria-modal="true" aria-label="${esc(t("plansAria", { name: item.name }))}">
        <button class="modal__close icon-btn" type="button" data-close-modal aria-label="${esc(t("close"))}">${icon("x")}</button>
        <div class="modal__hero">
          ${item.image ? `<img src="${img(item.image, 1000, 340)}" alt="">` : ""}
          <h3>${item.code ? `<img class="dest__flag" src="${flag(item.code)}" alt="">` : ""}${esc(item.name)}</h3>
        </div>
        <p class="modal__lead">${item.countries ? esc(t("modalCountries", { n: item.countries })) : ""}${esc(t("modalLead"))}</p>
        ${plans.length ? `<div class="plan-list" role="radiogroup" aria-label="${esc(t("dataVolume"))}">
          ${plans.map((p, i) => `
            <label class="plan ${i === pre ? "is-active" : ""}">
              <input type="radio" name="plan" value="${i}" ${i === pre ? "checked" : ""}>
              <span class="plan__gb">${p.gb} GB</span><span class="plan__days">${esc(t("days", { n: p.days }))}</span>
              ${p.popular ? `<span class="plan__pop">${esc(t("popular"))}</span>` : ""}
              <span class="plan__price">${eur(p.price)}</span>
            </label>`).join("")}
        </div>
        <button class="btn btn--dark plan-buy" type="button" style="width:100%;margin-top:18px">${esc(t("checkout"))} · <span>${eur(plans[pre].price)}</span></button>
        <p class="plan-note">${icon("shield")} ${esc(t("moneyBack"))}</p>`
        : `<div class="device-result__none">${esc(SITE.api?.modalUnavailableText || t("modalUnavailable"))}</div>`}
      </div>`;
    document.body.appendChild(modal);
    document.body.style.overflow = "hidden";
    const close = () => { modal.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    modal.addEventListener("click", (e) => { if (e.target.closest("[data-close-modal]")) close(); });
    modal.addEventListener("change", (e) => {
      if (e.target.name !== "plan") return;
      $$(".plan", modal).forEach((l) => l.classList.toggle("is-active", l.contains(e.target)));
      $(".plan-buy span", modal).textContent = eur(plans[+e.target.value].price);
    });
    $(".plan-buy", modal)?.addEventListener("click", () => { close(); toast(t("checkoutToast", { name: item.name })); });
    $("input:checked", modal)?.focus();
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
    const terms = q.split(" ");
    const hits = (AI.devices || []).filter((d) => terms.every((t) => norm(d).includes(t))).slice(0, 12);
    out.innerHTML = hits.length
      ? `<ul class="device-result__list">${hits.map((d) => `<li>${icon("check")}<span>${t("deviceOk", { d: esc(d) })}</span></li>`).join("")}</ul>`
      : `<div class="device-result__none">${t("deviceNone", { q: esc(e.target.value) })}</div>`;
  });
  }

  /* ---------- Assistent ---------- */
  function initAssistant(el) {
    const log = $("#assistant-log", el);
    const faqs = AI.faqs || [];
    const byId = Object.fromEntries(faqs.map((f) => [f.id, f]));

    const add = (html, who = "bot") => { const m = document.createElement("div"); m.className = `msg msg--${who}`; m.innerHTML = html; log.appendChild(m); log.scrollTop = log.scrollHeight; return m; };
    const typing = () => { const t = add(`<span class="typing"><span></span><span></span><span></span></span>`); t.style.padding = "0"; return t; };

    const rank = (text) => {
      const q = " " + norm(text) + " ";
      const tokens = q.trim().split(" ").filter((w) => w.length > 3);
      return faqs.map((f) => {
        let s = 0;
        (f.keywords || []).forEach((k) => { const nk = norm(k); if (nk && (q.includes(" " + nk) || q.includes(nk + " "))) s += 2 + nk.split(" ").length; });
        const fq = norm(f.question).split(" ");
        tokens.forEach((t) => { if (fq.some((w) => w.length > 3 && (w.startsWith(t) || t.startsWith(w)))) s += 1; });
        return { f, s };
      }).sort((a, b) => b.s - a.s);
    };
    // Land in der Frage erkennen – in jeder unterstützten Sprache („Mısır'da“, „in Ägypten“, „in Egypt“)
    const findCountry = (text) => { const q = " " + norm(text) + " "; return ESIM.countries.find((c) => (c.names || [norm(c.name)]).some((n) => n.length > 2 && q.includes(" " + n + " "))); };

    const contact = () => add(`${esc(AI.contactText)}<div class="msg__action"><a class="btn btn--dark btn--sm" href="mailto:${esc(AI.contactEmail)}">${icon("mail")} ${esc(t("writeEmail"))}</a></div>`);

    function respond(text, forced) {
      const dots = typing();
      setTimeout(() => {
        dots.remove();
        const ranked = forced ? [{ f: forced, s: 99 }] : rank(text);
        const best = ranked[0];
        const country = forced ? null : findCountry(text);
        if (country && (!best || best.s < 6)) {
          const cp = priceOf("country:" + country.code);
          add(`${t("countryAnswer", { country: esc(country.name), price: cp != null ? t("countryPrice", { p: eur(cp) }) : "" })}<div class="msg__action"><button class="btn btn--green btn--sm" type="button" data-plans="${esc(country.code)}">${esc(t("plansFor", { country: country.name }))}</button></div>`);
        } else if (best && best.s >= 3) {
          const related = ranked.slice(1, 4).filter((r) => r.s >= 2);
          add(md(best.f.answer)
            + (related.length ? `<div class="msg__related">${related.map((r) => `<button type="button" data-faq="${esc(r.f.id)}">${esc(r.f.question)}</button>`).join("")}</div>` : "")
            + `<div class="msg__feedback">${esc(t("helpful"))} <button type="button" data-fb="yes">${esc(t("yes"))}</button><button type="button" data-fb="no">${esc(t("no"))}</button></div>`);
          track("assistant_answer", { faq_id: best.f.id });
        } else {
          add(`${esc(AI.fallback)}<div class="msg__action"><button class="btn btn--dark btn--sm" type="button" data-handoff>${icon("chat")} ${esc(t("talkTeam"))}</button></div>`);
          track("assistant_unanswered", { question: text });
        }
      }, 450 + Math.random() * 450);
    }
    const ask = (text, forced) => { add(esc(text), "user"); respond(text, forced); };

    el.addEventListener("click", (e) => {
      const f = e.target.closest("[data-faq]"); if (f) { const it = byId[f.dataset.faq]; ask(it.question, it); return; }
      const p = e.target.closest("[data-plans]"); if (p) { openPlans(ESIM.countries.find((c) => c.code === p.dataset.plans)); return; }
      const s = e.target.closest("[data-suggest]"); if (s) { ask(s.textContent); return; }
      const fb = e.target.closest("[data-fb]");
      if (fb) { fb.parentElement.innerHTML = fb.dataset.fb === "yes" ? esc(t("thanksFeedback")) : `${esc(t("pity"))} <button type="button" data-handoff>${esc(t("talkTeam"))}</button>`; return; }
      if (e.target.closest("[data-handoff]")) { add(esc(t("talkTeam")), "user"); setTimeout(contact, 350); return; }
      const b = e.target.closest("[data-action]");
      if (b) {
        if (b.dataset.action === "device-check") return openDeviceCheck();
        if (/\.html|^https?:|^\//.test(b.dataset.action)) { location.href = b.dataset.action; return; }
        const it = byId[b.dataset.action];
        $(".assistant", el).scrollIntoView({ behavior: "smooth", block: "center" });
        if (it) setTimeout(() => ask(it.question, it), 350);
      }
    });
    $("#assistant-form", el).addEventListener("submit", (e) => { e.preventDefault(); const i = $("#assistant-input", el); const v = i.value.trim(); if (!v) return; i.value = ""; ask(v); });
    add(esc(AI.greeting));

    /* FAQ – automatisch nach Häufigkeit sortiert */
    const CATS = [["all", t("catAll")], ["esim", t("catEsim")], ["lounge", t("catLounge")], ["fasttrack", t("catFasttrack")], ["zahlung", t("catPayment")], ["allgemein", t("catGeneral")]]
      .filter(([id]) => id === "all" || faqs.some((f) => f.category === id));
    const sorted = [...faqs].sort((a, b) => (b.views || 0) - (a.views || 0));
    const hot = new Set(sorted.slice(0, 3).map((f) => f.id));
    let cat = "all", expanded = false;
    const filters = $("#faq-filters", el), list = $("#faq-list", el);
    filters.innerHTML = CATS.map(([id, label], i) => `<button type="button" role="tab" data-cat="${id}" class="${i ? "" : "is-active"}" aria-selected="${!i}">${esc(label)}</button>`).join("");
    filters.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]"); if (!b) return;
      cat = b.dataset.cat; expanded = false;
      $$("button", filters).forEach((x) => { x.classList.toggle("is-active", x === b); x.setAttribute("aria-selected", x === b); });
      renderFaq();
    });
    function renderFaq() {
      const items = sorted.filter((f) => cat === "all" || f.category === cat);
      const limit = cat === "all" && !expanded ? 8 : items.length;
      list.innerHTML = items.slice(0, limit).map((f) => `
        <div class="faq__item">
          <button class="faq__q" type="button" aria-expanded="false" aria-controls="faq-${esc(f.id)}"><span>${esc(f.question)}${hot.has(f.id) ? `<span class="faq__hot">${esc(t("hot"))}</span>` : ""}</span>${icon("plus")}</button>
          <div class="faq__a" id="faq-${esc(f.id)}"><div><div>${md(f.answer)}</div></div></div>
        </div>`).join("") + (items.length > limit ? `<div class="faq__more"><button class="btn btn--line" type="button" data-more>${esc(t("showAll", { n: items.length }))}</button></div>` : "");
    }
    list.addEventListener("click", (e) => {
      if (e.target.closest("[data-more]")) { expanded = true; renderFaq(); return; }
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
