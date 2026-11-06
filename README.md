# ⛅ WeatherPlanner

Kartenbasierte Web-App: Standort eingeben, Umkreis (100/200/300 km) und Zeitraum (nächstes Wochenende, optional + Freitag / + Montag) wählen – und die Karte zeigt, **wo im Umkreis das Wetter für deine Aktivität am besten ist**.

| Aktivität | Wichtig |
|---|---|
| 🧗 Klettern | trocken (auch an den Vortagen), mäßige Temperatur, wenig Wind |
| ⛷️ Skifahren | Höhenlage, Kälte, Neuschnee, wenig Regen/Wind, Sonne |
| 🚵 Mountainbiken | wenig Regen, nicht aufgeweichte Trails, angenehme Temperatur |
| 🥾 Wandern | trocken, nicht zu heiß, Sonne |
| 🏊 Baden / Seen | warm, sonnig, trocken, windarm |

## Wie es funktioniert
- Rund um den Standort wird ein Gitter von Punkten gelegt (Abstand = Umkreis / 5).
- Für alle Punkte werden Tagesvorhersagen von [Open-Meteo](https://open-meteo.com) geholt (kostenlos, **kein API-Key**), inkl. 2 Vortagen für Bodenfeuchte.
- Pro Aktivität und Tag wird ein Score 0–100 berechnet (`js/activities.js`); der Gesamtscore ist Mittelwert, gewichtet mit dem schlechtesten Tag.
- Farbige Kreise auf der Karte (rot → grün), Top-8-Liste, Klick auf einen Ort zeigt die Tageswerte.
- Die Aktivität lässt sich umschalten, ohne neu zu laden.

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
