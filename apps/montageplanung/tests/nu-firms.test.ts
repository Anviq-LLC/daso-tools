import test from 'node:test';
import assert from 'node:assert/strict';
import { nuFirmName, contractorRenames } from '../lib/nu-firms';

const firms = [
  { name: 'Aquavent Sp. z o.o. - Marcin von Lukasz', aliases: ['Marcin - Lukasz'] },
  { name: 'Rafal', aliases: [] },
];

test('a contractor name resolves to the nachunternehmer spelling', () => {
  assert.equal(nuFirmName(firms, 'Rafal'), 'Rafal');
  assert.equal(nuFirmName(firms, '  rafal '), 'Rafal');
  assert.equal(nuFirmName(firms, 'Marcin - Lukasz'), 'Aquavent Sp. z o.o. - Marcin von Lukasz');
  assert.equal(nuFirmName(firms, 'marcin  -  lukasz'), 'Aquavent Sp. z o.o. - Marcin von Lukasz');
});

test('names that no firm has are refused', () => {
  assert.equal(nuFirmName(firms, 'Vasili'), null);
  assert.equal(nuFirmName([], 'Rafal'), null);
  assert.equal(nuFirmName(firms, ''), null);
});

test('an old firm spelling is renamed to the nachunternehmer name, never onto an existing one', () => {
  const firms = [{ name: 'Kompanets', aliases: ['Kompanets GmbH'] }, { name: 'Alpha', aliases: ['Alpha Bau'] }]
  const rows = [{ id: '1', name: 'Kompanets GmbH' }, { id: '2', name: 'Alpha' }, { id: '3', name: 'Alpha Bau' }, { id: '4', name: 'Fremd' }]
  assert.deepEqual(contractorRenames(rows, firms), [{ id: '1', name: 'Kompanets' }])
})
