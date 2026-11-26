import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryD1 } from './d1.ts';
import { flows } from '../src/worker/flows.ts';

const lohn = memoryD1('CREATE TABLE months (month TEXT PRIMARY KEY, status TEXT NOT NULL, snapshot TEXT);');
const rows = [
  { resourceId: 'a', paySummary: { actual: { gross: 300000 } } },
  { resourceId: 'b', paySummary: { actual: { gross: 250000 } } },
  { resourceId: 'sub', sub: true, paySummary: { actual: { gross: 999999 } } },
  { resourceId: 'c' },
];
lohn.raw.prepare('INSERT INTO months VALUES (?,?,?)').run('2026-10', 'freigegeben', JSON.stringify({ result: { rows } }));
lohn.raw.prepare('INSERT INTO months VALUES (?,?,?)').run('2026-11', 'offen', null);

const nuState = {
  companies: [{ id: 'c1', name: 'Firma Eins' }, { id: 'c2', name: 'Firma Zwei' }],
  invoiceReviews: {
    a: { companyId: 'c1', reviewed: true, netCents: 100000, paymentDate: '2026-10-20', reviewedDate: '2026-10-05' },
    b: { companyId: 'c2', reviewed: true, netCents: 50000, reviewedDate: '2026-10-28' },
    c: { companyId: 'c1', reviewed: true, netCents: 70000, paymentDate: '2026-11-03' },
    d: { companyId: 'c1', reviewed: false, netCents: 90000, reviewedDate: '2026-10-10' },
  },
};
const nu = memoryD1("CREATE TABLE state (id TEXT PRIMARY KEY, data TEXT NOT NULL);");
nu.raw.prepare('INSERT INTO state VALUES (?,?)').run('main', JSON.stringify(nuState));
const env = { LOHN_DB: lohn, NU_DB: nu } as never;

test('released payroll months give gross pay of staff only, open months give no figure', async () => {
  assert.deepEqual((await flows(env, '2026-10')).payroll, { status: 'freigegeben', grossCents: 550000, employees: 2 });
  assert.deepEqual((await flows(env, '2026-11')).payroll, { status: 'offen', grossCents: null, employees: 0 });
  assert.deepEqual((await flows(env, '2026-09')).payroll, { status: 'offen', grossCents: null, employees: 0 });
});

test('reviewed Nachunternehmer invoices are counted by payment month, unreviewed ones never', async () => {
  assert.deepEqual((await flows(env, '2026-10')).nu, { reviewedCents: 150000, invoices: 2, byCompany: [{ name: 'Firma Eins', cents: 100000 }, { name: 'Firma Zwei', cents: 50000 }] });
  assert.equal((await flows(env, '2026-11')).nu?.reviewedCents, 70000);
});

test('missing bindings or tables mean no figure, never an error', async () => {
  assert.deepEqual(await flows({} as never, '2026-10'), { month: '2026-10', payroll: null, nu: null });
  const empty = memoryD1('CREATE TABLE x (a TEXT);');
  assert.deepEqual(await flows({ LOHN_DB: empty, NU_DB: empty } as never, '2026-10'), { month: '2026-10', payroll: null, nu: null });
});
