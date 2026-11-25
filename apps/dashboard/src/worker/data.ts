// Loads stored facts and assembles month and year reports.
import type { Env, Identity } from './auth.ts';
import { can } from './auth.ts';
import { buildMonth, daysOf, employeeYearRanking, projectYearRanking, type CostEntry, type CostType, type Wage } from '../calc/report.ts';
import { forecastMonth, forecastYear } from '../calc/forecast.ts';
import { employeeCalendarRows } from '../calc/employee-calendar.ts';
import { overviewDays } from '../calc/overview.ts';
import { absenceCredit } from '../calc/rules.ts';
import { subCalendarDays } from '../calc/sub-calendar.ts';
import { contractorHeadcounts, projectWeek } from '../calc/project-dashboard.ts';
import type { Assignment, HoursFact, PlanDayEntry } from '../calc/plan.ts';
import { holidaySet, loadSettings, targetFor, type Settings } from './settings.ts';

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');
export const berlinToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());

type Facts = Awaited<ReturnType<typeof loadFacts>>;

export async function loadFacts(env: Env, months: string[]) {
  const q = placeholders(months.length);
  const all = <T>(sql: string, ...extra: unknown[]) => env.DB.prepare(sql).bind(...months, ...extra).all<T>().then((r) => r.results);
  const lo = months[0] + '-01', hi = months[months.length - 1] + '-31';
  const [emp, sub, hours, absence, warn, costTypes, entries, wages, resources] = await Promise.all([
    all<{ month: string; day: string; resource_id: string; name: string; project_id: string; label: string; report_id: string; customer_cents: number; employee_cents: number; binding: number; estimated: number }>(`SELECT * FROM fact_emp WHERE month IN (${q})`),
    all<{ month: string; day: string; project_id: string; label: string; firm: string; team: string; report_id: string; customer_cents: number; cost_cents: number | null; heads: number | null; hours_minutes: number | null; binding: number; estimated: number; basis: 'performance' | 'hourly' }>(`SELECT * FROM fact_sub WHERE month IN (${q})`),
    all<{ month: string; day: string; resource_id: string; project_id: string; minutes: number; travel: number; open_shift: number }>(`SELECT * FROM fact_hours WHERE month IN (${q})`),
    all<{ month: string; day: string; resource_id: string; kind: string; review: number }>(`SELECT * FROM fact_absence WHERE month IN (${q})`),
    all<{ month: string; text: string }>(`SELECT * FROM ingest_warning WHERE month IN (${q})`),
    env.DB.prepare('SELECT id, name, category, monthly_cents, valid_from, valid_to FROM cost_type').all<{ id: string; name: string; category: string; monthly_cents: number; valid_from: string; valid_to: string | null }>().then((r) => r.results),
    env.DB.prepare('SELECT id, day, kind, project_id, firm, subcategory, cents FROM cost_entry WHERE day >= ? AND day <= ?').bind(lo, hi).all<{ id: string; day: string; kind: 'sub' | 'alex' | 'other'; project_id: string; firm: string; subcategory: string; cents: number }>().then((r) => r.results),
    env.DB.prepare('SELECT resource_id, valid_from, hourly_cents FROM wage').all<{ resource_id: string; valid_from: string; hourly_cents: number }>().then((r) => r.results),
    env.DB.prepare("SELECT id, name, code, archived FROM dim_resource WHERE kind = 'employee'").all<{ id: string; name: string; code: string; archived: number }>().then((r) => r.results),
  ]);
  return { emp, sub, hours, absence, warn, costTypes, entries, wages, resources };
}

function monthInput(f: Facts, month: string, s: Settings, showPersonnel: boolean) {
  return {
    month,
    emp: f.emp.filter((r) => r.month === month).map((r) => ({ day: r.day, resourceId: r.resource_id, name: r.name, projectId: r.project_id, label: r.label, reportId: r.report_id, customer: r.customer_cents, employee: r.employee_cents, binding: !!r.binding, estimated: !!r.estimated })),
    sub: f.sub.filter((r) => r.month === month).map((r) => ({ day: r.day, projectId: r.project_id, label: r.label, firm: r.firm, team: r.team, reportId: r.report_id, customer: r.customer_cents, cost: r.cost_cents, heads: r.heads, minutes: r.hours_minutes, binding: !!r.binding, estimated: !!r.estimated, basis: r.basis })),
    hours: f.hours.filter((r) => r.month === month).map((r) => ({ day: r.day, resourceId: r.resource_id, projectId: r.project_id, minutes: r.minutes, travel: !!r.travel, open: !!r.open_shift })),
    absence: f.absence.filter((r) => r.month === month).map((r) => ({ day: r.day, resourceId: r.resource_id, kind: r.kind, review: !!r.review })),
    costTypes: f.costTypes.map((c): CostType => ({ id: c.id, name: c.name, category: c.category, monthly: c.monthly_cents, validFrom: c.valid_from, validTo: c.valid_to })),
    entries: f.entries.filter((e) => e.day.startsWith(month)).map((e): CostEntry => ({ id: e.id, day: e.day, kind: e.kind, projectId: e.project_id, firm: e.firm, subcategory: e.subcategory, cents: e.cents })),
    wages: f.wages.map((w): Wage => ({ resourceId: w.resource_id, validFrom: w.valid_from, hourly: w.hourly_cents })),
    resources: f.resources.map((r) => ({ id: r.id, name: r.name, code: r.code, archived: !!r.archived })),
    holidays: holidaySet(s, Number(month.slice(0, 4))),
    cfg: { target: targetFor(s, month), employerPct: s.employerPct, defaultHourly: s.defaultHourly, modelSaturdayBonus: s.modelSaturdayBonus },
    showPersonnel,
  };
}

// asOf = last day that counts as actual for the forecast of this month.
function asOfFor(month: string, today: string): string | null {
  const cur = today.slice(0, 7);
  if (month < cur) return daysOf(month).at(-1)!;
  if (month === cur) return today;
  return null;
}

export async function monthReport(env: Env, who: Identity, month: string) {
  const s = await loadSettings(env);
  const f = await loadFacts(env, [month]);
  const report = buildMonth(monthInput(f, month, s, can.personnel(who)));
  const today = berlinToday();
  const asOf = asOfFor(month, today);
  const byDay = Object.fromEntries(report.daily.map((d) => [d.day, d.total]));
  const forecast = asOf ? forecastMonth({ month, asOf, revenueByDay: byDay, holidays: holidaySet(s, Number(month.slice(0, 4))), saturdayCents: s.saturdayForecastCents }) : null;
  let costForecast: number | null = null;
  if (forecast && report.revenue > 0 && report.profit !== null) {
    const variable = report.costs.directProject + (report.costs.personnel ?? 0);
    costForecast = report.costs.fixedTotal + report.costs.central + Math.round((variable / report.revenue) * forecast.forecast);
  }
  const ingested = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('ingested:' + month).first<{ value: string }>();
  return {
    ...report, forecast, costForecast, ingestWarnings: f.warn.map((w) => w.text), lastIngest: ingested?.value || null,
    approval: s.approval, dataDate: berlinToday(),
  };
}

export async function yearReport(env: Env, who: Identity, year: number) {
  const s = await loadSettings(env);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const f = await loadFacts(env, months);
  const show = can.personnel(who);
  const reports = months.map((m) => buildMonth(monthInput(f, m, s, show)));
  const today = berlinToday();
  const revenue = Object.fromEntries(reports.map((r) => [r.month, r.revenue]));
  const cur = today.slice(0, 7);
  const idx = months.indexOf(cur);
  let running = 0;
  if (idx >= 0) {
    const fc = forecastMonth({ month: cur, asOf: today, revenueByDay: Object.fromEntries(reports[idx].daily.map((d) => [d.day, d.total])), holidays: holidaySet(s, year), saturdayCents: s.saturdayForecastCents });
    running = fc.forecast;
  }
  const hasData = new Set(months.filter((m) => f.emp.some((r) => r.month === m) || f.sub.some((r) => r.month === m) || f.hours.some((r) => r.month === m)));
  const fy = forecastYear(year, today, revenue, running, hasData);

  const subMap = new Map<string, { firm: string; revenue: number; cost: number; profit: number; personDays: number }>();
  for (const r of reports) {
    for (const sb of r.subs) {
      const o = subMap.get(sb.firm) || { firm: sb.firm, revenue: 0, cost: 0, profit: 0, personDays: 0 };
      o.revenue += sb.revenue; o.cost += sb.cost; o.profit += sb.profit; o.personDays += sb.personDays; subMap.set(sb.firm, o);
    }
  }
  const booked = [...f.emp, ...f.sub].filter((r) => r.binding);
  return {
    year, months: reports.map((r) => {
      const d = hasData.has(r.month);
      const days = booked.filter((x) => x.month === r.month).map((x) => x.day);
      return { month: r.month, hasData: d, hasRevenueData: days.length > 0, revenueThrough: days.filter((x) => x <= today).sort().at(-1) ?? null, revenue: r.revenue, own: r.ownRevenue, sub: r.subRevenue, pipeline: r.pipeline.total, overhead: d ? r.costs.overhead : null, directProject: d ? r.costs.directProject : null, personnel: d ? r.costs.personnel : null, profit: d ? r.profit : null };
    }),
    forecast: fy,
    ...employeeYearRanking(reports, year, today),
    subs: [...subMap.values()].sort((a, b) => b.revenue - a.revenue),
    ...projectYearRanking(reports),
    totals: { revenue: reports.reduce((a, r) => a + r.revenue, 0), profit: show ? reports.filter((r) => hasData.has(r.month)).reduce((a, r) => a + (r.profit ?? 0), 0) : null },
  };
}

// Year facts plus the planning data (manual hours, absences) merged into one calendar row per employee.
async function employeeYear(env: Env, year: number) {
  const s = await loadSettings(env);
  const date = berlinToday();
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const from = `${year}-01-01`, to = date < `${year}-12-31` ? date : `${year}-12-31`;
  const f = await loadFacts(env, months);
  const inputs = months.map((m) => monthInput(f, m, s, false));
  const own = inputs.flatMap((i) => i.emp).filter((r) => r.day >= from && r.day <= to).map((r) => ({ ...r, code: '' }));
  const subs = inputs.flatMap((i) => i.sub).filter((r) => r.day >= from && r.day <= to);
  const range = [from, to];
  // hours entered by hand replace the punches of the same person and day
  const manual = to < from ? [] : await env.PLAN.prepare('SELECT resource_id, day, data FROM day_entries WHERE day >= ? AND day <= ?').bind(...range).all<PlanDayEntry>().then((r) => r.results).catch(() => [] as PlanDayEntry[]);
  const assignments = to < from ? [] : (await env.PLAN.prepare('SELECT resource_id, project_id, day, assignment_type FROM assignments WHERE day >= ? AND day <= ?').bind(...range).all<Assignment>()).results;
  const hours: HoursFact[] = inputs.flatMap((i) => i.hours).filter((r) => r.day >= from && r.day <= to);
  const staff = employeeCalendarRows({ resources: f.resources.map(({ id, name, code }) => ({ id, name, code })), revenue: own, hours, manual, assignments, from, to });
  return { s, date, months, from, to, own, subs, staff };
}

export async function employeeCalendar(env: Env, year: number) {
  return (await employeeYear(env, year)).staff;
}

// Employees with an absence entry today (Europe/Berlin), independent of the selected period.
export async function employeesAbsentToday(env: Env) {
  const date = berlinToday();
  const people = (await env.DB.prepare("SELECT id, name, code FROM dim_resource WHERE kind = 'employee' AND archived = 0").all<{ id: string; name: string; code: string | null }>()).results;
  const assignments = (await env.PLAN.prepare('SELECT resource_id, project_id, day, assignment_type FROM assignments WHERE day = ?').bind(date).all<Assignment>()).results;
  const rows = employeeCalendarRows({ resources: people.map((p) => ({ id: p.id, name: p.name, code: p.code ?? '' })), assignments, from: date, to: date, revenue: [], hours: [], manual: [] });
  const absences = rows.flatMap(({ id, name, days }) => (days[0]?.absence ? [{ id, name, absence: days[0].absence }] : [])).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { date, absences };
}

// Whole-year daily revenue with the Monteur / Obermonteur / Nachunternehmer split, built from the stored facts.
export async function overviewCalendar(env: Env, year: number) {
  const { s, date, months, from, to, own, subs, staff } = await employeeYear(env, year);
  const roles = new Map((await env.DB.prepare("SELECT id, role FROM dim_resource WHERE kind = 'employee'").all<{ id: string; role: string | null }>()).results.map((r) => [r.id, r.role]));
  const cfg = months.map((month, i) => ({ month, target: absenceCredit(targetFor(s, month), year, i + 1, 1), dates: daysOf(month) }));
  const daily = overviewDays(staff, own, subs, cfg, roles);
  const cur = cfg.find((c) => c.month === date.slice(0, 7));
  const days = daily.filter((d) => d.day.startsWith(cur?.month ?? '-') && d.hasRevenue);
  const forecast = cur && days.length
    ? forecastMonth({ month: cur.month, asOf: days.at(-1)!.day, revenueByDay: Object.fromEntries(days.map((d) => [d.day, d.total])), holidays: holidaySet(s, year), saturdayCents: s.saturdayForecastCents }).forecast
    : null;
  return { date, daily, forecast };
}

// Binding subcontractor bookings per firm, project, team and day for the Nachunternehmer calendar.
export async function subCalendar(env: Env, year: number) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const f = await loadFacts(env, months);
  const s = await loadSettings(env);
  return subCalendarDays(months.flatMap((m) => monthInput(f, m, s, false).sub), String(year));
}

// Today's staffing from the planning tables, project start, revenue so far and the stored order value.
export async function projectRoster(env: Env) {
  const date = berlinToday();
  const current = projectWeek(date);
  const plan = (sql: string, ...a: unknown[]) => env.PLAN.prepare(sql).bind(...a);
  const [projects, spans, staff, contractors, revenue, orders] = await Promise.all([
    env.DB.prepare('SELECT id, name, number, archived FROM dim_project').all<{ id: string; name: string; number: string; archived: number }>().then((r) => r.results),
    plan("SELECT project_id, MIN(day) AS start, MAX(day) AS last FROM assignments WHERE assignment_type = 'project' AND project_id IS NOT NULL GROUP BY project_id").all<{ project_id: string; start: string; last: string }>().then((r) => r.results),
    plan("SELECT a.project_id, COUNT(DISTINCT a.resource_id) AS n FROM assignments a JOIN resources r ON r.id = a.resource_id WHERE a.day = ? AND a.assignment_type = 'project' AND r.kind = 'employee' AND a.project_id IS NOT NULL GROUP BY a.project_id", date).all<{ project_id: string; n: number }>().then((r) => r.results),
    plan("SELECT a.resource_id, a.project_id, a.day, a.assignment_type, a.count FROM assignments a JOIN resources r ON r.id = a.resource_id WHERE a.day = ? AND a.assignment_type = 'project' AND r.kind = 'contractor'", date).all<Assignment>().then((r) => r.results).catch(() => null),
    env.DB.prepare('SELECT project_id, MAX(label) AS label, SUM(customer_cents) AS cents FROM (SELECT project_id, label, customer_cents FROM fact_emp WHERE binding = 1 AND day <= ? UNION ALL SELECT project_id, label, customer_cents FROM fact_sub WHERE binding = 1 AND day <= ?) GROUP BY project_id').bind(date, date).all<{ project_id: string; label: string; cents: number }>().then((r) => r.results),
    env.DB.prepare('SELECT project_id, cents FROM project_order').all<{ project_id: string; cents: number }>().then((r) => r.results),
  ]);
  const heads = contractors ? contractorHeadcounts(contractors, new Set(contractors.map((c) => c.resource_id)), date) : new Map<string, number | null>();
  const span = new Map(spans.map((x) => [x.project_id, x]));
  const rev = new Map(revenue.map((x) => [x.project_id, x]));
  const staffToday = new Map(staff.map((x) => [x.project_id, x.n]));
  const order = new Map(orders.map((x) => [x.project_id, x.cents]));
  const labels = new Map(projects.map((p) => [p.id, { name: `${p.number} ${p.name}`.trim(), archived: !!p.archived }]));
  for (const r of revenue) if (!labels.has(r.project_id)) labels.set(r.project_id, { name: r.label, archived: false });
  return [...labels].map(([id, label]) => {
    const sp = span.get(id);
    return {
      id, name: label.name, archived: label.archived || !(sp && sp.last >= current.from), start: sp?.start ?? null,
      today: staffToday.get(id) ?? 0, contractorsToday: contractors ? (heads.get(id) ?? 0) : null,
      revenue: rev.get(id)?.cents ?? 0, order: order.get(id) ?? null,
    };
  }).sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'de', { numeric: true }));
}
