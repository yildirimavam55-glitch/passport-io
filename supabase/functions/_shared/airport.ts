/* ==========================================================================
   passport.io – Lounge & Fast Track über Partner (ohne Anbieter-API)
   --------------------------------------------------------------------------
   Preise: Einkauf aus der Partner-Preisliste (Tabelle airport_offers, im Panel gepflegt)
           × Aufschlag (markup_pct), nie unter Einkauf + min_margin_pct und min_price_eur, auf ,99.
           → Keine festen Preise im Code; Einkauf verlässt den Server nie.
   Zustellung: dispatch() schickt dem Partner einen geheimen Link zum Partner-Portal (partner.html)
           per E-Mail (Resend) und/oder WhatsApp (Business API). tick() erinnert, warnt und
           markiert verpasste Buchungen. deliver() gibt den hochgeladenen Voucher an den Kunden.
   ========================================================================== */
// deno-lint-ignore-file no-explicit-any
import { env } from "./http.ts";
import { loadSettings } from "./pricing.ts";
import { mailHtml, mailOn, sendMail } from "./mail.ts";
import { sendWhatsApp, waLink, whatsappOn } from "./whatsapp.ts";

export type AirportSettings = {
  markup_pct: number;      // Aufschlag auf den Einkauf in %
  sla_hours: number;       // so viele Stunden hat der Partner zum Liefern
  reminder_hours: number;  // Erinnerung, wenn so lange keine Reaktion
  max_reminders: number;
  cutoff_hours: number;    // so kurz vor Abflug gilt eine offene Buchung als verpasst
  auto_send: boolean;      // bezahlte Buchungen automatisch an den Partner schicken
  send_test: boolean;      // auch Testbestellungen automatisch schicken
  notify_admin: boolean;   // Team (ADMIN_MAIL) bei Problemen per Mail warnen
  enabled: boolean;        // Buchung auf der Webseite anbieten
};
export const AIRPORT_DEFAULTS: AirportSettings = { markup_pct: 35, sla_hours: 6, reminder_hours: 2, max_reminders: 2, cutoff_hours: 3, auto_send: true, send_test: false, notify_admin: true, enabled: false };

const n = (v: unknown, min: number, max: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d; };
export function cleanAirportSettings(s: any): AirportSettings {
  const d = AIRPORT_DEFAULTS;
  return {
    markup_pct: n(s?.markup_pct, 0, 500, d.markup_pct), sla_hours: n(s?.sla_hours, 1, 168, d.sla_hours),
    reminder_hours: n(s?.reminder_hours, 0.5, 48, d.reminder_hours), max_reminders: Math.round(n(s?.max_reminders, 0, 5, d.max_reminders)),
    cutoff_hours: n(s?.cutoff_hours, 0, 48, d.cutoff_hours),
    auto_send: s?.auto_send !== undefined ? !!s.auto_send : d.auto_send, send_test: !!s?.send_test,
    notify_admin: s?.notify_admin !== undefined ? !!s.notify_admin : d.notify_admin, enabled: !!s?.enabled,
  };
}
export async function loadAirportSettings(db: any): Promise<AirportSettings> {
  const { data } = await db.from("site_settings").select("value").eq("key", "airport").maybeSingle();
  return cleanAirportSettings({ ...AIRPORT_DEFAULTS, ...(data?.value ?? {}) });
}

/* ---------- Preise ---------- */
const r2 = (x: number) => Math.round(x * 100) / 100;
const ceil99 = (x: number) => { const c = Math.ceil(x) - 0.01; return r2(c >= x - 1e-9 ? c : c + 1); };

/** EZB-Kurse (Basis EUR) aus dem Zwischenspeicher der Preis-Funktion */
export async function eurRates(db: any): Promise<Record<string, number>> {
  const { data } = await db.from("price_cache").select("body").eq("id", "fx:EUR").maybeSingle();
  return { EUR: 1, ...(data?.body?.rates ?? {}) };
}

/** Verkaufspreis pro Person in EUR aus dem Einkauf (null, wenn der Kurs der Einkaufswährung fehlt) */
export function sellEur(cost: number, cur: string, rates: Record<string, number>, a: AirportSettings, p: { min_margin_pct: number; min_price_eur: number; round_99: boolean }) {
  const rate = rates[(cur || "EUR").toUpperCase()];
  if (!rate) return null;
  const costEur = cost / rate;
  const target = Math.max(costEur * (1 + a.markup_pct / 100), costEur * (1 + p.min_margin_pct / 100), p.min_price_eur);
  return p.round_99 ? ceil99(target) : r2(Math.ceil(target * 100) / 100);
}

export type PublicOffer = { id: string; product: string; airport: string; airport_name: string | null; terminal: string | null; title: string; details: string | null; price: number; currency: string; max_persons: number; lead_hours: number };

/** Aktive Angebote mit Verkaufspreis in der gewünschten Währung (ohne Kurs → EUR) */
export async function offerList(db: any, currency = "EUR", opts: { ids?: string[]; withCost?: boolean } = {}) {
  let q = db.from("airport_offers").select("*").eq("active", true).order("airport").order("product").order("cost");
  if (opts.ids) q = q.in("id", opts.ids);
  const [{ data: rows }, a, p, rates] = await Promise.all([q, loadAirportSettings(db), loadSettings(db), eurRates(db)]);
  const want = (currency || "EUR").toUpperCase();
  const rate = rates[want] ?? null;
  const cur = rate ? want : "EUR";
  const out: (PublicOffer & { cost?: number; cost_currency?: string; partner_id?: string | null })[] = [];
  for (const o of rows ?? []) {
    const eur = sellEur(Number(o.cost), o.cost_currency, rates, a, p);
    if (eur == null) continue;
    const price = cur === "EUR" ? eur : r2(eur * (rate as number));
    const item: any = { id: o.id, product: o.product, airport: o.airport, airport_name: o.airport_name, terminal: o.terminal, title: o.title, details: o.details, price, currency: cur, max_persons: o.max_persons, lead_hours: o.lead_hours };
    if (opts.withCost) Object.assign(item, { cost: Number(o.cost), cost_currency: o.cost_currency, partner_id: o.partner_id, price_eur: eur });
    out.push(item);
  }
  return { offers: out, currency: cur, settings: a };
}

/* ---------- Zustellung ---------- */
export const newToken = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const siteUrl = () => (env("SITE_URL") || "https://yildirimavam55-glitch.github.io/passport-io/").replace(/\/?$/, "/");
export const portalLink = (token: string) => `${siteUrl()}partner.html#t=${token}`;
export const accountLink = () => `${siteUrl()}account.html`;

const PRODUCT: Record<string, Record<string, string>> = {
  tr: { lounge: "Lounge", fasttrack: "Fast Track" }, de: { lounge: "Lounge", fasttrack: "Fast Track" }, en: { lounge: "Lounge", fasttrack: "Fast Track" },
};
const T: Record<string, Record<string, string>> = {
  tr: { newSub: "Yeni rezervasyon", remSub: "Hatırlatma: rezervasyon bekliyor", test: "TEST – lütfen satın alma", intro: "Yeni bir rezervasyon var. Bağlantıyı aç, voucher/QR kodunu yükle ve “Tamamlandı”ya dokun.", remIntro: "Bu rezervasyon hâlâ bekliyor. Lütfen bağlantıyı aç ve voucher/QR kodunu yükle.", open: "Rezervasyonu aç", due: "Teslim", date: "Tarih", flight: "Uçuş", persons: "Kişi", names: "İsimler", airport: "Havalimanı", product: "Ürün", note: "Not", foot: "Bu bağlantı yalnızca senin için. Kimseyle paylaşma." },
  de: { newSub: "Neue Buchung", remSub: "Erinnerung: Buchung wartet", test: "TEST – bitte nicht kaufen", intro: "Es gibt eine neue Buchung. Öffne den Link, lade den Voucher/QR-Code hoch und tippe auf „Erledigt“.", remIntro: "Diese Buchung wartet noch. Bitte öffne den Link und lade den Voucher/QR-Code hoch.", open: "Buchung öffnen", due: "Lieferung bis", date: "Datum", flight: "Flug", persons: "Personen", names: "Namen", airport: "Flughafen", product: "Produkt", note: "Hinweis", foot: "Dieser Link ist nur für dich. Bitte nicht weitergeben." },
  en: { newSub: "New booking", remSub: "Reminder: booking waiting", test: "TEST – please do not buy", intro: "There is a new booking. Open the link, upload the voucher/QR code and tap “Done”.", remIntro: "This booking is still waiting. Please open the link and upload the voucher/QR code.", open: "Open booking", due: "Deliver by", date: "Date", flight: "Flight", persons: "Persons", names: "Names", airport: "Airport", product: "Product", note: "Note", foot: "This link is only for you. Please do not share it." },
};
const fmtDue = (d: string | null, lang: string) => { if (!d) return "–"; try { return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : lang === "en" ? "en-GB" : "tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(d)) + " (TR)"; } catch (_) { return d; } };

export function partnerMessage(b: any, lang: string, link: string, reminder = false) {
  const L = T[lang] ?? T.tr, P = PRODUCT[lang] ?? PRODUCT.tr;
  const when = `${b.travel_date}${b.travel_time ? " " + b.travel_time : ""}`;
  const rows: [string, string][] = [
    [L.product, `${P[b.product] ?? b.product} · ${b.title ?? ""}`], [L.airport, b.airport], [L.date, when], [L.flight, b.flight || "–"],
    [L.persons, String(b.persons)], [L.names, (b.names ?? []).join(", ") || "–"], [L.due, fmtDue(b.due_at, lang)],
  ];
  if (b.customer_note) rows.push([L.note, b.customer_note]);
  const head = `${b.test ? `[${L.test}] ` : ""}${reminder ? L.remSub : L.newSub}`;
  const summary = `${head}: ${P[b.product] ?? b.product} ${b.airport}, ${when}, ${b.persons} ${L.persons}${b.flight ? ", " + b.flight : ""}`;
  const subject = `${head} · ${P[b.product] ?? b.product} ${b.airport} · ${when} · #${String(b.id).slice(0, 8)}`;
  const text = `${summary}\n${L.due}: ${fmtDue(b.due_at, lang)}\n\n${reminder ? L.remIntro : L.intro}\n${link}`;
  return { subject, summary, text, html: mailHtml(head, reminder ? L.remIntro : L.intro, rows, { label: L.open, url: link }, L.foot) };
}

export const logItem = (who: string, what: string) => ({ at: new Date().toISOString(), who, what });
async function addLog(db: any, id: string, entries: any[], patch: Record<string, unknown> = {}) {
  const { data } = await db.from("airport_bookings").select("log").eq("id", id).single();
  const log = [...(data?.log ?? []), ...entries].slice(-100);
  await db.from("airport_bookings").update({ ...patch, log, updated_at: new Date().toISOString() }).eq("id", id);
}

/** Team warnen (ADMIN_MAIL), wenn eingeschaltet und Mail eingerichtet */
export async function alertAdmin(db: any, subject: string, rows: [string, string][]) {
  const a = await loadAirportSettings(db);
  if (!a.notify_admin) return false;
  const to = (env("ADMIN_EMAILS") || env("ADMIN_MAIL")).split(",").map((s) => s.trim()).filter(Boolean);
  return sendMail({ to, subject: `passport.io · ${subject}`, html: mailHtml(subject, "Lounge & Fast Track – bitte im Panel prüfen.", rows, { label: "Panel öffnen", url: `${siteUrl()}admin/panel.html#airport` }) });
}

/** Buchung an den Partner schicken (neu oder Erinnerung). Gibt Kanäle + WhatsApp-Link zum Antippen zurück. */
export async function dispatch(db: any, id: string, who = "system", reminder = false) {
  const { data: b } = await db.from("airport_bookings").select("*").eq("id", id).single();
  if (!b) throw new Error("not_found");
  if (["delivered", "cancelled"].includes(b.status)) throw new Error("closed");
  const a = await loadAirportSettings(db);
  let partnerId = b.partner_id;
  if (!partnerId && b.offer_id) { const { data: o } = await db.from("airport_offers").select("partner_id").eq("id", b.offer_id).maybeSingle(); partnerId = o?.partner_id ?? null; }
  if (!partnerId) { const { data: p } = await db.from("airport_partners").select("id").eq("active", true).order("created_at").limit(1).maybeSingle(); partnerId = p?.id ?? null; }
  if (!partnerId) throw new Error("no_partner");
  const { data: partner } = await db.from("airport_partners").select("*").eq("id", partnerId).single();
  const token = b.token || newToken();
  const now = new Date();
  const due = !reminder || !b.due_at ? new Date(now.getTime() + a.sla_hours * 3600e3).toISOString() : b.due_at;
  const link = portalLink(token);
  const msg = partnerMessage({ ...b, due_at: due }, partner.language || "tr", link, reminder);
  const [mailed, whatsapped] = await Promise.all([
    partner.email ? sendMail({ to: partner.email, subject: msg.subject, html: msg.html, text: msg.text }) : false,
    partner.whatsapp ? sendWhatsApp(partner.whatsapp, msg.summary, link) : false,
  ]);
  const channels = [mailed && "e-mail", whatsapped && "whatsapp"].filter(Boolean) as string[];
  const patch: Record<string, unknown> = { token, partner_id: partnerId };
  if (reminder) Object.assign(patch, { reminded_at: now.toISOString(), reminders: (b.reminders ?? 0) + 1 });
  else Object.assign(patch, { status: b.status === "accepted" ? "accepted" : "sent", sent_at: now.toISOString(), due_at: due, alerted_at: null, reminded_at: null, reminders: 0 });
  await addLog(db, id, [logItem(who, `${reminder ? "Erinnerung" : "An Partner gesendet"} (${partner.name}): ${channels.join(" + ") || "kein automatischer Kanal – Link manuell senden"}`)], patch);
  return { link, channels, wa: partner.whatsapp ? waLink(partner.whatsapp, msg.text) : null, partner: partner.name, mailOn: mailOn(), whatsappOn: whatsappOn() };
}

/** Bezahlte Bestellung → zugehörige Buchung automatisch verschicken (wenn eingeschaltet) */
export async function dispatchForOrder(db: any, orderId: string, who = "system") {
  const a = await loadAirportSettings(db);
  const { data: b } = await db.from("airport_bookings").select("id, status, test").eq("order_id", orderId).maybeSingle();
  if (!b || b.status !== "new" || !a.auto_send || (b.test && !a.send_test)) return null;
  try { return await dispatch(db, b.id, who); }
  catch (err) { await addLog(db, b.id, [logItem(who, `Automatischer Versand fehlgeschlagen: ${(err as Error).message}`)]); await alertAdmin(db, "Buchung konnte nicht verschickt werden", [["Buchung", String(b.id).slice(0, 8)], ["Grund", (err as Error).message]]); return null; }
}

/** Signierte Download-Links (Standard 7 Tage) für die Dateien einer Buchung */
export async function signedFiles(db: any, files: any[], seconds = 7 * 86400) {
  return Promise.all((files ?? []).map(async (f) => {
    const { data } = await db.storage.from("vouchers").createSignedUrl(f.path, seconds);
    return { name: f.name, type: f.type, size: f.size, url: data?.signedUrl ?? null };
  }));
}

const CUST: Record<string, { sub: string; intro: string; btn: string }> = {
  tr: { sub: "Voucher'ın hazır", intro: "Lounge/Fast Track voucher'ın hazır. Hesabında “Siparişlerim” altında QR kodunu açabilirsin. Havalimanında bu kodu göster.", btn: "Hesabımı aç" },
  de: { sub: "Dein Voucher ist da", intro: "Dein Lounge-/Fast-Track-Voucher ist fertig. Du findest den QR-Code in deinem Konto. Zeig ihn am Flughafen vor.", btn: "Mein Konto öffnen" },
  en: { sub: "Your voucher is ready", intro: "Your lounge/fast track voucher is ready. Open the QR code in your account and show it at the airport.", btn: "Open my account" },
};

/** Voucher an den Kunden geben: Status, Bestellung erfüllt, Mail an den Kunden */
export async function deliver(db: any, id: string, who: string) {
  const { data: b } = await db.from("airport_bookings").select("*").eq("id", id).single();
  if (!b) throw new Error("not_found");
  if (!(b.files ?? []).length) throw new Error("no_file");
  const now = new Date().toISOString();
  if (b.order_id) await db.from("orders").update({ status: "fulfilled", updated_at: now }).eq("id", b.order_id).eq("status", "paid");
  let lang = "en";
  if (b.user_id) { const { data: p } = await db.from("profiles").select("language").eq("id", b.user_id).maybeSingle(); lang = CUST[p?.language] ? p.language : "en"; }
  const c = CUST[lang];
  const mailed = b.customer_email ? await sendMail({ to: b.customer_email, subject: `passport.io · ${c.sub}`, html: mailHtml(c.sub, c.intro, [["", `${b.title ?? ""} · ${b.airport} · ${b.travel_date}`]], { label: c.btn, url: accountLink() }) }) : false;
  await addLog(db, id, [logItem(who, `Voucher zugestellt${mailed ? " (Mail an Kunden)" : " (im Kundenkonto sichtbar)"}`)], { status: "delivered", delivered_at: now });
  return { mailed };
}

/** Datei speichern (Partner-Portal oder Panel) */
/** Dateityp am Inhalt erkennen – die Angabe des Browsers allein reicht nicht (sonst z. B. HTML als „Bild“) */
function sniff(b: Uint8Array, type: string) {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (type === "image/png") return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === "image/jpeg") return at(0, 0xff, 0xd8, 0xff);
  if (type === "image/webp") return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
  if (type === "application/pdf") return at(0, 0x25, 0x50, 0x44, 0x46, 0x2d);
  return false;
}
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };
export async function storeFile(db: any, id: string, bytes: Uint8Array, type: string, name: string, who: string) {
  if (!TYPES[type] || !sniff(bytes, type)) throw new Error("type");
  if (bytes.length > 8 * 1024 * 1024) throw new Error("too_big");
  const { data: b } = await db.from("airport_bookings").select("files, status").eq("id", id).single();
  if (!b || ["cancelled"].includes(b.status)) throw new Error("closed");
  if ((b.files ?? []).length >= 10) throw new Error("too_many");
  const safe = String(name || "voucher").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const path = `${id}/${Date.now()}-${safe.replace(/\.[a-z0-9]+$/i, "")}.${TYPES[type]}`;
  const { error } = await db.storage.from("vouchers").upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw error;
  const files = [...(b.files ?? []), { path, name: safe, type, size: bytes.length, at: new Date().toISOString(), by: who }];
  await addLog(db, id, [logItem(who, `Datei hochgeladen: ${safe}`)], { files });
  return files;
}

export async function removeFile(db: any, id: string, path: string, who: string) {
  const { data: b } = await db.from("airport_bookings").select("files").eq("id", id).single();
  const files = (b?.files ?? []).filter((f: any) => f.path !== path);
  await db.storage.from("vouchers").remove([path]);
  await addLog(db, id, [logItem(who, "Datei entfernt")], { files });
  return files;
}

/** Wächter (alle 15 Minuten über GitHub Actions): erinnern, warnen, verpasste Buchungen markieren */
export async function tick(db: any) {
  const a = await loadAirportSettings(db);
  const now = Date.now();
  const { data: list } = await db.from("airport_bookings").select("*").in("status", ["new", "sent", "accepted"]).order("created_at").limit(200);
  const done = { reminded: 0, alerted: 0, failed: 0, cleaned: 0 };
  // Datensparsamkeit (DSGVO/KVKK): 30 Tage nach der Reise Voucher-Dateien und Telefonnummer löschen
  const old = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
  const { data: stale } = await db.from("airport_bookings").select("id, files").lt("travel_date", old).or("customer_phone.not.is.null,token.not.is.null").limit(50);
  for (const s of stale ?? []) {
    const paths = (s.files ?? []).map((f: any) => f.path).filter(Boolean);
    if (paths.length) await db.storage.from("vouchers").remove(paths);
    await db.from("airport_bookings").update({ files: [], customer_phone: null, token: null, updated_at: new Date().toISOString() }).eq("id", s.id);
    done.cleaned++;
  }
  for (const b of list ?? []) {
    const dep = new Date(`${b.travel_date}T${b.travel_time || "23:59"}:00+03:00`).getTime(); // Ortszeit unbekannt → TR-Zeit als Näherung
    // 1) Zu knapp vor Abflug und noch nicht geliefert → verpasst
    if (dep - now < a.cutoff_hours * 3600e3) {
      await addLog(db, b.id, [logItem("wächter", "Nicht rechtzeitig geliefert – als verpasst markiert. Erstattung prüfen.")], { status: "failed" });
      if (!b.test) await alertAdmin(db, "Buchung verpasst – Erstattung prüfen", [["Buchung", `#${String(b.id).slice(0, 8)}`], ["Flughafen", b.airport], ["Abflug", `${b.travel_date} ${b.travel_time ?? ""}`], ["Kunde", b.customer_email ?? "–"]]);
      done.failed++; continue;
    }
    // 2) Bezahlt, aber noch nicht verschickt (z. B. kein Partner) → Team warnen
    if (b.status === "new") {
      if (b.order_id && !b.alerted_at && now - new Date(b.created_at).getTime() > 30 * 60e3) {
        const { data: o } = await db.from("orders").select("status").eq("id", b.order_id).maybeSingle();
        if (o?.status === "paid") { await alertAdmin(db, "Bezahlte Buchung noch nicht verschickt", [["Buchung", `#${String(b.id).slice(0, 8)}`], ["Flughafen", b.airport]]); await addLog(db, b.id, [logItem("wächter", "Team gewarnt: bezahlt, aber nicht verschickt")], { alerted_at: new Date().toISOString() }); done.alerted++; }
      }
      continue;
    }
    // 3) Keine Reaktion → Erinnerung an den Partner
    const last = new Date(b.reminded_at || b.sent_at || b.created_at).getTime();
    if (b.status === "sent" && (b.reminders ?? 0) < a.max_reminders && now - last > a.reminder_hours * 3600e3) {
      try { await dispatch(db, b.id, "wächter", true); done.reminded++; } catch (err) { console.error(err); }
    }
    // 4) Frist überschritten → Team einmal warnen
    if (b.due_at && now > new Date(b.due_at).getTime() && !b.alerted_at) {
      if (!b.test) await alertAdmin(db, "Partner hat noch nicht geliefert", [["Buchung", `#${String(b.id).slice(0, 8)}`], ["Flughafen", b.airport], ["Abflug", `${b.travel_date} ${b.travel_time ?? ""}`], ["Frist", b.due_at]]);
      await addLog(db, b.id, [logItem("wächter", "Frist überschritten – Team gewarnt")], { alerted_at: new Date().toISOString() });
      done.alerted++;
    }
  }
  return done;
}
