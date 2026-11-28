/* ==========================================================================
   passport.io – Kundenkonto
   --------------------------------------------------------------------------
   Alle Anfragen außer coupon_check brauchen die Anmeldung (Authorization: Bearer <Sitzungs-Token>).
     GET                       → Profil, gebuchte eSIMs (mit aktuellem Verbrauch), Bestellungen
     POST {action:"profile"}   → Name, Sprache, Währung, Newsletter ändern
     POST {action:"order"}     → Bestellung anlegen; Preis kommt NUR aus der Preis-Schnittstelle
                                 Lounge/Fast Track: item "airport:<Angebots-ID>" + booking {date, time, flight, persons, names[], phone, note}
     POST {action:"coupon_check", code, item, planId, currency} → Rabattcode für den Warenkorb prüfen (ohne Anmeldung, zählt nicht)
     POST {action:"delete"}    → Konto und alle Daten löschen (DSGVO / KVKK)
   Zahlung: Solange kein Zahlungsanbieter angebunden ist (PAYMENT_PROVIDER leer),
   bleiben Bestellungen „pending“. Nur mit ALLOW_TEST_ORDERS=true wird eine Test-eSIM erzeugt.
   ========================================================================== */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors, env, json } from "../_shared/http.ts";
import { fulfillOrder, refresh } from "../_shared/esim-provider.ts";
import { dispatchForOrder, logItem, offerList, signedFiles } from "../_shared/airport.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const LANGS = ["tr", "en", "de", "ar", "ru", "fr", "es", "it", "pt", "nl", "pl", "ja", "ko"];
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

/** Rabattcode prüfen (ohne ihn zu verbrauchen) – Betrag in der Bestellwährung; fester Rabatt und Mindestwert sind in EUR hinterlegt */
async function checkCoupon(raw: string, price: number, currency: string): Promise<{ code: string | null; discount: number; state?: string }> {
  const code = raw.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  if (!code) return { code: null, discount: 0 };
  const { data: c } = await db.from("discount_codes").select("*").eq("code", code).maybeSingle();
  const now = Date.now();
  if (!c || !c.active || (c.starts_at && new Date(c.starts_at).getTime() > now) || (c.ends_at && new Date(c.ends_at).getTime() < now) || (c.max_uses && c.used_count >= c.max_uses)) return { code: null, discount: 0, state: "invalid" };
  // EUR → Bestellwährung (EZB-Kurs aus dem Zwischenspeicher)
  let rate = 1;
  if (currency !== "EUR") { const { data: fx } = await db.from("price_cache").select("body").eq("id", "fx:EUR").maybeSingle(); rate = Number(fx?.body?.rates?.[currency]) || 0; if (!rate) return { code: null, discount: 0, state: "invalid" }; }
  if (price < Number(c.min_amount || 0) * rate) return { code: null, discount: 0, state: "min_amount" };
  const discount = c.kind === "percent" ? price * (Number(c.value) / 100) : Number(c.value) * rate;
  return { code, discount: Math.min(price, Math.round(discount * 100) / 100) };
}

/** Rabattcode anwenden = prüfen und einmal als benutzt zählen */
async function applyCoupon(raw: string, price: number, currency: string): Promise<{ code: string | null; discount: number; state?: string }> {
  const r = await checkCoupon(raw, price, currency);
  if (!r.code) return r.state === "min_amount" ? { ...r, state: "invalid" } : r;
  const { data: ok } = await db.rpc("use_discount", { p_code: r.code });
  if (!ok) return { code: null, discount: 0, state: "invalid" };
  return r;
}

// Einfache Bremse gegen Durchprobieren von Codes (pro Instanz): 20 Prüfungen je IP in 10 Minuten
const checks = new Map<string, number[]>();
const tooMany = (ip: string) => { const now = Date.now(); const a = (checks.get(ip) || []).filter((x) => now - x < 6e5); a.push(now); checks.set(ip, a); if (checks.size > 5000) checks.clear(); return a.length > 20; };

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

  // Warenkorb: Rabattcode vor der Anmeldung prüfen (zählt nicht als Nutzung, Preis kommt aus der Preis-Schnittstelle)
  if (req.method === "POST") {
    const pre = await req.clone().json().catch(() => ({}));
    if (pre?.action === "coupon_check") {
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
      if (tooMany(ip)) return json({ error: "rate_limited" }, 429, headers);
      const currency = CURS.includes(String(pre.currency)) ? String(pre.currency) : "EUR";
      const found = await findPlan(String(pre.item ?? ""), String(pre.planId ?? ""), currency).catch(() => null);
      if (!found) return json({ state: "invalid" }, 200, headers);
      const r = await checkCoupon(String(pre.code ?? ""), Number(found.plan.price), found.currency);
      return json(r.code ? { state: "ok", code: r.code, discount: r.discount, currency: found.currency } : { state: r.state || "invalid" }, 200, headers);
    }
  }

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
      // Lounge & Fast Track: Buchungen; Voucher-Links erst nach der Zustellung (7 Tage gültig, bei jedem Aufruf neu)
      const { data: bks } = await db.from("airport_bookings").select("id, order_id, product, airport, title, travel_date, travel_time, flight, persons, status, files, test, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
      const bookings = await Promise.all((bks ?? []).map(async (x) => ({ ...x, files: x.status === "delivered" ? await signedFiles(db, x.files) : [] })));
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
        profile, esims: fresh.map(view), orders, refunds: refunds ?? [], tickets: tickets ?? [], bookings,
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

    if (body.action === "order" && String(body.item ?? "").startsWith("airport:")) {
      // Lounge / Fast Track über Partner: Preis aus der Partner-Preisliste + Preisregel (nie aus dem Browser)
      const since = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
      if ((count ?? 0) >= 10) return json({ error: "rate_limited" }, 429, headers);
      const testMode = env("ALLOW_TEST_ORDERS") === "true";
      const offerId = String(body.item).slice(8, 50);
      const currency = CURS.includes(body.currency) ? body.currency : "EUR";
      const { offers, settings } = await offerList(db, currency, { ids: [offerId], withCost: true });
      const offer = offers[0];
      if (!offer) return json({ error: "plan_not_found" }, 400, headers);
      if (!settings.enabled && !testMode) return json({ error: "unavailable" }, 409, headers);
      const bk = body.booking ?? {};
      const date = String(bk.date ?? "");
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(bk.time ?? "")) ? String(bk.time) : null;
      const persons = Math.round(Number(bk.persons));
      const names = (Array.isArray(bk.names) ? bk.names : []).map((x: unknown) => String(x ?? "").trim().replace(/\s+/g, " ").slice(0, 80)).filter((x: string) => x.length >= 3);
      const flight = String(bk.flight ?? "").toUpperCase().replace(/\s+/g, "").slice(0, 12);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return json({ error: "invalid_date" }, 400, headers);
      // Mindestvorlauf: Abflug (Näherung TR-Zeit) minus Vorlauf des Angebots
      const dep = new Date(`${date}T${time}:00+03:00`).getTime();
      if (!Number.isFinite(dep) || dep - Date.now() < offer.lead_hours * 3600e3) return json({ error: "too_soon", lead_hours: offer.lead_hours }, 400, headers);
      if (dep - Date.now() > 365 * 864e5) return json({ error: "invalid_date" }, 400, headers);
      if (!(persons >= 1 && persons <= offer.max_persons) || names.length !== persons) return json({ error: "invalid_persons" }, 400, headers);
      if (flight && !/^[A-Z0-9]{2,3}\d{1,5}[A-Z]?$/.test(flight)) return json({ error: "invalid_flight" }, 400, headers);
      const price = Math.round(offer.price * persons * 100) / 100;
      const disc = await applyCoupon(String(body.coupon ?? ""), price, offer.currency);
      const amount = Math.max(0, Math.round((price - disc.discount) * 100) / 100);
      const { data: order, error } = await db.from("orders").insert({
        user_id: user.id, customer_email: user.email, product: offer.product, item_key: `airport:${offer.airport}`, plan_id: offer.id,
        title: `${offer.title} · ${persons}×`, amount, currency: offer.currency, plan_meta: { airport: offer.airport, persons, date },
        coupon: disc.code, discount: disc.discount, ...(testMode && !env("PAYMENT_PROVIDER") ? { status: "paid", test: true } : {}),
      }).select().single();
      if (error) throw error;
      const { data: booking, error: bErr } = await db.from("airport_bookings").insert({
        order_id: order.id, user_id: user.id, offer_id: offer.id, partner_id: offer.partner_id ?? null, product: offer.product, airport: offer.airport, title: offer.title,
        travel_date: date, travel_time: time, flight: flight || null, persons, names, customer_email: user.email,
        customer_phone: String(bk.phone ?? "").replace(/[^\d+ ]/g, "").slice(0, 30) || null, customer_note: String(bk.note ?? "").trim().slice(0, 1000) || null,
        cost: Math.round(Number(offer.cost) * persons * 100) / 100, cost_currency: offer.cost_currency, test: order.test,
        log: [logItem("kunde", "Buchung angelegt")],
      }).select("id, status").single();
      if (bErr) throw bErr;
      if (env("PAYMENT_PROVIDER")) {
        // TODO Zahlung: Zahlungssitzung erzeugen; nach erfolgreicher Zahlung (Webhook) status "paid" → dispatchForOrder()
        return json({ order, booking, coupon: disc.state, payment: { status: "not_implemented" } }, 501, headers);
      }
      if (!testMode) return json({ order, booking, coupon: disc.state, payment: { status: "provider_missing" } }, 409, headers);
      // Testmodus: als bezahlt behandeln → an den Partner nur, wenn im Panel „Testbestellungen senden“ an ist
      const sent = await dispatchForOrder(db, order.id, "kunde (test)");
      return json({ order, booking: { ...booking, status: sent ? "sent" : booking.status }, coupon: disc.state }, 200, headers);
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
      // Rabattcode prüfen (nur serverseitig): aktiv, im Zeitraum, Nutzungen frei, Mindestbestellwert erreicht
      const disc = await applyCoupon(String(body.coupon ?? ""), Number(plan.price), found.currency);
      const amount = Math.max(0, Math.round((Number(plan.price) - disc.discount) * 100) / 100);
      const { data: order, error } = await db.from("orders").insert({
        user_id: user.id, customer_email: user.email, product: "esim", item_key: item, plan_id: plan.id,
        title: `${plan.unlimited ? "Unlimited" : plan.gb + " GB"} · ${plan.days}`, amount, currency: found.currency,
        plan_meta: { gb: plan.gb, days: plan.days, unlimited: !!plan.unlimited },
        coupon: disc.code, discount: disc.discount,
      }).select().single();
      if (error) throw error;

      if (env("PAYMENT_PROVIDER")) {
        // TODO Zahlung: hier die Zahlungssitzung beim Anbieter erzeugen und die Weiterleitungsadresse zurückgeben.
        // Nach erfolgreicher Zahlung (Webhook) → status "paid" → provision() → eSIM speichern.
        return json({ order, coupon: disc.state, payment: { status: "not_implemented" } }, 501, headers);
      }
      if (env("ALLOW_TEST_ORDERS") !== "true") return json({ order, coupon: disc.state, payment: { status: "provider_missing" } }, 409, headers);

      // Testmodus: ohne Zahlung sofort eine Test-eSIM ausstellen – NIE eine echte (kostenpflichtige) eSIM
      const done = await fulfillOrder(db, order.id, { test: true });
      return json({ order: { ...done.order, test: true }, coupon: disc.state, esim: done.esim ? view(done.esim) : null }, 200, headers);
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
      const { data: vb } = await db.from("airport_bookings").select("status").eq("order_id", order.id).maybeSingle();
      if (vb?.status === "delivered") return json({ error: "voucher_delivered" }, 409, headers);
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
      await db.from("airport_bookings").update({ customer_phone: null, customer_note: null }).eq("user_id", user.id);
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
