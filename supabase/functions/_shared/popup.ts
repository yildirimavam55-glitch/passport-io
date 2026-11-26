// Pop-up auf der Website: Aktion mit Rabattcode (wenn aktiv) – sonst Newsletter-Anmeldung.
// Einstellungen stehen in site_settings (key "popup") und werden im Panel unter „Pop-up & kampanya“ gepflegt.

export type PopupSettings = {
  newsletter: { enabled: boolean; delay: number; welcomeCode: string | null };
  promo: { enabled: boolean; code: string | null; startsAt: string | null; endsAt: string | null; title: Record<string, string>; text: Record<string, string> };
  everyDays: number;
};

export const DEFAULT_POPUP: PopupSettings = {
  newsletter: { enabled: true, delay: 6, welcomeCode: null },
  promo: { enabled: false, code: null, startsAt: null, endsAt: null, title: {}, text: {} },
  everyDays: 7,
};

const LANGS = ["tr", "en", "de", "ar", "ru", "fr", "es"];
const str = (v: unknown, n: number) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, n);
const code = (v: unknown) => { const c = String(v ?? "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32); return c || null; };
const date = (v: unknown) => { const d = v ? new Date(String(v)) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : null; };
const texts = (o: unknown, n: number) => Object.fromEntries(LANGS.map((l) => [l, str((o as any)?.[l], n)]).filter(([, v]) => v));

/** Eingaben aus dem Panel prüfen und in eine saubere Form bringen */
export function cleanPopup(b: any): PopupSettings {
  return {
    newsletter: {
      enabled: !!b?.newsletter?.enabled,
      delay: Math.min(60, Math.max(0, Math.round(Number(b?.newsletter?.delay ?? 6)))),
      welcomeCode: code(b?.newsletter?.welcomeCode),
    },
    promo: {
      enabled: !!b?.promo?.enabled, code: code(b?.promo?.code),
      startsAt: date(b?.promo?.startsAt), endsAt: date(b?.promo?.endsAt),
      title: texts(b?.promo?.title, 80), text: texts(b?.promo?.text, 220),
    },
    everyDays: Math.min(90, Math.max(1, Math.round(Number(b?.everyDays ?? 7)))),
  };
}

export async function loadPopup(db: any): Promise<PopupSettings> {
  const { data } = await db.from("site_settings").select("value").eq("key", "popup").maybeSingle();
  const v = data?.value || {};
  return { ...DEFAULT_POPUP, ...v, newsletter: { ...DEFAULT_POPUP.newsletter, ...(v.newsletter || {}) }, promo: { ...DEFAULT_POPUP.promo, ...(v.promo || {}) } };
}

/** Ist der Rabattcode jetzt gültig? Liefert nur, was öffentlich sein darf (Art, Wert, Ende). */
export async function codeInfo(db: any, c: string | null) {
  if (!c) return null;
  const { data: d } = await db.from("discount_codes").select("code, kind, value, min_amount, active, starts_at, ends_at, max_uses, used_count").eq("code", c).maybeSingle();
  const now = Date.now();
  if (!d || !d.active || (d.starts_at && new Date(d.starts_at).getTime() > now) || (d.ends_at && new Date(d.ends_at).getTime() < now) || (d.max_uses && d.used_count >= d.max_uses)) return null;
  return { code: d.code, kind: d.kind, value: Number(d.value), minAmount: Number(d.min_amount || 0), endsAt: d.ends_at };
}

/** Öffentliche Sicht für die Website: genau ein Pop-up oder keins. Der Willkommenscode bleibt geheim bis zur Anmeldung. */
export async function publicPopup(db: any) {
  const s = await loadPopup(db), now = Date.now();
  const p = s.promo;
  if (p.enabled && p.code && (!p.startsAt || new Date(p.startsAt).getTime() <= now) && (!p.endsAt || new Date(p.endsAt).getTime() > now)) {
    const info = await codeInfo(db, p.code);
    if (info) {
      const ends = [p.endsAt, info.endsAt].filter(Boolean).map((x) => new Date(String(x)).getTime());
      return { type: "promo", id: "promo:" + info.code, code: info.code, kind: info.kind, value: info.value, minAmount: info.minAmount, endsAt: ends.length ? new Date(Math.min(...ends)).toISOString() : null, title: p.title, text: p.text, delay: s.newsletter.delay, everyDays: s.everyDays };
    }
  }
  if (s.newsletter.enabled) {
    const w = await codeInfo(db, s.newsletter.welcomeCode);
    return { type: "newsletter", id: "nl", offer: w ? { kind: w.kind, value: w.value } : null, delay: s.newsletter.delay, everyDays: s.everyDays };
  }
  return { type: null };
}
