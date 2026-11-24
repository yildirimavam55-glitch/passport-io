/* ==========================================================================
   passport.io – Preisregel (gemeinsam für Preis-Funktion und Verwaltungspanel)
   --------------------------------------------------------------------------
   Grundlage ist immer der EINKAUFSPREIS aus der Anbieter-API (Grundregel: keine erfundenen Preise).
   1. Gibt es für dasselbe Produkt (gleiches Land/Region, gleiches Volumen, gleiche Laufzeit)
      einen aktiven Wettbewerbspreis (z. B. Airalo) → einen Tick darunter, auf ,99 abgerundet:
      höchster ,99-Preis, der unter dem günstigsten Wettbewerber liegt (10,06 → 9,99 · 9,99 → 8,99).
   2. Sonst → Einkaufspreis × markup_factor (Standard 2), auf den nächsten ,99-Preis gerundet.
   3. Untergrenzen: nie unter min_price_eur (2,99 €) und nie unter Einkauf + min_margin_pct
      (Schutz vor Verkauf mit Verlust; 0 % = nie unter Einkauf).
   Der Einkaufspreis wird nie öffentlich ausgeliefert.
   ========================================================================== */
// deno-lint-ignore-file no-explicit-any
export type Settings = { markup_factor: number; undercut_eur: number; min_price_eur: number; min_margin_pct: number; round_99: boolean };
export type Competitor = { item_key: string; gb: number | null; days: number | null; price: number; currency: string; competitor: string; active?: boolean };
export const DEFAULTS: Settings = { markup_factor: 2, undercut_eur: 0.01, min_price_eur: 2.99, min_margin_pct: 10, round_99: true };

const r2 = (n: number) => Math.round(n * 100) / 100;
// Nächstgelegener ,99-Preis (14,00 → 13,99 · 7,80 → 7,99); die Untergrenzen werden danach geprüft
const up99 = (n: number) => { const lo = Math.floor(n) - 0.01, hi = Math.floor(n) + 0.99; return r2(n - lo <= hi - n ? lo : hi); };
const ceil99 = (n: number) => { const c = Math.ceil(n) - 0.01; return r2(c >= n ? c : c + 1); };
// Höchster ,99-Preis ≤ n (10,05 → 9,99 · 9,98 → 8,99 · 9,99 → 9,99)
const floor99 = (n: number) => { const c = Math.floor(r2(n)) + 0.99; return r2(c <= r2(n) ? c : c - 1); };

export async function loadSettings(db: any): Promise<Settings> {
  const { data } = await db.from("pricing_settings").select("*").eq("id", 1).maybeSingle();
  return data ? {
    markup_factor: Number(data.markup_factor), undercut_eur: Number(data.undercut_eur), min_price_eur: Number(data.min_price_eur),
    min_margin_pct: Number(data.min_margin_pct), round_99: !!data.round_99,
  } : DEFAULTS;
}
export async function loadCompetitors(db: any): Promise<Competitor[]> {
  const { data } = await db.from("competitor_prices").select("item_key, gb, days, price, currency, competitor").eq("active", true).limit(5000);
  return (data ?? []).map((c: any) => ({ ...c, gb: c.gb == null ? null : Number(c.gb), days: c.days == null ? null : Number(c.days), price: Number(c.price) }));
}

/**
 * Wendet die Preisregel an. body = Anbieterdaten mit Einkaufspreisen (Feld price = Einkauf) in body.currency.
 * toBase(betrag, währung) rechnet in die Anbieterwährung um (null = kein Kurs → Wettbewerber wird ignoriert).
 * debug = true lässt Einkauf und angewandte Regel für das Verwaltungspanel stehen.
 */
export function applyPricing(body: any, s: Settings, comps: Competitor[], toBase: (n: number, cur: string) => number | null, debug = false) {
  const out = structuredClone(body);
  const eur = (n: number) => toBase(n, "EUR") ?? n;
  const minPrice = eur(s.min_price_eur), undercut = eur(s.undercut_eur);

  const price = (key: string, cost: number, gb: number | null, days: number | null) => {
    const matches = comps.filter((c) => c.item_key === key && (c.gb == null || gb == null || Number(c.gb) === Number(gb)) && (c.days == null || days == null || Number(c.days) === Number(days)));
    const prices = matches.map((c) => ({ c, v: toBase(c.price, c.currency) })).filter((x) => x.v != null && x.v > 0) as { c: Competitor; v: number }[];
    const floor = Math.max(minPrice, cost * (1 + s.min_margin_pct / 100));
    let value: number, rule: string, competitor: string | undefined;
    if (prices.length) {
      const best = prices.reduce((a, b) => (b.v < a.v ? b : a));
      // „Ein Tick“ darunter (mind. 1 Cent), dann auf ,99 abrunden → immer günstiger als der Wettbewerber
      const target = best.v - Math.max(undercut, 0.01);
      value = s.round_99 ? floor99(target) : r2(target); rule = "competitor"; competitor = `${best.c.competitor} ${r2(best.v)}`;
    } else {
      value = cost * s.markup_factor; rule = "markup";
      if (s.round_99) value = up99(value);
    }
    if (value < floor) { value = s.round_99 ? ceil99(floor) : r2(Math.ceil(floor * 100) / 100); rule += "+floor"; }
    return { value: r2(value), rule, competitor };
  };

  const plans = (key: string, list: any[] | undefined) => list?.forEach((p) => {
    const cost = Number(p.price);
    const res = price(key, cost, p.gb ?? null, p.days ?? null);
    p.price = res.value;
    if (debug) { p.cost = cost; p.rule = res.rule; if (res.competitor) p.competitor = res.competitor; }
  });
  for (const [code, c] of Object.entries<any>(out.esim?.countries ?? {})) plans(`country:${code}`, c.plans);
  for (const [id, c] of Object.entries<any>(out.esim?.regions ?? {})) plans(`region:${id}`, c.plans);
  plans("global", out.esim?.global?.plans);
  for (const k of ["lounge", "fasttrack", "vignette"]) {
    if (out[k]?.from == null) continue;
    const cost = Number(out[k].from);
    const res = price(k, cost, null, null);
    out[k].from = res.value;
    if (debug) { out[k].cost = cost; out[k].rule = res.rule; }
  }
  out.pricing = { rule: "competitor-undercut / markup", min_price_eur: s.min_price_eur };
  return out;
}
