#!/usr/bin/env node
/*
 * Webseite: geänderte oder fehlende Texte automatisch in alle Sprachen übersetzen.
 *
 * Läuft in GitHub Actions (.github/workflows/site-translate.yml), sobald Inhalte auf main geändert werden
 * (Mağaza editörü, Blog, Rechtstexte, neue Sprache in content/languages.json).
 * - Quelle ist die Standardsprache (tr), Englisch wird als Bezugstext mitgegeben.
 * - Je Text wird ein Fingerabdruck des türkischen Originals gespeichert (tools/site-sync.json).
 *   Fehlt eine Übersetzung oder hat sich der türkische Text geändert, wird nur dieser Text neu übersetzt.
 *   Von Hand gepflegte Übersetzungen bleiben, solange sich das Original nicht ändert.
 * - Lina-FAQs (content/assistant.json → faqs) übersetzt tools/lina-translate.mjs (mit Stichwörtern).
 *
 *   ANTHROPIC_API_KEY=… node tools/site-translate.mjs        → übersetzen und Dateien schreiben
 *   node tools/site-translate.mjs --dry                       → nur zählen, was zu tun ist
 *   node tools/site-translate.mjs --init                      → Fingerabdrücke für vorhandene Übersetzungen setzen
 *   node tools/site-translate.mjs --export=it > offen.json    → offene Texte einer Sprache als JSON ausgeben
 *   node tools/site-translate.mjs --import=it offen-it.json   → Übersetzungen (gleiche Schlüssel) übernehmen
 *   Optional: --only=it,pt  (Sprachen)   --files=ui,site  (Dateien)
 */
import fs from "node:fs";
import crypto from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
const SYNC = `${ROOT}tools/site-sync.json`;
const MODEL = process.env.SITE_MODEL || process.env.LINA_MODEL || "claude-sonnet-5-5";
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=").slice(1).join("=") || null;
const DRY = process.argv.includes("--dry"), INIT = process.argv.includes("--init");
const EXPORT = arg("export"), IMPORT = arg("import");

const LANGS = JSON.parse(fs.readFileSync(`${ROOT}content/languages.json`, "utf8"));
const BASE = LANGS.default;
const NAMES = Object.fromEntries(LANGS.languages.map((l) => [l.code, l.name]));
let targets = LANGS.languages.map((l) => l.code).filter((c) => c !== BASE);
if (arg("only")) targets = targets.filter((c) => arg("only").split(",").includes(c));
if (EXPORT) targets = [EXPORT];
if (IMPORT) targets = [IMPORT];

// Dateien mit Texten je Sprache ({tr:…, en:…}); Blogartikel einzeln
let FILES = ["site", "ui", "account", "install", "pages", "reviews", "esim", "blog", "assistant"].map((n) => `content/${n}.json`)
  .concat(fs.readdirSync(`${ROOT}content/posts`).filter((f) => f.endsWith(".json")).map((f) => `content/posts/${f}`));
if (arg("files")) FILES = FILES.filter((f) => arg("files").split(",").some((x) => f.includes(`/${x}.json`) || f.includes(`/${x}`)));

// Was nicht übersetzt wird: Links, Bilder, Codes, Farben … (wie im Panel → Diller & çeviri)
const SKIP = /^(image|images|img|url|href|link|icon|color|green|dark|code|id|type|date|cta|country|countryCode|pricesUrl|questionsUrl|linaUrl|mapCodes|slug|value|style|tap|toggle|kind|currency|email|phone|logo|flag|contactEmail|draft|views|category|next|popular|devices|devicesNo|brand|priceKey|payments|author|action)$/i;
const SOFT = /^(code|value|date|category|type|kind|style)$/i;
const skipPath = (file, path) =>
  (file.endsWith("/assistant.json") && path[0] === "faqs") || // Lina-FAQs: eigenes Werkzeug
  (file.endsWith("/esim.json") && ((path[0] === "countries" && path[path.length - 1] === "name") || path[path.length - 1] === "data")); // Ländernamen kommen aus dem Browser (Intl)
const looksCode = (s) => /^(https?:\S*|mailto:\S*|tel:\S*|#[\w-]*|\/\S*|[a-z0-9._-]+\.(json|html|svg|png|jpe?g|webp))$/i.test(s.trim()) || !/\p{L}/u.test(s);

const KEYF = (o) => (o && typeof o === "object" ? (o.id !== undefined ? "id" : o.code !== undefined ? "code" : null) : null);
// Pfad: Schlüssel bzw. {k:"id", v:"eu"} für Listen mit IDs bzw. Zahl für Listen ohne IDs
function leaves(file, obj, path = [], out = []) {
  if (typeof obj === "string") { if (obj.trim() && !looksCode(obj) && !skipPath(file, path)) out.push({ path, text: obj }); return out; }
  if (Array.isArray(obj)) { obj.forEach((x, i) => { const kf = KEYF(x); leaves(file, x, [...path, kf ? { k: kf, v: x[kf] } : i], out); }); return out; }
  // Weiche Schlüssel (code, value, date, category …): nur Texte mit Leerzeichen („Verification code“, „2 days ago“), keine Codes
  if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_")) continue;
    // ui.json/account.json sind reine Textwörterbücher: dort zählt jeder Eintrag der obersten Ebene („currency“ = „Para birimi“)
    const dict = !path.length && /\/(ui|account)\.json$/.test(file);
    if (!dict && SKIP.test(k) && !(SOFT.test(k) && typeof v === "string" && /\p{L}+\s+\p{L}+/u.test(v) && !looksCode(v))) continue;
    leaves(file, v, [...path, k], out);
  }
  return out;
}
const pkey = (path) => path.map((s) => (typeof s === "object" ? `[${s.k}=${s.v}]` : typeof s === "number" ? `[${s}]` : s)).join(".");
function getAt(o, path) { for (const s of path) { if (o == null) return undefined; o = typeof s === "object" ? (Array.isArray(o) ? o.find((x) => x && x[s.k] === s.v) : undefined) : o[s]; } return o; }
function setAt(root, path, val, src) {
  let o = root, so = src;
  path.forEach((s, i) => {
    const last = i === path.length - 1, nxt = path[i + 1];
    const make = () => (typeof nxt === "number" || typeof nxt === "object" ? [] : {});
    if (typeof s === "object") {
      let x = o.find((e) => e && e[s.k] === s.v); if (!x) { x = { [s.k]: s.v }; o.push(x); }
      so = Array.isArray(so) ? so.find((e) => e && e[s.k] === s.v) : undefined; o = x;
    } else if (typeof s === "number") {
      // Listen ohne IDs werden nach Position gemischt; reine Textlisten ersetzt die Seite ganz → mit Original auffüllen
      while (o.length < s) o.push(Array.isArray(so) && typeof so[o.length] === "string" ? so[o.length] : {});
      if (last) o[s] = val; else { if (o[s] == null || typeof o[s] !== "object") o[s] = make(); o = o[s]; }
      so = Array.isArray(so) ? so[s] : undefined;
    } else {
      if (last) o[s] = val; else { if (o[s] == null || typeof o[s] !== "object") o[s] = make(); o = o[s]; }
      so = so && typeof so === "object" ? so[s] : undefined;
    }
  });
}
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
const sync = fs.existsSync(SYNC) ? JSON.parse(fs.readFileSync(SYNC, "utf8")) : {};
const docs = Object.fromEntries(FILES.map((f) => [f, JSON.parse(fs.readFileSync(ROOT + f, "utf8"))]));

// Offene Texte je Datei und Sprache
const jobs = []; // {file, lang, items:[{key,path,text,ref}]}
for (const f of FILES) {
  const d = docs[f]; if (!d[BASE]) continue;
  const src = leaves(f, d[BASE]); sync[f] ||= {};
  for (const l of targets) {
    const items = [];
    for (const { path, text } of src) {
      const key = pkey(path), h = hash(text), have = getAt(d[l], path);
      if (INIT) { if (typeof have === "string" && have.trim()) (sync[f][key] ||= {})[l] = h; continue; }
      if (typeof have === "string" && have.trim() && sync[f][key]?.[l] === h) continue;
      if (typeof have === "string" && have.trim() && !sync[f][key]?.[l]) { (sync[f][key] ||= {})[l] = h; continue; } // vorhandene Übersetzung ohne Fingerabdruck: behalten
      const ref = l !== "en" ? getAt(d.en, path) : undefined;
      items.push({ key, path, text, ref: typeof ref === "string" ? ref : undefined });
    }
    if (items.length) jobs.push({ file: f, lang: l, items });
  }
}
const save = () => {
  for (const f of FILES) fs.writeFileSync(ROOT + f, JSON.stringify(docs[f], null, 2) + "\n");
  fs.writeFileSync(SYNC, JSON.stringify(sync, null, 1) + "\n");
};
if (INIT) { save(); console.log("Fingerabdrücke gesetzt."); process.exit(0); }

const total = jobs.reduce((n, j) => n + j.items.length, 0);
if (EXPORT) {
  const out = {}; jobs.forEach((j) => j.items.forEach((x) => (out[`${j.file}::${x.key}`] = x.ref ? { tr: x.text, en: x.ref } : { tr: x.text })));
  fs.writeSync(1, JSON.stringify(out, null, 1) + "\n"); process.exit(0); // synchron: sonst wird die Ausgabe in einer Pipe abgeschnitten
}
const apply = (lang, map) => { // map: "datei::pfad" → Übersetzung
  let n = 0;
  for (const j of jobs) for (const x of j.items) {
    const v = map[`${j.file}::${x.key}`]; if (typeof v !== "string" || !v.trim()) continue;
    const d = docs[j.file]; d[lang] ||= {}; setAt(d[lang], x.path, v, d[BASE]);
    (sync[j.file][x.key] ||= {})[lang] = hash(x.text); n++;
  }
  return n;
};
if (IMPORT) {
  const file = process.argv.filter((a) => !a.startsWith("--")).slice(2).pop();
  const n = apply(IMPORT, JSON.parse(fs.readFileSync(file, "utf8"))); save();
  console.log(`${IMPORT}: ${n} von ${total} Texten übernommen.`); process.exit(0);
}
console.log(`Webseite: ${total} Text(e) offen` + (total ? ":" : ""));
const per = {}; jobs.forEach((j) => (per[j.lang] = (per[j.lang] || 0) + j.items.length)); Object.entries(per).forEach(([l, n]) => console.log(` - ${l}: ${n}`));
if (!total) { save(); process.exit(0); }
if (DRY) process.exit(0);
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.log("::notice::ANTHROPIC_API_KEY fehlt – Übersetzung übersprungen. Fehlende Texte zeigt die Seite auf Englisch."); save(); process.exit(0); }

const SYSTEM = `You translate website texts for passport.io, a travel eSIM shop (also airport lounge & fast track). Tone: friendly, short, clear, informal "you" where the language allows it (du/tu/tú/je/ty; Japanese and Korean: polite but natural).
Rules:
- Translate from Turkish (source). An English reference is given when available – use it to understand the meaning.
- Keep Markdown (**bold**, lists, links [text](url)), HTML tags, emojis, line breaks and placeholders like {p}, {n}, {email} exactly.
- Keep brand and product names: passport.io, Lina, eSIM, Fast Track, Apple Pay, Google Pay, iPhone, Samsung, WhatsApp.
- Prices, numbers and units stay as they are.
- Answer ONLY with a JSON object: the same keys, value = translation.`;
const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
async function translate(lang, items) {
  const input = Object.fromEntries(items.map((x, i) => [String(i), x.ref ? { tr: x.text, en: x.ref } : { tr: x.text }]));
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, temperature: 0, system: SYSTEM, messages: [{ role: "user", content: `Target language: ${NAMES[lang]} (${lang}).\n${JSON.stringify(input)}` }] }) });
    if (!r.ok) { console.log(`  API ${r.status} – neuer Versuch`); await new Promise((ok) => setTimeout(ok, 3000 * (attempt + 1))); continue; }
    const txt = (await r.json()).content?.map((c) => c.text || "").join("") || "";
    try {
      const obj = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)); const out = {};
      items.forEach((x, i) => { const v = obj[String(i)]; if (typeof v === "string" && v.trim() && placeholders(v) === placeholders(x.text)) out[x.key] = v; });
      return out;
    } catch (_) { console.log("  Antwort kein JSON – neuer Versuch"); }
  }
  return {};
}
let done = 0;
for (const j of jobs) {
  for (let i = 0; i < j.items.length; i += 60) {
    const part = j.items.slice(i, i + 60); const res = await translate(j.lang, part);
    const map = Object.fromEntries(Object.entries(res).map(([k, v]) => [`${j.file}::${k}`, v]));
    done += apply(j.lang, map); save(); // nach jedem Teil speichern – Abbruch verliert nichts
    console.log(` ${j.file} → ${j.lang}: ${Object.keys(res).length}/${part.length}`);
  }
}
console.log(`Fertig: ${done} von ${total} Texten übersetzt.`);
