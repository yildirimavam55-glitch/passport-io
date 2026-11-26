// Prüft Lina gegen Testfragen.
//   node tools/lina-test/eval.mjs                 → alle Testsätze, nur Stichwortsuche
//   node tools/lina-test/eval.mjs -v --set=colloq_c  → ein Satz, mit Fehlerliste
//   node tools/lina-test/eval.mjs --site=de       → Seite auf Deutsch, Fragen in allen Sprachen
//   ANTHROPIC_API_KEY=… node tools/lina-test/eval.mjs --ai   → mit KI-Stufe (wie auf der Webseite)
// Testsätze: sets/catalog (724, darauf optimiert) · blind · colloq_a/b (Umgangssprache, optimiert) · colloq_c (zuletzt, nicht optimiert) · simple (5000 einfache Fragen aus Vorlagen, simple-src/)
// rank.mjs + lina.mjs sind eine Kopie der Suche aus js/app.js (initAssistant) – bei Änderungen dort beide anpassen.
import fs from "node:fs";
import { makeLina } from "./lina.mjs";
import { buildPrompt, readAnswer } from "../../supabase/functions/_shared/lina-prompt.js";
const ROOT = new URL("../..", import.meta.url).pathname;
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || null;
const site = arg("site"), only = arg("set"), AIKEY = process.argv.includes("--ai") ? process.env.ANTHROPIC_API_KEY : null;
if (process.argv.includes("--ai") && !AIKEY) { console.log("ANTHROPIC_API_KEY fehlt – teste ohne KI."); }
const AI = JSON.parse(fs.readFileSync(`${ROOT}content/assistant.json`, "utf8"));
const LANGS = JSON.parse(fs.readFileSync(`${ROOT}content/languages.json`, "utf8"));
const SYN = JSON.parse(fs.readFileSync(`${ROOT}content/lina-synonyms.json`, "utf8"));
const SETS = new URL("./sets/", import.meta.url).pathname;
const MODEL = process.env.LINA_MODEL || "claude-haiku-5-5";

async function askAI(q, lang, ids) {
  const { system, user, ids: known } = buildPrompt(AI, lang, q, ids);
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": AIKEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, temperature: 0, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: user }] }) });
    if (r.ok) return readAnswer(await r.json(), known);
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  return null;
}

const out = [], lines = [];
// Mit KI wird der große Satz "simple" (5000 Fragen) nur auf ausdrücklichen Wunsch (--set=simple) geprüft – spart API-Kosten
for (const set of fs.readdirSync(SETS).filter((s) => (only ? s === only : !(AIKEY && s === "simple")))) {
  const sum = { n: 0, richtig: 0, vorschlag: 0, falsch: 0, keine: 0 }; const fails = [];
  for (const f of fs.readdirSync(SETS + set).filter((x) => x.endsWith(".txt"))) {
    const qlang = f.replace(".txt", "");
    const lina = makeLina(AI, LANGS, site || qlang, SYN);
    for (const line of fs.readFileSync(SETS + set + "/" + f, "utf8").split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      const [q, exp] = line.split("|").map((s) => s.trim());
      const want = exp === "-" ? null : exp.split(",").map((s) => s.trim());
      const r = lina(q);
      let st, via = "suche", id = r.id;
      if (AIKEY && !(r.type === "answer" && r.score >= 5)) {
        const a = await askAI(q, r.lang, r.near.map((n) => n.id));
        if (a) { via = "ki"; id = a.handoff ? null : a.faq; r.type = a.handoff ? (r.near.length ? "suggest" : "none") : "answer"; }
      }
      if (!want) st = r.type === "answer" ? "falsch" : "richtig";
      else if (r.type === "answer") st = want.includes(id) ? "richtig" : "falsch";
      else st = r.near.some((n) => want.includes(n.id)) ? "vorschlag" : "keine";
      sum.n++; sum[st]++;
      if (st === "falsch" || st === "keine") fails.push(` ${st === "falsch" ? "✗" : "○"} [${qlang}] "${q}" → ${id || "-"} (${via}) erwartet ${exp}`);
      out.push({ set, qlang, q, want: exp, st, via, id });
    }
  }
  const pct = (x) => Math.round((100 * x) / sum.n);
  lines.push(`${set.padEnd(9)} ${String(sum.n).padStart(4)} Fragen · richtig ${pct(sum.richtig)} % · gelöst inkl. Vorschlag ${pct(sum.richtig + sum.vorschlag)} % · falsch ${pct(sum.falsch)} %`);
  console.log(`${set.padEnd(9)} ${String(sum.n).padStart(4)} Fragen · richtig ${pct(sum.richtig)} % · gelöst inkl. Vorschlag ${pct(sum.richtig + sum.vorschlag)} % · falsch ${pct(sum.falsch)} %`);
  if (process.argv.includes("-v")) fails.forEach((x) => console.log(x));
}
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Lina-Test ${AIKEY ? "mit KI" : "nur Stichwortsuche"}\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
if (process.env.SAVE) fs.writeFileSync(process.env.SAVE, JSON.stringify(out, null, 1));
