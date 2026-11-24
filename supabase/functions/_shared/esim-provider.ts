/* ==========================================================================
   eSIM-Anbieter-Adapter – zwei Anbieter
   --------------------------------------------------------------------------
   • eSIM Access  → Tarife mit festem Datenvolumen   (https://docs.esimaccess.com)
   • eSIM Go      → Unlimited-Tarife                 (https://docs.esim-go.com/api/v2_5)

   Secrets in Supabase (Edge Functions → Secrets) – nie im Browser, nie im Repository:
     ESIMACCESS_ACCESS_CODE   AccessCode aus console.esimaccess.com → Developer
     ESIMGO_API_KEY           API-Schlüssel aus sso.esim-go.com → Account Settings → API Details
     ESIMGO_CURRENCY          Währung eures eSIM-Go-Kontos (Standard USD)
   Ist keiner gesetzt, laufen Testdaten. Tarif-IDs tragen den Anbieter vorne: "ea:<packageCode>" / "eg:<bundle>".
   ========================================================================== */
// deno-lint-ignore-file no-explicit-any
import { env } from "./http.ts";

export type CatalogPlan = { id: string; gb: number; days: number; price: number; unlimited?: boolean; name?: string; countries?: number; popular?: boolean };
export type Catalog = { countries: Record<string, { plans: CatalogPlan[] }>; regions: Record<string, { plans: CatalogPlan[] }>; global: { plans: CatalogPlan[] } };
export type Provisioned = {
  iccid: string | null; lpa: string | null; smdp_address: string | null; activation_code: string | null;
  data_total_mb: number | null; validity_days: number; provider_ref: string; provider: string; test: boolean; unlimited: boolean; status: string;
};
export type Refresh = Record<string, unknown>;

const EA = "https://api.esimaccess.com/api/v1/open";
const EG = "https://api.esim-go.com/v2.5";
const MB = 1024 * 1024, GB = 1024 * MB;
export const accessOn = () => Boolean(env("ESIMACCESS_ACCESS_CODE"));
export const goOn = () => Boolean(env("ESIMGO_API_KEY"));
export const providerConfigured = () => accessOn() || goOn();
export const goCurrency = () => (env("ESIMGO_CURRENCY") || "USD").toUpperCase();

/* ---------- HTTP ---------- */
async function ea(path: string, body: unknown = {}) {
  const r = await fetch(EA + path, {
    method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(25_000),
    headers: { "RT-AccessCode": env("ESIMACCESS_ACCESS_CODE").trim(), "Content-Type": "application/json" },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) { const e: any = new Error(`eSIM Access ${path}: ${j?.errorCode ?? r.status} ${j?.errorMsg ?? ""}`); e.code = j?.errorCode; throw e; }
  return j.obj;
}
async function eg(path: string, init: RequestInit = {}) {
  const r = await fetch(EG + path, {
    ...init, signal: AbortSignal.timeout(25_000),
    headers: { "X-API-Key": env("ESIMGO_API_KEY").trim(), "Content-Type": "application/json", Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`eSIM Go ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/* ---------- Region aus dem Tarifnamen (unsere Regionen: eu, asia, na, me, latam, af, global) ---------- */
const REGION_WORDS: [RegExp, string][] = [
  [/global|world|worldwide/i, "global"], [/middle east|mena|gulf/i, "me"], [/europe|\beu\b|euro/i, "eu"],
  [/north america|usa? ?(&|and|\+) ?canada/i, "na"], [/latin|south america|central america|caribbean|americas/i, "latam"],
  [/africa/i, "af"], [/asia|apac/i, "asia"],
];
const regionOf = (text: string) => REGION_WORDS.find(([re]) => re.test(text))?.[1] ?? null;

function add(cat: Catalog, kind: "country" | "region" | "global", key: string, plan: CatalogPlan) {
  const list = kind === "global" ? cat.global.plans : kind === "region" ? (cat.regions[key] ??= { plans: [] }).plans : (cat.countries[key] ??= { plans: [] }).plans;
  // Pro Volumen/Laufzeit nur EIN Tarif: Länder → günstigster, Regionen/Global → meiste Länder (dann günstigster)
  const same = list.findIndex((p) => p.gb === plan.gb && p.days === plan.days && !!p.unlimited === !!plan.unlimited);
  if (same < 0) return list.push(plan);
  const old = list[same];
  const better = kind === "country" ? plan.price < old.price : (plan.countries ?? 0) > (old.countries ?? 0) || ((plan.countries ?? 0) === (old.countries ?? 0) && plan.price < old.price);
  if (better) list[same] = plan;
}

/** Einkaufspreise beider Anbieter; toEur rechnet Anbieterwährung → EUR (null = kein Kurs → Tarif fällt weg). */
export async function esimAccessCatalog(toEur: (n: number, cur: string) => number | null): Promise<Catalog | null> {
  if (!accessOn()) return null;
  const obj = await ea("/package/list", { locationCode: "", type: "BASE", packageCode: "", iccid: "" });
  const cat: Catalog = { countries: {}, regions: {}, global: { plans: [] } };
  for (const p of (obj?.packageList ?? []) as any[]) {
    if (p.dataType != null && Number(p.dataType) !== 1) continue;            // nur „Daten gesamt“ – Tagespässe/Unlimited kommen von eSIM Go
    if ((p.durationUnit ?? "DAY") !== "DAY") continue;
    const gb = Math.round((Number(p.volume) / GB) * 100) / 100, days = Number(p.duration);
    const cost = toEur(Number(p.price) / 10000, p.currencyCode || "USD");   // price = USD × 10 000
    // 999 GB u. Ä. sind verkappte Unlimited-Tarife – Unlimited kommt von eSIM Go
    if (!(gb >= 1) || gb > 200 || !(days > 0) || !cost) continue;
    const locs = String(p.location ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const plan: CatalogPlan = { id: `ea:${p.packageCode}`, gb, days, price: Math.round(cost * 100) / 100 };
    if (locs.length === 1) add(cat, "country", locs[0].toLowerCase(), plan);
    else {
      const reg = regionOf(`${p.name} ${p.description ?? ""}`);
      if (reg) add(cat, reg === "global" ? "global" : "region", reg, { ...plan, name: p.name, countries: locs.length });
    }
  }
  return cat;
}

export async function esimGoCatalog(toEur: (n: number, cur: string) => number | null): Promise<Catalog | null> {
  if (!goOn()) return null;
  const cat: Catalog = { countries: {}, regions: {}, global: { plans: [] } };
  const cur = goCurrency();
  for (let page = 1; page <= 40; page++) {
    const raw = await eg(`/catalogue?page=${page}&perPage=200`);
    const list: any[] = Array.isArray(raw) ? raw : raw?.bundles ?? [];
    for (const b of list) {
      if (!b.unlimited) continue;                                             // eSIM Go liefert bei uns nur Unlimited
      const days = Number(b.duration), cost = toEur(Number(b.price), cur);
      if (!(days > 0) || !cost) continue;
      const isos = (b.countries ?? []).map((c: any) => String(c.iso ?? c.country?.iso ?? "").toLowerCase()).filter(Boolean);
      const plan: CatalogPlan = { id: `eg:${b.name}`, gb: 0, days, price: Math.round(cost * 100) / 100, unlimited: true };
      if (isos.length === 1) add(cat, "country", isos[0], plan);
      else {
        const reg = regionOf(`${b.description ?? ""} ${b.name ?? ""} ${(b.countries ?? [])[0]?.region ?? ""}`);
        if (reg) add(cat, reg === "global" ? "global" : "region", reg, { ...plan, name: b.description, countries: isos.length });
      }
    }
    const pages = Number(raw?.pageCount ?? 0);
    if (!list.length || (pages && page >= pages) || (!pages && list.length < 200)) break;
  }
  return cat;
}

/** Zwei Kataloge zusammenführen und je Land einen „beliebten“ Tarif markieren (5 GB / 30 Tage, sonst Mitte) */
export function mergeCatalogs(...cats: (Catalog | null)[]): Catalog {
  const out: Catalog = { countries: {}, regions: {}, global: { plans: [] } };
  for (const c of cats) {
    if (!c) continue;
    for (const [k, v] of Object.entries(c.countries)) (out.countries[k] ??= { plans: [] }).plans.push(...v.plans);
    for (const [k, v] of Object.entries(c.regions)) (out.regions[k] ??= { plans: [] }).plans.push(...v.plans);
    out.global.plans.push(...c.global.plans);
  }
  const mark = (plans: CatalogPlan[]) => {
    plans.sort((a, b) => Number(!!a.unlimited) - Number(!!b.unlimited) || a.gb - b.gb || a.days - b.days);
    const data = plans.filter((p) => !p.unlimited);
    const pick = data.find((p) => p.gb === 5 && p.days === 30) ?? data[Math.floor(data.length / 2)];
    if (pick) pick.popular = true;
  };
  Object.values(out.countries).forEach((c) => mark(c.plans));
  Object.values(out.regions).forEach((c) => mark(c.plans));
  return out;
}

/* ---------- Bestellung ---------- */
const parseLpa = (ac: string) => { const [, smdp, code] = String(ac || "").split("$"); return { smdp: smdp ?? null, code: code ?? null }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function testEsim(plan: { gb: number; days: number; unlimited?: boolean }): Provisioned {
  // Test-eSIM: nur zum Ausprobieren des Kundenbereichs. Funktioniert NICHT auf einem echten Telefon.
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase();
  return {
    iccid: "TEST" + Date.now(), smdp_address: "test.smdp.invalid", activation_code: code, lpa: `LPA:1$test.smdp.invalid$${code}`,
    data_total_mb: plan.unlimited ? null : Math.round(plan.gb * 1024), validity_days: plan.days, provider_ref: "test-" + code,
    provider: "test", test: true, unlimited: !!plan.unlimited, status: "ready",
  };
}

/** eSIM Access: Profil aus der Abfrage in unser Format */
function eaProfile(e: any): Partial<Provisioned> & Refresh {
  const { smdp, code } = parseLpa(e.ac);
  return {
    iccid: e.iccid || null, lpa: e.ac || null, smdp_address: smdp, activation_code: code,
    data_total_mb: e.totalVolume ? Math.round(Number(e.totalVolume) / MB) : null, provider_ref: `ea:${e.esimTranNo}`,
  };
}

/**
 * Bestellt eine eSIM. ref = unsere Bestell-ID (eSIM Access erkennt doppelte Anfragen daran).
 * test = true → nie eine echte eSIM (Testmodus ohne Zahlung).
 */
export async function provision(plan: { id: string; gb: number; days: number; unlimited?: boolean }, opts: { ref: string; test?: boolean }): Promise<Provisioned> {
  const [prov, ...rest] = String(plan.id).split(":");
  const code = rest.join(":");
  if (opts.test || !providerConfigured() || !code) {
    if (env("ALLOW_TEST_ORDERS") !== "true") throw new Error("Kein eSIM-Anbieter angebunden.");
    return testEsim(plan);
  }
  if (prov === "ea") {
    if (!accessOn()) throw new Error("ESIMACCESS_ACCESS_CODE fehlt");
    const o = await ea("/esim/order", { transactionId: opts.ref, packageInfoList: [{ packageCode: code, count: 1 }] });
    // Profile werden asynchron erzeugt (bis ca. 30 s) – kurz warten, sonst später nachladen
    for (let i = 0; i < 12; i++) {
      await sleep(i === 0 ? 2000 : 3500);
      try {
        const q = await ea("/esim/query", { orderNo: o.orderNo, iccid: "", pager: { pageNum: 1, pageSize: 5 } });
        const e = q?.esimList?.[0];
        if (e?.ac) return { ...eaProfile(e), validity_days: plan.days, provider: "esimaccess", test: false, unlimited: false, status: "ready" } as Provisioned;
      } catch (err: any) { if (err.code !== "200010") throw err; }
    }
    return { iccid: null, lpa: null, smdp_address: null, activation_code: null, data_total_mb: Math.round(plan.gb * 1024), validity_days: plan.days,
      provider_ref: `ea-order:${o.orderNo}`, provider: "esimaccess", test: false, unlimited: false, status: "processing" };
  }
  if (prov === "eg") {
    if (!goOn()) throw new Error("ESIMGO_API_KEY fehlt");
    const o = await eg("/orders", { method: "POST", body: JSON.stringify({ type: "transaction", assign: true, order: [{ type: "bundle", quantity: 1, item: code, allowReassign: false }] }) });
    let e = o?.order?.[0]?.esims?.[0];
    if (!e?.matchingId && o?.orderReference) {
      const a = await eg(`/esims/assignments?reference=${encodeURIComponent(o.orderReference)}`);
      e = Array.isArray(a) ? a[0] : a;
    }
    if (!e?.iccid) throw new Error(`eSIM Go: keine eSIM in der Antwort (Bestellung ${o?.orderReference ?? "?"})`);
    return {
      iccid: e.iccid, smdp_address: e.smdpAddress ?? null, activation_code: e.matchingId ?? null,
      lpa: e.smdpAddress && e.matchingId ? `LPA:1$${e.smdpAddress}$${e.matchingId}` : null,
      data_total_mb: null, validity_days: plan.days, provider_ref: `eg:${e.iccid}:${code}`, provider: "esimgo", test: false, unlimited: true, status: "ready",
    };
  }
  throw new Error(`Unbekannter Anbieter in Tarif-ID: ${plan.id}`);
}

/* ---------- Verbrauch & Status ---------- */
const eaStatus = (e: any) => {
  if (["CANCEL", "REVOKED"].includes(e.esimStatus) || e.smdpStatus === "DELETED") return "cancelled";
  if (e.esimStatus === "USED_UP") return "depleted";
  if (e.esimStatus === "USED_EXPIRED" || e.esimStatus === "UNUSED_EXPIRED") return "expired";
  if (Number(e.orderUsage) > 0 || e.esimStatus === "IN_USE") return "active";
  if (["ENABLED", "DISABLED"].includes(e.smdpStatus)) return "installed";
  return "ready";
};
const egStatus: Record<string, string> = { processing: "ready", queued: "ready", active: "active", depleted: "depleted", expired: "expired", lapsed: "expired", revoked: "cancelled" };

/** Neuer Stand einer eSIM beim Anbieter (Felder für die Tabelle esims) – null = nichts Neues */
export async function refresh(providerRef: string): Promise<Refresh | null> {
  if (!providerRef || providerRef.startsWith("test-")) return null;
  const [prov, a, ...b] = providerRef.split(":");
  if ((prov === "ea" || prov === "ea-order") && accessOn()) {
    const q = await ea("/esim/query", prov === "ea" ? { esimTranNo: a, iccid: "", pager: { pageNum: 1, pageSize: 5 } } : { orderNo: a, iccid: "", pager: { pageNum: 1, pageSize: 5 } })
      .catch((err: any) => { if (err.code === "200010") return null; throw err; });
    const e = q?.esimList?.[0];
    if (!e) return null;
    return {
      ...(prov === "ea-order" || e.ac ? eaProfile(e) : {}),
      data_used_mb: Math.round(Number(e.orderUsage || 0) / MB), status: eaStatus(e),
      activated_at: e.activateTime ?? null, expires_at: e.expiredTime ?? null,
    };
  }
  if (prov === "eg" && goOn()) {
    const r = await eg(`/esims/${encodeURIComponent(a)}/bundles/${encodeURIComponent(b.join(":"))}`);
    const x = r?.assignments?.[0];
    if (!x) return null;
    const used = x.unlimited ? 0 : Math.max(0, Math.round((Number(x.initialQuantity || 0) - Number(x.remainingQuantity || 0)) / MB));
    return { data_used_mb: used, status: egStatus[String(x.bundleState).toLowerCase()] ?? "ready", activated_at: x.startTime ?? null, expires_at: x.endTime ?? null };
  }
  return null;
}
/** Abwärtskompatibel */
export const usage = refresh;

/** Storniert eine unbenutzte eSIM beim Anbieter (Rückerstattung des Einkaufs). false = nur manuell möglich. */
export async function cancel(providerRef: string): Promise<boolean> {
  const [prov, a] = String(providerRef || "").split(":");
  if (prov === "ea" && accessOn()) { await ea("/esim/cancel", { esimTranNo: a }); return true; }
  return false; // eSIM Go: Erstattung über das eSIM-Go-Portal / den Account-Manager
}

/**
 * Stellt die eSIM für eine bezahlte Bestellung aus und speichert sie (Zahlungs-Webhook oder Panel).
 * Doppelte Ausstellung ist ausgeschlossen: gibt es zur Bestellung schon eine eSIM, wird nichts bestellt.
 */
export async function fulfillOrder(db: any, orderId: string, opts: { test?: boolean } = {}) {
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) throw new Error("order_not_found");
  const { data: existing } = await db.from("esims").select("id").eq("order_id", orderId).limit(1);
  if (existing?.length) return { order, esim: null, already: true };
  const planMeta = order.plan_meta ?? {};
  const plan = { id: order.plan_id, gb: Number(planMeta.gb ?? 0), days: Number(planMeta.days ?? 0), unlimited: !!planMeta.unlimited };
  const p = await provision(plan, { ref: order.id, test: opts.test });
  const { data: esim, error } = await db.from("esims").insert({
    user_id: order.user_id, order_id: order.id, country: String(order.item_key).split(":")[1] ?? order.item_key, plan_name: order.title,
    iccid: p.iccid, lpa: p.lpa, smdp_address: p.smdp_address, activation_code: p.activation_code, data_total_mb: p.data_total_mb,
    validity_days: p.validity_days, provider_ref: p.provider_ref, provider: p.provider, unlimited: p.unlimited, status: p.status, test: p.test,
  }).select().single();
  if (error) throw error;
  await db.from("orders").update({ status: "fulfilled", test: p.test || order.test, updated_at: new Date().toISOString() }).eq("id", order.id);
  return { order: { ...order, status: "fulfilled" }, esim, already: false };
}
