/* ==========================================================================
   passport.io – Mağaza editörü (Shopify-artig)
   --------------------------------------------------------------------------
   Links:  Abschnitte der Startseite (sortieren, ein-/ausblenden) + weitere Inhalte
   Mitte:  Live-Vorschau der echten Seite (Entwurf, noch nicht veröffentlicht)
   Rechts: Einstellungen des gewählten Abschnitts – automatisch aus admin/config.yml erzeugt
   Speichern: über die Admin-Funktion nach GitHub (Secret GITHUB_CONTENT_TOKEN) → automatisch veröffentlicht.
   Sprachen: Türkisch ist die Hauptsprache (alle Felder); andere Sprachen nur die Texte.
   ========================================================================== */
(() => {
  "use strict";
  const LANGS = [["tr", "Türkçe"], ["en", "English"], ["de", "Deutsch"], ["ar", "العربية"], ["ru", "Русский"], ["fr", "Français"], ["es", "Español"], ["it", "Italiano"], ["pt", "Português"], ["nl", "Nederlands"], ["pl", "Polski"], ["ja", "日本語"], ["ko", "한국어"]];
  const TEXT_WIDGETS = new Set(["string", "text", "markdown"]);
  const KEYF = (o) => (o && typeof o === "object" ? (o.id !== undefined ? "id" : o.code !== undefined ? "code" : null) : null);
  const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
  const loadScript = (src) => new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });

  let ctx, root, schema, files = [], state = null;

  /* ---------- Schema aus admin/config.yml ---------- */
  async function loadSchema() {
    if (!window.jsyaml) await loadScript("../vendor/js/js-yaml.min.js");
    const cfg = window.jsyaml.load(await fetch("config.yml", { cache: "no-cache" }).then((r) => r.text()));
    files = [];
    for (const col of cfg.collections || []) {
      for (const f of col.files || []) files.push({ id: f.file, label: f.label, group: col.label, fields: f.fields || [], file: f.file });
      if (col.folder) files.push({ id: "folder:" + col.name, label: col.label, group: col.label, fields: col.fields || [], folder: col.folder });
    }
    return cfg;
  }

  /* ---------- Werte lesen/schreiben (Pfad = Liste aus Schlüsseln und Indizes) ---------- */
  function getAt(obj, path) { let o = obj; for (const p of path) { if (o == null) return undefined; o = o[p]; } return o; }
  // Für Fremdsprachen: Listen-Elemente mit id/code über den Schlüssel finden (so mischt die Seite die Sprachen)
  function resolvePath(lang, path) {
    if (lang === "tr") return path;
    const base = state.data.tr, out = [];
    let b = base, o = state.data[lang] ?? {};
    for (const p of path) {
      if (typeof p === "number" && Array.isArray(b)) {
        const kf = KEYF(b[p]);
        if (kf && Array.isArray(o)) { const j = o.findIndex((x) => x && x[kf] === b[p][kf]); out.push(j >= 0 ? j : { newKey: kf, val: b[p][kf] }); o = j >= 0 ? o[j] : undefined; }
        else { out.push(p); o = Array.isArray(o) ? o[p] : undefined; }
        b = b[p];
      } else { out.push(p); b = b?.[p]; o = o?.[p]; }
    }
    return out;
  }
  function readVal(path) {
    if (state.lang === "tr") return getAt(state.data.tr, path);
    const rp = resolvePath(state.lang, path);
    if (rp.some((x) => typeof x === "object")) return undefined;
    return getAt(state.data[state.lang], rp);
  }
  function writeVal(path, value) {
    const lang = state.lang;
    state.data[lang] ??= {};
    let o = state.data[lang], b = state.data.tr;
    const rp = resolvePath(lang, path);
    for (let i = 0; i < rp.length - 1; i++) {
      let p = rp[i]; const next = rp[i + 1];
      if (typeof p === "object") { // neues Element in einer Fremdsprachen-Liste mit Schlüssel
        o.push({ [p.newKey]: p.val }); p = o.length - 1;
      }
      if (o[p] == null) o[p] = (typeof next === "number" || (typeof next === "object" && next)) ? [] : {};
      if (lang !== "tr" && Array.isArray(o[p]) === false && typeof next === "number" && Array.isArray(b?.[path[i]])) o[p] = [];
      o = o[p]; b = b?.[path[i]];
    }
    const last = rp[rp.length - 1];
    if (typeof last === "object") o.push({ [last.newKey]: last.val }); else o[last] = value;
    markDirty();
  }

  /* ---------- Formular aus Felddefinitionen ---------- */
  const esc = (s) => ctx.esc(s);
  const fid = () => "f" + Math.random().toString(36).slice(2, 9);
  function fieldHtml(f, path) {
    const w = f.widget || "string";
    if (w === "hidden") return "";
    const val = readVal(path);
    const isTr = state.lang === "tr";
    const trVal = !isTr ? getAt(state.data.tr, path) : undefined;
    // Fremdsprache: nur Texte; Listen/Objekte nur, wenn sie Texte enthalten
    if (!isTr && !TEXT_WIDGETS.has(w) && w !== "object" && w !== "list") return "";
    const label = `${esc(f.label || f.name)}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}`;
    const id = fid(), dp = esc(JSON.stringify(path));
    if (w === "object") {
      const inner = (f.fields || []).map((sf) => fieldHtml(sf, [...path, sf.name])).join("");
      if (!inner.trim()) return "";
      return `<details class="ed-obj" ${f.collapsed ? "" : "open"}><summary>${esc(f.label || f.name)}</summary><div class="ed-fields">${inner}</div></details>`;
    }
    if (w === "list") {
      const items = isTr ? (Array.isArray(val) ? val : []) : (Array.isArray(trVal) ? trVal : []);
      if (!f.fields && !f.field) {
        if (!isTr) return "";
        return `<label class="pl-field" for="${id}">${label}<textarea id="${id}" data-path="${dp}" data-kind="strlist" rows="3">${esc(items.join("\n"))}</textarea><small>Her satıra bir değer</small></label>`;
      }
      const sub = f.fields || [f.field];
      const rows = items.map((it, i) => {
        const inner = sub.map((sf) => fieldHtml(sf, f.field ? [...path, i] : [...path, i, sf.name])).join("");
        if (!inner.trim()) return "";
        const title = itemTitle(f, it, i);
        return `<details class="ed-item"><summary><span>${esc(title)}</span>${isTr ? `<button type="button" data-move="-1" data-list="${dp}" data-i="${i}" title="Yukarı">↑</button><button type="button" data-move="1" data-list="${dp}" data-i="${i}" title="Aşağı">↓</button><button type="button" data-del data-list="${dp}" data-i="${i}" title="Sil">✕</button>` : ""}</summary><div class="ed-fields">${inner}</div></details>`;
      }).join("");
      if (!isTr && !rows.trim()) return "";
      return `<details class="ed-obj" ${f.collapsed ? "" : "open"}><summary>${esc(f.label || f.name)} <small class="pl-note">(${items.length})</small></summary><div class="ed-list">${rows}</div>${isTr ? `<button type="button" class="pl-btn pl-btn--sm" data-add data-list="${dp}">+ ${esc(f.label_singular || "Öğe")} ekle</button>` : ""}</details>`;
    }
    if (w === "boolean") return `<label class="ed-toggle"><span>${label}</span><input type="checkbox" data-path="${dp}" data-kind="bool" ${val === true || (val === undefined && f.default === true) ? "checked" : ""}></label>`;
    if (w === "select") {
      const opts = (f.options || []).map((o) => (typeof o === "object" ? o : { label: o, value: o }));
      return `<label class="pl-field" for="${id}">${label}<select id="${id}" data-path="${dp}">${opts.map((o) => `<option value="${esc(o.value)}" ${String(val ?? f.default ?? "") === String(o.value) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`;
    }
    if (w === "color") return `<label class="pl-field" for="${id}">${label}<input id="${id}" type="color" data-path="${dp}" value="${esc(val || f.default || "#2ef58a")}"></label>`;
    if (w === "number") return `<label class="pl-field" for="${id}">${label}<input id="${id}" type="number" step="any" data-path="${dp}" data-kind="num" value="${esc(val ?? "")}"></label>`;
    if (w === "image" || w === "file") {
      const src = imgSrc(val);
      return `<div class="pl-field">${label}<div class="ed-img"><img src="${esc(src)}" alt="" data-imgprev="${dp}" onerror="this.style.visibility='hidden'"><div><input type="text" data-path="${dp}" data-kind="img" value="${esc(val || "")}" placeholder="https://… veya yükle"><div class="ed-img__btns"><button type="button" class="pl-btn pl-btn--sm" data-upload="${dp}">Görsel yükle</button></div></div></div></div>`;
    }
    const ph = !isTr && trVal ? ` placeholder="${esc(String(trVal).slice(0, 120))}"` : "";
    if (w === "text" || w === "markdown") return `<label class="pl-field" for="${id}">${label}<textarea id="${id}" data-path="${dp}" rows="${w === "markdown" ? 8 : 4}"${ph}>${esc(val ?? "")}</textarea></label>`;
    return `<label class="pl-field" for="${id}">${label}<input id="${id}" type="text" data-path="${dp}" value="${esc(val ?? "")}"${ph}></label>`;
  }
  function itemTitle(f, it, i) {
    if (it && typeof it === "object") {
      if (f.summary) { const t = f.summary.replace(/\{\{\s*fields\.(\w+)\s*\}\}/g, (_, k) => it[k] ?? ""); if (t.trim()) return t; }
      const k = ["title", "name", "label", "q", "question", "text", "type", "code", "id"].find((x) => typeof it[x] === "string" && it[x].trim());
      if (k) return String(it[k]).slice(0, 60);
    } else if (typeof it === "string" && it.trim()) return it.slice(0, 60);
    return `${f.label_singular || f.label || "Öğe"} ${i + 1}`;
  }
  const uploaded = {}; // frisch hochgeladene Bilder (bis zur Veröffentlichung lokal anzeigen)
  const imgSrc = (v) => !v ? "" : uploaded[v] || (/^https?:|^data:/.test(v) ? v : "../" + String(v).replace(/^\//, ""));

  /* ---------- Startseite: Abschnitte ---------- */
  const SECTION_LABELS = { hero: "Giriş görseli (hero)", destinations: "Popüler destinasyonlar", packages: "Bölgesel & global paketler", howto: "eSIM nedir? (3 adım)", airport: "Lounge & Fast Track", reviews: "Değerlendirmeler", assistant: "Dijital asistan & SSS", blog: "Dergi / blog", newsletter: "Bülten" };
  const GENERAL = [["theme", "Marka renkleri"], ["brand", "Marka"], ["announcement", "Duyuru çubuğu"], ["nav", "Menü"], ["footer", "Alt bilgi"], ["preview", "Önizleme notu"], ["api", "Fiyat arayüzü"]];
  const siteField = (name) => state.file.fields.find((f) => f.name === name);

  function leftHtml() {
    const tabs = `<div class="ed-tabs"><button type="button" data-ltab="home" class="${state.ltab === "home" ? "is-active" : ""}">Ana sayfa</button><button type="button" data-ltab="files" class="${state.ltab === "files" ? "is-active" : ""}">Tüm içerikler</button></div>`;
    if (state.ltab === "files") {
      const groups = {};
      files.filter((f) => !f.folder).forEach((f) => (groups[f.group] ??= []).push(f));
      return tabs + `<div class="ed-files">${Object.entries(groups).map(([g, list]) => `<h3>${esc(g)}</h3>${list.map((f) => `<div class="ed-sec ${state.file?.id === f.id ? "is-active" : ""}" data-file="${esc(f.id)}"><span>${esc(f.label)}</span></div>`).join("")}`).join("")}
        ${state.posts?.length ? `<h3>Blog yazıları</h3>${state.posts.map((p) => `<div class="ed-sec ${state.file?.id === "content/posts/" + p.id + ".json" ? "is-active" : ""}" data-post="${esc(p.id)}"><span>${esc(p.title || p.id)}</span></div>`).join("")}` : ""}</div>`;
    }
    if (state.file?.id !== "content/site.json" || !state.data?.tr) return tabs + `<p class="ed-empty">Ana sayfa yükleniyor …</p>`;
    const secs = state.data.tr.sections || [];
    return tabs + `<h3>Bölümler <small class="pl-note">(sürükle veya ↑↓)</small></h3>
      <div data-seclist>${secs.map((s, i) => `<div class="ed-sec ${s.enabled === false ? "is-off" : ""} ${state.sel === s.type ? "is-active" : ""}" draggable="true" data-sec="${esc(s.type)}" data-i="${i}">
        <span class="ed-grip">⋮⋮</span><span>${esc(SECTION_LABELS[s.type] || s.type)}</span>
        <button type="button" data-secmove="-1" data-i="${i}" title="Yukarı">↑</button><button type="button" data-secmove="1" data-i="${i}" title="Aşağı">↓</button>
        <button type="button" data-eye data-i="${i}" title="${s.enabled === false ? "Göster" : "Gizle"}">${s.enabled === false ? "◌" : "◉"}</button></div>`).join("")}</div>
      <h3>Genel ayarlar</h3>${GENERAL.filter(([k]) => siteField(k)).map(([k, l]) => `<div class="ed-sec ${state.sel === k ? "is-active" : ""}" data-sec="${k}"><span>${esc(l)}</span></div>`).join("")}`;
  }
  function rightHtml() {
    if (!state.file) return `<p class="ed-empty">Soldan bir bölüm seç.</p>`;
    const warn = state.readonly ? `<div class="ed-warn">Kaydetme kapalı: Supabase'de <b>GITHUB_CONTENT_TOKEN</b> secret'ı yok. Değişiklikleri önizlemede görebilirsin ama yayınlayamazsın.</div>` : "";
    const langNote = state.lang !== "tr" ? `<div class="ed-warn" style="background:rgba(106,168,255,.1);color:#9cc4ff">${esc(LANGS.find((l) => l[0] === state.lang)[1])}: yalnızca metinler. Boş alanlarda Türkçe metin gösterilir.</div>` : "";
    let fields = state.file.fields;
    let title = state.file.label;
    if (state.file.id === "content/site.json") {
      const f = siteField(state.sel);
      if (!f) return warn + `<p class="ed-empty">Soldan bir bölüm seç.</p>`;
      fields = [{ ...f, collapsed: false }]; title = SECTION_LABELS[state.sel] || GENERAL.find((g) => g[0] === state.sel)?.[1] || f.label;
      const inner = f.widget === "object" ? (f.fields || []).map((sf) => fieldHtml(sf, [f.name, sf.name])).join("") : fieldHtml(f, [f.name]);
      return `${warn}${langNote}<h3>${esc(title)}</h3><div class="ed-fields">${inner || `<p class="ed-empty">Bu bölümde bu dilde metin yok.</p>`}</div>`;
    }
    const inner = fields.map((f) => fieldHtml(f, [f.name])).join("");
    return `${warn}${langNote}<h3>${esc(title)}</h3><div class="ed-fields">${inner || `<p class="ed-empty">Bu dilde düzenlenecek metin yok.</p>`}</div>`;
  }

  /* ---------- Vorschau ---------- */
  function previewUrl() {
    const id = state.file?.id || "";
    const page = id.includes("install") ? "install.html" : id.includes("pages") ? "page.html" : id.includes("account") ? "account.html" : id.startsWith("content/posts/") ? `blog.html?p=${id.split("/").pop().replace(".json", "")}&` : "index.html";
    return `../${page}${page.includes("?") ? "" : "?"}editor=1&lang=${state.lang}`;
  }
  let reloadT = null;
  function writeDraft() { try { sessionStorage.setItem("pp_draft:" + state.file.id, JSON.stringify(state.data)); } catch (_) {} }
  function reloadPreview(keepScroll = true) {
    clearTimeout(reloadT);
    reloadT = setTimeout(() => {
      const fr = root.querySelector(".ed-frame"); if (!fr) return;
      let y = 0; try { y = fr.contentWindow.scrollY; } catch (_) {}
      fr.onload = () => { try { if (keepScroll) fr.contentWindow.scrollTo(0, y); } catch (_) {} };
      const want = previewUrl();
      if (!fr.src.endsWith(want.replace("../", ""))) fr.src = want; else fr.contentWindow.location.reload();
    }, 450);
  }
  function scrollPreviewTo(type) {
    const fr = root.querySelector(".ed-frame");
    try {
      const doc = fr.contentDocument, secs = (state.data.tr.sections || []).filter((s) => s.enabled !== false);
      const idx = secs.findIndex((s) => s.type === type);
      const el = idx >= 0 ? doc.querySelector("#page")?.children[idx] : null;
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (_) {}
  }

  /* ---------- Zustand ---------- */
  function markDirty() {
    state.dirty = true; writeDraft(); reloadPreview();
    const st = root.querySelector(".ed-status"); if (st) { st.textContent = "Kaydedilmemiş değişiklikler"; st.className = "ed-status dirty"; }
    const sv = root.querySelector("[data-save]"); if (sv) sv.disabled = state.readonly;
  }
  async function openFile(id, sel) {
    if (state.dirty && state.file && state.file.id !== id) { if (!(await confirmLeave())) return; }
    const meta = id.startsWith("content/posts/") ? { ...files.find((f) => f.folder), id, file: id, label: "Blog yazısı" } : files.find((f) => f.id === id);
    state.file = meta; state.sel = sel || (id === "content/site.json" ? "hero" : null); state.dirty = false; state.data = null;
    renderAll(true);
    let data = null, sha = null, ro = false;
    try { const r = await ctx.api("POST", "", { action: "content_get", file: id }); data = r.data; sha = r.sha; }
    catch (err) { if (err.message === "github_missing" || err.status === 409) ro = true; else ctx.toast("GitHub'dan yüklenemedi – yayındaki içerik açıldı."); }
    if (!data) { try { data = await fetch("../" + id, { cache: "no-cache" }).then((r) => r.json()); } catch (_) { data = {}; } }
    // Blog-Artikel liegen ohne Sprachebene? Sicherstellen, dass es eine tr-Ebene gibt
    if (!data.tr) data = { tr: data };
    state.data = data; state.sha = sha; state.readonly = ro;
    try { sessionStorage.removeItem("pp_draft:" + id); } catch (_) {}
    renderAll(false);
  }
  const confirmLeave = () => new Promise((ok) => {
    const st = root.querySelector(".ed-status");
    if (st) { st.innerHTML = `Kaydedilmemiş değişiklikler kaybolacak. <button type="button" class="pl-btn pl-btn--sm" data-leave="1">Devam</button> <button type="button" class="pl-btn pl-btn--sm" data-leave="0">Vazgeç</button>`; st.className = "ed-status dirty"; }
    const h = (e) => { const b = e.target.closest("[data-leave]"); if (!b) return; root.removeEventListener("click", h, true); ok(b.dataset.leave === "1"); };
    root.addEventListener("click", h, true);
  });
  async function save() {
    if (state.readonly || !state.dirty) return;
    const btn = root.querySelector("[data-save]"); btn.disabled = true; btn.textContent = "Kaydediliyor …";
    try {
      const r = await ctx.api("POST", "", { action: "content_put", file: state.file.id, data: state.data, sha: state.sha });
      state.sha = r.sha; state.dirty = false;
      const st = root.querySelector(".ed-status"); st.textContent = "Kaydedildi · 1–2 dakika içinde yayında"; st.className = "ed-status ok";
      ctx.toast("Kaydedildi. Site birkaç dakika içinde güncellenir.");
    } catch (err) {
      ctx.toast(err.message === "conflict" ? "Bu içerik bu arada başka biri tarafından değiştirildi. Sayfayı yeniden aç." : "Kaydedilemedi: " + err.message);
      btn.disabled = false;
    }
    btn.textContent = "Kaydet";
  }

  /* ---------- Rendern ---------- */
  function renderAll(loadingNow) {
    root.querySelector(".ed-left").innerHTML = leftHtml();
    root.querySelector(".ed-right").innerHTML = loadingNow || !state.data ? `<p class="pl-loading">Yükleniyor …</p>` : rightHtml();
    const st = root.querySelector(".ed-status");
    if (st && !state.dirty) { st.textContent = state.readonly ? "Salt okunur" : state.sha ? "Yayındaki sürüm" : ""; st.className = "ed-status"; }
    const sv = root.querySelector("[data-save]"); if (sv) sv.disabled = !state.dirty || state.readonly;
    if (!loadingNow && state.data) { writeDraft(); reloadPreview(false); }
  }
  function renderRight() { root.querySelector(".ed-right").innerHTML = rightHtml(); }

  function open(c) {
    ctx = c;
    document.querySelector(".ed")?.remove();
    root = document.createElement("div");
    root.className = "ed";
    root.innerHTML = `
      <div class="ed-bar">
        <button type="button" class="pl-btn pl-btn--sm" data-close>← Panel</button>
        <h1>✎ Mağaza editörü</h1>
        <select data-lang aria-label="Dil">${LANGS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <span class="ed-devices"><button type="button" data-dev="desk" class="is-active" title="Masaüstü">▭</button><button type="button" data-dev="mob" title="Mobil">▯</button></span>
        <span class="ed-grow"></span>
        <span class="ed-status"></span>
        <a class="pl-btn pl-btn--sm" href="../index.html" target="_blank" rel="noopener">Siteyi aç ↗</a>
        <button type="button" class="pl-btn pl-btn--green pl-btn--sm" data-save disabled>Kaydet</button>
      </div>
      <div class="ed-body">
        <aside class="ed-left"><p class="pl-loading">Yükleniyor …</p></aside>
        <div class="ed-preview"><iframe class="ed-frame" title="Önizleme" src="about:blank"></iframe></div>
        <aside class="ed-right"></aside>
      </div>`;
    document.body.appendChild(root);
    const startFile = /^content[/](posts[/])?[a-z0-9-]+[.]json$/.test(c.file || "") ? c.file : "content/site.json";
    state = { lang: "tr", ltab: startFile === "content/site.json" ? "home" : "files", file: null, data: null, sel: "hero", dirty: false, posts: [] };
    wire();
    (async () => {
      try { schema = await loadSchema(); } catch (e) { root.querySelector(".ed-left").innerHTML = `<p class="ed-empty">Şema yüklenemedi (config.yml).</p>`; return; }
      try { const blog = await fetch("../content/blog.json", { cache: "no-cache" }).then((r) => r.json()); state.posts = (blog.tr?.posts || blog.posts || []).map((p) => ({ id: p.id, title: p.title })); } catch (_) {}
      // neu angelegte Artikel stehen noch nicht in blog.json → in die Liste aufnehmen
      if (startFile.startsWith("content/posts/") && !state.posts.some((p) => "content/posts/" + p.id + ".json" === startFile)) state.posts.unshift({ id: startFile.split("/").pop().replace(".json", ""), title: "Yeni rehber" });
      openFile(startFile, startFile === "content/site.json" ? "hero" : undefined);
    })();
    window.addEventListener("beforeunload", beforeUnload);
  }
  const beforeUnload = (e) => { if (state?.dirty) { e.preventDefault(); e.returnValue = ""; } };
  function close() {
    window.removeEventListener("beforeunload", beforeUnload);
    root.remove(); ctx.close();
  }

  /* ---------- Ereignisse ---------- */
  function wire() {
    root.addEventListener("click", async (e) => {
      const t = e.target;
      if (t.closest("[data-close]")) { if (state.dirty && !(await confirmLeave())) return; close(); return; }
      if (t.closest("[data-save]")) return save();
      const dev = t.closest("[data-dev]");
      if (dev) { root.querySelectorAll("[data-dev]").forEach((b) => b.classList.toggle("is-active", b === dev)); root.querySelector(".ed-frame").classList.toggle("mobile", dev.dataset.dev === "mob"); return; }
      const lt = t.closest("[data-ltab]");
      if (lt) { state.ltab = lt.dataset.ltab; root.querySelector(".ed-left").innerHTML = leftHtml(); if (state.ltab === "home" && state.file?.id !== "content/site.json") openFile("content/site.json", "hero"); return; }
      const fl = t.closest("[data-file]"); if (fl) return openFile(fl.dataset.file);
      const po = t.closest("[data-post]"); if (po) return openFile(`content/posts/${po.dataset.post}.json`);
      // Abschnitte
      const secs = state.data?.tr?.sections;
      const mv = t.closest("[data-secmove]");
      if (mv && secs) { e.stopPropagation(); const i = +mv.dataset.i, j = i + +mv.dataset.secmove; if (j < 0 || j >= secs.length) return; [secs[i], secs[j]] = [secs[j], secs[i]]; markDirty(); root.querySelector(".ed-left").innerHTML = leftHtml(); return; }
      const eye = t.closest("[data-eye]");
      if (eye && secs) { e.stopPropagation(); const s = secs[+eye.dataset.i]; s.enabled = s.enabled === false; markDirty(); root.querySelector(".ed-left").innerHTML = leftHtml(); return; }
      const sec = t.closest("[data-sec]");
      if (sec) { state.sel = sec.dataset.sec; root.querySelector(".ed-left").innerHTML = leftHtml(); renderRight(); scrollPreviewTo(state.sel); return; }
      // Listen
      const add = t.closest("[data-add]");
      if (add) { const path = JSON.parse(add.dataset.list); const list = getAt(state.data.tr, path) ?? []; const f = findField(path); const proto = f?.fields ? Object.fromEntries(f.fields.map((x) => [x.name, x.default ?? (x.widget === "list" ? [] : x.widget === "boolean" ? false : "")])) : ""; list.push(proto); setTr(path, list); markDirty(); renderRight(); return; }
      const del = t.closest("[data-del]");
      if (del) { e.preventDefault(); const path = JSON.parse(del.dataset.list); const list = getAt(state.data.tr, path); const i = +del.dataset.i; const it = list[i]; const kf = KEYF(it); list.splice(i, 1); removeOther(path, i, kf, it); markDirty(); renderRight(); return; }
      const lm = t.closest("[data-move]");
      if (lm) { e.preventDefault(); const path = JSON.parse(lm.dataset.list); const list = getAt(state.data.tr, path); const i = +lm.dataset.i, j = i + +lm.dataset.move; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; moveOther(path, i, j, list); markDirty(); renderRight(); return; }
      const up = t.closest("[data-upload]");
      if (up) return upload(JSON.parse(up.dataset.upload));
    });
    root.addEventListener("input", (e) => {
      const el = e.target.closest("[data-path]"); if (!el) return;
      const path = JSON.parse(el.dataset.path), k = el.dataset.kind;
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (k === "num") v = el.value === "" ? null : Number(el.value);
      if (k === "strlist") v = el.value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
      writeVal(path, v);
      if (k === "img") { const im = root.querySelector(`[data-imgprev='${CSS.escape(el.dataset.path)}']`); if (im) { im.style.visibility = ""; im.src = imgSrc(v); } }
    });
    root.querySelector("[data-lang]").addEventListener("change", (e) => { state.lang = e.target.value; renderRight(); reloadPreview(false); });
    // Ziehen & Ablegen der Abschnitte
    let dragI = null;
    root.addEventListener("dragstart", (e) => { const s = e.target.closest("[data-sec][draggable]"); if (!s) return; dragI = +s.dataset.i; s.classList.add("dragging"); });
    root.addEventListener("dragover", (e) => { const s = e.target.closest("[data-sec][draggable]"); if (!s || dragI == null) return; e.preventDefault(); root.querySelectorAll(".drop-before").forEach((x) => x.classList.remove("drop-before")); s.classList.add("drop-before"); });
    root.addEventListener("drop", (e) => {
      const s = e.target.closest("[data-sec][draggable]"); if (!s || dragI == null) return; e.preventDefault();
      const secs = state.data.tr.sections, to = +s.dataset.i, [it] = secs.splice(dragI, 1); secs.splice(to > dragI ? to - 1 : to, 0, it); dragI = null; markDirty(); root.querySelector(".ed-left").innerHTML = leftHtml();
    });
    root.addEventListener("dragend", () => { dragI = null; root.querySelectorAll(".dragging,.drop-before").forEach((x) => x.classList.remove("dragging", "drop-before")); });
    document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s" && document.body.contains(root)) { e.preventDefault(); save(); } });
  }
  function setTr(path, v) { let o = state.data.tr; for (let i = 0; i < path.length - 1; i++) o = o[path[i]] ??= (typeof path[i + 1] === "number" ? [] : {}); o[path[path.length - 1]] = v; }
  // Fremdsprachen bei Listen ohne Schlüssel (Index) mitziehen
  function removeOther(path, i, kf, item) { for (const [l] of LANGS) { if (l === "tr") continue; const arr = getAt(state.data[l], path); if (!Array.isArray(arr)) continue; if (kf) { const j = arr.findIndex((x) => x && x[kf] === item[kf]); if (j >= 0) arr.splice(j, 1); } else if (i < arr.length) arr.splice(i, 1); } }
  function moveOther(path, i, j, list) { if (KEYF(list[0])) return; for (const [l] of LANGS) { if (l === "tr") continue; const arr = getAt(state.data[l], path); if (!Array.isArray(arr) || Math.max(i, j) >= arr.length) continue; [arr[i], arr[j]] = [arr[j], arr[i]]; } }
  function findField(path) {
    let fields = state.file.fields, f = null;
    for (const p of path) { if (typeof p === "number") continue; f = (fields || []).find((x) => x.name === p); fields = f?.fields || (f?.field ? [f.field] : null); }
    return f;
  }
  async function upload(path) {
    if (state.readonly) { ctx.toast("Yükleme için GITHUB_CONTENT_TOKEN gerekli."); return; }
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp,image/avif,image/gif";
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      if (file.size > 3 * 1024 * 1024) { ctx.toast("Görsel en fazla 3 MB olabilir."); return; }
      const dataUrl = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); });
      ctx.toast("Yükleniyor …");
      try {
        const r = await ctx.api("POST", "", { action: "content_upload", name: file.name, data: String(dataUrl).split(",")[1] });
        uploaded[r.url] = dataUrl;
        writeVal(path, r.url); renderRight(); ctx.toast("Görsel yüklendi.");
      } catch (err) { ctx.toast("Yüklenemedi: " + err.message); }
    };
    inp.click();
  }

  window.PPEditor = { open };
})();
