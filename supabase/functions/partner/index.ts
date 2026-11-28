/* ==========================================================================
   passport.io – Partner-Portal (Lounge & Fast Track ohne Anbieter-API)
   --------------------------------------------------------------------------
   Zugang nur über den geheimen Link aus der Partner-Nachricht (partner.html#t=<token>).
     GET  ?t=<token>                       → Buchungsdaten (ohne Kunden-E-Mail, ohne Preise)
     POST {t, action:"accept"}             → „Ich kümmere mich“
     POST {t, action:"decline", reason}    → „Kann ich nicht“ → Team wird gewarnt
     POST multipart (t, file)              → QR-Code/Voucher hochladen (PNG, JPG, WEBP, PDF, ≤ 8 MB)
     POST {t, action:"remove", path}       → eigene Datei entfernen (vor dem Abschluss)
     POST {t, action:"done", note}         → Abschluss → Kunde bekommt den Voucher
     GET  ?tick=1                          → Wächter (Erinnern/Warnen), alle 15 Min. per GitHub Actions
   ========================================================================== */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors, env, json } from "../_shared/http.ts";
import { alertAdmin, deliver, logItem, removeFile, signedFiles, storeFile, tick } from "../_shared/airport.ts";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
let lastTick = 0;
const okToken = (t: unknown) => typeof t === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(t);

async function byToken(t: unknown) {
  if (!okToken(t)) return null;
  const { data } = await db.from("airport_bookings").select("*").eq("token", t).maybeSingle();
  if (!data) return null;
  // Link läuft 14 Tage nach dem Reisedatum ab
  if (Date.now() > new Date(`${data.travel_date}T23:59:59Z`).getTime() + 14 * 864e5) return null;
  return data;
}

async function addLog(id: string, what: string, patch: Record<string, unknown> = {}) {
  const { data } = await db.from("airport_bookings").select("log").eq("id", id).single();
  await db.from("airport_bookings").update({ ...patch, log: [...(data?.log ?? []), logItem("partner", what)].slice(-100), updated_at: new Date().toISOString() }).eq("id", id);
}

async function view(b: any) {
  const { data: offer } = b.offer_id ? await db.from("airport_offers").select("airport_name, terminal, details").eq("id", b.offer_id).maybeSingle() : { data: null };
  const { data: partner } = b.partner_id ? await db.from("airport_partners").select("name, language").eq("id", b.partner_id).maybeSingle() : { data: null };
  return {
    id: String(b.id).slice(0, 8), product: b.product, airport: b.airport, airport_name: offer?.airport_name ?? null, terminal: offer?.terminal ?? null,
    title: b.title, details: offer?.details ?? null, travel_date: b.travel_date, travel_time: b.travel_time, flight: b.flight, persons: b.persons,
    names: b.names, phone: b.customer_phone, note: b.customer_note, status: b.status, due_at: b.due_at, test: b.test,
    partner_note: b.partner_note, partner: partner?.name ?? null, language: partner?.language ?? "tr",
    files: (await signedFiles(db, b.files, 3600)).map((f, i) => ({ ...f, path: b.files[i].path })),
  };
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  const url = new URL(req.url);
  try {
    if (req.method === "GET" && url.searchParams.get("tick") === "1") {
      // Öffentlich erreichbar, aber harmlos: tut nur Fälliges; gegen Dauerfeuer höchstens 1× pro Minute je Instanz
      if (Date.now() - lastTick < 60e3) return json({ ok: true, skipped: true }, 200, headers);
      lastTick = Date.now();
      return json({ ok: true, ...(await tick(db)) }, 200, headers);
    }

    if (req.method === "GET") {
      const b = await byToken(url.searchParams.get("t"));
      if (!b) return json({ error: "not_found" }, 404, headers);
      if (!(b.log ?? []).some((l: any) => l.who === "partner" && l.what === "Link geöffnet")) await addLog(b.id, "Link geöffnet");
      return json({ booking: await view(b) }, 200, headers);
    }
    if (req.method !== "POST") return json({ error: "method" }, 405, headers);

    // Datei-Upload (multipart/form-data)
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData();
      const b = await byToken(form.get("t"));
      if (!b) return json({ error: "not_found" }, 404, headers);
      if (["delivered", "cancelled", "failed"].includes(b.status)) return json({ error: "closed" }, 409, headers);
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "file" }, 400, headers);
      try {
        await storeFile(db, b.id, new Uint8Array(await file.arrayBuffer()), file.type, file.name, "partner");
      } catch (err) {
        const m = (err as Error).message;
        return json({ error: ["type", "too_big", "too_many", "closed"].includes(m) ? m : "upload" }, 400, headers);
      }
      if (b.status === "sent") await db.from("airport_bookings").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", b.id);
      const fresh = await byToken(form.get("t"));
      return json({ booking: await view(fresh) }, 200, headers);
    }

    const body = await req.json().catch(() => ({}));
    const b = await byToken(body.t);
    if (!b) return json({ error: "not_found" }, 404, headers);
    const closed = ["delivered", "cancelled", "failed"].includes(b.status);

    if (body.action === "accept") {
      if (closed) return json({ error: "closed" }, 409, headers);
      if (b.status !== "accepted") await addLog(b.id, "Angenommen", { status: "accepted", accepted_at: new Date().toISOString() });
    } else if (body.action === "decline") {
      if (closed) return json({ error: "closed" }, 409, headers);
      const reason = String(body.reason ?? "").trim().slice(0, 500) || "–";
      await addLog(b.id, `Abgelehnt: ${reason}`, { status: "declined", partner_note: reason });
      await alertAdmin(db, "Partner hat eine Buchung abgelehnt", [["Buchung", `#${String(b.id).slice(0, 8)}`], ["Flughafen", b.airport], ["Abflug", `${b.travel_date} ${b.travel_time ?? ""}`], ["Grund", reason]]);
    } else if (body.action === "remove") {
      if (closed) return json({ error: "closed" }, 409, headers);
      if (!(b.files ?? []).some((f: any) => f.path === body.path && f.by === "partner")) return json({ error: "not_found" }, 404, headers);
      await removeFile(db, b.id, String(body.path), "partner");
    } else if (body.action === "done") {
      if (closed) return json({ error: "closed" }, 409, headers);
      if (!(b.files ?? []).length) return json({ error: "no_file" }, 400, headers);
      const note = String(body.note ?? "").trim().slice(0, 1000);
      if (note) await db.from("airport_bookings").update({ partner_note: note }).eq("id", b.id);
      await deliver(db, b.id, "partner");
    } else return json({ error: "unknown_action" }, 400, headers);

    return json({ booking: await view(await byToken(body.t)) }, 200, headers);
  } catch (err) {
    console.error(err);
    return json({ error: "server" }, 500, headers);
  }
});
