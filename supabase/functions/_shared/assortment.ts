/* ==========================================================================
   passport.io – Sortiment und logische Preisstaffel
   --------------------------------------------------------------------------
   1. Festes Sortiment für jedes Land/jede Region:
      Standard: 1, 2, 3, 5, 10, 20, 50 GB – je Größe EIN Paket (bevorzugt 30 Tage,
      sonst die längste Laufzeit bis 30 Tage, sonst die nächstlängere).
      Unlimited: 3, 5, 7, 10, 15, 30 Tage.
      Hat der Anbieter eine Größe nicht, fehlt sie einfach (nie erfundene Pakete).
   2. Preisstaffel nach der Preisregel: ein kleineres Paket kostet nie mehr als ein
      größeres. Ist es teurer, wird es auf den Preis des größeren gesenkt – fiele es
      dadurch unter die Untergrenze (Mindestpreis/Verlustschutz), wird es ausgeblendet.
   ========================================================================== */
// deno-lint-ignore-file no-explicit-any

const SIZES = [1, 2, 3, 5, 10, 20, 50];
/** Wunsch-Sortiment (GB → Laufzeiten). Fehlt eine Größe ganz, wird die beste vorhandene Laufzeit genommen. */
const SHAPES: Record<number, number[]> = { 1: [7], 2: [15], 3: [15, 30], 5: [30], 10: [30], 20: [30], 50: [30, 180] };
const UNL_DAYS = new Set([3, 5, 7, 10, 15, 30]);

const markPopular = (out: any[]) => {
  out.forEach((p) => delete p.popular);
  const d = out.filter((p) => !p.unlimited);
  const pop = d.find((p) => Number(p.gb) === 5) ?? d[Math.floor(d.length / 2)];
  if (pop) pop.popular = true;
};

/** Laufzeit-Vorliebe: 30 Tage > längste bis 30 > kürzeste darüber */
const daysRank = (d: number) => (d === 30 ? 0 : d < 30 ? 1000 - d : 2000 + d);

export function applyAssortment(body: any) {
  const pick = (plans: any[] | undefined) => {
    if (!plans?.length) return plans;
    const data = plans.filter((p) => !p.unlimited), unl = plans.filter((p) => p.unlimited);
    const keepData: any[] = [];
    for (const gb of SIZES) {
      const ofSize = data.filter((p) => Number(p.gb) === gb);
      // genau die Wunsch-Laufzeiten (je Laufzeit das günstigste Paket) …
      const exact = SHAPES[gb].map((d) => ofSize.filter((p) => Number(p.days) === d).sort((a, b) => Number(a.price) - Number(b.price))[0]).filter(Boolean);
      if (exact.length) { keepData.push(...exact); continue; }
      // … sonst die beste vorhandene Laufzeit für diese Größe
      const cands = ofSize.sort((a, b) => daysRank(Number(a.days)) - daysRank(Number(b.days)) || Number(a.price) - Number(b.price));
      if (cands[0]) keepData.push(cands[0]);
    }
    const keepUnl = unl.filter((p) => UNL_DAYS.has(Number(p.days)));
    let out = [...(keepData.length ? keepData : data), ...(keepUnl.length ? keepUnl : unl)];
    if (!out.length) out = plans;
    markPopular(out);
    return out;
  };
  for (const c of Object.values<any>(body.esim?.countries ?? {})) c.plans = pick(c.plans);
  for (const c of Object.values<any>(body.esim?.regions ?? {})) c.plans = pick(c.plans);
  return body;
}

/**
 * Preisstaffel: von groß nach klein – ein kleineres Paket darf höchstens so viel kosten wie das
 * nächstgrößere. floorOf(p) = Untergrenze aus der Preisregel (Mindestpreis, Einkauf + Marge).
 */
export function enforceStaircase(body: any, floorOf: (p: any) => number) {
  const stair = (list: any[], size: (p: any) => number) => {
    const sorted = [...list].sort((a, b) => size(b) - size(a));
    let cap = Infinity;
    const drop = new Set<any>();
    for (const p of sorted) {
      if (Number(p.price) >= cap && cap !== Infinity) {
        // möglichst einen Tick (1 €, bleibt auf ,99) unter dem größeren Paket, sonst gleich teuer, sonst ausblenden
        const below = Math.round((cap - 1) * 100) / 100, fl = floorOf(p);
        if (Number(p.price) > below && below >= fl) p.price = below;
        else if (Number(p.price) > cap) { if (cap >= fl) p.price = cap; else { drop.add(p); continue; } }
      }
      cap = Math.min(cap, Number(p.price));
    }
    return list.filter((p) => !drop.has(p));
  };
  const fix = (plans: any[] | undefined) => {
    if (!plans?.length) return plans;
    const data = stair(plans.filter((p) => !p.unlimited), (p) => Number(p.gb) * 1000 + Number(p.days));
    const unl = stair(plans.filter((p) => p.unlimited), (p) => Number(p.days));
    const out = [...data, ...unl];
    if (!out.some((p) => p.popular)) markPopular(out);
    return out;
  };
  for (const c of Object.values<any>(body.esim?.countries ?? {})) c.plans = fix(c.plans);
  for (const c of Object.values<any>(body.esim?.regions ?? {})) c.plans = fix(c.plans);
  if (body.esim?.global) body.esim.global.plans = fix(body.esim.global.plans);
  return body;
}
