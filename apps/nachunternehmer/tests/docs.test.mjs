import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, issueValidUntil, extractIssueDate, extractFreistellungEnd, parseInsurance, insuranceLine, docIsLive, prepareDoc, missingItems, requestMail } from '../dist/docs.mjs';

test('three months from the issue date, clamped at the end of a month', () => {
  assert.equal(issueValidUntil('2026-01-15'), '2026-04-15');
  assert.equal(issueValidUntil('2026-11-30'), '2027-02-28');
  assert.equal(addMonths('2026-12-31', 3), '2027-03-31');
});

test('the issue date is only taken when it is clear', () => {
  assert.equal(extractIssueDate('Unbedenklichkeitsbescheinigung\nAusgestellt am 12.03.2026\nGültig bis 31.12.2026'), '2026-03-12');
  assert.equal(extractIssueDate('Mainz, den 02.04.2026\nMit freundlichen Grüßen'), '2026-04-02');
  assert.equal(extractIssueDate('Ausgestellt am 12.03.2026 und Ausgestellt am 13.03.2026'), null);
  assert.equal(extractIssueDate('Kein Datum hier'), null);
});

test('the Freistellung end date comes from "gültig bis" or a "vom ... bis ..." range', () => {
  assert.equal(extractFreistellungEnd('Die Bescheinigung ist gültig bis zum 31.12.2027.'), '2027-12-31');
  assert.equal(extractFreistellungEnd('Gültig vom 01.01.2026 bis 31.12.2028'), '2028-12-31');
  assert.equal(extractFreistellungEnd('Ausgestellt am 01.01.2026'), null);
});

test('insurance sums in euro and subcontractor damage, "Nein" when unreadable', () => {
  const t = 'Versicherungssumme für Personenschäden 5.000.000,00 EUR, für Sachschäden 2,5 Mio. EUR. Schäden von Nachunternehmern sind mitversichert.';
  assert.deepEqual(parseInsurance(t), { personEuros: 5000000, propertyEuros: 2500000, nuCovered: true });
  assert.deepEqual(parseInsurance('Pauschale Deckungssumme für Personen- und Sachschäden: 3.000.000 €'), { personEuros: 3000000, propertyEuros: 3000000, nuCovered: false });
  assert.equal(parseInsurance('Schäden von Nachunternehmern sind nicht mitversichert.').nuCovered, false);
  assert.deepEqual(parseInsurance('nichts lesbar'), { personEuros: null, propertyEuros: null, nuCovered: false });
  assert.match(insuranceLine({ personEuros: 3000000, propertyEuros: null, nuCovered: false }), /Personenschäden 3\.000\.000 €, Sachschäden nicht lesbar, Nachunternehmerschäden nein/);
});

const docs = [
  { id: 'a', companyId: 'c1', type: 'Freistellungsbescheinigung', uploadedAt: '2026-01-01T00:00:00Z' },
  { id: 'b', companyId: 'c1', type: 'Freistellungsbescheinigung', uploadedAt: '2026-06-01T00:00:00Z' },
  { id: 'z1', companyId: 'c1', type: 'Zertifikat', uploadedAt: '2026-01-01T00:00:00Z' },
  { id: 'z2', companyId: 'c1', type: 'Zertifikat', uploadedAt: '2026-02-01T00:00:00Z' },
];
test('only the newest single-copy document is current, certificates all stay', () => {
  assert.deepEqual(docs.map((d) => docIsLive(d, docs)), [false, true, true, true]);
});

test('upload form: issue types get a computed validity, insurance values are stored, helper fields removed', () => {
  assert.match(prepareDoc({ type: 'Unbedenklichkeitsbescheinigung' }).error, /Ausstellungsdatum/);
  const u = prepareDoc({ type: 'Unbedenklichkeitsbescheinigung', issuedOn: '2026-03-12' }).doc;
  assert.deepEqual([u.issuedOn, u.validUntil], ['2026-03-12', '2026-06-12']);
  const h = prepareDoc({ type: 'Betriebshaftpflicht', issuedOn: '2026-03-12', personEuros: '3000000', propertyEuros: '', nuCovered: '' }).doc;
  assert.deepEqual(h.insurance, { personEuros: 3000000, propertyEuros: null, nuCovered: false });
  assert.equal('personEuros' in h, false);
  assert.equal(prepareDoc({ type: 'Zertifikat', title: ' Schweißer ' }).doc.title, 'Schweißer');
});

const state = {
  companies: [{ id: 'c1', name: 'Firma', country: 'DE', email: 'info@firma.example' }],
  workers: [{ id: 'w1', companyId: 'c1', name: 'Jan Kowalski' }, { id: 'w2', companyId: 'c1', name: 'Anna Nowak' }, { id: 'w3', companyId: 'c1', name: 'Alt', archived: true }],
  docs: [
    { id: 'd1', companyId: 'c1', type: 'Gewerbeanmeldung', validUntil: '' },
    { id: 'd2', companyId: 'c1', type: 'Freistellungsbescheinigung', validUntil: '2026-01-01', uploadedAt: '2025-01-01' },
    { id: 'd3', companyId: 'c1', workerId: 'w1', type: 'Ausweis' },
    { id: 'd4', companyId: 'c1', workerId: 'w2', type: 'Sozialmeldebescheinigung' },
  ],
};
test('missing papers: expired company papers, missing ID, A1 or its alternative', () => {
  const items = missingItems(state, 'c1', '2026-11-26');
  assert.deepEqual(items.map((i) => i.key), ['c:Betriebshaftpflicht', 'c:Unbedenklichkeitsbescheinigung', 'c:Freistellungsbescheinigung', 'w:w1:a1', 'w:w2:ausweis']);
  assert.match(items[2].label, /abgelaufen am 01\.01\.2026/);
});

test('the request mail lists exactly the chosen items', () => {
  const url = requestMail(state.companies[0], [{ label: 'Ausweis von Anna Nowak' }]);
  assert.match(url, /^mailto:info@firma\.example\?subject=/);
  assert.match(decodeURIComponent(url), /- Ausweis von Anna Nowak/);
});
