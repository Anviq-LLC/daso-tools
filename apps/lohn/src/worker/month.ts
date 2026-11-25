import { GROSS, MONTHLY_PAYROLL_HOURS, MONTHLY_REVENUE_BONUS, type Inputs } from '../calc/payroll.ts';
// Loads one month from the three databases and runs the calculation.
import { computeMonth, DEFAULT_SETTINGS, type Adjustment, type NuAssign, type MonthResult, type Settings, type Terms, type ToolAccount } from '../calc/month.ts';
import { computeDay, daysOfMonth, berlinDay, berlin, isOfficeRole, reportVacationDates, type Day } from '../import/plan.ts';
import { importAufmass, parseRecords } from '../import/aufmass.ts';
import type { Env } from './auth.ts';
import { fullMonth, type NuPeriods } from '../calc/nu-periods.ts';
import { databaseSources, type PayrollSources } from './sources.ts';
import { activePayrollEmployee, manualPayrollEmployees } from './payroll.ts';

export const DEFAULT_TERMS = (name: string): Terms => ({
  name, lohngruppe: null, surchargeCents: 0, foreman: false, foremanCostCents: null, fixedSalaryCents: null, bonus: true, saturday: true, sub: false, subRateCents: null,
});

export async function loadSettings(env: Env): Promise<Settings & { equalSplit: boolean }> {
  const rows = (await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()).results;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const j = <T>(k: string, d: T): T => { try { return m[k] ? JSON.parse(m[k]) : d; } catch { return d; } };
  return {
    ...DEFAULT_SETTINGS,
    rates: j('rates', DEFAULT_SETTINGS.rates), tiers: j('tiers', DEFAULT_SETTINGS.tiers), holidays: j('holidays', []),
    absenceThreshold: j('absenceThreshold', DEFAULT_SETTINGS.absenceThreshold), saturdayRate: j('saturdayRate', 40),
    nightPct: j('nightPct', 25), sundayPct: j('sundayPct', 100), holidayPct: j('holidayPct', 150),
    equalSplit: j('equalSplit', false),
  };
}

export const prevMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
};

export function sameGroup(a: Partial<Terms>, b: Partial<Terms>) {
  return !!a.sub === !!b.sub && (a.sub || (a.lohngruppe ?? null) === (b.lohngruppe ?? null));
}

async function applyVacationBalances(
  result: MonthResult, past: Map<string, Map<string, Inputs>>, sources: PayrollSources,
) {
  const month = result.month;
  const year = month.slice(0, 4);
  const months = Array.from({ length: Number(month.slice(5)) - 1 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0'));
  const balances = result.rows.flatMap(row => {
    const history = past.get(row.resourceId);
    if (row.sub || !history) return [];
    const baseline = [...history].find(([, entry]) => Number.isFinite(entry.uebrig));
    return baseline ? [{ row, history, since: baseline[0], left: baseline[1].uebrig }] : [];
  });
  if (!balances.length) return;
  const earliest = balances.map(balance => balance.since).sort()[0];
  const periods = months.filter(period => period > earliest);
  let imported: ReturnType<typeof reportVacationDates> = new Map();
  if (periods.length) {
    const { assignments, entries } = await sources.planDays({
      from: periods[0] + '-01', to: fullMonth(periods[periods.length - 1]).to,
    });
    imported = reportVacationDates(assignments, entries);
  }
  for (const { row, history, since, left } of balances) {
    const dates = [...(imported.get(row.resourceId) ?? [])];
    const used = periods.filter(period => period > since).reduce((total, period) => {
      const override = history.get(period)?.urlaub;
      return total + (override === undefined ? dates.filter(day => day.startsWith(period)).length : override);
    }, 0);
    row.vacationBalanceBefore = left - used;
  }
}

export async function termsFor(env: Env, month: string, names: Record<string, string>, end = month + '-31') {
  const [rows, salaries] = await Promise.all([
    env.DB.prepare('SELECT resource_id, valid_from, data FROM employee_terms WHERE valid_from <= ? ORDER BY valid_from').bind(end).all<{ resource_id: string; valid_from: string; data: string }>(),
    env.DB.prepare('SELECT resource_id, cents, pay_basis FROM payroll_salaries WHERE from_month <= ? ORDER BY from_month')
      .bind(end.slice(0, 7)).all<{ resource_id: string; cents: number; pay_basis: 'fixed' | 'hourly' }>(),
  ]);
  const terms: Record<string, Terms> = {};
  const changed: string[] = [];
  const groupSince: Record<string, string> = {};
  for (const [id, name] of Object.entries(names)) terms[id] = DEFAULT_TERMS(name);
  for (const r of rows.results) {
    if (!(r.resource_id in names)) continue;
    const updated = { ...DEFAULT_TERMS(names[r.resource_id]), ...JSON.parse(r.data), name: names[r.resource_id] };
    if (!sameGroup(terms[r.resource_id], updated)) groupSince[r.resource_id] = r.valid_from;
    terms[r.resource_id] = updated;
    if (r.valid_from > month + '-01') changed.push(names[r.resource_id]);
  }
  for (const salary of salaries.results) {
    const person = terms[salary.resource_id];
    if (person && !person.sub) {
      person.fixedSalaryCents = salary.pay_basis === 'fixed' ? salary.cents : null;
      person.hourlyRateCents = salary.pay_basis === 'hourly' ? salary.cents : null;
    }
  }
  return { terms, changed, groupSince };
}

export async function liveMonth(env: Env, month: string, sources: PayrollSources = databaseSources(env)) {
  const [{ employees: planned, assignments, punches, entries, projects, records }, local] = await Promise.all([
    sources.month(month), manualPayrollEmployees(env),
  ]);
  const employees = [...planned, ...local.filter(person => activePayrollEmployee(person, month))];
  const settings = await loadSettings(env);
  const holidays = new Set(settings.holidays);
  const names = Object.fromEntries(employees.map((r) => [r.id, r.name]));
  const { terms, changed } = await termsFor(env, month, names);
  const officeIds = new Set(employees.filter(person => isOfficeRole(person.role)).map(person => person.id));
  for (const id of officeIds) terms[id].office = true;
  const days: Record<string, Day[]> = {};
  const foremanMinutes: Record<string, Record<string, number>> = {};
  const foremanDaily: Record<string, Record<string, Record<string, number>>> = {};
  const now = berlin(new Date().toISOString());
  for (const r of planned) {
    days[r.id] = daysOfMonth(month).map(d => computeDay(r.id, d, assignments, punches, entries, holidays, now, officeIds.has(r.id)));
  }
  for (const p of punches) {
    if (!p.ended || !p.project_id) continue;
    const day = berlinDay(p.started);
    if (!day.startsWith(month)) continue;
    const mins = Math.max(0, (Date.parse(p.ended) - Date.parse(p.started)) / 60000 - (p.pause || 0));
    const mine = (foremanMinutes[p.resource_id] ||= {});
    mine[p.project_id] = (mine[p.project_id] || 0) + mins;
    const byDay = ((foremanDaily[p.resource_id] ??= {})[p.project_id] ??= {});
    byDay[day] = (byDay[day] ?? 0) + mins;
  }

  const aufmass = parseRecords(records);
  const imp = importAufmass(aufmass, month, { allowEqualSplit: settings.equalSplit });
  const foremanOf = new Map(projects.map((p) => [p.id, p.foreman_id]));
  imp.nu = imp.nu.map((n) => ({ ...n, foremanId: foremanOf.get(n.projectId) ?? null }));
  const unknown = imp.enteredRevenue.filter((r) => !(r.resourceId in names));
  const revenue = imp.revenue.filter((r) => r.resourceId in names);
  const warnings = [...imp.warnings];
  if (unknown.length) warnings.push(`${unknown.length} Umsatzzeilen gehören zu Personen, die in der Montageplanung nicht (mehr) als Mitarbeiter geführt werden.`);
  if (changed.length) warnings.push(`Konditionen ändern sich im Monat (gelten für den ganzen Monat): ${changed.join(', ')}.`);
  const unchecked = [...new Map(imp.unchecked.map((u) => [u.day + u.project, u])).values()].sort((a, b) => a.day.localeCompare(b.day));

  const adj = (await env.DB.prepare('SELECT id, resource_id, kind, label, cents FROM adjustments WHERE month = ?').bind(month).all<{ id: string; resource_id: string; kind: string; label: string; cents: number }>()).results
    .map((a): Adjustment => ({ id: a.id, resourceId: a.resource_id, kind: a.kind, label: a.label, cents: a.cents }));
  const tools: Record<string, ToolAccount> = {};
  for (const t of (await env.DB.prepare('SELECT * FROM tool_accounts').all<{ resource_id: string; price_cents: number; monthly_rate_cents: number; paid_before_cents: number; prepaid_cents: number }>()).results)
    tools[t.resource_id] = { priceCents: t.price_cents, monthlyRateCents: t.monthly_rate_cents, paidBefore: t.paid_before_cents, prepaid: t.prepaid_cents };
  const otherNuCosts = Object.fromEntries((await env.DB.prepare('SELECT project_id, cents FROM nu_costs WHERE month = ?').bind(month).all<{ project_id: string; cents: number }>()).results.map((r) => [r.project_id, r.cents]));
  const nuAssign: Record<string, NuAssign> = {};
  for (const a of (await env.DB.prepare('SELECT project_id, first_id, second_id, second_pct, periods FROM nu_assign WHERE month = ?').bind(month).all<{ project_id: string; first_id: string | null; second_id: string | null; second_pct: number; periods: string | null }>()).results) {
    const full = fullMonth(month);
    const periods = a.second_id ? (a.periods ? JSON.parse(a.periods) as NuPeriods : { first: full, second: full }) : undefined;
    nuAssign[a.project_id] = { firstId: a.first_id, secondId: a.second_id, secondPct: a.second_pct, periods };
  }
  const prev = await env.DB.prepare('SELECT snapshot FROM months WHERE month = ?').bind(prevMonth(month)).first<{ snapshot: string | null }>();
  const carryIn: Record<string, number> = {};
  if (prev?.snapshot) for (const r of (JSON.parse(prev.snapshot) as { result: MonthResult }).result.rows) if (r.carryOut) carryIn[r.resourceId] = r.carryOut;

  const payrollRows = (await env.DB.prepare("SELECT month, resource_id, data FROM payroll_inputs WHERE month BETWEEN ? AND ? AND resource_id <> '_notes' ORDER BY month DESC")
    .bind(month.slice(0, 4) + '-01', month).all<{ month: string; resource_id: string; data: string }>()).results;
  const payrollInputs: Record<string, Inputs> = {};
  const revenueBonusOverrides: Record<string, number> = {};
  const pastPayroll = new Map<string, Map<string, Inputs>>();
  const manualRows = new Set<string>();
  for (const row of payrollRows) {
    const data = JSON.parse(row.data) as Inputs;
    if (row.month !== month) {
      const history = pastPayroll.get(row.resource_id) ?? new Map<string, Inputs>();
      history.set(row.month, data);
      pastPayroll.set(row.resource_id, history);
      continue;
    }
    if (Object.keys(data).length) manualRows.add(row.resource_id);
    payrollInputs[row.resource_id] = Object.fromEntries(GROSS.flatMap(({ key }) =>
      Number.isFinite(data[key]) ? [[key, data[key]]] : []));
    const hours = data[MONTHLY_PAYROLL_HOURS];
    if (Number.isSafeInteger(hours) && hours >= 0) payrollInputs[row.resource_id][MONTHLY_PAYROLL_HOURS] = hours;
    const override = data[MONTHLY_REVENUE_BONUS];
    if (Number.isSafeInteger(override)) revenueBonusOverrides[row.resource_id] = override;
  }

  const projectNames = new Map(projects.map(p => [p.id, p.name]));
  const result = computeMonth({ month, settings, terms, days, projectNames, revenue, enteredRevenue: imp.enteredRevenue, asOf: now.day, nu: imp.nu, foremanMinutes, foremanDaily, otherNuCosts, nuAssign, adjustments: adj, tools, carryIn, revenueBonusOverrides, payrollInputs, importWarnings: warnings });
  await applyVacationBalances(result, pastPayroll, sources);
  // Employees without any hours, terms or revenue in the month only add noise.
  result.rows = result.rows.filter((r) => r.overview?.revenue || r.overview?.holiday || r.warnings.length || r.metrics.workMinutes || r.metrics.revenue || r.lines.length || r.km || r.spesen ||
    r.payrollAbsences?.vacation || r.payrollAbsences?.unpaid || r.payrollAbsences?.sick || r.vacationBalanceBefore !== undefined ||
    manualRows.has(r.resourceId) || officeIds.has(r.resourceId) || terms[r.resourceId].lohngruppe ||
    terms[r.resourceId].fixedSalaryCents !== null || terms[r.resourceId].hourlyRateCents != null);
  return { result, unchecked, roles: Object.fromEntries(employees.map((r) => [r.id, r.role])), employees };
}
