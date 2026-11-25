import { crewReports, reportCost, reportTotals } from '../vendor/aufmass/business.ts';
import { defaultTimeRates, isTimeReport, reportDays, timePricingComplete, timeWorkers, workMinutes } from '../vendor/aufmass/time-reports.ts';
import { workerRate } from '../vendor/aufmass/team-members.ts';
import type { Data, Report } from '../vendor/aufmass/types.ts';
import type { NuRow } from '../calc/month.ts';

export const reportApproved = (report: Report) =>
  (report as Report & { review?: string }).review === 'approved';

function dates(from: string, to: string) {
  const start = Date.parse(from + 'T12:00:00Z'), end = Date.parse(to + 'T12:00:00Z');
  const count = 1 + (end - start) / 86400000;
  return Number.isInteger(count) && count > 0 && count <= 366
    ? Array.from({ length: count }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10)) : [];
}

export function importNuAufmass(data: Data, month: string): NuRow[] {
  const projects = new Map(data.projects.map(p => [p.id, p]));
  const result = new Map<string, NuRow>();
  const inMonth = (day: string) => day.startsWith(month + '-');
  for (const report of data.reports) {
    const project = projects.get(report.projectId);
    if (!project || report.state === 'draft') continue;
    const factor = project.factor ?? 0.9;
    const projectId = project.planId || project.id;
    const from = report.date.slice(0, 10), to = (report.endDate || report.date).slice(0, 10);
    const put = (day: string, revenue: number, cost: number | null, crew: Report, reason?: string) => {
      if (!inMonth(day)) return;
      const row: NuRow = result.get(projectId) ?? {
        projectId, projectName: project.name, foremanId: null, revenue: 0, cost: 0, approved: true, daily: {}, issues: [],
      };
      const entry = row.daily![day] ??= { revenue: 0, cost: 0 };
      row.revenue += revenue;
      entry.revenue += revenue;
      row.approved &&= reportApproved(crew);
      if (cost === null) row.cost = null;
      else {
        if (row.cost !== null) row.cost += cost;
        entry.cost += cost;
      }
      if (reason) row.issues!.push({ day, end: to, team: crew.team, reason, reportId: report.id });
      result.set(projectId, row);
    };

    if (isTimeReport(report)) {
      for (const dayReport of reportDays(report)) {
        if (!inMonth(dayReport.date)) continue;
        const stored = report.lines.filter(line => line.serviceDate === dayReport.date);
        for (const crew of crewReports(stored.length ? { ...dayReport, lines: stored } : dayReport, factor)) {
          if (!crew.teamWork) continue;
          const sheet = crew.timeSheet;
          const ratesByWorker = new Map(timeWorkers(crew).map(worker => [worker.id, worker.contractorRate]));
          const withCostRate = sheet ? { ...crew, timeSheet: { ...sheet, entries: sheet.entries.map(entry => {
            const rate = ratesByWorker.get(entry.workerId);
            if (entry.rates?.costHourly != null || typeof rate !== 'number' || !Number.isSafeInteger(rate) || rate < 0) return entry;
            return { ...entry, rates: { ...(entry.rates ?? defaultTimeRates()[entry.role]), costHourly: rate } };
          }) } } : crew;
          const cost = reportCost(withCostRate);
          const unfinished = !timePricingComplete(crew);
          const incompleteTime = crew.timeSheet?.entries.some(entry => workMinutes(entry) === null);
          const reason = cost === null ? incompleteTime ? 'Arbeitsbeginn, Arbeitsende oder Pause unvollständig'
            : !sheet?.entries.length ? 'Keine Stundenbuchung im Stundenaufmaß'
            : 'NU-Kostensatz im Stundenaufmaß fehlt'
            : unfinished ? 'Abrechnungssatz im Stundenaufmaß fehlt' : undefined;
          put(dayReport.date, reportTotals([crew], factor).employee, cost, crew, reason);
        }
      }
      continue;
    }

    const reportDates = dates(from, to);
    const byDay = new Map<string, Report['lines']>();
    for (const line of report.lines) {
      const day = (line.serviceDate || from).slice(0, 10);
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(line);
    }
    for (const [day, lines] of byDay) {
      if (!inMonth(day)) continue;
      for (const crew of crewReports({ ...report, lines }, factor)) {
        if (crew.teamWork) put(day, reportTotals([crew], factor).employee, 0, crew);
      }
    }
    const workDates = reportDates.filter(inMonth);
    if (!workDates.length) continue;
    for (const crew of crewReports(report, factor)) {
      const work = crew.teamWork;
      if (!work) continue;
      const rates = work.workers.map(worker => workerRate(work, worker));
      const ratesValid = rates.every(rate => typeof rate === 'number' && Number.isSafeInteger(rate) && rate >= 0);
      const totalsValid = work.workers.length > 0 && work.workers.every(w => typeof w.hours === 'number' && Number.isFinite(w.hours) && w.hours >= 0);
      if (!ratesValid || !totalsValid) {
        const reason = rates.some(rate => rate == null) ? 'NU-Stundensatz einer eingesetzten Person fehlt'
          : !totalsValid ? 'NU-Gesamtstunden im Aufmaß fehlen' : 'NU-Stundensatz im Aufmaß ist ungültig';
        put(workDates[0], 0, null, crew, reason);
        continue;
      }
      const totalWeight = work.workers.reduce((sum, w, index) => sum + w.hours! * rates[index]!, 0);
      const wholeCost = reportCost(crew) ?? Math.round(totalWeight);
      const dailyHoursValid = reportDates.length === 1 || work.workers.every(w =>
        reportDates.every(day => typeof w.dailyHours?.[day] === 'number' && Number.isFinite(w.dailyHours[day]) && w.dailyHours[day] >= 0) &&
        Math.abs(reportDates.reduce((sum, day) => sum + w.dailyHours![day], 0) - w.hours!) < 0.000001);
      if (workDates.length === reportDates.length && !dailyHoursValid) {
        put(workDates[0], 0, wholeCost, crew);
        if (wholeCost) (result.get(projectId)!.undatedCosts ??= []).push({ from, to });
      } else if (!dailyHoursValid && wholeCost !== 0) {
        put(workDates[0], 0, null, crew, 'Tagesstunden zur Kostenzuordnung über die Monatsgrenze fehlen');
      } else {
        let weight = 0, allocated = 0;
        for (const day of reportDates) {
          weight += reportDates.length === 1 ? totalWeight
            : work.workers.reduce((sum, w, index) => sum + (w.dailyHours?.[day] ?? 0) * rates[index]!, 0);
          const cumulative = totalWeight ? Math.round(wholeCost * weight / totalWeight) : 0;
          if (inMonth(day)) put(day, 0, cumulative - allocated, crew);
          allocated = cumulative;
        }
      }
    }
  }
  return [...result.values()].sort((a, b) => a.projectName.localeCompare(b.projectName, 'de'));
}
