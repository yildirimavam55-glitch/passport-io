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

## Was wo bearbeitet wird

| Im Admin                        | Was                                                         |
|---------------------------------|-------------------------------------------------------------|
| Startseite › Startseite & Design | Farben, Menü, Ankündigungsleiste, **Reihenfolge/Sichtbarkeit der Bereiche**, alle Texte und Bilder der Bereiche, Footer |
| Produkte › eSIM-Länder & Pakete | Länder, Bilder, „Beliebt“-Schalter, regionale Pakete und Weltkarten-Regionen (Preise kommen von der API) |
| Hilfe-Center › Assistent & FAQ  | Fragen & Antworten, Suchbegriffe, Banner, Schnellfragen, Geräteliste |
| Magazin & Bewertungen           | Blog-Teaser, Bewertungen (Demo – später Trustpilot-Widget)  |

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

## Was Lina nicht beantworten konnte

Supabase › Table Editor › `top_unanswered` zeigt die häufigsten offenen Fragen.
Daraus im Admin neue FAQ-Einträge machen und die Zeile in
`unanswered_questions` auf `handled = true` setzen.

## Bilder

Aktuell Platzhalter von Unsplash (kommerziell nutzbar). Im Admin bei jedem Bild
einfach eine eigene Datei hochladen – sie landet in `img/uploads/`.
