import type { Record_ } from '../import/aufmass.ts';
import type { Assignment, DayEntry, Punch } from '../import/plan.ts';
import { HttpError, readOnly, type Env } from './auth.ts';
import type { DateRange } from '../calc/nu-periods.ts';
import { officeRows } from './office-feed.ts';

export type Employee = { id: string; name: string; role: string };
export type PlanProject = { id: string; name: string; foreman_id: string | null };
export type MonthSources = {
  employees: Employee[];
  assignments: Assignment[];
  punches: Punch[];
  entries: DayEntry[];
  projects: PlanProject[];
  records: Record_[];
};
export type PayrollSources = {
  employees(): Promise<Employee[]>;
  month(month: string, planDays?: DateRange): Promise<MonthSources>;
  planDays(range: DateRange): Promise<Pick<MonthSources, 'assignments' | 'entries'>>;
};

const shiftedIso = (day: string, days: number) => new Date(Date.parse(day + 'T00:00:00Z') + days * 86_400_000).toISOString();

export function sourceRange(month: string, planDays?: DateRange) {
  const [year, monthNumber] = month.split('-').map(Number);
  const iso = (offset: number) => new Date(Date.UTC(year, monthNumber - 1, 1 + offset)).toISOString();
  return {
    first: planDays?.from ?? month + '-01',
    last: planDays?.to ?? new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
    punchFrom: planDays ? shiftedIso(planDays.from, -2) : iso(-2),
    punchTo: planDays ? shiftedIso(planDays.to, 3) : new Date(Date.UTC(year, monthNumber, 3)).toISOString(),
    reportFrom: iso(-8).slice(0, 10),
    reportTo: iso(110).slice(0, 10),
  };
}

export function databaseSources(env: Env): PayrollSources {
  if (!env.PLAN || !env.AUFMASS) throw new HttpError(503, 'Quelldatenbanken fehlen.');
  const plan = readOnly(env.PLAN), aufmass = readOnly(env.AUFMASS);
  const employees = async () => (await plan.prepare("SELECT id, name, role FROM resources WHERE kind = 'employee' AND archived_at IS NULL ORDER BY sort_order, name").all<Employee>()).results;
  const planDays = async ({ from, to }: DateRange) => {
    const [assignments, entries] = await Promise.all([
      plan.prepare('SELECT resource_id, project_id, day, assignment_type FROM assignments WHERE day >= ? AND day <= ?').bind(from, to).all<Assignment>(),
      plan.prepare('SELECT resource_id, day, data FROM day_entries WHERE day >= ? AND day <= ?').bind(from, to).all<DayEntry>(),
    ]);
    const office = await officeRows(env.MA_DB, await employees(), { from, to });
    return { assignments: [...office.assignments, ...assignments.results], entries: entries.results };
  };
  return {
    employees,
    planDays,
    async month(period, range) {
      const { first, last, punchFrom, punchTo, reportFrom, reportTo } = sourceRange(period, range);
      const [resources, days, punches, projects, records] = await Promise.all([
        employees(),
        planDays({ from: first, to: last }),
        plan.prepare('SELECT resource_id, project_id, started, ended, pause FROM punches WHERE started >= ? AND started <= ?').bind(punchFrom, punchTo).all<Punch>(),
        plan.prepare('SELECT id, name, foreman_id FROM projects').all<PlanProject>(),
        aufmass.prepare("SELECT id, kind, data FROM records WHERE kind = 'project' OR (kind = 'report' AND json_extract(data, '$.date') <= ? AND COALESCE(json_extract(data, '$.endDate'), json_extract(data, '$.date')) >= ?)").bind(reportTo, reportFrom).all<Record_>(),
      ]);
      const office = await officeRows(env.MA_DB, resources, { from: first, to: last }, { from: punchFrom, to: punchTo });
      return { employees: resources, ...days, punches: [...punches.results, ...office.punches], projects: projects.results, records: records.results };
    },
  };
}
