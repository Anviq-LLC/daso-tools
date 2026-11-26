import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContract } from '../dist/contract-import.mjs';
import { pickAgreement } from '../dist/contracts.mjs';

// Shape of an OCR'd hourly contract: no labels, scan noise, dates that must not be mixed up.
const hourly = `Seite 1 von 8
Nachunternehmer-Werkvertrag
( auf Stundenlohnbasis )
zwischen
der Firma
Muster Bau GmbH
Geschäftsführer: Erika Beispiel
Hauptstr. 1
12345 Beispielstadt
- nachfolgend AN genannt -
und
der Firma
Muster NU
Max Mustermann
Musterweg 4
54321 Musterdorf
- nachfolgend NU genannt —-
wird nachfolgender Nachunternehmer-Werkvertrag geschlossen:
Seite 2 von 8
S 1 Grundlagen des Vertrages
Die Vergütung erfolgt auf
Stundenlohnbasis + Projektbeteiligung vom Monatsgewinn 10,00 %.
Der AN und die NU vereinbaren folgende Vergütung:
40,00 £ pro Stunde Ab dem Zeitpunkt Haustüre zur Baustelle.
Sollte die NU allein arbeiten (1 Monteur): 75% für die NU und 25% für den AN.
Sollte die NU zu zweit oder mehr für den AN arbeiten: 80% für die NU und 20% für den
AN.
Seite 4 von 8
Bauvorhaben: __nach Absprache__
Damit der Vertrag verlängert werden kann sollten die Vertragsparteien sich bis zum
31.10.2025 zusammenfinden, um diesen zu beschließen.
Dieser Vertrag ist befristet bis zum 31.12.2025.
Die Zahlungen erfolgen bargeldlos von dem AN an die NU innerhalb von 7 Tagen 2%
Skonto, 21 Tagen netto nach Eingang der jeweiligen Rechnung.
Ein Sicherheitseinbehalt laut VOB/B erfolgt nicht.
Sollten die Unterlagen nicht vorliegen, so werden 20,00 % der Abschlagsrechnung einbehalten.`;

test('Stundenlohnvertrag als Scan: Konditionen, Satz und Vertragsende', () => {
  const r = parseContract(hourly);
  assert.equal(r.company.name, 'Muster NU');
  assert.equal(r.company.owner, 'Max Mustermann');
  assert.equal(r.company.address, 'Musterweg 4\n54321 Musterdorf');
  assert.deepEqual(r.terms, {
    netDays: 21, discountDays: 7, discountPercent: 2,
    retentionPercent: 0, contractUntil: '2025-12-31',
    termsNote: 'Projektbeteiligung 10 % vom Gewinn. Aufteilung bei eigenen Monteuren (NU/AN): 75/25, 80/20 %.',
  });
  assert.deepEqual(r.options, [{ foremanRate: 40 }]);
});

test('Skonto mit und ohne "mit", Inhaberzeile mit Beschriftung', () => {
  const r = parseContract(`der Firma
Beispiel Montage
Inhaber: Anna Test
Weg 2
11111 Ort
- nachfolgend NU genannt -
Rechnungsstellung und Zahlungen
14 Tage mit 3 % Skonto, 30 Tage netto.
§ 5`);
  assert.equal(r.company.owner, 'Anna Test');
  assert.equal(r.company.address, 'Weg 2\n11111 Ort');
  assert.deepEqual(r.terms, { netDays: 30, discountDays: 14, discountPercent: 3 });
});

test('Ohne erkennbare Daten bleibt das Ergebnis leer', () => {
  const r = parseContract('Seite 1 von 1\nirgendein Text');
  assert.deepEqual(r, { company: {}, terms: {}, options: [{}] });
});

test('Projektvereinbarung geht vor Standardsatz, Standardsatz greift sonst', () => {
  const list = [
    { id: 'a', companyId: 'c1', project: 'Alle Projekte (Standardsatz)', allProjects: true },
    { id: 'b', companyId: 'c1', project: 'Schule', projectId: 'p1' },
    { id: 'c', companyId: 'c2', project: 'Schule', projectId: 'p1' },
  ];
  assert.equal(pickAgreement(list, 'c1', 'p1', 'Schule').id, 'b');
  assert.equal(pickAgreement(list, 'c1', undefined, 'Schule').id, 'b');
  assert.equal(pickAgreement(list, 'c1', 'p9', 'Rathaus').id, 'a');
  assert.equal(pickAgreement(list, 'c2', 'p9', 'Rathaus'), undefined);
  assert.equal(pickAgreement(list.slice(1), 'c1', 'p9', 'Rathaus'), undefined);
});

test('Stundensatz mit und ohne gelesenes Eurozeichen', () => {
  assert.deepEqual(parseContract('45,00 € pro Stunde').options, [{ foremanRate: 45 }]);
  assert.deepEqual(parseContract('1.250,50 EUR pro Stunde').options, [{ foremanRate: 1250.5 }]);
  assert.deepEqual(parseContract('45,00 pro Stunde').options, [{ foremanRate: 45 }]);
});
