import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadState, saveState } from '../src/state.js';
import { directory } from '../src/directory.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_state.sql', import.meta.url), 'utf8'));
  return {
    prepare: (sql) => ({
      bind: (...a) => ({
        run: async () => ({ meta: { changes: db.prepare(sql).run(...a).changes } }),
        first: async () => db.prepare(sql).get(...a) ?? null,
      }),
      first: async () => db.prepare(sql).get() ?? null,
    }),
  };
}

test('first write needs the initial token, stale tokens are rejected', async () => {
  const db = d1();
  assert.equal((await loadState(db)).token, 'initial');
  const a = await saveState(db, '{"v":1}', 'initial', 'a@x');
  assert.equal(a.status, 200);
  assert.equal((await saveState(db, '{"v":2}', 'initial', 'b@x')).status, 409);
  const b = await saveState(db, '{"v":3}', a.token, 'a@x');
  assert.equal(b.status, 200);
  assert.deepEqual((await loadState(db)).state, { v: 3 });
  assert.equal((await saveState(db, '{"v":4}', a.token, 'a@x')).status, 409);
});

test('directory exposes only master data', () => {
  const out = directory({
    companies: [{ id: 'c1', name: 'Firma', rating: 9, docs: 1 }],
    teams: [{ id: 't1', companyId: 'c1', name: 'Team 1' }],
    workers: [{ id: 'w1', companyId: 'c1', teamId: 't1', name: 'Jan Kowalski', passport: 'X' }],
    projectAgreements: [{ id: 'a1', companyId: 'c1', project: 'P', fitterRateCents: 4000 }],
  });
  assert.deepEqual(out.workers[0], { id: 'w1', companyId: 'c1', teamId: 't1', name: 'Jan Kowalski', role: '', archived: false });
  assert.equal(out.agreements[0].foremanRateCents, null);
  assert.ok(!JSON.stringify(out).includes('passport'));
});
