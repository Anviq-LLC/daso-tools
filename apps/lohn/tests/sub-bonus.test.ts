import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MonthResult, Row } from '../src/calc/month.ts';
import { assignSubInvoiceWeeks, calculateSubBonus, subBonusWeekRange } from '../src/calc/sub-bonus.ts';
import { prevMonth } from '../src/worker/month.ts';
import { subBonusWeeks } from '../src/worker/sub-bonus.ts';

const resourceId = 'sub';
const period = '2026-10';
const weeks = subBonusWeeks(period);
const row: Row = {
  resourceId, name: 'Test', lines: [], sub: true, payout: 0, km: 0, spesen: 0, carryOut: 0, warnings: [],
  metrics: { workMinutes: 0, travelMinutes: 0, absentDays: 0, revenue: 0, saturdayRevenue: 0, replacement: 0 },
  overview: { worked: 0, travel: 0, revenue: 80000, vacation: 0, sick: 0, holiday: 0 },
  weeks: [
    { kw: '2026-W40', workMinutes: 480, travelMinutes: 60, cents: 36000 },
    { kw: '2026-W41', workMinutes: 600, travelMinutes: 0, cents: 40000 },
  ],
};
const project = (projectId: string, profit: number | null, foremanId = resourceId): MonthResult['nu'][number] => ({
  projectId, projectName: projectId, revenue: 0, cost: 0, profit, foremanId,
  firstId: foremanId, secondId: null, secondPct: 0, bonus: 0,
});
const ledger: MonthResult = {
  month: period, rows: [row], nu: [project('Baustelle A', 60000), project('Baustelle B', -20000), project('Andere Leitung', 99000, 'other')],
  warnings: [],
};

test('SUB-Monatsbonus nutzt Rechnungswerte, Vorbonus, Eigenumsatz und zugehörige Projektgewinne', () => {
  const result = calculateSubBonus(ledger, resourceId, row.weeks!, { 'week:2026-W40': 38000, bonus: 3200 }, 8000);
  assert.equal(result.weeks[0].suggestedCents, 36000);
  assert.equal(result.weeks[0].invoiceCents, 38000);
  assert.equal(result.invoiceCosts, 78000);
  assert.equal(result.previousBonusCents, 8000);
  assert.equal(result.costs, 86000);
  assert.equal(result.ownRevenue, 80000);
  assert.equal(result.projectProfit, 40000);
  assert.equal(result.profit, 34000);
  assert.equal(result.proposedBonus, 3400);
  assert.equal(result.storedBonus, 3200);
});

test('Manuelle Nullwerte, Gewinnverlust und fehlende Projektwerte werden unterschieden', () => {
  const result = calculateSubBonus(ledger, resourceId, row.weeks!, { 'week:2026-W40': 0, 'prior-bonus': 0 }, 8000);
  assert.equal(result.previousBonusCents, 0);
  assert.equal(result.invoiceCosts, 40000);
  const loss = calculateSubBonus(ledger, resourceId, row.weeks!, { 'prior-bonus': 60000 }, null);
  assert.equal(loss.profit, -16000);
  assert.equal(loss.proposedBonus, 0);
  const incomplete = calculateSubBonus({ ...ledger, nu: [project('Offene Baustelle', null)] }, resourceId, row.weeks!, {}, null);
  assert.equal(incomplete.previousBonusCents, null);
  assert.equal(incomplete.proposedBonus, null);
  assert.equal(prevMonth('2027-01'), '2026-12');
  assert.deepEqual(weeks, ['2026-W40', '2026-W41', '2026-W42', '2026-W43', '2026-W44']);
});


test('Kalenderwochen am Monatswechsel folgen den meisten Stunden und werden ganz abgerechnet', () => {
  const days = [
    { day: '2026-09-28', absent: false, workMinutes: 480, travelMinutes: 120 },
    { day: '2026-09-30', absent: false, workMinutes: 480, travelMinutes: 0 },
    { day: '2026-10-01', absent: false, workMinutes: 480, travelMinutes: 120 },
    { day: '2026-10-02', absent: false, workMinutes: 480, travelMinutes: 60 },
  ];
  assert.deepEqual(assignSubInvoiceWeeks(days, '2026-09', 4000), []);
  assert.deepEqual(assignSubInvoiceWeeks(days, '2026-10', 4000), [{ kw: '2026-W40', workMinutes: 1920, travelMinutes: 300, cents: 148000 }]);
  const tie = days.map(day => ({ ...day, travelMinutes: 0 }));
  assert.equal(assignSubInvoiceWeeks(tie, '2026-10', 4000).length, 1);
  assert.equal(assignSubInvoiceWeeks(tie, '2026-09', 4000).length, 0);
  const range = subBonusWeekRange('2026-10');
  assert.deepEqual([range.from, range.to, range.days.length], ['2026-09-28', '2026-11-01', 35]);
});
