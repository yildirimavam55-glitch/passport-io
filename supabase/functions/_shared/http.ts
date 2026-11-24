// Gemeinsame Helfer für alle Edge Functions: Umgebungsvariablen, CORS, JSON-Antworten
export const env = (k: string) => Deno.env.get(k) ?? "";

export function cors(req: Request, methods = "GET, POST, OPTIONS") {
  const allowed = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": !allowed.length || allowed.includes(origin) ? origin || "*" : allowed[0],
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    Vary: "Origin",
  };
}

export const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
