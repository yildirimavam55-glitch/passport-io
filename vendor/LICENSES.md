# Selbst gehostete Bibliotheken (unverändert aus npm)

Werden von hier geladen statt von einem CDN, damit beim Seitenaufruf keine Daten an Fremdserver gehen (Datenschutz) und niemand die Dateien unterwegs austauschen kann.

| Datei | Paket | Lizenz |
| --- | --- | --- |
| js/supabase.js, js/591.supabase.js | @supabase/supabase-js 2.45.4 | MIT |
| js/qrcode.js | qrcode-generator 1.4.4 | MIT |
| js/d3-array.min.js | d3-array 3.2.4 | ISC |
| js/d3-geo.min.js | d3-geo 3.1.1 | ISC |
| js/topojson-client.min.js | topojson-client 3.1.0 | ISC |
| js/js-yaml.min.js | js-yaml 4.1.0 | MIT |
| data/countries-110m.json | world-atlas 2.0.2 (Natural Earth, gemeinfrei) | ISC |

Flaggen: img/flags (flag-icons 7.6.0, MIT). Schrift: fonts/ (Schibsted Grotesk via @fontsource, SIL OFL 1.1).
Aktualisieren: `npm pack <paket>@<version>` und die Datei aus `package/dist` hierher kopieren.
