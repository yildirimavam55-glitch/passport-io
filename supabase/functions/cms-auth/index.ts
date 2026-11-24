/* ==========================================================================
   passport.io – Anmeldung für den Admin-Bereich (Decap CMS über GitHub)
   --------------------------------------------------------------------------
   Ablauf: Admin (/admin) öffnet ein Fenster auf diese Funktion → weiter zu GitHub →
   GitHub kommt hierher zurück (/callback) → Token holen → weiter zu /admin/callback.html
   auf der eigenen Webseite, die das Token an den Admin-Bereich übergibt.
   (Supabase liefert HTML aus Funktionen nur als Text aus – daher die eigene Rückkehrseite.)
   Bearbeiten kann nur, wer im GitHub-Repository Schreibrechte hat.
   Secrets in Supabase:
     GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET   (GitHub → Settings → Developer settings → OAuth Apps)
   Callback-URL der OAuth-App:  https://<projekt>.supabase.co/functions/v1/cms-auth/callback
   ========================================================================== */
import { env } from "../_shared/http.ts";

const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const allowed = (u: URL) => env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).includes(u.origin);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const clientId = env("GITHUB_CLIENT_ID"), secret = env("GITHUB_CLIENT_SECRET");
  if (!clientId || !secret) return text("GitHub-Anmeldung ist noch nicht eingerichtet (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET fehlen).", 500);
  const self = `${env("SUPABASE_URL")}/functions/v1/cms-auth`;

  // Schritt 2: Rückkehr von GitHub
  if (url.pathname.endsWith("/callback")) {
    let back: URL;
    try { back = new URL(JSON.parse(atob(url.searchParams.get("state") ?? "")).back); } catch (_) { return text("Ungültige Anfrage.", 400); }
    if (!allowed(back)) return text("Diese Webadresse ist nicht freigegeben.", 403);
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: secret, code: url.searchParams.get("code") ?? "", redirect_uri: `${self}/callback` }),
    });
    const d = await r.json().catch(() => ({}));
    // Token nur im #-Teil der Adresse: er wird nie an einen Server gesendet
    back.hash = d.access_token ? `token=${encodeURIComponent(d.access_token)}` : `error=${encodeURIComponent(d.error ?? "token")}`;
    return Response.redirect(back.toString(), 302);
  }

  // Schritt 1: Start – Rückkehrseite merken und weiter zu GitHub
  const ref = req.headers.get("referer");
  if (!ref) return text("Bitte über den Admin-Bereich anmelden.", 400);
  const back = new URL("callback.html", new URL(ref));
  if (!allowed(back)) return text("Diese Webadresse ist nicht freigegeben.", 403);
  const gh = new URL("https://github.com/login/oauth/authorize");
  gh.searchParams.set("client_id", clientId);
  gh.searchParams.set("redirect_uri", `${self}/callback`);
  gh.searchParams.set("scope", url.searchParams.get("scope") || "repo,user");
  gh.searchParams.set("state", btoa(JSON.stringify({ back: back.toString(), n: crypto.randomUUID() })));
  return Response.redirect(gh.toString(), 302);
});
