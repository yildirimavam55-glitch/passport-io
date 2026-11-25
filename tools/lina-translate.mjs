#!/usr/bin/env node
/*
 * Lina: neue oder geänderte FAQs automatisch in alle Sprachen übersetzen.
 *
 * Läuft in GitHub Actions (.github/workflows/lina-translate.yml), sobald content/assistant.json auf main geändert wird.
 * - Quelle ist immer die Standardsprache aus content/languages.json (tr).
 * - Für jede FAQ wird ein Fingerabdruck (Frage + Antwort) gespeichert: tools/lina-sync.json.
 *   Fehlt eine Sprache oder hat sich der türkische Text geändert, wird nur diese FAQ neu übersetzt.
 *   Von Hand gepflegte Übersetzungen bleiben unangetastet, solange sich der türkische Text nicht ändert.
 * - Hat eine FAQ in der Standardsprache weniger als 6 Stichwörter, ergänzt das Skript welche.
 * - Neue Sprache in languages.json → alle FAQs werden für diese Sprache übersetzt.
 *
 *   ANTHROPIC_API_KEY=… node tools/lina-translate.mjs          → übersetzen und Dateien schreiben
 *   node tools/lina-translate.mjs --dry                         → nur anzeigen, was übersetzt würde
 *   node tools/lina-translate.mjs --init                        → Fingerabdrücke für den jetzigen Stand setzen (nichts übersetzen)
 *   ANTHROPIC_API_KEY=… node tools/lina-translate.mjs --expand 25 → je FAQ und Sprache bis zu 25 echte Kundenformulierungen
 *                                                                 (Umgangssprache, Tippfehler) als Stichwörter ergänzen – einmal pro FAQ-Text
 */
import fs from "node:fs";
import crypto from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
const FILE = `${ROOT}content/assistant.json`;
const SYNC = `${ROOT}tools/lina-sync.json`;
const MODEL = process.env.LINA_MODEL || "claude-sonnet-5-5";
const DRY = process.argv.includes("--dry");
const EXPAND = process.argv.includes("--expand") ? Math.min(60, +process.argv[process.argv.indexOf("--expand") + 1] || 25) : 0;
const INIT = process.argv.includes("--init");

const LANGS = JSON.parse(fs.readFileSync(`${ROOT}content/languages.json`, "utf8"));
const AI = JSON.parse(fs.readFileSync(FILE, "utf8"));
const sync = fs.existsSync(SYNC) ? JSON.parse(fs.readFileSync(SYNC, "utf8")) : {};
const BASE = LANGS.default;
const NAMES = Object.fromEntries(LANGS.languages.map((l) => [l.code, l.name]));
const targets = LANGS.languages.map((l) => l.code).filter((c) => c !== BASE);
const hash = (f) => crypto.createHash("sha1").update(`${f.question}\n${f.answer}`).digest("hex").slice(0, 12);

// Was ist zu tun?
const jobs = []; // { id, langs: [...], enrich: bool }
for (const f of AI[BASE].faqs || []) {
  if (!f.id || !f.question || !f.answer) continue;
  const h = hash(f);
  const langs = targets.filter((c) => {
    const have = (AI[c]?.faqs || []).find((x) => x.id === f.id);
    return !have || !have.question || !have.answer || sync[f.id]?.[c] !== h;
  });
  const enrich = (f.keywords || []).length < 6;
  if (INIT) { sync[f.id] = Object.fromEntries(targets.map((c) => [c, h])); continue; }
  if (langs.length || enrich) jobs.push({ f, h, langs, enrich });
}
if (INIT) { fs.writeFileSync(SYNC, JSON.stringify(sync, null, 1) + "\n"); console.log(`Fingerabdrücke für ${Object.keys(sync).length} FAQs gesetzt.`); process.exit(0); }
if (!jobs.length && !EXPAND) { console.log("Lina: alles übersetzt – nichts zu tun."); process.exit(0); }
console.log(`Lina: ${jobs.length} FAQ(s) zu bearbeiten:`);
jobs.forEach((j) => console.log(` - ${j.f.id}: ${j.langs.join(", ") || "–"}${j.enrich ? " + Stichwörter (tr)" : ""}`));
if (DRY && !EXPAND) process.exit(0);
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY && !(EXPAND && DRY)) { console.log("::notice::ANTHROPIC_API_KEY fehlt – Übersetzung übersprungen. Lina zeigt so lange den türkischen Text."); process.exit(0); }

const SYSTEM = `You translate FAQ entries for passport.io, a travel eSIM shop (also airport lounge & fast track). Customers are travellers, many from the Turkish-German community.
Rules:
- Keep the meaning exactly. Do not add promises, prices, times or features that are not in the source.
- Keep Markdown (**bold**, lists, line breaks), links like [text](account.html) with the same URL, arrows "→", and the brand "passport.io" unchanged.
- Translate menu names the way the site shows them in that language (e.g. "Hesabım → Benim eSIM'lerim" = "My account → My eSIMs" / "Mein Konto → Meine eSIMs").
- Friendly, informal tone ("du" in German, "tu" in French, "tú" in Spanish, "ты" in Russian), short sentences.
- "keywords": 10–15 short search phrases a customer would really type in that language (colloquial, lowercase, also without accents if people often type that way). Prefer 2–4 word phrases. Never single very generic words like "esim", "internet", "phone", "help", "not working".
Answer ONLY with JSON.`;

async function ask(prompt) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
    });
    if (r.ok) {
      const j = await r.json();
      const text = (j.content || []).map((c) => c.text || "").join("");
      const m = text.match(/\{[\s\S]*\}/);
      if (m) try { return JSON.parse(m[0]); } catch (_) { /* nochmal */ }
    } else if (r.status !== 429 && r.status < 500) throw new Error(`API ${r.status}: ${await r.text()}`);
    await new Promise((res) => setTimeout(res, 3000 * attempt));
  }
  throw new Error("Keine gültige Antwort vom Übersetzungsdienst");
}

if (EXPAND) { await expand(); process.exit(0); }
const ok = (e) => e && typeof e.question === "string" && e.question.trim() && typeof e.answer === "string" && e.answer.trim() && Array.isArray(e.keywords);
let done = 0;
for (const j of jobs) {
  const { f } = j;
  const want = [...j.langs, ...(j.enrich ? [BASE] : [])];
  const prompt = `Source FAQ (${NAMES[BASE]}):\n${JSON.stringify({ question: f.question, answer: f.answer, keywords: f.keywords || [] }, null, 1)}\n\n`
    + `Return {${want.map((c) => `"${c}": {"question","answer","keywords"}`).join(", ")}}`
    + ` for these languages: ${want.map((c) => `${c} = ${NAMES[c]}${c === BASE ? " (same language: keep question and answer unchanged, only write the keywords)" : ""}`).join("; ")}.`;
  try {
    const out = await ask(prompt);
    for (const c of j.langs) {
      if (!ok(out[c])) { console.log(`   ! ${f.id}/${c}: unvollständig, übersprungen`); continue; }
      AI[c] ||= { faqs: [] }; AI[c].faqs ||= [];
      const e = { id: f.id, question: out[c].question.trim(), answer: out[c].answer.trim(), keywords: out[c].keywords.map(String).filter(Boolean).slice(0, 20) };
      const i = AI[c].faqs.findIndex((x) => x.id === f.id);
      if (i >= 0) AI[c].faqs[i] = { ...AI[c].faqs[i], ...e }; else AI[c].faqs.push(e);
      (sync[f.id] ||= {})[c] = j.h;
    }
    if (j.enrich && Array.isArray(out[BASE]?.keywords)) {
      const add = out[BASE].keywords.map(String).filter((k) => k && !(f.keywords || []).includes(k));
      f.keywords = [...(f.keywords || []), ...add].slice(0, 20);
    }
    done++;
    console.log(`   ✓ ${f.id}`);
  } catch (err) { console.log(`   ! ${f.id}: ${err.message}`); }
}
fs.writeFileSync(FILE, JSON.stringify(AI, null, 2) + "\n");
fs.writeFileSync(SYNC, JSON.stringify(sync, null, 1) + "\n");
console.log(`Lina: ${done}/${jobs.length} FAQ(s) aktualisiert.`);

// Viele echte Kundenformulierungen je FAQ erzeugen und als Stichwörter ergänzen (einmal je FAQ-Text, gemerkt in lina-sync.json)
async function expand() {
  const all = LANGS.languages.map((l) => l.code);
  const todo = (AI[BASE].faqs || []).filter((f) => f.id && sync._expanded?.[f.id] !== hash(f));
  console.log(`Lina: Kundenformulierungen für ${todo.length} FAQ(s), je Sprache bis zu ${EXPAND}`);
  if (DRY) return;
  if (!KEY) { console.log("::notice::ANTHROPIC_API_KEY fehlt – keine Formulierungen erzeugt."); return; }
  const norm = (x) => String(x).toLowerCase().replace(/[?!.,;:"“”„]+/g, " ").replace(/\s+/g, " ").trim();
  let done = 0;
  for (const f of todo) {
    const prompt = `FAQ (${NAMES[BASE]}):\nQ: ${f.question}\nA: ${f.answer}\n\n`
      + `Write up to ${EXPAND} different short messages per language that real travellers would type into a support chat when THIS FAQ is the answer: colloquial, often without punctuation or accents, some with typos, some describing the problem in their own words (not just rephrasing the question), mixed lengths (2–12 words). `
      + `Languages: ${all.map((c) => `${c} = ${NAMES[c]}`).join("; ")}. Return {${all.map((c) => `"${c}": ["…"]`).join(", ")}}.`;
    try {
      const out = await ask(prompt);
      for (const c of all) {
        if (!Array.isArray(out[c])) continue;
        const e = c === BASE ? f : (AI[c]?.faqs || []).find((x) => x.id === f.id);
        if (!e) continue;
        const have = new Set((e.keywords || []).map(norm));
        const add = out[c].map(norm).filter((k) => k && k.split(" ").length >= 2 && k.length <= 80 && !have.has(k));
        e.keywords = [...(e.keywords || []), ...add].slice(0, 80);
      }
      (sync._expanded ||= {})[f.id] = hash(f);
      done++; console.log(`   ✓ ${f.id}`);
    } catch (err) { console.log(`   ! ${f.id}: ${err.message}`); }
  }
  fs.writeFileSync(FILE, JSON.stringify(AI, null, 2) + "\n");
  fs.writeFileSync(SYNC, JSON.stringify(sync, null, 1) + "\n");
  console.log(`Lina: ${done}/${todo.length} FAQ(s) erweitert.`);
}
