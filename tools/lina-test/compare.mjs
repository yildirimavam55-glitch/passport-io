// Vergleicht zwei Testläufe (SAVE=…json): bricht mit Fehler ab, wenn Lina schlechter geworden ist.
import fs from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const score = (r) => r.filter((x) => x.st === "richtig").length - 2 * r.filter((x) => x.st === "falsch").length;
console.log(`vorher ${score(a)} · nachher ${score(b)} (richtig minus 2× falsch)`);
if (score(b) < score(a)) { console.log("::warning::Lina wäre schlechter geworden – Änderung wird nicht übernommen."); process.exit(1); }
