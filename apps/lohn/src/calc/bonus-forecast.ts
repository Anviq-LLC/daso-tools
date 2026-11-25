import { progressiveBonus, type Tier } from './bonus.ts';
import { dow, type Day } from '../import/plan.ts';
import type { RevenueRow } from './month.ts';

function isWorkday(day: Day, holidays: ReadonlySet<string>) {
  const weekday = dow(day.day);
  return weekday >= 1 && weekday <= 5 && !day.absent && !holidays.has(day.day);
}

function isOpenWorkday(day: Day, asOf: string) {
  return !day.workMinutes && (day.day > asOf || (day.day === asOf && day.stampCheckDue === false));
}

export function forecastWageDays(month: string, asOf: string | undefined, days: Day[], holidays: ReadonlySet<string>) {
  if (!asOf?.startsWith(month + '-')) return 0;
  return days.filter(day => isWorkday(day, holidays) && isOpenWorkday(day, asOf)).length;
}

function workdayRevenue(
  month: string, asOf: string | undefined, days: Day[], holidays: ReadonlySet<string>,
  revenue: RevenueRow[],
) {
  if (!asOf?.startsWith(month + '-')) return null;
  const revenueByDay = new Map<string, number>();
  for (const row of revenue) revenueByDay.set(row.day, (revenueByDay.get(row.day) ?? 0) + row.cents);

  let pastDays = 0;
  let observedRevenue = 0;
  const remaining: string[] = [];
  for (const day of days) {
    if (!isWorkday(day, holidays)) continue;
    const earned = revenueByDay.get(day.day) ?? 0;
    if (day.day <= asOf && earned > 0) {
      pastDays++;
      observedRevenue += earned;
    } else if (!revenueByDay.has(day.day) && isOpenWorkday(day, asOf)) {
      remaining.push(day.day);
    }
  }
  return { pastDays, remaining, averageRevenue: pastDays ? Math.round(observedRevenue / pastDays) : null };
}

export function forecastWorkdayRevenue(
  month: string, asOf: string | undefined, days: Day[], holidays: ReadonlySet<string>, revenue: RevenueRow[],
) {
  const stats = workdayRevenue(month, asOf, days, holidays, revenue);
  if (!stats || stats.averageRevenue === null || !stats.remaining.length) return null;
  return { ...stats, averageRevenue: stats.averageRevenue };
}

export function forecastRevenueBonus(
  month: string, asOf: string | undefined, days: Day[], holidays: ReadonlySet<string>,
  revenue: RevenueRow[], basis: number, tiers: Tier[],
) {
  const forecast = workdayRevenue(month, asOf, days, holidays, revenue);
  if (!forecast) return null;
  const { pastDays, averageRevenue, remaining } = forecast;
  const remainingDays = remaining.length;
  const projectedBasis = basis + (averageRevenue ?? 0) * remainingDays;
  return { pastDays, remainingDays, averageRevenue, projectedBasis, projectedBonus: progressiveBonus(projectedBasis, tiers) };
}
