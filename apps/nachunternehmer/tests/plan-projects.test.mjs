import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { normalizeProjectCatalog } from '../dist/project-catalog.mjs';

const plan = { prepare: () => ({ all: async () => ({ results: [{ id: 'p1', name: 'Büro Dürrholz', project_number: '2026-01', address: 'Weg 1', archived_at: null }, { id: 'p2', name: 'Alt', project_number: '', address: '', archived_at: '2025-01-01' }] }) }) };

test('projects are served live from the planning, in the shape the catalog expects', async () => {
  const res = await worker.fetch(new Request('https://x/api/plan-projects'), { DEV_IDENTITY: '1', PLAN: plan });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.source, 'montageplanung');
  const catalog = normalizeProjectCatalog(data.projects);
  assert.deepEqual(catalog.map((p) => [p.id, p.label, p.archived]), [['p1', '2026-01 Büro Dürrholz', false], ['p2', 'Alt', true]]);
});

test('without a login or the planning database there are no projects, and nothing is guessed', async () => {
  assert.equal((await worker.fetch(new Request('https://x/api/plan-projects'), { PLAN: plan })).status, 401);
  const none = await (await worker.fetch(new Request('https://x/api/plan-projects'), { DEV_IDENTITY: '1' })).json();
  assert.deepEqual(none.projects, []);
});
