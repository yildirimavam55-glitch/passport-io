/* ==========================================================================
   passport.io – Partner-Portal (Lounge & Fast Track)
   Der Partner öffnet den Link aus der Nachricht (partner.html#t=<token>), sieht die Buchung,
   lädt den QR-Code/Voucher hoch und tippt auf „Tamamlandı“. Server: Funktion „partner“.
   ========================================================================== */
(async () => {
  "use strict";
  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const token = new URLSearchParams(location.hash.slice(1)).get("t") || "";
  const TX = {
    tr: { notFound: "Bu bağlantı geçersiz veya süresi dolmuş. Lütfen passport.io ekibine yaz.", noSetup: "Portal henüz bağlı değil.", booking: "Rezervasyon", lounge: "Lounge", fasttrack: "Fast Track", airport: "Havalimanı", terminal: "Terminal", date: "Uçuş tarihi", time: "Kalkış", flight: "Uçuş", persons: "Kişi", names: "İsimler", phone: "Telefon", note: "Müşteri notu", due: "Teslim", test: "TEST – bu bir deneme rezervasyonu, lütfen satın alma.", st: { new: "Yeni", sent: "Yeni", accepted: "Kabul edildi", delivered: "Teslim edildi", declined: "Reddedildi", failed: "Süresi geçti", cancelled: "İptal" }, accept: "Kabul ediyorum, ilgileniyorum", upload: "Voucher / QR kodunu yükle", uploadHint: "Fotoğraf, ekran görüntüsü veya PDF · en fazla 8 MB", uploading: "Yükleniyor …", done: "Tamamlandı – müşteriye gönder", doneNote: "Not (isteğe bağlı, müşteriye gitmez)", decline: "Bu rezervasyonu yapamıyorum", reason: "Neden? (ör. lounge dolu, tarih uygun değil)", sendDecline: "Reddet ve ekibe bildir", thanks: "Teşekkürler! Voucher müşteriye iletildi.", declined: "Ekibe bildirildi. Teşekkürler.", closed: "Bu rezervasyon kapandı.", needFile: "Önce en az bir dosya yükle.", errType: "Yalnızca PNG, JPG, WEBP veya PDF.", errBig: "Dosya çok büyük (en fazla 8 MB).", errMany: "En fazla 10 dosya.", err: "Bir hata oldu. Tekrar dene.", remove: "Kaldır", files: "Yüklenen dosyalar" },
    de: { notFound: "Dieser Link ist ungültig oder abgelaufen. Bitte schreib dem passport.io-Team.", noSetup: "Portal noch nicht verbunden.", booking: "Buchung", lounge: "Lounge", fasttrack: "Fast Track", airport: "Flughafen", terminal: "Terminal", date: "Flugdatum", time: "Abflug", flight: "Flug", persons: "Personen", names: "Namen", phone: "Telefon", note: "Hinweis des Kunden", due: "Lieferung bis", test: "TEST – das ist eine Probebuchung, bitte nichts kaufen.", st: { new: "Neu", sent: "Neu", accepted: "Angenommen", delivered: "Zugestellt", declined: "Abgelehnt", failed: "Abgelaufen", cancelled: "Storniert" }, accept: "Annehmen, ich kümmere mich", upload: "Voucher / QR-Code hochladen", uploadHint: "Foto, Screenshot oder PDF · max. 8 MB", uploading: "Wird hochgeladen …", done: "Erledigt – an den Kunden senden", doneNote: "Notiz (optional, geht nicht an den Kunden)", decline: "Diese Buchung kann ich nicht übernehmen", reason: "Warum? (z. B. Lounge voll, Datum passt nicht)", sendDecline: "Ablehnen und Team informieren", thanks: "Danke! Der Voucher ist beim Kunden.", declined: "Das Team ist informiert. Danke.", closed: "Diese Buchung ist abgeschlossen.", needFile: "Bitte zuerst mindestens eine Datei hochladen.", errType: "Nur PNG, JPG, WEBP oder PDF.", errBig: "Datei zu groß (max. 8 MB).", errMany: "Höchstens 10 Dateien.", err: "Etwas ist schiefgelaufen. Bitte nochmal versuchen.", remove: "Entfernen", files: "Hochgeladene Dateien" },
    en: { notFound: "This link is invalid or has expired. Please contact the passport.io team.", noSetup: "Portal not connected yet.", booking: "Booking", lounge: "Lounge", fasttrack: "Fast Track", airport: "Airport", terminal: "Terminal", date: "Flight date", time: "Departure", flight: "Flight", persons: "Persons", names: "Names", phone: "Phone", note: "Customer note", due: "Deliver by", test: "TEST – this is a trial booking, please do not buy anything.", st: { new: "New", sent: "New", accepted: "Accepted", delivered: "Delivered", declined: "Declined", failed: "Expired", cancelled: "Cancelled" }, accept: "Accept, I'll handle it", upload: "Upload voucher / QR code", uploadHint: "Photo, screenshot or PDF · max. 8 MB", uploading: "Uploading …", done: "Done – send to customer", doneNote: "Note (optional, not sent to the customer)", decline: "I can't take this booking", reason: "Why? (e.g. lounge full, date not possible)", sendDecline: "Decline and notify the team", thanks: "Thank you! The voucher has been sent to the customer.", declined: "The team has been notified. Thank you.", closed: "This booking is closed.", needFile: "Please upload at least one file first.", errType: "Only PNG, JPG, WEBP or PDF.", errBig: "File too large (max. 8 MB).", errMany: "Max. 10 files.", err: "Something went wrong. Please try again.", remove: "Remove", files: "Uploaded files" },
  };
  let L = TX[(navigator.language || "tr").slice(0, 2)] || TX.tr;

  let cfg = null;
  try { cfg = await fetch("content/auth.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)); } catch (_) {}
  if (!cfg?.url) { app.innerHTML = `<div class="pp-card"><p class="pp-muted">${esc(L.noSetup)}</p></div>`; return; }
  const fn = `${cfg.url}/functions/v1/partner`;
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) { app.innerHTML = `<div class="pp-card"><p>${esc(L.notFound)}</p></div>`; return; }

  let B = null, busy = false, msg = "", mode = "";
  const call = async (body) => {
    const r = await fetch(fn, { method: "POST", headers: body instanceof FormData ? {} : { "Content-Type": "application/json" }, body: body instanceof FormData ? body : JSON.stringify({ t: token, ...body }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "server");
    return d;
  };
  const errText = (e) => ({ type: L.errType, too_big: L.errBig, too_many: L.errMany, no_file: L.needFile, closed: L.closed, not_found: L.notFound })[e.message] || L.err;
  const fmtDue = (d) => { try { return new Intl.DateTimeFormat(navigator.language || "tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d)); } catch (_) { return d; } };
  const fmtDate = (d) => { try { return new Intl.DateTimeFormat(navigator.language || "tr-TR", { weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00")); } catch (_) { return d; } };
  const cls = (s) => (s === "delivered" || s === "accepted" ? "ok" : s === "sent" || s === "new" ? "warn" : "bad");

  function render() {
    const b = B, open = !["delivered", "cancelled", "failed", "declined"].includes(b.status);
    const rows = [[L.airport, `${b.airport}${b.airport_name ? " · " + b.airport_name : ""}`], b.terminal && [L.terminal, b.terminal], [L.date, fmtDate(b.travel_date)], b.travel_time && [L.time, b.travel_time], b.flight && [L.flight, b.flight], [L.persons, b.persons]].filter(Boolean);
    app.innerHTML = `
      ${b.test ? `<div class="pp-test">${esc(L.test)}</div>` : ""}
      <section class="pp-card">
        <p class="pp-muted">${esc(L.booking)} #${esc(b.id)}</p>
        <h1 class="pp-h">${esc(L[b.product] || b.product)} · ${esc(b.title || "")}</h1>
        <span class="pp-pill ${cls(b.status)}">${esc(L.st[b.status] || b.status)}</span>${open && b.due_at ? ` <span class="pp-pill">${esc(L.due)}: ${esc(fmtDue(b.due_at))}</span>` : ""}
        <dl class="pp-rows">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}
          <dt>${esc(L.names)}</dt><dd><ol class="pp-names">${(b.names || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ol></dd>
          ${b.phone ? `<dt>${esc(L.phone)}</dt><dd>${esc(b.phone)}</dd>` : ""}
          ${b.note ? `<dt>${esc(L.note)}</dt><dd>${esc(b.note)}</dd>` : ""}
        </dl>
        ${b.details ? `<p class="pp-muted" style="margin-top:12px">${esc(b.details)}</p>` : ""}
      </section>
      ${b.status === "delivered" ? `<section class="pp-card pp-done"><div class="pp-big">✓</div><h2 class="pp-h">${esc(L.thanks)}</h2></section>`
        : b.status === "declined" ? `<section class="pp-card pp-done"><h2 class="pp-h">${esc(L.declined)}</h2></section>`
        : !open ? `<section class="pp-card"><p>${esc(L.closed)}</p></section>` : `
      ${b.status === "sent" || b.status === "new" ? `<button class="pp-btn" data-accept ${busy ? "disabled" : ""}>${esc(L.accept)}</button>` : ""}
      <section class="pp-card">
        <label class="pp-drop" data-drop>
          <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple data-file />
          <b>＋ ${esc(busy && mode === "up" ? L.uploading : L.upload)}</b>
          <span class="pp-muted">${esc(L.uploadHint)}</span>
        </label>
        ${(b.files || []).length ? `<p class="pp-muted" style="margin-top:12px">${esc(L.files)}</p><div class="pp-files">${b.files.map((f) => `
          <div class="pp-file">${f.type === "application/pdf" ? `<a class="pp-pdf" href="${esc(f.url)}" target="_blank" rel="noopener">PDF</a>` : `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt=""></a>`}<span>${esc(f.name)}</span>
          <button type="button" aria-label="${esc(L.remove)}" data-remove="${esc(f.path)}">×</button></div>`).join("")}</div>` : ""}
        <div class="pp-actions">
          <textarea data-note placeholder="${esc(L.doneNote)}" maxlength="1000"></textarea>
          <button class="pp-btn pp-btn--green" data-done ${busy || !(b.files || []).length ? "disabled" : ""}>${esc(L.done)}</button>
        </div>
        ${msg ? `<p class="pp-err">${esc(msg)}</p>` : ""}
      </section>
      <details class="pp-card"><summary>${esc(L.decline)}</summary>
        <div class="pp-actions"><textarea data-reason placeholder="${esc(L.reason)}" maxlength="500"></textarea><button class="pp-btn pp-btn--ghost" data-decline>${esc(L.sendDecline)}</button></div>
      </details>`}`;
  }

  async function run(fnc, m = "") {
    if (busy) return; busy = true; mode = m; msg = ""; render();
    try { const d = await fnc(); if (d?.booking) B = d.booking; }
    catch (e) { msg = errText(e); }
    busy = false; mode = ""; render();
  }
  async function upload(files) {
    await run(async () => {
      let last = null;
      for (const f of [...files].slice(0, 10)) {
        if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(f.type)) throw new Error("type");
        if (f.size > 8 * 1024 * 1024) throw new Error("too_big");
        const fd = new FormData(); fd.append("t", token); fd.append("file", f, f.name);
        last = await call(fd);
      }
      return last;
    }, "up");
  }

  app.addEventListener("click", (e) => {
    if (e.target.closest("[data-accept]")) return run(() => call({ action: "accept" }));
    const rm = e.target.closest("[data-remove]");
    if (rm) { e.preventDefault(); return run(() => call({ action: "remove", path: rm.dataset.remove })); }
    if (e.target.closest("[data-done]")) { const note = app.querySelector("[data-note]")?.value || ""; return run(() => call({ action: "done", note })); }
    if (e.target.closest("[data-decline]")) { const reason = app.querySelector("[data-reason]")?.value || ""; return run(() => call({ action: "decline", reason })); }
  });
  app.addEventListener("change", (e) => { if (e.target.matches("[data-file]") && e.target.files.length) upload(e.target.files); });
  app.addEventListener("dragover", (e) => { const d = e.target.closest("[data-drop]"); if (d) { e.preventDefault(); d.classList.add("is-over"); } });
  app.addEventListener("dragleave", (e) => e.target.closest("[data-drop]")?.classList.remove("is-over"));
  app.addEventListener("drop", (e) => { const d = e.target.closest("[data-drop]"); if (d) { e.preventDefault(); d.classList.remove("is-over"); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); } });

  try {
    const r = await fetch(`${fn}?t=${encodeURIComponent(token)}`);
    if (!r.ok) throw new Error();
    B = (await r.json()).booking;
    L = TX[B.language] || L;
    document.documentElement.lang = B.language || "tr";
    render();
  } catch (_) { app.innerHTML = `<div class="pp-card"><p>${esc(L.notFound)}</p></div>`; }
})();
