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
  // Zwei-Faktor-Anmeldung: Pflicht, sobald die Person eine Authenticator-App eingerichtet hat
  // (oder für alle Admins mit ADMIN_REQUIRE_MFA=true). Die Stufe steht im geprüften Token (aal).
  let aal = "aal1";
  try { aal = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal ?? "aal1"; } catch (_) { /* aal1 */ }
  const hasFactor = (user.factors ?? []).some((f: any) => f.status === "verified");
  if ((hasFactor || env("ADMIN_REQUIRE_MFA") === "true") && aal !== "aal2") return json({ error: hasFactor ? "mfa_required" : "mfa_setup_required" }, 403, headers);
  const audit = (action: string, target: string, details: unknown = null) =>
    db.from("admin_audit").insert({ admin_email: user.email, action, target, details }).then(() => {}, () => {});

  try {
    if (req.method === "GET") {
      const view = new URL(req.url).searchParams.get("view") ?? "overview";
      if (view === "overview") {
        const [{ data: orders }, { count: esimCount }, { count: activeCount }, users, status, { count: openRefunds }, { count: openSupport }, { count: openQuestions }] = await Promise.all([
          db.from("orders").select("id, user_id, customer_email, item_key, title, amount, currency, status, test, created_at").order("created_at", { ascending: false }).limit(2000),
          db.from("esims").select("id", { count: "exact", head: true }),
          db.from("esims").select("id", { count: "exact", head: true }).in("status", ["active", "installed"]),
          emailMap(), providerStatus(),
          db.from("refund_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
          db.from("support_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
          db.from("unanswered_questions").select("id", { count: "exact", head: true }).eq("handled", false),
        ]);
        // Verlauf der letzten 30 Tage (bezahlte Bestellungen, ohne Testbestellungen)
        const days: { day: string; orders: number; revenue: Record<string, number> }[] = [];
        for (let i = 29; i >= 0; i--) days.push({ day: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), orders: 0, revenue: {} });
        (orders ?? []).forEach((o: any) => {
          if (o.test || !["paid", "fulfilled"].includes(o.status)) return;
          const d = days.find((x) => x.day === String(o.created_at).slice(0, 10));
          if (d) { d.orders++; d.revenue[o.currency] = Math.round(((d.revenue[o.currency] ?? 0) + Number(o.amount)) * 100) / 100; }
        });
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
          recent: (orders ?? []).slice(0, 8).map((o: any) => ({ ...o, email: users[o.user_id]?.email ?? o.customer_email ?? "" })), status,
          days, openRefunds: openRefunds ?? 0, openSupport: openSupport ?? 0, openQuestions: openQuestions ?? 0,
          mfa: { hasFactor, aal },
        }, 200, headers);
      }
      if (view === "orders") {
        const st = new URL(req.url).searchParams.get("status");
        let q = db.from("orders").select("*").order("created_at", { ascending: false }).limit(500);
        if (st && ORDER_ST.includes(st)) q = q.eq("status", st);
        const [{ data }, users] = await Promise.all([q, emailMap()]);
        return json({ orders: (data ?? []).map((o: any) => ({ ...o, email: users[o.user_id]?.email ?? o.customer_email ?? "" })) }, 200, headers);
      }
      if (view === "payments") {
        const { data } = await db.from("orders").select("id, customer_email, item_key, title, amount, currency, status, payment_provider, payment_ref, paid_at, refunded_amount, test, created_at")
          .in("status", ["paid", "fulfilled", "refunded"]).order("created_at", { ascending: false }).limit(1000);
        const sum = (st: string[], f: (o: any) => number) => (data ?? []).filter((o: any) => !o.test && st.includes(o.status)).reduce((a: any, o: any) => ((a[o.currency] = Math.round(((a[o.currency] ?? 0) + f(o)) * 100) / 100), a), {});
        return json({ payments: data ?? [], gross: sum(["paid", "fulfilled", "refunded"], (o) => Number(o.amount)), refunded: sum(["refunded"], (o) => Number(o.refunded_amount || o.amount)) }, 200, headers);
      }
      if (view === "refunds") {
        const { data } = await db.from("refund_requests").select("*, orders(item_key, title, amount, currency, status, created_at)").order("created_at", { ascending: false }).limit(500);
        return json({ refunds: data ?? [] }, 200, headers);
      }
      if (view === "support") {
        const { data } = await db.from("support_requests").select("*").order("created_at", { ascending: false }).limit(500);
        return json({ tickets: data ?? [] }, 200, headers);
      }
      if (view === "questions") {
        const { data } = await db.from("unanswered_questions").select("*").order("created_at", { ascending: false }).limit(500);
        return json({ questions: data ?? [] }, 200, headers);
      }
      if (view === "audit") {
        const { data } = await db.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(300);
        return json({ audit: data ?? [] }, 200, headers);
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
      await audit("order_status", txt(b.id, 60), { status: b.status });
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "esim_status") {
      if (!ESIM_ST.includes(b.status)) return json({ error: "status" }, 400, headers);
      const { error } = await db.from("esims").update({ status: b.status }).eq("id", txt(b.id, 60));
      if (error) throw error;
      await audit("esim_status", txt(b.id, 60), { status: b.status });
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "refund_decide") {
      // Genehmigen: Bestellung „erstattet“, eSIMs gesperrt. Die Geldrückzahlung selbst läuft beim Zahlungsanbieter.
      const decision = b.decision === "approve" ? "approved" : b.decision === "reject" ? "rejected" : null;
      if (!decision) return json({ error: "invalid" }, 400, headers);
      const { data: rr } = await db.from("refund_requests").select("id, order_id, status").eq("id", txt(b.id, 60)).maybeSingle();
      if (!rr || rr.status !== "open") return json({ error: "not_open" }, 409, headers);
      await db.from("refund_requests").update({ status: decision, admin_note: txt(b.note, 1000) || null, decided_by: user.email, decided_at: now }).eq("id", rr.id);
      if (decision === "approved") {
        const { data: o } = await db.from("orders").select("amount").eq("id", rr.order_id).maybeSingle();
        await db.from("orders").update({ status: "refunded", refunded_amount: o?.amount ?? 0, updated_at: now }).eq("id", rr.order_id);
        await db.from("esims").update({ status: "cancelled" }).eq("order_id", rr.order_id);
      }
      await audit("refund_" + decision, rr.order_id, { note: txt(b.note, 300) });
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "support_update") {
      const st = ["open", "answered", "closed"].includes(b.status) ? b.status : null;
      if (!st) return json({ error: "invalid" }, 400, headers);
      const { error } = await db.from("support_requests").update({ status: st, admin_note: txt(b.note, 2000) || null, updated_at: now }).eq("id", txt(b.id, 60));
      if (error) throw error;
      await audit("support_" + st, txt(b.id, 60));
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "question_handled") {
      const { error } = await db.from("unanswered_questions").update({ handled: true }).eq("id", Number(b.id));
      if (error) throw error;
      await audit("question_handled", String(b.id));
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
      await audit("pricing_settings", "1", patch);
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
      await audit("competitor_save", row.item_key, row);
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "competitor_delete") {
      const { error } = await db.from("competitor_prices").delete().eq("id", Number(b.id));
      if (error) throw error;
      await audit("competitor_delete", String(b.id));
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "competitor_import") {
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 2000).map(compRow);
      const good = rows.filter(Boolean);
      if (good.length) { const { error } = await db.from("competitor_prices").insert(good); if (error) throw error; await audit("competitor_import", String(good.length)); }
      return json({ ok: true, imported: good.length, skipped: rows.length - good.length }, 200, headers);
    }
    return json({ error: "unknown_action" }, 400, headers);
  } catch (err) {
    console.error(err);
    return json({ error: "server" }, 500, headers);
  }
});
