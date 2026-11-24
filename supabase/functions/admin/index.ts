/* ==========================================================================
   passport.io – Verwaltungspanel (Shop-Admin)
   --------------------------------------------------------------------------
   Zugriff nur für angemeldete Personen mit bestätigter E-Mail, die im Secret
   ADMIN_EMAILS stehen (kommagetrennt, z. B. "ali@firma.com,ayse@firma.com").
     GET  ?view=overview | orders | customers | esims | pricing
     POST {action: "order_status" | "esim_status" | "pricing_settings" |
                   "competitor_save" | "competitor_delete" | "competitor_import"}
   ========================================================================== */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors, env, json } from "../_shared/http.ts";
import { applyPricing, DEFAULTS, loadCompetitors, loadSettings } from "../_shared/pricing.ts";
import MOCK from "../_shared/mock.json" with { type: "json" };

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const admins = () => env("ADMIN_EMAILS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const ORDER_ST = ["pending", "paid", "fulfilled", "failed", "refunded", "cancelled"];
const ESIM_ST = ["ready", "installed", "active", "depleted", "expired", "cancelled"];
const num = (v: unknown, min = 0, max = 1e6) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
const txt = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

async function emailMap() {
  const map: Record<string, { email: string; created_at: string; last_sign_in_at: string | null; providers: string[] }> = {};
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    data.users.forEach((u: any) => (map[u.id] = { email: u.email ?? "", created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null, providers: u.app_metadata?.providers ?? [] }));
    if (data.users.length < 1000) break;
  }
  return map;
}

async function providerStatus() {
  let google = false, apple = false;
  try {
    const r = await fetch(`${env("SUPABASE_URL")}/auth/v1/settings`, { headers: { apikey: env("SUPABASE_ANON_KEY") } });
    const s = await r.json(); google = !!s.external?.google; apple = !!s.external?.apple;
  } catch (_) { /* unbekannt */ }
  return {
    esim: !!env("ESIM_API_URL"), lounge: !!env("LOUNGE_API_URL"), fasttrack: !!env("FASTTRACK_API_URL"),
    payment: env("PAYMENT_PROVIDER") || null, testOrders: env("ALLOW_TEST_ORDERS") === "true",
    cmsGithub: !!env("GITHUB_CLIENT_ID") && !!env("GITHUB_CLIENT_SECRET"), google, apple,
    currencies: env("CURRENCIES") || "EUR,USD,GBP,TRY,CHF",
  };
}

/** Preisvorschau: Einkaufspreise (Cache oder Testdaten) mit angewandter Regel */
async function pricingPreview() {
  let raw: any;
  if (env("ESIM_API_URL")) { const { data } = await db.from("price_cache").select("body").eq("id", "current").maybeSingle(); raw = data?.body; }
  raw = raw ?? { ...structuredClone(MOCK), source: "mock" };
  const base = raw.currency ?? "EUR";
  const { data: fxRow } = await db.from("price_cache").select("body").eq("id", `fx:${base}`).maybeSingle();
  const toBase = (n: number, cur: string) => { cur = (cur || "EUR").toUpperCase(); if (cur === base) return n; const r = fxRow?.body?.rates?.[cur]; return r ? n / r : null; };
  const [settings, comps] = await Promise.all([loadSettings(db), loadCompetitors(db)]);
  const priced = applyPricing(raw, settings, comps, toBase, true);
  const rows: any[] = [];
  for (const [code, c] of Object.entries<any>(priced.esim?.countries ?? {})) c.plans?.forEach((p: any) => rows.push({ key: `country:${code}`, ...p }));
  for (const [id, c] of Object.entries<any>(priced.esim?.regions ?? {})) c.plans?.forEach((p: any) => rows.push({ key: `region:${id}`, ...p }));
  priced.esim?.global?.plans?.forEach((p: any) => rows.push({ key: "global", ...p }));
  for (const k of ["lounge", "fasttrack"]) if (priced[k]?.from != null) rows.push({ key: k, id: k, price: priced[k].from, cost: priced[k].cost, rule: priced[k].rule });
  return { source: raw.source ?? "live", currency: base, rows };
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = token ? await db.auth.getUser(token) : { data: { user: null } };
  const user = auth?.user;
  if (!user) return json({ error: "unauthorized" }, 401, headers);
  if (!user.email_confirmed_at || !admins().includes((user.email ?? "").toLowerCase())) return json({ error: "forbidden" }, 403, headers);

  try {
    if (req.method === "GET") {
      const view = new URL(req.url).searchParams.get("view") ?? "overview";
      if (view === "overview") {
        const [{ data: orders }, { count: esimCount }, { count: activeCount }, users, status] = await Promise.all([
          db.from("orders").select("id, user_id, item_key, title, amount, currency, status, test, created_at").order("created_at", { ascending: false }).limit(1000),
          db.from("esims").select("id", { count: "exact", head: true }),
          db.from("esims").select("id", { count: "exact", head: true }).in("status", ["active", "installed"]),
          emailMap(), providerStatus(),
        ]);
        const revenue: Record<string, number> = {};
        const last30 = Date.now() - 30 * 864e5;
        let orders30 = 0;
        (orders ?? []).forEach((o: any) => {
          if (["paid", "fulfilled"].includes(o.status) && !o.test) revenue[o.currency] = Math.round(((revenue[o.currency] ?? 0) + Number(o.amount)) * 100) / 100;
          if (new Date(o.created_at).getTime() > last30) orders30++;
        });
        const byStatus = ORDER_ST.reduce((a: any, s) => ((a[s] = (orders ?? []).filter((o: any) => o.status === s).length), a), {});
        return json({
          revenue, orders30, byStatus, customers: Object.keys(users).length, esims: esimCount ?? 0, esimsActive: activeCount ?? 0,
          recent: (orders ?? []).slice(0, 8).map((o: any) => ({ ...o, email: users[o.user_id]?.email ?? "" })), status,
        }, 200, headers);
      }
      if (view === "orders") {
        const st = new URL(req.url).searchParams.get("status");
        let q = db.from("orders").select("*").order("created_at", { ascending: false }).limit(500);
        if (st && ORDER_ST.includes(st)) q = q.eq("status", st);
        const [{ data }, users] = await Promise.all([q, emailMap()]);
        return json({ orders: (data ?? []).map((o: any) => ({ ...o, email: users[o.user_id]?.email ?? "" })) }, 200, headers);
      }
      if (view === "customers") {
        const [users, { data: profiles }, { data: orders }] = await Promise.all([
          emailMap(), db.from("profiles").select("id, full_name, language, currency, marketing"), db.from("orders").select("user_id, amount, currency, status, test"),
        ]);
        const prof = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
        const list = Object.entries(users).map(([id, u]) => {
          const mine = (orders ?? []).filter((o: any) => o.user_id === id);
          return { id, ...u, ...(prof[id] ?? {}), orders: mine.length, paid: mine.filter((o: any) => ["paid", "fulfilled"].includes(o.status) && !o.test).length };
        }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return json({ customers: list }, 200, headers);
      }
      if (view === "esims") {
        const [{ data }, users] = await Promise.all([db.from("esims").select("id, user_id, country, plan_name, iccid, status, data_total_mb, data_used_mb, validity_days, activated_at, expires_at, test, created_at").order("created_at", { ascending: false }).limit(500), emailMap()]);
        return json({ esims: (data ?? []).map((e: any) => ({ ...e, email: users[e.user_id]?.email ?? "" })) }, 200, headers);
      }
      if (view === "pricing") {
        const [settings, { data: comps }, preview] = await Promise.all([
          loadSettings(db), db.from("competitor_prices").select("*").order("item_key").limit(5000), pricingPreview(),
        ]);
        return json({ settings, defaults: DEFAULTS, competitors: comps ?? [], preview }, 200, headers);
      }
      return json({ error: "unknown_view" }, 400, headers);
    }

    if (req.method !== "POST") return json({ error: "method" }, 405, headers);
    const b = await req.json().catch(() => ({}));
    const now = new Date().toISOString();

    if (b.action === "order_status") {
      if (!ORDER_ST.includes(b.status)) return json({ error: "status" }, 400, headers);
      const { error } = await db.from("orders").update({ status: b.status, updated_at: now }).eq("id", txt(b.id, 60));
      if (error) throw error;
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "esim_status") {
      if (!ESIM_ST.includes(b.status)) return json({ error: "status" }, 400, headers);
      const { error } = await db.from("esims").update({ status: b.status }).eq("id", txt(b.id, 60));
      if (error) throw error;
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "pricing_settings") {
      const patch = {
        markup_factor: num(b.markup_factor, 1, 20), undercut_eur: num(b.undercut_eur, 0, 100), min_price_eur: num(b.min_price_eur, 0, 1000),
        min_margin_pct: num(b.min_margin_pct, 0, 500), round_99: !!b.round_99, updated_at: now,
      };
      if (Object.values(patch).some((v) => v === null)) return json({ error: "invalid" }, 400, headers);
      const { error } = await db.from("pricing_settings").upsert({ id: 1, ...patch });
      if (error) throw error;
      return json({ ok: true }, 200, headers);
    }
    const compRow = (c: any) => {
      const row = {
        item_key: txt(c.item_key, 60).toLowerCase(), gb: c.gb === "" || c.gb == null ? null : num(c.gb, 0, 10000),
        days: c.days === "" || c.days == null ? null : num(c.days, 0, 3650), price: num(c.price, 0.01, 100000),
        currency: txt(c.currency || "EUR", 3).toUpperCase(), competitor: txt(c.competitor, 80), url: txt(c.url, 300) || null,
        active: c.active !== false, checked_at: now,
      };
      const ok = /^(country:[a-z]{2}|region:[a-z0-9-]+|global|lounge|fasttrack|vignette)$/.test(row.item_key) && row.price && row.competitor && /^[A-Z]{3}$/.test(row.currency);
      return ok ? row : null;
    };
    if (b.action === "competitor_save") {
      const row = compRow(b);
      if (!row) return json({ error: "invalid" }, 400, headers);
      const q = b.id ? db.from("competitor_prices").update(row).eq("id", Number(b.id)) : db.from("competitor_prices").insert(row);
      const { error } = await q;
      if (error) throw error;
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "competitor_delete") {
      const { error } = await db.from("competitor_prices").delete().eq("id", Number(b.id));
      if (error) throw error;
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "competitor_import") {
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 2000).map(compRow);
      const good = rows.filter(Boolean);
      if (good.length) { const { error } = await db.from("competitor_prices").insert(good); if (error) throw error; }
      return json({ ok: true, imported: good.length, skipped: rows.length - good.length }, 200, headers);
    }
    return json({ error: "unknown_action" }, 400, headers);
  } catch (err) {
    console.error(err);
    return json({ error: "server" }, 500, headers);
  }
});
