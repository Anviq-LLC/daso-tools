import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEmployee, importRows } from '../src/employees.js';
import worker from '../src/worker.js';

test('names are trimmed, roles stay free text with a default', () => {
  assert.deepEqual(cleanEmployee({ name: '  Max   Mustermann ', role: ' Büro ' }), { id: '', name: 'Max Mustermann', role: 'Büro', email: null });
  assert.equal(cleanEmployee({ name: 'A' }).role, 'Monteur');
  assert.throws(() => cleanEmployee({ name: ' ' }));
  assert.throws(() => cleanEmployee({ name: 'A', role: 'x'.repeat(61) }));
});

test('import keeps planning ids, includes archived people and skips known ones', () => {
  const plan = [{ id: 'a', name: 'A', role: 'Monteur', archived_at: null }, { id: 'b', name: 'B', role: '', archived_at: '2026-01-01' }, { id: 'c', name: 'C', role: 'Büro', archived_at: null }];
  assert.deepEqual(importRows(plan, ['c']), [{ id: 'a', name: 'A', role: 'Monteur', archived_at: null }, { id: 'b', name: 'B', role: 'Monteur', archived_at: '2026-01-01' }]);
  assert.deepEqual(importRows(plan, ['a', 'b', 'c']), []);
});

const db = { prepare: () => ({ first: async () => null, all: async () => ({ results: [] }), bind() { return this; } }) };

test('nothing is served without a verified login', async () => {
  assert.equal((await worker.fetch(new Request('https://x/api/employees'), { DB: db })).status, 401);
  assert.equal((await worker.fetch(new Request('https://x/api/employees', { headers: { 'cf-access-jwt-assertion': 'a.b.c' } }), { DB: db, CF_ACCESS_TEAM_DOMAIN: 't', CF_ACCESS_AUD: 'a' })).status, 401);
});

test('the local identity reads, and cross-site writes are refused', async () => {
  const env = { DB: db, DEV_IDENTITY: '1' };
  assert.equal((await worker.fetch(new Request('https://x/api/employees'), env)).status, 200);
  const post = await worker.fetch(new Request('https://x/api/employees', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body: '{}' }), env);
  assert.equal(post.status, 403);
});
