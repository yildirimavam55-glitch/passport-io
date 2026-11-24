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
import { applyPricing, DEFAULTS, loadAllRows, loadCompetitors, loadSettings } from "../_shared/pricing.ts";
import MOCK from "../_shared/mock.json" with { type: "json" };
import { accessOn, cancel, fulfillOrder, goOn, providerConfigured } from "../_shared/esim-provider.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const admins = () => (env("ADMIN_EMAILS") || env("ADMIN_MAIL")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const ORDER_ST = ["pending", "paid", "fulfilled", "failed", "refunded", "cancelled"];
const ESIM_ST = ["processing", "ready", "installed", "active", "depleted", "expired", "cancelled"];
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
    esim: providerConfigured(), esimAccess: accessOn(), esimGo: goOn(), contentEditor: !!env("GITHUB_CONTENT_TOKEN"), lounge: !!env("LOUNGE_API_URL"), fasttrack: !!env("FASTTRACK_API_URL"),
    payment: env("PAYMENT_PROVIDER") || null, testOrders: env("ALLOW_TEST_ORDERS") === "true",
    cmsGithub: !!env("GITHUB_CLIENT_ID") && !!env("GITHUB_CLIENT_SECRET"), google, apple,
    currencies: env("CURRENCIES") || "EUR,USD,GBP,TRY,CHF",
  };
}

/** Preisvorschau: Einkaufspreise (Cache oder Testdaten) mit angewandter Regel */
async function pricingPreview() {
  let raw: any;
  if (providerConfigured()) { const { data } = await db.from("price_cache").select("body").eq("id", "current7").maybeSingle(); raw = data?.body; }
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
        // Kennzahlen in EUR (EZB-Kurs aus dem Zwischenspeicher): heute, Woche, Monat + Vorzeitraum, Verlauf 90 Tage
        const { data: fxRow } = await db.from("price_cache").select("body").eq("id", "fx:EUR").maybeSingle();
        const toEur = (n: number, c: string) => { c = String(c || "EUR").toUpperCase(); if (c === "EUR") return n; const r = fxRow?.body?.rates?.[c]; return r ? n / r : 0; };
        const paid = (orders ?? []).filter((o: any) => !o.test && ["paid", "fulfilled"].includes(o.status));
        const startOf = (d: Date) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x.getTime(); };
        const now = new Date(), today = startOf(now), dayMs = 864e5;
        const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), prevMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
        const sumRange = (from: number, to: number) => {
          const list = paid.filter((o: any) => { const t = new Date(o.created_at).getTime(); return t >= from && t < to; });
          const rev = list.reduce((a: number, o: any) => a + toEur(Number(o.amount), o.currency), 0);
          return { revenue: Math.round(rev * 100) / 100, orders: list.length };
        };
        const elapsedMonth = now.getTime() - monthStart; // Vormonat bis zum gleichen Tag vergleichen
        const kpi = {
          today: sumRange(today, today + dayMs), yesterday: sumRange(today - dayMs, today),
          week: sumRange(today - 6 * dayMs, today + dayMs), prevWeek: sumRange(today - 13 * dayMs, today - 6 * dayMs),
          month: sumRange(monthStart, now.getTime() + 1), prevMonth: sumRange(prevMonthStart, prevMonthStart + elapsedMonth),
          total: sumRange(0, now.getTime() + 1),
        };
        const series: { day: string; revenue: number; orders: number }[] = [];
        for (let i = 89; i >= 0; i--) { const s = today - i * dayMs; const r = sumRange(s, s + dayMs); series.push({ day: new Date(s).toISOString().slice(0, 10), ...r }); }
        // Top-Ziele der letzten 30 Tage
        const top: Record<string, { orders: number; revenue: number }> = {};
        paid.filter((o: any) => new Date(o.created_at).getTime() >= today - 29 * dayMs).forEach((o: any) => {
          const k = String(o.item_key || "?"); top[k] ??= { orders: 0, revenue: 0 }; top[k].orders++; top[k].revenue = Math.round((top[k].revenue + toEur(Number(o.amount), o.currency)) * 100) / 100;
        });
        const topItems = Object.entries(top).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 6).map(([key, v]) => ({ key, ...v }));
        return json({
          revenue, orders30, byStatus, customers: Object.keys(users).length, esims: esimCount ?? 0, esimsActive: activeCount ?? 0,
          recent: (orders ?? []).slice(0, 8).map((o: any) => ({ ...o, email: users[o.user_id]?.email ?? o.customer_email ?? "" })), status,
          days, openRefunds: openRefunds ?? 0, openSupport: openSupport ?? 0, openQuestions: openQuestions ?? 0,
          mfa: { hasFactor, aal }, kpi, series, topItems,
          newCustomers30: Object.values(users).filter((u) => new Date(u.created_at).getTime() >= today - 29 * dayMs).length,
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
      if (view === "newsletter") {
        const data = await loadAllRows(db, "newsletter_subscribers");
        const since = Date.now() - 30 * 864e5;
        const active = data.filter((s: any) => !s.unsubscribed_at);
        const byLang = active.reduce((a: any, s: any) => ((a[s.lang || "?"] = (a[s.lang || "?"] ?? 0) + 1), a), {});
        return json({ subscribers: data.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))), total: data.length, active: active.length, new30: active.filter((s: any) => new Date(s.created_at).getTime() >= since).length, byLang }, 200, headers);
      }
      if (view === "discounts") {
        const { data } = await db.from("discount_codes").select("*").order("created_at", { ascending: false }).limit(500);
        const { data: used } = await db.from("orders").select("coupon, discount, currency, status").not("coupon", "is", null).limit(5000);
        return json({ codes: data ?? [], usage: used ?? [] }, 200, headers);
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
          loadSettings(db), loadAllRows(db, "competitor_prices").then((data) => ({ data: data.sort((a: any, b: any) => String(a.item_key).localeCompare(String(b.item_key))) })), pricingPreview(),
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
      const providerCancel: string[] = [];
      if (decision === "approved") {
        const { data: o } = await db.from("orders").select("amount").eq("id", rr.order_id).maybeSingle();
        await db.from("orders").update({ status: "refunded", refunded_amount: o?.amount ?? 0, updated_at: now }).eq("id", rr.order_id);
        // Unbenutzte eSIM beim Anbieter stornieren (eSIM Access erstattet den Einkauf aufs Guthaben)
        const { data: es } = await db.from("esims").select("id, provider_ref, test").eq("order_id", rr.order_id);
        for (const e of es ?? []) {
          if (e.test || !e.provider_ref) continue;
          const ok = await cancel(e.provider_ref).catch((err) => { console.error(err); return false; });
          providerCancel.push(ok ? "ok" : "manual");
        }
        await db.from("esims").update({ status: "cancelled" }).eq("order_id", rr.order_id);
      }
      await audit("refund_" + decision, rr.order_id, { note: txt(b.note, 300), providerCancel });
      return json({ ok: true, providerCancel }, 200, headers);
    }
    if (b.action === "order_fulfill") {
      // eSIM für eine BEZAHLTE Bestellung ausstellen (z. B. nach manueller Zahlungsprüfung). Nie doppelt.
      const { data: o } = await db.from("orders").select("id, status, test").eq("id", txt(b.id, 60)).maybeSingle();
      if (!o) return json({ error: "not_found" }, 404, headers);
      if (o.status !== "paid") return json({ error: "not_paid" }, 409, headers);
      try {
        const r = await fulfillOrder(db, o.id, { test: o.test });
        await audit("order_fulfill", o.id, { already: r.already, provider: r.esim?.provider ?? null, status: r.esim?.status ?? null });
        return json({ ok: true, already: r.already, esimStatus: r.esim?.status ?? null }, 200, headers);
      } catch (err) {
        console.error(err);
        await audit("order_fulfill_failed", o.id, { message: String((err as Error).message).slice(0, 300) });
        return json({ error: "provider", message: String((err as Error).message).slice(0, 300) }, 502, headers);
      }
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

    /* ---------- Bülten ---------- */
    if (b.action === "newsletter_unsub" || b.action === "newsletter_resub") {
      const { error } = await db.from("newsletter_subscribers").update({ unsubscribed_at: b.action === "newsletter_unsub" ? now : null }).eq("id", Number(b.id));
      if (error) throw error;
      await audit(b.action, String(b.id));
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "newsletter_delete") {
      // Endgültig löschen (z. B. auf Wunsch nach KVKK/DSGVO)
      const { error } = await db.from("newsletter_subscribers").delete().eq("id", Number(b.id));
      if (error) throw error;
      await audit("newsletter_delete", String(b.id));
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "newsletter_add") {
      const email = txt(b.email, 254).toLowerCase();
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(email)) return json({ error: "invalid" }, 400, headers);
      const { error } = await db.from("newsletter_subscribers").upsert({ email, lang: txt(b.lang, 5) || null, source: "panel", consent_text: txt(b.consent, 300) || "Panel üzerinden eklendi", unsubscribed_at: null }, { onConflict: "email" });
      if (error) throw error;
      await audit("newsletter_add", email);
      return json({ ok: true }, 200, headers);
    }

    /* ---------- İndirim kodları ---------- */
    if (b.action === "discount_save") {
      const row: any = {
        code: txt(b.code, 32).toUpperCase().replace(/[^A-Z0-9_-]/g, ""), kind: b.kind === "fixed" ? "fixed" : "percent",
        value: num(b.value, 0.01, 100000), min_amount: num(b.min_amount ?? 0, 0, 100000) ?? 0,
        starts_at: b.starts_at ? new Date(b.starts_at).toISOString() : null, ends_at: b.ends_at ? new Date(b.ends_at).toISOString() : null,
        max_uses: b.max_uses === "" || b.max_uses == null ? null : num(b.max_uses, 1, 1e7), active: b.active !== false, note: txt(b.note, 200) || null,
      };
      if (!/^[A-Z0-9_-]{3,32}$/.test(row.code) || !row.value || (row.kind === "percent" && row.value > 100)) return json({ error: "invalid" }, 400, headers);
      const q = b.id ? db.from("discount_codes").update(row).eq("id", Number(b.id)) : db.from("discount_codes").insert(row);
      const { error } = await q;
      if (error) return json({ error: error.code === "23505" ? "exists" : "server" }, error.code === "23505" ? 409 : 500, headers);
      await audit("discount_save", row.code, row);
      return json({ ok: true }, 200, headers);
    }
    if (b.action === "discount_toggle" || b.action === "discount_delete") {
      const q = b.action === "discount_delete" ? db.from("discount_codes").delete().eq("id", Number(b.id)) : db.from("discount_codes").update({ active: !!b.active }).eq("id", Number(b.id));
      const { error } = await q;
      if (error) throw error;
      await audit(b.action, String(b.id));
      return json({ ok: true }, 200, headers);
    }

    /* ---------- Mağaza editörü: Inhalte laden/speichern über GitHub (Secret GITHUB_CONTENT_TOKEN) ---------- */
    if (["content_get", "content_put", "content_upload", "content_delete", "posts_list"].includes(b.action)) {
      const token = env("GITHUB_CONTENT_TOKEN"), repo = env("GITHUB_REPO") || "yildirimavam55-glitch/passport-io", branch = env("GITHUB_BRANCH") || "main";
      if (!token) return json({ error: "github_missing" }, 409, headers);
      const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "passport-io-admin", "Content-Type": "application/json" },
      });
      const b64 = (s: string) => { const bytes = new TextEncoder().encode(s); let bin = ""; for (const x of bytes) bin += String.fromCharCode(x); return btoa(bin); };
      const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
      if (b.action === "posts_list") {
        // Alle Ratgeber/Artikel (auch Entwürfe) direkt aus GitHub
        const r = await gh(`content/posts?ref=${branch}`);
        if (!r.ok) return json({ error: "github", status: r.status }, 502, headers);
        const list = ((await r.json()) as any[]).filter((f) => /[.]json$/.test(f.name)).slice(0, 200);
        const posts = await Promise.all(list.map(async (f) => {
          try {
            const c = await (await gh(`${f.path}?ref=${branch}`)).json();
            const d = JSON.parse(unb64(c.content)), tr = d.tr ?? d;
            const langs = Object.keys(d).filter((k) => k !== "tr" && d[k]?.title);
            return { id: f.name.replace(/[.]json$/, ""), title: tr.title ?? "", date: tr.date ?? "", category: tr.category ?? "", image: tr.image ?? "", draft: tr.draft === true, langs };
          } catch (_) { return { id: f.name.replace(/[.]json$/, ""), title: "?", error: true }; }
        }));
        return json({ posts: posts.sort((a: any, b: any) => String(b.date).localeCompare(String(a.date))) }, 200, headers);
      }
      if (b.action === "content_upload") {
        // Bild hochladen → img/uploads/<zeit>-<name>; nur Bilder bis 3 MB
        const name = txt(b.name, 80).toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
        const ext = (name.match(/\.(jpe?g|png|webp|avif|gif|svg)$/) || [])[1];
        const data = String(b.data ?? "");
        if (!ext || !/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 4_200_000) return json({ error: "invalid_image" }, 400, headers);
        const path = `img/uploads/${Date.now()}-${name}`;
        const r = await gh(path, { method: "PUT", body: JSON.stringify({ message: `Bild hochgeladen: ${name}`, content: data, branch }) });
        if (!r.ok) return json({ error: "github", status: r.status }, 502, headers);
        await audit("content_upload", path);
        return json({ ok: true, path, url: path }, 200, headers); // relativ, die Seite liegt ggf. in einem Unterordner
      }
      // Erlaubte Dateien: content/<name>.json und content/posts/<name>.json (nicht auth.json/blog.json – werden erzeugt)
      const file = txt(b.file, 120);
      if (!/^content\/(posts\/)?[a-z0-9-]+\.json$/.test(file) || /^content\/(auth|blog)\.json$/.test(file)) return json({ error: "file" }, 400, headers);
      if (b.action === "content_delete") {
        // Nur Artikel dürfen gelöscht werden
        if (!/^content[/]posts[/][a-z0-9-]+[.]json$/.test(file)) return json({ error: "file" }, 400, headers);
        const cur = await gh(`${file}?ref=${branch}`);
        if (!cur.ok) return json({ error: "github", status: cur.status }, 502, headers);
        const { sha } = await cur.json();
        const r = await gh(file, { method: "DELETE", body: JSON.stringify({ message: `Artikel gelöscht: ${file} (${user.email})`, sha, branch }) });
        if (!r.ok) return json({ error: "github", status: r.status }, 502, headers);
        await audit("content_delete", file);
        return json({ ok: true }, 200, headers);
      }
      if (b.action === "content_get") {
        const r = await gh(`${file}?ref=${branch}`);
        if (r.status === 404) return json({ data: null, sha: null }, 200, headers);
        if (!r.ok) return json({ error: "github", status: r.status }, 502, headers);
        const d = await r.json();
        return json({ data: JSON.parse(unb64(d.content)), sha: d.sha }, 200, headers);
      }
      // content_put: JSON prüfen, höchstens 1,5 MB, nur Objekte
      if (!b.data || typeof b.data !== "object" || Array.isArray(b.data)) return json({ error: "invalid" }, 400, headers);
      const body = JSON.stringify(b.data, null, 2) + "\n";
      if (body.length > 1_500_000) return json({ error: "too_large" }, 400, headers);
      const r = await gh(file, { method: "PUT", body: JSON.stringify({ message: `Inhalt geändert: ${file} (Mağaza editörü, ${user.email})`, content: b64(body), sha: b.sha || undefined, branch }) });
      if (r.status === 409 || r.status === 422) return json({ error: "conflict" }, 409, headers);
      if (!r.ok) return json({ error: "github", status: r.status }, 502, headers);
      const d = await r.json();
      await audit("content_put", file);
      return json({ ok: true, sha: d.content?.sha }, 200, headers);
    }
    return json({ error: "unknown_action" }, 400, headers);
  } catch (err) {
    console.error(err);
    return json({ error: "server" }, 500, headers);
  }
});
