/* ==========================================================================
   eSIM-Anbieter-Adapter
   --------------------------------------------------------------------------
   Hier wird später die Schnittstelle des eSIM-Anbieters angebunden.
   Benötigte Secrets in Supabase (Edge Functions → Secrets):
     ESIM_API_URL   Basis-Adresse der Anbieter-API
     ESIM_API_KEY   API-Schlüssel (nur hier auf dem Server, nie im Browser)
   Solange ESIM_API_URL leer ist, gibt es KEINE echten eSIMs:
   provision() liefert nur dann eine Test-eSIM, wenn ALLOW_TEST_ORDERS=true gesetzt ist.
   ========================================================================== */
import { env } from "./http.ts";

export type Provisioned = {
  iccid: string; lpa: string; smdp_address: string; activation_code: string;
  data_total_mb: number; validity_days: number; provider_ref: string; test: boolean;
};
export type Usage = { data_used_mb: number; status?: string; activated_at?: string | null; expires_at?: string | null };

export const providerConfigured = () => Boolean(env("ESIM_API_URL"));

/** Bestellt eine eSIM beim Anbieter. plan = Tarif aus der Preis-Schnittstelle. */
export async function provision(plan: { id: string; gb: number; days: number }): Promise<Provisioned> {
  if (providerConfigured()) {
    // TODO Anbieter: hier den Bestell-Endpunkt des Anbieters aufrufen und die Antwort umwandeln.
    // Beispiel (an die echte API anpassen):
    // const r = await fetch(`${env("ESIM_API_URL")}/orders`, { method: "POST",
    //   headers: { Authorization: `Bearer ${env("ESIM_API_KEY")}`, "Content-Type": "application/json" },
    //   body: JSON.stringify({ package_id: plan.id, quantity: 1 }) });
    // const d = await r.json();
    // return { iccid: d.iccid, lpa: d.qrcode, smdp_address: d.smdp, activation_code: d.matching_id,
    //          data_total_mb: plan.gb * 1024, validity_days: plan.days, provider_ref: d.order_id, test: false };
    throw new Error("eSIM-Anbieter ist noch nicht angebunden (provision in _shared/esim-provider.ts).");
  }
  if (env("ALLOW_TEST_ORDERS") !== "true") throw new Error("Kein eSIM-Anbieter angebunden.");
  // Test-eSIM: nur zum Ausprobieren des Kundenbereichs. Funktioniert NICHT auf einem echten Telefon.
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase();
  return {
    iccid: "TEST" + Date.now(), smdp_address: "test.smdp.invalid", activation_code: code,
    lpa: `LPA:1$test.smdp.invalid$${code}`, data_total_mb: Math.round(plan.gb * 1024),
    validity_days: plan.days, provider_ref: "test-" + code, test: true,
  };
}

/** Fragt Verbrauch und Status beim Anbieter ab. */
export async function usage(providerRef: string): Promise<Usage | null> {
  if (!providerConfigured() || providerRef.startsWith("test-")) return null;
  // TODO Anbieter: Verbrauchs-Endpunkt aufrufen, z. B.
  // const r = await fetch(`${env("ESIM_API_URL")}/esims/${providerRef}/usage`, { headers: { Authorization: `Bearer ${env("ESIM_API_KEY")}` } });
  // const d = await r.json();
  // return { data_used_mb: d.used_mb, status: d.status, activated_at: d.activated_at, expires_at: d.expires_at };
  return null;
}
