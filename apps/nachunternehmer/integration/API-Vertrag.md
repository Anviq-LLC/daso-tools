# Nachunternehmertool · Integration v5

## Aufmaßdaten

GET `/api/sub-teams?month=YYYY-MM` ist freigeschaltet und am 17.11.2026 erfolgreich ausschließlich lesend abgerufen. Felder und konkreter Einbau: **Aufmass-Anbindung.md**. Keine zusätzliche API-Erweiterung nötig. Keine Änderungen bestehender Tools oder der Quelldatenbank.

Wochenansicht übernimmt ausschließlich Nachunternehmer, Teams, Stunden, Tagesumsätze und Kosten aus dieser Antwort. Keine Mitarbeiterzuordnung oder erneute Eingabe. Die Mitarbeiterpflege mit Bewertungen/Unterlagen ist optional. Nur bestätigte Varianten von Oleksii Kompanets vereinigen, unterschiedliche Teams erhalten. Keine eigene Leistung, Projektbeteiligung, Planungs-/Stempelverbindung oder Alex-Sonderabrechnung importieren.

Schlüssel nur serverseitig als Secret; `read-proxy.mjs` enthält einen gesperrten Beispielhandler zur Integration hinter bestehender Authentifizierung. Statische Vorschau verwendet den datierten Abruf aus `aufmass-nu.json`; keine automatische laufende Hintergrundsynchronisation. Frische Monatsantworten müssen den jeweiligen Quellbestand ersetzen, nie addieren. Keine Daten aus Köpfen oder Kosten hochrechnen, fehlende Werte nicht als 0 behandeln. Geschätzte Werte anzeigen, aber nicht als exakte Stunden bestätigen.

## Wochenabschluss und Rechnung

1. Mo–So mit Datum, Teamstunden, Tagesumsatz/-kosten anzeigen.
2. Vollständigkeit von Stunden und Umsatz je Projekt/Firma/KW bestätigen; Name und Quellstand speichern. Bei Quelländerung erneut prüfen.
3. Stundenzettel einzeln oder gesammelt für abgeschlossene Wochen erzeugen. Er enthält Stunden und Kosten, keine Kundenumsätze.
4. PDF, ZUGFeRD-PDF mit eingebetteter CII-XML oder separate UBL-/CII-XML auslesen: Rechnungsnummer, Netto, Brutto und offener Zahlbetrag. Original unverändert behalten. Kein Zahlenabtippen bei eindeutig lesbaren Daten. Scans ohne Text benötigen derzeit Ergänzung/OCR außerhalb des Prototyps. Kein vollständiger Konformitätsvalidator.
5. Stimmt Netto mit Wochenabrechnung überein, keine Differenzmeldung. Abweichung anzeigen. Begründete Sollkorrektur mit Prüfer speichern, ohne Quellstunden/-kosten zu verändern. Bonus/Abzug separat mit Stunden, Satz, Grund und Namen des Obermonteurs erfassen.
6. Optional 5 % Einbehalt und Skonto gemäß Firmen-Projektvertrag anwenden. Basis/Reihenfolge explizit; offener Rechnungsbetrag bei Vorauszahlung getrennt von Brutto.
7. „Rechnung für Zahlung bereitstellen“ speichert die Prüfung und lädt eine PDF-Prüfkopie herunter. Stempel: Prüfername, Zahlungsdatum/Status, Sicherheitseinbehalt dieser Rechnung und kumuliert pro Projekt/Firma, Skonto, Auszahlungsbetrag. Freie Stempelfläche suchen oder Prüfseite anhängen. XML bekommt eine PDF-Lesefassung mit eingebettetem Original. Keine Zahlungsauslösung oder Buchung.

## Zentrale Datenhaltung

Neue Tool-Daten (Firmen, Unterlagen, Profile, Verträge, Wochenprüfungen, Korrekturen, Rechnungsprüfungen) separat von der Quelle speichern. Prototyp: Browser-localStorage/IndexedDB. Für Einbettung: zentrale Rechteprüfung, versionierte Rechnungs-/Quellstände und geschützte Dateispeicherung implementieren. Keine Materialkosten pauschal ansetzen. `schema.sql` ist nur ein Vorschlag für separate neue Datenhaltung, keine Produktionsmigration.


## Verbindliche Anpassung v6

Keine Pflichtreihenfolge und keine Datensperre: Woche manuell abschließen auch bei fehlenden/geschätzten Werten; Stundenzettel sowie Rechnungseinlesung/Prüfung/PDF-Zahlungsbereitstellung sind unabhängig davon möglich. Offene Sollkosten verhindern die Rechnungsprüfung nicht; Stempel zeigt Soll offen statt 0.

Wochenwerte lokal bearbeiten (Teams, Tagesstunden, Umsatz, Kosten), Quelle unverändert erhalten. Lokale Änderungen als Überlagerung mit Originalvergleich, Rücksetzen auf Quelle möglich. Bonus/Abzug exakt zwei Felder Monteur ± Stunden und Obermonteur ± Stunden, automatische Projektsätze und Neuberechnung; keine weiteren Pflichtfelder. Frühere Vorgaben zu Sperren und Pflichtbegründung im Bonusdialog sind ersetzt.


## Rechnungsskonto v8

Rechnungsskonto unabhängig von Projektvereinbarung aktivieren und den Prozentsatz bei der Rechnung frei eingeben. Projektprozent nur vorbelegen, Änderung ausschließlich rechnungsbezogen speichern. Keine Änderung an Projektkonditionen. Rechnungssatz wird für Skontobetrag, Auszahlung und PDF-Stempel verwendet. Eingabe >0 und <100, höchstens zwei Dezimalstellen, deaktiviert = 0. Im Browser ohne Projektvertrag geprüft: 700 Euro mit manuell 3 Prozent ergibt 21 Euro Skonto und 679 Euro Zahlung.

## v9 ersetzt frühere abweichende Vorgaben
Siehe README: Netto-only, Einbehalt vor Skonto; Stempel erste Seite; Rollenstunden mit automatisch berechneten Kosten und festem Umsatz; Einbehaltsauszahlungen separat auditieren. Einteilungs-Projektkatalog fehlt noch, vorbereiteter Vertrag in Projektstamm.md. Sammelstundenzettel werden als ZIP eigenständiger PDFs ausgegeben.
