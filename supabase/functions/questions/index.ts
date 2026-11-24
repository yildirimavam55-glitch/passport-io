/* ==========================================================================
   passport.io – Fragen an Lina und Kontaktanfragen
   --------------------------------------------------------------------------
   1. {question, page}            → Frage, die Lina nicht beantworten konnte (ohne Personendaten)
   2. {kind:"support", name, email, message, page, website}
                                   → Anfrage „Mit einem Menschen sprechen“ (Panel → Anfragen)
      „website“ ist ein unsichtbares Lockfeld gegen Bots: ist es ausgefüllt, wird nichts gespeichert.
      Höchstens 3 Anfragen pro E-Mail und Stunde.
   3. {kind:"newsletter", email, lang, page, consent, website}
                                   → Bülten-Anmeldung (Panel → Bülten)
   ========================================================================== */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors, env } from "../_shared/http.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

Deno.serve(async (req) => {
  const headers = cors(req, "POST, OPTIONS");
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers });

  try {
    const body = await req.json();

    if (body.kind === "newsletter") {
      // Bülten-Anmeldung: Lockfeld gegen Bots, gültige E-Mail; erneute Anmeldung hebt eine Abmeldung auf
      if (body.website) return new Response(null, { status: 204, headers });
      const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
      if (!EMAIL.test(email)) return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers });
      const { error } = await db.from("newsletter_subscribers").upsert({
        email, lang: String(body.lang ?? "").slice(0, 5) || null, source: String(body.page ?? "").slice(0, 120) || null,
        consent_text: String(body.consent ?? "").slice(0, 300) || null, unsubscribed_at: null,
      }, { onConflict: "email" });
      if (error) throw error;
      return new Response(null, { status: 204, headers });
    }

    if (body.kind === "support") {
      if (body.website) return new Response(null, { status: 204, headers }); // Bot
      const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
      const message = String(body.message ?? "").trim().slice(0, 4000);
      if (!EMAIL.test(email) || message.length < 5) return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers });
      const since = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count } = await db.from("support_requests").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", since);
      if ((count ?? 0) >= 3) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers });
      const { error } = await db.from("support_requests").insert({
        email, name: String(body.name ?? "").trim().slice(0, 120) || null, subject: "Lina", message, page: String(body.page ?? "").slice(0, 120),
      });
      if (error) throw error;
      return new Response(null, { status: 204, headers });
    }

    const q = String(body.question ?? "").trim().slice(0, 300);
    if (q.length < 3) return new Response(null, { status: 204, headers });
    const { error } = await db.from("unanswered_questions").insert({ question: q, page: String(body.page ?? "").slice(0, 100) });
    if (error) throw error;
    return new Response(null, { status: 204, headers });
  } catch (err) {
    console.error(err);
    return new Response(null, { status: 400, headers });
  }
});
