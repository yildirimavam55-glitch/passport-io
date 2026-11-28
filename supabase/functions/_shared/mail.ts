/* E-Mail-Versand (optional) über Resend – https://resend.com
   Secrets: RESEND_API_KEY, MAIL_FROM (z. B. "passport.io <bestellung@passport.io>", Domain muss bei Resend bestätigt sein).
   Ohne Secrets wird nichts verschickt (Rückgabe false) – das Panel zeigt dann den WhatsApp-/Link-Weg. */
import { env } from "./http.ts";

export const mailOn = () => !!env("RESEND_API_KEY") && !!env("MAIL_FROM");

export type Mail = { to: string | string[]; subject: string; html: string; text?: string; replyTo?: string };

export async function sendMail(m: Mail): Promise<boolean> {
  if (!mailOn()) return false;
  const to = (Array.isArray(m.to) ? m.to : [m.to]).map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  if (!to.length) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env("MAIL_FROM"), to, subject: m.subject, html: m.html, text: m.text, reply_to: m.replyTo || undefined }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error("mail", r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (err) {
    console.error("mail", err);
    return false;
  }
}

const escH = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Schlichte, gut lesbare HTML-Mail: Titel, Zeilen (Label/Wert), optional ein Knopf */
export function mailHtml(title: string, intro: string, rows: [string, string][] = [], button?: { label: string; url: string }, foot = "") {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#fff;border-radius:14px;padding:24px;border:1px solid #e3e8e5">
<p style="margin:0 0 4px;font-weight:700;color:#0a7a45">passport.io</p>
<h1 style="font-size:20px;margin:0 0 12px">${escH(title)}</h1>
<p style="margin:0 0 16px;line-height:1.5">${escH(intro)}</p>
${rows.length ? `<table style="width:100%;border-collapse:collapse;margin:0 0 18px">${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#667;width:38%;vertical-align:top">${escH(k)}</td><td style="padding:6px 0;font-weight:600">${escH(v)}</td></tr>`).join("")}</table>` : ""}
${button ? `<p style="margin:0 0 8px"><a href="${escH(button.url)}" style="display:inline-block;background:#12d47a;color:#04150c;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">${escH(button.label)}</a></p>` : ""}
${foot ? `<p style="margin:16px 0 0;color:#667;font-size:13px;line-height:1.5">${escH(foot)}</p>` : ""}
</div></div></body></html>`;
}
