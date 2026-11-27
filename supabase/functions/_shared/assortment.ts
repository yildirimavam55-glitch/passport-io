/* ==========================================================================
   passport.io – Sortiment und logische Preisstaffel
   --------------------------------------------------------------------------
   1. Festes Sortiment für jedes Land/jede Region:
      Standard: 1, 2, 3, 5, 10, 20, 50 GB – je Größe EIN Paket (bevorzugt 30 Tage,
      sonst die längste Laufzeit bis 30 Tage, sonst die nächstlängere).
      Unlimited: 3, 5, 7, 10, 15, 30 Tage.
      Hat der Anbieter eine Größe nicht, fehlt sie einfach (nie erfundene Pakete).
   2. Preisstaffel nach der Preisregel: ein kleineres Paket kostet nie mehr als ein
      größeres. Es wird mindestens 1 € unter das größere gesenkt – fiele es dadurch unter die
      Untergrenze (Mindestpreis/Verlustschutz), wird es ausgeblendet (nie zwei Pakete zum gleichen Preis).
   ========================================================================== */
// deno-lint-ignore-file no-explicit-any

const SIZES = [1, 2, 3, 5, 10, 20, 50];
/** Wunsch-Sortiment (GB → Laufzeiten). Fehlt eine Größe ganz, wird die beste vorhandene Laufzeit genommen. */
const SHAPES: Record<number, number[]> = { 1: [7], 2: [15], 3: [15, 30], 5: [30], 10: [30], 20: [30], 50: [30, 180] };
const UNL_DAYS = new Set([3, 5, 7, 10, 15, 30]);

/* „Beliebt“ je Ziel: Größe nach typischer Aufenthaltsdauer und Nutzung (Recherche 11/2026):
   - 8–14 Tage → meist 3–5 GB, 15–30 Tage → meist 10 GB (Bcengi Data Usage Report 2026)
   - Türkei Ø 10,7 Tage, dazu lange Heimatbesuche; Spanien 5,3, Italien 7,8, Griechenland 6,8 (KPMG Türkiye 2025)
   - Japan: Median 4,7 GB pro Reise, ~1 GB/Tag (Travelsim Asia 2026) – eine Größe mehr kostet nur ~11 % extra
   Fernreisen und lange Aufenthalte → 10 GB, kurze Europa-/Städtereisen → 5 GB. Regionen (Rundreisen) → 10 GB. */
const POPULAR_GB: Record<string, number> = {
  tr: 10, ma: 10, dz: 10, tn: 10, th: 10, id: 10, vn: 10, ph: 10, jp: 10, kr: 10, cn: 10, us: 10, ca: 10, mx: 10, br: 10, au: 10, nz: 10, in: 10, lk: 10, mv: 10,
};
const REGION_GB = 10, DEFAULT_GB = 5;

const markPopular = (out: any[], key = "") => {
  out.forEach((p) => delete p.popular);
  const d = out.filter((p) => !p.unlimited);
  const want = key.startsWith("region:") ? REGION_GB : (POPULAR_GB[key.replace("country:", "")] ?? DEFAULT_GB);
  // gewünschte Größe, sonst die nächstgrößere, sonst die größte vorhandene darunter
  const pop = d.find((p) => Number(p.gb) === want)
    ?? d.filter((p) => Number(p.gb) > want).sort((a, b) => Number(a.gb) - Number(b.gb))[0]
    ?? d.sort((a, b) => Number(b.gb) - Number(a.gb))[0];
  if (pop) pop.popular = true;
};

/** Laufzeit-Vorliebe: 30 Tage > längste bis 30 > kürzeste darüber */
const daysRank = (d: number) => (d === 30 ? 0 : d < 30 ? 1000 - d : 2000 + d);

export function applyAssortment(body: any) {
  const pick = (plans: any[] | undefined, key = "") => {
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
    markPopular(out, key);
    return out;
  };
  for (const [k, c] of Object.entries<any>(body.esim?.countries ?? {})) c.plans = pick(c.plans, "country:" + k);
  for (const [k, c] of Object.entries<any>(body.esim?.regions ?? {})) c.plans = pick(c.plans, "region:" + k);
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
        // möglichst einen Tick (1 €, bleibt auf ,99) unter dem größeren Paket – geht das nicht, ausblenden:
        // zwei Pakete zum gleichen Preis verwirren (niemand kauft dann das kleinere)
        const below = Math.round((cap - 1) * 100) / 100, fl = floorOf(p);
        if (below >= fl) p.price = Math.min(Number(p.price), below);
        else { drop.add(p); continue; }
      }
      cap = Math.min(cap, Number(p.price));
    }
    return list.filter((p) => !drop.has(p));
  };
  const fix = (plans: any[] | undefined, key = "") => {
    if (!plans?.length) return plans;
    const data = stair(plans.filter((p) => !p.unlimited), (p) => Number(p.gb) * 1000 + Number(p.days));
    const unl = stair(plans.filter((p) => p.unlimited), (p) => Number(p.days));
    const out = [...data, ...unl];
    if (!out.some((p) => p.popular)) markPopular(out, key);
    return out;
  };
  for (const [k, c] of Object.entries<any>(body.esim?.countries ?? {})) c.plans = fix(c.plans, "country:" + k);
  for (const [k, c] of Object.entries<any>(body.esim?.regions ?? {})) c.plans = fix(c.plans, "region:" + k);
  if (body.esim?.global) body.esim.global.plans = fix(body.esim.global.plans, "region:global");
  return body;
}
