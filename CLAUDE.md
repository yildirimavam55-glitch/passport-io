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
- Supabase-Funktionen (`supabase/functions`): `prices` (Katalog+Preisregel, `?item=` Details, `?currency=`), `account` (Bestellung, Rabattcode, Erstattung, Support), `admin` (Panel-API inkl. GitHub-Inhalte), `questions` (Lina-Fragen, Support, Newsletter), `cms-auth` (alt, ungenutzt).
- Shared: `_shared/esim-provider.ts` (eSIM Access = Datenvolumen, eSIM Go = Unlimited Stufe essential), `pricing.ts`, `assortment.ts`.
- Panel: `admin/panel.html|js|css` + `admin/panel-editor.js` (Shopify-artiger Editor, Felder aus `admin/config.yml`, Speichern über Admin-Funktion → GitHub).

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
- Push auf main → `gh run watch` → Jobs: Seite bauen, GitHub Pages, Supabase (Migrationen + Funktionen).
- Lokal: `.claude/launch.json` „passport“ (node server.js, Port 5173). Lokale Seite nutzt Live-Supabase.
- Syntaxcheck TS: Datei nach `$TEMP/x.mts` kopieren, `node --check`.
- Caches: `prices` nutzt price_cache-IDs `current7`, `cat:esimaccess4`, `cat:esimgo9-<tier>` – bei Formatänderungen Nummer erhöhen.
- **Fallen:** In Node-`String.replace` wird `$$` zu `$` → Ersatz als Funktion übergeben. Backslashes in Regex gehen in Bash-Heredocs/Template-Strings verloren → `[.]`, `[/]` statt `\.`/`\/` verwenden oder Edit-Tool nutzen.

## Offen
- Zahlungsanbieter (iyzico/PayTR vs. Stripe) – Entscheidung des Nutzers fehlt; Rabattnutzung zählt derzeit bei Bestellanlage.
- Lounge/Fast Track-Anbieter; Newsletter-Versand (Export nach Brevo/Mailchimp); Lina & SSS nur ~55 % übersetzt.
- Rechtliches: BTK-Klärung, ETBİS, e-Fatura, KVKK, Rechtstexte (siehe YAYINA-HAZIRLIK.md, ANLEITUNG.md).
- Echte Testbestellung auf Handy noch nicht gemacht.
