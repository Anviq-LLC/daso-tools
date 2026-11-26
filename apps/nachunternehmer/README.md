# DaSo Nachunternehmertool · v13

Isolierter Prototyp zur Einbettung durch euren Entwickler. Originaltools und Quelldatenbank bleiben unverändert.

## Run

    pnpm install
    pnpm dev         # local worker
    pnpm typecheck   # syntax check
    pnpm test
    pnpm build       # dry run, deploys nothing

## Aktueller Stand

Die aktualisierte API liefert jetzt unter **GET /api/sub-teams?month=YYYY-MM** echte Teams, Tagesstunden, Personen, Projekte, Umsätze und Kosten. Oktober und November 2026 wurden ausschließlich lesend übernommen. Der Einteilungs-Projektstamm ist seit v10 über den vorhandenen GET /api/catalog verfügbar (siehe integration/Projektstamm.md). Der statische Prototyp verwendet den aktuellen datierten Snapshot, keinen laufenden Live-Abruf. Für laufende Synchronisierung serverseitigen Proxy wie unter `integration/` anbinden; API-Schlüssel niemals ins Frontend.

| Monat | Teamstunden | NU-Umsatz netto | NU-Kosten netto |
| --- | ---: | ---: | ---: |
| Oktober 2026 | 249 | 12.766,85 € | 7.690,00 € |
| November 2026 | 957,5 | 62.066,02 € | 31.279,00 € |

Stand des letzten Abrufs: siehe fetchedAt in `dist/aufmass-nu.json`. Keine Behauptung vollständig erfasster Monate. Beide NU-Umsatzsummen stimmen mit den gleichzeitig gelesenen Monatsübersichten überein. Die Firmenübersicht liefert im November abweichende Kosten (+12.904 €); die UI verwendet die Tages-/Teamkosten und zeigt den Quellenhinweis. Vier Novemberzeilen tragen estimated=true und bleiben als Hinweis sichtbar; alle Aktionen sind trotzdem verfügbar.

## Freier Ablauf in v6

Alle Aktionen sind unabhängig: Vorherige Stundenzettel sind keine Voraussetzung für Rechnungseinlesung oder PDF-Zahlungsbereitstellung. Geschätzte und fehlende Daten sperren den Ablauf nicht. Fehlende Werte bleiben offen und erscheinen nicht als 0.

Über Bearbeiten können Teambezeichnung, Tagesstunden, Umsätze und Kosten je Projekt/Firma/Woche korrigiert und leere Tage ergänzt werden. Änderungen werden als lokale Überlagerung gespeichert; Original-API bleibt unverändert. Aufmaßwerte wiederherstellen entfernt die Überlagerung. Umsatzübersicht bleibt die separate API-Auswertung, keine Verbuchung von lokalen Wochenkorrekturen.

Bonus/Abzug zeigt genau zwei Stundenfelder. Betrag = Monteurstunden × Projekt-Monteursatz + Obermonteurstunden × Projekt-Obermonteursatz. Bekannte Sätze werden beim Speichern festgehalten, fehlende Sätze später aus Projektvertrag ergänzt. Keine Pflichtfelder für Satz, Name oder Grund im Bonusdialog. Abrechnungsstunden und Wochenpauschale werden neu berechnet; tatsächliche Arbeitsstunden und Ausgleich bleiben getrennt. Fehlt ein Satz, bleiben Kosten offen, Stunden können gespeichert werden.

## Ablauf

1. Projekt oder alle Projekte wählen; Mo–So mit Datum, Stunden, Tagesumsatz und Kosten je Team ansehen. Keine Monteurzuordnung oder erneute Tagesstundeneingabe.
2. Wochenwerte bei Bedarf bearbeiten.
3. Wochenstundenzettel einzeln oder gesammelt drucken / als PDF speichern. Teamstunden statt erfundener Einzelnamen. Kundenerlöse stehen nur intern in der Wochenübersicht.
4. Rechnung als PDF, ZUGFeRD-PDF oder UBL-/CII-XML einlesen. Rechnungsnummer und einziger Netto-Rechnungsbetrag werden automatisch übernommen. Nur Abweichungen melden; begründete Rechnungskorrektur mit Prüfer erlaubt, Quellwerte bleiben erhalten.
5. Bonus/Abzug mit genau zwei Eingabefeldern: Monteur ± Stunden und Obermonteur ± Stunden. Projektsätze automatisch übernehmen; keine weitere Pflichtangabe. Skonto aus Projektvertrag auswählen, optional 5 % Sicherheitseinbehalt.
6. „Rechnung für Zahlung bereitstellen“ erzeugt die PDF-Prüfkopie mit Stempel: geprüft von, Einbehalt aktuell und kumuliert pro Projekt/Firma, Skonto und Auszahlungsbetrag. Original erhalten; Stempel auf erster Seite; bei fehlender Fläche Inhalt auf derselben Seite verkleinern; leere Seiten in der Prüfkopie entfernen. XML-Lesefassung mit eingebettetem Original. Keine Bankzahlung.

## Weitere Funktionen

Firmen und Unterlagen, frei pflegbare Teams/Mitarbeiter, kompakte Bewertungen, Fristwarnungen, Projektverträge und Zahlungsziele. Neue Mitarbeiter erhalten einen vollständigen Namen. Nur die bestätigten Kompanets-Namensvarianten werden vereinigt, keine anderen Firmen. Teams bleiben getrennt. Keine eigene Leistung in Umsatzansicht, keine Projektbeteiligung, keine Einteilungs-/Stempelanbindung und keine Alex-Sonderabrechnung. Alex bleibt normale Firma.

## Speicherung und Übergabe

Prototyp: localStorage und IndexedDB. Alte manuelle Wochenstunden bleiben archiviert, zählen nicht als Aufmaßstunden. Neue Abrechnung eigener Namensraum aufmass-v4; Quellstände und Wochenprüfung werden verglichen. Für Mehrbenutzerbetrieb zentrale Rechteprüfung, geschützte Dateien und versionierte Freigaben anbinden. `integration/API-Vertrag.md` und `Aufmass-Anbindung.md` sind die aktuelle Einbauanleitung. Der eigene Endpunktvorschlag aus v4 ist historisch, nicht erforderlich.

Buildlos `dist/` über Webserver öffnen. `app.js` = UI, `aufmass.mjs` = Adapter, `einvoice.mjs` = PDF/XML-Auslesung, `invoice.mjs` = Berechnung/Stempel; übrige Module Profile/Verträge. Keine Installation für die Vorschau nötig.

## Validierung und Grenzen

47 Tests mit `node --test tests/*.test.mjs` bestanden: neue Team-API, aktuelle Monatsabgleiche, Alias, fehlende Stunden, Duplikate, Vertragswerte, Rechnungswerte und Kumulation, UBL/CII, XML-Sicherheitsfälle und PDF-Lesefassung. Browser: Stundenzettel, Abweichung und 5 % Einbehalt, begründbare Korrektur. Offline zusätzlich eingebettete ZUGFeRD-XML aus PDF und gestempelte Prüfkopie (1.000 € minus 50 € Einbehalt, dann 2 % aus 950 € = 931 € Zahlung) geprüft.

Browser-Datei-Upload war zuvor nicht freigegeben; er wurde nicht erneut versucht und ist weiter nicht Ende-zu-Ende geprüft. Scans ohne Text: keine OCR. EUR-Rechnungen mit positiven Beträgen; keine Gutschriftverarbeitung oder vollständige EN16931-/Schematron-/PDF-A-Konformitätsprüfung. Im Produktiveinbau Mehrfachrechnungen/Teilzahlungen und endgültige Buchungsfreigabe versioniert behandeln.

Drittkomponenten lokal mit Lizenzen: PDF.js 4.10.38 (Apache-2.0), pdf-lib 1.17.1 (MIT), IBM Plex Sans (OFL), xml-js 1.6.11 mit gebündeltem SAX-Parser (MIT). DaSo-Logo aus bereitgestelltem Dashboard.


## PDF-Erkennung v7

PDF-Zeichenläufe werden anhand ihrer tatsächlichen Position auf derselben Textzeile zusammengesetzt. Dadurch bleiben fragmentierte Ziffern und Rechnungsnummern erhalten, und Tabellenüberschriften werden dem Betrag in derselben Zeile zugeordnet. Zusätzliche Erkennung für Rechnung / Nr auf getrennten Zeilen. Keine globale Entfernung von Leerzeichen, keine Vereinigung verschiedener Zahlenfelder. Mit einer bereitgestellten zweitseitigen Word-PDF über den vollständigen Dateileser geprüft: Nummer und Betrag korrekt; die leere zweite Seite stört nicht. Original-PDF nicht in Repository oder Paket aufgenommen. Drei neue Regressionstests mit minimalen synthetischen Textpositionen. Browser-Upload weiterhin nicht erneut getestet.


## Rechnungsskonto v8

Bei jeder Rechnung kann Rechnungsskonto unabhängig von einem Projektvertrag aktiviert und der Prozentsatz manuell eingegeben werden. Vorhandener Projektsatz wird nur vorgeschlagen und kann für diese Rechnung überschrieben werden; Projektvertrag unverändert. Skontobetrag, Zahlbetrag und PDF-Stempel nutzen den tatsächlich gespeicherten Rechnungssatz. Eingabe größer 0 und kleiner 100, bis zwei Nachkommastellen; bei ausgeschaltetem Skonto 0.

## Verbindlicher Stand v9

- Rechnung ausschließlich netto. Einbehalt zuerst, Skonto aus verbleibendem Betrag. Alte Prüfungen müssen vor neuem Export erneut gespeichert werden (calculationVersion 2).
- Kompakter Prüfungsstempel auf erster Seite, kein Projektname. Original unverändert; unnötige Leerseiten werden nur in der Prüfkopie entfernt. Bei dichter Seite reservierter Fußbereich auf derselben Seite.
- Sicherheitseinbehalte pro Firma/Projekt/Rechnung mit Datum, Summen und Auszahlungsprotokoll. Vorbereiten reserviert Betrag, bezahlt-Markierung vermindert offenen Saldo, Stornierung bleibt historisch. Keine Bankaktion.
- Wochenwerte: zwei Rollenstunden, Kosten automatisch mit Projektsätzen; Umsatz unveränderlich. Unbekannte Rollen bleiben bis bewusster Bearbeitung offen. Bonus/Abzug explizit löschbar. Umsatz, Kosten und Gewinn intern sichtbar.
- Mitarbeiter: vollständiger Name, Funktion per Auswahl, Team, Stundensatz und personengebundene Unterlagen (Ausweis, Aufenthaltstitel, A1, Versicherung, Sonstiges).
- Projekte aus Auswahl statt Freitext. Gemeinsame Einteilungs-IDs vorbereitet, aber aktueller Lese-API fehlt Katalog. Bis dessen Anschluss Aufmaß-Auswahl deutlich als vorläufig markiert.
- Alle Stundenzettel: eigenständige PDF je Firma/Projekt/Woche, gemeinsam als ZIP; keine zusammengefügte Sammel-PDF. Eindeutige Dateinamen mit laufender Nummer. Keine Kundenerlöse in externen Stundenzetteln.

47 automatisierte Tests bestanden; ZIP mit zwei separaten, ladbaren PDFs via unzip geprüft. Rechnungsstempel und Auszahlungsprotokoll offline gerendert und visuell geprüft, inklusive leerer Folgeseite und dichter erster Seite. Browser-Upload weiterhin nicht Ende-zu-Ende geprüft.

## Aktualisierung v10

Neue OpenAPI mit /api/catalog, /api/plan und /api/aufmass geprüft. /api/catalog liefert die Original-Projekt-IDs der Einteilung; 13 Projekte (12 aktiv) lesend übernommen. Neue Projektvereinbarungen wählen aus diesem Katalog und speichern dessen Projekt-ID. Datierter Snapshot, kein laufender Abruf. read-proxy.mjs unterstützt für den späteren Servereinbau zusätzlich /source/catalog. Frühere Hinweise auf den noch fehlenden Projektkatalog sind damit ersetzt.

## Bonusnotiz v11

Bonus/Abzug erhält eine optionale, maximal 2.000 Zeichen lange Notiz. Sie bleibt je Firma/Projekt/Woche gespeichert, ist beim erneuten Bearbeiten vorbelegt und erscheint in der Wochenübersicht und auf dem Stundenzettel. Löschen des Bonus/Abzugs entfernt auch die Notiz. Bestehende ältere reason-Felder bleiben sichtbar. Keine Pflichtangabe, keine Änderung der Stunden-/Kostenberechnung.
