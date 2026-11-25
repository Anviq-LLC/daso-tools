# Aktuelle Aufmaß-Anbindung · v5 · 17.11.2026

Der bisher fehlende Abruf ist jetzt verfügbar: **GET /api/sub-teams?month=YYYY-MM**. Bestehende Bearer-Authentifizierung, ausschließlich lesend. Keine zusätzliche API-Erweiterung mehr erforderlich. `aufmass-nu-endpoint.mjs` aus v4 ist ein historischer Alternativvorschlag und wird nicht benötigt.

Antwort je Tages-/Team-/Projektzeile:

`{subcontractor,team,project,day,revenueEur,costEur,persons,hours,perPersonEur,estimated}`

Der aktualisierte API-Code bildet diese Antwort aus verbindlichen `subB`-Aufmaßdaten. Keine Einzelaufmaßnummer oder Monteurnamen enthalten. Keine Zuordnung zu frei gepflegten Mitarbeiterprofilen erzwingen. Das Team bleibt die Abrechnungsebene. Stunden sind Gesamtstunden des Teams, nicht Stunden pro Person.

Im Prototyp sind Oktober und November 2026 eingelesen: `sub-teams-read.json` enthält die Antworten und Kontrollwerte; `aufmass-nu.json` den normalisierten Export. `subTeamsExport` in `dist/aufmass.mjs` wandelt Stunden in Minuten und Euro in Cent um, erhält Nullwerte und prüft doppelte Schlüssel. Der neue Bestand ersetzt den alten, keine Addition zu v_sub_day. Der Snapshot wird nicht automatisch im Hintergrund erneuert.

Bei der Einbettung `read-proxy.mjs` hinter vorhandene Nutzer-Authentifizierung anbinden. Schlüssel nur als serverseitiges Secret. Anschließend die benötigten Monate lesen und über `subTeamsExport` übernehmen. Nach Quelländerungen verlieren Wochenabschlüsse ihre Gültigkeit durch Vergleich mit den gespeicherten Quelldaten; Rechnungsprüfungen müssen bei geänderten Beträgen erneuert werden. Keine Schreiboperationen auf die Originaldatenbank.

Vier Novemberzeilen sind als `estimated=true` gekennzeichnet; sie werden angezeigt, aber nicht als genaue Stunden bestätigt. Keine Schätzwerte stillschweigend zu Ist erklären. Fehlende Angaben bleiben unbekannt. Nur die ausdrücklich bestätigten Kompanets-Namensvarianten vereinigen; unterschiedliche Teams und Projekte bleiben getrennt.

Rechnungseinlesung: PDF-Text, in PDF eingebettete CII-/ZUGFeRD-XML sowie separate UBL-/CII-XML. Nur EUR und positive Rechnungen, keine Gutschriftverarbeitung oder vollständige EN16931-/Schematron-Konformitätsvalidierung. Rohdatei unverändert aufbewahren; XML-Lesefassung als PDF mit eingebettetem Original-XML erzeugen. Bei Scans ohne Text ist OCR weiter nicht implementiert.


## Verbindliche Anpassung v6

Keine Pflichtreihenfolge und keine Datensperre: Woche manuell abschließen auch bei fehlenden/geschätzten Werten; Stundenzettel sowie Rechnungseinlesung/Prüfung/PDF-Zahlungsbereitstellung sind unabhängig davon möglich. Offene Sollkosten verhindern die Rechnungsprüfung nicht; Stempel zeigt Soll offen statt 0.

Wochenwerte lokal bearbeiten (Teams, Tagesstunden, Umsatz, Kosten), Quelle unverändert erhalten. Lokale Änderungen als Überlagerung mit Originalvergleich, Rücksetzen auf Quelle möglich. Bonus/Abzug exakt zwei Felder Monteur ± Stunden und Obermonteur ± Stunden, automatische Projektsätze und Neuberechnung; keine weiteren Pflichtfelder. Frühere Vorgaben zu Sperren und Pflichtbegründung im Bonusdialog sind ersetzt.

## Aufmaßwert nach Firmenanteil

Für die Umsatzübersicht, Wochenübersicht und CSV übernimmt der Prototyp `aufmassValueCents` aus dem datierten Aufmaßexport. Der Wert wird aus den hinterlegten Aufmaßpositionen mit der Preislogik des Aufmaßtools ermittelt und nach Projekt-ID, Leistungsdatum, Firma und Team zugeordnet. Beim Import wurde für alle 57 Tages-/Teamzeilen auch der jeweilige Kundenumsatz abgeglichen. Für weitere Datenimporte dieses Feld mitliefern. Ohne Aufmaßwert bleibt der Betrag offen.
