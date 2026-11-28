/* WhatsApp-Versand (optional) über die offizielle WhatsApp Business Cloud API (Meta).
   Secrets: WHATSAPP_TOKEN (dauerhaftes System-User-Token), WHATSAPP_PHONE_ID (Telefonnummer-ID),
            WHATSAPP_TEMPLATE (Name einer freigegebenen Vorlage mit 2 Variablen: {{1}} = Kurzinfo, {{2}} = Link),
            WHATSAPP_TEMPLATE_LANG (Sprache der Vorlage, Standard "tr").
   Ohne Secrets: Rückgabe false – das Panel bietet dann einen wa.me-Link zum Antippen an.
   Keine inoffiziellen WhatsApp-Bots (verstoßen gegen die Nutzungsbedingungen, Nummer kann gesperrt werden). */
import { env } from "./http.ts";

export const whatsappOn = () => !!env("WHATSAPP_TOKEN") && !!env("WHATSAPP_PHONE_ID") && !!env("WHATSAPP_TEMPLATE");
export const waNumber = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^00/, "");

export async function sendWhatsApp(to: string, summary: string, link: string): Promise<boolean> {
  const num = waNumber(to);
  if (!whatsappOn() || num.length < 8) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${env("WHATSAPP_PHONE_ID")}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: num, type: "template",
        template: {
          name: env("WHATSAPP_TEMPLATE"), language: { code: env("WHATSAPP_TEMPLATE_LANG") || "tr" },
          // Vorlagen-Variablen dürfen keine Zeilenumbrüche enthalten
          components: [{ type: "body", parameters: [{ type: "text", text: summary.replace(/\s+/g, " ").slice(0, 900) }, { type: "text", text: link }] }],
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error("whatsapp", r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (err) {
    console.error("whatsapp", err);
    return false;
  }
}

/** Link zum Antippen (öffnet WhatsApp mit vorbereitetem Text) – Fallback ohne Business-API */
export const waLink = (to: string, text: string) => { const n = waNumber(to); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null; };
