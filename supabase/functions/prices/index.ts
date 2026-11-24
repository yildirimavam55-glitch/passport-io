/* ==========================================================================
   passport.io – Preis-Proxy (Supabase Edge Function)
   --------------------------------------------------------------------------
   GRUNDREGEL: Alle Preise der Webseite kommen von hier – und hierher nur von
   den APIs der Anbieter (eSIM, Lounge, Fast Track, Vignette). Keine Ausnahme.

   - API-Schlüssel liegen NUR als Secrets in Supabase (Dashboard → Edge Functions
     → Secrets), nie im Browser und nie im GitHub-Repository.
   - Antworten der Anbieter werden in EIN Format übersetzt (siehe api/prices.json,
     Testdaten im selben Format).
   - Zwischenspeicher: Tabelle public.price_cache. Anbieter werden höchstens alle
     CACHE_SECONDS abgefragt. Fällt ein Anbieter aus, bleibt der letzte gültige
     Stand stehen – erfundene Preise gibt es nie.

   Secrets: ESIMACCESS_ACCESS_CODE, ESIMGO_API_KEY (siehe _shared/esim-provider.ts), LOUNGE_API_URL, LOUNGE_API_KEY,
            FASTTRACK_API_URL, FASTTRACK_API_KEY, (später VIGNETTE_API_URL/KEY)
            ALLOWED_ORIGINS (kommagetrennt, z. B. https://passport.io,https://<name>.github.io)
   SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase automatisch bereit.
   ========================================================================== */

import { createClient } from "jsr:@supabase/supabase-js@2";
// Testdaten (gleiches Format wie die Live-Antwort) – nur solange KEIN eSIM-Anbieter eingetragen ist.
import MOCK from "../_shared/mock.json" with { type: "json" };
import { applyPricing, loadCompetitors, loadSettings } from "../_shared/pricing.ts";
import { accessOn, type Catalog, esimAccessCatalog, goTier, esimGoCatalog, goOn, mergeCatalogs, providerConfigured } from "../_shared/esim-provider.ts";

const CACHE_SECONDS = 15 * 60;
/* ---------- Währungen ----------
   Anbieterpreise kommen in ihrer Währung (meist EUR). Andere Währungen werden mit dem
   offiziellen Tageskurs der Europäischen Zentralbank (über api.frankfurter.dev) umgerechnet.
   Erlaubte Währungen: Secret CURRENCIES (z. B. "EUR,USD,GBP,TRY,CHF"). Keine festen Kurse im Code. */
const FX_SECONDS = 6 * 60 * 60;
const currencies = () => (Deno.env.get("CURRENCIES") ?? "EUR,USD,GBP,TRY,CHF").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

type Plan = { id: string; gb: number; days: number; price: number; popular?: boolean; name?: string; countries?: number; unlimited?: boolean };
type Esim = { countries: Record<string, { plans: Plan[] }>; regions: Record<string, { plans: Plan[] }>; global: { plans: Plan[] } };
const EMPTY_ESIM: Esim = { countries: {}, regions: {}, global: { plans: [] } };

function cors(req: Request) {
  const allowed = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": !allowed.length || allowed.includes(origin) ? origin || "*" : allowed[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    Vary: "Origin",
  };
}

/* Hilfsfunktion für Anbieter-Aufrufe */
async function call(url: string, key: string, path = "") {
  if (!url) return null;
  const res = await fetch(url.replace(/\/$/, "") + path, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${url}${path} → HTTP ${res.status}`);
  return res.json();
}
const round = (n: unknown) => Math.round(Number(n) * 100) / 100;

/* ---------- Adapter: eSIM-Anbieter (eSIM Access = Datenvolumen, eSIM Go = Unlimited) ----------
   Einkaufspreise werden in EUR umgerechnet (EZB-Kurs). Ohne Kurs fällt der Tarif weg – nie geschätzt.
   Jeder Katalog hat einen eigenen Zwischenspeicher: eSIM Access 1 h, eSIM Go 6 h (eSIM Go bittet um
   seltene Katalogabfragen). Fällt ein Anbieter aus, bleibt sein letzter gültiger Stand stehen. */
// Zustand je Anbieter (nur Fehlercode/-text des Anbieters, nie Schlüssel) – hilft bei falschem Schlüssel o. Ä.
const providerState: Record<string, string> = {};
const countPlans = (c: Catalog | null) => c ? Object.values(c.countries).reduce((n, x) => n + x.plans.length, 0) + Object.values(c.regions).reduce((n, x) => n + x.plans.length, 0) + c.global.plans.length : 0;
async function cachedCatalog(id: string, ttl: number, load: () => Promise<Catalog | null>): Promise<Catalog | null> {
  const name = id.replace("cat:", "").replace(/[0-9]+(-[a-z]+)?$/, "");
  const { data: row } = await db.from("price_cache").select("body, updated_at").eq("id", id).maybeSingle();
  if (row && countPlans(row.body) > 0 && (Date.now() - new Date(row.updated_at).getTime()) / 1000 < ttl) { providerState[name] = `ok (${countPlans(row.body)} Tarife, Zwischenspeicher)`; return row.body; }
  try {
    const cat = await load();
    if (!cat) { providerState[name] = "nicht eingerichtet"; return null; }
    providerState[name] = `ok (${countPlans(cat)} Tarife)`;
    if (countPlans(cat) > 0) await db.from("price_cache").upsert({ id, body: cat, updated_at: new Date().toISOString() });
    return cat;
  } catch (err) {
    console.error(err);
    providerState[name] = "Fehler: " + String((err as Error).message).replace(/[A-Za-z0-9_-]{24,}/g, "…").slice(0, 200);
    return row?.body ?? null;
  }
}
async function esim(): Promise<Esim | null> {
  if (!providerConfigured()) return null;
  const fx = await rates("EUR");
  const toEur = (n: number, cur: string) => { cur = (cur || "EUR").toUpperCase(); if (cur === "EUR") return n; const r = fx?.rates?.[cur]; return r ? n / r : null; };
  const [a, g] = await Promise.all([
    cachedCatalog("cat:esimaccess4", 3600, () => esimAccessCatalog(toEur)),
    cachedCatalog(`cat:esimgo6-${goTier()}`, 6 * 3600, () => esimGoCatalog(toEur)),
  ]);
  if (!a && !g) throw new Error("Kein eSIM-Katalog verfügbar");
  return mergeCatalogs(a, g) as Esim;
}

/* ---------- Adapter: „ab“-Preise (Lounge, Fast Track, Vignette) ---------- */
async function fromPrice(prefix: string) {
  const raw = await call(env(`${prefix}_API_URL`), env(`${prefix}_API_KEY`), "/products");
  if (!raw) return null;
  // TODO: an die Felder des jeweiligen Anbieters anpassen
  // deno-lint-ignore no-explicit-any
  const prices = ((raw.data || raw.products || []) as any[]).map((p) => Number(p.wholesale_price ?? p.net_price ?? p.cost ?? p.price)).filter((n) => n > 0); // Einkaufspreise
  return { from: prices.length ? round(Math.min(...prices)) : null };
}

async function fetchAll(previous: Record<string, unknown> | null) {
  const results = await Promise.allSettled([esim(), fromPrice("LOUNGE"), fromPrice("FASTTRACK"), fromPrice("VIGNETTE")]);
  results.forEach((r) => r.status === "rejected" && console.error(r.reason));
  const keys = ["esim", "lounge", "fasttrack", "vignette"] as const;
  const body: Record<string, unknown> = { source: "live", currency: "EUR", updatedAt: new Date().toISOString(), providers: { ...providerState } };
  keys.forEach((k, i) => {
    const r = results[i];
    // Anbieter ok → neuer Wert; Anbieter weg → letzter gültiger Stand; nie etwas Erfundenes
    body[k] = r.status === "fulfilled" && r.value ? r.value : previous?.[k] ?? (k === "esim" ? EMPTY_ESIM : { from: null });
  });
  return body;
}

/* Wechselkurse (EZB) – zwischengespeichert in price_cache unter "fx:<Basis>" */
async function rates(base: string): Promise<{ date: string; rates: Record<string, number> } | null> {
  const id = `fx:${base}`;
  const { data: row } = await db.from("price_cache").select("body, updated_at").eq("id", id).maybeSingle();
  if (row && (Date.now() - new Date(row.updated_at).getTime()) / 1000 < FX_SECONDS) return row.body;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
    const j = await res.json();
    const body = { date: j.date, rates: j.rates };
    await db.from("price_cache").upsert({ id, body, updated_at: new Date().toISOString() });
    return body;
  } catch (err) {
    console.error(err);
    return row?.body ?? null; // letzter bekannter offizieller Kurs, sonst keine Umrechnung
  }
}

/* Alle Preisfelder umrechnen (Pakete + „ab“-Preise) */
// deno-lint-ignore no-explicit-any
function convert(body: any, rate: number) {
  const out = structuredClone(body);
  const plans = (g: { plans?: Plan[] } | undefined) => g?.plans?.forEach((p) => (p.price = round(p.price * rate)));
  Object.values(out.esim?.countries ?? {}).forEach((c) => plans(c as { plans: Plan[] }));
  Object.values(out.esim?.regions ?? {}).forEach((c) => plans(c as { plans: Plan[] }));
  plans(out.esim?.global);
  for (const k of ["lounge", "fasttrack", "vignette"]) if (out[k]?.from != null) out[k].from = round(out[k].from * rate);
  return out;
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" } });

  // deno-lint-ignore no-explicit-any
  let body: any = null;
  if (!providerConfigured()) {
    // Noch kein Anbieter angebunden → Testdaten (auf der Seite als „Testdaten“ gekennzeichnet)
    body = { ...structuredClone(MOCK), source: "mock" };
  } else {
    const { data: row } = await db.from("price_cache").select("body, updated_at").eq("id", "current3").maybeSingle();
    body = row?.body ?? null;
    const age = row ? (Date.now() - new Date(row.updated_at).getTime()) / 1000 : Infinity;
    // Leerer Katalog (z. B. Schlüssel falsch) → nach 60 s erneut versuchen statt 15 min warten
    const empty = !Object.keys(body?.esim?.countries ?? {}).length;
    // Neu eingetragener oder zuletzt fehlerhafter Anbieter → sofort neu laden (höchstens alle 60 s)
    const pv = body?.providers ?? {};
    const pending = (accessOn() && !String(pv.esimaccess ?? "").startsWith("ok")) || (goOn() && !String(pv.esimgo ?? "").startsWith("ok"));
    if (!body || age > CACHE_SECONDS || ((empty || pending) && age > 60)) {
      try {
        body = await fetchAll(body);
        await db.from("price_cache").upsert({ id: "current3", body, updated_at: new Date().toISOString() });
      } catch (err) {
        console.error(err);
        if (!body) return json({ error: "prices_unavailable" }, 503);
      }
    }
  }

  // Tarif-Details eines Landes/einer Region (?item=country:de) – ohne Preise, nur Anbieterinformationen
  const params = new URL(req.url).searchParams;
  const item = params.get("item");
  if (item && /^(country:[a-z]{2}|region:[a-z0-9-]+|global)$/.test(item)) {
    const [type, id] = item.split(":");
    const E = body.esim ?? {};
    const list = (type === "country" ? E.countries?.[id]?.plans : type === "region" ? E.regions?.[id]?.plans : E.global?.plans) ?? [];
    // deno-lint-ignore no-explicit-any
    return json({ item, plans: list.map((p: any) => ({ id: p.id, meta: p.meta ?? null })) });
  }

  // Preisregel anwenden (Einkauf → Verkaufspreis); Einkaufspreise verlassen die Funktion nie
  {
    const base0 = body.currency ?? "EUR";
    const fx0 = await rates(base0); // für Wettbewerbspreise in anderen Währungen
    const toBase = (n: number, cur: string) => { cur = (cur || "EUR").toUpperCase(); if (cur === base0) return n; const r = fx0?.rates?.[cur]; return r ? n / r : null; };
    const [settings, comps] = await Promise.all([loadSettings(db), loadCompetitors(db)]);
    body = applyPricing(body, settings, comps, toBase);
  }

  // Gewünschte Währung (?currency=TRY). Ohne Kurs bleibt es bei der Anbieterwährung – nie ein geschätzter Wert.
  const want = (new URL(req.url).searchParams.get("currency") ?? "").toUpperCase();
  const base = body.currency ?? "EUR";
  if (want && want !== base && currencies().includes(want)) {
    const fx = await rates(base);
    const rate = fx?.rates?.[want];
    if (rate) body = { ...convert(body, rate), currency: want, fx: { base, rate, date: fx!.date, source: "ECB" } };
  }
  body.currencies = currencies();
  // Details nicht im Hauptabruf (klein halten) – die Seite lädt sie pro Land über ?item=
  // deno-lint-ignore no-explicit-any
  const strip = (g: any) => g?.plans?.forEach((p: any) => delete p.meta);
  Object.values(body.esim?.countries ?? {}).forEach(strip); Object.values(body.esim?.regions ?? {}).forEach(strip); strip(body.esim?.global);

  return new Response(JSON.stringify(body), {
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
});
