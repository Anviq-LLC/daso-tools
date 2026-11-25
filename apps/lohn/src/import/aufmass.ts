// Turns Aufmass records into revenue per employee and service day (Mitarbeiterwert, after the 0.9 factor).
// The displayed shares follow the Aufmass accounting. Bonus eligibility follows the payroll settings.
import { crewReports, employeeShares, normalizeFinancialData } from '../vendor/aufmass/business.ts';
import { isTimeReport, reportDays, timePricingComplete } from '../vendor/aufmass/time-reports.ts';
import type { Data, Line, Project, Report } from '../vendor/aufmass/types.ts';
import type { NuRow, RevenueRow } from '../calc/month.ts';
import { importNuAufmass, reportApproved } from './nu-aufmass.ts';
import { dow } from './plan.ts';

export type Record_ = { id: string; kind: string; data: string };
export type AufmassImport = {
  revenue: RevenueRow[]; enteredRevenue: RevenueRow[]; nu: NuRow[]; warnings: string[];
  unchecked: { day: string; project: string }[];
};

export function parseRecords(rows: Record_[]): Data {
  const data = { projects: [], positions: [], reports: [], files: [], closures: [], payments: [], packages: [], audit: [], weekRecords: [] } as Data;
  for (const r of rows) {
    try {
      if (r.kind === 'project') data.projects.push(JSON.parse(r.data));
      else if (r.kind === 'report') data.reports.push(JSON.parse(r.data));
    } catch { /* unreadable record is skipped, the count of reports shows the gap */ }
  }
  return normalizeFinancialData(data);
}

// A report is split by service day first, then by crew, so crew shares apply per day.
function byServiceDay(r: Report): Report[] {
  if (isTimeReport(r)) return reportDays(r);
  const groups = new Map<string, Line[]>();
  for (const l of r.lines) {
    const d = (l.serviceDate || r.date || '').slice(0, 10);
    (groups.get(d) || groups.set(d, []).get(d)!).push(l);
  }
  return [...groups].map(([day, lines]) => ({ ...r, date: day, endDate: day, lines }));
}

export function importAufmass(
  data: Data, month: string, opts: { allowEqualSplit?: boolean } = {},
): AufmassImport {
  const out: AufmassImport = { revenue: [], enteredRevenue: [], nu: [], warnings: [], unchecked: [] };
  const project = new Map<string, Project>(data.projects.map((p) => [p.id, p]));
  const planOf = new Map<string, string>();
  for (const p of data.projects) for (const e of p.employees || []) {
    if (!e.planId) continue;
    planOf.set(e.id, e.planId);
    for (const old of e.legacyIds || []) planOf.set(old, e.planId);
  }
  const missing = new Set<string>();
  const drafts = new Set<string>();

  for (const report of data.reports) {
    const proj = project.get(report.projectId);
    if (!proj) continue;
    const factor = proj.factor ?? 0.9;
    const days = byServiceDay(report).filter((d) => (d.date || '').startsWith(month));
    if (!days.length) continue;
    if (report.state === 'draft') { drafts.add(proj.number + ' ' + proj.name); continue; }
    for (const day of days) {
      for (const sub of crewReports(day, factor)) {
        const label = `${proj.number} ${proj.name}`;
        const dayKey = (sub.date || '').slice(0, 10);
        const approved = reportApproved(sub);
        if (!approved) out.unchecked.push({ day: dayKey, project: label });
        if (sub.teamWork) continue;
        const members = sub.employeeMembers || [];
        if (!members.length) { out.warnings.push(`${label} ${dayKey}: Aufmaß ohne Mitarbeiter.`); continue; }
        if (!timePricingComplete(sub)) { out.warnings.push(`${label} ${dayKey}: Preise unvollständig, kein Umsatz übernommen.`); continue; }
        const personal = isTimeReport(sub) || members.length === 1;
        const dayRevenue: RevenueRow[] = [];
        for (const share of employeeShares(sub, factor)) {
          const id = planOf.get(share.employeeId);
          if (id) dayRevenue.push({ resourceId: id, day: dayKey, projectId: proj.id, label, cents: share.employee, approved });
          else missing.add(share.name);
        }
        out.enteredRevenue.push(...dayRevenue);
        // Saturday bonuses use the employee shares displayed in Aufmaß, including team measurements.
        const requirePersonalAllocation = !personal && dow(dayKey) !== 6;
        if (requirePersonalAllocation && !opts.allowEqualSplit) {
          out.warnings.push(`${label} ${dayKey}: Zuordnung fehlt (${members.length} Mitarbeiter ohne persönliche Zuordnung), Umsatz für Bonus nicht übernommen.`);
          continue;
        }
        out.revenue.push(...dayRevenue);
        if (requirePersonalAllocation) out.warnings.push(`${label} ${dayKey}: vorläufig gleich verteilt.`);
      }
    }
  }
  for (const name of missing) out.warnings.push(`Mitarbeiter ${name} ist im Aufmaßtool nicht mit der Montageplanung verknüpft.`);
  for (const d of drafts) out.warnings.push(`${d}: Entwürfe im Monat werden nicht gezählt.`);

  out.nu = importNuAufmass(data, month);
  return out;
}
