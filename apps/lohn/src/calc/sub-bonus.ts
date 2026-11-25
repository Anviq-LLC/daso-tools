import { isoWeek, type MonthResult, type SubWeek } from './month.ts';
import { hoursPay } from './bonus.ts';
import { dow, type Day } from '../import/plan.ts';
import { fullMonth } from './nu-periods.ts';

export type SubBonusAmounts = Partial<Record<string, number>>;
export type SubBonusWeek = Pick<SubWeek, 'kw' | 'workMinutes' | 'travelMinutes'> & {
  suggestedCents: number;
  invoiceCents: number | null;
};

const dayMs = 86_400_000;
const stamp = (day: string) => Date.parse(day + 'T00:00:00Z');
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const weekdayIndex = (day: string) => (dow(day) + 6) % 7;

export function subBonusWeekRange(period: string) {
  const month = fullMonth(period);
  const start = stamp(month.from) - weekdayIndex(month.from) * dayMs;
  const end = stamp(month.to) + (6 - weekdayIndex(month.to)) * dayMs;
  return { from: isoDate(start), to: isoDate(end), days: Array.from({ length: (end - start) / dayMs + 1 }, (_, i) => isoDate(start + i * dayMs)) };
}

export function assignSubInvoiceWeeks(days: Pick<Day, 'day' | 'absent' | 'workMinutes' | 'travelMinutes'>[], period: string, rate: number): SubWeek[] {
  const weeks = new Map<string, { minutesByMonth: Map<string, number>; thursdayMonth: string; workMinutes: number; travelMinutes: number }>();
  for (const day of days) {
    const kw = isoWeek(day.day);
    const thursdayMonth = isoDate(stamp(day.day) + (3 - weekdayIndex(day.day)) * dayMs).slice(0, 7);
    const week = weeks.get(kw) ?? { minutesByMonth: new Map<string, number>(), thursdayMonth, workMinutes: 0, travelMinutes: 0 };
    const month = day.day.slice(0, 7);
    const work = day.absent ? 0 : day.workMinutes;
    week.workMinutes += work;
    week.travelMinutes += day.travelMinutes;
    week.minutesByMonth.set(month, (week.minutesByMonth.get(month) ?? 0) + work + day.travelMinutes);
    weeks.set(kw, week);
  }
  return [...weeks].flatMap(([kw, week]) => {
    const winningMonth = [...week.minutesByMonth].reduce((best, [month, minutes]) =>
      minutes > (week.minutesByMonth.get(best) ?? 0) ? month : best, week.thursdayMonth);
    if (winningMonth !== period) return [];
    return [{ kw, workMinutes: week.workMinutes, travelMinutes: week.travelMinutes, cents: hoursPay(week.workMinutes + week.travelMinutes, rate) }];
  });
}

export function calculateSubBonus(
  ledger: MonthResult, resourceId: string, invoiceWeeks: SubWeek[], amounts: SubBonusAmounts,
  carriedBonusCents: number | null,
) {
  const row = ledger.rows.find(row => row.resourceId === resourceId);
  const weeks: SubBonusWeek[] = invoiceWeeks.map(({ kw, workMinutes, travelMinutes, cents }) => ({
    kw, workMinutes, travelMinutes, suggestedCents: cents, invoiceCents: amounts[`week:${kw}`] ?? null,
  }));
  const projects = ledger.nu.filter(project => project.foremanId === resourceId)
    .map(({ projectId, projectName, profit }) => ({ projectId, projectName, profit }));
  const invoiceCosts = weeks.reduce((sum, week) => sum + (week.invoiceCents ?? week.suggestedCents), 0);
  const previousBonusCents = amounts['prior-bonus'] ?? carriedBonusCents;
  const costs = invoiceCosts + (previousBonusCents ?? 0);
  const ownRevenue = row?.overview?.revenue ?? 0;
  const projectProfit = projects.some(project => project.profit === null) ? null
    : projects.reduce((sum, project) => sum + (project.profit ?? 0), 0);
  const profit = projectProfit === null ? null : ownRevenue + projectProfit - costs;
  const proposedBonus = profit === null ? null : Math.round(Math.max(0, profit) / 10);
  return { weeks, projects, invoiceCosts, previousBonusCents, costs, ownRevenue, projectProfit, profit,
    proposedBonus, storedBonus: amounts.bonus ?? null };
}

export type SubBonusView = ReturnType<typeof calculateSubBonus> & { period: string; previousPeriod: string };
