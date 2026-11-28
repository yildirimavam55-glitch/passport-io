# passport.io – Projektkontext (kurz)

Reise-Shop: eSIM (live), Lounge/Fast Track (noch ohne Anbieter), Vignette (später). Hauptsprache Türkisch; Seite in 13 Sprachen (tr,en,de,ar,ru,fr,es,it,pt[-BR],nl,pl,ja,ko), Sprache = Gerät. Fehlende Texte: erst Englisch, dann Türkisch. Design: dunkel + Neongrün; Standard = Dunkel-Modus (Wahl in localStorage `pp_theme`, Schalter „Darstellung“ im Menü, Desktop: Knopf in der Leiste). Inline-Theme-Skript ist per CSP-Hash erlaubt → bei Änderung Hash in allen 5 HTML-Seiten neu setzen. Nutzer schreibt TR/DE.

## Links
- Live: https://yildirimavam55-glitch.github.io/passport-io/ · Panel: …/admin/panel.html · Konto: …/account.html
- Repo: yildirimavam55-glitch/passport-io (main → GitHub Actions deployt Seite + Supabase)
- Supabase-Projekt: sbzwibctxezprpefwxzn

## Grundregeln (verbindlich)
- **Alle Preise nur aus Anbieter-APIs + Preisregel.** Keine festen Preise/Kurse im Code.
- Secrets trägt der Nutzer selbst in Supabase ein; nie Schlüssel im Code/Repo/Chat. Keine Konten anlegen.
- Commits enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Aufbau
- Statische Seite: `index/install/blog/account/page.html` + `partner.html` (Partner-Portal, eigene CSP ohne Inline-Skript), `js/app.js` (rendert alles), `js/account.js`, `css/styles.css`.
- **Automatische Übersetzung (alle Inhalte):** Workflow „Webseite übersetzen“ (`tools/site-translate.mjs`, Fingerabdrücke `tools/site-sync.json`) übersetzt neue/geänderte tr-Texte aller `content/*.json` + Blogartikel in alle Sprachen; neue Sprache in `languages.json` → alles. Lina-FAQs: „Lina übersetzen“. Beide brauchen GitHub-Secret `ANTHROPIC_API_KEY`. Von Hand: `--export=it` / `--import=it datei.json`. Neue Sprache außerdem in `admin/panel*.js`, `admin/config.yml`, `account/index.ts`, `_shared/popup.ts`, `_shared/lina-prompt.js` eintragen.
- Inhalte: `content/*.json` je `{tr,en,…}`; Fremdsprachen werden über `id`/`code` bzw. Index gemischt. Blog: `content/posts/*.json` → `tools/build-blog.js` erzeugt `blog.json` beim Deploy (draft=true wird ausgelassen).
- Supabase-Funktionen (`supabase/functions`): `prices` (Katalog+Preisregel, `?item=` Details, `?currency=`), `account` (Bestellung, Rabattcode, Erstattung, Support), `admin` (Panel-API inkl. GitHub-Inhalte), `questions` (Lina-Fragen, Support, Newsletter), `lina` (KI, optional).
- Shared: `_shared/esim-provider.ts` (eSIM Access = Datenvolumen, eSIM Go = Unlimited Stufe essential), `pricing.ts`, `assortment.ts`.
- Panel: `admin/panel.html|js|css` + `admin/panel-editor.js` (Shopify-artiger Editor, Felder aus `admin/config.yml`, Speichern über Admin-Funktion → GitHub).

- **Keine Fremd-CDNs:** Schriften (`fonts/`, `css/fonts*.css`), Bibliotheken (`vendor/js`, Liste in `vendor/LICENSES.md`), Weltkarte (`vendor/data`) und Flaggen (`img/flags/1x1|4x3`, flag-icons) liegen im Repo. CSP-Meta in jeder HTML-Seite erlaubt nur `'self'`, Supabase und (Platzhalter-)Bilder von Unsplash. Neue externe Quellen nur mit CSP- und Datenschutz-Anpassung.

## Lina (Assistent)
- 82 FAQs in `content/assistant.json`, alle 13 Sprachen; Kategorie `probleme` = Sorun giderme. Schritt-für-Schritt je Handy (iPhone/Samsung/Pixel/Xiaomi): data-roaming, data-line, network-select, line-on, install-iphone, install-android, reset-network, hotspot-setup.
- Feld `next` (nur tr): IDs, die als Knöpfe „nächster Schritt“ unter der Antwort erscheinen (z. B. no-internet → Roaming → Datenleitung → Netzwahl → APN → Zurücksetzen).
- **Japanisch/Koreanisch:** Suche zerlegt CJK-Text in Zeichenpaare (`cjkPairs` in app.js/lina.mjs, `bigTok` im Ranker); Schrift-Erkennung ja/ko. Schriften: Systemschriften (`fontFallback` in languages.json), CSS `:lang(ja|ko)` für Zeilenumbruch.
- **Sprache der Frage:** Lina sucht in allen Sprachen (Schrift + Wortschatz der Sprache) und antwortet in der Sprache, in der gefragt wurde – unabhängig von der Seitensprache.
- **Umgangssprache:** `content/lina-synonyms.json` (je Sprache: Kundenwörter → einheitlicher Begriff, gilt für Frage und FAQ-Texte). Neue Kundenformulierungen dort ergänzen.
- **Suche** (`initAssistant` in app.js): Stichwörter mit Wortstamm-Vergleich, seltene Wörter wiegen mehr (IDF), Frage voll, Antwort halb. Sicher = Score ≥ 3 oder ≥ 2 mit 1,5 Abstand → Antwort; sonst „Meintest du…?“ + Team-Button.
- **KI (optional):** `supabase/functions/lina` + `SITE.api.linaUrl`. Aktiv erst mit Supabase-Secret `ANTHROPIC_API_KEY`; ohne → 503 → nur Stichwortsuche. KI wird nur gefragt, wenn die Suche unsicher ist (Score < 5), antwortet nur aus den FAQs.
- **Mehr Kundenformulierungen:** Workflow „Lina übersetzen“ von Hand starten mit expand=25 → KI schreibt je FAQ und Sprache bis zu 25 echte Formulierungen als Stichwörter; wird nur übernommen, wenn der Test danach besser ist.
- **Neue FAQ:** nur auf Türkisch im Editor anlegen → Workflow „Lina übersetzen“ (`tools/lina-translate.mjs`) übersetzt in alle Sprachen + ergänzt Stichwörter, braucht GitHub-Secret `ANTHROPIC_API_KEY`. Fingerabdrücke: `tools/lina-sync.json`.
- **Test:** `node tools/lina-test/eval.mjs [-v] [--set=colloq_c] [--ai]` · GitHub-Workflow „Lina testen“ (mit KI, wenn Secret gesetzt). Stand ohne KI: Katalog 97 %, einfache Fragen (`simple`, 9284 = 5000 in 7 Sprachen + je 714 it/pt/nl/pl/ja/ko) 91 % / 95 % inkl. Vorschlag, spezifische Fragen (`specific`, 9284: Gerät, Land, Fehlermeldung, Lounge) 95 % / 96 %, neue Kundensprache (colloq_c, nicht optimiert) 69 % / 79 %, neue Sprachen (`newlang`, je 20 Fragen it/pt/nl/pl/ja/ko, nicht optimiert) 82 % / 88 %. ja/ko-Stichwörter als Wortstamm ohne Endung/Partikel schreiben („何時間いら“, „라운지 들어가“), da jedes Zeichenpaar vorkommen muss. simple/specific werden aus Vorlagen in `tools/lina-test/simple-src/` erzeugt und mit `--ai` nur per `--set=` geprüft. Suche dort ist eine Kopie aus app.js – bei Änderungen beide anpassen. KI-Aufgabe: `supabase/functions/_shared/lina-prompt.js`.
- Konto-FAQs (11/2026): my-esims (gekaufte eSIMs/Bestellungen → Mein Konto), how-to-buy, need-account, change-password, change-email (nur über Support).
- Stichwörter: Kundensprache (2–4 Wörter), keine allgemeinen Einzelwörter („çalışmıyor“, „lounge“, „qr“).

- Handy-Check (Modal): `devices` (eSIM-fähig, 217 Modelle bis iPhone 18 Pro/Galaxy S26/Pixel 11, Stand 11/2026) + `devicesNo` (bekannte Modelle ohne eSIM) in `content/assistant.json` (nur tr). Suche über Wortanfänge. Neue Modelle im Editor ergänzen.

- **Netz-Laufband** (Startseite, Bereich `networks`, Panel → Ana sayfa düzeni): `prices` `?networks=1` → bekannte Netzbetreiber, die die Anbieter-API im jeweiligen Land wirklich liefert (Markenliste/Reihenfolge in `_shared/networks.ts`, max. 20). Nur Markennamen als Schriftzug (ohne Flaggen, ohne Logos – Markenrecht), Hinweis „nicht mit passport.io verbunden“. Unter 4 Treffern bleibt der Bereich verborgen.

- **So funktioniert's + Vertrauen** (Bereich `howto`): 3 Wischkarten, darunter Vertrauensblock (`trustBlock`, gewählt: Variante „c“ = Geld-zurück-Banner, `site.json howto.trustVariant`, Vorschau `?trust=a|b|c`), Knopf „Finde dein Paket“ springt zur Suche im Startbild und öffnet sie. Geld-zurück-Text nur aus `ui.moneyBack`.

- **Warenkorb** (app.js, `openCart`): Paketfenster → „In den Warenkorb“; Inhalt in localStorage `pp_cart` (max. 10), Preise immer live aus `prices`. Rabattcode nur im Warenkorb: `account` POST `{action:"coupon_check"}` (ohne Anmeldung, zählt nicht, 20/IP/10 min) → gilt für den teuersten Artikel. Kasse = `account.html?cart=1` → je Artikel eine Bestellung, Code wird erst dort verbraucht.

- **Pop-up** (app.js `popupInit`, Panel → „Pop-up & kampanya“): Einstellungen in Tabelle `site_settings` (key `popup`, `_shared/popup.ts`). Aktive Aktion mit gültigem Rabattcode → Aktionsfenster, sonst Newsletter-Fenster (optional Willkommenscode, wird erst nach der Anmeldung von `questions` zurückgegeben). Öffentlich: `questions` GET `?popup=1`. Code landet als `pending` im Warenkorb. Weggeklickt = `everyDays` Ruhe (localStorage `pp_popup`), nach Anmeldung nie wieder (`pp_nl_done`). Vorschau: `index.html?popup=preview`.

- **Lounge & Fast Track über Partner** (keine Anbieter-API, 11/2026): Panel → „Lounge & Fast Track“ (Rezervasyonlar, Fiyat listesi, Partnerler, Ayarlar). Tabellen `airport_partners`, `airport_offers` (Einkauf pro Person), `airport_bookings`; Bucket `vouchers` (privat, signierte Links). Logik `_shared/airport.ts` (Preisregel: Einkauf × (1+markup_pct), ≥ Einkauf + min_margin_pct, ,99; Einstellungen `site_settings` key `airport`, Standard `enabled=false`). Ablauf: Kunde sucht im Bereich `airport` (`prices?airport=1`) → Formular → `account` POST `order` mit `item:"airport:<id>"` + `booking` → bezahlt (`dispatchForOrder`, auch bei Panel-Status „paid“) → Partner bekommt geheimen Link `partner.html#t=<token>` per Mail (Resend: `RESEND_API_KEY`, `MAIL_FROM`) und/oder WhatsApp Business API (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE` mit {{1}} Kurzinfo, {{2}} Link); ohne Kanal: wa.me-Link im Panel. Partner lädt Voucher hoch → „Tamamlandı“ → Kunde sieht ihn unter Bestellungen. Funktion `partner` (+ `?tick=1` = Wächter, Workflow „Lounge-Wächter“ alle 15 Min.: Erinnerung, Warnung an ADMIN_MAIL, „kaçırıldı“ kurz vor Abflug). Bewusste Ausnahme von „nur API-Preise“: Partner-Preisliste im Panel = Anbieterpreis. Neue Texte (`ap*`, `bk*`) nur tr/en/de – Rest über Workflow „Webseite übersetzen“.

## Preis- und Sortimentslogik
- Wettbewerbspreise in Tabelle `competitor_prices` (Airalo, Saily, Nomad; gb=0 = Unlimited). Laden seitenweise (Supabase max 1000 Zeilen).
- Regel: Wettbewerber vorhanden → nächster ,99-Preis darunter; sonst Einkauf × 2 auf ,99; min 2,99 €; Verlustschutz Einkauf + min_margin_pct (Panel → Fiyatlar).
- Sortiment je Land: 1/7, 2/15, 3/15, 3/30, 5/30, 10/30, 20/30, 50/30, 50/180 (GB/Tage) + Unlimited 3/5/7/10/15/30 Tage. Staffel: kleineres Paket nie teurer als größeres.
- „Beliebt“ je Ziel (`POPULAR_GB` in `_shared/assortment.ts`, Recherche 11/2026): Fernreisen/lange Aufenthalte (tr, ma, th, id, jp, us …) 10 GB, sonst 5 GB, Regionen 10 GB; fehlt die Größe → nächstgrößere. „Preis-Leistung“ (Frontend `valuePlan`): Datenpaket über „Beliebt“ mit dem niedrigsten Preis/GB – Länderkarten zeigen beide, Paketfenster markiert beide.
- Einkauf nie öffentlich (debug-Felder werden in `prices` entfernt).

## Sicherheit (Prüfung 28.11.2026)
- Live geprüft mit öffentlichem Schlüssel: alle Tabellen leer/gesperrt (RLS), RPCs `use_discount`/`bump_usage` gesperrt, keine öffentlichen Buckets, Funktionen ohne Anmeldung 401, keine Einkaufspreise in `prices`.
- Admin: Zwei-Faktor ist Standard-Pflicht (nur `ADMIN_REQUIRE_MFA=false` schaltet ab). `prices` gibt `providers` (Anbieter/Fehler) nicht mehr öffentlich aus.
- Voucher-Uploads: Dateityp wird am Inhalt geprüft (PNG/JPG/WEBP/PDF). Wächter löscht Voucher, Telefon und Partner-Link 30 Tage nach der Reise; `?tick=1` max. 1×/Min. je Instanz.

## Secrets (Supabase, gesetzt)
ADMIN_MAIL (Alias ADMIN_EMAILS), ALLOWED_ORIGINS, ESIMACCESS_ACCESS_CODE, ESIMACCESS_SECRETS (ungenutzt), ESIMGO_API_KEY, GITHUB_CONTENT_TOKEN.
Optional (Lounge/Fast Track): RESEND_API_KEY, MAIL_FROM, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE, WHATSAPP_TEMPLATE_LANG.
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
- Lounge/Fast Track: Partner + Preisliste im Panel eintragen, Mail (Resend) einrichten, dann „Sitede rezervasyon“ einschalten; Vereinbarung mit dem Partner (Preise, Lieferzeit, Erstattung). Newsletter-Versand (Export nach Brevo/Mailchimp).
- Lina-FAQ „payment“ nennt Apple Pay/Klarna usw. – an den echten Zahlungsanbieter anpassen; FAQ „invoice“ verweist vorerst aufs Support-Formular (e-Fatura offen).
- Rechtliches: BTK-Klärung, ETBİS, e-Fatura, KVKK, Rechtstexte (siehe YAYINA-HAZIRLIK.md, ANLEITUNG.md).
- Echte Testbestellung auf Handy noch nicht gemacht.
