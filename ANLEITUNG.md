# passport.io – Inhalte selbst pflegen

Die Startseite ist ein Baukasten. Texte, Bilder, FAQ, Blog, Farben und die
Reihenfolge der Bereiche stehen in `content/*.json` und werden über die
Admin-Oberfläche unter **/admin** bearbeitet – ohne Code.

## Lokal starten

Zwei Terminals im Projektordner:

```
node server.js          # Webseite  -> http://localhost:5173
npx decap-server        # Admin-Dienst (nur lokal nötig)
```

Dann **http://localhost:5173/admin/** öffnen. Änderungen werden direkt in die
Dateien in `content/` gespeichert, die Webseite nach dem Neuladen aktualisiert.

**Online:** `<Live-Adresse>/admin/` öffnen und mit GitHub anmelden (Einrichtung siehe
„Start-Checkliste“, Punkt 2). Jede gespeicherte Änderung geht automatisch online.

## Was wo bearbeitet wird

| Im Admin                        | Was                                                         |
|---------------------------------|-------------------------------------------------------------|
| Startseite › Startseite & Design | Farben, Menü, Ankündigungsleiste, **Reihenfolge/Sichtbarkeit der Bereiche**, alle Texte und Bilder der Bereiche, Footer |
| Produkte › eSIM-Länder & Pakete | Länder, Bilder, „Beliebt“-Schalter, regionale Pakete und Weltkarten-Regionen (Preise kommen von der API) |
| Hilfe-Center › Assistent & FAQ  | Fragen & Antworten, Suchbegriffe, Schnellfragen, Geräteliste. Die „Banner“ (Geräte-Check, Anleitung, Paketberatung) und Schnellfragen erscheinen zusammen mit den meistgefragten FAQ in der laufenden Fragenleiste unter Lina |
| Blog-Artikel                    | Ein Eintrag = ein Artikel (Seite `blog.html?p=<name>`), in allen Sprachen. Die neuesten 5 erscheinen auf der Startseite. Preise im Text nur als Platzhalter, z. B. `{fiyat:country:jp}` |
| Bewertungen                     | Bewertungen (Demo – später Trustpilot-Widget)               |

## Assistent füttern

Jede Frage unter „Fragen & Antworten“ ist gleichzeitig FAQ-Eintrag und Wissen des
Assistenten. Wichtig sind die **Suchbegriffe**: alle Wörter, mit denen Kunden
danach fragen könnten. „Wie oft gefragt“ bestimmt die Reihenfolge in der FAQ.

## Sprachen

- **Türkisch ist die Hauptsprache.** Die Seite erscheint automatisch in der
  Sprache des Handys bzw. Browsers. Gibt es diese Sprache nicht, erscheint Türkisch.
- Besucher können oben rechts (z. B. „TR · EUR“) die Sprache wechseln; die Wahl wird gespeichert.
- Jede Inhaltsdatei enthält alle Sprachen: `{ "tr": …, "en": …, "de": … }`.
  Türkisch enthält alles (Bilder, Links, Reihenfolge); die anderen Sprachen nur Texte.
  Fehlt ein Text, wird automatisch der türkische angezeigt.
- Im Admin oben die Sprache wählen und übersetzen. Kleine Texte (Buttons, Hinweise)
  stehen unter **Oberflächentexte**. Platzhalter wie `{p}` (Preis) oder `{n}` (Zahl) stehen lassen.
- Ländernamen übersetzt der Browser automatisch in jede Sprache.
- **Neue Sprache:** in `content/languages.json` eintragen, im Admin bei
  `admin/config.yml → i18n.locales` ergänzen, dann übersetzen.
- Preise in Texten: `{fiyat:esim}`, `{price:lounge}` oder `{preis:country:tr}`.
- Aktuell: Türkisch, Englisch, Deutsch, Arabisch (von rechts nach links), Russisch,
  Französisch, Spanisch.

## Währungen

- Oben rechts wählen Besucher Sprache **und** Währung (Handy und Desktop).
- Startwährung: gespeicherte Wahl › Land des Geräts (z. B. Türkei → TRY, UK → GBP,
  Euroländer → EUR) › Standard der Sprache (`content/languages.json`).
- Umgerechnet wird **nur auf dem Server** (Supabase-Funktion `prices`) mit dem
  offiziellen Tageskurs der Europäischen Zentralbank. Im Browser oder im Code gibt
  es keine festen Kurse. Ist kein Kurs verfügbar, bleibt es bei der Anbieterwährung.
- Erlaubte Währungen: Secret `CURRENCIES` in Supabase (Standard `EUR,USD,GBP,TRY,CHF`)
  und Liste `currencies` in `content/languages.json`. Die EZB veröffentlicht keine
  Kurse für AED, SAR oder RUB – diese sind deshalb nicht dabei.
- Wichtig für den Checkout: Der Betrag an der Kasse muss in derselben Währung
  berechnet werden wie angezeigt (Zahlungsanbieter entsprechend einrichten).

## Preise – Grundregel

Alle Preise kommen ausschließlich von den Anbieter-APIs (eSIM, Lounge, Fast Track,
Vignette). Im Admin gibt es deshalb keine Preisfelder. Ist eine API nicht
erreichbar, zeigt die Seite „Preis folgt“ – nie einen erfundenen Wert.

- Lokal: Testdaten in `api/prices.json` (in der Vorschau-Leiste markiert).
- Live: Supabase-Funktion `supabase/functions/prices`. Sie fragt die Anbieter ab,
  speichert 15 Minuten zwischen (Tabelle `price_cache`) und liefert alles in einem
  Format. Die API-Schlüssel liegen nur als Secrets in Supabase.

## Live gehen: GitHub + Supabase

| Wo              | Was                                                            |
|-----------------|----------------------------------------------------------------|
| GitHub          | Code, Versionen, automatische Veröffentlichung (Actions)       |
| GitHub Pages    | die Webseite selbst (öffentlicher Link, später eigene Domain)  |
| Supabase        | Preis-Funktion, Preis-Zwischenspeicher, unbeantwortete Lina-Fragen |

Einmalig einrichten:

1. Repository auf GitHub anlegen und hochladen; unter **Settings › Pages** als
   Quelle „GitHub Actions“ wählen. Ab dann geht jede Änderung auf `main`
   automatisch online (`.github/workflows/deploy.yml`).
2. In Supabase unter **Edge Functions › Secrets** eintragen:
   `ESIM_API_URL`, `ESIM_API_KEY`, `LOUNGE_API_URL`, `LOUNGE_API_KEY`,
   `FASTTRACK_API_URL`, `FASTTRACK_API_KEY`, `ALLOWED_ORIGINS`
   (z. B. `https://passport.io,https://<name>.github.io`).
3. In GitHub unter **Settings › Secrets and variables › Actions**:
   Secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`
   und die Variable `SUPABASE_ENABLED` = `true`.
4. Im Admin unter **Startseite & Design › Preis-Schnittstelle** eintragen:
   - Adresse: `https://<projekt>.supabase.co/functions/v1/prices`
   - Lina-Fragen: `https://<projekt>.supabase.co/functions/v1/questions`

## Blog und Google

- Artikel liegen in `content/posts/` (eine Datei je Artikel, alle Sprachen darin).
  Die Übersicht `content/blog.json` wird beim Veröffentlichen automatisch erzeugt
  (lokal: `node tools/build-blog.js`).
- Beim Veröffentlichen entstehen außerdem `sitemap.xml` (alle Seiten in allen Sprachen)
  und `robots.txt`. In der Google Search Console die Sitemap einreichen:
  `<Seitenadresse>/sitemap.xml`. Eigene Domain später als GitHub-Variable `SITE_URL` eintragen.
- Jede Artikelseite setzt Titel, Beschreibung, Sprachversionen (hreflang) und
  Artikel-Daten für Google automatisch.

## Kundenkonto (account.html)

- Anmeldung mit E-Mail + Passwort (6-stelliger Code per E-Mail), Google oder Apple.
- Passwort vergessen: Code per E-Mail (zusätzlich Link), dann neues Passwort.
- Profil: gebuchte eSIMs mit QR-Code, SM-DP+-Adresse und Aktivierungscode zum Kopieren,
  „Direkt auf dem iPhone installieren“, Verbrauch (GB), Restlaufzeit, Ablaufdatum, Status;
  Bestellungen; Name, Sprache, Währung, Newsletter; Passwort ändern; Konto löschen.
- Technik: Supabase Auth; Tabellen `profiles`, `orders`, `esims` (jede Person sieht nur
  ihre Daten); Funktion `account` (Profil, Bestellung, Löschen). Preise prüft der Server
  über die Preis-Schnittstelle – nie aus dem Browser.
- Texte: `content/account.json` (alle 7 Sprachen).

## Shop-Verwaltung (/admin/panel.html)

- **Übersicht:** Umsatz, Bestellungen (30 Tage), Kunden, aktive eSIMs, letzte Bestellungen,
  „Startklar?“-Liste (was vor dem Verkauf noch fehlt).
- **Bestellungen / Kunden / eSIMs:** Listen mit Suche und Filter, Status ändern
  (Erstattungen zusätzlich beim Zahlungsanbieter auslösen).
- **Preise & Wettbewerb:** Preisregel einstellen, Wettbewerbspreise pflegen (einzeln oder per
  CSV), Vorschau aller Verkaufspreise mit Einkauf, Marge und angewandter Regel.
- **Anbieter & Einstellungen:** Status aller Schnittstellen mit direkten Links ins Supabase-Dashboard.
- **Inhalte:** Texte, Bilder, Blog, Rechtsseiten, Farben → Inhalts-Editor unter /admin/.
- **Zugang:** Supabase → Edge Functions → Secrets → `ADMIN_EMAILS` = eure E-Mails
  (kommagetrennt). Diese Personen registrieren sich normal auf der Kontoseite, bestätigen die
  E-Mail und melden sich dann im Panel an.

## Preisregel

Grundlage ist immer der **Einkaufspreis aus der Anbieter-API**:
1. Gibt es einen Wettbewerbspreis für dasselbe Produkt (Land/Region, Volumen, Laufzeit) →
   **günstigster Wettbewerber minus „ein Tick“** (Standard 0,10 €).
2. Sonst → **Einkaufspreis × 2** (auf ,99 gerundet).
3. **Nie unter 2,99 €** und nie unter Einkauf + Mindestmarge (Standard 10 %, Schutz vor
   Verlustverkäufen, falls ein Wettbewerber extrem günstig ist).

Alle Werte sind im Panel einstellbar und gelten sofort. Einkaufspreise werden nie öffentlich
ausgeliefert. Der eSIM-Adapter liest den Einkauf aus `wholesale_price` / `net_price` / `cost` /
`price` der Anbieter-Antwort (in `supabase/functions/prices/index.ts` an den Anbieter anpassen).

## Rechtsseiten

`page.html?p=imprint | privacy | terms | withdrawal | distance-sales | about` – Inhalte in
`content/pages.json` (Admin: „Seiten & Rechtliches“). **Entwürfe mit Platzhaltern in
[ECKIGEN KLAMMERN]** – ausfüllen und vor dem Start anwaltlich prüfen lassen. Türkisch,
Englisch und Deutsch sind ausformuliert, die übrigen Sprachen zeigen vorerst den englischen Text.

## Start-Checkliste (einmalig, von euch selbst einzurichten)

Alle Schlüssel und Passwörter tragt ihr selbst ein – nie in den Code.

**1. Supabase → Authentication**
- *URL Configuration*: Site URL = Live-Adresse; Redirect URLs:
  `https://yildirimavam55-glitch.github.io/passport-io/account.html`,
  `http://localhost:5173/account.html`, später `https://passport.io/account.html`.
- *Sign In / Providers → Email*: „Confirm email“ an, OTP-Länge 6, Mindestlänge Passwort 8
  (Buchstaben + Ziffern).
- *Email Templates*: Inhalt von `supabase/templates/confirm-signup.html` in „Confirm signup“
  und `reset-password.html` in „Reset Password“ einfügen (Betreff steht oben in der Datei).
  Die Mails erscheinen automatisch in der Sprache der Registrierung.
- *SMTP*: **Pflicht vor dem Start.** Ohne eigenen Mailversand verschickt Supabase nur
  wenige Test-Mails. Einen Dienst wie Resend, Brevo oder Postmark anlegen, Absender z. B.
  `no-reply@passport.io`, Zugangsdaten unter *SMTP Settings* eintragen.
- *Google* (aktuell **aus** – deshalb funktioniert „Mit Google“ noch nicht; der Knopf ist
  so lange ausgeblendet):
  1. console.cloud.google.com → Projekt anlegen → *APIs & Services → OAuth consent screen*
     (App-Name passport.io, Support-E-Mail, Domain) ausfüllen.
  2. *Credentials → Create credentials → OAuth client ID → Web application*.
     Authorized JavaScript origins: Live-Adresse(n). Authorized redirect URI:
     `https://sbzwibctxezprpefwxzn.supabase.co/auth/v1/callback`.
  3. Client-ID und Client-Secret in Supabase → Authentication → Providers → *Google* eintragen
     und einschalten. Danach erscheint der Knopf automatisch.
- *Apple*: Apple-Developer-Konto nötig. Services ID + Key anlegen, Return URL wie oben
  (`…/auth/v1/callback`), Team ID, Key ID und Key in Supabase bei *Apple* eintragen.

**2. Admin-Bereich online (/admin)**
- GitHub → Settings → Developer settings → OAuth Apps → *New OAuth App*:
  Homepage = Live-Adresse, Callback =
  `https://sbzwibctxezprpefwxzn.supabase.co/functions/v1/cms-auth/callback`.
- In Supabase → Edge Functions → Secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
- Wer Inhalte bearbeiten soll, braucht Schreibrechte im GitHub-Repository.

**3. Anbieter anbinden (Secrets in Supabase)**
- eSIM: `ESIM_API_URL`, `ESIM_API_KEY` – Anbindung in `supabase/functions/_shared/esim-provider.ts`.
- Zahlung: `PAYMENT_PROVIDER` + Schlüssel – Anbindung in `supabase/functions/account/index.ts`
  (Stelle „TODO Zahlung“). Bis dahin bleiben Bestellungen „Zahlung ausstehend“.
- Nur zum Testen: `ALLOW_TEST_ORDERS=true` stellt ohne Zahlung eine **Test-eSIM** aus
  (funktioniert auf keinem echten Handy). Vor dem Start wieder entfernen.

**4. Rechtliches (vor dem Start)**
- Impressum, Datenschutzerklärung (DSGVO + KVKK), AGB bzw. Mesafeli Satış Sözleşmesi,
  Widerrufs-/Rückgaberegeln, Cookie-Hinweis. Die Footer-Links zeigen noch auf Platzhalter.

**5. Domain**
- `passport.io` in GitHub → Settings → Pages als Custom Domain eintragen, DNS beim
  Domain-Anbieter setzen, Repository-Variable `SITE_URL=https://passport.io/`.

## Was Lina nicht beantworten konnte

Supabase › Table Editor › `top_unanswered` zeigt die häufigsten offenen Fragen.
Daraus im Admin neue FAQ-Einträge machen und die Zeile in
`unanswered_questions` auf `handled = true` setzen.

## Bilder

Aktuell Platzhalter von Unsplash (kommerziell nutzbar). Im Admin bei jedem Bild
einfach eine eigene Datei hochladen – sie landet in `img/uploads/`.
