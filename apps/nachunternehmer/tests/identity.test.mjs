import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMrz, parseLabels, nameKey, findMatches } from '../dist/identity.mjs';

// ICAO 9303 specimen data
const TD1 = 'I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<';
const TD3 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';

test('TD1 ID card MRZ is parsed and check digits verify', () => {
  const r = parseMrz('noise\n' + TD1);
  assert.deepEqual([r.name, r.birth, r.validUntil, r.docNo, r.verified], ['ANNA MARIA ERIKSSON', '1974-08-12', '2012-04-15', 'D23145890', true]);
});

test('TD3 passport MRZ is parsed', () => {
  const r = parseMrz(TD3);
  assert.deepEqual([r.name, r.docNo, r.verified], ['ANNA MARIA ERIKSSON', 'L898902C3', true]);
});

test('OCR digit confusion is corrected, a wrong digit is flagged', () => {
  const noisy = TD1.replace('7408122F', '74O8122F');
  assert.equal(parseMrz(noisy).verified, true);
  assert.equal(parseMrz(TD1.replace('D231458907', 'D231458900')).verified, false);
});

test('printed labels give name and birth date', () => {
  const r = parseLabels('Nazwisko: Kowalski\nImiona: Jan Piotr\nData urodzenia: 03.05.1985');
  assert.deepEqual([r.name, r.birth], ['Jan Piotr Kowalski', '1985-05-03']);
  assert.equal(parseLabels('nothing here'), null);
});

test('German bilingual ID layout with values on the next line', () => {
  const r = parseLabels('Name / Surname\nMUSTERMANN\nVornamen / Given names\nERIKA\nGeburtsdatum / Date of birth\n12.08.1964');
  assert.deepEqual([r.name, r.birth], ['ERIKA MUSTERMANN', '1964-08-12']);
  const spaced = parseLabels('Name / Surname\n\nGRÜNEWALD\n\nVornamen / Given names\n\nJÜRGEN\n\nGeburtsdatum\n\n12.08.1964');
  assert.deepEqual([spaced.name, spaced.birth], ['JÜRGEN GRÜNEWALD', '1964-08-12']);
});

test('name keys ignore order, case and Polish letters', () => {
  assert.equal(nameKey('Łukasz Wójcik'), nameKey('WOJCIK lukasz'));
});

test('duplicates are found across companies', () => {
  const state = {
    companies: [{ id: 'a', name: 'Firma A' }, { id: 'b', name: 'Firma B' }],
    workers: [
      { id: '1', companyId: 'a', name: 'Łukasz Wójcik', identity: { docNo: 'ABC 123456', birth: '1990-01-01' } },
      { id: '2', companyId: 'a', name: 'Jan Nowak' },
      { id: '3', companyId: 'a', name: 'Anna Lis', identity: { birth: '1980-02-02' } },
    ],
  };
  const byDoc = findMatches(state, { id: 'x', companyId: 'b', name: 'Lukasz Wojcik', identity: { docNo: 'abc123456' } });
  assert.deepEqual(byDoc.map((m) => [m.company, m.level]), [['Firma A', 'sicher']]);
  assert.equal(findMatches(state, { id: 'y', companyId: 'b', name: 'Nowak Jan' })[0].level, 'name');
  assert.equal(findMatches(state, { id: 'z', companyId: 'b', name: 'Anna Lis', identity: { birth: '1999-09-09' } }).length, 0);
});
