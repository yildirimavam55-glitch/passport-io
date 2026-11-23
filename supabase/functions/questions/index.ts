/* ==========================================================================
   passport.io – Fragen, die Lina nicht beantworten konnte
   --------------------------------------------------------------------------
   Die Webseite schickt unbeantwortete Fragen hierher. Das Team sieht sie in
   Supabase → Table Editor → unanswered_questions und ergänzt daraus neue
   FAQ-Einträge im Admin. So sinken die Support-Anfragen Schritt für Schritt.
   Gespeichert wird nur der Fragetext (max. 300 Zeichen) und die Seite –
   keine IP-Adresse, keine Personendaten.
   ========================================================================== */

import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

function cors(req: Request) {
  const allowed = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": !allowed.length || allowed.includes(origin) ? origin || "*" : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    Vary: "Origin",
  };
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers });

  try {
    const { question, page } = await req.json();
    const q = String(question ?? "").trim().slice(0, 300);
    if (q.length < 3) return new Response(null, { status: 204, headers });
    const { error } = await db.from("unanswered_questions").insert({ question: q, page: String(page ?? "").slice(0, 100) });
    if (error) throw error;
    return new Response(null, { status: 204, headers });
  } catch (err) {
    console.error(err);
    return new Response(null, { status: 400, headers });
  }
});
