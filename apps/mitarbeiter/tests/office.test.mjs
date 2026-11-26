import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { as, accessBindings } from './access.mjs';
import { cleanVacation, cleanAbsence, cleanPause, workdays } from '../src/office.js';

test('office rules: days, pauses and vacation requests are validated', () => {
  assert.deepEqual(workdays('2026-11-06', '2026-11-10'), ['2026-11-06', '2026-11-09', '2026-11-10']);
  assert.throws(() => cleanAbsence({ day: '2026-11-02', type: 'other', label: ' ' }, ['other']));
  assert.throws(() => cleanAbsence({ day: '2026-11-02', type: 'vacation' }, ['sick']));
  assert.deepEqual(cleanAbsence({ day: '2026-11-02', type: 'other', label: ' Seminar ' }, ['other']), { day: '2026-11-02', type: 'other', label: 'Seminar' });
  assert.equal(cleanAbsence({ day: '2026-11-02', type: 'sick', label: 'x' }, ['sick']).label, '');
  assert.equal(cleanPause(30, '2026-11-02T08:00:00Z', '2026-11-02T16:00:00Z'), 30);
  assert.throws(() => cleanPause(600, '2026-11-02T08:00:00Z', '2026-11-02T16:00:00Z'));
  assert.throws(() => cleanVacation({ start: '2026-01-05', end: '2026-01-06' }, '2026-11-26', false));
  assert.throws(() => cleanVacation({ start: '2026-12-05', end: '2026-12-06' }, '2026-11-26', false), 'a weekend has no workday');
  assert.throws(() => cleanVacation({ start: '2026-12-07', end: '2026-12-08' }, '2026-11-26', true));
});

const root = fileURLToPath(new URL('..', import.meta.url));
const modules = await Promise.all(['worker', 'auth', 'employees', 'office'].map(async (n) => ({ type: 'ESModule', path: `src/${n}.js`, contents: await readFile(`${root}src/${n}.js`, 'utf8') })));
const mf = new Miniflare({
  modules,
  compatibilityDate: '2026-05-15',
  bindings: { ...accessBindings, MA_ALLOWED_EMAILS: 'boss@example.test' },
  d1Databases: ['DB', 'PLAN'],
});
const db = await mf.getD1Database('DB');
for (const f of (await readdir(root + 'migrations')).sort()) {
  for (const s of (await readFile(root + 'migrations/' + f, 'utf8')).split(';')) if (s.trim()) await db.prepare(s.trim()).run();
}
const ins = (id, name, role, email) => db.prepare('INSERT INTO employees (id, name, role, email, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, name, role, email, 'x').run();
await ins('anna', 'Anna Büro', 'Büro', 'anna@example.test');
await ins('berta', 'Berta Büro', 'Büro', 'berta@example.test');
await ins('max', 'Max Monteur', 'Monteur', 'max@example.test');

const call = async (who, method, path, body) => {
  const res = await mf.dispatchFetch('http://t' + path, { method, headers: { ...(who ? await as(who) : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const nextMonday = () => { let n = 1; while (new Date(day(n)).getUTCDay() !== 1) n++; return day(n); };

test('only verified logins with an employee record or admin rights get in', async () => {
  assert.equal((await mf.dispatchFetch('http://t/api/me')).status, 401);
  assert.equal((await call('stranger@example.test', 'GET', '/api/me')).status, 403);
  assert.equal((await call('anna@example.test', 'GET', '/api/me')).body.me.office, true);
});

test('office staff cannot reach master data, the switch or approvals', async () => {
  for (const [m, p, b] of [['GET', '/api/employees'], ['POST', '/api/master', { on: true }], ['POST', '/api/employees', { name: 'X' }], ['POST', '/api/import', {}], ['POST', '/api/vacation/decide', { id: 'x', approve: true }]])
    assert.equal((await call('anna@example.test', m, p, b)).status, 403, p);
  assert.equal((await call('boss@example.test', 'GET', '/api/employees')).status, 200);
});

test('field staff cannot use the office features', async () => {
  for (const [m, p] of [['POST', '/api/punch/in'], ['GET', '/api/calendar?month=2026-11'], ['GET', '/api/vacation']])
    assert.equal((await call('max@example.test', m, p, m === 'GET' ? undefined : {})).status, 403, p);
});

test('stamping: one open entry, server times, pause limited to the shift, report saved', async () => {
  assert.equal((await call('anna@example.test', 'POST', '/api/punch/in', {})).status, 200);
  assert.equal((await call('anna@example.test', 'POST', '/api/punch/in', {})).status, 409);
  assert.equal((await call('anna@example.test', 'POST', '/api/punch/out', { pause: 600, report: 'x' })).status, 400);
  assert.equal((await call('anna@example.test', 'POST', '/api/punch/out', { pause: 0, report: 'Rechnungen geprüft' })).status, 200);
  const month = new Date().toISOString().slice(0, 7);
  const mine = (await call('anna@example.test', 'GET', '/api/punches?month=' + month)).body.punches;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].report, 'Rechnungen geprüft');
  assert.equal((await call('berta@example.test', 'GET', '/api/punches?month=' + month + '&employeeId=anna')).body.punches.length, 0, 'colleagues see only their own entries');
  assert.equal((await call('anna@example.test', 'POST', '/api/punch/edit', { id: mine[0].id, started: mine[0].started, ended: mine[0].ended })).status, 403);
});

test('absences: self-service types only, free labels, colleagues see "away" without a reason', async () => {
  const d = nextMonday();
  assert.equal((await call('anna@example.test', 'POST', '/api/absence', { day: d, type: 'other', label: 'Seminar' })).status, 200);
  assert.equal((await call('anna@example.test', 'POST', '/api/absence', { day: d, type: 'vacation' })).status, 400);
  assert.equal((await call('anna@example.test', 'POST', '/api/absence', { employeeId: 'berta', day: day(20), type: 'sick' })).status, 200);
  const cal = (await call('berta@example.test', 'GET', '/api/calendar?month=' + d.slice(0, 7))).body;
  assert.deepEqual(cal.days.anna[d], { type: 'away', label: '' });
  assert.equal(cal.days.berta?.[day(20)], undefined, 'the employeeId of a self user is ignored');
  assert.deepEqual((await call('anna@example.test', 'GET', '/api/calendar?month=' + d.slice(0, 7))).body.days.anna[d], { type: 'other', label: 'Seminar' });
  assert.equal((await call('boss@example.test', 'POST', '/api/absence', { employeeId: 'berta', day: d, type: 'unpaid' })).status, 200);
  assert.equal((await call('berta@example.test', 'POST', '/api/absence/delete', { day: d })).status, 403, 'unpaid leave is set by a planner');
});

test('vacation: requested by the employee, approved by an admin, becomes absences on workdays only', async () => {
  const mon = nextMonday(), start = new Date(Date.parse(mon) + 14 * 86400000).toISOString().slice(0, 10), end = new Date(Date.parse(start) + 6 * 86400000).toISOString().slice(0, 10);
  assert.equal((await call('anna@example.test', 'POST', '/api/vacation/request', { start, end })).status, 200);
  assert.equal((await call('anna@example.test', 'POST', '/api/vacation/request', { start, end })).status, 400, 'overlap');
  const req = (await call('boss@example.test', 'GET', '/api/vacation')).body.requests.find((r) => r.start_day === start);
  assert.equal((await call('anna@example.test', 'POST', '/api/vacation/decide', { id: req.id, approve: true })).status, 403);
  assert.equal((await call('boss@example.test', 'POST', '/api/vacation/decide', { id: req.id, approve: true })).status, 200);
  assert.equal((await call('boss@example.test', 'POST', '/api/vacation/decide', { id: req.id, approve: true })).status, 409);
  const rows = (await db.prepare("SELECT day FROM absences WHERE employee_id = 'anna' AND type = 'vacation' ORDER BY day").all()).results.map((r) => r.day);
  assert.deepEqual(rows, workdays(start, end));
  assert.equal((await call('anna@example.test', 'POST', '/api/absence/delete', { day: start })).status, 403);
});

test.after(() => mf.dispose());
