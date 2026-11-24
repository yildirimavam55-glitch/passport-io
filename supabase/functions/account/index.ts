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
import { provision, usage } from "../_shared/esim-provider.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const LANGS = ["tr", "en", "de", "ar", "ru", "fr", "es"];
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
      const [{ data: profile }, { data: esims }, { data: orders }] = await Promise.all([
        db.from("profiles").select("full_name, language, currency, marketing, created_at").eq("id", user.id).single(),
        db.from("esims").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        db.from("orders").select("id, product, item_key, title, amount, currency, status, test, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
      ]);
      // Verbrauch beim Anbieter auffrischen (höchstens alle 10 Minuten je eSIM)
      const fresh = await Promise.all((esims ?? []).map(async (e) => {
        const stale = !e.usage_checked_at || Date.now() - new Date(e.usage_checked_at).getTime() > 10 * 60 * 1000;
        if (!stale || !e.provider_ref || ["expired", "cancelled"].includes(e.status)) return e;
        const u = await usage(e.provider_ref).catch(() => null);
        if (!u) return e;
        const patch = { ...u, usage_checked_at: new Date().toISOString() };
        await db.from("esims").update(patch).eq("id", e.id);
        return { ...e, ...patch };
      }));
      return json({
        user: { email: user.email, providers: user.app_metadata?.providers ?? [], created_at: user.created_at },
        profile, esims: fresh.map(view), orders,
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
      const item = String(body.item ?? ""), planId = String(body.planId ?? "");
      const currency = CURS.includes(body.currency) ? body.currency : "EUR";
      const found = await findPlan(item, planId, currency);
      if (!found) return json({ error: "plan_not_found" }, 400, headers);
      const { plan } = found;
      const { data: order, error } = await db.from("orders").insert({
        user_id: user.id, product: "esim", item_key: item, plan_id: plan.id,
        title: `${plan.gb} GB · ${plan.days}`, amount: plan.price, currency: found.currency,
      }).select().single();
      if (error) throw error;

      if (env("PAYMENT_PROVIDER")) {
        // TODO Zahlung: hier die Zahlungssitzung beim Anbieter erzeugen und die Weiterleitungsadresse zurückgeben.
        // Nach erfolgreicher Zahlung (Webhook) → status "paid" → provision() → eSIM speichern.
        return json({ order, payment: { status: "not_implemented" } }, 501, headers);
      }
      if (env("ALLOW_TEST_ORDERS") !== "true") return json({ order, payment: { status: "provider_missing" } }, 409, headers);

      // Testmodus: ohne Zahlung sofort eine Test-eSIM ausstellen
      const p = await provision(plan);
      const { data: esim, error: e2 } = await db.from("esims").insert({
        user_id: user.id, order_id: order.id, country: item.split(":")[1] ?? item, plan_name: `${plan.gb} GB · ${plan.days}`,
        iccid: p.iccid, lpa: p.lpa, smdp_address: p.smdp_address, activation_code: p.activation_code,
        data_total_mb: p.data_total_mb, validity_days: p.validity_days, provider_ref: p.provider_ref, test: p.test,
      }).select().single();
      if (e2) throw e2;
      await db.from("orders").update({ status: "fulfilled", test: true, updated_at: new Date().toISOString() }).eq("id", order.id);
      return json({ order: { ...order, status: "fulfilled", test: true }, esim: view(esim) }, 200, headers);
    }

    if (body.action === "delete") {
      // Löscht das Konto; Profil, Bestellungen und eSIM-Einträge werden automatisch mitgelöscht
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
