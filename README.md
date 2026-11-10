# ⛅ WeatherPlanner

Kartenbasierte Web-App: Standort eingeben, Zeitraum (nächstes Wochenende, optional + Freitag / + Montag) wählen – und die Karte zeigt, **wo im sichtbaren Kartenausschnitt das Wetter für deine Aktivität am besten ist**, inklusive Auto-Fahrzeit ab deinem Standort.

| Aktivität | Wichtig |
|---|---|
| 🧗 Klettern | trocken (auch an den Vortagen), mäßige Temperatur, wenig Wind |
| ⛷️ Skifahren | Höhenlage, Kälte, Neuschnee, wenig Regen/Wind, Sonne |
| 🚵 Mountainbiken | wenig Regen, nicht aufgeweichte Trails, angenehme Temperatur |
| 🥾 Wandern | trocken, nicht zu heiß, Sonne |
| 🏊 Baden / Seen | warm, sonnig, trocken, windarm |

## Wie es funktioniert
- Über den sichtbaren Kartenausschnitt wird ein Gitter von Punkten gelegt (max. ~100, Raster passt sich dem Zoom an). Verschieben/Zoomen lädt nur fehlende Punkte nach.
- **Fahrzeit:** Klick auf einen Ort oder Spot zeigt Fahrzeit und Strecke mit dem Auto ab dem Standort (Routing über den öffentlichen [OSRM](https://project-osrm.org)-Demo-Server, ohne Key; fällt er aus, gibt es eine Schätzung aus der Luftlinie). Die Liste „Beste Orte“ zeigt immer die Schätzung.
- Standort setzen: Ortssuche, 📍 oder Rechtsklick (lang drücken) auf die Karte.
- Für alle Punkte werden Tagesvorhersagen von [Open-Meteo](https://open-meteo.com) geholt (kostenlos, **kein API-Key**), inkl. 2 Vortagen für Bodenfeuchte.
- Pro Aktivität und Tag wird ein Score 0–100 berechnet (`js/activities.js`); der Gesamtscore ist Mittelwert, gewichtet mit dem schlechtesten Tag.
- Farbige Kreise auf der Karte (rot → grün), Top-8-Liste, Klick auf einen Ort zeigt die Tageswerte.
- Die Aktivität lässt sich umschalten, ohne neu zu laden.
- **Gewichtung:** unter „Gewichtung anpassen“ lässt sich pro Faktor (Trockenheit, Temperatur, Wind, Sonne, Neuschnee …) per Dropdown einstellen, wie stark er einfließt (Ignorieren … Sehr wichtig). Wird im Browser gespeichert.
- **Wettervorschau:** Tageskarten (Wetter, Temperatur, Regen, Schnee, Böen, Score) für den Standort bzw. den zuletzt angeklickten Ort.
- **Spots:** Pins nur für die gewählte Aktivität (Klettern → Klettergebiete, Skifahren → Skigebiete, MTB → Bikeparks), gruppiert in Clustern. Beim Klettern lässt sich nach Disziplin filtern: Sportklettern, Trad, Alpin, Bouldern. Spots ohne Namen bekommen beim Klick per Ortssuche einen Namen („Klettergebiet bei …“).

## Spot-Daten
| Datei | Inhalt |
|---|---|
| `data/scraped-spots.json` | per Web-Scraping aus Wikipedia-Kategorien (MediaWiki-API) – Ski (AT/DE/CH), Klettern (DE/AT/IT/FR) |
| `data/curated-spots.json` | von Hand ergänzt, **Koordinaten ungefähr**: MTB-Bikeparks, bekannte Klettergebiete, Skigebiete in IT/FR |

| `data/osm-spots.json` | Europa-weit aus OpenStreetMap (Overpass): Klettergebiete mit Disziplinen, Skigebiete – erzeugt mit `npm run scrape:osm` (Datei wird beim Scrapen erzeugt, ist noch nicht im Repo) |

`npm run scrape:osm` (`scripts/scrape-osm.mjs`) lädt Europa in 5°-Kacheln, ist fortsetzbar (Cache in `data/.cache`), nutzt mehrere Overpass-Mirrors mit Retry/Backoff und fasst Duplikate zusammen. Daten © OpenStreetMap-Mitwirkende (ODbL).

`npm run scrape` holt die Wikipedia-Kategorien neu (`scripts/scrape-spots.mjs`, braucht Netzwerk) und überschreibt `scraped-spots.json`.
### Geprüfte Quellen
- **OpenBeta** (offene API): funktioniert, enthält für Europa aber nur leere Gerüst-Einträge (0 Routen, Platzhalter-Koordinaten wie Landesmitte) – deshalb nicht eingebunden.
- **Outdooractive**: `robots.txt` sperrt `/climbingspot/`, `/climbingroute/` und `/api/` ausdrücklich – nicht gescrapt. Legitimer Weg: offizielle Outdooractive-API mit Partner-Key.
- **UKClimbing**: Nutzungsbedingungen waren für den Abruf gesperrt (bot_blocked), daher nicht verifizierbar – nicht gescrapt.
- **DAV Felsinfo**: enthält Regionen-Infos (Sperrungen, Regeln), aber keine Koordinaten/Routenzahlen.

Größe der Pins/Filter „Mindestgröße“ basieren auf der Routenzahl (OSM `climbing:routes`), sonst auf einer Schätzung (Wikipedia-/kuratierte Gebiete = groß).

theCrag blockiert Bots und Mountain Project deckt Europa kaum ab – deshalb ist OpenStreetMap die Hauptquelle für Klettergebiete.

## Lokal starten
```bash
npm start          # http://localhost:8080  (nur Python 3 nötig)
npm test           # Tests für die Bewertungslogik (Node ≥ 20)
```
`http://localhost:8080/?demo=1` nutzt synthetische Wetterdaten (zum Entwickeln ohne Netzwerk).

Kein Build-Schritt: reines HTML/ES-Module + [Leaflet](https://leafletjs.com). Deployment als statische Seite via GitHub Pages (`.github/workflows/pages.yml`; unter *Settings → Pages → Source: GitHub Actions* aktivieren).

## Ideen / Roadmap
- Eigene Schwellwerte je Aktivität einstellbar machen
- Weitere Aktivitäten (Rennrad, Paragliding, Wintersport mit Schneehöhe, Kajak …)
- Feineres Gitter / Höhenlagen-Filter, Fahrzeit statt Luftlinie
- Wetter-Modellvergleich (Unsicherheit anzeigen), Teilen per URL
