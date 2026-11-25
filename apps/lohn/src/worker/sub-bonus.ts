import { isoWeek } from '../calc/month.ts';
import { assignSubInvoiceWeeks, calculateSubBonus, subBonusWeekRange, type SubBonusView } from '../calc/sub-bonus.ts';
import { berlin, computeDay, daysOfMonth } from '../import/plan.ts';
import { HttpError, type Env } from './auth.ts';
import { liveMonth, prevMonth, termsFor } from './month.ts';
import type { PayrollSources } from './sources.ts';

export const subBonusWeeks = (period: string) => [...new Set(daysOfMonth(period).map(isoWeek))];

export async function subTermsFor(env: Env, month: string, resourceId: string) {
  const { terms } = await termsFor(env, month, { [resourceId]: '' });
  const termsForSub = terms[resourceId];
  if (!termsForSub.sub) throw new HttpError(404, 'Dieser Mitarbeiter ist im gewählten Monat kein SUB.');
  return termsForSub;
}

export async function loadSubBonus(env: Env, sources: PayrollSources, month: string, resourceId: string): Promise<SubBonusView> {
  const current = await subTermsFor(env, month, resourceId);
  const period = prevMonth(month);
  const previousPeriod = prevMonth(period);
  const span = subBonusWeekRange(period);
  const weekItems = subBonusWeeks(period).map(week => `week:${week}`);
  const [source, historical, stored, carried] = await Promise.all([
    sources.month(period, span),
    termsFor(env, period, { [resourceId]: '' }),
    env.DB.prepare(`SELECT item, cents FROM sub_bonus_amounts WHERE resource_id = ?
      AND (month = ? OR item IN (${weekItems.map(() => '?').join(', ')})) ORDER BY (month = ?), (month = '')`)
      .bind(resourceId, period, ...weekItems, period).all<{ item: string; cents: number }>(),
    env.DB.prepare("SELECT cents FROM sub_bonus_amounts WHERE month = ? AND resource_id = ? AND item = 'bonus'")
      .bind(previousPeriod, resourceId).first<{ cents: number }>(),
  ]);
  const ledger = await liveMonth(env, period, { ...sources, month: async () => source });
  const { assignments, punches, entries } = source;
  const now = berlin(new Date().toISOString());
  const days = span.days.map(day => computeDay(resourceId, day, assignments, punches, entries, new Set(), now));
  const historicalTerms = historical.terms[resourceId];
  const rate = (historicalTerms.sub ? historicalTerms.subRateCents : current.subRateCents) ?? 0;
  const weeks = assignSubInvoiceWeeks(days, period, rate);
  return { period, previousPeriod, ...calculateSubBonus(ledger.result, resourceId, weeks,
    Object.fromEntries(stored.results.map(row => [row.item, row.cents])), carried?.cents ?? null) };
}
