import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonth, DEFAULT_SETTINGS, type Terms } from '../src/calc/month.ts';
import { computeDay, daysOfMonth, dow } from '../src/import/plan.ts';
import { toCsv } from '../src/worker/export.ts';
import { de, deEur, sortCodes, LABELS } from '../src/calc/labels.ts';
import { progressiveBonus, saturdayBonus, toolInstallment, hoursPay } from '../src/calc/bonus.ts';
import { weekdaysInMonth } from '../src/calc/time.ts';

const terms: Terms = { name: 'Test Person', lohngruppe: 4, surchargeCents: 0, foreman: false, foremanCostCents: null, fixedSalaryCents: null, bonus: true, saturday: true };
const base = (over: object = {}) => ({
  month: '2027-02', settings: { ...DEFAULT_SETTINGS, holidays: ['2027-01-01'] }, terms: { r1: terms }, days: {}, revenue: [], nu: [],
  foremanMinutes: {}, otherNuCosts: {}, adjustments: [], tools: {}, carryIn: {}, ...over,
});
const punch = (a: string, b: string, pause = 0) => ({ resource_id: 'r1', project_id: 'p', started: a, ended: b, pause });

test('Sunday work earns 100 % surcharge, holiday work 150 %', () => {
  const sun = computeDay('r1', '2027-02-07', [], [punch('2027-02-07T07:00:00Z', '2027-02-07T15:00:00Z')], [], new Set());
  assert.equal(sun.surcharge.sunday, 480);
  const hol = computeDay('r1', '2027-02-02', [], [punch('2027-02-02T07:00:00Z', '2027-02-02T15:00:00Z')], [], new Set(['2027-02-02']));
  assert.equal(hol.surcharge.holiday, 480);
  const res = computeMonth(base({ days: { r1: [sun, hol] } }));
  const rate = 1627;
  assert.equal(res.rows[0].lines.find((l) => l.code === 'ZUS_SUNDAY')!.cents, hoursPay(480, rate * 2));
  assert.equal(res.rows[0].lines.find((l) => l.code === 'ZUS_HOLIDAY')!.cents, hoursPay(480, Math.round(rate * 2.5)));
});

test('pause is taken out of the paid time', () => {
  const d = computeDay('r1', '2027-02-02', [], [punch('2027-02-02T07:00:00Z', '2027-02-02T16:00:00Z', 60)], [], new Set());
  assert.equal(d.workMinutes, 480);
  assert.equal(d.surcharge.normal, 480);
});

test('Stempelhinweise erscheinen für heutige Einsätze erst ab 20 Uhr in Berlin', () => {
  const day = '2027-02-02';
  const records = [{ resource_id: 'r1', project_id: 'p', started: day + 'T07:00:00Z', ended: null, pause: null }];
  const assignments = [{ resource_id: 'r1', project_id: 'p', day, assignment_type: 'project' }];
  const warning = (time: string, punches = records, localDay = day) =>
    computeDay('r1', day, assignments, punches, [], new Set(), { day: localDay, time, local: localDay + 'T' + time }).warnings;
  assert.deepEqual(warning('19:59'), []);
  assert.equal(computeDay('r1', day, assignments, records, [], new Set()).workMinutes, 0);
  assert.deepEqual(warning('20:00'), ['Offene Stempelung']);
  assert.deepEqual(warning('20:00', []), ['Keine Stempelung für den geplanten Einsatz']);
  assert.deepEqual(warning('07:00', records, '2027-02-03'), ['Offene Stempelung']);
  assert.deepEqual(warning('21:00', [], '2027-02-01'), []);
});

test('manuell erfasste Arbeitsstunden ersetzen eine fehlende Arbeitsstempelung nicht', () => {
  const day = '2027-02-02';
  const entries = [{ resource_id: 'r1', day, data: '{"workHours":8}' }];
  const travel = [{ ...punch(day + 'T06:00:00Z', day + 'T07:00:00Z'), project_id: null }];
  const compute = (time: string) => computeDay('r1', day, [], travel, entries, new Set(), { day, time, local: day + 'T' + time });
  assert.deepEqual(compute('19:59').warnings, []);
  const after = compute('20:00');
  assert.equal(after.workMinutes, 480);
  assert.deepEqual(after.warnings, ['Keine Arbeitsstempelung']);
  const row = computeMonth(base({ days: { r1: [after] } })).rows[0];
  assert.equal(row.calendar?.[0].note, 'Stunden ohne Umsatz, Keine Arbeitsstempelung');
  assert.deepEqual(row.warnings, ['2027-02-02: Keine Arbeitsstempelung', '02.02.2027: Stunden ohne Umsatz']);
});

test('broken day entry is treated as empty', () => {
  const d = computeDay('r1', '2027-02-02', [], [punch('2027-02-02T07:00:00Z', '2027-02-02T15:00:00Z')], [{ resource_id: 'r1', day: '2027-02-02', data: '{not json' }], new Set());
  assert.equal(d.workMinutes, 480);
});

test('manual hours override the stamped time and are flagged', () => {
  const d = computeDay('r1', '2027-02-02', [], [punch('2027-02-02T07:00:00Z', '2027-02-02T15:00:00Z')], [{ resource_id: 'r1', day: '2027-02-02', data: JSON.stringify({ workHours: '6' }) }], new Set());
  assert.equal(d.workMinutes, 360);
  assert.ok(d.warnings.some((w) => w.includes('manuell')));
});

test('Stunden ohne Umsatz sind nach Tag kopierbar, interne Korrekturhinweise bleiben im Kalender', () => {
  const today = '2027-02-05';
  const makeDays = (time: string) => ['2027-02-02', '2027-02-03', today].map(day => computeDay('r1', day, [], [
    punch(day + 'T07:00:00Z', day + 'T15:00:00Z'),
    { ...punch(day + 'T06:00:00Z', day + 'T07:00:00Z'), project_id: null },
  ], day === '2027-02-02' ? [{ resource_id: 'r1', day, data: '{"workHours":6}' }] : [], new Set(),
  { day: today, time, local: today + 'T' + time }));
  const result = (time: string, foreman = true) => computeMonth(base({
    terms: { r1: { ...terms, foreman } }, days: { r1: makeDays(time) },
    revenue: [{ resourceId: 'r1', day: '2027-02-03', projectId: 'p', cents: 20000, approved: false }],
  })).rows[0];
  const before = result('19:59');
  assert.deepEqual(before.warnings, ['02.02.2027: Stunden ohne Umsatz']);
  assert.equal(before.calendar?.[0].note, 'Stunden ohne Umsatz, Stunden manuell geändert');
  assert.equal(before.calendar?.[0].workMinutes, 360);
  assert.equal(before.calendar?.[0].travelMinutes, 60);
  assert.equal(before.calendar?.[2].note, '');
  assert.deepEqual(result('20:00').warnings, ['02.02.2027: Stunden ohne Umsatz', '05.02.2027: Stunden ohne Umsatz']);
  assert.equal(result('20:00', false).calendar?.[0].travelMinutes, undefined);
});

test('fixed salary has no hourly wage and no bonus', () => {
  const t = { ...terms, fixedSalaryCents: 300000, lohngruppe: null };
  const res = computeMonth(base({ terms: { r1: t }, revenue: [{ resourceId: 'r1', day: '2027-02-10', projectId: 'p', cents: 2_000_000, approved: true }] }));
  assert.deepEqual(res.rows[0].lines.map((l) => l.code), ['FIX']);
  assert.equal(res.rows[0].payout, 300000);
});

test('SUB hat keine Lohngruppenwarnung und wird als SUB für die Lohnabrechnung ausgewiesen', () => {
  const res = computeMonth(base({ terms: { r1: { ...terms, lohngruppe: null, sub: true, subRateCents: 4000 } } }));
  assert.equal(res.rows[0].sub, true);
  assert.ok(!res.rows[0].warnings.some(w => w.includes('Lohngruppe')));
});

test('carry from the previous month is added and a later negative sum is carried again', () => {
  const res = computeMonth(base({ carryIn: { r1: -20000 }, adjustments: [{ id: 'a', resourceId: 'r1', kind: 'korrektur', label: 'x', cents: -5000 }] }));
  assert.equal(res.rows[0].carryOut, -25000);
  assert.equal(res.rows[0].payout, 0);
});

test('tool installment stops when the debt is paid', () => {
  assert.deepEqual(toolInstallment(60000, 55000, 0, 5000), { debt: 5000, installment: 5000 });
  assert.deepEqual(toolInstallment(60000, 60000, 0, 5000), { debt: 0, installment: 0 });
  const res = computeMonth(base({ tools: { r1: { priceCents: 60000, monthlyRateCents: 5000, paidBefore: 40000, prepaid: 20000 } } }));
  assert.equal(res.rows[0].lines.find((l) => l.code === 'WZG'), undefined);
});

test('bonus tier edges', () => {
  assert.equal(progressiveBonus(799_999), 0);
  assert.equal(progressiveBonus(800_100), 20);
  assert.equal(progressiveBonus(1_400_000), 160000);
  assert.equal(saturdayBonus(0), 0);
});

test('calendar helpers', () => {
  assert.equal(daysOfMonth('2028-02').length, 29);
  assert.equal(dow('2027-02-06'), 6);
  assert.equal(weekdaysInMonth(2027, 2), 20);
});

test('formatting helpers use German notation', () => {
  assert.equal(de(46.5), '46,50');
  assert.match(deEur(1800000), /18\.000,00/);
  assert.ok(sortCodes(['WZG', 'UMS', 'LOHN'])[0] === 'LOHN');
});

test('CSV: fixed headers, German decimals, formula injection defused, quotes escaped', () => {
  const res = computeMonth(base({
    terms: { r1: { ...terms, name: '=HYPERLINK("x")' }, r2: { ...terms, name: 'Anna; "Test"' } },
    adjustments: [{ id: 'a', resourceId: 'r1', kind: 'korrektur', label: 'Freitext Januar', cents: 1250 }],
  }));
  const csv = toCsv('2027-02', res);
  const lines = csv.split('\r\n');
  assert.ok(csv.startsWith('﻿'));
  assert.ok(lines[0].includes(LABELS.KORREKTUR));
  assert.ok(!lines[0].includes('Freitext'));
  assert.ok(lines[1].includes("'=HYPERLINK"));
  assert.ok(lines[1].includes('12,50'));
  assert.ok(lines[2].includes('"Anna; ""Test"""'));
});

test('SUB is paid by hourly rate with a weekly breakdown and no bonus', () => {
  const d1 = computeDay('r1', '2027-02-02', [], [
    punch('2027-02-02T07:00:00Z', '2027-02-02T11:00:00Z'),
    { ...punch('2027-02-02T11:00:00Z', '2027-02-02T15:00:00Z'), project_id: 'p2' },
    { ...punch('2027-02-02T15:00:00Z', '2027-02-02T16:00:00Z'), project_id: null },
  ], [], new Set());
  const d2 = computeDay('r1', '2027-02-09', [], [punch('2027-02-09T07:00:00Z', '2027-02-09T11:00:00Z')], [], new Set());
  const res = computeMonth(base({ terms: { r1: { ...terms, sub: true, subRateCents: 4000, lohngruppe: null } }, days: { r1: [d1, d2] },
    projectNames: new Map([['p', 'Bauvorhaben 1'], ['p2', 'Bauvorhaben 2']]),
    revenue: [{ resourceId: 'r1', day: '2027-02-10', projectId: 'p', cents: 2_000_000, approved: true }] }));
  const row = res.rows[0];
  assert.deepEqual(row.weeks!.map((w) => [w.kw, w.cents]), [['2027-W05', 36000], ['2027-W06', 16000]]);
  assert.deepEqual(row.weeks?.[0].days, [{
    day: '2027-02-02', projects: ['Bauvorhaben 1', 'Bauvorhaben 2'], workMinutes: 480, travelMinutes: 60,
  }]);
  assert.equal(row.payout, 52000);
  assert.ok(!row.lines.some((l) => l.code === 'UMS'));
});

import { brutto, value, GROSS } from '../src/calc/payroll.ts';
test('payroll sheet: brutto from month lines, override wins', () => {
  const row = { lines: [{ code: 'LOHN', label: '', cents: 270000 }, { code: 'UMS', label: '', cents: 24358 }, { code: 'NU', label: '', cents: 45000 }], spesen: 39200, km: 0 } as never;
  assert.equal(brutto(row, {}), 339358);
  assert.equal(brutto(row, { grundgehalt: 280000 }), 349358);
  assert.equal(value(GROSS[0], row, {}), 270000);
});
