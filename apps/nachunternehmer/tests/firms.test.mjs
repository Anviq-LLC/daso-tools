import test from 'node:test';
import assert from 'node:assert/strict';
import { companyForFirm, parseAliases } from '../dist/firms.mjs';
import { directory } from '../src/directory.js';

const companies = [
  { id: 'a', name: 'Aquavent Sp. z o.o. - Marcin von Lukasz', aliases: ['Marcin - Lukasz', 'Marcin - Lukasz Deutsche Firma'] },
  { id: 'b', name: 'Rafal' },
];

test('a firm matches by name or by another spelling, ignoring case and spacing', () => {
  assert.equal(companyForFirm(companies, 'Rafal').id, 'b');
  assert.equal(companyForFirm(companies, '  rafal ').id, 'b');
  assert.equal(companyForFirm(companies, 'Marcin - Lukasz').id, 'a');
  assert.equal(companyForFirm(companies, 'marcin  -  lukasz deutsche firma').id, 'a');
  assert.equal(companyForFirm(companies, 'Aquavent Sp. z o.o. - Marcin von Lukasz').id, 'a');
  assert.equal(companyForFirm(companies, 'Unbekannt'), undefined);
  assert.equal(companyForFirm([], 'Rafal'), undefined);
});

test('Oleksii Kompanets spellings still collapse to one firm', () => {
  const list = [{ id: 'k', name: 'Oleksii Kompanets' }];
  assert.equal(companyForFirm(list, 'Oleksii Kompanets').id, 'k');
});

test('aliases are split by line, trimmed and unique', () => {
  assert.deepEqual(parseAliases(' Marcin - Lukasz \n\nMarcin - Lukasz\nRafal; Rafal K.'), ['Marcin - Lukasz', 'Rafal', 'Rafal K.']);
  assert.deepEqual(parseAliases(undefined), []);
  assert.equal(parseAliases(Array.from({ length: 40 }, (_, i) => 'Firma ' + i).join('\n')).length, 20);
});

test('directory exposes the switch and the aliases', () => {
  const out = directory({ settings: { nuMaster: true }, companies: [{ id: 'a', name: 'A', aliases: ['A alt'], archived: true, owner: 'Geheim' }] });
  assert.equal(out.nuMaster, true);
  assert.deepEqual(out.companies[0], { id: 'a', name: 'A', aliases: ['A alt'], archived: true });
  assert.equal(directory({}).nuMaster, false);
  assert.ok(!JSON.stringify(out).includes('Geheim'));
});
