import assert from 'node:assert/strict';
import { test } from 'node:test';
import { progressiveBonus, progressiveBonusTiers, STANDARD_TIERS } from '../src/calc/bonus.ts';
import { forecastRevenueBonus, forecastWorkdayRevenue } from '../src/calc/bonus-forecast.ts';
import { computeDay } from '../src/import/plan.ts';
import { computeMonth, DEFAULT_SETTINGS, type Terms } from '../src/calc/month.ts';
import { brutto, payrollBonusForecast } from '../src/calc/payroll.ts';

const month = '2026-11';
const today = '2026-11-20';
const now = { day: today, time: '16:00', local: `${today}T16:00` };
const holidays = new Set(['2026-11-24']);
const day = (day: string, working = false, absence = false) => computeDay('p', day,
  absence ? [{ resource_id: 'p', day, project_id: null, assignment_type: 'vacation' }] : [], [],
  working ? [{ resource_id: 'p', day, data: '{"workHours":8}' }] : [], holidays, now);
const revenue = (day: string, cents: number) => ({ resourceId: 'p', projectId: 'a', day, cents, approved: true });

test('Prognose verwendet nur Werktage mit Umsatz und basiert auf derselben Staffel', () => {
  const days = [day('2026-11-18', true), day('2026-11-19', true), day(today), day('2026-11-21'), day('2026-11-23'),
    day('2026-11-24'), day('2026-11-25', false, true), day('2026-11-26'), day('2026-11-27')];
  const existing = [revenue('2026-11-18', 100_000), revenue('2026-11-21', 30_000), revenue('2026-11-27', 10_000)];
  assert.deepEqual(forecastWorkdayRevenue(month, today, days, holidays, existing),
    { pastDays: 1, remaining: [today, '2026-11-23', '2026-11-26'], averageRevenue: 100_000 });
  const basis = 900_000;
  const forecast = forecastRevenueBonus(month, today, days, holidays, existing, basis, STANDARD_TIERS);
  assert.deepEqual(forecast, { pastDays: 1, remainingDays: 3, averageRevenue: 100_000,
    projectedBasis: 1_200_000, projectedBonus: 90_000 });
  const recorded = [...existing, revenue('2026-11-26', 20_000)];
  assert.equal(forecastRevenueBonus(month, today, days, holidays, recorded, basis, STANDARD_TIERS)?.remainingDays, 2);
  assert.equal(forecastRevenueBonus(month, '2026-12-01', days, holidays, existing, basis, STANDARD_TIERS), null);
  assert.deepEqual(forecastRevenueBonus(month, today, days.filter(day => day.day < today), holidays, existing, basis, STANDARD_TIERS),
    { pastDays: 1, remainingDays: 0, averageRevenue: 100_000, projectedBasis: basis, projectedBonus: 20_000 });
  assert.deepEqual(forecastRevenueBonus(month, today, [day('2026-11-23')], holidays, [], 900_000, STANDARD_TIERS),
    { pastDays: 0, remainingDays: 1, averageRevenue: null, projectedBasis: 900_000, projectedBonus: 20_000 });
});

test('Der Rechenweg weist die tatsächlich berechneten Umsatzstufen aus', () => {
  const tiers = progressiveBonusTiers(1_250_000);
  assert.deepEqual(tiers.map(tier => [tier.from, tier.to, tier.eligible, tier.rate, tier.cents]), [
    [800_000, 1_000_000, 200_000, 20, 40_000], [1_000_000, 1_200_000, 200_000, 25, 50_000],
    [1_200_000, 1_400_000, 50_000, 35, 17_500], [1_400_000, null, 0, 35, 0],
  ]);
  assert.equal(tiers.reduce((sum, tier) => sum + tier.cents, 0), progressiveBonus(1_250_000));
});


test('Bonusprognose übernimmt erfasste Teamanteile und Ersatz aus der Monatsprognose', () => {
  const days = [day('2026-11-16'), day('2026-11-17'), day('2026-11-18', false, true), day('2026-11-21'), day('2026-11-23')];
  const personal = [revenue('2026-11-16', 400_000)];
  const entered = [...personal, revenue('2026-11-17', 600_000), revenue('2026-11-21', 5_000)];
  const terms: Terms = { name: 'Test', lohngruppe: 5, surchargeCents: 0, foreman: false, foremanCostCents: null,
    fixedSalaryCents: null, bonus: true, saturday: true };
  const [row] = computeMonth({ month, asOf: today, settings: DEFAULT_SETTINGS, terms: { p: terms }, days: { p: days },
    revenue: personal, enteredRevenue: entered, nu: [], foremanMinutes: {}, otherNuCosts: {}, adjustments: [], tools: {},
    carryIn: {} }).rows;
  assert.equal(row.metrics.revenue, 438_095);
  assert.equal(row.calendar?.find(day => day.day === '2026-11-23')?.projectedRevenue, 500_000);
  assert.equal(row.revenueBonus?.forecast?.projectedBasis, 1_538_095);
  assert.equal(row.revenueBonus?.forecast?.projectedBonus, 208_333);
});


test('Bruttolohn prognostiziert acht Stunden je offenem Arbeitstag und endet mit vollständigen Daten', () => {
  const terms: Terms = { name: 'Test', lohngruppe: 8, surchargeCents: 0, foreman: false, foremanCostCents: null,
    fixedSalaryCents: null, bonus: true, saturday: true };
  const known = [day('2026-11-18', true), day('2026-11-24'), day('2026-11-25', false, true), day('2026-11-28')];
  const entered = [revenue('2026-11-18', 600_000)];
  const calculate = (open: boolean) => computeMonth({ month, asOf: today, settings: { ...DEFAULT_SETTINGS, holidays: [...holidays] },
    terms: { p: terms }, days: { p: [...known, day('2026-11-23', !open)] },
    revenue: open ? entered : [...entered, revenue('2026-11-23', 600_000)], nu: [], foremanMinutes: {}, otherNuCosts: {},
    adjustments: [{ id: 'old', resourceId: 'p', kind: 'korrektur', label: 'Vormonat', cents: -2500 }],
    tools: {}, carryIn: {} }).rows[0];
  const projected = calculate(true);
  assert.deepEqual(projected.payrollHours, { minutes: 24 * 60, ratePerHour: 2037 });
  assert.equal(projected.paySummary?.actual.base, 48_888);
  assert.deepEqual(projected.paySummary?.forecast, { base: 65_184, bonus: 116_667, correction: -2500, other: 0,
    gross: 179_351, wageDays: 1, bonusProjected: true });
  const sheetForecast = payrollBonusForecast(projected, {});
  assert.deepEqual(sheetForecast, { umsatzbonus: 116_667, sonstiges: -2500 });
  assert.equal(brutto(projected, sheetForecast!), 163_055);
  assert.equal(payrollBonusForecast(projected, { umsatzbonus: 0 }), null);
  const complete = calculate(false);
  assert.deepEqual(complete.payrollHours, { minutes: 32 * 60, ratePerHour: 2037 });
  assert.equal(payrollBonusForecast(complete, {}), null);
  assert.equal(complete.revenueBonus?.forecast, null);
  assert.equal(complete.paySummary?.forecast, null);
  assert.equal(complete.paySummary?.actual.gross, 179_351);
});
