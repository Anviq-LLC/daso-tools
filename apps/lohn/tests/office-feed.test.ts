import assert from 'node:assert/strict';
import { test } from 'node:test';
import { officeRows } from '../src/worker/office-feed.ts';
import { computeDay } from '../src/import/plan.ts';

const rows: Record<string, unknown[]> = {
  absences: [
    { employee_id: 'anna', day: '2026-11-03', type: 'vacation' },
    { employee_id: 'anna', day: '2026-11-04', type: 'other' },
    { employee_id: 'max', day: '2026-11-03', type: 'sick' },
  ],
  punches: [
    { employee_id: 'anna', started: '2026-11-02T07:00:00.000Z', ended: '2026-11-02T15:30:00.000Z', pause: 30 },
    { employee_id: 'max', started: '2026-11-02T07:00:00.000Z', ended: '2026-11-02T15:00:00.000Z', pause: null },
  ],
};
const db = { prepare: (sql: string) => ({ bind: () => ({ all: async () => ({ results: sql.includes('FROM absences') ? rows.absences : rows.punches }) }) }) } as unknown as D1Database;
const people = [{ id: 'anna', role: 'Büro' }, { id: 'max', role: 'Monteur' }];
const range = { from: '2026-11-01', to: '2026-11-30' };

test('only office staff reach payroll, with the same row shapes as the planning', async () => {
  const out = await officeRows(db, people, range, { from: '2026-10-30', to: '2026-12-03' });
  assert.deepEqual(out.assignments, [{ resource_id: 'anna', project_id: null, day: '2026-11-03', assignment_type: 'vacation' }]);
  assert.deepEqual(out.punches, [{ resource_id: 'anna', project_id: null, started: '2026-11-02T07:00:00.000Z', ended: '2026-11-02T15:30:00.000Z', pause: 30 }]);
});

test('without the binding, the tables or office staff there is simply no office data', async () => {
  assert.deepEqual(await officeRows(undefined, people, range), { assignments: [], punches: [] });
  assert.deepEqual(await officeRows(db, [{ id: 'max', role: 'Monteur' }], range), { assignments: [], punches: [] });
  const broken = { prepare: () => { throw new Error('no such table'); } } as unknown as D1Database;
  assert.deepEqual(await officeRows(broken, people, range), { assignments: [], punches: [] });
});

test('stamped office hours and an approved vacation are counted by the existing day calculation', async () => {
  const out = await officeRows(db, people, range, { from: '2026-10-30', to: '2026-12-03' });
  const worked = computeDay('anna', '2026-11-02', out.assignments, out.punches, [], new Set(), undefined, true);
  assert.equal(worked.workMinutes, 8 * 60, 'stamped 8.5 h minus a 30 minute pause');
  const away = computeDay('anna', '2026-11-03', out.assignments, out.punches, [], new Set(), undefined, true);
  assert.equal(away.type, 'vacation');
  assert.equal(away.absent, true);
});
