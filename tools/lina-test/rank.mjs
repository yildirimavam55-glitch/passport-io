// Neue Ranking-Logik für Lina (identisch nach js/app.js übernommen)
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const bigTok = (w) => w.length > 3 || CJK.test(w); // CJK-Zeichenpaare zählen immer als Wort
export function makeRanker(faqs, norm) {
  // Wortstamm-Vergleich: verträgt Endungen und Tippfehler am Wortende („internetim“ ~ „internet“, „calismiyo“ ~ „calismiyor“)
  const same = (a, b) => {
    if (a === b) return true;
    const m = Math.min(a.length, b.length);
    if (m < 4) return false;
    let i = 0; while (i < m && a[i] === b[i]) i++;
    return i === m || i >= Math.max(5, m - 2);
  };
  const idx = faqs.map((f) => {
    const kws = (f.keywords || []).map((k) => norm(k)).filter(Boolean).map((k) => ({ k, w: k.split(" ") }));
    const qw = norm(f.question).split(" ").filter(bigTok);
    const aw = [...new Set(norm(String(f.answer || "").replace(/\]\([^)]*\)/g, " ")).split(" ").filter(bigTok))];
    return { f, kws, qw, aw, words: new Set([...kws.flatMap((x) => x.w), ...qw]) };
  });
  // Wörter, die in vielen Einträgen vorkommen („esim“, „nasil“), zählen kaum – sonst gewinnt immer dieselbe FAQ
  const df = new Map();
  idx.forEach((e) => e.words.forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const common = (w) => (df.get(w) || 0) > Math.max(3, idx.length * 0.1);
  // Seltene Stichwörter wiegen mehr als solche, die in vielen Einträgen stehen („lounge“, „qr“, „paket“)
  const weight = (w) => { const ds = w.filter((x) => x.length > 2).map((x) => df.get(x) || 1); const d = ds.length ? Math.max(1, Math.min(...ds)) : 1; return 1 / (1 + Math.log2(d) / 3); };

  return (text) => {
    const nq = norm(text), q = " " + nq + " ";
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
        const t = exact || (!weak && w.some(bigTok)) ? hit(w) : null;
        if (!t && !exact) return;
        if (t && t.every((i) => used.has(i))) return;
        (t || []).forEach((i) => used.add(i));
        s += (exact ? (weak ? 1 : 2 + w.length) : 0.5 + w.length) * (weak ? 1 : weight(w));
      });
      // Frage zählt voll, Antworttext halb (deckt Formulierungen ab, an die beim Stichwort niemand gedacht hat)
      toks.forEach((t) => { if (!bigTok(t) || common(t)) return; if (qw.some((w) => same(t, w))) s += 1; else if (aw.some((w) => same(t, w))) s += 0.5; });
      return { f, s };
    }).sort((a, b) => b.s - a.s);
  };
}
