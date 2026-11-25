import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berlinDay, computeDay } from '../src/import/plan.ts';
import { importAufmass, parseRecords } from '../src/import/aufmass.ts';

test('punch after midnight Berlin belongs to the Berlin day, summer and winter', () => {
  assert.equal(berlinDay('2027-07-09T22:30:00Z'), '2027-07-10'); // CEST = UTC+2
  assert.equal(berlinDay('2027-01-09T23:30:00Z'), '2027-01-10'); // CET = UTC+1
  assert.equal(berlinDay('2027-07-09T21:30:00Z'), '2027-07-09');
});

const punch = (project: string | null, a: string, b: string, pause = 0) => ({ resource_id: 'r1', project_id: project, started: a, ended: b, pause });

test('work day from punches with night minutes in Berlin time', () => {
  // 05:00-13:00 Berlin (winter): 1 night hour, 7 normal hours
  const d = computeDay('r1', '2027-01-11', [], [punch('p1', '2027-01-11T04:00:00Z', '2027-01-11T12:00:00Z')], [], new Set());
  assert.equal(d.workMinutes, 480);
  assert.equal(d.surcharge.night, 60);
  assert.equal(d.surcharge.normal, 420);
});

test('absence day counts 8 h and no meal; entry override wins', () => {
  const d = computeDay('r1', '2027-01-11', [{ resource_id: 'r1', project_id: null, day: '2027-01-11', assignment_type: 'sick' }], [], [], new Set());
  assert.equal(d.workMinutes, 480);
  assert.equal(d.mealCents, 0);
  const e = computeDay('r1', '2027-01-11', [], [punch('p1', '2027-01-11T06:00:00Z', '2027-01-11T14:00:00Z')],
    [{ resource_id: 'r1', day: '2027-01-11', data: JSON.stringify({ meal: '28', kmOut: '40', kmBack: '40' }) }], new Set());
  assert.equal(e.mealCents, 2800);
  assert.equal(e.km, 80);
});

test('travel plus work over 8h away gives 14 EUR meal', () => {
  const d = computeDay('r1', '2027-01-11', [], [punch(null, '2027-01-11T05:00:00Z', '2027-01-11T06:00:00Z'), punch('p1', '2027-01-11T06:00:00Z', '2027-01-11T14:00:00Z')], [], new Set());
  assert.equal(d.mealCents, 1400);
  assert.equal(d.travelMinutes, 60);
});

const project = { id: 'a1', name: 'Haus', number: 'P1', factor: 0.9, planId: 'plan1', employees: [{ id: 'e1', planId: 'r1', firstName: 'A', lastName: 'B', code: 'AB' }, { id: 'e2', planId: 'r2', firstName: 'C', lastName: 'D', code: 'CD' }] };
const mk = (members: string[], review = 'approved', state = 'ready') => ({
  id: 'rep' + members.join(''), projectId: 'a1', date: '2027-01-12', endDate: '2027-01-12', team: 'T1', kind: 'measurement', state, review,
  employeeMembers: members.map((m) => ({ employeeId: m, name: m, code: m, trial: false })),
  lines: [{ id: 'l1', positionId: 'x', number: '1', description: 'x', unit: 'm', price: 10000, employeePrice: 9000, quantity: 1, remark: '', serviceDate: '2027-01-12' }],
});
const recs = (reports: unknown[]) => [{ id: 'a1', kind: 'project', data: JSON.stringify(project) }, ...reports.map((r: any) => ({ id: r.id, kind: 'report', data: JSON.stringify(r) }))];

test('single worker gets the Mitarbeiterwert, several workers without assignment give a warning', () => {
  const one = importAufmass(parseRecords(recs([mk(['e1'])])), '2027-01');
  assert.deepEqual(one.revenue.map((r) => [r.resourceId, r.cents]), [['r1', 9000]]);
  const two = importAufmass(parseRecords(recs([mk(['e1', 'e2'])])), '2027-01');
  assert.equal(two.revenue.length, 0);
  assert.deepEqual(two.enteredRevenue.map(row => [row.resourceId, row.day, row.cents]), [
    ['r1', '2027-01-12', 4500], ['r2', '2027-01-12', 4500],
  ]);
  assert.match(two.warnings.join(), /Zuordnung fehlt/);
  const split = importAufmass(parseRecords(recs([mk(['e1', 'e2'])])), '2027-01', { allowEqualSplit: true });
  assert.equal(split.revenue.reduce((n, r) => n + r.cents, 0), 9000);
  assert.match(split.warnings.join(), /vorläufig/);
  const group = mk(['e1', 'e2']);
  const saturday = '2027-01-16';
  const weekend = importAufmass(parseRecords(recs([{ ...group, date: saturday, endDate: saturday,
    lines: group.lines.map(line => ({ ...line, serviceDate: saturday })) }])), '2027-01');
  assert.deepEqual(weekend.revenue.map(row => [row.resourceId, row.cents]), [['r1', 4500], ['r2', 4500]]);
  assert.deepEqual(weekend.warnings, []);
});

test('other months and drafts are not counted, unchecked days are listed', () => {
  assert.equal(importAufmass(parseRecords(recs([mk(['e1'])])), '2027-02').revenue.length, 0);
  const d = importAufmass(parseRecords(recs([mk(['e1'], 'approved', 'draft')])), '2027-01');
  assert.equal(d.revenue.length, 0);
  const u = importAufmass(parseRecords(recs([mk(['e1'], 'pending')])), '2027-01');
  assert.equal(u.unchecked.length, 1);
});

test('a report written in March for work on 25 Feb counts in February only', () => {
  const late: any = { ...mk(['e1']), id: 'late', date: '2027-03-04', endDate: '2027-03-04' };
  late.lines[0].serviceDate = '2027-02-25';
  assert.equal(importAufmass(parseRecords(recs([late])), '2027-02').revenue.length, 1);
  assert.equal(importAufmass(parseRecords(recs([late])), '2027-03').revenue.length, 0);
});

test('mehrtägiges NU-Aufmaß übernimmt die 90-%-Umsatzwerte und berechnet Gesamtstunden nur einmal', () => {
  const base = mk([]);
  const run = (hours: number | null) => importAufmass(parseRecords(recs([{
    ...base, endDate: '2027-01-13',
    teamWork: { code: 'NU1', company: 'Firma', hourlyRate: 3500, workers: [{ name: 'NU', hours }] },
    lines: [base.lines[0], { ...base.lines[0], id: 'l2', serviceDate: '2027-01-13' }],
  }])), '2027-01').nu[0];
  const row = run(16);
  assert.deepEqual([row.projectName, row.revenue, row.cost, row.issues?.length], ['Haus', 18000, 56000, 0]);
  assert.deepEqual(row.undatedCosts, [{ from: '2027-01-12', to: '2027-01-13' }]);
  assert.equal(run(null).issues?.[0].reason, 'NU-Gesamtstunden im Aufmaß fehlen');
});

test('historisches NU-Stundenaufmaß nutzt den im Bericht gespeicherten Team-Stundensatz', () => {
  const base = mk([]);
  const report = {
    ...base, kind: 'timesheet',
    teamWork: { code: 'T1', company: 'Firma', hourlyRate: 3500, workers: [{ name: 'NU', hours: 2 }] },
    lines: [{ ...base.lines[0], quantity: 2, workerId: 'sub:T1:0' }],
    timeSheet: { anchorDate: base.date, mode: 'day', factor: 0.9, entries: [{
      id: 'entry', workerId: 'sub:T1:0', date: base.date, role: 'fitter', start: '08:00', end: '10:00',
      pauseMinutes: 0, travelQuantity: 0, overnightQuantity: 0,
      rates: { costHourly: null, billingHourly: 10000, travelCost: 0, overnightCost: 0 },
    }] },
  };
  const [row] = importAufmass(parseRecords(recs([report])), '2027-01').nu;
  assert.deepEqual([row.revenue, row.cost, row.issues], [18000, 7000, []]);
});

test('NU-Aufmaß ohne Teamsatz nutzt die gespeicherten Einzelkostensätze je Leistungsdatum', () => {
  const base = mk([]);
  const report = {
    ...base, endDate: '2027-01-13',
    teamWork: { code: 'T1', company: 'Firma', workers: [
      { name: 'Monteur', hourlyRate: 3500, hours: 8, dailyHours: { '2027-01-12': 8, '2027-01-13': 0 } },
      { name: 'Obermonteur', hourlyRate: 4500, hours: 8, dailyHours: { '2027-01-12': 0, '2027-01-13': 8 } },
    ] },
    lines: [base.lines[0], { ...base.lines[0], id: 'l2', serviceDate: '2027-01-13' }],
  };
  const [row] = importAufmass(parseRecords(recs([report])), '2027-01').nu;
  assert.deepEqual([row.cost, row.daily?.['2027-01-12'].cost, row.daily?.['2027-01-13'].cost, row.issues], [64000, 28000, 36000, []]);
});

test('NU-Stundenaufmaß liest den Einzelkostensatz aus der gespeicherten Besetzung', () => {
  const base = mk([]);
  const report = {
    ...base, kind: 'timesheet',
    teamWork: { code: 'T1', company: 'Firma', workers: [{ name: 'NU', hours: null, hourlyRate: 4200 }] },
    lines: [{ ...base.lines[0], quantity: 2, workerId: 'sub:T1:0' }],
    timeSheet: { anchorDate: base.date, mode: 'day', factor: 0.9, entries: [{
      id: 'entry', workerId: 'sub:T1:0', date: base.date, role: 'fitter', start: '08:00', end: '10:00',
      pauseMinutes: 0, travelQuantity: 0, overnightQuantity: 0,
      rates: { costHourly: null, billingHourly: 10000, travelCost: 0, overnightCost: 0 },
    }] },
  };
  const [row] = importAufmass(parseRecords(recs([report])), '2027-01').nu;
  assert.deepEqual([row.revenue, row.cost, row.issues], [18000, 8400, []]);
});
