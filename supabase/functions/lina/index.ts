/* ==========================================================================
   passport.io – Lina mit KI (optional)
   --------------------------------------------------------------------------
   POST {question, lang, ids[]}  →  {answer, faq, handoff, lang}
   - Die Webseite schickt die Frage und als Hinweis die IDs der passendsten FAQs (Stichwortsuche im Browser).
   - Diese Funktion holt die FAQ-Texte selbst von der Webseite (content/assistant.json) – der Browser kann
     ihr also keine eigenen „Fakten“ unterschieben.
   - Claude bekommt alle FAQs (zwischengespeichert, daher günstig) und antwortet in der Sprache der Frage – NUR auf Basis der FAQs.
     Passt nichts, kommt handoff:true zurück und die Seite bietet das Team an.
   - Ohne Secret ANTHROPIC_API_KEY antwortet die Funktion 503 und die Seite nutzt nur die Stichwortsuche.
   Secrets: ANTHROPIC_API_KEY (geheim, von Hand in Supabase eintragen), SITE_URL (setzt die Veröffentlichung)
   ========================================================================== */
import { cors, env, json } from "../_shared/http.ts";
import { buildPrompt, readAnswer } from "../_shared/lina-prompt.js";

const MODEL = env("LINA_MODEL") || "claude-haiku-5-5";
const PER_IP = 15; // Fragen pro IP in 10 Minuten
const hits = new Map<string, number[]>();
let cache: { at: number; data: any } = { at: 0, data: null };

async function content() {
  if (cache.data && Date.now() - cache.at < 10 * 60 * 1000) return cache.data;
  const r = await fetch(new URL("content/assistant.json", env("SITE_URL")), { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`content ${r.status}`);
  cache = { at: Date.now(), data: await r.json() };
  return cache.data;
}


Deno.serve(async (req) => {
  const headers = cors(req, "POST, OPTIONS");
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers });
  const key = env("ANTHROPIC_API_KEY");
  if (!key || !env("SITE_URL")) return json({ error: "disabled" }, 503, headers);

  // einfache Bremse gegen Missbrauch
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  if (list.length >= PER_IP) return json({ error: "rate_limited" }, 429, headers);
  hits.set(ip, [...list, now]);

  try {
    const body = await req.json();
    const question = String(body.question ?? "").trim().slice(0, 400);
    if (question.length < 2) return json({ error: "empty" }, 400, headers);
    const data = await content();
    const lang = typeof body.lang === "string" && data[body.lang] ? body.lang : "tr";
    const ids: string[] = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 8);
    const { system, user, ids: known } = buildPrompt(data, lang, question, ids);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, temperature: 0, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: user }] }),
    });
    if (!r.ok) { console.error("anthropic", r.status, await r.text()); return json({ error: "upstream" }, 502, headers); }
    const res = readAnswer(await r.json(), known);
    if (!res) return json({ error: "parse" }, 502, headers);
    return json({ ...res, lang }, 200, headers);
  } catch (err) {
    console.error(err);
    return json({ error: "failed" }, 500, headers);
  }
});
