// Lina wie im Browser: sucht in allen Sprachen und antwortet in der Sprache der Frage.
import { makeRanker } from "./rank.mjs";
const KEY = (o) => (o && typeof o === "object" ? o.id ?? o.code : undefined);
export function merge(base, over) {
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
export const mkNorm = (locale) => (s) => String(s).toLocaleLowerCase(locale).replace(/ı/g, "i").replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ًͯ-ٰٟ]/g, "").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ё/g, "е").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

// Schrift erkennen: Arabisch/Kyrillisch eindeutig, sonst lateinische Sprachen
export const scriptOf = (s) => (/[؀-ۿ]/.test(s) ? "arab" : /[Ѐ-ӿ]/.test(s) ? "cyrl" : "latn");
const SCRIPT = { ar: "arab", ru: "cyrl" };

// Umgangssprache → einheitliche Begriffe (content/lina-synonyms.json), auf Frage UND FAQ-Texte angewendet
export function makeCanon(rules, norm) {
  const list = Object.entries(rules || {}).filter(([k]) => !k.startsWith("_"))
    .flatMap(([vars, canon]) => vars.split("|").map((v) => [norm(v), norm(canon)]))
    .filter(([v]) => v).sort((a, b) => b[0].length - a[0].length);
  return (s) => { let t = " " + norm(s) + " "; for (const [v, c] of list) if (t.includes(" " + v + " ")) t = t.split(" " + v + " ").join(" " + c + " "); return t.trim().replace(/\s+/g, " "); };
}
export function makeLina(AI, LANGS, site, SYN = {}) {
  const per = LANGS.languages.map((l) => {
    const data = merge(AI[LANGS.default], AI[l.code]);
    const norm = mkNorm(l.locale);
    // Wortschatz nur aus den eigenen Texten der Sprache (nicht aus dem Rückgriff auf die Standardsprache)
    const own = AI[l.code] || {};
    const vocab = new Set(norm([own.greeting, own.fallback, ...(own.suggestions || []), ...(own.faqs || []).flatMap((f) => [f.question, f.answer, ...(f.keywords || [])])].join(" ")).split(" ").filter((w) => w.length > 1));
    return { code: l.code, data, norm, vocab, rank: makeRanker(data.faqs, makeCanon(SYN[l.code], norm)), script: SCRIPT[l.code] || "latn" };
  });
  // Sprache der Frage: Wörter, die nur in einer Sprache vorkommen, zählen am meisten
  const detect = (text, cands) => {
    const sc = cands.map((p) => ({ p, s: 0 }));
    const toks = [...new Set(cands[0].norm(text).split(" ").filter((w) => w.length > 1))];
    toks.forEach((t) => { const inL = sc.filter((x) => x.p.vocab.has(t)); inL.forEach((x) => (x.s += 1 / inL.length)); });
    sc.sort((a, b) => b.s - a.s);
    return sc.length === 1 || (sc[0].s >= 0.5 && sc[0].s - (sc[1]?.s || 0) >= 0.5) ? sc[0].p.code : null;
  };
  return (text) => {
    const sc = scriptOf(text);
    const res = per.filter((p) => p.script === sc).map((p) => ({ p, r: p.rank(text) }));
    if (!res.length) res.push(...per.filter((p) => p.code === site).map((p) => ({ p, r: p.rank(text) })));
    const qlang = detect(text, res.map((x) => x.p));
    const det = qlang && res.find((x) => x.p.code === qlang);
    const own = det || res.find((x) => x.p.code === site);
    const best = det || res.reduce((a, b) => (b.r[0].s > a.r[0].s ? b : a));
    // Seitensprache gewinnt, solange eine andere Sprache nicht deutlich besser passt
    const gap = +(process.env.G || 1);
    const pick = !own ? best : best.r[0].s - own.r[0].s >= (own.r[0].s >= 3 ? 2 : gap) ? best : own;
    const top = pick.r[0];
    const near = pick.r.filter((x) => x.s >= 1).slice(0, 3).map((x) => ({ id: x.f.id, question: x.f.question }));
    const second = pick.r[1] ? pick.r[1].s : 0;
    const sure = top.s >= +(process.env.T || 3) || (top.s >= +(process.env.T2 || 2) && top.s - second >= +(process.env.M || 1.5));
    return sure
      ? { type: "answer", lang: pick.p.code, id: top.f.id, score: top.s, question: top.f.question, answer: top.f.answer, near }
      : { type: near.length ? "suggest" : "none", lang: pick.p.code, id: null, score: top.s, near, answer: pick.p.data.fallback };
  };
}
