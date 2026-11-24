/* ==========================================================================
   passport.io – Sortiment: nur Paketgrößen anbieten, die auch der Markt verkauft
   --------------------------------------------------------------------------
   Pro Land/Region bleiben nur Tarife, für die es einen Wettbewerbspreis mit gleichem
   Volumen und gleicher Laufzeit gibt (Airalo, Saily, Nomad …). Gibt es für ein Land
   gar keine Wettbewerbsdaten, gilt ein Standard-Sortiment. Fällt dadurch alles weg,
   bleibt das ursprüngliche Angebot stehen (nie ein leeres Land).
   ========================================================================== */
// deno-lint-ignore-file no-explicit-any
import type { Competitor } from "./pricing.ts";

/** Übliche Größen am Markt, falls für ein Land keine Wettbewerbsdaten vorliegen */
const STD_DATA = new Set(["1|7", "3|30", "5|30", "10|30", "20|30", "50|30"]);
const STD_UNL_DAYS = new Set([3, 5, 7, 10, 15, 30]);

export function applyAssortment(body: any, comps: Competitor[]) {
  const shapes = new Map<string, Set<string>>();
  for (const c of comps) {
    if (c.gb == null || c.days == null) continue;
    (shapes.get(c.item_key) ?? shapes.set(c.item_key, new Set()).get(c.item_key)!).add(`${Number(c.gb)}|${Number(c.days)}`);
  }
  const pick = (key: string, plans: any[] | undefined) => {
    if (!plans?.length) return plans;
    const set = shapes.get(key);
    const data = plans.filter((p) => !p.unlimited), unl = plans.filter((p) => p.unlimited);
    const marketData = set ? data.filter((p) => set.has(`${Number(p.gb)}|${Number(p.days)}`)) : [];
    const keepData = marketData.length ? marketData : data.filter((p) => STD_DATA.has(`${Number(p.gb)}|${Number(p.days)}`));
    const marketUnl = set ? unl.filter((p) => set.has(`0|${Number(p.days)}`)) : [];
    const keepUnl = marketUnl.length ? marketUnl : unl.filter((p) => STD_UNL_DAYS.has(Number(p.days)));
    let out = [...(keepData.length ? keepData : data), ...(keepUnl.length ? keepUnl : unl)];
    if (!out.length) out = plans;
    // „Beliebt“ neu setzen, falls der markierte Tarif weggefallen ist
    if (!out.some((p) => p.popular)) {
      const d = out.filter((p) => !p.unlimited);
      const pop = d.find((p) => Number(p.gb) === 5 && Number(p.days) === 30) ?? d[Math.floor(d.length / 2)];
      if (pop) pop.popular = true;
    }
    return out;
  };
  for (const [code, c] of Object.entries<any>(body.esim?.countries ?? {})) c.plans = pick(`country:${code}`, c.plans);
  for (const [id, c] of Object.entries<any>(body.esim?.regions ?? {})) c.plans = pick(`region:${id}`, c.plans);
  return body;
}
