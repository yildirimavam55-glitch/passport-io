# passport.io – Projektkontext (kurz)

Reise-Shop: eSIM (live), Lounge/Fast Track (noch ohne Anbieter), Vignette (später). Hauptsprache Türkisch; Seite in 7 Sprachen (tr,en,de,ar,ru,fr,es), Sprache = Gerät. Design: dunkel + Neongrün. Nutzer schreibt TR/DE.

## Links
- Live: https://yildirimavam55-glitch.github.io/passport-io/ · Panel: …/admin/panel.html · Konto: …/account.html
- Repo: yildirimavam55-glitch/passport-io (main → GitHub Actions deployt Seite + Supabase)
- Supabase-Projekt: sbzwibctxezprpefwxzn

## Grundregeln (verbindlich)
- **Alle Preise nur aus Anbieter-APIs + Preisregel.** Keine festen Preise/Kurse im Code.
- Secrets trägt der Nutzer selbst in Supabase ein; nie Schlüssel im Code/Repo/Chat. Keine Konten anlegen.
- Commits enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Aufbau
- Statische Seite: `index/install/blog/account/page.html`, `js/app.js` (rendert alles), `js/account.js`, `css/styles.css`.
- Inhalte: `content/*.json` je `{tr,en,…}`; Fremdsprachen werden über `id`/`code` bzw. Index gemischt. Blog: `content/posts/*.json` → `tools/build-blog.js` erzeugt `blog.json` beim Deploy (draft=true wird ausgelassen).
- Supabase-Funktionen (`supabase/functions`): `prices` (Katalog+Preisregel, `?item=` Details, `?currency=`), `account` (Bestellung, Rabattcode, Erstattung, Support), `admin` (Panel-API inkl. GitHub-Inhalte), `questions` (Lina-Fragen, Support, Newsletter), `lina` (KI, optional).
- Shared: `_shared/esim-provider.ts` (eSIM Access = Datenvolumen, eSIM Go = Unlimited Stufe essential), `pricing.ts`, `assortment.ts`.
- Panel: `admin/panel.html|js|css` + `admin/panel-editor.js` (Shopify-artiger Editor, Felder aus `admin/config.yml`, Speichern über Admin-Funktion → GitHub).

- **Keine Fremd-CDNs:** Schriften (`fonts/`, `css/fonts*.css`), Bibliotheken (`vendor/js`, Liste in `vendor/LICENSES.md`), Weltkarte (`vendor/data`) und Flaggen (`img/flags/1x1|4x3`, flag-icons) liegen im Repo. CSP-Meta in jeder HTML-Seite erlaubt nur `'self'`, Supabase und (Platzhalter-)Bilder von Unsplash. Neue externe Quellen nur mit CSP- und Datenschutz-Anpassung.

## Lina (Assistent)
- 77 FAQs in `content/assistant.json`, alle 7 Sprachen; Kategorie `probleme` = Sorun giderme. Schritt-für-Schritt je Handy (iPhone/Samsung/Pixel/Xiaomi): data-roaming, data-line, network-select, line-on, install-iphone, install-android, reset-network, hotspot-setup.
- Feld `next` (nur tr): IDs, die als Knöpfe „nächster Schritt“ unter der Antwort erscheinen (z. B. no-internet → Roaming → Datenleitung → Netzwahl → APN → Zurücksetzen).
- **Sprache der Frage:** Lina sucht in allen Sprachen (Schrift + Wortschatz der Sprache) und antwortet in der Sprache, in der gefragt wurde – unabhängig von der Seitensprache.
- **Umgangssprache:** `content/lina-synonyms.json` (je Sprache: Kundenwörter → einheitlicher Begriff, gilt für Frage und FAQ-Texte). Neue Kundenformulierungen dort ergänzen.
- **Suche** (`initAssistant` in app.js): Stichwörter mit Wortstamm-Vergleich, seltene Wörter wiegen mehr (IDF), Frage voll, Antwort halb. Sicher = Score ≥ 3 oder ≥ 2 mit 1,5 Abstand → Antwort; sonst „Meintest du…?“ + Team-Button.
- **KI (optional):** `supabase/functions/lina` + `SITE.api.linaUrl`. Aktiv erst mit Supabase-Secret `ANTHROPIC_API_KEY`; ohne → 503 → nur Stichwortsuche. KI wird nur gefragt, wenn die Suche unsicher ist (Score < 5), antwortet nur aus den FAQs.
- **Mehr Kundenformulierungen:** Workflow „Lina übersetzen“ von Hand starten mit expand=25 → KI schreibt je FAQ und Sprache bis zu 25 echte Formulierungen als Stichwörter; wird nur übernommen, wenn der Test danach besser ist.
- **Neue FAQ:** nur auf Türkisch im Editor anlegen → Workflow „Lina übersetzen“ (`tools/lina-translate.mjs`) übersetzt in alle Sprachen + ergänzt Stichwörter, braucht GitHub-Secret `ANTHROPIC_API_KEY`. Fingerabdrücke: `tools/lina-sync.json`.
- **Test:** `node tools/lina-test/eval.mjs [-v] [--set=colloq_c] [--ai]` · GitHub-Workflow „Lina testen“ (mit KI, wenn Secret gesetzt). Stand ohne KI: Katalog 97 %, neue Kundensprache (colloq_c) 68 % direkt / 79 % inkl. Vorschlag. Suche dort ist eine Kopie aus app.js – bei Änderungen beide anpassen. KI-Aufgabe: `supabase/functions/_shared/lina-prompt.js`.
- Stichwörter: Kundensprache (2–4 Wörter), keine allgemeinen Einzelwörter („çalışmıyor“, „lounge“, „qr“).

- Handy-Check (Modal): `devices` (eSIM-fähig, 217 Modelle bis iPhone 18 Pro/Galaxy S26/Pixel 11, Stand 11/2026) + `devicesNo` (bekannte Modelle ohne eSIM) in `content/assistant.json` (nur tr). Suche über Wortanfänge. Neue Modelle im Editor ergänzen.

- **Warenkorb** (app.js, `openCart`): Paketfenster → „In den Warenkorb“; Inhalt in localStorage `pp_cart` (max. 10), Preise immer live aus `prices`. Rabattcode nur im Warenkorb: `account` POST `{action:"coupon_check"}` (ohne Anmeldung, zählt nicht, 20/IP/10 min) → gilt für den teuersten Artikel. Kasse = `account.html?cart=1` → je Artikel eine Bestellung, Code wird erst dort verbraucht.

## Preis- und Sortimentslogik
- Wettbewerbspreise in Tabelle `competitor_prices` (Airalo, Saily, Nomad; gb=0 = Unlimited). Laden seitenweise (Supabase max 1000 Zeilen).
- Regel: Wettbewerber vorhanden → nächster ,99-Preis darunter; sonst Einkauf × 2 auf ,99; min 2,99 €; Verlustschutz Einkauf + min_margin_pct (Panel → Fiyatlar).
- Sortiment je Land: 1/7, 2/15, 3/15, 3/30, 5/30, 10/30, 20/30, 50/30, 50/180 (GB/Tage) + Unlimited 3/5/7/10/15/30 Tage. Staffel: kleineres Paket nie teurer als größeres.
- Einkauf nie öffentlich (debug-Felder werden in `prices` entfernt).

## Secrets (Supabase, gesetzt)
ADMIN_MAIL (Alias ADMIN_EMAILS), ALLOWED_ORIGINS, ESIMACCESS_ACCESS_CODE, ESIMACCESS_SECRETS (ungenutzt), ESIMGO_API_KEY, GITHUB_CONTENT_TOKEN.
Optional: ESIMGO_UNLIMITED_TIER (lite|essential|plus, Std essential), ESIMGO_CURRENCY (Std USD), REFUND_DAYS, ALLOW_TEST_ORDERS, PAYMENT_PROVIDER.
Prüfen: GitHub-Workflow `check-secrets.yml` (nur Namen) – `gh workflow run check-secrets.yml`.

## Arbeiten / Deploy (Windows)
- PATH für gh/git: `/c/Users/Yildi/AppData/Local/Microsoft/WinGet/Packages/GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe/bin`
- **Vor jeder Arbeit `git pull --rebase`**: Der Mağaza editörü im Panel committet Inhalte direkt auf main.
- Push auf main → `gh run watch` → Jobs: Seite bauen, GitHub Pages, Supabase (Migrationen + Funktionen).
- Lokal: `.claude/launch.json` „passport“ (node server.js, Port 5173). Lokale Seite nutzt Live-Supabase.
- Syntaxcheck TS: Datei nach `$TEMP/x.mts` kopieren, `node --check`.
- Caches: `prices` nutzt price_cache-IDs `current7`, `cat:esimaccess4`, `cat:esimgo9-<tier>` – bei Formatänderungen Nummer erhöhen.
- **Fallen:** In Node-`String.replace` wird `$$` zu `$` → Ersatz als Funktion übergeben. Backslashes in Regex gehen in Bash-Heredocs/Template-Strings verloren → `[.]`, `[/]` statt `\.`/`\/` verwenden oder Edit-Tool nutzen.

## Offen
- Zahlungsanbieter (iyzico/PayTR vs. Stripe) – Entscheidung des Nutzers fehlt; Rabattnutzung zählt derzeit bei Bestellanlage.
- Lounge/Fast Track-Anbieter; Newsletter-Versand (Export nach Brevo/Mailchimp).
- Lina-FAQ „payment“ nennt Apple Pay/Klarna usw. – an den echten Zahlungsanbieter anpassen; FAQ „invoice“ verweist vorerst aufs Support-Formular (e-Fatura offen).
- Rechtliches: BTK-Klärung, ETBİS, e-Fatura, KVKK, Rechtstexte (siehe YAYINA-HAZIRLIK.md, ANLEITUNG.md).
- Echte Testbestellung auf Handy noch nicht gemacht.
