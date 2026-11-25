import { hoursPay } from './bonus.ts';

export type DateRange = { from: string; to: string };
export type NuPeriods = { first: DateRange; second: DateRange };
export type NuDay = { revenue: number; cost: number };
export function fullMonth(month: string): DateRange {
  const [year, number] = month.split('-').map(Number);
  return { from: month + '-01', to: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
}

export function splitNuPeriods(
  bonus: number, periods: NuPeriods, daily: Record<string, NuDay>, foremanMinutes: Record<string, number>,
  rate: number, otherCost: number, undatedCosts: DateRange[],
) {
  const crosses = (range: DateRange, period: DateRange) =>
    range.from <= period.to && range.to >= period.from && (range.from < period.from || range.to > period.to);
  if (bonus && undatedCosts.some(range => crosses(range, periods.first) || crosses(range, periods.second)))
    return { first: 0, second: 0, unassigned: bonus, pending: true };

  const days = [...new Set([...Object.keys(daily), ...Object.keys(foremanMinutes)])].sort();
  const byGroup = [0, 0, 0, 0]; // None, first, second, both
  let cumulativeOther = 0;
  for (const [index, day] of days.entries()) {
    const first = day >= periods.first.from && day <= periods.first.to;
    const second = day >= periods.second.from && day <= periods.second.to;
    const partialOther = Math.round(otherCost * (index + 1) / days.length);
    const amounts = daily[day];
    const net = (amounts?.revenue ?? 0) - (amounts?.cost ?? 0)
      - hoursPay(foremanMinutes[day] ?? 0, rate) - (partialOther - cumulativeOther);
    byGroup[Number(first) + 2 * Number(second)] += net;
    cumulativeOther = partialOther;
  }

  const positive = byGroup.map(value => Math.max(0, value));
  const total = positive.reduce((a, b) => a + b, 0);
  if (!total) return { first: 0, second: 0, unassigned: bonus, pending: false };
  let cumulative = 0, previous = 0;
  const shares = positive.map(weight => {
    cumulative += weight;
    const allocated = Math.round(bonus * cumulative / total);
    const part = allocated - previous;
    previous = allocated;
    return part;
  });
  const half = Math.floor(shares[3] / 2);
  return { first: shares[1] + shares[3] - half, second: shares[2] + half, unassigned: shares[0], pending: false };
}
