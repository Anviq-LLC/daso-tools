import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonth, DEFAULT_SETTINGS, type Terms } from '../src/calc/month.ts';
import { computeDay } from '../src/import/plan.ts';
import { DAYS, DISTANCE, KM, PAYROLL_ABSENCE_NOTES, brutto, fieldValue, payrollAbsenceList } from '../src/calc/payroll.ts';

const terms: Terms = { name: 'Max Muster', lohngruppe: 8, surchargeCents: 0, foreman: false, foremanCostCents: null, fixedSalaryCents: null, bonus: true, saturday: true };
const base = (over: object = {}) => ({
  month: '2027-02', settings: { ...DEFAULT_SETTINGS, holidays: ['2027-01-01'] }, terms: { r1: terms }, days: {}, revenue: [], nu: [],
  foremanMinutes: {}, otherNuCosts: {}, adjustments: [], tools: {}, carryIn: {}, ...over,
});

test('bonus tiers, replacement revenue and tool installment in one month', () => {
  const absent = [1, 2].map((n) => computeDay('r1', `2027-02-0${n}`, [{ resource_id: 'r1', project_id: null, day: `2027-02-0${n}`, assignment_type: 'vacation' }], [], [], new Set()));
  const res = computeMonth(base({
    days: { r1: absent },
    revenue: [{ resourceId: 'r1', day: '2027-02-10', projectId: 'p', cents: 1_000_000, approved: true }],
    tools: { r1: { priceCents: 60000, monthlyRateCents: 5000, paidBefore: 58000, prepaid: 0 } },
  }));
  const row = res.rows[0];
  // Feb 2027 has 20 weekdays: 2 absence days add 2 x 400 EUR = 800 EUR, pot 10.800 EUR
  assert.equal(row.metrics.replacement, 80000);
  // 8-10k at 20% = 400, 10-10.8k at 25% = 200
  assert.equal(row.lines.find((l) => l.code === 'UMS')!.cents, 40000 + 20000);
  assert.equal(row.lines.find((l) => l.code === 'WZG')!.cents, -2000);
  assert.equal(row.lines.find((l) => l.code === 'ABW')!.cents, 2 * 8 * 2037);
});

test('Ersatzumsatz zählt für Urlaub, unbezahlten Urlaub und Krankheit nur in der Bonusgrundlage', () => {
  const absence = (day: string, assignment_type: string) => computeDay('r1', day,
    [{ resource_id: 'r1', project_id: null, day, assignment_type }], [], [], new Set());
  const row = computeMonth(base({
    month: '2026-11', days: { r1: [absence('2026-11-02', 'vacation'), absence('2026-11-03', 'unpaid'),
      absence('2026-11-04', 'sick'), absence('2026-11-07', 'unpaid')] },
    revenue: [{ resourceId: 'r1', day: '2026-11-05', projectId: 'p', cents: 750_000, approved: true }],
  })).rows[0];
  assert.deepEqual(row.revenueBonus?.replacement, { threshold: 800_000, weekdays: 21, perDay: 38_095,
    days: { vacation: 1, unpaid: 1, sick: 1, holiday: 0 } });
  assert.deepEqual(row.calendar?.map(day => day.replacementRevenue), [38_095, 38_095, 38_096, undefined]);
  assert.equal(row.metrics.replacement, 114_286);
  assert.equal(row.metrics.revenue, 864_286);
  assert.equal(row.overview?.revenue, 750_000);
  assert.equal(row.lines.find(line => line.code === 'UMS')?.cents, 12_857);
  assert.equal(row.lines.find(line => line.code === 'ABW')?.cents, 2 * 8 * 2037);
});

test('Lohnabrechnung übernimmt Kilometer und Abwesenheiten und bevorzugt manuelle Eingaben', () => {
  const plan = [{ resource_id: 'r1', day: '2027-02-02', project_id: null, assignment_type: 'sick' }];
  const entries = [
    { resource_id: 'r1', day: '2027-02-01', data: '{"kmOut":"20,5","kmBack":"30","meal":14}' },
    { resource_id: 'r1', day: '2027-02-02', data: '{"site":"Urlaub"}' },
    { resource_id: 'r1', day: '2027-02-03', data: '{"site":"Unbezahlter Urlaub"}' },
    { resource_id: 'r1', day: '2027-02-04', data: '{"site":"Urlaub"}' },
  ];
  const days = entries.map(entry => computeDay('r1', entry.day, plan, [], entries, new Set()));
  const [row] = computeMonth(base({ days: { r1: days } })).rows;
  assert.equal(fieldValue(DISTANCE, row, {}), 50.5);
  assert.equal(fieldValue(KM, row, {}), 1515);
  assert.equal(fieldValue(KM, row, { kilometer: 100 }), 3000);
  assert.equal(fieldValue(KM, row, { kilometer: 100, kmPauschale: 2000 }), 2000);
  assert.deepEqual(DAYS.map(column => fieldValue(column, row, {})), [1, 1, 1, undefined]);
  assert.deepEqual(PAYROLL_ABSENCE_NOTES.map(category => payrollAbsenceList([row], category)),
    ['Max Muster: 03.02.', 'Max Muster: 04.02.', 'Max Muster: 02.02.']);
  row.vacationBalanceBefore = 12.5;
  assert.deepEqual(DAYS.map(column => fieldValue(column, row, { unbezahlt: 0, urlaub: 2 })), [0, 2, 1, 10.5]);
  assert.equal(fieldValue(DAYS[3], row, { uebrig: 0 }), 0);
});

test('Abwesenheitslisten verbinden Freitag und Montag und trennen unterbrochene Zeiträume', () => {
  const sick = ['2027-02-05', '2027-02-06', '2027-02-08', '2027-02-09', '2027-02-11', '2027-02-13'];
  const vacation = ['2027-02-18', '2027-02-19', '2027-02-22'];
  const entries = [...sick.map(day => ({ day, assignment_type: 'sick' })),
    ...vacation.map(day => ({ day, assignment_type: 'vacation' }))]
    .map(entry => ({ ...entry, resource_id: 'r1', project_id: null }));
  const days = entries.map(({ day }) => computeDay('r1', day, entries, [], [], new Set()));
  const [row] = computeMonth(base({ days: { r1: days } })).rows;
  assert.equal(payrollAbsenceList([row], PAYROLL_ABSENCE_NOTES[1]), 'Max Muster: vom 18.02. bis 22.02.');
  assert.equal(payrollAbsenceList([row], PAYROLL_ABSENCE_NOTES[2]), 'Max Muster: vom 05.02. bis 09.02., 11.02.');
});

test('Samstagsumsatz bleibt außerhalb der Umsatzstaffel und 40 Prozent kommen zum Stundenlohn hinzu', () => {
  const saturday = '2027-02-06';
  const work = computeDay('r1', saturday, [], [],
    [{ resource_id: 'r1', day: saturday, data: '{"workHours":8}' }], new Set());
  const rows = computeMonth(base({ days: { r1: [work] }, revenue: [
    { resourceId: 'r1', day: '2027-02-05', projectId: 'p', cents: 790_000, approved: true },
    { resourceId: 'r1', day: saturday, projectId: 'p', cents: 30_000, approved: true },
  ] })).rows;
  const [row] = rows;
  assert.equal(row.metrics.revenue, 790_000);
  assert.equal(row.metrics.saturdayRevenue, 30_000);
  assert.equal(row.lines.find(line => line.code === 'UMS'), undefined);
  assert.equal(row.lines.find(line => line.code === 'LOHN')?.cents, 16_296);
  assert.equal(row.lines.find(line => line.code === 'SAM')?.cents, 12_000);
  assert.equal(brutto(row, {}), 28_296);
  assert.equal(row.payout, 28_296);
});

test('Manueller Umsatzbonus ersetzt den Bonusbetrag samt früherer Bonuskorrektur', () => {
  const input = base({
    revenue: [
      { resourceId: 'r1', day: '2027-02-02', projectId: 'p', cents: 1_200_000, approved: true },
      { resourceId: 'r1', day: '2027-02-06', projectId: 'p', cents: 100_000, approved: true },
    ],
    adjustments: [{ id: 'old', resourceId: 'r1', kind: 'korrektur', label: 'Frühere Korrektur', cents: -5000 }],
  });
  const automatic = computeMonth(input).rows[0];
  const manual = computeMonth({ ...input, revenueBonusOverrides: { r1: 50_000 } }).rows[0];
  assert.equal(automatic.payout, 125_000);
  assert.equal(manual.revenueBonus?.override, 50_000);
  assert.equal(manual.lines.find(line => line.code === 'UMS')?.cents, 50_000);
  assert.equal(manual.lines.find(line => line.code === 'SAM')?.cents, 40_000);
  assert.equal(manual.payout, 90_000);
  assert.equal(manual.revenueBonus?.tiers.reduce((sum, tier) => sum + tier.cents, 0), 90_000);
  const zero = computeMonth({ ...input, revenueBonusOverrides: { r1: 0 } }).rows[0];
  assert.equal(zero.revenueBonus?.override, 0);
  assert.equal(zero.payout, 40_000);
});

test('negative bonus is carried, never taken from wages', () => {
  const res = computeMonth(base({ adjustments: [{ id: 'a', resourceId: 'r1', kind: 'korrektur', label: 'Rückbuchung', cents: -50000 }] }));
  const row = res.rows[0];
  assert.equal(row.carryOut, -50000);
  assert.equal(row.payout, 0);
});

test('NU bonus goes to the foreman by default', () => {
  const t = { ...terms, foreman: true, foremanCostCents: 3000 };
  const nu = [{ projectId: 'p', projectName: 'NU Haus', foremanId: 'r1', revenue: 500000, cost: 300000, approved: true }];
  const ok = computeMonth(base({ terms: { r1: t }, nu, foremanMinutes: { r1: { p: 600 } } }));
  // profit = 5000 - 3000 - 10 h x 30 = 1700, bonus 10% = 170
  assert.equal(ok.nu[0].bonus, 17000);
  assert.equal(ok.rows[0].lines.find((l) => l.code === 'NU')!.cents, 17000);
  const noRate = computeMonth(base({ terms: { r1: terms }, nu }));
  assert.equal(noRate.nu[0].bonus, 20000); // no cost rate: profit 2000, bonus 200
  assert.ok(!/Kostensatz/.test(noRate.warnings.join()));
});

test('missing holidays warn', () => {
  const res = computeMonth(base({ settings: DEFAULT_SETTINGS }));
  assert.match(res.warnings.join(), /Feiertage/);
});

test('weekend absence is not paid as a workday', () => {
  const sat = computeDay('r1', '2027-02-06', [{ resource_id: 'r1', project_id: null, day: '2027-02-06', assignment_type: 'vacation' }], [], [], new Set());
  const res = computeMonth(base({ days: { r1: [sat] } }));
  assert.equal(res.rows[0].lines.find((l) => l.code === 'ABW'), undefined);
  assert.equal(res.rows[0].metrics.absentDays, 0);
});

test('NU bonus can be assigned and split between two people', () => {
  const nu = [{ projectId: 'p', projectName: 'NU Haus', foremanId: null, revenue: 500000, cost: 300000, approved: true }];
  const r = computeMonth(base({ terms: { r1: terms, r2: { ...terms, name: 'Zwei' } }, nu, nuAssign: { p: { firstId: 'r1', secondId: 'r2', secondPct: 30 } } }));
  assert.equal(r.rows.find((x) => x.resourceId === 'r1')!.lines.find((l) => l.code === 'NU')!.cents, 14000);
  assert.equal(r.rows.find((x) => x.resourceId === 'r2')!.lines.find((l) => l.code === 'NU')!.cents, 6000);
});

test('Zeiträume ordnen den Bonus je Leistungsdatum zu und halbieren die Überschneidung', () => {
  const daily = {
    '2027-02-03': { revenue: 5000, cost: 1000 },
    '2027-02-11': { revenue: 7000, cost: 1000 },
    '2027-02-18': { revenue: 3000, cost: 1000 },
  };
  const nu = [{ projectId: 'p', projectName: 'Haus', foremanId: null, revenue: 15000, cost: 3000, approved: true, daily }];
  const r = computeMonth(base({
    terms: { r1: terms, r2: { ...terms, name: 'Zwei' } }, nu,
    nuAssign: { p: { firstId: 'r1', secondId: 'r2', secondPct: 50, periods: {
      first: { from: '2027-02-01', to: '2027-02-15' }, second: { from: '2027-02-10', to: '2027-02-28' },
    } } },
  }));
  assert.equal(r.nu[0].bonus, 1200);
  assert.deepEqual(r.nu[0].shares, { first: 700, second: 500, unassigned: 0, pending: false });
  assert.deepEqual(r.rows.map(row => row.lines.find(line => line.code === 'NU')?.cents), [700, 500]);
});

test('Mitarbeiterübersicht trennt Arbeitszeit und Anfahrt und verwendet echte Aufmaßumsätze', () => {
  const date = '2027-02-03';
  const shift = { resource_id: 'r1', project_id: 'p', started: date + 'T07:00:00Z', ended: date + 'T14:00:00Z', pause: null };
  const drive = { ...shift, project_id: null, started: date + 'T06:00:00Z', ended: date + 'T07:00:00Z' };
  const absent = (day: string, assignment_type: string) => computeDay('r1', day, [{ resource_id: 'r1', day, project_id: null, assignment_type }], [], [], new Set());
  const days = [computeDay('r1', date, [], [shift, drive], [], new Set()), absent('2027-02-04', 'vacation'), absent('2027-02-05', 'sick')];
  const row = computeMonth(base({
    days: { r1: days }, asOf: '2027-02-05',
    enteredRevenue: [{ resourceId: 'r1', day: date, projectId: 'p', label: 'Testprojekt', cents: 125450, approved: false }],
  })).rows[0];
  assert.deepEqual(row.overview, { worked: 420, travel: 60, revenue: 125450, vacation: 1, sick: 1, holiday: 0 });
  assert.deepEqual(row.calendar?.[0].revenue, [{ label: 'Testprojekt', cents: 125450 }]);
  assert.equal(row.calendar?.[0].note, '');
  assert.deepEqual(row.warnings, []);
  assert.equal(row.metrics.revenue, computeMonth(base({ days: { r1: days } })).rows[0].metrics.revenue);
});
