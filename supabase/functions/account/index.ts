/* ==========================================================================
   passport.io – Kundenkonto
   --------------------------------------------------------------------------
   Alle Anfragen brauchen die Anmeldung (Authorization: Bearer <Sitzungs-Token>).
     GET                       → Profil, gebuchte eSIMs (mit aktuellem Verbrauch), Bestellungen
     POST {action:"profile"}   → Name, Sprache, Währung, Newsletter ändern
     POST {action:"order"}     → Bestellung anlegen; Preis kommt NUR aus der Preis-Schnittstelle
     POST {action:"delete"}    → Konto und alle Daten löschen (DSGVO / KVKK)
   Zahlung: Solange kein Zahlungsanbieter angebunden ist (PAYMENT_PROVIDER leer),
   bleiben Bestellungen „pending“. Nur mit ALLOW_TEST_ORDERS=true wird eine Test-eSIM erzeugt.
   ========================================================================== */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors, env, json } from "../_shared/http.ts";
import { fulfillOrder, refresh } from "../_shared/esim-provider.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const LANGS = ["tr", "en", "de", "ar", "ru", "fr", "es"];
// Geld-zurück-Frist für nicht installierte eSIMs (Secret REFUND_DAYS, Standard 30 – muss zu den Rechtstexten passen)
const refundDays = () => Number(env("REFUND_DAYS") || 30);
const CURS = (env("CURRENCIES") || "EUR,USD,GBP,TRY,CHF").split(",").map((s) => s.trim());

/** Tarif und Preis direkt aus der Preis-Schnittstelle (Grundregel: keine Preise aus dem Browser) */
async function findPlan(item: string, planId: string, currency: string) {
  const r = await fetch(`${env("SUPABASE_URL")}/functions/v1/prices?currency=${encodeURIComponent(currency)}`);
  if (!r.ok) throw new Error("Preise nicht erreichbar");
  const p = await r.json();
  const [type, id] = item.split(":");
  const E = p.esim ?? {};
  const plans = type === "country" ? E.countries?.[id]?.plans : type === "region" ? E.regions?.[id]?.plans : type === "global" ? E.global?.plans : null;
  const plan = (plans ?? []).find((x: { id: string }) => x.id === planId);
  return plan ? { plan, currency: p.currency as string } : null;
}

/** Status und Restlaufzeit berechnen */
function view(e: Record<string, unknown>) {
  const exp = e.expires_at ? new Date(String(e.expires_at)) : null;
  const now = Date.now();
  let status = String(e.status);
  if (exp && exp.getTime() < now && status !== "cancelled") status = "expired";
  if (e.data_total_mb && Number(e.data_used_mb) >= Number(e.data_total_mb) && status === "active") status = "depleted";
  const daysLeft = exp ? Math.max(0, Math.ceil((exp.getTime() - now) / 86400000)) : null;
  return { ...e, status, days_left: daysLeft, provider_ref: undefined };
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  // Angemeldete Person aus dem Token bestimmen
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = token ? await db.auth.getUser(token) : { data: { user: null }, error: true };
  const user = auth?.user;
  if (authErr || !user) return json({ error: "unauthorized" }, 401, headers);

  try {
    if (req.method === "GET") {
      const [{ data: profile }, { data: esims }, { data: orders }, { data: refunds }, { data: tickets }] = await Promise.all([
        db.from("profiles").select("full_name, language, currency, marketing, created_at").eq("id", user.id).single(),
        db.from("esims").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        db.from("orders").select("id, product, item_key, title, amount, currency, status, test, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        db.from("refund_requests").select("order_id, status, created_at, decided_at").eq("user_id", user.id),
        db.from("support_requests").select("id, subject, status, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      ]);
      // Verbrauch beim Anbieter auffrischen (höchstens alle 10 Minuten je eSIM; Profile in Arbeit alle 20 Sekunden)
      const fresh = await Promise.all((esims ?? []).map(async (e) => {
        const wait = e.status === "processing" ? 20 * 1000 : 10 * 60 * 1000;
        const stale = !e.usage_checked_at || Date.now() - new Date(e.usage_checked_at).getTime() > wait;
        if (!stale || !e.provider_ref || ["expired", "cancelled"].includes(e.status)) return e;
        const u = await refresh(e.provider_ref).catch((err) => { console.error(err); return null; });
        if (!u) return e;
        const patch = { ...u, usage_checked_at: new Date().toISOString() };
        await db.from("esims").update(patch).eq("id", e.id);
        return { ...e, ...patch };
      }));
      return json({
        user: { email: user.email, providers: user.app_metadata?.providers ?? [], created_at: user.created_at },
        profile, esims: fresh.map(view), orders, refunds: refunds ?? [], tickets: tickets ?? [],
        refundDays: refundDays(),
      }, 200, headers);
    }

    if (req.method !== "POST") return json({ error: "method" }, 405, headers);
    const body = await req.json().catch(() => ({}));

    if (body.action === "profile") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.full_name === "string") patch.full_name = body.full_name.trim().slice(0, 120);
      if (LANGS.includes(body.language)) patch.language = body.language;
      if (CURS.includes(body.currency)) patch.currency = body.currency;
      if (typeof body.marketing === "boolean") patch.marketing = body.marketing;
      const { error } = await db.from("profiles").update(patch).eq("id", user.id);
      if (error) throw error;
      return json({ ok: true }, 200, headers);
    }

    if (body.action === "order") {
      // Schutz vor Missbrauch: höchstens 10 Bestellungen pro Stunde und Konto
      const since = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
      if ((count ?? 0) >= 10) return json({ error: "rate_limited" }, 429, headers);
      const item = String(body.item ?? "").slice(0, 60), planId = String(body.planId ?? "").slice(0, 80);
      const currency = CURS.includes(body.currency) ? body.currency : "EUR";
      const found = await findPlan(item, planId, currency);
      if (!found) return json({ error: "plan_not_found" }, 400, headers);
      const { plan } = found;
      const { data: order, error } = await db.from("orders").insert({
        user_id: user.id, customer_email: user.email, product: "esim", item_key: item, plan_id: plan.id,
        title: `${plan.unlimited ? "Unlimited" : plan.gb + " GB"} · ${plan.days}`, amount: plan.price, currency: found.currency,
        plan_meta: { gb: plan.gb, days: plan.days, unlimited: !!plan.unlimited },
      }).select().single();
      if (error) throw error;

      if (env("PAYMENT_PROVIDER")) {
        // TODO Zahlung: hier die Zahlungssitzung beim Anbieter erzeugen und die Weiterleitungsadresse zurückgeben.
        // Nach erfolgreicher Zahlung (Webhook) → status "paid" → provision() → eSIM speichern.
        return json({ order, payment: { status: "not_implemented" } }, 501, headers);
      }
      if (env("ALLOW_TEST_ORDERS") !== "true") return json({ order, payment: { status: "provider_missing" } }, 409, headers);

      // Testmodus: ohne Zahlung sofort eine Test-eSIM ausstellen – NIE eine echte (kostenpflichtige) eSIM
      const done = await fulfillOrder(db, order.id, { test: true });
      return json({ order: { ...done.order, test: true }, esim: done.esim ? view(done.esim) : null }, 200, headers);
    }

    if (body.action === "refund_request") {
      // Nur eigene, bezahlte Bestellungen innerhalb der Frist, deren eSIM noch nicht installiert/aktiv ist
      const orderId = String(body.orderId ?? "").slice(0, 60);
      const { data: order } = await db.from("orders").select("id, user_id, status, created_at").eq("id", orderId).maybeSingle();
      if (!order || order.user_id !== user.id) return json({ error: "not_found" }, 404, headers);
      if (!["paid", "fulfilled"].includes(order.status)) return json({ error: "not_refundable" }, 409, headers);
      if (Date.now() - new Date(order.created_at).getTime() > refundDays() * 864e5) return json({ error: "too_late" }, 409, headers);
      const { data: es } = await db.from("esims").select("status, activated_at").eq("order_id", order.id);
      if ((es ?? []).some((e) => !["processing", "ready", "cancelled"].includes(e.status) || e.activated_at)) return json({ error: "esim_used" }, 409, headers);
      const { error } = await db.from("refund_requests").insert({ order_id: order.id, user_id: user.id, customer_email: user.email, reason: String(body.reason ?? "").trim().slice(0, 1000) || null });
      if (error) return json({ error: error.code === "23505" ? "already_requested" : "server" }, error.code === "23505" ? 409 : 500, headers);
      return json({ ok: true }, 200, headers);
    }

    if (body.action === "support") {
      // Höchstens 5 Anfragen pro Stunde und Konto
      const since = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count } = await db.from("support_requests").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
      if ((count ?? 0) >= 5) return json({ error: "rate_limited" }, 429, headers);
      const message = String(body.message ?? "").trim().slice(0, 4000);
      if (message.length < 5) return json({ error: "invalid" }, 400, headers);
      const orderId = String(body.orderId ?? "").slice(0, 60);
      const { data: own } = orderId ? await db.from("orders").select("id").eq("id", orderId).eq("user_id", user.id).maybeSingle() : { data: null };
      const { error } = await db.from("support_requests").insert({
        user_id: user.id, email: user.email, subject: String(body.subject ?? "").trim().slice(0, 160) || null, message, order_id: own?.id ?? null, page: "account",
      });
      if (error) throw error;
      return json({ ok: true }, 200, headers);
    }

    if (body.action === "delete") {
      // Löscht das Konto; Profil und eSIM-Einträge werden mitgelöscht. Bestellungen bleiben wegen der
      // gesetzlichen Aufbewahrungspflicht für Rechnungsdaten erhalten, sind aber vom Konto getrennt.
      const { error } = await db.auth.admin.deleteUser(user.id);
      if (error) throw error;
      return json({ ok: true }, 200, headers);
    }

    return json({ error: "unknown_action" }, 400, headers);
  } catch (err) {
    console.error(err);
    return json({ error: "server" }, 500, headers);
  }
});
